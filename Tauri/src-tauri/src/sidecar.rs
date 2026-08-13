use log::{error, info};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use which::which;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 存储子进程引用，用于退出时清理
static SIDECAR_CHILDREN: Mutex<Vec<Child>> = Mutex::new(Vec::new());

/// 获取 resources 目录路径
/// 开发模式：使用项目源码目录下的 resources/
/// 发布模式：使用 resource_dir() 下的 resources/
fn get_resources_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        // 开发模式：CARGO_MANIFEST_DIR 是 src-tauri 目录，向上一级到项目根目录
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .map(|p| p.join("resources"))
            .unwrap_or_else(|| manifest_dir.join("resources"))
    } else {
        // 发布模式：使用 Tauri 的 resource_dir
        // 发布模式：使用 Tauri 的 resource_dir，根据 tauri.conf.json 配置，映射到了根目录
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .to_path_buf()
            })
    }
}

/// 启动三平台 Node API sidecar 服务
pub fn start_node_services(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 查找 Node.js 可执行文件
    let node_path = match find_node_binary() {
        Ok(path) => path,
        Err(e) => {
            error!("未找到 Node.js: {}", e);
            return Err(e);
        }
    };

    info!("Using Node.js: {:?}", node_path);

    let resources_dir = get_resources_dir(app);
    info!("Resources dir: {:?}", resources_dir);

    // 启动网易云 API (端口 3100)
    let netease_path = resources_dir.join("netease-api");
    if let Some(entry) = find_api_entry(&netease_path) {
        start_service(&node_path, &entry, "3100", "NetEase API");
    } else {
        error!("NetEase API entry not found in {:?}", netease_path);
    }

    // 启动 QQ 音乐 API (端口 3200)
    let qq_path = resources_dir.join("qq-music-api");
    if let Some(entry) = find_api_entry(&qq_path) {
        start_service(&node_path, &entry, "3200", "QQ Music API");
    } else {
        error!("QQ Music API entry not found in {:?}", qq_path);
    }

    // 启动酷狗音乐 API (端口 3300)
    let kugou_path = resources_dir.join("kugou-music-api");
    if let Some(entry) = find_api_entry(&kugou_path) {
        start_service(&node_path, &entry, "3300", "Kugou Music API");
    } else {
        error!("Kugou Music API entry not found in {:?}", kugou_path);
    }

    // 启动 Native API 服务 (端口 3400)
    // 封装原 Electron 的歌词/动漫/影视/B站/视频解析等复杂逻辑
    let native_path = resources_dir.join("native-api");
    if let Some(entry) = find_api_entry(&native_path) {
        start_service(&node_path, &entry, "3400", "Native API");
    } else {
        error!("Native API entry not found in {:?}", native_path);
    }

    Ok(())
}

/// 查找 Node.js 二进制文件
fn find_node_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    match which("node") {
        Ok(path) => Ok(path),
        Err(_) => Err("Node.js not found in PATH. Please install Node.js.".into()),
    }
}

/// 查找 API 入口文件
/// 优先级:
///   1. 顶层 app.js / index.js / main.js / server.js (网易云/酷狗)
///   2. dist/app.cjs / dist/app.js (QQ 音乐 @sansenjian/qq-music-api)
fn find_api_entry(api_dir: &std::path::Path) -> Option<PathBuf> {
    // 1. 顶层入口(网易云 NeteaseCloudMusicApiEnhanced / 酷狗 KuGouMusicApi)
    for entry in &["app.js", "index.js", "main.js", "server.js"] {
        let path = api_dir.join(entry);
        if path.exists() {
            return Some(path);
        }
    }
    // 2. dist/ 入口(QQ 音乐 @sansenjian/qq-music-api,CommonJS 优先避免 ESM 加载问题)
    for entry in &["dist/app.cjs", "dist/app.js"] {
        let path = api_dir.join(entry);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// 启动单个 API 服务
/// - 设置工作目录为 API 根目录(便于 Node 查找 node_modules / libs)
/// - 若 libs/ 存在(QQ 音乐打包态),通过 NODE_PATH 指向 libs/
/// - PORT 由各服务自行读取(网易云/酷狗/QQ 均支持 PORT 环境变量)
fn start_service(
    node_path: &std::path::Path,
    entry: &std::path::Path,
    port: &str,
    name: &str,
) {
    // API 根目录:entry 为 <root>/app.js 或 <root>/dist/app.cjs
    // 取 entry 所在文件,先向上一级(dist 的话再向上一级)
    let api_root = entry
        .parent()
        .map(|p| {
            if p.file_name().and_then(|n| n.to_str()) == Some("dist") {
                p.parent().unwrap_or(p).to_path_buf()
            } else {
                p.to_path_buf()
            }
        })
        .unwrap_or_else(|| PathBuf::from("."));

    // NODE_PATH:打包态 QQ 音乐依赖放在 libs/(绕过 electron-builder/tauri node_modules 过滤)
    let libs_dir = api_root.join("libs");
    let mut cmd = Command::new(node_path);
    cmd.arg(entry)
        .env("PORT", port)
        .env("NODE_ENV", "production")
        .current_dir(&api_root);
    if libs_dir.exists() {
        cmd.env("NODE_PATH", &libs_dir);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            info!(
                "{} started on port {} (PID: {}, cwd: {:?})",
                name,
                port,
                child.id(),
                api_root
            );
            let mut children = SIDECAR_CHILDREN.lock().unwrap();
            children.push(child);
        }
        Err(e) => {
            error!("Failed to start {}: {}", name, e);
        }
    }
}

/// 停止所有 sidecar 服务
pub fn stop_all_services() {
    let mut children = SIDECAR_CHILDREN.lock().unwrap();
    for mut child in children.drain(..) {
        let _ = child.kill();
    }
}
