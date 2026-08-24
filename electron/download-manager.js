// electron/download-manager.js
// 统一下载管理器
// - 直链（mp4/mp3 等）：aria2c 多线程下载（32 连接）
// - m3u8 流：ffmpeg 合并为 mp4
// - 本地文件：直接复制
// - 统一历史记录（持久化到磁盘），分类：music / movie / anime / mv / video
// - 同时发送新事件（download:*）和旧事件（video-download-*）以兼容 VideoDownloadToast
import { ipcMain, app, dialog } from 'electron'
import { execFile, spawn } from 'node:child_process'
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
  video: '视频'
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
  const defaultDir = app.getPath('documents')
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

  // 自动为 B站 CDN 注入 Referer（B站视频流需要 Referer 才能访问）
  // bilivideo 与 mcdn(mountaintoys) 都是 B站视频 CDN，都需 Referer/UA，否则 403
  let headers = params.headers
  if (/bilivideo\.(com|cn)|edge\.mountaintoys\.cn|mcdn/i.test(url)) {
    headers = Object.assign({
      'Referer': 'https://www.bilibili.com/',
      'User-Agent': DEFAULT_UA
    }, headers || {})
  }

  // 统一 headers 为字符串格式（"Key: Value\r\nKey2: Value2"），下游下载函数统一用 split 解析
  if (headers && typeof headers === 'object') {
    headers = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
  }

  const id = genId()
  const cat = category || 'video'
  const safeName = String(name || 'download').replace(/[\\/:*?"<>|]/g, '_').trim()
  const ext = deriveExt(url, cat)

  // 选择保存路径
  let outputPath = savePath
  if (!outputPath && askPath !== false) {
    outputPath = await pickSavePath(safeName, ext, cat)
    if (!outputPath) return { success: false, canceled: true }
  }
  if (!outputPath) {
    // 兜底：直接用 documents 目录
    outputPath = path.join(app.getPath('documents'), safeName + ext)
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
    startAria2cDownload(id, url, outputPath, headers, record)
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

// ===== aria2c 多线程直链下载 =====
function startAria2cDownload(id, url, outputPath, extraHeaders, record) {
  // 检查 aria2c 是否存在（仅对绝对路径检查；裸名称走 PATH 由 spawn error 兜底）
  const isBareName = ARIA2C_PATH === 'aria2c.exe' || ARIA2C_PATH === 'aria2c'
  if (!isBareName && !fs.existsSync(ARIA2C_PATH)) {
    console.warn(`[DownloadManager] aria2c 不存在: ${ARIA2C_PATH}，降级到内置多线程下载`)
    startBuiltinMultithread(id, url, outputPath, extraHeaders, record)
    return
  }

  const dir = path.dirname(outputPath)
  const filename = path.basename(outputPath)

  const args = [
    '-x', '16',            // 每服务器最大连接数
    '-s', '16',            // 分片数
    '-k', '1M',            // 最小分片大小
    '--max-tries=5',
    '--retry-wait=3',
    '--summary-interval=1',
    '--console-log-level=notice',
    '--download-result=hide',
    '--file-allocation=none',
    '--max-download-limit=0',       // 不限速
    '--max-overall-download-limit=0', // 总体不限速
    '-d', dir,
    '-o', filename
  ]

  // 头部处理
  const headerLines = (extraHeaders || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (!headerLines.some(h => /^user-agent/i.test(h))) {
    headerLines.push('User-Agent: ' + DEFAULT_UA)
  }
  for (const h of headerLines) {
    args.push('--header', h)
  }
  args.push(url)

  const proc = spawn(ARIA2C_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const state = { canceled: false, _lastReport: 0, startTime: Date.now() }
  activeDownloads.set(id, {
    process: proc,
    canceled: false,
    cancel: () => { state.canceled = true; try { proc.kill() } catch (e) {} }
  })
  record.status = 'downloading'

  const reportProgress = (received, total, speed) => {
    record.received = received
    record.total = total
    record.percent = total ? Math.min(100, (received / total) * 100) : 0
    record.speed = speed
    const now = Date.now()
    if (now - state._lastReport > 400) {
      state._lastReport = now
      emit('download:progress', {
        id, percent: record.percent, received, total, speed
      })
      emit('video-download-progress', {
        downloadId: id, percent: record.percent, received, total, speed
      })
    }
  }

  const parseProgress = (line) => {
    // [#abc 56MiB/120MiB(46%) CN:16 DL:8MiB ETA:8s]
    const m = line.match(/\[#\w+\s+([\d.]+[KMG]?i?B)\/([\d.]+[KMG]?i?B)\((\d+)%\)\s+CN:\d+\s+DL:([\d.]+[KMG]?i?B)/)
    if (m) {
      const received = parseSize(m[1])
      const total = parseSize(m[2])
      const speed = parseSize(m[4])
      reportProgress(received, total, speed)
    }
  }

  proc.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    text.split(/\r?\n/).forEach(parseProgress)
  })
  proc.stderr?.on('data', (chunk) => {
    // aria2c 一般不走 stderr，但保险起见也解析
    const text = chunk.toString()
    text.split(/\r?\n/).forEach(parseProgress)
  })

  proc.on('close', (code) => {
    if (state.canceled) {
      record.status = 'canceled'
      record.error = '用户取消'
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
    } else if (code !== 0) {
      record.status = 'error'
      record.error = `aria2c 退出码 ${code}`
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) {}
    } else {
      record.status = 'done'
      record.percent = 100
      // 尝试获取实际文件大小
      try { record.total = fs.statSync(outputPath).size; record.received = record.total } catch (e) {}
    }
    record.endTime = Date.now()
    // 计算平均速度（保留显示），不清零
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
      emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })
    } else {
      emit('download:error', { id, error: record.error })
      emit('video-download-error', { downloadId: id, error: record.error })
    }
  })

  proc.on('error', (err) => {
    console.warn(`[DownloadManager] aria2c 启动失败: ${err.message}，降级到内置多线程`)
    activeDownloads.delete(id)
    startBuiltinMultithread(id, url, outputPath, extraHeaders, record)
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
  // aria2c 多线程下载（32线程×2=64并发，不限速）
  if (fs.existsSync(ARIA2C_PATH)) {
    args.push(
      '--downloader', 'aria2c',
      '--downloader-args', `aria2c:-x32 -s32 --max-overall-download-limit=0 --file-allocation=none --console-log-level=warn --summary-interval=0`
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

// ===== 内置多线程分片下载（不依赖外部工具的降级方案） =====
async function startBuiltinMultithread(id, url, outputPath, extraHeaders, record) {
  try {
    const headerObj = { 'User-Agent': DEFAULT_UA }
    if (extraHeaders) {
      for (const line of extraHeaders.split(/\r?\n/)) {
        const idx = line.indexOf(':')
        if (idx > 0) headerObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    }

    const headRes = await axios.head(url, { headers: headerObj, timeout: 15000, maxRedirects: 5 }).catch(() => null)
    const total = parseInt(headRes?.headers?.['content-length'] || '0', 10)
    const acceptRanges = (headRes?.headers?.['accept-ranges'] || '').toLowerCase() === 'bytes'

    const controller = new AbortController()
    const state = { canceled: false, controller, _lastReport: 0, startTime: Date.now() }
    activeDownloads.set(id, state)
    record.status = 'downloading'

    const report = (received) => {
      const now = Date.now()
      if (now - state._lastReport > 400) {
        state._lastReport = now
        const speed = received / ((now - state.startTime) / 1000 || 1)
        record.received = received
        record.total = total
        record.speed = speed
        record.percent = total ? (received / total) * 100 : 0
        emit('download:progress', { id, percent: record.percent, received, total, speed })
        emit('video-download-progress', { downloadId: id, percent: record.percent, received, total, speed })
      }
    }

    if (!total || !acceptRanges) {
      // 单线程
      const res = await axios.get(url, { responseType: 'stream', headers: headerObj, timeout: 0, maxRedirects: 5, signal: controller.signal })
      const ws = fs.createWriteStream(outputPath)
      let received = 0
      for await (const chunk of res.data) {
        if (activeDownloads.get(id)?.canceled) {
          ws.destroy()
          try { fs.unlinkSync(outputPath) } catch (e) {}
          throw new Error('已取消')
        }
        ws.write(chunk)
        received += chunk.length
        report(received)
      }
      await new Promise(r => ws.end(r))
    } else {
      // 多线程分片
      const threads = 8
      const partSize = Math.ceil(total / threads)
      const parts = []
      for (let i = 0; i < threads; i++) {
        const start = i * partSize
        const end = Math.min(total - 1, start + partSize - 1)
        if (start > end) break
        parts.push({ index: i, start, end, received: 0 })
      }
      const partFiles = parts.map(p => outputPath + '.part' + p.index)
      const fd = fs.openSync(outputPath, 'w')
      fs.ftruncateSync(fd, total)
      fs.closeSync(fd)

      async function downloadPart(p) {
        const partPath = partFiles[p.index]
        const ws = fs.createWriteStream(partPath)
        const res = await axios.get(url, {
          responseType: 'stream',
          headers: { ...headerObj, Range: `bytes=${p.start}-${p.end}` },
          timeout: 0, maxRedirects: 5, signal: controller.signal
        })
        for await (const chunk of res.data) {
          if (activeDownloads.get(id)?.canceled) { ws.destroy(); throw new Error('已取消') }
          ws.write(chunk)
          p.received += chunk.length
          report(parts.reduce((s, x) => s + x.received, 0))
        }
        await new Promise(r => ws.end(r))
      }

      await Promise.all(parts.map(downloadPart))
      if (activeDownloads.get(id)?.canceled) throw new Error('已取消')
      const outFd = fs.openSync(outputPath, 'r+')
      for (const p of parts) {
        const buf = fs.readFileSync(partFiles[p.index])
        fs.writeSync(outFd, buf, 0, buf.length, p.start)
        try { fs.unlinkSync(partFiles[p.index]) } catch (e) {}
      }
      fs.closeSync(outFd)
    }

    record.status = 'done'
    record.percent = 100
    record.endTime = Date.now()
    // 计算平均速度（保留显示），不清零
    const dur = (record.endTime - record.startTime) / 1000
    if (dur > 0 && record.total > 0) {
      record.speed = Math.round(record.total / dur)
    }
    saveHistory()
    activeDownloads.delete(id)
    emit('download:done', { id, path: outputPath, speed: record.speed })
    emit('video-download-done', { downloadId: id, path: outputPath, name: record.name, category: record.type, speed: record.speed })
  } catch (e) {
    record.status = activeDownloads.get(id)?.canceled ? 'canceled' : 'error'
    record.error = e.message
    record.endTime = Date.now()
    saveHistory()
    activeDownloads.delete(id)
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (er) {}
    emit('download:error', { id, error: record.error })
    emit('video-download-error', { downloadId: id, error: record.error })
  }
}

// ===== 多线程下载单个文件到指定路径（用于 DASH video/audio 分别下载）=====
// 基于 axios + 自定义 Agent（maxSockets: Infinity），支持 Range 分片、取消、进度回调
async function downloadFileMultithread(url, filePath, extraHeaders, onProgress, state) {
  const headerObj = { 'User-Agent': DEFAULT_UA }
  if (extraHeaders) {
    for (const line of extraHeaders.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx > 0) headerObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }

  const headRes = await axios.head(url, { headers: headerObj, timeout: 15000, maxRedirects: 5, httpsAgent, httpAgent }).catch(() => null)
  const total = parseInt(headRes?.headers?.['content-length'] || '0', 10)
  const acceptRanges = (headRes?.headers?.['accept-ranges'] || '').toLowerCase() === 'bytes'

  if (!total || !acceptRanges) {
    // 单线程下载
    const res = await axios.get(url, { responseType: 'stream', headers: headerObj, timeout: 0, maxRedirects: 5, httpsAgent, httpAgent })
    const ws = fs.createWriteStream(filePath)
    let received = 0
    for await (const chunk of res.data) {
      if (state.canceled) { ws.destroy(); throw new Error('已取消') }
      ws.write(chunk)
      received += chunk.length
      if (onProgress) onProgress(received, total)
    }
    await new Promise(r => ws.end(r))
    return { size: received }
  }

  // 多线程分片下载（4-16 线程，按文件大小自适应）
  const threads = Math.min(16, Math.max(4, Math.ceil(total / (2 * 1024 * 1024))))
  const partSize = Math.ceil(total / threads)
  const parts = []
  for (let i = 0; i < threads; i++) {
    const start = i * partSize
    const end = Math.min(total - 1, start + partSize - 1)
    if (start > end) break
    parts.push({ index: i, start, end, received: 0 })
  }
  const partFiles = parts.map(p => filePath + '.part' + p.index)

  async function downloadPart(p) {
    const partPath = partFiles[p.index]
    const ws = fs.createWriteStream(partPath)
    const res = await axios.get(url, {
      responseType: 'stream',
      headers: { ...headerObj, Range: `bytes=${p.start}-${p.end}` },
      timeout: 0, maxRedirects: 5, httpsAgent, httpAgent
    })
    for await (const chunk of res.data) {
      if (state.canceled) { ws.destroy(); throw new Error('已取消') }
      ws.write(chunk)
      p.received += chunk.length
      if (onProgress) onProgress(parts.reduce((s, x) => s + x.received, 0), total)
    }
    await new Promise(r => ws.end(r))
  }

  await Promise.all(parts.map(downloadPart))
  if (state.canceled) throw new Error('已取消')

  // 合并分片
  const fd = fs.openSync(filePath, 'w')
  fs.ftruncateSync(fd, total)
  fs.closeSync(fd)
  const outFd = fs.openSync(filePath, 'r+')
  for (const p of parts) {
    const buf = fs.readFileSync(partFiles[p.index])
    fs.writeSync(outFd, buf, 0, buf.length, p.start)
    try { fs.unlinkSync(partFiles[p.index]) } catch (e) {}
  }
  fs.closeSync(outFd)
  return { size: total }
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

  // 进度上报（合并 video + audio 的字节进度）
  let vSize = 0, aSize = 0, vTotal = 0, aTotal = 0
  const reportProgress = () => {
    const now = Date.now()
    if (now - state._lastReport > 400) {
      state._lastReport = now
      const received = vSize + aSize
      const total = vTotal + aTotal
      record.received = received
      record.total = total
      record.percent = total ? Math.min(99, (received / total) * 100) : 0
      const speed = received / ((now - state.startTime) / 1000 || 1)
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

    await Promise.all([videoPromise, audioPromise])
    if (state.canceled) throw new Error('已取消')

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
ipcMain.handle('download:start', async (_, params) => {
  try {
    return await startDownload(params)
  } catch (e) {
    console.error('[DownloadManager] 启动失败:', e.message)
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


