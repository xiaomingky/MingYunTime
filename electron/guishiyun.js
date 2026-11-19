// electron/guishiyun.js
// 桂师云（www.guishiyun.com）教辅资源 - 主进程 IPC 处理器
// 资源来源：桂师云开放接口（目录/筛选/统计/文件清单/中考真题匿名可用；电子书 PDF 需登录）
// 登录：打开 guishiyun.com 登录窗口（独立 persist:guishiyun 会话），轮询捕获 Cookie gsy-Token
// 下载：CDN file.guishiyun.com 直链免登录，交给统一下载管理器（document 分类）；
//       不注入国家中小学智慧教育平台的 X-Nd-Auth / Cookie
import { ipcMain, app, BrowserWindow, session, shell } from 'electron'
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { delegateStartDownload, resolveDownloadDir } from './download-manager.js'

const BASE = 'https://www.guishiyun.com/api'
const HOME = 'https://www.guishiyun.com/'
const REFERER = 'https://www.guishiyun.com/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const LOGIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 「中考真题」伪书 id（走 filezgkzt 接口，不对应真实教辅）
const EXAM_ID = '__zgkzt__'
const EXAM_NAME = '中考真题'

// ===== 资源类型映射（对齐参考项目 GuishiyunApiService.RestypeLabel）=====
const RESTYPE_LABELS = {
  '1': '课件', '6': '课件',
  '2': '知识微课',
  '3': '微课视频',
  '11': '实验微课',
  '8': '绘图资源',
  '4': '拓展资源',
  '5': '试卷',
  '13': '答题卡', '14': '答题卡',
  '9': '听力音频',
  '17': '衔接资源',
  '16': '专题资源',
  'ebook': '电子书 PDF',
  'paper': '中考真题'
}
const RESTYPE_ORDER = ['课件', '知识微课', '微课视频', '实验微课', '绘图资源', '拓展资源', '试卷', '答题卡', '听力音频', '衔接资源', '专题资源', '电子书 PDF', '中考真题']
const RESTYPE_CHIP_ORDER = RESTYPE_ORDER

function restypeLabel(code) {
  return RESTYPE_LABELS[String(code || '')] || '其他资源'
}

// booktype → 书系列（站点的 booktype 筛选只给 0/3/5，1/2/4 需要按册次归类）
function seriesOf(bookType) {
  switch (String(bookType || '')) {
    case '0': case '1': case '2': return '新课程学习与测评'
    case '3': case '4': return '中考先锋'
    case '5': return '全优中考'
    default: return '其他'
  }
}

// ===== 令牌持久化（userData/guishiyun-auth.json）=====
const AUTH_FILE = () => path.join(app.getPath('userData'), 'guishiyun-auth.json')
let authCache = null

function loadAuth(force = false) {
  if (authCache && !force) return authCache
  try {
    const raw = fs.readFileSync(AUTH_FILE(), 'utf8')
    const obj = JSON.parse(raw)
    authCache = obj && obj.token ? obj : null
  } catch { authCache = null }
  return authCache
}

function saveAuth(token) {
  const t = String(token || '').trim()
  if (!t) return
  authCache = { token: t, savedAt: Date.now() }
  try {
    fs.mkdirSync(path.dirname(AUTH_FILE()), { recursive: true })
    fs.writeFileSync(AUTH_FILE(), JSON.stringify(authCache, null, 2))
  } catch (e) {}
}

function clearAuth() {
  authCache = null
  try { fs.rmSync(AUTH_FILE(), { force: true }) } catch (e) {}
}

function gsyToken() {
  return loadAuth()?.token || ''
}

// 电子书接口鉴权：Cookie gsy-Token + Authorization: Bearer <token> 两者同时带
function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Cookie: `gsy-Token=${token}` }
}

// ===== 内存缓存 =====
const cacheStore = new Map() // key -> { at, ttl, data }
function readCache(key, ttl) {
  const hit = cacheStore.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttl) { cacheStore.delete(key); return null }
  return hit.data
}
function writeCache(key, data, ttl) {
  cacheStore.set(key, { at: Date.now(), data, ttl })
}
function clearCacheByPrefix(prefix) {
  for (const key of Array.from(cacheStore.keys())) {
    if (key.startsWith(prefix)) cacheStore.delete(key)
  }
}

