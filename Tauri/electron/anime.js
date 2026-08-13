// electron/anime.js
// 动漫模块 - 主进程 IPC 处理器
// 数据源：樱花动漫（3线路：推荐/经典/备用，标准 maccms 结构）
// 播放器：优先提取 player_aaaa 中的 m3u8/mp4 直链由 BiliPlayer 播放；失败则 iframe 嵌入整页
import { ipcMain } from 'electron'
import axios from 'axios'
import * as cheerio from 'cheerio'

// 3线路：推荐 / 经典 / 备用（同构 maccms，解析逻辑通用）
const SOURCES = {
  yhfs: {
    id: 'yhfs',
    base: 'https://www.yinghuafans.com',
    label: '樱花动漫·官方线路',
    type: 'iframe'
  },
  yhf: {
    id: 'yhf',
    base: 'https://www.yinghuafan.com',
    label: '樱花动漫·推荐线路',
    type: 'iframe'
  },
  xdm: {
    id: 'xdm',
    base: 'https://www.xdm7.net',
    label: '樱花动漫·经典线路',
    type: 'iframe'
  },
  yhdmfan: {
    id: 'yhdmfan',
    base: 'https://www.yhdmfan.cc',
    label: '樱花动漫·备用线路',
    type: 'iframe'
  }
}

// 故障转移顺序：官方 → 推荐 → 经典 → 备用
const FALLBACK_ORDER = ['yhfs', 'yhf', 'xdm', 'yhdmfan']

// 各播放源(from)对应的解析接口（来自 playerconfig.js）
// 方案一：直接 iframe 套用解析播放器，快速无需提取直链
const PARSE_MAP = {
  'CYC67':    'https://jx.yhdm5.one/player?url=',
  'LMM97':    'https://jx.yhdm5.one/player?url=',
  'qq':       'https://jx.yhdm5.one/player?url=',
  'youku':    'https://jx.yhdm5.one/player?url=',
  'bilibili': 'https://jx.yhdm5.one/player?url=',
  'lzm3u8':   'https://jx.yhdz.one/?url=',
  'ffm3u8':   'https://jx.yhdz.one/?url=',
  'bfzym3u8': 'https://jx.yhdz.one/?url=',
  'dbm3u8':   'https://jx.yhdz.one/?url=',
  'vwnet':    'https://jx.yinghuafan.com/?url='
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchHtml(url, referer, timeout = 12000) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || '',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    responseType: 'text',
    timeout,
    validateStatus: () => true,
    maxRedirects: 5
  })
  return res.data
}

// 封面归一化
function normalizeCover(url, base) {
  if (!url) return ''
  let u = url.replace(/&amp;/g, '&')
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('http')) return u
  if (u.startsWith('/')) return base + u
  return base + '/' + u
}

// ============================================================
// 通用 maccms 解析（3线路共用）
// ============================================================

