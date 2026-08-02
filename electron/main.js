import { app, BrowserWindow, shell, ipcMain, dialog, protocol, Tray, Menu, nativeImage, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { Readable } from 'node:stream'
// music-metadata 是 ESM-only，Electron 22 CJS 环境用动态 import 懒加载
let mm = null
async function getMM() {
    if (!mm) {
        const mod = await import('music-metadata')
        mm = mod.default || mod
    }
    return mm
}
import axios from 'axios'
import { exec, execFile } from 'node:child_process'
import https from 'node:https'
import crypto from 'node:crypto'

// 解析打包内 ffmpeg 路径（与 download-manager.js 的 resolveTool 一致）
function getFfmpegPath() {
    if (app.isPackaged) {
        const packed = path.join(process.resourcesPath, 'ffmpeg.exe')
        if (fs.existsSync(packed)) return packed
    }
    const dev = path.join(process.env.APP_ROOT || process.cwd(), 'resources', 'ffmpeg.exe')
    if (fs.existsSync(dev)) return dev
    return 'ffmpeg'
}

// 动漫模块
import './anime.js'
import './anime-meta.js'
import './movie.js'
// 统一下载管理器（aria2c 多线程 + ffmpeg + 历史记录）
import { setDownloadManagerWindow, delegateStartDownload, delegateCancelDownload } from './download-manager.js'
// 多平台歌词搜索（QQ + 酷狗）—— 必须用静态 import，否则 vite 打包后 dist-electron 下找不到模块
import { searchMultiPlatform, fetchLyricByCandidate, searchAndFetchQQ } from './lyric-providers.js'
// QQ 音乐 API 子进程(@sansenjian/qq-music-api,监听 3200 端口)
import { startQQMusicAPI, stopQQMusicAPI } from './qq-music.js'

// --- Win7 兼容性初始化 ---
if (process.platform === 'win32') {
    // 强制使用软件渲染或特定的渲染限制会导致严重卡顿。
    // 我们采取“稳健模式”：限制高负载 GL 特性，但保留基本硬件加速。
    app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('ignore-gpu-blacklist');
    // 如果在极旧的 Win7 上崩溃，可以尝试取消注释下面这行进行彻底降级
    // app.disableHardwareAcceleration();
}

// --- 内存/CPU 优化：V8 和 Chromium 开关（激进省内存） ---
// V8 堆上限 256MB（默认 4GB），gc-interval=500 避免频繁 GC 抢占主线程
// expose-gc 允许手动调用 gc() 在窗口隐藏时强制回收
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --gc-interval=500 --expose-gc')
// 磁盘缓存降到 5MB（默认 100MB）
app.commandLine.appendSwitch('disk-cache-size', '5242880')
// 禁用站点隔离（单窗口应用不需要），大幅降低内存
app.commandLine.appendSwitch('disable-site-isolation-trials')
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process')
// 禁用不必要的 Chromium 子系统，进一步降低基础内存
app.commandLine.appendSwitch('disable-extensions')
app.commandLine.appendSwitch('disable-plugins')
app.commandLine.appendSwitch('disable-printing')
app.commandLine.appendSwitch('disable-bundled-ppapi-flash')
app.commandLine.appendSwitch('disable-default-apps')
app.commandLine.appendSwitch('disable-translate')
app.commandLine.appendSwitch('disable-media-stream')  // 不用摄像头/麦克风（音频设备用 WebAudio 不依赖此）
// 降低图片解码缓存内存（Chromium 默认会缓存大量解码后的图片位图）
app.commandLine.appendSwitch('prune-to-zero', 'true')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')

// 设置正式名称，确保对话框标题正确
app.name = '茗韵时光'
// Windows 系统级应用识别：任务栏、开始菜单、跳转列表、Alt+Tab、文件关联"打开方式"都依赖此 ID
// 必须在 app.whenReady() 之前调用，且与 package.json build.appId 保持一致
if (process.platform === 'win32') {
    app.setAppUserModelId('com.mingyuntime.app')
}

// 单例锁：确保只有一个实例运行，后续启动会触发 second-instance 事件
// 这是"打开方式"功能正常工作的前提（否则会启动新进程而不是传给已运行的实例）
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
    // 已有实例运行，直接退出当前进程
    app.quit()
}

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// 支持的本地音频格式
const AUDIO_EXTENSIONS = [
    '.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.wma', '.ape',
    '.opus', '.wv', '.tta', '.dsf', '.dff', '.mp2', '.ac3', '.amr', '.aiff',
    '.au', '.ra', '.ram', '.mpc', '.mka', '.weba'
]
// 支持的本地视频格式（与 scanVideoFiles 内的 videoExts 保持一致）
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.ts']

let win
let tray = null

function createTray() {
    const iconPath = VITE_DEV_SERVER_URL
        ? path.join(process.env.APP_ROOT, 'build', 'icon.png')
        : path.join(RENDERER_DIST, 'icon.png')

    try {
        const icon = nativeImage.createFromPath(iconPath)
        tray = new Tray(icon.resize({ width: 16, height: 16 }))
    } catch (e) {
        tray = new Tray(nativeImage.createEmpty())
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => { win.show(); win.focus() } },
        { type: 'separator' },
        { label: '上一首', click: () => win.webContents.send('player-command', 'prev') },
        { label: '播放/暂停', click: () => win.webContents.send('player-command', 'togglePlay') },
        { label: '下一首', click: () => win.webContents.send('player-command', 'next') },
        { type: 'separator' },
        { label: '退出', click: () => { tray.destroy(); tray = null; app.quit() } }
    ])

    tray.setToolTip('茗韵时光')
    tray.setContextMenu(contextMenu)

    tray.on('double-click', () => {
        win.show()
        win.focus()
    })
}

// Register protocols (Privileged 保持不变)
protocol.registerSchemesAsPrivileged([
    { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'song-cover', privileges: { bypassCSP: true, stream: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

function createWindow() {
    const preloadPath = VITE_DEV_SERVER_URL
        ? path.join(process.env.APP_ROOT, 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.js')

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1022,
        minHeight: 720,
        frame: false,
        title: '茗韵时光', // 系统级窗口标题（任务栏 tooltip、Alt+Tab 等）
        backgroundColor: '#ffffff', // Win7 下防止透明窗口闪烁
        icon: path.join(process.env.VITE_PUBLIC, 'icon.png'), // 设置图标
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false, // 允许跨域
            backgroundThrottling: true,    // 主窗口后台时节流，降低 CPU
            spellcheck: false,    // 关闭拼写检查，减少 CPU 开销
            autoplayPolicy: 'no-user-gesture-required'
        },
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) shell.openExternal(url)
        return { action: 'deny' }
    })

    win.on('maximize', () => {
        win.webContents.send('window-maximize-status', true)
    })

    win.on('unmaximize', () => {
        win.webContents.send('window-maximize-status', false)
    })

    win.on('close', (e) => {
        if (tray) {
            e.preventDefault()
            win.hide()
            // 窗口隐藏后立即释放资源，降低后台内存占用
            releaseMemoryOnHide()
        }
    })

    // 窗口重新显示时通知渲染进程恢复资源（重建 analyser 等）
    win.on('show', () => {
        if (_memoryReleaseTimer) {
            clearTimeout(_memoryReleaseTimer)
            _memoryReleaseTimer = null
        }
        win.webContents.send('window-shown-recover')
    })

    // 主窗口拖动/调整大小时暂时隐藏桌面歌词窗口，避免 DWM 反复合成导致闪烁
    let _lyricHideTimer = null
    let _lyricHiddenByMove = false
    const hideLyricOnMove = () => {
        if (!lyricWin) return
        // 每次 move 都重设 debounce timer，确保拖动期间不会过早 show
        if (_lyricHideTimer) clearTimeout(_lyricHideTimer)
        // hide 只执行一次（避免反复 hide/show 闪烁）
        if (!_lyricHiddenByMove && lyricWin.isVisible()) {
            lyricWin.hide()
            _lyricHiddenByMove = true
        }
        _lyricHideTimer = setTimeout(() => {
            if (lyricWin && _lyricHiddenByMove) {
                lyricWin.show()
                _lyricHiddenByMove = false
            }
        }, 300)
    }
    win.on('move', hideLyricOnMove)
    win.on('resize', hideLyricOnMove)

    // 窗口隐藏时主动释放资源，显示时恢复
    let _memoryReleaseTimer = null
    function releaseMemoryOnHide() {
        // 延迟 2 秒执行，避免快速切换时频繁释放/重建
        if (_memoryReleaseTimer) clearTimeout(_memoryReleaseTimer)
        _memoryReleaseTimer = setTimeout(() => {
            try {
                // 1. 清理 session 缓存（图片、CSS、JS 等解码后的资源位图）
                session.defaultSession.clearCache().catch(() => {})
                session.defaultSession.clearStorageData({
                    storages: ['shadercache', 'serviceworkers', 'cachestorage']
                }).catch(() => {})
                // 2. 清理 song-cover 协议的 LRU 缓存（主进程侧）
                ipcMain.emit('clear-cover-cache')
                // 3. 通知渲染进程释放资源（暂停 RAF、清理 Audio 等）
                win.webContents.send('window-hidden-release')
                // 4. 强制 V8 GC（需要 --expose-gc 标志）
                if (typeof global.gc === 'function') {
                    global.gc()
                }
            } catch (e) { /* 静默 */ }
        }, 2000)
    }

    // 接入统一下载管理器
    setDownloadManagerWindow(win)

    // 为 B站/虎牙/斗鱼/Twitch CDN 请求注入 Referer（各平台 CDN 有防盗链）
    // 注意：session.webRequest.onBeforeSendHeaders 多次注册会互相覆盖，必须合并到一次注册中
    session.defaultSession.webRequest.onBeforeSendHeaders(
        {
            urls: [
                'https://*.bilivideo.com/*', 'http://*.bilivideo.com/*',
                'https://*.bilivideo.cn/*', 'http://*.bilivideo.cn/*',
                'https://*.hdslb.com/*', 'http://*.hdslb.com/*',
                // Twitch CDN 域名（usher/playlist/hls）— Twitch CDN 防盗链较宽松，但仍注入 Origin/Referer 以防万一
                'https://*.ttvnw.net/*', 'http://*.ttvnw.net/*',
                'https://*.hls.ttvnw.net/*', 'http://*.hls.ttvnw.net/*',
                // 虎牙 CDN 域名（flv.huya.com / hls.huya.com）
                'https://*.flv.huya.com/*', 'http://*.flv.huya.com/*',
                'https://*.hls.huya.com/*', 'http://*.hls.huya.com/*',
                // 斗鱼 CDN 域名（douyucdn / douyuscdn / hdslb）
                'https://*.douyucdn.com/*', 'http://*.douyucdn.com/*',
                'https://*.douyuscdn.com/*', 'http://*.douyuscdn.com/*',
                'https://*.douyucdn2.com/*', 'http://*.douyucdn2.com/*'
            ]
        },
        (details, callback) => {
            const u = details.url
            if (/bilivideo\.(com|cn)|hdslb\.com/i.test(u)) {
                details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
                if (/bilivideo\.(com|cn)/i.test(u)) {
                    details.requestHeaders['User-Agent'] = PARSE_UA
                }
            } else if (/ttvnw\.net/i.test(u)) {
                // Twitch CDN：注入 Origin 和 Referer
                details.requestHeaders['Origin'] = 'https://www.twitch.tv'
                details.requestHeaders['Referer'] = 'https://www.twitch.tv/'
                details.requestHeaders['User-Agent'] = PARSE_UA
            } else if (/huya\.com/i.test(u)) {
                // 虎牙 CDN：注入 Referer
                details.requestHeaders['Referer'] = 'https://www.huya.com/'
                details.requestHeaders['User-Agent'] = PARSE_UA
            } else if (/douyu(cdn|scdn)?2?\.com/i.test(u)) {
                // 斗鱼 CDN：注入 Referer
                details.requestHeaders['Referer'] = 'https://www.douyu.com/'
                details.requestHeaders['User-Agent'] = PARSE_UA
            }
            callback({ requestHeaders: details.requestHeaders })
        }
    )
}
let lyricWin = null
let isLocked = false

function createLyricWindow() {
    if (lyricWin) return;

    const preloadPath = VITE_DEV_SERVER_URL
        ? path.join(process.env.APP_ROOT, 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.js')

    lyricWin = new BrowserWindow({
        width: 860,
        height: 176,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false,
            backgroundThrottling: false    // 桌面歌词窗口禁止后台节流，保证动画始终流畅
        },
    })

    if (VITE_DEV_SERVER_URL) {
        lyricWin.loadURL(`${VITE_DEV_SERVER_URL}#/desktop-lyrics`)
    } else {
        lyricWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: 'desktop-lyrics' })
    }

    lyricWin.on('closed', () => {
        lyricWin = null
    })

    // 确保窗口准备好后立即同步一次状态
    lyricWin.webContents.on('did-finish-load', () => {
        win.webContents.send('request-lyric-sync')
    })
}

// Global IPC handlers (保持不变)
ipcMain.on('window-minimize', () => {
    const currentWin = BrowserWindow.getFocusedWindow() || win
    currentWin?.minimize()
})

ipcMain.on('window-maximize', () => {
    const currentWin = BrowserWindow.getFocusedWindow() || win
    if (currentWin?.isMaximized()) {
        currentWin?.unmaximize()
    } else {
        currentWin?.maximize()
    }
})

ipcMain.on('window-close', () => {
    const currentWin = BrowserWindow.getFocusedWindow() || win
    currentWin?.close()
})

ipcMain.on('toggle-desktop-lyrics', (_, show) => {
    if (show) {
        if (!lyricWin) createLyricWindow()
        else {
            lyricWin.show()
            lyricWin.setAlwaysOnTop(true, 'screen-saver')
        }
    } else {
        lyricWin?.hide()
    }
})

// 打开本地文件/文件夹路径（下载专区使用）
ipcMain.handle('open-path', async (_, { path: p }) => {
    if (!p) return { success: false, error: '路径为空' }
    try {
        // 如果路径文件不存在，尝试打开其所在目录
        if (!fs.existsSync(p)) {
            const dir = path.dirname(p)
            if (fs.existsSync(dir)) {
                await shell.openPath(dir)
                return { success: true }
            }
            return { success: false, error: '路径不存在' }
        }
        const result = await shell.openPath(p)
        if (result) {
            // openPath 返回非空字符串表示错误
            return { success: false, error: result }
        }
        return { success: true }
    } catch (e) {
        return { success: false, error: e.message }
    }
})

// 扫描字体目录
ipcMain.handle('scan-fonts', async () => {
    // 打包后放置在 resources/font，开发时在项目根目录 /font
    const fontDir = app.isPackaged
        ? path.join(process.resourcesPath, 'font')
        : path.join(process.env.APP_ROOT, 'font')

    if (!fs.existsSync(fontDir)) return []

    const results = []
    const scanDir = (dir) => {
        try {
            const files = fs.readdirSync(dir)
            files.forEach(file => {
                const fullPath = path.join(dir, file)
                if (fs.statSync(fullPath).isDirectory()) {
                    scanDir(fullPath)
                } else if (/\.(ttf|otf|ttc|woff|woff2)$/i.test(file)) {
                    results.push({
                        name: path.basename(file, path.extname(file)),
                        path: fullPath,
                        url: `local-file://${fullPath.replace(/\\/g, '/')}`
                    })
                }
            })
        } catch (e) { }
    }
    scanDir(fontDir)
    return results
})

ipcMain.on('update-lyric-state', (_, data) => {
    lyricWin?.webContents.send('lyric-state-change', data)
})

ipcMain.on('request-lyric-state', () => {
    win?.webContents.send('request-lyric-sync')
})

ipcMain.on('lyric-window-command', (_, cmd) => {
    win?.webContents.send('player-command', cmd)
})

ipcMain.on('lyric-window-lock', (_, { locked }) => {
    if (!lyricWin) return
    isLocked = locked
    if (locked) {
        lyricWin.setMovable(false)
        lyricWin.setIgnoreMouseEvents(true, { forward: true })
    } else {
        lyricWin.setMovable(true)
        lyricWin.setIgnoreMouseEvents(false)
    }
})

// 鼠标悬停检测：动态控制窗口穿透
// 锁定时：鼠标在控制按钮上才接收事件，其余穿透
// 未锁定时：始终接收事件（保证可拖动），不穿透
ipcMain.on('lyric-card-hover', (_, hovering) => {
    if (!lyricWin) return
    if (isLocked) {
        lyricWin.setIgnoreMouseEvents(!hovering, { forward: true })
    }
    // 未锁定时不设置穿透，确保 drag 区域可拖动
})

// 核心递归扫描函数
async function scanAudioFiles(filePath) {
    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
        const files = fs.readdirSync(filePath)
        let results = []
        for (const file of files) {
            results = results.concat(await scanAudioFiles(path.join(filePath, file)))
        }
        return results
    }

    if (AUDIO_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
        try {
            const metadata = await (await getMM()).parseFile(filePath)
            const name = metadata.common.title || path.basename(filePath, path.extname(filePath))
            const artist = metadata.common.artist || '未知歌手'

            const album = metadata.common.album || '本地磁盘'
            const duration = (metadata.format.duration || 0) * 1000
            const formattedPath = filePath.replace(/\\/g, '/')
            const encodedPath = encodeURI(formattedPath)
            return [{
                id: 'local-' + Date.now() + Math.random(),
                name, artist, ar: [{ name: artist }],
                path: filePath,
                url: `local-file:///${encodedPath}`,
                size: stats.size,
                dt: duration,
                duration: duration / 1000,
                al: { name: album, picUrl: `song-cover:///${encodedPath}` }
            }]
        } catch (err) {
            const formattedPath = filePath.replace(/\\/g, '/')
            const encodedPath = encodeURI(formattedPath)
            return [{
                id: 'local-' + Date.now() + Math.random(),
                name: path.basename(filePath, path.extname(filePath)),
                artist: '本地音乐', ar: [{ name: '本地音乐' }],
                path: filePath,
                url: `local-file:///${encodedPath}`,
                size: stats.size, dt: 0, duration: 0,
                // 即使 music-metadata 失败，也走 song-cover 协议（由协议层尝试同目录封面图片查找）
                al: { name: '本地磁盘', picUrl: `song-cover:///${encodedPath}` }
            }]
        }
    }
    return []
}

ipcMain.handle('open-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio Files', extensions: AUDIO_EXTENSIONS.map(ext => ext.replace('.', '')) }]
    })
    if (canceled) return []
    let allSongs = []
    for (const fp of filePaths) {
        allSongs = allSongs.concat(await scanAudioFiles(fp))
    }
    return allSongs
})

ipcMain.handle('open-directory-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return []
    return await scanAudioFiles(filePaths[0])
})

// ── 本地视频扫描 ──
async function scanVideoFiles(filePath) {
    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
        const files = fs.readdirSync(filePath)
        let results = []
        for (const file of files) {
            results = results.concat(await scanVideoFiles(path.join(filePath, file)))
        }
        return results
    }

    const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.ts']
    const ext = path.extname(filePath).toLowerCase()
    if (videoExts.includes(ext)) {
        const formattedPath = filePath.replace(/\\/g, '/')
        const encodedPath = encodeURI(formattedPath)
        // 尝试提取视频时长
        let duration = 0
        try {
            const metadata = await (await getMM()).parseFile(filePath, { duration: true })
            duration = (metadata.format.duration || 0) * 1000
        } catch (e) { /* 忽略解析错误 */ }
        return [{
            id: 'local-video-' + Date.now() + Math.random(),
            name: path.basename(filePath, ext),
            path: filePath,
            url: `local-file:///${encodedPath}`,
            size: stats.size,
            duration: duration,
            format: ext.replace('.', '').toUpperCase(),
            // 封面：复用 song-cover 协议，支持内嵌封面 + 同目录同名图片
            al: { name: '本地视频', picUrl: `song-cover:///${encodedPath}` }
        }]
    }
    return []
}

