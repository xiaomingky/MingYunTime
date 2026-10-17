import assert from 'node:assert/strict'
import { QQClient } from '../electron/qq-client.js'
import { QQSession } from '../electron/qq-session.js'
let checks = 0, requests = [], responder
const check = (value, message) => { assert.ok(value, message); checks++ }
const reject = async (promise, expression) => { await assert.rejects(promise, expression); checks++ }
const client = new QQClient({ request: async config => { requests.push(config); return { data: await responder(config) } } })
const rpc = data => ({ code: 0, req: { code: 0, data } })
responder=config=>rpc({code:0,selfdirnum:2,favdirnum:1,selfDirs:[{disstid:'8938474284',dirid:201,title:'喜欢',songnum:40,optype:1},{disstid:'8938474285',title:'自建',songnum:3,optype:1}],orderDirs:[{disstid:'9650200317',title:'收藏',songnum:69,optype:1}]})
const nativeCreated=await client.userPlaylists('1152921504606846977','qm_keyst=fixture','created')
check(nativeCreated.length===2&&nativeCreated[0].type===1&&nativeCreated[1].kind==='created','native self directories preserve likes and created playlists')
check(requests.at(-1).data.req.module==='music.mobileAsset.GetFav'&&requests.at(-1).data.req.method==='CgiGetSelfDiss'&&requests.at(-1).data.req.param.uin==='1152921504606846977','native created contract and long identity are exact')
check((await client.userPlaylists('1152921504606846977','qm_keyst=fixture','collected'))[0].song_count===69&&requests.at(-1).data.req.method==='CgiGetOrderDiss','native collected uses its own APK method')
responder=()=>rpc({code:0,selfdirnum:2,selfDirs:[]})
await reject(client.userPlaylists('123','x','created'),/完整同步/)
responder=()=>rpc({code:0,code_orderDirs:1000,orderDirs:[]})
await reject(client.userPlaylists('123','x','collected'),/拒绝/)
await reject(client.userPlaylists('123','x','invalid'),/分类/)
responder = () => ({ code: 0, subcode: 0, data: { song: { list: [{ songmid: 'song' }], totalnum: 99 }, album: { list: [{ albumMID: 'album' }], totalnum: 7 } } })
let result = await client.call('/getSearchByKey', { key: '陈粒', page: 2, limit: 30 }, 'wxuin=1152921504606846977;qm_keyst=secret')
check(result.data.total === 99 && result.data.list[0].songmid === 'song', 'search normalizes totalnum without dropping raw fields')
check(requests.at(-1).url.startsWith('https://c.y.qq.com/') && requests.at(-1).params.p === 2 && requests.at(-1).params.n === 30, 'direct search retains page and count')
check(requests.at(-1).params.loginUin === '1152921504606846977', 'long account identities remain strings')
await client.call('/getSearchByKey', { key: '陈粒', catZhida: 2 }); check(requests.at(-1).params.t === 8, 'album uses verified public search type')
responder = () => ({ code: 0, subcode: 0, data: { song: { list: [], totalnum: 0 } } })
check((await client.call('/getSearchByKey', { key: 'empty' })).data.list.length === 0, 'legitimate empty search succeeds')
responder = () => ({ code: 0, subcode: 10003, data: { song: { list: [{ songmid: 'unrelated' }] } } })
await reject(client.call('/getSearchByKey', { key: 'rejected' }), /被拒绝/)
responder = () => ({ code: 0, data: {} })
await reject(client.call('/getSearchByKey', { key: 'malformed' }), /响应不完整/)
let before = requests.length
await reject(client.call('/getSearchByKey', { key: '' }), /搜索关键词/)
await reject(client.call('/getSearchByKey', { key: 'x', page: -1 }), /分页/)
await reject(client.call('/getAlbumInfo', { albummid: '../invalid' }), /有效/)
await reject(client.call('/getSongListDetail', { disstid: '9007199254740993' }), /分页/)
check(requests.length === before, 'invalid arguments never issue network requests')
responder = config => {
    const request = config.data.req
    if (request.method === 'GetAlbumDetail') return rpc({ basicInfo: { albumID: 123, albumName: 'Album', publishDate: '2026-10-15', desc: 'Description' }, singer: [{ name: 'Singer' }], company: { name: 'Label' } })
    return rpc({ songList: [{ songInfo: { mid: 'song', pay: { pay_play: 1 } } }], totalNum: 151 })
}
result = await client.call('/getAlbumInfo', { albummid: 'album' })
check(result.data.id === 123 && result.data.name === 'Album' && result.data.singers[0].name === 'Singer', 'album contains numeric comment resource ID and artists')
check(result.data.list[0].mid === 'song' && result.data.total === 151 && result.data.hasMore && result.data.offset === 1, 'album unwraps songInfo and exposes pagination')
await client.call('/getAlbumTracks', { albummid: 'album', offset: 100, limit: 51 })
check(requests.at(-1).data.req.param.begin === 100 && requests.at(-1).data.req.param.num === 51, 'album continuation uses actual loaded count')
responder = () => rpc({ code: 0, subcode: 0, dirinfo: { title: 'Playlist', picurl: 'http://qpic.y.qq.com/cover', songnum: 66 }, total_song_num: 66, songlist: [{ mid: 'track' }] })
result = await client.call('/getSongListDetail', { disstid: '7707261125', offset: 30, limit: 30 })
check(requests.at(-1).data.req.module === 'music.srfDissInfo.DissInfo' && requests.at(-1).data.req.param.disstid === 7707261125, 'playlist uses APK RPC with safe integer contract')
check(result.cdlist[0].logo.startsWith('https:') && result.hasMore && result.offset === 31 && result.total === 66, 'playlist converts metadata and exact continuation position')
responder = () => rpc({ code: 10004, songlist: [] })
await reject(client.call('/getSongListDetail', { disstid: '1' }), /失败/)
responder = config => config.data.req.method === 'GetAll' ? rpc({ group: [{ groupName: 'Group', toplist: [{ topId: 26, period: '2026-10-14', title: 'Chart' }] }] })
    : rpc({ data: { topId: 26, title: 'Chart', totalNum: 151 }, songInfoList: [{ mid: 'tail' }] })
