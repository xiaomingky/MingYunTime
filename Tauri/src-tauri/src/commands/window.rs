use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use serde_json::Value;

/// 最小化窗口
#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 最大化/还原窗口
#[tauri::command]
pub async fn window_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
        let is_max = window.is_maximized().unwrap_or(false);
        app.emit("window-maximize-status", is_max).ok();
    }
    Ok(())
}

/// 关闭窗口（实际最小化到托盘）
#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 最小化到托盘
#[tauri::command]
pub async fn window_minimize_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 退出应用
#[tauri::command]
pub async fn window_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// 设置窗口全屏
#[tauri::command]
pub async fn set_window_fullscreen(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 退出窗口全屏
#[tauri::command]
pub async fn exit_window_fullscreen(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}





/// 打开 Windows 屏幕键盘
/// 直接 spawn osk.exe 可能因 PATH/System32 重定向找不到或被阻止，
/// 通过 cmd /c start 间接启动更可靠
#[tauri::command]
pub async fn open_osk() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "osk.exe"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打开外部链接
#[tauri::command]
pub async fn open_external(payload: Value) -> Result<(), String> {
    let url = payload.as_str().or_else(|| payload["url"].as_str()).ok_or("缺少 url")?.to_string();
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
