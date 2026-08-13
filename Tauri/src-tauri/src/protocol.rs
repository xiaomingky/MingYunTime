use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::http::{Request, Response};
use tauri::{Builder, Runtime};
use urlencoding::decode;

/// 封面缓存条目：图片数据 + MIME 类型 + 创建时间
struct CoverCacheEntry {
    data: Vec<u8>,
    mime_type: String,
    ts: Instant,
}

/// 封面 LRU 缓存：key = 文件路径(+?static 后缀), value = CoverCacheEntry
/// 参考原版 Electron：最多 8 条，5 分钟过期
static COVER_CACHE: Mutex<Option<HashMap<String, CoverCacheEntry>>> = Mutex::new(None);
const COVER_CACHE_MAX: usize = 8;
const COVER_CACHE_TTL: Duration = Duration::from_secs(300);

/// 1x1 透明 PNG 像素（超级兜底，避免 404 导致前端报错）
const TRANSPARENT_PIXEL: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// 从请求中提取文件路径
/// Tauri 2 在 Windows/WebView2 上,自定义协议的 URI 格式为:
///   http://<scheme>.localhost/<encoded_path>
/// 在 macOS/WKWebView 上为:
///   <scheme>://<path>
/// 使用 request.uri().path() 获取路径部分（不依赖完整 URL 字符串）
fn extract_path_from_request(request: &Request<Vec<u8>>) -> String {
    let uri = request.uri();
    let raw_path = uri.path();

    // 去掉前导 / 和查询参数
    let path_part = raw_path.strip_prefix('/').unwrap_or(raw_path);
    // 去掉查询参数（如 ?static=1）
    let path_part = path_part.split('?').next().unwrap_or(path_part);

    // URL 解码
    let decoded = decode(path_part).unwrap_or(path_part.into()).to_string();

    windows_path_fix(&decoded)
}

/// 检测请求是否带 ?static=1 参数（前端用于请求静态图片，跳过 GIF 动图）
fn has_static_param(request: &Request<Vec<u8>>) -> bool {
    if let Some(query) = request.uri().query() {
        return query.contains("static=1");
    }
    // 兜底：检查完整 URI 字符串
    request.uri().to_string().contains("?static=1")
}

/// Windows 路径修正:去掉前导 / 并处理反斜杠
fn windows_path_fix(path: &str) -> String {
    let mut p = path.to_string();
    // Windows 盘符前可能有多余的 /
    if cfg!(target_os = "windows") {
        // /C:/path → C:/path
        if p.starts_with('/') && p.len() > 2 && p.as_bytes()[2] == b':' {
            p = p[1..].to_string();
        }
        // 将正斜杠转回反斜杠(Windows 文件系统)
        p = p.replace('/', "\\");
    }
    p
}

/// 注册自定义协议
pub fn register_protocols<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    // 注册 local-file 协议（读取本地文件,用于音频/视频播放）
    builder
        .register_uri_scheme_protocol("local-file", |_ctx, request: Request<Vec<u8>>| {
            let path = extract_path_from_request(&request);

            // 调试日志：打印实际收到的 URI 和解析出的路径（排查 404 问题）
            eprintln!("[local-file] uri='{}' parsed_path='{}'", request.uri(), path);

            // 支持 Range 请求(音频/视频流式播放需要)
            let range_header = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            match read_file_with_range(&path, range_header.as_deref()) {
                Ok((content, status, headers)) => {
                    let mut builder = Response::builder()
                        .status(status)
                        .header("Content-Type", guess_content_type(&path))
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Accept-Ranges", "bytes");
                    for (k, v) in headers {
                        builder = builder.header(k, v);
                    }
                    builder.body(content).unwrap()
                }
                Err(e) => {
                    eprintln!("[local-file] 读取失败 path='{}' err='{}'", path, e);
                    Response::builder()
                        .status(404)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(format!("File not found: {}", e).into_bytes())
                        .unwrap()
                }
            }
        })
        // 注册 song-cover 协议（带 LRU 缓存 + 内嵌封面提取 + 同目录图片查找 + 兜底图）
        // 完全参考原版 Electron 实现（main.js 第 2546-2651 行）
        .register_uri_scheme_protocol("song-cover", |_ctx, request: Request<Vec<u8>>| {
            let path = extract_path_from_request(&request);
            let has_static = has_static_param(&request);

            eprintln!(
                "[song-cover] uri='{}' parsed_path='{}' static={}",
                request.uri(),
                path,
                has_static
            );

            // 文件不存在直接走兜底
            if !Path::new(&path).exists() {
                eprintln!("[song-cover] 文件不存在 path='{}'", path);
                return build_fallback_response();
            }

            // LRU 缓存检查：命中且未过期则直接返回
            let cache_key = format!("{}{}", path, if has_static { "?static" } else { "" });
            {
                let mut cache = COVER_CACHE.lock().unwrap();
                if let Some(cache_map) = cache.as_mut() {
                    if let Some(entry) = cache_map.get(&cache_key) {
                        if entry.ts.elapsed() < COVER_CACHE_TTL {
                            return Response::builder()
                                .header("Content-Type", &entry.mime_type)
                                .header("Access-Control-Allow-Origin", "*")
                                .header("Cache-Control", "max-age=86400")
                                .body(entry.data.clone())
                                .unwrap();
                        }
                        // 过期，移除
                        cache_map.remove(&cache_key);
                    }
                }
            }

            // 1. 提取内嵌封面（使用 lofty 解析音频元数据）
            if let Some((data, mime_type)) = extract_embedded_cover(&path, has_static) {
                // 写入 LRU 缓存
                insert_cover_cache(&cache_key, data.clone(), mime_type.clone());
                return Response::builder()
                    .header("Content-Type", &mime_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "max-age=86400")
                    .body(data)
                    .unwrap();
            }

            // 2. 查找同目录图片（依次尝试：同名 → cover/folder/album/front → 目录内任意图片）
            if let Some((data, mime_type)) = find_cover_in_directory(&path, has_static) {
                // 写入 LRU 缓存
                insert_cover_cache(&cache_key, data.clone(), mime_type.clone());
                return Response::builder()
                    .header("Content-Type", &mime_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "max-age=86400")
                    .body(data)
                    .unwrap();
            }

            // 3. 最终兜底
            eprintln!("[song-cover] 未找到封面，使用兜底图 path='{}'", path);
            build_fallback_response()
        })
}