// 通用卡片解析（首页 .module-poster-item / 搜索 .module-card-item）
// 注意：樱花首页的 .module-poster-item 卡片本身就是 <a> 标签
function parseCard($el, base, sourceId) {
  let $titleLink
  if ($el.is('a[href*="/v/"]') || $el.is('a[href*="/show/"]')) {
    $titleLink = $el.first()
  } else {
    $titleLink = $el.find('a[href*="/v/"]').first()
    if (!$titleLink.length) $titleLink = $el.find('a[href*="/show/"]').first()
    if (!$titleLink.length) $titleLink = $el.find('.module-card-item-title a').first()
    if (!$titleLink.length) $titleLink = $el.find('.module-item-title a').first()
    if (!$titleLink.length) $titleLink = $el.find('.vod-item-title a').first()
  }

  const href = $titleLink.attr('href') || ''
  let idMatch = href.match(/\/v\/(\w+)\.html/) || href.match(/\/v\/(\w+)/)
  if (!idMatch) idMatch = href.match(/\/show\/(\w+)\.html/) || href.match(/\/show\/(\w+)/)
  if (!idMatch) return null

  const $img = $el.find('img').first()
  let title = ($titleLink.attr('title') || '').trim()
    || ($img.attr('alt') || '').trim()
    || $el.find('.module-poster-item-title, .module-card-item-title, .vod-item-title, .slide-item-title').first().text().trim()
    || $titleLink.find('strong').text().trim()
    || $el.attr('title')
    || ''
  if (!title) {
    const txt = $titleLink.text().trim()
    if (txt && !/^(播放|详情|全集|HD|高清|下载|第\d+集|资源详情)$/.test(txt)) title = txt
  }
  if (!title) return null

  const $ewaveImg = $el.find('.ewave-img-wrapper, .slide-item-pic').first()
  const coverUrl = $img.attr('data-original') || $img.attr('data-src') || $img.attr('src') || $ewaveImg.attr('data-original') || $ewaveImg.attr('data-background')
  const cover = normalizeCover(
    coverUrl,
    base
  )
  const note = $el.find('.module-item-note, .module-item-new, .module-card-item-tag, .vod-item-desc, .slide-item-desc').first().text().trim()
  return {
    id: idMatch[1],
    title: title.replace(/\s+/g, ' '),
    cover,
    desc: note,
    source: sourceId
  }
}

// 单源首页
async function getHomeSingle(sourceId) {
  const src = SOURCES[sourceId]
  const base = src.base
  const html = await fetchHtml(base + '/', base)
  const $ = cheerio.load(html)
  const sections = { latest: [], hot: [], ranking: [] }
  const seenIds = new Set()
  const pushCard = (card) => {
    if (card && !seenIds.has(card.id)) {
      seenIds.add(card.id)
      sections.latest.push(card)
    }
  }

  // 1. 优先按 module 区块爬取
  $('.module, .layout-box').each((_, mod) => {
    const $mod = $(mod)
    const sectionTitle = $mod.find('.module-heading .module-title, .module-title, .box-title').first().text().trim()
    const items = []
    $mod.find('.module-poster-item, .module-card-item, .module-item, .stui-vodlist__item, .vodlist-item, .vod-item, .slide-item').each((_, el) => {
      const card = parseCard($(el), base, sourceId)
      if (card) items.push(card)
    })
    if (items.length === 0) return
    if (/更新|最新|今日|周|新番/.test(sectionTitle)) {
      items.forEach(pushCard)
    } else if (/排行|热门|推荐/.test(sectionTitle)) {
      items.forEach(c => {
        if (c && !sections.hot.find(x => x.id === c.id)) sections.hot.push(c)
        if (c && !sections.ranking.find(x => x.id === c.id)) sections.ranking.push(c)
      })
    } else {
      items.forEach(pushCard)
    }
  })

  // 2. 兜底：直接遍历所有卡片选择器
  if (sections.latest.length === 0 && sections.hot.length === 0) {
    $('.module-poster-item, .module-card-item, .module-item, .stui-vodlist__item, .vodlist-item, .vod-item, .slide-item, li[class*=item]').each((_, el) => {
      pushCard(parseCard($(el), base, sourceId))
    })
  }

  // 3. 最终兜底：所有 /v/ 链接
  if (sections.latest.length === 0) {
    $('a[href*="/v/"]').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href') || ''
      const idMatch = href.match(/\/v\/(\w+)\.html/) || href.match(/\/v\/(\w+)/)
      if (!idMatch) return
      const id = idMatch[1]
      if (seenIds.has(id)) return
      seenIds.add(id)
      const $parent = $el.closest('div, li, .module-item, .module-card-item, .module-poster-item')
      const $img = $parent.length ? $parent.find('img').first() : $el.find('img').first()
      const title = ($img.attr('alt') || '').trim() || $el.attr('title') || $el.text().trim()
      if (!title || /^(播放|详情|全集|HD|高清|下载)$/.test(title)) return
      const cover = $img.length ? normalizeCover($img.attr('data-original') || $img.attr('data-src') || $img.attr('src'), base) : ''
      sections.latest.push({ id, title: title.replace(/\s+/g, ' '), cover, desc: '', source: sourceId })
    })
  }

  // 4. 补全 hot/ranking
  if (sections.hot.length === 0) sections.hot = sections.latest.slice(0, 18)
  if (sections.ranking.length === 0) sections.ranking = sections.latest.slice(0, 10)

  return {
    latest: sections.latest.slice(0, 30),
    hot: sections.hot.slice(0, 18),
    ranking: sections.ranking.slice(0, 10)
  }
}

