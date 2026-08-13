use serde_json::{json, Value};

const NATIVE_API_BASE: &str = "http://127.0.0.1:3400";

/// 获取 B站登录二维码
#[tauri::command]
pub async fn bilibili_login_qr() -> Result<Value, String> {
    let url = format!("{}/bilibili/login-qr", NATIVE_API_BASE);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 检查 B站登录状态
#[tauri::command]
pub async fn bilibili_login_check(payload: Value) -> Result<Value, String> {
    let qrcode_key = payload["qrcodeKey"].as_str().unwrap_or("");
    let url = format!(
        "{}/bilibili/login-check?qrcodeKey={}",
        NATIVE_API_BASE,
        urlencoding::encode(qrcode_key)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取 B站登录状态
#[tauri::command]
pub async fn bilibili_login_status() -> Result<Value, String> {
    let url = format!("{}/bilibili/login-status", NATIVE_API_BASE);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 退出 B站登录
#[tauri::command]
pub async fn bilibili_logout() -> Result<Value, String> {
    let url = format!("{}/bilibili/logout", NATIVE_API_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}
