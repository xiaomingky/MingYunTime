use serde_json::{json, Value};

const NATIVE_API_BASE: &str = "http://127.0.0.1:3400";

/// 视频流解析
#[tauri::command]
pub async fn video_parse_url(payload: Value) -> Result<Value, String> {
    let url = format!("{}/video/parse-url", NATIVE_API_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 网易云 MV 搜索
#[tauri::command]
pub async fn ncm_mv_search(payload: Value) -> Result<Value, String> {
    let keyword = payload["keyword"].as_str().unwrap_or("");
    let url = format!(
        "{}/ncm/mv-search?keyword={}",
        NATIVE_API_BASE,
        urlencoding::encode(keyword)
    );
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

/// 查找本地 MV
#[tauri::command]
pub async fn find_local_mv(payload: Value) -> Result<Value, String> {
    let song_name = payload["songName"].as_str().ok_or("缺少 songName")?;
    let artist = payload["artist"].as_str().unwrap_or("");
    let search_dirs = payload["searchDirs"].as_array();

    let mut results = Vec::new();
    let video_exts = ["mp4", "mkv", "avi", "mov", "flv", "webm", "m4v"];

    let dirs: Vec<String> = if let Some(dirs) = search_dirs {
        dirs.iter()
            .filter_map(|d| d.as_str().map(|s| s.to_string()))
            .collect()
    } else {
        // 默认搜索目录
        if let Some(music_dir) = dirs::audio_dir() {
            vec![music_dir.to_string_lossy().to_string()]
        } else {
            vec![]
        }
    };

    for dir in dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if video_exts.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                            let file_name = path
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            // 简单匹配：文件名包含歌曲名
                            if file_name.contains(song_name)
                                || (artist.is_empty() == false && file_name.contains(artist))
                            {
                                results.push(json!({
                                    "name": file_name,
                                    "path": path.to_string_lossy(),
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(json!(results))
}
