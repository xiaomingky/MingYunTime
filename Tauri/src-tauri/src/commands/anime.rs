use serde_json::{json, Value};

const NATIVE_API_BASE: &str = "http://127.0.0.1:3400";

/// 获取动漫数据源列表
#[tauri::command]
pub async fn anime_sources() -> Result<Value, String> {
    Ok(json!({
        "yhfs": {"id":"yhfs","base":"https://www.yinghuafans.com","label":"樱花动漫·官方线路","type":"iframe"},
        "yhf": {"id":"yhf","base":"https://www.yinghuafan.com","label":"樱花动漫·推荐线路","type":"iframe"},
        "xdm": {"id":"xdm","base":"https://www.xdm7.net","label":"樱花动漫·经典线路","type":"iframe"},
        "yhdmfan": {"id":"yhdmfan","base":"https://www.yhdmfan.cc","label":"樱花动漫·备用线路","type":"iframe"}
    }))
}

/// 获取动漫首页
#[tauri::command]
pub async fn anime_home(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let url = format!(
        "{}/anime/home?source={}",
        NATIVE_API_BASE,
        urlencoding::encode(source)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 搜索动漫
#[tauri::command]
pub async fn anime_search(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let keyword = payload["keyword"].as_str().unwrap_or("");
    let url = format!(
        "{}/anime/search?source={}&keyword={}",
        NATIVE_API_BASE,
        urlencoding::encode(source),
        urlencoding::encode(keyword)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取动漫详情（剧集列表）
#[tauri::command]
pub async fn anime_detail(payload: Value) -> Result<Value, String> {
    let source = payload["source"].as_str().unwrap_or("");
    let id = payload["id"].as_str().unwrap_or("");
    let url = format!(
        "{}/anime/detail?source={}&id={}",
        NATIVE_API_BASE,
        urlencoding::encode(source),
        urlencoding::encode(id)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 解析动漫播放地址
#[tauri::command]
pub async fn anime_parse_playurl(payload: Value) -> Result<Value, String> {
    let url = format!("{}/anime/parse-playurl", NATIVE_API_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// Bangumi 元信息搜索
#[tauri::command]
pub async fn anime_meta_search(payload: Value) -> Result<Value, String> {
    let title = payload["title"].as_str().unwrap_or("");
    let url = format!(
        "{}/anime/meta/search?title={}",
        NATIVE_API_BASE,
        urlencoding::encode(title)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// Bangumi 相关联想
#[tauri::command]
pub async fn anime_meta_related(payload: Value) -> Result<Value, String> {
    let bgm_id = payload["bgmId"].as_str().unwrap_or("");
    let url = format!(
        "{}/anime/meta/related?bgmId={}",
        NATIVE_API_BASE,
        urlencoding::encode(bgm_id)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}
