use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "wma", "ape", "opus",
    "wv", "tta", "dsf", "dff", "mp2", "ac3", "amr", "aiff", "au", "ra",
    "ram", "mpc", "mka", "weba",
];

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "flv", "wmv", "m4v", "ts"];

/// 生成唯一 ID(模拟 Electron 的 'local-' + Date.now() + Math.random())
fn gen_id(prefix: &str) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let rand = {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        (nanos as f64) / 1_000_000_000.0
    };
    format!("{}{}{}", prefix, ts, rand)
}

/// 类似 JavaScript 的 encodeURI：不编码 ASCII 字母数字和 ;,/?:@&=+$-_.!~*'()#
/// 仅编码非 ASCII 字符（如中文）和空格等
/// 这样生成的 URL 格式与前端 bridge.fileUrl(encodeURI) 完全一致
fn encode_uri(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for byte in s.bytes() {
        // encodeURI 不编码的字符：A-Z a-z 0-9 ; , / ? : @ & = + $ - _ . ! ~ * ' ( ) #
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b';' | b',' | b'/' | b'?' | b':' | b'@' | b'&' | b'=' | b'+'
                    | b'$' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' | b'#'
            )
        {
            result.push(byte as char);
        } else {
            // 非 ASCII 字符需要先转为 UTF-8 字节序列，再百分号编码
            result.push_str(&format!("%{:02X}", byte));
        }
    }
    result
}

/// 将文件路径转为 local-file 协议 URL
/// Tauri 2 在 Windows/Linux(WebView2/WebKitGTK)上自定义协议格式为 http://<scheme>.localhost/<path>
/// 在 macOS(WKWebView)上为 <scheme>://<path>
/// 使用 encode_uri（等价 JS encodeURI），与前端 bridge.fileUrl 生成格式一致
fn path_to_url(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let encoded = encode_uri(&normalized);
    if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
        format!("http://local-file.localhost/{}", encoded)
    } else {
        format!("local-file://{}", encoded)
    }
}

/// 将文件路径转为 song-cover 协议 URL（同 path_to_url 的平台规则）
fn path_to_cover_url(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let encoded = encode_uri(&normalized);
    if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
        format!("http://song-cover.localhost/{}", encoded)
    } else {
        format!("song-cover://{}", encoded)
    }
}

/// 判断是否为音频文件
fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 判断是否为视频文件
fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 递归扫描目录中的音频文件,返回完整歌曲对象数组(与 Electron scanAudioFiles 一致)
fn scan_audio_files(path: &Path) -> Vec<Value> {
    let mut results = Vec::new();
    if path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                results.extend(scan_audio_files(&p));
            }
        }
        return results;
    }

    if !is_audio(path) {
        return results;
    }

    let file_path = path.to_string_lossy().to_string();
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // 尝试用 lofty 读取元数据
    let (name, artist, album, duration_ms) = match Probe::open(path)
        .ok()
        .and_then(|p| p.read().ok())
    {
        Some(tagged_file) => {
            let duration_secs = tagged_file.properties().duration().as_secs_f64();
            let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
            if let Some(tag) = tag {
                let name = tag.title().map(|s| s.to_string()).unwrap_or_else(|| file_stem.clone());
                let artist = tag.artist().map(|s| s.to_string()).unwrap_or_else(|| "未知歌手".to_string());
                let album = tag.album().map(|s| s.to_string()).unwrap_or_else(|| "本地磁盘".to_string());
                (name, artist, album, (duration_secs * 1000.0) as u64)
            } else {
                (
                    file_stem.clone(),
                    "未知歌手".to_string(),
                    "本地磁盘".to_string(),
                    (duration_secs * 1000.0) as u64,
                )
            }
        }
        None => (
            file_stem.clone(),
            "本地音乐".to_string(),
            "本地磁盘".to_string(),
            0u64,
        ),
    };

    results.push(json!({
        "id": gen_id("local-"),
        "name": name,
        "artist": artist,
        "ar": [{ "name": artist }],
        "path": file_path,
        "url": path_to_url(&file_path),
        "size": size,
        "dt": duration_ms,
        "duration": duration_ms as f64 / 1000.0,
        "al": { "name": album, "picUrl": path_to_cover_url(&file_path) }
    }));
    results
}

