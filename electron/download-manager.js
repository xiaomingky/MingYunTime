// electron/download-manager.js
// 统一下载管理器
// - 直链（mp4/mp3 等）：内置 128 线程分片下载（不限速，不依赖 aria2c）
// - m3u8 流：ffmpeg 合并为 mp4
// - 本地文件：直接复制
// - 统一历史记录（持久化到磁盘），分类：music / movie / anime / mv / video
// - 同时发送新事件（download:*）和旧事件（video-download-*）以兼容 VideoDownloadToast
import { ipcMain, app, dialog } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import axios from 'axios'

// 自定义 Agent：解除默认 maxSockets 限制，支持 128 路并发不限速
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256 })
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256 })

// 动态解析 aria2c / ffmpeg 路径（打包进程序，不依赖外部路径）
function resolveTool(name) {
  // 打包后：extraResources 中的文件放在 process.resourcesPath 根目录
  if (app.isPackaged) {
    const packed = path.join(process.resourcesPath, name)
    if (fs.existsSync(packed)) return packed
  }
  // 开发环境：项目根目录 resources/
  const dev = path.join(process.env.APP_ROOT || process.cwd(), 'resources', name)
  if (fs.existsSync(dev)) return dev
  // 兜底：系统 PATH
  return name
}

const ARIA2C_PATH = resolveTool('aria2c.exe')
const FFMPEG_PATH = resolveTool('ffmpeg.exe')
const YTDLP_PATH = resolveTool('yt-dlp.exe')

// YouTube 登录 Cookie 文件（Netscape 格式，由主进程在官方网页登录后写入），存在即代表已登录
function getYoutubeCookieFile() {
  try {
    const f = path.join(app.getPath('userData'), 'youtube-cookies.txt')
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return f
  } catch (e) {}
  return null
}
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 进行中的下载：id -> { process, canceled, cancel(), controller, _lastReport }
const activeDownloads = new Map()
// 全部下载历史（含进行中）：id -> record
const downloadHistory = new Map()
// 类别 -> 中文标签
const CATEGORY_LABELS = {
  music: '音乐',
  movie: '影视',
  anime: '动漫',
  mv: 'MV',
  video: '视频',
  document: '文档'
}

let win = null
function setWindow(w) { win = w }
function emit(channel, data) { win?.webContents.send(channel, data) }

function maskUrl(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    const last = segs.length ? segs[segs.length - 1] : ''
    return `${u.protocol}//${u.host}/***${last ? '/' + last : ''}`
  } catch (e) { return '***' }
}

function genId() {
  return 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

// ===== 磁盘持久化（仅元数据，不含进行中状态） =====
let historyFile = ''
let historyLoaded = false
function getHistoryFile() {
  if (historyFile) return historyFile
  try {
    historyFile = path.join(app.getPath('userData'), 'download-history.json')
  } catch (e) {
    historyFile = path.join(process.cwd(), 'download-history.json')
  }
  return historyFile
}

function loadHistory() {
  if (historyLoaded) return
  historyLoaded = true
  try {
    const f = getHistoryFile()
    if (fs.existsSync(f)) {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (Array.isArray(arr)) {
        for (const item of arr) {
          // 重启后，原本"下载中"的标记为"已中断"
          if (item.status === 'downloading' || item.status === 'pending') {
            item.status = 'interrupted'
            item.error = '应用重启，下载已中断'
          }
          downloadHistory.set(item.id, item)
        }
      }
    }
  } catch (e) {
    console.error('[DownloadManager] 加载历史失败:', e.message)
  }
}

// ===== 统一下载目录（设置页"下载专区"配置，所有下载共用） =====
function getDirSettingFile() {
  try {
    return path.join(app.getPath('userData'), 'download-dir.json')
  } catch (e) {
    return path.join(process.cwd(), 'download-dir.json')
  }
}

// 读取用户设置的下载目录（未设置返回 ''）
function readSavedDownloadDir() {
  try {
    const f = getDirSettingFile()
    if (fs.existsSync(f)) {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (d && typeof d.dir === 'string' && d.dir.trim()) return d.dir.trim()
    }
  } catch (e) {}
  return ''
}

// 保存下载目录设置（dir 传空表示恢复系统默认）
function saveDownloadDir(dir) {
  try {
    const f = getDirSettingFile()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify({ dir: dir || '' }), 'utf8')
  } catch (e) {
    console.error('[DownloadManager] 保存下载目录失败:', e.message)
  }
}

// 统一下载目录：优先用户设置，未设置时回退系统下载区
function resolveDownloadDir() {
  return readSavedDownloadDir() || app.getPath('downloads')
}

function saveHistory() {
  try {
    const f = getHistoryFile()
    // 只持久化最近 200 条，避免无限增长
    const arr = Array.from(downloadHistory.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .slice(0, 200)
    fs.writeFileSync(f, JSON.stringify(arr, null, 2), 'utf8')
  } catch (e) {
    console.error('[DownloadManager] 保存历史失败:', e.message)
  }
}

// ===== 选择保存路径 =====
async function pickSavePath(defaultName, ext, category) {
  const safeExt = ext || ''
  const safeName = (String(defaultName || 'download').replace(/[\\/:*?"<>|]/g, '_').trim()) + safeExt
  const defaultDir = resolveDownloadDir() // 弹窗默认定位到设置页"下载专区"配置的统一下载目录
  const title = category === 'music' ? '选择音乐保存位置' : '选择视频保存位置'
  const filters = category === 'music'
    ? [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'm4a'] }, { name: 'All Files', extensions: ['*'] }]
    : [{ name: 'MP4 Video', extensions: ['mp4'] }, { name: 'All Files', extensions: ['*'] }]
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath: path.join(defaultDir, safeName),
    filters
  })
  if (canceled || !filePath) return null
  return filePath
}

// 根据URL/类别推导扩展名
function deriveExt(url, category) {
  if (category === 'music') {
    const m = url.match(/\.(\w{2,4})(\?|$)/i)
    if (m && ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'ape', 'aac'].includes(m[1].toLowerCase())) return '.' + m[1].toLowerCase()
    return '.mp3'
  }
  if (/\.m3u8(\?|$)/i.test(url)) return '.mp4'
  // B站 DASH 的 .m4s 音频/视频流 下载后由 ffmpeg 合并为 mp4，统一用 .mp4 后缀
  if (/\.m4s(\?|$)/i.test(url)) return '.mp4'
  const m = url.match(/\.(\w{2,4})(\?|$)/i)
  if (m) return '.' + m[1].toLowerCase()
  return '.mp4'
}

// 解析 aria2c 进度行：[#abc 56MiB/120MiB(46%) CN:16 DL:8MiB ETA:8s]
function parseSize(s) {
  if (!s) return 0
  const m = String(s).match(/^([\d.]+)\s*([KMG]?i?B?)$/i)
  if (!m) return 0
  const num = parseFloat(m[1])
  const unit = (m[2] || '').toUpperCase()
  if (unit.startsWith('K')) return num * 1024
  if (unit.startsWith('M')) return num * 1024 * 1024
  if (unit.startsWith('G')) return num * 1024 * 1024 * 1024
  return num
}