ipcMain.handle('open-video-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts'] }]
    })
    if (canceled) return []
    let allVideos = []
    for (const fp of filePaths) {
        allVideos = allVideos.concat(await scanVideoFiles(fp))
    }
    return allVideos
})

ipcMain.handle('open-video-directory-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return []
    return await scanVideoFiles(filePaths[0])
})

ipcMain.handle('save-lyric', async (_, { songPath, lyricContent }) => {
    try {
        const lyricPath = songPath.replace(path.extname(songPath), '.lrc')
        fs.writeFileSync(lyricPath, lyricContent, 'utf8')
        return { success: true, path: lyricPath }
    } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('load-local-lyric', async (_, songPath) => {
    try {
        const lyricPath = songPath.replace(path.extname(songPath), '.lrc')
        if (fs.existsSync(lyricPath)) {
            return { success: true, lyric: fs.readFileSync(lyricPath, 'utf8') }
        }
        return { success: false, error: 'No local lyric file found' }
    } catch (err) { return { success: false, error: err.message } }
})

// 多平台歌词搜索（本地歌曲用）：QQ + 酷狗
ipcMain.handle('search-multi-lyric', async (_, { songName, artist }) => {
    try {
        return await searchMultiPlatform(songName, artist)
    } catch (err) {
        return { qq: [], kugou: [], errors: { qq: err.message, kugou: err.message } }
    }
})

// 按候选获取歌词（本地歌曲用户选中后调用）
ipcMain.handle('fetch-lyric-by-candidate', async (_, candidate) => {
    try {
        return await fetchLyricByCandidate(candidate)
    } catch (err) {
        return { lrc: '', yrc: '', trans: '' }
    }
})

// 线上歌曲用：QQ 音乐歌词获取（匹配作者+歌名+时长，不一致返回 matched:false）
ipcMain.handle('get-qq-lyric', async (_, { songName, artist, duration }) => {
    try {
        return await searchAndFetchQQ(songName, artist, duration)
    } catch (err) {
        return { matched: false, error: err.message }
    }
})

// 保存英文解析缓存（本地歌曲旁边存 .analysis.json）
ipcMain.handle('save-english-analysis', async (_, { songPath, analysis }) => {
    try {
        const cachePath = songPath.replace(path.extname(songPath), '.analysis.json')
        fs.writeFileSync(cachePath, JSON.stringify(analysis, null, 2), 'utf8')
        return { success: true, path: cachePath }
    } catch (err) { return { success: false, error: err.message } }
})

// 加载英文解析缓存
ipcMain.handle('load-english-analysis', async (_, songPath) => {
    try {
        const cachePath = songPath.replace(path.extname(songPath), '.analysis.json')
        if (fs.existsSync(cachePath)) {
            const data = fs.readFileSync(cachePath, 'utf8')
            return { success: true, analysis: JSON.parse(data), path: cachePath }
        }
        return { success: false, error: 'No cached analysis found' }
    } catch (err) { return { success: false, error: err.message } }
})

// 保存在线歌曲歌词到本地缓存（支持离线使用）
ipcMain.handle('save-online-lyric', async (_, { songId, songName, artist, lrc, tlrc }) => {
    try {
        // 使用 app.getPath('userData') 获取用户数据目录
        const lyricsDir = path.join(app.getPath('userData'), 'lyrics_cache')
        if (!fs.existsSync(lyricsDir)) {
            fs.mkdirSync(lyricsDir, { recursive: true })
        }
        
        // 文件名格式：{songId}_{songName}.lrc
        const safeName = songName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)
        const fileName = `${songId}_${safeName}.lrc`
        const filePath = path.join(lyricsDir, fileName)
        
        // 保存歌词（包含原文和翻译）
        let content = lrc || ''
        if (tlrc) {
            content += '\n---trans---\n' + tlrc
        }
        
        // 添加元数据头部
        const meta = [
            `[ti:${songName}]`,
            `[ar:${artist}]`,
            `[id:${songId}]`,
            `[saved:${new Date().toISOString()}]`,
            ''
        ].join('\n')
        
        fs.writeFileSync(filePath, meta + content, 'utf8')
        console.log(`[LyricCache] 已保存歌词: ${fileName}`)
        return { success: true, path: filePath }
    } catch (err) { 
        console.error('[LyricCache] 保存失败:', err)
        return { success: false, error: err.message } 
    }
})

// 加载本地缓存的在线歌词
ipcMain.handle('load-online-lyric-cache', async (_, songId) => {
    try {
        const lyricsDir = path.join(app.getPath('userData'), 'lyrics_cache')
        
        if (!fs.existsSync(lyricsDir)) {
            return { success: false, error: 'No cache directory' }
        }
        
        // 查找匹配的文件
        const files = fs.readdirSync(lyricsDir).filter(f => f.startsWith(songId + '_') && f.endsWith('.lrc'))
        
        if (files.length === 0) {
            return { success: false, error: 'No cached lyric found' }
        }
        
        const filePath = path.join(lyricsDir, files[0])
        const content = fs.readFileSync(filePath, 'utf8')
        
        return { success: true, lyric: content, path: filePath }
    } catch (err) { 
        return { success: false, error: err.message } 
    }
})

// 保存在线歌曲英文解析到本地（支持离线使用）
ipcMain.handle('save-online-english-analysis', async (_, { songId, songName, artist, analysis }) => {
    try {
        const analysisDir = path.join(app.getPath('userData'), 'analysis_cache')
        if (!fs.existsSync(analysisDir)) {
            fs.mkdirSync(analysisDir, { recursive: true })
        }
        
        const safeName = songName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)
        const fileName = `${songId}_${safeName}.analysis.json`
        const filePath = path.join(analysisDir, fileName)
        
        fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2), 'utf8')
        console.log(`[AnalysisCache] 已保存解析: ${fileName}`)
        return { success: true, path: filePath }
    } catch (err) { 
        console.error('[AnalysisCache] 保存失败:', err)
        return { success: false, error: err.message } 
    }
})

// 加载本地缓存的在线歌曲英文解析
ipcMain.handle('load-online-english-analysis', async (_, songId) => {
    try {
        const analysisDir = path.join(app.getPath('userData'), 'analysis_cache')
        
        if (!fs.existsSync(analysisDir)) {
            return { success: false, error: 'No cache directory' }
        }
        
        const files = fs.readdirSync(analysisDir).filter(f => f.startsWith(songId + '_') && f.endsWith('.analysis.json'))
        
        if (files.length === 0) {
            return { success: false, error: 'No cached analysis found' }
        }
        
        const filePath = path.join(analysisDir, files[0])
        const data = fs.readFileSync(filePath, 'utf8')
        
        return { success: true, analysis: JSON.parse(data), path: filePath }
    } catch (err) { 
        return { success: false, error: err.message } 
    }
})

// 窗口全屏控制
ipcMain.handle('set-window-fullscreen', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
        win.setFullScreen(true)
        return { success: true }
    }
    return { success: false, error: 'No focused window' }
})

ipcMain.handle('exit-window-fullscreen', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
        win.setFullScreen(false)
        return { success: true }
    }
    return { success: false, error: 'No focused window' }
})

