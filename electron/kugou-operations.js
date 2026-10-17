import { createHash, createCipheriv, publicEncrypt, constants } from 'node:crypto'
import { inflateSync } from 'node:zlib'

// Official concept-client wire contracts; no local API server is involved.
export const KUGOU_OPERATION_ROUTES = [
    '/playlist/add', '/playlist/del', '/playlist/tags', '/user/detail',
    '/comment/music', '/comment/playlist', '/comment/album', '/video/url',
    '/video/detail', '/kmr/audio/mv', '/search/lyric', '/lyric',
    '/youth/vip', '/youth/day/vip', '/youth/day/vip/upgrade',
    '/youth/month/vip/record', '/youth/union/vip', '/song/url/new'
]
const md5 = value => createHash('md5').update(String(value)).digest('hex')
export const kugouParamsKey = value => md5('3116LnT6xpN3khm36zse0QzvmgTZ3waWdRSA11440' + value)
const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB\n-----END PUBLIC KEY-----'
export function kugouRsa(value) {
    const bytes = Buffer.from(JSON.stringify(value)), padded = Buffer.alloc(128)
    if (bytes.length > padded.length) throw new Error('酷狗登录参数过长')
    bytes.copy(padded)
    return publicEncrypt({key:PUBLIC_KEY,padding:constants.RSA_NO_PADDING},padded).toString('hex').toUpperCase()
}
export function kugouAes(value, key, iv = md5(key).slice(-16)) {
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(md5(key)), Buffer.from(iv))
    return Buffer.concat([cipher.update(typeof value === 'string' ? value : JSON.stringify(value)),cipher.final()]).toString('hex')
}
function identifier(value) {
    const s = String(value ?? '')
    if (!/^[1-9]\d{0,17}$/.test(s) || typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('酷狗资源 ID 无效')
    return s
}
function identifiers(value) { return String(value || '').split(',').map(identifier) }
export async function kugouOperation(client, route, p, page, size) {
    const call = (path, options = {}) => client.privateClient.call(path,p,{anonymous:!p.token,...options})
    const time = Math.floor(client.now()/1000)
    switch (route) {
    case '/playlist/add': {
        const name = String(p.name || '').trim()
        if (!name || name.length > 100) throw new Error('歌单名称需要 1–100 个字')
        return call('/cloudlist.service/v4/add_list',{anonymous:false,params:Number(p.type || 0) === 0 ? {last_time:time,last_area:'gztx',userid:p.userid,token:p.token} : {},data:{userid:String(p.userid),token:p.token,total_ver:0,name,type:Number(p.type || 0),source:Number(p.source ?? 1),is_pri:Number(p.type || 0) === 0 ? Number(p.is_pri || 0) : 0,list_create_userid:p.list_create_userid,list_create_listid:p.list_create_listid,list_create_gid:p.list_create_gid || '',from_shupinmv:0}})
    }
    case '/playlist/del': return call('/cloudlist.service/v3/delete_list',{anonymous:false,data:{userid:String(p.userid),token:p.token,listid:identifier(p.listid),total_ver:0,type:1},params:{last_time:time,last_area:'gztx'}})
    case '/playlist/tags': return call('/pubsongs/v1/get_tags_by_type',{data:{tag_type:'collection',tag_id:0,source:3}})
    case '/user/detail': return call('/v3/get_my_info',{anonymous:false,router:'usercenter.kugou.com',params:{plat:1},data:{visit_time:time,usertype:1,p:kugouRsa({token:p.token,clienttime:time}),userid:identifier(p.userid)}})
    case '/comment/music':
    case '/comment/playlist':
    case '/comment/album': {
        const music = route.endsWith('music'), playlist = route.endsWith('playlist')
        return call(music ? '/mcomment/v1/cmtlist' : '/m.comment.service/v1/cmtlist',{method:'POST',params:{...(music ? {mixsongid:identifier(p.mixsongid),extdata:'0'} : {childrenid:identifier(p.id)}),need_show_image:1,p:page(),pagesize:size(),show_classify:Number(p.show_classify ?? 1),show_hotword_list:Number(p.show_hotword_list ?? 1),code:music ? 'fc4be23b4e972707f36b8a828a93ba8a' : playlist ? 'ca53b96fe5a1d9c22d71c8f522ef7c4f' : '94f1792ced1df89aa68a7939eaf2efca',...(playlist ? {content_type:0,tag:5} : {})}})
    }
    case '/video/url': {
        if (!/^[a-f0-9]{32}$/i.test(p.hash || '')) throw new Error('酷狗视频 hash 无效')
        return call('/v2/interface/index',{router:'trackermv.kugou.com',params:{backupdomain:1,cmd:123,ext:'mp4',ismp3:0,hash:p.hash,pid:1,type:1,key:kugouParamsKey(p.hash)}})
    }
    case '/video/detail': return call('/v1/video',{router:'kmr.service.kugou.com',data:{appid:3116,clientver:11440,clienttime:time,mid:client.privateClient.mid,uuid:md5((p.dfid || '-')+client.privateClient.mid),dfid:p.dfid || '-',token:p.token || '',key:kugouParamsKey(time),show_resolution:1,data:identifiers(p.id).map(video_id=>({video_id}))}})
    case '/kmr/audio/mv': return call('/kmr/v1/audio/mv',{router:'openapi.kugou.com',headers:{'KG-TID':'38'},data:{data:identifiers(p.album_audio_id).map(album_audio_id=>({album_audio_id})),fields:p.fields || ''}})
    case '/search/lyric': return client.data('https://lyrics.kugou.com/v1/search',{album_audio_id:p.album_audio_id || 0,appid:3116,clientver:11440,duration:p.duration || 0,hash:p.hash || '',keyword:String(p.keywords || ''),lrctxt:1,man:p.man ?? 'no'})
    case '/lyric': {
        const fmt = p.fmt || 'lrc'
        if (!['lrc','krc'].includes(fmt)) throw new Error('歌词格式无效')
        const result = await client.data('https://lyrics.kugou.com/download',{ver:1,client:'android',id:identifier(p.id),accesskey:String(p.accesskey || ''),fmt,charset:'utf8'})
        if (p.decode && result.content) {
            let bytes = Buffer.from(result.content,'base64')
            if (fmt === 'krc' && Number(result.contenttype) === 0) {
                const key = Buffer.from([64,71,97,119,94,50,116,71,81,54,49,45,206,210,110,105])
                bytes = bytes.subarray(4).map((b,i)=>b^key[i%16]); bytes = inflateSync(bytes)
            }
            result.decodeContent = bytes.toString('utf8')
        }
        return result
    }
    case '/youth/union/vip': return client.privateClient.vip(p)
    case '/youth/month/vip/record': return call('/youth/v1/activity/get_month_vip_record',{anonymous:false,params:{latest_limit:100}})
    case '/youth/day/vip': return call('/youth/v1/recharge/receive_vip_listen_song',{anonymous:false,method:'POST',params:{source_id:90139,receive_day:identifier(p.receive_day)},headers:{'Content-Type':'application/x-www-form-urlencoded'}})
    case '/youth/day/vip/upgrade': return call('/youth/v1/listen_song/upgrade_vip_reward',{anonymous:false,method:'POST',params:{kugouid:identifier(p.userid),ad_type:1}})
    case '/youth/vip':
        if (!p.ad_id || !Number.isFinite(p.play_start) || !Number.isFinite(p.play_end)) throw new Error('请先在酷狗官方客户端完成广告任务，再刷新会员状态')
        return call('/youth/v2/ad/play_report',{anonymous:false,data:{ad_id:identifier(p.ad_id),play_start:p.play_start,play_end:p.play_end}})
    case '/song/url/new': return client.call('/song/url',p)
    default: throw new Error('未知酷狗操作')
    }
}
