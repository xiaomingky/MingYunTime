import { randomUUID } from 'node:crypto'
import { decryptQishuiCenc } from './qishui-cenc.js'
import { parseByteRange } from './local-protocol.js'

// Only platform-issued media is accepted. Account cookies are never sent to CDNs.
export function qishuiMediaURL(value) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(douyinvod\.com|byteicdn\.com|muscdn\.com|qishui\.com)$/.test(url.hostname)) throw new Error('汽水音频地址无效')
    return url.href
}

export function remuxQishuiAudio(data, key, ffmpeg, maxBytes = 96 * 1024 * 1024) {
    if (data.length > maxBytes) throw new Error('汽水音频超过缓存大小限制')
    return decryptQishuiCenc(data, key)
}

export function createQishuiAudio({ request, runtime, ffmpeg, transfer, remux = remuxQishuiAudio, maxBytes = 96 * 1024 * 1024, maxEntries = 4 }) {
    const cache = new Map(); let bytes = 0, revision = 0
    function drop(id) { bytes -= cache.get(id)?.length || 0; cache.delete(id) }
    return {
        clear() { revision++; cache.clear(); bytes = 0 },
        async prepare(playback, { progress, signal } = {}) {
            const { playAuth, backupUrls = [], ...safe } = playback
            qishuiMediaURL(safe.url)
            const current = revision
            const key = playAuth ? await runtime.decodeKey(playAuth) : null
            if (current !== revision) throw new Error('账号已切换，请重新播放')
            // Some official quality variants redirect to another CDN hostname.
            // Validate every hop ourselves; never forward account credentials.
            let response, lastError
            for (const candidate of [...new Set([safe.url, ...backupUrls])].slice(0, 3)) {
                try {
                    if (transfer) {
                        response = await transfer({ request, url:qishuiMediaURL(candidate), signal, progress, maxBytes })
                        break
                    }
                    let mediaUrl = candidate
                    for (let hop = 0; hop <= 3; hop++) {
                        response = await request({ url: qishuiMediaURL(mediaUrl), method: 'GET', responseType: 'arraybuffer', timeout: 25000, signal,
                            ...(progress ? { onDownloadProgress:event => progress({ received:event.loaded || 0, total:event.total || 0 }) } : {}),
                            maxContentLength: maxBytes, maxRedirects: 0,
                            validateStatus: status => status >= 200 && status < 300 || [301,302,303,307,308].includes(status),
                            headers: { 'User-Agent': 'LunaPC/3.7.0(452316191)' } })
                        if (current !== revision) throw new Error('账号已切换，请重新播放')
                        if (![301,302,303,307,308].includes(response.status)) break
                        if (hop === 3 || !response.headers?.location) throw new Error('汽水音频跳转异常，请重试')
                        mediaUrl = qishuiMediaURL(new URL(response.headers.location, mediaUrl).href)
                    }
                    break
                } catch (e) {
                    if (signal?.aborted) throw new Error('下载已取消')
                    if (current !== revision) throw new Error('账号已切换，请重新播放')
                    lastError = e; response = undefined
                }
            }
            if (!response) throw lastError || new Error('汽水音频下载失败，请重试')
            if (current !== revision) throw new Error('账号已切换，请重新播放')
            const data = playAuth ? await remux(Buffer.from(response.data), key, ffmpeg, maxBytes) : Buffer.from(response.data)
            if (current !== revision) throw new Error('账号已切换，请重新播放')
            if (!data.length || data.length > maxBytes || maxEntries < 1) throw new Error('汽水音频超过缓存大小限制')
            while (cache.size >= maxEntries || bytes + data.length > maxBytes) drop(cache.keys().next().value)
            const id = randomUUID(); cache.set(id, data); bytes += data.length
            return { ...safe, url: 'qishui-audio://cache/' + id }
        },
        handle(request) {
            const url = new URL(request.url), data = url.hostname === 'cache' && cache.get(url.pathname.slice(1))
            if (!data) return new Response(null, { status: 404 })
            const mime = data.subarray(0,4).toString() === 'fLaC' ? 'audio/flac' : data.subarray(4,8).toString() === 'ftyp' ? 'audio/mp4' : 'audio/mpeg'
            const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
            if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
            const range = parseByteRange(request.headers.get('range'), data.length)
            if (range === false) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${data.length}` } })
            const body = range ? data.subarray(range.start, range.end + 1) : data
            headers['Content-Length'] = String(body.length)
            if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${data.length}`
            return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: range ? 206 : 200, headers })
        }
    }
}
