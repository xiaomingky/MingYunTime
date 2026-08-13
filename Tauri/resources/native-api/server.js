// native-api/server.js
// HTTP 服务（端口 3400，监听 127.0.0.1）
// 封装原 Electron 项目中的复杂模块逻辑，供 Tauri 版应用通过 HTTP 调用
//
// 模块组成：
//   - lyric-providers.js + tripledes.js  (歌词)
//   - anime.js                          (动漫)
//   - anime-meta.js                     (Bangumi 元信息)
//   - movie.js                          (影视)
//   - bilibili.js                       (B站登录)
//   - video-parse.js                    (视频解析)
//   - ncm.js                            (网易云 MV 搜索)
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

import { searchMultiPlatform, fetchLyricByCandidate, searchAndFetchQQ, getKugouLyric } from './lyric-providers.js'
import { SOURCES as ANIME_SOURCES, getHome as animeGetHome, search as animeSearch, getDetail as animeGetDetail, parsePlay as animeParsePlay } from './anime.js'
import { metaSearch as animeMetaSearch, metaRelated as animeMetaRelated } from './anime-meta.js'
import { SOURCES as MOVIE_SOURCES, getHome as movieGetHome, search as movieSearch, getDetail as movieGetDetail, parsePlay as movieParsePlay } from './movie.js'
import { loginQr as biliLoginQr, loginCheck as biliLoginCheck, loginStatus as biliLoginStatus, logout as biliLogout } from './bilibili.js'
import { parseVideoUrl } from './video-parse.js'
import { ncmMvSearch } from './ncm.js'

const PORT = parseInt(process.env.NATIVE_API_PORT || '3400', 10)
const HOST = process.env.NATIVE_API_HOST || '127.0.0.1'

// ===== 工具函数 =====

// 读取请求 body（JSON）
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      if (!buf.length) return resolve({})
      try {
        resolve(JSON.parse(buf.toString('utf-8')))
      } catch (e) {
        reject(new Error('请求 body 不是合法的 JSON'))
      }
    })
    req.on('error', reject)
  })
}

// 发送 JSON 响应
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(body)
}

// 发送错误响应
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message })
}

// 从查询字符串中取值
function getQuery(urlObj, key) {
  return urlObj.searchParams.get(key) || ''
}

// 包装异步 handler：统一异常处理
function wrapHandler(fn) {
  return async (req, res, urlObj, body) => {
    try {
      const result = await fn(req, res, urlObj, body)
      return result
    } catch (e) {
      sendError(res, 500, e.message || '服务器内部错误')
    }
  }
}

// ===== 路由表 =====
// 每个路由：{ method, pattern, handler }
// pattern 可以是字符串（精确匹配 pathname）或 RegExp（match 后通过 urlObj 取参数）
const routes = []

function addRoute(method, pathname, handler) {
  routes.push({ method, pathname, handler: wrapHandler(handler) })
}

// ---------- 歌词模块 ----------
addRoute('GET', '/lyric/search', async (req, res, urlObj) => {
  const songName = getQuery(urlObj, 'songName')
  const artist = getQuery(urlObj, 'artist')
  if (!songName) return sendError(res, 400, '缺少参数 songName')
  const data = await searchMultiPlatform(songName, artist || undefined)
  sendJson(res, 200, data)
})

addRoute('POST', '/lyric/fetch', async (req, res, urlObj, body) => {
  if (!body || typeof body !== 'object' || !body.candidate) {
    return sendError(res, 400, '请求 body 必须包含 candidate 对象')
  }
  const data = await fetchLyricByCandidate(body.candidate)
  sendJson(res, 200, data)
})

addRoute('GET', '/lyric/qq', async (req, res, urlObj) => {
  const songName = getQuery(urlObj, 'songName')
  const artist = getQuery(urlObj, 'artist')
  const durationStr = getQuery(urlObj, 'duration')
  if (!songName) return sendError(res, 400, '缺少参数 songName')
  const duration = durationStr ? parseInt(durationStr, 10) : 0
  const data = await searchAndFetchQQ(songName, artist || undefined, duration || 0)
  sendJson(res, 200, data)
})

addRoute('GET', '/lyric/kugou', async (req, res, urlObj) => {
  const hash = getQuery(urlObj, 'hash')
  if (!hash) return sendError(res, 400, '缺少参数 hash')
  const data = await getKugouLyric(hash)
  sendJson(res, 200, data)
})

// ---------- 动漫模块 ----------
addRoute('GET', '/anime/home', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  // 首页忽略 source 参数，直接故障转移（与原 Electron 一致）
  const data = await animeGetHome()
  sendJson(res, 200, { success: true, data })
})

