import axios from 'axios'
import { KugouAccount, kugouWebSign } from './kugou-account.js'
import { isKugouDirectRoute } from '../src/api/kugou-direct.js'
import { KugouPrivateClient } from './kugou-private.js'
import { kugouStreamInfo } from '../src/utils/playback-quality.js'

const integer = (value, fallback, min = 1, max = 100) => {
    const number = value === undefined || value === '' ? fallback : Number(value)
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('酷狗分页参数无效')
    return number
}
const id = value => { const s = String(value ?? ''); if (!/^[1-9]\d{0,17}$/.test(s) || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new Error('酷狗 ID 无效'); return s }
const hash = value => { if (!/^[a-fA-F0-9]{32}$/.test(value || '')) throw new Error('酷狗歌曲标识无效'); return value.toUpperCase() }
const list = (items, label) => { if (!Array.isArray(items)) throw new Error(`酷狗${label}响应不完整`); return items }
function image(url) { return String(url || '').replace('{size}', '480').replace(/^http:\/\//, 'https://') }
function artwork(item) {
    return { ...item, Image: image(item.Image || item.trans_param?.union_cover || item.album_img), img: image(item.img), imgurl: image(item.imgurl), sizable_cover: image(item.sizable_cover) }
}
function publicPlaylist(item) { return { ...artwork(item), _officialPublic: true } }

export class KugouClient {
    constructor({ request = config => axios(config), now = () => Date.now(), qrImage } = {}) {
        Object.assign(this, { request, now })
        this.privateClient = new KugouPrivateClient({request,now})
        this.account = new KugouAccount({ send: this.send.bind(this), now, qrImage, privateValidate:auth=>this.privateClient.vip(auth) })
    }
    supports(route, params) { return isKugouDirectRoute(route, params) }
    async send(url, params = {}, method = 'GET') {
        const target = new URL(url)
        if (!/(^|\.)kugou\.com$/.test(target.hostname) || !['https:','http:'].includes(target.protocol)) throw new Error('非官方酷狗请求地址')
        // The old mobile metadata CDN has no matching TLS certificate. Only
        // fixed, public, read-only metadata requests use HTTP, without tokens.
        if (target.protocol === 'http:' && (target.hostname !== 'mobilecdn.kugou.com' || Object.keys(params).some(k => /token|cookie|userid|password/i.test(k)))) throw new Error('账号请求必须使用 HTTPS')
        let result
        try { result = await this.request({ url, method, params, timeout: 12000, maxRedirects: 0, headers: { Referer: 'https://www.kugou.com/', 'User-Agent': 'Mozilla/5.0' } }) }
        catch (e) { throw new Error(e.response?.status ? `酷狗服务暂不可用（HTTP ${e.response.status}）` : '酷狗连接失败，请检查网络后重试') }
        const data = result?.data
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('酷狗返回了无效响应')
        return data
    }
    async data(url, params) {
        const result = await this.send(url, params)
        const error = Number(result.error_code || result.errcode || result.err_code || 0)
        if (result.status === 0 || error) throw new Error([20028,30020].includes(error) ? '酷狗要求安全验证，请在官方客户端完成验证' : `酷狗请求被拒绝（${error || result.status}）`)
        return result
    }
    async mobile(path, params) { return this.data('http://mobilecdn.kugou.com/api/v3/' + path, params) }
    async home() {
        if (this.homeCache && this.now() - this.homeCache.time < 30000) return this.homeCache.data
        if (this.homePending) return this.homePending
        this.homePending = this.data('https://m.kugou.com/', { json:true }).then(data => {
            list(data.data, '新歌'); list(data.banner, '推荐')
            this.homeCache = { time:this.now(), data }
            return data
        }).finally(() => { this.homePending = null })
        return this.homePending
    }
    async publicPlaylists(page, size) {
        // The official mobile site returns fixed 30-item pages. Translate the
        // caller's page size without skipping or repeating catalogue entries.
        const offset=(page-1)*size, songs=[], batch=30
        let cursor=Math.floor(offset/batch)+1, total=Infinity, skip=offset%batch
        while (songs.length<size && (cursor-1)*batch<total) {
            const response=await this.data('https://m.kugou.com/plist/index', {json:true,page:cursor})
            const data=response.plist?.list, items=list(data?.info,'推荐歌单')
            total=Number(data.total)
            if (!Number.isSafeInteger(total) || total<0 || items.length>batch) throw new Error('酷狗歌单分页响应异常')
            songs.push(...items.slice(skip,skip+size-songs.length)); skip=0; cursor++
            if (items.length<batch) break
        }
        return {status:1,data:{special_list:songs.map(publicPlaylist),total,has_next:offset+songs.length<total?1:0}}
    }
    async audio(value) {
        const requested = hash(value)
        const result = await this.data('https://m.kugou.com/app/i/getSongInfo.php', { cmd: 'playInfo', hash: requested })
        const variants = [result.hash, result.req_hash, ...Object.entries(result.extra || {}).filter(([k]) => /hash$/i.test(k)).map(([,v]) => v)].filter(Boolean).map(s => String(s).toUpperCase())
        if (!variants.includes(requested)) throw new Error('酷狗返回的歌曲与所选歌曲不匹配')
        return { ...result, requestedHash: requested }
    }
    async accountAudio(params) {
        const requested = hash(params.hash), userid = id(params.userid)
        if (!/^[a-zA-Z0-9_-]{8,2048}$/.test(String(params.token || ''))) throw new Error('酷狗登录凭据格式无效，请重新登录')
        const query = { appid:1014, platid:4, hash:requested, userid, token:params.token }
        for (const field of ['album_id','album_audio_id']) if (params[field]) query[field] = id(params[field])
        const result = await this.data('https://wwwapi.kugou.com/play/songinfo', kugouWebSign(query, this.now(), this.account.mid))
        const data = result.data
        if (!data || String(data.hash || '').toUpperCase() !== requested) throw new Error('酷狗返回的账号歌曲与所选歌曲不匹配')
        if (!data.play_url) throw new Error('酷狗账号未获得该歌曲的播放授权')
        return { ...data, url:data.play_url, bitRate:Number(data.bitrate || data.bitRate || 0), extName:data.extname || '', timeLength:Number(data.timelength || 0)/1000,
            is_trial:data.is_free_part === 1, requestedHash:requested, accountAuthorized:true }
    }
    async call(route, params = {}) {
        if (!this.supports(route, params)) throw new Error('该酷狗操作尚未独立接入')
        if (route.startsWith('/login/')) return this.account.call(route, params)
        const page = () => integer(params.page, 1, 1, 10000), size = () => integer(params.pagesize, 30, 1, 300)
        switch (route) {
        case '/user/vip/detail': return this.privateClient.vip(params)
        case '/user/playlist': return this.privateClient.playlists(params,page(),size())
        case '/playlist/track/all/new': return this.privateClient.playlistTracks(params,id(params.listid),page(),size())
        case '/playlist/tracks/add': {
            if (!Array.isArray(params.songs) || !params.songs.length || params.songs.length > 300) throw new Error('缺少要添加的歌曲')
            const songs = params.songs.map(song => {
                if (!song || typeof song !== 'object') throw new Error('歌曲信息不完整，请刷新后重试')
                const album = song.album_id ? Number(id(song.album_id)) : 0
                const mix = song.mixsongid || song.album_audio_id
                const mixId = mix ? Number(id(mix)) : 0
                if (!Number.isSafeInteger(album) || !Number.isSafeInteger(mixId)) throw new Error('歌曲 ID 超出安全精度')
                return { number:1,name:String(song.name || song.songname || ''),hash:hash(song.hash),size:0,sort:0,timelen:0,bitrate:0,album_id:album,mixsongid:mixId }
            })
            return this.privateClient.addPlaylistTracks(params,id(params.listid),songs)
        }
        case '/playlist/tracks/del': {
            const values = Array.isArray(params.fileids) ? params.fileids : String(params.fileids || '').split(',')
            if (!values.length || values.length > 300) throw new Error('缺少歌单歌曲 ID')
            const fileids = values.map(value => { const n=Number(id(value)); if (!Number.isSafeInteger(n)) throw new Error('歌单歌曲 ID 超出安全精度'); return n })
            return this.privateClient.deletePlaylistTracks(params,id(params.listid),fileids)
        }
        case '/top/song': return {status:1,data:(await this.home()).data.map(artwork)}
        case '/pc/diantai': {
            const data=(await this.home()).banner.filter(item => !item.isAd && !item.is_ad && item.extra?.specialid && item.imgurl)
                .map(item => ({code:image(item.imgurl),title:item.title || '',url:'/kugou/playlist/special:'+id(item.extra.specialid)}))
            return {status:1,data:{data}}
        }
        case '/top/album': {
            const result=await this.mobile('album/list',{page:page(),pagesize:size()})
            return {status:1,data:list(result.data?.info,'新碟').map(artwork)}
        }
        case '/top/playlist': return this.publicPlaylists(page(),size())
        case '/artist/lists': {
            const result=await this.mobile('singer/list',{page:1,pagesize:integer(params.hotsize,30,1,100)})
            return {status:1,data:{...result.data,info:list(result.data?.info,'歌手目录').map(artwork)}}
        }
        case '/search': {
            const keyword = String(params.keywords || '').trim(), type = params.type || 'song'
            if (!keyword || keyword.length > 200) throw new Error('请输入 1–200 字的关键词')
            if (!['song','author','album','special'].includes(type)) throw new Error('酷狗搜索分类暂未独立接入')
            if (type === 'song' || params.token && params.userid) {
                const result = await this.privateClient.search(params, keyword, page(), size(), type)
                const items = list(result.data?.lists ?? result.data?.info, '搜索')
                if (!Number.isFinite(Number(result.data?.total))) throw new Error('酷狗搜索缺少结果总数')
                return { ...result, data: { ...result.data, lists: items.map(type === 'special' ? publicPlaylist : artwork) } }
            }
            const urls = { song:'https://songsearch.kugou.com/song_search_v2', album:'https://albumsearch.kugou.com/album_search', special:'https://specialsearch.kugou.com/special_search', author:'https://complexsearch.kugou.com/v1/search/author' }
            let query = { keyword, page: page(), pagesize: size() }
            if (type === 'author') query = kugouWebSign({ ...query, appid:1014, platform:'WebFilter' }, this.now())
            const result = await this.data(urls[type], query)
            const items = list(result.data?.lists, '搜索')
            if (!Number.isFinite(Number(result.data.total))) throw new Error('酷狗搜索缺少结果总数')
            return { ...result, data: { ...result.data, lists: items.map(type === 'special' ? publicPlaylist : artwork) } }
        }
        case '/search/suggest': return this.data('https://searchtip.kugou.com/getSearchTip', { keyword:String(params.keywords || '').slice(0,200), MusicTipCount:integer(params.musicTipCount,8,1,30), MVTipCount:3, albumcount:3 })
        case '/search/hot': {
            const result = await this.mobile('search/hot', { plat: 0, count: 30 })
            return { status:1, data:{ list:[{ name:'热搜', keywords:list(result.data?.info,'热搜').map(item => ({ keyword:item.keyword })) }] } }
        }
        case '/album/detail': {
            const result = await this.mobile('album/info', { albumid:id(params.id) })
            if (!result.data?.albumname) throw new Error('酷狗未返回专辑信息')
            return { status:1, data:artwork(result.data) }
        }
        case '/album/songs': {
            const result = await this.mobile('album/song', { albumid:id(params.id), page:page(), pagesize:size() })
            return { status:1, data:{ ...result.data, list:list(result.data?.info,'专辑歌曲').map(artwork) } }
        }
        case '/artist/detail': {
            const result = await this.mobile('singer/info', { singerid:id(params.id) })
            if (!result.data?.singername) throw new Error('酷狗未返回歌手信息')
            return { status:1, data:artwork(result.data) }
        }
        case '/artist/audios':
        case '/artist/albums': {
            const result = await this.mobile(route.endsWith('audios')?'singer/song':'singer/album', { singerid:id(params.id), page:page(), pagesize:size(), sorttype:params.sort === 'new'?2:1 })
            return { status:1, data:{ ...result.data, list:list(result.data?.info,'歌手作品').map(artwork) } }
        }
        case '/rank/list': return this.mobile('rank/list', { withsong:integer(params.withsong,0,0,1) })
        case '/rank/audio': {
            const result = await this.mobile('rank/song', { rankid:id(params.rankid), page:page(), pagesize:size() })
            return { status:1, data:{ ...result.data, list:list(result.data?.info,'榜单歌曲').map(artwork) } }
        }
        case '/playlist/detail':
        case '/playlist/track/all': {
            const specialid = id(String(params.ids || params.id).slice(8))
            const info = await this.mobile('special/info', { specialid })
            if (!info.data?.specialname) throw new Error('酷狗未返回歌单信息')
            const detail = publicPlaylist(info.data)
            if (route === '/playlist/detail') return { status:1, data:[detail] }
            const result = await this.mobile('special/song', { specialid, page:page(), pagesize:size() })
            const songs = list(result.data?.info,'歌单歌曲').map(artwork)
            return { status:1, data:{ ...result.data, info:songs, songs, list_info:detail } }
        }
        case '/audio': {
            const result = await this.audio(params.hash)
            return { status:1, data:[{ ...result, hash:result.requestedHash, name:result.songName, author_name:result.singerName, timelen:result.timeLength*1000, cover:image(result.album_img), album_id:result.albumid, mixsongid:result.album_audio_id }] }
        }
        case '/song/url': {
            let result, accountNotice = ''
            if (params.token && params.userid) {
                hash(params.hash)
                try { result = await this.privateClient.playback(params,params) }
                catch (error) {
                    if (error.requiresVerification) throw error
                    try { result = await this.accountAudio(params) }
                    catch (e) { accountNotice = e.message + '；当前尝试游客可用音源' }
                }
            }
            if (!result) result = await this.audio(params.hash)
            const stream = kugouStreamInfo(result)
            let url = result.url || ''
            if (url) {
                const parsed = new URL(url)
                if (!['http:','https:'].includes(parsed.protocol) || !/(^|\.)kugou\.com$/.test(parsed.hostname)) throw new Error('酷狗返回非官方音频地址')
                url = parsed.href
            }
            return { status:1, data:{ url, ...stream, timeLength:result.timeLength, fullDuration:result.extra?.['128timelength']/1000 || result.timeLength, is_trial:!!result.is_trial || !!result.free_part, requestedHash:result.requestedHash, accountAuthorized:!!result.accountAuthorized, accountNotice } }
        }
        }
    }
}
