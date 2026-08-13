use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 获取应用数据目录
fn get_app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir().unwrap().join("com.mingyuntime.app")
    })
}

/// 确保目录存在
fn ensure_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 保存歌词到本地缓存（优先保存在歌曲同目录，失败则存入缓存）
#[tauri::command]
pub async fn save_lyric(app: AppHandle, payload: Value) -> Result<(), String> {
    let song_path_str = payload["songPath"].as_str().ok_or("缺少 songPath")?;
    let lyric = payload["lyric"].as_str().ok_or("缺少 lyric")?;
    
    // 1. 尝试保存在歌曲同目录
    let song_path = PathBuf::from(song_path_str);
    let mut saved_to_local = false;
    if let Some(stem) = song_path.file_stem() {
        let lrc_path = song_path.with_file_name(stem).with_extension("lrc");
        if fs::write(&lrc_path, lyric).is_ok() {
            saved_to_local = true;
        }
    }
    
    // 2. 如果保存失败（如无权限），降级保存到 app_data_dir/lyrics_cache
    if !saved_to_local {
        let cache_dir = get_app_data_dir(&app).join("lyrics_cache");
        ensure_dir(&cache_dir)?;
        let hash = format!("{:x}", md5_hash(song_path_str));
        let cache_file = cache_dir.join(format!("{}.lrc", hash));
        fs::write(&cache_file, lyric).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// 加载本地歌词
/// 1. 先查找歌曲同目录的同名 .lrc 文件（原版 Electron 逻辑）
/// 2. 再查找 app_data_dir/lyrics_cache 缓存
/// 返回 { success, lyric } 格式（与原版 Electron 一致）
#[tauri::command]
pub async fn load_local_lyric(app: AppHandle, payload: Value) -> Result<Value, String> {
    let song_path = payload
        .as_str()
        .or_else(|| payload["songPath"].as_str())
        .ok_or("缺少 songPath")?
        .to_string();

    // 1. 查找歌曲同目录的同名 .lrc 文件
    let song_path_buf = PathBuf::from(&song_path);
    if let Some(stem) = song_path_buf.file_stem() {
        let lrc_path = song_path_buf
            .with_file_name(stem)
            .with_extension("lrc");
        if lrc_path.exists() {
            match fs::read_to_string(&lrc_path) {
                Ok(content) => {
                    return Ok(json!({ "success": true, "lyric": content }));
                }
                Err(_) => {}
            }
        }
    }

    // 2. 查找 app_data_dir/lyrics_cache 缓存
    let cache_dir = get_app_data_dir(&app).join("lyrics_cache");
    let hash = format!("{:x}", md5_hash(&song_path));
    let cache_file = cache_dir.join(format!("{}.lrc", hash));
    if cache_file.exists() {
        match fs::read_to_string(&cache_file) {
            Ok(content) => {
                return Ok(json!({ "success": true, "lyric": content }));
            }
            Err(_) => {}
        }
    }

    // 3. 未找到歌词
    Ok(json!({ "success": false, "error": "No local lyric file found" }))
}

/// 保存英文解析缓存
#[tauri::command]
pub async fn save_english_analysis(app: AppHandle, payload: Value) -> Result<(), String> {
    let song_path = payload["songPath"].as_str().ok_or("缺少 songPath")?;
    let analysis = payload["analysis"].as_str().ok_or("缺少 analysis")?;
    let cache_dir = get_app_data_dir(&app).join("analysis_cache");
    ensure_dir(&cache_dir)?;
    let hash = format!("{:x}", md5_hash(song_path));
    let cache_file = cache_dir.join(format!("{}.json", hash));
    fs::write(&cache_file, analysis).map_err(|e| e.to_string())?;
    Ok(())
}

/// 加载英文解析缓存
#[tauri::command]
pub async fn load_english_analysis(app: AppHandle, payload: Value) -> Result<Value, String> {
    let song_path = payload.as_str().or_else(|| payload["songPath"].as_str()).ok_or("缺少 songPath")?.to_string();
    let cache_dir = get_app_data_dir(&app).join("analysis_cache");
    let hash = format!("{:x}", md5_hash(&song_path));
    let cache_file = cache_dir.join(format!("{}.json", hash));
    if cache_file.exists() {
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        Ok(json!(content))
    } else {
        Ok(Value::Null)
    }
}

/// 保存在线歌词缓存
#[tauri::command]
pub async fn save_online_lyric(app: AppHandle, payload: Value) -> Result<(), String> {
    let song_id = payload["songId"].as_str().or_else(|| payload["songId"].as_str()).ok_or("缺少 songId")?.to_string();
    let lyric = payload["lyric"].to_string();
    let cache_dir = get_app_data_dir(&app).join("online_lyrics_cache");
    ensure_dir(&cache_dir)?;
    let cache_file = cache_dir.join(format!("{}.json", song_id));
    fs::write(&cache_file, lyric).map_err(|e| e.to_string())?;
    Ok(())
}

/// 加载在线歌词缓存
#[tauri::command]
pub async fn load_online_lyric_cache(app: AppHandle, payload: Value) -> Result<Value, String> {
    let song_id = payload.as_str().or_else(|| payload["songId"].as_str()).ok_or("缺少 songId")?.to_string();
    let cache_dir = get_app_data_dir(&app).join("online_lyrics_cache");
    let cache_file = cache_dir.join(format!("{}.json", song_id));
    if cache_file.exists() {
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or(Value::Null))
    } else {
        Ok(Value::Null)
    }
}

/// 保存在线英文解析缓存
#[tauri::command]
pub async fn save_online_english_analysis(app: AppHandle, payload: Value) -> Result<(), String> {
    let song_id = payload["songId"].as_str().ok_or("缺少 songId")?;
    let analysis = payload["analysis"].to_string();
    let cache_dir = get_app_data_dir(&app).join("online_analysis_cache");
    ensure_dir(&cache_dir)?;
    let cache_file = cache_dir.join(format!("{}.json", song_id));
    fs::write(&cache_file, analysis).map_err(|e| e.to_string())?;
    Ok(())
}

/// 加载在线英文解析缓存
#[tauri::command]
pub async fn load_online_english_analysis(app: AppHandle, payload: Value) -> Result<Value, String> {
    let song_id = payload.as_str().or_else(|| payload["songId"].as_str()).ok_or("缺少 songId")?.to_string();
    let cache_dir = get_app_data_dir(&app).join("online_analysis_cache");
    let cache_file = cache_dir.join(format!("{}.json", song_id));
    if cache_file.exists() {
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or(Value::Null))
    } else {
        Ok(Value::Null)
    }
}

