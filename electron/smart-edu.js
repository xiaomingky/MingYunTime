// electron/smart-edu.js
// 智慧教育（国家中小学智慧教育平台 basic.smartedu.cn）教材专区 - 主进程 IPC 处理器
// 仅接入「教材」功能（目录/详情/预览图/PDF/音频），课程不做
// 登录：打开官方登录页窗口，拦截请求头 X-Nd-Auth 令牌（也可从 localStorage ND_UC_AUTH 抓取）
// 下载：PDF 直链/音频直链 由前端交给统一下载管理器（download:start，128 线程）
import { ipcMain, app, BrowserWindow } from 'electron'
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { delegateStartDownload } from './download-manager.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
// 登录窗口使用无 Electron 标识的标准 Edge UA：
// Electron 默认 UA 带 "Electron/x.x.x" 会被平台风控识别并返回 retCode 500「请求信息异常，请重试」
const LOGIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REFERER = 'https://basic.smartedu.cn/'

// 教材目录总入口（公开，无需登录）
const CATALOG_VERSION_URL = 'https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json'
// 教材详情（含预览图目录 preview 与 PDF 直链 ti_items；PDF 直链需 X-Nd-Auth 令牌）
const DETAIL_URL = (id) => `https://s-file-2.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details/${id}.json`
// 教材配套音频（公开接口）
const AUDIO_URL = (id) => `https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/${id}/relation_audios.json`

// 令牌持久化（userData/smart-edu-auth.json）
const AUTH_FILE = () => path.join(app.getPath('userData'), 'smart-edu-auth.json')
let authCache = null // { token, cookie, userName, avatar, savedAt }

// 预览图磁盘缓存（userData/smart-edu-preview-cache/<URL 相对路径>）
// 目的：一本教材整本预读后，任意跳页都由主进程本地读盘返回，跳过网络 → 秒级跳转；
// 且内存只保留 16 张 dataURL（极低占用），其余全部落在磁盘。
const PREVIEW_CACHE_DIR = () => path.join(app.getPath('userData'), 'smart-edu-preview-cache')
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' }
// 从 URL 提取可落盘的相对路径（如 .../esp/assets/<asset>/zh-CN/<ts>/transcode/image/77.jpg → 完整子路径）
function previewCachePath(url) {
  try {
    const u = new URL(url)
    let rel = u.pathname.replace(/^\/+/, '').replace(/[^\w\-.~/@]/g, '_')
    if (!rel) return null
    return path.join(PREVIEW_CACHE_DIR(), ...rel.split('/'))
  } catch { return null }
}

// —— 目录 / 页数磁盘缓存（userData JSON，毫秒级二次打开）——
// 目录合并结果缓存 24h（教材分片列表变动不频繁）；页数探测缓存 30 天（同册次 transcode 目录固定），
// 避免每次进入智慧教材页 / 每打开一本书都重新串行拉全部分片 / 重新二分探测页数。
const JSON_CACHE_DIR = () => app.getPath('userData')
const CATALOG_CACHE_FILE = () => path.join(JSON_CACHE_DIR(), 'smart-edu-catalog.json')
const PAGE_COUNT_CACHE_FILE = () => path.join(JSON_CACHE_DIR(), 'smart-edu-pagecount-cache.json')
function readJsonCache(file, ttlMs) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && Date.now() - (obj.at || 0) < ttlMs) return obj.data
  } catch {}
  return null
}
function writeJsonCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), data }))
  } catch {}
}

function loadAuth(force = false) {
  if (authCache && !force) return authCache
  try {
    const raw = fs.readFileSync(AUTH_FILE(), 'utf8')
    authCache = JSON.parse(raw) || null
  } catch { authCache = null }
  return authCache
}
function saveAuth(info) {
  if (!info || !info.token) return
  authCache = { ...info, savedAt: Date.now() }
  try {
    fs.mkdirSync(path.dirname(AUTH_FILE()), { recursive: true })
    fs.writeFileSync(AUTH_FILE(), JSON.stringify(authCache, null, 2))
  } catch (e) {}
}
function clearAuth() {
  authCache = null
  try { fs.rmSync(AUTH_FILE(), { force: true }) } catch (e) {}
}

