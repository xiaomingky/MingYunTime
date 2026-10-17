import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { QishuiClient, qishuiPayload, qishuiTrack, qishuiPlayback, qishuiLyrics, qishuiCookie, qishuiImage } from '../electron/qishui-client.js'
import { qqAccountId, qqGtk, qqPage } from '../electron/qq-account.js'
import * as qq from '../src/api/qq.js'

let checks = 0
const check = (value, message) => { assert.ok(value, message); checks++ }
const track = { id: '7079108541549643812', name: '测试歌曲', duration: 297240, artists: [{ name: '测试歌手' }],
    album: { id: '7096700219496368135', name: '测试专辑', url_cover: { urls: ['https://example.test/cover.jpg'], uri: 'already-in-url' } },
    preview: { start: 143808, duration: 30047 } }
const media = { seo_track: { track }, lyric: { content: '[143000,2000]<0,1000,0>一<1000,1000,0>二\n[145000,1000]<0,1000,0>三' },
    track_player: { expire_at: 2000000000, video_model: JSON.stringify({ video_duration: 30.047, video_list: [{ main_url: 'https://example.test/preview.m4a', video_meta: { codec_type: 'aac' } }] }) } }
check(qishuiTrack(track).id === track.id, '19-digit IDs remain exact strings')
check(qishuiTrack({ ...track, id: Number(track.id) }) === null, 'rounded numeric IDs are rejected')
check(qishuiTrack(track).picUrl === 'https://example.test/cover.jpg', 'complete artwork URLs are not appended twice')
check(qishuiImage({urls:['https://p3-luna.douyinpic.com/img/'],uri:'ies-music/cover',template_prefix:'tplv-b829550vbb'}) === 'https://p3-luna.douyinpic.com/img/ies-music/cover~tplv-b829550vbb-image.image', 'App CDN prefix, URI and image template become loadable artwork')
check(qishuiImage({urls:['https://example.test/cover.jpg?sign=1'],uri:'extra',template_prefix:'tplv-test'}) === 'https://example.test/cover.jpg?sign=1', 'complete signed artwork remains unchanged')
check(qishuiImage({urls:['https://p3-luna.douyinpic.com/img/'],uri:'../unsafe'}) === '', 'malformed artwork URI rejected')
const playback = qishuiPlayback(media)
check(playback.preview && playback.duration === 30.047 && playback.fullDuration === 297.24, 'preview/full duration differ')
check(playback.offsetMs === 143808 && playback.preview && playback.downloadAllowed, 'returned audio can be saved while preview offset remains explicit')
check(playback.lrc.startsWith('[00:00.000]') && playback.yrc.includes('(192,1000,0)二'), 'word timestamps shifted to preview clock')
check(!qishuiLyrics('[0,1000]<0,1000,0>旧\n[2000,1000]<0,1000,0>新', 1500, 1000).lrc.includes('旧'), 'lyrics outside preview omitted')
assert.throws(() => qishuiPayload(''), /暂未返回/); checks++
assert.throws(() => qishuiPayload({ status_code: 1000016, status_info: { status_msg: 'expired' } }), /expired/); checks++
assert.throws(() => qishuiPlayback({ ...media, track_player: { video_model: '{}' } }), /未提供可播放/); checks++

