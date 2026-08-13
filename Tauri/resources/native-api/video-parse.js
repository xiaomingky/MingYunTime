// native-api/video-parse.js
// 视频解析模块 - 从 electron/main.js 提取（去除 ipcMain / electron 依赖）
// 包含：video:parse-url 主入口 + 各平台解析器（B站/虎牙/斗鱼/Twitch/快手/抖音/通用HTML）
//
// 重要说明：
//   原版 Electron 中 parseDouyu / parseKuaishou / parseDouyin 在 SSR 提取失败时
//   会使用隐藏 BrowserWindow 渲染页面来抓取视频地址。纯 Node.js 无 BrowserWindow，
//   因此这些平台的 BrowserWindow 渲染路径已被替换为返回 null（带 warn 日志）。
//   - B站视频/直播/番剧、虎牙直播、Twitch 直播、maccms 站点：完全可用
//   - 斗鱼直播：不可用（依赖 BrowserWindow 网络拦截）
//   - 快手/抖音：SSR 提取成功时可用，否则不可用
import axios from 'axios'
import { loadBiliCookie, biliCookieString, PARSE_UA } from './bilibili.js'

// Twitch 网页版公开 Client-ID（非机密，所有浏览器请求都用这个）
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

// ===== B站直播解析 =====
// 输入直播间地址（live.bilibili.com/xxx），调用官方 API 获取直播流（flv/hls）
async function parseBilibiliLive(target, addStream) {
  let roomId = ''
  // 提取房间号：live.bilibili.com/1883358196 或带参数
  const m = target.match(/live\.bilibili\.com\/(\d+)/i)
  if (m) roomId = m[1]
  if (!roomId) return null
  try {
    const biliCookies = loadBiliCookie()
    const headers = { 'User-Agent': PARSE_UA, 'Referer': 'https://live.bilibili.com/' }
    if (biliCookies && biliCookies.SESSDATA) headers['Cookie'] = biliCookieString(biliCookies)
    // 获取房间真实 ID + 直播流
    const api = `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=16`
    const res = await axios.get(api, { headers, timeout: 15000, validateStatus: () => true })
    if (res.status !== 200 || res.data?.code !== 0) return null
    const playurl = res.data?.data?.playurl_info?.playurl
    if (!playurl?.stream) return null
    const title = res.data?.data?.room_info?.title || `B站直播 ${roomId}`
    let added = 0
    for (const stream of playurl.stream) {
      const proto = stream.protocol_name  // http_hls / http_flv
      for (const fmt of (stream.format || [])) {
        for (const codec of (fmt.codec || [])) {
          // url_list 是完整地址（flv 直链）
          for (const u of (codec.url_list || [])) {
            if (!u) continue
            const type = /hls|ts|m3u8/i.test(proto) || /\.m3u8/i.test(u) ? 'm3u8'
              : (/flv/i.test(proto) || /\.flv/i.test(u) ? 'flv' : 'live')
            const proxyUrl = `http://127.0.0.1:3400/proxy/stream?url=${encodeURIComponent(u)}`
            addStream(proxyUrl, type, `${title} (${proto}/${fmt.format_name}/${codec.codec_name})`)
            added++
          }
          // base_url + url_info 拼接（HLS 的 base_url 是 .m3u8 相对路径）
          if (codec.base_url && codec.url_info?.length) {
            const info = codec.url_info[0]
            const fullUrl = (info.host || '') + codec.base_url + (info.extra || '')
            if (/^https?:\/\//.test(fullUrl)) {
              const type = /\.m3u8/i.test(codec.base_url) ? 'm3u8'
                : (/\.flv/i.test(codec.base_url) ? 'flv' : 'live')
              const proxyUrl = `http://127.0.0.1:3400/proxy/stream?url=${encodeURIComponent(fullUrl)}`
              addStream(proxyUrl, type, `${title} (${proto}/${fmt.format_name}/${codec.codec_name})`)
              added++
            }
          }
        }
      }
    }
    return added > 0 ? { title } : null
  } catch (e) {
    return null
  }
}

// ===== B站专用解析 =====
// 从 URL 提取 BV 号（支持 bilibili.com/video/BVxxx、b23.tv 短链、av 号）
async function extractBvid(target) {
  // 直接匹配 BV 号
  let m = target.match(/\/video\/(BV\w+)/i)
  if (m) return m[1]
  // 匹配 av 号 → 需要后续转 BV
  m = target.match(/\/video\/av(\d+)/i)
  if (m) return { aid: m[1] }
  // b23.tv 短链：跟随重定向获取最终 URL
  if (/b23\.tv/i.test(target)) {
    try {
      let current = target
      for (let i = 0; i < 5; i++) {
        const r = await axios.get(current, { maxRedirects: 0, validateStatus: () => true, timeout: 10000, headers: { 'User-Agent': PARSE_UA } })
        if (r.status >= 300 && r.status < 400 && r.headers.location) {
          current = r.headers.location
          const bm = current.match(/\/video\/(BV\w+)/i)
          if (bm) return bm[1]
        } else { break }
      }
    } catch (e) {}
  }
  return null
}