// 查找本地 MV 视频文件
ipcMain.handle('find-local-mv', async (_, { songName, songPath, mvDir }) => {
    const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv']
    const searchDirs = []

    // 1. 歌曲所在目录
    if (songPath && fs.existsSync(songPath)) {
        const dir = path.dirname(songPath)
        if (!searchDirs.includes(dir)) searchDirs.push(dir)
    }

    // 2. 用户配置的 MV 目录
    if (mvDir && fs.existsSync(mvDir)) {
        if (!searchDirs.includes(mvDir)) searchDirs.push(mvDir)
    }

    // 3. 歌曲目录下的 mv 子目录
    if (songPath) {
        const songDir = path.dirname(songPath)
        const subMvDir = path.join(songDir, 'mv')
        if (fs.existsSync(subMvDir) && !searchDirs.includes(subMvDir)) {
            searchDirs.push(subMvDir)
        }
    }

    // 清理歌曲名用于匹配：移除括号内容、特殊字符
    const cleanName = (str) => str.replace(/[\\/:*?"<>|]/g, '').trim()

    const targetName = cleanName(songName).toLowerCase()

    for (const dir of searchDirs) {
        try {
            const files = fs.readdirSync(dir)
            for (const file of files) {
                const ext = path.extname(file).toLowerCase()
                if (!videoExts.includes(ext)) continue

                const fileName = cleanName(path.basename(file, ext)).toLowerCase()

                // 精确匹配或包含匹配
                if (fileName === targetName || fileName.includes(targetName) || targetName.includes(fileName)) {
                    const fullPath = path.join(dir, file)
                    const formattedPath = fullPath.replace(/\\/g, '/')
                    const encodedPath = encodeURI(formattedPath)
                    return {
                        success: true,
                        path: fullPath,
                        url: `local-file:///${encodedPath}`,
                        name: file
                    }
                }
            }
        } catch (e) {
            // 跳过无法访问的目录
        }
    }

    return { success: false, error: '未找到匹配的MV视频文件' }
})

// ============================================================
// 视频下载 —— 委托给统一下载管理器（download-manager.js）
// 旧 IPC 保留兼容，实际逻辑由 download-manager 处理：
// - aria2c 多线程直链下载（16 连接）
// - ffmpeg m3u8 合并
// - 本地文件复制
// - 统一历史记录 + 速度/进度事件
// ============================================================
ipcMain.handle('video-download', async (_, { url, name, headers, type, category, audioUrl }) => {
    // 委托给统一下载管理器，category 由调用方指定（mv/movie/anime/video），默认 video
    // audioUrl: DASH 音视频分离时，下载后由 ffmpeg 流复制合并（B站高画质，极快）
    return delegateStartDownload({ url, name, headers, type, category: category || 'video', audioUrl })
})

ipcMain.handle('video-download-cancel', async (_, { downloadId }) => {
    return delegateCancelDownload(downloadId)
})

// ===== 网址视频流解析 =====
// 输入一个网页地址，抓取页面并提取其中的视频流（m3u8/mp4/iframe播放器）
// 返回 { success, streams: [{url, type, title}], pageUrl }
const PARSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ===== B站直播解析 =====
// 输入直播间地址（live.bilibili.com/xxx），调用官方 API 获取直播流（flv/hls）
async function parseBilibiliLive(target, addStream) {
    let roomId = ''
    // 提取房间号：live.bilibili.com/1883358196 或带参数
    const m = target.match(/live\.bilibili\.com\/(\d+)/i)
    if (m) roomId = m[1]
    if (!roomId) return null
    try {
        const biliCookies = loadBiliCookie()
        const headers = { 'User-Agent': PARSE_UA, 'Referer': 'https://live.bilibili.com/' }
        if (biliCookies && biliCookies.SESSDATA) headers['Cookie'] = biliCookieString(biliCookies)
        // 获取房间真实 ID + 直播流
        const api = `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=16`
        const res = await axios.get(api, { headers, timeout: 15000, validateStatus: () => true })
        if (res.status !== 200 || res.data?.code !== 0) return null
        const playurl = res.data?.data?.playurl_info?.playurl
        if (!playurl?.stream) return null
        const title = res.data?.data?.room_info?.title || `B站直播 ${roomId}`
        let added = 0
        for (const stream of playurl.stream) {
            const proto = stream.protocol_name  // http_hls / http_flv
            for (const fmt of (stream.format || [])) {
                for (const codec of (fmt.codec || [])) {
                    // url_list 是完整地址（flv 直链）
                    for (const u of (codec.url_list || [])) {
                        if (!u) continue
                        const type = /hls|ts|m3u8/i.test(proto) || /\.m3u8/i.test(u) ? 'm3u8'
                            : (/flv/i.test(proto) || /\.flv/i.test(u) ? 'flv' : 'live')
                        addStream(u, type, `${title} (${proto}/${fmt.format_name}/${codec.codec_name})`)
                        added++
                    }
                    // base_url + url_info 拼接（HLS 的 base_url 是 .m3u8 相对路径）
                    if (codec.base_url && codec.url_info?.length) {
                        const info = codec.url_info[0]
                        const fullUrl = (info.host || '') + codec.base_url + (info.extra || '')
                        if (/^https?:\/\//.test(fullUrl)) {
                            const type = /\.m3u8/i.test(codec.base_url) ? 'm3u8'
                                : (/\.flv/i.test(codec.base_url) ? 'flv' : 'live')
                            addStream(fullUrl, type, `${title} (${proto}/${fmt.format_name}/${codec.codec_name})`)
                            added++
                        }
                    }
                }
            }
        }
        return added > 0 ? { title } : null
    } catch (e) {
        return null
    }
}

// ===== 快手视频解析 =====
// 快手短视频页面 SSR 包含 window.__APOLLO_STATE__，实际格式为：
//   window.__APOLLO_STATE__={...};(function(){...}());</script>
// 注意结尾不是直接 </script>，需要更宽松的正则；当前页面 __APOLLO_STATE__ 仅含 UI 配置，
// 视频数据需由前端 JS 动态拉取。所以同时尝试：
//   1) HTML SSR 提取（兼容老版本页面）
//   2) 隐藏 BrowserWindow 渲染后从 DOM/网络请求抓取视频地址（兼容新版页面）
async function parseKuaishou(target, addStream) {
    let title = ''
    let added = 0
    try {
        const res = await axios.get(target, {
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': 'https://www.kuaishou.com/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            responseType: 'text',
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 5
        })
        const html = res.data || ''
        if (html) {
            const tm = html.match(/<title>([^<]*)<\/title>/i)
            if (tm) title = tm[1].replace(/ - 快手.*$/, '').trim()
            // 提取 __APOLLO_STATE__：兼容 `;(function(){...}());</script>` 结尾
            let apollo = null
            const m1 = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/)
            if (m1) {
                try { apollo = JSON.parse(m1[1]) } catch (e) {}
            }
            // 兜底：用括号平衡匹配
            if (!apollo) {
                const idx = html.indexOf('__APOLLO_STATE__')
                if (idx >= 0) {
                    const start = html.indexOf('{', idx)
                    if (start > 0) {
                        let depth = 0, inStr = false, esc = false, quote = '', end = -1
                        for (let i = start; i < html.length; i++) {
                            const c = html[i]
                            if (esc) { esc = false; continue }
                            if (inStr) {
                                if (c === '\\') esc = true
                                else if (c === quote) inStr = false
                            } else {
                                if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c }
                                else if (c === '{') depth++
                                else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
                            }
                        }
                        if (end > 0) {
                            try { apollo = JSON.parse(html.slice(start, end + 1)) } catch (e) {}
                        }
                    }
                }
            }
            // 提取 __INITIAL_STATE__
            let initState = null
            const m2 = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/)
            if (m2) {
                try { initState = JSON.parse(m2[1]) } catch (e) {}
            }
            const tryAdd = (obj, depth) => {
                if (!obj || typeof obj !== 'object' || depth > 8) return
                if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.url)) {
                    const u = obj.url.replace(/\\\//g, '/')
                    // 排除快手 UI 资源图片
                    if (!/\.png|\.jpg|\.svg|\.webp/i.test(u)) {
                        const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
                        addStream(u, type, title)
                        added++
                    }
                }
                if (typeof obj.mainMvUrls === 'object' && Array.isArray(obj.mainMvUrls)) {
                    for (const item of obj.mainMvUrls) {
                        if (item?.url) tryAdd(item, depth + 1)
                    }
                }
                if (typeof obj.playUrl === 'string' && /^https?:\/\//.test(obj.playUrl)) tryAdd({ url: obj.playUrl }, depth + 1)
                if (typeof obj.photoUrl === 'string' && /^https?:\/\//.test(obj.photoUrl)) tryAdd({ url: obj.photoUrl }, depth + 1)
                for (const k of Object.keys(obj)) {
                    if (['url', 'mainMvUrls', 'playUrl', 'photoUrl'].includes(k)) continue
                    const v = obj[k]
                    if (v && typeof v === 'object') tryAdd(v, depth + 1)
                }
            }
            if (apollo) tryAdd(apollo, 0)
            if (initState) tryAdd(initState, 0)
            // 兜底：正则提取 mp4/m3u8 直链（排除 UI 资源）
            if (added === 0) {
                const vm = html.match(/"(https?:\/\/[^"]*(?:kwai|kwaixia|gifshow|ksv|kscube|kslive)[^"]*\.(?:mp4|m3u8|flv)[^"]*)"/i)
                if (vm) { addStream(vm[1].replace(/\\\//g, '/'), /\.m3u8/i.test(vm[1]) ? 'm3u8' : 'mp4', title); added++ }
            }
        }
    } catch (e) {}

    // SSR 没抓到 → 用隐藏 BrowserWindow 渲染后抓取
    if (added === 0) {
        const renderResult = await parseByHiddenWindow(target, 'kuaishou')
        if (renderResult?.title && !title) title = renderResult.title
        for (const s of (renderResult?.streams || [])) {
            addStream(s.url, s.type, title || renderResult.title)
            added++
        }
    }
    return added > 0 ? { title } : null
}

// ===== 抖音视频解析 =====
// 抖音页面已全面 JS 渲染，HTML 中无 _ROUTER_DATA/RENDER_DATA 等任何 SSR 视频数据。
// 官方 detail API 需要 X-Bogus/a_bogus 签名（算法复杂且经常变动），纯 Node 难以稳定实现。
// 因此 SSR 提取失败后，直接走隐藏 BrowserWindow 渲染方案（让 Chromium 完整执行 JS 后抓取 video src）。
async function parseDouyin(target, addStream) {
    let title = ''
    let added = 0
    try {
        // 先跟随短链接跳转，拿到真实 URL（提取 aweme_id 并获取页面标题）
        const res = await axios.get(target, {
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': 'https://www.douyin.com/',
                'Cookie': 'msToken=abcdef0123456789; ttwid=1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            responseType: 'text',
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 10
        })
        const html = res.data || ''
        if (html) {
            const tm = html.match(/<title>([^<]*)<\/title>/i)
            if (tm) title = tm[1].replace(/ - 抖音.*$/, '').replace(/【.*?】/g, '').trim()
            // 兼容旧版页面：尝试 _ROUTER_DATA / RENDER_DATA
            let routerData = null
            const m1 = html.match(/<script[^>]*id="_ROUTER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
            if (m1) {
                try { routerData = JSON.parse(m1[1].trim()) } catch (e) {}
            }
            if (!routerData) {
                const m2 = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
                if (m2) {
                    try { routerData = JSON.parse(decodeURIComponent(m2[1].trim())) } catch (e) {}
                }
            }
            const tryAdd = (obj, depth) => {
                if (!obj || typeof obj !== 'object' || depth > 8) return
                if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.url)) {
                    const u = obj.url.replace(/\\\//g, '/')
                    const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
                    addStream(u, type, title)
                    added++
                }
                if (Array.isArray(obj.url_list)) {
                    for (const u of obj.url_list) {
                        if (typeof u === 'string' && /^https?:\/\//.test(u)) tryAdd({ url: u }, depth + 1)
                    }
                }
                if (typeof obj.play_addr === 'object') tryAdd(obj.play_addr, depth + 1)
                if (typeof obj.playApi === 'string' && /^https?:\/\//.test(obj.playApi)) tryAdd({ url: obj.playApi }, depth + 1)
                for (const k of Object.keys(obj)) {
                    if (['url', 'url_list', 'play_addr', 'playApi'].includes(k)) continue
                    const v = obj[k]
                    if (v && typeof v === 'object') tryAdd(v, depth + 1)
                }
            }
            if (routerData) tryAdd(routerData, 0)
            // 兜底：正则提取直链
            if (added === 0) {
                const vm = html.match(/"(https?:\/\/[^"]*(?:douyinvod|douyin\.com|bytecdn|bytedance|ixigua)[^"]*\.(?:mp4|m3u8)[^"]*)"/i)
                if (vm) { addStream(vm[1].replace(/\\\//g, '/'), 'mp4', title); added++ }
                if (added === 0) {
                    const vm2 = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/i)
                    if (vm2) { addStream(vm2[1].replace(/\\\//g, '/'), 'mp4', title); added++ }
                }
            }
        }
    } catch (e) {}

    // SSR 没抓到 → 用隐藏 BrowserWindow 渲染后抓取（这是抖音唯一可靠的解析路径）
    if (added === 0) {
        const renderResult = await parseByHiddenWindow(target, 'douyin')
        if (renderResult?.title && !title) title = renderResult.title
        for (const s of (renderResult?.streams || [])) {
            addStream(s.url, s.type, title || renderResult.title)
            added++
        }
    }
    return added > 0 ? { title } : null
}

// ===== 基于 BrowserWindow 的渲染解析（通用）=====
// 用隐藏窗口加载页面，等 JS 完整渲染后从 <video> DOM 元素和网络请求中提取视频地址。
// 适用于抖音、快手等完全 JS 渲染的页面，绕过 X-Bogus 签名问题。
//
// 核心策略（解决"抓到红包广告"问题）：
//   1. 网络层：只收集来自已知视频 CDN 域名的请求（douyinvod/bytecdn/kwaixia 等），
//      广告通常来自不同域名，直接被过滤
//   2. DOM 层：优先选择页面中尺寸最大的 <video> 元素（主视频远大于广告），
//      跳过 blob: URL（MSE 流无法直接用）
//   3. 自动播放：静音播放视频以触发视频流网络请求
//   4. 排序：DOM 主视频 > CDN 网络请求 > 全局对象 > 性能接口
async function parseByHiddenWindow(target, source) {
    return new Promise((resolve) => {
        let bw = null
        let settled = false
        const networkUrls = []  // 监听到的视频流 URL（按域名过滤，有序）

        // 已知视频 CDN 域名正则（只收集这些域名的请求，排除广告）
        const cdnPattern = source === 'douyin'
            ? /douyinvod\.com|bytecdn\.cn|bytedance\.com|ixigua\.com|byteimg\.com|douyinstatic/i
            : /kwaixia\.com|kwai\.com|gifshow\.com|kwimgs\.com|kwaicdn\.com|kscube\.com|ksapisrc\.com/i

        const finish = (result) => {
            if (settled) return
            settled = true
            try { if (bw) { bw.destroy(); bw = null } } catch (e) {}
            resolve(result)
        }
        // 超时保护：35 秒
        const timer = setTimeout(() => {
            finish({ streams: [], title: '', timeout: true })
        }, 35000)

        try {
            bw = new BrowserWindow({
                width: 1280, height: 800,
                show: false,
                frame: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false,
                    webSecurity: false,
                    images: false,
                    // 允许自动播放，这样页面加载后视频会自动开始播放，触发视频流请求
                    autoplayPolicy: 'no-user-gesture-required',
                    // 使用独立 partition，避免覆盖主窗口 defaultSession 的 webRequest 处理器
                    partition: 'temp-parser'
                }
            })

            // === 网络请求监听：只收集来自已知 CDN 域名的视频流 ===
            // 用 onBeforeRequest + URL filter 粗筛，listener 中再用 cdnPattern 精筛
            bw.webContents.session.webRequest.onBeforeRequest(
                { urls: ['*://*/*.mp4*', '*://*/*.m3u8*', '*://*/*.flv*'] },
                (details, cb) => {
                    const u = details.url
                    // 只收集来自已知视频 CDN 域名的请求，排除广告
                    if (u && cdnPattern.test(u)) {
                        networkUrls.push(u)
                    }
                    cb({})
                }
            )

            // === 注入 Referer（针对抖音/快手 CDN）===
            const refererHost = source === 'douyin' ? 'https://www.douyin.com/' : 'https://www.kuaishou.com/'
            bw.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
                const u = details.url
                if (cdnPattern.test(u) || /douyin\.com|iesdouyin\.com|kuaishou\.com/i.test(u)) {
                    details.requestHeaders['Referer'] = refererHost
                    details.requestHeaders['User-Agent'] = PARSE_UA
                }
                cb({ requestHeaders: details.requestHeaders })
            })

            bw.webContents.on('did-finish-load', () => {
                // 自动静音播放视频，触发视频流网络请求
                bw.webContents.executeJavaScript(`
                    try {
                        const videos = document.querySelectorAll('video');
                        for (const v of videos) {
                            v.muted = true;
                            v.play().catch(() => {});
                        }
                        // 尝试点击播放按钮（抖音/快手播放器）
                        const playBtns = document.querySelectorAll('[class*="play-btn"], [class*="PlayBtn"], [class*="xgplayer-start"], [class*="start-play"]');
                        for (const btn of playBtns) {
                            try { btn.click(); } catch (e) {}
                        }
                    } catch (e) {}
                `).catch(() => {})

                // 等待 SPA 渲染完成（多轮检查，每轮 1.5 秒，最多 18 秒）
                let attempts = 0
                const maxAttempts = 12
                const checkInterval = setInterval(async () => {
                    attempts++
                    try {
                        const result = await bw.webContents.executeJavaScript(`
                            (function() {
                                const out = { streams: [], title: document.title || '' };

                                // 1. 从 <video> 元素抓取 —— 只选主视频（尺寸最大的）
                                const videos = document.querySelectorAll('video');
                                let mainVideoSrc = '';
                                let mainVideoSize = 0;
                                for (const v of videos) {
                                    const src = v.src || v.currentSrc || '';
                                    // 跳过 blob: URL（MSE 流，无法直接用）
                                    if (!src || src.startsWith('blob:')) continue;
                                    if (!/^https?:\\/\\//.test(src)) continue;
                                    // 计算视频元素尺寸，选最大的（主视频远大于广告）
                                    const rect = v.getBoundingClientRect();
                                    const size = rect.width * rect.height;
                                    // 优先选择正在播放的、尺寸最大的视频
                                    if (size > mainVideoSize || (!v.paused && size >= mainVideoSize)) {
                                        mainVideoSize = size;
                                        mainVideoSrc = src;
                                    }
                                }
                                if (mainVideoSrc) {
                                    out.streams.push({
                                        url: mainVideoSrc,
                                        type: /\\.m3u8/i.test(mainVideoSrc) ? 'm3u8' : (/\\.flv/i.test(mainVideoSrc) ? 'flv' : 'mp4'),
                                        source: 'dom'
                                    });
                                }

                                // 2. 抖音专用：从全局对象抓取 play_addr（深度遍历）
                                try {
                                    const objs = [];
                                    if (window._ROUTER_DATA) objs.push(window._ROUTER_DATA);
                                    if (window.__INITIAL_STATE__) objs.push(window.__INITIAL_STATE__);
                                    if (window.__NEXT_DATA__) objs.push(window.__NEXT_DATA__);
                                    const seen = new Set();
                                    const walk = (o, d) => {
                                        if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return;
                                        seen.add(o);
                                        if (Array.isArray(o.url_list)) {
                                            for (const u of o.url_list) {
                                                if (typeof u === 'string' && /^https?:\\/\\//.test(u)) {
                                                    out.streams.push({
                                                        url: u.replace(/\\\\\\//g, '/'),
                                                        type: /\\.m3u8/i.test(u) ? 'm3u8' : 'mp4',
                                                        source: 'global'
                                                    });
                                                }
                                            }
                                        }
                                        if (typeof o.playApi === 'string' && /^https?:\\/\\//.test(o.playApi)) {
                                            out.streams.push({ url: o.playApi, type: 'mp4', source: 'global' });
                                        }
                                        for (const k in o) {
                                            try { walk(o[k], d + 1); } catch (e) {}
                                        }
                                    };
                                    objs.forEach(o => walk(o, 0));
                                } catch (e) {}

                                // 3. 快手专用：从 __APOLLO_STATE__ 抓取
                                try {
                                    if (window.__APOLLO_STATE__) {
                                        const seen = new Set();
                                        const walk = (o, d) => {
                                            if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return;
                                            seen.add(o);
                                            if (typeof o.url === 'string' && /^https?:\\/\\//.test(o.url) && /\\.(mp4|m3u8|flv)(\\?|$|#)/i.test(o.url)) {
                                                out.streams.push({
                                                    url: o.url.replace(/\\\\\\//g, '/'),
                                                    type: /\\.m3u8/i.test(o.url) ? 'm3u8' : 'mp4',
                                                    source: 'global'
                                                });
                                            }
                                            if (typeof o.photoUrl === 'string' && /^https?:\\/\\//.test(o.photoUrl)) {
                                                out.streams.push({ url: o.photoUrl, type: 'mp4', source: 'global' });
                                            }
                                            if (typeof o.playUrl === 'string' && /^https?:\\/\\//.test(o.playUrl)) {
                                                out.streams.push({ url: o.playUrl, type: 'mp4', source: 'global' });
                                            }
                                            for (const k in o) {
                                                try { walk(o[k], d + 1); } catch (e) {}
                                            }
                                        };
                                        walk(window.__APOLLO_STATE__, 0);
                                    }
                                } catch (e) {}

                                // 去重
                                const seen = new Set();
                                out.streams = out.streams.filter(s => {
                                    if (seen.has(s.url)) return false;
                                    seen.add(s.url);
                                    return true;
                                });
                                return out;
                            })()
                        `)

                        // 合并网络请求中捕获的 URL（已按 CDN 域名过滤）
                        for (const u of networkUrls) {
                            if (!result.streams.find(s => s.url === u)) {
                                result.streams.push({
                                    url: u,
                                    type: /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4'),
                                    source: 'network'
                                })
                            }
                        }

                        // === 最终过滤：只保留来自已知 CDN 域名的 URL ===
                        // 这一步确保 DOM/全局对象抓取的 URL 也经过 CDN 域名过滤，排除广告
                        result.streams = result.streams.filter(s => cdnPattern.test(s.url))

                        // === 排序：DOM 主视频优先 > 网络请求 > 全局对象 ===
                        const priority = { dom: 0, network: 1, global: 2 }
                        result.streams.sort((a, b) => {
                            const pa = priority[a.source] ?? 9
                            const pb = priority[b.source] ?? 9
                            if (pa !== pb) return pa - pb
                            // 同来源按 URL 长度降序（主视频 URL 通常更长，包含更多参数）
                            return b.url.length - a.url.length
                        })

                        if (result.streams.length > 0 || attempts >= maxAttempts) {
                            clearInterval(checkInterval)
                            clearTimeout(timer)
                            // 清理 source 字段
                            result.streams = result.streams.map(s => ({ url: s.url, type: s.type }))
                            finish(result)
                        }
                    } catch (e) {
                        // executeJavaScript 失败：可能页面正在跳转，等下一轮
                    }
                }, 1500)
            })

            bw.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
                if (errorCode !== -3 && errorCode !== 0) {  // -3 是中断，0 是成功
                    clearTimeout(timer)
                    finish({ streams: [], title: '', error: errorDescription || `load failed (${errorCode})` })
                }
            })

            // 加载目标 URL
            bw.loadURL(target, { userAgent: PARSE_UA })
        } catch (e) {
            clearTimeout(timer)
            finish({ streams: [], title: '', error: e.message })
        }
    })
}

// ===== B站专用解析 =====
// 从 URL 提取 BV 号（支持 bilibili.com/video/BVxxx、b23.tv 短链、av 号）
async function extractBvid(target) {
    // 直接匹配 BV 号
    let m = target.match(/\/video\/(BV\w+)/i)
    if (m) return m[1]
    // 匹配 av 号 → 需要后续转 BV
    m = target.match(/\/video\/av(\d+)/i)
    if (m) return { aid: m[1] }
    // b23.tv 短链：跟随重定向获取最终 URL
    if (/b23\.tv/i.test(target)) {
        try {
            let current = target
            for (let i = 0; i < 5; i++) {
                const r = await axios.get(current, { maxRedirects: 0, validateStatus: () => true, timeout: 10000, headers: { 'User-Agent': PARSE_UA } })
                if (r.status >= 300 && r.status < 400 && r.headers.location) {
                    current = r.headers.location
                    const bm = current.match(/\/video\/(BV\w+)/i)
                    if (bm) return bm[1]
                } else { break }
            }
        } catch (e) {}
    }
    return null
}

// 调用 B站 API 解析视频流
async function parseBilibili(target, addStream) {
    const bvidInfo = await extractBvid(target)
    if (!bvidInfo) return null

    // 带上已登录的 Cookie（提升画质，大会员可解锁 4K/1080P+）
    const biliCookies = loadBiliCookie()
    const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
    const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
    if (isLoggedIn) {
        biliHeaders['Cookie'] = biliCookieString(biliCookies)
    }
    let bvid = null

    // av 号转 BV 号
    if (typeof bvidInfo === 'object' && bvidInfo.aid) {
        try {
            const r = await axios.get(`https://api.bilibili.com/x/web-interface/view?id=${bvidInfo.aid}`, { headers: biliHeaders, timeout: 10000 })
            if (r.data?.code === 0) bvid = r.data.data.bvid
        } catch (e) { return null }
    } else {
        bvid = bvidInfo
    }
    if (!bvid) return null

    // 获取视频信息（cid、标题、封面）
    let viewData
    try {
        const r = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: biliHeaders, timeout: 10000 })
        if (r.data?.code !== 0) return null
        viewData = r.data.data
    } catch (e) { return null }

    const { cid, title } = viewData
    const pageTitle = title
    const qualityMap = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P' }
    const loggedInfo = isLoggedIn ? '（已登录）' : '（未登录·仅低画质）'
    let addedAny = false

    // === 1. 登录后优先尝试 DASH 格式（fnval=16），可获取 4K/1080P+ 高画质（音视频分离）===
    // B站对 durl(fnval=1) 限制了高画质，登录用户的高画质必须走 DASH（音视频分离）
    // 下载时由下载管理器自动用 ffmpeg 合并 video+audio 成有声 mp4
    if (isLoggedIn) {
        try {
            const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
                params: { bvid, cid, qn: 127, fnval: 16, fourk: 1 },
                headers: biliHeaders,
                timeout: 10000
            })
            if (r.data?.code === 0 && r.data.data?.dash) {
                const dash = r.data.data.dash
                // 取最高音质的 audio（按 id 降序），下载时与 video 合并
                const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                const bestAudio = audios[0]
                const audioUrl = bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : ''
                // 视频流按 id 降序（高画质在前），同时去重相同 id（不同码率备份）
                const videos = (dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                const seenQ = new Set()
                videos.forEach(v => {
                    if (seenQ.has(v.id)) return
                    seenQ.add(v.id)
                    const qLabel = qualityMap[v.id] || `${v.id}P`
                    addStream(v.baseUrl || v.base_url, 'mp4', `${title} [${qLabel} 高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
                    addedAny = true
                })
            }
        } catch (e) {}
    }

    // === 2. 请求 durl 格式（fnval=1），完整音视频流（有声，画质取决于登录状态）===
    try {
        const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
            params: { bvid, cid, qn: 127, fnval: 1, fourk: 1 },
            headers: biliHeaders,
            timeout: 10000
        })
        if (r.data?.code === 0 && r.data.data?.durl) {
            const durl = r.data.data.durl
            const quality = r.data.data.quality
            const qLabel = qualityMap[quality] || `${quality}P`
            durl.forEach((d, i) => {
                const partTitle = durl.length > 1
                    ? `${title} - 第${i + 1}段/共${durl.length}段 [${qLabel} 完整·有声]${loggedInfo}`
                    : `${title} [${qLabel} 完整·有声]${loggedInfo}`
                addStream(d.url, 'mp4', partTitle, { bili: true })
            })
            addedAny = true
        }
    } catch (e) {}

    // === 3. 降级：尝试不同清晰度的 durl ===
    if (!addedAny) {
        for (const qn of [80, 64, 32, 16]) {
            try {
                const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
                    params: { bvid, cid, qn, fnval: 1, fourk: 0 },
                    headers: biliHeaders,
                    timeout: 10000
                })
                if (r.data?.code === 0 && r.data.data?.durl) {
                    const durl = r.data.data.durl
                    const quality = r.data.data.quality
                    const qLabel = qualityMap[quality] || `${quality}P`
                    durl.forEach((d, i) => {
                        const partTitle = durl.length > 1
                            ? `${title} - 第${i + 1}段/共${durl.length}段 [${qLabel}]${loggedInfo}`
                            : `${title} [${qLabel}]${loggedInfo}`
                        addStream(d.url, 'mp4', partTitle, { bili: true })
                    })
                    addedAny = true
                    break
                }
            } catch (e) {}
        }
    }

    return addedAny ? { title: pageTitle } : null
}

// ===== B站番剧/电影解析 =====
// 番剧/电影 URL 格式：
//   https://www.bilibili.com/bangumi/play/ep737427/   (ep_id)
//   https://www.bilibili.com/bangumi/play/ss12956/    (season_id)
// 走 /pgc/ API 域名，与普通视频 /x/ 不同；返回字段为 result（普通视频是 data）
// 提取番剧 ep_id 或 season_id（含 b23.tv 短链跳转）
async function extractBangumiId(target) {
    let m = target.match(/\/bangumi\/play\/ep(\d+)/i)
    if (m) return { epId: m[1] }
    m = target.match(/\/bangumi\/play\/ss(\d+)/i)
    if (m) return { seasonId: m[1] }
    // b23.tv 短链：跟随重定向获取最终 URL
    if (/b23\.tv/i.test(target)) {
        try {
            let current = target
            for (let i = 0; i < 5; i++) {
                const r = await axios.get(current, { maxRedirects: 0, validateStatus: () => true, timeout: 10000, headers: { 'User-Agent': PARSE_UA } })
                if (r.status >= 300 && r.status < 400 && r.headers.location) {
                    current = r.headers.location
                    const em = current.match(/\/bangumi\/play\/ep(\d+)/i)
                    if (em) return { epId: em[1] }
                    const sm = current.match(/\/bangumi\/play\/ss(\d+)/i)
                    if (sm) return { seasonId: sm[1] }
                } else { break }
            }
        } catch (e) {}
    }
    return null
}

// 调用 B站番剧 API 解析视频流
async function parseBilibiliBangumi(target, addStream) {
    const idInfo = await extractBangumiId(target)
    if (!idInfo) return null

    const biliCookies = loadBiliCookie()
    const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
    const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
    if (isLoggedIn) biliHeaders['Cookie'] = biliCookieString(biliCookies)

    // 1. 获取 season 信息和剧集列表
    let seasonData
    try {
        const params = idInfo.epId ? { ep_id: idInfo.epId } : { season_id: idInfo.seasonId }
        const r = await axios.get('https://api.bilibili.com/pgc/view/web/season', {
            params, headers: biliHeaders, timeout: 15000, validateStatus: () => true
        })
        if (r.data?.code !== 0) return null
        seasonData = r.data.result
    } catch (e) { return null }

    const title = seasonData.title || 'B站番剧'
    const episodes = seasonData.episodes || []
    if (episodes.length === 0) return null

    // 找到目标 ep（如果是 ep_id 则直接匹配，否则用第一个）
    let targetEp = null
    if (idInfo.epId) {
        targetEp = episodes.find(e => String(e.id) === idInfo.epId)
    }
    if (!targetEp) targetEp = episodes[0]

    const qualityMap = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P' }
    const loggedInfo = isLoggedIn ? '（已登录）' : '（未登录·仅低画质）'
    const epTitle = `${title} 第${targetEp.title}话${targetEp.long_title ? ' ' + targetEp.long_title : ''}`.trim()
    let addedAny = false

    // === 1. 登录后优先尝试 DASH 格式（fnval=16），获取高画质（音视频分离）===
    if (isLoggedIn) {
        try {
            const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
                params: { ep_id: targetEp.id, cid: targetEp.cid, qn: 127, fnval: 16, fourk: 1 },
                headers: biliHeaders, timeout: 15000, validateStatus: () => true
            })
            if (r.data?.code === 0 && r.data.result?.dash) {
                const dash = r.data.result.dash
                const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                const bestAudio = audios[0]
                const audioUrl = bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : ''
                const videos = (dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                const seenQ = new Set()
                videos.forEach(v => {
                    if (seenQ.has(v.id)) return
                    seenQ.add(v.id)
                    const qLabel = qualityMap[v.id] || `${v.id}P`
                    addStream(v.baseUrl || v.base_url, 'mp4', `${epTitle} [${qLabel} 高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
                    addedAny = true
                })
            }
        } catch (e) {}
    }

    // === 2. 请求 durl 格式（fnval=1），完整音视频流（有声，画质取决于登录状态）===
    try {
        const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
            params: { ep_id: targetEp.id, cid: targetEp.cid, qn: 127, fnval: 1, fourk: 1 },
            headers: biliHeaders, timeout: 15000, validateStatus: () => true
        })
        if (r.data?.code === 0 && r.data.result?.durl) {
            const durl = r.data.result.durl
            const quality = r.data.result.quality
            const qLabel = qualityMap[quality] || `${quality}P`
            durl.forEach((d, i) => {
                const partTitle = durl.length > 1
                    ? `${epTitle} - 第${i + 1}段/共${durl.length}段 [${qLabel} 完整·有声]${loggedInfo}`
                    : `${epTitle} [${qLabel} 完整·有声]${loggedInfo}`
                addStream(d.url, 'mp4', partTitle, { bili: true })
            })
            addedAny = true
        }
    } catch (e) {}

    // === 3. 降级：尝试不同清晰度的 durl ===
    if (!addedAny) {
        for (const qn of [80, 64, 32, 16]) {
            try {
                const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
                    params: { ep_id: targetEp.id, cid: targetEp.cid, qn, fnval: 1, fourk: 0 },
                    headers: biliHeaders, timeout: 15000, validateStatus: () => true
                })
                if (r.data?.code === 0 && r.data.result?.durl) {
                    const durl = r.data.result.durl
                    const quality = r.data.result.quality
                    const qLabel = qualityMap[quality] || `${quality}P`
                    durl.forEach((d, i) => {
                        const partTitle = durl.length > 1
                            ? `${epTitle} - 第${i + 1}段/共${durl.length}段 [${qLabel}]${loggedInfo}`
                            : `${epTitle} [${qLabel}]${loggedInfo}`
                        addStream(d.url, 'mp4', partTitle, { bili: true })
                    })
                    addedAny = true
                    break
                }
            } catch (e) {}
        }
    }

    return addedAny ? { title: epTitle } : null
}

