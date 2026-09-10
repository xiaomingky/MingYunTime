using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using Microsoft.Win32;

namespace MingYunInstaller
{
    /// <summary>应用配置（内嵌 AppConfig.json）</summary>
    public class Config
    {
        public string AppName = "茗韵时光";
        public string AppExe = "茗韵时光.exe";
        public string UninstallKey = "茗韵时光";
        public string DisplayVersion = "3.4.5";
        public string Publisher = "xiaomingky";
        public string Repo = "xiaomingky/MingYunTime";
        public string DefaultInstallDir = "%LOCALAPPDATA%\\Programs\\茗韵时光";
        public string DownloadBase = "";
        public string DownloadFile = "";
        public bool HasEmbeddedPackage => EmbeddedPackageLength > 0;
        public long EmbeddedPackageLength { get; private set; }

        private static volatile Config _inst;
        public static Config Current => _inst ?? (_inst = Load());

        static Config Load()
        {
            var c = new Config();
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MingYunInstaller.AppConfig.json"))
                {
                    if (s != null)
                    {
                        var bytes = new byte[s.Length];
                        s.Read(bytes, 0, bytes.Length);
                        var json = Encoding.UTF8.GetString(bytes);
                        var m = System.Text.RegularExpressions.Regex.Matches(json, "\"([^\"]+)\"\\s*:\\s*\"([^\"]*)\"");
                        var d = new Dictionary<string, string>();
                        foreach (System.Text.RegularExpressions.Match mm in m)
                            if (!d.ContainsKey(mm.Groups[1].Value)) d[mm.Groups[1].Value] = mm.Groups[2].Value;
                        if (d.ContainsKey("appName")) c.AppName = d["appName"];
                        if (d.ContainsKey("appExe")) c.AppExe = d["appExe"];
                        if (d.ContainsKey("uninstallKey")) c.UninstallKey = d["uninstallKey"];
                        if (d.ContainsKey("displayVersion")) c.DisplayVersion = d["displayVersion"];
                        if (d.ContainsKey("publisher")) c.Publisher = d["publisher"];
                        if (d.ContainsKey("repo")) c.Repo = d["repo"];
                        if (d.ContainsKey("defaultInstallDir")) c.DefaultInstallDir = d["defaultInstallDir"];
                        if (d.ContainsKey("downloadBase")) c.DownloadBase = d["downloadBase"];
                        if (d.ContainsKey("downloadFile")) c.DownloadFile = d["downloadFile"];
                    }
                }
            }
            catch (Exception e) { Debug.WriteLine("Config parse: " + e.Message); }

            // 内嵌 7z 包探测
            c.EmbeddedPackageLength = ResourceLength("MingYunInstaller.AppPackage.7z");
            return c;
        }