/// 打开本地路径
#[tauri::command]
pub async fn open_path(payload: Value) -> Result<(), String> {
    let path = payload["path"].as_str().ok_or("缺少 path")?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// 在文件管理器中显示文件
#[tauri::command]
pub async fn show_item_in_folder(payload: Value) -> Result<(), String> {
    let path = payload["path"].as_str().ok_or("缺少 path")?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// 扫描系统字体
#[tauri::command]
pub async fn scan_fonts() -> Result<Value, String> {
    let mut fonts = Vec::new();
    let fonts_dir = dirs::font_dir().ok_or("无法获取字体目录")?;
    if fonts_dir.exists() {
        for entry in fs::read_dir(&fonts_dir).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext = ext.to_string_lossy().to_lowercase();
                    if ext == "ttf" || ext == "otf" || ext == "ttc" {
                        if let Some(name) = path.file_stem() {
                            fonts.push(name.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    // Windows 字体目录
    #[cfg(target_os = "windows")]
    {
        let win_fonts = PathBuf::from("C:\\Windows\\Fonts");
        if win_fonts.exists() {
            for entry in fs::read_dir(&win_fonts).map_err(|e| e.to_string())? {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if let Some(ext) = path.extension() {
                        let ext = ext.to_string_lossy().to_lowercase();
                        if ext == "ttf" || ext == "otf" || ext == "ttc" {
                            if let Some(name) = path.file_stem() {
                                let name = name.to_string_lossy().to_string();
                                if !fonts.contains(&name) {
                                    fonts.push(name);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(json!(fonts))
}

/// 清理封面缓存
#[tauri::command]
pub async fn clear_cover_cache(app: AppHandle) -> Result<(), String> {
    let cache_dir = get_app_data_dir(&app).join("cover_cache");
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 简单 MD5 哈希（用于缓存文件名）
fn md5_hash(s: &str) -> u128 {
    let mut hash: u128 = 0;
    for byte in s.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u128);
    }
    hash
}