before = requests.length
result = await client.call('/getRanks', { topId: '26', page: 100, limit: 51 })
check(requests.at(-1).data.req.param.period === '2026-10-14' && requests.at(-1).data.req.param.offset === 100, 'rank uses official current period, not assumed today or multiplied page')
check(result.req_1.data.topInfo.totalNum === 151 && result.req_1.data.songInfoList[0].mid === 'tail', 'rank tail and metadata survive legacy IPC shape')
await client.call('/getTopLists')
check(requests.length === before + 2, 'public rank metadata is cached separately from account responses')
responder = config => {
    const p = config.data.req.param
    return rpc({ total: 240, singerlist: Array.from({ length: 80 }, (_, i) => ({ singer_mid: String(p.sin + i) })) })
}
result = await client.call('/getSingerList', { page: 3, limit: 30 })
check(result.data.singerlist.length === 30 && result.data.singerlist[0].singer_mid === '60' && result.data.singerlist.at(-1).singer_mid === '89', 'singer paging crosses fixed 80-item upstream boundary without duplication')
result = await client.call('/getSingerList', { page: 4, limit: 30 })
check(result.data.singerlist[0].singer_mid === '90' && result.data.singerlist.at(-1).singer_mid === '119', 'next singer page starts after prior range')
responder = () => rpc({ singer_list: [{ basic_info: { singer_id: 12, name: 'Singer' }, ex_info: { desc: 'Profile' } }] })
result = await client.call('/getSingerDesc', { singermid: 'singer' })
check(result.singer.name === 'Singer' && result.singer.desc === 'Profile', 'structured singer profile replaces referer-sensitive XML')
responder = () => rpc({ songList: [{ songInfo: { mid: 'song' } }], totalNum: 50 })
result = await client.call('/getSingerHotsong', { singermid: 'singer', page: 2, limit: 30 })
check(requests.at(-1).data.req.module === 'music.musichallSong.SongListInter' && requests.at(-1).data.req.param.begin === 30 && result.data.songlist[0].mid === 'song', 'APK singer song contract with songInfo unwrap')
responder = () => rpc({ albumList: [], total: 0 })
check((await client.call('/getSingerAlbum', { singermid: 'singer' })).data.list.length === 0, 'empty singer album list is valid')
responder = () => rpc({ ret_code: 0, vec_hotkey: [{ query: 'Live hotkey' }, { title: 'Other' }] })
check((await client.call('/getHotkey')).data.hotkey[0].k === 'Live hotkey', 'real hotkey response is mapped to existing UI')
responder = () => ({ code: 0, req: { code: 500003 } })
await reject(client.call('/getNewDisks'), /失败/)
responder = () => ({ code: 0, req: { code: 0 } })
await reject(client.call('/getNewDisks'), /缺少数据/)
responder = () => ({ code: 0, req: { code: 0, data: { albums: 'broken' } } })
await reject(client.call('/getNewDisks'), /响应不完整/)
responder = () => { throw Object.assign(new Error('secret credential'), { response: { status: 503 } }) }
await reject(client.call('/getNewDisks'), error => /503/.test(error.message) && !error.message.includes('secret'))
check([0,1,2,3,4].every(catZhida => client.supports('/getSearchByKey', { catZhida })), 'all five verified search categories use the independent client')
let sessionCount = 0, filtered = false, time = 1000
const searchClient = new QQClient({ now: () => time, request: async config => {
    requests.push(config)
    if (config.data.req.method === 'GetSession') {
        sessionCount++
        check(!config.headers.Cookie, 'anonymous search session never receives account Cookie')
        return { data: rpc({ session: { uid: '12345', sid: 'session-' + sessionCount, userip: '0' } }) }
    }
    return { data: rpc({ meta: { sum: 66, is_filter: filtered ? -2 : 0 }, body: {
        singer: [{ singerMID: 'artist', singerPic: 'http://y.gtimg.cn/artist' }],
        item_songlist: [{ dissid: '123', logo: 'http://qpic.y.qq.com/cover' }],
        item_mv: [{ vid: 'video', mvname: 'Video', pic: 'http://y.gtimg.cn/video' }]
    } }) }
} })
const typed = await Promise.all([1,3,4].map(catZhida => searchClient.call('/getSearchByKey', { key: '陈粒', catZhida, page: 2 }, 'uin=12345;qm_keyst=test')))
check(sessionCount === 1 && typed.every(item => item.data.total === 66), 'concurrent category searches share one anonymous session')
check(typed[1].data.list[0].imgurl.startsWith('https:') && typed[2].data.list[0].mv_name === 'Video', 'playlist/MV typed responses use actual fields and secure artwork')
check(requests.at(-1).data.req.param.page_num === 2 && requests.at(-1).data.comm.sid === 'session-1', 'typed search pagination carries session context')
filtered = true
await reject(searchClient.call('/getSearchByKey', { key: '陈粒', catZhida: 3 }), /被平台限制/)
filtered = false; time += 900001
await searchClient.call('/getSearchByKey', { key: '陈粒', catZhida: 1 })
check(sessionCount === 2, 'expired anonymous session is replaced')
const track = { id: 123, mid: 'song', name: 'Track', interval: 200, album: { name: 'Album' }, singer: [], file: { media_mid: 'media' } }
let playbackURL = 'M500media.mp3?vkey=token', domain = 'http://aqqmusic.tc.qq.com/'
responder = config => {
    const req = config.data.req
    if (req.method === 'get_song_detail') return rpc({ track_info: track })
    if (req.method === 'CgiGetVkey') return rpc({ retcode: 0, sip: [domain], midurlinfo: [{ songmid: 'song', purl: playbackURL }] })
    return rpc({ crypt: 0, lyric: Buffer.from('[00:01.00]Exact ID lyric').toString('base64'), trans: '' })
}
result = await client.call('/getMusicPlay', { songmid: 'song', quality: '320' }, 'uin=12345;qqmusic_key=key')
check(result.data.playUrl.song.url.startsWith('https://aqqmusic.tc.qq.com/'), 'authorized relative media URL is composed on official HTTPS origin')
check(result.data.playUrl.song.quality === '128' && result.data.playUrl.song.codec === 'mp3' && result.data.playUrl.song.requestedQuality === '320', 'actual M500 grant remains standard even when requesting M800 high quality')
check(result.data.playUrl.song.fullDuration === 200 && requests.at(-1).data.req.param.filename[0] === 'M800media.mp3', 'playback uses actual media_mid and selected quality')
check(requests.at(-1).data.req.param.authst === 'key' && requests.at(-1).headers.Cookie.includes('qqmusic_key'), 'account credentials are scoped to current upstream playback request')
playbackURL = ''
result = await client.call('/getMusicPlay', { songmid: 'song' })
check(!result.data.playUrl.song.url && /权限/.test(result.data.playUrl.song.error), 'empty vkey authorization never manufactures a playable URL')
playbackURL = '//evil.example/audio'
check(!(await client.call('/getMusicPlay', { songmid: 'song' })).data.playUrl.song.url, 'protocol-relative injected playback URL rejected')
playbackURL = 'audio.mp3'; domain = 'http://evil.example/'
check(!(await client.call('/getMusicPlay', { songmid: 'song' })).data.playUrl.song.url, 'non-QQ playback origin rejected')
result = await client.call('/getLyric', { songmid: 'song' })
check(result.lrc === '[00:01.00]Exact ID lyric' && requests.at(-1).data.req.param.songID === 123, 'lyrics decode by real song ID rather than name matching')
const richClient = new QQClient({ request: async config => ({ data: config.data.req.method === 'get_song_detail' ? rpc({ track_info: track }) : { code: 0, req: { code: -1 } } }), wordLyrics: async song => ({ yrc: `[0,1000](0,1000,0)${song.name}`, trans: '' }) })
check((await richClient.call('/getLyric', { songmid: 'song' })).yrc.includes('Track'), 'existing word lyrics survive standard lyric endpoint failure')
await reject(client.call('/getMusicPlay', { songmid: 'song', quality: 'invented' }), /音质参数/)
result = await client.call('/batchGetSongInfo', { songs: [['song', 123], 'song', { songmid: 'song' }] })
check(result.data.list.length === 3 && result.data.list[0].mid === 'song', 'batch metadata accepts existing caller forms and returns the UI list contract')
check(requests.every(request => !request.url.includes('localhost')), 'all independent client operations connect directly to QQ')
let saved = '', failSave = false, validation = async cookie => {
    if (cookie === 'expired') throw new Error('expired')
    return { userId: '12345', nickname: 'Test' }
}
const sessions = new QQSession({ validate: (...args) => validation(...args), load: () => saved,
    save: value => { if (failSave) throw new Error('disk unavailable'); saved = value }, clear: () => { saved = '' } })
