import { createCipheriv, createHash, constants, publicEncrypt, randomBytes } from 'node:crypto'

const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const md5 = value => createHash('md5').update(String(value)).digest('hex')
function id(value) {
    const result = String(value ?? '')
    if (!/^[1-9]\d{0,17}$/.test(result) || typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('网易云资源 ID 无效')
    return result
}
function ids(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',')
    if (!values.length || values.length > 1000) throw new Error('每次需要 1–1000 个资源 ID')
    return values.map(id)
}
function text(value, max = 1000) {
    const result = String(value || '').trim()
    if (!result || result.length > max) throw new Error('输入内容为空或过长')
    return result
}
function thread(p) {
    if (p.threadId) {
        if (!/^[A-Za-z0-9_]{1,100}$/.test(p.threadId)) throw new Error('评论资源标识无效')
        return p.threadId
    }
    const prefix = ['R_SO_4_', 'R_MV_5_', 'A_PL_0_', 'R_AL_3_', 'A_DJ_1_', 'R_VI_62_', 'A_EV_2_', 'A_DR_14_'][Number(p.type || 0)]
    if (!prefix) throw new Error('评论类型无效')
    return prefix + id(p.id)
}
export function encodeNeteaseWeb(data) {
    const key = randomBytes(16).toString('hex').slice(0, 16)
    function aes(value, secret) {
        const cipher = createCipheriv('aes-128-cbc', Buffer.from(secret), Buffer.from('0102030405060708'))
        return Buffer.concat([cipher.update(value), cipher.final()]).toString('base64')
    }
    const padded = Buffer.alloc(128)
    Buffer.from(key.split('').reverse().join('')).copy(padded, 112)
    return { params: aes(aes(JSON.stringify(data), '0CoJUm6Qyw8W8jud'), key), encSecKey: publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex') }
}
export { NETEASE_OPERATION_ROUTES } from '../src/api/netease-operation-routes.js'
export async function neteaseWebRequest(client, path, data, cookie = '') {
    if (!path.startsWith('/api/') || /[\r\n]/.test(cookie)) throw new Error('网易云请求无效')
    const csrf = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('__csrf='))?.slice(7) || ''
    const encrypted = encodeNeteaseWeb({ ...data, csrf_token: csrf })
    const response = await client.request({ url: 'https://music.163.com' + '/weapi/' + path.slice(5) + '?csrf_token=' + encodeURIComponent(csrf), method: 'POST',
        data: new URLSearchParams(encrypted).toString(), timeout: 15000, maxRedirects: 0, validateStatus: status => status >= 200 && status < 500,
        headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) } })
    const body = response.data
    if (!body || typeof body !== 'object' || !Number.isInteger(body.code)) throw new Error('网易云返回了无效响应')
    return { ...body, ...(response.headers?.['set-cookie']?.length ? { cookie: response.headers['set-cookie'].map(x => x.split(';')[0]).join('; ') } : {}) }
}
export async function neteaseOperation(client, route, p, cookie) {
    const call = (path, data) => neteaseWebRequest(client, path, data, cookie)
    const limit = Number(p.limit || 30), offset = Number(p.offset || 0)
    switch (route) {
    case '/login/status': return call('/api/w/nuser/account/get', {})
    case '/mv/all': return call('/api/mv/all', { tags: JSON.stringify({ 地区: p.area || '全部', 类型: p.type || '全部', 排序: p.order || '上升最快' }), limit, offset, total: true })
    case '/mv/url': return call('/api/song/enhance/play/mv/url', { id: id(p.id), r: Number(p.r || 1080) })
    case '/likelist': return call('/api/song/like/get', { uid: id(p.uid) })
    // Use the ordinary song-like contract and include the current account ID.
    case '/like': return call('/api/song/like', { trackId: id(p.id), like: p.like !== false && p.like !== 'false', ...(p.uid ? { userid: id(p.uid) } : {}) })
    case '/comment/new': {
        const sortType = Number(p.sortType || 3) === 1 ? 99 : Number(p.sortType || 3)
        const pageNo = Number(p.pageNo || 1), pageSize = Number(p.pageSize || 20)
        const cursor = sortType === 3 ? String(p.cursor || '0') : (sortType === 2 ? 'normalHot#' : '') + (pageNo - 1) * pageSize
        return call('/api/v2/resource/comments', { threadId: thread(p), sortType, pageNo, pageSize, cursor, showInner: true })
    }
    case '/comment/like': return call('/api/v1/comment/' + (Number(p.t) === 1 ? 'like' : 'unlike'), { threadId: thread(p), commentId: id(p.cid) })
    case '/comment': {
        const action = { 0: 'delete', 1: 'add', 2: 'reply' }[p.t]
        if (!action) throw new Error('评论操作无效')
        return call('/api/resource/comments/' + action, { threadId: thread(p), ...(action !== 'add' ? { commentId: id(p.commentId) } : {}), ...(action !== 'delete' ? { content: text(p.content) } : {}) })
    }
    case '/user/cloud': return call('/api/v1/cloud/get', { limit, offset })
    case '/user/cloud/detail': return call('/api/v1/cloud/get/byids', { songIds: JSON.stringify(ids(p.id)) })
    case '/user/cloud/del': return call('/api/cloud/del', { songIds: JSON.stringify(ids(p.id)) })
    case '/cloud/match': return call('/api/cloud/user/song/match', { userId: id(p.uid), songId: id(p.sid), adjustSongId: String(p.asid) === '0' ? '0' : id(p.asid) })
    case '/cloud/lyric/get': return call('/api/cloud/lyric/get', { userId: id(p.uid), songId: id(p.sid), lv: -1, kv: -1 })
    case '/playlist/create': return call('/api/playlist/create', { name: text(p.name, 100), privacy: Number(p.privacy || 0), type: p.type || 'NORMAL' })
    case '/playlist/delete': return call('/api/playlist/remove', { ids: JSON.stringify(ids(p.id)) })
    case '/playlist/subscribe': return call('/api/playlist/' + (Number(p.t || 1) === 1 ? 'subscribe' : 'unsubscribe'), { id: id(p.id) })
    case '/playlist/tracks': {
        if (!['add', 'del'].includes(p.op)) throw new Error('歌单操作无效')
        const result = await call('/api/playlist/manipulate/tracks', { op: p.op, pid: id(p.pid), trackIds: JSON.stringify(ids(p.tracks)), imme: true })
        if (result.code === 200) { client.playlists.clear(); client.playlistPending.clear() }
        return result
    }
    case '/playlist/update': {
        const playlistId = id(p.id)
        const result = await call('/api/batch', { '/api/playlist/desc/update': JSON.stringify({ id: playlistId, desc: String(p.desc || '') }), '/api/playlist/tags/update': JSON.stringify({ id: playlistId, tags: String(p.tags || '') }), '/api/playlist/update/name': JSON.stringify({ id: playlistId, name: text(p.name, 100) }) })
        client.playlists.delete(playlistId)
        return result
    }
    case '/playlist/cover/update': {
        const file = p.imgFile
        if (!file || !Array.isArray(file.bytes) || !file.bytes.length || file.bytes.length > 10 * 1024 * 1024) throw new Error('封面文件无效或超过 10 MB')
        const allocation = await call('/api/nos/token/alloc', { bucket: 'yyimgs', ext: 'jpg', filename: String(file.name || 'cover.jpg'), local: false, nos_product: 0, return_body: '{"code":200,"size":"$(ObjectSize)"}', type: 'other' })
        if (allocation.code !== 200) return allocation
        const info = allocation.result
        if (!info?.objectKey || !info.token || !info.docId || !/^[a-zA-Z0-9_./-]+$/.test(info.objectKey) || info.objectKey.includes('..')) throw new Error('封面上传授权无效')
        const uploaded = await client.request({ url: 'https://nosup-hz1.127.net/yyimgs/' + info.objectKey + '?offset=0&complete=true&version=1.0', method: 'POST', data: Buffer.from(file.bytes), timeout: 30000, maxRedirects: 0, headers: { 'x-nos-token': info.token, 'Content-Type': file.type || 'image/jpeg' } })
        if (uploaded.data?.code !== 200) throw new Error('封面上传失败')
        return call('/api/playlist/cover/update', { id: id(p.id), coverImgId: info.docId })
    }
    case '/login/cellphone': return call('/api/w/login/cellphone', { type: '1', https: true, phone: text(p.phone, 30), countrycode: String(p.countrycode || '86'), remember: true, ...(p.captcha ? { captcha: text(p.captcha, 12) } : { password: p.md5_password || md5(text(p.password)) }) })
    case '/login': return call('/api/w/login', { type: '0', https: true, username: text(p.email, 200), password: p.md5_password || md5(text(p.password)), rememberLogin: true })
    case '/captcha/sent': return call('/api/sms/captcha/sent', { ctcode: String(p.ctcode || '86'), cellphone: text(p.phone, 30), secrete: 'music_middleuser_pclogin' })
    case '/captcha/verify': return call('/api/sms/captcha/verify', { ctcode: String(p.ctcode || '86'), cellphone: text(p.phone, 30), captcha: text(p.captcha, 12) })
    default: throw new Error('未知网易云操作')
    }
}