// ===== Twitch 直播流解析 =====
// Twitch 直播使用 HLS (m3u8) 格式，但需要 token+sig 才能访问 usher.ttvnw.net
// 解析流程：
//   1. 从 URL 提取频道名（twitch.tv/blastpremier → blastpremier）
//   2. 通过 GraphQL API 获取 streamPlaybackAccessToken（token + signature）
//   3. 构造 usher.ttvnw.net/api/channel/hls/{channel}.m3u8 URL 获取主播放列表
//   4. 主播放列表包含多个变体流（不同分辨率），每个变体流是独立的 m3u8
// 关键：使用 playerType="embed"（嵌入式播放器）获取 token，不插入前贴片广告
// Twitch 网页版公开 Client-ID（非机密，所有浏览器请求都用这个）
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

async function parseTwitch(target, addStream) {
    // 1. 提取频道名
    let channel = ''
    let m = target.match(/twitch\.tv\/([A-Za-z0-9_]+)/i)
    if (m) channel = m[1]
    if (!channel) return null
    // 排除 Twitch 的特殊路径
    if (['directory', 'following', 'downloads', 'jobs', 'turbo', 'p', 'clips', 'videos', 'search'].includes(channel.toLowerCase())) {
        return null
    }

    // 2. 通过 GraphQL 获取 streamPlaybackAccessToken
    // 使用 playerType="embed"（嵌入式播放器），不插入前贴片广告
    // 同时尝试 "embed" 和 "site" 两个 playerType，embed 优先（无广告）
    let token = '', sig = ''
    for (const playerType of ['embed', 'site']) {
        try {
            const r = await axios.post('https://gql.twitch.tv/gql', {
                operationName: 'PlaybackAccessToken_Template',
                query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
                    streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
                        value signature
                    }
                    videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {
                        value signature
                    }
                }`,
                variables: {
                    isLive: true,
                    login: channel,
                    isVod: false,
                    vodID: '',
                    playerType: playerType
                }
            }, {
                headers: {
                    'User-Agent': PARSE_UA,
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                timeout: 15000, validateStatus: () => true
            })
            const data = r.data?.data?.streamPlaybackAccessToken
            if (data?.value && data?.signature) {
                token = data.value
                sig = data.signature
                break  // 成功获取，跳出循环
            }
        } catch (e) {}
    }
    if (!token || !sig) return null

    // 3. 构造 usher.ttvnw.net HLS 主播放列表 URL
    const p = Math.floor(Math.random() * 999999)
    const hlsUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?player=twitchweb&token=${encodeURIComponent(token)}&sig=${sig}&allow_source=true&allow_audio_only=true&p=${p}&supported_codecs=avc1&fast_bread=true`

    // 4. 获取主播放列表，解析变体流
    let mainM3u8 = ''
    try {
        const r = await axios.get(hlsUrl, {
            headers: { 'User-Agent': PARSE_UA },
            timeout: 15000, validateStatus: () => true
        })
        if (r.status !== 200 || !r.data) return null
        mainM3u8 = r.data
    } catch (e) { return null }

    // 解析 #EXT-X-STREAM-INF 行 + 下一行的 URL
    const variants = []
    const lines = mainM3u8.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const url = (lines[i + 1] || '').trim()
            if (!url) continue
            // 提取分辨率和码率
            const resMatch = line.match(/RESOLUTION=([^,]+)/)
            const bwMatch = line.match(/BANDWIDTH=(\d+)/)
            const nameMatch = line.match(/NAME="([^"]+)"/)
            const codecsMatch = line.match(/CODECS="([^"]+)"/)
            const resolution = resMatch ? resMatch[1] : ''
            const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0
            const name = nameMatch ? nameMatch[1] : ''
            const codecs = codecsMatch ? codecsMatch[1] : ''
            variants.push({ url, resolution, bandwidth, name, codecs })
        }
    }

    if (variants.length === 0) return null

    // 按码率降序排序（高画质优先）
    variants.sort((a, b) => b.bandwidth - a.bandwidth)

    // 解析分辨率生成清晰度标签
    const makeLabel = (v) => {
        let label = v.name || ''
        if (v.resolution) {
            // 1920x1080 → 1080P
            const h = v.resolution.split('x')[1]
            if (h) label = label || `${h}P`
        }
        if (!label && v.bandwidth) {
            label = `${Math.round(v.bandwidth / 1000)}kbps`
        }
        return label || '未知'
    }

    const title = `Twitch - ${channel}`
    for (const v of variants) {
        const label = makeLabel(v)
        const type = 'm3u8'
        const desc = `${title} [${label} 直播]${v.codecs ? ' ' + v.codecs : ''}`
        addStream(v.url, type, desc)
    }

    return { title }
}

// ===== 虎牙直播流解析 =====
// 虎牙直播页面内嵌 stream: [{ gameLiveInfo, gameStreamInfoList }]
// 每个 gameStreamInfo 含 sFlvUrl/sStreamName/sFlvAntiCode/sHlsUrl/sHlsAntiCode
// 直接拼接即可得到 FLV 和 HLS 直播流地址（无需签名计算）
async function parseHuya(target, addStream) {
    // 1. 提取房间号（支持 huya.com/123 或 huya.com/xxx）
    let m = target.match(/huya\.com\/([A-Za-z0-9_]+)/i)
    if (!m) return null
    const room = m[1]

    // 2. 获取页面 HTML
    let html = ''
    try {
        const r = await axios.get(`https://www.huya.com/${room}`, {
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://www.huya.com/' },
            timeout: 15000, validateStatus: () => true
        })
        html = r.data || ''
    } catch (e) { return null }
    if (!html) return null

    // 3. 用括号平衡匹配提取 stream: [...]
    const idx = html.indexOf('stream:')
    if (idx < 0) return null
    const startArr = html.indexOf('[', idx)
    if (startArr < 0) return null
    let depth = 0, inStr = false, esc = false, quote = '', end = -1
    for (let i = startArr; i < html.length; i++) {
        const c = html[i]
        if (esc) { esc = false; continue }
        if (inStr) {
            if (c === '\\') esc = true
            else if (c === quote) inStr = false
        } else {
            if (c === '"' || c === "'") { inStr = true; quote = c }
            else if (c === '[') depth++
            else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
        }
    }
    if (end < 0) return null

    let streams
    try { streams = JSON.parse(html.slice(startArr, end + 1)) } catch (e) { return null }
    if (!streams || streams.length === 0) return null

    // 4. 提取标题
    const gameLiveInfo = streams[0].gameLiveInfo || {}
    let title = gameLiveInfo.nick || gameLiveInfo.roomName || `虎牙 - ${room}`
    if (gameLiveInfo.gameFullName) title += ` - ${gameLiveInfo.gameFullName}`

    // 5. 遍历 gameStreamInfoList 构造直播流 URL
    const streamInfoList = streams[0].gameStreamInfoList || []
    if (streamInfoList.length === 0) return null

    let addedAny = false
    // CDN 优先级：HS(华为)优先（测试中只有 HS 节点 HLS 返回 200，AL/TX 返回 403）
    // 然后 TX(腾讯) > AL(阿里) > BD
    const cdnPriority = { HS: 0, TX: 1, AL: 2, BD: 3, HW: 4, HX: 5 }
    streamInfoList.sort((a, b) => (cdnPriority[a.sCdnType] ?? 9) - (cdnPriority[b.sCdnType] ?? 9))

    // 优先返回所有 HLS 直播流（HLS 直播流更稳定，hls.js 会自动刷新 playlist 获取新分片）
    for (const info of streamInfoList) {
        const cdn = info.sCdnType || '?'
        const streamName = info.sStreamName
        if (!streamName) continue

        // HLS 直播流（优先返回，直播流 hls.js 会自动刷新 playlist）
        if (info.sHlsUrl && info.sHlsAntiCode) {
            const hlsUrl = `${info.sHlsUrl}/${streamName}.${info.sHlsUrlSuffix || 'm3u8'}?${info.sHlsAntiCode}`
            addStream(hlsUrl, 'm3u8', `${title} [HLS ${cdn}节点 直播]`)
            addedAny = true
        }
    }
    // FLV 作为备选（延迟更低但浏览器播放稳定性不如 HLS）
    for (const info of streamInfoList) {
        const cdn = info.sCdnType || '?'
        const streamName = info.sStreamName
        if (!streamName) continue
        if (info.sFlvUrl && info.sFlvAntiCode) {
            const flvUrl = `${info.sFlvUrl}/${streamName}.${info.sFlvUrlSuffix || 'flv'}?${info.sFlvAntiCode}`
            addStream(flvUrl, 'flv', `${title} [FLV ${cdn}节点 直播]`)
            addedAny = true
        }
    }

    return addedAny ? { title } : null
}

// ===== 斗鱼直播流解析 =====
// 斗鱼改版后签名函数从 ub98484234 改为 web-encrypt-57bbddd0.js 中的混淆代码
// 新 API 端点：/lapi/live/getH5PlayV1/{roomId}（不再是 getH5Play）
// 纯 Node 无法实现新签名算法，方案：
//   用隐藏 BrowserWindow 加载页面，让 Chromium 执行加密 JS
//   拦截视频流网络请求（FLV/HLS），直接提取 URL
async function parseDouyu(target, addStream) {
    // 1. 提取房间号
    let m = target.match(/douyu\.com\/([A-Za-z0-9_]+)/i)
    if (!m) return null
    const room = m[1]
    // 排除特殊路径
    if (['directory', 'following', 'search', 'topic', 'fishsmall'].includes(room.toLowerCase())) {
        return null
    }

    // 2. 用隐藏窗口加载页面，拦截视频流请求
    return new Promise((resolve) => {
        let bw = null
        let settled = false
        const networkUrls = []  // 拦截到的视频流 URL

        // 斗鱼视频 CDN 域名
        const douyuCdnPattern = /douyucdn|douyuscdn|douyucdn2|akm|tct|wsd|hwcdn|jscdn|txcdn/i

        const finish = (result) => {
            if (settled) return
            settled = true
            try { if (bw) { bw.destroy(); bw = null } } catch (e) {}
            resolve(result)
        }
        const timer = setTimeout(() => {
            // 超时后返回已收集的流
            if (networkUrls.length > 0) {
                let addedAny = false
                for (const u of networkUrls) {
                    const type = /\.m3u8/i.test(u) ? 'm3u8' : ( /\.flv/i.test(u) ? 'flv' : 'mp4')
                    addStream(u, type, `斗鱼 - ${room} [${type.toUpperCase()} 直播]`)
                    addedAny = true
                }
                finish(addedAny ? { title: `斗鱼 - ${room}` } : null)
            } else {
                finish(null)
            }
        }, 25000)

        try {
            bw = new BrowserWindow({
                width: 1280, height: 800, show: false, frame: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false,
                    webSecurity: false,
                    images: false,
                    autoplayPolicy: 'no-user-gesture-required',
                    partition: 'temp-parser'
                }
            })

            // 拦截视频流请求（FLV/HLS/MP4）
            bw.webContents.session.webRequest.onBeforeRequest(
                { urls: ['*://*/*.flv*', '*://*/*.m3u8*', '*://*/*.mp4*'] },
                (details, cb) => {
                    const u = details.url
                    // 只收集斗鱼 CDN 域名的请求
                    if (u && douyuCdnPattern.test(u)) {
                        // 去重
                        if (!networkUrls.includes(u)) {
                            networkUrls.push(u)
                        }
                    }
                    cb({})
                }
            )

            // 注入 Referer
            bw.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
                const u = details.url
                if (douyuCdnPattern.test(u) || /douyu\.com/i.test(u)) {
                    details.requestHeaders['Referer'] = `https://www.douyu.com/${room}`
                    details.requestHeaders['User-Agent'] = PARSE_UA
                }
                cb({ requestHeaders: details.requestHeaders })
            })

            bw.webContents.on('did-finish-load', () => {
                // 自动静音播放视频，触发视频流请求
                bw.webContents.executeJavaScript(`
                    try {
                        const videos = document.querySelectorAll('video');
                        for (const v of videos) {
                            v.muted = true;
                            v.play().catch(() => {});
                        }
                        // 点击播放按钮
                        const playBtns = document.querySelectorAll('[class*="play"], [class*="Play"], [class*="start"]');
                        for (const btn of playBtns) {
                            try { btn.click(); } catch (e) {}
                        }
                    } catch (e) {}
                `).catch(() => {})

                // 多轮检查：每 2 秒检查一次，看是否已拦截到视频流
                let attempts = 0
                const maxAttempts = 10
                const checkInterval = setInterval(() => {
                    attempts++
                    if (networkUrls.length > 0) {
                        // 已拦截到视频流，立即返回
                        clearInterval(checkInterval)
                        clearTimeout(timer)
                        let addedAny = false
                        for (const u of networkUrls) {
                            const type = /\.m3u8/i.test(u) ? 'm3u8' : ( /\.flv/i.test(u) ? 'flv' : 'mp4')
                            addStream(u, type, `斗鱼 - ${room} [${type.toUpperCase()} 直播]`)
                            addedAny = true
                        }
                        finish(addedAny ? { title: `斗鱼 - ${room}` } : null)
                    } else if (attempts >= maxAttempts) {
                        clearInterval(checkInterval)
                        // 超时检查，让 timer 处理
                    }
                }, 2000)
            })

            bw.webContents.on('did-fail-load', (_, errorCode) => {
                if (errorCode !== -3 && errorCode !== 0) {
                    clearTimeout(timer)
                    finish(null)
                }
            })

            bw.loadURL(`https://www.douyu.com/${room}`, { userAgent: PARSE_UA })
        } catch (e) {
            clearTimeout(timer)
            finish(null)
        }
    })
}

// ===== B站登录（二维码扫码，获取 Cookie 提升画质） =====
const BILI_COOKIE_FILE = () => path.join(app.getPath('userData'), 'bilibili-cookie.json')

function loadBiliCookie() {
    try {
        const raw = fs.readFileSync(BILI_COOKIE_FILE(), 'utf8')
        const data = JSON.parse(raw)
        // 检查过期（B站 SESSDATA 默认 180 天，这里保守按 30 天判断）
        if (data.savedAt && Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) return null
        return data.cookies || null
    } catch (e) { return null }
}

function saveBiliCookie(cookies) {
    try {
        fs.writeFileSync(BILI_COOKIE_FILE(), JSON.stringify({ cookies, savedAt: Date.now() }), 'utf8')
    } catch (e) {}
}

function biliCookieString(cookies) {
    if (!cookies) return ''
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

// 生成二维码登录
ipcMain.handle('bilibili:login-qr', async () => {
    try {
        const r = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
            headers: { 'User-Agent': PARSE_UA },
            timeout: 10000
        })
        if (r.data?.code === 0 && r.data.data) {
            return { success: true, qrcodeUrl: r.data.data.url, qrcodeKey: r.data.data.qrcode_key }
        }
        return { success: false, message: r.data?.message || '获取二维码失败' }
    } catch (e) {
        return { success: false, message: e.message }
    }
})

// 检查扫码状态
ipcMain.handle('bilibili:login-check', async (_, { qrcodeKey }) => {
    try {
        const r = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', {
            params: { qrcode_key: qrcodeKey },
            headers: { 'User-Agent': PARSE_UA },
            timeout: 10000
        })
        const code = r.data?.data?.code
        // code: 0=成功, 86038=失效, 86090=已扫码未确认, 86101=未扫码
        if (code === 0) {
            // 登录成功，从返回的 url 中提取 Cookie
            const url = r.data.data.url || ''
            const cookies = {}
            // url 形如 https://passport.biligame.com/x/passport-login/web/crossDomain?DedeUserID=xxx&DedeUserID__ckMd5=xxx&Expires=xxx&SESSDATA=xxx&bili_jct=xxx&gourl=xxx
            const params = new URL(url).searchParams
            for (const key of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5']) {
                const val = params.get(key)
                if (val) cookies[key] = val
            }
            // 补充从 set-cookie 获取（如有）
            const setCookies = r.headers?.['set-cookie'] || []
            for (const sc of setCookies) {
                const m = sc.match(/^([^=]+)=([^;]*)/)
                if (m) cookies[m[1]] = m[2]
            }
            if (cookies.SESSDATA) {
                saveBiliCookie(cookies)
                // 立即获取完整用户信息（昵称、头像、大会员）
                let userInfo = { uid: cookies.DedeUserID }
                try {
                    const nr = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
                        headers: { 'User-Agent': PARSE_UA, 'Cookie': biliCookieString(cookies) },
                        timeout: 10000
                    })
                    if (nr.data?.code === 0 && nr.data.data?.isLogin) {
                        userInfo = {
                            uid: nr.data.data.mid,
                            uname: nr.data.data.uname,
                            face: nr.data.data.face,
                            vip: nr.data.data.vipStatus
                        }
                    }
                } catch (e) {}
                return { success: true, loggedIn: true, userInfo }
            }
            return { success: false, message: 'Cookie 解析失败' }
        }
        const msgMap = { 86038: 'expired', 86090: 'scanned', 86101: 'waiting' }
        return { success: true, loggedIn: false, status: msgMap[code] || 'unknown' }
    } catch (e) {
        return { success: false, message: e.message }
    }
})

