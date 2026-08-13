mod commands;
mod sidecar;
mod tray;
mod protocol;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_http::init());

    let builder = protocol::register_protocols(builder);

    builder
        .setup(|app| {
            // 启动三平台 Node API sidecar 服务
            sidecar::start_node_services(app.handle())?;

            // 创建系统托盘(必须先创建,保证即使窗口创建失败也有托盘维持事件循环)
            tray::create_tray(app.handle())?;

            // 手动创建主窗口(tauri.conf.json 中 windows 为空,避免预创建时 WebView2 失败导致程序退出)
            // 在 setup 中创建窗口,如果失败不会导致程序 panic(有托盘维持事件循环)
            match tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("茗韵时光")
            .inner_size(1200.0, 800.0)
            .min_inner_size(1022.0, 720.0)
            .decorations(false)
            .center()
            .build()
            {
                Ok(main_window) => {
                    log::info!("主窗口创建成功");
                    let app_handle = app.handle().clone();
                    let main_window_clone = main_window.clone();
                    main_window.on_window_event(move |event| {
                        match event {
                            tauri::WindowEvent::Resized(_) => {
                                let is_max = main_window_clone.is_maximized().unwrap_or(false);
                                let _ = app_handle.emit("window-maximize-status", is_max);
                            }
                            tauri::WindowEvent::CloseRequested { api, .. } => {
                                // 关闭时最小化到托盘而不是退出
                                api.prevent_close();
                                let _ = main_window_clone.hide();
                            }
                            tauri::WindowEvent::Focused(focused) => {
                                if *focused {
                                    let _ = app_handle.emit("window-shown-recover", ());
                                }
                            }
                            _ => {}
                        }
                    });
                }
                Err(e) => {
                    log::error!("主窗口创建失败: {} (程序将继续运行,可通过托盘操作)", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 窗口控制
            commands::window::window_minimize,
            commands::window::window_maximize,
            commands::window::window_close,
            commands::window::window_minimize_to_tray,
            commands::window::window_quit,
            commands::window::set_window_fullscreen,
            commands::window::exit_window_fullscreen,

            commands::window::open_osk,
            commands::window::open_external,
            // 文件对话框
            commands::dialog::open_file_dialog,
            commands::dialog::open_directory_dialog,
            commands::dialog::open_video_file_dialog,
            commands::dialog::open_video_directory_dialog,
            commands::dialog::open_cloud_upload_dialog,
            commands::dialog::open_cover_dialog,
            commands::dialog::open_lyrics_dialog,
            // 文件系统
            commands::fs::save_lyric,
            commands::fs::load_local_lyric,
            commands::fs::save_english_analysis,
            commands::fs::load_english_analysis,
            commands::fs::save_online_lyric,
            commands::fs::load_online_lyric_cache,
            commands::fs::save_online_english_analysis,
            commands::fs::load_online_english_analysis,
            commands::fs::open_path,
            commands::fs::show_item_in_folder,
            commands::fs::scan_fonts,
            commands::fs::clear_cover_cache,
            // 下载管理
            commands::download::download_start,
            commands::download::download_cancel,
            commands::download::download_list,
            commands::download::download_remove,
            commands::download::download_clear,
            commands::download::download_retry,
            commands::download::download_song,
            commands::download::download_cover_for_song,
            commands::download::video_download,
            commands::download::video_download_cancel,
            // 媒体元数据
            commands::media::read_song_metadata,
            commands::media::save_song_metadata,
            commands::media::parse_upload_file,
            commands::media::write_upload_file,
            commands::media::cloud_upload,
            // 歌词
            commands::lyric::search_multi_lyric,
            commands::lyric::fetch_lyric_by_candidate,
            commands::lyric::get_qq_lyric,
            commands::lyric::get_kugou_lyric,
            // B站登录
            commands::bilibili::bilibili_login_qr,
            commands::bilibili::bilibili_login_check,
            commands::bilibili::bilibili_login_status,
            commands::bilibili::bilibili_logout,
            // 视频解析
            commands::video::video_parse_url,
            commands::video::ncm_mv_search,
            commands::video::find_local_mv,
            // 动漫
            commands::anime::anime_sources,
            commands::anime::anime_home,
            commands::anime::anime_search,
            commands::anime::anime_detail,
            commands::anime::anime_parse_playurl,
            // 动漫元信息
            commands::anime::anime_meta_search,
            commands::anime::anime_meta_related,
            // 影视
            commands::movie::movie_sources,
            commands::movie::movie_home,
            commands::movie::movie_search,
            commands::movie::movie_detail,
            commands::movie::movie_parse_playurl,
            // QQ 音乐 API 代理
            commands::qq_api::qq_search,
            commands::qq_api::qq_smartbox,
            commands::qq_api::qq_hotkey,
            commands::qq_api::qq_song_info,
            commands::qq_api::qq_song_play,
            commands::qq_api::qq_lyric,
            commands::qq_api::qq_album_info,
            commands::qq_api::qq_batch_song_info,
            commands::qq_api::qq_song_detail,
            commands::qq_api::qq_singer_list,
            commands::qq_api::qq_singer_desc,
            commands::qq_api::qq_singer_hotsong,
            commands::qq_api::qq_singer_album,
            commands::qq_api::qq_singer_mv,
            commands::qq_api::qq_similar_singer,
            commands::qq_api::qq_singer_star_num,
            commands::qq_api::qq_playlist_categories,
            commands::qq_api::qq_playlist_list,
            commands::qq_api::qq_playlist_detail,
            commands::qq_api::qq_batch_playlists,
            commands::qq_api::qq_new_disks,
            commands::qq_api::qq_ranks,
            commands::qq_api::qq_top_lists,
            commands::qq_api::qq_comments,
            commands::qq_api::qq_user_playlists,
            commands::qq_api::qq_liked_songs,
            commands::qq_api::qq_user_detail,
            commands::qq_api::qq_user_avatar,
            commands::qq_api::qq_web_login,
            commands::qq_api::qq_qr_create,
            commands::qq_api::qq_qr_check,
            commands::qq_api::qq_oper_mylike,
            commands::qq_api::qq_oper_songlist,
            commands::qq_api::qq_mv_list,
            commands::qq_api::qq_mv_play,
            commands::qq_api::qq_mv_by_tag,
            commands::qq_api::qq_image_url,
            commands::qq_api::qq_digital_albums,
            commands::qq_api::qq_download,
            commands::qq_api::qq_radio_lists,
            commands::qq_api::qq_recommend,
            commands::qq_api::qq_ticket_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
