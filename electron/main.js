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
import { exec, execFile, spawn } from 'node:child_process'
import https from 'node:https'
import crypto from 'node:crypto'
import os from 'node:os'

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
import { setDownloadManagerWindow, delegateStartDownload, delegateCancelDownload, getYtDlpPath } from './download-manager.js'
// 抖音 a_bogus 签名：逐字加载 video-parser 原始 a_bogus.js（sloppy mode，vm 执行），
// 与 Python 版（py-mini-racer 执行同一文件）签名逐位一致；?raw 打包时把源码内联进 bundle。
import vm from 'node:vm'
import abogusSource from './a_bogus.origin.js?raw'
import { generateABogus as generateABogusPort } from './douyin-abogus.js'
// 2026-07 新版 a_bogus（移植自 douyin_parse/DLWangSan abogus.py）：旧版(video-parser)算法已被抖音风控拦截
import { generateABogusV2 } from './douyin-abogus-v2.js'
let generateABogus = null
try {
    const _abogusCtx = vm.createContext({ console })
    vm.runInContext(abogusSource, _abogusCtx)
    if (typeof _abogusCtx.generate_a_bogus === 'function') generateABogus = _abogusCtx.generate_a_bogus
} catch (e) { generateABogus = null }
if (!generateABogus) generateABogus = generateABogusPort  // 兜底：本地移植版（算法一致）
// 多平台歌词搜索（QQ + 酷狗）—— 必须用静态 import，否则 vite 打包后 dist-electron 下找不到模块
import { searchMultiPlatform, fetchLyricByCandidate, searchAndFetchQQ, getKugouLyric } from './lyric-providers.js'
// QQ 音乐 API 子进程(@sansenjian/qq-music-api,监听 3200 端口)
import { startQQMusicAPI, stopQQMusicAPI } from './qq-music.js'
// 酷狗音乐 API 子进程(KuGouMusicApi,监听 3300 端口,platform=lite 概念版)
import { startKugouMusicAPI, stopKugouMusicAPI } from './kugou-music.js'
import { startNeteaseAPI, stopNeteaseAPI } from './netease-api.js'

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
                // B站 mcdn 备用 CDN（edge.mountaintoys.cn），同样需注入 Referer/UA
                'https://*.edge.mountaintoys.cn/*', 'http://*.edge.mountaintoys.cn/*',
                // Twitch CDN 域名（usher/playlist/hls）— Twitch CDN 防盗链较宽松，但仍注入 Origin/Referer 以防万一
                'https://*.ttvnw.net/*', 'http://*.ttvnw.net/*',
                'https://*.hls.ttvnw.net/*', 'http://*.hls.ttvnw.net/*',
                // 虎牙 CDN 域名（flv.huya.com / hls.huya.com）
                'https://*.flv.huya.com/*', 'http://*.flv.huya.com/*',
                'https://*.hls.huya.com/*', 'http://*.hls.huya.com/*',
                // 斗鱼 CDN 域名（douyucdn / douyuscdn / hdslb）
                'https://*.douyucdn.com/*', 'http://*.douyucdn.com/*',
                'https://*.douyuscdn.com/*', 'http://*.douyuscdn.com/*',
                'https://*.douyucdn2.com/*', 'http://*.douyucdn2.com/*',
                // 抖音 CDN 域名（点播：douyinvod/bytecdn 等最终 CDN + www.douyin.com 播放跳转接口，
                // 必须带 douyin Referer + 浏览器 UA 才能播放/下载，否则 CDN 返回 403）
                'https://*.douyincdn.com/*', 'http://*.douyincdn.com/*',
                'https://*.amemv.com/*', 'http://*.amemv.com/*',
                'https://live.douyin.com/*', 'http://live.douyin.com/*',
                'https://*.douyinvod.com/*', 'http://*.douyinvod.com/*',
                'https://*.bytecdn.cn/*', 'http://*.bytecdn.cn/*',
                'https://*.byteimg.com/*', 'http://*.byteimg.com/*',
                'https://*.ixigua.com/*', 'http://*.ixigua.com/*',
                'https://*.snssdk.com/*', 'http://*.snssdk.com/*',
                'https://*.iesdouyin.com/*', 'http://*.iesdouyin.com/*',
                'https://www.douyin.com/*', 'http://www.douyin.com/*',
                // YouTube CDN（googlevideo 直链 + youtubei）
                'https://*.googlevideo.com/*', 'http://*.googlevideo.com/*',
                'https://*.youtube.com/*', 'http://*.youtube.com/*',
                'https://i.ytimg.com/*', 'https://i9.ytimg.com/*'
            ]
        },
        (details, callback) => {
            const u = details.url
            // TV 接口流（platform=android_tv_yst 签名的 upos/mcdn URL）：必须用 BilibiliTV UA 且不能带 Referer，
            // 2026-08-26 实测：带浏览器 UA 或 bili Referer 一律 403，仅 BilibiliTV UA + 无 Referer 返回 200
            if (/platform=android_tv_yst/i.test(u)) {
                details.requestHeaders['User-Agent'] = BILI_TV_UA
                delete details.requestHeaders['Referer']
                delete details.requestHeaders['Origin']
                callback({ requestHeaders: details.requestHeaders })
                return
            }
            if (/bilivideo\.(com|cn)|hdslb\.com|mcdn|mountaintoys\.cn/i.test(u)) {
                details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
                // mcdn/edge.mountaintoys.cn 与 bilivideo 一样需要浏览器 UA，否则 403
                if (/bilivideo\.(com|cn)|edge\.mountaintoys\.cn|mcdn/i.test(u)) {
                    details.requestHeaders['User-Agent'] = PARSE_UA
                }
                // 播放分片同样需要登录 Cookie，否则高清/会员画质会 403（下载分支已注入，播放分支补上）
                try {
                    const bCookies = loadBiliCookie()
                    if (bCookies && bCookies.SESSDATA) {
                        details.requestHeaders['Cookie'] = biliCookieString(bCookies)
                    }
                } catch (e) { /* ignore */ }
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
            } else if (/douyincdn\.com|amemv\.com|douyin\.com|douyinvod\.com|bytecdn\.cn|byteimg\.com|ixigua\.com|snssdk\.com|iesdouyin\.com/i.test(u)) {
                // 抖音点播 CDN：注入 www.douyin.com Referer + 浏览器 UA（否则 douyinvod 等最终 CDN 返回 403）
                // 2026-08-25 实测：不带 Referer/UA 请求最终 CDN 返回 403 text/html，带上后返回 200 video/mp4
                details.requestHeaders['Referer'] = 'https://www.douyin.com/'
                details.requestHeaders['User-Agent'] = PARSE_UA
            } else if (/googlevideo\.com|youtube\.com/i.test(u)) {
                // YouTube CDN：注入来源 + 浏览器 UA，避免直链/分片 403
                details.requestHeaders['Referer'] = 'https://www.youtube.com/'
                details.requestHeaders['Origin'] = 'https://www.youtube.com'
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
        // 本地识别格式：文件标签缺失时按设置从文件名解析出 歌名/作者（"歌名 - 作者" 或 "作者 - 歌名"）
        const parsedNameInfo = parseLocalFileName(path.basename(filePath, path.extname(filePath)), (readMusicNaming() || {}).local)
        try {
            const metadata = await (await getMM()).parseFile(filePath)
            const name = metadata.common.title || parsedNameInfo?.name || path.basename(filePath, path.extname(filePath))
            const artist = metadata.common.artist || parsedNameInfo?.artist || '未知歌手'

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
                name: parsedNameInfo?.name || path.basename(filePath, path.extname(filePath)),
                artist: parsedNameInfo?.artist || '本地音乐', ar: [{ name: parsedNameInfo?.artist || '本地音乐' }],
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

// 线上歌曲用：酷狗歌词直接获取（按 hash，不走搜索匹配）
ipcMain.handle('get-kugou-lyric', async (_, { hash }) => {
    try {
        if (!hash) return { lrc: '', yrc: '', trans: '' }
        return await getKugouLyric(hash)
    } catch (err) {
        return { lrc: '', yrc: '', trans: '', error: err.message }
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
ipcMain.handle('video-download', async (_, { url, name, headers, type, category, audioUrl, ytSrc, ytHeight }) => {
    // 委托给统一下载管理器，category 由调用方指定（mv/movie/anime/video），默认 video
    // audioUrl: DASH 音视频分离时，下载后由 ffmpeg 流复制合并（B站高画质，极快）
    // ytSrc/ytHeight: YouTube 视频时交给 yt-dlp 下载（自动合并音视频为 mp4）
    // B站视频流（bilivideo CDN）需带 Referer + 登录 Cookie 才能访问，否则 403
    let h = headers
    if (/bilivideo\.(com|cn)/i.test(url || '')) {
        const cookies = loadBiliCookie()
        h = Object.assign({}, headers || {})
        h['Referer'] = 'https://www.bilibili.com/'
        h['User-Agent'] = PARSE_UA
        if (cookies && cookies.SESSDATA) {
            h['Cookie'] = biliCookieString(cookies)
        }
    }
    // YouTube 登录状态：仅在已登录(令牌已缓存)时让 yt-dlp 开启 OAuth 账号画质
    let ytAuthed = false
    if (ytSrc && youtubeIsLoggedIn()) ytAuthed = true
    return delegateStartDownload({ url, name, headers: h, type, category: category || 'video', audioUrl, ytSrc, ytHeight, ytAuthed })
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
// ===== 快手视频解析（无水印）=====
// 原理（移植自 F:/xiangmu/video-parser）：
//   快手网页 SSR 注入 window.__APOLLO_STATE__，其中：
//     - VisionVideoSetRepresentation:N.url  为无水印视频直链
//     - VisionVideoDetailPhoto:N.caption / coverUrl  为标题与封面
//     - VisionVideoDetailPhoto:N.photoManifest.adaptationSet[].representation[] 为全画质清单（含宽高/质量名）
//   提取所有可用画质（直链 mp4），优先复用可靠的 Vision 直链，photoManifest 仅补充直链 mp4 档位。
// 把快手的 Representation 条目解析成画质标签（宽高优先，质量名兜底）
function kuaishouRatioFromRep(rep) {
    if (!rep || typeof rep !== 'object') return ''
    const w = Number(rep.width) || 0
    const h = Number(rep.height) || 0
    if (w > 0 || h > 0) {
        const r = ratioFromHeight(Math.max(w, h))
        if (r) return r
    }
    const label = String(rep.qualityLabel || '')
    if (!label) return ''
    const lm = label.match(/4k|2k|\d{3,4}\s?p/i)
    if (lm) return lm[0].toLowerCase().replace(/\s+/g, '')
    if (/fhd|超清/i.test(label)) return '1080p'
    if (/hd|高清/i.test(label)) return '720p'
    if (/sd|标清/i.test(label)) return '480p'
    if (/流畅|fluent/i.test(label)) return '360p'
    return ''
}
function extractKuaishouFromApollo(root) {
    if (!root || typeof root !== 'object') return {}
    const dc = (root.defaultClient && typeof root.defaultClient === 'object') ? root.defaultClient : root
    let videoUrl = '', caption = '', coverUrl = ''
    const qualities = []
    const seen = new Set()
    const ratioByUrl = {}
    // 1) 全部 VisionVideoSetRepresentation:N 直链（已知可靠）
    const reprKeys = Object.keys(dc).filter(k => /VisionVideoSetRepresentation/i.test(k))
        .sort((a, b) => {
            const na = parseInt((a.match(/:(\d+)/) || [])[1] || '0', 10)
            const nb = parseInt((b.match(/:(\d+)/) || [])[1] || '0', 10)
            return na - nb
        })
    for (const k of reprKeys) {
        const o = dc[k]
        if (o && typeof o.url === 'string') {
            const u = o.url.replace(/\\u002F/g, '/')
            if (u && !seen.has(u)) {
                seen.add(u)
                qualities.push({ url: u, ratio: '' })
            }
        }
    }
    // 2) 标题 / 封面 + photoManifest 全画质清单（仅补充直链 mp4，避免 m3u8 播放异常）
    const photoKeys = Object.keys(dc).filter(k => /VisionVideoDetailPhoto/i.test(k))
    if (photoKeys[0] && dc[photoKeys[0]]) {
        const o = dc[photoKeys[0]]
        if (typeof o.caption === 'string') caption = o.caption
        if (typeof o.coverUrl === 'string') coverUrl = o.coverUrl
        const manifest = o.photoManifest
        if (manifest && typeof manifest === 'object' && Array.isArray(manifest.adaptationSet)) {
            const tmpReps = []
            for (const as of manifest.adaptationSet) {
                if (!as || typeof as !== 'object' || !Array.isArray(as.representation)) continue
                for (const rep of as.representation) {
                    if (!rep || typeof rep !== 'object') continue
                    const lst = rep.urlLst || rep.urls || rep.playUrlList || []
                    const first = Array.isArray(lst) && lst.length ? String(lst[0]) : ''
                    const u = String(first || rep.url || '').replace(/\\u002F/g, '/')
                    if (!u) continue
                    const ratio = kuaishouRatioFromRep(rep)
                    if (ratio) ratioByUrl[u] = ratio
                    tmpReps.push({ url: u, ratio, ext: String(rep.ext || '').toLowerCase(), withAudio: rep.withAudio !== false })
                }
            }
            // 直链 mp4 才补充为独立档位；已被 Vision 收录的同 URL 只回填画质标签
            for (const r of tmpReps) {
                if (!/\.mp4(\?|$)/i.test(r.url) && r.ext !== 'mp4') continue
                const u = r.url
                if (seen.has(u)) {
                    if (r.ratio) {
                        const f = qualities.find(q => q.url === u)
                        if (f && !f.ratio) f.ratio = r.ratio
                    }
                    continue
                }
                seen.add(u)
                qualities.push({ url: u, ratio: r.ratio })
            }
        }
    }
    // 3) 排序：分辨率高的优先，无分辨率信息排最后
    const ratioOrder = { '4K': 8, '2K': 7, '1440p': 6, '1080p': 5, '720p': 4, '540p': 3, '480p': 2, '360p': 1 }
    qualities.sort((a, b) => {
        const ra = ratioOrder[a.ratio] || 0
        const rb = ratioOrder[b.ratio] || 0
        if (ra !== rb) return rb - ra
        if (a.ratio !== b.ratio) return a.ratio ? -1 : 1
        return 0
    })
    if (qualities.length) videoUrl = qualities[0].url
    return { videoUrl, caption, coverUrl, qualities }
}

// 打开隐藏窗口跑真实会话，等页面 JS 执行完成，返回窗口实例与可复用的 Cookie 头。
// 抖音/快手现已对无 Cookie 直连做风控，用真实会话（含 ttwid / 客户端注入的 __APOLLO_STATE__）才能拿到无水印直链。
function openSessionBrowser(url, { waitExtra = 3000, timeout = 30000 } = {}) {
    return new Promise((resolve) => {
        let bw = null
        let settled = false
        const finish = (r) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({ win: bw, ...r })
        }
        const timer = setTimeout(() => finish({ cookieHeader: '', timeout: true }), timeout)
        try {
            bw = new BrowserWindow({
                width: 1280, height: 800, show: false, frame: false,
                webPreferences: {
                    nodeIntegration: false, contextIsolation: true, sandbox: false,
                    webSecurity: false, images: false,
                    autoplayPolicy: 'no-user-gesture-required',
                    partition: 'temp-parser'
                }
            })
            bw.webContents.on('did-finish-load', async () => {
                // 等页面异步加载（SPA 拉取视频数据 / 设置 cookie）
                await new Promise(r => setTimeout(r, waitExtra))
                try {
                    const cookies = await bw.webContents.session.cookies.get({ url })
                    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
                    finish({ cookieHeader })
                } catch (e) { finish({ cookieHeader: '' }) }
            })
            bw.webContents.on('did-fail-load', (_, code) => {
                if (code !== -3 && code !== 0) finish({ cookieHeader: '' })
            })
            bw.webContents.loadURL(url, { userAgent: PARSE_UA }).catch(() => finish({ cookieHeader: '' }))
        } catch (e) { finish({ cookieHeader: '' }) }
    })
}

// 快手：主路径 = 跟随跳转到 short-video 落地页，带「硬编码真实 Cookie」直抓 SSR 里的 window.__APOLLO_STATE__。
// 2026-08-25 实测：分享链(kuaishou.com/f/xxx)自身 SSR 不含 Vision* 键；跳转后的 short-video 页 SSR 才含，
// 且必须带 Cookie（无 Cookie 时 SSR 同样不含视频数据）。带 Cookie 直抓已在 Node 端到端实测成功。
// 失败再依次回退 CDP 拦截 / 隐藏窗口渲染。
async function parseKuaishou(target, addStream) {
    let title = '', cover = '', added = 0

    // 1. 跟随跳转拿落地页（short-video/...）与标题
    let finalUrl = target
    try {
        const res = await axios.get(target, {
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://www.kuaishou.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' },
            responseType: 'text', timeout: 15000, validateStatus: () => true, maxRedirects: 5
        })
        finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || res.config.url || target
        const tm = (res.data || '').match(/<title>([^<]*)<\/title>/i)
        if (tm) title = tm[1].replace(/ - 快手.*$/, '').trim()
    } catch (e) {}

    // 2. 主路径：带硬编码 Cookie 直抓落地页 SSR 的 __APOLLO_STATE__（与 video-parser 一致）
    try {
        const res = await axios.get(finalUrl, {
            headers: {
                'content-type': 'application/json; charset=UTF-8',
                'User-Agent': DOUYIN_UA,
                'referer': 'https://www.kuaishou.com/',
                'cookie': KUAISHOU_COOKIE
            },
            responseType: 'text',
            timeout: 15000,
            validateStatus: () => true
        })
        const apollo = extractApolloState(res.data || '')
        const ks = extractKuaishouFromApollo(apollo)
        if (ks.videoUrl) {
            if (ks.caption) title = ks.caption
            if (ks.coverUrl) cover = ks.coverUrl
            // 多画质输出：每个档位打上 [分辨率] 标签，无标签的保留原标题
            const list = (ks.qualities && ks.qualities.length) ? ks.qualities : [{ url: ks.videoUrl, ratio: '' }]
            for (const q of list) {
                addStream(q.url, /\.m3u8(\?|$)/i.test(q.url) ? 'm3u8' : 'mp4',
                    q.ratio ? `${title} [${q.ratio}]` : title,
                    { cover: ks.coverUrl, watermarkFree: true, quality: q.ratio || '' })
                added++
            }
        }
    } catch (e) {}

    // 3. 次路径：CDP 拦截 + 持续读取客户端注入的 __APOLLO_STATE__
    if (added === 0) {
        try {
            const cdp = await parseViaCDP(finalUrl, 'kuaishou')
            if (cdp && Array.isArray(cdp.streams) && cdp.streams.length) {
                for (const s of cdp.streams) {
                    addStream(s.url, s.type, s.title || title, { cover: s.cover, watermarkFree: true })
                    added++
                }
                if (cdp.title) title = cdp.title
                if (cdp.cover) cover = cdp.cover
            }
        } catch (e) {}
    }

    // 4. 兜底：隐藏窗口 DOM / 网络抓取（已修正 CDN 域名白名单，覆盖 yximgs.com 等真实视频主机）
    if (added === 0) {
        const renderResult = await parseByHiddenWindow(target, 'kuaishou')
        if (renderResult?.title && !title) title = renderResult.title
        for (const s of (renderResult?.streams || [])) {
            addStream(s.url, s.type, title || renderResult.title, { cover: cover || undefined, watermarkFree: true })
            added++
        }
    }
    return added > 0 ? { title, cover } : null
}

// 从 HTML 中提取并解析 window.__APOLLO_STATE__（括号平衡法，兼容任意层嵌套与尾部分号/undefined）
function extractApolloState(html) {
    if (!html || typeof html !== 'string') return null
    const idx = html.indexOf('__APOLLO_STATE__')
    if (idx < 0) return null
    const start = html.indexOf('{', idx)
    if (start < 0) return null
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
    if (end < 0) return null
    let raw = html.slice(start, end + 1).replace(/;?\s*$/, '')
    raw = raw.replace(/\bundefined\b/g, 'null')
    try { return JSON.parse(raw) } catch (e) { return null }
}

// ===== 抖音视频解析（无水印）=====
// 原理（2026-08 重写，移植自 https://github.com/DLWangSan/douyin_parse abogus.py）：
//   1. 从 URL 提取 aweme_id（支持 /video/ /note/ 与 v.douyin.com 短链）
//   2. 实时向 ttwid.bytedance.com 注册「新鲜 ttwid」（旧方案硬编码 2024 Cookie 已被风控）
//   3. 调用官方 detail 接口，query 经新版 a_bogus v2 签名（generateABogusV2），
//      a_bogus 需 encodeURIComponent 后拼接，Cookie 带 ttwid + 随机 msToken
//   4. 取 video.bit_rate[0].play_addr.url_list（play_addr 即无水印直链，
//      download_addr 才带水印；再 playwm->play 双保险）
//   失败则回退到 SSR 正则 + 隐藏 BrowserWindow 渲染（仍尽量拿到直链）
function genMsToken(len = 107) {
    const base = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789='
    let s = ''
    for (let i = 0; i < len; i++) s += base[Math.floor(Math.random() * base.length)]
    return s
}
// 把响应 Set-Cookie 数组拼成请求 Cookie 头（尽量带上完整会话，提升 detail 接口通过率）
function cookiesFromSetCookie(setCookie) {
    if (!Array.isArray(setCookie)) return ''
    const parts = []
    for (const c of setCookie) {
        const m = c.match(/^([^=;]+)=([^;]*)/)
        if (m) parts.push(`${m[1]}=${m[2]}`)
    }
    return parts.join('; ')
}
function extractDouyinId(url) {
    if (!url) return ''
    let m = String(url).match(/\/video\/(\d{10,20})/)
    if (m) return m[1]
    m = String(url).match(/\/note\/([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    m = String(url).match(/douyin\.com\/(?:share\/)?(\d{10,20})/)
    if (m) return m[1]
    return ''
}
function coverFromDouyin(video) {
    if (!video) return ''
    const c1 = video.cover_original_scale && video.cover_original_scale.url_list
    if (Array.isArray(c1) && c1.length) return c1[0]
    const c2 = video.cover && video.cover.url_list
    if (Array.isArray(c2) && c2.length) return c2[0]
    return ''
}

// ===== 抖音/快手 无水印解析：忠实移植 video-parser（硬编码真实浏览器 Cookie + 原始 a_bogus）=====
// 2026-08-25 实测结论：抖音/快手已对「无 Cookie 直连」全面风控（detail 接口返回空包 / 分享页 SSR 不含视频数据），
// video-parser 之所以能用，是因为内置了真实浏览器 Cookie（抖音 ttwid+UIFID+csrf 全家桶；快手 did+kpn+webday7_st）。
// 以下 Cookie 与 F:/xiangmu/video-parser 内 Python 代码逐字一致；如官方风控升级导致失效，需从该仓库同步新 Cookie。
const DOUYIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const DOUYIN_TTWID = '1%7CvDWCB8tYdKPbdOlqwNTkDPhizBaV9i91KjYLKJbqurg%7C1723536402%7C314e63000decb79f46b8ff255560b29f4d8c57352dad465b41977db4830b4c7e'
const DOUYIN_WEBID = '7307457174287205926'
function buildDouyinCookie(refererUrl) {
    return `ttwid=${DOUYIN_TTWID}; UIFID_TEMP=973a3fd64dcc46a3490fd9b60d4a8e663b34df4ccc4bbcf97643172fb712d8b085a6744acabbffda742bf60a364e4bd6ba5522889cc6f6598b4ea0b83bec2c70bac5163dec36cdb8fb58ea1ae00a413d; s_v_web_id=verify_lzhq5z5k_lbhbXlzb_o9V2_4SQt_8VKz_WZhdN8ARwLk5; home_can_add_dy_2_desktop=%220%22; dy_swidth=1536; dy_sheight=864; stream_recommend_feed_params=%22%7B%5C%22cookie_enabled%5C%22%3Atrue%2C%5C%22screen_width%5C%22%3A1536%2C%5C%22screen_height%5C%22%3A864%2C%5C%22browser_online%5C%22%3Atrue%2C%5C%22cpu_core_num%5C%22%3A8%2C%5C%22device_memory%5C%22%3A8%2C%5C%22downlink%5C%22%3A10%2C%5C%22effective_type%5C%22%3A%5C%224g%5C%22%2C%5C%22round_trip_time%5C%22%3A50%7D%22; csrf_session_id=c25ac0fd3e72f260d4d666d4e5b59401; strategyABtestKey=%221722906710.493%22; passport_csrf_token=e8e0d86abdd80d40b0a35f4417140777; passport_csrf_token_default=e8e0d86abdd80d40b0a35f4417140777; bd_ticket_guard_client_web_domain=2; FORCE_LOGIN=%7B%22videoConsumedRemainSeconds%22%3A180%7D; fpk1=U2FsdGVkX1/MzFW4T42Rh27SkY1k9enxmP1563AOYXnpFPaQOzdqmDBHwkaQrfKGx2e0KwNeDci6fNn3aTjflw==; fpk2=362d7fe3d8b2581bffa359f0eeda7106; UIFID=973a3fd64dcc46a3490fd9b60d4a8e663b34df4ccc4bbcf97643172fb712d8b0001661437e34e9c40cd654256ca161ee16bfeed98d4c55748714f5d5e8b3961f299814cae48bfbbd1b49196b4ee347af48639652b3235c20ab5ceedde56f53b486cfba7e3400cb7f7d39bc7dbade81d368864fde51e4c52065bf7329ca6a7be919aa4b6add8afe59f8857a5fccb62199c9e66654824ef007ff13d9780400ad16; volume_info=%7B%22isUserMute%22%3Afalse%2C%22isMute%22%3Atrue%2C%22volume%22%3A0.5%7D; biz_trace_id=d2dfa5cf; bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCR1ZlY2RTY2piNWVBcHc0aVNTaTFrTThYSXdDOHNaK0NoSk16WWpyc2ZyWEYvT3VmMTB3MGpZMWpLZXdQWTFLQ0xLeERzajE5V3Y4RXlKc1U2MzlKejQ9IiwiYmQtdGlja2V0LWd1YXJkLXdlYi12ZXJzaW9uIjoxfQ%3D%3D; download_guide=%221%2F20240806%2F0%22; IsDouyinActive=false; __ac_nonce=066b1804600a583d1df8e; __ac_signature=_02B4Z6wo00f01b-.zKAAAIDA3JBBKKMofAG.n8gAAAlf52; __ac_referer=${refererUrl}`
}
const KUAISHOU_COOKIE = 'kpf=PC_WEB; clientid=3; did=web_66ce2b981cc6326ce81c6593ec91501c; userId=3978546192; kuaishou.server.webday7_st=ChprdWFpc2hvdS5zZXJ2ZXIud2ViZGF5Ny5zdBKwATXJWZrns_X3k5b6EXLF6ooCljC0gVVIPCzBhwCxWnpSihvqoREftPzm-sr8F2VyYbgWgLQ4DDNqhPAHDJ9XP5L9mqQvDejh8LnSf5_hTUDBhfmZQL9UsmohvK5xnc2CeQ_x2mXeJEm9Fg6xWe3qzvmzFgaxNDler6igGyd5uipoa-eTAr3vogs4UNuWjfwTcjYrlLjhd69ao0_PsRssIpN1JDqdmn5RW_NcaCp6ZOyPGhKFbZIQPBqwmm2qxNndD6tYkp4iIH54RTp6GjDbOO9cGXuiLNw2QAOgYTzEFhzlU9yMy_1zKAUwAQ; kuaishou.server.webday7_ph=b0edd97f04f01bde6a8f5e1a27d025a937ce; kpn=KUAISHOU_VISION'

// 2026-08-25 实测：抖音 detail 接口需要「实时注册的新鲜 ttwid」才能通过 a_bogus v2 校验。
// 每次解析都重新注册（不复用直播缓存），失败时回退到直播用的缓存 ttwid。
async function douyinRegisterTtwid() {
    try {
        const r = await axios.post('https://ttwid.bytedance.com/ttwid/union/register/',
            JSON.stringify({ region: 'cn', aid: 6383, needFid: false, service: 'https://www.douyin.com', union: true, fid: '' }),
            { headers: { 'Content-Type': 'application/json' }, timeout: 8000, validateStatus: () => true })
        const setCookie = r.headers?.['set-cookie']
        if (Array.isArray(setCookie)) {
            for (const c of setCookie) {
                const m = c.match(/ttwid=([^;]+)/)
                if (m) return m[1]
            }
        }
    } catch (e) { /* fallback */ }
    // 注册失败时回退到直播缓存的 ttwid（不强求最新）
    try { return await douyinGetTtwid() } catch (e) {}
    return DOUYIN_TTWID
}

// 根据高度（宽高中较大者）生成标准画质标签
function ratioFromHeight(h) {
    if (!h || h <= 0) return ''
    if (h >= 3840) return '4K'
    if (h >= 2560) return '2K'
    if (h >= 1920) return '1080p'
    if (h >= 1440) return '1440p'
    if (h >= 1280) return '720p'
    if (h >= 960) return '540p'
    if (h >= 854) return '480p'
    return '360p'
}
// 当分辨率信息缺失时按码率估算大致画质（如 2795Kbps ≈ 1080p），让标签更易分辨
function estimateRatioFromKbps(kbps) {
    if (!kbps || kbps <= 0) return ''
    if (kbps >= 8000) return '4K'
    if (kbps >= 5000) return '2K'
    if (kbps >= 2800) return '1080p'
    if (kbps >= 1400) return '720p'
    if (kbps >= 900) return '540p'
    if (kbps >= 500) return '480p'
    return '360p'
}
// 从 bit_rate 档位解析画质标签：优先 play_addr 的 ratio/宽高，其次 quality_type.name/gear_name 文案，
// 再尝试 URL 里的 ratio 参数，最后返回 ''（由调用方按码率估算）
function douyinRatioFrom(br, url) {
    const pa = br && br.play_addr
    if (pa && typeof pa === 'object') {
        if (typeof pa.ratio === 'string') {
            const rm = String(pa.ratio).match(/(\d+\s*p)/i)
            if (rm) return rm[1].replace(/\s+/g, '').toLowerCase()
        }
        const w = Number(pa.width) || 0
        const h = Number(pa.height) || 0
        if (w > 0 || h > 0) {
            const r = ratioFromHeight(Math.max(w, h))
            if (r) return r
        }
    }
    const qt = br && br.quality_type
    const text = String((qt && typeof qt === 'object' && qt.name) ? qt.name : '') + '\n' + String((br && br.gear_name) || '')
    if (text.trim()) {
        // 1920x1080 / 1280x720 这类宽高
        const whm = text.match(/(\d{3,4})\s*[xX×]\s*(\d{3,4})/)
        if (whm) {
            const r = ratioFromHeight(Math.max(Number(whm[1]), Number(whm[2])))
            if (r) return r
        }
        const pm = text.match(/4k/i)
        if (pm) return '4K'
        const k2m = text.match(/\b2k\b/i)
        if (k2m) return '2K'
        const dm = text.match(/(\d{3,4})\s*p/i)
        if (dm) return String(dm[1]).toLowerCase() + 'p'
        if (/超清/i.test(text)) return '1080p'
        if (/高清|蓝光/i.test(text)) return '720p'
        if (/标清/i.test(text)) return '480p'
        if (/流畅/i.test(text)) return '360p'
    }
    const um = String(url || '').match(/ratio=(\d+p)/i)
    if (um) return um[1].toLowerCase()
    return ''
}

async function parseDouyin(target, addStream) {
    let title = ''
    let added = 0
    let cover = ''

    // —— 主路径：官方 detail 接口（硬编码真实浏览器 Cookie + 原始 a_bogus，忠实移植 video-parser）——
    // 实测：带「Cookie 全家桶」才能过风控拿到无水印 play_addr；弱会话(仅 ttwid/msToken)会返回空包。
    try {
        let awemeId = extractDouyinId(target)
        if (!awemeId) {
            // 短链/分享文案：跟随跳转拿最终 URL 再提取 aweme_id 与标题
            const pageRes = await axios.get(target, {
                headers: {
                    'User-Agent': PARSE_UA,
                    'Referer': 'https://www.douyin.com/',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9'
                },
                responseType: 'text',
                timeout: 15000,
                validateStatus: () => true,
                maxRedirects: 10
            })
            const finalUrl = (pageRes.request && pageRes.request.res && pageRes.request.res.responseUrl) || pageRes.config.url || target
            awemeId = extractDouyinId(finalUrl)
            const tm = (pageRes.data || '').match(/<title>([^<]*)<\/title>/i)
            if (tm) title = tm[1].replace(/ - 抖音.*$/, '').replace(/【.*?】/g, '').trim()
        }
        if (awemeId) {
            // ===== 2026-08 实测：新版 a_bogus v2 + 新鲜注册 ttwid（移植 douyin_parse/DLWangSan abogus.py）=====
            // 旧方案（硬编码 2024 Cookie + video-parser 旧 a_bogus）已被抖音风控整体拦截（detail 返回空包），
            // 新版只需 ttwid（实时注册）+ 随机 msToken，配合 a_bogus v2 签名即可拿到完整 aweme_detail。
            const msToken = genMsToken(107)
            const referer = `https://www.douyin.com/video/${awemeId}`
            const ttwid = await douyinRegisterTtwid()
            // 与 Python 版一致：a_bogus v2 需要 URL 编码后拼接到 URL，且必须带真实 ttwid cookie
            const baseParams = {
                device_platform: 'webapp',
                aid: '6383',
                channel: 'channel_pc_web',
                pc_client_type: '1',
                version_code: '190500',
                version_name: '19.5.0',
                cookie_enabled: 'true',
                browser_language: 'zh-CN',
                browser_platform: 'Win32',
                browser_name: 'Edge',
                browser_online: 'true',
                engine_name: 'Blink',
                os_name: 'Windows',
                os_version: '10',
                platform: 'PC',
                screen_width: '1920',
                screen_height: '1080',
                aweme_id: awemeId
            }
            // 保持 Python urlencode 的参数顺序（参数值均为 URL 安全字符，直接拼接）
            const paramStr = Object.entries(baseParams).map(([k, v]) => `${k}=${v}`).join('&')
            const aBogusV2 = generateABogusV2(paramStr, 'GET')
            const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?${paramStr}&a_bogus=${encodeURIComponent(aBogusV2)}`
            const apiRes = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': DOUYIN_UA,
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Referer': referer,
                    'Origin': 'https://www.douyin.com',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Dest': 'empty',
                    'Cookie': `ttwid=${ttwid}; msToken=${msToken}`
                },
                responseType: 'text',
                timeout: 15000,
                validateStatus: () => true
            })
            let data = null
            if (apiRes.data) {
                try { data = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data } catch (e) {}
            }
            const detail = data && data.aweme_detail
            if (detail) {
                if (detail.desc) title = detail.desc
                const video = detail.video || {}
                // 多画质提取：遍历 bit_rate，每个档位输出一个独立流（参考 douyin_parse extract_video_qualities）
                // 优先 play_addr（无水印直链），down load_addr 才带水印；再 playwm->play 双保险
                const qualities = []
                const bitRate = video.bit_rate
                if (Array.isArray(bitRate) && bitRate.length) {
                    for (const br of bitRate) {
                        const ul = (br.play_addr && br.play_addr.url_list) || []
                        if (!ul.length) continue
                        let u = ul.length > 2 ? ul[2] : ul[0]
                        u = String(u || '').replace(/playwm/i, 'play')
                        if (!u || qualities.find(q => q.url === u)) continue
                        // 画质标签：尽力提取分辨率，实在拿不到再按码率估算；全失败才留空（输出时标注 Kbps）
                        let ratio = douyinRatioFrom(br, u)
                        const kbps = Math.floor((br.bit_rate || 0) / 1000)
                        if (!ratio && kbps > 0) ratio = estimateRatioFromKbps(kbps)
                        qualities.push({ url: u, ratio, kbps })
                    }
                }
                // 兜底：bit_rate 为空时取 video.play_addr
                if (!qualities.length) {
                    const ul = (video.play_addr && video.play_addr.url_list) || []
                    if (ul.length) {
                        let u = ul.length > 2 ? ul[2] : ul[0]
                        u = String(u || '').replace(/playwm/i, 'play')
                        if (u) qualities.push({ url: u, ratio: '', kbps: 0 })
                    }
                }
                // 兜底2：仍无直链时用 play_addr.uri 按常见画质构造 snssdk 播放地址（参考 douyin_parse Method 3）
                if (!qualities.length && video.play_addr && video.play_addr.uri) {
                    for (const ratio of ['1080p', '720p', '540p', '480p', '360p']) {
                        qualities.push({ url: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${video.play_addr.uri}&ratio=${ratio}&line=0`, ratio, kbps: 0 })
                    }
                }
                // 排序：4K > 2K > 1440p > 1080p > ...，同档位码率高的优先
                const ratioOrder = { '4K': 8, '2K': 7, '1440p': 6, '1080p': 5, '720p': 4, '540p': 3, '480p': 2, '360p': 1 }
                qualities.sort((a, b) => {
                    const ra = ratioOrder[a.ratio] || 0
                    const rb = ratioOrder[b.ratio] || 0
                    if (ra !== rb) return rb - ra
                    return (b.kbps || 0) - (a.kbps || 0)
                })
                // 去重后输出；画质标签放进标题括号（如 ' [1080p]'），前端按括号识别并折叠分组
                const coverUrl = coverFromDouyin(video)
                const seen = new Set()
                for (const q of qualities) {
                    if (seen.has(q.url)) continue
                    seen.add(q.url)
                    // 画质括号：首选分辨率标签，否则用码率（如 4000Kbps）
                    const qualityTag = q.ratio || (q.kbps ? `${q.kbps}Kbps` : '')
                    addStream(q.url, 'mp4', qualityTag ? `${title} [${qualityTag}]` : title,
                        { cover: coverUrl, watermarkFree: true, quality: qualityTag })
                    added++
                }
                if (added && coverUrl) cover = coverUrl
            }
        }
    } catch (e) {}

    // —— 次路径：CDP 拦截浏览器自己发出的 detail 请求（浏览器自己签名 + 带 Cookie）——
    if (added === 0) {
        try {
            const cdp = await parseViaCDP(target, 'douyin')
            if (cdp && Array.isArray(cdp.streams) && cdp.streams.length) {
                for (const s of cdp.streams) {
                    addStream(s.url, s.type, s.title || title, { cover: s.cover, watermarkFree: true })
                    added++
                }
                if (cdp.title) title = cdp.title
                if (cdp.cover) cover = cdp.cover
            }
        } catch (e) {}
    }

    // —— 回退：SSR 正则（旧版页面兜底）——
    if (added === 0) {
        try {
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
                if (!title) {
                    const tm = html.match(/<title>([^<]*)<\/title>/i)
                    if (tm) title = tm[1].replace(/ - 抖音.*$/, '').replace(/【.*?】/g, '').trim()
                }
                // 兼容旧版页面：尝试 _ROUTER_DATA / RENDER_DATA
                let routerData = null
                const m1 = html.match(/<script[^>]*id="_ROUTER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
                if (m1) { try { routerData = JSON.parse(m1[1].trim()) } catch (e) {} }
                if (!routerData) {
                    const m2 = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
                    if (m2) { try { routerData = JSON.parse(decodeURIComponent(m2[1].trim())) } catch (e) {} }
                }
                const tryAdd = (obj, depth) => {
                    if (!obj || typeof obj !== 'object' || depth > 8) return
                    if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.url)) {
                        const u = obj.url.replace(/\\\//g, '/')
                        const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
                        addStream(u, type, title, { watermarkFree: false })
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
                    if (vm) { addStream(vm[1].replace(/\\\//g, '/'), 'mp4', title, { watermarkFree: false }); added++ }
                    if (added === 0) {
                        const vm2 = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/i)
                        if (vm2) { addStream(vm2[1].replace(/\\\//g, '/'), 'mp4', title, { watermarkFree: false }); added++ }
                    }
                }
            }
        } catch (e) {}
    }

    // —— 终极回退：隐藏 BrowserWindow 渲染（让 Chromium 完整执行 JS 抓取直链）——
    if (added === 0) {
        const renderResult = await parseByHiddenWindow(target, 'douyin')
        if (renderResult?.title && !title) title = renderResult.title
        for (const s of (renderResult?.streams || [])) {
            addStream(s.url, s.type, title || renderResult.title, { watermarkFree: false })
            added++
        }
    }
    return added > 0 ? { title, cover } : null
}

// ===== 基于 CDP 请求拦截的解析（最稳：浏览器自己签名 + 带 Cookie）=====
// 用隐藏窗口加载页面，挂上 DevTools 调试器拦截页面自己发出的接口请求响应体：
//   - 抖音：拦截 .../aweme/detail 的响应，取 aweme_detail.video.bit_rate[0].play_addr（无水印直链）
//   - 快手：等客户端把视频注入 window.__APOLLO_STATE__ 后读取（VisionVideoSetRepresentation 即无水印直链）
// 不需要自己实现 a_bogus，也不用手动处理 Cookie 时效 —— 浏览器全程代劳，绝不会把推荐/广告流误判成目标视频。
async function parseViaCDP(target, source) {
    return new Promise((resolve) => {
        const result = { streams: [], title: '', cover: '', timeout: false }
        let bw = null, dbg = null, settled = false, timer = null, pollTimer = null
        const reqUrl = {}
        let triggerReqId = null
        const finish = (r) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            if (pollTimer) clearInterval(pollTimer)
            try { if (dbg && dbg.isAttached()) dbg.detach() } catch (e) {}
            try { if (bw && !bw.isDestroyed()) bw.destroy() } catch (e) {}
            resolve(r || result)
        }
        timer = setTimeout(() => { if (!result.streams.length) result.timeout = true; finish(result) }, 20000)

        const readApollo = async () => {
            if (!bw || bw.isDestroyed() || settled) return
            try {
                const raw = await bw.webContents.executeJavaScript('(function(){try{return JSON.stringify(window.__APOLLO_STATE__||null)}catch(e){return null}})()')
                if (!raw) return
                const apollo = JSON.parse(raw)
                const dc = (apollo.defaultClient && typeof apollo.defaultClient === 'object') ? apollo.defaultClient : apollo
                const ks = extractKuaishouFromApollo(dc)
                if (ks.videoUrl) {
                    if (ks.caption) result.title = ks.caption
                    if (ks.coverUrl) result.cover = ks.coverUrl
                    const list = (ks.qualities && ks.qualities.length) ? ks.qualities : [{ url: ks.videoUrl, ratio: '' }]
                    for (const q of list) {
                        result.streams.push({
                            url: q.url,
                            type: /\.m3u8(\?|$)/i.test(q.url) ? 'm3u8' : 'mp4',
                            title: q.ratio ? `${result.title} [${q.ratio}]` : result.title,
                            cover: ks.coverUrl, watermarkFree: true
                        })
                    }
                    finish(result)
                }
            } catch (e) {}
        }

        try {
            bw = new BrowserWindow({
                width: 1280, height: 800, show: false, frame: false,
                webPreferences: {
                    nodeIntegration: false, contextIsolation: true, sandbox: false,
                    webSecurity: false, images: false,
                    autoplayPolicy: 'no-user-gesture-required',
                    partition: 'temp-parser-cdp'
                }
            })
            dbg = bw.webContents.debugger
            dbg.attach('1.3')
            dbg.on('message', (event) => {
                const { method, params } = event
                if (method === 'Network.responseReceived') {
                    const url = (params.response && params.response.url) || ''
                    reqUrl[params.requestId] = url
                    if (source === 'douyin' && /aweme\/detail|\/iteminfo\//.test(url)) {
                        triggerReqId = params.requestId
                    }
                } else if (method === 'Network.loadingFinished') {
                    const url = reqUrl[params.requestId] || ''
                    if (source === 'douyin' && params.requestId === triggerReqId) {
                        ;(async () => {
                            try {
                                const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
                                const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
                                const json = JSON.parse(text)
                                const d = json && json.aweme_detail
                                if (!d) return
                                if (d.desc) result.title = d.desc
                                const video = d.video || {}
                                const coverUrl = coverFromDouyin(video)
                                if (coverUrl) result.cover = coverUrl
                                let playUrl = ''
                                const br = video.bit_rate
                                if (Array.isArray(br) && br.length) {
                                    const ul = (br[0].play_addr && br[0].play_addr.url_list) || []
                                    playUrl = ul.length > 2 ? ul[2] : (ul[0] || '')
                                }
                                if (!playUrl) {
                                    const ul = (video.play_addr && video.play_addr.url_list) || []
                                    playUrl = ul.length > 2 ? ul[2] : (ul[0] || '')
                                }
                                if (playUrl) {
                                    playUrl = playUrl.replace(/playwm/i, 'play')  // 双保险去水印
                                    // 画质标签：优先分辨率，其次按码率估算，放进标题括号供前端分组
                                    let ratio = ''
                                    const br = video.bit_rate
                                    if (Array.isArray(br) && br.length) {
                                        ratio = douyinRatioFrom(br[0], playUrl)
                                        const kbps = Math.floor((br[0].bit_rate || 0) / 1000)
                                        if (!ratio && kbps > 0) ratio = estimateRatioFromKbps(kbps)
                                    }
                                    const titleTag = ratio ? `${result.title} [${ratio}]` : result.title
                                    result.streams.push({ url: playUrl, type: 'mp4', title: titleTag, cover: coverUrl, watermarkFree: true })
                                    finish(result)
                                }
                            } catch (e) {}
                        })()
                    } else if (source === 'kuaishou' && /kuaishou\.com\/graphql/.test(url)) {
                        readApollo()
                    }
                }
            })
            dbg.sendCommand('Network.enable')
            // 抖音：页面加载后再等 12s 仍无 detail 响应就提前结束，让次级兜底（a_bogus/SSR/DOM）接管
            bw.webContents.on('did-finish-load', () => {
                if (source === 'douyin') {
                    setTimeout(() => { if (!settled && !result.streams.length) finish(result) }, 12000)
                }
            })
            // 快手兜底轮询：graphql 没命中时持续读 Apollo，直到出现 Vision 键
            if (source === 'kuaishou') pollTimer = setInterval(readApollo, 600)
            bw.webContents.loadURL(target, { userAgent: PARSE_UA }).catch(() => finish(result))
        } catch (e) { finish(result) }
    })
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
            : /kwaixia\.com|kwai\.com|gifshow\.com|kwimgs\.com|kwaicdn\.com|kscube\.com|ksapisrc\.com|yximgs\.com|kuaishou\.com|cloudshort\.live\.kuaishou\.com/i

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
// mode: 'web'（默认，网页接口+登录Cookie）| 'tv'（云视听小电视接口，无水印源，无需登录）
async function parseBilibili(target, addStream, mode = 'web') {
    const bvidInfo = await extractBvid(target)
    if (!bvidInfo) return null

    // 带上已登录的 Cookie（提升画质，大会员可解锁 4K/1080P+）
    const biliCookies = loadBiliCookie()
    const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
    const useTv = mode === 'tv'
    const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
    if (isLoggedIn && !useTv) {
        biliHeaders['Cookie'] = biliCookieString(biliCookies)
    }
    let bvid = null
    let aid = null

    // av 号转 BV 号
    if (typeof bvidInfo === 'object' && bvidInfo.aid) {
        const rawAid = bvidInfo.aid
        try {
            const r = await axios.get(`https://api.bilibili.com/x/web-interface/view?id=${rawAid}`, { headers: biliHeaders, timeout: 10000 })
            if (r.data?.code === 0) { bvid = r.data.data.bvid; aid = r.data.data.aid }
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
        if (!aid) aid = viewData.aid
    } catch (e) { return null }

    // 过滤 B站标题开头的【...】前缀（不少 UP 主会把整个标题或分类套进【】里，可能连续多层）
    const cleanBiliTitle = (t) => {
        let s = String(t || '')
        // 循环剥离开头的连续【...】前缀（如"【合集】【全B站】标题"）
        while (/^\s*【[^】]*】/u.test(s)) {
            s = s.replace(/^\s*【[^】]*】\s*/u, '')
        }
        return s.trim()
    }
    const { cid } = viewData
    const title = cleanBiliTitle(viewData.title)
    const pageTitle = title
    const qualityMap = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P' }
    const loggedInfo = isLoggedIn ? '（已登录）' : '（未登录·仅低画质）'
    let addedAny = false

    // 合集/分P：遍历所有 P（pages），每 P 各自请求 cid 对应的流
    const pages = (viewData.pages && viewData.pages.length > 0)
        ? viewData.pages
        : [{ cid, part: title }]
    const multi = pages.length > 1
    for (let pi = 0; pi < pages.length; pi++) {
        const p = pages[pi]
        const partialCid = p.cid
        // 分P标题：单P用合集原标题；多P用 [P分P号] 分P标题，作为文件名主体
        const pTitle = multi
            ? `[P${pi + 1}] ${cleanBiliTitle(p.part || `第${pi + 1}P`)}`
            : title
        let pageAdded = false

        // === 0. TV 接口模式（无需登录，无水印源）===
        if (useTv) {
            try {
                pageAdded = await biliTvParsePage({ aid, cid: partialCid, pTitle, addStream, qualityMap })
            } catch (e) { pageAdded = false }
            if (pageAdded) { addedAny = true; continue }
            // TV 接口失败时自动回退到 web 接口逻辑
        }

        // === 1. 登录后优先尝试 DASH 格式（fnval=16），可获取 4K/1080P+ 高画质（音视频分离）===
        // B站对 durl(fnval=1) 限制了高画质，登录用户的高画质必须走 DASH（音视频分离）
        // 下载时由下载管理器自动用 ffmpeg 合并 video+audio 成有声 mp4
        if (isLoggedIn) {
            try {
                const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
                    params: { bvid, cid: partialCid, qn: 127, fnval: 16, fourk: 1 },
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
                        addStream(v.baseUrl || v.base_url, 'mp4', `${pTitle} [${qLabel} 高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
                        pageAdded = true
                    })
                }
            } catch (e) {}
        }

        // === 2. 请求 durl 格式（fnval=1），完整音视频流（有声，画质取决于登录状态）===
        if (!pageAdded) {
            try {
                const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
                    params: { bvid, cid: partialCid, qn: 127, fnval: 1, fourk: 1 },
                    headers: biliHeaders,
                    timeout: 10000
                })
                if (r.data?.code === 0 && r.data.data?.durl) {
                    const durl = r.data.data.durl
                    const quality = r.data.data.quality
                    const qLabel = qualityMap[quality] || `${quality}P`
                    durl.forEach((d, i) => {
                        const partTitle = durl.length > 1
                            ? `${pTitle} [${qLabel} 完整·有声] - 第${i + 1}段${loggedInfo}`
                            : `${pTitle} [${qLabel} 完整·有声]${loggedInfo}`
                        addStream(d.url, 'mp4', partTitle, { bili: true })
                    })
                    pageAdded = true
                }
            } catch (e) {}
        }

        // === 3. 降级：尝试不同清晰度的 durl ===
        if (!pageAdded) {
            for (const qn of [80, 64, 32, 16]) {
                try {
                    const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
                        params: { bvid, cid: partialCid, qn, fnval: 1, fourk: 0 },
                        headers: biliHeaders,
                        timeout: 10000
                    })
                    if (r.data?.code === 0 && r.data.data?.durl) {
                        const durl = r.data.data.durl
                        const quality = r.data.data.quality
                        const qLabel = qualityMap[quality] || `${quality}P`
                        durl.forEach((d, i) => {
                            const partTitle = durl.length > 1
                                ? `${pTitle} [${qLabel}] - 第${i + 1}段${loggedInfo}`
                                : `${pTitle} [${qLabel}]${loggedInfo}`
                            addStream(d.url, 'mp4', partTitle, { bili: true })
                        })
                        pageAdded = true
                        break
                    }
                } catch (e) {}
            }
        }

        // === 4. 兜底：官方电影账号投稿（rights.movie=1，如「哔哩哔哩电影」）普通接口 x/player/playurl 一律 -404，
        //        必须回退 pgc 接口 pgc/player/web/playurl（bvid+cid 参数实测可用，返回 durl） ===
        if (!pageAdded) {
            try {
                const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
                    params: { bvid, cid: partialCid, qn: 127, fnval: 16, fourk: 1 },
                    headers: biliHeaders,
                    timeout: 10000,
                    validateStatus: () => true
                })
                if (r.data?.code === 0) {
                    const res = r.data.result || {}
                    if (res.durl && res.durl.length) {
                        const quality = res.quality
                        const qLabel = qualityMap[quality] || `${quality}P`
                        res.durl.forEach((d, i) => {
                            const partTitle = res.durl.length > 1
                                ? `${pTitle} [${qLabel} 电影·有声] - 第${i + 1}段${loggedInfo}`
                                : `${pTitle} [${qLabel} 电影·有声]${loggedInfo}`
                            addStream(d.url, 'mp4', partTitle, { bili: true })
                        })
                        pageAdded = true
                    } else if (res.dash && (res.dash.video || []).length) {
                        const dash = res.dash
                        const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                        const bestAudio = audios[0]
                        const audioUrl = bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : ''
                        const videos = (dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
                        const seenQ = new Set()
                        videos.forEach(v => {
                            if (seenQ.has(v.id)) return
                            seenQ.add(v.id)
                            const qLabel = qualityMap[v.id] || `${v.id}P`
                            addStream(v.baseUrl || v.base_url, 'mp4', `${pTitle} [${qLabel} 电影·高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
                            pageAdded = true
                        })
                    }
                }
            } catch (e) {}
        }

        if (pageAdded) addedAny = true
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
// mode: 'web'（默认）| 'tv'（云视听小电视接口，无水印源）
async function parseBilibiliBangumi(target, addStream, mode = 'web') {
    const idInfo = await extractBangumiId(target)
    if (!idInfo) return null

    const biliCookies = loadBiliCookie()
    const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
    const useTv = mode === 'tv'
    const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
    if (isLoggedIn && !useTv) biliHeaders['Cookie'] = biliCookieString(biliCookies)

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

    // === 0. TV 接口模式（无需登录，无水印源）===
    if (useTv) {
        try {
            addedAny = await biliTvParsePage({ aid: targetEp.aid, cid: targetEp.cid, pTitle: epTitle, addStream, bangumi: true, epId: targetEp.id, qualityMap })
        } catch (e) { addedAny = false }
        if (addedAny) return { title: epTitle }
        // TV 接口失败时自动回退到 web 接口逻辑
    }

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

// ===== Kick 直播流解析 =====
// 频道 API 返回 playback_url（m3u8），再解析 master 列表拆分多清晰度
async function parseKick(target, addStream) {
    let m = target.match(/kick\.com\/([A-Za-z0-9_-]+)/i)
    if (!m) return null
    const user = m[1]
    try {
        const r = await axios.get(`https://kick.com/api/v2/channels/${user}`, {
            headers: { 'User-Agent': PARSE_UA, 'Accept': 'application/json' },
            timeout: 15000, validateStatus: () => true
        })
        if (r.status !== 200 || !r.data) return null
        const data = r.data
        const name = data.name || data.username || user
        // 开播时 livestream 不为 null，playback_url 在 livestream 内；未开播时为 null
        const pb = (data.livestream && data.livestream.playback_url) || data.playback_url
        if (!pb) return null
        // 抓取 master.m3u8，拆分出各分辨率变体（Kick 用多码率 HLS）
        try {
            const mr = await axios.get(pb, {
                headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://kick.com/' },
                timeout: 15000, validateStatus: () => true
            })
            if (mr.status === 200 && mr.data && /#EXT-X-STREAM-INF/i.test(mr.data)) {
                const lines = (mr.data || '').split('\n')
                let attrs = null
                let added = 0
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim()
                    if (/^#EXT-X-STREAM-INF:/i.test(line)) {
                        attrs = {}
                        const rr = line.match(/RESOLUTION=(\d+)x(\d+)/)
                        const bb = line.match(/BANDWIDTH=(\d+)/)
                        if (rr) attrs.h = rr[2]
                        if (bb) attrs.kbps = Math.round(parseInt(bb[1], 10) / 1000)
                        continue
                    }
                    if (attrs && line && !line.startsWith('#')) {
                        const vUrl = /^https?:/i.test(line) ? line : new URL(line, pb).href
                        const label = attrs.h ? `Kick - ${name} [${attrs.h}p${attrs.kbps ? ' · ' + attrs.kbps + 'k' : ''}]`
                            : `Kick - ${name} [直播]`
                        addStream(vUrl, 'm3u8', label)
                        added++
                        attrs = null
                    }
                }
                if (added) return { title: name }
            }
        } catch (e) { /* 直接使用原链接 */ }
        addStream(pb, 'm3u8', `Kick - ${name} [直播]`)
        return { title: name }
    } catch (e) { /* fallthrough */ }
    return null
}

// ===== YouTube 直播/视频流解析 =====
// 用 yt-dlp 拉取 YouTube 全量元数据 + 已解签名的直播/视频直链（最可靠，自动绕过签名/consent/反爬）
function runYtDlpOnce(url, useCookie, timeoutMs) {
    return new Promise((resolve) => {
        let yt
        try { yt = getYtDlpPath() } catch (e) { return resolve(null) }
        const args = ['-J', '--skip-download', '--no-warnings', '--no-playlist']
        // 已登录（官方 Cookie）时带上账号身份，可解析会员/受限内容
        if (useCookie) {
            try {
                if (youtubeIsLoggedIn()) args.push('--cookies', YT_COOKIE_FILE())
            } catch (e) {}
        }
        args.push(String(url))
        const proc = spawn(yt, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        let out = '', done = false
        const finish = (val) => { if (!done) { done = true; resolve(val) } }
        const timer = setTimeout(() => { try { proc.kill() } catch (e) {} }, timeoutMs || 90000)
        proc.stdout.on('data', (d) => { if (out.length < 12 * 1024 * 1024) out += String(d) })
        proc.on('error', () => { clearTimeout(timer); finish(null) })
        proc.on('close', (code) => {
            clearTimeout(timer)
            if (!out.trim() && !code) { finish(null); return }
            try { finish(JSON.parse(out)) } catch (e) { finish(null) }
        })
    })
}

// 先带 Cookie 解析；若失败（陈旧/损坏的 Cookie 会导致错误），回退为不带 Cookie 再次解析
async function runYtDlpJson(url) {
    let r
    try {
        if (youtubeIsLoggedIn()) {
            r = await runYtDlpOnce(url, true)
            if (r) return r
        }
    } catch (e) {}
    r = await runYtDlpOnce(url, false)
    return r
}

async function parseYouTube(target, addStream) {
    const id = (target.match(/youtu\.be\/([\w-]{6,})/) ||
                target.match(/[?&]v=([\w-]{6,})/) ||
                target.match(/youtube\.com\/(?:live\/|shorts\/|watch\/|embed\/)([\w-]{6,})/))?.[1]
    if (!id) return null
    const U = (s) => String(s || '').replace(/\\(.)/g, '$1')
    const watchUrl = 'https://www.youtube.com/watch?v=' + id

    const info = await runYtDlpJson(watchUrl)
    if (!info) return null
    const title = info.title || ''
    const formats = Array.isArray(info.formats) ? info.formats : []

    // ===== 直播：与 biliup/yt-dlp 一致 —— HLS 视频流 + 独立音频流同步播放；DASH(fMP4) 标「下载用」供下载合并 =====
    const isLive = !!(info.is_live || info.live_status === 'is_live' || (info.was_live && !formats.some(f => f.height && f.acodec && f.acodec !== 'none')))
    if (isLive) {
        // biliup/yt-dlp：YouTube 直播音视频分离 —— HLS 视频流多为纯画面(video-only)，音频是独立一条 HLS/DASH 流。
        // 因此对「无自带音轨」的视频流附带 audioUrl，由播放器 initDashAudio 同步播放；
        // 若变体本身带音轨(acodec 非 none)，则直接可播，不再叠加音频，避免冲突。
        // 1) 最优音频流：优先 m3u8 音频(hls.js)，其次 AAC fMP4/m4a(原生 <audio>)
        //    注意：yt-dlp 对 YouTube 直播的 audio-only 流（如 format_id 233/234）常缺失 acodec 字段，
        //    只有 resolution:"audio only" / format_note:"audio only"，必须一并纳入判定，否则会漏选导致无音频。
        const isAudioOnly = (f) => {
            if (f.vcodec && f.vcodec !== 'none' && f.vcodec !== '') return false
            const text = `${f.resolution || ''} ${f.format_note || ''} ${f.format_id || ''}`.toLowerCase()
            return !!(f.acodec && f.acodec !== 'none') || /audio/i.test(text)
        }
        // 有 url 的音频流：可直接用于附加播放
        const audioCands = formats.filter(f => f.url && isAudioOnly(f))
        const liveAudio = audioCands
            .sort((a, b) => {
                const aMux = /m3u8/i.test((a.protocol || '') + (a.format_id || '')) ? 1 : 0
                const bMux = /m3u8/i.test((b.protocol || '') + (b.format_id || '')) ? 1 : 0
                if (aMux !== bMux) return bMux - aMux
                const aacA = /mp4a|aac/i.test(a.acodec || '') ? 1 : 0
                const aacB = /mp4a|aac/i.test(b.acodec || '') ? 1 : 0
                if (aacA !== aacB) return aacB - aacA
                return ((b.abr || 0) || (b.tbr || 0)) - ((a.abr || 0) || (a.tbr || 0))
            })[0]
        const liveAudioUrl = liveAudio ? liveAudio.url : ''

        // 2) HLS 视频流（首选，hls.js 可播 fMP4）；无音轨的附带独立音频
        //    排序：优先「自带音轨」(avc+mp4a 合一) 的 HLS，保证默认选中的线路有声音；纯画面 HLS 再按清晰度排
        const liveHlsVideos = formats
            .filter(f => f.url && f.vcodec && f.vcodec !== 'none' && /m3u8|hls/i.test((f.protocol || '') + ' ' + (f.format_id || '')))
        const hlsSeen = new Set()
        const hlsUnique = liveHlsVideos.filter(f => { if (hlsSeen.has(f.url)) return false; hlsSeen.add(f.url); return true })
            .sort((a, b) => {
                const aOwn = a.acodec && a.acodec !== 'none' ? 1 : 0
                const bOwn = b.acodec && b.acodec !== 'none' ? 1 : 0
                if (aOwn !== bOwn) return bOwn - aOwn
                return (b.height || b.tbr || 0) - (a.height || a.tbr || 0)
            })
        let hlsAdded = 0
        for (const f of hlsUnique) {
            const h = f.height || 0
            const hasOwnAudio = f.acodec && f.acodec !== 'none'
            const lbl = h ? `${h}p` : (f.format_note || '直播')
            addStream(U(f.url), 'm3u8', `${title} [${lbl}]`, { ytSrc: watchUrl, ytHeight: h, audioUrl: hasOwnAudio ? '' : liveAudioUrl, isLive: true })
            hlsAdded++
        }

        // 3) DASH fMP4 纯画面流：在线 <video> 无法直接播 fMP4，标注「下载用」供 yt-dlp/ffmpeg 合并音视频
        const liveDashVideos = formats
            .filter(f => f.url && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && f.height)
            .filter((f, i, arr) => arr.findIndex(x => x.format_id === f.format_id) === i)
            .sort((a, b) => (b.height || 0) - (a.height || 0))
        let liveDashAdded = 0
        const liveSeen = new Set()
        for (const f of liveDashVideos) {
            const h = f.height || 0
            const label = f.format_note || (h ? `${h}p` : '')
            const key = `live_${h}`
            if (liveSeen.has(key)) continue
            liveSeen.add(key)
            addStream(U(f.url), 'mp4', `${title} [${label}·下载用]`, { ytSrc: watchUrl, ytHeight: h, audioUrl: liveAudioUrl, isLive: true })
            liveDashAdded++
        }

        // 4) 兜底：既无 HLS 也无 DASH 时，随便取一个视频流
        if (hlsAdded === 0 && liveDashAdded === 0) {
            const fallback = formats.find(f => f.url && f.vcodec && f.vcodec !== 'none' && !/audio/ig.test(f.resolution || ''))
            if (fallback?.url) addStream(U(fallback.url), 'mp4', `${title} [直播]`, { ytSrc: watchUrl, ytHeight: fallback.height || 0, audioUrl: liveAudioUrl, isLive: true })
        }
        return { title: title || 'YouTube Live' }
    }

    // ===== 视频：优先用渐进式流（音视频合一、可直接播放）；DASH 流仅用于下载（音视频分离）=====
    // YouTube 渐进式流（format_id 18/22/37 等）自带音轨，mp4 格式，<video> 可直接播放，
    // 但最高只有 720p。1080p+ 必须走 DASH（音视频分离），仅适合下载时 yt-dlp 自动合并。
    const progressive = formats
        .filter(f => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0))

    // DASH 视频流（纯画面，无音轨）— 供下载用
    const bestAudio = formats
        .filter(f => f.url && (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none')
        .sort((a, b) => ((b.abr || 0) || (b.tbr || 0)) - ((a.abr || 0) || (a.tbr || 0)))[0]
    const bestAudioUrl = bestAudio ? bestAudio.url : ''
    const dashVideos = formats
        .filter(f => f.url && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && f.height)
        .filter((f, i, arr) => arr.findIndex(x => x.format_id === f.format_id) === i)
        .sort((a, b) => (b.height || 0) - (a.height || 0))

    let added = 0
    const seen = new Set()

    // 1) 渐进式流：可直接播放（有声）
    for (const f of progressive) {
        const h = f.height || 0
        const label = f.format_note || `${h}p`
        const key = `prog_${h}`
        if (seen.has(key)) continue
        seen.add(key)
        addStream(U(f.url), 'mp4', `${title} [${label}]`, { ytSrc: watchUrl, ytHeight: h })
        added++
    }

    // 2) DASH 高画质流：仅用于下载（yt-dlp 自动合并音视频）
    for (const f of dashVideos) {
        const h = f.height || 0
        const qKey = f.format_note || `${h}p`
        const key = `dash_${h}`
        if (seen.has(key)) continue
        seen.add(key)
        addStream(U(f.url), 'mp4', `${title} [${qKey}·下载用]`, { ytSrc: watchUrl, ytHeight: h, audioUrl: bestAudioUrl })
        added++
    }

    return added ? { title: title || 'YouTube' } : null
}

const DOUYIN_LIVE_URL = 'https://live.douyin.com/'
const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const DEFAULT_TTWID = '1%7Cu7ogdHsSmHtxbt4hjDCNvcLfVJz78CTM0TTWU8Hio8w%7C1751545220%7C18aac967e501e9d6c13384335ced3523c46a0b1cc4535c7213bc2506a7f462c8'
const DOUYIN_QUALITY_MAP = { origin: '蓝光', uhd: '超清', hd: '高清', sd: '标清', ld: '流畅', md: '极速' }
let douyinTtwidCache = null

async function douyinGetTtwid() {
    if (douyinTtwidCache) return douyinTtwidCache
    try {
        const r = await axios.post('https://ttwid.bytedance.com/ttwid/union/register/',
            JSON.stringify({ region: 'cn', aid: 6383, needFid: false, service: 'https://www.douyin.com', union: true, fid: '' }),
            { headers: { 'Content-Type': 'application/json' }, timeout: 8000, validateStatus: () => true })
        const setCookie = r.headers?.['set-cookie']
        if (Array.isArray(setCookie)) {
            for (const c of setCookie) {
                const m = c.match(/ttwid=([^;]+)/)
                if (m) { douyinTtwidCache = m[1]; return douyinTtwidCache }
            }
        }
    } catch (e) { /* fallback */ }
    douyinTtwidCache = DEFAULT_TTWID
    return douyinTtwidCache
}

async function douyinGetHeaders() {
    const ttwid = await douyinGetTtwid()
    const nonce = crypto.randomBytes(11).toString('hex').slice(0, 21)
    const odinTtid = crypto.randomBytes(80).toString('hex')
    const cookie = `ttwid=${ttwid}; odin_ttid=${odinTtid}; __ac_nonce=${nonce};`
    return { 'User-Agent': DOUYIN_USER_AGENT, 'Referer': DOUYIN_LIVE_URL, 'Cookie': cookie }
}

async function parseDouyinLive(target, addStream) {
    let m = target.match(/live\.douyin\.com\/([A-Za-z0-9_+]+)/i)
    if (!m) return null
    const webRid = m[1]
    const headers = await douyinGetHeaders()

    // 获取房间信息（不需要 ABogus 签名）
    let roomInfo = null
    try {
        const params = new URLSearchParams({
            app_name: 'douyin_web', enter_from: 'web_live', live_id: '1',
            aid: '6383', device_platform: 'web', browser_language: 'zh-CN',
            browser_platform: 'Win32', browser_name: 'Mozilla', browser_version: '142.0.0.0',
            web_rid: webRid, is_need_double_stream: 'false'
        })
        const r = await axios.get(`https://live.douyin.com/webcast/room/web/enter/?${params}`, {
            headers, timeout: 10000, validateStatus: () => true, responseType: 'text'
        })
        let data
        try { data = JSON.parse(r.data) } catch (e) { console.log('[DOUYIN] 响应非JSON'); return null }
        const arr = data?.data?.data
        if (Array.isArray(arr) && arr.length > 0) roomInfo = arr[0]
        if (data?.data?.prompts === '直播已结束') return null
    } catch (e) { console.log('[DOUYIN] API 失败:', e.message) }

    if (!roomInfo) return null
    if (roomInfo.status !== 2) return null
    if ((roomInfo.finish_time || 0) > 0) return null

    const title = roomInfo.title || '抖音直播'

    // 提取直播流
    const pullData = roomInfo.stream_url?.live_core_sdk_data?.pull_data
    const streamDataText = pullData?.stream_data
    if (!streamDataText) { console.log('[DOUYIN] stream_data 为空'); return null }

    let streamData
    try { streamData = JSON.parse(streamDataText) } catch (e) { return null }
    const qualities = streamData?.data
    if (!qualities || typeof qualities !== 'object') return null

    let addedAny = false
    const qualityOrder = ['origin', 'uhd', 'hd', 'sd', 'ld', 'md']
    for (const q of qualityOrder) {
        const qData = qualities[q]
        if (!qData?.main) continue
        const label = DOUYIN_QUALITY_MAP[q] || q
        if (qData.main.flv && !qData.main.flv.includes('rtm_expr_tag=reflow_room_info')) {
            addStream(qData.main.flv.replace('http://', 'https://'), 'flv', `${title} [${label}]`)
            addedAny = true
        }
    }

    return addedAny ? { title } : null
}

// ===== 虎牙直播流解析 =====
// 参考 biliup huya.rs：页面提取 stream JSON → 重建 anticode → 多 CDN / 画质
const HUYA_CDN_PRIORITY = { AL: 0, TX: 1, HW: 2, HS: 3, BD: 4, HX: 5 }
const HUYA_SKIP_CDNS = new Set(['HY', 'HUYA', 'HYZJ'])

function huyaBuildAnticode(streamName, anticode, presenterUid) {
    try {
        const query = new URLSearchParams(anticode)
        const fm = query.get('fm')
        if (!fm) return anticode
        const ctype = query.get('ctype') || 'huya_live'
        const platformId = query.get('t') || '100'
        const uid = presenterUid || huyaRandomUid()
        const now = Math.floor(Date.now() / 1000)
        const seqId = uid + Date.now()
        const secretHash = crypto.createHash('md5').update(`${seqId}|${ctype}|${platformId}`).digest('hex')
        const convertUid = huyaRotl64(uid)
        const fmDecoded = decodeURIComponent(fm)
        const secretPrefix = Buffer.from(fmDecoded, 'base64').toString('utf8').split('_')[0]
        let wsTime = query.get('wsTime')
        if (parseInt(wsTime, 16) < now + 20 * 60) {
            wsTime = (now + 24 * 60 * 60).toString(16)
        }
        const isWap = platformId === '103'
        const calcUid = isWap ? uid : convertUid
        const wsSecret = crypto.createHash('md5').update(`${secretPrefix}_${calcUid}_${streamName}_${secretHash}_${wsTime}`).digest('hex')
        const fs = query.get('fs') || 'bgct'
        const fmEncoded = encodeURIComponent(fm)
        let result = `wsSecret=${wsSecret}&wsTime=${wsTime}&seqid=${seqId}&ctype=${ctype}&ver=1&fs=${fs}&fm=${fmEncoded}&t=${platformId}`
        if (isWap) {
            const ct = Math.floor((parseInt(wsTime, 16) + Math.random()) * 1000)
            const uuid = Math.floor(((ct % 10000000000) + Math.random()) * 1000 % 4294967295)
            result += `&uid=${uid}&uuid=${uuid}`
        } else {
            result += `&u=${convertUid}`
        }
        return result
    } catch (e) { return anticode }
}
function huyaRotl64(value) {
    const lo = (value & 0xFFFFFFFF) >>> 0
    const rotated = (((lo << 8) | (lo >>> 24)) & 0xFFFFFFFF) >>> 0
    return (value - lo) + rotated
}
function huyaRandomUid() {
    return Math.random() < 0.5
        ? parseInt(`1234${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`)
        : parseInt(`140000${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`)
}

async function parseHuya(target, addStream) {
    let m = target.match(/huya\.com\/([A-Za-z0-9_]+)/i)
    if (!m) return null
    const room = m[1]

    // 桌面页面有 stream: 数据，移动端没有
    let html = ''
    try {
        const r = await axios.get(`https://www.huya.com/${room}`, {
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://www.huya.com/' },
            timeout: 10000, validateStatus: () => true
        })
        html = typeof r.data === 'string' ? r.data : ''
    } catch (e) { /* 继续 */ }
    if (!html || html.length < 1000) return null

    // 括号平衡提取 stream: { ... }（参考 biliup extract_stream_json）
    const streamIdx = html.indexOf('stream:')
    if (streamIdx < 0) return null
    const braceStart = html.indexOf('{', streamIdx)
    if (braceStart < 0) return null
    let depth = 0, inStr = false, esc = false, quote = '', braceEnd = -1
    for (let i = braceStart; i < html.length; i++) {
        const c = html[i]
        if (esc) { esc = false; continue }
        if (inStr) {
            if (c === '\\') esc = true
            else if (c === quote) inStr = false
        } else {
            if (c === '"' || c === "'") { inStr = true; quote = c }
            else if (c === '{') depth++
            else if (c === '}') { depth--; if (depth === 0) { braceEnd = i; break } }
        }
    }
    if (braceEnd < 0) return null

    let streamObj
    try { streamObj = JSON.parse(html.slice(braceStart, braceEnd + 1)) } catch (e) { return null }
    const dataList = streamObj?.data
    if (!Array.isArray(dataList) || dataList.length === 0) return null

    const gameLiveInfo = dataList[0].gameLiveInfo || {}
    let title = gameLiveInfo.nick || gameLiveInfo.roomName || `虎牙 - ${room}`
    if (gameLiveInfo.gameFullName) title += ` - ${gameLiveInfo.gameFullName}`
    const presenterUid = Number(dataList[0].gameStreamInfoList?.[0]?.lPresenterUid) || 0

    const streamInfoList = dataList[0].gameStreamInfoList || []
    if (streamInfoList.length === 0) return null

    let addedAny = false
    const sorted = [...streamInfoList].sort((a, b) =>
        (HUYA_CDN_PRIORITY[a.sCdnType] ?? 9) - (HUYA_CDN_PRIORITY[b.sCdnType] ?? 9))

    // 虎牙画质：ratio 参数控制（0=蓝光8M, 4000=蓝光4M, 2000=超清, 1500=高清, 800=流畅）
    const HUYA_QUALITIES = [
        { ratio: 0, label: '蓝光8M' },
        { ratio: 4000, label: '蓝光4M' },
        { ratio: 2000, label: '超清' },
        { ratio: 1500, label: '高清' },
        { ratio: 800, label: '流畅' },
    ]

    for (const info of sorted) {
        const cdn = info.sCdnType || '?'
        if (HUYA_SKIP_CDNS.has(cdn)) continue
        const streamName = info.sStreamName
        if (!streamName) continue
        const baseName = streamName.replace(/-imgplus/g, '')

        // FLV 直播流（mpegts.js 边下载边播放，延迟最低，接近官方）
        if (info.sFlvUrl && info.sFlvAntiCode) {
            const anticode = huyaBuildAnticode(baseName, info.sFlvAntiCode, presenterUid)
            const suffix = info.sFlvUrlSuffix || 'flv'
            for (const q of HUYA_QUALITIES) {
                const ratioParam = q.ratio > 0 ? `&ratio=${q.ratio}` : ''
                const flvUrl = `${info.sFlvUrl}/${baseName}.${suffix}?${anticode}${ratioParam}`
                addStream(flvUrl, 'flv', `${title} [${q.label} FLV ${cdn}]`)
                addedAny = true
            }
        }
        // HLS 直播流（备用，缓冲更稳，延迟略高）
        if (info.sHlsUrl && info.sHlsAntiCode) {
            const anticode = huyaBuildAnticode(baseName, info.sHlsAntiCode, presenterUid)
            const suffix = info.sHlsUrlSuffix || 'm3u8'
            for (const q of HUYA_QUALITIES) {
                const ratioParam = q.ratio > 0 ? `&ratio=${q.ratio}` : ''
                const hlsUrl = `${info.sHlsUrl}/${baseName}.${suffix}?${anticode}${ratioParam}`
                addStream(hlsUrl, 'm3u8', `${title} [${q.label} HLS ${cdn}]`)
                addedAny = true
            }
        }
    }

    return addedAny ? { title } : null
}

// ===== 斗鱼直播流解析 =====
// 参考 biliup douyu.rs：纯 HTTP API，不再用 BrowserWindow 拦截
// getEncryption → sign_stream → getH5Play，支持 CDN 线路选择
const DOUYU_DEFAULT_DID = '10000000000000000000000000001501'
const DOUYU_CDN_LIST = ['hw-h5', 'tct-h5', 'hs-h5']

function douyuSignStream(encKey, roomId, ts) {
    const salt = encKey.is_special === 1 ? '' : `${roomId}${ts}`
    let secret = encKey.rand_str
    for (let i = 0; i < encKey.enc_time; i++) {
        secret = crypto.createHash('md5').update(secret + encKey.key).digest('hex')
    }
    return crypto.createHash('md5').update(secret + encKey.key + salt).digest('hex')
}

function randomChromeUA() {
    const v = 100 + Math.floor(Math.random() * 21)
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`
}

async function parseDouyu(target, addStream) {
    let m = target.match(/douyu\.com\/([A-Za-z0-9_]+)/i)
    if (!m) return null
    const room = m[1]
    if (['directory', 'following', 'search', 'topic', 'fishsmall'].includes(room.toLowerCase())) return null

    const douyuReferer = `https://www.douyu.com/${room}`

    // 1. 解析真实房间号（短号 → 真实号）
    let roomId = room
    try {
        const mobileRes = await axios.get(`https://m.douyu.com/${room}`, {
            headers: { 'User-Agent': PARSE_UA }, timeout: 15000, validateStatus: () => true
        })
        const ridMatch = (typeof mobileRes.data === 'string' ? mobileRes.data : '').match(/roomInfo":\{"rid":(\d+)/)
        if (ridMatch) roomId = ridMatch[1]
    } catch (e) { /* 继续用原 room */ }

    // 2. 获取房间信息（betard API，最多重试 3 次）
    let betardData
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const betardRes = await axios.get(`https://www.douyu.com/betard/${roomId}`, {
                headers: { 'User-Agent': PARSE_UA, 'Referer': douyuReferer },
                timeout: 15000, validateStatus: () => true
            })
            betardData = betardRes.data
            if (betardData?.room) break
        } catch (e) { /* 重试 */ }
    }
    if (!betardData?.room) { console.log('[DOUYU] 房间信息获取失败:', roomId); return null }
    const roomData = betardData.room
    if (roomData.show_status !== 1 || roomData.video_loop === 1) return null
    const title = roomData.room_name || `斗鱼 - ${room}`

    // 3. 获取加密密钥 & 4. 签名获取播放信息（鉴权失败时刷新密钥重试，最多 2 轮）
    let addedAny = false
    let encKey = null
    let ua = null

    for (let keyRound = 0; keyRound < 2; keyRound++) {
        // 每轮使用新 UA 防风控
        ua = randomChromeUA()
        try {
            const encRes = await axios.get(`https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption`, {
                params: { did: DOUYU_DEFAULT_DID },
                headers: { 'User-Agent': ua, 'Referer': douyuReferer },
                timeout: 15000, validateStatus: () => true
            })
            if (encRes.data?.error !== 0 || !encRes.data?.data) {
                console.log('[DOUYU] getEncryption 失败:', encRes.data?.error, encRes.data?.msg)
                continue
            }
            encKey = encRes.data.data
        } catch (e) { console.log('[DOUYU] getEncryption 网络错误:', e.message); continue }
        if (!encKey) continue

        const ts = Math.floor(Date.now() / 1000)
        const auth = douyuSignStream(encKey, roomId, ts)
        const formBase = {
            ver: 'Douyu_new', iar: '0', ive: '0', rid: roomId,
            hevc: '0', fa: '0', sov: '0',
            enc_data: encKey.enc_data, tt: String(ts),
            did: DOUYU_DEFAULT_DID, auth
        }

        // 请求主 CDN（使用 V1 API，多个画质）
        const DOUYU_QUALITIES = [
            { rate: '0', label: '蓝光' },
            { rate: '800', label: '高清' },
            { rate: '500', label: '标清' },
            { rate: '250', label: '流畅' },
        ]
        const cdnToTry = []
        // 先请求最高画质
        try {
            const primaryRes = await axios.post(
                `https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                new URLSearchParams({ ...formBase, cdn: 'hw-h5', rate: '0' }),
                { headers: { 'User-Agent': ua, 'Referer': douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
            )
            const bodyText = primaryRes.data
            const normalized = typeof bodyText === 'string' ? bodyText.trim().replace(/["'\s]/g, '') : ''
            if (primaryRes.status === 403 || normalized.includes('鉴权失败')) {
                console.log('[DOUYU] 鉴权失败(HTTP', primaryRes.status, ')，刷新密钥重试')
                continue
            }
            let pBody
            try { pBody = JSON.parse(bodyText) } catch (e) {
                console.log('[DOUYU] getH5PlayV1 响应非JSON:', String(bodyText).slice(0, 200))
                continue
            }
            if (pBody?.msg && String(pBody.msg).includes('鉴权失败')) {
                console.log('[DOUYU] 鉴权失败(JSON msg)，刷新密钥重试')
                continue
            }
            const primaryData = pBody?.data
            if (primaryData?.rtmp_url && primaryData?.rtmp_live) {
                const streamUrl = `${primaryData.rtmp_url}/${primaryData.rtmp_live}`
                addStream(streamUrl, 'flv', `${title} [蓝光 ${primaryData.rtmp_cdn || 'hw-h5'}]`)
                addedAny = true
                if (primaryData.cdnsWithName) {
                    for (const c of primaryData.cdnsWithName) {
                        if (c.cdn && c.cdn !== primaryData.rtmp_cdn) cdnToTry.push(c.cdn)
                    }
                }
                // 请求其他画质（同一 CDN）
                const otherQualities = DOUYU_QUALITIES.filter(q => q.rate !== '0')
                const qualResults = await Promise.allSettled(
                    otherQualities.map(q =>
                        axios.post(`https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                            new URLSearchParams({ ...formBase, cdn: primaryData.rtmp_cdn || 'hw-h5', rate: q.rate }),
                            { headers: { 'User-Agent': ua, Referer: douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
                        )
                    )
                )
                qualResults.forEach((r, i) => {
                    if (r.status !== 'fulfilled') return
                    try {
                        const d = JSON.parse(r.value?.data)?.data
                        if (d?.rtmp_url && d?.rtmp_live) {
                            addStream(`${d.rtmp_url}/${d.rtmp_live}`, 'flv', `${title} [${otherQualities[i].label} ${d.rtmp_cdn || 'hw-h5'}]`)
                        }
                    } catch (e) {}
                })
            } else if (pBody?.error === -5) {
                console.log('[DOUYU] 主播未开播:', roomId)
                return null
            } else if (pBody?.error === 126) {
                console.log('[DOUYU] 版权限制:', pBody?.msg)
                return null
            } else {
                console.log('[DOUYU] getH5PlayV1 error:', pBody?.error, 'msg:', pBody?.msg)
            }
        } catch (e) { console.log('[DOUYU] getH5PlayV1 网络错误:', e.message) }

        // 并行请求其他 CDN 线路
        if (cdnToTry.length > 0) {
            const extraResults = await Promise.allSettled(
                cdnToTry.map(cdn =>
                    axios.post(`https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                        new URLSearchParams({ ...formBase, cdn, rate: '0' }),
                        { headers: { 'User-Agent': ua, 'Referer': douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
                    )
                )
            )
            for (const r of extraResults) {
                if (r.status !== 'fulfilled') continue
                try {
                    const d = JSON.parse(r.value?.data)?.data
                    if (d?.rtmp_url && d?.rtmp_live) {
                        addStream(`${d.rtmp_url}/${d.rtmp_live}`, 'flv', `${title} [蓝光 ${d.rtmp_cdn || '?'}]`)
                        addedAny = true
                    }
                } catch (e) { /* 非JSON响应跳过 */ }
            }
        }

        // 如果已拿到流，无需再刷新密钥
        if (addedAny) break
    }

    if (!addedAny) console.log('[DOUYU] 所有 CDN 线路获取失败:', roomId)
    return addedAny ? { title } : null
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

// ===== YouTube 登录（官方网页登录，用邮箱/账号，捕获 Cookie 供 yt-dlp） =====
// yt-dlp 新版已移除 OAuth 设备码授权，官方通道仅剩 Cookie。这里打开一个无边框浏览器窗口
// 加载 YouTube 官方登录页，用户用邮箱正常登录后，把该会话 Cookie 落盘为 yt-dlp 的 Netscape
// 格式 cookie 文件，从而实现会员画质/受限内容的下载与解析。
const YT_LOGIN_MARKER = () => path.join(app.getPath('userData'), 'youtube-login.json')
const YT_COOKIE_FILE = () => path.join(app.getPath('userData'), 'youtube-cookies.txt')
let ytLoginWin = null
let ytLoginTimer = null

function readYtLoginMarker() {
    try {
        const f = YT_LOGIN_MARKER()
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch (e) {}
    return null
}
function writeYtLoginMarker(info) {
    try { fs.writeFileSync(YT_LOGIN_MARKER(), JSON.stringify({ ...info, loggedAt: Date.now() }), 'utf8') } catch (e) {}
}
function youtubeCookieExists() {
    try { return fs.existsSync(YT_COOKIE_FILE()) && fs.statSync(YT_COOKIE_FILE()).size > 0 } catch (e) { return false }
}
function youtubeIsLoggedIn() { return youtubeCookieExists() }

// 把当前会话中 Google/YouTube 域的 Cookie 落盘为 yt-dlp 可用的 Netscape 格式
async function persistYoutubeCookies() {
    try {
        const cookies = await session.defaultSession.cookies.get({})
        const lines = [
            '# Netscape HTTP Cookie File',
            '# This file is generated by MingYunTime. Do not edit.'
        ]
        const seen = new Set()
        for (const c of cookies) {
            if (!/youtube\.com|youtube-nocookie\.com|google\.com|youtubei\.googleapis\.com/i.test(c.domain || '')) continue
            const key = c.domain + '|' + c.name + '|' + c.path
            if (seen.has(key)) continue
            seen.add(key)
            const secure = c.secure ? 'TRUE' : 'FALSE'
            const name = c.httpOnly ? '#HttpOnly_' + c.name : c.name
            const domain = c.domain?.startsWith('.') ? c.domain : '.' + (c.domain || '')
            const expire = Math.floor(c.expirationDate || 0)
            lines.push(`${domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expire}\t${name}\t${c.value}`)
        }
        fs.writeFileSync(YT_COOKIE_FILE(), lines.join('\n') + '\n', 'utf8')
        return true
    } catch (e) { return false }
}

// 已登录时补一条用户信息（Cookie 无法取头像，用通用昵称）
function defaultYtUserInfo() {
    const m = readYtLoginMarker()
    if (m && (m.uname || m.face)) return { uid: m.uid || 'youtube', uname: m.uname, face: m.face }
    return { uid: 'youtube', uname: 'YouTube \u5df2\u767b\u5f55', face: '' }
}

function closeYtLoginWin() {
    if (ytLoginTimer) { clearInterval(ytLoginTimer); ytLoginTimer = null }
    if (ytLoginWin && !ytLoginWin.isDestroyed()) {
        try { ytLoginWin.removeAllListeners('closed'); ytLoginWin.destroy() } catch (e) {}
    }
    ytLoginWin = null
}

// 生成 YouTube API 认证所需的 SAPISIDHASH
async function getYtSapiSidHash() {
    try {
        const cookies = await session.defaultSession.cookies.get({ domain: '.youtube.com' })
        const sapisid = cookies.find(c => c.name === 'SAPISID' || c.name === '__Secure-3PAPISID')
        if (!sapisid?.value) return null
        const timestamp = Math.floor(Date.now() / 1000)
        const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisid.value} https://www.youtube.com`).digest('hex')
        return `SAPISIDHASH ${timestamp}_${hash}`
    } catch (e) { return null }
}

async function extractYtUserInfo() {
    // 从登录窗口已加载的 YouTube 页面中提取用户信息
    if (!ytLoginWin || ytLoginWin.isDestroyed()) return null
    try {
        for (let i = 0; i < 3; i++) {
            if (i > 0) await new Promise(r => setTimeout(r, 2000))
            if (!ytLoginWin || ytLoginWin.isDestroyed()) return null
            const result = await ytLoginWin.webContents.executeJavaScript(`
                (function() {
                    try {
                        var d = window.ytInitialData;
                        if (!d) return JSON.stringify({error: 'no_ytInitialData'});
                        // 递归搜索用户头像和名称
                        var avatar = '', name = '', found = false;
                        function search(obj, depth) {
                            if (!obj || depth > 15 || found) return;
                            if (typeof obj === 'object') {
                                // 找 topbar 中的头像和名称
                                if (obj.topbarMenuButtonRenderer) {
                                    var btn = obj.topbarMenuButtonRenderer;
                                    if (btn.avatar && btn.avatar.thumbnails && btn.avatar.thumbnails.length) {
                                        avatar = btn.avatar.thumbnails[0].url;
                                    }
                                    if (btn.accessibility && btn.accessibility.accessibilityData && btn.accessibility.accessibilityData.label) {
                                        name = btn.accessibility.accessibilityData.label;
                                    }
                                    if (!name && btn.tooltip) name = btn.tooltip;
                                }
                                // 找 activeAccountHeaderRenderer
                                if (obj.activeAccountHeaderRenderer) {
                                    var h = obj.activeAccountHeaderRenderer;
                                    if (h.accountPhoto && h.accountPhoto.thumbnails) avatar = h.accountPhoto.thumbnails[0].url;
                                    if (h.channelName) name = h.channelName.simpleText || '';
                                    if (!name && h.accountName) name = h.accountName.simpleText || '';
                                }
                                // 找 channelHeader 或 metadata
                                if (obj.channelMetadataRenderer && obj.channelMetadataRenderer.title) {
                                    name = obj.channelMetadataRenderer.title;
                                }
                                // 找 ownerText (视频频道名)
                                if (!name && obj.ownerText && obj.ownerText.runs) {
                                    name = obj.ownerText.runs.map(function(r){return r.text}).join('');
                                }
                                if (avatar && name) { found = true; return; }
                                for (var k in obj) {
                                    if (obj.hasOwnProperty(k) && typeof obj[k] === 'object') {
                                        search(obj[k], depth + 1);
                                    }
                                }
                            }
                        }
                        search(d, 0);
                        // 兜底: 从 ytcfg 获取
                        if (!name && window.ytcfg) {
                            name = window.ytcfg.get && window.ytcfg.get('CHANNEL_NAME') || '';
                        }
                        if (!name) {
                            // 从 DOM 获取用户名
                            var btn = document.querySelector('#avatar-btn, ytd-topbar-menu-button-renderer');
                            if (btn) {
                                var label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                                if (label) name = label;
                            }
                        }
                        if (avatar) avatar = avatar.replace(/^`|`$/g, '');
                        if (avatar || name) return JSON.stringify({uname: name || '', face: avatar || ''});
                        return JSON.stringify({error: 'not_found'});
                    } catch(e) { return JSON.stringify({error: e.message}); }
                })()
            `)
            const parsed = JSON.parse(result)
            if (parsed.uname || parsed.face) {
                const face = parsed.face || ''
                return { uname: parsed.uname || 'YouTube \u7528\u6237', face: face.startsWith('//') ? 'https:' + face : face }
            }
        }
    } catch (e) {}
    return null
}

function tryFinalizeYtLogin() {
    return new Promise(async (resolve) => {
        const ok = await persistYoutubeCookies()
        if (ok && youtubeCookieExists()) {
            const userInfo = await extractYtUserInfo()
            const uname = userInfo?.uname || 'YouTube \u5df2\u767b\u5f55'
            const face = userInfo?.face || ''
            writeYtLoginMarker({ uid: 'youtube', uname, face })
            win?.webContents.send('youtube-login-done', { success: true, userInfo: { uid: 'youtube', uname, face } })
            closeYtLoginWin()
            resolve(true)
            return
        }
        resolve(false)
    })
}

// 轮询检测是否已登录（Google 登录成功后在 youtube.com 会写入 SID/APISID 等会话 Cookie）
function pollYtLogin(winObj) {
    if (ytLoginTimer) clearInterval(ytLoginTimer)
    let pollCount = 0
    ytLoginTimer = setInterval(async () => {
        if (!winObj || winObj.isDestroyed()) { closeYtLoginWin(); return }
        let logged = false
        try {
            const cookies = await session.defaultSession.cookies.get({})
            const ytCookies = cookies.filter(c => /youtube\.com|google\.com/i.test(c.domain || ''))
            logged = ytCookies.some(c => ['SID', 'LOGIN_INFO', 'APISID', '__Secure-3PAPISID'].includes(c.name))
        } catch (e) {}
        if (logged) {
            const done = await tryFinalizeYtLogin()
            if (done) clearInterval(ytLoginTimer)
        }
    }, 1500)
}

// 打开官方网页登录（Youtube 登录页，用户用邮箱正常登录）
ipcMain.handle('youtube:login-open', async () => {
    if (ytLoginWin && !ytLoginWin.isDestroyed()) {
        try { ytLoginWin.focus() } catch (e) {}
        return { success: true }
    }
    // 复用默认会话，登录态会随持久化 Cookie 保留
    const parent = win
    ytLoginWin = new BrowserWindow({
        width: 1024,
        height: 720,
        frame: true,
        title: 'YouTube 登录',
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        minimizable: true,
        maximizable: false,
        ...(parent ? { parent, modal: false } : {})
    })
    ytLoginWin.setMenuBarVisibility(false)
    ytLoginWin.loadURL('https://www.youtube.com/')
    ytLoginWin.on('closed', () => {
        // 若窗口被用户直接关闭，尝试把已登录的 Cookie 落盘
        tryFinalizeYtLogin()
    })
    pollYtLogin(ytLoginWin)
    return { success: true }
})

// 关闭登录窗口
ipcMain.handle('youtube:login-close', async () => {
    tryFinalizeYtLogin()
    return { success: true }
})

// 检查登录状态
ipcMain.handle('youtube:login-status', async () => {
    const cookieExists = youtubeCookieExists()
    if (!cookieExists) return { success: true, loggedIn: false }
    return { success: true, loggedIn: true, userInfo: defaultYtUserInfo() }
})

// 退出登录（删除 Cookie 文件与本地标记）
ipcMain.handle('youtube:logout', async () => {
    try { fs.unlinkSync(YT_COOKIE_FILE()) } catch (e) {}
    try { fs.unlinkSync(YT_LOGIN_MARKER()) } catch (e) {}
    closeYtLoginWin()
    return { success: true }
})

// ===== B站直播开播（获取自己的推流地址与串流密钥，供 OBS 推流）=====
// 说明：仅获取用户自己直播间的推流参数，合规使用；遇到平台人脸认证等要求时不绕过，直接提示。
function biliLiveHeaders(cookies) {
    return {
        'User-Agent': PARSE_UA,
        'Referer': 'https://link.bilibili.com/',
        'Origin': 'https://link.bilibili.com',
        'Cookie': biliCookieString(cookies)
    }
}

// 获取自己直播间信息：uid -> room_id（真实长号）
ipcMain.handle('bilibili:live-room', async () => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const uid = cookies.DedeUserID
    if (!uid) return { success: false, message: '登录信息缺少用户ID，请重新登录' }
    try {
        // 1) 用 uid 查自己的房间号（可能为短号）
        const r1 = await axios.get('https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld', {
            params: { mid: uid },
            headers: biliLiveHeaders(cookies),
            timeout: 10000
        })
        if (r1.data?.code !== 0 || !r1.data?.data) {
            return { success: false, message: r1.data?.message || '获取直播间信息失败' }
        }
        const roomData = r1.data.data
        if (roomData.roomStatus !== 1) {
            return { success: false, message: '尚未开通直播间，请先在B站直播中心开通后重试', notOpen: true }
        }
        // 2) 短号转真实长号，并取上次使用的分区(area_v2)与封面/标题（get_info 含 area_v2）
        let roomId = roomData.roomid
        let areaV2 = roomData.area_v2 || roomData.areaV2 || null
        let title = roomData.title || ''
        let cover = roomData.user_cover || roomData.cover || ''
        try {
            const r2 = await axios.get('https://api.live.bilibili.com/room/v1/Room/get_info', {
                params: { room_id: roomId },
                headers: biliLiveHeaders(cookies),
                timeout: 10000
            })
            const d2 = r2.data?.data
            if (d2?.room_id) roomId = d2.room_id
            // get_info 返回的是 area_id（不是 area_v2），以此记忆上次使用的分区
            if (d2?.area_id !== undefined && d2?.area_id !== null) areaV2 = d2.area_id
            if (d2?.title) title = d2.title
            if (d2?.user_cover || d2?.cover || d2?.keyframe) cover = d2.user_cover || d2.cover || d2.keyframe || ''
        } catch (e) {}
        return {
            success: true,
            roomId,
            shortId: roomData.short_id,
            liveStatus: roomData.liveStatus,
            title,
            areaV2,
            // 之前的直播封面（user_cover 为实际生效封面，fallback 到 cover/keyframe）
            cover
        }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})

// 获取直播分区列表（父分区 -> 子分区）
ipcMain.handle('bilibili:live-areas', async () => {
    try {
        const r = await axios.get('https://api.live.bilibili.com/room/v1/Area/getList', {
            headers: { 'User-Agent': PARSE_UA },
            timeout: 10000
        })
        if (r.data?.code !== 0) return { success: false, message: r.data?.message || '获取分区失败' }
        // 扁平化为 [{parent_id, parent_name, id, name}]
        const areas = []
        for (const p of r.data.data || []) {
            for (const c of p.list || []) {
                areas.push({ id: c.id, name: c.name, parentId: p.id, parentName: p.name })
            }
        }
        return { success: true, areas }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})

// 开始直播：获取推流地址与串流密钥
ipcMain.handle('bilibili:live-start', async (_, { roomId, areaV2, title, platform, cover }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const csrf = cookies.bili_jct
    if (!csrf) return { success: false, message: '登录信息缺少bili_jct，请重新登录' }
    // 封面为 dataURI 时先上传为永久 URL
    let coverUrl = cover
    if (coverUrl && typeof coverUrl === 'string' && /^data:/i.test(coverUrl)) {
        const up = await uploadBiliLiveCover(cookies, coverUrl)
        if (up.err) return { success: false, message: up.err }
        coverUrl = up.url
    }
    const doStart = async (platform, extra = {}) => {
        const params = new URLSearchParams()
        params.set('room_id', String(roomId))
        params.set('area_v2', String(areaV2))
        // 注意：Room/startLive 不接收 title/cover（文档无此参数，传了会被静默忽略）。
        // 标题与封面由开播成功后的 UpdatePreLiveInfo 设置。
        params.set('platform', platform)
        params.set('csrf', csrf)
        for (const [k, v] of Object.entries(extra)) params.set(k, String(v))
        const r = await axios.post('https://api.live.bilibili.com/room/v1/Room/startLive', params.toString(), {
            headers: {
                ...biliLiveHeaders(cookies),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
        })
        return r.data
    }
    // 根据用户选择组合尝试顺序：优先用户指定的 platform，再尝试默认组合，
    // 规避"仅支持直播姬开播"限制（60034）
    const attempts = []
    if (platform) {
        attempts.push({ platform, extra: { build: '1', version: '3.0.0' } })
        attempts.push({ platform, extra: {} })
    }
    attempts.push(
        { platform: 'pc', extra: { build: '1', version: '3.0.0' } },
        { platform: 'pc_link', extra: { build: '1', version: '3.0.0' } },
        { platform: 'pc', extra: {} },
        { platform: 'pc_link', extra: {} }
    )
    let errCode = null
    let errMsg = ''
    for (const { platform, extra } of attempts) {
        try {
            const data = await doStart(platform, extra)
            if (data?.code === 0) {
                const d = data.data || {}
                const rtmp = d.rtmp || {}
                let addr = rtmp.addr || ''
                const code = rtmp.code || ''
                // 规范化：OBS 服务器地址要求以 / 结尾，否则拼接/解析容易重连失败
                if (addr && !addr.endsWith('/')) addr = addr + '/'
                // 开播成功后设置标题/封面（UpdatePreLiveInfo 是唯一接受 cover 的接口，title 也走这里生效）。
                // 失败不阻断开播结果，仅附加提示。
                let coverSet = false
                let coverErr = ''
                if (title || coverUrl) {
                    const up = await updateBiliLivePreInfo(cookies, { title, coverUrl })
                    if (up.ok) coverSet = true
                    else coverErr = up.err || ''
                }
                return {
                    success: true,
                    platform,
                    liveKey: d.live_key || '',
                    fullUrl: addr + code,
                    serverAddr: addr,
                    streamCode: code,
                    streamCodeNoQ: code.replace(/^\?/, ''),
                    coverSet,
                    coverErr
                }
            }
            if (!errCode) { errCode = data?.code; errMsg = data?.message || '开播失败' }
            // 60034 需要换 platform 重试；其它错误（如60024人脸）不重试
            if (data?.code !== 60034) {
                // 60024 人脸认证：不绕过，直接提示
                if (data?.code === 60024) {
                    return { success: false, code: 60024, message: '该分区开播需要人脸认证，请到B站直播中心完成认证后重试' }
                }
                return { success: false, code: data?.code, message: data?.message || '开播失败' }
            }
        } catch (e) {
            if (!errCode) { errCode = e?.response?.data?.code; errMsg = e?.response?.data?.message || e.message }
            return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
        }
    }
    return { success: false, code: errCode, message: errMsg || '开播失败' }
})

// 上传 B站直播封面：不做任何压缩、不设大小限制。
// 主链路用 BFS 通用图床 bucket=openplatform（实测限制 20MB，ElainaBot 等开源项目同款参数），
// 返回 .hdslb.com/bfs/ 域名 URL，供 UpdatePreLiveInfo 使用。
// 旧参数 bucket=live&dir=new_room_cover 为直播封面专用目录，服务器限制极小（<500KB 即 -617），已弃用。
async function uploadBiliLiveCover(cookies, dataUri) {
    const csrf = cookies.bili_jct
    if (!csrf) return { err: '登录信息缺少bili_jct，请重新登录' }
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,([\s\S]+)$/i.exec(dataUri)
    if (!m) return { err: '封面格式不正确（需 base64 dataURI 图片）' }
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length) return { err: '封面内容为空' }
    const mime = m[1].toLowerCase()
    // BFS 图床 multipart 二进制（bucket=openplatform，20MB 限制）
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    const boundary = '----WB' + Date.now().toString(36)
    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="bucket"\r\n\r\nopenplatform\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, buf, tail])
    try {
        const r = await axios.post('https://api.bilibili.com/x/upload/web/image', body, {
            params: { csrf },
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': 'https://www.bilibili.com/',
                'Origin': 'https://www.bilibili.com',
                'Cookie': biliCookieString(cookies),
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            timeout: 30000
        })
        if (r.data?.code === 0 && r.data?.data?.location) return { url: r.data.data.location }
        return { err: r.data?.message || '上传封面失败' }
    } catch (e) {
        return { err: '上传封面请求失败：' + (e?.response?.data?.message || e.message) }
    }
}

// 设置直播封面/标题：xlive/app-blink/v1/preLive/UpdatePreLiveInfo
// 唯一接受 cover 的直播接口；cover 必须是 .hdslb.com 域名 URL（上传接口返回的 location）
async function updateBiliLivePreInfo(cookies, { title, coverUrl }) {
    const csrf = cookies.bili_jct
    if (!csrf) return { err: '登录信息缺少bili_jct，请重新登录' }
    const params = new URLSearchParams()
    params.set('platform', 'web')
    params.set('mobi_app', 'web')
    params.set('build', '1')
    if (title) params.set('title', String(title))
    if (coverUrl) params.set('cover', String(coverUrl))
    params.set('csrf_token', csrf)
    params.set('csrf', csrf)
    params.set('visit_id', '')
    try {
        const r = await axios.post('https://api.live.bilibili.com/xlive/app-blink/v1/preLive/UpdatePreLiveInfo', params.toString(), {
            headers: {
                ...biliLiveHeaders(cookies),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
        })
        if (r.data?.code === 0) return { ok: true }
        return { err: r.data?.message || r.data?.msg || '设置直播封面失败' }
    } catch (e) {
        return { err: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
}

// 保存直播间信息（标题/分区/封面，同步到直播间资料）
// 依据 bilibili-API-collect live/manage.md 权威文档：
// - Room/update 合法参数：room_id/title/area_id/add_tag/del_tag/csrf（分区参数名是 area_id，无 cover）
// - 封面唯一入口：xlive/app-blink/v1/preLive/UpdatePreLiveInfo（cover 必须是 .hdslb.com 域名 URL）
ipcMain.handle('bilibili:live-update', async (_, { roomId, title, areaV2, cover }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const csrf = cookies.bili_jct
    if (!csrf) return { success: false, message: '登录信息缺少bili_jct，请重新登录' }
    // 封面为本地选择(dataURI)时先上传为 .hdslb.com/bfs/live/ 永久 URL
    let coverUrl = cover
    if (coverUrl && typeof coverUrl === 'string' && /^data:/i.test(coverUrl)) {
        const up = await uploadBiliLiveCover(cookies, coverUrl)
        if (up.err) return { success: false, message: up.err }
        coverUrl = up.url
    }
    // 1) 标题/分区：Room/update（分区参数名 area_id）
    let updateErr = ''
    const params = new URLSearchParams()
    params.set('room_id', String(roomId))
    if (title !== undefined && title !== null && String(title)) params.set('title', String(title))
    if (areaV2 !== undefined && areaV2 !== null && String(areaV2)) params.set('area_id', String(areaV2))
    params.set('csrf', csrf)
    try {
        const r = await axios.post('https://api.live.bilibili.com/room/v1/Room/update', params.toString(), {
            headers: {
                ...biliLiveHeaders(cookies),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
        })
        if (r.data?.code !== 0) updateErr = r.data?.message || r.data?.msg || '保存直播间信息失败'
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
    // 2) 封面：UpdatePreLiveInfo（Room/update 不接受 cover 参数）
    let preErr = ''
    if (coverUrl) {
        const up = await updateBiliLivePreInfo(cookies, { coverUrl })
        if (!up.ok) preErr = up.err || '设置直播封面失败'
    }
    if (updateErr) return { success: false, code: 1, message: updateErr }
    if (preErr) return { success: false, code: 1, message: '标题/分区已保存，但封面设置失败：' + preErr }
    return { success: true }
})

// 停止直播
ipcMain.handle('bilibili:live-stop', async (_, { roomId, platform }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const csrf = cookies.bili_jct
    const doStop = async (platform, extra = {}) => {
        const params = new URLSearchParams()
        params.set('room_id', String(roomId))
        params.set('platform', platform)
        params.set('csrf', csrf)
        for (const [k, v] of Object.entries(extra)) params.set(k, String(v))
        const r = await axios.post('https://api.live.bilibili.com/room/v1/Room/stopLive', params.toString(), {
            headers: {
                ...biliLiveHeaders(cookies),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        })
        return r.data
    }
    // 与开播保持一致：优先使用开播成功的 platform，其它尝试同样规避"仅支持直播姬"（60034）
    const attempts = []
    if (platform) {
        attempts.push({ platform, extra: { build: '1', version: '3.0.0' } })
        attempts.push({ platform, extra: {} })
    }
    attempts.push(
        { platform: 'pc', extra: { build: '1', version: '3.0.0' } },
        { platform: 'pc_link', extra: { build: '1', version: '3.0.0' } },
        { platform: 'pc', extra: {} },
        { platform: 'pc_link', extra: {} }
    )
    let errMsg = ''
    for (const a of attempts) {
        try {
            const data = await doStop(a.platform, a.extra)
            if (data?.code === 0) return { success: true }
            if (!errMsg) errMsg = data?.message || '停止直播失败'
            // 60034 需换 platform 重试；其它错误直接返回
            if (data?.code !== 60034) return { success: false, message: errMsg }
        } catch (e) {
            return { success: false, message: '请求失败：' + e.message }
        }
    }
    return { success: false, message: errMsg || '停止直播失败' }
})

// ===== B站管理（收藏夹 / 空间数据 / 稿件管理）=====
// 依据 bilibili-API-collect 文档实现；均需登录 Cookie(SESSDATA)

// 收藏夹列表（自己创建的）
ipcMain.handle('bilibili:fav-list', async () => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const uid = cookies.DedeUserID
    if (!uid) return { success: false, message: '登录信息缺少用户ID，请重新登录' }
    try {
        const r = await axios.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all', {
            params: { up_mid: uid, rid: 0 },
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://space.bilibili.com/' + uid, 'Cookie': biliCookieString(cookies) },
            timeout: 10000
        })
        if (r.data?.code !== 0) return { success: false, message: r.data?.message || '获取收藏夹失败' }
        const list = (r.data?.data?.list || []).map(f => ({
            id: f.id, title: f.title, mediaCount: f.media_count || 0, cover: f.cover || ''
        }))
        return { success: true, list }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})

// 收藏夹内容（分页，仅视频）
ipcMain.handle('bilibili:fav-content', async (_, { fid, pn = 1, ps = 20 }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    try {
        const r = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list', {
            params: { media_id: fid, pn, ps: Math.min(ps, 50), platform: 'web' },
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://space.bilibili.com/', 'Cookie': biliCookieString(cookies) },
            timeout: 10000
        })
        if (r.data?.code !== 0) return { success: false, message: r.data?.message || '获取收藏内容失败' }
        const d = r.data?.data || {}
        // 收藏类型枚举：2/1/22=视频 21=合集(season) 4=番剧/影视 24=番剧/有声剧(网页显示"番剧"，非音频) 11/12/10=直播(回放)
        // 番剧/电影项通常不带 ep_id/season_id 字段，ep 号藏在 link 里（https://www.bilibili.com/bangumi/play/ep737427）
        const typeNames = { 2: '视频', 21: '合集', 1: '视频', 22: '视频', 4: '番剧/影视', 24: '番剧', 11: '直播', 12: '直播回放', 10: '直播' }
        const medias = (d.medias || []).map(m => {
            // 番剧 ep_id：优先字段，其次从 link 提取
            let epId = m.ep_id || m.epId || 0
            const linkStr = m.link || ''
            const epM = /bangumi\/play\/ep(\d+)/.exec(linkStr)
            if (!epId && epM) epId = Number(epM[1])
            const isBangumi = m.type === 4 || m.type === 24 || /bangumi\/play/.test(linkStr) || !!epId
            return {
                id: m.id,
                bvid: m.bvid || '',
                title: m.title || '',
                cover: m.cover || '',
                duration: m.duration || 0,
                upper: (m.upper && m.upper.name) || '',
                upperMid: (m.upper && m.upper.mid) || 0,
                // type=21 合集项的 id 本身就是 season_id
                seasonId: m.season_id || m.seasonId || (m.type === 21 ? m.id : 0) || 0,
                epId,
                isBangumi,
                link: linkStr,
                cid: (m.page && m.page.length) ? m.page[0].cid || 0 : 0,
                type: m.type || 2,
                typeName: typeNames[m.type] || (m.type ? '类型' + m.type : '视频'),
                // 普通视频/有声剧(type24)可直接下载
                downloadable: !!(m.bvid),
                // 所有项都给"展开/查合集"入口：
                //  - 番剧(type4/24/带 epId) → "展开番剧"（pgc 集数接口）
                //  - 带 season_id 或 type 21 → "展开合集"
                //  - type=2 普通视频 → "查合集"（可能属于某个 UP主合集，走 ugc_season 查询）
                expandable: true
            }
        })
        // 总数取 data.info.media_count（整个收藏夹的条目数），d.count 只是当前页数量
        return { success: true, folderTitle: d.info?.title || '', medias, hasMore: !!d.has_more, total: d.info?.media_count || d.count || medias.length }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})

// 拉取 UP主合集全部视频（自动翻页：seasons_archives_list page_size 上限 100，合集可超百集）
async function fetchSeasonAll(mid, seasonId, ps) {
    const cookies = loadBiliCookie()
    const all = []
    let seasonName = ''
    let pn = 1
    let total = 0
    const pageSize = Math.min(ps || 100, 100)
    for (let i = 0; i < 10; i++) {
        const r = await axios.get('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list', {
            params: { mid, season_id: seasonId, sort_reverse: false, page_num: pn, page_size: pageSize },
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': `https://space.bilibili.com/${mid}/channel/collectiondetail?sid=${seasonId}`,
                'Cookie': biliCookieString(cookies)
            },
            timeout: 10000,
            validateStatus: () => true
        })
        const body = r.data
        if (typeof body !== 'object' || body?.code !== 0) {
            if (!all.length) return { err: (body && (body.message || body.msg)) || '获取合集内容失败' }
            break
        }
        const d = body.data || {}
        const arch = (d.archives || []).map(v => ({
            id: v.aid || v.id, bvid: v.bvid || '', title: v.title || '', cover: v.pic || '',
            duration: v.duration || 0, play: v.play || 0, created: v.created || 0
        }))
        all.push(...arch)
        total = d.page?.total || all.length
        if (!seasonName) seasonName = (d.meta && d.meta.name) || d.title || ''
        if (!arch.length || all.length >= total) break
        pn++
    }
    return { archives: all, total, seasonName }
}

// 合集/番剧展开：获取内部视频列表（内层是普通视频可下载）
// 三种形态：
//   isPgc / epId       → 番剧/影视：有 seasonId 直接查 pgc season；只有 epId 先抓 ep 页 HTML 提取 ss 号再查
//   bvid && !seasonId  → 普通视频查"所属合集"（x/web-interface/view 返回 data.ugc_season）
//   mid && seasonId    → UP主合集 seasons_archives_list
// 说明：收藏夹里收藏"合集下的单条视频"时，B站返回 type=2 普通视频，
//       只有通过 ugc_season 才能得知它属于哪个合集、有哪些集数。
ipcMain.handle('bilibili:fav-season', async (_, { mid, seasonId, bvid, epId, pn = 1, ps = 20, isPgc }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    try {
        // 番剧/影视：拿全部集数
        if (isPgc || epId) {
            let sid = seasonId
            // 只有 ep_id 时：抓 ep 播放页 HTML 提取 season_id（ss 号）
            if (!sid && epId) {
                try {
                    const ph = await axios.get(`https://www.bilibili.com/bangumi/play/ep${epId}`, {
                        headers: { 'User-Agent': PARSE_UA, 'Referer': `https://www.bilibili.com/bangumi/play/ep${epId}`, 'Cookie': biliCookieString(cookies) },
                        timeout: 10000,
                        validateStatus: () => true,
                        maxRedirects: 0
                    })
                    const html = typeof ph.data === 'string' ? ph.data : ''
                    const ssM = /ss(\d+)/.exec(html) || /"season_id":(\d+)/.exec(html)
                    if (ssM) sid = Number(ssM[1])
                } catch (e) { /* 页面抓取失败则直接尝试用 epId 当 season_id */ }
            }
            if (!sid) return { success: false, message: '无法获取该番剧的季号（season_id）' }
            const r = await axios.get('https://api.bilibili.com/pgc/view/web/season', {
                params: { season_id: sid },
                headers: {
                    'User-Agent': PARSE_UA,
                    'Referer': `https://www.bilibili.com/bangumi/play/ss${sid}`,
                    'Cookie': biliCookieString(cookies)
                },
                timeout: 10000,
                validateStatus: () => true
            })
            const body = r.data
            if (typeof body !== 'object' || body?.code !== 0) {
                return { success: false, message: (body && (body.message || body.msg)) || '获取番剧信息失败' }
            }
            // 注意：pgc 系列接口返回字段是 result 而非 data（与 x/ 系列接口不同）
            const d = body.data || body.result || {}
            const episodes = (d.episodes || []).map(ep => ({
                id: ep.id,
                bvid: ep.bvid || '',
                title: ep.long_title ? `${ep.title || ''} ${ep.long_title}`.trim() : (ep.title || ''),
                cover: ep.cover || d.cover || '',
                duration: 0, play: 0, created: 0
            }))
            return { success: true, seasonTitle: d.title || '', archives: episodes, total: episodes.length, hasMore: false }
        }
        // 普通视频查所属合集（UGP合集）：view 接口返回 data.ugc_season（只有 id/title/cover，没有集数！）
        // 拿到 season_id 后必须再调 seasons_archives_list 拉取全部集数
        if (bvid && !seasonId) {
            const rv = await axios.get('https://api.bilibili.com/x/web-interface/view', {
                params: { bvid },
                headers: {
                    'User-Agent': PARSE_UA,
                    'Referer': `https://www.bilibili.com/video/${bvid}`,
                    'Cookie': biliCookieString(cookies)
                },
                timeout: 10000,
                validateStatus: () => true
            })
            const bv = rv.data
            if (typeof bv !== 'object' || bv?.code !== 0) {
                return { success: false, message: (bv && (bv.message || bv.msg)) || '获取视频信息失败' }
            }
            const ugc = bv.data?.ugc_season
            if (!ugc || !ugc.id) {
                // UP主注销/删除时合集信息一并消失，给出针对性提示
                const ownerName = bv.data?.owner?.name || ''
                const ownerMid = bv.data?.owner?.mid || ''
                if (/注销|已删除/.test(ownerName)) {
                    return { success: false, message: '该视频UP主已注销，合集信息无法获取（视频仍可单独下载）' }
                }
                // 无 ugc_season：B站服务端未给该视频挂载合集信息（视频页也无合集标签）
                return {
                    success: false,
                    message: `该视频未挂载合集（仅单条视频）· 可复制分享链接到「网址解析」尝试解析；若确认在合集内，可能是合集信息更新延迟，稍后再试`
                }
            }
            // 用合集 id + UP主 mid 拉取全部集数（seasons_archives_list 是权威接口，自动翻页拉全）
            const ownerMid = bv.data?.owner?.mid
            if (!ownerMid) {
                return { success: false, message: '无法获取UP主信息，无法展开合集' }
            }
            const sa = await fetchSeasonAll(ownerMid, ugc.id, ps)
            if (sa.err) return { success: false, message: sa.err }
            return {
                success: true,
                seasonTitle: ugc.title || '',
                archives: sa.archives,
                total: sa.total,
                hasMore: false,
                viaUgc: true
            }
        }
        if (!seasonId || !mid) {
            return { success: false, message: '缺少合集信息（seasonId/mid）' }
        }
        const sa = await fetchSeasonAll(mid, seasonId, ps)
        if (sa.err) return { success: false, message: sa.err }
        return {
            success: true,
            seasonTitle: sa.seasonName || '',
            archives: sa.archives,
            total: sa.total,
            hasMore: false
        }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})

// 空间数据：自己账号信息 + 粉丝/关注 + 播放/点赞/阅读（数据小助手）
// 三个接口各自容错：任一失败不影响其他数据（acc/info 偶发 -401 反爬，重试一次）
async function biliGetJson(url, params, h, timeout = 10000) {
    const r = await axios.get(url, { params, headers: h, timeout, validateStatus: () => true })
    return r.data
}
ipcMain.handle('bilibili:space-info', async () => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const uid = cookies.DedeUserID
    if (!uid) return { success: false, message: '登录信息缺少用户ID，请重新登录' }
    const h = { 'User-Agent': PARSE_UA, 'Referer': `https://space.bilibili.com/${uid}`, 'Origin': 'https://space.bilibili.com', 'Cookie': biliCookieString(cookies) }
    const warns = []
    // 账号信息（偶发反爬，失败重试一次）
    let info = {}
    try {
        let d = await biliGetJson('https://api.bilibili.com/x/space/acc/info', { mid: uid }, h)
        if (d?.code !== 0) {
            d = await biliGetJson('https://api.bilibili.com/x/space/acc/info', { mid: uid }, h)
            if (d?.code !== 0) warns.push('账号信息获取失败：' + (d?.message || '风控拦截'))
        }
        info = d?.data || {}
    } catch (e) { warns.push('账号信息获取失败') }
    // 粉丝/关注
    let relD = {}
    try {
        const d = await biliGetJson('https://api.bilibili.com/x/relation/stat', { vmid: uid }, h)
        relD = d?.data || {}
        if (d?.code !== 0) warns.push('粉丝数据获取失败：' + (d?.message || '风控拦截'))
    } catch (e) { warns.push('粉丝数据获取失败') }
    // 播放/点赞/阅读
    let upD = {}
    try {
        const d = await biliGetJson('https://api.bilibili.com/x/space/upstat', { mid: uid }, h)
        upD = d?.data || {}
        if (d?.code !== 0) warns.push('播放数据获取失败：' + (d?.message || '风控拦截'))
    } catch (e) { warns.push('播放数据获取失败') }
    return {
        success: true,
        uid,
        name: info.name || '',
        face: info.face || '',
        sign: info.sign || '',
        level: info.level || 0,
        follower: relD.follower || 0,
        following: relD.following || 0,
        archiveView: upD.archive?.view || 0,
        archiveLike: upD.archive?.like || 0,
        articleView: upD.article?.view || 0,
        likes: upD.likes || 0,
        warns
    }
})



// ===== B站 TV 接口（云视听小电视） =====
// TV 端取流走 api.snm0516.aisee.tv（TvFetcher），固定 appkey/appsec 签名（无需 WBI / 网页 Cookie），
// 无水印片源：面向粉丝量大的 UP 主，投稿源多为无水印原档（BBDown 的 -tv 模式同款）。
// 未登录（无 access_key）时也能取流到 1080P 以下档位；要 1080P+/大会员档需 TV 端 access_key。
const BILI_TV_APPKEY = '4409e2ce8ffd12b8'
const BILI_TV_APPSEC = '59b43e04ad6965f34319062b478f83dd'
// TV 流必须用此 UA 且不带 Referer 才能通过防盗链（实测验证）
const BILI_TV_UA = 'BilibiliTV/106500 (Android TV; TV; 4.4.4)'

// APP 接口签名：参数按 key 字典序排列后 urlencode，尾部拼 appsec 做 MD5（32位小写）
function appSignParams(appkey, appsec, params) {
    const merged = { ...params, appkey }
    const keys = Object.keys(merged).sort()
    let q = ''
    for (const k of keys) q += `${k}=${encodeURIComponent(String(merged[k]))}&`
    q = q.slice(0, -1)
    const sign = crypto.createHash('md5').update(q + appsec).digest('hex')
    return { ...merged, sign }
}

// 读取/保存 B站解析接口模式（web | tv），持久化到 userData/bili-api.json
function getBiliApiJsonFile() {
    try { return path.join(app.getPath('userData'), 'bili-api.json') } catch (e) { return path.join(process.cwd(), 'bili-api.json') }
}
let biliApiModeCache = null  // 空 = 未读取
function readBiliApiMode() {
    if (biliApiModeCache) return biliApiModeCache
    try {
        const f = getBiliApiJsonFile()
        if (fs.existsSync(f)) {
            const d = JSON.parse(fs.readFileSync(f, 'utf8'))
            if (d && (d.mode === 'web' || d.mode === 'tv')) { biliApiModeCache = d.mode; return d.mode }
        }
    } catch (e) {}
    return 'web'
}
function saveBiliApiMode(mode) {
    try {
        const f = getBiliApiJsonFile()
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, JSON.stringify({ mode }), 'utf8')
        biliApiModeCache = mode
    } catch (e) {
        console.error('[BiliApi] 保存解析接口模式失败:', e.message)
    }
}
ipcMain.handle('bili-api:get-mode', () => readBiliApiMode())
ipcMain.handle('bili-api:set-mode', (_, mode) => {
    const m = mode === 'tv' ? 'tv' : 'web'
    saveBiliApiMode(m)
    return { success: true, mode: m }
})

// ===== B站 TV 端登录（云视听小电视 passport） =====
// TV 接口不吃网页 Cookie，必须用 TV 端独立的 access_key 才能解锁 1080P+/大会员档。
// 登录链路：生成二维码 → 手机 B站 App 扫码 → 轮询拿到 access_key → 持久化并注入取流请求。
const BILI_TV_TOKEN_FILE = () => path.join(app.getPath('userData'), 'bilibili-tv-token.json')
function loadBiliTvToken() {
    try {
        const raw = fs.readFileSync(BILI_TV_TOKEN_FILE(), 'utf8')
        const data = JSON.parse(raw)
        if (!data || !data.accessKey) return null
        // access_key 有效期内长期有效（按 30 天保守判断，超期强制重新扫码）
        if (data.savedAt && Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) return null
        return data
    } catch (e) { return null }
}
function saveBiliTvToken(token) {
    try { fs.writeFileSync(BILI_TV_TOKEN_FILE(), JSON.stringify({ ...token, savedAt: Date.now() }), 'utf8') } catch (e) {}
}
function randStr(len) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    let s = ''
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
}

// 生成 TV 登录二维码
ipcMain.handle('bilibili:tv-login-qr', async () => {
    const localId = randStr(20)
    const params = { local_id: localId, buvid: randStr(37), ts: Math.round(Date.now() / 1000) }
    const signed = appSignParams(BILI_TV_APPKEY, BILI_TV_APPSEC, params)
    try {
        const r = await axios.post('https://passport.snm0516.aisee.tv/x/passport-tv-login/qrcode/auth_code',
            new URLSearchParams(signed), {
            headers: { 'User-Agent': BILI_TV_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        })
        const d = r.data
        if (d?.code === 0 && d.data?.auth_code) {
            return { success: true, qrcodeUrl: d.data.url, authCode: d.data.auth_code, localId }
        }
        return { success: false, message: d?.message || 'TV登录二维码生成失败' }
    } catch (e) {
        return { success: false, message: e.message }
    }
})

// 轮询扫码状态；code=0 时拿到 access_key 并持久化
ipcMain.handle('bilibili:tv-login-check', async (_, { authCode, localId }) => {
    const params = { auth_code: authCode, local_id: localId, ts: Math.round(Date.now() / 1000) }
    const signed = appSignParams(BILI_TV_APPKEY, BILI_TV_APPSEC, params)
    try {
        const r = await axios.post('https://passport.snm0516.aisee.tv/x/passport-tv-login/qrcode/poll',
            new URLSearchParams(signed), {
            headers: { 'User-Agent': BILI_TV_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        })
        const d = r.data
        // code=0 且 data 中存在 token_info.access_token（H5 TV 登录）或 access_key（旧版 TV 登录）
        const tokenObj = d?.data?.token_info || d?.data || {}
        const accessKey = d?.code === 0 ? (tokenObj.access_token || tokenObj.access_key || '') : ''
        if (d?.code === 0 && accessKey) {
            const token = { accessKey, expiresIn: tokenObj.expires_in || 0, mid: tokenObj.mid || '' }
            saveBiliTvToken(token)
            return { success: true, loggedIn: true }
        }
        const statusMap = { 86101: 'waiting', 86039: 'waiting', 86090: 'scanned', 86038: 'expired' }
        return { success: true, loggedIn: false, status: statusMap[d?.code] || 'unknown' }
    } catch (e) {
        return { success: false, message: e.message }
    }
})

// TV 登录状态（返回本地持久化的 token 信息 + 通过 mid 拉取头像昵称）
ipcMain.handle('bilibili:tv-login-status', async () => {
    const token = loadBiliTvToken()
    if (!token) return { success: true, loggedIn: false }
    const base = { success: true, loggedIn: true, mid: token.mid || '', expiresIn: token.expiresIn || 0 }
    if (!token.mid) return base
    // 通过公开空间卡片接口拉取头像昵称（无需登录，慢速限频）
    try {
        const r = await axios.get('https://api.bilibili.com/x/web-interface/card', {
            params: { mid: token.mid },
            headers: { 'User-Agent': PARSE_UA, 'Referer': `https://space.bilibili.com/${token.mid}` },
            timeout: 8000,
            validateStatus: () => true
        })
        if (r.data?.code === 0 && r.data.data?.card) {
            base.userInfo = {
                uname: r.data.data.card.name || '',
                face: r.data.data.card.face || ''
            }
        }
    } catch (e) {}
    return base
})

// 退出 TV 登录
ipcMain.handle('bilibili:tv-logout', () => {
    try { fs.unlinkSync(BILI_TV_TOKEN_FILE()) } catch (e) {}
    return { success: true }
})

// TV 取流：返回 { dash, durl, quality } 或 null；qn 失败时由调用方降级重试
async function biliTvFetchPlayurl({ aid, cid, qn = 80, fourk = 1, bangumi = false, epId = '' }) {
    const tvToken = loadBiliTvToken()
    const params = {
        appkey: BILI_TV_APPKEY,
        build: '106500',
        cid,
        device: 'android',
        fnval: '4048',
        fnver: '0',
        fourk: fourk ? 1 : 0,
        mid: 0,
        mobi_app: 'android_tv_yst',
        object_id: aid || 0,
        platform: 'android',
        playurl_type: 1,
        qn,
        ts: Math.round(Date.now() / 1000)
    }
    // 已登录（TV 端 access_key）：解锁 1080P+/大会员档
    if (tvToken?.accessKey) {
        params.access_key = tvToken.accessKey
        if (tvToken.mid) params.mid = tvToken.mid
    }
    if (bangumi && epId) params.ep_id = epId
    if (!bangumi) params.bvid = ''
    const signed = appSignParams(BILI_TV_APPKEY, BILI_TV_APPSEC, params)
    const host = bangumi ? 'https://api.snm0516.aisee.tv/pgc/player/api/playurltv' : 'https://api.snm0516.aisee.tv/x/tv/playurl'
    try {
        const r = await axios.get(host, {
            params: signed,
            headers: {
                'User-Agent': BILI_TV_UA,
                'Referer': 'https://www.bilibili.com/',
                'Origin': 'https://www.bilibili.com'
            },
            timeout: 10000,
            validateStatus: () => true
        })
        if (r.data?.code !== 0 || !r.data.data) return null
        const d = r.data.data
        return {
            dash: d.dash || null,
            durl: (d.durl && d.durl.length) ? d.durl : null,
            quality: d.quality || 0
        }
    } catch (e) {
        return null
    }
}

// 用 TV 接口解析单 P：优先 durl（整段有声），DASH 视频流带 audioUrl 供合并
// 返回该 P 是否成功添加流
async function biliTvParsePage({ aid, cid, pTitle, addStream, bangumi = false, epId = '', qualityMap }) {
    const tryQns = [127, 116, 112, 80, 64, 32, 16]
    let lastErr = null
    // TV 接口 base_url 是 mcdn IP 直链（HTTP，稳定性差），优先 backup_url（upos-sz-mirror 域名，可被防盗链拦截匹配）
    const tvUrl = (v) => (v && (v.backup_url?.[0] || v.base_url || v.baseUrl)) || ''
    for (const qn of tryQns) {
        const res = await biliTvFetchPlayurl({ aid, cid, qn, fourk: 1, bangumi, epId })
        if (!res) { lastErr = 'tv-empty'; continue }
        // DASH：多画质输出（视频 + 对应音频）
        if (res.dash && (res.dash.video || []).length) {
            const audios = (res.dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
            const bestAudio = audios[0]
            const audioUrl = tvUrl(bestAudio)
            const videos = (res.dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
            const seenQ = new Set()
            for (const v of videos) {
                if (seenQ.has(v.id)) continue
                seenQ.add(v.id)
                const u = tvUrl(v)
                if (!u) continue
                const qLabel = qualityMap[v.id] || `${v.id}P`
                addStream(u, 'mp4', `${pTitle} [${qLabel} TV无水印·下载自动合并音频]`, { audioUrl, bili: true, tv: true })
            }
            return true
        }
        // durl：整段有声（可能分段）
        if (res.durl) {
            const qLabel = qualityMap[res.quality] || `${res.quality}P`
            res.durl.forEach((d, i) => {
                const u = tvUrl(d)
                if (!u) return
                const partTitle = res.durl.length > 1
                    ? `${pTitle} [${qLabel} TV无水印·有声] - 第${i + 1}段`
                    : `${pTitle} [${qLabel} TV无水印·有声]`
                addStream(u, 'mp4', partTitle, { bili: true, tv: true })
            })
            return true
        }
        // 该 qn 拿到返回但无流 → 直接换更低档
        lastErr = 'tv-no-stream'
    }
    return false
}

// ===== B站 WBI 签名（部分 space/polymer 接口需要） =====
const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
let wbiMixinKey = ''
let wbiKeyTime = 0
async function getWbiMixinKey(cookies) {
    // 缓存 1 小时
    if (wbiMixinKey && Date.now() - wbiKeyTime < 3600 * 1000) return wbiMixinKey
    try {
        const r = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': biliCookieString(cookies) },
            timeout: 10000,
            validateStatus: () => true
        })
        const wbi = r.data?.data?.wbi_img
        if (!wbi) return ''
        const getKey = (url) => {
            const base = String(url || '').split('?')[0]
            const m = base.match(/\/([\w-]+)\.(?:png|jpg|webp)$/i)
            return m ? m[1] : ''
        }
        const imgKey = getKey(wbi.img_url)
        const subKey = getKey(wbi.sub_url)
        if (!imgKey || !subKey) return ''
        const raw = imgKey + subKey
        let mixin = ''
        for (const i of MIXIN_KEY_ENC_TAB) mixin += raw[i] || ''
        wbiMixinKey = mixin.slice(0, 32)
        wbiKeyTime = Date.now()
        return wbiMixinKey
    } catch (e) {
        return ''
    }
}
// 对 params 应用 WBI 签名，返回带 wts/w_rid 的新参数对象
async function wbiSignParams(cookies, params) {
    const mixin = await getWbiMixinKey(cookies)
    if (!mixin) return null
    const wts = Math.round(Date.now() / 1000)
    const merged = { ...params, wts }
    const keys = Object.keys(merged).sort()
    let query = ''
    for (const k of keys) query += `${k}=${encodeURIComponent(merged[k])}&`
    query = query.slice(0, -1)
    const wRid = crypto.createHash('md5').update(query + mixin).digest('hex')
    return { ...merged, w_rid: wRid }
}


// 稿件管理：已投稿列表
// 创作中心接口 x/vu/web/archive/list 对部分账号返回 404/HTML（需 WBI 或风控），
// 改用已验证可用的空间投稿接口 x/space/arc/search（mid=自己，返回自己的全部投稿）
ipcMain.handle('bilibili:archives', async (_, { pn = 1, ps = 10 }) => {
    const cookies = loadBiliCookie()
    if (!cookies?.SESSDATA) return { success: false, message: '请先登录B站账号' }
    const uid = cookies.DedeUserID
    if (!uid) return { success: false, message: '登录信息缺少用户ID，请重新登录' }
    try {
        const r = await axios.get('https://api.bilibili.com/x/space/arc/search', {
            params: { mid: uid, pn, ps: Math.min(ps, 30), order: 'pubdate' },
            headers: {
                'User-Agent': PARSE_UA,
                'Referer': `https://space.bilibili.com/${uid}`,
                'Cookie': biliCookieString(cookies)
            },
            timeout: 10000,
            validateStatus: () => true
        })
        const body = r.data
        if (typeof body !== 'object' || body?.code !== 0) {
            return { success: false, message: (body && (body.message || body.msg)) || '获取稿件列表失败' }
        }
        const vlist = body.data?.list?.vlist || []
        const archives = vlist.map(v => ({
            aid: v.aid, bvid: v.bvid || '', title: v.title || '', cover: v.pic || '',
            state: 0, pubtime: v.created || 0, play: v.play || 0, danmaku: v.video_review || 0
        }))
        return { success: true, archives, count: body.data?.page?.count || archives.length }
    } catch (e) {
        return { success: false, message: '请求失败：' + (e?.response?.data?.message || e.message) }
    }
})


ipcMain.handle('video:parse-url', async (_, { url }) => {
    try {
        const target = String(url || '').trim()
        if (!/^https?:\/\//i.test(target)) {
            return { success: false, message: '请输入以 http:// 或 https:// 开头的网址' }
        }

        // B站解析接口模式（web | tv）：全局持久化，可在解析界面切换
        const biliApiMode = readBiliApiMode()

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
            if (extra.ytSrc) item.ytSrc = extra.ytSrc
            if (extra.ytHeight) item.ytHeight = extra.ytHeight
            if (extra.isLive) item.isLive = true
            // 抖音/快手无水印解析：封面与"无水印"标记
            if (extra.cover) item.cover = extra.cover
            if (extra.watermarkFree) item.watermarkFree = true
            // 画质标签（抖音多画质）：用于列表展示，如 '1080p 超清'
            if (extra.quality) item.quality = extra.quality
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

        // === 抖音直播解析（优先尝试直播流） ===
        if (/live\.douyin\.com/i.test(target)) {
            const douyinResult = await parseDouyinLive(target, addStream)
            if (douyinResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: douyinResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析抖音直播流（可能未开播或房间号无效）', pageUrl: target }
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

        // === Kick 直播解析 ===
        if (/kick\.com/i.test(target)) {
            const kResult = await parseKick(target, addStream)
            if (kResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: kResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析 Kick 直播流（可能未开播或频道名无效）', pageUrl: target }
        }

        // === YouTube 直播/视频解析 ===
        if (/youtu\.be|youtube\.com/i.test(target)) {
            const ytResult = await parseYouTube(target, addStream)
            if (ytResult) {
                const streams = Array.from(found.values())
                return { success: true, streams, pageTitle: ytResult.title || '', pageUrl: target, isLive: true }
            }
            return { success: false, message: '未能解析 YouTube 直播流', pageUrl: target }
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
                const bgmResult = await parseBilibiliBangumi(target, addStream, biliApiMode)
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
            const biliResult = await parseBilibili(target, addStream, biliApiMode)
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
    // --- 启动酷狗音乐 API 子进程(监听 3300 端口,概念版 platform=lite) ---
    startKugouMusicAPI()
    // --- 启动网易云 API 子进程(NeteaseCloudMusicApiEnhanced,监听 3100 端口) ---
    startNeteaseAPI()

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

// ===== 音乐命名格式配置（下载命名 + 本地识别，设置页可切换，主进程持久化）=====
// download: 'song-artist'（歌名 - 作者）/ 'artist-song'（作者 - 歌名）
// local: 同上，用于把本地文件名解析出 歌名/作者
function getMusicNamingFile() {
    try {
        return path.join(app.getPath('userData'), 'music-naming.json')
    } catch (e) {
        return path.join(process.cwd(), 'music-naming.json')
    }
}
function readMusicNaming() {
    try {
        const f = getMusicNamingFile()
        if (fs.existsSync(f)) {
            const d = JSON.parse(fs.readFileSync(f, 'utf8'))
            if (d && (d.download === 'song-artist' || d.download === 'artist-song')) return d
        }
    } catch (e) {}
    return { download: 'song-artist', local: 'song-artist' }
}
function saveMusicNaming(d) {
    try {
        const f = getMusicNamingFile()
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, JSON.stringify(d || {}), 'utf8')
    } catch (e) {
        console.error('[MusicNaming] 保存音乐命名格式失败:', e.message)
    }
}
ipcMain.handle('music-naming:get', () => readMusicNaming())
ipcMain.handle('music-naming:save', (_, d) => {
    const cur = readMusicNaming()
    if (d && typeof d === 'object') {
        if (d.download === 'song-artist' || d.download === 'artist-song') cur.download = d.download
        if (d.local === 'song-artist' || d.local === 'artist-song') cur.local = d.local
    }
    saveMusicNaming(cur)
    return { success: true, ...cur }
})
// 把本地文件名（无扩展名）按指定格式解析出 { name, artist }，不匹配返回 null
// 支持 "歌名 - 作者"（song-artist）与 "作者 - 歌名"（artist-song）
function parseLocalFileName(fileBase, format) {
    const base = String(fileBase || '').trim()
    if (!base) return null
    const parts = base.split(' - ')
    if (parts.length < 2) return null
    const a = parts[0].trim()
    const b = parts.slice(1).join(' - ').trim()
    if (!a || !b) return null
    return format === 'artist-song' ? { name: b, artist: a } : { name: a, artist: b }
}

ipcMain.handle('download-song', async (_, { url, name, artist, picUrl }) => {
    // 委托给统一下载管理器，category='music'，封面单独后台下载
    // 文件名格式随设置：'歌名 - 作者'（默认）或 '作者 - 歌名'
    const naming = readMusicNaming()
    let fullName = name
    if (artist) {
        fullName = naming.download === 'artist-song' ? `${artist} - ${name}` : `${name} - ${artist}`
    }
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
        } catch (e) {
            // ffmpeg 失败时 fallback 到手动构建标准 APIC frame
            writeMP3CoverStandard(songPath, coverBuf, coverMime)
        }
        // 验证封面是否真的写入
        try {
            NodeID3.read(songPath)
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
            // 格式与扩展名不符,按实际格式处理
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
            }
            if (lyrics) updates.LYRICS = lyrics
            injectOggComments(filePath, updates)
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
            }
            injectFlacComments(filePath, updates)
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
            // 格式与扩展名不符,按实际格式处理
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
    // 退出前停止酷狗音乐 API 子进程
    stopKugouMusicAPI()
    // 退出前停止网易云 API 子进程
    stopNeteaseAPI()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
})