addRoute('GET', '/anime/search', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  const keyword = getQuery(urlObj, 'keyword')
  if (!keyword) return sendError(res, 400, '缺少参数 keyword')
  // 搜索也故障转移
  const data = await animeSearch(keyword)
  sendJson(res, 200, { success: true, data })
})

addRoute('GET', '/anime/detail', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  const id = getQuery(urlObj, 'id')
  if (!id) return sendError(res, 400, '缺少参数 id')
  if (!source) return sendError(res, 400, '缺少参数 source')
  const data = await animeGetDetail(source, id)
  if (!data) return sendJson(res, 200, { success: false, message: '加载详情失败，请尝试切换线路' })
  sendJson(res, 200, { success: true, data })
})

addRoute('POST', '/anime/parse-playurl', async (req, res, urlObj, body) => {
  if (!body || typeof body !== 'object') return sendError(res, 400, '请求 body 必须是 JSON 对象')
  const { source, episodeUrl, scheme } = body
  if (!source) return sendError(res, 400, '缺少参数 source')
  if (!episodeUrl) return sendError(res, 400, '缺少参数 episodeUrl')
  const data = await animeParsePlay(source, episodeUrl, scheme || 1)
  sendJson(res, 200, data)
})

addRoute('GET', '/anime/sources', async (req, res, urlObj) => {
  sendJson(res, 200, { success: true, data: ANIME_SOURCES })
})

addRoute('GET', '/anime/meta/search', async (req, res, urlObj) => {
  const title = getQuery(urlObj, 'title')
  if (!title) return sendError(res, 400, '缺少参数 title')
  const data = await animeMetaSearch(title)
  sendJson(res, 200, data)
})

addRoute('GET', '/anime/meta/related', async (req, res, urlObj) => {
  const bgmId = getQuery(urlObj, 'bgmId')
  if (!bgmId) return sendError(res, 400, '缺少参数 bgmId')
  const data = await animeMetaRelated(bgmId)
  sendJson(res, 200, data)
})

// ---------- 影视模块 ----------
addRoute('GET', '/movie/home', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  if (!source) return sendError(res, 400, '缺少参数 source')
  const data = await movieGetHome(source)
  sendJson(res, 200, { success: true, data })
})

addRoute('GET', '/movie/search', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  const keyword = getQuery(urlObj, 'keyword')
  if (!source) return sendError(res, 400, '缺少参数 source')
  if (!keyword) return sendError(res, 400, '缺少参数 keyword')
  const data = await movieSearch(source, keyword)
  sendJson(res, 200, { success: true, data })
})

addRoute('GET', '/movie/detail', async (req, res, urlObj) => {
  const source = getQuery(urlObj, 'source')
  const id = getQuery(urlObj, 'id')
  if (!source) return sendError(res, 400, '缺少参数 source')
  if (!id) return sendError(res, 400, '缺少参数 id')
  const data = await movieGetDetail(source, id)
  sendJson(res, 200, { success: true, data })
})

addRoute('POST', '/movie/parse-playurl', async (req, res, urlObj, body) => {
  if (!body || typeof body !== 'object') return sendError(res, 400, '请求 body 必须是 JSON 对象')
  const { source, episodeUrl } = body
  if (!source) return sendError(res, 400, '缺少参数 source')
  if (!episodeUrl) return sendError(res, 400, '缺少参数 episodeUrl')
  const data = await movieParsePlay(source, episodeUrl)
  sendJson(res, 200, data)
})

addRoute('GET', '/movie/sources', async (req, res, urlObj) => {
  sendJson(res, 200, { success: true, data: MOVIE_SOURCES })
})

// ---------- B站模块 ----------
addRoute('GET', '/bilibili/login-qr', async (req, res, urlObj) => {
  const data = await biliLoginQr()
  sendJson(res, 200, data)
})

addRoute('GET', '/bilibili/login-check', async (req, res, urlObj) => {
  const qrcodeKey = getQuery(urlObj, 'qrcodeKey')
  if (!qrcodeKey) return sendError(res, 400, '缺少参数 qrcodeKey')
  const data = await biliLoginCheck(qrcodeKey)
  sendJson(res, 200, data)
})

addRoute('GET', '/bilibili/login-status', async (req, res, urlObj) => {
  const data = await biliLoginStatus()
  sendJson(res, 200, data)
})

addRoute('POST', '/bilibili/logout', async (req, res, urlObj) => {
  const data = await biliLogout()
  sendJson(res, 200, data)
})