// 优先返回 X-Nd-Auth 应使用的原始令牌
function rawToken() {
  const a = loadAuth()
  return a?.rawAuth || a?.token || null
}

// 供 main.js 默认会话 webRequest 复用：渲染进程播放/预览私有 CDN 资源时注入认证头
// 注意：此函数只回放单一 X-Nd-Auth（仿 C# PDF 下载逻辑）。音频等 Media 资源走 probeMediaUrl 探测（音频/TV 单独判定）
export function getSmartEduHeaders() {
  const a = loadAuth()
  const token = a?.rawAuth || a?.token
  if (!token) return null
  const h = { 'User-Agent': UA, 'Referer': REFERER, 'X-Nd-Auth': token }
  if (a?.cookie) h['Cookie'] = a.cookie
  return h
}

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': UA, 'Referer': REFERER },
  validateStatus: () => true
})

// ===== 教材目录 =====
// data_version.json -> urls(逗号分隔的分片 JSON 列表) -> 每片是一个数组，元素含 id/title/tag_list/custom_properties
// 性能：磁盘缓存 24h（二次进入智慧教材页毫秒级直出）；未命中时分片 8 并发下载（串行逐个拉几千本要几十秒）
const CATALOG_TTL = 24 * 60 * 60 * 1000
async function getCatalog() {
  const cached = readJsonCache(CATALOG_CACHE_FILE(), CATALOG_TTL)
  if (cached && Array.isArray(cached)) return cached

  let verRes
  try { verRes = await http.get(CATALOG_VERSION_URL) }
  catch (e) { throw new Error('目录版本加载失败: ' + e.message) }
  if (verRes.status !== 200) throw new Error('目录版本加载失败: HTTP ' + verRes.status)
  const urls = (verRes.data?.urls || '').split(',').map(s => s.trim()).filter(Boolean)
  const books = []
  const CONC = 8
  for (let i = 0; i < urls.length; i += CONC) {
    const chunk = urls.slice(i, i + CONC)
    const results = await Promise.all(chunk.map(u => http.get(u).catch(() => null)))
    for (const res of results) {
      if (!res || res.status !== 200 || !Array.isArray(res.data)) continue
      for (const e of res.data) {
        const b = parseTextbook(e)
        if (b.id && b.title) books.push(b)
      }
    }
  }
  // 拉取失败/超时导致为空时，回退到过期缓存，避免每次硬啃网络
  if (!books.length) {
    const stale = readJsonCache(CATALOG_CACHE_FILE(), Infinity)
    if (stale && Array.isArray(stale) && stale.length) return stale
    throw new Error('教材目录为空')
  }
  const pick = (b) => b.stage || '\uffff'
  const bySubject = (b) => b.subject || '\uffff'
  const grade = (b) => b.grade || '\uffff'
  const term = (b) => b.term || '\uffff'
  const title = (b) => b.title || ''
  books.sort((a, b) => pick(a).localeCompare(pick(b), 'zh-CN') || bySubject(a).localeCompare(bySubject(b), 'zh-CN') || grade(a).localeCompare(grade(b), 'zh-CN') || term(a).localeCompare(term(b), 'zh-CN') || title(a).localeCompare(title(b), 'zh-CN'))
  writeJsonCache(CATALOG_CACHE_FILE(), books)
  return books
}

function parseTextbook(e) {
  const t = { id: e?.id || '', title: e?.title || '' }
  const tags = Array.isArray(e?.tag_list) ? e.tag_list : []
  for (const tg of tags) {
    const dim = tg?.tag_dimension_id || ''
    const name = tg?.tag_name || ''
    if (dim === 'zxxxd') t.stage = name       // 学段
    else if (dim === 'zxxxk') t.subject = name // 学科
    else if (dim === 'zxxbb') t.version = name // 版本
    else if (dim === 'zxxnj') t.grade = name   // 年级
    else if (dim === 'zxxcc') t.term = name    // 册次
  }
  const thumbs = e?.custom_properties?.thumbnails
  if (Array.isArray(thumbs) && thumbs.length > 0) t.coverUrl = thumbs[0]
  return t
}