// ===== 启动下载（核心入口） =====
async function startDownload(params) {
  loadHistory()
  const { url, name, type, category, savePath, askPath, audioUrl, ytSrc, ytHeight, ytAuthed } = params
  if (!url) return { success: false, error: '缺少下载地址' }

  // 自动为各平台 CDN 注入 Referer（视频流需要对应 Referer 才能访问，否则 403）
  let headers = params.headers
  const injectReferer = (hostRe, referer) => {
    if (hostRe.test(url)) {
      headers = Object.assign({ 'Referer': referer, 'User-Agent': DEFAULT_UA }, headers || {})
    }
  }
  // TV 接口流（platform=android_tv_yst 签名）：必须用 BilibiliTV UA 且不能带 Referer（实测带 Referer/浏览器 UA → 403）
  if (/platform=android_tv_yst/i.test(url)) {
    headers = Object.assign({ 'User-Agent': 'BilibiliTV/106500 (Android TV; TV; 4.4.4)' }, headers || {})
  } else {
    injectReferer(/bilivideo\.(com|cn)|edge\.mountaintoys\.cn|mcdn/i, 'https://www.bilibili.com/')
    // 抖音 CDN（play_addr 直链形如 www.douyin.com/aweme/v1/play/... 会 302 到 douyinvod/bytecdn 等最终 CDN，
    // 2026-08-25 实测：不带 douyin Referer + 浏览器 UA 时最终 CDN 返回 403，后续 302 会沿用注入的 Referer）
    injectReferer(/douyinvod\.com|bytecdn\.cn|ixigua\.com|byteimg\.com|douyinstatic|(?:www\.)?douyin\.com\/aweme|snssdk\.com|iesdouyin\.com/i, 'https://www.douyin.com/')
    // 快手 CDN
    injectReferer(/kwaicdn\.com|kwai\.com|gifshow\.com|ksapisrc\.com|kwaixia\.com|kscube\.com/i, 'https://www.kuaishou.com/')
  }

  // 统一 headers 为字符串格式（"Key: Value\r\nKey2: Value2"），下游下载函数统一用 split 解析
  if (headers && typeof headers === 'object') {
    headers = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
  }

  const id = genId()
  const cat = category || 'video'
  const safeName = String(name || 'download').replace(/[\\/:*?"<>|]/g, '_').trim()
  const ext = deriveExt(url, cat)

  // 选择保存路径：仅当调用方显式 askPath === true 时才弹窗选择；
  // 其余一律按"统一下载目录"直接下载（设置页"下载专区"配置，未配置用系统下载区）
  let outputPath = savePath
  if (!outputPath && askPath === true) {
    outputPath = await pickSavePath(safeName, ext, cat)
    if (!outputPath) return { success: false, canceled: true }
  }
  if (!outputPath) {
    // 兜底：未指定保存路径时统一存到"下载专区"配置的目录（未配置则系统下载区）
    outputPath = path.join(resolveDownloadDir(), safeName + ext)
  }
  // 规范化路径（前端可能传混用分隔符的 Windows 路径）
  try { outputPath = path.normalize(outputPath) } catch (e) {}
  // 指定的保存路径可能带不存在的子目录（如"下载区/视频名/视频名.mp4"），自动创建，避免下载失败
  try {
    const dir = path.dirname(outputPath)
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true })
  } catch (e) { /* 目录创建失败不阻塞，下游下载函数仍会尝试 */ }

  const record = {
    id,
    type: cat,
    typeLabel: CATEGORY_LABELS[cat] || '视频',
    name: safeName,
    url,
    urlMasked: maskUrl(url),
    path: outputPath,
    status: 'pending',
    percent: 0,
    received: 0,
    total: 0,
    speed: 0,
    currentTime: 0,
    error: '',
    startTime: Date.now(),
    endTime: 0
  }
  downloadHistory.set(id, record)
  saveHistory()

  // 发送 started 事件（新+旧）
  emit('download:started', { ...record })
  // 兼容旧 Toast：用 downloadId 字段名
  emit('video-download-started', { downloadId: id, name: safeName, path: outputPath, category: cat })
  // 立即发送初始进度事件，让 UI 马上显示"下载中"状态（防止快速下载完成前看不到进度）
  emit('download:progress', { id, percent: 0, received: 0, total: 0, speed: 0 })
  emit('video-download-progress', { downloadId: id, percent: 0, received: 0, total: 0, speed: 0 })

  // 分流：YouTube(yt-dlp) / DASH 音视频分离 / 本地文件 / m3u8 / 直链
  if (ytSrc && /^https?:\/\//i.test(ytSrc)) {
    // YouTube：交给 yt-dlp 下载并自动合并音视频为 mp4
    startYoutubeDlpDownload(id, ytSrc, ytHeight, ytAuthed, outputPath, record)
  } else if (audioUrl && /^https?:\/\//i.test(audioUrl)) {
    // DASH 格式：分别下载 video 和 audio，再用 ffmpeg 流复制合并（极快）
    startDashMergeDownload(id, url, audioUrl, outputPath, headers, record)
  } else if (url.startsWith('local-file://') || url.startsWith('file://')) {
    startLocalCopy(id, url, outputPath, record)
  } else if (/\.m3u8(\?|$)/i.test(url) || type === 'm3u8') {
    // m3u8：并行分片下载 + ffmpeg 本地 concat 合并
    startM3u8SegmentsDownload(id, url, outputPath, headers, record)
  } else {
    // 直链：内置 128 线程分片下载（不限速，不依赖 aria2c）
    startBuiltinMultithread(id, url, outputPath, headers, record, !!params.autoName, Number(params.threads) || 0)
  }

  return { success: true, downloadId: id, path: outputPath }
}

// ===== 本地文件复制 =====
function startLocalCopy(id, url, outputPath, record) {
  setImmediate(async () => {
    try {
      const localPath = url.replace(/^local-file:\/\//, '').replace(/^file:\/\//, '')
      const decoded = decodeURIComponent(localPath)
      await fs.promises.copyFile(decoded, outputPath)
      record.status = 'done'
      record.percent = 100
      record.endTime = Date.now()
      // 计算平均速度
      const dur = (record.endTime - record.startTime) / 1000
      if (dur > 0 && record.total > 0) {
        record.speed = Math.round(record.total / dur)
      }
      saveHistory()
      emit('download:progress', { id, percent: 100, done: true })
      emit('video-download-progress', { downloadId: id, percent: 100, done: true })
      emit('download:done', { id, path: outputPath, speed: record.speed })
      emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })
    } catch (e) {
      record.status = 'error'
      record.error = e.message
      record.endTime = Date.now()
      saveHistory()
      emit('download:error', { id, error: e.message })
      emit('video-download-error', { downloadId: id, error: e.message })
    }
  })
}

