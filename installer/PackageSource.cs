using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using SharpCompress.Readers;

namespace MingYunInstaller
{
    /// <summary>aria2c 进度信息（字节）</summary>
    public struct AriaProgress
    {
        public long Done;
        public long Total;
        public long Speed;
    }

    /// <summary>
    /// 应用包获取与解压：
    /// - 离线版：直接读内嵌的 AppPackage.7z；
    /// - 线上版：用内嵌 aria2c（与主应用同款：-x16 -s64 不限速）从 GitHub Releases 下载压缩包，
    ///   失败时自动回退内置断点续传下载器。
    /// 解压用 SharpCompress（纯托管，Win7 兼容），支持 .7z / .zip。
    /// </summary>
    public static class PackageSource
    {
        public static event Action<string> Log;

        static void Say(string msg) { try { Log?.Invoke(msg); Debug.WriteLine("[Pkg] " + msg); } catch { } }

        /// <summary>释放内嵌 aria2c.exe 到临时目录（与主应用同一份：128 线程能力、不限速）</summary>
        static string EnsureAria2c()
        {
            var dir = Path.Combine(Path.GetTempPath(), "mia-aria2");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "aria2c.exe");
            if (File.Exists(path)) return path;
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MingYunInstaller.aria2c.exe"))
            {
                if (s == null) throw new FileNotFoundException("aria2c 缺失");
                using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
                    s.CopyTo(fs);
            }
            return path;
        }

        /// <summary>aria2c 多线程下载（主应用同款参数：单服务器连接 16、64 分片、不限速、进度逐行解析）</summary>
        public static async Task<long> DownloadWithAria2Async(string url, string target, IProgress<AriaProgress> progress, CancellationToken ct)
        {
            var aria2c = EnsureAria2c();
            var full = Path.GetFullPath(target);
            var dir = Path.GetDirectoryName(full);
            var name = Path.GetFileName(full);
            Directory.CreateDirectory(dir);
            try { if (File.Exists(full)) File.Delete(full); } catch { }

            // 与主应用完全一致：-x16 -s64 --max-download-limit=0 --max-overall-download-limit=0 --file-allocation=none
            var psi = new ProcessStartInfo(aria2c)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                Arguments = "--file-allocation=none -x16 -s64 --max-download-limit=0 --max-overall-download-limit=0 "
                          + "--console-log-level=warn --summary-interval=0 --auto-file-renaming=false "
                          + "--dir=\"" + dir + "\" --out=\"" + name + "\" \"" + url + "\""
            };
            Say("aria2c 启动：" + (string.IsNullOrEmpty(url) ? url : "（URL 已隐藏）"));

