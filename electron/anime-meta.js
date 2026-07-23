// electron/anime-meta.js
// Bangumi API 元信息聚合（仅用 Bangumi，不用 AniList）
// 提供：标题、封面、简介、评分、标签、Cast、相关推荐
//
// 稳定性优化（解决"时好时坏"）：
// 1) 每个 HTTP 请求带 3 次重试 + 指数退避；429/5xx 单独加重退避
// 2) 限流间隔提升到 800ms（贴近 Bangumi 匿名用户 ~1 rps 上限）
// 3) 命中结果持久化到磁盘缓存，断网/失败时仍可返回历史数据
import { ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

const BGM_BASE = 'https://api.bgm.tv'
const UA = 'mingyuntime/anime (https://github.com/xiaomingky/MingYunTime)'

const bgmClient = axios.create({
  baseURL: BGM_BASE,
  timeout: 30000,
  headers: {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip'
  },
  validateStatus: () => true
})

// ===== 内存缓存 1 小时 =====
const metaCache = new Map()
const CACHE_TTL = 60 * 60 * 1000

function getCached(key) {
  const item = metaCache.get(key)
  if (!item) return null
  if (Date.now() > item.expireAt) {
    metaCache.delete(key)
    return null
  }
  return item.data
}

function setCached(key, data) {
  metaCache.set(key, { data, expireAt: Date.now() + CACHE_TTL })
}

// ===== 持久化磁盘缓存（仅命中结果，断网时仍可用） =====
let diskCachePath = ''
let diskCache = null
function loadDiskCache() {
  if (diskCache) return diskCache
  try {
    diskCachePath = path.join(app.getPath('userData'), 'bangumi-cache.json')
    if (fs.existsSync(diskCachePath)) {
      diskCache = JSON.parse(fs.readFileSync(diskCachePath, 'utf8'))
    } else {
      diskCache = {}
    }
  } catch (e) {
    diskCache = {}
  }
  return diskCache
}

function saveDiskCache() {
  try {
    if (!diskCachePath) loadDiskCache()
    fs.writeFileSync(diskCachePath, JSON.stringify(diskCache), 'utf8')
  } catch (e) {
    console.error('[AnimeMeta] 磁盘缓存写入失败:', e.message)
  }
}

function getDiskCached(key) {
  const c = loadDiskCache()
  const item = c[key]
  if (!item) return null
  // 磁盘缓存 7 天有效；过期仍保留作降级，但下次重新拉取
  if (Date.now() > item.expireAt) return null
  return item.data
}

function setDiskCached(key, data) {
  const c = loadDiskCache()
  c[key] = { data, expireAt: Date.now() + 7 * 24 * 60 * 60 * 1000, ts: Date.now() }
  saveDiskCache()
}

// ===== 限流（800ms + 抖动，避免触发 Bangumi 429） =====
let lastRequestTime = 0
async function throttle() {
  const minGap = 800 + Math.random() * 200 // 800-1000ms 抖动
  const now = Date.now()
  const delta = now - lastRequestTime
  if (delta < minGap) await new Promise(r => setTimeout(r, minGap - delta))
  lastRequestTime = Date.now()
}

// ===== 带重试的请求（3 次，指数退避；429/5xx 单独处理） =====
async function requestWithRetry(fn, label = '') {
  const MAX_RETRY = 3
  let lastErr = null
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fn()
      // Bangumi 429/503 需要长退避
      if (res?.status === 429 || res?.status === 503) {
        const wait = 2000 * attempt + Math.random() * 1000
        console.warn(`[AnimeMeta] ${label} 收到 ${res.status}，第 ${attempt} 次重试，等待 ${Math.round(wait)}ms`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      const wait = 500 * Math.pow(2, attempt - 1) + Math.random() * 300
      console.warn(`[AnimeMeta] ${label} 请求异常: ${e.message}，第 ${attempt} 次重试，等待 ${Math.round(wait)}ms`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr || new Error(`${label} 重试 ${MAX_RETRY} 次后仍失败`)
}

// 字符串归一化：去除空格/标点/符号，小写，去除季/期/部等干扰后缀
function normalizeStr(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .replace(/[\s\u3000\u00a0]+/g, '')
    .replace(/[[:\-_·.,!！?？:：;；()（）\[\]【】""''`'"]+/g, '')
    // 去除 第N季/第N期/第N部/第N章
    .replace(/第[一二三四五六七八九十百0-9]+[季期部章]/g, '')
    // 去除 N季/N期/N部（1季/2期/3部）
    .replace(/[0-9]+[季期部]/g, '')
    // 去除 上半/下半/上期/下期/前篇/后篇/前篇/后篇
    .replace(/(上半|下半|上期|下期|前篇|后篇|前传|后传|新|旧)/g, '')
    // 去除 简体/繁体/中字/国语/日语/字幕 等标注
    .replace(/(简体|繁体|中字|国语|日语|字幕|高清|蓝光|web|dvd|bd)/g, '')
}

// 标题相似度：0-1，1=完全一致
function titleSimilarity(a, b) {
  const na = normalizeStr(a)
  const nb = normalizeStr(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  // 包含关系给 0.8
  if (na.includes(nb) || nb.includes(na)) return 0.85
  // 编辑距离（Levenshtein）
  const len = Math.max(na.length, nb.length)
  const dist = levenshtein(na, nb)
  return 1 - dist / len
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

// 从标题中提取季数（第N季/N季/第N期/Ⅱ/Ⅲ/Season N/S2 等）
const CN_NUM_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
const ROMAN_MAP = { 'ⅰ': 1, 'ⅱ': 2, 'ⅲ': 3, 'ⅳ': 4, 'ⅴ': 5, 'ⅵ': 6, 'ⅶ': 7, 'ⅷ': 8, 'ⅸ': 9, 'ⅹ': 10, 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10 }

function extractSeason(s) {
  if (!s) return null
  const str = String(s)
  let m = str.match(/第([一二三四五六七八九十百0-9]+)[季期部章]/)
  if (m) {
    const n = CN_NUM_MAP[m[1]] || parseInt(m[1], 10)
    if (n) return n
  }
  m = str.match(/([0-9]+)[季期部]/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n) return n
  }
  m = str.match(/season\s*([0-9]+)/i) || str.match(/\bs\s*([0-9]+)\b/i)
  if (m) return parseInt(m[1], 10)
  for (const k in ROMAN_MAP) {
    if (str.includes(k)) return ROMAN_MAP[k]
  }
  m = str.match(/([0-9])\s*$/)
  if (m) return parseInt(m[1], 10)
  return null
}

// 搜索番剧条目（带相似度匹配，避免重名作品错误匹配）
async function searchSubject(keyword) {
  let result = await doSearch(keyword, 0.5)
  if (result) return result

  const normalized = normalizeStr(keyword)
  if (normalized && normalized !== keyword.toLowerCase().replace(/\s+/g, '')) {
    const cleanKeyword = normalized.slice(0, 12)
    if (cleanKeyword.length >= 2) {
      result = await doSearch(cleanKeyword, 0.4)
      if (result) return result
    }
  }
  return null
}

// 实际执行搜索 + 匹配
async function doSearch(keyword, threshold) {
  await throttle()
  let candidates = []
  try {
    const res = await requestWithRetry(() => bgmClient.post('/v0/search/subjects', {
      keyword,
      filter: { type: [2] }
    }), 'search-subjects-v0')
    if (res.status === 200 && res.data?.data?.length > 0) {
      candidates = res.data.data
    }
  } catch (e) {
    console.error('[AnimeMeta] Bangumi搜索失败:', e.message)
  }
  // 备用搜索接口（v1，老接口，仅作兜底；单次尝试，不重试，避免拖慢整体响应）
  if (candidates.length === 0) {
    try {
      await throttle()
      const res = await bgmClient.get(`/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=large`, { timeout: 12000 })
      if (res.status === 200 && res.data?.list?.length > 0) {
        candidates = res.data.list
      }
    } catch (e) {
      console.error('[AnimeMeta] Bangumi备用搜索失败:', e.message)
    }
  }
  if (candidates.length === 0) return null

  const origSeason = extractSeason(keyword)
  const scored = candidates.map(item => {
    const bgmTitle = item.name_cn || item.name || ''
    const bgmOriginal = item.name || ''
    const simCn = titleSimilarity(keyword, bgmTitle)
    const simOrig = titleSimilarity(keyword, bgmOriginal)
    let bestSim = Math.max(simCn, simOrig)
    if (origSeason !== null) {
      const bgmSeason = extractSeason(bgmTitle) || extractSeason(bgmOriginal)
      if (bgmSeason === origSeason) {
        bestSim += 0.15
      } else if (bgmSeason !== null && bgmSeason !== origSeason) {
        bestSim -= 0.4
      }
    }
    return { item, sim: bestSim, bgmTitle, bgmOriginal, bgmSeason: extractSeason(bgmTitle) || extractSeason(bgmOriginal) }
  })
  scored.sort((a, b) => b.sim - a.sim)

  const best = scored[0]
  console.log(`[AnimeMeta] 候选 TOP3 for "${keyword}" (origSeason=${origSeason}):`)
  scored.slice(0, 3).forEach((s, i) => {
    console.log(`  #${i + 1} sim=${s.sim.toFixed(2)} season=${s.bgmSeason} title="${s.bgmTitle}"`)
  })
  if (best.sim < threshold) {
    console.log(`[AnimeMeta] 标题不匹配: "${keyword}" vs "${best.bgmTitle}" (sim=${best.sim.toFixed(2)}, threshold=${threshold})`)
    return null
  }
  console.log(`[AnimeMeta] 匹配: "${keyword}" -> "${best.bgmTitle}" (sim=${best.sim.toFixed(2)})`)
  return best.item
}

async function getSubject(id) {
  await throttle()
  try {
    const res = await requestWithRetry(() => bgmClient.get(`/v0/subjects/${id}`), 'get-subject')
    if (res.status === 200) return res.data
  } catch (e) {
    console.error('[AnimeMeta] 详情失败:', e.message)
  }
  return null
}

async function getCharacters(id) {
  await throttle()
  try {
    const res = await requestWithRetry(() => bgmClient.get(`/v0/subjects/${id}/characters`), 'get-characters')
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data
        .filter(c => c.type === 1 || c.type === 2 || c.type === 3)
        .sort((a, b) => (a.type || 9) - (b.type || 9))
        .slice(0, 24)
        .map(c => ({
          id: c.id,
          name: c.name,
          relation: c.relation,
          type: c.type,
          cover: c.images?.large || ''
        }))
    }
  } catch (e) {
    console.error('[AnimeMeta] 角色失败:', e.message)
  }
  return []
}

async function getPersons(id) {
  await throttle()
  try {
    const res = await requestWithRetry(() => bgmClient.get(`/v0/subjects/${id}/persons`), 'get-persons')
    if (res.status === 200 && Array.isArray(res.data)) {
      const priority = ['原作', '导演', '总导演', '副导演', '系列构成', '脚本', '人物设定', '总作画监督', '作画监督', '机械设定', '美术监督', '色彩设计', '摄影监督', '音响监督', '音乐', '音乐制作', '动画制作', '制片', '制片人', '企画', '系列监督', '监督']
      return res.data
        .map(p => ({ id: p.id, name: p.name, relation: p.relation }))
        .sort((a, b) => {
          const ia = priority.indexOf(a.relation)
          const ib = priority.indexOf(b.relation)
          if (ia === -1 && ib === -1) return 0
          if (ia === -1) return 1
          if (ib === -1) return -1
          return ia - ib
        })
    }
  } catch (e) {
    console.error('[AnimeMeta] 制作人员失败:', e.message)
  }
  return []
}

async function getRelated(id) {
  await throttle()
  try {
    const res = await requestWithRetry(() => bgmClient.get(`/v0/subjects/${id}/subjects`), 'get-related')
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data
        .filter(s => s.type === 2 || s.relation === '续集' || s.relation === '前传' || s.relation === '衍生')
        .slice(0, 12)
        .map(s => ({
          id: s.id,
          name: s.name,
          name_cn: s.name_cn || s.name,
          cover: s.images?.large || '',
          score: s.rating?.score || 0,
          relation: s.relation
        }))
    }
  } catch (e) {
    console.error('[AnimeMeta] 关联失败:', e.message)
  }
  return []
}

// ===== IPC Handler =====
ipcMain.handle('anime:meta:search', async (_, { title }) => {
  try {
    if (!title) return { success: false, message: '标题为空' }
    const cacheKey = `meta:${title}`
    // 1. 内存缓存
    const mem = getCached(cacheKey)
    if (mem) return { success: true, data: mem, cached: true }
    // 2. 磁盘缓存（断网/失败也能用）
    const disk = getDiskCached(cacheKey)
    if (disk) {
      setCached(cacheKey, disk) // 回填内存
      // 后台静默刷新（不阻塞）
      refreshMetaInBackground(title, cacheKey)
      return { success: true, data: disk, cached: true }
    }

    const subject = await searchSubject(title)
    if (!subject) return { success: false, message: '未找到 Bangumi 条目' }

    const bgmId = subject.id
    const [detail, characters, staff] = await Promise.all([
      getSubject(bgmId),
      getCharacters(bgmId),
      getPersons(bgmId)
    ])

    const meta = {
      id: bgmId,
      title: detail?.name_cn || detail?.name || subject.name_cn || subject.name || title,
      titleOriginal: detail?.name || subject.name || '',
      cover: detail?.images?.large || subject.images?.large || subject.cover || '',
      summary: detail?.summary || subject.summary || '',
      score: detail?.rating?.score || subject.rating?.score || 0,
      scoreCount: detail?.rating?.total || subject.rating?.total || 0,
      tags: (detail?.tags || subject.tags || []).slice(0, 12).map(t => ({
        name: t.name,
        count: t.count
      })),
      infobox: detail?.infobox || [],
      date: detail?.date || '',
      characters,
      staff
    }

    setCached(cacheKey, meta)
    setDiskCached(cacheKey, meta)
    return { success: true, data: meta }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// 后台静默刷新（命中磁盘缓存时调用，更新数据但不阻塞 UI）
let refreshLock = new Set()
async function refreshMetaInBackground(title, cacheKey) {
  if (refreshLock.has(cacheKey)) return
  refreshLock.add(cacheKey)
  try {
    const subject = await searchSubject(title)
    if (!subject) return
    const bgmId = subject.id
    const [detail, characters, staff] = await Promise.all([
      getSubject(bgmId),
      getCharacters(bgmId),
      getPersons(bgmId)
    ])
    const meta = {
      id: bgmId,
      title: detail?.name_cn || detail?.name || subject.name_cn || subject.name || title,
      titleOriginal: detail?.name || subject.name || '',
      cover: detail?.images?.large || subject.images?.large || subject.cover || '',
      summary: detail?.summary || subject.summary || '',
      score: detail?.rating?.score || subject.rating?.score || 0,
      scoreCount: detail?.rating?.total || subject.rating?.total || 0,
      tags: (detail?.tags || subject.tags || []).slice(0, 12).map(t => ({ name: t.name, count: t.count })),
      infobox: detail?.infobox || [],
      date: detail?.date || '',
      characters,
      staff
    }
    setCached(cacheKey, meta)
    setDiskCached(cacheKey, meta)
    console.log(`[AnimeMeta] 后台刷新完成: ${title}`)
  } catch (e) {
    console.warn(`[AnimeMeta] 后台刷新失败: ${e.message}`)
  } finally {
    refreshLock.delete(cacheKey)
  }
}

ipcMain.handle('anime:meta:related', async (_, { bgmId }) => {
  try {
    if (!bgmId) return { success: false, message: 'bgmId 为空' }
    const cacheKey = `related:${bgmId}`
    const mem = getCached(cacheKey)
    if (mem) return { success: true, data: mem, cached: true }
    const disk = getDiskCached(cacheKey)
    if (disk) {
      setCached(cacheKey, disk)
      return { success: true, data: disk, cached: true }
    }

    const related = await getRelated(bgmId)
    setCached(cacheKey, related)
    setDiskCached(cacheKey, related)
    return { success: true, data: related }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

console.log('[AnimeMeta] 模块已加载（Bangumi API，含重试+持久缓存）')