// 调用 B站 API 解析视频流
async function parseBilibili(target, addStream) {
  const bvidInfo = await extractBvid(target)
  if (!bvidInfo) return null

  // 带上已登录的 Cookie（提升画质，大会员可解锁 4K/1080P+）
  const biliCookies = loadBiliCookie()
  const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
  const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
  if (isLoggedIn) {
    biliHeaders['Cookie'] = biliCookieString(biliCookies)
  }
  let bvid = null

  // av 号转 BV 号
  if (typeof bvidInfo === 'object' && bvidInfo.aid) {
    try {
      const r = await axios.get(`https://api.bilibili.com/x/web-interface/view?id=${bvidInfo.aid}`, { headers: biliHeaders, timeout: 10000 })
      if (r.data?.code === 0) bvid = r.data.data.bvid
    } catch (e) { return null }
  } else {
    bvid = bvidInfo
  }
  if (!bvid) return null

  // 获取视频信息（cid、标题、封面）
  let viewData
  try {
    const r = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: biliHeaders, timeout: 10000 })
    if (r.data?.code !== 0) return null
    viewData = r.data.data
  } catch (e) { return null }

  const { cid, title } = viewData
  const pageTitle = title
  const qualityMap = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P' }
  const loggedInfo = isLoggedIn ? '（已登录）' : '（未登录·仅低画质）'
  let addedAny = false

  // === 1. 登录后优先尝试 DASH 格式（fnval=16），可获取 4K/1080P+ 高画质（音视频分离）===
  // B站对 durl(fnval=1) 限制了高画质，登录用户的高画质必须走 DASH（音视频分离）
  // 下载时由下载管理器自动用 ffmpeg 合并 video+audio 成有声 mp4
  if (isLoggedIn) {
    try {
      const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
        params: { bvid, cid, qn: 127, fnval: 16, fourk: 1 },
        headers: biliHeaders,
        timeout: 10000
      })
      if (r.data?.code === 0 && r.data.data?.dash) {
        const dash = r.data.data.dash
        // 取最高音质的 audio（按 id 降序），下载时与 video 合并
        const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
        const bestAudio = audios[0]
        const audioUrl = bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : ''
        // 视频流按 id 降序（高画质在前），同时去重相同 id（不同码率备份）
        const videos = (dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
        const seenQ = new Set()
        videos.forEach(v => {
          if (seenQ.has(v.id)) return
          seenQ.add(v.id)
          const qLabel = qualityMap[v.id] || `${v.id}P`
          addStream(v.baseUrl || v.base_url, 'mp4', `${title} [${qLabel} 高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
          addedAny = true
        })
      }
    } catch (e) {}
  }

  // === 2. 请求 durl 格式（fnval=1），完整音视频流（有声，画质取决于登录状态）===
  try {
    const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
      params: { bvid, cid, qn: 127, fnval: 1, fourk: 1 },
      headers: biliHeaders,
      timeout: 10000
    })
    if (r.data?.code === 0 && r.data.data?.durl) {
      const durl = r.data.data.durl
      const quality = r.data.data.quality
      const qLabel = qualityMap[quality] || `${quality}P`
      durl.forEach((d, i) => {
        const partTitle = durl.length > 1
          ? `${title} - 第${i + 1}段/共${durl.length}段 [${qLabel} 完整·有声]${loggedInfo}`
          : `${title} [${qLabel} 完整·有声]${loggedInfo}`
        addStream(d.url, 'mp4', partTitle, { bili: true })
      })
      addedAny = true
    }
  } catch (e) {}

  // === 3. 降级：尝试不同清晰度的 durl ===
  if (!addedAny) {
    for (const qn of [80, 64, 32, 16]) {
      try {
        const r = await axios.get('https://api.bilibili.com/x/player/playurl', {
          params: { bvid, cid, qn, fnval: 1, fourk: 0 },
          headers: biliHeaders,
          timeout: 10000
        })
        if (r.data?.code === 0 && r.data.data?.durl) {
          const durl = r.data.data.durl
          const quality = r.data.data.quality
          const qLabel = qualityMap[quality] || `${quality}P`
          durl.forEach((d, i) => {
            const partTitle = durl.length > 1
              ? `${title} - 第${i + 1}段/共${durl.length}段 [${qLabel}]${loggedInfo}`
              : `${title} [${qLabel}]${loggedInfo}`
            addStream(d.url, 'mp4', partTitle, { bili: true })
          })
          addedAny = true
          break
        }
      } catch (e) {}
    }
  }

  return addedAny ? { title: pageTitle } : null
}

// ===== B站番剧/电影解析 =====
// 番剧/电影 URL 格式：
//   https://www.bilibili.com/bangumi/play/ep737427/   (ep_id)
//   https://www.bilibili.com/bangumi/play/ss12956/    (season_id)
// 走 /pgc/ API 域名，与普通视频 /x/ 不同；返回字段为 result（普通视频是 data）
// 提取番剧 ep_id 或 season_id（含 b23.tv 短链跳转）
async function extractBangumiId(target) {
  let m = target.match(/\/bangumi\/play\/ep(\d+)/i)
  if (m) return { epId: m[1] }
  m = target.match(/\/bangumi\/play\/ss(\d+)/i)
  if (m) return { seasonId: m[1] }
  // b23.tv 短链：跟随重定向获取最终 URL
  if (/b23\.tv/i.test(target)) {
    try {
      let current = target
      for (let i = 0; i < 5; i++) {
        const r = await axios.get(current, { maxRedirects: 0, validateStatus: () => true, timeout: 10000, headers: { 'User-Agent': PARSE_UA } })
        if (r.status >= 300 && r.status < 400 && r.headers.location) {
          current = r.headers.location
          const em = current.match(/\/bangumi\/play\/ep(\d+)/i)
          if (em) return { epId: em[1] }
          const sm = current.match(/\/bangumi\/play\/ss(\d+)/i)
          if (sm) return { seasonId: sm[1] }
        } else { break }
      }
    } catch (e) {}
  }
  return null
}

// 调用 B站番剧 API 解析视频流
async function parseBilibiliBangumi(target, addStream) {
  const idInfo = await extractBangumiId(target)
  if (!idInfo) return null

  const biliCookies = loadBiliCookie()
  const isLoggedIn = !!(biliCookies && biliCookies.SESSDATA)
  const biliHeaders = { 'User-Agent': PARSE_UA, 'Referer': 'https://www.bilibili.com/' }
  if (isLoggedIn) biliHeaders['Cookie'] = biliCookieString(biliCookies)

  // 1. 获取 season 信息和剧集列表
  let seasonData
  try {
    const params = idInfo.epId ? { ep_id: idInfo.epId } : { season_id: idInfo.seasonId }
    const r = await axios.get('https://api.bilibili.com/pgc/view/web/season', {
      params, headers: biliHeaders, timeout: 15000, validateStatus: () => true
    })
    if (r.data?.code !== 0) return null
    seasonData = r.data.result
  } catch (e) { return null }

  const title = seasonData.title || 'B站番剧'
  const episodes = seasonData.episodes || []
  if (episodes.length === 0) return null

  // 找到目标 ep（如果是 ep_id 则直接匹配，否则用第一个）
  let targetEp = null
  if (idInfo.epId) {
    targetEp = episodes.find(e => String(e.id) === idInfo.epId)
  }
  if (!targetEp) targetEp = episodes[0]

  const qualityMap = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P高码率', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P' }
  const loggedInfo = isLoggedIn ? '（已登录）' : '（未登录·仅低画质）'
  const epTitle = `${title} 第${targetEp.title}话${targetEp.long_title ? ' ' + targetEp.long_title : ''}`.trim()
  let addedAny = false

  // === 1. 登录后优先尝试 DASH 格式（fnval=16），获取高画质（音视频分离）===
  if (isLoggedIn) {
    try {
      const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
        params: { ep_id: targetEp.id, cid: targetEp.cid, qn: 127, fnval: 16, fourk: 1 },
        headers: biliHeaders, timeout: 15000, validateStatus: () => true
      })
      if (r.data?.code === 0 && r.data.result?.dash) {
        const dash = r.data.result.dash
        const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
        const bestAudio = audios[0]
        const audioUrl = bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : ''
        const videos = (dash.video || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0))
        const seenQ = new Set()
        videos.forEach(v => {
          if (seenQ.has(v.id)) return
          seenQ.add(v.id)
          const qLabel = qualityMap[v.id] || `${v.id}P`
          addStream(v.baseUrl || v.base_url, 'mp4', `${epTitle} [${qLabel} 高画质·下载自动合并音频]${loggedInfo}`, { audioUrl, bili: true })
          addedAny = true
        })
      }
    } catch (e) {}
  }

  // === 2. 请求 durl 格式（fnval=1），完整音视频流（有声，画质取决于登录状态）===
  try {
    const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
      params: { ep_id: targetEp.id, cid: targetEp.cid, qn: 127, fnval: 1, fourk: 1 },
      headers: biliHeaders, timeout: 15000, validateStatus: () => true
    })
    if (r.data?.code === 0 && r.data.result?.durl) {
      const durl = r.data.result.durl
      const quality = r.data.result.quality
      const qLabel = qualityMap[quality] || `${quality}P`
      durl.forEach((d, i) => {
        const partTitle = durl.length > 1
          ? `${epTitle} - 第${i + 1}段/共${durl.length}段 [${qLabel} 完整·有声]${loggedInfo}`
          : `${epTitle} [${qLabel} 完整·有声]${loggedInfo}`
        addStream(d.url, 'mp4', partTitle, { bili: true })
      })
      addedAny = true
    }
  } catch (e) {}

  // === 3. 降级：尝试不同清晰度的 durl ===
  if (!addedAny) {
    for (const qn of [80, 64, 32, 16]) {
      try {
        const r = await axios.get('https://api.bilibili.com/pgc/player/web/playurl', {
          params: { ep_id: targetEp.id, cid: targetEp.cid, qn, fnval: 1, fourk: 0 },
          headers: biliHeaders, timeout: 15000, validateStatus: () => true
        })
        if (r.data?.code === 0 && r.data.result?.durl) {
          const durl = r.data.result.durl
          const quality = r.data.result.quality
          const qLabel = qualityMap[quality] || `${quality}P`
          durl.forEach((d, i) => {
            const partTitle = durl.length > 1
              ? `${epTitle} - 第${i + 1}段/共${durl.length}段 [${qLabel}]${loggedInfo}`
              : `${epTitle} [${qLabel}]${loggedInfo}`
            addStream(d.url, 'mp4', partTitle, { bili: true })
          })
          addedAny = true
          break
        }
      } catch (e) {}
    }
  }

  return addedAny ? { title: epTitle } : null
}

// ===== Twitch 直播流解析 =====
// Twitch 直播使用 HLS (m3u8) 格式，但需要 token+sig 才能访问 usher.ttvnw.net
// 解析流程：
//   1. 从 URL 提取频道名（twitch.tv/blastpremier → blastpremier）
//   2. 通过 GraphQL API 获取 streamPlaybackAccessToken（token + signature）
//   3. 构造 usher.ttvnw.net/api/channel/hls/{channel}.m3u8 URL 获取主播放列表
//   4. 主播放列表包含多个变体流（不同分辨率），每个变体流是独立的 m3u8
// 关键：使用 playerType="embed"（嵌入式播放器）获取 token，不插入前贴片广告
async function parseTwitch(target, addStream) {
  // 1. 提取频道名
  let channel = ''
  let m = target.match(/twitch\.tv\/([A-Za-z0-9_]+)/i)
  if (m) channel = m[1]
  if (!channel) return null
  // 排除 Twitch 的特殊路径
  if (['directory', 'following', 'downloads', 'jobs', 'turbo', 'p', 'clips', 'videos', 'search'].includes(channel.toLowerCase())) {
    return null
  }

  // 2. 通过 GraphQL 获取 streamPlaybackAccessToken
  // 使用 playerType="embed"（嵌入式播放器），不插入前贴片广告
  // 同时尝试 "embed" 和 "site" 两个 playerType，embed 优先（无广告）
  let token = '', sig = ''
  for (const playerType of ['embed', 'site']) {
    try {
      const r = await axios.post('https://gql.twitch.tv/gql', {
        operationName: 'PlaybackAccessToken_Live',
        query: `query PlaybackAccessToken_Live($login: String!, $playerType: String!) {
                    streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) {
                        value signature
                    }
                }`,
        variables: {
          login: channel,
          playerType: playerType
        }
      }, {
        headers: {
          'User-Agent': PARSE_UA,
          'Client-ID': TWITCH_CLIENT_ID,
          'Content-Type': 'application/json'
        },
        timeout: 15000, validateStatus: () => true
      })
      const data = r.data?.data?.streamPlaybackAccessToken
      if (data?.value && data?.signature) {
        token = data.value
        sig = data.signature
        break  // 成功获取，跳出循环
      }
    } catch (e) {}
  }
  if (!token || !sig) return null

  // 3. 构造 usher.ttvnw.net HLS 主播放列表 URL
  const p = Math.floor(Math.random() * 999999)
  const hlsUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?player=twitchweb&token=${encodeURIComponent(token)}&sig=${sig}&allow_source=true&allow_audio_only=true&p=${p}&supported_codecs=avc1&fast_bread=true`

  // 4. 获取主播放列表，解析变体流
  let mainM3u8 = ''
  try {
    const r = await axios.get(hlsUrl, {
      headers: { 'User-Agent': PARSE_UA },
      timeout: 15000, validateStatus: () => true
    })
    if (r.status !== 200 || !r.data) return null
    mainM3u8 = r.data
  } catch (e) { return null }

  // 解析 #EXT-X-STREAM-INF 行 + 下一行的 URL
  const variants = []
  const lines = mainM3u8.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const url = (lines[i + 1] || '').trim()
      if (!url) continue
      // 提取分辨率和码率
      const resMatch = line.match(/RESOLUTION=([^,]+)/)
      const bwMatch = line.match(/BANDWIDTH=(\d+)/)
      const nameMatch = line.match(/NAME="([^"]+)"/)
      const codecsMatch = line.match(/CODECS="([^"]+)"/)
      const resolution = resMatch ? resMatch[1] : ''
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0
      const name = nameMatch ? nameMatch[1] : ''
      const codecs = codecsMatch ? codecsMatch[1] : ''
      variants.push({ url, resolution, bandwidth, name, codecs })
    }
  }

  if (variants.length === 0) return null

  // 按码率降序排序（高画质优先）
  variants.sort((a, b) => b.bandwidth - a.bandwidth)

  // 解析分辨率生成清晰度标签
  const makeLabel = (v) => {
    let label = v.name || ''
    if (v.resolution) {
      // 1920x1080 → 1080P
      const h = v.resolution.split('x')[1]
      if (h) label = label || `${h}P`
    }
    if (!label && v.bandwidth) {
      label = `${Math.round(v.bandwidth / 1000)}kbps`
    }
    return label || '未知'
  }

  const title = `Twitch - ${channel}`

  variants.forEach(v => {
    addStream(v.url, `twitch_${v.resolution || v.name}`, `${title} [${makeLabel(v)}]`)
  })

  // 同时也添加官方 iframe 作为备选（防 403 兜底）
  addStream(`https://www.twitch.tv/${channel}`, 'twitch_iframe', `${title} [官方备用通道 (带广告)]`)

  return { title }
}

