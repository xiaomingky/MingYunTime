import axios from 'axios'
import QRCode from 'qrcode'
import { NeteasePlayback } from './netease-playback.js'
import { NETEASE_DIRECT_ROUTES } from '../src/api/netease-direct.js'

const BASE = 'https://music.163.com'
const number = (value, fallback, min, max) => {
    const n = value === undefined ? fallback : Number(value)
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('网易云请求参数无效')
    return n
}
const id = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('网易云 ID 超出安全精度')
    const result = String(value ?? '')
    if (!/^[1-9]\d{0,17}$/.test(result)) throw new Error('缺少有效的网易云 ID')
    return result
}
const array = (value, context) => {
    if (!Array.isArray(value)) throw new Error(`网易云${context}响应不完整`)
    return value
}
export function neteaseTrack(song) {
    if (!song?.id) return null
    return { ...song, ar: song.ar || song.artists || [], al: song.al || song.album || { name: '', picUrl: '' },
        dt: song.dt ?? song.duration ?? 0, mv: song.mv ?? song.mvid ?? 0, platform: 'netease' }
}
export class NeteaseClient {
    constructor({ request = config => axios(config), now = () => Date.now(), playback, qrImage = url => QRCode.toDataURL(url, { width: 300, margin: 2 }) } = {}) {
        Object.assign(this, { request, now, qrImage })
        this.playback = playback || new NeteasePlayback({ request, now })
        this.qr = new Map()
        this.playlists = new Map(); this.playlistPending = new Map(); this.playlistCookie = null
    }
    supports(route) { return NETEASE_DIRECT_ROUTES.has(route) }
    async post(path, params = {}, cookie = '') {
        if (/[\r\n]/.test(String(cookie))) throw new Error('Cookie 格式无效')
        const body = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
        const csrf = String(cookie).split(';').map(s => s.trim()).find(s => s.startsWith('__csrf='))?.slice(7) || ''
        if (csrf) body.set('csrf_token', csrf)
        let response
        try {
            response = await this.request({ url: BASE + path, method: 'POST', timeout: 12000, data: body.toString(),
                headers: { Referer: BASE + '/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) } })
        } catch (error) { throw new Error(error.response?.status ? `网易云服务暂不可用（HTTP ${error.response.status}）` : '网易云连接失败，请检查网络后重试') }
        const result = response?.data
        if (!result || typeof result !== 'object' || Array.isArray(result) || !Number.isInteger(result.code)) throw new Error('网易云返回了无效响应，请重试')
        return { body: result, cookies: response.headers?.['set-cookie'] || [] }
    }
    async data(path, params, cookie) {
        const { body } = await this.post(path, params, cookie)
        if (body.code !== 200) throw new Error(body.message || body.msg || `网易云请求被拒绝（${body.code}）`)
        return body
    }
    async tracks(ids, cookie) {
        const valid = ids.map(id)
        if (valid.length > 1000) throw new Error('每次最多加载 1000 首歌曲')
        const songs = [], privileges = []
        for (let start = 0; start < valid.length; start += 100) {
            const part = valid.slice(start, start + 100)
            const data = await this.data('/api/v3/song/detail', { c: JSON.stringify(part.map(id => ({ id }))), ids: JSON.stringify(part) }, cookie)
            songs.push(...array(data.songs, '歌曲详情')); privileges.push(...(data.privileges || []))
        }
        const byId = new Map(songs.map(song => [String(song.id), neteaseTrack(song)]))
        return { code: 200, songs: valid.map(id => byId.get(id)).filter(Boolean), privileges }
    }
    async playlistDetail(value, cookie, reuse = false) {
        const key = id(value)
        if (this.playlistCookie !== cookie) { this.playlistCookie = cookie; this.playlists.clear(); this.playlistPending.clear() }
        const cached = this.playlists.get(key)
        if (reuse && cached && this.now() - cached.time < 15000) return cached.data
        if (this.playlistPending.has(key)) return this.playlistPending.get(key)
        const pending = (async () => {
            const data = await this.data('/api/v6/playlist/detail', { id: key, n: 100, s: 8 }, cookie)
            if (!data.playlist) throw new Error('网易云歌单详情不完整')
            array(data.playlist.trackIds, '歌单曲目 ID')
            data.playlist.tracks = array(data.playlist.tracks, '歌单曲目').map(neteaseTrack).filter(Boolean)
            if (this.playlistCookie === cookie) {
                if (this.playlists.size >= 8) this.playlists.delete(this.playlists.keys().next().value)
                this.playlists.set(key, { data, time: this.now() })
            }
            return data
        })()
        this.playlistPending.set(key, pending)
        try { return await pending } finally { if (this.playlistPending.get(key) === pending) this.playlistPending.delete(key) }
    }
    async call(route, params = {}, cookie = '') {
        if (!this.supports(route)) throw new Error('该网易云操作尚未独立接入')
        const limit = (fallback = 30, max = 100) => number(params.limit, fallback, 1, max)
        const offset = () => number(params.offset, 0, 0, 100000)
        switch (route) {
        case '/vip/info': return this.data('/api/music-vip-membership/front/vip/info', {userId:params.uid ? id(params.uid) : ''}, cookie)
        case '/search':
        case '/cloudsearch': {
            const query = String(params.keywords || '').trim()
            if (!query || query.length > 200) throw new Error('请输入 1–200 字的搜索关键词')
            const type = number(params.type, 1, 1, 2000)
            if (![1,10,100,1000,1002,1004,1006,1009].includes(type)) throw new Error('网易云搜索类型暂未支持')
            const data = await this.data('/api/cloudsearch/pc', { s: query, type, limit: limit(), offset: offset(), total: true }, cookie)
            const key = { 1:'songs',10:'albums',100:'artists',1000:'playlists',1002:'userprofiles',1004:'mvs',1006:'songs',1009:'djRadios' }[type]
            const result = data.result
            if (!result || typeof result !== 'object') throw new Error('网易云搜索响应不完整')
            // Empty arrays may be omitted by the upstream for genuine zero hits.
            const count = Number(result[{ 1:'songCount',10:'albumCount',100:'artistCount',1000:'playlistCount',1002:'userprofileCount',1004:'mvCount',1006:'songCount',1009:'djRadiosCount' }[type]] || 0)
            const items = result[key] === undefined && count === 0 ? [] : array(result[key], '搜索')
            if (type === 1 || type === 1006) result.songs = items.map(neteaseTrack).filter(Boolean)
            if (type === 1004) result.videos = items.map(mv => ({ ...mv, vid: mv.id, title: mv.name, coverUrl: mv.cover, durationms: mv.duration, creator: mv.artists || [], type: 0 }))
            return { ...data, result, total: count }
        }
        case '/song/detail': return this.tracks(String(params.ids || '').split(',').filter(Boolean), cookie)
        case '/song/url/v1': {
            const ids = String(params.id || '').split(',').map(id)
            if (ids.length > 100) throw new Error('每次最多请求 100 首播放授权')
            const level = String(params.level || 'standard')
            if (!['standard','higher','exhigh','lossless','hires','jyeffect','sky','jymaster','dolby'].includes(level)) throw new Error('网易云音质参数无效')
            const result = await this.playback.playback({ ids: JSON.stringify(ids), level, encodeType: 'flac', ...(level === 'sky' ? { immerseType: params.immerseType || 'c51' } : {}) }, cookie)
            const items = array(result.data, '播放授权')
            // Upstream may reorder a batch. Preserve caller order; never invent
            // an external URL when the platform returns a rights rejection.
            const map = new Map(items.map(item => [String(item.id), item]))
            return { ...result, data: ids.map(id => {
                const item = map.get(id)
                if (!item) throw new Error('网易云缺少所请求歌曲的播放授权结果')
                if (!item.url) return item
                const url = new URL(item.url)
                if (!['http:','https:'].includes(url.protocol) || !/(^|\.)music\.126\.net$/.test(url.hostname)) throw new Error('网易云返回了非官方音频地址')
                url.protocol = 'https:'
                return { ...item, url: url.href }
            }) }
        }
        case '/lyric':
        case '/lyric/new': return this.data(route === '/lyric' ? '/api/song/lyric' : '/api/song/lyric/v1', { id: id(params.id), lv: -1, kv: -1, tv: -1, rv: -1, yv: -1, ytv: -1, yrv: -1, cp: false }, cookie)
        case '/album': {
            const data = await this.data('/api/v1/album/' + id(params.id), {}, cookie)
            if (!data.album) throw new Error('网易云专辑详情不完整')
            const songs = array(data.songs || data.album.songs, '专辑歌曲').map(neteaseTrack).filter(Boolean)
            return { ...data, songs, album: { ...data.album, songs } }
        }
        case '/playlist/detail': {
            return this.playlistDetail(params.id, cookie)
        }
        case '/playlist/track/all': {
            const detail = await this.playlistDetail(params.id, cookie, true)
            if (!detail.playlist) throw new Error('网易云歌单详情不完整')
            const ids = array(detail.playlist.trackIds, '歌单曲目 ID').map(track => track.id)
            const start = offset(), count = limit(100, 1000)
            const requested = ids.slice(start, start + count)
            const embedded = new Map(detail.playlist.tracks.map(track => [String(track.id), track]))
            const result = requested.every(id => embedded.has(String(id)))
                ? { code: 200, songs: requested.map(id => embedded.get(String(id))) }
                : await this.tracks(requested, cookie)
            return { ...result, total: ids.length, hasMore: start + count < ids.length, offset: start + Math.min(count, Math.max(0, ids.length - start)) }
        }
        case '/toplist': { const data = await this.data('/api/toplist', {}, cookie); array(data.list, '排行榜'); return data }
        case '/banner': { const data = await this.data('/api/v2/banner/get', { clientType: 'pc' }, cookie); array(data.banners, '横幅'); return data }
        case '/personalized': { const data = await this.data('/api/personalized/playlist', { limit: limit(10), total: true, n: 1000 }, cookie); array(data.result, '推荐歌单'); return data }
        case '/personalized/newsong': { const data = await this.data('/api/personalized/newsong', { limit: limit(12) }, cookie); array(data.result, '新歌'); return data }
        case '/top/playlist': { const data = await this.data('/api/playlist/list', { cat: String(params.cat || '全部'), order: params.order === 'new' ? 'new' : 'hot', offset: offset(), limit: limit(20), total: true }, cookie); array(data.playlists, '歌单'); return data }
        case '/top/artists': { const data = await this.data('/api/artist/top', { offset: offset(), limit: limit(), total: true }, cookie); array(data.artists, '歌手'); return data }
        case '/top/song': { const data = await this.data('/api/v1/discovery/new/songs', { areaId: number(params.type, 0, 0, 100), total: true }, cookie); return { ...data, data: array(data.data, '新歌').map(neteaseTrack).filter(Boolean) } }
        case '/user/detail': return this.data('/api/v1/user/detail/' + id(params.uid), {}, cookie)
        case '/user/playlist': { const data = await this.data('/api/user/playlist', { uid: id(params.uid), offset: offset(), limit: limit(100,1000), includeVideo: true }, cookie); array(data.playlist, '用户歌单'); return data }
        case '/login/status':
        case '/user/account': return this.data('/api/nuser/account/get', {}, cookie)
        case '/login/qr/key': {
            for (const [key, state] of this.qr) if (this.now() - state.time > 180000) this.qr.delete(key)
            if (this.qr.size >= 10) throw new Error('登录二维码创建过多，请稍后重试')
            const data = await this.data('/api/login/qrcode/unikey', { type: 1 }, '')
            if (typeof data.unikey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.unikey)) throw new Error('网易云未返回有效二维码标识')
            this.qr.set(data.unikey, { time: this.now() })
            return { code: 200, data: { unikey: data.unikey } }
        }
        case '/login/qr/create': {
            const key = String(params.key || '')
            if (!this.qr.has(key) || this.now() - this.qr.get(key).time > 180000) throw new Error('二维码已过期，请刷新')
            const qrurl = 'https://music.163.com/login?codekey=' + encodeURIComponent(key)
            return { code: 200, data: { qrurl, qrimg: await this.qrImage(qrurl) } }
        }
        case '/login/qr/cancel': { this.qr.delete(String(params.key || '')); return { code: 200 } }
        case '/login/qr/check': {
            const key = String(params.key || ''), state = this.qr.get(key)
            if (!state || this.now() - state.time > 180000) { this.qr.delete(key); return { code: 800, message: '二维码已过期，请刷新' } }
            if (state.pending) return state.pending
            state.pending = (async () => {
                const result = await this.post('/api/login/qrcode/client/login', { key, type: 1 }, '')
                if (this.qr.get(key) !== state) return { code: 800, message: '登录已取消' }
                if (![800,801,802,803].includes(result.body.code)) throw new Error(result.body.message || '网易云扫码暂不可用')
                if (result.body.code === 803) {
                    const cookies = array(result.cookies, '登录 Cookie').map(value => value.split(';')[0]).join('; ')
                    if (!/(?:^|;\s*)MUSIC_U=/.test(cookies)) throw new Error('网易云未返回完整登录凭据，请重新扫码')
                    const account = await this.call('/login/status', {}, cookies)
                    if (this.qr.get(key) !== state) return { code: 800, message: '登录已取消' }
                    if (!account.account?.id || !account.profile?.userId) throw new Error('网易云未确认有效登录，请重新扫码')
                    this.qr.delete(key)
                    return { ...result.body, cookie: cookies, profile: account.profile }
                }
                if (result.body.code === 800) this.qr.delete(key)
                return result.body
            })().finally(() => { state.pending = null })
            return state.pending
        }
        case '/comment/music':
        case '/comment/playlist':
        case '/comment/album': {
            const prefix = { '/comment/music':'R_SO_4_', '/comment/playlist':'A_PL_0_', '/comment/album':'R_AL_3_' }[route]
            const data = await this.data('/api/v1/resource/comments/' + prefix + id(params.id), { limit: limit(20), offset: offset(), beforeTime: number(params.before,0,0,Number.MAX_SAFE_INTEGER) }, cookie)
            array(data.comments, '评论'); return data
        }
        }
    }
}
