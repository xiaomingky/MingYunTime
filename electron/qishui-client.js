import { randomUUID, randomBytes, randomInt, createHash } from 'node:crypto'
import QRCode from 'qrcode'
import os from 'node:os'

const APP = 'https://beta-luna.douyin.com'
const PC = 'https://api.qishui.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const passport = { passport_jssdk_version: '2.4.13', passport_jssdk_type: 'normal', is_from_ttaccountsdk: '1', aid: '386088' }
export class QishuiError extends Error {
    constructor(code, message) { super(message); this.code = code }
}
export function qishuiCookie(value) {
    let cookie = String(value || '').trim()
    if (/^[\[{]/.test(cookie)) {
        let parsed
        try { parsed = JSON.parse(cookie) } catch { throw new QishuiError('invalid_cookie', 'Cookie JSON 格式无效，请粘贴完整 Cookie 或导出的 Cookie 数组') }
        const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cookies) ? parsed.cookies : null
        if (!rows || rows.some(row => !row || typeof row.name !== 'string' || typeof row.value !== 'string' || /[;=\s]/.test(row.name) || /[;\r\n]/.test(row.value))) {
            throw new QishuiError('invalid_cookie', '请使用包含 name 和 value 的 Cookie 数组')
        }
        cookie = rows.map(row => `${row.name}=${row.value}`).join('; ')
    } else cookie = cookie.replace(/^cookie\s*:\s*/i, '')
    if (!/(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt)=[^;\s]+/.test(cookie) || /[\r\n\x00]/.test(cookie)) throw new QishuiError('invalid_cookie', '请提供含 sessionid 或 sessionid_ss 等登录凭据的完整汽水 Cookie')
    return cookie
}
export function qishuiPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new QishuiError('upstream_empty_response', '汽水接口暂未返回数据，请稍后重试')
    const code = payload.status_code ?? payload.status_info?.status_code ?? 0
    if (Number(code) !== 0) throw new QishuiError(String(code), payload.status_info?.status_msg || payload.message || '汽水音乐请求失败')
    return payload
}
// Optional protobuf lists are omitted for successful empty resources. An empty
// HTTP body/object has no such success envelope and must stay an error.
export function qishuiList(payload, key) {
    const value = payload[key]
    if (Array.isArray(value)) return value
    if (value === undefined && (payload.status_info || payload.status_code !== undefined)) return []
    throw new QishuiError('invalid_response', '汽水未返回有效列表，请重试')
}
export function qishuiImage(value) {
    if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : ''
    const url = value?.urls?.find(url => typeof url === 'string' && /^https?:\/\//.test(url)) || ''
    if (!url) return ''
    // App artwork provides CDN prefixes; H5 already supplies complete URLs.
    // Append the URI only to a bare /img/ prefix, preserving signed/full URLs.
    if (!/^https?:\/\/[^/?#]+\/img\/$/.test(url) || !value.uri) return url
    const uri = String(value.uri).replace(/^\/+/, '')
    if (/[?#\s]/.test(uri) || uri.includes('..')) return ''
    const template = /^[\w-]+$/.test(value.template_prefix || '') ? `~${value.template_prefix}-image.image` : ''
    return url + uri + template
}
export function qishuiTrack(raw) {
    const track = raw?.entity?.track_wrapper?.track || raw?.entity?.track || raw?.track_wrapper?.track || raw?.track || raw
    if (!track?.id || (typeof track.id === 'number' && !Number.isSafeInteger(track.id))) return null
    const artists = Array.isArray(track.artists) ? track.artists.map(a => ({ id: String(a.id || ''), name: a.name || a.nickname || '' })) : []
    const cover = qishuiImage(track.album?.url_cover || track.url_cover || track.cover)
    return { id: String(track.id), qishuiId: String(track.id), platform: 'qishui', name: track.name || track.title || '',
        artist: artists.map(a => a.name).join(' / ') || '未知歌手', ar: artists,
        al: { id: String(track.album?.id || ''), name: track.album?.name || track.album?.title || '', picUrl: cover },
        picUrl: cover, dt: Number(track.duration || 0), duration: Number(track.duration || 0) / 1000,
        previewStartMs: Number(track.audition_info?.start_time_ms ?? track.preview?.start ?? 0),
        previewDurationMs: Number(track.audition_info?.duration_ms ?? track.preview?.duration ?? 0),
        collected: !!track.state?.is_collected,
        // APK NetTrackKt obtains these independently from NetLabelInfo. A
        // preview or high-quality-only restriction does not imply VIP playback.
        isVip: [true,1,'1'].includes((track.label_info || track.labelInfo)?.only_vip_playable ?? (track.label_info || track.labelInfo)?.onlyVipPlayable),
        vipPlayRequired: [true,1,'1'].includes((track.label_info || track.labelInfo)?.only_vip_playable ?? (track.label_info || track.labelInfo)?.onlyVipPlayable),
        vipDownloadOnly: [true,1,'1'].includes((track.label_info || track.labelInfo)?.only_vip_download ?? (track.label_info || track.labelInfo)?.onlyVipDownload) }
}
export function qishuiPlaylist(raw) {
    const p = raw?.entity?.playlist || raw?.playlist || raw
    if (!p?.id || (typeof p.id === 'number' && !Number.isSafeInteger(p.id))) return null
    return { id: String(p.id), name: p.title || p.name || '', coverImgUrl: qishuiImage(p.url_cover || p.cover),
        description: p.desc || p.description || '', songCount: Number(p.count_tracks || 0), creator: p.owner?.nickname || p.owner?.name || '',
        ownerId: String(p.owner?.id || ''), collected: !!p.state?.is_collected, isPrivate: !!p.is_private, type: Number(p.type || 0) }
}
export function qishuiLyrics(content, offsetMs = 0, durationMs = Infinity) {
    const lines = [], words = []
    for (const line of String(content || '').split(/\r?\n/)) {
        const match = line.match(/^\[(\d+),(\d+)\](.*)$/)
        if (!match) continue
        const start = Number(match[1]), length = Number(match[2])
        if (start + length < offsetMs || start > offsetMs + durationMs) continue
        const syllables = [...match[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)]
        const text = syllables.length ? syllables.map(w => w[3]).join('') : match[3]
        const adjusted = Math.max(0, start - offsetMs)
        const time = `[${String(Math.floor(adjusted / 60000)).padStart(2, '0')}:${(adjusted % 60000 / 1000).toFixed(3).padStart(6, '0')}]`
        lines.push(time + text)
        // YRC supports absolute word timestamps; clip a phrase spanning preview start.
        const visible = syllables.map(w => ({ start: start + Number(w[1]), length: Number(w[2]), text: w[3] }))
            .filter(w => w.start + w.length >= offsetMs && w.start < offsetMs + durationMs)
        if (visible.length) words.push(`[${adjusted},${Math.min(length, durationMs)}]` + visible.map(w => `(${Math.max(0, w.start - offsetMs)},${Math.min(w.length, Math.max(0, w.start + w.length - offsetMs))},0)${w.text}`).join(''))
    }
    return { lrc: lines.join('\n'), yrc: words.join('\n') }
}

// Official translations are timestamped LRC, independently of KRC word timing.
// Apply the same audition offset as the main track before passing both to UI.
export function qishuiTranslation(content, offsetMs = 0, durationMs = Infinity) {
    const result = []
    for (const line of String(content || '').split(/\r?\n/)) {
        const pattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
        const text = line.replace(pattern, '').trim()
        if (!text || text === '//') continue
        for (const m of line.matchAll(pattern)) {
            const start = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] || '').padEnd(3, '0'))
            if (start < offsetMs || start >= offsetMs + durationMs) continue
            const time = start - offsetMs
            result.push(`[${String(Math.floor(time / 60000)).padStart(2, '0')}:${(time % 60000 / 1000).toFixed(3).padStart(6, '0')}]${text}`)
        }
    }
    return result.join('\n')
}

export function qishuiPlayback(payload, quality = 'auto') {
    const p = qishuiPayload(payload), track = qishuiTrack(p.seo_track?.track || p.track)
    const player = p.track_player || p.media_player || p.player
    let model
    try { model = typeof player?.video_model === 'string' ? JSON.parse(player.video_model) : player?.video_model } catch {}
    const list = Array.isArray(model?.video_list) ? model.video_list : Object.values(model?.video_list || {})
    const candidates = list.filter(v => /^https:\/\//.test(v.main_url || v.main_play_url || '') && (!v.video_meta?.codec_type || ['aac','flac'].includes(v.video_meta.codec_type)))
    const getQuality = v => v.video_meta?.quality || v.quality || 'platform'
    const ranked = candidates.slice().sort((a,b) => Number(b.video_meta?.bitrate || b.bitrate || 0) - Number(a.video_meta?.bitrate || a.bitrate || 0))
    const order = ['lossless','hi_res','highest','higher','medium']
    const item = (quality !== 'auto' && candidates.find(v => getQuality(v) === quality)) ||
        order.map(q => ranked.find(v => getQuality(v) === q)).find(Boolean) || ranked[0]
    const duration = Number(model?.video_duration || 0), full = (track?.dt || 0) / 1000
    if (!track || !item || !(duration > 0)) throw new QishuiError('playback_unavailable', '当前歌曲未提供可播放音频')
    // Preview metadata can accompany full streams. Only the delivered duration
    // determines whether this response actually grants full playback.
    const preview = full > 0 && duration + 2 < full
    const offsetMs = preview ? track.previewStartMs : 0
    return { track, url: item.main_url || item.main_play_url, preview, duration, fullDuration: full, offsetMs,
        backupUrls: [item.backup_url, item.backup_play_url].flat().filter(url => typeof url === 'string' && url.startsWith('https://')),
        playAuth: item.play_auth || item.encrypt_info?.spade_a || model.play_auth || model.spade_a || '',
        quality: getQuality(item), requestedQuality: quality,
        availableQualities: [...new Set(candidates.map(getQuality))],
        codec: item.video_meta?.codec_type || 'aac', bitrate: Number(item.video_meta?.bitrate || item.bitrate || 0),
        expiresAt: Number(player.expire_at || model.url_expire || 0),
        ...qishuiLyrics(p.lyric?.content, offsetMs, duration * 1000),
        tlrc: qishuiTranslation(p.lyric?.translations?.cn, offsetMs, duration * 1000), downloadAllowed: true }
}

function mergeCookies(jar, setCookie = []) {
    const list = Array.isArray(setCookie) ? setCookie : [setCookie]
    for (const value of list) {
        const pair = String(value).split(';')[0], index = pair.indexOf('=')
        if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1))
    }
}
const cookieString = jar => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

export class QishuiClient {
    constructor({ request, pcRequest, passportRequest, passportClose = () => {}, identity, load = () => '', save = () => {}, now = Date.now }) {
        this.request = request; this.save = save; this.now = now; this.revision = 0
        this.pcRequest = pcRequest
        this.passportRequest = passportRequest; this.passportClose = passportClose
        this.cookie = load() || ''; this.logins = new Map()
        const digits = length => Array.from({ length }, (_, index) => String(randomInt(index ? 0 : 1, 10))).join('')
        this.identity = identity || { deviceId:digits(16), installId:digits(15) }
    }
    async pcCall(path, options = {}) {
        if (this.pcRequest) return this.pcRequest({path,cookie:this.cookie,...options})
        return this.call(path,{host:PC,...options})
    }
    async call(path, { host = APP, method = 'POST', data = {}, params = {}, cookie = this.cookie, ua } = {}) {
        let response
        try { response = await this.request({ url: host + path, method, data: method === 'GET' ? undefined : data, params,
            timeout: 15000, headers: { 'User-Agent': ua || (host === APP ? 'Luna/19.1.0 Android' : UA),
                Cookie: cookie, 'Content-Type': typeof data === 'string' ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8' } }) }
        catch { throw new QishuiError('network_error', '汽水音乐网络请求失败，请检查网络后重试') }
        return response
    }
    async discover(cursor = '') {
        const revision = this.revision
        const options = { data: { count: 20, ...(cursor ? { cursor } : {}) } }
        const response = this.pcRequest ? await this.pcCall('/luna/pc/discover/mix', options) : await this.call('/luna/discover/mix', options)
        if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请刷新发现页')
        const p = qishuiPayload(response.data)
        const playlists = (p.inner_block || []).flatMap(b => b.resources || []).map(qishuiPlaylist).filter(Boolean)
        return { playlists: [...new Map(playlists.map(p => [p.id, p])).values()], hasMore: !!p.has_more, cursor: String(p.next_cursor || '') }
    }
    async playlist(id, cursor = '') {
        if (!/^\d+$/.test(String(id)) || (typeof id === 'number' && !Number.isSafeInteger(id))) throw new QishuiError('invalid_id', '歌单 ID 无效')
        const revision = this.revision
        const response = this.pcRequest
            ? await this.pcCall('/luna/pc/playlist/detail', { method: 'GET', params: { playlist_id: String(id), count: 50, cursor: String(cursor), session_id: '', reverse: false, ab_param: '' } })
            : await this.call('/luna/playlist/detail', { data: { playlist_id: String(id), count: 50, ...(cursor ? { cursor } : {}) } })
        const p = qishuiPayload(response.data)
        if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请重新打开歌单')
        if (!p.playlist) throw new QishuiError('invalid_response', '汽水未返回有效歌单详情，请重试')
        const songs = qishuiList(p, 'media_resources').map(qishuiTrack).filter(Boolean)
        return { playlist: qishuiPlaylist(p.playlist || p), songs,
            hasMore: !!p.has_more, cursor: String(p.next_cursor || '') }
    }
    async detail(id) {
        if (!/^\d+$/.test(String(id))) throw new QishuiError('invalid_id', '歌曲 ID 无效')
        return qishuiPayload((await this.call('/luna/h5/seo_track', { method: 'GET', params: { track_id: String(id), device_platform: 'web' }, ua: UA })).data)
    }
    async playback(id, quality = 'auto') {
        if (!/^\d+$/.test(String(id))) throw new QishuiError('invalid_id', '歌曲 ID 无效')
        if (!['auto','medium','higher','highest','hi_res','lossless','spatial'].includes(quality)) throw new QishuiError('invalid_quality', '不支持的汽水音质')
        const revision = this.revision
        let payload, source = 'pc'
        if (this.pcRequest) {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    payload = qishuiPayload((await this.pcCall('/luna/pc/track_v2', { data: {
                        track_id: String(id), media_type: 'track', queue_type: 'favorite_track_playlist', scene_name: 'library'
                    } })).data)
                    break
                } catch(e) {
                    if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请重新播放')
                    if (attempt || !['ECONNRESET','ETIMEDOUT','ECONNABORTED','EAI_AGAIN'].includes(e.code)) throw e
                }
            }
        } else { payload = await this.detail(id); source = 'h5' }
        if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请重新播放')
        const playback = qishuiPlayback(payload, quality)
        return { ...playback, source }
    }
    async search(query, cursor = '') {
        const keyword = String(query || '').trim(), revision = this.revision
        if (!keyword) throw new QishuiError('invalid_query', '请输入歌曲、歌手或专辑名称')
        const p = qishuiPayload((await this.pcCall('/luna/pc/search/track', { method: 'GET', params: {
            q: keyword, cursor: String(cursor || '0'), search_id: '', search_method: 'input',
            debug_params: '', from_search_id: '', search_scene: ''
        } })).data)
        if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请重新搜索')
        const groups = Array.isArray(p.result_groups) ? p.result_groups.filter(group => group.id === 'tracks' || group.id === 'track') : []
        const entries = groups.length ? groups.flatMap(group => group.data || []) : p.tracks || p.media_resources
        if (!Array.isArray(entries) && !Array.isArray(p.result_groups)) throw new QishuiError('search_unavailable', '汽水搜索接口未返回有效数据，请稍后重试')
        const songs = [...new Map((entries || []).map(qishuiTrack).filter(Boolean).map(song => [song.id, song])).values()]
        const group = groups[0]
        return { songs, hasMore: !!(group?.has_more ?? p.has_more), cursor: String(group?.next_cursor ?? p.next_cursor ?? ''), scope: 'platform' }
    }
    async profile(cookie = this.cookie) {
        if (!cookie) throw new QishuiError('1000016', '请先登录汽水音乐')
        const p = qishuiPayload((await this.pcCall('/luna/pc/me', { method: 'GET', cookie })).data)
        const info = p.my_info || p.user
        if (!info?.id || (typeof info.id === 'number' && !Number.isSafeInteger(info.id))) throw new QishuiError('profile_unavailable', '未取得汽水账号资料，登录尚未完成')
        return { userId: String(info.id), nickname: info.nickname || '汽水音乐用户', avatarUrl: qishuiImage(info.url_avatar || info.medium_avatar_url || info.larger_avatar_url || info.thumb_avatar_url || info.avatar), isVip: [true,1,'1'].includes(info.is_vip), vipStage: typeof info.vip_stage === 'string' ? info.vip_stage : '' }
    }
    async status() {
        if (!this.cookie) return { isLoggedIn: false, profile: null }
        const revision = this.revision
        try {
            const profile = await this.profile()
            if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换，请刷新')
            return { isLoggedIn: true, profile }
        }
        catch (e) {
            if (e.code === '1000016' && revision === this.revision) { this.logout(); return { isLoggedIn: false, profile: null, message: '汽水登录已过期，请重新登录' } }
            throw e
        }
    }
    async importCookie(value) {
        const cookie = qishuiCookie(value), revision = this.revision
        const profile = await this.profile(cookie)
        if (revision !== this.revision) throw new QishuiError('cancelled', '登录已取消')
        this.save(cookie); this.revision++; this.cookie = cookie; this.clearLogins()
        return { isLoggedIn: true, profile }
    }
    async passportCall(login, path, { method = 'GET', params = {}, data } = {}) {
        const traceId = randomBytes(8).toString('hex')
        const query = { ...passport, language: 'zh', account_sdk_source: 'web', p_js_v: '2.4.13', p_js_t: 'pro',
            p_zt: '0', p_ver: '1.0.29', request_host: encodeURIComponent(PC), p_bd: '1.0.0.41',
            biz_trace_id: traceId, is_new_login: '1', is_from_iesaccountsaas: '1',
            device_id: login.deviceId, install_id: login.installId, did: login.deviceId, iid: login.installId,
            device_platform: 'PC', version_code: '3.7.0', account_sdk_source_info: '00', ...params }
        const headers = { Accept: 'application/json, text/javascript',
            'x-tt-passport-verify-portrait': login.portrait, 'x-tt-passport-trace-id': traceId }
        if (data !== undefined) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            headers['x-ss-stub'] = createHash('md5').update(data).digest('hex').toUpperCase()
        }
        if (this.passportRequest) return this.passportRequest(login.id, { url: PC + path, method, params: query, data, headers })
        return this.request({ url: PC + path, method, params: query, data, timeout: 15000,
            headers: { ...headers, 'User-Agent': UA, Cookie: cookieString(login.jar) } })
    }
    beginLogin(kind = 'qr', lifetime = 180000) {
        for (const [id, login] of this.logins) if (login.expiresAt < this.now()) this.qrCancel(id)
        if (this.logins.size >= 5) throw new QishuiError('login_busy', '请关闭旧的登录窗口后再试')
        const revision = this.revision, id = randomUUID()
        const login = { id, kind, jar: new Map(), revision, busy: false, expiresAt: this.now() + lifetime,
            deviceId: this.identity.deviceId, installId: this.identity.installId,
            portrait: randomUUID() + '.login', lastCheckAt: -Infinity, cooldownUntil: 0 }
        this.logins.set(id, login)
        return login
    }
    async qrCreate() {
        const login = this.beginLogin(), { id, revision } = login
        try {
            const res = await this.passportCall(login, '/passport/web/get_qrcode/', { params: {
                next: PC, need_logo: 'false', need_short_url: 'false', is_new_login: '1' } })
            const p = res.data?.data
            if (res.data?.message !== 'success' || Number(p?.error_code || 0) !== 0 || !p?.token) throw new QishuiError('qr_unavailable', p?.description || '汽水登录二维码获取失败，请刷新')
            let image = p.qrcode
            if (p.qrcode_index_url) {
                let entry
                try { entry = new URL(p.qrcode_index_url) } catch {}
                if (!entry || entry.protocol !== 'https:' || entry.username || entry.password || !/(^|\.)qishui\.com$/.test(entry.hostname)) throw new QishuiError('qr_entry_unavailable', '汽水扫码入口无效，请刷新二维码')
                // Official PC RendererService.getHandleScanCodeH5Img converts
                // the passport SDK link to a Qishui App confirmation page.
                const token = entry.searchParams.get('token')
                if (!token) throw new QishuiError('qr_entry_unavailable', '汽水扫码入口缺少授权票据，请刷新二维码')
                const scan = new URL('https://bff-pc.qishui.com/light/invoke/scan_login')
                scan.searchParams.set('token', token)
                scan.searchParams.set('os', process.platform === 'darwin' ? 'Mac' : 'Windows')
                scan.searchParams.set('computer_name', os.hostname())
                image = await QRCode.toDataURL(scan.href.replaceAll('+', '%20'), { width: 320, margin: 2, errorCorrectionLevel: 'M' })
            }
            if (!image?.startsWith('data:image/png;base64,')) throw new QishuiError('qr_unavailable', '汽水未返回有效二维码，请刷新')
            if (revision !== this.revision || this.logins.get(id) !== login) throw new QishuiError('cancelled', '登录已取消')
            mergeCookies(login.jar, res.headers?.['set-cookie']); login.token = p.token
            const expiry = Number(p.expire_time)
            const lifetime = expiry > 1000000000 ? expiry * 1000 - this.now() : (expiry || 180) * 1000
            login.expiresAt = this.now() + Math.max(1000, Math.min(300000, lifetime))
            return { loginId: id, image, expiresAt: login.expiresAt }
        } catch (error) { this.qrCancel(id); throw error }
    }
    async qrCheck(id) {
        const login = this.logins.get(id)
        if (login && login.kind !== 'qr') throw new QishuiError('invalid_login', '请使用对应的登录方式')
        if (!login || login.expiresAt <= this.now()) { this.qrCancel(id); return { status: 'expired' } }
        if (login.busy || login.cooldownUntil > this.now()) return { status: login.lastStatus || 'waiting' }
        if (this.passportRequest && this.now() - login.lastCheckAt < 2500) return { status: login.lastStatus || 'waiting' }
        login.lastCheckAt = this.now()
        login.busy = true
        try {
            const data = new URLSearchParams({ need_logo: 'false', need_short_url: 'false',
                is_frontier: 'true', token: login.token, is_new_login: '1', next: PC }).toString()
            const res = await this.passportCall(login, '/passport/web/check_qrconnect/', { method: 'POST', data })
            if (this.logins.get(id) !== login || this.revision !== login.revision) return { status: 'cancelled' }
            if (login.expiresAt <= this.now()) { this.qrCancel(id); return { status: 'expired' } }
            const p = res.data?.data, code = Number(p?.error_code || 0)
            if (code === 7) { login.cooldownUntil = this.now() + 5000; return { status: login.lastStatus || 'waiting', message: '正在等待汽水 App 确认，请稍候' } }
            if (code === 2 || String(p?.status) === 'expired') { this.qrCancel(id); return { status: 'expired' } }
            if (p?.verify_center_decision_conf || p?.verify_center_secondary_decision_conf || [1105,2032,2046].includes(code)) return { status: 'verification_required', message: '汽水安全验证尚未完成，请刷新后完成弹出的验证窗口' }
            if (res.data?.message !== 'success' || !p || code !== 0) throw new QishuiError('qr_rejected', p?.description || '登录二维码已失效，请刷新')
            mergeCookies(login.jar, res.headers?.['set-cookie'])
            const state = String(p.status || 'waiting').toLowerCase()
            login.lastStatus = state === '1' ? 'new' : state === '2' ? 'scanned' : state
            if (['3', 'confirmed', 'success'].includes(state) || p.logged_in === true) {
                for (const raw of [p.session_cookie, p.cookie, res.data.session_cookie]) if (typeof raw === 'string') mergeCookies(login.jar, raw.split(';').map(pair => pair.trim()))
                if (typeof p.sessionid === 'string') login.jar.set('sessionid', p.sessionid)
                if (![...login.jar.keys()].some(key => ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'].includes(key)) && p.redirect_url) {
                    let redirect
                    try { redirect = new URL(p.redirect_url) } catch {}
                    if (!redirect || redirect.protocol !== 'https:' || !['api.qishui.com', 'bff-pc.qishui.com'].includes(redirect.hostname)) throw new QishuiError('qr_rejected', '汽水登录回调地址无效')
                    const result = this.passportRequest
                        ? await this.passportRequest(id, { url: redirect.href, method: 'GET' })
                        : await this.request({ url: redirect.href, method: 'GET', timeout: 15000, maxRedirects: 0, headers: { Cookie: cookieString(login.jar), 'User-Agent': UA } })
                    mergeCookies(login.jar, result.headers?.['set-cookie'])
                }
                if (this.logins.get(id) !== login || this.revision !== login.revision) return { status: 'cancelled' }
                if (![...login.jar.keys()].some(key => ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'].includes(key))) throw new QishuiError('qr_session_missing', '汽水已确认扫码但尚未返回登录会话，请刷新二维码')
                const cookie = cookieString(login.jar), profile = await this.profile(cookie)
                if (this.logins.get(id) !== login || this.revision !== login.revision) return { status: 'cancelled' }
                if (login.expiresAt <= this.now()) { this.qrCancel(id); return { status: 'expired' } }
                this.save(cookie); this.cookie = cookie; this.revision++; this.clearLogins()
                return { status: 'confirmed', profile }
            }
            if (state === 'cancelled') this.qrCancel(id)
            return { status: login.lastStatus }
        } finally { login.busy = false }
    }
    qrCancel(id) {
        this.logins.delete(id)
        Promise.resolve().then(() => this.passportClose(id)).catch(() => {})
        return { success: true }
    }
    clearLogins() { for (const id of this.logins.keys()) this.qrCancel(id) }
    logout() { this.revision++; this.clearLogins(); this.cookie = ''; this.save(''); return { success: true } }
    async library(cursor = '') {
        if (!this.cookie) throw new QishuiError('1000016', '请先登录汽水音乐')
        const revision = this.revision
        const res = await this.pcCall('/luna/pc/me/playlist', { method: 'GET', params: { cursor: String(cursor), count: 50, ab_param: '' } })
        if (revision !== this.revision) throw new QishuiError('cancelled', '账号已切换')
        const p = qishuiPayload(res.data)
        const playlists = qishuiList(p, 'playlists')
        return { playlists: playlists.map(qishuiPlaylist).filter(Boolean), total: Number(p.total_num || playlists.length), hasMore: !!p.has_more, cursor: String(p.next_cursor || '') }
    }
}