// ===== 教材详情（预览图目录 + PDF 直链）=====
// 预览图：detail.json 的 preview 只暴露部分页，但公开 CDN transcode/image/N.jpg 是连续完整页图，
// 解析出图片目录后用 翻倍+二分 探测真实总页数，生成 1..N 全部页图。
// PDF：ti_items 中 ti_file_flag=source && ti_format=pdf 的 ti_storages[0]（需 X-Nd-Auth，私有 CDN）
const pageCountCache = new Map()
const detailCache = new Map() // contentId -> { at, data }：智能阅读页会先调 detail 再调 preview，两次都走 getDetail，内存缓存避免重复网络请求
const DETAIL_TTL = 5 * 60 * 1000

async function getDetail(contentId) {
  const hit = detailCache.get(contentId)
  if (hit && Date.now() - hit.at < DETAIL_TTL) return hit.data

  const token = rawToken()
  const url = DETAIL_URL(contentId)

  let detail = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const useToken = attempt === 0 && !!token
    const headers = { 'User-Agent': UA, 'Referer': REFERER }
    if (useToken) headers['X-Nd-Auth'] = token
    const res = await http.get(url, { headers })
    if (res.status === 403 || res.status === 401) { if (attempt === 0) continue; throw new Error('获取教材详情失败: HTTP ' + res.status) }
    if (res.status !== 200) throw new Error('获取教材详情失败: HTTP ' + res.status)
    detail = res.data
    break
  }
  if (!detail) throw new Error('教材详情为空')

  // preview 首图 -> 图片目录
  const cp = detail?.custom_properties
  let previewDir = null
  const pv = cp?.preview
  if (pv) {
    const first = firstString(pv)
    if (first) {
      const slash = first.lastIndexOf('/')
      if (slash > 0) previewDir = first.slice(0, slash)
    }
  }

  // PDF 直链（source pdf）
  let pdfUrl = null
  const items = Array.isArray(detail?.ti_items) ? detail.ti_items : []
  for (const it of items) {
    if ((it?.ti_file_flag || '') === 'source' && (it?.ti_format || '') === 'pdf' &&
        Array.isArray(it?.ti_storages) && it.ti_storages.length > 0) {
      pdfUrl = it.ti_storages[0]
      break
    }
  }

  const result = { previewDir, pdfUrl, title: detail?.title || '', pageCount: previewDir ? await probePageCount(previewDir) : 0 }
  detailCache.set(contentId, { at: Date.now(), data: result })
  return result
}

function firstString(pv) {
  if (typeof pv === 'string') return pv
  if (pv && typeof pv === 'object') {
    if (Array.isArray(pv)) {
      for (const v of pv) if (typeof v === 'string' && v) return v
      return null
    }
    for (const k of Object.keys(pv)) {
      const v = pv[k]
      if (typeof v === 'string' && v) return v
    }
  }
  return null
}

// 翻倍探测 + 二分：确定 1..N.jpg 最大可访问页数（公开 CDN 免登录；内存 + 磁盘缓存 30 天）
// 只发 Range 取前 256 字节判定存在，避免探测页数时把整张图下载下来（原来每次开书都白下几十张图）
const PAGE_COUNT_TTL = 30 * 24 * 60 * 60 * 1000
let pageCountDiskCache = null
function loadPageCountDisk() {
  if (pageCountDiskCache === null) {
    const d = readJsonCache(PAGE_COUNT_CACHE_FILE(), PAGE_COUNT_TTL)
    pageCountDiskCache = (d && typeof d === 'object') ? d : {}
  }
  return pageCountDiskCache
}
async function probePageCount(baseDir) {
  if (pageCountCache.has(baseDir)) return pageCountCache.get(baseDir)
  const diskMap = loadPageCountDisk()
  if (typeof diskMap[baseDir] === 'number') {
    pageCountCache.set(baseDir, diskMap[baseDir])
    return diskMap[baseDir]
  }
  const exists = async (n) => {
    try {
      const res = await http.get(`${baseDir}/${n}.jpg`, {
        timeout: 6000, maxRedirects: 2, headers: { Range: 'bytes=0-255' }
      })
      return res.status === 200 || res.status === 206
    } catch { return false }
  }
  let count = 0
  if (await exists(1)) {
    let best = 1, step = 1
    while (best < 4096 && await exists(best + step)) { best += step; step *= 2 }
    let l = best + 1, r = best + step - 1
    while (l <= r) {
      const mid = (l + r) >> 1
      if (await exists(mid)) { best = mid; l = mid + 1 } else r = mid - 1
    }
    count = best
  }
  pageCountCache.set(baseDir, count)
  diskMap[baseDir] = count
  writeJsonCache(PAGE_COUNT_CACHE_FILE(), diskMap)
  return count
}

