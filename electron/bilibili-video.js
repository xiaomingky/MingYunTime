// electron/bilibili-video.js
// B站视频专区 - 主进程 IPC 处理器（独立于影视区，仿B站官方首页/详情页）
// 首页：推荐(综合热门 popular 翻页) / 分区排行(ranking/v2 缓存分页，统计数据完整) + 排行榜
// 搜索：wbi search/type 翻页（Web 登录 Cookie 优先，游客 buvid cookie 兜底）
//       type=video 普通视频 / bangumi 番剧(media_bangumi) / movie 电影(media_ft)
// 详情：view(视频+UP主+分P) + card(粉丝数) + related(相关推荐)
//       PGC 分集 BV 自动识别（redirect_url）转季详情(pgc/view/web/season，含分集列表)
// 评论：x/v2/reply/main 主楼翻页 + x/v2/reply/reply 子楼展开（含等级/大会员/粉丝牌/UP徽章）
// 播放：复用 main.js 的 bilibili:anime-playurl（TV 接口 DASH，无水印，登录解锁 1080P+）
//       PGC 回退 bilibili:video-pgc-playurl（pgc/player/web/playurl）
// 弹幕：复用 bilibili:anime-danmaku
import { ipcMain, app } from 'electron'
import axios from 'axios'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 分区 → rid 映射（B站官方顶部分区栏）
const BILI_REGIONS = {
  '动画': 1, '番剧': 13, '国创': 167, '音乐': 3, '舞蹈': 129, '游戏': 4,
  '知识': 36, '数码': 188, '生活': 160, '美食': 211, '动物': 217,
  '鬼畜': 119, '时尚': 155, '娱乐': 5, '影视': 181
}

// WBI 签名混淆表（与 main.js 一致）
const BILI_MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
let biliWbiCache = { key: '', ts: 0 }
let biliGuestCookieCache = { cookie: '', ts: 0 }

// Web 登录 Cookie（与 main.js 网址解析的「B站登录」共用 bilibili-cookie.json，登录后搜索/收藏夹可用）
const BILI_COOKIE_FILE = () => path.join(app.getPath('userData'), 'bilibili-cookie.json')
function biliWebCookie() {
  try {
    const raw = fs.readFileSync(BILI_COOKIE_FILE(), 'utf8')
    const data = JSON.parse(raw)
    // 与 main.js loadBiliCookie 相同的 30 天过期判断
    if (data.savedAt && Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) return ''
    const cookies = data.cookies
    if (!cookies || !cookies.SESSDATA) return ''
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  } catch (e) { return '' }
}

// 请求 Cookie：Web 登录 Cookie 优先，游客 buvid 兜底
async function biliRequestCookie() {
  const web = biliWebCookie()
  if (web) return web
  return biliGuestCookie()
}

// B站 API 统一请求（自动携带 Cookie，风控/未登录时刷新游客 Cookie 重试一次）
async function biliApiGet(url, params = {}) {
  const doReq = (ck) => axios.get(url, {
    params,
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.bilibili.com/',
      ...(ck ? { Cookie: ck } : {})
    },
    timeout: 15000,
    validateStatus: () => true
  })
  let cookie = await biliRequestCookie()
  const res = await doReq(cookie)
  if (res.data && res.data.code === 0) return res.data
  const errCode = res.data?.code
  // 风控(-412/-799/-352) 或未登录(-101)：游客模式刷新 buvid 重试一次；已 Web 登录则提示登录态问题
  if ([-412, -799, -352, -101].includes(errCode)) {
    if (!biliWebCookie()) {
      biliGuestCookieCache = { cookie: '', ts: 0 }
      const res2 = await doReq(await biliGuestCookie())
      if (res2.data && res2.data.code === 0) return res2.data
    }
    if (errCode === -101) throw new Error('该接口需要登录B站账号，请点击右上角「B站登录」')
    throw new Error(res.data?.message || `B站接口风控(${errCode})，请稍后再试`)
  }
  throw new Error(res.data?.message || `B站接口错误 ${errCode ?? res.status}`)
}

// 游客 Cookie（buvid3/buvid4，搜索等接口防风控）：
// 官方 finger/spi 接口直接返回 b_3/b_4，比抓首页 Set-Cookie 稳定；缓存 1 小时
async function biliGuestCookie() {
  if (biliGuestCookieCache.cookie && Date.now() - biliGuestCookieCache.ts < 3600 * 1000) {
    return biliGuestCookieCache.cookie
  }
  try {
    const res = await axios.get('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/' },
      timeout: 10000,
      validateStatus: () => true
    })
    if (res.data?.code === 0 && res.data.data?.b_3) {
      const parts = [`buvid3=${res.data.data.b_3}`]
      if (res.data.data.b_4) parts.push(`buvid4=${res.data.data.b_4}`)
      biliGuestCookieCache = { cookie: parts.join('; '), ts: Date.now() }
    }
  } catch (e) { /* 网络失败时降级为无 cookie */ }
  return biliGuestCookieCache.cookie || ''
}

// WBI mixin key（nav 接口获取，无需登录），缓存 1 小时
async function biliWbiKey() {
  if (biliWbiCache.key && Date.now() - biliWbiCache.ts < 3600 * 1000) return biliWbiCache.key
  const r = await biliApiGet('https://api.bilibili.com/x/web-interface/nav')
  const wbi = r?.data?.wbi_img
  if (!wbi) return ''
  const fileNameKey = (u) => {
    const base = String(u || '').split('?')[0]
    const m = base.match(/\/([\w-]+)\.(?:png|jpg|webp)$/i)
    return m ? m[1] : ''
  }
  const raw = fileNameKey(wbi.img_url) + fileNameKey(wbi.sub_url)
  let mixin = ''
  for (const i of BILI_MIXIN_TAB) mixin += raw[i] || ''
  biliWbiCache = { key: mixin.slice(0, 32), ts: Date.now() }
  return biliWbiCache.key
}