// 首页：故障转移（推荐失败 → 经典 → 备用）
async function getHome() {
  for (const sid of FALLBACK_ORDER) {
    try {
      const data = await getHomeSingle(sid)
      if (data.latest.length > 0 || data.hot.length > 0) {
        return data
      }
    } catch (e) {
      console.warn(`[Anime] 首页失败(${sid}): ${e.message}`)
    }
  }
  console.error('[Anime] 所有线路首页均失败')
  return { latest: [], hot: [], ranking: [] }
}

// 单源搜索
async function searchSingle(sourceId, keyword) {
  const base = SOURCES[sourceId].base
  const results = []
  const seen = new Set()
  
  // 1. 优先使用 MacCMS 的 ajax/suggest 接口，这通常返回 JSON 且不易被安全验证拦截
  try {
    const suggestUrl = `${base}/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(keyword)}&limit=50`
    const res = await axios.post(suggestUrl, {}, {
      headers: {
        'User-Agent': UA,
        'Referer': base + '/'
      },
      timeout: 10000
    })
    if (res.data && res.data.code === 1 && Array.isArray(res.data.list)) {
      for (const item of res.data.list) {
        const id = String(item.id)
        if (!seen.has(id)) {
          seen.add(id)
          results.push({
            id: id,
            title: item.name,
            cover: normalizeCover(item.pic, base),
            desc: '',
            source: sourceId
          })
        }
      }
      if (results.length > 0) {
        return results
      }
    }
  } catch (e) {
    console.warn(`[Anime] ajax/suggest 失败(${sourceId}): ${e.message}`)
  }

  // 2. 降级：网页搜索（如果遇到系统安全验证可能会失败）
  try {
    const url = `${base}/vodsearch/${encodeURIComponent(keyword)}-------------.html`
    const html = await fetchHtml(url, base)
    // 如果返回了"系统安全验证"，直接放弃网页解析
    if (html && (html.includes('系统安全验证') || html.includes('mx-mac_msg_jump'))) {
      console.warn(`[Anime] 网页搜索被系统安全验证拦截(${sourceId})`)
      return results // 返回前面 suggest 可能拿到的空结果
    }
    const $ = cheerio.load(html)
    $('.module-card-item, .module-item, .module-poster-item').each((_, el) => {
      const card = parseCard($(el), base, sourceId)
      if (card && !seen.has(card.id)) {
        seen.add(card.id)
        results.push(card)
      }
    })
    // 兜底
    if (results.length === 0) {
      $('a[href*="/v/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        const idMatch = href.match(/\/v\/(\w+)\.html/)
        if (!idMatch) return
        const id = idMatch[1]
        if (seen.has(id)) return
        const $parent = $el.closest('.module-card-item, .module-item, div, li')
        const $img = $parent.length ? $parent.find('img').first() : $el.find('img').first()
        let title = $el.attr('title') || $img.attr('alt') || ''
        if (!title) {
          const txt = $el.text().trim()
          if (txt && txt.length >= 2 && !/^(播放|详情|全集|HD|高清|下载)$/.test(txt)) title = txt
        }
        if (!title) return
        seen.add(id)
        const cover = $img.length ? normalizeCover($img.attr('data-original') || $img.attr('src'), base) : ''
        results.push({ id, title, cover, desc: '', source: sourceId })
      })
    }
  } catch (e) {
    console.warn(`[Anime] 网页搜索解析失败(${sourceId}): ${e.message}`)
  }
  
  return results
}

