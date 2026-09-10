using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MingYunInstaller
{
    public class ReleaseAsset
    {
        public string Name;
        public long Size;
        public string BrowserUrl;
    }

    public class ReleaseInfo
    {
        public string Tag;
        public string Name;
        public DateTime Published;
        public bool Draft;
        public bool IsLatest;
        public List<ReleaseAsset> Assets = new List<ReleaseAsset>();

        public ReleaseAsset GetPackage()
        {
            // 优先级：.7z > .zip/tar > .exe（exe 为旧 Setup，下载后直接打开即可）
            ReleaseAsset zip = null, exe = null;
            foreach (var a in Assets)
            {
                var n = a.Name;
                if (n.EndsWith(".7z", StringComparison.OrdinalIgnoreCase)) return a;
                if (n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) { if (exe == null) exe = a; continue; }
                if (zip == null &&
                    (n.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)
                     || n.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
                     || n.EndsWith(".tar.gz", StringComparison.OrdinalIgnoreCase)
                     || n.EndsWith(".tgz", StringComparison.OrdinalIgnoreCase)))
                    zip = a;
            }
            return zip ?? exe;
        }

        /// <summary>安装包是否为 .exe（下载后直接打开安装，无需解压）</summary>
        public bool IsExePackage
        {
            get
            {
                var a = GetPackage();
                return a != null && a.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
            }
        }

        /// <summary>包类型文字（列表副标题）</summary>
        public string KindText
        {
            get
            {
                var a = GetPackage();
                if (a == null) return "";
                if (a.Name.EndsWith(".7z", StringComparison.OrdinalIgnoreCase)) return "离线包";
                if (a.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return "安装程序";
                return "压缩包";
            }
        }

        public string Display => Tag + (Draft ? "（草稿）" : "") + "  ·  " + Published.ToString("yyyy-MM-dd");

        /// <summary>发布日期（用于列表副标题）</summary>
        public string DateText => Published == default(DateTime) ? "" : Published.ToString("yyyy-MM-dd");

        /// <summary>安装包大小（用于列表副标题）</summary>
        public string SizeText
        {
            get
            {
                var a = GetPackage();
                if (a == null || a.Size <= 0) return "大小未知";
                return FmtBytes(a.Size);
            }
        }

        static string FmtBytes(double b)
        {
            if (b >= 1073741824) return (b / 1073741824).ToString("F2") + " GB";
            if (b >= 1048576) return (b / 1048576).ToString("F1") + " MB";
            if (b >= 1024) return (b / 1024).ToString("F0") + " KB";
            return b.ToString("F0") + " B";
        }
    }

    /// <summary>从 GitHub Releases 拉取版本列表（无需鉴权，匿名限流 60 次/小时；失败自动重试，走系统代理）</summary>
    public static class VersionSource
    {
        public static async Task<List<ReleaseInfo>> FetchReleasesAsync(CancellationToken ct)
        {
            var cfg = Config.Current;
            var url = "https://api.github.com/repos/" + cfg.Repo + "/releases?per_page=30";

            HttpStatusCode? lastStatus = null;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var req = WebRequest.Create(url) as HttpWebRequest;
                    req.UserAgent = "MingYunInstaller/1.0 (" + cfg.AppName + ")";
                    req.Accept = "application/vnd.github+json";
                    req.Timeout = 30000;
                    req.ReadWriteTimeout = 30000;
                    // 走系统默认代理（无代理时等效直连）；强制 Proxy=null 会导致开着代理的机器连不上
                    req.Proxy = WebRequest.DefaultWebProxy;

                    using (var resp = (HttpWebResponse)await Task.Factory.FromAsync(req.BeginGetResponse, req.EndGetResponse, null))
                    {
                        if (resp.StatusCode != HttpStatusCode.OK)
                        {
                            if (resp.StatusCode == HttpStatusCode.Forbidden)
                                throw new Exception("GitHub 接口限流（60 次/小时），请稍后再试");
                            throw new Exception("GitHub 返回 " + (int)resp.StatusCode);
                        }
                        using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                        {
                            var json = await sr.ReadToEndAsync();
                            ct.ThrowIfCancellationRequested();
                            var list = Parse(json);
                            // 过滤草稿 / 无安装包的版本；.exe 资产同样可安装（下载后直接打开）
                            list.RemoveAll(r => r.Draft || r.GetPackage() == null);
                            if (list.Count > 0) list[0].IsLatest = true; // API 按发布时间倒序，首条即最新
                            return list;
                        }
                    }
                }
                catch (WebException we)
                {
                    if (we.Response is HttpWebResponse hw) lastStatus = hw.StatusCode;
                    lastStatus = lastStatus ?? HttpStatusCode.GatewayTimeout;
                    try { await Task.Delay(700 * (attempt + 1), ct); } catch (OperationCanceledException) { throw; }
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    // 非 WebException（DNS/超时包装等）：按网络故障处理重试
                    lastStatus = lastStatus ?? HttpStatusCode.GatewayTimeout;
                    try { await Task.Delay(700 * (attempt + 1), ct); } catch (OperationCanceledException) { throw; }
                }
            }

            if (lastStatus == HttpStatusCode.Forbidden)
                throw new Exception("GitHub 接口限流（60 次/小时），请稍后再试");
            throw new Exception("无法连接 GitHub（已重试 3 次），请检查网络或代理后点此重试");
        }

        static List<ReleaseInfo> Parse(string json)
        {
            var list = new List<ReleaseInfo>();
            var arr = MiniJson.Parse(json) as List<object>;
            if (arr == null) return list;

            foreach (var raw in arr)
            {
                var d = raw as Dictionary<string, object>;
                if (d == null) continue;
                try
                {
                    var r = new ReleaseInfo
                    {
                        Tag = MiniJson.Str(d, "tag_name") ?? "",
                        Name = MiniJson.Str(d, "name") ?? "",
                        Draft = d.ContainsKey("draft") && Convert.ToBoolean(d["draft"]),
                        Published = d.ContainsKey("published_at") && DateTime.TryParse(MiniJson.Str(d, "published_at"), out var dt) ? dt.ToLocalTime() : default(DateTime)
                    };
                    if (d.ContainsKey("assets") && d["assets"] is List<object> assets)
                    {
                        foreach (var a in assets)
                        {
                            var ad = a as Dictionary<string, object>;
                            if (ad == null) continue;
                            r.Assets.Add(new ReleaseAsset
                            {
                                Name = MiniJson.Str(ad, "name") ?? "",
                                Size = ad.ContainsKey("size") ? Convert.ToInt64(ad["size"]) : 0,
                                BrowserUrl = MiniJson.Str(ad, "browser_download_url") ?? ""
                            });
                        }
                    }
                    if (!string.IsNullOrEmpty(r.Tag)) list.Add(r);
                }
                catch { }
            }
            return list;
        }
    }
}