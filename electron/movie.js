// electron/movie.js
// 电影模块 - 主进程 IPC 处理器
// 数据源：神马电影网（标准 maccms 结构）
//   主源：https://www.smdyu.com  (神马电影网，maccms 结构，player_aaaa 直接提供 m3u8)
//   说明：appys.pro / czys.tv 的 TLS 握手在大陆机房稳定失败，已弃用
// 播放：通过 player_aaaa.url 提取 m3u8，前端用 hls.js 播放
import { ipcMain } from 'electron'
import axios from 'axios'
import * as cheerio from 'cheerio'

const SOURCES = {
  smdyu: {
    id: 'smdyu',
    base: 'https://www.smdyu.com',
    label: '神马电影',
    type: 'maccms'
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchHtml(url, referer) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || '',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    responseType: 'text',
    timeout: 15000,
    validateStatus: () => true,
    maxRedirects: 5
  })
  return res.data
}

function normalizeCover(url, base) {
  if (!url) return ''
  let u = url.replace(/&amp;/g, '&')
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('http')) return u
  if (u.startsWith('/')) return base + u
  return base + '/' + u
}

// 神马电影网卡片解析
// 结构：<div class="card">
//   <div class="media-wrapper"><a href="/vod-detail-id-XXX.html"><img data-original="..." alt="标题"></a></div>
//   <div class="card-heading"><strong><a href="..." title="标题">标题</a></strong></div>
//   <span class="label ...">备注</span>
//   <div class="card-content">分类/地区/年份</div>
// </div>
function parseCard($el, base, sourceId) {
  const $link = $el.find('a[href*="/vod-detail-id-"]').first()
  if (!$link.length) return null
  const href = $link.attr('href') || ''
  const idMatch = href.match(/\/vod-detail-id-(\w+)\.html/)
  if (!idMatch) return null

  const $img = $el.find('.media-wrapper img').first()
  let title = ($link.attr('title') || '').trim()
    || ($img.attr('alt') || '').trim()
    || $el.find('.card-heading a').first().text().trim()
  if (!title) return null

  const cover = normalizeCover(
    $img.attr('data-original') || $img.attr('data-src') || $img.attr('src'),
    base
  )
  // 占位图 load.gif 跳过
  if (cover && /\/load\.gif$/i.test(cover)) return null

  const note = $el.find('.label').first().text().trim()
  const categoryText = $el.find('.card-content').first().text().trim()
  return {
    id: idMatch[1],
    title: title.replace(/\s+/g, ' '),
    cover,
    desc: note || categoryText,
    source: sourceId
  }
}

// 获取首页（电影分类页）
async function getHome(sourceId) {
  const src = SOURCES[sourceId]
  if (!src) return { latest: [], hot: [], ranking: [] }
  try {
    const base = src.base
    const sections = { latest: [], hot: [], ranking: [] }
    const seen = new Set()
    const pushCard = (c) => {
      if (c && !seen.has(c.id)) { seen.add(c.id); sections.latest.push(c) }
    }

    // 神马首页 + 电影分类页 都有 .cards.video-list .card
    const urls = [`${base}/`, `${base}/vod-type-id-dianying.html`]
    for (const u of urls) {
      try {
        const html = await fetchHtml(u, base)
        const $ = cheerio.load(html)
        $('.cards.video-list .card').each((_, el) => {
          pushCard(parseCard($(el), base, sourceId))
        })
      } catch (e) { /* 继续尝试下一个 URL */ }
      if (sections.latest.length >= 30) break
    }

    // hot/ranking 用同一批数据的不同切片
    sections.hot = sections.latest.slice(0, 18)
    sections.ranking = sections.latest.slice(0, 10)

    console.log(`[Movie] ${src.label}首页: latest=${sections.latest.length}`)
    return {
      latest: sections.latest.slice(0, 30),
      hot: sections.hot,
      ranking: sections.ranking
    }
  } catch (e) {
    console.error(`[Movie] ${src.label}首页失败:`, e.message)
    return { latest: [], hot: [], ranking: [] }
  }
}

// 搜索
async function search(sourceId, keyword) {
  const src = SOURCES[sourceId]
  if (!src) return []
  try {
    const base = src.base
    // 神马搜索 URL：/vod-search--------------.html?wd=关键词
    const url = `${base}/vod-search--------------.html?wd=${encodeURIComponent(keyword)}`
    const html = await fetchHtml(url, base)
    const $ = cheerio.load(html)
    const results = []
    const seen = new Set()
    $('.cards.video-list .card').each((_, el) => {
      const card = parseCard($(el), base, sourceId)
      if (card && !seen.has(card.id)) {
        seen.add(card.id)
        results.push(card)
      }
    })
    return results
  } catch (e) {
    console.error(`[Movie] ${src.label}搜索失败:`, e.message)
    return []
  }
}

