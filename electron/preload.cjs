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
    exitWindowFullscreen: () => ipcRenderer.invoke('exit-window-fullscreen')
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