// 检查登录状态
ipcMain.handle('bilibili:login-status', async () => {
    const cookies = loadBiliCookie()
    if (!cookies || !cookies.SESSDATA) return { success: true, loggedIn: false }
    try {
        const r = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: { 'User-Agent': PARSE_UA, 'Cookie': biliCookieString(cookies) },
            timeout: 10000
        })
        if (r.data?.code === 0 && r.data.data?.isLogin) {
            return { success: true, loggedIn: true, userInfo: { uid: r.data.data.mid, uname: r.data.data.uname, face: r.data.data.face, vip: r.data.data.vipStatus } }
        }
        return { success: true, loggedIn: false }
    } catch (e) {
        return { success: true, loggedIn: false }
    }
})

// 退出登录
ipcMain.handle('bilibili:logout', async () => {
    try { fs.unlinkSync(BILI_COOKIE_FILE()) } catch (e) {}
    return { success: true }
})

ipcMain.handle('video:parse-url', async (_, { url }) => {
    try {
        const target = String(url || '').trim()
        if (!/^https?:\/\//i.test(target)) {
            return { success: false, message: '请输入以 http:// 或 https:// 开头的网址' }
        }

        const found = new Map()  // url -> {url, type, title, audioUrl?}
        const addStream = (u, type, title, extra = {}) => {
            let clean = String(u).replace(/\\\//g, '/').replace(/&amp;/g, '&').trim()
            if (clean.startsWith('//')) clean = 'https:' + clean
            else if (clean.startsWith('/')) {
                try { clean = new URL(target).origin + clean } catch (e) { return }
            }
            if (!/^https?:\/\//i.test(clean)) return
            if (found.has(clean)) return
            const item = { url: clean, type, title: title || '' }
            // 透传 DASH 音频地址（用于下载时 ffmpeg 合并）等附加字段
            if (extra.audioUrl) item.audioUrl = extra.audioUrl
            if (extra.bili) item.bili = true
            found.set(clean, item)
        }

        // === 虎牙直播解析 ===
        if (/huya\.com/i.test(target)) {
            const hyResult = await parseHuya(target, addStream)
            if (hyResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: hyResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析虎牙直播流（可能未开播或房间号无效）', pageUrl: target }
        }

        // === 斗鱼直播解析 ===
        if (/douyu\.com/i.test(target) && !/v\.douyu\.com/i.test(target)) {
            const dyResult = await parseDouyu(target, addStream)
            if (dyResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: dyResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析斗鱼直播流（可能未开播或房间号无效）', pageUrl: target }
        }

        // === Twitch 直播解析 ===
        if (/twitch\.tv/i.test(target)) {
            const twResult = await parseTwitch(target, addStream)
            if (twResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: twResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析 Twitch 直播流（可能未开播或频道名无效）', pageUrl: target }
        }

        // === B站解析（区分视频 / 直播 / 番剧/电影）===
        if (/bilibili\.com|b23\.tv/i.test(target)) {
            // 直播间：live.bilibili.com/xxx
            if (/live\.bilibili\.com\/\d+/i.test(target)) {
                const liveResult = await parseBilibiliLive(target, addStream)
                if (liveResult) {
                    const streams = Array.from(found.values())
                    return { success: true, streams, pageTitle: liveResult.title || '', pageUrl: target }
                }
                return { success: false, message: '未能解析 B站直播间（可能未开播或需登录）', pageUrl: target }
            }
            // 番剧/电影：bangumi/play/epXXX 或 ssXXX
            if (/\/bangumi\/play\//i.test(target) || /b23\.tv/i.test(target)) {
                const bgmResult = await parseBilibiliBangumi(target, addStream)
                if (bgmResult) {
                    const streams = Array.from(found.values())
                    return { success: true, streams, pageTitle: bgmResult.title || '', pageUrl: target }
                }
                // b23.tv 短链既可能指向番剧也可能指向普通视频，番剧解析失败时继续走普通视频分支
                if (!/\/bangumi\/play\//i.test(target)) {
                    // fall through 到普通视频解析
                } else {
                    return { success: false, message: '未能解析 B站番剧（可能需要登录、区域限制或为付费内容）', pageUrl: target }
                }
            }
            // 普通视频
            const biliResult = await parseBilibili(target, addStream)
            if (biliResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: biliResult.title || '', pageUrl: target }
            }
        }

        // === 快手视频解析 ===
        if (/kuaishou\.com/i.test(target)) {
            const ksResult = await parseKuaishou(target, addStream)
            if (ksResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: ksResult.title || '', pageUrl: target }
            }
        }

        // === 抖音视频解析 ===
        if (/douyin\.com|iesdouyin\.com/i.test(target)) {
            const dyResult = await parseDouyin(target, addStream)
            if (dyResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: dyResult.title || '', pageUrl: target }
            }
        }

        // === 通用 HTML 解析 ===
        const res = await axios.get(target, {
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': target,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            responseType: 'text',
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 5
        })
        const html = res.data || ''
        if (!html) return { success: false, message: '页面内容为空' }

        // 1. maccms player_aaaa JSON（最常见，url 字段多为 m3u8 直链）
        const pm = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
        if (pm) {
            try {
                const player = JSON.parse(pm[1])
                if (player.url && /^https?:\/\//.test(player.url)) {
                    const u = String(player.url).replace(/\\\//g, '/')
                    const isM3u8 = /\.m3u8/i.test(u)
                    addStream(u, isM3u8 ? 'm3u8' : 'iframe', player.title || '')
                }
            } catch (e) { /* 降级到正则 */ }
        }

        // 2. 正则提取所有 m3u8
        const m3u8Matches = html.matchAll(/["'](https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)["']/gi)
        for (const m of m3u8Matches) addStream(m[1], 'm3u8', '')

        // 3. 正则提取所有视频直链（支持任何视频格式）
        const videoExts = 'mp4|webm|flv|avi|mkv|mov|wmv|m4v|ts|mpg|mpeg|mpe|3gp|asf|f4v|ogv|mts|m2ts|vob|rm|rmvb|ts'
        const videoMatches = html.matchAll(new RegExp(`["'](https?://[^"'\\s<>]+\\.(?:${videoExts})(?:[?#][^"'\\s<>]*)?)["']`, 'gi'))
        for (const m of videoMatches) {
            const u = m[1]
            const ext = u.match(/\.(\w+)(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'mp4'
            addStream(u, ext, '')
        }

        // 4. iframe 播放器源（含 player/dplayer/m3u8 关键字）
        const iframeMatches = html.matchAll(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi)
        for (const m of iframeMatches) {
            let src = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&')
            if (src.startsWith('//')) src = 'https:' + src
            else if (src.startsWith('/')) {
                try { src = new URL(target).origin + src } catch (e) { continue }
            }
            if (/player|dplayer|url=|\.m3u8/i.test(src)) addStream(src, 'iframe', '')
        }

        // 5. 嵌入式 JSON 深度提取（__INITIAL_STATE__/__NUXT__/__APP_DATA__/__PRELOADED_STATE__ 等）
        //    递归遍历 JSON 树，提取所有视频直链（覆盖微博/西瓜/小红书等 SSR 站点）
        const jsonVarPatterns = [
            /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
            /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
            /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
            /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
            /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
            /window\._SSR_DATA_\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/
        ]
        const scanVideoUrls = (obj, depth) => {
            if (!obj || typeof obj !== 'object' || depth > 7) return
            if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv|ts|webm)(\?|$|#)/i.test(obj.url)) {
                const u = obj.url.replace(/\\\//g, '/')
                const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
                addStream(u, type, '')
            }
            if (Array.isArray(obj.url_list)) {
                for (const u of obj.url_list) {
                    if (typeof u === 'string' && /^https?:\/\/.+/.test(u) && /\.(mp4|m3u8|flv|ts|webm)(\?|$|#)/i.test(u)) {
                        const clean = u.replace(/\\\//g, '/')
                        const type = /\.m3u8/i.test(clean) ? 'm3u8' : (/\.flv/i.test(clean) ? 'flv' : 'mp4')
                        addStream(clean, type, '')
                    }
                }
            }
            if (typeof obj.playUrl === 'string' && /^https?:\/\/.+/.test(obj.playUrl) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.playUrl)) {
                addStream(obj.playUrl.replace(/\\\//g, '/'), /\.m3u8/i.test(obj.playUrl) ? 'm3u8' : 'mp4', '')
            }
            for (const k of Object.keys(obj)) {
                const v = obj[k]
                if (v && typeof v === 'object') scanVideoUrls(v, depth + 1)
            }
        }
        for (const pat of jsonVarPatterns) {
            const jm = html.match(pat)
            if (jm) {
                try { scanVideoUrls(JSON.parse(jm[1]), 0) } catch (e) {}
            }
        }

        const streams = Array.from(found.values())
        // 获取页面标题作为默认名
        let pageTitle = ''
        const tm = html.match(/<title>([^<]*)<\/title>/i)
        if (tm) pageTitle = tm[1].trim()
        return { success: true, streams, pageTitle, pageUrl: target }
    } catch (e) {
        return { success: false, message: e.message || '解析失败' }
    }
})

// 获取网易云 MV 搜索结果（按歌名匹配）
ipcMain.handle('ncm-mv-search', async (_, { keyword }) => {
    try {
        const apiBase = process.env.NCM_API_BASE || 'https://api.xiaomingky.cn'
        const res = await axios.get(`${apiBase}/cloudsearch`, {
            params: { keywords: keyword, type: 1004, timestamp: Date.now() },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://music.163.com/'
            },
            timeout: 15000,
            validateStatus: () => true
        })
        if (res.status === 200 && res.data?.code === 200) {
            const mvs = res.data?.result?.mvs || []
            return {
                success: true,
                mvs: mvs.map(m => ({
                    id: m.id,
                    name: m.name || '',
                    artistName: m.artistName || '',
                    duration: m.duration || 0,
                    cover: m.cover || '',
                    playCount: m.playCount || 0
                }))
            }
        }
        return { success: false, message: res.data?.msg || `HTTP ${res.status}` }
    } catch (err) {
        return { success: false, message: err.message }
    }
})

// --- 自动更新（GitHub API 直连）---
function checkForUpdates() {
    win?.webContents.send('update-checking')
    const opts = {
        hostname: 'api.github.com',
        path: '/repos/xiaomingky/MingYunTime/releases/latest',
        headers: { 'User-Agent': 'MingYunTime', 'Accept': 'application/vnd.github+json' }
    }
    https.get(opts, (res) => {
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => {
            try {
                const release = JSON.parse(body)
                const tag = release.tag_name || ''
                const latestVersion = tag.replace('v', '')
                const currentVersion = app.getVersion()
                const notes = release.body || ''
                // 从 release assets 中筛选真正的 Windows 安装包，避免下载 latest.yml / blockmap
                const asset = release.assets?.find(a => {
                    const name = a.name?.toLowerCase() || ''
                    return name.endsWith('.exe')
                })
                // 兜底直链使用当前仓库与构建产物名称
                const encodedFileName = encodeURIComponent(`茗韵时光 Setup ${latestVersion}.exe`)
                const directDownload = `https://github.com/xiaomingky/MingYunTime/releases/download/${tag}/${encodedFileName}`
                const downloadUrl = asset?.browser_download_url || directDownload
                console.log('[Update] latest:', tag, 'current:', currentVersion)
                if (latestVersion && latestVersion !== currentVersion) {
                    win?.webContents.send('update-available', tag, notes, downloadUrl)
                } else {
                    win?.webContents.send('update-not-available', currentVersion)
                }
            } catch(e) {
                console.error('[Update] Parse error:', e)
                win?.webContents.send('update-error', '检查更新失败')
            }
        })
    }).on('error', (e) => {
        console.error('[Update] Network error:', e)
        win?.webContents.send('update-error', '网络连接失败')
    })
}

app.whenReady().then(() => {
    // --- 启动 QQ 音乐 API 子进程(监听 3200 端口) ---
    startQQMusicAPI()

    // --- Electron 22 兼容性协议注册 (Win7 支持) ---

    // 1. local-file 协议 (支持 Range 请求)
    protocol.registerStreamProtocol('local-file', (request, callback) => {
        try {
            const urlStr = request.url
            // 改进路径解析：解决双斜杠/三斜杠路径匹配问题
            let filePath = decodeURIComponent(urlStr.replace('local-file://', ''))
            // 兼容有些系统传入的是 /C:/... 格式
            if (process.platform === 'win32' && filePath.startsWith('/')) {
                filePath = filePath.substring(1)
            }

            // Windows 路径规范化
            if (process.platform === 'win32') {
                filePath = path.normalize(filePath)
            }

            if (!fs.existsSync(filePath)) {
                return callback({ statusCode: 404, data: 'Not Found' })
            }

            const stats = fs.statSync(filePath)
            const range = request.headers['Range'] || request.headers['range']

            const ext = path.extname(filePath).toLowerCase()
            const mimeMap = {
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.flac': 'audio/flac',
                '.ogg': 'audio/ogg',
                '.oga': 'audio/ogg',
                '.m4a': 'audio/mp4',
                '.aac': 'audio/aac',
                '.wma': 'audio/x-ms-wma',
                '.ape': 'audio/ape',
                '.opus': 'audio/opus',
                '.wv': 'audio/x-wavpack',
                '.tta': 'audio/tta',
                '.dsf': 'audio/dsf',
                '.dff': 'audio/dff',
                '.mp2': 'audio/mpeg',
                '.ac3': 'audio/ac3',
                '.amr': 'audio/amr',
                '.aiff': 'audio/aiff',
                '.au': 'audio/basic',
                '.ra': 'audio/vnd.rn-realaudio',
                '.ram': 'audio/vnd.rn-realaudio',
                '.mpc': 'audio/x-musepack',
                '.mka': 'audio/x-matroska',
                '.weba': 'audio/webm',
                '.ttf': 'font/ttf',
                '.otf': 'font/otf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.mp4': 'video/mp4',
                '.mkv': 'video/x-matroska',
                '.webm': 'video/webm',
                '.avi': 'video/x-msvideo',
                '.mov': 'video/quicktime',
                '.flv': 'video/x-flv',
                '.wmv': 'video/x-ms-wmv'
            }
            const contentType = mimeMap[ext] || 'application/octet-stream'

            if (!range) {
                return callback({
                    statusCode: 200,
                    headers: {
                        'Content-Length': stats.size.toString(),
                        'Accept-Ranges': 'bytes',
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*'
                    },
                    data: fs.createReadStream(filePath)
                })
            }

            const parts = range.replace(/bytes=/, "").split("-")
            const start = parseInt(parts[0], 10)
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
            const chunksize = (end - start) + 1

            callback({
                statusCode: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize.toString(),
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*'
                },
                data: fs.createReadStream(filePath, { start, end })
            })
        } catch (e) {
            console.error('Local protocol error:', e)
            callback({ statusCode: 500 })
        }
    })

    // 2. song-cover 协议 (带 LRU 缓存 + 兜底逻辑)
    // 缓存已解析的封面 Buffer，避免每次切歌都重新 parseFile 音频元数据
    const _coverCache = new Map()    // key: filePath+static → { data, mimeType, ts }
    const _COVER_CACHE_MAX = 8       // 最多缓存 8 首歌的封面（省内存，旧值 30 占用过多）
    const _COVER_CACHE_TTL = 300000  // 5 分钟过期（旧值 10 分钟，缩短以加速释放）

    protocol.registerBufferProtocol('song-cover', async (request, callback) => {
        try {
            const urlStr = request.url
            const hasStaticParam = urlStr.includes('?static=1')
            // 健壮解析：兼容 Chromium 对 song-cover:/// 规范化后的各种形式
            // 原始: song-cover:///C:/path/file.mp3  规范化后可能: song-cover://C:/path/file.mp3
            let filePath = urlStr.replace(/^song-cover:\/+/i, '').replace(/\?static=1.*$/, '').replace(/\?param=.*$/, '')
            filePath = decodeURIComponent(filePath)

            if (process.platform === 'win32') {
                // 规范化路径（处理 / 转为 \），但 path.normalize 会把 / 转成 \，下面 fs 调用都兼容
                filePath = path.normalize(filePath)
            }

            if (!fs.existsSync(filePath)) return callback({ statusCode: 404 })

            // LRU 缓存检查：命中则直接返回，避免重复 parseFile
            const cacheKey = filePath + (hasStaticParam ? '?static' : '')
            const cached = _coverCache.get(cacheKey)
            if (cached && (Date.now() - cached.ts < _COVER_CACHE_TTL)) {
                return callback({ mimeType: cached.mimeType, data: cached.data })
            }

            // 提取内嵌
            try {
                const metadata = await (await getMM()).parseFile(filePath)
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                    const pic = metadata.common.picture[0]
                    // 如果要求静态图片且内嵌的是GIF，则跳过使用兜底图
                    if (hasStaticParam && pic.format === 'image/gif') {
                        // 跳过GIF，继续查找其他图片
                    } else {
                        // music-metadata 11.x 的 pic.data 是 Uint8Array，Electron registerBufferProtocol 需要 Buffer
                        const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data)
                        // 写入 LRU 缓存
                        if (_coverCache.size >= _COVER_CACHE_MAX) {
                            // 删除最早的条目（Map 保持插入顺序）
                            const firstKey = _coverCache.keys().next().value
                            _coverCache.delete(firstKey)
                        }
                        _coverCache.set(cacheKey, { data: buf, mimeType: pic.format, ts: Date.now() })
                        return callback({ mimeType: pic.format, data: buf })
                    }
                }
            } catch (e) { }

            // 提取同目录图片（依次尝试：同名 → cover/folder/album/front → 目录内任意图片）
            const dir = path.dirname(filePath)
            const baseName = path.basename(filePath, path.extname(filePath))
            const exts = hasStaticParam ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.gif', '.png', '.jpg', '.jpeg', '.webp']
            const mimeOf = (ext) => ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'

            // 1. 与音乐同名的图片（保留 GIF 动图优先级）
            for (const ext of exts) {
                const imgPath = path.join(dir, baseName + ext)
                if (fs.existsSync(imgPath)) {
                    return callback({ mimeType: mimeOf(ext), data: fs.readFileSync(imgPath) })
                }
            }

            // 2. 通用封面文件名（cover / folder / album / front）
            const coverNames = hasStaticParam
                ? ['cover', 'Cover', 'folder', 'Folder', 'album', 'Album', 'front', 'Front']
                : ['cover', 'Cover', 'folder', 'Folder', 'album', 'Album', 'front', 'Front']
            for (const cn of coverNames) {
                for (const ext of exts) {
                    const imgPath = path.join(dir, cn + ext)
                    if (fs.existsSync(imgPath)) {
                        return callback({ mimeType: mimeOf(ext), data: fs.readFileSync(imgPath) })
                    }
                }
            }

            // 3. 目录内任意图片文件（最后兜底）
            try {
                const files = fs.readdirSync(dir)
                for (const f of files) {
                    const ext = path.extname(f).toLowerCase()
                    if (exts.includes(ext)) {
                        const imgPath = path.join(dir, f)
                        const stat = fs.statSync(imgPath)
                        if (stat.isFile()) {
                            return callback({ mimeType: mimeOf(ext), data: fs.readFileSync(imgPath) })
                        }
                    }
                }
            } catch (e) { }

            // 最终兜底：使用应用内置 icon.png（避免依赖网络图片 404）
            const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')
            if (fs.existsSync(iconPath)) {
                return callback({ mimeType: 'image/png', data: fs.readFileSync(iconPath) })
            }
            // 超级兜底：1x1 透明像素
            const transparentPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
            callback({ mimeType: 'image/png', data: transparentPixel })
        } catch (e) {
            callback({ statusCode: 500 })
        }
    })

    // 清理 song-cover LRU 缓存（窗口隐藏时触发，释放封面图片占用的内存）
    ipcMain.on('clear-cover-cache', () => {
        try { _coverCache.clear() } catch (e) {}
    })

    createWindow()
    createTray()

    // === 系统级文件关联：处理通过"打开方式"启动时传入的音频文件 ===
    // 启动时检查命令行参数是否包含音频文件路径
    const openArg = findAudioArgFromArgv(process.argv)
    if (openArg) {
        // 延迟发送，等渲染进程加载完毕
        setTimeout(() => sendOpenFile(openArg), 1500)
    }

    // 程序已运行时，再次通过"打开方式"打开文件会触发 second-instance
    app.on('second-instance', (event, argv) => {
        const arg = findAudioArgFromArgv(argv)
        if (arg) {
            // 显示主窗口并发送文件路径
            if (win) {
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
                sendOpenFile(arg)
            }
        } else {
            // 没有文件参数：仅显示主窗口
            if (win) {
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
            }
        }
    })

    // 启动后 5 秒检测更新
    setTimeout(checkForUpdates, 5000)
})

// 从命令行参数中提取音视频文件路径（过滤掉 electron 自身和 flag 参数）
function findAudioArgFromArgv(argv) {
    if (!argv || !argv.length) return null
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg || arg.startsWith('-') || arg.startsWith('--')) continue
        // 跳过 electron 可执行文件本身和 main.js
        if (/electron\.exe$/i.test(arg)) continue
        if (/main\.js$/i.test(arg)) continue
        // 检查是否为受支持的音频或视频文件
        const ext = path.extname(arg).toLowerCase()
        if (AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext)) return arg
    }
    return null
}

// 发送文件路径到渲染进程进行播放（自动区分音视频）
async function sendOpenFile(filePath) {
    if (!win || win.isDestroyed()) return
    try {
        const ext = path.extname(filePath).toLowerCase()
        const isVideo = VIDEO_EXTENSIONS.includes(ext)
        // 扫描文件元数据，构造 song/video 对象（与对应 dialog 返回结构一致）
        const items = isVideo ? await scanVideoFiles(filePath) : await scanAudioFiles(filePath)
        if (items && items.length > 0) {
            // 视频走 'open-video-file' 事件，音频走 'open-audio-file'
            const channel = isVideo ? 'open-video-file' : 'open-audio-file'
            // 按项目约定：IPC 通信必须用 JSON.parse(JSON.stringify()) 克隆对象，确保 structured cloning 兼容
            const cloned = JSON.parse(JSON.stringify(items[0]))
            win.webContents.send(channel, cloned)
        }
    } catch (e) {
        console.error('sendOpenFile error:', e)
    }
}

ipcMain.on('window-minimize-to-tray', () => {
    win?.hide()
})

ipcMain.on('window-quit', () => {
    if (tray) {
        tray.destroy()
        tray = null
    }
    app.quit()
})

ipcMain.handle('download-song', async (_, { url, name, artist, picUrl }) => {
    // 委托给统一下载管理器，category='music'，封面单独后台下载
    const fullName = artist ? `${name} - ${artist}` : name
    const result = await delegateStartDownload({ url, name: fullName, category: 'music' })
    // 后台下载封面到同目录（不纳入下载管理器，避免污染列表）
    if (result?.success && picUrl && result.path) {
        const coverPath = path.join(path.dirname(result.path), path.basename(result.path, path.extname(result.path)) + '.jpg')
        axios.get(picUrl, { responseType: 'arraybuffer', timeout: 15000 }).then(res => {
            try { fs.writeFileSync(coverPath, Buffer.from(res.data)) } catch (e) {}
        }).catch(() => {})
    }
    return result
})

ipcMain.on('open-osk', () => {
    // 针对 Win7-Win11 的虚拟键盘
    exec('osk.exe', (err) => {
        if (err) {
            // 如果普通 exec 失败，尝试全路径
            const fullPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'osk.exe')
            exec(`"${fullPath}"`)
        }
    })
})

ipcMain.on('open-external', (_, url) => {
    if (url && (url.startsWith('https:') || url.startsWith('http:'))) {
        shell.openExternal(url)
    }
})

// ── 元数据编辑 ──
import NodeID3 from 'node-id3'

// 用 ffmpeg 压缩大封面（避免引入 sharp 的 native 依赖与 Node 版本冲突）
async function resizeCover(coverDataUrl) {
    if (!coverDataUrl || !coverDataUrl.startsWith('data:')) return null
    const [mime, b64] = coverDataUrl.split(';base64,')
    let imgBuf = Buffer.from(b64, 'base64')
    if (imgBuf.length <= 500 * 1024) {
        return imgBuf && imgBuf.length > 0 ? imgBuf : null
    }
    // 大于 500KB：用 ffmpeg 缩放至 600x600 内并转 JPEG
    const tmpDir = app.getPath('temp')
    const inPath = path.join(tmpDir, 'cover_in_' + Date.now() + '.jpg')
    const outPath = path.join(tmpDir, 'cover_out_' + Date.now() + '.jpg')
    try {
        fs.writeFileSync(inPath, imgBuf)
        await new Promise((resolve, reject) => {
            // scale 保持宽高比、不放大；quality 85
            execFile(getFfmpegPath(), [
                '-y', '-i', inPath,
                '-vf', 'scale=600:600:force_original_aspect_ratio=decrease',
                '-q:v', '3',
                outPath
            ], { timeout: 15000 }, (err) => {
                if (err) { reject(new Error('ffmpeg resize failed: ' + err.message)); return }
                resolve()
            })
        })
        const resized = fs.readFileSync(outPath)
        return resized.length > 0 ? resized : imgBuf
    } catch (e) {
        console.warn('[save-metadata] ffmpeg resize failed, using original cover:', e.message)
        return imgBuf && imgBuf.length > 0 ? imgBuf : null
    } finally {
        try { fs.unlinkSync(inPath) } catch (e) {}
        try { fs.unlinkSync(outPath) } catch (e) {}
    }
}

function saveCoverTempFile(coverBuf) {
    if (!coverBuf) return null
    const tmpDir = app.getPath('temp')
    const tmpPath = path.join(tmpDir, 'cover_' + Date.now() + '.jpg')
    fs.writeFileSync(tmpPath, coverBuf)
    return tmpPath
}

// 根据 MIME 类型保存封面临时文件（ffmpeg 需要正确扩展名识别图片格式）
function saveCoverTempFileWithMime(coverBuf, coverMime) {
    if (!coverBuf) return null
    const tmpDir = app.getPath('temp')
    const ext = (coverMime || 'image/jpeg').includes('png') ? '.png'
              : (coverMime || '').includes('gif') ? '.gif' : '.jpg'
    const tmpPath = path.join(tmpDir, 'mp3_cover_' + Date.now() + ext)
    fs.writeFileSync(tmpPath, coverBuf)
    return tmpPath
}

// 用 ffmpeg 写入标准 ID3v2.3 APIC frame（最可靠的 MP3 封面写入方式）
// ffmpeg 生成的 APIC frame 被 Windows 资源管理器/所有播放器/网易云云盘统一识别
async function writeMP3CoverWithFfmpeg(songPath, coverBuf, coverMime) {
    const coverFile = saveCoverTempFileWithMime(coverBuf, coverMime)
    const tmpOut = songPath + '.tmp.mp3'
    try {
        await new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-i', songPath,
                '-i', coverFile,
                '-map', '0:a:0',       // 只映射音频流（丢弃旧封面）
                '-map', '1:0',         // 映射封面图片
                '-c', 'copy',          // 直接复制，不重新编码
                '-id3v2_version', '3', // 强制 ID3v2.3（兼容性最好）
                '-write_id3v1', '1',   // 同时写 ID3v1（老播放器兼容）
                '-metadata:s:v', 'title=Album cover',
                '-metadata:s:v', 'comment=Cover (front)',
                '-disposition:v', 'attached_pic',
                tmpOut
            ]
            execFile(getFfmpegPath(), args, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[writeMP3CoverWithFfmpeg] ffmpeg failed:', stderr?.slice(-500))
                    reject(new Error('ffmpeg封面写入失败: ' + err.message))
                    return
                }
                resolve()
            })
        })
        fs.copyFileSync(tmpOut, songPath)
        fs.unlinkSync(tmpOut)
    } finally {
        try { fs.unlinkSync(coverFile) } catch (e) {}
        try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut) } catch (e) {}
    }
}