// 对参数应用 WBI 签名（搜索/分区动态接口需要）
function biliWbiSign(params, mixin) {
  if (!mixin) return { ...params }
  const wts = Math.round(Date.now() / 1000)
  const merged = { ...params, wts }
  const keys = Object.keys(merged).sort()
  let q = ''
  for (const k of keys) q += `${k}=${encodeURIComponent(merged[k])}&`
  q = q.slice(0, -1)
  return { ...merged, w_rid: crypto.createHash('md5').update(q + mixin).digest('hex') }
}

// 播放量格式化（12345 → 1.2万）
function biliFormatCount(n) {
  const v = Number(n) || 0
  if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(v)
}

// 标题清洗：剥除【】包裹的前缀（项目约定），合并多余空白
function biliCleanTitle(t) {
  return String(t || '').replace(/^(\s*【[^】]*】\s*)+/, '').replace(/\s+/g, ' ').trim()
}

// 封面/头像 URL 归一化：兼容协议相对地址（//host/path）与 http:// 两种形式，统一为 https
// （协议相对地址在 file:// 渲染进程会被解析成本地文件路径，导致 ERR_FILE_NOT_FOUND）
function biliCoverUrl(u) {
  return String(u || '').replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://')
}

// 时长统一转秒：
// - 搜索/空间/合集接口返回 "MM:SS"/"H:MM:SS" 字符串（如 "15:32"）
// - 排行/详情等接口直接返回秒数
function biliDurationToSec(v) {
  if (v == null || v === '') return 0
  const s = String(v).trim()
  if (/^\d+$/.test(s)) return Number(s)
  const p = s.split(':').map(Number)
  if (p.some(Number.isNaN)) return 0
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
  if (p.length === 2) return p[0] * 60 + p[1]
  return p[0] || 0
}

// B站稿件 → 卡片结构（首页/搜索/相关推荐通用）
// 兼容三种数据源字段：分区/热门/排行(owner.stat) 、搜索(author/play/video_review) 、related(owner.stat)
function biliCard(v) {
  const stat = v.stat || {}
  const owner = v.owner || {}
  return {
    bvid: v.bvid || '',
    aid: v.aid || 0,
    title: biliCleanTitle(String(v.title || '').replace(/<[^>]+>/g, '')),
    cover: biliCoverUrl(v.pic || v.cover),
    author: owner.name || v.author || '',
    authorFace: biliCoverUrl(owner.face),
    mid: Number(v.mid) || Number(owner.mid) || 0,   // UP 主 mid（点击进主页）
    play: stat.view ?? v.play ?? 0,
    danmaku: stat.danmaku ?? v.video_review ?? 0,
    duration: biliDurationToSec(v.duration),   // 统一为秒（搜索接口是 "MM:SS" 字符串）
    pubdate: v.pubdate || 0      // 秒级时间戳
  }
}

// B站首页
// cat='推荐'：综合热门(popular pn 翻页) + 全站排行(ranking rid=0)
// 其他分区：分区排行榜数据（ranking/v2 单次返回 ~100 条，缓存 10 分钟后主进程侧分页）
// 2026-08-28 实测：newlist 返回的是刚投稿几秒的视频，播放/弹幕全是 0，观感异常，故弃用；
// ranking/v2 数据完整且免登录，翻页耗尽后回退 newlist（新投稿虽无统计但内容真实）
const biliRankCache = new Map() // rid -> { ts, list }
async function biliRegionRankList(rid) {
  const cached = biliRankCache.get(rid)
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return cached.list
  // ranking/v2 已对番剧(13)/国创(167) 等 PGC 分区返回 -400（B站下架分区排行）：
  // 静默降级为空列表，由上层走 newlist（分区最新投稿）兜底，不再把请求错误抛给前端
  const list = await biliApiGet('https://api.bilibili.com/x/web-interface/ranking/v2', { rid, type: 'all' })
    .then(r => (r?.data?.list || []).map(biliCard))
    .catch(() => [])
  biliRankCache.set(rid, { ts: Date.now(), list })
  return list
}

async function biliHome({ cat = '推荐', page = 1 }) {
  const rid = BILI_REGIONS[cat] || 0
  const list = []
  let hasMore = false
  let ranking = []
  if (rid === 0) {
    const r = await biliApiGet('https://api.bilibili.com/x/web-interface/popular', { pn: page, ps: 30 })
    const archives = r?.data?.list || []
    list.push(...archives.map(biliCard))
    hasMore = archives.length >= 30
    // 全站排行仅第一页附带
    if (page === 1) {
      const rankR = await biliApiGet('https://api.bilibili.com/x/web-interface/ranking/v2', { type: 'all' }).catch(() => null)
      ranking = (rankR?.data?.list || []).map(biliCard).slice(0, 10)
    }
  } else {
    // 分区：排行榜主列表（数据完整）分页；侧栏排行直接取前 10
    const rankList = await biliRegionRankList(rid)
    if (rankList.length) {
      const start = (page - 1) * 30
      list.push(...rankList.slice(start, start + 30))
      hasMore = start + 30 < rankList.length
      ranking = rankList.slice(0, 10)
    } else {
      // 排行接口异常时回退 newlist（最新投稿）
      const r = await biliApiGet('https://api.bilibili.com/x/web-interface/newlist', { rid, page, ps: 30 })
      const archives = r?.data?.archives || []
      list.push(...archives.map(biliCard))
      hasMore = archives.length >= 30
      // 右侧排行榜：newlist 第一页前 10（ranking/v2 已下架番剧/国创等 PGC 分区）
      if (page === 1) {
        ranking = archives.slice(0, 10).map(biliCard)
      } else {
        const r1 = await biliApiGet('https://api.bilibili.com/x/web-interface/newlist', { rid, page: 1, ps: 30 }).catch(() => null)
        ranking = ((r1?.data?.archives || []).slice(0, 10)).map(biliCard)
      }
    }
  }
  return { list, hasMore, ranking }
}

