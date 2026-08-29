const { contextBridge, ipcRenderer } = require('electron')

const bridgeAPI = {
    on: (channel, callback) => {
        const subscription = (event, ...args) => callback(event, ...args)
        ipcRenderer.on(channel, subscription)
        return () => ipcRenderer.removeListener(channel, subscription)
    },
    off: (channel, callback) => ipcRenderer.off(channel, callback),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

    // 常用原生功能封装
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
    saveLyric: (data) => ipcRenderer.invoke('save-lyric', data),
    saveLyricAs: (data) => ipcRenderer.invoke('lyric-save-as', data),
    loadLocalLyric: (songPath) => ipcRenderer.invoke('load-local-lyric', songPath),
    // 歌词保存目录（歌词获取面板）
    lyricGetDir: () => ipcRenderer.invoke('lyric-dir:get'),
    lyricSaveDir: (dir) => ipcRenderer.invoke('lyric-dir:save', { dir }),
    lyricPickDir: () => ipcRenderer.invoke('lyric-dir:pick'),
    // 多平台歌词搜索（QQ + 酷狗）
    searchMultiLyric: ({ songName, artist }) => ipcRenderer.invoke('search-multi-lyric', { songName, artist }),
    fetchLyricByCandidate: (candidate) => ipcRenderer.invoke('fetch-lyric-by-candidate', candidate),
    getQQLyric: ({ songName, artist, duration }) => ipcRenderer.invoke('get-qq-lyric', { songName, artist, duration }),
    // 酷狗歌词：按 hash 直接获取（不走搜索匹配，与 searchMultiLyric 不同）
    getKugouLyric: ({ hash }) => ipcRenderer.invoke('get-kugou-lyric', { hash }),
    findLocalMv: (params) => ipcRenderer.invoke('find-local-mv', params),
    saveEnglishAnalysis: (data) => ipcRenderer.invoke('save-english-analysis', data),
    loadEnglishAnalysis: (songPath) => ipcRenderer.invoke('load-english-analysis', songPath),
    openVideoFileDialog: () => ipcRenderer.invoke('open-video-file-dialog'),
    openVideoDirectoryDialog: () => ipcRenderer.invoke('open-video-directory-dialog'),
    readSongMetadata: (songPath) => ipcRenderer.invoke('read-song-metadata', songPath),
    saveSongMetadata: (data) => ipcRenderer.invoke('save-song-metadata', data),
    // 在线歌词本地缓存（支持离线使用）
    saveOnlineLyric: (data) => ipcRenderer.invoke('save-online-lyric', data),
    loadOnlineLyricCache: (songId) => ipcRenderer.invoke('load-online-lyric-cache', songId),
    // 在线歌曲英文解析本地缓存
    saveOnlineEnglishAnalysis: (data) => ipcRenderer.invoke('save-online-english-analysis', data),
    loadOnlineEnglishAnalysis: (songId) => ipcRenderer.invoke('load-online-english-analysis', songId),
    // 窗口全屏控制
    setWindowFullscreen: () => ipcRenderer.invoke('set-window-fullscreen'),
    exitWindowFullscreen: () => ipcRenderer.invoke('exit-window-fullscreen'),
    // 视频下载（m3u8/直链/本地）—— 旧接口，委托给统一下载管理器
    downloadVideo: (params) => ipcRenderer.invoke('video-download', params),
    cancelVideoDownload: (downloadId) => ipcRenderer.invoke('video-download-cancel', { downloadId }),
    // 网址视频流解析
    parseVideoUrl: (url) => ipcRenderer.invoke('video:parse-url', { url }),
    // B站解析接口模式（web | tv，TV 为无水印接口）
    getBiliApiMode: () => ipcRenderer.invoke('bili-api:get-mode'),
    setBiliApiMode: (mode) => ipcRenderer.invoke('bili-api:set-mode', mode),
    // B站登录（二维码扫码，获取 Cookie 提升画质）
    biliLoginQr: () => ipcRenderer.invoke('bilibili:login-qr'),
    biliLoginCheck: (qrcodeKey) => ipcRenderer.invoke('bilibili:login-check', { qrcodeKey }),
    biliLoginStatus: () => ipcRenderer.invoke('bilibili:login-status'),
    biliLogout: () => ipcRenderer.invoke('bilibili:logout'),
    // B站 TV 端登录（云视听小电视 access_key，解锁 TV 接口高画质）
    biliTvLoginQr: () => ipcRenderer.invoke('bilibili:tv-login-qr'),
    biliTvLoginCheck: (params) => ipcRenderer.invoke('bilibili:tv-login-check', params),
    biliTvLoginStatus: () => ipcRenderer.invoke('bilibili:tv-login-status'),
    biliTvLogout: () => ipcRenderer.invoke('bilibili:tv-logout'),
    // 动漫专区 B站番剧/电影取流（TV 接口 DASH 音视频分离）
    biliAnimePlayurl: (params) => ipcRenderer.invoke('bilibili:anime-playurl', params),
    // 动漫专区 B站弹幕（seg.so protobuf，滚动/顶部/底部）
    biliAnimeDanmaku: (params) => ipcRenderer.invoke('bilibili:anime-danmaku', params),
// YouTube 登录（官方网页登录，捕获 Cookie 供 yt-dlp 使用）
    youtubeLoginOpen: () => ipcRenderer.invoke('youtube:login-open'),
    youtubeLoginClose: () => ipcRenderer.invoke('youtube:login-close'),
    youtubeLoginStatus: () => ipcRenderer.invoke('youtube:login-status'),
    youtubeLogout: () => ipcRenderer.invoke('youtube:logout'),
    onYoutubeLoginDone: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('youtube-login-done', sub)
        return () => ipcRenderer.removeListener('youtube-login-done', sub)
    },
    // B站直播开播（OBS推流参数）
    biliLiveRoom: () => ipcRenderer.invoke('bilibili:live-room'),
    biliLiveAreas: () => ipcRenderer.invoke('bilibili:live-areas'),
    biliLiveStart: (params) => ipcRenderer.invoke('bilibili:live-start', params),
    biliLiveUpdate: (params) => ipcRenderer.invoke('bilibili:live-update', params),
    biliLiveStop: (params) => ipcRenderer.invoke('bilibili:live-stop', params),
    // B站管理（收藏夹 / 空间 / 稿件）
    biliFavList: () => ipcRenderer.invoke('bilibili:fav-list'),
    biliFavContent: (params) => ipcRenderer.invoke('bilibili:fav-content', params),
    biliFavSeason: (params) => ipcRenderer.invoke('bilibili:fav-season', params),
    biliSpaceInfo: () => ipcRenderer.invoke('bilibili:space-info'),
    biliArchives: (params) => ipcRenderer.invoke('bilibili:archives', params),
    // 下载目录设置（统一下载目录，所有下载共用）
    downloadDefaultDir: () => ipcRenderer.invoke('download:default-dir'),
    downloadCheckDir: (dir) => ipcRenderer.invoke('download:check-dir', { dir }),
    downloadPickDir: () => ipcRenderer.invoke('download:pick-dir'),
    downloadGetDir: () => ipcRenderer.invoke('download:get-dir'),
    downloadSaveDir: (dir) => ipcRenderer.invoke('download:save-dir', { dir }),
    // 音乐命名格式（下载命名 + 本地识别）
    getMusicNaming: () => ipcRenderer.invoke('music-naming:get'),
    saveMusicNaming: (d) => ipcRenderer.invoke('music-naming:save', d),
    onVideoDownloadProgress: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('video-download-progress', sub)
        return () => ipcRenderer.removeListener('video-download-progress', sub)
    },
    onVideoDownloadStarted: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('video-download-started', sub)
        return () => ipcRenderer.removeListener('video-download-started', sub)
    },
    onVideoDownloadDone: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('video-download-done', sub)
        return () => ipcRenderer.removeListener('video-download-done', sub)
    },
    onVideoDownloadError: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('video-download-error', sub)
        return () => ipcRenderer.removeListener('video-download-error', sub)
    },
    // ===== 统一下载管理器（新） =====
    downloadStart: (params) => ipcRenderer.invoke('download:start', params),
    downloadCancel: (downloadId) => ipcRenderer.invoke('download:cancel', { downloadId }),
    downloadPause: (downloadId) => ipcRenderer.invoke('download:pause', { downloadId }),
    downloadResume: (downloadId) => ipcRenderer.invoke('download:resume', { downloadId }),
    downloadList: () => ipcRenderer.invoke('download:list'),
    downloadRemove: (downloadId) => ipcRenderer.invoke('download:remove', { downloadId }),
    downloadClear: (status) => ipcRenderer.invoke('download:clear', { status }),
    downloadRetry: (downloadId) => ipcRenderer.invoke('download:retry', { downloadId }),
    onDownloadStarted: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:started', sub)
        return () => ipcRenderer.removeListener('download:started', sub)
    },
    onDownloadPaused: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:paused', sub)
        return () => ipcRenderer.removeListener('download:paused', sub)
    },
    onDownloadProgress: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:progress', sub)
        return () => ipcRenderer.removeListener('download:progress', sub)
    },
    onDownloadDone: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:done', sub)
        return () => ipcRenderer.removeListener('download:done', sub)
    },
    onDownloadError: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:error', sub)
        return () => ipcRenderer.removeListener('download:error', sub)
    },
    // 网易云 MV 搜索（按歌名匹配）
    ncmMvSearch: (keyword) => ipcRenderer.invoke('ncm-mv-search', { keyword }),
    // 智慧教育教材（国家中小学智慧教育平台）
    smartEduCatalog: () => ipcRenderer.invoke('smart-edu:catalog'),
    smartEduDetail: (contentId) => ipcRenderer.invoke('smart-edu:detail', { contentId }),
    smartEduPreview: (contentId) => ipcRenderer.invoke('smart-edu:preview', { contentId }),
    smartEduAudios: (contentId) => ipcRenderer.invoke('smart-edu:audios', { contentId }),
    smartEduDownloadPdf: (contentId, title) => ipcRenderer.invoke('smart-edu:download-pdf', { contentId, title }),
    smartEduDownloadAudio: (url, title) => ipcRenderer.invoke('smart-edu:download-audio', { url, title }),
    smartEduProbeAudio: (url) => ipcRenderer.invoke('smart-edu:probe-audio', { url }),
    smartEduLoginOpen: () => ipcRenderer.invoke('smart-edu:login-open'),
    smartEduLoginStatus: () => ipcRenderer.invoke('smart-edu:login-status'),
    smartEduLoginManual: (raw) => ipcRenderer.invoke('smart-edu:login-manual', { raw }),
    smartEduTestToken: () => ipcRenderer.invoke('smart-edu:test-token'),
    smartEduLogout: () => ipcRenderer.invoke('smart-edu:logout'),
    onSmartEduLoginDone: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('smartedu-login-done', sub)
        return () => ipcRenderer.removeListener('smartedu-login-done', sub)
    },
    // 打开本地文件/文件夹路径
    openPath: (p) => ipcRenderer.invoke('open-path', { path: p }),
    // 音乐加密格式解锁（网易云/QQ/酷狗 -> 原生格式还原）
    unlockScanDir: (dir) => ipcRenderer.invoke('unlock:scan-dir', dir),
    unlockConvertFile: (filePath) => ipcRenderer.invoke('unlock:convert-file', { path: filePath }),
    unlockOpenFiles: () => ipcRenderer.invoke('unlock:open-files-dialog'),
    unlockParseInfo: (paths) => ipcRenderer.invoke('unlock:parse-info', { paths })
}

// 导出到全局
try {
    contextBridge.exposeInMainWorld('__ELECTRON_BRIDGE__', bridgeAPI)
    contextBridge.exposeInMainWorld('bridge', bridgeAPI)
    contextBridge.exposeInMainWorld('ipcHandler', bridgeAPI)
    contextBridge.exposeInMainWorld('ipcRenderer', bridgeAPI)
    contextBridge.exposeInMainWorld('electron', bridgeAPI)
} catch (e) {
    console.error('--- [Preload] Failed to expose bridge:', e)
}