/// 递归扫描目录中的视频文件,返回完整视频对象数组(与 Electron scanVideoFiles 一致)
fn scan_video_files(path: &Path) -> Vec<Value> {
    let mut results = Vec::new();
    if path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                results.extend(scan_video_files(&p));
            }
        }
        return results;
    }

    if !is_video(path) {
        return results;
    }

    let file_path = path.to_string_lossy().to_string();
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_uppercase())
        .unwrap_or_default();

    // 尝试用 lofty 读取视频时长(lofty 支持部分视频格式)
    let duration = match Probe::open(path)
        .ok()
        .and_then(|p| p.read().ok())
    {
        Some(tagged_file) => tagged_file.properties().duration().as_secs_f64(),
        None => 0.0,
    };

    results.push(json!({
        "id": gen_id("local-video-"),
        "name": file_stem,
        "path": file_path,
        "url": path_to_url(&file_path),
        "size": size,
        "duration": duration,
        "format": ext,
        "al": { "name": "本地视频", "picUrl": path_to_cover_url(&file_path) }
    }));
    results
}

/// 打开音频文件选择对话框(返回完整歌曲对象数组,与 Electron 一致)
#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "音频文件",
            &[
                "mp3", "flac", "wav", "ogg", "m4a", "ape", "aac", "wma", "opus",
            ],
        )
        .pick_files(move |paths| {
            let result = paths.map(|files| {
                let mut all_songs = Vec::new();
                for f in &files {
                    let path = PathBuf::from(f.to_string());
                    all_songs.extend(scan_audio_files(&path));
                }
                json!(all_songs)
            });
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(json!([])))
}

/// 打开目录选择对话框(返回目录内音频文件对象数组)
#[tauri::command]
pub async fn open_directory_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let result = path.map(|p| {
            let path_buf = PathBuf::from(p.to_string());
            json!(scan_audio_files(&path_buf))
        });
        let _ = tx.send(result);
    });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(json!([])))
}

/// 打开视频文件选择对话框(返回完整视频对象数组)
#[tauri::command]
pub async fn open_video_file_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "视频文件",
            &["mp4", "mkv", "webm", "avi", "mov", "flv", "wmv", "m4v", "ts"],
        )
        .pick_files(move |paths| {
            let result = paths.map(|files| {
                let mut all_videos = Vec::new();
                for f in &files {
                    let path = PathBuf::from(f.to_string());
                    all_videos.extend(scan_video_files(&path));
                }
                json!(all_videos)
            });
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(json!([])))
}

/// 打开视频目录选择对话框(返回目录内视频文件对象数组)
#[tauri::command]
pub async fn open_video_directory_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let result = path.map(|p| {
            let path_buf = PathBuf::from(p.to_string());
            json!(scan_video_files(&path_buf))
        });
        let _ = tx.send(result);
    });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(json!([])))
}

/// 打开云上传文件选择对话框(返回文件路径数组)
#[tauri::command]
pub async fn open_cloud_upload_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("音频文件", &["mp3", "flac", "wav", "ogg", "m4a"])
        .pick_files(move |paths| {
            let result = paths.map(|files| {
                json!(files.iter().map(|f| f.to_string()).collect::<Vec<_>>())
            });
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(json!([])))
}

/// 打开封面图片选择对话框(返回单个文件路径)
#[tauri::command]
pub async fn open_cover_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("图片文件", &["jpg", "jpeg", "png", "bmp", "webp"])
        .pick_file(move |path| {
            let result = path.map(|p| json!(p.to_string()));
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(Value::Null))
}

/// 打开歌词文件选择对话框(返回单个文件路径)
#[tauri::command]
pub async fn open_lyrics_dialog(app: tauri::AppHandle) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("歌词文件", &["lrc", "txt"])
        .pick_file(move |path| {
            let result = path.map(|p| json!(p.to_string()));
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.unwrap_or(Value::Null))
}
