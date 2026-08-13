/**
 * Tauri 桥接兼容层
 * 替代 electron/preload.cjs，提供与原 window.__ELECTRON_BRIDGE__ 完全一致的 API
 * 渲染端 27 处调用点无需修改
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

// 事件监听器管理（用于 off 和清理）
const listenerMap = new Map()

/**
 * 生成自定义协议 URL（跨平台）
 * Tauri 2 在 Windows/Linux(WebView2/WebKitGTK)上自定义协议格式为 http://<scheme>.localhost/<path>
 * 在 macOS(WKWebView)上为 <scheme>://<path>
 * 用 navigator.userAgent 同步判断平台，避免异步调用
 */
function fileUrl(scheme, path) {
  const normalized = String(path).replace(/\\/g, '/')
  const encoded = encodeURI(normalized)
  const ua = (navigator.userAgent || '').toLowerCase()
  // WebView2 (Windows) 和 WebKitGTK (Linux) 用 http://<scheme>.localhost/<path>
  // WKWebView (macOS) 用 <scheme>://<path>
  if (ua.includes('windows') || ua.includes('linux')) {
    return `http://${scheme}.localhost/${encoded}`
  }
  return `${scheme}://${encoded}`
}

class TauriBridge {
  /**
   * 双向调用（替代 ipcRenderer.invoke）
   * 通道名中的冒号(如 download:start)会被替换为下划线(download_start)作为 Rust 命令名
   */
  async invoke(channel, ...args) {
    const cmdName = channel.replace(/:/g, '_').replace(/-/g, '_')
    // 无参数时不传参数对象，有参数时统一包装为 { payload }
    if (args.length === 0) {
      return invoke(cmdName)
    }
    const payload = args.length === 1 ? args[0] : args
    return invoke(cmdName, { payload })
  }

  /**
   * 单向发送（替代 ipcRenderer.send）
   * 窗口控制类直接调用 Tauri API，其他通过 emit
   */
  send(channel, ...args) {
    const payload = args.length === 0 ? null : (args.length === 1 ? args[0] : args)
    // 窗口控制类通道特殊处理
    switch (channel) {
      case 'window-minimize':
        getCurrentWebviewWindow().minimize()
        return
      case 'window-maximize':
        getCurrentWebviewWindow().isMaximized().then((maximized) => {
          if (maximized) {
            getCurrentWebviewWindow().unmaximize()
          } else {
            getCurrentWebviewWindow().maximize()
          }
        })
        return
      case 'window-close':
        getCurrentWebviewWindow().close()
        return
      case 'window-minimize-to-tray':
        getCurrentWebviewWindow().hide()
        return
      case 'window-quit':
        import('@tauri-apps/plugin-process').then(({ exit }) => exit(0))
        return
      default:
        emit(channel, payload)
    }
  }

  /**
   * 监听事件（替代 ipcRenderer.on）
   * 返回取消监听函数
   * 兼容 Electron 的 (event, ...args) 签名：Tauri 2 的 event.payload 作为第二个参数传出
   */
  on(channel, callback) {
    let unlistenFn = null
    const subscription = (event) => {
      // 模拟 Electron 的 (event, ...args) 签名
      // Tauri 2 event.payload 是发送的数据
      // 如果 payload 是数组，展开为多个参数（兼容 Electron send 多参数）
      const payload = event.payload
      if (Array.isArray(payload)) {
        callback(event, ...payload)
      } else {
        callback(event, payload)
      }
    }
    listen(channel, subscription).then((un) => {
      unlistenFn = un
      listenerMap.set(channel, un)
    })
    // 返回取消监听函数（兼容原 preload 的返回值）
    return () => {
      if (unlistenFn) unlistenFn()
      listenerMap.delete(channel)
    }
  }

  /**
   * 取消监听（替代 ipcRenderer.off）
   */
  off(channel, callback) {
    const un = listenerMap.get(channel)
    if (un) {
      un()
      listenerMap.delete(channel)
    }
  }