// ===== 虎牙直播流解析 =====
// 虎牙直播页面内嵌 stream: [{ gameLiveInfo, gameStreamInfoList }]
// 每个 gameStreamInfo 含 sFlvUrl/sStreamName/sFlvAntiCode/sHlsUrl/sHlsAntiCode
// 直接拼接即可得到 FLV 和 HLS 直播流地址（无需签名计算）
async function parseHuya(target, addStream) {
  // 1. 提取房间号（支持 huya.com/123 或 huya.com/xxx）
  let m = target.match(/huya\.com\/([A-Za-z0-9_]+)/i)
  if (!m) return null
  const room = m[1]

  // 2. 获取页面 HTML
  let html = ''
  try {
    const r = await axios.get(`https://www.huya.com/${room}`, {
      headers: { 'User-Agent': PARSE_UA, 'Referer': 'https://www.huya.com/' },
      timeout: 15000, validateStatus: () => true
    })
    html = r.data || ''
  } catch (e) { return null }
  if (!html) return null

  // 3. 用括号平衡匹配提取 stream: [...]
  const idx = html.indexOf('stream:')
  if (idx < 0) return null
  const startArr = html.indexOf('[', idx)
  if (startArr < 0) return null
  let depth = 0, inStr = false, esc = false, quote = '', end = -1
  for (let i = startArr; i < html.length; i++) {
    const c = html[i]
    if (esc) { esc = false; continue }
    if (inStr) {
      if (c === '\\') esc = true
      else if (c === quote) inStr = false
    } else {
      if (c === '"' || c === "'") { inStr = true; quote = c }
      else if (c === '[') depth++
      else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
    }
  }
  if (end < 0) return null

  let streams
  try { streams = JSON.parse(html.slice(startArr, end + 1)) } catch (e) { return null }
  if (!streams || streams.length === 0) return null

  // 4. 提取标题
  const gameLiveInfo = streams[0].gameLiveInfo || {}
  let title = gameLiveInfo.nick || gameLiveInfo.roomName || `虎牙 - ${room}`
  if (gameLiveInfo.gameFullName) title += ` - ${gameLiveInfo.gameFullName}`

  // 5. 遍历 gameStreamInfoList 构造直播流 URL
  const streamInfoList = streams[0].gameStreamInfoList || []
  if (streamInfoList.length === 0) return null

  let addedAny = false
  // CDN 优先级：HS(华为)优先（测试中只有 HS 节点 HLS 返回 200，AL/TX 返回 403）
  // 然后 TX(腾讯) > AL(阿里) > BD
  const cdnPriority = { HS: 0, TX: 1, AL: 2, BD: 3, HW: 4, HX: 5 }
  streamInfoList.sort((a, b) => (cdnPriority[a.sCdnType] ?? 9) - (cdnPriority[b.sCdnType] ?? 9))

  // 优先返回所有 HLS 直播流（HLS 直播流更稳定，hls.js 会自动刷新 playlist 获取新分片）
  for (const info of streamInfoList) {
    const cdn = info.sCdnType || '?'
    const streamName = info.sStreamName
    if (!streamName) continue

    // HLS 直播流（优先返回，直播流 hls.js 会自动刷新 playlist）
    if (info.sHlsUrl && info.sHlsAntiCode) {
      const hlsUrl = `${info.sHlsUrl}/${streamName}.${info.sHlsUrlSuffix || 'm3u8'}?${info.sHlsAntiCode}`
      addStream(hlsUrl, 'm3u8', `${title} [HLS ${cdn}节点 直播]`)
      addedAny = true
    }
  }
  // FLV 作为备选（延迟更低但浏览器播放稳定性不如 HLS）
  for (const info of streamInfoList) {
    const cdn = info.sCdnType || '?'
    const streamName = info.sStreamName
    if (!streamName) continue
    if (info.sFlvUrl && info.sFlvAntiCode) {
      const flvUrl = `${info.sFlvUrl}/${streamName}.${info.sFlvUrlSuffix || 'flv'}?${info.sFlvAntiCode}`
      addStream(flvUrl, 'flv', `${title} [FLV ${cdn}节点 直播]`)
      addedAny = true
    }
  }

  return addedAny ? { title } : null
}