// 预览图完整 URL 列表（1..N）
async function getPreviewImages(contentId) {
  const d = await getDetail(contentId)
  if (!d.previewDir || d.pageCount <= 0) return { images: [], pageCount: 0, pdfUrl: d.pdfUrl }
  const images = []
  for (let i = 1; i <= d.pageCount; i++) images.push(`${d.previewDir}/${i}.jpg`)
  return { images, pageCount: d.pageCount, pdfUrl: d.pdfUrl }
}

// ===== 教材配套音频 =====
// 从 ti_item 挑选可直连的存储 URL。
// 接口会给多个候选：干净转码直链（esp/xxx.t/zh-CN/{ts}/transcode/audios/{uuid}.mp3，纯 ASCII，MAC 可访问 206）
// 与源文件直链（esp/xxx.pkg/2 Read the speech...mp3，带空格/中文，CDN 一律 403）。
// 必须优先选「无空格/中文且含 transcode」的 URL，否则列表里全是不可播的源文件
function pickStorage(it) {
  const arr = (it?.ti_storages || []).map(String).filter(Boolean)
  if (!arr.length) return ''
  const clean = arr.find(s => /\/transcode\/|\/m3u8\/|\.m4a\//i.test(s) && !/[ \u4e00-\u9fa5]/.test(s))
  return clean || arr[0]
}

async function getAudios(contentId) {
  const res = await http.get(AUDIO_URL(contentId))
  if (res.status !== 200) return []
  const arr = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.data) ? res.data.data : [])
  const list = []
  const seen = new Map() // title -> list 下标（同名去重，只保留更优 URL）
  for (const a of arr) {
    const title = a?.global_title?.['zh-CN'] || ''
    for (const it of (Array.isArray(a?.ti_items) ? a.ti_items : [])) {
      const fmt = it?.ti_format || ''
      if (!['mp3', 'ogg'].includes(fmt)) continue
      const url = pickStorage(it)
      if (!url) continue
      const good = !/[ \u4e00-\u9fa5]/.test(url) // 无空格/中文才算可直连
      if (seen.has(title)) {
        const idx = seen.get(title)
        const cur = list[idx]
        const curGood = !/[ \u4e00-\u9fa5]/.test(cur.mp3Url || cur.oggUrl || '')
        // 新 URL 更优（干净直链）时替换；否则忽略重复项
        if (good && !curGood) {
          if (fmt === 'mp3') cur.mp3Url = url
          else cur.oggUrl = url
        }
        continue
      }
      const item = { title }
      if (fmt === 'mp3') item.mp3Url = url
      else item.oggUrl = url
      list.push(item)
      seen.set(title, list.length - 1)
    }
  }
  return list
}

// ===== 登录：打开官方登录窗口，捕获 X-Nd-Auth =====
let loginWin = null
let capturedInSession = false

function openLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return true }
  capturedInSession = false
  loginWin = new BrowserWindow({
    width: 1080,
    height: 760,
    title: '国家中小学智慧教育平台 - 登录',
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:smartedu' // 独立会话，保留登录 Cookie
    }
  })

  const ses = loginWin.webContents.session
  // 关键：登录窗口 session 使用无 Electron 标识的标准浏览器 UA（否则风控返回 500）
  try { ses.setUserAgent(LOGIN_UA) } catch (e) {}
  // 拦截 HTTPS 请求头，捕获登录令牌（与 WinUI 版 WebView2 同理）
  // 令牌出现在两种请求头之一：
  //   1) X-Nd-Auth: <token>
  //   2) Authorization: MAC id="...",nonce="...",mac="..."（MAC 签名格式，即 X-Nd-Auth 的等价物）
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const h = details.requestHeaders
      // 部分请求可能仍带 Electron UA，统一改写为标准 UA（header 键名大小写在部分 Electron 版本会被归一化，两种都兜底）
      const uaKey = h['User-Agent'] ? 'User-Agent' : ('user-agent' in h ? 'user-agent' : null)
      if (uaKey && String(h[uaKey] || '').includes('Electron')) h[uaKey] = LOGIN_UA
      const auth = h['X-Nd-Auth'] || h['x-nd-auth'] || h['Authorization'] || h['authorization']
      if (auth && !capturedInSession) {
        // 令牌必须保留 MAC/Bearer 前缀原样（C# 版实测：X-Nd-Auth 值与 Authorization 值完全一致），
        // 只额外留存去前缀版本 bare 供兼容性判断，回放始终用完整原始串
        const raw = String(auth)
        capturedInSession = true
        getSessionCookie(ses).then(cookie => applyAuth({ rawAuth: raw, token: raw, bare: raw.replace(/^(MAC|Bearer)\s+/i, ''), cookie }))
      }
    } catch (e) {}
    callback({ requestHeaders: details.requestHeaders })
  })

  // 从登录窗口会话抓取全部 Cookie（与令牌一并持久化，资源请求时注入成功率更高）
  async function getSessionCookie(s) {
    try {
      const cookies = await s.cookies.get({})
      const parts = cookies.filter(c => c && c.name && c.value).map(c => `${c.name}=${c.value}`)
      return parts.join('; ')
    } catch (e) { return '' }
  }

  // 兜底：定期从 localStorage 抓取 ND_UC_AUTH
  const timer = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) { clearInterval(timer); return }
    try {
      const json = await loginWin.webContents.executeJavaScript(`(function(){
        var keys=["ND_UC_AUTH","nd_uc_auth","ND_UC_AUTH_TOKEN","access_token","accessToken","token","uc_auth","auth","loginInfo","loginData","userInfo","user"];
        for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v&&v.length>0)return JSON.stringify({k:keys[i],v:v});}
        for(var j=0;j<localStorage.length;j++){var k=localStorage.key(j),v=localStorage.getItem(k)||"";if(v.length>16)return JSON.stringify({k:k,v:v});}
        return "{}";
      })()`)
      const obj = JSON.parse(json || '{}')
      if (obj && obj.v && !capturedInSession) {
        capturedInSession = true
        getSessionCookie(loginWin.webContents.session).then(cookie => applyAuth({ rawAuth: obj.v, token: obj.v, cookie }))
      }
    } catch (e) {}
  }, 2500)

  loginWin.on('closed', () => {
    clearInterval(timer)
    loginWin = null
    // 关闭前补抓一次最新 Cookie：登录完成后会话 Cookie 才真正建立，
    // 早期捕获令牌那一刻拿到的 Cookie 可能是空的。有会话 Cookie 后再回放，
    // 音频私有资源才能放行（实测：仅有 MAC 令牌 → AccessDenied）
    if (capturedInSession) {
      capturedInSession = false
      getSessionCookie(ses).then(cookie => {
        if (cookie) {
          const a = loadAuth()
          if (a?.rawAuth) applyAuth({ rawAuth: a.rawAuth, cookie })
        }
      })
    }
  })

  loginWin.loadURL('https://basic.smartedu.cn/login')
  return true
}