// 详情
async function getDetail(sourceId, id) {
  const src = SOURCES[sourceId]
  if (!src) return null
  try {
    const base = src.base
    const url = `${base}/vod-detail-id-${id}.html`
    const html = await fetchHtml(url, base)
    if (!html || html.length < 1000) return null
    const $ = cheerio.load(html)

    const title = $('.page-header h2, .panel-heading h2, .content-info h2, h2').first().text().trim()
      || $('meta[property="og:title"]').attr('content')
      || id
    const $coverImg = $('.content-info img, .media-wrapper img, .panel-body img').first()
    const cover = normalizeCover(
      $coverImg.attr('data-original') || $coverImg.attr('data-src') || $coverImg.attr('src'),
      base
    )
    const desc = $('.content-info, .panel-body.content-info, .brief, .summary').text().trim().slice(0, 500)

    // 多线路解析：神马用 .play-list#playlist_1 / #playlist_2 区分线路
    const routes = []
    $('.play-list').each((idx, list) => {
      const $list = $(list)
      // 线路名优先取对应的 tab 标签，没有就用 线路N
      let routeName = `线路${idx + 1}`
      const listId = $list.attr('id') || ''
      const listIdxMatch = listId.match(/playlist_(\d+)/)
      if (listIdxMatch) {
        const tabSel = `.playlist-tab[data-playlist="${listIdxMatch[1]}"], .playlist-tab a[href="#${listId}"], a[href="#${listId}"]`
        const tabText = $(tabSel).first().text().trim()
        if (tabText) routeName = tabText
      }
      const episodes = []
      $list.find('a[href*="/vod-play-id-"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        const epTitle = $el.attr('title') || $el.text().trim()
        // 提取 id-src-num 部分（不含 .html）
        const epMatch = href.match(/\/vod-play-id-([\w\-]+-src-\d+-num-\d+)\.html/)
        if (epTitle && epMatch) {
          episodes.push({ title: epTitle, url: epMatch[1], source: sourceId })
        }
      })
      if (episodes.length > 0) routes.push({ name: routeName, episodes })
    })

    return { id, title, cover, desc, routes, source: sourceId }
  } catch (e) {
    console.error(`[Movie] ${src.label}详情失败:`, e.message)
    return null
  }
}

// 解析播放地址
async function parsePlay(sourceId, episodeUrl) {
  const src = SOURCES[sourceId]
  if (!src) return { success: false, message: '未知源' }
  try {
    const base = src.base
    const detailReferer = `${base}/vod-detail-id-${episodeUrl.split('-src-')[0]}.html`
    const url = `${base}/vod-play-id-${episodeUrl}.html`
    const html = await fetchHtml(url, detailReferer)

    // 方案1：player_aaaa JSON 提取 m3u8（神马电影网主要使用此方式）
    const playerMatch = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
    if (playerMatch) {
      try {
        const player = JSON.parse(playerMatch[1])
        if (player.url && /^https?:\/\//.test(player.url)) {
          const playUrl = String(player.url).replace(/\\\//g, '/')
          const isM3u8 = /\.m3u8/i.test(playUrl)
          return { success: true, url: playUrl, type: isM3u8 ? 'm3u8' : 'iframe' }
        }
      } catch (e) { /* 降级 */ }
    }

    // 方案2：正则找 m3u8
    const m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
    if (m3u8Match) {
      return { success: true, url: m3u8Match[1].replace(/\\\//g, '/'), type: 'm3u8' }
    }

    // 方案3：找 iframe
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i)
    if (iframeMatch) {
      let iframeSrc = iframeMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&')
      if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc
      else if (iframeSrc.startsWith('/')) iframeSrc = base + iframeSrc
      if (/player|dplayer|url=|\.m3u8/i.test(iframeSrc)) {
        return { success: true, url: iframeSrc, type: 'iframe' }
      }
    }

    // 方案4：iframe 嵌入整个播放页（兜底）
    return { success: true, url: url, type: 'iframe' }
  } catch (e) {
    console.error(`[Movie] ${src.label}解析失败:`, e.message)
    return { success: false, message: e.message }
  }
}

// ============================================================
// IPC Handler
// ============================================================
ipcMain.handle('movie:sources', async () => {
  return { success: true, data: SOURCES }
})

ipcMain.handle('movie:home', async (_, { source }) => {
  try {
    const data = await getHome(source)
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('movie:search', async (_, { source, keyword }) => {
  try {
    const data = await search(source, keyword)
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('movie:detail', async (_, { source, id }) => {
  try {
    const data = await getDetail(source, id)
    return { success: true, data }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('movie:parse-playurl', async (_, { source, episodeUrl }) => {
  try {
    return await parsePlay(source, episodeUrl)
  } catch (e) {
    return { success: false, message: e.message }
  }
})

console.log('[Movie] 模块已加载（1源：神马电影 smdyu.com）')