// 搜索：故障转移
async function search(keyword) {
  for (const sid of FALLBACK_ORDER) {
    try {
      const data = await searchSingle(sid, keyword)
      if (data.length > 0) {

        return data
      }
    } catch (e) {
      console.warn(`[Anime] 搜索失败(${sid}): ${e.message}`)
    }
  }
  return []
}

// 单源详情
async function getDetailSingle(sourceId, id) {
  const base = SOURCES[sourceId].base
  const url = `${base}/v/${id}.html`
  const html = await fetchHtml(url, base)
  const $ = cheerio.load(html)

  const title = $('.module-info-heading h1, .page-title, h1, .detail-info-title').first().text().trim()
    || $('meta[property="og:title"]').attr('content') || id

  const $coverImg = $('.module-info-poster img, .module-item-pic img, .content img, .detail-info-pic img').first()
  const $ewaveCover = $('.detail-info-pic .ewave-img-wrapper, .ewave-img-wrapper').first()
  const coverUrl = $coverImg.attr('data-original') || $coverImg.attr('src') || $ewaveCover.attr('data-original') || $ewaveCover.attr('data-background')
  const cover = normalizeCover(coverUrl, base)

  // 简介：优先取 .module-info-introduction 的纯文本，避免混入导演/制作等元信息行
  let desc = ''
  const $intro = $('.module-info-introduction, .video-info-content, .summary, .brief, .video_info-content, #c1>p, .play-desc, .detail-info-list').first()
  if ($intro.length) {
    desc = $intro.text().trim()
    // 过滤掉"导演：xxx"、"主演：xxx"等元信息行（以"xxx："开头且含中文冒号）
    desc = desc.split(/\n+/).filter(line => !/^(导演|主演|原作|编剧|制片|主演|配音|声优|动画制作|制作公司|发行|首播|集数|语言|地区|年代|类型|又名|官方网站)\s*[:：]/.test(line.trim())).join(' ')
  }
  if (!desc) {
    desc = $('.module-info-introduction, .video-info, .content, .summary, .brief').text().trim()
  }

  // 多线路：每个 .module-play-list 对应一个 .module-tab-item
  const routes = []
  const $tabs = $('.module-tab-item[data-dropdown-value], .playlist-tab-item, .ewave-tab[data-target^="#"]')
  const $playLists = $('.module-play-list')

  if ($tabs.length > 0) {
    $tabs.each((idx, tab) => {
      const $tab = $(tab)
      const routeName = $tab.attr('data-dropdown-value') || $tab.text().trim() || `线路${idx + 1}`
      const target = $tab.attr('data-target')
      let $list
      if (target && target.startsWith('#')) {
        $list = $(target)
      } else {
        $list = $playLists.eq(idx)
      }
      
      const episodes = []
      $list.find('a.module-play-list-link, a[href*="/p/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        const epTitle = $el.find('span').text().trim() || $el.text().trim()
        const epMatch = href.match(/\/p\/(\d+-\d+-\d+)\.html/)
        if (epTitle && epMatch) {
          episodes.push({ title: epTitle, url: epMatch[1], source: sourceId })
        }
      })
      if (episodes.length > 0) {
        routes.push({ name: routeName, episodes })
      }
    })
  }

  // 兜底：所有播放链接归一条线路
  if (routes.length === 0) {
    const episodes = []
    $('a[href*="/p/"]').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href') || ''
      const epTitle = $el.find('span').text().trim() || $el.text().trim()
      const epMatch = href.match(/\/p\/(\d+-\d+-\d+)\.html/)
      if (epTitle && epMatch) {
        episodes.push({ title: epTitle, url: epMatch[1], source: sourceId })
      }
    })
    const seen = new Set()
    const unique = episodes.filter(e => {
      if (seen.has(e.title)) return false
      seen.add(e.title)
      return true
    })
    if (unique.length > 0) routes.push({ name: '线路1', episodes: unique })
  }

  return { id, title, cover, desc: desc.slice(0, 500), routes, source: sourceId }
}