// 应用/保存登录令牌，通知渲染进程
function applyAuth(info) {
  const parsed = parseTokenInfo(info.rawAuth || info.token || '')
  // cookie 缺省时保留已存值，避免「手动粘贴令牌」把登录会话 Cookie 清空（音频资源需要 Cookie 才放行）
  const prevCookie = loadAuth()?.cookie || ''
  const cookie = info.cookie !== undefined && info.cookie !== null ? String(info.cookie) : prevCookie
  const merged = { token: info.token || parsed.token, rawAuth: info.rawAuth || info.token, cookie, ...parsed }
  saveAuth(merged)
  try {
    const wins = BrowserWindow.getAllWindows()
    for (const w of wins) w.webContents.send('smartedu-login-done', { userName: merged.userName, tokenPrefix: (merged.token || '').slice(0, 16) })
  } catch (e) {}
  return merged
}

// 解析原始令牌字符串（JSON / JWT / 纯字符串）
function parseTokenInfo(raw) {
  const info = { token: '', userName: '已登录用户', avatar: '' }
  let str = String(raw || '').trim()
  // JSON 解包多层引号
  for (let i = 0; i < 3; i++) {
    if (str.startsWith('"') && str.endsWith('"') && str.length > 1) {
      try { const u = JSON.parse(str); if (typeof u === 'string' && u && u !== str) { str = u; continue } } catch (e) {}
    }
    break
  }
  // 当 JSON 解析
  try {
    const doc = JSON.parse(str)
    if (doc && typeof doc === 'object') {
      for (const key of ['access_token', 'accessToken', 'token', 'auth_token', 'ticket', 'Value']) {
        if (typeof doc[key] === 'string' && doc[key]) { info.token = doc[key]; break }
      }
      if (!info.token) {
        for (const nest of ['data', 'result', 'userInfo', 'user']) {
          if (doc[nest] && typeof doc[nest] === 'object') {
            for (const key of ['access_token', 'accessToken', 'token', 'auth_token', 'ticket']) {
              if (typeof doc[nest][key] === 'string' && doc[nest][key]) { info.token = doc[nest][key]; break }
            }
            const un = pickUserName(doc[nest])
            if (un) info.userName = un
            if (doc[nest].avatar) info.avatar = doc[nest].avatar
            if (info.token) break
          }
        }
      }
      const un = pickUserName(doc)
      if (un) info.userName = un
      if (doc.avatar) info.avatar = doc.avatar
    }
  } catch (e) {
    info.token = str // 纯令牌串
  }
  if (!info.token) info.token = str
  const jwtName = parseJwtName(info.token)
  if (jwtName) info.userName = jwtName
  return info
}

function pickUserName(node) {
  for (const key of ['username', 'userName', 'nickname', 'nickName', 'realName', 'realname', 'name', 'phone', 'mobile']) {
    if (node && typeof node[key] === 'string' && node[key]) return node[key]
  }
  return ''
}

function parseJwtName(jwt) {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    let payload = parts[1].padEnd(parts[1].length + ((4 - parts[1].length % 4) % 4), '=')
    payload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    for (const key of ['nickname', 'name', 'username', 'realName', 'phone']) {
      if (typeof json[key] === 'string' && json[key]) return json[key]
    }
  } catch (e) {}
  return null
}

// 测试令牌是否有效：用令牌请求私有 CDN PDF（Range 前 100 字节），200/206=有效
async function testToken(token) {
  const probeUrl = 'https://r1-ndr-private.ykt.cbern.com.cn/edu_product/esp/assets/5a35ea46-f828-44f6-aafb-571cf9a81faa.pkg/9787553999968_%E4%B9%89%E5%8A%A1%E6%95%99%E8%82%B2%E6%95%99%E7%A7%91%E4%B9%A6%E2%80%A2%E6%95%B0%E5%AD%A6_%E4%B9%9D%E5%B9%B4%E7%BA%A7_%E4%B8%8A%E5%86%8C_%E6%B9%96%E5%8D%97%E6%95%99%E8%82%B2%E5%87%BA%E7%89%88%E7%A4%BE_1787020807977.pdf'
  try {
    // 注入方式与真实下载/播放完全一致（X-Nd-Auth + Cookie）
    const res = await http.get(probeUrl, {
      headers: { 'User-Agent': UA, 'Referer': REFERER, ...(getSmartEduHeaders() || {}) },
      timeout: 10000
    })
    return res.status === 200 || res.status === 206
  } catch { return false }
}

