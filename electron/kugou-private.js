import { createHash, randomBytes } from 'node:crypto'

const md5 = value => createHash('md5').update(value).digest('hex')
const SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
// Concept-client tracker constants (UrlRequestor / BasicTrackerProtocol / g0).
const APPID = 3116
const PID = 411
const PID_VERSION = '3001'
const TRACKER_SECRET = '185672dd44712f60bb1736df5a377e82'
const VIP_TYPE = 65530
// SongQuality.qualityToParams(): only these four wire values exist.
const QUALITY_PARAMS = { '128': '128', '320': '320', flac: 'flac', high: 'high', super: 'flac', viper_tape: 'viper_tape', viper_clear: '128', viper_atmos: '128' }
const albumAudioId = value => {
    const text = String(value ?? '').trim()
    return /^\d+$/.test(text) ? text : '0'
}
const trackerUrl = data => {
    const value = Array.isArray(data?.url) ? data.url[0] : data?.url
    return typeof value === 'string' ? value : ''
}
const trackerResult = (data, requestedHash, accountAuthorized) => {
    const requested = String(requestedHash).toUpperCase()
    // A tracker may answer with another quality variant of the same recording
    // (lower bitrate or lossless file hash); every advertised variant must
    // still identify the requested song instead of a different one.
    const variants = [data?.hash, data?.std_hash, ...Object.entries(data?.extra || {}).filter(([key]) => /hash$/i.test(key)).map(([, value]) => value)]
        .filter(Boolean).map(value => String(value).toUpperCase())
    if (variants.length && !variants.includes(requested)) throw new Error('酷狗返回的歌曲与所选歌曲不匹配')
    return {...data, url:trackerUrl(data), bitRate:Number(data.bitRate || data.bitrate) > 10000 ? Number(data.bitRate || data.bitrate)/1000 : Number(data.bitRate || data.bitrate),
        requestedHash:requested, accountAuthorized, is_trial:!!data.free_part}
}