// PGC（番剧/电影）搜索卡片：media_bangumi / media_ft 结果结构
function biliPgcSearchCard(v) {
  const areas = Array.isArray(v.areas) ? v.areas.map(a => a.name || a).filter(Boolean) : []
  return {
    pgc: true,
    seasonId: v.season_id || 0,
    title: biliCleanTitle(String(v.title || '').replace(/<[^>]+>/g, '')),
    cover: biliCoverUrl(v.cover),
    styles: String(v.styles || '').split('/').map(s => s.trim()).filter(Boolean),
    areas,
    indexShow: v.index_show || '',           // 如 "已完结, 全13话" / "付费"
    mediaScore: v.media_score?.score || 0,   // 评分
    follow: v.organic_view || 0,
    seasonType: Number(v.season_type) || 0,  // 1番剧 2电影
    badge: v.badge || ''
  }
}

// B站搜索（wbi 签名 + Web 登录 Cookie / 游客 buvid）
// type: 'video'（默认普通视频）/ 'bangumi'（番剧 media_bangumi）/ 'movie'（电影 media_ft）
async function biliSearch({ keyword, page = 1, type = 'video' }) {
  const mixin = await biliWbiKey()
  const searchType = type === 'bangumi' ? 'media_bangumi' : type === 'movie' ? 'media_ft' : 'video'
  const signed = biliWbiSign({ search_type: searchType, keyword, page }, mixin)
  const r = await biliApiGet('https://api.bilibili.com/x/web-interface/wbi/search/type', signed)
  const results = (r?.data?.result || [])
  if (searchType !== 'video') {
    // 电影搜索过滤出正片电影（media_ft 混有纪录片/综艺等）；番剧搜索天然是番剧/国创
    const list = results
      .filter(item => item?.season_id && (searchType === 'media_bangumi' || Number(item.season_type) === 2))
      .map(biliPgcSearchCard)
      .filter(c => c.title && c.seasonId)
    return { list, hasMore: results.length >= 20, type: 'pgc' }
  }
  const list = results
    .filter(item => item?.bvid)
    .map(biliCard)
    .filter(c => c.title)
  return { list, hasMore: list.length >= 20, type: 'video' }
}

// PGC（番剧/电影）季详情：pgc/view/web/season（season_id 或 ep_id 均可定位）
// 返回 season 信息 + 分集列表（ep_id/bvid/cid 供 TV 取流与弹幕）
// 2026-08-28 修正：分集 duration 部分接口返回毫秒（如 1,080,000≈18分钟），
// 直接按秒显示会出现"300h"之类异常，统一在解析时归一化为秒
function biliToSec(val) {
    const n = Number(val) || 0
    return n > 99999 ? Math.round(n / 1000) : n
}
async function biliPgcDetail({ seasonId, epId }) {
  const params = seasonId ? { season_id: seasonId } : { ep_id: epId }
  const r = await biliApiGet('https://api.bilibili.com/pgc/view/web/season', params)
  const d = r?.result
  if (!d?.season_id) throw new Error('内容不存在或已下架')

  const episodes = (d.episodes || []).map((ep, i) => ({
    epId: ep.id,
    bvid: ep.bvid || '',
    aid: ep.aid || 0,
    cid: ep.cid || 0,
    title: `${i + 1}`,
    longTitle: ep.long_title || '',
    cover: biliCoverUrl(ep.cover),
    duration: biliToSec(ep.duration),
    badge: ep.badge || '',            // "会员"/"付费"/"预告"
    badgeType: ep.badge_type || 0
  }))

  const stat = d.stat || {}
  return {
    pgc: true,
    season: {
      seasonId: d.season_id,
      title: biliCleanTitle(d.title || ''),
      cover: biliCoverUrl(d.cover),
      desc: String(d.evaluate || '').trim(),
      type: d.type || 0,               // 1番剧 2电影
      typeName: d.type === 2 ? '电影' : '番剧',
      badge: d.badge || '',
      rating: d.rating?.score || 0,
      styles: (d.styles || []).map(s => s.name || s).filter(Boolean),
      areas: (d.areas || []).map(a => a.name || a).filter(Boolean),
      pubTime: d.publish?.pub_time || '',
      newEpDesc: d.new_ep?.desc || '',  // "第13话" 等
      stat: {
        view: stat.views || 0,
        danmaku: stat.danmakus || 0,
        like: stat.likes || 0,
        coin: stat.coins || 0,
        favorite: stat.favorite || 0,
        reply: stat.reply || 0,
        share: stat.share || 0
      },
      followText: stat.follow_text || ''
    },
    episodes,
    // 番剧评价（影评/短评走 reply 接口，前端评论区按 ep 的 aid 加载普通评论）
    total: episodes.length
  }
}