// ===== YouTube 下载（yt-dlp，自动合并音视频为 mp4） =====
function startYoutubeDlpDownload(id, ytSrc, ytHeight, ytAuthed, outputPath, record) {
  // yt-dlp 会自动补扩展名，去掉我们推导的 .mp4 避免变成 .mp4.mp4
  const base = String(outputPath || '').replace(/\.[^.\/\\]+$/, '')
  const format = ytHeight ? `bestvideo[height<=${ytHeight}]+bestaudio/best[height<=${ytHeight}]/best` : 'bestvideo+bestaudio/best'

  const args = [
    '--no-warnings', '--no-mtime', '--newline',
    '-f', format,
    '--merge-output-format', 'mp4',
    '-o', base,
    '--restrict-filenames',
    '--progress-template', 'download:[download] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s'
  ]
  // aria2c 外部下载器（单服务器连接上限 16，64 分片尽量压满带宽，不限速）
  if (fs.existsSync(ARIA2C_PATH)) {
    args.push(
      '--downloader', 'aria2c',
      '--downloader-args', `aria2c:-x16 -s64 --max-download-limit=0 --max-overall-download-limit=0 --file-allocation=none --console-log-level=warn --summary-interval=0`
    )
  }
  // 已登录（官方网页 Cookie 已写入）时启用账号画质/会员内容：yt-dlp 最新版仅支持 --cookies
  // 只要 Cookie 文件存在就带上（不管前端是否显式传了 ytAuthed）
  const ytCookieFile = getYoutubeCookieFile()
  if (ytCookieFile) {
    args.push('--cookies', ytCookieFile)
  }
  args.push(ytSrc)

  const proc = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const state = { canceled: false, _lastReport: 0, startTime: Date.now() }
  activeDownloads.set(id, {
    process: proc,
    canceled: false,
    cancel: () => { state.canceled = true; try { proc.kill() } catch (e) {} }
  })
  record.status = 'downloading'

  const reportProgress = (percent, total, speed) => {
    record.percent = percent
    record.total = total || record.total
    record.speed = speed
    const now = Date.now()
    if (now - state._lastReport > 400) {
      state._lastReport = now
      emit('download:progress', { id, percent, received: total || 0, total: total || 0, speed })
      emit('video-download-progress', { downloadId: id, percent, received: total || 0, total: total || 0, speed })
    }
  }

  const parseProgress = (line) => {
    // yt-dlp 原生格式: [download]  45.2% of ~  12.34MiB at  3.42MiB/s ETA 00:03
    // yt-dlp template: [download] 45.2% of 12.34MiB at 3.42MiB/s ETA 00:03
    let m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+[KMGTP]?i?B)\s+at\s+([\d.]+[KMGTP]?i?B\/s)/i)
    if (m) {
      reportProgress(Math.min(100, parseFloat(m[1])), parseSize(m[2]), parseSize(m[3]))
      return
    }
    // aria2c 格式: [#abc123 12.34MiB/45.67MiB(27%) CN:16 DL:3.42MiB ETA:1m23s]
    m = line.match(/\[#[\w]+\s+([\d.]+[KMGTP]?i?B)\/([\d.]+[KMGTP]?i?B)\((\d+)%\).*?DL:([\d.]+[KMGTP]?i?B)/i)
    if (m) {
      reportProgress(Math.min(100, parseInt(m[3])), parseSize(m[2]), parseSize(m[4]))
      return
    }
    // aria2c 简化格式: [#abc123 12.34MiB/45.67MiB(27%)]
    m = line.match(/\[#[\w]+\s+([\d.]+[KMGTP]?i?B)\/([\d.]+[KMGTP]?i?B)\((\d+)%\)/i)
    if (m) {
      reportProgress(Math.min(100, parseInt(m[3])), parseSize(m[2]), 0)
      return
    }
    // 合并阶段：[Merger] Merging formats into "..."
    if (/\[Merger\]/.test(line)) reportProgress(99, 0, 0)
  }

  const onData = (chunk) => String(chunk).split(/\r?\n/).forEach(parseProgress)
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)

  proc.on('error', (err) => {
    console.warn(`[DownloadManager] yt-dlp 启动失败: ${err.message}`)
    record.status = 'error'
    record.error = 'yt-dlp 启动失败：' + err.message
    record.endTime = Date.now()
    saveHistory()
    activeDownloads.delete(id)
    emit('download:error', { id, error: record.error })
    emit('video-download-error', { downloadId: id, error: record.error })
  })

  proc.on('close', (code) => {
    activeDownloads.delete(id)
    // 定位 yt-dlp 实际产出的文件（base + 任意视频扩展名）
    let finalPath = ''
    try {
      const dir = path.dirname(base)
      const bname = path.basename(base)
      const exts = ['mp4', 'mkv', 'webm', 'flv', 'mov', 'm4a', 'mp3', 'ogg', 'opus']
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(bname)) {
          const e = f.split('.').pop().toLowerCase()
          if (exts.includes(e)) { finalPath = path.join(dir, f); break }
        }
      }
    } catch (e) {}

    if (state.canceled) {
      record.status = 'canceled'
      record.error = '用户取消'
      try { if (finalPath && fs.existsSync(finalPath)) fs.unlinkSync(finalPath) } catch (e) {}
    } else if (code !== 0) {
      record.status = 'error'
      record.error = `yt-dlp 下载失败（退出码 ${code}）`
      try { if (finalPath && fs.existsSync(finalPath)) fs.unlinkSync(finalPath) } catch (e) {}
    } else if (!finalPath) {
      record.status = 'error'
      record.error = '未找到下载产物'
    } else {
      // 若产物扩展名与预期(record.path)不同，重命名到 record.path
      try {
        if (finalPath !== outputPath && !fs.existsSync(outputPath)) fs.renameSync(finalPath, outputPath)
        finalPath = outputPath
      } catch (e) {}
      record.status = 'done'
      record.percent = 100
      try { record.total = fs.statSync(finalPath).size; record.received = record.total } catch (e) {}
    }
    record.endTime = Date.now()
    const dur = (record.endTime - record.startTime) / 1000
    if (record.status === 'done' && dur > 0 && record.total > 0) {
      record.speed = Math.round(record.total / dur)
    } else if (record.status !== 'done') {
      record.speed = 0
    }
    saveHistory()

    if (record.status === 'done') {
      emit('download:done', { id, path: record.path, speed: record.speed })
      emit('video-download-done', { downloadId: id, path: record.path, name: record.name, category: record.type, speed: record.speed })
    } else {
      emit('download:error', { id, error: record.error })
      emit('video-download-error', { downloadId: id, error: record.error })
    }
  })
}

// ===== 内置 128 线程分片下载（直链统一入口，不限速，不依赖外部工具） =====
async function startBuiltinMultithread(id, url, outputPath, extraHeaders, record, autoName = false, customThreads = 0) {
  const state = { canceled: false, paused: false, autoName, customThreads, startTime: Date.now() }
  record.engine = 'multi'
  activeDownloads.set(id, {
    canceled: false,
    cancel: () => { state.canceled = true; try { state.abortAll?.() } catch (e) {} },
    pause: () => { state.paused = true; try { state.abortAll?.() } catch (e) {} },
    resume: () => { state.paused = false }
  })
  record.status = 'downloading'
  try {
    // 暂停→等待恢复循环：downloadFileMultithread 返回 {paused:true} 时保留分片目录等待续传
    while (true) {
      const r = await downloadFileMultithread(url, outputPath, extraHeaders, (received, total, speed) => {
        record.received = received
        record.total = total
        record.percent = total ? Math.min(100, (received / total) * 100) : 0
        record.speed = speed
        emit('download:progress', { id, percent: record.percent, received, total, speed })
        emit('video-download-progress', { downloadId: id, percent: record.percent, received, total, speed })
      }, state)
      if (r?.paused) {
        record.status = 'paused'
        record.speed = 0
        saveHistory()
        emit('download:paused', { id })
        while (state.paused && !state.canceled) await new Promise(res => setTimeout(res, 250))
        if (state.canceled) throw new Error('已取消')
        record.status = 'downloading'
        continue
      }
      // Content-Disposition 实际文件名（未手动命名时采用）：合并前已在函数内改写目标路径
      if (r?.name) {
        outputPath = path.join(path.dirname(outputPath), r.name)
        record.name = path.basename(outputPath)
        record.path = outputPath
        saveHistory()
      }
      record.status = 'done'
      record.percent = 100
      record.endTime = Date.now()
      try { record.total = fs.statSync(outputPath).size; record.received = record.total } catch (e) {}
      // 计算平均速度（保留显示），不清零
      const dur = (record.endTime - record.startTime) / 1000
      if (dur > 0 && record.total > 0) {
        record.speed = Math.round(record.total / dur)
      }
      saveHistory()
      activeDownloads.delete(id)
      emit('download:done', { id, path: outputPath, speed: record.speed })
      emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })
      return
    }
  } catch (e) {
    record.status = state.canceled ? 'canceled' : (e.paused || state.paused ? 'paused' : 'error')
    record.error = state.canceled ? '已取消' : e.message
    record.endTime = Date.now()
    record.speed = 0
    saveHistory()
    activeDownloads.delete(id)
    // 清理半成品与分片临时目录（分片目录带随机后缀，按 前缀 扫描删除；暂停的任务保留目录供续传）
    try {
      if (!state.paused && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    } catch (er) {}
    if (!state.paused) {
      try {
        const pdir = path.dirname(outputPath)
        const pbase = path.basename(outputPath)
        for (const f of fs.readdirSync(pdir)) {
          if (f.startsWith(pbase + '.parts')) {
            try { fs.rmSync(path.join(pdir, f), { recursive: true, force: true }) } catch (er) {}
          }
        }
      } catch (er) {}
    }
    emit('download:error', { id, error: record.error })
    emit('video-download-error', { downloadId: id, error: record.error })
  }
}


