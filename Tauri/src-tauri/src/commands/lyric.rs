use serde_json::{json, Value};

const NATIVE_API_BASE: &str = "http://127.0.0.1:3400";

/// 多平台歌词搜索（QQ + 酷狗）
#[tauri::command]
pub async fn search_multi_lyric(payload: Value) -> Result<Value, String> {
    let song_name = payload["songName"].as_str().unwrap_or("");
    let artist = payload["artist"].as_str().unwrap_or("");
    let url = format!(
        "{}/lyric/search?songName={}&artist={}",
        NATIVE_API_BASE,
        urlencoding::encode(song_name),
        urlencoding::encode(artist)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 按候选项获取歌词
#[tauri::command]
pub async fn fetch_lyric_by_candidate(payload: Value) -> Result<Value, String> {
    let url = format!("{}/lyric/fetch", NATIVE_API_BASE);
    let req_body = json!({ "candidate": payload });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取 QQ 歌词
#[tauri::command]
pub async fn get_qq_lyric(payload: Value) -> Result<Value, String> {
    let song_name = payload["songName"].as_str().unwrap_or("");
    let artist = payload["artist"].as_str().unwrap_or("");
    let duration = payload["duration"].as_i64().unwrap_or(0);
    let url = format!(
        "{}/lyric/qq?songName={}&artist={}&duration={}",
        NATIVE_API_BASE,
        urlencoding::encode(song_name),
        urlencoding::encode(artist),
        duration
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 获取酷狗歌词（按 hash）
#[tauri::command]
pub async fn get_kugou_lyric(payload: Value) -> Result<Value, String> {
    let hash = payload["hash"].as_str().unwrap_or("");
    let url = format!(
        "{}/lyric/kugou?hash={}",
        NATIVE_API_BASE,
        urlencoding::encode(hash)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}
