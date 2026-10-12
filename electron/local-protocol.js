import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export const mimeMap = {
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.flac': 'audio/flac',
                '.ogg': 'audio/ogg',
                '.oga': 'audio/ogg',
                '.m4a': 'audio/mp4',
                '.aac': 'audio/aac',
                '.wma': 'audio/x-ms-wma',
                '.ape': 'audio/ape',
                '.opus': 'audio/opus',
                '.wv': 'audio/x-wavpack',
                '.tta': 'audio/tta',
                '.dsf': 'audio/dsf',
                '.dff': 'audio/dff',
                '.mp2': 'audio/mpeg',
                '.ac3': 'audio/ac3',
                '.amr': 'audio/amr',
                '.aiff': 'audio/aiff',
                '.au': 'audio/basic',
                '.ra': 'audio/vnd.rn-realaudio',
                '.ram': 'audio/vnd.rn-realaudio',
                '.mpc': 'audio/x-musepack',
                '.mka': 'audio/x-matroska',
                '.weba': 'audio/webm',
                '.ttf': 'font/ttf',
                '.otf': 'font/otf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.mp4': 'video/mp4',
                '.mkv': 'video/x-matroska',
                '.webm': 'video/webm',
                '.avi': 'video/x-msvideo',
                '.mov': 'video/quicktime',
                '.flv': 'video/x-flv',
                '.wmv': 'video/x-ms-wmv'
            }

export function decodeLocalPath(url, scheme) {
    // Generated paths are URI-encoded in full, preserving Chinese, spaces, # and ?.
    let raw = url.replace(new RegExp(`^${scheme}://`, 'i'), '').replace(/\?param=.*$/, '')
    let decoded = decodeURIComponent(raw)
    if (process.platform === 'win32') decoded = decoded.replace(/^\/+(?=[a-z]:)/i, '')
    return path.normalize(decoded)
}

export function parseByteRange(value, size) {
    if (!value) return null
    const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
    if (!match || (!match[1] && !match[2]) || size === 0) return false
    let start, end
    if (!match[1]) {
        const suffix = Number(match[2])
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
        start = Math.max(0, size - suffix)
        end = size - 1
    } else {
        start = Number(match[1])
        end = match[2] ? Number(match[2]) : size - 1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false
        end = Math.min(end, size - 1)
    }
    return { start, end }
}

export async function localFileResponse(request) {
    let handle
    try {
        const file = decodeLocalPath(request.url, 'local-file')
        handle = await fs.promises.open(file, 'r')
        const stat = await handle.stat()
        if (!stat.isFile()) { await handle.close(); handle = null; return new Response(null, { status: 404 }) }
        const headers = { 'Content-Type': mimeMap[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            await handle.close(); handle = null
            return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
        }
        const range = parseByteRange(request.headers.get('range'), stat.size)
        if (range === false) {
            await handle.close(); handle = null
            return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } })
        }
        const length = range ? range.end - range.start + 1 : stat.size
        headers['Content-Length'] = String(length)
        if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
        if (request.method === 'HEAD' || length === 0) {
            await handle.close(); handle = null
            return new Response(null, { status: range ? 206 : 200, headers })
        }
        const stream = handle.createReadStream({ ...(range || {}), autoClose: true, signal: request.signal })
        handle = null // Stream now owns the descriptor; cancellation closes it.
        return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers })
    } catch (error) {
        await handle?.close().catch(() => {})
        return new Response(null, { status: error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500 })
    }
}

export function createCoverHandler({ metadata, fallback, maxBytes = 32 * 1024 * 1024, maxEntries = 8 }) {
    const cache = new Map()
    const pending = new Map()
    let bytes = 0
    function drop(key) { bytes -= cache.get(key)?.data.length || 0; cache.delete(key) }
    async function load(file) {
        const stat = await fs.promises.stat(file)
        const hit = cache.get(file)
        if (hit && hit.mtime === stat.mtimeMs && Date.now() - hit.time < 60000) {
            cache.delete(file); cache.set(file, hit)
            return hit
        }
        drop(file)
        let picture
        try {
            const result = await (await metadata()).parseFile(file, { duration: false })
            const pic = result.common.picture?.[0]
            if (pic) picture = { data: Buffer.from(pic.data), type: pic.format }
        } catch {}
        if (!picture) {
            const dir = path.dirname(file)
            const basename = path.basename(file, path.extname(file))
            const entries = await fs.promises.readdir(dir, { withFileTypes: true })
            const files = new Set(entries.filter(e => e.isFile()).map(e => e.name))
            const extensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp']
            const choices = [basename, 'cover', 'Cover', 'folder', 'Folder', 'album', 'Album', 'front', 'Front'].flatMap(name => extensions.map(ext => name + ext))
            const cover = [...choices, ...files].find(name => files.has(name) && extensions.includes(path.extname(name).toLowerCase()))
            const image = cover ? path.join(dir, cover) : fallback
            try { picture = { data: await fs.promises.readFile(image), type: mimeMap[path.extname(image).toLowerCase()] || 'image/png' } }
            catch { picture = { data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), type: 'image/png' } }
        }
        const entry = { ...picture, mtime: stat.mtimeMs, time: Date.now() }
        if (entry.data.length <= maxBytes) {
            while (cache.size >= maxEntries || bytes + entry.data.length > maxBytes) drop(cache.keys().next().value)
            cache.set(file, entry); bytes += entry.data.length
        }
        return entry
    }
    return {
        clear() { cache.clear(); bytes = 0 },
        async handle(request) {
            try {
                const file = decodeLocalPath(request.url, 'song-cover')
                if (!pending.has(file)) pending.set(file, load(file).finally(() => pending.delete(file)))
                const entry = await pending.get(file)
                return new Response(request.method === 'HEAD' ? null : new Uint8Array(entry.data), { headers: { 'Content-Type': entry.type, 'Content-Length': String(entry.data.length), 'Access-Control-Allow-Origin': '*' } })
            } catch (error) { return new Response(null, { status: error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500 }) }
        }
    }
}