// ===== 多线程分片下载核心（128 线程封顶 / 分片级断点重试 / 流式合并） =====
// 基于 axios + 自定义 Agent（maxSockets: Infinity + keepAlive），Range 分片不限速榨干带宽
const DL_MAX_THREADS = 128              // 最大并发线程数
const DL_MIN_PART = 4 * 1024 * 1024     // 最小分片 4MB（小文件自动减线程；4MB 起 128 并发对网盘/限流源过于激进易 403）

// 探测文件大小与 Range 支持：HEAD 优先；被拒时用 GET Range: bytes=0-0 兜底
// （B站 TV 签名 URL 等部分 CDN 拒绝 HEAD，GET 探测成功才能解锁 128 线程）
async function probeDownload(url, headerObj) {
  const head = await axios.head(url, { headers: headerObj, timeout: 15000, maxRedirects: 5, httpsAgent, httpAgent, validateStatus: () => true }).catch(() => null)
  if (head && (head.status === 200 || head.status === 206)) {
    const total = parseInt(head.headers?.['content-length'] || '0', 10)
    const ranged = (head.headers?.['accept-ranges'] || '').toLowerCase() === 'bytes'
    if (total > 0 && ranged) return { total, ranged: true }
    if (total > 0) return { total, ranged: false }
  }
  const res = await axios.get(url, {
    headers: { ...headerObj, Range: 'bytes=0-0' },
    timeout: 15000, maxRedirects: 5, httpsAgent, httpAgent,
    validateStatus: () => true, responseType: 'stream'
  }).catch(() => null)
  if (res) {
    try { res.data?.destroy?.() } catch (e) {}
    const m = String(res.headers?.['content-range'] || '').match(/\/(\d+)\s*$/)
    if (res.status === 206 && m) return { total: parseInt(m[1], 10), ranged: true }
    if (res.status > 0 && res.status < 300) {
      const total = parseInt(res.headers?.['content-length'] || '0', 10)
      if (total > 0) return { total, ranged: false }
    }
  }
  return { total: 0, ranged: false }
}

async function downloadFileMultithread(url, filePath, extraHeaders, onProgress, state) {
  // 暂停/取消统一经 AbortController 中止在途请求；partDir 挂在 state 上供暂停-恢复复用
  const ac = new AbortController()
  state.abortAll = () => { try { ac.abort() } catch (e) {} }
  const headerObj = { 'User-Agent': DEFAULT_UA }
  if (extraHeaders) {
    for (const line of extraHeaders.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) headerObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }

  const { total, ranged } = await probeDownload(url, headerObj)

  // 滑动窗口实时速度（500ms 窗口，比平均值更贴近真实带宽）
  let winT = Date.now()
  let winBytes = 0
  let winSpeed = 0
  const currentSpeed = (received) => {
    const now = Date.now()
    if (now - winT >= 500) {
      winSpeed = Math.round((received - winBytes) / ((now - winT) / 1000))
      winT = now
      winBytes = received
    }
    return winSpeed
  }

  // 上报节流（300ms 一报；调用方可能再节流一层，双节流无害）
  let reportT = 0
  let receivedTotal = 0
  const maybeReport = (force) => {
    const now = Date.now()
    if (force || now - reportT >= 300) {
      reportT = now
      if (onProgress) onProgress(receivedTotal, total, currentSpeed(receivedTotal))
    }
  }

  if (!total || !ranged) {
    // 服务器不支持 Range / 未知大小 → 单线程直下
    const res = await axios.get(url, { responseType: 'stream', headers: headerObj, timeout: 0, maxRedirects: 5, httpsAgent, httpAgent })
    const ws = fs.createWriteStream(filePath)
    for await (const chunk of res.data) {
      if (state.canceled) { ws.destroy(); throw new Error('已取消') }
      ws.write(chunk)
      receivedTotal += chunk.length
      maybeReport()
    }
    await new Promise(r => ws.end(r))
    maybeReport(true)
    return { size: receivedTotal }
  }

  // 128 线程自适应：大文件满 128 线程，小文件按 1MB/片 递减
  // 并发线程：4MB/片自动递减，但下限 32（NDM 等下载器 32 线程即可稳定跑满网盘直链）
  const threads = Math.min(DL_MAX_THREADS, Math.max(32, Math.floor(total / DL_MIN_PART)))
  const partSize = Math.ceil(total / threads)
  const parts = []
  for (let i = 0; i < threads; i++) {
    const start = i * partSize
    const end = Math.min(total - 1, start + partSize - 1)
    if (start > end) break
    parts.push({ index: i, start, end, received: 0 })
  }
  // 分片临时目录（与目标同盘，合并后整体删除；避免在下载目录堆放大量 .part 文件）。
  // 目录按下载 ID 隔离：同一目标文件并发下载时各自独立，杜绝"一边合并删目录、一边写分片"的 EPERM/ENOENT 竞争
  // 分片目录按目标文件隔离（video/audio 并发下载时各自独立）
  state.partDirs = state.partDirs || new Map()
  let partDir = state.partDirs.get(filePath)
  if (!partDir) {
    partDir = filePath + '.parts_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    state.partDirs.set(filePath, partDir)
  }
  for (let mk = 0; mk < 3; mk++) {
    try { fs.mkdirSync(partDir, { recursive: true }); break } catch (e) { if (mk === 2) throw e }
  }
  const partFiles = parts.map(p => path.join(partDir, 'part_' + p.index))
  // 暂停-恢复：扫描既有分片文件，恢复已收字节偏移（文件大小即断点）
  if (state.resumable) {
    for (const p of parts) {
      try {
        const st = fs.statSync(partFiles[p.index])
        if (st.size > 0) p.received = Math.min(st.size, p.end - p.start + 1)
      } catch (e) {}
    }
  }
  state.resumable = true

  // 分片下载：失败重试 3 次，重试时从已收字节续传（分片内断点）。
  // ws 必须挂 error 监听：目录被清理/磁盘异常时 createWriteStream 的错误走事件，
  // 无监听会变成主进程未捕获异常直接崩溃
  async function downloadPart(p, abort) {
    const partPath = partFiles[p.index]
    for (let attempt = 0; attempt < 5; attempt++) {
      if (state.canceled || abort.v) throw new Error('已取消')
      let wsError = null
      try {
        const startByte = p.start + p.received
        if (startByte > p.end) return
        let res = null
        const ws = fs.createWriteStream(partPath, { flags: p.received > 0 ? 'a' : 'w' })
        ws.on('error', (err) => { wsError = err; try { res?.data?.destroy() } catch (e) {} })
        try {
          res = await axios.get(url, {
            responseType: 'stream',
            headers: { ...headerObj, Range: `bytes=${startByte}-${p.end}` },
            timeout: 0, maxRedirects: 5, httpsAgent, httpAgent,
            signal: ac.signal
          })
        } catch (e) {
          try { ws.destroy() } catch (e2) {}
          if (state.paused && (e.code === 'ERR_CANCELED' || ac.signal.aborted)) {
            throw Object.assign(new Error('已暂停'), { paused: true })
          }
          throw e
        }
        // 分片 0 的响应头：Content-Disposition 真实文件名 + Content-Type 扩展名兜底
        if (p.index === 0 && !cdName) {
          cdName = parseCDName(res.headers?.['content-disposition'])
          if (!cdName) {
            try {
              const ct = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
              const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
              const ext = DL_CT_EXT_MAP[ct]
              if (ext && base && !base.match(/\\.[A-Za-z0-9]{1,8}$/)) cdName = base + ext
            } catch (e) {}
          }
        }
        for await (const chunk of res.data) {
          if (wsError) throw wsError
          if (state.canceled || abort.v) { ws.destroy(); throw new Error('已取消') }
          ws.write(chunk)
          p.received += chunk.length
          receivedTotal += chunk.length
          maybeReport()
        }
        if (wsError) throw wsError
        await new Promise(r => ws.end(r))
        if (wsError) throw wsError
        return
      } catch (e) {
        if (state.paused && (e.code === 'ERR_CANCELED' || ac.signal.aborted || e.paused)) {
          throw Object.assign(new Error('已暂停'), { paused: true })
        }
        if (state.canceled || abort.v) throw new Error('已取消')
        if (attempt === 4) throw e
        // 阶梯退避：0.8s → 2s → 5s → 10s → 20s；限流类错误（403/429）额外多等 3s
        const backoff = [800, 2000, 5000, 10000, 20000][attempt]
        const st = e.response?.status
        await new Promise(r => setTimeout(r, backoff + (st === 403 || st === 429 ? 3000 : 0)))
      }
    }
  }

  // 全部分片收敛后才进入合并/清理：任一片失败先置中止位等其余分片退出，
  // 杜绝"清理删除目录时其他分片仍在写入"导致的 EPERM 未捕获崩溃
  let firstErr = null
  let cdName = ''
  const abort = { v: false }
  await Promise.all(parts.map(async (p) => {
    try { await downloadPart(p, abort) } catch (e) {
      if (!firstErr) firstErr = e
      abort.v = true
    }
  }))
  if (state.canceled) throw new Error('已取消')
  if (state.paused) return { paused: true }
  if (firstErr) {
    // 403/410 等给出可读原因（网盘直链常见：链接过期、UA/Referer/Cookie 不对、限流）
    const st = firstErr.response?.status
    if (st === 403) throw new Error('链接拒绝访问(403)：链接可能已过期，或 UA/Referer/Cookie 不正确')
    if (st === 410 || st === 404) throw new Error('链接已失效(' + st + ')：请重新获取下载链接')
    throw firstErr
  }
  maybeReport(true)

  // 流式按序合并（内存峰值仅为管道缓冲，不整块读入分片）
  if (cdName && state.autoName) {
    const renamed = path.join(path.dirname(filePath), cdName)
    if (path.resolve(renamed) !== path.resolve(filePath)) filePath = renamed
  }
  const out = fs.createWriteStream(filePath)
  for (const p of parts) {
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(partFiles[p.index])
      rs.on('error', reject)
      out.on('error', reject)
      rs.on('end', resolve)
      rs.pipe(out, { end: false })
    })
  }
  await new Promise(r => out.end(r))
  // 分片合并完成，整体清理临时目录
  try { fs.rmSync(partDir, { recursive: true, force: true }) } catch (e) {}
  return { size: total, name: (cdName && state.autoName) ? cdName : null }
}

