import assert from 'node:assert/strict'
import { createDecipheriv, createHash } from 'node:crypto'
import { NeteaseClient } from '../electron/netease-client.js'
let checks = 0, requests = [], responder, responseHeaders = {}
let playbackParams
const client = new NeteaseClient({ playback: { playback: async (params, cookie) => { playbackParams = { params, cookie }; return responder() } }, request: async config => { requests.push(config); return { data: await responder(config), headers: responseHeaders } }, qrImage: async url => 'qr:' + url })
const ok = data => ({ code: 200, ...data })
const check = (value, message) => { assert.ok(value, message); checks++ }
const reject = async (promise, expression) => { await assert.rejects(promise, expression); checks++ }
function qrBody(request) {
    check(request.url.startsWith('https://interfacepc.music.163.com/eapi/login/qrcode/'), 'QR uses the native encrypted origin')
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null)
    const [path, text, digest] = Buffer.concat([decipher.update(Buffer.from(new URLSearchParams(request.data).get('params'), 'hex')), decipher.final()]).toString().split('-36cd479b6b5-')
    check(digest === createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex'), 'QR signs its exact endpoint and payload')
    return JSON.parse(text)
}
responder = () => ok({ result: { songs: [{ id: 1, name: 'Song', duration: 1000, artists: [{ name: 'A' }], album: { name: 'Al' } }], songCount: 1 } })
let data = await client.call('/cloudsearch', { keywords: 'Song', type: 1, limit: 1 })
check(data.result.songs[0].platform === 'netease' && data.total === 1, 'search normalizes a real song into the existing player shape')
check(requests.at(-1).url.includes('music.163.com') && requests.at(-1).headers.Cookie === undefined, 'guest search uses the official origin without a credential header')
responder = () => ok({ result: { songCount: 0 } })
check((await client.call('/search', { keywords: 'nothing' })).result.songs.length === 0, 'legitimate empty search does not throw')
responder = () => ok({ songs: [{ id: 1, duration: 1000, ar: [], al: {} }], privileges: [] })
data = await client.call('/song/detail', { ids: '1' }); check(data.songs[0].dt === 1000, 'song detail preserves duration')
responder = () => ok({ data: [{ id: 1, url: 'http://m801.music.126.net/audio.m4a', time: 1000, code: 200 }, { id: 2, url: null, code: -110 }] })
data = await client.call('/song/url/v1', { id: '1,2', level: 'standard' })
check(data.data[0].url.startsWith('https://m801.music.126.net') && data.data[1].url === null, 'playback keeps official URLs and honest rights denial')
check(playbackParams.params.encodeType === 'flac' && playbackParams.params.level === 'standard', 'native playback transport receives the selected quality')
await reject(client.call('/song/url/v1', { id: '1', level: 'unknown' }), /音质/)
responder = () => ok({ lrc: { lyric: '[00:01.00]Line' }, klyric: { lyric: '[0,1000](0,1000,0)Word' }, tlyric: { lyric: '' } })
data = await client.call('/lyric/new', { id: '1' }); check(data.lrc.lyric.includes('Line') && data.klyric.lyric.includes('Word'), 'standard and word lyrics remain available')
responder = () => ok({ album: { id: 1, name: 'Album', songs: [] }, songs: [{ id: 1, duration: 1000, artists: [], album: {} }] })
data = await client.call('/album', { id: 1 }); check(data.album.songs.length === 1 && data.album.songs[0].platform === 'netease', 'album detail normalizes returned tracks')
responder = () => ok({ playlist: { id: 1, trackIds: [{ id: 1 }, { id: 2 }], tracks: [{ id: 1, duration: 1000, ar: [], al: {} }] } })
data = await client.call('/playlist/detail', { id: 1 }); check(data.playlist.trackIds.length === 2 && data.playlist.tracks.length === 1, 'playlist keeps lazy track IDs and embedded tracks separate')
responder = config => {
    if (config.url.endsWith('/api/v6/playlist/detail')) return ok({ playlist: { trackIds: [{ id: 1 }, { id: 2 }] } })
    const ids = JSON.parse(new URLSearchParams(config.data).get('ids'))
    return ok({ songs: ids.map(value => ({ id: value, duration: 1000, ar: [], al: {} })) })
}
data = await client.call('/playlist/track/all', { id: 1, offset: 1, limit: 1 }); check(data.songs.length === 1 && String(data.songs[0].id) === '2' && data.hasMore === false && data.offset === 2, 'playlist continuation fetches exact requested slice')
responder = () => ok({ unikey: 'valid-key-123' })
data = await client.call('/login/qr/key'); const key = data.data.unikey
check((await client.call('/login/qr/create', { key })).data.qrimg === 'qr:https://music.163.com/login?codekey=valid-key-123', 'QR data uses generated official login URL')
responder = config => config.url.endsWith('/eapi/login/qrcode/client/login') ? { code: 801, message: '等待扫码' } : ok({ unikey: 'valid-key-123' })
check((await client.call('/login/qr/check', { key })).code === 801, 'unconfirmed QR reports waiting')
await client.call('/login/qr/cancel', { key }); await reject(client.call('/login/qr/create', { key }), /过期/)
responseHeaders = {}
responder = () => ok({ unikey: 'confirmed-key-123' })
const confirmedKey = (await client.call('/login/qr/key')).data.unikey
check(qrBody(requests.at(-1)).type === 3, 'desktop QR key uses native type 3')
const deviceId = qrBody(requests.at(-1)).header.deviceId
responder = config => config.url.endsWith('/eapi/login/qrcode/client/login')
    ? { code: 803, message: '登录成功' }
    : { code: 200, account: { id: 11 }, profile: { userId: 11, nickname: 'Synthetic' } }
