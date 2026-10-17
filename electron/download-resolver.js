import axios from 'axios'
import cheerio from 'cheerio'

const safeDecode = value => { try { return decodeURIComponent(value) } catch { return value } }
export function safeDownloadName(value) {
  let name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().replace(/[. ]+$/, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name.slice(0, 220)
}
export function parseCDName(value) {
  const cd = String(value || '')
  const extended = cd.match(/filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i)
  if (extended) {
    const raw = (extended[1] ?? extended[2]).trim()
    const parts = raw.match(/^([^']*)'[^']*'(.*)$/)
    if (parts && /^utf-?8$/i.test(parts[1])) {
      const decoded = safeDecode(parts[2])
      if (decoded !== parts[2] || !/%[0-9a-f]{2}/i.test(parts[2])) return safeDownloadName(decoded)
    }
  }
  const plain = cd.match(/filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/i)
  return plain ? safeDownloadName((plain[1] ?? plain[2]).replace(/\\([\\"])/g, '$1')) : ''
}
export function downloadHeaders(value, userAgent) {
  const headers = { 'User-Agent': userAgent }
  if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
  } else if (value && typeof value === 'object') Object.assign(headers, value)
  return headers
}
export function responseDownloadName(response, url) {
  const final = new URL(response.request?.res?.responseUrl || response.request?.res?.responseURL || response.request?.responseURL || url)
  const disposition = parseCDName(response.headers?.['content-disposition'])
  if (disposition) return disposition
  const ct = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
  for (const key of ['response-content-disposition', 'rscd']) { const name = parseCDName(final.searchParams.get(key)); if (name) return name }
  for (const key of ['filename', 'file_name', 'download_name']) { const name = safeDownloadName(final.searchParams.get(key)); if (/\.[a-z0-9]{1,8}$/i.test(name)) return name }
  const base = safeDownloadName(safeDecode(final.pathname.split('/').pop() || ''))
  if (/\.[a-z0-9]{1,8}$/i.test(base) && !/\.(php|aspx?|jsp|cgi|do|action)$/i.test(base)) return base
  const ext = DL_CT_EXT_MAP[ct]
  return ext && ct !== 'text/plain' ? (base || 'download') + ext : ''
}

function stripCrossOriginCredentials(headers, from, to) {
  if (new URL(from).origin !== new URL(to).origin) {
    for (const key of Object.keys(headers)) if (/^(cookie|authorization|proxy-authorization|host)$/i.test(key)) delete headers[key]
  }
}

// Inspect headers first; only read bounded HTML when a landing page needs resolving.
// Never evaluate scripts or guess among multiple download targets.
export async function resolveDownloadLink(input, userAgent, client = axios) {
  const params = typeof input === 'string' ? { url: input } : input || {}
  let url = new URL(params.url).href
  const headers = downloadHeaders(params.headers, userAgent), visited = new Set()
  let redirects = 0, pages = 0
  for (let hop = 0; hop < 15; hop++) {
    if (!/^https?:\/\//i.test(url)) throw Error('仅支持 HTTP / HTTPS 下载链接')
    if (visited.has(url)) throw Error('下载链接重定向循环')
    visited.add(url)
    const response = await client.get(url, { responseType: 'stream', headers, timeout: 15000, maxRedirects: 0, validateStatus: () => true })
    try {
      if ([301,302,303,307,308].includes(response.status) && response.headers?.location) {
        if (++redirects > 8) throw Error('下载链接重定向过多')
        const next = new URL(response.headers.location, url)
        stripCrossOriginCredentials(headers, url, next.href)
        url = next.href
        continue
      }
      if (response.status < 200 || response.status >= 300) throw Error('下载链接返回 HTTP ' + response.status + '，请检查登录、请求头或链接有效期')
      const final = response.request?.res?.responseUrl || response.request?.res?.responseURL || response.request?.responseURL || url
      const ct = String(response.headers?.['content-type'] || '').toLowerCase()
      if (!/text\/html|application\/xhtml/.test(ct) || parseCDName(response.headers?.['content-disposition'])) {
        return { success: true, name: responseDownloadName(response, final), url: final, headers: { ...headers }, contentType: ct.split(';')[0], size: Number(response.headers?.['content-length']) || 0 }
      }
      if (++pages > 6) throw Error('下载中转页跳转过多')
      const chunks = []; let bytes = 0
      for await (const chunk of response.data) { bytes += chunk.length; if (bytes > 262144) throw Error('下载中转页过大，请提供实际下载链接'); chunks.push(chunk) }
      const $ = cheerio.load(Buffer.concat(chunks).toString('utf8'))
      const refresh = String(response.headers?.refresh || $('meta[http-equiv]').filter((_, el) => String($(el).attr('http-equiv')).toLowerCase() === 'refresh').attr('content') || '')
      const redirect = refresh.match(/url\s*=\s*["']?([^"']+)/i)?.[1]?.trim()
      let target = redirect
      if (!target) {
        const links = $('a[href]').toArray().filter(el => $(el).attr('download') !== undefined || /(?:下载|download)/i.test($(el).text() + ' ' + ($(el).attr('id') || '') + ' ' + ($(el).attr('class') || '')))
        const urls = [...new Set(links.map(el => $(el).attr('href')).filter(href => href && !/^(?:javascript:|#)/i.test(href)))]
        if (urls.length === 1) target = urls[0]
      }
      if (!target) throw Error('链接返回网页，未发现唯一的实际下载地址；请提供文件直链')
      const next = new URL(target, final)
      stripCrossOriginCredentials(headers, url, next.href)
      url = next.href
    } finally { response.data?.destroy?.() }
  }
  throw Error('下载链接跳转层数过多')
}

export const DL_CT_EXT_MAP = {
        'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
        'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
        'application/x-7z-compressed': '.7z', 'application/gzip': '.gz',
        'application/x-gzip': '.gz', 'application/x-tar': '.tar',
        'application/x-iso9660-image': '.iso', 'application/vnd.android.package-archive': '.apk',
        'video/mp4': '.mp4', 'video/x-matroska': '.mkv', 'video/webm': '.webm',
        'video/quicktime': '.mov', 'video/x-msvideo': '.avi', 'video/x-flv': '.flv',
        'video/mpeg': '.mpeg', 'video/mp2t': '.ts', 'video/x-ms-wmv': '.wmv',
        'audio/mpeg': '.mp3', 'audio/flac': '.flac', 'audio/mp4': '.m4a',
        'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
        'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/x-ape': '.ape',
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
        'application/pdf': '.pdf', 'text/plain': '.txt',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/epub+zip': '.epub',
        'application/x-msdownload': '.exe', 'application/x-msi': '.msi',
        'application/x-apple-diskimage': '.dmg'
      }
