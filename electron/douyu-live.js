import axios from 'axios'
import https from 'node:https'
import crypto from 'node:crypto'
import { net } from 'electron'
const PARSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
// ===== 斗鱼直播流解析 =====
// 参考 biliup douyu.rs：纯 HTTP API，不再用 BrowserWindow 拦截
// getEncryption → sign_stream → getH5Play，支持 CDN 线路选择
const DOUYU_DEFAULT_DID = '10000000000000000000000000001501'
const DOUYU_TLS_AGENT = new https.Agent({ keepAlive: false, family: 4, minVersion: 'TLSv1.2', maxCachedSessions: 0 })

async function douyuRequest(config, attempts = 3) {
    let lastError
    for (let attempt = 0; attempt < attempts; attempt++) {
        config.signal?.throwIfAborted()
        try { return await axios.request({ ...config, httpsAgent: DOUYU_TLS_AGENT }) }
        catch (error) {
            config.signal?.throwIfAborted()
            lastError = error
            const transient = /ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|ERR_NETWORK|socket disconnected|TLS connection/i.test(`${error?.code || ''} ${error?.message || ''}`)
            if (!transient || attempt === attempts - 1) throw error
            // Chromium uses the OS networking/proxy stack; this recovers Node TLS
            // disconnects while retaining certificate validation in both paths.
            if (attempt === 0) {
                try {
                    const url = new URL(config.url)
                    for (const [key, value] of Object.entries(config.params || {})) url.searchParams.set(key, value)
                    const response = await net.fetch(url.toString(), {
                        method: config.method, headers: config.headers,
                        ...(config.data ? { body: String(config.data) } : {}),
                        signal: AbortSignal.any([AbortSignal.timeout(config.timeout || 15000), ...(config.signal ? [config.signal] : [])])
                    })
                    const body = await response.text()
                    let data = body
                    if (config.responseType !== 'text') { try { data = JSON.parse(body) } catch {} }
                    if (!config.validateStatus && !response.ok) throw new Error(`斗鱼 HTTP ${response.status}`)
                    return { status: response.status, data }
                } catch (fallbackError) { lastError = fallbackError }
            }
            await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)))
        }
    }
    throw lastError
}

function douyuSignStream(encKey, roomId, ts) {
    const rounds = Number(encKey.enc_time)
    if (!Number.isInteger(rounds) || rounds < 0 || rounds > 10000 || typeof encKey.rand_str !== 'string' || typeof encKey.key !== 'string') {
        throw new Error('斗鱼返回的签名密钥无效，请稍后重试。')
    }
    const salt = Number(encKey.is_special) === 1 ? '' : `${roomId}${ts}`
    let secret = encKey.rand_str
    for (let i = 0; i < rounds; i++) {
        secret = crypto.createHash('md5').update(secret + encKey.key).digest('hex')
    }
    return crypto.createHash('md5').update(secret + encKey.key + salt).digest('hex')
}