responseHeaders = { 'set-cookie': ['MUSIC_U=synthetic-session; Path=/', '__csrf=synthetic-csrf; Path=/'] }
data = await client.call('/login/qr/check', { key: confirmedKey })
check(data.code === 803 && data.profile?.userId === 11 && data.cookie.includes('MUSIC_U=synthetic-session'), 'confirmed QR accepts returned credentials only after account status is verified')
check(qrBody(requests.at(-2)).type === 3 && qrBody(requests.at(-2)).header.deviceId === deviceId, 'desktop QR polling keeps native type and session device identity')
check(requests.at(-1).url.includes('/weapi/w/nuser/account/get?') && requests.at(-1).headers.Cookie.includes('MUSIC_U=synthetic-session'), 'QR account confirmation uses the official authenticated web status contract')
responseHeaders = {}
responder = () => ok({ unikey: 'rejected-key-123' })
const rejectedKey = (await client.call('/login/qr/key')).data.unikey
responder = config => config.url.endsWith('/eapi/login/qrcode/client/login')
    ? { code: 400, message: '请切换其他登录方式或升级新版本再试' }
    : ok({})
await reject(client.call('/login/qr/check', { key: rejectedKey }), /请切换其他登录方式或升级新版本再试/)
check(qrBody(requests.at(-1)).type === 3, 'QR rejection remains visible without changing the protocol or account')
await client.call('/login/qr/cancel', { key: rejectedKey })
responder = () => ok({ unikey: 'session-key-123' })
responseHeaders = { 'set-cookie': ['QR_SESSION=synthetic-qr-session; Path=/'] }
const sessionKey = (await client.call('/login/qr/key')).data.unikey
responseHeaders = {}
responder = config => {
    check(config.headers.Cookie.includes('QR_SESSION=synthetic-qr-session'), 'poll retains cookies returned when the QR key was created')
    return { code: 802, message: '等待确认' }
}
check((await client.call('/login/qr/check', { key: sessionKey })).code === 802, 'scanned QR waits for confirmation without treating it as failure')
responder = () => ({ code: 803 })
await reject(client.call('/login/qr/check', { key: sessionKey }), /登录凭据/)
await client.call('/login/qr/cancel', { key: sessionKey })
const requestCount = requests.length
check((await client.call('/login/qr/check', { key: sessionKey })).code === 800 && requests.length === requestCount, 'cancelled QR never makes a further network request')
responseHeaders = {}
responder = () => ok({})
data = await client.call('/like', { id: '123', uid: '11', like: false }, 'MUSIC_U=synthetic-session; __csrf=synthetic-csrf')
check(data.code === 200 && requests.at(-1).url.includes('/weapi/song/like?'), 'ordinary unlike writes the account song-like endpoint, not radio state')
check(requests.at(-1).headers.Cookie.includes('MUSIC_U=synthetic-session'), 'song-like mutation stays bound to the active account session')
await reject(client.call('/search', { keywords: 'x' }, 'bad\r\ncredential'), /Cookie/)
check(requests.every(request => ['music.163.com', 'interfacepc.music.163.com'].includes(new URL(request.url).hostname)), 'every independent NetEase request uses an official origin')
// Opening a playlist must not fetch its detail and embedded first page twice.
let playlistCalls=0, releasePlaylist
const paged = new NeteaseClient({request:async spec=>{
 if(spec.url.endsWith('/api/v6/playlist/detail')) {playlistCalls++;return {data:{code:200,playlist:{trackIds:[{id:1},{id:2}],tracks:[{id:1,ar:[],al:{},dt:10},{id:2,ar:[],al:{},dt:10}]}}}}
 throw Error('embedded tracks should avoid a second song request')
}})
await Promise.all([paged.call('/playlist/detail',{id:'1'},'account-a'),paged.call('/playlist/detail',{id:'1'},'account-a')])
check(playlistCalls===1,'concurrent detail requests share the same in-flight request')
const embedded = await paged.call('/playlist/track/all',{id:'1',limit:1,offset:1},'account-a')
check(playlistCalls===1 && embedded.songs[0].id===2 && embedded.hasMore===false,'cached detail and embedded tracks preserve exact page offsets')
await paged.call('/playlist/track/all',{id:'1',limit:1},'account-b')
check(playlistCalls===2,'different account cannot reuse personal playlist cache')
await paged.call('/playlist/detail',{id:'1'},'account-b')
check(playlistCalls===3,'explicit detail refresh bypasses old snapshots after edits')
console.log(`NetEase independent client checks passed: ${checks} assertions.`)
