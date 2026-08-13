use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// 创建系统托盘
pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一曲", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "播放/暂停", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一曲", true, None::<&str>)?;
    let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &prev, &play, &next, &sep1, &quit])?;

    let app_handle = app.clone();
    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("茗韵时光")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "prev" => {
                let _ = app_handle.emit("player-command", "prev");
            }
            "play" => {
                let _ = app_handle.emit("player-command", "togglePlay");
            }
            "next" => {
                let _ = app_handle.emit("player-command", "next");
            }
            "quit" => {
                // 停止所有 sidecar 服务
                crate::sidecar::stop_all_services();
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