// 详情：先按用户选的源，失败则故障转移
async function getDetail(sourceId, id) {
  // 先尝试用户选的源
  try {
    const data = await getDetailSingle(sourceId, id)
    if (data.title && data.routes.length > 0) return data
  } catch (e) {
    console.warn(`[Anime] 详情失败(${sourceId}): ${e.message}`)
  }
  // 故障转移（跳过用户已选的源）
  for (const sid of FALLBACK_ORDER) {
    if (sid === sourceId) continue
    try {
      const data = await getDetailSingle(sid, id)
      if (data.title && data.routes.length > 0) {

        return data
      }
    } catch (e) { /* 继续尝试 */ }
  }
  return null
}

// 解析播放地址
// 方案一（默认 scheme=1）：提取 player_aaaa，拼解析接口 iframe 套用，快速无需提取直链
// 方案二（scheme=2）：提取 m3u8/mp4 直链由 BiliPlayer(hls.js) 播放，失败则 iframe 整页
async function parsePlay(sourceId, episodeUrl, scheme = 1) {
  // episodeUrl 形如 131086-5-1
  const trySources = [sourceId, ...FALLBACK_ORDER.filter(s => s !== sourceId)]
  for (const sid of trySources) {
    if (!SOURCES[sid]) continue
    try {
      const base = SOURCES[sid].base
      const url = `${base}/p/${episodeUrl}.html`
      const html = await fetchHtml(url, base)
      if (!html || html.length < 1000) continue

      // 提取 player_aaaa
      const playerMatch = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
      let player = null
      if (playerMatch) {
        try { player = JSON.parse(playerMatch[1]) } catch (e) { /* 忽略 */ }
      }

      // ===== 方案一：解析播放器 iframe 套用（快速） =====
      if (scheme === 1 && player && player.url && player.from) {
        const parseUrl = PARSE_MAP[player.from]
        if (parseUrl) {
          const playUrl = String(player.url).replace(/\\\//g, '/')
          const iframeUrl = parseUrl + encodeURIComponent(playUrl)

          return { success: true, url: iframeUrl, type: 'iframe', scheme: 1 }
        }
        // from 不在映射表，降级到方案二逻辑
      }

      // ===== 方案二：提取 m3u8/mp4 直链给 BiliPlayer =====
      if (player && player.url && /^https?:\/\//.test(player.url)) {
        const playUrl = String(player.url).replace(/\\\//g, '/')
        if (/\.(m3u8|mp4|flv|m4v|webm)(\?|$)/i.test(playUrl)) {

          return { success: true, url: playUrl, type: 'm3u8', scheme: 2 }
        }
      }

      // 方案二降级：正则找 m3u8
      const m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
      if (m3u8Match) {

        return { success: true, url: m3u8Match[1].replace(/\\\//g, '/'), type: 'm3u8', scheme: 2 }
      }

      // 最终兜底：iframe 直接嵌入整页（樱花原生 Artplayer）

      return { success: true, url: url, type: 'iframe' }
    } catch (e) {
      console.warn(`[Anime] 播放解析失败(${sid}): ${e.message}`)
    }
  }
  return { success: false, message: '所有线路解析播放地址失败，请切换线路重试' }
}

// ============================================================
// IPC Handler
// ============================================================
ipcMain.handle('anime:sources', async () => {
  return { success: true, data: SOURCES }
})

ipcMain.handle('anime:home', async (_, { source }) => {
  try {
    // 首页忽略 source 参数，直接故障转移（保证可用性）
    const data = await getHome()
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('anime:search', async (_, { source, keyword }) => {
  try {
    // 搜索也故障转移
    const data = await search(keyword)
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('anime:detail', async (_, { source, id }) => {
  try {
    const data = await getDetail(source, id)
    if (!data) return { success: false, message: '加载详情失败，请尝试切换线路' }
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('anime:parse-playurl', async (_, { source, episodeUrl, scheme }) => {
  try {
    return await parsePlay(source, episodeUrl, scheme || 1)
  } catch (e) {
    return { success: false, message: e.message }
  }
})


