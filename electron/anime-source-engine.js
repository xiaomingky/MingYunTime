import { app, BrowserWindow, ipcMain, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import axios from 'axios'
import cheerio from 'cheerio'
import bundledRules from './anime-source-builtins.js'
import { discoverAnimeCatalog } from './anime-source-catalog.js'

// Declarative JSON compatibility adapter, implemented for this application.
// Rule HTML and external sites never execute with Node or application privileges.
const REPO = 'https://api.github.com/repos/Predidit/KazumiRules/contents/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36'
let rules, parser
let parseTail = Promise.resolve()
const tasks = new Map(), playRequests = new Map(), headersByOrigin = new Map(), cache = new Map()
const rulesPath = () => path.join(app.getPath('userData'), 'anime-source-rules.json')
const statePath = () => path.join(app.getPath('userData'), 'anime-source-state.json')
const inFlight = new Map()
let ruleState
function state() {
  if (!ruleState) { try { ruleState = JSON.parse(fs.readFileSync(statePath(), 'utf8')) } catch { ruleState = {} } }
  return ruleState
}
function saveState() { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(state()), 'utf8') }
function http(value) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw Error('仅支持 HTTP 或 HTTPS 地址'); return url.href }
const absolute = (base, value) => value ? http(new URL(String(value).replace(/&amp;/g, '&'), base).href) : ''
const substitute = (value, vars, encode = false) => String(value ?? '').replace(/\{(\w+)\}|@(\w+)\b/g, (match, a, b) => Object.hasOwn(vars, a || b) ? encode ? encodeURIComponent(vars[a || b] ?? '') : String(vars[a || b] ?? '') : match)
function mapTemplate(value, vars) {
  if (typeof value === 'string') return substitute(value, vars)
  if (Array.isArray(value)) return value.map(item => mapTemplate(item, vars))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapTemplate(item, vars)]))
  return value
}
function load() {
  if (!rules) {
    try { rules = JSON.parse(fs.readFileSync(rulesPath(), 'utf8')) } catch { rules = [] }
    if (!Array.isArray(rules)) rules = []
    const removed = new Set(state().removed || []), installed = new Set(rules.map(rule => rule.id))
    const missing = bundledRules.map(normalizeAnimeRule).filter(rule => !installed.has(rule.id) && !removed.has(rule.id))
    if (missing.length) persist([...rules, ...missing])
  }
  return rules
}
function persist(next) {
  fs.mkdirSync(path.dirname(rulesPath()), { recursive: true })
  fs.writeFileSync(rulesPath() + '.tmp', JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(rulesPath() + '.tmp', rulesPath()); rules = next
}
export function normalizeAnimeRule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('规则必须是 JSON 对象')
  const name = String(value.name || '').trim(); if (!name) throw Error('规则名称不能为空')
  const baseUrl = http(value.baseUrl || value.baseURL)
  if (!value.search?.url && !value.searchURL && !value.searchApiConfig?.request?.url) throw Error('规则缺少搜索地址')
  if (!value.detail && !value.chapterRoads && value.chapterMode !== 'api') throw Error('规则缺少分集解析配置')
  const id = value.id && value.id !== 'rule-undefined' ? String(value.id) : createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 14)
  return { ...value, id: id.startsWith('rule-') ? id : `rule-${id}`, name, baseUrl, enabled: value.enabled !== false }
}
const list = () => load().filter(rule => rule.enabled).map(rule => ({ id: rule.id, label: rule.name, desc: rule.baseUrl, version: rule.version || '', builtin: !!rule.builtin, health: state().health?.[rule.id] || null, rule: true }))
function ruleFor(id) { const rule = load().find(item => item.id === id && item.enabled); if (!rule) throw Error('动漫源未启用或已删除'); return rule }
export function animeSourceRules() { return { success: true, data: list(), all: load().map(rule => ({ ...rule, health: state().health?.[rule.id] || null })) } }
const siteSession = rule => session.fromPartition(`persist:anime-source-${createHash('sha256').update(rule.baseUrl).digest('hex').slice(0, 12)}`)
async function request(rule, url, spec = {}, vars = {}) {
  url = http(substitute(url, vars, true))
  const cookies = await siteSession(rule).cookies.get({ url })
  const headers = { 'User-Agent': rule.userAgent || UA, Referer: rule.referer || rule.baseUrl, ...rule.headers, ...mapTemplate(spec.headers || {}, vars) }
  if (cookies.length) headers.Cookie = cookies.map(item => `${item.name}=${item.value}`).join('; ')
  let body = mapTemplate(spec.body, vars)
  if (spec.bodyType === 'form') { body = new URLSearchParams(body || {}).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
  let response
  try { response = await axios({ method: spec.method || 'GET', url, headers, params: mapTemplate(spec.query, vars), data: body, timeout: 9000, maxRedirects: 5, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true }) }
  catch (error) { throw Error(error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ? '连接此源超时，可切换其他源后重试' : '暂时无法连接此源，请切换其他源或检查网络') }
  if ([403, 429].includes(response.status)) throw Error(`源站限制访问（${response.status}），可点击“站点验证”后重试`)
  if (response.status >= 400) throw Error(`源站返回 ${response.status}`)
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
}
export function jsonValues(root, expression = '$') {
  if (!expression || expression === '$') return [root]
  let rest = expression.replace(/^\$/, ''), values = [root]
  while (rest) {
    const match = rest.match(/^(?:\.\.([\w-]+)|\.([\w-]+)|\[['"]([^'"]+)['"]\]|\[(\d+|\*)\]|([\w-]+))/)
    if (!match) throw Error(`不支持的 JSON 路径：${expression}`)
    const key = match[1] || match[2] || match[3] || match[4] || match[5], next = []
    const walk = object => { if (!object || typeof object !== 'object') return; if (Object.hasOwn(object, key)) next.push(object[key]); Object.values(object).forEach(walk) }
    for (const value of values) {
      if (match[1]) walk(value)
      else if (key === '*') { if (value && typeof value === 'object') next.push(...Object.values(value)) }
      else if (value != null && Object.hasOwn(Object(value), key)) next.push(value[key])
    }
    values = next; rest = rest.slice(match[0].length)
  }
  return values
}
const scalar = (root, expression, fallback = '') => jsonValues(root, expression)[0] ?? fallback
async function xpath(raw, rule, phase) {
  const run = async () => {
    if (!parser || parser.isDestroyed()) { parser = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); parser.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); await parser.loadURL('about:blank') }
    function parseHtml(html, config, operation) {
      const document = new DOMParser().parseFromString(html, 'text/html')
      const select = (context, expression) => {
        if (!expression) return []
        if (expression === '//' || expression === '/') return [document.documentElement]
        // Imported rules evaluate // relative to each result/road, rather than the entire document.
        const scoped = context === document ? expression : expression.split('|').map(part => { const value = part.trim(); return value.startsWith('/') ? `.${value}` : value }).join(' | ')
        const result = document.evaluate(scoped, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        return Array.from({ length: result.snapshotLength }, (_, index) => result.snapshotItem(index))
      }
      const text = node => (node?.nodeValue || node?.textContent || '').replace(/\s+/g, ' ').trim()
      const href = node => node?.nodeType === 2 ? node.value : node?.getAttribute?.('href') || ''
      if (operation === 'search') return select(document, config.searchList).map(node => {
        const image = node.querySelector?.('img')
        return { title: text(select(node, config.searchName)[0]), id: href(select(node, config.searchResult)[0]), cover: image?.getAttribute('data-original') || image?.getAttribute('data-src') || image?.getAttribute('src') || '' }
      }).filter(item => item.title && item.id)
      return select(document, config.chapterRoads).map((road, index) => ({ name: `线路 ${index + 1}`, episodes: select(road, config.chapterResult).map((ep, i) => ({ title: text(ep) || `第 ${i + 1} 集`, url: href(ep) })).filter(ep => ep.url) })).filter(road => road.episodes.length)
    }
    return parser.webContents.executeJavaScript(`(${parseHtml.toString()})(${JSON.stringify(raw)},${JSON.stringify(rule)},${JSON.stringify(phase)})`)
  }
  const result = parseTail.then(run, run); parseTail = result.catch(() => {}); return result
}
const node = ($, el, selector) => selector ? ($(el).is(selector) ? $(el) : $(el).find(selector).first()) : $(el)
const text = ($, el, selector) => node($, el, selector).text().replace(/\s+/g, ' ').trim()
const image = ($, el, selector) => { const n = node($, el, selector); return n.attr('data-original') || n.attr('data-src') || n.attr('src') || '' }
export async function searchAnimeRule(id, keyword) {
  const rule = ruleFor(id); let items
  const api = rule.searchMode === 'api' ? rule.searchApiConfig : rule.search?.mode === 'api' ? rule.search : null
  if (api) {
    const spec = api.request || api, data = JSON.parse(await request(rule, absolute(rule.baseUrl, spec.url), spec, { keyword }))
    items = jsonValues(data, api.listPath || '$.data[*]').map(item => ({ title: String(scalar(item, api.namePath || api.titlePath || '$.name')), id: String(scalar(item, api.sourcePath || api.idPath || '$.url')), cover: scalar(item, api.coverPath || '$.cover', item.pic || item.vod_pic || item.image || item.poster || ''), desc: scalar(item, '$.desc', item.vod_blurb || '') }))
    if (api.sourceTemplate) items.forEach(item => { item.id = substitute(api.sourceTemplate, { source: item.id }) })
  } else {
    const config = rule.search; let url = absolute(rule.baseUrl, substitute(config?.url || rule.searchURL, { keyword }, true)), spec = config || {}
    if (rule.usePost) { const parsed = new URL(url); spec = { ...spec, method: 'POST', bodyType: 'form', body: Object.fromEntries(parsed.searchParams) }; parsed.search = ''; url = parsed.href }
    const raw = await request(rule, url, spec, { keyword })
    if (!config) items = await xpath(raw, rule, 'search')
    else { const $ = cheerio.load(raw); items = []; $(config.item).each((_, el) => items.push({ id: node($, el, config.id).attr('href') || '', title: text($, el, config.title), cover: image($, el, config.cover) })) }
  }
  const seen = new Set()
  return items.filter(item => item.id && item.title).map(item => ({ ...item, id: api ? String(item.id) : absolute(rule.baseUrl, item.id), cover: absolute(rule.baseUrl, item.cover), source: id, sourceLabel: rule.name })).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true })
}
export async function checkAnimeRule(id, keyword = '海贼王') {
  const started = Date.now()
  let health
  try { const results = await searchAnimeRule(id, keyword); health = { status: results.length ? 'available' : 'empty', count: results.length, ms: Date.now() - started, checkedAt: Date.now(), message: results.length ? '已验证搜索结果' : '连接成功，未找到匹配结果' } }
  catch (error) { health = { status: 'unreachable', count: 0, ms: Date.now() - started, checkedAt: Date.now(), message: error.message } }
  state().health = { ...state().health, [id]: health }; saveState()
  return health
}
export async function detailAnimeRule(id, itemId) {
  const rule = ruleFor(id), config = rule.detail || {}, api = rule.chapterMode === 'api' ? rule.chapterApiConfig : null
  const target = /^https?:\/\//i.test(itemId) ? http(itemId) : absolute(rule.baseUrl, substitute(config.url || '{id}', { id: itemId }, true))
  const raw = api ? await request(rule, absolute(rule.baseUrl, substitute(api.request.url, { source: itemId, id: itemId }, true)), api.request, { source: itemId, id: itemId }) : await request(rule, target)
  let routes, title = '', cover = '', desc = ''
  if (api) {
    const data = JSON.parse(raw)
    if (api.format === 'delimited') {
      const names = String(scalar(data, api.roadNamesPath)).split(api.roadSeparator || '$$$')
      routes = String(scalar(data, api.roadEpisodesPath)).split(api.roadSeparator || '$$$').map((road, index) => ({ name: names[index] || `线路 ${index + 1}`, episodes: road.split(api.episodeSeparator || '#').map(entry => { const fields = entry.split(api.fieldSeparator || '$'); return { title: fields[0], url: fields.slice(1).join(api.fieldSeparator || '$') } }) }))
    } else routes = jsonValues(data, api.roadsPath || '$.data.roads[*]').map((road, roadIndex) => ({ name: scalar(road, api.roadNamePath || '$.name', `线路 ${roadIndex + 1}`), episodes: jsonValues(road, api.episodesPath || '$.episodes[*]').map((ep, episodeIndex) => {
      const vars = { source: itemId, id: itemId, roadIndex, episodeIndex, episodeUrl: scalar(ep, api.episodeUrlPath || '$.url'), episodeName: scalar(ep, api.episodeNamePath || '$.name') }
      for (const [key, expression] of Object.entries(api.variables || {})) vars[key] = scalar(data, expression)
      let url = api.episodePage?.url ? substitute(api.episodePage.url, vars) : scalar(ep, api.episodeUrlPath || '$.url')
      if (api.episodePage?.query) { const parsed = new URL(url, rule.baseUrl); Object.entries(mapTemplate(api.episodePage.query, vars)).forEach(([key, value]) => parsed.searchParams.set(key, value)); url = parsed.href }
      return { title: scalar(ep, api.episodeNamePath || '$.name', `第 ${episodeIndex + 1} 集`), url }
    }) }))
  } else {
    const $ = cheerio.load(raw)
    title = text($, $.root(), config.title || 'h1') || $('meta[property="og:title"]').attr('content') || $('title').text()
    cover = config.cover ? image($, $.root(), config.cover) : $('meta[property="og:image"]').attr('content')
    desc = config.desc ? text($, $.root(), config.desc) : $('meta[name="description"]').attr('content') || ''
    if (!rule.detail) routes = await xpath(raw, rule, 'detail')
    else { routes = []; $(config.route).each((index, el) => { const episodes = []; $(el).find(config.episode).each((i, ep) => episodes.push({ title: text($, ep, config.episodeTitle) || `第 ${i + 1} 集`, url: $(ep).attr(config.episodeUrl || 'href') || '' })); routes.push({ name: config.routeName ? text($, el, config.routeName) : `线路 ${index + 1}`, episodes }) }) }
  }
  routes = routes.map((road, roadIndex) => ({ ...road, episodes: road.episodes.filter(ep => ep.url).map((ep, index) => ({ ...ep, id: `${id}:${roadIndex}:${index}`, url: absolute(rule.baseUrl, ep.url), source: id, routeIndex: roadIndex, thumbnail: absolute(rule.baseUrl, cover) })) })).filter(road => road.episodes.length)
  if (!routes.length) throw Error(/暂无播放资源|暂无资源|暂无片源/.test(raw) ? '此条目暂无播放资源，请选择同名其他条目或更换播放源' : '没有解析到剧集，请检查规则或完成站点验证')
  return { id: itemId, title: String(title).trim(), cover: absolute(rule.baseUrl, cover), desc: String(desc).slice(0, 1800), routes, source: id, sourceLabel: rule.name }
}
function remember(url, rule, referer) { headersByOrigin.set(new URL(url).origin, { expires: Date.now() + 7200000, headers: { Referer: rule.referer || referer, 'User-Agent': rule.userAgent || UA, ...rule.mediaHeaders } }) }
export function animeSourceMediaHeaders(url) { try { const item = headersByOrigin.get(new URL(url).origin); return item?.expires > Date.now() ? item.headers : null } catch { return null } }
export function animeMediaType(url, contentType = '') {
  if (/mpegurl/i.test(contentType)) return 'm3u8'
  if (/video\/x-flv/i.test(contentType)) return 'flv'
  if (/video\//i.test(contentType)) return 'direct'
  try { const pathname = new URL(url).pathname; return /\.m3u8$/i.test(pathname) ? 'm3u8' : /\.flv$/i.test(pathname) ? 'flv' : /\.(mp4|webm|m4v)$/i.test(pathname) ? 'direct' : '' } catch { return '' }
}
const mediaType = animeMediaType
export function animePageMedia(raw, baseUrl) {
  const decoded = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'), $ = cheerio.load(raw)
  const player = decoded.match(/(?:var\s+)?player_[\w]+\s*=\s*(\{[^;]+?\})\s*[;<]/)?.[1]
  let configured = ''
  try {
    const data = JSON.parse(player)
    configured = String(data.url || '')
    if (Number(data.encrypt) === 1) configured = decodeURIComponent(configured)
    if (Number(data.encrypt) === 2) configured = decodeURIComponent(Buffer.from(configured, 'base64').toString('utf8'))
  } catch {}
  const candidates = [configured, ...$('video[src], video source[src]').map((_, node) => $(node).attr('src')).get(), ...(decoded.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>\\]*)?/ig) || [])].filter(Boolean)
  for (const value of candidates) {
    try {
      let url = new URL(value, baseUrl)
      for (let depth = 0; depth < 3; depth++) {
        if (mediaType(url.href)) return { url: http(url.href), type: mediaType(url.href) }
        const nested = ['url', 'src', 'video'].map(key => url.searchParams.get(key)).find(item => /^https?:\/\//i.test(item || ''))
        if (!nested) break
        url = new URL(nested)
      }
    } catch {}
  }
  return null
}
async function browserMedia(rule, episodeUrl, owner) {
  tasks.get(owner)?.cancel()
  return new Promise((resolve, reject) => {
    const isolated = session.fromPartition(`anime-resolve-${owner}-${Date.now()}`)
    const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } })
    window.webContents.setAudioMuted(true); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); isolated.setPermissionRequestHandler((_, __, callback) => callback(false))
    let done = false, poll, timer, polling = false
    let intercept
    const finish = (url, error, fallback = false, detectedType = '') => {
      if (done) return; done = true; clearInterval(poll); clearTimeout(timer); isolated.webRequest.onBeforeRequest(null); isolated.webRequest.onHeadersReceived(null)
      if (!window.isDestroyed()) window.destroy()
      if (tasks.get(owner)?.window === window) tasks.delete(owner)
      if (error) reject(error)
      else { if (!fallback) remember(url, rule, episodeUrl); resolve({ success: true, url, type: fallback ? 'iframe' : detectedType || mediaType(url) || 'direct' }) }
    }
    tasks.set(owner, { window, cancel: () => finish('', Error('播放解析已取消')) })
    intercept = (details, callback) => { callback({ cancel: false }); if (mediaType(details.url) && ['media', 'xhr'].includes(details.resourceType)) finish(details.url) }
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, intercept)
    isolated.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      callback({ cancel: false })
      const header = Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
      const type = mediaType(details.url, Array.isArray(header) ? header[0] : header || '')
      if (details.statusCode >= 200 && details.statusCode < 300 && type && ['media', 'xhr'].includes(details.resourceType)) finish(details.url, null, false, type)
    })
    window.webContents.on('will-navigate', (event, url) => { try { http(url) } catch { event.preventDefault() } })
    timer = setTimeout(() => finish(episodeUrl, null, true), 14000)
    siteSession(rule).cookies.get({ url: episodeUrl }).then(async cookies => {
      for (const cookie of cookies) { try { const { hostOnly, session: ignored, ...fields } = cookie; await isolated.cookies.set({ ...fields, url: episodeUrl }) } catch {} }
      if (!done) await window.loadURL(episodeUrl, { userAgent: rule.userAgent || UA, httpReferrer: rule.referer || rule.baseUrl })
    }).catch(() => {})
    poll = setInterval(async () => {
      if (done || window.isDestroyed() || polling) return; polling = true
      try { for (const frame of window.webContents.mainFrame.framesInSubtree) {
        if (done) break
        const url = await frame.executeJavaScript(`(()=>{for(const video of document.querySelectorAll('video')){video.muted=true;video.play().catch(()=>{});const url=video.currentSrc||video.src;if(/^https?:/.test(url))return url}return ''})()`).catch(() => '')
        if (url && /^https?:/.test(url)) finish(url)
      } } finally { polling = false }
    }, 800)
  })
}
export async function playAnimeRule(id, episodeUrl, owner = 0) {
  const revision = (playRequests.get(owner) || 0) + 1
  playRequests.set(owner, revision)
  tasks.get(owner)?.cancel()
  const ensureCurrent = () => { if (playRequests.get(owner) !== revision) throw Error('播放解析已取消') }
  const rule = ruleFor(id); episodeUrl = http(episodeUrl)
  if (mediaType(episodeUrl)) { remember(episodeUrl, rule, rule.baseUrl); return { success: true, url: episodeUrl, type: mediaType(episodeUrl) } }
  try {
    const raw = await request(rule, episodeUrl)
    ensureCurrent()
    const direct = animePageMedia(raw, episodeUrl)
    if (direct) { remember(direct.url, rule, episodeUrl); return { success: true, ...direct } }
  } catch (error) { if (/限制访问|已取消/.test(error.message)) throw error }
  ensureCurrent()
  return browserMedia(rule, episodeUrl, owner)
}
async function repository(file) {
  const cached = cache.get(`repo:${file}`); if (cached && Date.now() - cached.time < 300000) return cached.data
  if (!inFlight.has(file)) {
    const controller = new AbortController()
    const urls = [REPO + encodeURIComponent(file), `https://raw.githubusercontent.com/Predidit/KazumiRules/main/${encodeURIComponent(file)}`, `https://raw.gitcode.com/gh_mirrors/ka/KazumiRules/raw/main/${encodeURIComponent(file)}`]
    const pending = Promise.any(urls.map(async url => {
      const response = await axios.get(url, { timeout: 6000, signal: controller.signal, maxContentLength: 2 * 1024 * 1024, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MingYunTime' } })
      let data = response.data?.encoding === 'base64' ? JSON.parse(Buffer.from(response.data.content, 'base64').toString('utf8')) : response.data
      if (typeof data === 'string') data = JSON.parse(data)
      if (!data || typeof data !== 'object') throw Error('规则目录响应无效')
      return data
    })).then(data => { cache.set(`repo:${file}`, { data, time: Date.now() }); return data }).finally(() => { controller.abort(); inFlight.delete(file) })
    inFlight.set(file, pending)
  }
  return inFlight.get(file)
}
export async function importAnimeRules(input) {
  let value = input
  if (typeof value === 'string') {
    const raw = value.trim()
    if (/^https?:\/\//i.test(raw)) value = (await axios.get(http(raw), { timeout: 16000, maxContentLength: 2 * 1024 * 1024 })).data
    else if (/^[a-z]+:\/\//i.test(raw)) value = JSON.parse(Buffer.from(decodeURIComponent(raw.slice(raw.indexOf('://') + 3)), 'base64').toString('utf8'))
    else value = JSON.parse(raw)
  }
  if (typeof value === 'string') value = JSON.parse(value)
  const entries = Array.isArray(value) ? value : [value]
  if (!entries.length || entries.length > 200) throw Error('一次请导入 1 至 200 个规则')
  const normalized = entries.map(normalizeAnimeRule), next = new Map(load().map(rule => [rule.id, rule]))
  normalized.forEach(rule => next.set(rule.id, rule)); persist([...next.values()])
  state().removed = (state().removed || []).filter(id => !normalized.some(rule => rule.id === id)); saveState()
  return normalized
}
export function registerAnimeSourceRuleIPC() {
  const handle = (channel, handler) => ipcMain.handle(channel, async (event, payload = {}) => { try { return await handler(payload, event) } catch (error) { return { success: false, message: error.message || '操作失败' } } })
  handle('anime:rule-sources', animeSourceRules)
  handle('anime:rule-save', async rule => ({ success: true, data: (await importAnimeRules(rule))[0] }))
  handle('anime:rule-import', async ({ input }) => ({ success: true, data: await importAnimeRules(input) }))
  handle('anime:rule-delete', id => { persist(load().filter(rule => rule.id !== id)); state().removed = [...new Set([...(state().removed || []), id])]; saveState(); return { success: true } })
  handle('anime:rule-restore', async () => ({ success: true, data: await importAnimeRules(bundledRules) }))
  handle('anime:rule-search', async ({ source, keyword }) => ({ success: true, data: await searchAnimeRule(source, String(keyword || '').trim()) }))
  handle('anime:rule-health', async ({ source }) => ({ success: true, data: await checkAnimeRule(source) }))
  handle('anime:rule-detail', async ({ source, id }) => ({ success: true, data: await detailAnimeRule(source, id) }))
  handle('anime:rule-play', ({ source, episodeUrl }, event) => playAnimeRule(source, episodeUrl, event.sender.id))
  handle('anime:rule-cancel', (_, event) => { const owner = event.sender.id; playRequests.set(owner, (playRequests.get(owner) || 0) + 1); tasks.get(owner)?.cancel(); return { success: true } })
  handle('anime:rule-catalog', async ({ refresh }) => {
    const local = bundledRules.map(rule => ({ name: rule.sourceFile || rule.name, version: rule.version, builtin: true, author: rule.author || '' }))
    if (!refresh) return { success: true, data: local, meta: { bundled: true } }
    try { return { success: true, data: await repository('index.json'), meta: { bundled: false } } }
    catch { return { success: true, data: local, meta: { bundled: true, warning: '在线更新暂时不可达，内置源仍可使用。' } } }
  })
  handle('anime:rule-install', async ({ name }) => {
    if (!name || /[\\/]/.test(name)) throw Error('规则名称无效')
    let value
    try { value = await repository(`${name}.json`) } catch { value = bundledRules.find(rule => (rule.sourceFile || rule.name) === name); if (!value) throw Error('无法更新此源，请稍后重试') }
    return { success: true, data: (await importAnimeRules(value))[0] }
  })
  handle('anime:rule-verify', ({ source }) => { const rule = ruleFor(source), window = new BrowserWindow({ width: 1000, height: 730, title: '动漫源 · 站点验证', webPreferences: { session: siteSession(rule), nodeIntegration: false, contextIsolation: true, sandbox: true } }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.loadURL(rule.baseUrl, { userAgent: rule.userAgent || UA }).catch(() => {}); return { success: true } })
  handle('anime:source-discovery', ({ kind, offset, refresh }) => discoverAnimeCatalog(kind, offset, refresh))
  app.once('before-quit', () => { for (const task of tasks.values()) task.cancel(); parser?.destroy() })
}