/// 提取音频文件内嵌封面（使用 lofty）
/// 返回 (图片数据, MIME 类型)；失败返回 None
/// has_static=true 时跳过 GIF 动图（前端需要静态图片）
fn extract_embedded_cover(path: &str, has_static: bool) -> Option<(Vec<u8>, String)> {
    use lofty::file::TaggedFileExt;
    use lofty::probe::Probe;

    let tagged_file = Probe::open(Path::new(path)).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let pictures = tag.pictures();

    if pictures.is_empty() {
        return None;
    }

    for pic in pictures {
        // 静态图片请求时跳过 GIF 动图
        let mime_str = pic.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
        if has_static && mime_str == "image/gif" {
            continue;
        }
        return Some((pic.data().to_vec(), mime_str.to_string()));
    }
    None
}

/// 在文件同目录查找封面图片
/// 依次尝试：
///   1. 与音乐同名的图片（同名.jpg / 同名.png 等）
///   2. 通用封面文件名（cover / folder / album / front）
///   3. 目录内任意图片文件（最后兜底）
fn find_cover_in_directory(path: &str, has_static: bool) -> Option<(Vec<u8>, String)> {
    let file_path = Path::new(path);
    let dir = file_path.parent()?;
    let base_name = file_path.file_stem()?.to_str()?;
    let base_name = base_name.to_string();

    // 扩展名优先级：static 模式下不优先 GIF
    let exts: &[&str] = if has_static {
        &[".png", ".jpg", ".jpeg", ".webp"]
    } else {
        &[".gif", ".png", ".jpg", ".jpeg", ".webp"]
    };

    // 1. 与音乐同名的图片
    for ext in exts {
        let img_path = dir.join(format!("{}{}", base_name, ext));
        if let Some(data) = read_image_file(&img_path, ext) {
            return Some(data);
        }
    }

    // 2. 通用封面文件名（cover / Cover / folder / Folder / album / Album / front / Front）
    const COVER_NAMES: &[&str] = &[
        "cover", "Cover", "folder", "Folder", "album", "Album", "front", "Front",
    ];
    for cn in COVER_NAMES {
        for ext in exts {
            let img_path = dir.join(format!("{}{}", cn, ext));
            if let Some(data) = read_image_file(&img_path, ext) {
                return Some(data);
            }
        }
    }

    // 3. 目录内任意图片文件（最后兜底）
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                let ext_lower = format!(".{}", ext.to_lowercase());
                if exts.contains(&ext_lower.as_str()) {
                    if let Some(data) = read_image_file(&p, &ext_lower) {
                        return Some(data);
                    }
                }
            }
        }
    }

    None
}

/// 读取图片文件，返回 (数据, MIME 类型)
fn read_image_file(path: &Path, ext: &str) -> Option<(Vec<u8>, String)> {
    let data = std::fs::read(path).ok()?;
    let mime = mime_from_ext(ext);
    Some((data, mime.to_string()))
}

/// 根据扩展名获取 MIME 类型
fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        ".gif" => "image/gif",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".jpg" | ".jpeg" => "image/jpeg",
        _ => "image/jpeg",
    }
}

/// 写入封面 LRU 缓存（超过上限时删除最早条目）
fn insert_cover_cache(cache_key: &str, data: Vec<u8>, mime_type: String) {
    let mut cache = COVER_CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(HashMap::new());
    }
    let cache_map = cache.as_mut().unwrap();

    // LRU 淘汰：超过上限时删除最早条目
    while cache_map.len() >= COVER_CACHE_MAX {
        // 找到最早（ts 最小）的条目
        if let Some(oldest_key) = cache_map
            .iter()
            .min_by_key(|(_, v)| v.ts)
            .map(|(k, _)| k.clone())
        {
            cache_map.remove(&oldest_key);
        } else {
            break;
        }
    }

    cache_map.insert(
        cache_key.to_string(),
        CoverCacheEntry {
            data,
            mime_type,
            ts: Instant::now(),
        },
    );
}