// 用 ffmpeg 写入元数据（支持 FLAC/OGG/WAV/M4A 等所有格式）
function saveWithFfmpeg(songPath, metadata, coverBuf, lyrics) {
    return new Promise((resolve, reject) => {
        const tmpOut = songPath + '.tmp'
        // 参数顺序：所有 -i 输入在前，-metadata/-map 等输出选项在后
        const args = ['-y', '-i', songPath]
        const coverFile = saveCoverTempFile(coverBuf)
        if (coverFile) args.push('-i', coverFile)

        const metaFields = [
            ['title', metadata.title], ['artist', metadata.artist],
            ['album', metadata.album], ['date', metadata.year],
            ['genre', metadata.genre], ['track', metadata.track]
        ]
        for (const [key, val] of metaFields) {
            if (val) args.push('-metadata', `${key}=${val}`)
        }
        if (lyrics) args.push('-metadata', `lyrics=${lyrics}`)

        if (coverFile) args.push('-map', '0', '-map', '1', '-c', 'copy', '-disposition:v', 'attached_pic')
        else args.push('-c', 'copy')

        args.push(tmpOut)

        execFile(getFfmpegPath(), args, { timeout: 30000 }, (err, stdout, stderr) => {
            if (coverFile) { try { fs.unlinkSync(coverFile) } catch(e) {} }
            if (err) {
                try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut) } catch(e) {}
                reject(new Error('ffmpeg写入失败: ' + err.message))
                return
            }
            try {
                fs.copyFileSync(tmpOut, songPath)
                fs.unlinkSync(tmpOut)
                resolve()
            } catch (e) {
                reject(new Error('替换文件失败: ' + e.message))
            }
        })
    })
}

// 读取 4 字节 syncsafe integer（ID3v2 header size / v2.4 frame size）
function readSyncsafe(buf, offset) {
    return ((buf[offset] & 0x7F) << 21) | ((buf[offset + 1] & 0x7F) << 14) |
           ((buf[offset + 2] & 0x7F) << 7) | (buf[offset + 3] & 0x7F)
}
// 写入 4 字节 syncsafe integer
function writeSyncsafe(value) {
    const buf = Buffer.alloc(4)
    buf[0] = (value >>> 21) & 0x7F
    buf[1] = (value >>> 14) & 0x7F
    buf[2] = (value >>> 7) & 0x7F
    buf[3] = value & 0x7F
    return buf
}

// 手动构建标准 ID3v2.3 APIC frame 并写入 MP3 文件
// 解决 NodeID3 0.2.9 生成的 APIC frame 不被部分播放器/网易云云盘识别的问题
// 流程：读取现有 ID3v2 → 移除旧 APIC frame → 插入标准 APIC frame → 重写 header size
function writeMP3CoverStandard(songPath, coverBuf, coverMime) {
    const mime = coverMime || 'image/jpeg'
    // APIC frame body（ID3v2.3 规范）：
    //   text encoding(1) + MIME(null-terminated ISO-8859-1) + picture type(1) +
    //   description(null-terminated ISO-8859-1) + picture data
    const mimeBuf = Buffer.from(mime, 'ascii')
    const apicBody = Buffer.concat([
        Buffer.from([0x00]),       // text encoding: ISO-8859-1（兼容性最好）
        mimeBuf,
        Buffer.from([0x00]),       // MIME null terminator
        Buffer.from([0x03]),       // picture type: 3 = front cover
        Buffer.from([0x00]),       // description: empty + null terminator
        coverBuf                   // picture data
    ])
    // APIC frame header（v2.3: size 是普通 4 字节大端序，非 syncsafe）
    const apicFrame = Buffer.concat([
        Buffer.from('APIC', 'ascii'),
        Buffer.from([(apicBody.length >>> 24) & 0xFF, (apicBody.length >>> 16) & 0xFF,
                     (apicBody.length >>> 8) & 0xFF, apicBody.length & 0xFF]),
        Buffer.from([0x00, 0x00]), // frame flags
        apicBody
    ])

    const fileBuf = fs.readFileSync(songPath)
    let newFileBuf

    if (fileBuf.length >= 10 && fileBuf.toString('ascii', 0, 3) === 'ID3') {
        const version = fileBuf[3]          // major version (3=v2.3, 4=v2.4)
        const headerSize = readSyncsafe(fileBuf, 6)
        const headerEnd = 10 + headerSize

        // 解析现有 frames，跳过旧 APIC
        const frames = []
        let offset = 10
        while (offset + 10 <= headerEnd) {
            const id = fileBuf.toString('ascii', offset, offset + 4)
            if (id.charCodeAt(0) === 0) break  // padding 区域
            let fsize
            if (version >= 4) {
                fsize = readSyncsafe(fileBuf, offset + 4)
            } else {
                fsize = fileBuf.readUInt32BE(offset + 4)
            }
            if (fsize <= 0 || offset + 10 + fsize > headerEnd) break
            const fflags = fileBuf.readUInt16BE(offset + 8)
            const fbody = fileBuf.subarray(offset + 10, offset + 10 + fsize)
            if (id !== 'APIC') {
                frames.push({ id, body: fbody, flags: fflags })
            }
            offset += 10 + fsize
        }

        // 追加标准 APIC frame
        frames.push({ id: 'APIC', body: apicBody, flags: 0 })

        // 重新构建所有 frame（统一用 v2.3 格式：size 为普通大端序）
        const allFrames = Buffer.concat(frames.map(f => {
            const fid = Buffer.from(f.id.padEnd(4).slice(0, 4), 'ascii')
            const fsize = Buffer.alloc(4)
            fsize.writeUInt32BE(f.body.length, 0)
            const fflags = Buffer.alloc(2)
            fflags.writeUInt16BE(f.flags || 0, 0)
            return Buffer.concat([fid, fsize, fflags, f.body])
        }))

        // 新 ID3v2.3 header
        const newHeader = Buffer.concat([
            Buffer.from('ID3', 'ascii'),
            Buffer.from([0x03, 0x00]),    // version 2.3.0
            Buffer.from([0x00]),          // flags
            writeSyncsafe(allFrames.length)
        ])
        const audioData = fileBuf.subarray(headerEnd)
        newFileBuf = Buffer.concat([newHeader, allFrames, audioData])
    } else {
        // 无 ID3v2 header，直接在文件头插入
        const newHeader = Buffer.concat([
            Buffer.from('ID3', 'ascii'),
            Buffer.from([0x03, 0x00]),
            Buffer.from([0x00]),
            writeSyncsafe(apicFrame.length)
        ])
        newFileBuf = Buffer.concat([newHeader, apicFrame, fileBuf])
    }

    fs.writeFileSync(songPath, newFileBuf)
}

// MP3 写入 (NodeID3 写文本标签 + ffmpeg 写标准 APIC frame)
async function saveMP3Metadata(songPath, metadata, coverBuf, coverMime, lyrics) {
    // 第一步：用 NodeID3 写入文本标签和歌词（不写封面，封面由 ffmpeg 写入确保标准兼容）
    const tags = {
        title: metadata.title || '', artist: metadata.artist || '',
        album: metadata.album || '', year: metadata.year || '',
        genre: metadata.genre || '', trackNumber: metadata.track || ''
    }
    if (lyrics) tags.unsynchronisedLyrics = { language: 'chi', text: lyrics }
    const success = NodeID3.write(tags, songPath)
    if (!success) throw new Error('ID3写入失败')

    // 第二步：用 ffmpeg 写入标准 ID3v2.3 APIC frame（最可靠，所有播放器/云盘都能识别）
    if (coverBuf && coverBuf.length > 0) {
        try {
            await writeMP3CoverWithFfmpeg(songPath, coverBuf, coverMime)
            console.log('[saveMP3Metadata] cover written (ffmpeg APIC):', { mime: coverMime, size: coverBuf.length })
        } catch (e) {
            // ffmpeg 失败时 fallback 到手动构建标准 APIC frame
            console.warn('[saveMP3Metadata] ffmpeg cover failed, fallback to manual APIC:', e.message)
            writeMP3CoverStandard(songPath, coverBuf, coverMime)
            console.log('[saveMP3Metadata] cover written (manual APIC fallback):', { mime: coverMime, size: coverBuf.length })
        }
        // 验证封面是否真的写入
        try {
            const read = NodeID3.read(songPath)
            console.log('[saveMP3Metadata] verify after write:', { hasImage: !!read.image, imageMime: read.image?.mime, imageSize: read.image?.imageBuffer?.length })
        } catch (e) {
            console.warn('[saveMP3Metadata] verify read failed:', e.message)
        }
    }
}

ipcMain.handle('read-song-metadata', async (_, songPath) => {
    try {
        const metadata = await (await getMM()).parseFile(songPath)
        const ext = path.extname(songPath).toLowerCase()
        const result = {
            title: metadata.common.title || '',
            artist: metadata.common.artist || '',
            album: metadata.common.album || '',
            year: metadata.common.year || '',
            genre: metadata.common.genre?.[0] || '',
            track: metadata.common.track?.no || '',
            hasCover: !!(metadata.common.picture?.length),
            lyrics: metadata.common.lyrics?.[0]?.text || '',
            format: ext.replace('.', '').toUpperCase()
        }
        // 提取封面 base64
        if (metadata.common.picture?.length) {
            const pic = metadata.common.picture[0]
            const base64 = Buffer.from(pic.data).toString('base64')
            result.coverData = `data:${pic.format};base64,${base64}`
        }
        return { success: true, metadata: result }
    } catch (err) { return { success: false, error: err.message } }
})

// 解析本地音频文件元数据（基于文件路径，避免大 Buffer 跨进程序列化导致 OOM）
// 用于云盘上传前预填歌名/歌手/封面
ipcMain.handle('parse-upload-file', async (_, filePath) => {
    try {
        const metadata = await (await getMM()).parseFile(filePath)
        const result = {
            title: metadata.common.title || '',
            artist: metadata.common.artist || '',
            album: metadata.common.album || '',
            hasCover: !!(metadata.common.picture?.length)
        }
        if (metadata.common.picture?.length) {
            const pic = metadata.common.picture[0]
            const base64 = Buffer.from(pic.data).toString('base64')
            result.coverData = `data:${pic.format};base64,${base64}`
            result.coverMime = pic.format
        }
        return { success: true, metadata: result }
    } catch (err) { return { success: false, error: err.message } }
})

