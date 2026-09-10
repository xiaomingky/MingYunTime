using System;
using System.Windows;

namespace MingYunInstaller
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            NetCheck.EnsureTls();

            // --removal="<dir>"：部署在安装目录的卸载器副本，静默整删后退出（无界面）
            string removalDir = null;
            bool uninstall = false;
            if (e.Args != null)
            {
                foreach (var a in e.Args)
                {
                    if (a.StartsWith("--removal=", StringComparison.OrdinalIgnoreCase))
                        removalDir = a.Substring(10).Trim('"', ' ');
                    else if (string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase))
                        uninstall = true;
                }
            }

            if (removalDir != null)
            {
                InstallOps.RunRemoval(removalDir);
                Shutdown();
                return;
            }

            Window w = uninstall ? (Window)new UninstallWindow() : new MainWindow();
            w.Show();
        }
    }
}