await sessions.accept('valid')
check((await sessions.restore()).cookie === 'valid', 'persisted QQ session is reauthenticated before restore')
await reject(sessions.accept('expired'), /expired/)
check(JSON.parse(saved).cookie === 'valid', 'rejected login preserves prior persisted session')
failSave = true
await reject(sessions.accept('replacement'), /disk unavailable/)
check(JSON.parse(saved).cookie === 'valid', 'failed persistence preserves prior saved credentials')
failSave = false
let finishValidation
validation = () => new Promise(resolve => { finishValidation = resolve })
const pendingSession = sessions.accept('late')
sessions.logout(); finishValidation({ userId: '12345' })
await reject(pendingSession, /已取消|已切换/)
check(!saved, 'late authentication cannot recreate encrypted state after logout')
validation = async () => ({ userId: '12345' })
await sessions.accept('valid')
const pendingRestore = sessions.restore()
sessions.logout()
await reject(pendingRestore, /已取消|已切换/)
saved = 'invalid JSON'
await reject(sessions.restore(), /损坏/)
saved='previous';let nativeCurrent=true
validation=()=>new Promise(resolve=>{finishValidation=resolve})
const cancelledNative=sessions.accept('native-candidate','12345',()=>nativeCurrent)
nativeCurrent=false;finishValidation({userId:'12345'})
await reject(cancelledNative,/取消/)
check(saved==='previous','closing native login during validation preserves previous encrypted session')
console.log(`QQ independent client checks passed: ${checks} assertions; protocol errors, identity precision, album/playlist/rank/singer pagination and direct transport.`)