export class KugouPrivateClient {
    constructor({ request, now }) { Object.assign(this, { request, now }); this.mid = randomBytes(16).toString('hex') }
    async call(path, { token, userid, dfid = '-' }, { host = 'gateway.kugou.com', params = {}, data, router, anonymous = false, method, headers = {}, responseType, decode, allowErrors = [], protocol = 'https', uuid = '-' } = {}) {
        if (!anonymous && (!/^[a-zA-Z0-9_-]{8,2048}$/.test(String(token || '')) || !/^[1-9]\d{0,17}$/.test(String(userid || '')))) throw new Error('酷狗登录凭据不完整')
        const query = { dfid, mid:this.mid, ...(uuid ? {uuid} : {}), appid:APPID, clientver:11440, clienttime:Math.floor(this.now()/1000), ...(!anonymous ? {token, userid:String(userid)} : {}), ...params }
        const body = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data)
        query.signature = md5(SALT + Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('') + body + SALT)
        let response
        if (!/(^|\.)kugou\.com$/.test(host)) throw new Error('非官方酷狗请求地址')
        try { response = await this.request({ url:`${protocol}://${host}${path}`, method:method || (data === undefined ? 'GET' : 'POST'), params:query, ...(data === undefined ? {} : {data:body}), ...(responseType ? {responseType} : {}), timeout:15000, maxRedirects:0,
            headers:{'Content-Type':'application/json','User-Agent':'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',dfid,mid:this.mid,clienttime:query.clienttime,'kg-rc':'1','kg-thash':'5d816a0','kg-rec':1,'kg-rf':'B9EDA08A64250DEFFBCADDEE00F8F25F',...(router ? {'x-router':router} : {}),...headers} }) }
        catch { throw new Error('酷狗账号服务连接失败，请重试') }
        const result = decode ? decode(response?.data) : response?.data
        if (allowErrors.includes(Number(result?.error_code))) return result
        if (!result || Number(result.status) !== 1 || Number(result.error_code || result.errcode || 0)) {
            const code = Number(result?.error_code || result?.errcode || 0)
            const rawMessage = result?.error_msg || result?.errmsg || result?.message || result?.msg || result?.tip
            const platformMessage = Number(code) === 131001 ? '您已经领取 VIP' : Number(code) === 130011 ? '没有听歌记录' : rawMessage
            const message = typeof platformMessage === 'string' ? platformMessage.split(String(token || '\0')).join('[已隐藏]').slice(0, 240) : ''
            const error = new Error([20028,30020].includes(code) ? '酷狗要求安全验证，请在官方客户端完成验证后重试' : `酷狗账号服务未接受请求（${code || result?.status || '响应异常'}）${message ? '：' + message : ''}`)
            error.code = code; error.requiresVerification = [20028,30020].includes(code)
            throw error
        }
        return result
    }
    async search(auth, keyword, page, pagesize, type = 'song') {
        return this.call(`/${type === 'song' ? 'v3' : 'v1'}/search/${type}`, auth, { anonymous: !auth.token, router:'complexsearch.kugou.com', params:{ keyword,page,pagesize,albumhide:0,iscorrection:1,nocollect:0,platform:'AndroidFilter' } })
    }
    async vip(auth) {
        const result = await this.call('/v1/get_union_vip', auth, {host:'kugouvip.kugou.com',params:{busi_type:'concept',opt_product_types:'dvip,qvip,wvip,evip'}})
        if (!result.data || !Array.isArray(result.data.busi_vip)) throw new Error('酷狗会员响应不完整')
        if (result.data.userid && String(result.data.userid) !== String(auth.userid)) throw new Error('酷狗会员账号不匹配')
        return result
    }
    async playlists(auth, page, pagesize) {
        const result = await this.call('/v7/get_all_list',auth,{params:{plat:1},data:{userid:String(auth.userid),token:auth.token,total_ver:979,type:2,page,pagesize},router:'cloudlist.service.kugou.com'})
        if (!Array.isArray(result.data?.info)) throw new Error('酷狗个人歌单响应不完整')
        return result
    }
    async playlistTracks(auth, listid, page, pagesize) {
        return this.call('/v4/get_list_all_file',auth,{data:{listid,userid:String(auth.userid),area_code:1,show_relate_goods:0,pagesize,allplatform:1,show_cover:1,type:0,token:auth.token,page},router:'cloudlist.service.kugou.com'})
    }
    async addPlaylistTracks(auth, listid, songs) {
        return this.call('/cloudlist.service/v4/add_song',auth,{params:{last_time:Math.floor(this.now()/1000),last_area:'gztx'},
            data:{userid:String(auth.userid),token:auth.token,listid,list_ver:0,type:0,slow_upload:1,scene:'false;null',data:songs}})
    }
    async deletePlaylistTracks(auth, listid, fileids) {
        return this.call('/v4/delete_songs',auth,{data:{listid,userid:String(auth.userid),token:auth.token,list_ver:0,type:0,data:fileids.map(fileid=>({fileid}))},router:'cloudlist.service.kugou.com'})
    }
    // UrlRequestor.h(true): charged account tracker (gateway -> trackercdn).
    async playback(auth, params) {
        const fileHash = String(params.hash).toLowerCase()
        const quality = QUALITY_PARAMS[String(params.quality || '128')] || '128'
        const albumId = String(params.album_id ?? '').trim()
        // UrlRequestor.h(true) marks the charge tracker with IsFreePart=1 so
        // the server grants the complete recording instead of a listen part.
        const request = key => this.call('/v5/url',auth,{router:'trackercdn.kugou.com',params:{cmd:26,hash:fileHash,key,pidversion:PID_VERSION,pid:PID,version:11440,vipType:VIP_TYPE,ssa_flag:'is_fromtrack',
            ptype:0,behavior:'play',module:'',area_code:'1',album_audio_id:albumAudioId(params.album_audio_id),quality,IsFreePart:1,...(albumId ? {album_id:albumId} : {})}})
        const result = await request(md5(`${fileHash}${TRACKER_SECRET}${APPID}${this.mid}${auth.userid}`))
            .catch(error => {
                // The official key switches to the plain cloud branch when the
                // server-pushed YL/ZL config is absent; retry that branch once.
                if (Number(error.code) === 31833) return request(md5(`${fileHash}kgcloudv2`))
                throw error
            })
        return trackerResult(result.data || result, params.hash, true)
    }
    // BasicTrackerProtocol: guest tracker with no account grant.
    async guestPlayback(params) {
        const fileHash = String(params.hash).toLowerCase()
        const result = await this.call('/trackercdn/v5/url',{}, {anonymous:true,uuid:'',params:{cmd:25,quality:'128',hash:fileHash,key:md5(`${fileHash}${TRACKER_SECRET}`),
            pidversion:PID_VERSION,pid:PID,appid:APPID,mid:'-',behavior:'play',module:'',dfid:'-',clientver:'-',album_audio_id:albumAudioId(params.album_audio_id)}})
        return trackerResult(result.data || result, params.hash, false)
    }
    // g0 / PartListenTrackerProtocol: official listen-part (trial) tracker.
    async partPlayback(auth, params) {
        const fileHash = String(params.hash).toLowerCase()
        const result = await this.call('/v5/url',auth,{host:'trackercdn.kugou.com',protocol:'http',params:{pidversion:PID_VERSION,pid:PID,appid:APPID,mid:this.mid,version:11440,
            vipType:VIP_TYPE,behavior:'play',module:'',album_audio_id:albumAudioId(params.album_audio_id),quality:'128',IsFreePart:'2',hash:fileHash,key:md5(`${fileHash}${TRACKER_SECRET}`)}})
        return {...trackerResult(result.data || result, params.hash, true), free_part:1}
    }
}