// ===== DASH 音视频分离下载 + ffmpeg 合并（B站高画质专用）=====
// 流程：并行多线程下载 video.m4s + audio.m4s → ffmpeg 流复制合并为 mp4（极快）
async function startDashMergeDownload(id, videoUrl, audioUrl, outputPath, extraHeaders, record) {
  const state = { canceled: false, _lastReport: 0, startTime: Date.now() }
  activeDownloads.set(id, {
    canceled: false,
    cancel: () => { state.canceled = true }
  })
  record.status = 'downloading'

  // 临时目录（下载完成后清理）
  const tmpDir = outputPath + '.tmpdir'
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch (e) {}
  const videoFile = path.join(tmpDir, 'video.m4s')
  const audioFile = path.join(tmpDir, 'audio.m4s')

  // B站 audio 流也在 bilivideo/mcdn CDN，需要相同的 Referer 头
  let audioHeaders = extraHeaders
  if (/bilivideo\.(com|cn)|edge\.mountaintoys\.cn|mcdn/i.test(audioUrl) && !audioHeaders) {
    audioHeaders = `Referer: https://www.bilibili.com/\r\nUser-Agent: ${DEFAULT_UA}`
  }

  // 进度上报（合并 video + audio 的字节进度；速度取滑动窗口实时值，更贴近真实带宽）
  let vSize = 0, aSize = 0, vTotal = 0, aTotal = 0
  let lastRptT = 0, lastRptBytes = 0, instSpeed = 0
  const reportProgress = () => {
    const now = Date.now()
    if (now - state._lastReport > 400) {
      state._lastReport = now
      const received = vSize + aSize
      const total = vTotal + aTotal
      if (lastRptT) {
        const dt = (now - lastRptT) / 1000
        if (dt > 0) instSpeed = Math.round((received - lastRptBytes) / dt)
      }
      lastRptT = now
      lastRptBytes = received
      const speed = instSpeed || Math.round(received / ((now - state.startTime) / 1000 || 1))
      record.received = received
      record.total = total
      record.percent = total ? Math.min(99, (received / total) * 100) : 0
      record.speed = speed
      emit('download:progress', { id, percent: record.percent, received, total, speed })
      emit('video-download-progress', { downloadId: id, percent: record.percent, received, total, speed })
    }
  }


  try {
    // 并行下载 video + audio
    const videoPromise = downloadFileMultithread(videoUrl, videoFile, extraHeaders, (r, t) => {
      vSize = r; vTotal = t; reportProgress()
    }, state)
    const audioPromise = downloadFileMultithread(audioUrl, audioFile, audioHeaders, (r, t) => {
      aSize = r; aTotal = t; reportProgress()
    }, state)

    // 全部收敛后才继续：视频失败时音频可能仍在写入，立即清理 tmpdir 会引发 ENOENT/EPERM
    const settled = await Promise.allSettled([videoPromise, audioPromise])
    if (state.canceled) throw new Error('已取消')
    const firstErr = settled.find(r => r.status === 'rejected')
    if (firstErr) throw firstErr.reason

    // 进度推进到合并阶段
    record.percent = 99
    emit('download:progress', { id, percent: 99, merging: true })
    emit('video-download-progress', { downloadId: id, percent: 99, merging: true })

    // ffmpeg 合并：-i video -i audio → mp4（流复制，不重编码，极快）
    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', videoFile, '-i', audioFile, '-c', 'copy', outputPath]
      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      const errBuf = []
      proc.stderr?.on('data', (chunk) => { errBuf.push(chunk.toString()) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('ffmpeg 合并失败: ' + errBuf.join('').slice(-300)))
      })
      proc.on('error', reject)
    })

    if (state.canceled) throw new Error('已取消')

    record.status = 'done'
    record.percent = 100
    record.endTime = Date.now()
    try { record.total = fs.statSync(outputPath).size; record.received = record.total } catch (e) {}
    const dur = (record.endTime - record.startTime) / 1000
    if (dur > 0 && record.total > 0) record.speed = Math.round(record.total / dur)
    saveHistory()
    activeDownloads.delete(id)
    emit('download:progress', { id, percent: 100, done: true })
    emit('video-download-progress', { downloadId: id, percent: 100, done: true })
    emit('download:done', { id, path: outputPath, speed: record.speed })
    emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })

    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
  } catch (e) {
    record.status = state.canceled ? 'canceled' : 'error'
    record.error = e.message
    record.endTime = Date.now()
    saveHistory()
    activeDownloads.delete(id)
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (er) {}
    emit('download:error', { id, error: record.error })
    emit('video-download-error', { downloadId: id, error: record.error })
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (er) {}
  }
}