// 将元数据（歌名/歌手/专辑/封面/歌词）写入本地音频文件，返回写入后的文件路径
// MP3 用 NodeID3，OGG/OPUS 用 Vorbis comment METADATA_BLOCK_PICTURE，其他用 ffmpeg attached_pic
// 构建 Vorbis METADATA_BLOCK_PICTURE base64（FLAC picture format）
function buildVorbisCoverBase64(imageBuf, mime) {
    const mimeBuf = Buffer.from(mime || 'image/jpeg', 'utf-8')
    const descBuf = Buffer.from('', 'utf-8')
    // 4(pictureType) + 4(mimeLen) + mime + 4(descLen) + desc + 4(w) + 4(h) + 4(depth) + 4(colors) + 4(dataLen) + data
    const buf = Buffer.alloc(4 + 4 + mimeBuf.length + 4 + descBuf.length + 16 + 4 + imageBuf.length)
    let offset = 0
    buf.writeUInt32BE(3, offset); offset += 4              // picture type: front cover
    buf.writeUInt32BE(mimeBuf.length, offset); offset += 4
    mimeBuf.copy(buf, offset); offset += mimeBuf.length
    buf.writeUInt32BE(descBuf.length, offset); offset += 4
    descBuf.copy(buf, offset); offset += descBuf.length
    buf.writeUInt32BE(0, offset); offset += 4               // width
    buf.writeUInt32BE(0, offset); offset += 4               // height
    buf.writeUInt32BE(0, offset); offset += 4               // color depth
    buf.writeUInt32BE(0, offset); offset += 4               // number of colors
    buf.writeUInt32BE(imageBuf.length, offset); offset += 4
    imageBuf.copy(buf, offset)
    return buf.toString('base64')
}

// ============ OGG/Opus Vorbis Comment 二进制注入器 ============
// 直接操作 OGG 二进制结构，无命令行长度限制，支持写入原始大封面和歌词
// OGG CRC32 (多项式 0x04c11db7，无反射)
const OGG_CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        let r = i << 24
        for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? (((r << 1) ^ 0x04c11db7) >>> 0) : ((r << 1) >>> 0)
        t[i] = r >>> 0
    }
    return t
})()
function oggCrc32(buf) {
    let crc = 0
    for (let i = 0; i < buf.length; i++) {
        crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0
    }
    return crc >>> 0
}

// 解析整个 OGG 文件的所有 pages
function parseOggPages(buf) {
    const pages = []
    let offset = 0
    while (offset + 27 <= buf.length) {
        if (buf.toString('ascii', offset, offset + 4) !== 'OggS') break
        const headerType = buf[offset + 5]
        const granuleLow = buf.readUInt32LE(offset + 6)
        const granuleHigh = buf.readUInt32LE(offset + 10)
        const serial = buf.readUInt32LE(offset + 14)
        const seqNo = buf.readUInt32LE(offset + 18)
        const numSegs = buf[offset + 26]
        const segTable = []
        let payloadLen = 0
        for (let i = 0; i < numSegs; i++) {
            segTable.push(buf[offset + 27 + i])
            payloadLen += buf[offset + 27 + i]
        }
        const payloadStart = offset + 27 + numSegs
        const payload = buf.slice(payloadStart, payloadStart + payloadLen)
        pages.push({ headerType, granuleLow, granuleHigh, serial, seqNo, segTable, payload, startOffset: offset, totalSize: 27 + numSegs + payloadLen })
        offset = payloadStart + payloadLen
    }
    return pages
}

// 构建 OGG page bytes
function buildOggPage(headerType, granuleLow, granuleHigh, serial, seqNo, segTable, payload) {
    const header = Buffer.alloc(27 + segTable.length)
    header.write('OggS', 0, 'ascii')
    header[5] = headerType
    header.writeUInt32LE(granuleLow, 6)
    header.writeUInt32LE(granuleHigh, 10)
    header.writeUInt32LE(serial, 14)
    header.writeUInt32LE(seqNo, 18)
    header.writeUInt32LE(0, 22)  // CRC 占位
    header[26] = segTable.length
    for (let i = 0; i < segTable.length; i++) header[27 + i] = segTable[i]
    const fullPage = Buffer.concat([header, payload])
    const crc = oggCrc32(fullPage)
    fullPage.writeUInt32LE(crc, 22)
    return fullPage
}

// 将大 packet 分割成多个 OGG pages
// 每页最多 254 个 255-segment（留 1 个槽位给 end marker），payload 最多 254*255=64770 bytes
function packetToOggPages(packetData, serial, startSeqNo) {
    const pages = []
    const MAX_SEGMENTS = 254  // 保守值，留 1 个给 end marker
    let offset = 0, seqNo = startSeqNo, isFirst = true
    while (offset < packetData.length) {
        const remaining = packetData.length - offset
        const segTable = []
        let chunkSize = 0
        if (remaining <= MAX_SEGMENTS * 255) {
            // 这页能放完剩余数据
            chunkSize = remaining
            const numFull = Math.floor(chunkSize / 255)
            const remainder = chunkSize % 255
            for (let i = 0; i < numFull; i++) segTable.push(255)
            if (remainder > 0) segTable.push(remainder)
            else if (chunkSize > 0) segTable.push(0)  // end marker
        } else {
            // 这页放不下，放 MAX_SEGMENTS 个 255-segment（packet 继续到下一页）
            chunkSize = MAX_SEGMENTS * 255
            for (let i = 0; i < MAX_SEGMENTS; i++) segTable.push(255)
        }
        const chunk = packetData.slice(offset, offset + chunkSize)
        const headerType = isFirst ? 0 : 1  // 后续页设 continuation flag
        pages.push(buildOggPage(headerType, 0, 0, serial, seqNo, segTable, chunk))
        offset += chunkSize
        seqNo++
        isFirst = false
    }
    return pages
}

// 注入 OGG/Opus Vorbis comment（保留原有 comments，替换/添加/删除指定 keys）
// updates: { KEY: value | null }，null 表示删除该 key
// 使用 segment 级别精确提取 comment header packet，正确处理 comment 与 setup header 共享 page 的情况
function injectOggComments(filePath, updates) {
    const buf = fs.readFileSync(filePath)
    const pages = parseOggPages(buf)
    if (pages.length < 2) throw new Error('OGG page 数量异常')

    const serial = pages[0].serial

    // 从 page 1 开始按 segment 提取第一个完整 packet（comment header）
    // 同时记录 packet 结束所在 page 的剩余 segments（可能是 setup header 或 audio data）
    let commentPacket = Buffer.alloc(0)
    let commentEndPageIdx = -1
    let remainingSegsInEndPage = []  // comment packet 结束后，同一 page 中的剩余 segments
    let remainingPayloadInEndPage = Buffer.alloc(0)
    let remainingHeaderType = 0
    let foundPacketEnd = false

    for (let pageIdx = 1; pageIdx < pages.length && !foundPacketEnd; pageIdx++) {
        const pg = pages[pageIdx]
        let payloadPos = 0
        for (let s = 0; s < pg.segTable.length; s++) {
            const segLen = pg.segTable[s]
            commentPacket = Buffer.concat([commentPacket, pg.payload.slice(payloadPos, payloadPos + segLen)])
            payloadPos += segLen
            if (segLen < 255) {
                // comment packet 结束
                commentEndPageIdx = pageIdx
                foundPacketEnd = true
                // 收集剩余 segments（属于后续 packets）
                for (let s2 = s + 1; s2 < pg.segTable.length; s2++) {
                    remainingSegsInEndPage.push(pg.segTable[s2])
                    remainingPayloadInEndPage = Buffer.concat([remainingPayloadInEndPage, pg.payload.slice(payloadPos, payloadPos + pg.segTable[s2])])
                    payloadPos += pg.segTable[s2]
                }
                remainingHeaderType = pg.headerType
                break
            }
        }
    }
    if (!foundPacketEnd) throw new Error('无法找到 comment header packet 结束')

    // 判断格式并解析
    let isOpus = false, magicLen = 7
    if (commentPacket.length >= 7 && commentPacket[0] === 3 && commentPacket.toString('ascii', 1, 7) === 'vorbis') {
        isOpus = false
    } else if (commentPacket.length >= 8 && commentPacket.toString('ascii', 0, 8) === 'OpusTags') {
        isOpus = true; magicLen = 8
    } else {
        throw new Error('无法识别的 comment header 格式')
    }

    const magic = commentPacket.slice(0, magicLen)
    let pos = magicLen
    const vendorLen = commentPacket.readUInt32LE(pos); pos += 4
    const vendor = commentPacket.slice(pos, pos + vendorLen); pos += vendorLen
    let commentCount = commentPacket.readUInt32LE(pos); pos += 4
    let comments = []
    for (let i = 0; i < commentCount; i++) {
        const len = commentPacket.readUInt32LE(pos); pos += 4
        comments.push(commentPacket.slice(pos, pos + len).toString('utf-8'))
        pos += len
    }

    // 修改 comments：移除 updates 指定的 keys（大小写不敏感），再添加新值
    const updateKeysUpper = Object.keys(updates).map(k => k.toUpperCase())
    comments = comments.filter(c => {
        const eq = c.indexOf('=')
        return eq < 0 || !updateKeysUpper.includes(c.slice(0, eq).toUpperCase())
    })
    for (const [k, v] of Object.entries(updates)) {
        if (v != null) comments.push(`${k}=${v}`)
    }

    // 重建 comment packet
    const parts = [magic]
    const vl = Buffer.alloc(4); vl.writeUInt32LE(vendor.length); parts.push(vl, vendor)
    const cl = Buffer.alloc(4); cl.writeUInt32LE(comments.length); parts.push(cl)
    for (const c of comments) {
        const cb = Buffer.from(c, 'utf-8')
        const lb = Buffer.alloc(4); lb.writeUInt32LE(cb.length); parts.push(lb, cb)
    }
    if (!isOpus) parts.push(Buffer.from([1]))  // Vorbis framing bit
    const newPacket = Buffer.concat(parts)

    // 将新 comment packet 分页（seqNo 从 1 开始）
    const newCommentPages = packetToOggPages(newPacket, serial, 1)

    // 如果原 comment 结束 page 有剩余数据（setup header 或 audio data 的开始），
    // 保持其 segment table 不变，作为单独的 page 追加
    let extraPage = null
    if (remainingSegsInEndPage.length > 0) {
        extraPage = buildOggPage(remainingHeaderType, 0, 0, serial, 1 + newCommentPages.length, remainingSegsInEndPage, remainingPayloadInEndPage)
    }

    // 后续 pages（commentEndPageIdx + 1 开始）调整 seqNo
    const newHeaderPageCount = newCommentPages.length + (extraPage ? 1 : 0)
    const oldHeaderPageCount = commentEndPageIdx  // page 1 到 commentEndPageIdx（含）
    const seqNoOffset = newHeaderPageCount - oldHeaderPageCount

    // 重组文件
    const outputParts = []
    // page 0 原样保留
    outputParts.push(buf.slice(0, pages[1].startOffset))
    // 新 comment pages
    for (const p of newCommentPages) outputParts.push(p)
    // 剩余数据页（如果有）
    if (extraPage) outputParts.push(extraPage)
    // 后续 pages 调整 seqNo + 重算 CRC
    for (let i = commentEndPageIdx + 1; i < pages.length; i++) {
        const pg = pages[i]
        const orig = buf.slice(pg.startOffset, pg.startOffset + pg.totalSize)
        const nb = Buffer.from(orig)
        nb.writeUInt32LE(pg.seqNo + seqNoOffset, 18)
        nb.writeUInt32LE(0, 22)
        nb.writeUInt32LE(oggCrc32(nb), 22)
        outputParts.push(nb)
    }
    fs.writeFileSync(filePath, Buffer.concat(outputParts))
}

// 用 ffmpeg 压缩封面到指定大小（用于 Vorbis comment，避免 base64 超过命令行长度限制）
async function compressCoverForVorbis(coverBuf) {
    const tmpDir = app.getPath('temp')
    const inPath = path.join(tmpDir, 'vorbis_in_' + Date.now() + '.jpg')
    const outPath = path.join(tmpDir, 'vorbis_out_' + Date.now() + '.jpg')
    try {
        fs.writeFileSync(inPath, coverBuf)
        // 逐级压缩：先用较大尺寸，若 base64 仍超限则递减尺寸/质量
        // 目标：base64 < 28000（留余量，命令行参数上限约 30000）
        const presets = [
            { scale: 256, q: 8 },
            { scale: 200, q: 10 },
            { scale: 160, q: 12 },
            { scale: 128, q: 15 }
        ]
        for (const preset of presets) {
            await new Promise((resolve, reject) => {
                execFile(getFfmpegPath(), [
                    '-y', '-i', inPath,
                    '-vf', `scale=${preset.scale}:${preset.scale}:force_original_aspect_ratio=decrease`,
                    '-q:v', String(preset.q),
                    outPath
                ], { timeout: 15000 }, (err) => {
                    if (err) { reject(new Error('ffmpeg compress failed: ' + err.message)); return }
                    resolve()
                })
            })
            const buf = fs.readFileSync(outPath)
            const b64Len = Math.ceil(buf.length * 4 / 3) + 60  // 预估 base64 长度（含 METADATA_BLOCK_PICTURE 头部开销）
            if (b64Len < 28000) {
                return buf
            }
            console.log(`[vorbis-cover] preset ${preset.scale}x q${preset.q} -> ${buf.length}B (b64~${b64Len}), still too large, trying next`)
        }
        // 所有预设都不够小，返回最后一个结果（最小那个）
        return fs.readFileSync(outPath)
    } catch (e) {
        console.warn('[vorbis-cover] compress failed, using original:', e.message)
        return coverBuf
    } finally {
        try { fs.unlinkSync(inPath) } catch (e) {}
        try { fs.unlinkSync(outPath) } catch (e) {}
    }
}

// OGG/OPUS/FLAC 等 Vorbis comment 格式
const VORBIS_COMMENT_EXT = ['.ogg', '.opus', '.oga']
const FLAC_EXT = '.flac'

// 读取文件头判断音频实际格式（解决扩展名与内容不符的问题，如 .mp3 实为 FLAC）
// 返回: 'mp3' | 'flac' | 'ogg' | 'wav' | 'm4a' | 'mp4' | null
function detectActualAudioFormat(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r')
        const header = Buffer.alloc(12)
        const bytesRead = fs.readSync(fd, header, 0, 12, 0)
        fs.closeSync(fd)
        if (bytesRead < 4) return null
        // fLaC
        if (header.toString('ascii', 0, 4) === 'fLaC') return 'flac'
        // OggS
        if (header.toString('ascii', 0, 4) === 'OggS') return 'ogg'
        // RIFF....WAVE
        if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') return 'wav'
        // MP3 帧同步 (0xFF Ex)
        if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) return 'mp3'
        // ftyp box (M4A/MP4): offset 4-8 = 'ftyp'
        if (bytesRead >= 8 && header.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
        // ID3v2 开头：跳过 ID3v2 标签后继续检测实际音频格式（可能 ID3v2+fLaC / ID3v2+MP3）
        if (header.toString('ascii', 0, 3) === 'ID3') {
            if (bytesRead < 10) return 'mp3'
            // ID3v2 size 是 syncsafe integer（每字节最高位不用）
            const id3Size = ((header[6] & 0x7F) << 21) | ((header[7] & 0x7F) << 14) |
                           ((header[8] & 0x7F) << 7) | (header[9] & 0x7F)
            const afterId3Offset = 10 + id3Size
            // 读取 ID3v2 标签之后的数据
            const fd2 = fs.openSync(filePath, 'r')
            const afterBuf = Buffer.alloc(12)
            const afterRead = fs.readSync(fd2, afterBuf, 0, 12, afterId3Offset)
            fs.closeSync(fd2)
            if (afterRead >= 4) {
                if (afterBuf.toString('ascii', 0, 4) === 'fLaC') return 'flac'
                if (afterBuf.toString('ascii', 0, 4) === 'OggS') return 'ogg'
                if (afterBuf.toString('ascii', 0, 4) === 'RIFF' && afterRead >= 12 && afterBuf.toString('ascii', 8, 12) === 'WAVE') return 'wav'
                if (afterBuf[0] === 0xFF && (afterBuf[1] & 0xE0) === 0xE0) return 'mp3'
            }
            // ID3v2 后无法识别，默认 MP3
            return 'mp3'
        }
        return null
    } catch (e) {
        return null
    }
}

// FLAC 二进制注入 Vorbis comment + PICTURE 块（不经过 ffmpeg，不压缩，支持原始大封面+歌词）
// FLAC 结构: fLaC(4) + METADATA_BLOCK* + AUDIO_FRAME*
// METADATA_BLOCK: block_type(1字节,高位为last标志) + block_length(3字节) + block_data
// block_type: 0=STREAMINFO(必须保留) 1=PADDING 2=APPLICATION 3=SEEKTABLE 4=VORBIS_COMMENT 5=CUESHEET 6=PICTURE
// updates.METADATA_BLOCK_PICTURE 必须是 FLAC PICTURE 块的二进制 Buffer（用 buildFlacPictureBlock 构造）
function injectFlacComments(filePath, updates) {
    const buf = fs.readFileSync(filePath)
    // 支持 ID3v2 前置标签的 FLAC 文件（如 .mp3 实为 FLAC 且被 NodeID3 写过 ID3v2）
    // FLAC 标准不应有 ID3v2 前置标签，这里自动移除以恢复标准 FLAC 结构
    let flacStart = 0
    if (buf.length >= 3 && buf.toString('latin1', 0, 3) === 'ID3') {
        // 跳过 ID3v2 标签
        if (buf.length < 10) throw new Error('文件过小')
        const id3Size = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) |
                       ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F)
        flacStart = 10 + id3Size
        console.log('[injectFlacComments] 检测到 ID3v2 前置标签,已移除:', { id3Size, flacStart })
    }
    if (buf.length < flacStart + 4 || buf.toString('latin1', flacStart, flacStart + 4) !== 'fLaC') {
        throw new Error('非有效 FLAC 文件')
    }
    let pos = flacStart + 4
    const blocks = []
    // 1. 解析所有 metadata block
    while (pos < buf.length) {
        const isLast = (buf[pos] & 0x80) !== 0
        const type = buf[pos] & 0x7F
        const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]
        const dataStart = pos + 4
        const dataEnd = dataStart + len
        if (dataEnd > buf.length) throw new Error('FLAC 块长度越界')
        blocks.push({ type, isLast, data: buf.slice(dataStart, dataEnd) })
        pos = dataEnd
        if (isLast) break  // 最后一个 metadata block，之后是音频帧
    }
    if (blocks.length === 0 || blocks[0].type !== 0) {
        throw new Error('FLAC 缺少 STREAMINFO 块')
    }
    // 2. 构建新的 VORBIS_COMMENT 块数据
    //    格式: vendor_length(4 LE) + vendor_string + comment_count(4 LE) + comment*
    //    comment: length(4 LE) + "KEY=value" (UTF-8)
    const vendorStr = 'trae-music-editor'
    const vendorBuf = Buffer.from(vendorStr, 'utf-8')
    const comments = []
    const targetKeys = new Set(Object.keys(updates).map(k => k.toUpperCase()))
    const oldVc = blocks.find(b => b.type === 4)
    if (oldVc) {
        let p = 0
        const vlen = oldVc.data.readUInt32LE(p); p += 4
        p += vlen  // skip vendor
        const count = oldVc.data.readUInt32LE(p); p += 4
        for (let i = 0; i < count; i++) {
            const clen = oldVc.data.readUInt32LE(p); p += 4
            const cstr = oldVc.data.toString('utf-8', p, p + clen); p += clen
            const eqIdx = cstr.indexOf('=')
            if (eqIdx > 0) {
                const k = cstr.substring(0, eqIdx).toUpperCase()
                if (!targetKeys.has(k) && k !== 'METADATA_BLOCK_PICTURE') {
                    comments.push(cstr)
                }
            }
        }
    }
    for (const [k, v] of Object.entries(updates)) {
        if (v != null && k !== 'METADATA_BLOCK_PICTURE') {
            comments.push(`${k.toUpperCase()}=${v}`)
        }
    }
    const commentBufs = comments.map(c => {
        const cb = Buffer.from(c, 'utf-8')
        const lenBuf = Buffer.alloc(4)
        lenBuf.writeUInt32LE(cb.length, 0)
        return Buffer.concat([lenBuf, cb])
    })
    const vcData = Buffer.concat([
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(vendorBuf.length, 0); return b })(),
        vendorBuf,
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(comments.length, 0); return b })(),
        ...commentBufs
    ])
    // 3. 重新组装文件: fLaC + blocks(保留非 VC/PICTURE/PADDING，添加新 VC 和 PICTURE) + 音频帧
    const audioData = buf.slice(pos)
    const outBlocks = []
    for (const b of blocks) {
        if (b.type === 4 || b.type === 6 || b.type === 1) continue  // 跳过旧 VC/PICTURE/PADDING
        outBlocks.push({ type: b.type, data: b.data })
    }
    outBlocks.push({ type: 4, data: vcData })
    if (updates.METADATA_BLOCK_PICTURE != null) {
        outBlocks.push({ type: 6, data: updates.METADATA_BLOCK_PICTURE })
    }
    // 写入: fLaC + 所有块（最后一个标记 isLast）+ 音频帧
    const parts = [Buffer.from('fLaC', 'latin1')]
    for (let i = 0; i < outBlocks.length; i++) {
        const isLast = (i === outBlocks.length - 1)
        const header = Buffer.alloc(4)
        header[0] = (isLast ? 0x80 : 0x00) | (outBlocks[i].type & 0x7F)
        header[1] = (outBlocks[i].data.length >> 16) & 0xFF
        header[2] = (outBlocks[i].data.length >> 8) & 0xFF
        header[3] = outBlocks[i].data.length & 0xFF
        parts.push(header, outBlocks[i].data)
    }
    parts.push(audioData)
    fs.writeFileSync(filePath, Buffer.concat(parts))
}

