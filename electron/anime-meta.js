// electron/anime-meta.js
// Bangumi API 元信息聚合（仅用 Bangumi，不用 AniList）
// 提供：标题、封面、简介、评分、标签、Cast、相关推荐
import { ipcMain } from 'electron'
import axios from 'axios'

const BGM_BASE = 'https://api.bgm.tv'
const UA = 'mingyuntime/anime (https://github.com/xiaomingky/MingYunTime)'

const bgmClient = axios.create({
  baseURL: BGM_BASE,
  timeout: 15000,
  headers: {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip'
  },
  validateStatus: () => true
})

// 内存缓存 1 小时
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

// 简单限流间隔
let lastRequestTime = 0
async function throttle() {
  const now = Date.now()
  const delta = now - lastRequestTime
  if (delta < 300) await new Promise(r => setTimeout(r, 300 - delta))
  lastRequestTime = Date.now()
}

// 字符串归一化：去除空格/标点/符号，小写
function normalizeStr(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[\s\u3000\u00a0]+/g, '').replace(/[[:\-_·.,!！?？:：;；()（）\[\]【】""''`'"]+/g, '').replace(/第[一二三四五六七八九十0-9]+季/g, '')
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

// 搜索番剧条目（带相似度匹配，避免重名作品错误匹配）
async function searchSubject(keyword) {
  await throttle()
  let candidates = []
  try {
    const res = await bgmClient.post('/v0/search/subjects', {
      keyword,
      filter: { type: [2] } // 2 = 动画
    })
    if (res.status === 200 && res.data?.data?.length > 0) {
      candidates = res.data.data
    }
  } catch (e) {
    console.error('[AnimeMeta] Bangumi搜索失败:', e.message)
  }
  // 备用搜索接口
  if (candidates.length === 0) {
    try {
      await throttle()
      const res = await bgmClient.get(`/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=large`)
      if (res.status === 200 && res.data?.list?.length > 0) {
        candidates = res.data.list
      }
    } catch (e) {
      console.error('[AnimeMeta] Bangumi备用搜索失败:', e.message)
    }
  }
  if (candidates.length === 0) return null

  // 计算每个候选项的相似度（优先匹配 name_cn，其次 name）
  const scored = candidates.map(item => {
    const bgmTitle = item.name_cn || item.name || ''
    const bgmOriginal = item.name || ''
    const simCn = titleSimilarity(keyword, bgmTitle)
    const simOrig = titleSimilarity(keyword, bgmOriginal)
    const bestSim = Math.max(simCn, simOrig)
    return { item, sim: bestSim, bgmTitle, bgmOriginal }
  })
  scored.sort((a, b) => b.sim - a.sim)

  const best = scored[0]
  // 阈值：相似度 < 0.5 视为不匹配（避免不相干作品）
  if (best.sim < 0.5) {
    console.log(`[AnimeMeta] 标题不匹配: "${keyword}" vs "${best.bgmTitle}" (sim=${best.sim.toFixed(2)})`)
    return null
  }
  console.log(`[AnimeMeta] 匹配: "${keyword}" -> "${best.bgmTitle}" (sim=${best.sim.toFixed(2)})`)
  return best.item
}

// 获取详情
async function getSubject(id) {
  await throttle()
  try {
    const res = await bgmClient.get(`/v0/subjects/${id}`)
    if (res.status === 200) return res.data
  } catch (e) {
    console.error('[AnimeMeta] 详情失败:', e.message)
  }
  return null
}

// 获取角色
async function getCharacters(id) {
  await throttle()
  try {
    const res = await bgmClient.get(`/v0/subjects/${id}/characters`)
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data
        .filter(c => c.type === 1) // 1 = 主角
        .slice(0, 8)
        .map(c => ({
          id: c.id,
          name: c.name,
          relation: c.relation,
          cover: c.images?.large || ''
        }))
    }
  } catch (e) {
    console.error('[AnimeMeta] 角色失败:', e.message)
  }
  return []
}

// 获取制作人员
async function getPersons(id) {
  await throttle()
  try {
    const res = await bgmClient.get(`/v0/subjects/${id}/persons`)
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data
        .filter(p => ['原作', '导演', '脚本', '音乐', '动画制作'].includes(p.relation))
        .slice(0, 10)
        .map(p => ({
          id: p.id,
          name: p.name,
          relation: p.relation
        }))
    }
  } catch (e) {
    console.error('[AnimeMeta] 制作人员失败:', e.message)
  }
  return []
}

// 获取关联作品（相关推荐）
async function getRelated(id) {
  await throttle()
  try {
    const res = await bgmClient.get(`/v0/subjects/${id}/subjects`)
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
    const cached = getCached(cacheKey)
    if (cached) return { success: true, data: cached, cached: true }

    // 1. 搜索条目
    const subject = await searchSubject(title)
    if (!subject) return { success: false, message: '未找到 Bangumi 条目' }

    const bgmId = subject.id
    // 2. 并发拉取详情/角色/制作人员
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
    return { success: true, data: meta }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('anime:meta:related', async (_, { bgmId }) => {
  try {
    if (!bgmId) return { success: false, message: 'bgmId 为空' }
    const cacheKey = `related:${bgmId}`
    const cached = getCached(cacheKey)
    if (cached) return { success: true, data: cached, cached: true }

    const related = await getRelated(bgmId)
    setCached(cacheKey, related)
    return { success: true, data: related }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

console.log('[AnimeMeta] 模块已加载（Bangumi API）')
