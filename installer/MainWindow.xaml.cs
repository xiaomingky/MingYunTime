using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Forms;
using FolderBrowserDialog = System.Windows.Forms.FolderBrowserDialog;
using OpenFileDialog = System.Windows.Forms.OpenFileDialog;
using ProgressBar = System.Windows.Controls.ProgressBar;

namespace MingYunInstaller
{
    public partial class MainWindow : Window
    {
        static readonly Color BrandColor = Color.FromRgb(0xEC, 0x41, 0x41);
        static readonly Color GrayColor = Color.FromRgb(0x66, 0x66, 0x66);

        readonly CancellationTokenSource _cts = new CancellationTokenSource();
        string _tempPkg;
        volatile bool _busy;
        bool _done;

        bool _online = true;
        bool _versionsLoaded;
        List<ReleaseInfo> _releases = new List<ReleaseInfo>();
        ReleaseInfo _selected;
        string _localFile;

        public MainWindow()
        {
            InitializeComponent();
            var cfg = Config.Current;

            AppIcon.Source = IconHelper.Load();
            TitleText.Text = cfg.AppName;
            SubText.Text = "安装助手 v" + cfg.DisplayVersion + " · Win7 至 Win11 全兼容";

            // 目录识别：与原 setup 同款（注册表 HKCU/HKLM → 默认目录兜底）
            var def = InstallOps.DetectExistingInstall();
            if (!string.IsNullOrEmpty(def))
            {
                InstallDirBox.Text = def;
                var ver = InstallOps.ReadUninstallValue("DisplayVersion");
                InfoText.Text = "检测到已安装版本" + (string.IsNullOrEmpty(ver) ? "" : "  v" + ver)
                              + "\n将升级安装到同一目录，本地数据会完整保留。";
                FootText.Text = "升级安装 · 数据保留";
            }
            else
            {
                InstallDirBox.Text = InstallOps.ExpandDefaultDir();
                InfoText.Text = "欢迎使用 " + cfg.AppName + " 安装助手\n无需管理员权限 · 离线/在线双模式。";
                FootText.Text = "无需管理员权限 · 双模式安装";
            }

            UpdateLocalHint();
            Loaded += Window_Loaded;
        }

        async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            SizeChanged += (s, __) => UpdateSeg();
            UpdateSeg();

            // 环形内圈光弧常转
            try { ((Storyboard)FindResource("RingSpin")).Begin(this); } catch { }

            // 窗口淡入
            Root.Opacity = 0;
            var fade = new DoubleAnimation(1, new Duration(TimeSpan.FromMilliseconds(300)));
            fade.EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            Root.BeginAnimation(UIElement.OpacityProperty, fade);

            SetMode(true);
            await LoadVersionsAsync();
        }