function randomChromeUA() {
    const v = 100 + Math.floor(Math.random() * 21)
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`
}

export async function parseDouyu(target, addStream) {
    const deadline = AbortSignal.timeout(60000)
    const douyuHTTP = {
        get: (url, config) => douyuRequest({ ...config, method: 'GET', url, signal: deadline }),
        post: (url, data, config) => douyuRequest({ ...config, method: 'POST', url, data, signal: deadline })
    }
    let m = target.match(/douyu\.com\/(?:room\/)?([A-Za-z0-9_]+)/i)
    if (!m) return null
    const room = m[1]
    if (['directory', 'following', 'search', 'topic', 'fishsmall'].includes(room.toLowerCase())) return null

    const douyuReferer = `https://www.douyu.com/${room}`
    let lastNetworkError = null

    // 1. 解析真实房间号（短号 → 真实号）
    let roomId = room
    try {
        const mobileRes = await douyuHTTP.get(`https://m.douyu.com/${room}`, {
            headers: { 'User-Agent': PARSE_UA }, timeout: 15000, validateStatus: () => true
        })
        const ridMatch = (typeof mobileRes.data === 'string' ? mobileRes.data : '').match(/roomInfo":\{"rid":(\d+)/)
        if (ridMatch) roomId = ridMatch[1]
    } catch (e) { lastNetworkError = e }

    // 2. 获取房间信息；连接重试由 douyuRequest 统一处理。
    let betardData
    try {
        const betardRes = await douyuHTTP.get(`https://www.douyu.com/betard/${roomId}`, {
            headers: { 'User-Agent': PARSE_UA, 'Referer': douyuReferer },
            timeout: 15000, validateStatus: () => true
        })
        betardData = betardRes.data
        lastNetworkError = null
        if (betardRes.status >= 400) throw new Error(`HTTP ${betardRes.status}`)
    } catch (e) { lastNetworkError = e }
    if (!betardData?.room) {
        if (lastNetworkError) throw new Error('斗鱼房间信息连接失败：' + lastNetworkError.message)
        return null
    }
    const roomData = betardData.room
    roomId = String(roomData.room_id || roomId)
    if (Number(roomData.show_status) !== 1 || Number(roomData.video_loop ?? roomData.videoLoop) === 1) {
        throw new Error('该斗鱼房间当前未开播或正在播放录像。')
    }
    const title = roomData.room_name || `斗鱼 - ${room}`

    // 3. 获取加密密钥 & 4. 签名获取播放信息（鉴权失败时刷新密钥重试，最多 2 轮）
    let addedAny = false
    let encKey = null
    let ua = null

    for (let keyRound = 0; keyRound < 2; keyRound++) {
        // 每轮使用新 UA 防风控
        ua = randomChromeUA()
        try {
            const encRes = await douyuHTTP.get(`https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption`, {
                params: { did: DOUYU_DEFAULT_DID },
                headers: { 'User-Agent': ua, 'Referer': douyuReferer },
                timeout: 15000, validateStatus: () => true
            })
            if (encRes.data?.error !== 0 || !encRes.data?.data) {
                console.log('[DOUYU] getEncryption 失败:', encRes.data?.error, encRes.data?.msg)
                continue
            }
            encKey = encRes.data.data
        } catch (e) { lastNetworkError = e; continue }
        if (!encKey) continue

        const ts = Math.floor(Date.now() / 1000)
        const auth = douyuSignStream(encKey, roomId, ts)
        const formBase = {
            ver: 'Douyu_new', iar: '0', ive: '0', rid: roomId,
            hevc: '0', fa: '0', sov: '0',
            enc_data: encKey.enc_data, tt: String(ts),
            did: DOUYU_DEFAULT_DID, auth
        }

        // 请求主 CDN（使用 V1 API，多个画质）
        const DOUYU_QUALITIES = [
            { rate: '0', label: '蓝光' },
            { rate: '800', label: '高清' },
            { rate: '500', label: '标清' },
            { rate: '250', label: '流畅' },
        ]
        const cdnToTry = ['tct-h5', 'hs-h5']
        // 先请求最高画质
        try {
            const primaryRes = await douyuHTTP.post(
                `https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                new URLSearchParams({ ...formBase, cdn: 'hw-h5', rate: '0' }),
                { headers: { 'User-Agent': ua, 'Referer': douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
            )
            const bodyText = primaryRes.data
            const normalized = typeof bodyText === 'string' ? bodyText.trim().replace(/["'\s]/g, '') : ''
            if (primaryRes.status === 403 || normalized.includes('鉴权失败')) {
                console.log('[DOUYU] 鉴权失败(HTTP', primaryRes.status, ')，刷新密钥重试')
                continue
            }
            let pBody
            try { pBody = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText } catch (e) {
                console.log('[DOUYU] getH5PlayV1 响应非JSON:', String(bodyText).slice(0, 200))
                continue
            }
            if (pBody?.msg && String(pBody.msg).includes('鉴权失败')) {
                console.log('[DOUYU] 鉴权失败(JSON msg)，刷新密钥重试')
                continue
            }
            const primaryData = pBody?.data
            if (primaryData?.rtmp_url && primaryData?.rtmp_live) {
                const streamUrl = `${primaryData.rtmp_url}/${primaryData.rtmp_live}`
                addStream(streamUrl, 'flv', `${title} [蓝光 ${primaryData.rtmp_cdn || 'hw-h5'}]`, { isLive: true })
                addedAny = true
                if (primaryData.cdnsWithName) {
                    for (const c of primaryData.cdnsWithName) {
                        if (c.cdn && c.cdn !== primaryData.rtmp_cdn && !cdnToTry.includes(c.cdn)) cdnToTry.push(c.cdn)
                    }
                }
                // 请求其他画质（同一 CDN）
                const otherQualities = Array.isArray(primaryData.multirates) && primaryData.multirates.length
                    ? primaryData.multirates.filter(q => Number(q.rate) !== 0).slice(0, 5).map(q => ({ rate: String(q.rate), label: q.name || `${q.rate}码率` }))
                    : DOUYU_QUALITIES.filter(q => q.rate !== '0')
                const qualResults = await Promise.allSettled(
                    otherQualities.map(q =>
                        douyuHTTP.post(`https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                            new URLSearchParams({ ...formBase, cdn: primaryData.rtmp_cdn || 'hw-h5', rate: q.rate }),
                            { headers: { 'User-Agent': ua, Referer: douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
                        )
                    )
                )
                qualResults.forEach((r, i) => {
                    if (r.status !== 'fulfilled') return
                    try {
                        const d = (typeof r.value?.data === 'string' ? JSON.parse(r.value.data) : r.value?.data)?.data
                        if (d?.rtmp_url && d?.rtmp_live) {
                            addStream(`${d.rtmp_url}/${d.rtmp_live}`, 'flv', `${title} [${otherQualities[i].label} ${d.rtmp_cdn || 'hw-h5'}]`, { isLive: true })
                        }
                    } catch (e) {}
                })
            } else if (pBody?.error === -5) {
                console.log('[DOUYU] 主播未开播:', roomId)
                throw Object.assign(new Error('该斗鱼房间当前未开播。'), { code: 'DOUYU_OFFLINE' })
            } else if (pBody?.error === 126) {
                console.log('[DOUYU] 版权限制:', pBody?.msg)
                throw Object.assign(new Error('该斗鱼直播受版权或地区限制，暂不能播放。'), { code: 'DOUYU_RESTRICTED' })
            } else {
                console.log('[DOUYU] getH5PlayV1 error:', pBody?.error, 'msg:', pBody?.msg)
            }
        } catch (e) { if (String(e.code || '').startsWith('DOUYU_')) throw e; lastNetworkError = e }

        // 并行请求其他 CDN 线路
        if (cdnToTry.length > 0) {
            const extraResults = await Promise.allSettled(
                cdnToTry.map(cdn =>
                    douyuHTTP.post(`https://www.douyu.com/lapi/live/getH5PlayV1/${roomId}`,
                        new URLSearchParams({ ...formBase, cdn, rate: '0' }),
                        { headers: { 'User-Agent': ua, 'Referer': douyuReferer, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true, responseType: 'text' }
                    )
                )
            )
            for (const r of extraResults) {
                if (r.status !== 'fulfilled') continue
                try {
                    const d = (typeof r.value?.data === 'string' ? JSON.parse(r.value.data) : r.value?.data)?.data
                    if (d?.rtmp_url && d?.rtmp_live) {
                        addStream(`${d.rtmp_url}/${d.rtmp_live}`, 'flv', `${title} [蓝光 ${d.rtmp_cdn || '?'}]`, { isLive: true })
                        addedAny = true
                    }
                } catch (e) { /* 非JSON响应跳过 */ }
            }
        }

        // 如果已拿到流，无需再刷新密钥
        if (addedAny) break
    }

    if (!addedAny && lastNetworkError) throw new Error('斗鱼直播连接失败：' + lastNetworkError.message)
    return addedAny ? { title } : null
}
