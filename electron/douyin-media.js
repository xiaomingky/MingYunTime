// Shared by HTTP, SSR and browser-response parsing. Never infer media from arbitrary CDN URLs.
export const DOUYIN_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'

export function extractShareUrl(input) {
    return String(input || '').match(/https?:\/\/[^\s<>"\u3000]+/i)?.[0]
        ?.replace(/[。，、；！？」』）】,;!)\]}]+$/u, '') || ''
}

export function extractDouyinId(input) {
    try {
        const url = new URL(extractShareUrl(input))
        if (!/(^|\.)(douyin|iesdouyin)\.com$/i.test(url.hostname)) return ''
        for (const key of ['modal_id', 'aweme_id', 'item_id', 'item_ids']) {
            const id = url.searchParams.get(key)
            if (/^\d{10,20}$/.test(id || '')) return id
        }
        return url.pathname.match(/\/(?:video|note|slides)\/(\d{10,20})(?:\/|$)/)?.[1]
            || url.pathname.match(/^\/(?:share\/)?(\d{10,20})(?:\/|$)/)?.[1] || ''
    } catch { return '' }
}

function urls(value) {
    if (!value) return []
    const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value
        : value.url_list || value.urlList || value.urls || (value.url ? [value.url] : [])
    const list = Array.isArray(raw) ? raw : [raw]
    return [...new Set(list.filter(v => typeof v === 'string').map(v => {
        const clean = v.replace(/\\\//g, '/').replace(/&amp;/g, '&')
        return clean.startsWith('//') ? 'https:' + clean : clean
    }).filter(v => /^https?:\/\//i.test(v)))]
}

function bestUrl(value, image = false) {
    const list = urls(value)
    return list.find(v => image ? !/tplv-dy-water|watermark/i.test(v) : !/\/playwm\//i.test(v)) || list[0] || ''
}

function qualityOf(address, bitrate) {
    const ratio = String(address?.ratio || bitrate?.gear_name || '')
    const named = ratio.match(/(?:2160|1440|1080|720|540|480|360)p|4k|2k/i)?.[0]
    if (named) return named.toUpperCase().replace('P', 'p')
    const height = Math.min(Number(address?.height) || Infinity, Number(address?.width) || Infinity)
    if (Number.isFinite(height)) return height >= 2160 ? '4K' : `${height}p`
    const kbps = Math.floor(Number(bitrate?.bit_rate || bitrate?.bitRate || 0) / 1000)
    return kbps ? `${kbps}Kbps` : ''
}

function fromDetail(detail) {
    const title = detail.desc || detail.title || ''
    const video = detail.video || {}
    const images = detail.images || detail.image_post_info?.images || detail.imagePostInfo?.images
    if (Array.isArray(images) && images.length) {
        const imageList = images.map(img => bestUrl(img.display_image || img.displayImage || img, true)
            || bestUrl(img.download_url_list || img.downloadUrlList, true)).filter(Boolean)
        if (!imageList.length) return null
        const cover = imageList[0]
        const streams = imageList.map((url, i) => ({ url, type: 'image',
            title: `${title} [图${i + 1}/${imageList.length}]`, cover, isImage: true, imageList,
            watermarkFree: !/tplv-dy-water|watermark/i.test(url) }))
        const music = bestUrl(detail.music?.play_url || detail.music?.playUrl)
        if (music) streams.push({ url: music, type: 'mp3', title: `${title} [背景音乐]`, cover })
        return { title, cover, streams }
    }
    // Image posts can expose their BGM as video.play_addr; it is not a video stream.
    if (Number(detail.aweme_type || detail.awemeType) === 68 || Number(detail.is_image_post) === 1) return null
    const cover = bestUrl(video.cover_original_scale || video.origin_cover || video.originCover || video.cover)
    const streams = []
    const add = (address, bitrate) => {
        let url = bestUrl(address)
        // The official play endpoint supports the watermark-free variant of playwm.
        if (url) url = url.replace(/\/playwm\//i, '/play/')
        if (!url || streams.some(s => s.url === url)) return
        const quality = qualityOf(address, bitrate)
        streams.push({ url, type: /\.m3u8(?:\?|$)/i.test(url) ? 'm3u8' : 'mp4',
            title: quality ? `${title} [${quality}]` : title, cover, quality,
            watermarkFree: !/watermark=1|\/download\//i.test(url) })
    }
    const bitrates = video.bit_rate || video.bitRate || video.bitRateList || []
    for (const bitrate of bitrates) add(bitrate.play_addr || bitrate.playAddr || bitrate.playAddrH264, bitrate)
    if (!streams.length) add(video.play_addr || video.playAddr || video.playApi)
    if (!streams.length) return null
    streams.sort((a, b) => {
        const rank = q => q === '4K' ? 2160 : q === '2K' ? 1440 : parseInt(q) || 0
        return rank(b.quality) - rank(a.quality)
    })
    return { title, cover, streams }
}

export function extractDouyinMedia(root, targetId = '') {
    const seen = new Set()
    const walk = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 14 || seen.has(value) || seen.size > 12000) return null
        seen.add(value)
        const id = String(value.aweme_id || value.awemeId || value.item_id || value.itemId || value.id || '')
        if ((!targetId || id === targetId) && (value.video || value.images || value.image_post_info || value.imagePostInfo)) {
            const media = fromDetail(value)
            if (media) return media
        }
        for (const child of Object.values(value)) {
            const media = walk(child, depth + 1)
            if (media) return media
        }
        return null
    }
    return walk(root)
}

// Parse JSON only, never execute scripts received from the share page.
export function extractDouyinPage(html, targetId = '') {
    for (const match of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const [ , attrs, body ] = match
        let candidate = ''
        if (/\bid\s*=\s*["'](?:RENDER_DATA|_ROUTER_DATA|__NEXT_DATA__)["']/i.test(attrs)) {
            candidate = body.trim()
            try { candidate = decodeURIComponent(candidate) } catch {}
        } else {
            const assign = body.match(/(?:window\.)?_ROUTER_DATA\s*=\s*/)
            if (assign) candidate = body.slice(assign.index + assign[0].length).trim().replace(/;\s*$/, '')
        }
        if (!candidate) continue
        try {
            const result = extractDouyinMedia(JSON.parse(candidate), targetId)
            if (result) return result
        } catch {}
    }
    return null
}