// ===== ffmpeg 下载 m3u8 =====
// 用 -user_agent / -referer 替代 -headers（精简版 ffmpeg 可能不支持 -headers）
// 首次用 -c copy（不重编码，最快）；若因音频 bitstream 不兼容失败，自动重试加 aac_adtstoasc
// 若因 "Option not found" 失败，自动重试去掉所有 header 选项
function startFfmpegDownload(id, url, outputPath, extraHeaders, record, useBsf = false, headerMode = 'individual') {
  const args = ['-y']
  if (headerMode === 'individual') {
    // 解析 headers，用独立选项设置（兼容精简版 ffmpeg）
    const headerStr = extraHeaders || `User-Agent: ${DEFAULT_UA}\r\nReferer: https://music.163.com/\r\n`
    const headers = {}
    for (const line of headerStr.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) {
        const key = line.slice(0, idx).trim().toLowerCase()
        const val = line.slice(idx + 1).trim()
        if (key && val) headers[key] = val
      }
    }
    if (headers['user-agent']) args.push('-user_agent', headers['user-agent'])
    if (headers['referer']) args.push('-referer', headers['referer'])
  }
  // headerMode === 'none' → 不加任何 header 选项（最终兜底）
  args.push('-i', url, '-c', 'copy')
  if (useBsf) {
    args.push('-bsf:a', 'aac_adtstoasc')
  }
  args.push(outputPath)

  const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const state = { canceled: false, _lastReport: 0, startTime: Date.now(), stderrBuf: [] }
  activeDownloads.set(id, {
    process: proc,
    canceled: false,
    cancel: () => { state.canceled = true; try { proc.kill('SIGKILL') } catch (e) {} }
  })
  record.status = 'downloading'

  proc.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    // 缓存 stderr 用于错误诊断（只保留最后 2KB）
    state.stderrBuf.push(text)
    if (state.stderrBuf.join('').length > 2048) {
      state.stderrBuf.splice(0, state.stderrBuf.length - 4)
    }
    const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    if (timeMatch) {
      const now = Date.now()
      if (now - state._lastReport > 500) {
        state._lastReport = now
        const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3])
        record.currentTime = t
        emit('download:progress', { id, currentTime: t })
        emit('video-download-progress', { downloadId: id, currentTime: t })
      }
    }
  })

  proc.on('close', (code) => {
    if (state.canceled) {
      record.status = 'canceled'
      record.error = '用户取消'
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
    } else if (code !== 0) {
      const errText = state.stderrBuf.join('').trim()
      const errLine = errText.split(/\r?\n/).filter(l => /error|invalid|not found|failed|option/i.test(l)).pop() || errText.split(/\r?\n/).pop() || ''
      // "Protocol not found" → ffmpeg 不支持 https，降级到分片下载合并
      if (/protocol not found|unknown protocol|no protocol/i.test(errText)) {
        console.warn(`[DownloadManager] ffmpeg 不支持该协议，降级到 m3u8 分片下载合并`)
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
        startM3u8SegmentsDownload(id, url, outputPath, extraHeaders, record)
        return
      }
      // "Option not found" → 去掉 header 选项重试
      if (headerMode === 'individual' && /option not found|unrecognized option|error splitting/i.test(errText)) {
        console.warn(`[DownloadManager] ffmpeg 不支持 header 选项，去掉重试: ${errLine}`)
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
        startFfmpegDownload(id, url, outputPath, extraHeaders, record, useBsf, 'none')
        return
      }
      // aac bitstream 不兼容 → 加 aac_adtstoasc 重试
      if (!useBsf && /aac_adtstoasc|adts|aac|bitstream/i.test(errText)) {
        console.warn(`[DownloadManager] ffmpeg 首次失败，重试加 aac_adtstoasc: ${errLine}`)
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
        startFfmpegDownload(id, url, outputPath, extraHeaders, record, true, headerMode)
        return
      }
      record.status = 'error'
      record.error = errLine ? `ffmpeg: ${errLine.trim().slice(0, 200)}` : `ffmpeg 退出码 ${code}`
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
    } else {
      record.status = 'done'
      record.percent = 100
      try { record.total = fs.statSync(outputPath).size; record.received = record.total } catch (e) {}
    }
    record.endTime = Date.now()
    // 计算平均速度
    const dur = (record.endTime - record.startTime) / 1000
    if (record.status === 'done' && dur > 0 && record.total > 0) {
      record.speed = Math.round(record.total / dur)
    } else if (record.status !== 'done') {
      record.speed = 0
    }
    saveHistory()
    activeDownloads.delete(id)

    if (record.status === 'done') {
      emit('download:done', { id, path: outputPath, speed: record.speed })
      emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type })
    } else {
      emit('download:error', { id, error: record.error })
      emit('video-download-error', { downloadId: id, error: record.error })
    }
  })

  proc.on('error', (err) => {
    record.status = 'error'
    record.error = err.message
    record.endTime = Date.now()
    saveHistory()
    activeDownloads.delete(id)
    emit('download:error', { id, error: err.message })
    emit('video-download-error', { downloadId: id, error: err.message })
  })
}

