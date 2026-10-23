import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import snapshot from './anime-source-snapshot.js'

const MIRROR = 'https://api.kazumi.fyi'
const headers = { 'User-Agent': 'MingYunTime/4.0.2 (https://github.com/xiaomingky/MingYunTime)' }
const memory = new Map(), pending = new Map()
const archivedSubjects = new Map(Object.values(snapshot.timeline).flatMap(day => day).map(entry => entry.subject || entry).map(item => [String(item.id), item]))
let loaded = false
const cachePath = () => path.join(app.getPath('userData'), 'anime-source-catalog.json')

export function catalogCard(entry) {
  const current = entry.subject || entry
  const item = { ...archivedSubjects.get(String(current.id)), ...current }
  return {
    id: String(item.id), title: item.name_cn || item.nameCN || item.name || '', originalTitle: item.name || '',
    cover: item.images?.common || item.images?.large || item.images?.medium || item.image || '',
    desc: item.summary || item.info || '', score: item.rating?.score || item.score || 0,
    tags: [...new Set((item.tags || item.metaTags || []).map(tag => typeof tag === 'string' ? tag : tag.name).filter(Boolean))].slice(0, 12),
    rank: Number(item.rating?.rank || 0), ratingCount: Number(item.rating?.total || 0),
    episodeCount: Number(item.eps || item.total_episodes || (item.info || '').match(/^(\d+)话/)?.[1] || 0),
    year: item.date || item.air_date || (item.info || '').match(/\d{4}年\d{1,2}月\d{1,2}日/)?.[0] || '', source: 'catalog'
  }
}
export function normalizeCatalog(raw, kind) {
  if (kind === 'timeline') {
    if (Array.isArray(raw)) return raw.map(day => ({ weekday: day.weekday.id, name: day.weekday.cn, items: (day.items || []).map(catalogCard) }))
    return Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, name: `周${'一二三四五六日'[index]}`, items: (raw[String(index + 1)] || []).map(catalogCard) }))
  }
  return (Array.isArray(raw) ? raw : raw.data || []).map(catalogCard).filter(item => item.id && item.title)
}
function loadCache() {
  if (loaded) return
  loaded = true
  try {
    const archived = new Map([...normalizeCatalog(snapshot.popular, 'popular'), ...normalizeCatalog(snapshot.timeline, 'timeline').flatMap(day => day.items)].map(item => [item.id, item]))
    const enrich = item => ({ ...archived.get(item.id), ...item, tags: item.tags || archived.get(item.id)?.tags || [] })
    for (const [key, entry] of Object.entries(JSON.parse(fs.readFileSync(cachePath(), 'utf8')))) {
      if (Array.isArray(entry.data)) memory.set(key, { ...entry, data: entry.data.map(item => item.items ? { ...item, items: item.items.map(enrich) } : enrich(item)) })
    }
  } catch {}
}
function persist() {
  try { fs.mkdirSync(path.dirname(cachePath()), { recursive: true }); fs.writeFileSync(cachePath(), JSON.stringify(Object.fromEntries([...memory].slice(-24))), 'utf8') } catch {}
}
// Race independent catalogue providers. Cancel slower requests, including delayed ones.
// A blocked provider must not keep the entire page waiting for its timeout.
async function firstAvailable(candidates, kind) {
  const controller = new AbortController()
  try {
    return await Promise.any(candidates.map(async (spec, index) => {
      if (index) await new Promise(resolve => setTimeout(resolve, index * 200))
      if (controller.signal.aborted) throw Error('cancelled')
      const response = await axios({ ...spec, headers, timeout: 6500, signal: controller.signal, maxContentLength: 4 * 1024 * 1024 })
      const data = normalizeCatalog(response.data, kind)
      if (!data.length || (kind === 'timeline' && !data.some(day => day.items.length))) throw Error('empty catalogue')
      return { data, provider: new URL(spec.url).hostname, time: Date.now() }
    }))
  } finally { controller.abort() }
}
export async function discoverAnimeCatalog(kind = 'popular', offset = 0, refresh = false) {
  kind = kind === 'timeline' ? 'timeline' : 'popular'
  offset = kind === 'timeline' ? 0 : Math.max(0, Math.min(10000, Number(offset) || 0))
  loadCache()
  const now = new Date(), quarter = Math.floor(now.getMonth() / 3) * 3
  const start = `${now.getFullYear()}-${String(quarter + 1).padStart(2, '0')}-01`
  const endDate = new Date(now.getFullYear(), quarter + 3, 1)
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`
  const key = `${kind}:${kind === 'timeline' ? start : offset}`
  let cached = memory.get(key)
  if (!cached && offset === 0) {
    cached = { data: normalizeCatalog(kind === 'timeline' ? snapshot.timeline : snapshot.popular, kind), provider: 'snapshot', time: new Date(snapshot.updatedAt).getTime() }
  }
  if (cached && (!refresh || (cached.provider !== 'snapshot' && Date.now() - cached.time < 300000))) {
    return { success: true, data: cached.data, meta: { cached: true, updatedAt: cached.time, needsRefresh: cached.provider === 'snapshot' || Date.now() - cached.time >= 300000 } }
  }
  if (!pending.has(key)) {
    const candidates = kind === 'timeline' ? [
      { url: `${MIRROR}/kazumi/v1/calendar/season`, params: { start, end } },
      { url: 'https://next.bgm.tv/p1/calendar' },
      { url: 'https://api.bgm.tv/calendar' }
    ] : [
      { url: `${MIRROR}/kazumi/v1/popular/subjects`, params: { limit: 24, offset } },
      { url: 'https://next.bgm.tv/p1/trending/subjects', params: { type: 2, limit: 24, offset } },
      { method: 'POST', url: 'https://api.bgm.tv/v0/search/subjects', params: { limit: 24, offset }, data: { keyword: '', sort: 'heat', filter: { type: [2], nsfw: false } } }
    ]
    pending.set(key, firstAvailable(candidates, kind).then(entry => { memory.set(key, entry); persist(); return entry }).finally(() => pending.delete(key)))
  }
  try {
    const entry = await pending.get(key)
    return { success: true, data: entry.data, meta: { cached: false, updatedAt: entry.time } }
  } catch {
    if (cached) return { success: true, data: cached.data, meta: { cached: true, updatedAt: cached.time, warning: '在线目录暂时不可达，正在显示已保存的目录；搜索和播放源仍可单独使用。' } }
    return { success: false, message: '暂时无法加载更多番剧，请稍后重试；仍可直接搜索已内置的播放源。' }
  }
}
