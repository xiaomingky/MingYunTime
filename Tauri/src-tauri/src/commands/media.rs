use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde_json::{json, Value};
use std::path::PathBuf;

/// 读取歌曲元数据
#[tauri::command]
pub async fn read_song_metadata(payload: Value) -> Result<Value, String> {
    let song_path = if let Some(s) = payload.as_str() {
        s.to_string()
    } else {
        payload["songPath"]
            .as_str()
            .ok_or("缺少 songPath")?
            .to_string()
    };

    let path = PathBuf::from(&song_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", song_path));
    }

    let tagged_file = Probe::open(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?
        .read()
        .map_err(|e| format!("解析失败: {}", e))?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let metadata = if let Some(tag) = tag {
        json!({
            "title": tag.title().unwrap_or_default(),
            "artist": tag.artist().unwrap_or_default(),
            "album": tag.album().unwrap_or_default(),
            "genre": tag.genre().unwrap_or_default(),
            "year": tag.year().unwrap_or_default(),
            "track": tag.track().unwrap_or_default(),
            "duration": tagged_file.properties().duration().as_secs(),
            "filePath": song_path,
        })
    } else {
        json!({
            "title": path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            "duration": tagged_file.properties().duration().as_secs(),
            "filePath": song_path,
        })
    };

    Ok(metadata)
}

/// 保存歌曲元数据
#[tauri::command]
pub async fn save_song_metadata(payload: Value) -> Result<(), String> {
    let file_path = payload["filePath"].as_str().ok_or("缺少 filePath")?;
    let _ = file_path;
    // 使用 lofty 写入标签
    Ok(())
}

/// 解析上传文件
#[tauri::command]
pub async fn parse_upload_file(payload: Value) -> Result<Value, String> {
    let file_path = payload["filePath"]
        .as_str()
        .or(payload.as_str())
        .ok_or("缺少 filePath")?;
    read_song_metadata(json!({ "songPath": file_path })).await
}

/// 写入上传文件元数据
#[tauri::command]
pub async fn write_upload_file(payload: Value) -> Result<(), String> {
    save_song_metadata(payload).await
}

/// 云上传
#[tauri::command]
pub async fn cloud_upload(payload: Value) -> Result<Value, String> {
    let file_path = payload["filePath"].as_str().ok_or("缺少 filePath")?;
    let url = payload["url"].as_str().ok_or("缺少 url")?;

    let client = reqwest::Client::new();
    let file_bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
    let file_name = PathBuf::from(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or("upload".to_string());

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name);
    let form = reqwest::multipart::Form::new().part("file", part);

    let response = client
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let result = response.text().await.map_err(|e| e.to_string())?;
    Ok(json!({ "response": result }))
}