let saved = '', mode = 'new', now = 0, pending, calls = []
const client = new QishuiClient({ now: () => now, save: value => { saved = value }, request: async config => {
    calls.push(config)
    if (config.url.includes('get_qrcode')) return { data: { message: 'success', data: { token: 'test-token', qrcode: 'data:image/png;base64,TEST', expire_time: 180 } }, headers: { 'set-cookie': ['flow=test-flow; Path=/'] } }
    if (config.url.includes('check_qrconnect')) {
        if (mode === 'pending') return await new Promise(resolve => { pending = resolve })
        return { data: { message: 'success', data: { status: mode, error_code: 0 } }, headers: mode === 'confirmed' ? { 'set-cookie': ['sessionid=test-session; HttpOnly'] } : {} }
    }
    if (config.url.endsWith('/me')) return { data: { my_info: { id: '90071992547409931', nickname: 'Test user' } }, headers: {} }
    if (config.url.includes('search/track')) return { data: '', headers: {} }
    throw new Error('Unexpected request')
} })
const qr = await client.qrCreate()
check(!JSON.stringify(qr).includes('test-token') && !JSON.stringify(qr).includes('test-flow'), 'QR tokens/cookies never exposed to renderer')
check((await client.qrCheck(qr.loginId)).status === 'new', 'unscanned QR never grants login')
check(calls.at(-1).headers.Cookie === 'flow=test-flow', 'QR poll retains same flow cookies')
mode = 'confirmed'
const confirmed = await client.qrCheck(qr.loginId)
check(confirmed.profile.userId === '90071992547409931' && saved.includes('sessionid=test-session'), 'confirmed session validated before persistence')
check((await client.status()).isLoggedIn, 'persistent session profile checked')
client.logout(); check(saved === '' && !client.cookie, 'logout clears stored credentials')
mode = 'pending'
const cancelQr = await client.qrCreate(), inFlight = client.qrCheck(cancelQr.loginId)
await Promise.resolve(); client.qrCancel(cancelQr.loginId)
pending({ data: { message: 'success', data: { status: 'confirmed', error_code: 0 } }, headers: { 'set-cookie': ['sessionid=stale'] } })
check((await inFlight).status === 'cancelled' && saved === '', 'late QR result after cancel cannot log in')
mode = 'new'; const expiredQr = await client.qrCreate(); now = 181000
check((await client.qrCheck(expiredQr.loginId)).status === 'expired', 'QR expiry releases session')
await assert.rejects(client.search('song'), /暂未返回/); checks++
await assert.rejects(client.importCookie('sessionid='), /完整汽水/); checks++
check(qishuiCookie('Cookie: sessionid=test; sid_guard=guard') === 'sessionid=test; sid_guard=guard', 'copied Cookie request header accepted')
check(qishuiCookie('[{"name":"sessionid","value":"test"},{"name":"sid_guard","value":"guard"}]') === 'sessionid=test; sid_guard=guard', 'browser Cookie export array accepted')
check(qishuiCookie('{"cookies":[{"name":"sessionid","value":"test"}]}') === 'sessionid=test', 'Cookie export wrapper accepted')
for (const value of ['[]', '[', '[{"name":"sessionid","value":"bad;injected=value"}]', 'sessionid=test\r\nInjected: header']) {
    assert.throws(()=>qishuiCookie(value)); checks++
}
let cookieSaved = '', rejectCookie = false, cookieProfilePending
const cookieClient = new QishuiClient({ load:()=> 'sessionid=old', save:value=>{cookieSaved=value}, request:async config=> {
    if (config.headers.Cookie==='sessionid=pending') return new Promise(resolve=>{cookieProfilePending=resolve})
    return {data:rejectCookie ? {status_code:1000016,status_info:{status_msg:'登录已过期'}} : {my_info:{id:'123',nickname:'Cookie user'}}}
} })
const importedCookie = await cookieClient.importCookie('Cookie: sessionid=new')
check(importedCookie.profile.nickname==='Cookie user' && cookieSaved==='sessionid=new', 'valid imported Cookie verified and persisted')
rejectCookie=true
await assert.rejects(cookieClient.importCookie('sessionid=expired'),/过期/); checks++
check(cookieClient.cookie==='sessionid=new' && cookieSaved==='sessionid=new', 'failed Cookie import preserves working session')
const pendingCookie = cookieClient.importCookie('sessionid=pending')
await Promise.resolve(); cookieClient.logout(); cookieProfilePending({data:{my_info:{id:'late'}}})
await assert.rejects(pendingCookie,/取消/); checks++
check(cookieSaved==='' && !cookieClient.cookie, 'late Cookie validation after logout does not restore session')

check(qqAccountId('wxuin=90071992547409931; qm_keyst=token') === '90071992547409931', 'QQ WeChat ID remains exact')
check(qqAccountId('uin=o00012345;') === '12345', 'QQ uin prefix normalized')
check(qqAccountId('euin=unverified') === '', 'encrypted identity is not guessed')
check(qqGtk('skey=a') === 177670 && qqGtk('qrsig=a') === 5381, 'g_tk uses session key, not QR signature')
const items = Array.from({ length: 251 }, (_, i) => i)
check(qqPage(items, 200, 100).items.length === 51 && !qqPage(items, 200, 100).hasMore, 'large QQ lists paginated without losing tail')
const rawQQ = { id: 123, mid: 'qq-song', name: 'QQ test', interval: 204, singer: [{ name: 'Singer', mid: 'singer' }], album: { mid: 'album', name: 'Album' }, pay: { payplay: 1 } }
const qqTrack = qq.toQQTrack(rawQQ)
check(qqTrack.songid === 123 && qqTrack.albummid === 'album' && qqTrack.isVip, 'QQ account metadata survives queue conversion')
check(qq.toQQTrack(qqTrack).dt === 204000 && qq.toQQTrack(qqTrack).duration === 204, 'QQ repeated conversion is idempotent')
for(const pay of [{payplay:'1'},{pay_play:1}])check(qq.normalizeQQSong({...rawQQ,pay}).isVip,'QQ official pay variants display VIP')
for(const pay of [{paytrackprice:200},{trackprice:'100'},{payplay:0,paytrackprice:200}])check(!qq.normalizeQQSong({...rawQQ,pay}).isVip,'QQ download/purchase price does not imply VIP playback')
check(!qq.normalizeQQSong({...rawQQ,pay:{},action:40000,grant:0}).isVip,'QQ action and grant alone cannot mark free songs VIP')
check(qq.normalizeQQSong(qqTrack).isVip,'QQ queue normalization preserves proven VIP status')
const numericQQ = qq.toQQTrack({ id: 123, name: 'Numeric song', interval: 204, singer: [{ name: 'Singer' }] })
check(qq.toQQTrack(numericQQ).dt === 204000 && qq.toQQTrack(numericQQ).artist === 'Singer', 'QQ numeric-only IDs survive repeated conversion')
const brokenSave = new QishuiClient({ request: client.request, save: () => { throw new Error('disk unavailable') } })
await assert.rejects(brokenSave.importCookie('sessionid=test'), /disk unavailable/)
check(!brokenSave.cookie, 'failed credential persistence does not leave a half-logged-in session')

