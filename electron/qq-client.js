// QQ's public HTTPS/RPC contracts. Business requests are authored here; no
// third-party music API module or local API server participates in these routes.
import axios from 'axios'
import { randomInt } from 'node:crypto'
import { qqAccountId, qqCookieValue, qqGtk } from './qq-account.js'
import { qqStreamInfo } from '../src/utils/playback-quality.js'

const GATEWAY = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const PUBLIC = 'https://c.y.qq.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
const success = data => ({ code: 0, data })
const integer = (value, fallback, minimum, maximum) => {
    const number = value === undefined ? fallback : Number(value)
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error('QQ 请求分页参数无效')
    return number
}
const identifier = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('QQ ID 超出安全精度，请使用字符串')
    const id = String(value ?? '')
    if (!/^[a-zA-Z0-9]{1,100}$/.test(id)) throw new Error('缺少有效的 QQ 音乐 ID')
    return id
}
const list = (value, name) => {
    if (!Array.isArray(value)) throw new Error(`QQ ${name}响应不完整，请重试`)
    return value
}
function accepted(payload, context) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.code !== 0) throw new Error(`QQ ${context}失败（${payload?.code ?? '无有效响应'}）`)
    if (payload.subcode !== undefined && payload.subcode !== 0) throw new Error(`QQ ${context}被拒绝（${payload.subcode}）`)
    return payload
}
const webImage = value => typeof value === 'string' ? value.replace(/^http:\/\//, 'https://') : ''
const LITE_COMM = { ct: 11, cv: '1003006', v: '1003006', os_ver: '15', phonetype: '24122RKC7C', tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI', udid: '0' }
const FILE_FORMATS = { '128': ['M500', '.mp3'], '320': ['M800', '.mp3'], m4a: ['C400', '.m4a'], flac: ['F000', '.flac'], ape: ['A000', '.ape'] }

function mediaURL(domain, relative) {
    if (!relative || /^\w+:|^\/\//.test(relative)) return ''
    try {
        const base = new URL(domain), url = new URL(relative, base)
        if (!['http:', 'https:'].includes(base.protocol) || !/(^|\.)qq\.com$/i.test(base.hostname) || url.origin !== base.origin) return ''
        url.protocol = 'https:'
        return url.href
    } catch { return '' }
}

export class QQClient {
    constructor({ request = config => axios(config), now = () => Date.now(), wordLyrics = async () => null } = {}) {
        this.request = request
        this.now = now
        this.rankCache = null
        this.searchSession = null
        this.wordLyrics = wordLyrics
    }

    async send(url, { params, data, cookie = '' } = {}) {
        let response
        try {
            response = await this.request({ url, method: data ? 'POST' : 'GET', params, data, timeout: 12000,
                headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } })
        } catch (error) {
            // Axios errors carry request headers. Never serialize them across IPC.
            throw new Error(error?.response?.status ? `QQ 音乐服务暂不可用（HTTP ${error.response.status}）` : 'QQ 音乐连接失败，请检查网络后重试')
        }
        return response?.data
    }

    async rpc(module, method, param, cookie = '', comm = {}, allowEmptyData = false) {
        const body = accepted(await this.send(GATEWAY, { cookie,
            data: { comm: { ct: 24, cv: 0, uin: qqAccountId(cookie) || '0', format: 'json', ...comm }, req: { module, method, param } }
        }), method)
        return accepted(body.req, method).data ?? (allowEmptyData ? {} : (() => { throw new Error(`QQ ${method}响应缺少数据`) })())
    }

    async mutatePlaylistSongs(dissid, songs, cookie, remove = false) {
        if (!cookie || !qqAccountId(cookie)) throw new Error('请先登录 QQ 音乐')
        const playlistId = identifier(dissid)
        if (!/^\d+$/.test(playlistId) || playlistId === '0') throw new Error('QQ 歌单 ID 无效')
        if (!Array.isArray(songs) || !songs.length || songs.length > 100) throw new Error('请选择 1–100 首歌曲')
        // APK newfolderprotocol/r.java: getId() -> dirId, getDisstId() -> tid.
        // The website uses the same PlaylistDetailWrite contract (common.js).
        const playlists = await this.userPlaylists(qqAccountId(cookie), cookie, 'created')
        const playlist = playlists.find(item => String(item.dissid) === playlistId)
        const dirId = Number(playlist?.directoryId)
        if (!Number.isSafeInteger(dirId) || dirId <= 0) throw new Error('未找到可编辑的 QQ 歌单，请刷新歌单后重试')
        const tracks = []
        for (const song of songs) {
            const key = identifier(typeof song === 'object' && song ? (song.songmid || song.mid || song.songid || song.id) : song)
            const track = await this.track(key, cookie)
            if (!/^\d+$/.test(key) && track.mid !== key || /^\d+$/.test(key) && String(track.id) !== key) throw new Error('QQ 返回的歌曲与所选歌曲不匹配，未执行歌单操作')
            const songId = Number(track.id), songType = Number(track.type ?? 0)
            if (!Number.isSafeInteger(songId) || songId <= 0 || !Number.isSafeInteger(songType) || songType < 0) throw new Error('QQ 歌曲 ID 或类型无效，未执行歌单操作')
            if (!tracks.some(item => item.songId === songId && item.songType === songType)) tracks.push({ songType, songId })
        }
        const method = remove ? 'DelSonglist' : 'AddSonglist'
        const data = await this.rpc('music.musicasset.PlaylistDetailWrite', method, { dirId, v_songInfo: tracks }, cookie, {}, true)
        if (data.code !== undefined && data.code !== 0) throw new Error(`QQ ${method}被拒绝（${data.code}）`)
        return { code: 0, data }
    }

    async createPlaylist(name, cookie = '') {
        const title = String(name || '').trim()
        if (!title) throw new Error('歌单名称不能为空')
        if (title.length > 40) throw new Error('歌单名称不能超过 40 个字符')
        const data = await this.rpc('music.musicasset.PlaylistBaseWrite', 'AddPlaylist', {
            dirName: title, dirDesc: '', dirPicUrl: '', taglist: []
        }, cookie)
        if (data?.result === undefined && data?.tid === undefined && data?.dirId === undefined) throw new Error('QQ 新建歌单响应不完整')
        return data
    }

    async deletePlaylist(dirId, cookie = '') {
        const id = String(dirId || '')
        if (!/^\d+$/.test(id) || id === '0') throw new Error('QQ 歌单 ID 无效')
        return this.rpc('music.musicasset.PlaylistBaseWrite', 'DelPlaylist', { dirId: Number(id) || id }, cookie)
    }

    async liteSearchSession() {
        if (!this.searchSession || this.now() - this.searchSession.time >= 900000) {
            const pending = this.rpc('music.getSession.session', 'GetSession', { caller: 0, uid: '0', vkey: 0 }, '', LITE_COMM).then(data => {
                const session = data.session
                if (!session?.sid || !session?.uid) throw new Error('QQ 未返回有效的搜索会话')
                return { ...LITE_COMM, uid: String(session.uid), sid: String(session.sid), userip: session.userip }
            })
            const state = { time: this.now(), pending }
            this.searchSession = state
            pending.catch(() => { if (this.searchSession === state) this.searchSession = null })
        }
        return this.searchSession.pending
    }

    async track(value, cookie = '') {
        const id = identifier(value)
        const data = await this.rpc('music.pf_song_detail_svr', 'get_song_detail', /^\d+$/.test(id)
            ? { song_id: integer(id, undefined, 1, Number.MAX_SAFE_INTEGER) } : { song_mid: id }, cookie)
        if (!data.track_info?.mid || !data.track_info?.id) throw new Error('QQ 歌曲不存在或无权读取')
        return data.track_info
    }

    async userPlaylists(uin, cookie, kind = 'created') {
        if (!['created','collected'].includes(kind)) throw new Error('QQ 歌单分类无效')
        const field = kind === 'created' ? 'selfDirs' : 'orderDirs'
        const data = accepted(await this.rpc('music.mobileAsset.GetFav', kind === 'created' ? 'CgiGetSelfDiss' : 'CgiGetOrderDiss', {
            uin: String(uin), local_time: Math.floor(this.now()/1000), clientSelfDirs: [], clientOrderDirs: [], getSelfDirs:1, getOrderDirs:1, getTipInfo: 1
        }, cookie), '个人歌单')
        if (Number(data[kind === 'created' ? 'code_selfDirs' : 'code_orderDirs'] || 0)) throw new Error('QQ 个人歌单同步被拒绝')
        const items = list(data[field], '个人歌单').filter(p => Number(p.optype) !== 2)
        const total = Number(data[kind === 'created' ? 'selfdirnum' : 'favdirnum'] ?? items.length)
        if (total > items.length) throw new Error('QQ 个人歌单尚未完整同步，请重试')
        return items.map(p => ({ dissid: String(p.disstid), diss_name: p.title || '', picurl: webImage(p.bigpic || p.picurl),
            song_count: Number(p.songnum || 0), type: Number(p.dirid) === 201 ? 1 : 0, directoryId: p.dirid,
            kind, creator: {name:p.host_nick || ''} })).filter(p => p.dissid !== '0' && /^\d+$/.test(p.dissid))
    }

    async get(path, params = {}, cookie = '') {
        return accepted(await this.send(PUBLIC + path, { cookie, params: {
            format: 'json', inCharset: 'utf8', outCharset: 'utf-8', platform: 'yqq.json', needNewCode: 0,
            g_tk: qqGtk(cookie), loginUin: qqAccountId(cookie) || '0', hostUin: 0, ...params
        } }), path.split('/').at(-1))
    }

    supports(endpoint, params = {}) {
        return ['/getSmartbox', '/getHotkey', '/getAlbumInfo', '/getAlbumTracks', '/getSongLists', '/getSongListCategories',
            '/getSongListDetail', '/getRanks', '/getTopLists', '/getNewDisks', '/getSingerList', '/getSingerHotsong', '/getSingerAlbum', '/getSingerDesc',
            '/getSearchByKey', '/getSongInfo', '/getMusicPlay', '/getLyric', '/batchGetSongInfo', '/getSingerMv', '/getSimilarSinger', '/getSingerStarNum',
            '/getDigitalAlbumLists', '/getTicketInfo', '/getMv', '/getMvByTag', '/getImageUrl', '/getRadioLists', '/getRecommend', '/user/getUserAvatar', '/getMvPlay', '/batchGetSongLists', '/downloadQQMusic', '/user/getUserPlaylists'].includes(endpoint)
    }

    async call(endpoint, params = {}, cookie = '') {
        const page = () => integer(params.page, 1, 1, 10000)
        const limit = () => integer(params.limit, 20, 1, 100)
        switch (endpoint) {
        case '/getMv': {
            const payload = await this.get('/mv/fcgi-bin/fcg_get_mv_by_tag.fcg', { area_id: integer(params.area_id, 15, 0, 1000), version_id: integer(params.version_id, 7, 0, 1000), sin: integer(params.page, 0, 0, 100000) * limit(), ein: integer(params.page, 0, 0, 100000) * limit() + limit() - 1 }, cookie)
            return payload
        }
        case '/getMvByTag': {
            const payload = await this.get('/mv/fcgi-bin/fcg_get_mv_by_tag.fcg', { tag: params.tag || '', sin: (page() - 1) * limit(), ein: page() * limit() - 1 }, cookie)
            return payload
        }
        case '/getImageUrl': {
            const id = identifier(params.id)
            return success({ url: `https://y.gtimg.cn/music/photo_new/T002R${String(params.size || '300x300').replace(/[^0-9x]/g, '')}M000${id}.jpg` })
        }
        case '/user/getUserAvatar': {
            const uin = identifier(params.uin)
            return success({ url: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=${integer(params.size, 140, 40, 640)}` })
        }
        case '/getRadioLists': {
            return this.get('/v8/fcg-bin/fcg_v8_radiolist.fcg', { format: 'json' }, cookie)
        }
        case '/getRecommend': {
            const data = await this.rpc('music.individuation.Recommend', 'GetRecommend', { from: 100, content_type: 0, page: 0, num: limit() }, cookie)
            return success(data)
        }
        case '/getSearchByKey': {
            const key = String(params.key || '').trim()
            if (!key || key.length > 200) throw new Error('请输入 1–200 字的搜索关键词')
            const type = Number(params.catZhida ?? 0)
            if (![0, 1, 2, 3, 4].includes(type)) throw new Error('QQ 搜索类型无效')
            const count = limit(), currentPage = page()
            if ([1, 3, 4].includes(type)) {
                const comm = await this.liteSearchSession()
                const data = await this.rpc('music.search.SearchCgiService', 'DoSearchForQQMusicLite', {
                    query: key, search_type: type, num_per_page: count, page_num: currentPage, highlight: 0, nqc_flag: 0,
                    page_id: 1, grp: 1, remoteplace: 'search.android.keyboard', search_id: String(this.now())
                }, cookie, comm)
                if (Number(data.meta?.is_filter) < 0) throw new Error('QQ 搜索被平台限制，请稍后重试')
                const keyName = { 1: 'singer', 3: 'item_songlist', 4: 'item_mv' }[type]
                const items = list(data.body?.[keyName], '分类搜索').map(item => ({
                    ...item, ...(type === 3 ? { imgurl: webImage(item.logo) } : {}),
                    ...(type === 4 ? { mv_name: item.mvname, mv_pic_url: webImage(item.pic) } : {}),
                    ...(type === 1 ? { singerPic: webImage(item.singerPic) } : {})
                }))
                return success({ list: items, total: Number(data.meta?.sum || 0) })
            }
            const payload = await this.get('/soso/fcgi-bin/search_for_qq_cp', { w: key, n: count, p: currentPage, t: type === 2 ? 8 : 0 }, cookie)
            const group = payload.data?.[type === 2 ? 'album' : 'song']
            list(group?.list, '搜索')
            return success({ ...payload.data, list: group.list, total: Number(group.totalnum ?? group.total ?? 0) })
        }
        case '/getSmartbox': {
            const payload = await this.get('/splcloud/fcgi-bin/smartbox_new.fcg', { key: String(params.key || '').trim(), is_xml: 0 }, cookie)
            if (!payload.data?.song || !Array.isArray(payload.data.song.itemlist)) throw new Error('QQ 搜索建议响应不完整')
            return payload
        }
        case '/getHotkey': {
            const data = await this.rpc('music.musicsearch.HotkeyService', 'GetHotkeyForQQMusicMobile', { searchid: '', remoteplace: 'txt.yqq.top', from: 'yqqweb' }, cookie)
            if (data.ret_code !== undefined && data.ret_code !== 0) throw new Error('QQ 热搜暂不可用')
            return success({ hotkey: list(data.vec_hotkey, '热搜').map(item => ({ k: item.query || item.title || '' })).filter(item => item.k) })
        }
        case '/getSongInfo': {
            const track = await this.track(params.songmid, cookie)
            return success({ ...track, songInfo: track, track_info: track })
        }
        case '/batchGetSongInfo': {
            if (!Array.isArray(params.songs) || params.songs.length > 100) throw new Error('QQ 批量详情每次最多 100 首')
            const ids = params.songs.map(song => identifier(Array.isArray(song) ? song[0] || song[1] : typeof song === 'object' ? song?.songmid || song?.id : song))
            const songs = []
            for (let index = 0; index < ids.length; index += 4) songs.push(...await Promise.all(ids.slice(index, index + 4).map(id => this.track(id, cookie))))
            return success({ list: songs })
        }
        case '/downloadQQMusic':
        case '/getMusicPlay': {
            const quality = String(params.quality || '128')
            if (!FILE_FORMATS[quality]) throw new Error('QQ 音质参数无效')
            const requested = identifier(params.songmid)
            const track = await this.track(requested, cookie)
            const media = identifier(track.file?.media_mid || track.mid)
            const [prefix, extension] = FILE_FORMATS[quality]
            const guid = String(randomInt(1000000000, 9999999999)), uin = qqAccountId(cookie) || '0'
            const data = await this.rpc('vkey.GetVkeyServer', 'CgiGetVkey', {
                filename: [`${prefix}${media}${extension}`], guid, songmid: [track.mid], songtype: [track.type || 0],
                uin, loginflag: uin === '0' ? 0 : 1, platform: '20',
                ...(qqCookieValue(cookie, 'qqmusic_key') ? { authst: qqCookieValue(cookie, 'qqmusic_key') } : {})
            }, cookie)
            if (data.retcode !== 0) throw new Error('QQ 未授权当前音质的播放链接')
            const entry = list(data.midurlinfo, '播放授权').find(item => item.songmid === track.mid)
            let url = ''
            if (entry?.purl) for (const domain of list(data.sip, '音频地址')) { url = mediaURL(domain, entry.purl); if (url) break }
            return success({ playUrl: { [requested]: { url, ...qqStreamInfo(entry?.purl), requestedQuality: quality, fullDuration: track.interval || 0,
                ...(url ? {} : { error: '当前账号暂无此音质的播放权限，可能需要登录、会员或购买专辑' }) } } })
        }
        case '/getLyric': {
            const track = await this.track(params.songmid, cookie)
            const [standard, words] = await Promise.allSettled([this.rpc('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
                songMID: track.mid, songID: track.id, trans_t: 0, roma_t: 0, qrc_t: 0, crypt: 0, lrc_t: 0, interval: track.interval || 0
            }, cookie), this.wordLyrics(track)])
            const rich = words.status === 'fulfilled' ? words.value : null
            if (standard.status === 'rejected' && !rich?.yrc && !rich?.lrc) throw standard.reason
            const data = standard.status === 'fulfilled' ? standard.value : {}
            if (data.crypt !== 0 && data.lyric) throw new Error('QQ 返回了不支持的歌词编码')
            const decode = value => typeof value === 'string' && value ? Buffer.from(value, 'base64').toString('utf8') : ''
            const lrc = decode(data.lyric) || rich?.lrc || '', trans = rich?.trans || decode(data.trans)
            return { code: 0, lyric: lrc, lrc, yrc: rich?.yrc || '', trans }
        }
        case '/getAlbumTracks': {
            const data = await this.rpc('music.musichallAlbum.AlbumSongList', 'GetAlbumSongList', {
                albumMid: identifier(params.albummid), albumID: 0, begin: integer(params.offset, 0, 0, 100000), num: limit(), order: 2
            }, cookie)
            const songs = list(data.songList, '专辑曲目').map(item => item.songInfo || item)
            const offset = integer(params.offset, 0, 0, 100000)
            return success({ list: songs, total: Number(data.totalNum || 0), offset: offset + songs.length, hasMore: songs.length > 0 && offset + songs.length < Number(data.totalNum || 0) })
        }
        case '/getAlbumInfo': {
            const mid = identifier(params.albummid)
            const [info, tracks] = await Promise.all([
                this.rpc('music.musichallAlbum.AlbumInfoServer', 'GetAlbumDetail', { albumMid: mid }, cookie),
                this.call('/getAlbumTracks', { albummid: mid, limit: 100 }, cookie)
            ])
            const basic = info.basicInfo
            if (!basic?.albumName) throw new Error('未找到此 QQ 专辑')
            return success({ id: basic.albumID, mid, name: basic.albumName, aDate: basic.publishDate, desc: basic.desc || '',
                company: info.company?.name || '', singers: Array.isArray(info.singer) ? info.singer : info.singer?.singerList || [], ...tracks.data })
        }
        case '/getSongListCategories': {
            const payload = await this.get('/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg', {}, cookie)
            list(payload.data?.categories, '歌单分类')
            return payload
        }
        case '/getSongLists': {
            const count = limit(), offset = (page() - 1) * count
            const payload = await this.get('/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg', {
                categoryId: integer(params.categoryId, 10000000, 0, 100000000), sortId: integer(params.sortId, 5, 1, 5), sin: offset, ein: offset + count - 1
            }, cookie)
            list(payload.data?.list, '歌单')
            return payload
        }
        case '/getSongListDetail': {
            const offset = integer(params.offset, 0, 0, 100000)
            const payload = accepted(await this.rpc('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
                disstid: integer(identifier(params.disstid), undefined, 1, Number.MAX_SAFE_INTEGER), song_begin: offset, song_num: limit()
            }, cookie), '歌单详情')
            const info = payload.dirinfo
            if (!info?.title) throw new Error('QQ 歌单不存在或无权访问')
            const songs = list(payload.songlist, '歌单曲目')
            const total = Number(payload.total_song_num ?? info.songnum ?? 0)
            return { code: 0, cdlist: [{ dissname: info.title, logo: webImage(info.picurl), desc: info.desc,
                nickname: info.host_nick || info.creator?.nick || '', listennum: info.listennum,
                songnum: total, songlist: songs }], total, offset: offset + songs.length,
                hasMore: songs.length > 0 && offset + songs.length < total }
        }
        case '/getTopLists': {
            if (this.rankCache && this.now() - this.rankCache.time < 300000) return success({ topList: this.rankCache.items })
            const data = await this.rpc('musicToplist.ToplistInfoServer', 'GetAll', {}, cookie)
            const items = list(data.group, '排行榜分类').flatMap(group => list(group.toplist, '排行榜').map(item => ({
                ...item, groupName: group.groupName, frontPicUrl: webImage(item.frontPicUrl), headPicUrl: webImage(item.headPicUrl)
            })))
            this.rankCache = { time: this.now(), items }
            return success({ topList: items })
        }
        case '/getRanks': {
            const topid = integer(params.topId, undefined, 1, 1000000)
            const charts = await this.call('/getTopLists', {}, cookie)
            const chart = charts.data.topList.find(item => Number(item.topId) === topid)
            if (!chart?.period) throw new Error('该 QQ 榜单当前没有可用期次，请刷新排行榜')
            // Legacy IPC names page as an absolute offset. Retain that contract.
            const data = await this.rpc('musicToplist.ToplistInfoServer', 'GetDetail', {
                topid, offset: integer(params.page, 0, 0, 100000), num: limit(), period: chart.period
            }, cookie)
            list(data.songInfoList, '榜单曲目')
            if (!data.data?.title) throw new Error('QQ 榜单详情响应不完整')
            return { code: 0, req_1: { code: 0, data: { ...data, topInfo: data.data } } }
        }
        case '/getNewDisks': {
            const count = limit()
            const data = await this.rpc('newalbum.NewAlbumServer', 'get_new_album_info', { area: 1, start: (page() - 1) * count, num: count }, cookie)
            list(data.albums, '新碟')
            return success(data)
        }
        case '/getSingerList': {
            // This RPC has a fixed upstream page size of 80; num is ignored.
            const count = limit(), offset = (page() - 1) * count
            const first = Math.floor(offset / 80), last = Math.floor((offset + count - 1) / 80)
            const pages = await Promise.all(Array.from({ length: last - first + 1 }, (_, index) => {
                const position = first + index
                return this.rpc('Music.SingerListServer', 'get_singer_list', {
                    area: integer(params.area, -100, -100, 1000), sex: integer(params.sex, -100, -100, 1000),
                    genre: integer(params.genre, -100, -100, 1000), index: -100, sin: position * 80, cur_page: position + 1
                }, cookie)
            }))
            const singers = pages.flatMap(data => list(data.singerlist, '歌手')).slice(offset % 80, offset % 80 + count)
            return success({ ...pages[0], singerlist: singers })
        }
        case '/getSingerDesc': {
            const id = identifier(params.singermid)
            const data = await this.rpc('music.musichallSinger.SingerInfoInter', 'GetSingerDetail', { singer_mids: [id], ex_singer: 1, wiki_singer: 1 }, cookie)
            const info = list(data.singer_list, '歌手资料')[0]
            if (!info?.basic_info?.name) throw new Error('未找到此 QQ 歌手')
            return { code: 0, singer: { id: info.basic_info.singer_id, name: info.basic_info.name,
                pic: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${id}.jpg`, desc: info.ex_info?.desc || '' } }
        }
        case '/getSingerHotsong': {
            const count = limit()
            const data = await this.rpc('music.musichallSong.SongListInter', 'GetSingerSongList', { singerMid: identifier(params.singermid), begin: (page() - 1) * count, num: count, order: 1 }, cookie)
            return success({ songlist: list(data.songList, '歌手热门歌曲').map(item => item.songInfo || item), total: data.totalNum })
        }
        case '/getSingerAlbum': {
            const count = limit()
            const data = await this.rpc('music.musichallAlbum.AlbumListServer', 'GetAlbumList', { singerMid: identifier(params.singermid), begin: (page() - 1) * count, num: count, order: 1 }, cookie)
            return success({ ...data, list: list(data.albumList, '歌手专辑') })
        }
        case '/getSingerMv': {
            const payload = await this.get('/mv/fcgi-bin/fcg_singer_mv.fcg', { singermid: identifier(params.singermid), order: params.order === 'time' ? 'time' : 'listen', cmd: params.order === 'time' ? 1 : 0, num: limit(), begin: 0, cid: 205360581 }, cookie)
            list(payload.data?.list, '歌手 MV')
            return payload
        }
        case '/getSimilarSinger': {
            const payload = await this.get('/v8/fcg-bin/fcg_v8_simsinger.fcg', { singermid: identifier(params.singermid), utf8: 1, start: 0, num: 8 }, cookie)
            list(payload.data?.singerlist, '相似歌手')
            return payload
        }
        case '/getSingerStarNum': {
            const payload = await this.get('/rsc/fcgi-bin/fcg_order_singer_getnum.fcg', { singermid: identifier(params.singermid), utf8: 1 }, cookie)
            if (!Number.isFinite(Number(payload.num))) throw new Error('QQ 粉丝数量响应不完整')
            return success({ star_num: Number(payload.num) })
        }
        case '/getDigitalAlbumLists': {
            const payload = await this.get('/v8/fcg-bin/musicmall.fcg', { cmd: 'pc_index_new' }, cookie)
            const albums = list(payload.data?.content, '数字专辑分类').flatMap(group => list(group.albumlist, '数字专辑'))
            const unique = [...new Map(albums.filter(album => album.album_mid).map(album => [album.album_mid, album])).values()]
            const count = limit(), offset = (page() - 1) * count
            return success({ albumList: unique.slice(offset, offset + count).map(album => ({
                albumMID: album.album_mid, albumName: album.album_name, singerName: album.singer_name,
                price: Number.isFinite(Number(album.price)) ? (Number(album.price) / 100).toFixed(2) : ''
            })), total: unique.length })
        }
        case '/getTicketInfo': {
            const data = await this.rpc('mall.ticket_index_page_svr', 'GetTicketIndexPage', { city_id: -1 }, cookie)
            if (data.status !== 1) throw new Error('QQ 演出列表暂不可用')
            const shows = [...list(data.more, '演出'), ...list(data.classes, '演出分类').flatMap(group => list(group.showlist, '演出'))]
            // This legacy official service still returns 2023 listings. Only
            // upcoming dates can appear as current shows in the product.
            const today = new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')
            const unique = [...new Map(shows.filter(show => String(show.show_date) >= today && /^\d{8}$/.test(String(show.show_date))).map(show => [show.show_id, show])).values()]
            return success({ list: unique.map(show => ({ id: show.show_id, name: show.show_name, time: String(show.show_date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), place: [show.city_name, show.hall_name].filter(Boolean).join(' · ') })) })
        }
        case '/getMvPlay': {
            const vid = identifier(params.vid)
            const data = await this.rpc('music.stream.MvUrlProxy', 'GetMvUrls', { vids: [vid], request_typet: 10001 }, cookie)
            const formats = data[vid]
            if (!formats || !Array.isArray(formats.mp4)) throw new Error('QQ 未返回该 MV 的播放授权')
            const versions = formats.mp4.flatMap(format => (format.freeflow_url || []).map(candidate => {
                try { const url = new URL(candidate); return { url: mediaURL(url.origin + '/', url.pathname + url.search), quality: format.filetype } } catch { return null }
            })).filter(item => item?.url)
            const preferred = versions.find(item => item.quality === 20) || versions[0]
            if (!preferred) throw new Error('该 MV 暂无播放权限，可能需要登录或会员')
            return success({ url: preferred.url, urls: [...new Set(versions.map(item => item.url))] })
        }
        case '/batchGetSongLists': {
            const ids = params.categoryIds ?? [10000000]
            if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) throw new Error('QQ 批量歌单每次需要 1–10 个分类')
            const current = integer(params.page, 0, 0, 9999) + 1, count = limit()
            const results = await Promise.allSettled(ids.map(categoryId => this.call('/getSongLists', { categoryId, sortId: params.sortId, page: current, limit: count }, cookie)))
            const items = results.filter(item => item.status === 'fulfilled').flatMap(item => item.value.data.list)
            if (results.every(item => item.status === 'rejected')) throw new Error('QQ 精选歌单加载失败，请重试')
            return success({ list: [...new Map(items.map(item => [item.dissid, item])).values()], failedCategories: ids.filter((_, index) => results[index].status === 'rejected') })
        }
        case '/user/getUserPlaylists': {
            const uin = identifier(params.uin)
            if (!/^\d+$/.test(uin)) throw new Error('QQ 账号 ID 无效')
            if (params.kind) {
                const items = await this.userPlaylists(uin,cookie,params.kind)
                const offset = integer(params.offset, 0, 0, 100000), count = integer(params.limit, 30, 1, 1000)
                return success({playlists:items.slice(offset,offset+count),total:items.length,hasMore:offset+count<items.length})
            }
            const data = await this.rpc('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin, bWithoutStatus: false }, cookie)
            const playlists = list(data.v_playlist, '用户歌单').map(item => ({
                dissid: String(item.tid), diss_name: item.dirName || '', picurl: webImage(item.picUrl), song_count: item.songNum || 0,
                type: Number(item.dirId) === 201 ? 1 : 0, directoryId: item.dirId
            })).filter(item => item.dissid && item.dissid !== '0')
            const offset = integer(params.offset, 0, 0, 100000), count = integer(params.limit, 30, 1, 1000)
            if (data.bFinish === false || Number(data.total || 0) > playlists.length) throw new Error('QQ 用户歌单列表未完整返回，请稍后重试')
            return success({ playlists: playlists.slice(offset, offset + count), total: playlists.length, hasMore: offset + count < playlists.length })
        }
        default: throw new Error('QQ 独立请求层尚未实现此操作')
        }
    }
}
