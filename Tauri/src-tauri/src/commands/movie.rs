use serde_json::{json, Value};

const NATIVE_API_BASE: &str = "http://127.0.0.1:3400";

/// 获取影视数据源列表
#[tauri::command]
pub async fn movie_sources() -> Result<Value, String> {
    let url = format!("{}/movie/sources", NATIVE_API_BASE);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取影视首页
#[tauri::command]
pub async fn movie_home(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let url = format!(
        "{}/movie/home?source={}",
        NATIVE_API_BASE,
        urlencoding::encode(source)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 搜索影视
#[tauri::command]
pub async fn movie_search(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let keyword = payload["keyword"].as_str().unwrap_or("");
    let url = format!(
        "{}/movie/search?source={}&keyword={}",
        NATIVE_API_BASE,
        urlencoding::encode(source),
        urlencoding::encode(keyword)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取影视详情
#[tauri::command]
pub async fn movie_detail(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let id = payload["id"].as_str().unwrap_or("");
    let url = format!(
        "{}/movie/detail?source={}&id={}",
        NATIVE_API_BASE,
        urlencoding::encode(source),
        urlencoding::encode(id)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 解析影视播放地址
#[tauri::command]
pub async fn movie_parse_playurl(payload: Value) -> Result<Value, String> {
    let url = format!("{}/movie/parse-playurl", NATIVE_API_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}