        static long ResourceLength(string name)
        {
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                    return s?.Length ?? 0;
            }
            catch { return 0; }
        }

        public Stream OpenEmbeddedPackage() => Assembly.GetExecutingAssembly().GetManifestResourceStream("MingYunInstaller.AppPackage.7z");
    }

    /// <summary>安装/卸载的注册表、快捷方式、启动等系统操作（HKCU 免管理员，Win7 起全兼容）</summary>
    public static class InstallOps
    {
        static string UninstallRoot => @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Config.Current.UninstallKey;

        /// <summary>
        /// 从注册表/常见目录识别上次安装目录（兼容 electron-builder NSIS 与自定义安装器）：
        /// 按可靠度：1) 精确键 InstallLocation → 2) 全量扫描卸载子键 DisplayName 命中 → 3) DisplayIcon / UninstallString 提取 → 4) 常见安装目录含 exe 兜底
        /// </summary>
        public static string DetectExistingInstall()
        {
            var found = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Action<string> add = dir =>
            {
                if (string.IsNullOrWhiteSpace(dir)) return;
                dir = dir.Trim().Trim('"').TrimEnd('\\');
                if (dir.Length < 3 || dir.IndexOf(':') < 0) return;
                if (!Directory.Exists(dir)) return;
                if (!HasAppExe(dir)) return; // 目录下要有主程序 exe 才算真实安装
                if (seen.Add(dir.ToLowerInvariant())) found.Add(dir);
            };

            // 1) 精确键的 InstallLocation / DisplayIcon / UninstallString
            foreach (var name in new[] { "InstallLocation", "DisplayIcon", "UninstallString" })
            {
                var v = ReadUninstallValue(name);
                if (string.IsNullOrEmpty(v)) continue;
                if (name == "InstallLocation") add(v);
                else AddPathFromValue(v, add);
            }
            if (found.Count > 0) return found[0];

            // 2) 全量扫描两个 Hive 的卸载子键，DisplayName 命中产品名
            string[] productNames = { Config.Current.AppName, "茗韵时光", "茗韵", "MingYunTime", "MingYun" };
            EachUninstallSubKey(key =>
            {
                try
                {
                    var dn = key.GetValue("DisplayName") as string;
                    if (string.IsNullOrEmpty(dn)) return;
                    bool hit = false;
                    foreach (var pn in productNames)
                        if (pn.Length > 0 && dn.IndexOf(pn, StringComparison.OrdinalIgnoreCase) >= 0) { hit = true; break; }
                    if (!hit) return;
                    add(key.GetValue("InstallLocation") as string);
                    AddPathFromValue(key.GetValue("DisplayIcon") as string, add);
                    AddPathFromValue(key.GetValue("UninstallString") as string, add);
                }
                catch { }
            });
            if (found.Count > 0) return found[0];

            // 3) 常见安装目录兜底（per-user / per-machine / 历史 Tauri 版）
            string[] candidates =
            {
                ExpandDefaultDir(),
                @"%LOCALAPPDATA%\Programs\" + Config.Current.AppName,
                @"%LOCALAPPDATA%\Programs\MingYunTime",
                @"%ProgramFiles%\" + Config.Current.AppName,
                @"%ProgramFiles%\MingYunTime",
                @"%ProgramFiles(x86)%\" + Config.Current.AppName,
                @"%ProgramFiles(x86)%\MingYunTime",
                @"%LocalAppData%\MingYunTime",
                @"%LocalAppData%\茗韵时光"
            };
            foreach (var c in candidates)
                add(Environment.ExpandEnvironmentVariables(c));
            return found.Count > 0 ? found[0] : null;
        }

        /// <summary>目录下是否存在主程序 exe（兼容 茗韵时光.exe / MingYunTime.exe / *-Tauri 等）</summary>
        static bool HasAppExe(string dir)
        {
            try
            {
                if (!Directory.Exists(dir)) return false;
                var exe = Config.Current.AppExe;
                if (File.Exists(Path.Combine(dir, exe))) return true;
                foreach (var f in Directory.GetFiles(dir, "*.exe"))
                {
                    var n = Path.GetFileNameWithoutExtension(f);
                    if (n.IndexOf("茗韵", StringComparison.OrdinalIgnoreCase) >= 0
                        || n.IndexOf("MingYunTime", StringComparison.OrdinalIgnoreCase) >= 0
                        || n.IndexOf("MingYun", StringComparison.OrdinalIgnoreCase) >= 0)
                        return true;
                }
            }
            catch { }
            return false;
        }

        /// <summary>从 DisplayIcon / UninstallString 等值中提取 exe 路径并取其目录</summary>
        static void AddPathFromValue(string value, Action<string> add)
        {
            if (string.IsNullOrEmpty(value)) return;
            // 提取形如 "C:\path\xxx.exe" 或裸路径 C:\path\xxx.exe 的可执行文件路径
            var m = System.Text.RegularExpressions.Regex.Match(value, @"([A-Za-z]:[^""\r\n]*?\.exe)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!m.Success) return;
            var exe = m.Groups[1].Value.Trim();
            try { add(Path.GetDirectoryName(exe)); } catch { }
        }

        /// <summary>遍历两个 Hive 的卸载子键</summary>
        static void EachUninstallSubKey(Action<Microsoft.Win32.RegistryKey> visit)
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    foreach (var sub in new[] { @"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                                                @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
                    {
                        using (var rk = hive.OpenSubKey(sub))
                        {
                            if (rk == null) continue;
                            foreach (var name in rk.GetSubKeyNames())
                            {
                                try { using (var k = rk.OpenSubKey(name)) { if (k != null) visit(k); } }
                                catch { }
                            }
                        }
                    }
                }
                catch { }
            }
        }

        public static string ReadUninstallValue(string name)
        {
            try
            {
                var r = Registry.CurrentUser.OpenSubKey(UninstallRoot);
                if (r != null)
                {
                    var v = r.GetValue(name) as string;
                    if (!string.IsNullOrEmpty(v)) return v;
                }
                r = Registry.LocalMachine.OpenSubKey(UninstallRoot);
                if (r != null)
                {
                    var v = r.GetValue(name) as string;
                    if (!string.IsNullOrEmpty(v)) return v;
                }
            }
            catch { }
            return null;
        }

        public static string ExpandDefaultDir()
        {
            var dir = Config.Current.DefaultInstallDir;
            if (string.IsNullOrEmpty(dir)) dir = @"%LOCALAPPDATA%\Programs\" + Config.Current.AppName;
            return Environment.ExpandEnvironmentVariables(dir);
        }

        /// <summary>写入卸载注册项（HKCU），UninstallString 指向部署到安装目录的卸载器</summary>
        public static void WriteUninstallEntry(string installDir, string exePath, string uninstallerPath)
        {
            try
            {
                var rk = Registry.CurrentUser.CreateSubKey(UninstallRoot);
                rk.SetValue("DisplayName", Config.Current.AppName);
                rk.SetValue("DisplayVersion", Config.Current.DisplayVersion);
                rk.SetValue("Publisher", Config.Current.Publisher);
                rk.SetValue("InstallLocation", installDir);
                rk.SetValue("DisplayIcon", "\"" + exePath + "\",0");
                rk.SetValue("NoModify", 1);
                rk.SetValue("NoRepair", 1);
                rk.SetValue("EstimatedSize", 0, RegistryValueKind.DWord);
                var un = !string.IsNullOrEmpty(uninstallerPath) ? uninstallerPath : Assembly.GetExecutingAssembly().Location;
                rk.SetValue("UninstallString", "\"" + un + "\" --uninstall");
            }
            catch { }
        }

        public static void RemoveUninstallEntry()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallRoot, false); } catch { }
        }

        /// <summary>
        /// 把卸载入口（安装器自身）部署到安装目录，供「控制面板卸载 / 开始菜单卸载」使用。
        /// 返回卸载器路径；目录不可写时返回 null（此时注册表仍指向安装器原始位置）。
        /// </summary>
        public static string DeployUninstaller(string installDir)
        {
            try
            {
                var src = Assembly.GetExecutingAssembly().Location;
                var dst = Path.Combine(installDir, "卸载" + Config.Current.AppName + ".exe");
                if (!string.Equals(Path.GetFullPath(src).TrimEnd('\\'),
                                   Path.GetFullPath(dst).TrimEnd('\\'),
                                   StringComparison.OrdinalIgnoreCase))
                    File.Copy(src, dst, true);
                return dst;
            }
            catch (Exception e) { Debug.WriteLine("DeployUninstaller: " + e.Message); return null; }
        }

        /// <summary>创建桌面 + 开始菜单快捷方式，以及开始菜单「卸载」快捷方式（WshShell COM，Win7 起可用）</summary>
        public static void CreateShortcuts(string exePath, string installDir, bool desktop, string uninstallerPath = null)
        {
            try
            {
                var appName = Config.Current.AppName;
                var icon = exePath;

                if (desktop)
                {
                    var dt = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateLnk(Path.Combine(dt, appName + ".lnk"), exePath, installDir, icon, null);
                }
                var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
                if (!Directory.Exists(startMenu)) Directory.CreateDirectory(startMenu);
                CreateLnk(Path.Combine(startMenu, appName + ".lnk"), exePath, installDir, icon, null);

                // 卸载快捷方式（控制面板之外的另一入口）
                if (!string.IsNullOrEmpty(uninstallerPath) && File.Exists(uninstallerPath))
                    CreateLnk(Path.Combine(startMenu, "卸载 " + appName + ".lnk"), uninstallerPath, installDir, uninstallerPath, "--uninstall");
            }
            catch { }
        }

        public static void RemoveShortcuts()
        {
            try
            {
                var appName = Config.Current.AppName;
                var dt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), appName + ".lnk");
                if (File.Exists(dt)) File.Delete(dt);
                var sm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
                if (File.Exists(Path.Combine(sm, appName + ".lnk"))) File.Delete(Path.Combine(sm, appName + ".lnk"));
                if (File.Exists(Path.Combine(sm, "卸载 " + appName + ".lnk"))) File.Delete(Path.Combine(sm, "卸载 " + appName + ".lnk"));
            }
            catch { }
        }

        /// <summary>
        /// 静默执行完整卸载（供部署在安装目录的卸载器副本以 --removal 参数调用）：
        /// 退出应用 → 删快捷方式/注册 → 整删安装目录 → 延迟自删。
        /// 若自身恰在安装目录内（防御性兜底），先复制到 temp 重跑，本进程退出。
        /// </summary>
        public static void RunRemoval(string installDir)
        {
            var self = Assembly.GetExecutingAssembly().Location;
            if (!string.IsNullOrEmpty(self) && !string.IsNullOrEmpty(installDir)
                && Path.GetDirectoryName(self).StartsWith(installDir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                // 自身被安装目录锁定：复制到 temp 后递归执行，本进程退出
                try
                {
                    var copy = Path.Combine(Path.GetTempPath(), "mia_un_" + Guid.NewGuid().ToString("N") + ".exe");
                    File.Copy(self, copy, true);
                    Process.Start(new ProcessStartInfo(copy, "--removal=\"" + installDir + "\"") { UseShellExecute = false });
                }
                catch (Exception e) { Debug.WriteLine("RunRemoval respawn: " + e.Message); }
                return;
            }

            try { KillRunningApp(); } catch { }
            try { RemoveShortcuts(); } catch { }
            try { RemoveUninstallEntry(); } catch { }
            if (!string.IsNullOrEmpty(installDir) && Directory.Exists(installDir))
            {
                try { Directory.Delete(installDir, true); }
                catch (Exception e) { Debug.WriteLine("RemoveInstallDir: " + e.Message); }
            }
            // 延迟自删自身（temp 副本），避免卡住运行中的 exe
            try { ScheduleSelfDelete(Assembly.GetExecutingAssembly().Location); } catch { }
        }

        /// <summary>让 cmd 延迟 2 秒后删除自身 exe（运行中的 exe 不能即时删除）</summary>
        static void ScheduleSelfDelete(string exePath)
        {
            try
            {
                if (!File.Exists(exePath)) return;
                var ps = new ProcessStartInfo("cmd.exe",
                    "/c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + exePath + "\"")
                { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                Process.Start(ps);
            }
            catch { }
        }

        static void CreateLnk(string lnkPath, string exePath, string workDir, string iconPath, string arguments)
        {
            try
            {
                // WScript.Shell COM（ProgID 动态创建，免 interop 程序集，Win7 起可用）
                var wsType = Type.GetTypeFromProgID("WScript.Shell");
                if (wsType == null) throw new Exception("WScript.Shell 不可用");
                dynamic ws = Activator.CreateInstance(wsType);
                dynamic sc = ws.CreateShortcut(lnkPath);
                sc.TargetPath = exePath;
                sc.WorkingDirectory = workDir;
                sc.IconLocation = iconPath + ",0";
                sc.Description = Config.Current.AppName;
                if (!string.IsNullOrEmpty(arguments)) sc.Arguments = arguments;
                sc.Save();
            }
            catch (Exception e)
            {
                Debug.WriteLine("CreateLnK: " + e.Message);
                // COM 失败兜底：写入 .url 文本（功能弱化但不中断安装）
                try { File.WriteAllText(lnkPath, "[InternetShortcut]\nURL=file:///" + exePath.Replace('\\', '/') + "\nIconFile=" + iconPath + "\nIconIndex=0\n", Encoding.UTF8); }
                catch { }
            }
        }

        /// <summary>关闭正在运行的应用</summary>
        public static void KillRunningApp()
        {
            try
            {
                var exe = Config.Current.AppExe;
                foreach (var p in Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(exe)))
                {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            }
            catch { }
        }

        /// <summary>安装完成后启动应用</summary>
        public static void LaunchApp(string exePath, string workDir)
        {
            try
            {
                if (!File.Exists(exePath)) return;
                var psi = new ProcessStartInfo(exePath) { WorkingDirectory = workDir, UseShellExecute = true };
                Process.Start(psi);
            }
            catch { }
        }
    }
}