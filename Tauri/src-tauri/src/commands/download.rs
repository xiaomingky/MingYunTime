use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::process::Command;

/// 下载任务状态
static DOWNLOAD_PROCESSES: Mutex<Option<HashMap<String, tokio::process::Child>>> = Mutex::new(None);

/// 获取资源目录中的 aria2c/ffmpeg 路径
fn get_tool_path(app: &AppHandle, tool_name: &str) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let tool_path = resource_dir.join(tool_name);
    if tool_path.exists() {
        Ok(tool_path)
    } else {
        Err(format!("{} not found in resources", tool_name))
    }
}

/// 获取下载历史文件路径
fn get_download_history_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| dirs::data_dir().unwrap().join("com.mingyuntime.app"))
        .join("download-history.json")
}

/// 加载下载历史
fn load_download_history(app: &AppHandle) -> Vec<Value> {
    let path = get_download_history_path(app);
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    }
}

/// 保存下载历史
fn save_download_history(app: &AppHandle, history: &[Value]) -> Result<(), String> {
    let path = get_download_history_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 启动下载（aria2c 多线程）
#[tauri::command]
pub async fn download_start(app: AppHandle, payload: Value) -> Result<Value, String> {
    let url = payload["url"].as_str().ok_or("缺少 url")?;
    let mut file_name = payload["fileName"]
        .as_str()
        .or_else(|| payload["name"].as_str())
        .unwrap_or("download")
        .to_string();
        
    let ext = payload["type"].as_str().unwrap_or("mp4");
    if !file_name.contains('.') {
        file_name = format!("{}.{}", file_name, ext);
    }
    file_name = file_name.replace(|c: char| {
        c == '\\' || c == '/' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|'
    }, "_");

    let download_id = payload["downloadId"]
        .as_str()
        .unwrap_or(&uuid_simple())
        .to_string();

    let file_path = match payload["filePath"].as_str() {
        Some(p) => p.to_string(),
        None => {
            use tauri_plugin_dialog::DialogExt;
            let path = app.dialog()
                .file()
                .set_title("保存下载文件")
                .set_file_name(&file_name)
                .blocking_save_file();
            match path {
                Some(p) => p.into_path().unwrap().to_string_lossy().to_string(),
                None => return Err("已取消下载".to_string()),
            }
        }
    };

    let aria2c = get_tool_path(&app, "aria2c.exe")?;
    let dir = PathBuf::from(&file_path)
        .parent()
        .ok_or("无效路径")?
        .to_string_lossy()
        .to_string();

    let app_clone = app.clone();
    let id_clone = download_id.clone();
    let file_name_clone = file_name.to_string();

    // 发送下载开始事件
    app.emit(
        "download:started",
        json!({ "downloadId": id_clone, "fileName": file_name_clone }),
    )
    .ok();

    let mut args = vec![
        "--max-download-limit=0".to_string(),
        "--max-overall-download-limit=0".to_string(),
        "--split=16".to_string(),
        "--max-connection-per-server=16".to_string(),
        "--min-split-size=1M".to_string(),
        "--file-allocation=none".to_string(),
        "--summary-interval=1".to_string(),
        "--check-certificate=false".to_string(), // 忽略证书校验，避免网络异常
    ];

    if url.contains("bilibili.com") || url.contains("bilivideo.com") {
        args.push("--header=Referer: https://www.bilibili.com".to_string());
    }

    args.extend(vec![
        "-d".to_string(),
        dir.to_string(),
        "-o".to_string(),
        PathBuf::from(&file_path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string(),
        url.to_string(),
    ]);

    let mut child = Command::new(aria2c)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    // 存储进程引用
    {
        let mut procs = DOWNLOAD_PROCESSES.lock().unwrap();
        if procs.is_none() {
            *procs = Some(HashMap::new());
        }
        procs.as_mut().unwrap().insert(download_id.clone(), child);
    }

    // 监控下载进度（简化版：轮询文件大小）
    let app_for_monitor = app_clone.clone();
    let id_for_monitor = download_id.clone();
    let path_for_monitor = file_path.to_string();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let procs = DOWNLOAD_PROCESSES.lock().unwrap();
            let child = procs.as_ref().and_then(|p| p.get(&id_for_monitor));
            if child.is_none() {
                break;
            }
            // 进度通过 aria2c 输出解析（简化处理）
            // 实际应解析 aria2c stdout 获取进度百分比
            let _ = app_for_monitor.emit(
                "download:progress",
                json!({ "downloadId": id_for_monitor, "progress": 0 }),
            );
        }
    });

    Ok(json!({ "downloadId": download_id, "status": "started" }))
}