        // ================= 顶栏 =================
        void Header_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed && !_busy) DragMove();
        }

        void CloseBtn_Click(object sender, RoutedEventArgs e) { CancelAndClose(); }
        void CancelBtn_Click(object sender, RoutedEventArgs e) { CancelAndClose(); }

        void CancelAndClose()
        {
            if (_done) { Close(); return; }
            if (_busy)
            {
                try { _cts.Cancel(); } catch { }
                SetBusyText("正在取消…");
                return;
            }
            Close();
        }

        // ================= 版本来源切换 =================
        void UpdateSeg()
        {
            if (SegBack.ActualWidth > 0)
                SegInd.Width = Math.Max(52, (SegBack.ActualWidth - 6) / 2);
        }

        void SetMode(bool online)
        {
            _online = online;

            // 滑块位移动画
            double to = online ? 0 : SegInd.Width;
            var anim = new DoubleAnimation(to, new Duration(TimeSpan.FromMilliseconds(190)));
            anim.EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut };
            IndTrans.BeginAnimation(TranslateTransform.XProperty, anim);

            // 文字状态
            OnlineBtn.Foreground = new SolidColorBrush(online ? BrandColor : GrayColor);
            OnlineBtn.FontWeight = online ? FontWeights.SemiBold : FontWeights.Normal;
            LocalBtn.Foreground = new SolidColorBrush(online ? GrayColor : BrandColor);
            LocalBtn.FontWeight = online ? FontWeights.Normal : FontWeights.SemiBold;

            if (online)
            {
                FadeIn(OnlineArea); FadeOut(LocalArea);
            }
            else
            {
                FadeIn(LocalArea); FadeOut(OnlineArea);
                UpdateLocalHint();
            }

            if (online && _versionsLoaded)
                ShowSelectedInfo();
        }

        void OnlineBtn_Click(object sender, RoutedEventArgs e) { SetMode(true); }
        void LocalBtn_Click(object sender, RoutedEventArgs e) { SetMode(false); }

        static void FadeIn(UIElement e)
        {
            e.Visibility = Visibility.Visible;
            var a = new DoubleAnimation(1, new Duration(TimeSpan.FromMilliseconds(220)));
            a.EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            e.BeginAnimation(UIElement.OpacityProperty, a);
        }

        static void FadeOut(UIElement e)
        {
            e.Opacity = 0;
            e.Visibility = Visibility.Collapsed;
        }

        // ================= 版本列表 =================
        async Task LoadVersionsAsync()
        {
            if (_versionsLoaded) return;
            ShowVersionState("loading");
            try
            {
                _releases = await VersionSource.FetchReleasesAsync(_cts.Token);
                _versionsLoaded = true;
                VersionList.ItemsSource = null;
                VersionList.ItemsSource = _releases;
                if (_releases.Count > 0) VersionList.SelectedIndex = 0;
                ShowVersionState(_releases.Count > 0 ? "list" : "empty");
            }
            catch (Exception ex)
            {
                VersionError.Text = "获取版本列表失败：" + ex.Message + "　（点击重试）";
                ShowVersionState("error");
            }
        }

        void ShowVersionState(string state)
        {
            var story = (Storyboard)FindResource("SpinAnim");
            switch (state)
            {
                case "loading":
                    FadeIn(VersionLoading);
                    VersionList.Visibility = Visibility.Collapsed;
                    VersionError.Visibility = Visibility.Collapsed;
                    story.Begin(this);
                    break;
                case "list":
                    story.Stop(this);
                    VersionLoading.Visibility = Visibility.Collapsed;
                    VersionError.Visibility = Visibility.Collapsed;
                    FadeIn(VersionList);
                    break;
                case "empty":
                    story.Stop(this);
                    VersionLoading.Visibility = Visibility.Collapsed;
                    VersionList.Visibility = Visibility.Collapsed;
                    VersionError.Text = "线上暂无可安装的 .7z/.zip 包\n（发布页需附带归档包，或切换「本地压缩包」选择文件）";
                    FadeIn(VersionError);
                    break;
                case "error":
                    story.Stop(this);
                    VersionLoading.Visibility = Visibility.Collapsed;
                    VersionList.Visibility = Visibility.Collapsed;
                    FadeIn(VersionError);
                    break;
            }
        }

        void RetryVersions_Click(object sender, MouseButtonEventArgs e)
        {
            (sender as UIElement).Opacity = 0.4;
            var fade = new DoubleAnimation(1, new Duration(TimeSpan.FromMilliseconds(150)));
            fade.EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            (sender as UIElement).BeginAnimation(UIElement.OpacityProperty, fade);
            _ = LoadVersionsAsync();
        }

        void VersionList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _selected = VersionList.SelectedItem as ReleaseInfo;
            if (_selected != null) ShowSelectedInfo();
        }

        void ShowSelectedInfo()
        {
            if (_selected == null) return;
            var a = _selected.GetPackage();
            InfoText.Text = "将在线安装  " + _selected.Tag
                          + (string.IsNullOrEmpty(_selected.DateText) ? "" : "  ·  " + _selected.DateText)
                          + "\n安装包 " + (_selected.IsLatest ? "（最新版）" : "") + "  "
                          + _selected.SizeText;
            if (a != null) FileInfoText.Text = "下载地址已确认，点击「立即安装」开始";
        }

        // ================= 本地文件 =================
        void BrowseLocal_Click(object sender, RoutedEventArgs e)
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "选择安装包（.exe / .7z / .zip）";
                dlg.Filter = "安装文件 (*.exe;*.7z;*.zip)|*.exe;*.7z;*.zip|所有文件 (*.*)|*.*";
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    _localFile = dlg.FileName;
                    LocalFileBox.Text = dlg.FileName;
                    string size = "";
                    try { size = FmtBytes(new FileInfo(dlg.FileName).Length); } catch { }
                    bool isExe = dlg.FileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
                    InfoText.Text = "使用" + (isExe ? "本地安装程序" : "本地压缩包") + "安装\n"
                                  + dlg.FileName + (size.Length > 0 ? "  （" + size + "）" : "");
                    FileInfoText.Text = isExe
                        ? "点击「立即安装」后直接打开该安装程序"
                        : "将从本地文件直接安装，无需联网";
                }
            }
        }

        void UpdateLocalHint()
        {
            LocalHint.Text = Config.Current.HasEmbeddedPackage
                ? "未选择文件时，将使用本安装器内置的离线安装包（无需联网）。"
                : "请选择发布页下载的 .exe / .7z / .zip 文件即可安装。";
            if (_localFile != null) LocalFileBox.Text = _localFile;
        }

        // ================= 安装目录 =================
        void BrowseDir_Click(object sender, RoutedEventArgs e)
        {
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择安装目录（自动追加 MingYunTime 子目录）";
                dlg.ShowNewFolderButton = true;
                if (!string.IsNullOrEmpty(InstallDirBox.Text) && Directory.Exists(InstallDirBox.Text))
                    dlg.SelectedPath = InstallDirBox.Text;
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    var p = dlg.SelectedPath?.TrimEnd('\\') ?? "";
                    if (p.Length > 0 && !p.EndsWith("\\MingYunTime", StringComparison.OrdinalIgnoreCase))
                        p += "\\MingYunTime"; // 选了盘符/目录也自动补产品目录，与原 setup 一致
                    InstallDirBox.Text = p;
                }
            }
        }

        // ================= 安装主流程 =================
        async void InstallBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_done) { Close(); return; }
            if (_busy) return;

            var installDir = InstallDirBox.Text?.Trim();
            if (string.IsNullOrEmpty(installDir))
            {
                Say("请先选择安装目录");
                return;
            }
            try { Directory.CreateDirectory(installDir); }
            catch (Exception ex)
            {
                Say("目录不可写：" + ex.Message);
                return;
            }

            _busy = true;
            InstallBtn.IsEnabled = false;
            CloseBtn.IsEnabled = false;
            FootText.Text = "正在准备…";
            SetProgress(0);

            string pkgPath = null;
            try
            {
                var cfg = Config.Current;
                InstallOps.KillRunningApp();

                if (_online)
                {
                    // ===== 线上：版本列表 → aria2c 下载 =====
                    if (_selected == null)
                    {
                        Say("请先在列表中选择要安装的版本");
                        ResetBusy();
                        return;
                    }
                    var asset = _selected.GetPackage();
                    if (asset == null || string.IsNullOrEmpty(asset.BrowserUrl))
                    {
                        Say("所选版本没有可用安装包");
                        ResetBusy();
                        return;
                    }

                    pkgPath = Path.Combine(Path.GetTempPath(), _selected.IsExePackage ? "mia-setup.exe" : "mia-download.7z");
                    try { if (File.Exists(pkgPath)) File.Delete(pkgPath); } catch { }

                    SetProgress(0.01);
                    ProgressText2("正在启动 aria2c 高速下载…");
                    var sw = Stopwatch.StartNew();
                    var progress = new Progress<AriaProgress>(p =>
                    {
                        Dispatcher.Invoke(new Action(() =>
                        {
                            if (p.Total > 0)
                            {
                                SetProgress(0.01 + 0.21 * p.Done / p.Total);
                                SpdText.Text = "下载中  " + FmtBytes(p.Done) + " / " + FmtBytes(p.Total)
                                             + "  ·  " + FmtBytes(p.Speed) + "/s";
                            }
                            else
                            {
                                SpdText.Text = "连接下载服务器…  " + FmtBytes(p.Speed) + "/s";
                            }
                        }));
                    });

                    try
                    {
                        await PackageSource.DownloadWithAria2Async(asset.BrowserUrl, pkgPath, progress, _cts.Token);
                    }
                    catch (Exception) when (!_cts.IsCancellationRequested)
                    {
                        // aria2c 异常时回退内置下载器，保证在线安装可用
                        SpdText.Text = "";
                        ProgressText2("aria2c 不可用，回退内置下载器…");
                        await PackageSource.DownloadAsync(asset.BrowserUrl, pkgPath,
                            new Progress<long>(d => Dispatcher.Invoke(new Action(() =>
                            {
                                SpdText.Text = "下载中  " + FmtBytes(d);
                            }))), _cts.Token);
                    }
                    sw.Stop();
                    SetProgress(0.25);
                    ProgressText2("下载完成…");

                    // ===== exe 安装程序：下载后直接打开让它自己装 =====
                    if (_selected.IsExePackage)
                    {
                        if (LaunchExeToFinish(pkgPath)) return;
                    }
                    ProgressText2("正在解压…");
                }
                else
                {
                    // ===== 本地：用户文件 → 内嵌包 =====
                    if (!string.IsNullOrEmpty(_localFile) && File.Exists(_localFile))
                    {
                        pkgPath = _localFile;
                        if (pkgPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                        {
                            // 本地选了 exe：直接打开安装
                            SetProgress(0.05);
                            ProgressText2("使用本地安装程序…");
                            if (LaunchExeToFinish(pkgPath)) return;
                        }
                        SetProgress(0.05);
                        ProgressText2("使用本地压缩包…");
                    }
                    else if (cfg.HasEmbeddedPackage)
                    {
                        pkgPath = Path.Combine(Path.GetTempPath(), "mia-embedded.7z");
                        using (var src = cfg.OpenEmbeddedPackage())
                        using (var fs = new FileStream(pkgPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            var buf = new byte[512 * 1024];
                            int n; long done = 0, total = cfg.EmbeddedPackageLength;
                            while ((n = src.Read(buf, 0, buf.Length)) > 0)
                            {
                                _cts.Token.ThrowIfCancellationRequested();
                                fs.Write(buf, 0, n);
                                done += n;
                                if (total > 0) SetProgress(0.05 * done / total);
                            }
                        }
                        SetProgress(0.05);
                        ProgressText2("内置离线包就绪，正在解压…");
                    }
                    else
                    {
                        Say("请选择本地压缩包，或切换到线上版本模式");
                        ResetBusy();
                        return;
                    }
                }

                if (pkgPath == null || !File.Exists(pkgPath) || new FileInfo(pkgPath).Length == 0)
                {
                    Say("安装包获取失败");
                    ResetBusy();
                    return;
                }

                // ===== 解压 =====
                _tempPkg = pkgPath;
                ProgressText2("正在解压到 " + installDir);
                await Task.Run(() =>
                    PackageSource.Extract(pkgPath, installDir, new Progress<double>(p =>
                    {
                        Dispatcher.Invoke(new Action(() =>
                        {
                            SetProgress(0.05 + 0.95 * p);
                            StatusText.Text = p >= 1 ? "文件就绪" : "正在安装文件… " + (int)(p * 100) + "%";
                        }));
                    })), _cts.Token);

                // ===== 收尾 =====
                var appExe = Path.Combine(installDir, cfg.AppExe);
                StatusText.Text = "正在创建快捷方式…";
                // 卸载入口：部署卸载器到安装目录（控制面板卸载 / 开始菜单「卸载」用）
                var uninstaller = InstallOps.DeployUninstaller(installDir);
                InstallOps.CreateShortcuts(appExe, installDir, DesktopChk.IsChecked == true, uninstaller);
                InstallOps.WriteUninstallEntry(installDir, appExe, uninstaller);

                if (pkgPath != _localFile)
                {
                    try { if (File.Exists(pkgPath)) File.Delete(pkgPath); } catch { }
                }
                _tempPkg = null;

                SetProgress(1);
                _done = true;
                InstallBtn.Content = "完成";
                InstallBtn.IsEnabled = true;
                CloseBtn.IsEnabled = true;
                FootText.Text = cfg.AppName + " 已安装到 " + installDir;
                Say("安装完成");

                if (LaunchChk.IsChecked == true && File.Exists(appExe))
                    InstallOps.LaunchApp(appExe, installDir);
            }
            catch (OperationCanceledException)
            {
                Say("安装已取消");
            }
            catch (Exception ex)
            {
                Say("安装失败：" + ex.Message);
            }
            finally
            {
                if (!_done) ResetBusy();
            }
        }

        // ================= 工具 =================
        void ResetBusy()
        {
            if (_busy) { _busy = false; }
            InstallBtn.IsEnabled = true;
            CloseBtn.IsEnabled = true;
        }

        /// <summary>打开 .exe 安装程序并结束本安装器流程（原 Setup 会自行完成安装）。返回是否已处理</summary>
        bool LaunchExeToFinish(string exePath)
        {
            StatusText.Text = "正在打开安装程序…";
            try
            {
                Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Say("打开安装程序失败：" + ex.Message);
                ResetBusy();
                return true; // 已处理（失败提示），防止继续走解压
            }
            _tempPkg = null; // 交给系统清理，安装过程中不能被删除
            SetProgress(1);
            _done = true;
            InstallBtn.Content = "完成";
            InstallBtn.IsEnabled = true;
            CloseBtn.IsEnabled = true;
            FootText.Text = "已打开安装程序，请按向导完成安装";
            Say("安装程序已打开，请在弹出的窗口里完成安装");
            return true;
        }

        /// <summary>环形转圈进度：按进度填充品牌红弧（平滑动画）+ 中央百分比</summary>
        void SetProgress(double v)
        {
            v = Math.Max(0, Math.Min(1, v));
            const double C = 251.4;
            var a = new DoubleAnimation(C * (1 - v), new Duration(TimeSpan.FromMilliseconds(160)));
            a.EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            RingFill.BeginAnimation(System.Windows.Shapes.Path.StrokeDashOffsetProperty, a);
            PctText.Text = (int)Math.Round(v * 100) + "%";
        }

        void ProgressText2(string msg)
        {
            SpdText.Text = "";
            StatusText.Text = msg;
        }

        void Say(string msg)
        {
            Dispatcher.Invoke(new Action(() =>
            {
                StatusText.Text = msg;
                FootText.Text = msg;
            }));
        }

        void SetBusyText(string msg)
        {
            StatusText.Text = msg;
            SpdText.Text = "";
            FootText.Text = msg;
        }

        static string FmtBytes(double b)
        {
            if (b >= 1073741824) return (b / 1073741824).ToString("F2") + " GB";
            if (b >= 1048576) return (b / 1048576).ToString("F1") + " MB";
            if (b >= 1024) return (b / 1024).ToString("F0") + " KB";
            return b.ToString("F0") + " B";
        }

        protected override void OnClosed(EventArgs e)
        {
            try { _cts.Cancel(); } catch { }
            base.OnClosed(e);
        }
    }
}