const storage = new Map(), require = createRequire(import.meta.url)
const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
let responseMode = 'ok', capturedCookie = '', likeCode = -1, pendingProfile, pendingSongDetail, likeWrites = 0
const window = { bridge: { invoke: async (channel, params) => {
    if (channel === 'qq:validate-session') {
        capturedCookie = params.cookie
        if (responseMode === 'pending') return await new Promise(resolve => { pendingProfile = resolve })
        return responseMode === 'bad' ? { code: -1, message: 'expired' } : { code: 0, data: { userId: '12345', uin: '12345', nickname: 'Test user' } }
    }
    if (channel === 'qq:user-playlists') return { code: 0, data: { playlists: params.kind==='collected'?[{dissid:'collected',diss_name:'收藏歌单',kind:'collected',song_count:69}]:[{ dissid: 'liked', diss_name: '喜欢', type: 1 },{dissid:'created',diss_name:'自建歌单',kind:'created'}], hasMore: false } }
    if (channel === 'qq:user-liked-songs') return { code: 0, data: { songs: [rawQQ], info: { id: 'liked' }, hasMore: false } }
    if (channel === 'qq:oper-mylike') { likeWrites++; return { code: likeCode, message: 'rejected' } }
    if (channel === 'qq:song-detail') return await new Promise(resolve => { pendingSongDetail = resolve })
    if (channel === 'qq:logout') return { code: 0 }
    throw new Error(channel)
} } }
const bundled = await build({ entryPoints: ['src/store/qq-user.js'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['pinia'] })
const module = { exports: {} }
new Function('require', 'module', 'localStorage', 'window', bundled.outputFiles[0].text)(require, module, localStorage, window)
const account = module.exports.useQQUserStore(require('pinia').createPinia())
storage.set('qq_cookie', 'old=credential')
responseMode = 'bad'
check(!(await account.cookieLogin('qm_keyst=new; uin=12345')).success && !account.isLoggedIn && storage.get('qq_cookie') === 'old=credential', 'rejected QQ login never overwrites previous session')
responseMode = 'ok'
check((await account.cookieLogin('qm_keyst=new; uin=12345')).success && capturedCookie.includes('qm_keyst=new'), 'new login cookie takes precedence over stored old credential')
check(account.likedLoaded && account.isSongLiked(qqTrack), 'online liked list synchronized on login')
check(account.createdPlaylists.length===1&&account.createdPlaylists[0].id==='created'&&account.collectedPlaylists[0].songCount===69,'QQ created and collected groups are independent and likes remain separate')
check(!(await account.toggleLikeSong(qqTrack)).success && account.isSongLiked(qqTrack), 'rejected QQ write never changes heart state')
likeCode = 0
check((await account.toggleLikeSong(qqTrack)).success && !account.isSongLiked(qqTrack), 'successful QQ removal updates account state')
responseMode = 'pending'; const late = account.cookieLogin('qm_keyst=late; uin=12345')
await Promise.resolve(); account.logout(); pendingProfile({ code: 0, data: { userId: '12345' } })
check(!(await late).success && !account.isLoggedIn && !storage.has('qq_profile') && !account.likedPlaylistId, 'late login/profile response cannot resurrect logged-out account')
responseMode = 'ok'
await account.cookieLogin('qm_keyst=valid;uin=12345')
const beforeWrites = likeWrites
const pendingLike = account.toggleLikeSong({ id: 'needs-detail', songmid: 'needs-detail', platform: 'qq' })
await Promise.resolve()
account.logout()
pendingSongDetail({ code: 0, data: { track_info: { id: 999 } } })
check(!(await pendingLike).success && likeWrites === beforeWrites, 'logout during song metadata lookup cannot send a write using another session')

// Exercise the main-process request builders with deterministic upstream responses.
const mainSource = readFileSync('electron/qq-music.js', 'utf8')
const mainBundle = await build({ stdin: { contents: mainSource + '\nexport { operSonglist, operMyLikeSonglist, fetchQQCommentsDirect, validateQQLogin };', resolveDir: process.cwd() + '/electron', sourcefile: 'qq-main-check.js' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'axios'] })
let writeResult = { code:0, req:{ code:0, data:{code:0} } }, commentResult = {code:0,comment:{commenttotal:1,commentlist:[{commentid:'c1',rootcommentcontent:'测试评论',time:1700000000}]}}
let loginResult = {code:0,req:{code:1000}}
const requests = []
const mockedAxios = Object.assign(async config => config.method === 'POST' ? mockedAxios.post(config.url, config.data, config) : mockedAxios.get(config.url, config), { post: async (url, body, config) => {
    requests.push({ url, body, config })
    if (body.req_0) return { data:{req_0:{data:{track_info:rawQQ}}} }
    if (body.req?.method==='GetLoginUserInfo') return {data:loginResult}
    if (body.req?.method==='CgiGetSelfDiss') return {data:{code:0,req:{code:0,data:{code:0,code_selfDirs:0,selfdirnum:1,selfDirs:[{disstid:'99',dirid:7,title:'测试'}]}}}}
    if (body.req?.method==='get_song_detail') return {data:{code:0,req:{code:0,data:{track_info:{mid:body.req.param.song_mid || 'qq-song',id:123,type:0}}}}}
    return {data:writeResult}
}, get: async (url, config) => {
    requests.push({url,config})
    return {data:url.includes('profile_homepage') ? {code:0,data:{creator:{nick:'Test user'}}} : commentResult}
} })
const nativeModule = {exports:{}}
new Function('require','module','exports','__dirname',mainBundle.outputFiles[0].text)(name => name==='axios' ? mockedAxios : name==='electron' ? {ipcMain:{},session:{},BrowserWindow:function(){}} : require(name), nativeModule, nativeModule.exports, process.cwd() + '/electron')
const native = nativeModule.exports
await assert.rejects(native.validateQQLogin('uin=12345;qm_keyst=invalid'),/未确认有效登录/); checks++
loginResult={code:0,req:{code:0,data:{userInfo:{uin:'12345'}}}}
check((await native.validateQQLogin('uin=12345;qm_keyst=test')).userId==='12345', 'QQ login requires authenticated response before public profile')
await assert.rejects(native.validateQQLogin('uin=999;qm_keyst=test'),/不一致/); checks++
check((await native.validateQQLogin('euin=opaque;qm_keyst=test')).userId==='12345', 'opaque QQ identity can be recovered only from authenticated account response')
check((await native.operSonglist('addsong',{dissid:'99',songmids:['qqSong']},'uin=12345;qm_keyst=test')).code===0, 'QQ playlist addition uses PlaylistDetailWrite')
check(requests.at(-1).body.req.param.v_songInfo[0].songId===123 && requests.at(-1).body.req.param.dirId===7, 'QQ playlist write carries resolved directory and song IDs')
writeResult={code:0,req:{code:0,data:{code:401}}}
await assert.rejects(native.operMyLikeSonglist(1,'qqSong','uin=12345;qm_keyst=test','99',123), /401/); checks++
const comments=await native.fetchQQCommentsDirect('99',8,2,25,'','',3)
check(comments.data.comments[0].time===1700000000000 && requests.at(-1).config.params.biztype===3 && requests.at(-1).config.params.pagenum===2, 'QQ comments preserve resource type, page and timestamp units')
commentResult={code:401,msg:'expired'}
await assert.rejects(native.fetchQQCommentsDirect('99'),/expired/); checks++

if (process.argv.includes('--live')) {
    const { default: axios } = await import('axios')
    const live = new QishuiClient({ request: config => axios(config) })
    const discovered = await live.discover()
    check(discovered.playlists.length > 0, 'live recommendation catalog contains playlists')
    const playlist = await live.playlist('7096700219496368135')
    check(playlist.songs.length > 0 && playlist.playlist?.id === '7096700219496368135', 'live playlist maps metadata and tracks')
    const preview = await live.playback('7079108541549643812')
    check(preview.preview && preview.duration < 60 && preview.lrc && preview.yrc, 'live preview has explicit permissions and shifted lyrics')
    const liveQr = await live.qrCreate()
    check(liveQr.image.startsWith('data:image/png;base64,'), 'live official mobile scan URL is encoded as an image')
    check((await live.qrCheck(liveQr.loginId)).status === 'new', 'live official unscanned poll does not claim login')
    live.qrCancel(liveQr.loginId)
    console.log('Live catalog/playlist/preview lyrics and unscanned QR passed; signed browser QR is tested separately; no user login or account writes performed.')
}
console.log(`Music platform checks passed: ${checks} assertions; QR lifecycle, preview permissions, lyrics, QQ account isolation, pagination, metadata and rejected operations.`)