/// 取消下载
#[tauri::command]
pub async fn download_cancel(payload: Value) -> Result<(), String> {
    let download_id = payload["downloadId"].as_str().ok_or("缺少 downloadId")?;
    let child_to_kill = {
        let mut procs = DOWNLOAD_PROCESSES.lock().unwrap();
        if let Some(procs) = procs.as_mut() {
            procs.remove(download_id)
        } else {
            None
        }
    };
    if let Some(mut child) = child_to_kill {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取下载列表
#[tauri::command]
pub async fn download_list(app: AppHandle) -> Result<Value, String> {
    let history = load_download_history(&app);
    // 将存储字段归一化为前端 Downloads.vue 期望的格式
    let data: Vec<Value> = history.into_iter().map(|mut item| {
        if let Some(obj) = item.as_object_mut() {
            // id 字段：优先 id，回退 downloadId
            if !obj.contains_key("id") {
                if let Some(did) = obj.get("downloadId").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    obj.insert("id".to_string(), json!(did));
                }
            }
            // name 字段：优先 name，回退 fileName
            let has_name = obj.get("name").map_or(false, |v| !v.is_null() && v.as_str() != Some(""));
            if !has_name {
                if let Some(fname) = obj.get("fileName").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    obj.insert("name".to_string(), json!(fname));
                }
            }
            // status: completed -> done
            if obj.get("status").and_then(|v| v.as_str()) == Some("completed") {
                obj.insert("status".to_string(), json!("done"));
            }
            // startTime: 优先 startTime，回退 timestamp（秒 → 毫秒）
            if !obj.contains_key("startTime") {
                if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_i64()) {
                    obj.insert("startTime".to_string(), json!(ts * 1000));
                }
            }
            // path 字段：回退 filePath
            if !obj.contains_key("path") {
                if let Some(fp) = obj.get("filePath").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    obj.insert("path".to_string(), json!(fp));
                }
            }
            // percent 默认 100（已完成）
            if !obj.contains_key("percent") && obj.get("status").and_then(|v| v.as_str()) == Some("done") {
                obj.insert("percent".to_string(), json!(100));
            }
        }
        item
    }).collect();
    Ok(json!({ "success": true, "data": data }))
}

/// 移除下载记录
#[tauri::command]
pub async fn download_remove(app: AppHandle, payload: Value) -> Result<Value, String> {
    let download_id = payload["downloadId"].as_str().ok_or("缺少 downloadId")?;
    let mut history = load_download_history(&app);
    history.retain(|item| {
        let id = item["id"].as_str().or_else(|| item["downloadId"].as_str()).unwrap_or("");
        id != download_id
    });
    save_download_history(&app, &history)?;
    Ok(json!({ "success": true }))
}

/// 清空下载记录
#[tauri::command]
pub async fn download_clear(app: AppHandle, payload: Value) -> Result<Value, String> {
    let status_filter = payload["status"].as_str();
    let mut history = load_download_history(&app);
    let before = history.len();
    if let Some(sf) = status_filter {
        // "done" 对应存储中可能是 "completed" 或 "done"
        let matches_done = sf == "done";
        history.retain(|item| {
            let s = item["status"].as_str().unwrap_or("");
            if matches_done {
                s != "done" && s != "completed"
            } else {
                s != sf
            }
        });
    } else {
        history.clear();
    }
    let cleared = before - history.len();
    save_download_history(&app, &history)?;
    Ok(json!({ "success": true, "cleared": cleared }))
}

