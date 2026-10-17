import assert from 'node:assert/strict'
import { NeteaseClient } from '../electron/netease-client.js'
let checks = 0, requests = [], responder
let playbackParams
const client = new NeteaseClient({ playback: { playback: async (params, cookie) => { playbackParams = { params, cookie }; return responder() } }, request: async config => { requests.push(config); return { data: await responder(config), headers: {} } }, qrImage: async url => 'qr:' + url })
const ok = data => ({ code: 200, ...data })
const check = (value, message) => { assert.ok(value, message); checks++ }
const reject = async (promise, expression) => { await assert.rejects(promise, expression); checks++ }
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
responder = config => config.url.endsWith('/api/login/qrcode/client/login') ? { code: 801, message: '等待扫码' } : ok({ unikey: 'valid-key-123' })
check((await client.call('/login/qr/check', { key })).code === 801, 'unconfirmed QR reports waiting')
await client.call('/login/qr/cancel', { key }); await reject(client.call('/login/qr/create', { key }), /过期/)
await reject(client.call('/search', { keywords: 'x' }, 'bad\r\ncredential'), /Cookie/)
check(requests.every(request => request.url.startsWith('https://music.163.com')), 'every independent NetEase request uses the official origin')
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