// ===== 音频/媒体资源认证探测（仿 C# DownloadCacheAsync 三连尝试） =====
// 顺序：匿名 → X-Nd-Auth+Cookie → Authorization+Cookie。
// 部分音频 URL 已预签名可匿名访问；私有 CDN 需要 MAC 签名，且有的只认 Authorization 头。
// 探测成功后按「精确 URL」登记所需认证头，供 main.js webRequest 注入：
// 避免给预签名公开 URL 乱注入认证头（会导致 403），也避免双头同时注入（会导致 400）。
const mediaAuthMap = new Map() // url -> { headers }

// 探测诊断日志（userData/smart-edu-probe.log）：拿到 21:54 登录后的真实探测结果，避免再靠猜
function probeLog(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'smart-edu-probe.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch (e) {}
}

async function probeMediaUrl(url) {
  // 强制从磁盘重读最新令牌：若运行中内存 authCache 缓存了旧令牌（进程长时间未重启 + 重新登录），
  // 会导致「明明新登录了，音频仍 403 AccessDenied」——实测 PDF 与音频恰好呈这种差异
  const a = loadAuth(true)
  const token = a?.rawAuth || a?.token || ''
  const cookiePart = a?.cookie ? { Cookie: a.cookie } : {}
  const tries = [
    { headers: { 'User-Agent': UA, 'Referer': REFERER, Range: 'bytes=0-0' } },
    ...(token ? [
      { headers: { 'User-Agent': UA, 'Referer': REFERER, 'X-Nd-Auth': token, ...cookiePart, Range: 'bytes=0-0' } },
      { headers: { 'User-Agent': UA, 'Referer': REFERER, Authorization: token, ...cookiePart, Range: 'bytes=0-0' } }
    ] : [])
  ]
  const nonce = (String(token).match(/nonce="([^"]+)"/) || [])[1] || ''
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i]
    try {
      const res = await http.get(url, { headers: t.headers, timeout: 10000, maxRedirects: 3 })
      probeLog(`probe try=${i} status=${res.status} nonce=${nonce} url=${url}`)
      if (res.status === 200 || res.status === 206) {
        const { Range, ...h } = t.headers
        mediaAuthMap.set(url, { headers: h })
        return { success: true, mode: h.Authorization ? 'authorization' : (h['X-Nd-Auth'] ? 'x-nd-auth' : 'anon'), headers: h }
      }
    } catch (e) { /* 换下一组头重试 */ }
  }
  probeLog(`probe FAIL nonce=${nonce} url=${url} (token len=${token.length})`)
  return { success: false }
}

// 供 main.js webRequest 同步查询：该精确 URL 已探测出的认证头（无则不加任何头）
export function getMediaInjectionHeaders(url) {
  return mediaAuthMap.get(url)?.headers || null
}