// ---------- 视频解析 ----------
addRoute('POST', '/video/parse-url', async (req, res, urlObj, body) => {
  if (!body || typeof body !== 'object') return sendError(res, 400, '请求 body 必须是 JSON 对象')
  const { url } = body
  if (!url) return sendError(res, 400, '缺少参数 url')
  const data = await parseVideoUrl(url)
  sendJson(res, 200, data)
})

// ---------- NCM MV 搜索 ----------
addRoute('GET', '/ncm/mv-search', async (req, res, urlObj) => {
  const keyword = getQuery(urlObj, 'keyword')
  if (!keyword) return sendError(res, 400, '缺少参数 keyword')
  const data = await ncmMvSearch(keyword)
  sendJson(res, 200, data)
})

// ---------- 健康检查 ----------
addRoute('GET', '/health', async (req, res, urlObj) => {
  sendJson(res, 200, { success: true, service: 'native-api', version: '1.0.0' })
})

// ---------- 代理流 (用于解决 B站直播等 Referer 限制) ----------
// 由于不再使用 wrapHandler 处理流式响应，我们手动添加一个特殊路由
routes.push({
  method: 'GET',
  pathname: '/proxy/stream',
  handler: async (req, res, urlObj) => {
    const targetUrl = urlObj.searchParams.get('url')
    if (!targetUrl) return sendError(res, 400, '缺少 url')
    const isTwitch = targetUrl.includes('twitch.tv') || targetUrl.includes('ttvnw.net')
    const referer = urlObj.searchParams.get('referer') || (isTwitch ? 'https://www.twitch.tv/' : 'https://live.bilibili.com/')
    
    try {
      // 动态导入 axios (因为只有这个路由需要)
      const { default: axios } = await import('axios')
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer
      }
      if (isTwitch) {
        headers['Origin'] = 'https://www.twitch.tv'
      }

    const isM3u8 = targetUrl.includes('.m3u8') || targetUrl.includes('playlist')

    if (isM3u8) {
      const response = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'text',
        headers
      })
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      
      let textData = response.data
      if (typeof textData === 'string') {
        textData = textData.split(/\r?\n/).map(line => {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) return line
          try {
            const absUrl = new URL(trimmed, targetUrl).href
            return `http://127.0.0.1:3400/proxy/stream?url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(referer)}`
          } catch (e) {
            return line
          }
        }).join('\n')
      }
      res.writeHead(response.status)
      return res.end(textData)
    }

    const response = await axios({
      method: 'GET',
      url: targetUrl,
      responseType: 'stream',
      headers
    })
      
      // 允许跨域
      res.setHeader('Access-Control-Allow-Origin', '*')
      
      // 透传重要的头部信息
      const headersToPass = ['content-type', 'content-length', 'accept-ranges', 'content-range']
      headersToPass.forEach(h => {
        if (response.headers[h]) {
          res.setHeader(h, response.headers[h])
        }
      })
      
      res.writeHead(response.status)
      response.data.pipe(res)
      
      req.on('close', () => {
        response.data.destroy()
      })
      
    } catch (e) {
      if (!res.headersSent) {
        // Axios 可能会抛出带有 response 的错误，如果是 404 等，尽量返回原状态码
        const status = e.response ? e.response.status : 500
        sendError(res, status, '代理请求失败: ' + e.message)
      }
    }
  }
})

// ===== HTTP 服务 =====
const server = http.createServer(async (req, res) => {
  // 处理 CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    return res.end()
  }

  // 解析 URL
  let urlObj
  try {
    urlObj = new URL(req.url, `http://${HOST}:${PORT}`)
  } catch (e) {
    return sendError(res, 400, '无效的 URL')
  }

  const pathname = urlObj.pathname
  const method = req.method

  // 查找匹配的路由
  const route = routes.find(r => r.method === method && r.pathname === pathname)
  if (!route) {
    return sendError(res, 404, `未找到路由 ${method} ${pathname}`)
  }

  // 读取请求 body（仅 POST 需要）
  let body = {}
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try {
      body = await readBody(req)
    } catch (e) {
      return sendError(res, 400, e.message)
    }
  }

  // 调用 handler
  await route.handler(req, res, urlObj, body)
})

server.on('error', (e) => {
  // 静默处理错误，不输出到 stdout（避免干扰 Tauri 主进程）
  if (e.code === 'EADDRINUSE') {
    // 端口被占用，可能是另一个 native-api 实例已经在运行，直接退出
    process.exit(0)
  }
})

server.listen(PORT, HOST, () => {
  // 不输出到 stdout（避免干扰 Tauri 主进程）
})

// 优雅退出
function shutdown() {
  server.close(() => process.exit(0))
  // 5 秒后强制退出
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)

export { server }