// ===== m3u8 分片下载合并（ffmpeg 不支持 https 协议时的降级方案）=====
// 流程：axios 下载 m3u8 → 解析 ts 分片 → aria2c 批量下载所有 ts → ffmpeg 本地 concat 合并
async function startM3u8SegmentsDownload(id, m3u8Url, outputPath, extraHeaders, record) {
  const state = { canceled: false }
  activeDownloads.set(id, {
    canceled: false,
    cancel: () => { state.canceled = true }
  })
  record.status = 'downloading'

  const tmpDir = path.join(path.dirname(outputPath), `.m3u8tmp_${id}`)
  const axiosHeaders = { 'User-Agent': DEFAULT_UA }
  if (extraHeaders) {
    for (const line of extraHeaders.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) {
        const key = line.slice(0, idx).trim()
        const val = line.slice(idx + 1).trim()
        if (key && val) axiosHeaders[key] = val
      }
    }
  }

  try {
    // 1. 下载 m3u8 内容

    const m3u8Res = await axios.get(m3u8Url, { headers: axiosHeaders, timeout: 15000, httpAgent, httpsAgent })
    let m3u8Text = m3u8Res.data
    let baseUrl = m3u8Url

    // 处理多级 m3u8（master playlist 指向子 m3u8）
    if (m3u8Text.includes('#EXT-X-STREAM-INF')) {
      const subMatch = m3u8Text.split(/\r?\n/).find(l => l && !l.startsWith('#'))
      if (subMatch) {
        const subUrl = resolveUrl(baseUrl, subMatch.trim())

        const subRes = await axios.get(subUrl, { headers: axiosHeaders, timeout: 15000, httpAgent, httpsAgent })
        m3u8Text = subRes.data
        baseUrl = subUrl
      }
    }

    // 2. 解析 ts 分片 URL
    const segments = m3u8Text.split(/\r?\n/)
      .filter(l => l && !l.startsWith('#'))
      .map(l => resolveUrl(baseUrl, l.trim()))
      .filter(Boolean)

    if (segments.length === 0) {
      throw new Error('m3u8 中未找到 ts 分片')
    }

    

    // 3. 创建临时目录
    await fs.promises.mkdir(tmpDir, { recursive: true })

    // 4. 并行下载所有 ts 分片（8 路并发，axios 直下载）
    const segCount = segments.length
    let downloadedCount = 0
    let receivedBytes = 0       // 累计已下载字节数（用于计算真实速度）
    const partFiles = new Array(segCount)
    const startTime = Date.now()
    let lastReport = 0
    let lastReceivedBytes = 0
    let lastReportTime = startTime

    const downloadSegment = async (i) => {
      if (state.canceled) throw new Error('已取消')
      const segUrl = segments[i]
      const partFile = path.join(tmpDir, `seg_${String(i).padStart(6, '0')}.ts`)
      partFiles[i] = partFile

      let ok = false
      let segSize = 0
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (state.canceled) throw new Error('已取消')
        try {
          const res = await axios.get(segUrl, {
            headers: axiosHeaders,
            responseType: 'arraybuffer',
            timeout: 0,
            maxRedirects: 5,
            httpAgent,
            httpsAgent
          })
          if (res.data && res.data.byteLength > 0) {
            segSize = res.data.byteLength
            await fs.promises.writeFile(partFile, Buffer.from(res.data))
            ok = true
          }
        } catch (e) {
          if (attempt === 2) console.warn(`[DownloadManager] 分片 ${i + 1} 下载失败: ${e.message}`)
        }
      }
      if (!ok) throw new Error(`分片 ${i + 1}/${segCount} 下载失败`)

      downloadedCount++
      receivedBytes += segSize
      // 限频上报进度（避免过快刷新 UI）
      const now = Date.now()
      if (now - lastReport > 300 || downloadedCount === segCount) {
        const elapsed = (now - startTime) / 1000
        // 实时速度：最近一段时间的增量 / 时间差
        const dt = (now - lastReportTime) / 1000
        const instSpeed = dt > 0 ? Math.round((receivedBytes - lastReceivedBytes) / dt) : 0
        // 平均速度（兜底，防止实时速度为0）
        const avgSpeed = elapsed > 0 ? Math.round(receivedBytes / elapsed) : 0
        const speed = instSpeed > 0 ? instSpeed : avgSpeed
        lastReport = now
        lastReportTime = now
        lastReceivedBytes = receivedBytes
        const percent = (downloadedCount / segCount) * 100
        record.percent = percent
        record.received = receivedBytes
        emit('download:progress', { id, percent, received: receivedBytes, total: 0, speed })
        emit('video-download-progress', { downloadId: id, percent, received: receivedBytes, total: 0, speed })
      }
    }

    // 128 路并发
    const CONCURRENCY = 128
    for (let i = 0; i < segCount; i += CONCURRENCY) {
      if (state.canceled) throw new Error('已取消')
      const batch = []
      for (let j = i; j < Math.min(i + CONCURRENCY, segCount); j++) {
        batch.push(downloadSegment(j))
      }
      await Promise.all(batch)
    }

    if (state.canceled) throw new Error('已取消')

    // 5. 用 ffmpeg 本地 concat 合并（不依赖网络协议，快速）

    const listFile = path.join(tmpDir, 'filelist.txt')
    const listContent = partFiles.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
    await fs.promises.writeFile(listFile, listContent, 'utf-8')

    const mergeOk = await new Promise((resolve) => {
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', outputPath]
      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let errBuf = ''
      proc.stderr?.on('data', (chunk) => { errBuf += chunk.toString() })
      proc.on('close', (code) => {
        if (code !== 0) console.warn(`[DownloadManager] ffmpeg 合并失败(code=${code}): ${errBuf.slice(-500)}`)
        resolve(code === 0)
      })
      proc.on('error', () => resolve(false))
    })

    if (!mergeOk) {
      // ffmpeg 合并失败（可能 aac_adtstoasc 不适用），去掉 bsf 重试
      const mergeOk2 = await new Promise((resolve) => {
        const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath]
        const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        let errBuf = ''
        proc.stderr?.on('data', (chunk) => { errBuf += chunk.toString() })
        proc.on('close', (code) => {
          if (code !== 0) console.warn(`[DownloadManager] ffmpeg 合并重试失败(code=${code}): ${errBuf.slice(-500)}`)
          resolve(code === 0)
        })
        proc.on('error', () => resolve(false))
      })
      if (!mergeOk2) {
        // 最终降级：二进制拼接
        console.warn('[DownloadManager] ffmpeg 合并彻底失败，降级到二进制拼接')
        const outFd = fs.openSync(outputPath, 'w')
        for (const pf of partFiles) {
          if (!pf) continue
          const buf = fs.readFileSync(pf)
          fs.writeSync(outFd, buf)
        }
        fs.closeSync(outFd)
      }
    }

    // 6. 清理临时目录
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }) } catch (e) {}

    // 7. 完成
    record.status = 'done'
    record.percent = 100
    record.endTime = Date.now()
    try { record.total = fs.statSync(outputPath).size; record.received = record.total } catch (e) {}
    const dur = (record.endTime - record.startTime) / 1000
    if (dur > 0 && record.total > 0) {
      record.speed = Math.round(record.total / dur)
    }
    saveHistory()
    activeDownloads.delete(id)
    emit('download:done', { id, path: outputPath, speed: record.speed })
    emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })
  } catch (e) {
    record.status = state.canceled ? 'canceled' : 'error'
    record.error = e.message
    record.endTime = Date.now()
    saveHistory()
    activeDownloads.delete(id)
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }) } catch (er) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (er) {}
    emit('download:error', { id, error: record.error })
    emit('video-download-error', { downloadId: id, error: record.error })
  }
}

// 解析相对 URL
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href
  } catch (e) {
    return relative
  }
}

// ===== 重试 =====
async function retryDownload(id) {
  loadHistory()
  const record = downloadHistory.get(id)
  if (!record) return { success: false, error: '记录不存在' }
  if (activeDownloads.has(id)) return { success: false, error: '该任务进行中' }
  // 复用原参数重新启动
  return startDownload({
    url: record.url,
    name: record.name,
    category: record.type,
    savePath: record.path
  })
}

// ===== IPC Handlers =====
// 探测下载真实文件名（设置页/自定义下载自动填充）：
// 1) Content-Disposition（filename* UTF-8 / filename） 2) 重定向后最终 URL 的带后缀文件名 3) Content-Type 推断扩展名
function parseCDName(cd) {
  const s = String(cd || '')
  const mStar = s.match(/filename\*=\s*(?:UTF-8|utf-8)''([^;]+)/i)
  const mPlain = s.match(/filename\s*=\s*"([^"]+)"/i) || s.match(/filename\s*=\s*([^;]+)/i)
  let name = ''
  if (mStar) name = decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ''))
  else if (mPlain) name = mPlain[1].trim().replace(/^"|"$/g, '')
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

