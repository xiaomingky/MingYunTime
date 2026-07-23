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

// 动漫模块
import './anime.js'
import './anime-meta.js'
import './movie.js'
// 统一下载管理器（aria2c 多线程 + ffmpeg + 历史记录）
import { setDownloadManagerWindow, delegateStartDownload, delegateCancelDownload } from './download-manager.js'

// --- Win7 兼容性初始化 ---
if (process.platform === 'win32') {
    // 强制使用软件渲染或特定的渲染限制会导致严重卡顿。
    // 我们采取“稳健模式”：限制高负载 GL 特性，但保留基本硬件加速。
    app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('ignore-gpu-blacklist');
    // 如果在极旧的 Win7 上崩溃，可以尝试取消注释下面这行进行彻底降级
    // app.disableHardwareAcceleration(); 
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')

// 设置正式名称，确保对话框标题正确
app.name = '茗韵时光'

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
        backgroundColor: '#ffffff', // Win7 下防止透明窗口闪烁
        icon: path.join(process.env.VITE_PUBLIC, 'icon.png'), // 设置图标
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false // 允许跨域
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
        }
    })

    // 接入统一下载管理器
    setDownloadManagerWindow(win)

    // 为 B站 CDN 请求注入 Referer（B站视频流需要 Referer: https://www.bilibili.com/ 才能访问）
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://*.bilivideo.com/*', 'http://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'http://*.bilivideo.cn/*'] },
        (details, callback) => {
            details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
            details.requestHeaders['User-Agent'] = PARSE_UA
            callback({ requestHeaders: details.requestHeaders })
        }
    )
    // 为 B站图片 CDN 注入 Referer（头像等图片有防盗链，需要 Referer: https://www.bilibili.com/）
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://*.hdslb.com/*', 'http://*.hdslb.com/*'] },
        (details, callback) => {
            details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
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
            webSecurity: false
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

// 鼠标悬停检测：动态控制窗口穿透（锁定/未锁定都生效）
ipcMain.on('lyric-card-hover', (_, hovering) => {
    if (!lyricWin) return
    if (isLocked) {
        lyricWin.setIgnoreMouseEvents(!hovering, { forward: true })
    } else {
        lyricWin.setIgnoreMouseEvents(!hovering, { forward: true })
    }
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
                al: { name: '本地磁盘', picUrl: '' }
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
            format: ext.replace('.', '').toUpperCase()
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

        // === B站专用解析 ===
        if (/bilibili\.com|b23\.tv/i.test(target)) {
            const biliResult = await parseBilibili(target, addStream)
            if (biliResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: biliResult.title || '', pageUrl: target }
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

    // 2. song-cover 协议 (带兜底逻辑)
    protocol.registerBufferProtocol('song-cover', async (request, callback) => {
        try {
            const urlStr = request.url
            const hasStaticParam = urlStr.includes('?static=1')
            let filePath = decodeURIComponent(urlStr.replace('song-cover:///', '').replace('?static=1', ''))

            if (process.platform === 'win32') {
                filePath = path.normalize(filePath)
            }

            if (!fs.existsSync(filePath)) return callback({ statusCode: 404 })

            // 提取内嵌
            try {
                const metadata = await (await getMM()).parseFile(filePath)
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                    const pic = metadata.common.picture[0]
                    // 如果要求静态图片且内嵌的是GIF，则跳过使用兜底图
                    if (hasStaticParam && pic.format === 'image/gif') {
                        // 跳过GIF，继续查找其他图片
                    } else {
                        return callback({ mimeType: pic.format, data: pic.data })
                    }
                }
            } catch (e) { }

            // 提取同目录图片 (gif > png > jpg > webp)
            const dir = path.dirname(filePath)
            const baseName = path.basename(filePath, path.extname(filePath))
            const exts = hasStaticParam ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.gif', '.png', '.jpg', '.jpeg', '.webp']
            for (const ext of exts) {
                const imgPath = path.join(dir, baseName + ext)
                if (fs.existsSync(imgPath)) {
                    const mime = ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
                    return callback({ mimeType: mime, data: fs.readFileSync(imgPath) })
                }
            }

            // 默认兜底图 (通过 axios 请求)
            const defaultUrl = 'https://p2.music.126.net/6y-U6QnSjd_5419m1B0R_g==/109951165034938831.jpg'
            const response = await axios.get(defaultUrl, { responseType: 'arraybuffer' })
            callback({ mimeType: 'image/jpeg', data: Buffer.from(response.data) })
        } catch (e) {
            callback({ statusCode: 500 })
        }
    })

    createWindow()
    createTray()
    // 启动后 5 秒检测更新
    setTimeout(checkForUpdates, 5000)
})

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

async function resizeCover(coverDataUrl) {
    if (!coverDataUrl || !coverDataUrl.startsWith('data:')) return null
    const [mime, b64] = coverDataUrl.split(';base64,')
    let imgBuf = Buffer.from(b64, 'base64')
    if (imgBuf.length > 500 * 1024) {
        try {
            const sharp = require('sharp')
            imgBuf = await sharp(imgBuf).resize(600, 600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
        } catch (e) {
            console.warn('[save-metadata] sharp not available, skipping large cover:', e.message)
            return null
        }
    }
    return imgBuf && imgBuf.length > 0 ? imgBuf : null
}

function saveCoverTempFile(coverBuf) {
    if (!coverBuf) return null
    const tmpDir = app.getPath('temp')
    const tmpPath = path.join(tmpDir, 'cover_' + Date.now() + '.jpg')
    fs.writeFileSync(tmpPath, coverBuf)
    return tmpPath
}

// 用 ffmpeg 写入元数据（支持 FLAC/OGG/WAV/M4A 等所有格式）
function saveWithFfmpeg(songPath, metadata, coverBuf) {
    return new Promise((resolve, reject) => {
        const tmpOut = songPath + '.tmp'
        const args = ['-y', '-i', songPath]
        
        const metaFields = [
            ['title', metadata.title], ['artist', metadata.artist],
            ['album', metadata.album], ['date', metadata.year],
            ['genre', metadata.genre], ['track', metadata.track]
        ]
        for (const [key, val] of metaFields) {
            if (val) args.push('-metadata', `${key}=${val}`)
        }
        
        const coverFile = saveCoverTempFile(coverBuf)
        if (coverFile) args.push('-i', coverFile, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v', 'attached_pic')
        else args.push('-c', 'copy')
        
        args.push(tmpOut)
        
        execFile('ffmpeg', args, { timeout: 30000 }, (err, stdout, stderr) => {
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

// MP3 写入 (NodeID3，不需要 ffmpeg)
function saveMP3Metadata(songPath, metadata, coverBuf) {
    const tags = {
        title: metadata.title || '', artist: metadata.artist || '',
        album: metadata.album || '', year: metadata.year || '',
        genre: metadata.genre || '', trackNumber: metadata.track || ''
    }
    if (coverBuf) tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: coverBuf }
    const success = NodeID3.write(tags, songPath)
    if (!success) throw new Error('ID3写入失败')
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

ipcMain.handle('save-song-metadata', async (_, { songPath, metadata, coverDataUrl }) => {
    try {
        const ext = path.extname(songPath).toLowerCase()
        const isMP3 = ext === '.mp3'
        const SUPPORTED_SAVE_EXTENSIONS = [...AUDIO_EXTENSIONS, '.mp4']
        if (!isMP3 && !SUPPORTED_SAVE_EXTENSIONS.includes(ext)) {
            return { success: false, error: `暂不支持 ${ext} 格式的元数据写入（支持 MP3/FLAC/OGG/WAV/M4A 等）` }
        }

        // 备份原文件
        const backupPath = songPath + '.bak'
        fs.copyFileSync(songPath, backupPath)

        try {
            const coverBuf = await resizeCover(coverDataUrl)
            if (isMP3) {
                saveMP3Metadata(songPath, metadata, coverBuf)
            } else {
                await saveWithFfmpeg(songPath, metadata, coverBuf)
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

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
})