/// 构建兜底响应：优先使用内置 icon.png，失败则使用 1x1 透明像素
fn build_fallback_response() -> Response<Vec<u8>> {
    // 尝试使用 src-tauri/icons/icon.png（编译时资源路径）
    // Tauri 运行时资源目录通常与可执行文件同目录的 resources/ 下
    // 但更可靠的方式是使用编译时嵌入的资源
    if let Some(icon_data) = load_builtin_icon() {
        return Response::builder()
            .header("Content-Type", "image/png")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "max-age=86400")
            .body(icon_data)
            .unwrap();
    }

    // 超级兜底：1x1 透明像素
    Response::builder()
        .header("Content-Type", "image/png")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "max-age=86400")
        .body(TRANSPARENT_PIXEL.to_vec())
        .unwrap()
}

/// 加载内置 icon.png（尝试多个可能的位置）
fn load_builtin_icon() -> Option<Vec<u8>> {
    // 1. 尝试可执行文件同目录的 icons/icon.png
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let icon_path = exe_dir.join("icons").join("icon.png");
            if icon_path.exists() {
                if let Ok(data) = std::fs::read(&icon_path) {
                    return Some(data);
                }
            }
            // 2. 尝试 resources/icons/icon.png
            let icon_path = exe_dir.join("resources").join("icons").join("icon.png");
            if icon_path.exists() {
                if let Ok(data) = std::fs::read(&icon_path) {
                    return Some(data);
                }
            }
        }
    }

    // 3. 尝试当前工作目录
    for rel in &["icons/icon.png", "src-tauri/icons/icon.png", "resources/icons/icon.png"] {
        let p = PathBuf::from(rel);
        if p.exists() {
            if let Ok(data) = std::fs::read(&p) {
                return Some(data);
            }
        }
    }

    None
}

/// 读取文件,支持 Range 请求(音频/视频流式播放)
/// Tauri 2 协议返回 Vec<u8>（不支持流式响应），对大文件需限制单次响应块大小，
/// 避免一次性读取整个文件到内存导致卡死。浏览器收到 206 后会继续发送 Range 请求获取剩余部分。
const MAX_CHUNK_SIZE: u64 = 2 * 1024 * 1024; // 2MB

fn read_file_with_range(
    path: &str,
    range: Option<&str>,
) -> Result<(Vec<u8>, u16, Vec<(String, String)>), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let file_size = metadata.len();

    if file_size == 0 {
        return Ok((Vec::new(), 200, vec![("Content-Length".to_string(), "0".to_string())]));
    }

    // 解析 Range 请求
    let (start, mut end) = if let Some(range) = range {
        if let Some(range_spec) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_spec.split('-').collect();
            if parts.len() == 2 {
                let start = parts[0].parse::<u64>().unwrap_or(0);
                let end = if parts[1].is_empty() {
                    file_size - 1
                } else {
                    parts[1].parse::<u64>().unwrap_or(file_size - 1)
                };
                (start, end)
            } else {
                (0u64, file_size - 1)
            }
        } else {
            (0u64, file_size - 1)
        }
    } else {
        // 无 Range 请求:返回前 MAX_CHUNK_SIZE 字节（206），让浏览器知道文件大小并继续请求剩余部分
        (0u64, file_size - 1)
    };

    if start >= file_size {
        return Ok((
            Vec::new(),
            416,
            vec![("Content-Range".to_string(), format!("bytes */{}", file_size))],
        ));
    }

    // 限制 end 不超过文件大小
    if end >= file_size {
        end = file_size - 1;
    }

    // 限制单次返回块大小为 MAX_CHUNK_SIZE，避免大文件一次性读取到内存
    let requested_length = end - start + 1;
    let chunk_end = if requested_length > MAX_CHUNK_SIZE {
        start + MAX_CHUNK_SIZE - 1
    } else {
        end
    };
    let chunk_length = chunk_end - start + 1;

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; chunk_length as usize];
    let read = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(read);

    // 始终返回 206 + Content-Range，让浏览器知道文件总大小并继续发送 Range 请求
    Ok((
        buf,
        206,
        vec![
            ("Content-Range".to_string(), format!("bytes {}-{}/{}", start, start + read as u64 - 1, file_size)),
            ("Content-Length".to_string(), read.to_string()),
        ],
    ))
}

/// 根据文件扩展名推断 Content-Type
fn guess_content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().map(|e| e.to_lowercase());
    match ext.as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("wma") => "audio/x-ms-wma",
        Some("opus") => "audio/opus",
        Some("ape") => "audio/x-ape",
        Some("mp4") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("avi") => "video/x-msvideo",
        Some("mov") => "video/quicktime",
        Some("flv") => "video/x-flv",
        Some("wmv") => "video/x-ms-wmv",
        Some("m4v") => "video/x-m4v",
        Some("ts") => "video/mp2t",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("lrc") => "text/plain; charset=utf-8",
        Some("json") => "application/json",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