// ===== 快手视频解析 =====
// 注意：纯 Node.js 无 BrowserWindow，仅支持 SSR 提取；新版页面可能无法解析。
async function parseKuaishou(target, addStream) {
  let title = ''
  let added = 0
  try {
    const res = await axios.get(target, {
      headers: {
        'User-Agent': PARSE_UA,
        'Referer': 'https://www.kuaishou.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      responseType: 'text',
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 5
    })
    const html = res.data || ''
    if (html) {
      const tm = html.match(/<title>([^<]*)<\/title>/i)
      if (tm) title = tm[1].replace(/ - 快手.*$/, '').trim()
      // 提取 __APOLLO_STATE__：兼容 `;(function(){...}());</script>` 结尾
      let apollo = null
      const m1 = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/)
      if (m1) {
        try { apollo = JSON.parse(m1[1]) } catch (e) {}
      }
      // 兜底：用括号平衡匹配
      if (!apollo) {
        const idx = html.indexOf('__APOLLO_STATE__')
        if (idx >= 0) {
          const start = html.indexOf('{', idx)
          if (start > 0) {
            let depth = 0, inStr = false, esc = false, quote = '', end = -1
            for (let i = start; i < html.length; i++) {
              const c = html[i]
              if (esc) { esc = false; continue }
              if (inStr) {
                if (c === '\\') esc = true
                else if (c === quote) inStr = false
              } else {
                if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c }
                else if (c === '{') depth++
                else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
              }
            }
            if (end > 0) {
              try { apollo = JSON.parse(html.slice(start, end + 1)) } catch (e) {}
            }
          }
        }
      }
      // 提取 __INITIAL_STATE__
      let initState = null
      const m2 = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/)
      if (m2) {
        try { initState = JSON.parse(m2[1]) } catch (e) {}
      }
      const tryAdd = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 8) return
        if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.url)) {
          const u = obj.url.replace(/\\\//g, '/')
          // 排除快手 UI 资源图片
          if (!/\.png|\.jpg|\.svg|\.webp/i.test(u)) {
            const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
            addStream(u, type, title)
            added++
          }
        }
        if (typeof obj.mainMvUrls === 'object' && Array.isArray(obj.mainMvUrls)) {
          for (const item of obj.mainMvUrls) {
            if (item?.url) tryAdd(item, depth + 1)
          }
        }
        if (typeof obj.playUrl === 'string' && /^https?:\/\//.test(obj.playUrl)) tryAdd({ url: obj.playUrl }, depth + 1)
        if (typeof obj.photoUrl === 'string' && /^https?:\/\//.test(obj.photoUrl)) tryAdd({ url: obj.photoUrl }, depth + 1)
        for (const k of Object.keys(obj)) {
          if (['url', 'mainMvUrls', 'playUrl', 'photoUrl'].includes(k)) continue
          const v = obj[k]
          if (v && typeof v === 'object') tryAdd(v, depth + 1)
        }
      }
      if (apollo) tryAdd(apollo, 0)
      if (initState) tryAdd(initState, 0)
      // 兜底：正则提取 mp4/m3u8 直链（排除 UI 资源）
      if (added === 0) {
        const vm = html.match(/"(https?:\/\/[^"]*(?:kwai|kwaixia|gifshow|ksv|kscube|kslive)[^"]*\.(?:mp4|m3u8|flv)[^"]*)"/i)
        if (vm) { addStream(vm[1].replace(/\\\//g, '/'), /\.m3u8/i.test(vm[1]) ? 'm3u8' : 'mp4', title); added++ }
      }
    }
  } catch (e) {}

  // SSR 没抓到 → 原 Electron 会用隐藏 BrowserWindow 渲染后抓取，纯 Node 无此能力
  if (added === 0) {
    console.warn('[VideoParse] 快手 SSR 提取失败，纯 Node.js 无 BrowserWindow，无法渲染页面抓取视频')
  }
  return added > 0 ? { title } : null
}

// ===== 抖音视频解析 =====
// 注意：纯 Node.js 无 BrowserWindow，仅支持 SSR 提取；新版抖音页面通常无法解析。
async function parseDouyin(target, addStream) {
  let title = ''
  let added = 0
  try {
    // 先跟随短链接跳转，拿到真实 URL（提取 aweme_id 并获取页面标题）
    const res = await axios.get(target, {
      headers: {
        'User-Agent': PARSE_UA,
        'Referer': 'https://www.douyin.com/',
        'Cookie': 'msToken=abcdef0123456789; ttwid=1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      responseType: 'text',
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 10
    })
    const html = res.data || ''
    if (html) {
      const tm = html.match(/<title>([^<]*)<\/title>/i)
      if (tm) title = tm[1].replace(/ - 抖音.*$/, '').replace(/【.*?】/g, '').trim()
      // 兼容旧版页面：尝试 _ROUTER_DATA / RENDER_DATA
      let routerData = null
      const m1 = html.match(/<script[^>]*id="_ROUTER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
      if (m1) {
        try { routerData = JSON.parse(m1[1].trim()) } catch (e) {}
      }
      if (!routerData) {
        const m2 = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i)
        if (m2) {
          try { routerData = JSON.parse(decodeURIComponent(m2[1].trim())) } catch (e) {}
        }
      }
      const tryAdd = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 8) return
        if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.url)) {
          const u = obj.url.replace(/\\\//g, '/')
          const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
          addStream(u, type, title)
          added++
        }
        if (Array.isArray(obj.url_list)) {
          for (const u of obj.url_list) {
            if (typeof u === 'string' && /^https?:\/\//.test(u)) tryAdd({ url: u }, depth + 1)
          }
        }
        if (typeof obj.play_addr === 'object') tryAdd(obj.play_addr, depth + 1)
        if (typeof obj.playApi === 'string' && /^https?:\/\//.test(obj.playApi)) tryAdd({ url: obj.playApi }, depth + 1)
        for (const k of Object.keys(obj)) {
          if (['url', 'url_list', 'play_addr', 'playApi'].includes(k)) continue
          const v = obj[k]
          if (v && typeof v === 'object') tryAdd(v, depth + 1)
        }
      }
      if (routerData) tryAdd(routerData, 0)
      // 兜底：正则提取直链
      if (added === 0) {
        const vm = html.match(/"(https?:\/\/[^"]*(?:douyinvod|douyin\.com|bytecdn|bytedance|ixigua)[^"]*\.(?:mp4|m3u8)[^"]*)"/i)
        if (vm) { addStream(vm[1].replace(/\\\//g, '/'), 'mp4', title); added++ }
        if (added === 0) {
          const vm2 = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/i)
          if (vm2) { addStream(vm2[1].replace(/\\\//g, '/'), 'mp4', title); added++ }
        }
      }
    }
  } catch (e) {}

  // SSR 没抓到 → 原 Electron 会用隐藏 BrowserWindow 渲染后抓取，纯 Node 无此能力
  if (added === 0) {
    console.warn('[VideoParse] 抖音 SSR 提取失败，纯 Node.js 无 BrowserWindow，无法渲染页面抓取视频')
  }
  return added > 0 ? { title } : null
}

// ===== 斗鱼直播流解析 =====
// 注意：纯 Node.js 无 BrowserWindow，斗鱼的新签名算法需要 Chromium 执行加密 JS，
//       因此此函数始终返回 null（原 Electron 版本通过隐藏窗口网络拦截获取视频流）
async function parseDouyu(target, addStream) {
  console.warn('[VideoParse] 斗鱼直播解析在纯 Node.js 环境下不可用（需要 BrowserWindow 执行加密 JS）')
  return null
}

// ===== 对外接口：video:parse-url =====
async function parseVideoUrl(url) {
  try {
    const target = String(url || '').trim()
    if (!/^https?:\/\//i.test(target)) {
      return { success: false, message: '请输入以 http:// 或 https:// 开头的网址' }
    }

    const found = new Map()  // url -> {url, type, title, audioUrl?}
    const addStream = (u, type, title, extra = {}) => {
      let clean = String(u).replace(/\\\//g, '/').replace(/&amp;/g, '&').trim()
      if (clean.startsWith('//')) clean = 'https:' + clean
      else if (clean.startsWith('/')) {
        try { clean = new URL(target).origin + clean } catch (e) { return }
      }
      if (!/^https?:\/\//i.test(clean)) return
      if (found.has(clean)) return
      const item = { url: clean, type, title: title || '' }
      // 透传 DASH 音频地址（用于下载时 ffmpeg 合并）等附加字段
      if (extra.audioUrl) item.audioUrl = extra.audioUrl
      if (extra.bili) item.bili = true
      found.set(clean, item)
    }

    // === 虎牙直播解析 ===
    if (/huya\.com/i.test(target)) {
      const hyResult = await parseHuya(target, addStream)
      if (hyResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: hyResult.title || '', pageUrl: target, isLive: true }
      }
      return { success: false, message: '未能解析虎牙直播流（可能未开播或房间号无效）', pageUrl: target }
    }

    // === 斗鱼直播解析 ===
    if (/douyu\.com/i.test(target) && !/v\.douyu\.com/i.test(target)) {
      const dyResult = await parseDouyu(target, addStream)
      if (dyResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: dyResult.title || '', pageUrl: target, isLive: true }
      }
      return { success: false, message: '未能解析斗鱼直播流（纯 Node 环境下不支持，需要 BrowserWindow 执行加密 JS）', pageUrl: target }
    }

    // === Twitch 直播解析 ===
    if (/twitch\.tv/i.test(target)) {
      const twResult = await parseTwitch(target, addStream)
      if (twResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: twResult.title || '', pageUrl: target, isLive: true }
      }
      return { success: false, message: '未能解析 Twitch 直播流（可能未开播或频道名无效）', pageUrl: target }
    }

    // === B站解析（区分视频 / 直播 / 番剧/电影）===
    if (/bilibili\.com|b23\.tv/i.test(target)) {
      // 直播间：live.bilibili.com/xxx
      if (/live\.bilibili\.com\/\d+/i.test(target)) {
        const liveResult = await parseBilibiliLive(target, addStream)
        if (liveResult) {
          const streams = Array.from(found.values())
          return { success: true, streams, pageTitle: liveResult.title || '', pageUrl: target }
        }
        return { success: false, message: '未能解析 B站直播间（可能未开播或需登录）', pageUrl: target }
      }
      // 番剧/电影：bangumi/play/epXXX 或 ssXXX
      if (/\/bangumi\/play\//i.test(target) || /b23\.tv/i.test(target)) {
        const bgmResult = await parseBilibiliBangumi(target, addStream)
        if (bgmResult) {
          const streams = Array.from(found.values())
          return { success: true, streams, pageTitle: bgmResult.title || '', pageUrl: target }
        }
        // b23.tv 短链既可能指向番剧也可能指向普通视频，番剧解析失败时继续走普通视频分支
        if (!/\/bangumi\/play\//i.test(target)) {
          // fall through 到普通视频解析
        } else {
          return { success: false, message: '未能解析 B站番剧（可能需要登录、区域限制或为付费内容）', pageUrl: target }
        }
      }
      // 普通视频
      const biliResult = await parseBilibili(target, addStream)
      if (biliResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: biliResult.title || '', pageUrl: target }
      }
    }

    // === 快手视频解析 ===
    if (/kuaishou\.com/i.test(target)) {
      const ksResult = await parseKuaishou(target, addStream)
      if (ksResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: ksResult.title || '', pageUrl: target }
      }
    }

    // === 抖音视频解析 ===
    if (/douyin\.com|iesdouyin\.com/i.test(target)) {
      const dyResult = await parseDouyin(target, addStream)
      if (dyResult) {
        const streams = Array.from(found.values())
        return { success: true, streams, pageTitle: dyResult.title || '', pageUrl: target }
      }
    }

    // === 通用 HTML 解析 ===
    const res = await axios.get(target, {
      headers: {
        'User-Agent': PARSE_UA,
        'Referer': target,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      responseType: 'text',
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 5
    })
    const html = res.data || ''
    if (!html) return { success: false, message: '页面内容为空' }

    // 1. maccms player_aaaa JSON（最常见，url 字段多为 m3u8 直链）
    const pm = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
    if (pm) {
      try {
        const player = JSON.parse(pm[1])
        if (player.url && /^https?:\/\//.test(player.url)) {
          const u = String(player.url).replace(/\\\//g, '/')
          const isM3u8 = /\.m3u8/i.test(u)
          addStream(u, isM3u8 ? 'm3u8' : 'iframe', player.title || '')
        }
      } catch (e) { /* 降级到正则 */ }
    }

    // 2. 正则提取所有 m3u8
    const m3u8Matches = html.matchAll(/["'](https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)["']/gi)
    for (const m of m3u8Matches) addStream(m[1], 'm3u8', '')

    // 3. 正则提取所有视频直链（支持任何视频格式）
    const videoExts = 'mp4|webm|flv|avi|mkv|mov|wmv|m4v|ts|mpg|mpeg|mpe|3gp|asf|f4v|ogv|mts|m2ts|vob|rm|rmvb|ts'
    const videoMatches = html.matchAll(new RegExp(`["'](https?://[^"'\\s<>]+\\.(?:${videoExts})(?:[?#][^"'\\s<>]*)?)["']`, 'gi'))
    for (const m of videoMatches) {
      const u = m[1]
      const ext = u.match(/\.(\w+)(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'mp4'
      addStream(u, ext, '')
    }

    // 4. iframe 播放器源（含 player/dplayer/m3u8 关键字）
    const iframeMatches = html.matchAll(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi)
    for (const m of iframeMatches) {
      let src = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&')
      if (src.startsWith('//')) src = 'https:' + src
      else if (src.startsWith('/')) {
        try { src = new URL(target).origin + src } catch (e) { continue }
      }
      if (/player|dplayer|url=|\.m3u8/i.test(src)) addStream(src, 'iframe', '')
    }

    // 5. 嵌入式 JSON 深度提取（__INITIAL_STATE__/__NUXT__/__APP_DATA__/__PRELOADED_STATE__ 等）
    //    递归遍历 JSON 树，提取所有视频直链（覆盖微博/西瓜/小红书等 SSR 站点）
    const jsonVarPatterns = [
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
      /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
      /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
      /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
      /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
      /window\._SSR_DATA_\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/
    ]
    const scanVideoUrls = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 7) return
      if (typeof obj.url === 'string' && /^https?:\/\/.+/.test(obj.url) && /\.(mp4|m3u8|flv|ts|webm)(\?|$|#)/i.test(obj.url)) {
        const u = obj.url.replace(/\\\//g, '/')
        const type = /\.m3u8/i.test(u) ? 'm3u8' : (/\.flv/i.test(u) ? 'flv' : 'mp4')
        addStream(u, type, '')
      }
      if (Array.isArray(obj.url_list)) {
        for (const u of obj.url_list) {
          if (typeof u === 'string' && /^https?:\/\/.+/.test(u) && /\.(mp4|m3u8|flv|ts|webm)(\?|$|#)/i.test(u)) {
            const clean = u.replace(/\\\//g, '/')
            const type = /\.m3u8/i.test(clean) ? 'm3u8' : (/\.flv/i.test(clean) ? 'flv' : 'mp4')
            addStream(clean, type, '')
          }
        }
      }
      if (typeof obj.playUrl === 'string' && /^https?:\/\/.+/.test(obj.playUrl) && /\.(mp4|m3u8|flv)(\?|$|#)/i.test(obj.playUrl)) {
        addStream(obj.playUrl.replace(/\\\//g, '/'), /\.m3u8/i.test(obj.playUrl) ? 'm3u8' : 'mp4', '')
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        if (v && typeof v === 'object') scanVideoUrls(v, depth + 1)
      }
    }
    for (const pat of jsonVarPatterns) {
      const jm = html.match(pat)
      if (jm) {
        try { scanVideoUrls(JSON.parse(jm[1]), 0) } catch (e) {}
      }
    }

    const streams = Array.from(found.values())
    // 获取页面标题作为默认名
    let pageTitle = ''
    const tm = html.match(/<title>([^<]*)<\/title>/i)
    if (tm) pageTitle = tm[1].trim()
    return { success: true, streams, pageTitle, pageUrl: target }
  } catch (e) {
    return { success: false, message: e.message || '解析失败' }
  }
}

export {
  parseVideoUrl,
  parseBilibili,
  parseBilibiliLive,
  parseBilibiliBangumi,
  parseTwitch,
  parseHuya,
  parseKuaishou,
  parseDouyin,
  parseDouyu
}