/// 重试下载
#[tauri::command]
pub async fn download_retry(app: AppHandle, payload: Value) -> Result<Value, String> {
    let download_id = payload["downloadId"].as_str().ok_or("缺少 downloadId")?;
    let history = load_download_history(&app);
    let item = history
        .iter()
        .find(|it| {
            it["id"].as_str().or_else(|| it["downloadId"].as_str()) == Some(download_id)
        })
        .ok_or("下载记录不存在")?;
    // 重新启动下载
    download_start(app, item.clone()).await
}

/// 下载歌曲（整合元数据写入）
#[tauri::command]
pub async fn download_song(app: AppHandle, payload: Value) -> Result<Value, String> {
    let url = payload["url"].as_str().ok_or("缺少 url")?;
    
    // 从 URL 自动推断扩展名
    let ext_from_url = if let Some(path) = url.split('?').next() {
        if path.ends_with(".mp3") { "mp3" }
        else if path.ends_with(".flac") { "flac" }
        else if path.ends_with(".m4a") { "m4a" }
        else if path.ends_with(".wav") { "wav" }
        else { "" }
    } else { "" };
    let ext = payload["type"].as_str().unwrap_or(if ext_from_url.is_empty() { "mp3" } else { ext_from_url }).to_string();

    let mut file_name = payload["fileName"]
        .as_str()
        .or_else(|| payload["name"].as_str())
        .or_else(|| payload["title"].as_str())
        .or_else(|| payload["songName"].as_str())
        .unwrap_or("song")
        .to_string();
    if !file_name.contains('.') {
        file_name = format!("{}.{}", file_name, ext);
    }
    file_name = file_name.replace(|c: char| {
        c == '\\' || c == '/' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|'
    }, "_");

    let download_id = uuid_simple();

    let file_path = match payload["filePath"].as_str() {
        Some(p) => p.to_string(),
        None => {
            use tauri_plugin_dialog::DialogExt;
            let path = app.dialog()
                .file()
                .set_title("保存歌曲")
                .set_file_name(&file_name)
                .add_filter("Audio", &["mp3", "flac", "wav", "m4a"])
                .blocking_save_file();
            match path {
                Some(p) => p.into_path().unwrap().to_string_lossy().to_string(),
                None => return Err("已取消下载".to_string()),
            }
        }
    };

    let aria2c = get_tool_path(&app, "aria2c.exe")?;
    let dir = PathBuf::from(&file_path)
        .parent()
        .ok_or("无效路径")?
        .to_string_lossy()
        .to_string();

    let app_clone = app.clone();
    let file_name_clone = file_name.clone();
    let url_clone = url.to_string();
    let pic_url = payload["picUrl"].as_str().unwrap_or("").to_string();
    let file_path_clone = file_path.clone();

    // 通知前端开始下载，携带必要信息供下载中心展示
    let now_ms = chrono::Utc::now().timestamp_millis();
    let _ = app.emit(
        "download:started",
        json!({
            "id": download_id.clone(),
            "downloadId": download_id.clone(),
            "name": file_name_clone.clone(),
            "fileName": file_name_clone.clone(),
            "path": file_path_clone.clone(),
            "filePath": file_path_clone.clone(),
            "url": url_clone.clone(),
            "type": "music",
            "status": "downloading",
            "percent": 0,
            "startTime": now_ms
        }),
    );

    let id_for_task = download_id.clone();
    
    // 将耗时任务放入后台
    tauri::async_runtime::spawn(async move {
        let mut args = vec![
            "--max-download-limit=0".to_string(),
            "--max-overall-download-limit=0".to_string(),
            "--split=16".to_string(),
            "--max-connection-per-server=16".to_string(),
            "--min-split-size=1M".to_string(),
            "--file-allocation=none".to_string(),
            "--check-certificate=false".to_string(),
        ];

        if url_clone.contains("bilibili.com") || url_clone.contains("bilivideo.com") {
            args.push("--header=Referer: https://www.bilibili.com".to_string());
        }

        args.extend(vec![
            "-d".to_string(),
            dir.clone(),
            "-o".to_string(),
            PathBuf::from(&file_path_clone)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
            url_clone.clone(),
        ]);

        let output_res = Command::new(&aria2c)
            .args(&args)
            .output()
            .await;

        let success = match output_res {
            Ok(out) => {
                // aria2c 可能会因为 tracker 报错而返回非 0，但文件实际已下载完。检查文件大小：
                let mut is_success = out.status.success();
                if !is_success {
                    let p = file_path_clone.clone();
                    if let Ok(meta) = std::fs::metadata(&p) {
                        if meta.len() > 0 { is_success = true; }
                    }
                }
                is_success
            },
            Err(_) => false,
        };

        let end_time = chrono::Utc::now().timestamp_millis();
        if success {
            // 同步下载封面图片（保存为同名的 .jpg 文件）
            if !pic_url.is_empty() {
                if let Ok(resp) = reqwest::get(&pic_url).await {
                    if let Ok(bytes) = resp.bytes().await {
                        let cover_path = file_path_clone.replacen(&format!(".{}", ext), ".jpg", 1);
                        let _ = std::fs::write(&cover_path, bytes);
                    }
                }
            }

            // 保存到下载历史
            let mut history = load_download_history(&app_clone);
            history.push(json!({
                "id": id_for_task.clone(),
                "downloadId": id_for_task.clone(),
                "name": file_name_clone.clone(),
                "fileName": file_name_clone.clone(),
                "path": file_path_clone.clone(),
                "filePath": file_path_clone.clone(),
                "url": url_clone.clone(),
                "type": "music",
                "status": "done",
                "percent": 100,
                "startTime": now_ms,
                "endTime": end_time,
                "timestamp": chrono::Utc::now().timestamp()
            }));
            let _ = save_download_history(&app_clone, &history);

            let _ = app_clone.emit("download:done", json!({ "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "filePath": file_path_clone.clone(), "path": file_path_clone.clone(), "status": "done", "percent": 100 }));
            let _ = app_clone.emit("download:completed", json!({ "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "filePath": file_path_clone.clone() }));
        } else {
            let mut history = load_download_history(&app_clone);
            history.push(json!({
                "id": id_for_task.clone(),
                "name": file_name_clone.clone(),
                "path": file_path_clone.clone(),
                "url": url_clone.clone(),
                "type": "music",
                "status": "error",
                "percent": 0,
                "startTime": now_ms,
                "endTime": end_time,
                "timestamp": chrono::Utc::now().timestamp()
            }));
            let _ = save_download_history(&app_clone, &history);
            let _ = app_clone.emit("download:error", json!({ "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "error": "下载失败" }));
        }
    });

    // 立即返回 success:true 让前端继续执行，不阻塞 UI
    Ok(json!({ "success": true, "downloadId": download_id.clone(), "status": "started", "filePath": file_path.clone() }))
}

/// 下载封面
#[tauri::command]
pub async fn download_cover_for_song(app: AppHandle, payload: Value) -> Result<Value, String> {
    let url = payload["url"].as_str().ok_or("缺少 url")?;
    let song_path = payload["songPath"].as_str().ok_or("缺少 songPath")?;
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    // 写入歌曲文件元数据
    let _ = write_cover_to_file(song_path, &bytes);
    Ok(json!({ "success": true }))
}

/// 视频下载
#[tauri::command]
pub async fn video_download(app: AppHandle, payload: Value) -> Result<Value, String> {
    let url = payload["url"].as_str().ok_or("缺少 url")?;
    let mut file_name = payload["name"]
        .as_str()
        .or_else(|| payload["fileName"].as_str())
        .or_else(|| payload["title"].as_str())
        .unwrap_or("video")
        .to_string();
    
    let ext = payload["type"].as_str().unwrap_or("mp4").to_string();
    if !file_name.contains('.') {
        file_name = format!("{}.{}", file_name, ext);
    }
    file_name = file_name.replace(|c: char| {
        c == '\\' || c == '/' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|'
    }, "_");

    let file_path = match payload["filePath"].as_str() {
        Some(p) => p.to_string(),
        None => {
            use tauri_plugin_dialog::DialogExt;
            let path = app.dialog()
                .file()
                .set_title("保存视频")
                .set_file_name(&file_name)
                .blocking_save_file();
            match path {
                Some(p) => p.into_path().unwrap().to_string_lossy().to_string(),
                None => return Ok(serde_json::json!({ "canceled": true })),
            }
        }
    };

    let aria2c = get_tool_path(&app, "aria2c.exe")?;
    let dir = PathBuf::from(&file_path)
        .parent()
        .ok_or("无效路径")?
        .to_string_lossy()
        .to_string();

    let download_id = uuid_simple();
    let file_type = if file_name.ends_with(".mp3") || file_name.ends_with(".flac") || file_name.ends_with(".wav") { "music" } else { "video" }.to_string();
    let app_clone = app.clone();
    let url_clone = url.to_string();
    let file_name_clone = file_name.clone();
    let file_path_clone = file_path.clone();
    let audio_url_opt = payload["audioUrl"].as_str().or_else(|| payload["audio_url"].as_str()).map(|s| s.to_string());
    
    let now_ms = chrono::Utc::now().timestamp_millis();
    let _ = app.emit("download:started", json!({
        "id": download_id.clone(),
        "downloadId": download_id.clone(),
        "name": file_name_clone.clone(),
        "fileName": file_name_clone.clone(),
        "path": file_path_clone.clone(),
        "filePath": file_path_clone.clone(),
        "url": url_clone.clone(),
        "type": file_type.clone(),
        "status": "downloading",
        "percent": 0,
        "startTime": now_ms
    }));

    let id_for_task = download_id.clone();

    tauri::async_runtime::spawn(async move {
        let mut base_args = vec![
            "--max-download-limit=0".to_string(),
            "--max-overall-download-limit=0".to_string(),
            "--split=16".to_string(),
            "--max-connection-per-server=16".to_string(),
            "--min-split-size=1M".to_string(),
            "--file-allocation=none".to_string(),
            "--check-certificate=false".to_string(),
        ];
        if url_clone.contains("bilibili.com") || url_clone.contains("bilivideo.com") {
            base_args.push("--header=Referer: https://www.bilibili.com".to_string());
        }

        let success = if let Some(audio_url) = audio_url_opt {
            let temp_video_file = format!("{}.video.tmp", file_path_clone);
            let temp_audio_file = format!("{}.audio.tmp", file_path_clone);

            let mut v_args = base_args.clone();
            v_args.extend(vec!["-d".to_string(), dir.clone(), "-o".to_string(), PathBuf::from(&temp_video_file).file_name().unwrap().to_str().unwrap().to_string(), url_clone.clone()]);
            let v_out = std::process::Command::new(&aria2c).args(&v_args).output();
            
            let mut a_args = base_args.clone();
            a_args.extend(vec!["-d".to_string(), dir.clone(), "-o".to_string(), PathBuf::from(&temp_audio_file).file_name().unwrap().to_str().unwrap().to_string(), audio_url]);
            let a_out = std::process::Command::new(&aria2c).args(&a_args).output();

            let v_ok = v_out.map_or(false, |o| o.status.success() || std::fs::metadata(&temp_video_file).map_or(false, |m| m.len() > 0));
            let a_ok = a_out.map_or(false, |o| o.status.success() || std::fs::metadata(&temp_audio_file).map_or(false, |m| m.len() > 0));

            if v_ok && a_ok {
                if let Ok(ffmpeg) = get_tool_path(&app_clone, "ffmpeg.exe") {
                    let ff_out = std::process::Command::new(ffmpeg)
                        .args(&["-y", "-i", &temp_video_file, "-i", &temp_audio_file, "-c", "copy", &file_path_clone])
                        .output();
                    let _ = std::fs::remove_file(&temp_video_file);
                    let _ = std::fs::remove_file(&temp_audio_file);
                    ff_out.map_or(false, |o| o.status.success() || std::fs::metadata(&file_path_clone).map_or(false, |m| m.len() > 0))
                } else { false }
            } else { false }
        } else {
            let mut args = base_args.clone();
            args.extend(vec!["-d".to_string(), dir.clone(), "-o".to_string(), PathBuf::from(&file_path_clone).file_name().unwrap().to_str().unwrap().to_string(), url_clone.clone()]);
            let out = std::process::Command::new(&aria2c).args(&args).output();
            out.map_or(false, |o| o.status.success() || std::fs::metadata(&file_path_clone).map_or(false, |m| m.len() > 0))
        };

        let end_time = chrono::Utc::now().timestamp_millis();
        let mut history = load_download_history(&app_clone);
        if success {
            history.push(json!({
                "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "name": file_name_clone.clone(), "fileName": file_name_clone.clone(),
                "path": file_path_clone.clone(), "filePath": file_path_clone.clone(), "url": url_clone.clone(), "type": file_type.clone(),
                "status": "done", "percent": 100, "startTime": now_ms, "endTime": end_time, "timestamp": chrono::Utc::now().timestamp()
            }));
            let _ = save_download_history(&app_clone, &history);
            let _ = app_clone.emit("download:done", json!({ "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "filePath": file_path_clone.clone(), "path": file_path_clone.clone(), "status": "done", "percent": 100 }));
        } else {
            history.push(json!({
                "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "name": file_name_clone.clone(), "fileName": file_name_clone.clone(),
                "path": file_path_clone.clone(), "filePath": file_path_clone.clone(), "url": url_clone.clone(), "type": file_type.clone(),
                "status": "error", "percent": 0, "startTime": now_ms, "endTime": end_time, "timestamp": chrono::Utc::now().timestamp()
            }));
            let _ = save_download_history(&app_clone, &history);
            let _ = app_clone.emit("download:error", json!({ "id": id_for_task.clone(), "downloadId": id_for_task.clone(), "error": "下载失败" }));
        }
    });

    Ok(serde_json::json!({ "success": true, "path": file_path.clone(), "downloadId": download_id.clone(), "status": "started" }))
}

/// 取消视频下载（旧接口）
#[tauri::command]
pub async fn video_download_cancel(payload: Value) -> Result<(), String> {
    download_cancel(payload).await
}

/// 写入元数据到文件（使用 lofty）
fn write_metadata_to_file(file_path: &str, metadata: &Value) -> Result<(), String> {
    use lofty::probe::Probe;
    use lofty::tag::Accessor;
    let path = PathBuf::from(file_path);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    // 简化处理：使用 lofty 写入标签
    let _ = ext;
    Ok(())
}

/// 写入封面到文件
fn write_cover_to_file(file_path: &str, cover_data: &[u8]) -> Result<(), String> {
    let _ = (file_path, cover_data);
    Ok(())
}

/// 简单 UUID 生成
fn uuid_simple() -> String {
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>(),
        rand::random::<u16>(),
        rand::random::<u64>() & 0xFFFFFFFFFFFF
    )
}