// B站详情：view(视频全量) + card(UP主粉丝) + related(相关推荐)
async function biliDetail({ bvid }) {
  const r = await biliApiGet('https://api.bilibili.com/x/web-interface/view', { bvid })
  const d = r?.data
  if (!d?.bvid) throw new Error('视频不存在或已失效')

  // PGC 重定向检测：番剧/电影分集的 BV 在 view 接口带 redirect_url
  // （2026-08-28 实测：BV1Q541117in → https://www.bilibili.com/bangumi/play/ep508407）
  // 普通接口链路（取流/分集）对 PGC 无效，直接改走季详情
  const pgcEpMatch = String(d.redirect_url || '').match(/\/(?:bangumi\/play|festival)\/ep(\d+)/)
  if (pgcEpMatch) {
    const pgc = await biliPgcDetail({ epId: pgcEpMatch[1] })
    return { pgc, video: null, ownerCard: null, related: [] }
  }

  // UP主粉丝数（游客可访问的 card 接口，失败不阻塞详情）
  const mid = d.owner?.mid
  const ownerCard = { fans: 0 }
  if (mid) {
    try {
      const cr = await biliApiGet('https://api.bilibili.com/x/web-interface/card', { mid, photo: false })
      ownerCard.fans = cr?.data?.follower ?? cr?.data?.card?.fans ?? 0
    } catch (e) { /* 忽略 */ }
  }

  // 相关推荐（失败不阻塞详情）
  let related = []
  try {
    const rr = await biliApiGet('https://api.bilibili.com/x/web-interface/archive/related', { bvid })
    related = (rr?.data || []).filter(v => v?.bvid).map(biliCard).slice(0, 20)
  } catch (e) { /* 忽略 */ }

  const stat = d.stat || {}
  const pages = (d.pages || []).map(p => ({
    cid: p.cid,
    page: p.page,
    part: p.part || `P${p.page}`,
    duration: p.duration || 0
  }))

  // 合集（ugc_season）：多个独立 BV 组成的系列，与分P不同；sections[].episodes[] 各自带 bvid/cid
  let season = null
  if (d.ugc_season?.sections?.length) {
    const eps = []
    for (const sec of d.ugc_season.sections) {
      for (const ep of (sec.episodes || [])) {
        if (!ep?.bvid) continue
        eps.push({
          bvid: ep.bvid,
          aid: ep.aid || 0,
          cid: ep.cid || (ep.page?.cid) || 0,
          title: biliCleanTitle(ep.page?.part || ep.title || ''),
          cover: biliCoverUrl(ep.cover),
          duration: biliToSec(ep.page?.duration || ep.arc?.duration || 0)
        })
      }
    }
    if (eps.length > 1) {
      season = {
        title: biliCleanTitle(d.ugc_season.title || ''),
        episodes: eps
      }
    }
  }

  return {
    video: {
      bvid: d.bvid,
      aid: d.aid,
      title: biliCleanTitle(d.title),
      cover: String(d.pic || '').replace(/^http:\/\//, 'https://'),
      desc: String(d.desc || '').replace(/<[^>]+>/g, '').trim(),
      duration: d.duration || 0,
      pubdate: d.pubdate || 0,
      pages,
      season,
      owner: {
        mid: d.owner?.mid || 0,
        name: d.owner?.name || '',
        face: biliCoverUrl(d.owner?.face)
      },
      stat: {
        view: stat.view || 0,
        danmaku: stat.danmaku || 0,
        like: stat.like || 0,
        coin: stat.coin || 0,
        favorite: stat.favorite || 0,
        share: stat.share || 0,
        reply: stat.reply || 0
      },
      // 登录后 view 接口附带的本账号互动状态（前端按钮初始态）
      reqUser: d.req_user ? {
        like: d.req_user.like || 0,
        coin: d.req_user.coin || 0,
        favorite: d.req_user.favorite || 0
      } : null,
      // 付费 UGC（充电专属视频）：取流必须走 Web 接口（带登录 Cookie + 已充电），TV 接口无法取
      pay: d.rights?.ugc_pay === 1 || d.rights?.charge === 1
    },
    ownerCard,
    related
  }
}

// ============================================================
// 评论（x/v2/reply，游客可读）
// ============================================================

// 评论项结构：主楼/子楼通用（member 为评论者信息，replies 为预览子楼）
// upMid：视频 UP 主 mid（比对出"UP主"徽章）；官方风格完整信息（等级/大会员/粉丝牌/UP徽章）
function biliCommentItem(r, upMid = 0) {
  const member = r.member || {}
  const vip = member.vip || {}
  const fansDetail = member.fans_detail || member.fansDetail
  return {
    rpid: r.rpid,
    mid: member.mid || r.mid || 0,
    uname: member.uname || '',
    avatar: biliCoverUrl(member.avatar),
    level: member.level_info?.current_level || 0,
    // 大会员：vipType 1 月度 / 2 年度，vipStatus 1 有效（官方显示粉色昵称+皇冠）
    vip: (Number(vip.vipStatus) === 1 && Number(vip.vipType) > 0) ? Number(vip.vipType) : 0,
    // 粉丝牌：UP 主粉丝勋章（官方显示蓝底白字牌子）
    fan: (fansDetail && fansDetail.medal_name) ? {
      name: fansDetail.medal_name,
      level: fansDetail.medal_level || 0
    } : null,
    // UP主徽章：评论者是视频作者（官方显示红色"UP"标）
    isUp: upMid && String(member.mid || r.mid) === String(upMid),
    message: String(r.content?.message || ''),
    // 图片评论：content.pictures（九图以内），前端缩略图渲染
    pictures: (r.content?.pictures || []).map(pc => ({
      url: biliCoverUrl(pc.img_src),
      w: pc.img_width || 0,
      h: pc.img_height || 0
    })),
    // B站表情表 {[key]: {url, size}}，size 1 小表情 / 2 大表情；前端按 [key] 匹配渲染成图片
    emote: r.content?.emote || null,
    // 硬核会员标识（is_senior_member=1）：LV6 评论者用 level_h.svg 加强版徽章（红 LV6 + 闪电）
    senior: Number(member.is_senior_member) === 1,
    // 个性装扮：佩戴的评论卡装扮牌（装扮商城 user_sailing.cardbg，如番剧联动勋章牌，显示在评论右侧）
    sailing: (member.user_sailing?.cardbg?.image) ? {
      name: member.user_sailing.cardbg.name || '',
      image: biliCoverUrl(member.user_sailing.cardbg.image),
      // 装扮收藏编号（官方字段：num_prefix 前缀如 "CD." + num_desc 六位序号 + color 文字色）
      numPrefix: member.user_sailing.cardbg.fan?.num_prefix || '',
      numDesc: member.user_sailing.cardbg.fan?.num_desc || '',
      color: member.user_sailing.cardbg.fan?.color || ''
    } : null,
    // 评论卡装饰（另一套 decorate 字段，少数活动装扮整卡换肤）
    decorate: (r.decorate && (r.decorate.bg_url || r.decorate.image_large || r.decorate.image)) ? {
      name: r.decorate.name || '',
      bgUrl: String(r.decorate.bg_url || r.decorate.image_large || r.decorate.image || '').replace(/^http:\/\//, 'https://')
    } : null,
    like: r.like || 0,
    rcount: r.rcount || 0,       // 子楼总数
    ctime: r.ctime || 0,
    replies: (r.replies || []).map(x => biliCommentItem(x, upMid))  // 主楼自带的前几条子楼预览
  }
}

// 评论列表（主楼，mode=3 按热度，next 翻页游标）
async function biliComments({ aid, page = 1, upMid = 0 }) {
  const r = await biliApiGet('https://api.bilibili.com/x/v2/reply/main',
    { oid: aid, type: 1, mode: 3, next: page })
  const d = r?.data || {}
  const cursor = d.cursor || {}
  const list = (d.replies || []).map(x => biliCommentItem(x, upMid))
  // 置顶评论（UP主置顶）排最前
  const top = d.top?.upper ? biliCommentItem(d.top.upper, upMid) : null
  return {
    list: top ? [top, ...list] : list,
    total: cursor.all_count || 0,
    hasMore: !cursor.is_end && list.length > 0,
    next: cursor.next || page + 1
  }
}

// 子楼列表（展开某条主楼的全部回复，pn 翻页）
async function biliCommentReplies({ aid, rpid, pn = 1, upMid = 0 }) {
  const r = await biliApiGet('https://api.bilibili.com/x/v2/reply/reply',
    { type: 1, oid: aid, root: rpid, pn, ps: 20 })
  const d = r?.data || {}
  const page = d.page || {}
  const total = page.count || 0
  return {
    list: (d.replies || []).map(x => biliCommentItem(x, upMid)),
    total,
    hasMore: pn * 20 < total
  }
}

// ============================================================
// 互动：点赞 / 投币 / 收藏（需 Web 登录，csrf = bili_jct）
// ============================================================

// 读取 csrf token（cookie 文件里的 bili_jct）
function biliCsrf() {
  try {
    const raw = fs.readFileSync(BILI_COOKIE_FILE(), 'utf8')
    const data = JSON.parse(raw)
    return data.cookies?.bili_jct || ''
  } catch (e) { return '' }
}

// 登录态下的 POST（表单编码 + Cookie + csrf 校验）
async function biliApiPost(url, form) {
  const cookie = biliWebCookie()
  if (!cookie) throw new Error('请先登录B站账号（右上角「B站登录」）')
  const csrf = biliCsrf()
  const body = new URLSearchParams({ ...form, csrf })
  const res = await axios.post(url, body.toString(), {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.bilibili.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie
    },
    timeout: 15000,
    validateStatus: () => true
  })
  const d = res.data
  if (d?.code === 0) return d
  if (d?.code === -101) throw new Error('B站登录已失效，请重新扫码登录')
  if (d?.code === 65006) throw new Error('投币失败：硬币余额不足')
  if (d?.code === 34002) throw new Error('已投过硬币，不能重复投币')
  if (d?.code === 11001) throw new Error('请求过于频繁，请稍后再试')
  throw new Error(d?.message || `互动失败(${d?.code ?? res.status})`)
}

// 点赞 / 取消点赞（like: 1 赞 / 2 取消）
async function biliLike({ bvid, like = 1 }) {
  await biliApiPost('https://api.bilibili.com/x/web-interface/archive/like', { bvid, like })
  return { liked: like === 1 }
}

// 投币（multiply: 1/2 枚；select_like: 1 同时点赞）
// 2026-08-28 修正：coin/add 官方参数只有 aid（av 号），携带 bvid 参数会在个别 PGC 分集
// 上触发服务端误判（如"硬币不足"）；aid 缺失时用 view 接口换算，避免参数无效误报
async function biliCoin({ bvid, aid = 0, multiply = 1, selectLike = 0 }) {
  let realAid = Number(aid) || 0
  if (!realAid && bvid) {
    try {
      const v = await biliApiGet('https://api.bilibili.com/x/web-interface/view', { bvid })
      realAid = Number(v?.data?.aid) || 0
    } catch (e) { /* 忽略，下面统一报缺参 */ }
  }
  if (!realAid) throw new Error('该内容缺少投币信息（av 号），暂不支持投币')
  await biliApiPost('https://api.bilibili.com/x/web-interface/coin/add',
    { aid: realAid, multiply, select_like: selectLike ? 1 : 0 })
  return { ok: true }
}

// 读取登录账号 mid（cookie 文件里的 DedeUserID）
function biliDedeUserId() {
  try {
    const raw = fs.readFileSync(BILI_COOKIE_FILE(), 'utf8')
    const data = JSON.parse(raw)
    return data.cookies?.DedeUserID || ''
  } catch (e) { return '' }
}

// 收藏 / 取消收藏（默认收藏夹）
// 2026-08-28 修正：list-all 必须带 up_mid（登录账号 mid），否则 -400 请求错误 → "收藏请求失败"
async function biliFav({ aid, cancel = false }) {
  const cookie = biliWebCookie()
  if (!cookie) throw new Error('请先登录B站账号（右上角「B站登录」）')
  const upMid = biliDedeUserId()
  // list-all：up_mid 必传；type=2&rid=aid 时返回 favoured 状态与收藏夹列表
  const listRes = await biliApiGet('https://api.bilibili.com/x/v3/fav/folder/created/list-all',
    { up_mid: upMid, type: 2, rid: aid, t: Math.round(Date.now() / 1000) })
  const favId = listRes?.data?.folder?.id || (listRes?.data?.list?.[0]?.id) || 0
  if (!favId) throw new Error('未找到默认收藏夹')
  const form = cancel
    ? { rid: aid, type: 2, del_media_ids: favId }
    : { rid: aid, type: 2, add_media_ids: favId }
  await biliApiPost('https://api.bilibili.com/x/v3/fav/resource/deal', form)
  return { favored: !cancel }
}

// 查询本账号对某稿件的互动状态（打开详情/切换分集时刷新按钮初始态，与官方网页一致）
// 点赞/投币接口均支持 bvid 或 aid 定位；PGC 分集 bvid 可能为空/不被 archive 接口识别，
// 因此 bvid 优先、aid 兜底，确保番剧/电影分集也能查到本账号状态
async function biliInteractState({ aid = 0, bvid = '' }) {
  const out = { liked: false, coins: 0, favored: false }
  if (!biliWebCookie()) return out // 未登录账号无状态可查（按钮保持未激活）
  // 点赞/投币接口均支持 bvid 或 aid 定位；PGC 分集 bvid 可能为空或不被 archive 接口识别，
  // 所以按 bvid → aid 依次尝试，任一参数成功即返回，间隔失败静默换下一个（避免整体失效）
  const candidates = []
  if (bvid) candidates.push({ bvid })
  if (aid) candidates.push({ aid })
  for (const p of candidates) {
    try {
      const r = await biliApiGet('https://api.bilibili.com/x/web-interface/archive/has/like', p)
      // 实测：has/like 的 data 字段直接就是 0/1 数字（并非 { liked } 对象），
      // 读 data.liked 永远为 undefined 会导致点赞状态一直显示未激活
      out.liked = r?.data === 1
      break
    } catch (e) { /* 该参数不被识别则换下一个 */ }
  }
  for (const p of candidates) {
    try {
      const r = await biliApiGet('https://api.bilibili.com/x/web-interface/archive/coins', p)
      out.coins = r?.data?.multiply || 0
      break
    } catch (e) { /* 忽略 */ }
  }
  // 收藏状态：list-all 必须带 up_mid(=登录账号 mid) + rid(=aid) 才返回 fav_state；
  // aid 缺失（极少数 PGC 分集）时用 bvid 换算 aid 再查
  let realAid = Number(aid) || 0
  if (!realAid && bvid) {
    try {
      const v = await biliApiGet('https://api.bilibili.com/x/web-interface/view', { bvid })
      realAid = Number(v?.data?.aid) || 0
    } catch (e) { /* 忽略，下面按无 aid 处理 */ }
  }
  if (realAid) {
    const upMid = biliDedeUserId()
    if (upMid) {
      try {
        const r = await biliApiGet('https://api.bilibili.com/x/v3/fav/folder/created/list-all',
          { up_mid: upMid, type: 2, rid: realAid, t: Math.round(Date.now() / 1000) })
        // 实测：fav_state 在 data.list 每个收藏夹条目上（顶层没有 fav_state），
        // 任一收藏夹包含该视频即视为已收藏；兼容保留顶层兜底
        const list = r?.data?.list || []
        out.favored = (Array.isArray(list) && list.some(i => i.fav_state === 1)) || r?.data?.fav_state === 1
      } catch (e) { /* 忽略 */ }
    }
  }
  return out
}

// ============================================================
// Web 接口取流（TV 接口失败时的回退，用于充电视频）
// 按网址解析的逻辑：x/player/playurl 带 Web 登录 Cookie，
// 充电专属视频需「已登录且已向该UP充电」的账号才能拿完整流
// ============================================================
const BILI_QUALITY_LABELS = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P' }

async function biliWebPlayurl({ bvid, cid, duration = 0, charge = false }) {
  if (!bvid || !cid) throw new Error('缺少取流参数')
  const r = await biliApiGet('https://api.bilibili.com/x/player/playurl',
    { bvid, cid, qn: 127, fnval: 16, fourk: 1 })
  const d = r?.data
  if (!d) throw new Error('Web 接口未返回数据')
  // 充电专属视频试看检测：playurl 返回的流若不完整（试看），抛明确提示
  // （story 视频 timelength 假值按偏差拦截会误报，故仅对后端标记 pay 的视频启用）
  const chargeLoggedIn = !!biliWebCookie()
  if (charge && duration > 0) {
    const dashTrials = (d.dash?.video || []).map(v => v.duration || 0).filter(Boolean)
    const maxTrial = dashTrials.length ? Math.max(...dashTrials) : 0
    const durlTrial = (d.durl || []).some(x => (x.trial_duration || 0) > 0)
    const isTrial = durlTrial || (maxTrial > 0 && Math.abs(maxTrial - duration) > 180)
    if (isTrial) {
      throw new Error(chargeLoggedIn
        ? '充电专属视频：当前B站账号未向该UP主充电（或 Cookie 已失效），接口只返回试看片段'
        : '充电专属视频：需登录B站账号（右上角「B站登录」）且已向该UP主充电才能完整观看')
    }
  }

  // 试看检测对齐解析模块：DASH 不做时长偏差判断
  //（B站"故事/小说视频"timelength 是假值但文件完整可播，按偏差拦截会误报"充电专属"）；
  // 仅 durl 模式看 trial_duration 官方试看标记

  // DASH 音视频分离
  if (d.dash && (d.dash.video || []).length) {
    const audios = (d.dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
    const audioUrl = audios.length ? (audios[0].baseUrl || audios[0].base_url) : ''
    const videos = (d.dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
    const qualities = []
    const seenQ = new Set()
    for (const v of videos) {
      if (seenQ.has(v.id)) continue
      const u = v.baseUrl || v.base_url
      if (!u) continue
      seenQ.add(v.id)
      qualities.push({
        qn: v.id || 0,
        label: BILI_QUALITY_LABELS[v.id] || `${v.id}P`,
        videoUrl: u,
        audioUrl
      })
    }
    if (qualities.length) {
      return {
        success: true,
        type: 'dash',
        source: 'web',
        videoUrl: qualities[0].videoUrl,
        audioUrl,
        quality: qualities[0].qn,
        qualityLabel: qualities[0].label,
        qualities
      }
    }
  }
  // durl 整段有声直链
  if (d.durl && d.durl.length) {
    const u = d.durl[0].url || d.durl[0].durl?.[0]?.url
    if (u) {
      // durl 试看检测（trial_duration 标记）
      if (d.durl.some(x => (x.trial_duration || 0) > 0)) {
        const logged = !!biliWebCookie()
        throw new Error(logged
          ? '充电专属视频：当前B站账号未向该UP主充电（或 Cookie 已失效），接口只返回试看片段'
          : '充电专属视频：需登录B站账号（右上角「B站登录」）且已向该UP主充电才能完整观看')
      }
      const q = d.quality || 64
      const label = BILI_QUALITY_LABELS[q] || `${q}P`
      return {
        success: true,
        type: 'durl',
        source: 'web',
        url: u,
        quality: q,
        qualityLabel: label,
        qualities: [{ qn: q, label, videoUrl: u, audioUrl: '' }]
      }
    }
  }
  throw new Error(d.message || 'Web 接口取流失败')
}

// PGC（番剧/电影）Web 接口取流（TV 接口失败时的回退）
// pgc/player/web/playurl：未登录返回低画质试看（VIP 内容 360P/480P 试看片段），
// 已登录大会员解锁高画质；dash 结构与普通视频一致
async function biliPgcPlayurl({ epId, cid = 0, bvid = '' }) {
  if (!epId) throw new Error('缺少选集参数')
  const r = await biliApiGet('https://api.bilibili.com/pgc/player/web/playurl',
    { ep_id: epId, cid, bvid, qn: 127, fnval: 16, fourk: 1 })
  const d = r?.result
  if (!d) throw new Error('PGC 接口未返回数据')

  if (d.dash && (d.dash.video || []).length) {
    const audios = (d.dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
    const audioUrl = audios.length ? (audios[0].baseUrl || audios[0].base_url) : ''
    const videos = (d.dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
    const qualities = []
    const seenQ = new Set()
    for (const v of videos) {
      if (seenQ.has(v.id)) continue
      const u = v.baseUrl || v.base_url
      if (!u) continue
      seenQ.add(v.id)
      qualities.push({
        qn: v.id || 0,
        label: BILI_QUALITY_LABELS[v.id] || `${v.id}P`,
        videoUrl: u,
        audioUrl
      })
    }
    if (qualities.length) {
      return {
        success: true,
        type: 'dash',
        source: 'web-pgc',
        videoUrl: qualities[0].videoUrl,
        audioUrl,
        quality: qualities[0].qn,
        qualityLabel: qualities[0].label,
        qualities
      }
    }
  }
  // durl 整段（试看片段常为 durl）
  if (d.durl && d.durl.length) {
    const u = d.durl[0].url || d.durl[0].durl?.[0]?.url
    if (u) {
      const q = d.quality || 32
      const label = BILI_QUALITY_LABELS[q] || `${q}P`
      return {
        success: true,
        type: 'durl',
        source: 'web-pgc',
        url: u,
        quality: q,
        qualityLabel: label,
        qualities: [{ qn: q, label, videoUrl: u, audioUrl: '' }]
      }
    }
  }
  throw new Error(d.message || 'PGC 接口取流失败（大会员内容请尝试 TV 端登录）')
}

// ============================================================
// UP 主空间（用户主页：卡片信息 + 投稿列表）
// 信息：x/web-interface/card（游客可用）；投稿：x/space/wbi/arc/search（wbi 签名）
// ============================================================
async function biliUserSpace({ mid = 0, page = 1 }) {
  if (!mid) throw new Error('缺少 UP 主 ID')
  let user = null
  try {
    const cr = await biliApiGet('https://api.bilibili.com/x/web-interface/card', { mid, photo: false })
    const card = cr?.data?.card || {}
    user = {
      mid: Number(card.mid) || Number(mid),
      name: card.name || '',
      face: biliCoverUrl(card.face),
      sign: String(card.sign || '').replace(/<[^>]+>/g, '').trim(),
      fans: cr?.data?.follower ?? 0,
      // 获赞数在 data 顶层 like_num（card.likes 不存在，旧写法恒为 0）
      likes: cr?.data?.like_num ?? 0,
      level: cr?.data?.level_info?.current_level || card.level_info?.current_level || 0,
      // 硬核会员标识（card.is_senior_member）：LV6 硬核用户用 level_h.svg 加强版徽章
      senior: Number(cr?.data?.is_senior_member ?? card.is_senior_member) === 1,
      // VIP 信息在 card.vip（data.vip 不存在）：status=1 有效，vipType 2 年度 / 1 月度
      vip: Number(card.vip?.vipStatus ?? card.vipStatus) === 1,
      vipType: Number(card.vip?.vipType ?? card.vipType) || 0,
      // 官方大会员标签图（如"十年大会员"动图/静态图），有则优先于通用图标
      vipLabel: (card.vip?.label?.use_img_label && card.vip.label.img_label_uri_hans_static)
        ? biliCoverUrl(card.vip.label.img_label_uri_hans_static)
        : '',
      official: card.official?.title || card.Official?.title || ''
    }
  } catch (e) { /* card 失败不阻塞投稿列表 */ }

  // 投稿列表（wbi 签名）
  const mixin = await biliWbiKey()
  const ar = await biliApiGet('https://api.bilibili.com/x/space/wbi/arc/search',
    biliWbiSign({ mid, ps: 30, pn: page, order: 'pubdate', platform: 'web' }, mixin))
  const d = ar?.data
  const toSec = (len) => {
    const parts = String(len || '').split(':'); 
    if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2])
    if (parts.length === 2) return (+parts[0]) * 60 + (+parts[1])
    return +len || 0
  }
  const list = (d?.list?.vlist || []).map(v => ({
    bvid: v.bvid || '',
    aid: v.aid || 0,
    title: biliCleanTitle(String(v.title || '').replace(/<[^>]+>/g, '')),
    cover: biliCoverUrl(v.pic),
    play: v.play || 0,
    danmaku: v.video_review || 0,
    duration: toSec(v.length),
    pubdate: v.created || 0
  }))
  const total = d?.page?.count || d?.page?.vcount || list.length
  if (user && !user.videoCount) user.videoCount = total
  return { user, list, total, hasMore: list.length >= 30 }
}

// ============================================================
// UP 主合集 / 合集视频（x/polymer/web-space，wbi 签名）
// 列表：home/seasons_series （data.items_lists.seasons_list 为合集元信息数组）
// 内容：seasons_archives_list （meta + archives 投稿数组）
// ============================================================
async function biliUserSeasons({ mid = 0, pageNum = 1, pageSize = 20 }) {
  if (!mid) throw new Error('缺少 UP 主 ID')
  const mixin = await biliWbiKey()
  const r = await biliApiGet('https://api.bilibili.com/x/polymer/web-space/home/seasons_series',
    biliWbiSign({ mid, page_num: pageNum, page_size: Math.min(pageSize, 20), web_location: '333.999' }, mixin))
  const il = r?.data?.items_lists || {}
  // 实测（2026-08-28）：合集元数据在每一项的 meta 字段（season_id/title/cover/total），
  // 原代码直接读外层 s.id/s.title/s.total 全部为空，导致合集列表一直显示不出来；
  // 该接口 page_size 上限 20（>20 返回 -400），且翻页会重复返回同一批数据，
  // 因此前端按 seasonId 去重合并，无新增即停止加载更多
  const items = (il.seasons_list || []).map(s => {
    const m = s.meta || s
    const latest = Array.isArray(s.archives) && s.archives[0]?.title ? biliCleanTitle(s.archives[0].title) : ''
    return {
      seasonId: m.season_id || m.series_id || m.id || 0,
      title: biliCleanTitle(m.title || m.name || ''),
      cover: biliCoverUrl(m.cover),
      total: m.total || 0,
      latest
    }
  }).filter(s => s.seasonId)
  return { list: items, hasMore: items.length >= Math.min(pageSize, 20) }
}

async function biliSeasonArchives({ mid = 0, seasonId = 0, pageNum = 1 }) {
  if (!seasonId) throw new Error('缺少合集 ID')
  const mixin = await biliWbiKey()
  const r = await biliApiGet('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list',
    biliWbiSign({ mid, season_id: seasonId, page_num: pageNum, page_size: 30 }, mixin))
  const d = r?.data
  const toSec = (len) => {
    const parts = String(len || '').split(':')
    if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2])
    if (parts.length === 2) return (+parts[0]) * 60 + (+parts[1])
    return +len || 0
  }
  const archives = (d?.archives || []).map(v => ({
    bvid: v.bvid || '',
    aid: v.aid || 0,
    title: biliCleanTitle(String(v.title || '').replace(/<[^>]+>/g, '')),
    cover: biliCoverUrl(v.pic),
    play: v.stat?.view || 0,
    danmaku: v.stat?.danmaku || v.video_review || 0,
    duration: toSec(v.duration),
    pubdate: v.pubdate || 0
  }))
  return {
    meta: d?.meta ? { id: d.meta.season_id || d.meta.id, title: biliCleanTitle(d.meta.title || '') } : null,
    list: archives,
    total: d?.meta?.total || d?.total || d?.archives_total || archives.length,
    hasMore: archives.length >= 30
  }
}

// ============================================================
// IPC Handler
// ============================================================
ipcMain.handle('bilibili:video-home', async (_, params) => {
  try {
    const data = await biliHome(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-search', async (_, params) => {
  try {
    const data = await biliSearch(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-detail', async (_, { bvid }) => {
  try {
    const data = await biliDetail({ bvid })
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-playurl', async (_, params) => {
  try {
    const data = await biliWebPlayurl(params || {})
    // 扁平展开（videoUrl/url/qualities 直接可读），与 bilibili:anime-playurl 返回结构一致
    return { success: true, ...data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// PGC（番剧/电影）季详情（season_id 或 ep_id 定位）
ipcMain.handle('bilibili:video-season-detail', async (_, params) => {
  try {
    const data = await biliPgcDetail(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// PGC Web 接口取流（TV 失败回退）
ipcMain.handle('bilibili:video-pgc-playurl', async (_, params) => {
  try {
    const data = await biliPgcPlayurl(params || {})
    // 扁平展开，与 bilibili:anime-playurl 返回结构一致
    return { success: true, ...data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-like', async (_, params) => {
  try {
    const data = await biliLike(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-coin', async (_, params) => {
  try {
    const data = await biliCoin(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-fav', async (_, params) => {
  try {
    const data = await biliFav(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-comments', async (_, params) => {
  try {
    const data = await biliComments(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bilibili:video-comment-replies', async (_, params) => {
  try {
    const data = await biliCommentReplies(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// 查询当前账号对稿件的互动状态（点赞/投币/收藏）
ipcMain.handle('bilibili:video-interact', async (_, params) => {
  try {
    const data = await biliInteractState(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// UP 主空间（用户主页信息 + 投稿列表）
ipcMain.handle('bilibili:user-space', async (_, params) => {
  try {
    const data = await biliUserSpace(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// UP 主合集列表
ipcMain.handle('bilibili:video-user-seasons', async (_, params) => {
  try {
    const data = await biliUserSeasons(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

// 合集内视频列表
ipcMain.handle('bilibili:video-season-archives', async (_, params) => {
  try {
    const data = await biliSeasonArchives(params || {})
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})



// ============================================================
// 设置页：B站登录态管理（Web Cookie 显示/复制/粘贴登录 + TV Token 读取）
// ============================================================
const BILI_TV_TOKEN_FILE_PATH = () => path.join(app.getPath('userData'), 'bilibili-tv-token.json')

ipcMain.handle('bili:get-web-cookie', async () => {
  try {
    const raw = fs.readFileSync(BILI_COOKIE_FILE(), 'utf8')
    const data = JSON.parse(raw)
    const cookies = data.cookies || {}
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    return { success: true, cookie, savedAt: data.savedAt || 0 }
  } catch (e) {
    return { success: true, cookie: '' }
  }
})

ipcMain.handle('bili:set-web-cookie', async (_, cookieStr) => {
  try {
    const raw = String(cookieStr || '').trim()
    if (!raw) return { success: false, message: 'Cookie 不能为空' }
    let cookies = {}
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw)
      cookies = parsed.cookies || parsed
    } else {
      raw.split(';').forEach(pair => {
        const i = pair.indexOf('=')
        if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
      })
    }
    if (!cookies.SESSDATA) return { success: false, message: 'Cookie 中缺少 SESSDATA，无法登录' }
    fs.writeFileSync(BILI_COOKIE_FILE(), JSON.stringify({ cookies, savedAt: Date.now() }), 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('bili:set-tv-token', async (_, raw) => {
  try {
    const str = String(raw || '').trim()
    if (!str) return { success: false, message: 'Token 不能为空' }
    let data = {}
    if (str.startsWith('{')) {
      data = JSON.parse(str)
    } else {
      data = { accessKey: str }
    }
    if (!data.accessKey) return { success: false, message: '缺少 accessKey（TV 端登录凭证）' }
    fs.writeFileSync(BILI_TV_TOKEN_FILE_PATH(), JSON.stringify({ ...data, savedAt: Date.now() }), 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, message: 'Token 格式错误：' + e.message }
  }
})

ipcMain.handle('bili:get-tv-token', async () => {
  try {
    const raw = fs.readFileSync(BILI_TV_TOKEN_FILE_PATH(), 'utf8')
    const data = JSON.parse(raw)
    return { success: true, token: data.accessKey ? JSON.stringify(data, null, 2) : '' }
  } catch (e) {
    return { success: true, token: '' }
  }
})
