const { contextBridge, ipcRenderer } = require('electron')

// 诊断标记
console.log('--- [Preload] Script execution started (CJS Mode)');

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
    loadLocalLyric: (songPath) => ipcRenderer.invoke('load-local-lyric', songPath),
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
    // B站登录（二维码扫码，获取 Cookie 提升画质）
    biliLoginQr: () => ipcRenderer.invoke('bilibili:login-qr'),
    biliLoginCheck: (qrcodeKey) => ipcRenderer.invoke('bilibili:login-check', { qrcodeKey }),
    biliLoginStatus: () => ipcRenderer.invoke('bilibili:login-status'),
    biliLogout: () => ipcRenderer.invoke('bilibili:logout'),
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
    downloadList: () => ipcRenderer.invoke('download:list'),
    downloadRemove: (downloadId) => ipcRenderer.invoke('download:remove', { downloadId }),
    downloadClear: (status) => ipcRenderer.invoke('download:clear', { status }),
    downloadRetry: (downloadId) => ipcRenderer.invoke('download:retry', { downloadId }),
    onDownloadStarted: (cb) => {
        const sub = (_, data) => cb(data)
        ipcRenderer.on('download:started', sub)
        return () => ipcRenderer.removeListener('download:started', sub)
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
    // 打开本地文件/文件夹路径
    openPath: (p) => ipcRenderer.invoke('open-path', { path: p })
}

// 导出到全局
try {
    contextBridge.exposeInMainWorld('__ELECTRON_BRIDGE__', bridgeAPI)
    contextBridge.exposeInMainWorld('bridge', bridgeAPI)
    contextBridge.exposeInMainWorld('ipcHandler', bridgeAPI)
    contextBridge.exposeInMainWorld('ipcRenderer', bridgeAPI)
    contextBridge.exposeInMainWorld('electron', bridgeAPI)
    console.log('--- [Preload] Bridge exposed successfully to window.__ELECTRON_BRIDGE__')
} catch (e) {
    console.error('--- [Preload] Failed to expose bridge:', e)
}