// Content-Type → 扩展名（probe 兜底 + 下载完成重命名共用）
const DL_CT_EXT_MAP = {
        'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
        'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
        'application/x-7z-compressed': '.7z', 'application/gzip': '.gz',
        'application/x-gzip': '.gz', 'application/x-tar': '.tar',
        'application/x-iso9660-image': '.iso', 'application/vnd.android.package-archive': '.apk',
        'video/mp4': '.mp4', 'video/x-matroska': '.mkv', 'video/webm': '.webm',
        'video/quicktime': '.mov', 'video/x-msvideo': '.avi', 'video/x-flv': '.flv',
        'video/mpeg': '.mpeg', 'video/mp2t': '.ts', 'video/x-ms-wmv': '.wmv',
        'audio/mpeg': '.mp3', 'audio/flac': '.flac', 'audio/mp4': '.m4a',
        'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
        'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/x-ape': '.ape',
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
        'application/pdf': '.pdf', 'text/plain': '.txt',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/epub+zip': '.epub',
        'application/x-msdownload': '.exe', 'application/x-msi': '.msi',
        'application/x-apple-diskimage': '.dmg'
      }

ipcMain.handle('download:probe-name', async (_, url) => {
  try {
    // 流式 GET：只取响应头（拿到 Content-Disposition 即销毁流），比 HEAD 兼容性好
    const res = await axios.get(url, {
      responseType: 'stream',
      headers: { 'User-Agent': DEFAULT_UA },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    })
    const finish = () => { try { res.data?.destroy() } catch (e) {} }
    const cd = String(res.headers?.['content-disposition'] || '')
    let name = ''
    const mStar = cd.match(/filename\*=\s*(?:UTF-8|utf-8)''([^;]+)/i)
    const mPlain = cd.match(/filename\s*=\s*"([^"]+)"/i) || cd.match(/filename\s*=\s*([^;]+)/i)
    if (mStar) name = decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ''))
    else if (mPlain) name = mPlain[1].trim().replace(/^"|"$/g, '')

    // 重定向后最终 URL 里带真实扩展名的文件名
    if (!name) {
      try {
        const finalUrl = res.request?.res?.responseURL || res.request?.responseURL || url
        const last = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '')
        if (/\.[A-Za-z0-9]{1,8}$/.test(last)) name = last
      } catch (e) {}
    }

    // Content-Type 明确指向具体类型时，路径基名 + 扩展名；
    // 泛型类型（octet-stream/text/html）+ 无扩展名基名（多为哈希 ID）→ 不猜，返回空让用户手填
    if (!name) {
      const ct = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
      const extMap = DL_CT_EXT_MAP
      const ext = extMap[ct]
      if (ext && ct !== 'text/plain') {
        const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download')
        name = base + ext
      }
    }

    finish()
    name = (name || '').replace(/[\/:*?"<>|]/g, '_').trim()
    return { success: true, name: name || '' }
  } catch (e) {
    return { success: false, name: '', error: e.message }
  }
})

ipcMain.handle('download:start', async (_, params) => {
  try {
    return await startDownload(params)
  } catch (e) {
    console.error('[DownloadManager] 启动失败:', e.message)
    return { success: false, error: e.message }
  }
})

// 获取统一下载目录（用户设置或系统默认，供前端"下载专区"显示与本地视频下载使用）
ipcMain.handle('download:get-dir', async () => {
  try {
    return { success: true, dir: resolveDownloadDir(), configured: !!readSavedDownloadDir() }
  } catch (e) {
    return { success: false, dir: '', error: e.message }
  }
})

// 保存统一下载目录（dir 为空表示恢复系统默认），所有下载操作共用
ipcMain.handle('download:save-dir', async (_, { dir }) => {
  try {
    const target = (dir || '').replace(/[\\/]+$/, '')
    if (target) {
      fs.mkdirSync(target, { recursive: true })
    }
    saveDownloadDir(target)
    return { success: true, dir: target || app.getPath('downloads') }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 获取系统默认下载目录（前端"下载专区"设置的默认值，避免每次下载弹窗）
ipcMain.handle('download:default-dir', async () => {
  try {
    return { success: true, dir: app.getPath('downloads') }
  } catch (e) {
    return { success: false, dir: '', error: e.message }
  }
})

// 校验下载目录是否有效（存在或可创建），供设置页使用
ipcMain.handle('download:check-dir', async (_, { dir }) => {
  try {
    if (!dir) return { success: false, error: '路径为空' }
    fs.mkdirSync(dir, { recursive: true })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 弹窗选择下载目录（供设置页"下载专区"使用）
ipcMain.handle('download:pick-dir', async () => {
  try {
    const opts = {
      title: '选择视频下载目录',
      properties: ['openDirectory', 'createDirectory']
    }
    // win 可能尚未初始化，分别调用避免传 undefined 参数导致部分版本报错
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }
    return { success: true, dir: result.filePaths[0] }
  } catch (e) {
    console.error('[DownloadManager] 选择目录失败:', e)
    return { success: false, error: String(e?.message || e) }
  }
})

ipcMain.handle('download:pause', async (_, { downloadId }) => {
  const item = activeDownloads.get(downloadId)
  if (!item?.pause) return { success: false, error: '该任务不支持暂停' }
  item.pause()
  return { success: true }
})

ipcMain.handle('download:resume', async (_, { downloadId }) => {
  const item = activeDownloads.get(downloadId)
  if (!item?.resume) return { success: false, error: 'no such pausable task' }
  item.resume()
  return { success: true }
})

ipcMain.handle('download:cancel', async (_, { downloadId }) => {
  const item = activeDownloads.get(downloadId)
  if (!item) return { success: false, error: 'no such active download' }
  item.canceled = true
  try { item.controller?.abort() } catch (e) {}
  try { item.cancel?.() } catch (e) {}
  return { success: true }
})

ipcMain.handle('download:list', async () => {
  loadHistory()
  const list = Array.from(downloadHistory.values()).sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
  return { success: true, data: list }
})

ipcMain.handle('download:remove', async (_, { downloadId }) => {
  if (activeDownloads.has(downloadId)) {
    return { success: false, error: '任务进行中，请先取消' }
  }
  const deleted = downloadHistory.delete(downloadId)
  if (deleted) saveHistory()
  return { success: deleted }
})

ipcMain.handle('download:clear', async (_, { status }) => {
  let cleared = 0
  for (const [id, item] of downloadHistory) {
    if (activeDownloads.has(id)) continue
    if (!status || item.status === status) {
      downloadHistory.delete(id)
      cleared++
    }
  }
  if (cleared > 0) saveHistory()
  return { success: true, cleared }
})

ipcMain.handle('download:retry', async (_, { downloadId }) => {
  return retryDownload(downloadId)
})

// 暴露给 main.js 调用的旧 IPC 委托入口
export function delegateStartDownload(params) {
  return startDownload(params)
}

export function delegateCancelDownload(downloadId) {
  const item = activeDownloads.get(downloadId)
  if (!item) return { success: false, error: 'no such active download' }
  item.canceled = true
  try { item.controller?.abort() } catch (e) {}
  try { item.cancel?.() } catch (e) {}
  return { success: true }
}

export function setDownloadManagerWindow(w) {
  setWindow(w)
}

// 供 main.js 复用 yt-dlp 路径（登录时调用）
export function getYtDlpPath() {
  return YTDLP_PATH
}

// 应用启动后清理历史遗留的分片/合并临时目录（*.parts / *.tmpdir）：
// 之前版本直接把 part 文件写进下载目录，或因进程被杀留下残骸；现在统一收敛到
// <目标文件>.parts / <目标文件>.tmpdir，启动时整批删除，避免下载目录堆积垃圾
app.whenReady?.().then(() => {
  try {
    const dir = resolveDownloadDir()
    if (!dir || !fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.parts') || name.includes('.parts_') || name.endsWith('.tmpdir')) {
        try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }) } catch (e) {}
      }
    }
  } catch (e) {}
})