const CATALOG_TTL = 10 * 60 * 1000
const FILTER_TTL = 24 * 60 * 60 * 1000
const STAT_TTL = 30 * 60 * 1000
const FILES_TTL = 10 * 60 * 1000
const EXAM_TTL = 30 * 60 * 1000
const EBOOK_TTL = 5 * 60 * 1000

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': UA, Referer: REFERER, Accept: 'application/json, text/plain, */*' },
  validateStatus: () => true
})

// 并发闸门：整目录统计 / 电子书探测需要连发数百次请求
async function pool(items, limit, worker) {
  const list = Array.from(items)
  const results = new Array(list.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= list.length) return
      try { results[i] = await worker(list[i], i) } catch (e) { results[i] = null }
    }
  })
  await Promise.all(runners)
  return results
}

// ===== 通用工具 =====
function str(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

// 直链规范化：保留已有 %XX（不会二次编码），编码中文/空格/全角括号
function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  try { return new URL(s).href } catch { return s.replace(/ /g, '%20') }
}

// Windows 目录/文件名安全化
function safeSegment(input, fallback = '未命名') {
  const s = String(input || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  return s || fallback
}

function extOfUrl(raw) {
  try {
    const u = new URL(raw)
    const base = decodeURIComponent((u.pathname.split('/').pop() || ''))
    const m = base.match(/\.([a-z0-9]{1,8})$/i)
    return m ? '.' + m[1].toLowerCase() : ''
  } catch { return '' }
}

function isGuishiyunUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase()
    return h === 'guishiyun.com' || h.endsWith('.guishiyun.com')
  } catch { return false }
}

// ===== 目录 / 筛选选项 =====
async function getFilterOptions() {
  const cached = readCache('filters', FILTER_TTL)
  if (cached) return cached

  const res = await http.post(`${BASE}/question/textbooks/getfilterconf`, {})
  if (res.status !== 200 || !res.data) return {}
  const data = (res.data && res.data.data) || res.data
  const out = {}
  for (const [dim, node] of Object.entries(data || {})) {
    if (!node || !Array.isArray(node.list)) continue
    out[dim] = node.list
      .filter(o => o && o.value !== undefined && o.value !== null && String(o.value) !== '' && String(o.value) !== 'all')
      .map(o => ({ value: str(o.value), label: str(o.label) }))
  }
  writeCache('filters', out, FILTER_TTL)
  return out
}

function labelMap(options) {
  const map = {}
  for (const o of (Array.isArray(options) ? options : [])) {
    if (o && o.value && !map[o.value]) map[o.value] = o.label || o.value
  }
  return map
}

function mapBook(it, maps) {
  const pick = (code, map) => {
    const c = str(code)
    return c && map[c] ? map[c] : c
  }
  return {
    id: str(it.id),
    name: str(it.name).trim(),
    bookType: str(it.booktype),
    series: seriesOf(it.booktype),
    year: str(it.year),
    stageCode: str(it.grade_level),
    stage: pick(it.grade_level, maps.stage),
    gradeCode: str(it.grade),
    grade: pick(it.grade, maps.grade),
    subjectCode: str(it.subject_id),
    subject: pick(it.subject_id, maps.subject),
    versionCode: str(it.ver),
    version: pick(it.ver, maps.version),
    termCode: str(it.turn),
    term: pick(it.turn, maps.term),
    coverUrl: normalizeUrl(str(it.logo))
  }
}

const SERIES_ORDER = ['新课程学习与测评', '中考先锋', '全优中考']
function seriesRank(s) {
  const i = SERIES_ORDER.indexOf(s)
  return i < 0 ? 99 : i
}

async function getCatalog(force = false) {
  if (!force) {
    const cached = readCache('catalog', CATALOG_TTL)
    if (cached) return cached
  }

  const filters = await getFilterOptions()
  const maps = {
    grade: labelMap(filters.grade),
    subject: labelMap(filters.subject_id),
    stage: labelMap(filters.grade_level),
    version: labelMap(filters.ver),
    term: labelMap(filters.turn)
  }

  const books = []
  const seen = new Set()
  for (let page = 1; page <= 10; page++) {
    const res = await http.get(`${BASE}/question/textbooks`, {
      params: { page, size: 500, ispublish: 'true', ordering: '-updated_time' }
    })
    if (res.status !== 200) break
    const data = res.data?.data
    const arr = Array.isArray(data?.results) ? data.results : []
    for (const it of arr) {
      const b = mapBook(it, maps)
      if (!b.id || !b.name || seen.has(b.id)) continue
      seen.add(b.id)
      books.push(b)
    }
    if (!data?.has_more) break
  }

  books.sort((a, b) =>
    seriesRank(a.series) - seriesRank(b.series) ||
    String(b.year).localeCompare(String(a.year), 'zh-CN') ||
    String(a.grade).localeCompare(String(b.grade), 'zh-CN') ||
    String(a.subject).localeCompare(String(b.subject), 'zh-CN') ||
    String(a.name).localeCompare(String(b.name), 'zh-CN')
  )

  const result = { books, filters, restypeOrder: RESTYPE_CHIP_ORDER }
  writeCache('catalog', result, CATALOG_TTL)
  return result
}

// ===== 资源统计（restype-stat）=====
async function getStats(ids) {
  const out = {}
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map(str).filter(id => id && id !== EXAM_ID)))

  await pool(list, 8, async (id) => {
    const key = `stat:${id}`
    const cached = readCache(key, STAT_TTL)
    if (cached) { out[id] = cached; return }

    const res = await http.get(`${BASE}/question/teatextbookfiles/restype-stat`, {
      params: { textbook_id: id, ispublish: 'true' }
    })
    if (res.status !== 200 || !res.data) return

    const root = res.data
    const counts = {}
    for (const s of (Array.isArray(root.stats) ? root.stats : [])) {
      const n = Number(s?.count) || 0
      if (n <= 0) continue
      const label = restypeLabel(s?.restype)
      counts[label] = (counts[label] || 0) + n
    }
    const types = RESTYPE_CHIP_ORDER.filter(l => counts[l])
    const stat = {
      total: Number(root.total_count) || 0,
      types,
      counts,
      text: types.map(l => `${l} ${counts[l]}`).join(' · ')
    }
    writeCache(key, stat, STAT_TTL)
    out[id] = stat
  })

  return out
}

// ===== 文件清单 =====
// fileurl 是 JSON 字符串：外层是资源条目，fileList 是压缩包成员（各自带 access_url）
function parseFileUrl(raw) {
  if (!raw) return []
  try {
    const doc = JSON.parse(raw)
    return Array.isArray(doc) ? doc.filter(x => x && typeof x === 'object') : []
  } catch { return [] }
}

function appendFiles(into, entry, bookId, bookName) {
  const restype = str(entry.restype)
  const label = restypeLabel(restype)
  for (const item of parseFileUrl(str(entry.fileurl))) {
    const outerName = str(item.name)
    const outerUrl = normalizeUrl(str(item.url))
    const members = (Array.isArray(item.fileList) ? item.fileList : [])
      .filter(m => m && typeof m === 'object' && str(m.access_url))

    if (outerUrl) {
      into.push({
        bookId,
        bookName,
        name: outerName || str(entry.filename),
        parent: '',
        inner: false,
        packaged: members.length > 0,
        restype,
        restypeLabel: label,
        size: Number(item.size) || 0,
        url: outerUrl
      })
    }

    for (const m of members) {
      const memberUrl = normalizeUrl(str(m.access_url))
      if (!memberUrl) continue
      into.push({
        bookId,
        bookName,
        name: str(m.filename),
        parent: outerName,
        inner: true,
        packaged: false,
        restype,
        restypeLabel: label,
        size: 0,
        url: memberUrl
      })
    }
  }
}

async function getFiles(bookId, bookName) {
  if (!bookId) return []
  const key = `files:${bookId}:${bookName || ''}`
  const cached = readCache(key, FILES_TTL)
  if (cached) return cached

  const list = []
  for (let page = 1; page <= 50; page++) {
    const res = await http.get(`${BASE}/question/teatextbookfiles`, {
      params: { page, size: 200, textbook_id: bookId, ordering: 'rank', ispublish: 'true' }
    })
    if (res.status !== 200) break
    const data = res.data?.data
    const arr = Array.isArray(data?.results) ? data.results : []
    for (const it of arr) appendFiles(list, it, bookId, bookName)
    if (!data?.has_more) break
  }

  writeCache(key, list, FILES_TTL)
  return list
}

async function getExamPapers() {
  const cached = readCache('exam', EXAM_TTL)
  if (cached) return cached

  const list = []
  for (let page = 1; page <= 10; page++) {
    const res = await http.get(`${BASE}/question/filezgkzt`, {
      params: { page, size: 200, ordering: 'rank', ispublish: 'true', type: 1 }
    })
    if (res.status !== 200) break
    const data = res.data?.data
    const arr = Array.isArray(data?.results) ? data.results : []
    for (const it of arr) appendFiles(list, it, EXAM_ID, EXAM_NAME)
    if (!data?.has_more) break
  }

  writeCache('exam', list, EXAM_TTL)
  return list
}

// ===== 配套电子书（需登录）=====
function finishStaOk(scope) {
  if (!scope || typeof scope !== 'object') return false
  const fsNode = scope.finishsta
  return !!(fsNode && typeof fsNode === 'object' && str(fsNode.value) === '1')
}

function readEbookFile(root) {
  const payload = (root && typeof root.data === 'object' && root.data !== null) ? root.data : root
  if (!finishStaOk(payload) && !finishStaOk(root)) return null

  const arrays = []
  if (payload && Array.isArray(payload.data)) arrays.push(payload.data)
  if (root && Array.isArray(root.data)) arrays.push(root.data)

  for (const arr of arrays) {
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue
      const url = normalizeUrl(str(e.fileurl))
      if (!url) continue
      return { url, name: str(e.bookname) }
    }
  }
  return null
}

async function getEbook(bookId, bookName) {
  const token = gsyToken()
  if (!token) return { success: true, needLogin: true, file: null }

  const key = `ebook:${bookId}`
  const cached = readCache(key, EBOOK_TTL)
  if (cached) return cached

  const res = await http.get(`${BASE}/question/textbooks/pdfebook`, {
    params: { textbook_id: bookId },
    headers: authHeaders(token)
  })

  let result
  if (res.status === 401 || res.status === 403) {
    result = { success: true, needLogin: true, file: null }
  } else if (res.status !== 200 || !res.data) {
    result = { success: true, needLogin: false, file: null }
  } else {
    const hit = readEbookFile(res.data)
    if (!hit) {
      result = { success: true, needLogin: false, file: null }
    } else {
      let name = hit.name || bookName || '电子书'
      if (!/\.pdf$/i.test(name)) name += '.pdf'
      result = {
        success: true,
        needLogin: false,
        file: {
          bookId,
          bookName: bookName || '',
          name,
          parent: '',
          inner: false,
          packaged: false,
          restype: 'ebook',
          restypeLabel: restypeLabel('ebook'),
          size: 0,
          url: hit.url
        }
      }
    }
  }

  writeCache(key, result, EBOOK_TTL)
  return result
}

async function getEbookIds(ids) {
  const token = gsyToken()
  if (!token) return []

  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map(str).filter(id => id && id !== EXAM_ID)))
  if (!list.length) return []

  const key = 'ebook-ids'
  const cached = readCache(key, EBOOK_TTL)
  if (cached) return cached

  const hits = []
  await pool(list, 8, async (id) => {
    const res = await http.get(`${BASE}/question/textbooks/pdfebook`, {
      params: { textbook_id: id },
      headers: authHeaders(token)
    })
    if (res.status !== 200 || !res.data) return
    if (readEbookFile(res.data)) hits.push(id)
  })

  writeCache(key, hits, EBOOK_TTL)
  return hits
}

// ===== 登录（独立会话，捕获 Cookie gsy-Token）=====
let loginWin = null
let loginTimer = null
let captured = false

function broadcastLoginDone() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('guishiyun-login-done', { loggedIn: true })
    }
  } catch (e) {}
}

function stopTimer() {
  if (loginTimer) { clearInterval(loginTimer); loginTimer = null }
}

function openLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return true }

  captured = false
  loginWin = new BrowserWindow({
    width: 1020,
    height: 740,
    title: '桂师云 - 登录',
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:guishiyun'
    }
  })

  const ses = loginWin.webContents.session
  try { ses.setUserAgent(LOGIN_UA) } catch (e) {}

  // 站点鉴权就是 Cookie gsy-Token；只读会话 Cookie，不读页面 localStorage
  const readCookie = async () => {
    if (captured) return
    try {
      const cookies = await ses.cookies.get({ name: 'gsy-Token' })
      const hit = (cookies || []).find(c => c && c.value)
      if (!hit) return
      captured = true
      saveAuth(hit.value)
      stopTimer()
      broadcastLoginDone()
      clearCacheByPrefix('ebook')
    } catch (e) {}
  }

  const scheduleRead = () => {
    setTimeout(readCookie, 300)
    setTimeout(readCookie, 1500)
  }
  loginWin.webContents.on('did-navigate', scheduleRead)
  loginWin.webContents.on('did-navigate-in-page', scheduleRead)
  loginWin.webContents.on('did-finish-load', scheduleRead)

  loginTimer = setInterval(readCookie, 1500)

  // 关闭前补抓一次：登录完成到用户关窗口之间可能还差一个轮询周期
  loginWin.on('close', () => { readCookie() })
  loginWin.on('closed', () => {
    stopTimer()
    loginWin = null
  })

  loginWin.loadURL(HOME)
  return true
}

function loginStatus() {
  const a = loadAuth(true)
  return { success: true, loggedIn: !!a?.token }
}

function loginManual(raw) {
  let t = String(raw || '').trim()
  if (!t) return { success: false, error: '令牌为空' }
  t = t.replace(/^Bearer\s+/i, '').replace(/^gsy-Token=/i, '').trim()
  if (!t) return { success: false, error: '令牌为空' }
  saveAuth(t)
  clearCacheByPrefix('ebook')
  broadcastLoginDone()
  return { success: true }
}

async function logout() {
  clearAuth()
  clearCacheByPrefix('ebook')
  try {
    const ses = session.fromPartition('persist:guishiyun')
    await ses.clearStorageData({ storages: ['cookies', 'localstorage'] })
  } catch (e) {}
  return { success: true }
}

// ===== 下载 =====
async function downloadOne({ url, name, bookName }) {
  const u = normalizeUrl(url)
  if (!isGuishiyunUrl(u)) return { success: false, error: '资源地址无效' }

  const bookDir = safeSegment(bookName, '桂师云资源')
  const baseName = safeSegment(name || decodeURIComponent((() => {
    try { return new URL(u).pathname.split('/').pop() || '' } catch { return '' }
  })()), '资源')
  const fileName = /\.[a-z0-9]{1,8}$/i.test(baseName) ? baseName : baseName + extOfUrl(u)
  const savePath = path.join(resolveDownloadDir(), bookDir, fileName)

  return delegateStartDownload({
    url: u,
    name: fileName,
    category: 'document',
    savePath,
    headers: { 'User-Agent': UA }
  })
}

async function downloadBatch(items) {
  const list = Array.isArray(items) ? items : []
  let added = 0
  let failed = 0
  for (const it of list) {
    try {
      const r = await downloadOne(it || {})
      if (r?.success) added += 1
      else failed += 1
    } catch (e) { failed += 1 }
  }
  return { success: true, added, failed }
}

async function openUrl(url) {
  const u = normalizeUrl(url)
  if (!isGuishiyunUrl(u)) return { success: false, error: '地址无效' }
  try { await shell.openExternal(u); return { success: true } } catch (e) { return { success: false, error: e.message } }
}

// ===== IPC 注册 =====
export function registerGuishiyunHandlers() {
  ipcMain.handle('guishiyun:catalog', async (_, payload) => {
    try {
      const force = !!payload?.force
      if (force) clearCacheByPrefix('catalog')
      const data = await getCatalog(force)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('guishiyun:stats', async (_, { ids } = {}) => {
    try { return { success: true, data: await getStats(ids) } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:files', async (_, { bookId, bookName } = {}) => {
    try { return { success: true, data: await getFiles(String(bookId || ''), String(bookName || '')) } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:exam', async () => {
    try { return { success: true, data: await getExamPapers() } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:ebook', async (_, { bookId, bookName } = {}) => {
    try { return await getEbook(String(bookId || ''), String(bookName || '')) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:ebook-ids', async (_, { ids } = {}) => {
    try { return { success: true, data: await getEbookIds(ids) } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:download', async (_, payload = {}) => {
    try { return await downloadOne(payload) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:download-batch', async (_, { items } = {}) => {
    try { return await downloadBatch(items) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:open-url', async (_, { url } = {}) => openUrl(url))

  ipcMain.handle('guishiyun:login-open', async () => {
    try { return { success: true, opened: openLoginWindow() } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('guishiyun:login-status', async () => loginStatus())

  ipcMain.handle('guishiyun:login-manual', async (_, { raw } = {}) => loginManual(raw))

  ipcMain.handle('guishiyun:logout', async () => logout())
}

registerGuishiyunHandlers()
