using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;

namespace MingYunInstaller
{
    public partial class UninstallWindow : Window
    {
        readonly CancellationTokenSource _cts = new CancellationTokenSource();
        volatile bool _busy;
        readonly string _loc;

        public UninstallWindow()
        {
            InitializeComponent();
            AppIcon.Source = IconHelper.Load();
            var cfg = Config.Current;
            TitleText.Text = "卸载 " + cfg.AppName + "？";

            // 安装目录：注册表精确位置，无效则默认目录兜底
            _loc = InstallOps.ReadUninstallValue("InstallLocation");
            if (string.IsNullOrEmpty(_loc) || !Directory.Exists(_loc))
            {
                var def = InstallOps.ExpandDefaultDir();
                if (Directory.Exists(def)) { _loc = def; }
                else { _loc = null; DescText.Text += "\n未找到安装记录，将仅清理快捷方式与注册信息。"; }
            }

            Loaded += (s, __) => { try { ((Storyboard)FindResource("RingSpin")).Begin(this); } catch { } };
        }

        void Header_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed && !_busy) DragMove();
        }

        void Cancel_Click(object sender, RoutedEventArgs e)
        {
            if (_busy) { try { _cts.Cancel(); } catch { } return; }
            Close();
        }

        void SetProgress(double v)
        {
            v = Math.Max(0, Math.Min(1, v));
            const double C = 238.8;
            var a = new DoubleAnimation(C * (1 - v), new Duration(TimeSpan.FromMilliseconds(140)));
            a.EasingFunction = new System.Windows.Media.Animation.QuadraticEase();
            RingFill.BeginAnimation(System.Windows.Shapes.Path.StrokeDashOffsetProperty, a);
            PctText.Text = v <= 0 ? "" : (int)Math.Round(v * 100) + "%";
        }

        async void Uninstall_Click(object sender, RoutedEventArgs e)
        {
            if (_busy) return;
            _busy = true;
            UninstallBtn.IsEnabled = false;
            CancelBtn.IsEnabled = false;
            SetProgress(0);
            ProgressText.Text = "正在卸载…";

            try
            {
                var self = Assembly.GetExecutingAssembly().Location;
                bool selfInside = !string.IsNullOrEmpty(Path.GetDirectoryName(self))
                    && !string.IsNullOrEmpty(_loc)
                    && Path.GetDirectoryName(self).StartsWith(_loc.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

                if (selfInside)
                {
                    // 自身位于安装目录（部署的卸载器）：复制副本到 temp 并静默整删，避免 exe 占用锁定
                    await Task.Run(() => InstallOps.KillRunningApp());
                    var copy = Path.Combine(Path.GetTempPath(), "mia_un_" + Guid.NewGuid().ToString("N") + ".exe");
                    await Task.Run(() => File.Copy(self, copy, true));
                    Process.Start(new ProcessStartInfo(copy, "--removal=\"" + _loc + "\"") { UseShellExecute = false });
                    SetProgress(1);
                    ProgressText.Text = "已提交卸载，即将完成…";
                    await Task.Delay(350);
                    Close();
                    return;
                }

                // 自身不在安装目录：直接清理（整删目录 + 快捷方式 + 注册）
                await Task.Run(() =>
                {
                    InstallOps.RunRemoval(_loc);
                    Dispatcher.Invoke(new Action(() => SetProgress(1)));
                }, _cts.Token);

                ProgressText.Text = "已卸载完成";
                UninstallBtn.Content = "完成";
                UninstallBtn.IsEnabled = true;
                UninstallBtn.Click -= Uninstall_Click;
                UninstallBtn.Click += (s2, e2) => Close();
            }
            catch (OperationCanceledException) { ProgressText.Text = "已取消"; Close(); }
            catch (Exception ex)
            {
                ProgressText.Text = "卸载失败：" + ex.Message;
                UninstallBtn.Content = "完成";
                UninstallBtn.IsEnabled = true;
                UninstallBtn.Click -= Uninstall_Click;
                UninstallBtn.Click += (s2, e2) => Close();
            }
        }
    }
}