// 构建 FLAC PICTURE 块二进制数据（type=3 前封面）
// 格式: type(4 BE) + mime_len(4 BE) + mime + desc_len(4 BE) + desc + width(4 BE) + height(4 BE) + color_depth(4 BE) + colors(4 BE) + data_len(4 BE) + data
function buildFlacPictureBlock(imageBuf, mime) {
    const mimeBuf = Buffer.from(mime || 'image/jpeg', 'utf-8')
    const descBuf = Buffer.from('', 'utf-8')
    const parts = []
    const typeBuf = Buffer.alloc(4)
    typeBuf.writeUInt32BE(3, 0)  // 3 = front cover
    parts.push(typeBuf)
    const mimeLenBuf = Buffer.alloc(4)
    mimeLenBuf.writeUInt32BE(mimeBuf.length, 0)
    parts.push(mimeLenBuf, mimeBuf)
    const descLenBuf = Buffer.alloc(4)
    descLenBuf.writeUInt32BE(descBuf.length, 0)
    parts.push(descLenBuf, descBuf)
    const dimBuf = Buffer.alloc(16)  // width(4) + height(4) + color_depth(4) + colors(4)，全 0
    parts.push(dimBuf)
    const dataLenBuf = Buffer.alloc(4)
    dataLenBuf.writeUInt32BE(imageBuf.length, 0)
    parts.push(dataLenBuf, imageBuf)
    return Buffer.concat(parts)
}

// 从 data URL 解析真实 mime 类型
function getCoverMime(coverDataUrl) {
    if (!coverDataUrl || !coverDataUrl.startsWith('data:')) return 'image/jpeg'
    const m = coverDataUrl.match(/^data:([^;]+)/)
    return m ? m[1] : 'image/jpeg'
}

ipcMain.handle('write-upload-file', async (_, { filePath, metadata, coverDataUrl, lyrics }) => {
    try {
        const ext = path.extname(filePath).toLowerCase()
        // 优先用文件头判断实际格式（解决扩展名与内容不符的问题，如 .mp3 实为 FLAC）
        const actualFmt = detectActualAudioFormat(filePath)
        const fmt = actualFmt || ext.replace('.', '')
        const coverMime = getCoverMime(coverDataUrl)
        let coverBuf = await resizeCover(coverDataUrl)
        if (actualFmt && actualFmt !== ext.replace('.', '') && actualFmt !== 'm4a') {
            console.log('[write-upload-file] 格式与扩展名不符,按实际格式处理:', { ext, actualFmt, filePath })
        }
        // MP3：NodeID3 写文本标签 + ffmpeg 写标准 APIC frame（确保跨应用兼容）
        if (fmt === 'mp3') {
            const tags = {
                title: metadata?.title || '',
                artist: metadata?.artist || '',
                album: metadata?.album || ''
            }
            if (lyrics) tags.unsynchronisedLyrics = { language: 'chi', text: lyrics }
            const success = NodeID3.write(tags, filePath)
            if (!success) throw new Error('ID3写入失败')
            if (coverBuf) {
                try {
                    await writeMP3CoverWithFfmpeg(filePath, coverBuf, coverMime)
                } catch (e) {
                    console.warn('[write-upload-file] ffmpeg cover failed, fallback:', e.message)
                    writeMP3CoverStandard(filePath, coverBuf, coverMime)
                }
            }
            console.log('[write-upload-file] MP3 written OK:', { title: tags.title, coverMime, coverSize: coverBuf?.length, hasLyrics: !!lyrics })
            return { success: true, path: filePath }
        }
        // OGG/OPUS：完全用二进制注入 Vorbis comment（不经过 ffmpeg，不压缩，支持原始大封面+歌词）
        if (fmt === 'ogg' || fmt === 'opus' || fmt === 'oga') {
            const updates = {}
            if (metadata?.title) updates.TITLE = metadata.title
            if (metadata?.artist) updates.ARTIST = metadata.artist
            if (metadata?.album) updates.ALBUM = metadata.album
            if (coverBuf) {
                updates.METADATA_BLOCK_PICTURE = buildVorbisCoverBase64(coverBuf, coverMime)
                console.log('[write-upload-file] OGG inject cover (no ffmpeg, no compress):', { size: coverBuf.length, mime: coverMime, b64Len: updates.METADATA_BLOCK_PICTURE.length })
            }
            if (lyrics) updates.LYRICS = lyrics
            injectOggComments(filePath, updates)
            console.log('[write-upload-file] OGG comment injected OK (pure binary, no ffmpeg)')
            return { success: true, path: filePath }
        }
        // FLAC：纯二进制注入 Vorbis comment + PICTURE 块
        if (fmt === 'flac') {
            const updates = {}
            if (metadata?.title) updates.TITLE = metadata.title
            if (metadata?.artist) updates.ARTIST = metadata.artist
            if (metadata?.album) updates.ALBUM = metadata.album
            if (metadata?.year) updates.DATE = metadata.year
            if (metadata?.genre) updates.GENRE = metadata.genre
            if (metadata?.track) updates.TRACKNUMBER = metadata.track
            if (lyrics) updates.LYRICS = lyrics
            if (coverBuf) {
                updates.METADATA_BLOCK_PICTURE = buildFlacPictureBlock(coverBuf, coverMime)
                console.log('[write-upload-file] FLAC inject cover:', { size: coverBuf.length, mime: coverMime })
            }
            injectFlacComments(filePath, updates)
            console.log('[write-upload-file] FLAC injected OK')
            return { success: true, path: filePath }
        }
        // FLAC/M4A/WAV 等：ffmpeg attached_pic 方式
        const tmpOut = filePath + '.tmp' + ext
        await new Promise((resolve, reject) => {
            const args = ['-y', '-i', filePath]
            const coverFile = saveCoverTempFile(coverBuf)
            if (coverFile) args.push('-i', coverFile)
            if (metadata?.title) args.push('-metadata', `title=${metadata.title}`)
            if (metadata?.artist) args.push('-metadata', `artist=${metadata.artist}`)
            if (metadata?.album) args.push('-metadata', `album=${metadata.album}`)
            if (lyrics) args.push('-metadata', `lyrics=${lyrics}`)
            if (coverFile) {
                args.push('-map', '0', '-map', '1', '-c', 'copy', '-disposition:v', 'attached_pic')
            } else {
                args.push('-c', 'copy')
            }
            args.push(tmpOut)
            execFile(getFfmpegPath(), args, { timeout: 30000 }, (err) => {
                if (coverFile) { try { fs.unlinkSync(coverFile) } catch (e) {} }
                if (err) { try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut) } catch (e) {}; reject(new Error('ffmpeg写入失败: ' + err.message)); return }
                resolve()
            })
        })
        fs.copyFileSync(tmpOut, filePath)
        try { fs.unlinkSync(tmpOut) } catch (e) {}
        return { success: true, path: filePath }
    } catch (err) { return { success: false, error: err.message } }
})

// 云盘上传文件选择对话框（支持多选，返回路径数组）
ipcMain.handle('open-cloud-upload-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'm4a', 'ape', 'ogg', 'aac', 'wma'] }]
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths  // 返回数组
})

// 选择封面图片对话框，返回 dataURL
ipcMain.handle('open-cover-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    })
    if (canceled || filePaths.length === 0) return null
    try {
        const buf = fs.readFileSync(filePaths[0])
        const ext = path.extname(filePaths[0]).slice(1).toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext
        return `data:image/${mime};base64,${buf.toString('base64')}`
    } catch (e) { return null }
})

// 选择歌词文件（.lrc/.txt），返回文本内容
ipcMain.handle('open-lyrics-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }]
    })
    if (canceled || filePaths.length === 0) return null
    try {
        const content = fs.readFileSync(filePaths[0], 'utf-8')
        return content
    } catch (e) { return null }
})

// 流式计算文件 MD5（不一次性读入内存，避免大文件 OOM）
function calculateFileMD5Stream(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5')
        const stream = fs.createReadStream(filePath)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('end', () => resolve(hash.digest('hex')))
        stream.on('error', reject)
    })
}

// 云盘完整上传（主进程内完成，避免大 Buffer 跨进程序列化）
// 参数: { filePath, filename, cookie, apiBaseUrl, song, artist, album }
// complete 始终传 song/artist/album（参考官方示例）
// 服务器默认自动匹配网易云歌曲，取消匹配由渲染进程上传后调用 matchCloud API
// 进度通过 event.sender.send('cloud-upload-progress', { progress, status, filename }) 推送
ipcMain.handle('cloud-upload', async (event, { filePath, filename, cookie, apiBaseUrl, song, artist, album }) => {
    const sendProgress = (progress, status) => {
        try { event.sender.send('cloud-upload-progress', { progress, status, filename }) } catch (e) {}
    }
    try {
        const stat = fs.statSync(filePath)
        sendProgress(0, '计算文件指纹...')
        // 1. 流式 MD5
        const md5 = await calculateFileMD5Stream(filePath)
        sendProgress(0, '获取上传凭证...')
        // 2. 获取上传凭证
        const tokenRes = await axios.post(`${apiBaseUrl}/cloud/upload/token`, {
            cookie, md5, fileSize: stat.size, filename
        })
        if (tokenRes.data.code !== 200) {
            return { success: false, error: tokenRes.data.message || tokenRes.data.msg || '获取上传凭证失败' }
        }
        const tokenInfo = tokenRes.data.data || {}
        const { needUpload, songId, resourceId, uploadUrl, uploadToken } = tokenInfo
        if (!songId || !resourceId) {
            console.error('[cloud-upload] token missing songId/resourceId:', tokenInfo)
            return { success: false, error: '上传凭证缺少必要字段（songId/resourceId）' }
        }
        // 3. 秒传或 POST 文件流到云存储
        if (needUpload && uploadUrl) {
            sendProgress(0, '上传中...')
            // 根据扩展名设置正确的 Content-Type，避免服务器按错误格式处理
            const ext = path.extname(filePath).toLowerCase()
            const contentTypeMap = {
                '.mp3': 'audio/mpeg',
                '.flac': 'audio/flac',
                '.ogg': 'audio/ogg',
                '.opus': 'audio/ogg',
                '.oga': 'audio/ogg',
                '.m4a': 'audio/mp4',
                '.aac': 'audio/aac',
                '.wav': 'audio/wav'
            }
            const contentType = contentTypeMap[ext] || 'audio/mpeg'
            const nosRes = await new Promise((resolve, reject) => {
                const stream = fs.createReadStream(filePath)
                let uploaded = 0
                stream.on('data', (chunk) => {
                    uploaded += chunk.length
                    const p = Math.round((uploaded / stat.size) * 100)
                    sendProgress(p, '上传中...')
                })
                axios.post(uploadUrl, stream, {
                    headers: {
                        'x-nos-token': uploadToken,
                        'Content-MD5': md5,
                        'Content-Type': contentType,
                        'Content-Length': String(stat.size)
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 0,
                    validateStatus: () => true
                }).then(resolve).catch(reject)
            })
            if (nosRes.status !== 200) {
                console.error('[cloud-upload] NOS upload failed:', nosRes.status, nosRes.statusText, typeof nosRes.data === 'string' ? nosRes.data.substring(0, 500) : nosRes.data)
                return { success: false, error: `云存储上传失败（HTTP ${nosRes.status}）` }
            }
        } else {
            sendProgress(100, '秒传命中，完成导入...')
            console.log('[cloud-upload] 秒传命中（MD5 已存在），songId 可能是之前上传的同内容文件')
        }
        // 4. 完成导入（带重试，服务器处理上传数据需要时间）
        // complete 始终传 song/artist/album（参考官方示例实现）
        sendProgress(100, '完成导入...')
        await new Promise(r => setTimeout(r, 2000))
        let completeRes = null
        const completeParams = {
            cookie, songId, resourceId, md5, filename,
            song: song || filename.replace(/\.[^.]+$/, ''),
            artist: artist || '未知艺术家',
            album: album || '未知专辑'
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                completeRes = await axios.post(`${apiBaseUrl}/cloud/upload/complete`, completeParams)
                if (completeRes.data.code === 200) break
                console.warn(`[cloud-upload] complete attempt ${attempt + 1} failed:`, completeRes.data.code, completeRes.data.msg)
            } catch (e) {
                console.warn(`[cloud-upload] complete attempt ${attempt + 1} error:`, e.message)
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, 3000))
        }
        if (!completeRes || completeRes.data.code !== 200) {
            console.error('[cloud-upload] complete final failed:', completeRes?.data)
            return { success: false, error: completeRes?.data?.message || completeRes?.data?.msg || '导入失败' }
        }
        console.log('[cloud-upload] upload success:', { songId, resourceId, needUpload })
        return { success: true, songId, resourceId, needUpload: !!needUpload }
    } catch (err) {
        console.error('Cloud upload error:', err)
        return { success: false, error: err.message || '上传失败' }
    }
})

ipcMain.handle('save-song-metadata', async (_, { songPath, metadata, coverDataUrl, lyrics }) => {
    try {
        const ext = path.extname(songPath).toLowerCase()
        // 优先用文件头判断实际格式（解决扩展名与内容不符的问题，如 .mp3 实为 FLAC）
        const actualFmt = detectActualAudioFormat(songPath)
        const isMP3 = actualFmt === 'mp3' || (actualFmt === null && ext === '.mp3')
        const isVorbis = actualFmt === 'ogg' || (actualFmt === null && VORBIS_COMMENT_EXT.includes(ext))
        const isFlac = actualFmt === 'flac' || (actualFmt === null && ext === FLAC_EXT)
        const SUPPORTED_SAVE_EXTENSIONS = [...AUDIO_EXTENSIONS, '.mp4']
        if (!isMP3 && !isVorbis && !isFlac && !SUPPORTED_SAVE_EXTENSIONS.includes(ext)) {
            return { success: false, error: `暂不支持 ${ext} 格式（实际 ${actualFmt || '未知'}）的元数据写入（支持 MP3/FLAC/OGG/WAV/M4A 等）` }
        }
        if (actualFmt && actualFmt !== ext.replace('.', '') && actualFmt !== 'm4a') {
            console.log('[save-song-metadata] 格式与扩展名不符,按实际格式处理:', { ext, actualFmt, songPath })
        }

        // 备份原文件
        const backupPath = songPath + '.bak'
        fs.copyFileSync(songPath, backupPath)

        try {
            const coverMime = getCoverMime(coverDataUrl)
            const coverBuf = await resizeCover(coverDataUrl)
            if (isMP3) {
                // MP3：NodeID3 写文本 + ffmpeg 写标准 APIC frame（支持封面/歌词）
                await saveMP3Metadata(songPath, metadata, coverBuf, coverMime, lyrics)
            } else if (isVorbis) {
                // OGG/Opus：纯二进制注入 Vorbis comment（不压缩，支持原始大封面+歌词）
                const updates = {}
                if (metadata?.title) updates.TITLE = metadata.title
                if (metadata?.artist) updates.ARTIST = metadata.artist
                if (metadata?.album) updates.ALBUM = metadata.album
                if (metadata?.date) updates.DATE = metadata.date
                if (metadata?.genre) updates.GENRE = metadata.genre
                if (metadata?.track) updates.TRACKNUMBER = metadata.track
                if (coverBuf) updates.METADATA_BLOCK_PICTURE = buildVorbisCoverBase64(coverBuf, coverMime)
                if (lyrics) updates.LYRICS = lyrics
                injectOggComments(songPath, updates)
            } else if (isFlac) {
                // FLAC：纯二进制注入 Vorbis comment + PICTURE 块（不压缩，支持原始大封面+歌词）
                const updates = {}
                if (metadata?.title) updates.TITLE = metadata.title
                if (metadata?.artist) updates.ARTIST = metadata.artist
                if (metadata?.album) updates.ALBUM = metadata.album
                if (metadata?.year) updates.DATE = metadata.year
                if (metadata?.genre) updates.GENRE = metadata.genre
                if (metadata?.track) updates.TRACKNUMBER = metadata.track
                if (lyrics) updates.LYRICS = lyrics
                // FLAC PICTURE 块是二进制格式，不是 base64，直接构造
                if (coverBuf) {
                    updates.METADATA_BLOCK_PICTURE = buildFlacPictureBlock(coverBuf, coverMime)
                }
                injectFlacComments(songPath, updates)
            } else {
                // M4A/WAV 等：ffmpeg attached_pic
                await saveWithFfmpeg(songPath, metadata, coverBuf, lyrics)
            }

            // 验证写入后文件是否可读
            const stat = fs.statSync(songPath)
            if (stat.size < 1024) throw new Error('写入后文件异常小，可能已损坏')

            fs.unlinkSync(backupPath)
            return { success: true }
        } catch (writeErr) {
            if (fs.existsSync(backupPath)) {
                fs.copyFileSync(backupPath, songPath)
                fs.unlinkSync(backupPath)
            }
            throw writeErr
        }
    } catch (err) { return { success: false, error: err.message } }
})

// 下载封面图片到本地歌曲同目录
ipcMain.handle('download-cover-for-song', async (_, { songPath, coverUrl }) => {
    try {
        if (!coverUrl || !songPath) return { success: false, error: '参数不全' }
        const response = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 15000 })
        const songDir = path.dirname(songPath)
        const songBase = path.basename(songPath, path.extname(songPath))
        const coverPath = path.join(songDir, songBase + '.jpg')
        fs.writeFileSync(coverPath, Buffer.from(response.data))
        console.log('[Cover] 封面已保存:', coverPath)
        return { success: true, coverPath }
    } catch (err) {
        console.error('[Cover] 下载封面失败:', err.message)
        return { success: false, error: err.message }
    }
})

// 打开文件所在文件夹
ipcMain.handle('show-item-in-folder', async (_, filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath)
            return { success: true }
        } else {
            // 如果文件不存在，尝试打开父文件夹
            const dir = path.dirname(filePath)
            if (fs.existsSync(dir)) {
                shell.openPath(dir)
                return { success: true }
            }
            return { success: false, error: '路径不存在' }
        }
    } catch (err) {
        return { success: false, error: err.message }
    }
})

app.on('window-all-closed', () => {
    // Don't quit on window close if tray icon exists
})

app.on('before-quit', () => {
    // 退出前停止 QQ 音乐 API 子进程
    stopQQMusicAPI()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
})