            using (var proc = Process.Start(psi))
            {
                using (ct.Register(() => { try { if (!proc.HasExited) proc.Kill(); } catch { } }))
                {
                    proc.OutputDataReceived += (s, e) => { if (e.Data != null) OnAriaLine(e.Data, progress); };
                    proc.ErrorDataReceived += (s, e) => { if (e.Data != null && e.Data.Trim().Length > 0) Say(e.Data); };
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();

                    while (!proc.HasExited)
                    {
                        ct.ThrowIfCancellationRequested();
                        await Task.Delay(100, ct);
                    }
                    await Task.Delay(150, CancellationToken.None);
                }

                if (proc.ExitCode != 0)
                    throw new Exception("aria2c 下载失败（退出码 " + proc.ExitCode + "）");
                if (!File.Exists(full) || new FileInfo(full).Length == 0)
                    throw new Exception("aria2c 下载产物为空");
                return new FileInfo(full).Length;
            }
        }

        static readonly Regex AriaLine = new Regex(@"\[#\w+\s+([\d.]+[KMGTP]?i?B)/([\d.]+[KMGTP]?i?B)\((\d+)%\)(.*?)DL:([\d.]+[KMGTP]?i?B)", RegexOptions.Compiled);
        static readonly Regex AriaLineNoSpeed = new Regex(@"\[#\w+\s+([\d.]+[KMGTP]?i?B)/([\d.]+[KMGTP]?i?B)\((\d+)%\)", RegexOptions.Compiled);

        static void OnAriaLine(string line, IProgress<AriaProgress> progress)
        {
            if (progress == null) return;
            var m = AriaLine.Match(line);
            long speed = 0;
            if (m.Success)
                speed = ParseSize(m.Groups[5].Value);
            else
                m = AriaLineNoSpeed.Match(line);
            if (!m.Success) return;
            long done = ParseSize(m.Groups[1].Value);
            long total = ParseSize(m.Groups[2].Value);
            try { progress.Report(new AriaProgress { Done = done, Total = total, Speed = speed }); } catch { }
        }

        static long ParseSize(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            var mm = Regex.Match(s, @"^([\d.]+)\s*([KMGTPE]?)(i?B)?$", RegexOptions.IgnoreCase);
            if (!mm.Success) return 0;
            double v = double.Parse(mm.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
            switch (mm.Groups[2].Value.ToUpperInvariant())
            {
                case "K": v *= 1024; break;
                case "M": v *= 1024 * 1024; break;
                case "G": v *= 1024L * 1024 * 1024; break;
                case "T": v *= 1024L * 1024 * 1024 * 1024; break;
            }
            return (long)v;
        }

        /// <summary>下载完整包（可选断点续传）。targetTemp 为 .part 临时路径</summary>
        public static async Task<long> DownloadAsync(string url, string targetTemp, IProgress<long> progress, CancellationToken ct)
        {
            if (!File.Exists(targetTemp)) File.WriteAllBytes(targetTemp, new byte[0]);
            long existing = new FileInfo(targetTemp).Length;

            var req = WebRequest.Create(url) as HttpWebRequest;
            req.UserAgent = "MingYunInstaller/1.0";
            req.Proxy = null;
            if (existing > 0)
            {
                req.AddRange(existing);
                req.Timeout = 30000;
            }
            else
            {
                req.Timeout = 30000;
            }

            using (var resp = await Task.Factory.FromAsync(req.BeginGetResponse, req.EndGetResponse, null).ConfigureAwait(false) as HttpWebResponse)
            {
                var total = existing + (resp.ContentLength >= 0 ? resp.ContentLength : 0);
                using (var fs = new FileStream(targetTemp, FileMode.Append, FileAccess.Write, FileShare.Read, 64 * 1024, true))
                using (var src = resp.GetResponseStream())
                {
                    var buf = new byte[256 * 1024];
                    int n;
                    long done = existing;
                    while ((n = src.Read(buf, 0, buf.Length)) > 0)
                    {
                        ct.ThrowIfCancellationRequested();
                        await fs.WriteAsync(buf, 0, n).ConfigureAwait(false);
                        done += n;
                        progress?.Report(done);
                    }
                    return done;
                }
            }
        }

        /// <summary>
        /// 解压 .7z / .zip 到目标目录（带条目级进度）。
        /// 注意：SharpCompress 的 ReaderFactory 不支持 7z（会抛「Cannot determine compressed stream type」），
        /// 且其 SevenZip 解析库对 electron-builder 产出的 LZMA2 7z 无法解压（内置 NRE）。
        /// 因此 .7z 一律走官方 7za.exe（优先本机 7-Zip，否则内嵌版），进度用 -bsp1 百分比解析。
        /// </summary>
        public static void Extract(string archivePath, string targetDir, IProgress<double> progress)
        {
            Directory.CreateDirectory(targetDir);
            bool is7z = archivePath.EndsWith(".7z", StringComparison.OrdinalIgnoreCase);

            if (is7z)
            {
                ExtractVia7za(archivePath, targetDir, progress);
                return;
            }

            long total = TotalEntryBytes(archivePath);
            long done = 0;
            using (var fs = File.OpenRead(archivePath))
            using (var reader = ReaderFactory.Open(fs, new ReaderOptions { LookForHeader = true, LeaveStreamOpen = false }))
            {
                while (reader.MoveToNextEntry())
                {
                    var e = reader.Entry;
                    ExtractEntry(e.Key, e.IsDirectory, e.Size, () => reader.OpenEntryStream(), targetDir, ref done, total, progress);
                }
            }
            progress?.Report(1.0);
        }

        /// <summary>用 7za / 7z 命令行解压 7z（-bsp1 输出百分比），退出码非 0 抛错</summary>
        static void ExtractVia7za(string archivePath, string targetDir, IProgress<double> progress)
        {
            var exe = Find7zExe();
            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                Arguments = "x \"" + archivePath + "\" -o\"" + targetDir + "\" -y -bsp1"
            };
            using (var proc = Process.Start(psi))
            {
                proc.OutputDataReceived += (s, e) =>
                {
                    if (e.Data == null) return;
                    var pct = ParsePct(e.Data);
                    if (pct.HasValue) progress?.Report(pct.Value);
                    else Say(e.Data);
                };
                proc.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Say(e.Data); };
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                proc.WaitForExit(30 * 60 * 1000);
                if (!proc.HasExited) { try { proc.Kill(); } catch { } }
                if (proc.ExitCode != 0)
                    throw new Exception("7z 解压失败（退出码 " + proc.ExitCode + "）");
            }
            progress?.Report(1.0);
        }

        static readonly Regex PctRe = new Regex(@"(\d{1,3})\s*%", RegexOptions.Compiled);
        static int? ParsePct(string line)
        {
            int last = -1; bool any = false;
            // -bsp1 的输出中可能有 % 的清理转义，逐段匹配取最后一段
            foreach (string seg in line.Split('\r', '\n'))
            {
                var m = PctRe.Match(seg);
                if (m.Success)
                {
                    int v;
                    if (int.TryParse(m.Groups[1].Value, out v) && v >= 0 && v <= 100) { last = v; any = true; }
                }
            }
            return any ? (int?)last : null;
        }

        /// <summary>定位可用的 7z 解压器：本机 7-Zip → 内嵌 7za.exe</summary>
        static string Find7zExe()
        {
            // 1) 已安装的 7-Zip
            try
            {
                string[] cands =
                {
                    @"%ProgramFiles%\7-Zip\7z.exe",
                    @"%ProgramFiles(x86)%\7-Zip\7z.exe",
                    @"%LocalAppData%\Programs\7-Zip\7z.exe"
                };
                foreach (var c in cands)
                {
                    var p = Environment.ExpandEnvironmentVariables(c);
                    if (File.Exists(p)) return p;
                }
                // 注册表
                foreach (var hive in new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine })
                {
                    foreach (var sub in new[]
                    {
                        @"Software\7-Zip",
                        @"Software\Microsoft\Windows\CurrentVersion\App Paths\7z.exe"
                    })
                    {
                        try
                        {
                            using (var k = hive.OpenSubKey(sub))
                            {
                                var v = k?.GetValue("Path") as string ?? k?.GetValue(null) as string;
                                var p = v != null ? Path.Combine(v, "7z.exe") : null;
                                if (p != null && File.Exists(p)) return p;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            // 2) 内嵌 7za.exe（构建时随安装器一同发布）
            var dir = Path.Combine(Path.GetTempPath(), "mia-7za");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "7za.exe");
            if (!File.Exists(path))
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MingYunInstaller.7za.exe"))
                {
                    if (s == null) throw new FileNotFoundException("未找到 7za 解压组件，且本机未安装 7-Zip");
                    using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
                        s.CopyTo(fs);
                }
            }
            return path;
        }

        static void ExtractEntry(string key, bool isDir, long size, Func<Stream> openStream, string targetDir, ref long done, long total, IProgress<double> progress)
        {
            if (isDir)
            {
                var dir = Path.Combine(targetDir, key ?? "");
                if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                return;
            }
            var outPath = Path.Combine(targetDir, key ?? "");
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(outPath));
                using (var es = openStream())
                using (var os = new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, false))
                {
                    es.CopyTo(os);
                }
            }
            catch (Exception ex)
            {
                Say("解压失败（跳过）: " + (key ?? "") + " " + ex.Message);
            }
            if (size > 0) done += size;
            progress?.Report(total > 0 ? Math.Min(1.0, (double)done / total) : 0);
        }

        static long TotalEntryBytes(string archivePath)
        {
            try
            {
                long sum = 0;
                bool is7z = archivePath.EndsWith(".7z", StringComparison.OrdinalIgnoreCase);
                if (is7z)
                {
                    using (var fs = File.OpenRead(archivePath))
                    using (var archive = SharpCompress.Archives.SevenZip.SevenZipArchive.Open(fs))
                    {
                        foreach (var e in archive.Entries)
                            if (e.Size > 0) sum += e.Size;
                    }
                }
                else
                {
                    using (var fs = File.OpenRead(archivePath))
                    using (var reader = ReaderFactory.Open(fs, new ReaderOptions { LookForHeader = true, LeaveStreamOpen = false }))
                    {
                        while (reader.MoveToNextEntry())
                        {
                            var s = reader.Entry.Size;
                            if (s > 0) sum += s;
                        }
                    }
                }
                return sum;
            }
            catch { return 0; }
        }
    }

    /// <summary>极简 http 可用性检查（仅用于诊断）</summary>
    public static class NetCheck
    {
        public static void EnsureTls()
        {
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
            try { ServicePointManager.Expect100Continue = false; } catch { }
        }
    }
}