  // ===== 常用原生功能封装（与 preload.cjs 完全一致） =====
  openFileDialog() { return this.invoke('open-file-dialog') }
  openDirectoryDialog() { return this.invoke('open-directory-dialog') }
  saveLyric(data) { return this.invoke('save-lyric', data) }
  loadLocalLyric(songPath) { return this.invoke('load-local-lyric', songPath) }
  searchMultiLyric({ songName, artist }) { return this.invoke('search-multi-lyric', { songName, artist }) }
  fetchLyricByCandidate(candidate) { return this.invoke('fetch-lyric-by-candidate', candidate) }
  getQQLyric({ songName, artist, duration }) { return this.invoke('get-qq-lyric', { songName, artist, duration }) }
  getKugouLyric({ hash }) { return this.invoke('get-kugou-lyric', { hash }) }
  findLocalMv(params) { return this.invoke('find-local-mv', params) }
  saveEnglishAnalysis(data) { return this.invoke('save-english-analysis', data) }
  loadEnglishAnalysis(songPath) { return this.invoke('load-english-analysis', songPath) }
  openVideoFileDialog() { return this.invoke('open-video-file-dialog') }
  openVideoDirectoryDialog() { return this.invoke('open-video-directory-dialog') }
  readSongMetadata(songPath) { return this.invoke('read-song-metadata', songPath) }
  saveSongMetadata(data) { return this.invoke('save-song-metadata', data) }
  saveOnlineLyric(data) { return this.invoke('save-online-lyric', data) }
  loadOnlineLyricCache(songId) { return this.invoke('load-online-lyric-cache', songId) }
  saveOnlineEnglishAnalysis(data) { return this.invoke('save-online-english-analysis', data) }
  loadOnlineEnglishAnalysis(songId) { return this.invoke('load-online-english-analysis', songId) }
  setWindowFullscreen() { return this.invoke('set-window-fullscreen') }
  exitWindowFullscreen() { return this.invoke('exit-window-fullscreen') }
  downloadVideo(params) { return this.invoke('video-download', params) }
  cancelVideoDownload(downloadId) { return this.invoke('video-download-cancel', { downloadId }) }
  parseVideoUrl(url) { return this.invoke('video:parse-url', { url }) }
  biliLoginQr() { return this.invoke('bilibili:login-qr') }
  biliLoginCheck(qrcodeKey) { return this.invoke('bilibili:login-check', { qrcodeKey }) }
  biliLoginStatus() { return this.invoke('bilibili:login-status') }
  biliLogout() { return this.invoke('bilibili:logout') }
  ncmMvSearch(keyword) { return this.invoke('ncm-mv-search', { keyword }) }
  openPath(p) { return this.invoke('open-path', { path: p }) }

  /**
   * 生成自定义协议 URL（local-file / song-cover）
   * 跨平台：Windows/Linux 用 http://<scheme>.localhost/<path>，macOS 用 <scheme>://<path>
   */
  fileUrl(scheme, path) { return fileUrl(scheme, path) }

  // ===== 事件监听封装（与 preload.cjs 完全一致） =====
  onVideoDownloadProgress(cb) { return this.on('video-download-progress', cb) }
  onVideoDownloadStarted(cb) { return this.on('video-download-started', cb) }
  onVideoDownloadDone(cb) { return this.on('video-download-done', cb) }
  onVideoDownloadError(cb) { return this.on('video-download-error', cb) }

  // ===== 统一下载管理器 =====
  downloadStart(params) { return this.invoke('download:start', params) }
  downloadCancel(downloadId) { return this.invoke('download:cancel', { downloadId }) }
  downloadList() { return this.invoke('download:list') }
  downloadRemove(downloadId) { return this.invoke('download:remove', { downloadId }) }
  downloadClear(status) { return this.invoke('download:clear', { status }) }
  downloadRetry(downloadId) { return this.invoke('download:retry', { downloadId }) }
  onDownloadStarted(cb) { return this.on('download:started', cb) }
  onDownloadProgress(cb) { return this.on('download:progress', cb) }
  onDownloadDone(cb) { return this.on('download:done', cb) }
  onDownloadError(cb) { return this.on('download:error', cb) }
}

const bridge = new TauriBridge()

// 兼容所有 5 个别名（与 preload.cjs 一致）
window.__ELECTRON_BRIDGE__ = bridge
window.bridge = bridge
window.ipcHandler = bridge
window.ipcRenderer = bridge
window.electron = bridge

export default bridge