// ===== IPC 注册 =====
export function registerSmartEduHandlers() {
  ipcMain.handle('smart-edu:catalog', async () => {
    try { return { success: true, data: await getCatalog() } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('smart-edu:detail', async (_, { contentId }) => {
    try { return { success: true, data: await getDetail(contentId) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('smart-edu:preview', async (_, { contentId }) => {
    try { return { success: true, data: await getPreviewImages(contentId) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('smart-edu:audios', async (_, { contentId }) => {
    try { return { success: true, data: await getAudios(contentId) } }
    catch (e) { return { success: false, error: e.message } }
  })
  // 预览图取回：由主进程直接下载（Node 层 CDN 放行，渲染进程 new Image() 对智教 CDN 会 403/坏缓存污染），
  // 转 base64 返回，前端缓存为 dataURL 实现秒级跳转。匿名失败（私有教材）则带令牌重试。
  // 磁盘缓存：URL 相对路径落盘到 userData/smart-edu-preview-cache，二次命中原生读盘，跨进程/跨会话秒开。
  ipcMain.handle('smart-edu:fetch-image', async (_, { url }) => {
    try {
      if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false }
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      const cacheFile = previewCachePath(url)
      // 1) 磁盘缓存优先：直接读回（本地毫秒级，不占内存）
      if (cacheFile) {
        try {
          const buf = fs.readFileSync(cacheFile)
          if (buf && buf.length > 0) {
            const mime = MIME_BY_EXT[path.extname(cacheFile).toLowerCase()] || 'image/jpeg'
            return { ok: true, fromCache: true, mime, b64: buf.toString('base64') }
          }
        } catch {}
      }
      // 2) 网络下载（匿名失败自动带令牌重试），成功后写盘供下次秒读
      let r
      try {
        r = await axios.get(url, { headers: { 'User-Agent': UA }, responseType: 'arraybuffer', timeout: 15000 })
      } catch (e1) {
        const h = getSmartEduHeaders()
        if (!h) return { ok: false }
        r = await axios.get(url, { headers: { ...h, 'User-Agent': UA }, responseType: 'arraybuffer', timeout: 15000 })
      }
      const mime = (r.headers['content-type'] || 'image/jpeg').split(';')[0]
      if (cacheFile && r.data && r.data.length > 0) {
        try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, r.data) } catch {}
      }
      return { ok: true, mime, b64: Buffer.from(r.data).toString('base64') }
    } catch (e) { return { ok: false } }
  })
  // 下载整本 PDF（私有 CDN 需 X-Nd-Auth 令牌，主进程注入后交给统一下载管理器 128 线程下载）
  ipcMain.handle('smart-edu:download-pdf', async (_, { contentId, title }) => {
    try {
      const d = await getDetail(contentId)
      if (!d.pdfUrl) return { success: false, error: '未解析到 PDF 直链' }
      const headers = getSmartEduHeaders()
      if (!headers) return { success: false, error: '下载 PDF 需要登录' }
      const safe = String(title || `教材_${contentId}`)
      const result = await delegateStartDownload({ url: d.pdfUrl, name: safe, category: 'document', headers })
      return result
    } catch (e) { return { success: false, error: e.message } }
  })
  // 下载教材配套音频：先三连探测出可用认证方式（匿名/X-Nd-Auth/Authorization），再以该组头下载一次
  // 避免双头同时注入（400）或给预签名公开 URL 乱注入（403）
  ipcMain.handle('smart-edu:download-audio', async (_, { url, title }) => {
    try {
      if (!/^https?:\/\//i.test(String(url || ''))) return { success: false, error: '音频地址无效' }
      const probe = await probeMediaUrl(url)
      if (!probe?.success) return { success: false, error: '音频资源拒绝访问（403）：令牌可能已过期，请重新登录后重试' }
      const safe = String(title || '教材音频')
      const result = await delegateStartDownload({ url, name: safe, category: 'document', headers: probe.headers })
      return result
    } catch (e) { return { success: false, error: e.message } }
  })
  // 播放前探测音频可用认证方式（结果由 main.js webRequest 按精确 URL 注入）
  ipcMain.handle('smart-edu:probe-audio', async (_, { url }) => {
    try { return await probeMediaUrl(String(url || '')) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('smart-edu:login-open', async () => ({ success: true, opened: openLoginWindow() }))
  ipcMain.handle('smart-edu:login-status', async () => {
    const a = loadAuth()
    return { success: true, loggedIn: !!a?.token, userName: a?.userName || '', avatar: a?.avatar || '' }
  })
  ipcMain.handle('smart-edu:login-manual', async (_, { raw }) => {
    if (!raw || !String(raw).trim()) return { success: false, error: '令牌为空' }
    applyAuth({ rawAuth: String(raw).trim() })
    return { success: true }
  })
  ipcMain.handle('smart-edu:test-token', async () => {
    const tk = rawToken()
    if (!tk) return { success: false, valid: false, error: '未登录' }
    const valid = await testToken(tk)
    return { success: true, valid }
  })
  ipcMain.handle('smart-edu:logout', async () => {
    clearAuth()
    return { success: true }
  })
}

registerSmartEduHandlers()