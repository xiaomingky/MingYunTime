import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { QishuiClient, qishuiPlayback, qishuiList } from '../electron/qishui-client.js'
import { QishuiBusiness, qishuiArtist } from '../electron/qishui-business.js'
import { createQishuiAudio, qishuiMediaURL } from '../electron/qishui-audio.js'

let assertions = 0
const check = (value, message) => { assert.ok(value, message); assertions++ }
const track = { id: '7079108541549643812', name: '曲目', duration: 297240, preview: { start: 143808, duration: 30047 } }
const model = duration => ({ track, track_player: { video_model: JSON.stringify({ video_duration: duration, video_list: [{ main_url: 'https://v95.douyinvod.com/audio', video_meta: { codec_type: 'aac' } }] }) } })
check(qishuiPlayback(model(297.24)).preview === false, 'metadata preview field must not label an actual complete stream as preview')
check(qishuiPlayback(model(297.24)).offsetMs === 0, 'complete stream retains the complete lyric clock')
check(qishuiPlayback(model(30.047)).preview === true, 'delivered short stream stays explicitly marked preview')

let calls = [], reply, pending
const client = new QishuiClient({ request: async () => { throw Error('unexpected unsigned backend') }, pcRequest: async config => {
    calls.push(config)
    if (reply === 'pending') return new Promise(resolve => { pending = resolve })
    if (reply !== undefined) return { data: reply }
    if (config.path.endsWith('/search/album')) return { data: { status_info: {}, result_groups: [{ id: 'albums', data: [{ entity: { album: { id: '7553552537015994369', name: '十年自选' } } }], has_more: true, next_cursor: '20' }] } }
    if (config.path.endsWith('/comments')) return { data: { status_info: {}, comments: [{ id: '7577331650129494811', content: '评论内容', time_created: 1700000000, user: { id: '123', nickname: '测试' } }], count: '33', cursor: 'next', has_more: true } }
    if (config.path.endsWith('/replies')) return { data: { status_info: {}, reply_infos: [{ id: '1234567890123456789', content: '回复' }], has_more: false } }
    if (config.path.endsWith('/me/playlist') && config.method === 'GET') return { data: { status_info: {}, playlists: [{ id: '123', title: '喜欢', type: 1 }], next_cursor: '', has_more: false } }
    if (config.path.endsWith('/me/playlist')) return { data: { status_info: {}, playlist: { id: '1234', title: config.data.name, type: 3 } } }
    return { data: { status_info: {}, collected_media: [{ id: track.id, type: 'track' }] } }
} })
client.playlist = async (id, cursor) => ({ songs: [{ ...track, platform: 'qishui' }], hasMore: !!cursor, cursor: '' })
const business = new QishuiBusiness(client)
const albums = await business.search({ query: '陈粒', type: 'album', cursor: '20' })
check(albums.items[0].name === '十年自选' && albums.hasMore && albums.cursor === '20', 'grouped album search keeps domain results and server pagination')
check(calls.at(-1).params.cursor === '20', 'search cursor is passed to platform')
const comments = await business.comments({ id: track.id })
check(comments.comments[0].commentId === '7577331650129494811' && comments.comments[0].time === 1700000000000 && comments.total === 33, 'comment identity, timestamp and count are normalized without precision loss')
const replies = await business.replies({ id: '7577331650129494811', groupId: track.id })
check(replies.comments[0].content === '回复' && calls.at(-1).params.group_id === track.id, 'reply list uses group context and actual reply_infos field')
const before = calls.length
await assert.rejects(business.collect({ ids: [track.id] }), /登录/); assertions++
check(calls.length === before, 'unauthenticated writes never reach upstream')
client.cookie = 'sessionid=fixture'
await business.collect({ ids: [track.id] })
check(calls.at(-1).data.media[0].id === track.id && calls.at(-1).data.collect_action === 1, 'favorite action uses exact native PC snake_case contract')
await business.collect({ type: 'album', ids: ['7553552537015994369'], collected: false })
check(calls.at(-1).path.endsWith('/album/delete') && calls.at(-1).data.album_ids[0] === '7553552537015994369', 'album uncollect uses explicit operation and full ID')
await business.playlistTracks({ id: '1234', ids: [track.id] })
check(calls.at(-1).data.playlist_id === '1234' && calls.at(-1).data.media[0].type === 'track', 'append uses PC playlist_id and media objects')
await business.playlistTracks({ id: '1234', ids: ['123',track.id], action: 'sort' })
check(calls.at(-1).path === '/luna/me/playlist/media/sort' && calls.at(-1).data.media.map(m=>m.id).join(',') === '123,'+track.id, 'playlist sorting preserves exact full media ordering on the declared endpoint')
const created = await business.createPlaylist({ name: '我的歌单', isPrivate: true })
check(created.playlist.name === '我的歌单' && calls.at(-1).data.is_private === true, 'private playlist creation retains the platform response')
const liked = await business.collections({ type: 'track' })
check(liked.items[0].collected && liked.items[0].id === track.id, 'liked tracks come from favorite type 1 playlist rather than album/playlist mixed collection endpoint')
reply = { status_info: {}, mixed_collections: [] }
await business.collections({ type: 'album' })
check(Array.isArray(calls.at(-1).params.item_types) && calls.at(-1).params.item_types[0] === 'album', 'collection filters retain repeated-query array contract')
reply = { status_info: {}, user: { id: '97557223451', nickname: '音乐人', artist_id: '6776144869279664130', sec_uid: 'not-for-renderer' }, user_stats: { count_follower: 42 }, my_user_state: { follow_status: 1 } }
const user = await business.user({ id: '97557223451' })
check(user.user.followStatus === 1 && user.user.followers === 42 && !JSON.stringify(user).includes('not-for-renderer'), 'public profile normalizes counts and omits private request fields')
reply = { status_info: {}, follow_status: 2 }
check((await business.follow({ id: '97557223451' })).followStatus === 2, 'follow status comes from confirmed server response')
reply = { status_info: {} }
await assert.rejects(business.follow({ id: '97557223451' }), /未确认/); assertions++
reply = { status_info: {}, media: [{ entity: { track_wrapper: { track } } }], total_num: 1, has_more: true, next_cursor: 'history-next' }
const recent = await business.recent()
check(recent.songs[0].id === track.id && recent.cursor === 'history-next' && calls.at(-1).params.scene === 'me_tab', 'cloud history keeps track wrappers, source scene and cursor')
reply = { status_info: {} }
await business.deleteRecent({ ids: [track.id] })
check(calls.at(-1).path.endsWith('/recently-played-media/delete') && calls.at(-1).data.media[0].id === track.id, 'recent deletion targets specific media rather than clearing unrelated history')
check(qishuiArtist({ id: '123', artist_profile: { intro: '歌手简介' } }).description === '歌手简介', 'structured artist profiles render readable introductions')
reply = { result_groups: [] }
check((await business.search({ query: '没有匹配', type: 'user' })).items.length === 0, 'valid zero-result entity search stays empty')
check(qishuiList({ status_info: {} }, 'comments').length === 0, 'successful omitted protobuf arrays represent valid empty resources')
assert.throws(()=>qishuiList({},'comments'), /有效列表/); assertions++
assert.throws(()=>qishuiList({status_info:{},comments:'invalid'},'comments'), /有效列表/); assertions++
reply = { status_info: {}, media_resources: [{ entity: { track_wrapper: { track } } }] }
const filtered = await business.playlistSearch({ id: '1234', query: '曲目' })
check(filtered.songs[0].id === track.id && calls.at(-1).data.query === '曲目', 'playlist search reads upstream media resources with exact query')
reply = { status_info: {}, share_info: { share_link: 'https://music.douyin.com/qishui/share/track?track_id=' + track.id, share_douyin_info: { private: 'omit-from-renderer' } } }
const share = await business.share({ id: track.id })
check(share.url.includes(track.id) && !JSON.stringify(share).includes('omit-from-renderer'), 'share exposes only official share URL')
reply.share_info.share_link = 'https://qishui.com.evil.test/share'
await assert.rejects(business.share({ id: track.id }), /有效/); assertions++
for (const task of [() => business.playlistTracks({ id: '../escape', ids: [track.id] }), () => business.collect({ ids: [Number(track.id)] }), () => business.createComment({ id: track.id, text: '' }), () => business.search({ type: '../passport', query: 'test' })]) {
    await assert.rejects(task()); assertions++
}
reply = { status_code: 1000016, status_info: { status_msg: '登录已过期' } }
await assert.rejects(business.collect({ ids: [track.id] }), /过期/); assertions++
reply = {}
await assert.rejects(business.collect({ ids: [track.id] }), /未确认/); assertions++
reply = 'pending'
const stale = business.collect({ ids: [track.id] })
await Promise.resolve(); client.revision++; pending({ data: { status_info: {} } })
await assert.rejects(stale, /账号已切换/); assertions++

for (const url of ['http://v95.douyinvod.com/a', 'https://douyinvod.com.evil.test/a', 'https://u:p@v95.douyinvod.com/a', 'https://127.0.0.1/a']) { assert.throws(() => qishuiMediaURL(url)); assertions++ }
check(qishuiMediaURL('https://v95.douyinvod.com/a').startsWith('https:'), 'only official HTTPS media origins are accepted')
const audio = createQishuiAudio({ request: async () => ({status:200,data:Buffer.from('clear audio')}), runtime: {}, ffmpeg: '' })
const clear = await audio.prepare({ url: 'https://v95.douyinvod.com/a', duration: 30, playAuth: '', backupUrls: ['https://backup.douyinvod.com/a?synthetic=grant'] })
check(!Object.hasOwn(clear, 'playAuth') && !Object.hasOwn(clear, 'backupUrls'), 'audio authorizations and signed backups never escape to renderer even for unencrypted playback')
check(audio.handle(new Request('qishui-audio://cache/unknown')).status === 404, 'missing in-memory media is explicit 404')
const main = readFileSync(new URL('../electron/qishui-music.js', import.meta.url), 'utf8')
check(main.includes('playAuth, backupUrls, ...playback') && main.includes('audio.prepare'), 'detail and playback IPC keep authorization material in main process')

let releaseKey, releaseDownload, releaseRemux
const buffer = Buffer.from('0123456789')
const memory = createQishuiAudio({ request: async () => ({ data: buffer }), runtime: { decodeKey: async () => '0'.repeat(32) },
    remux: async () => buffer, maxBytes: 20, maxEntries: 1 })
const media = await memory.prepare({ url: 'https://v95.douyinvod.com/a', playAuth: 'fixture' })
const range = memory.handle(new Request(media.url, { headers: { Range: 'bytes=2-5' } }))
check(range.status === 206 && range.headers.get('content-range') === 'bytes 2-5/10' && await range.text() === '2345', 'in-memory audio supports seeking with exact byte ranges')
const head = memory.handle(new Request(media.url, { method: 'HEAD' }))
check(head.status === 200 && head.headers.get('content-length') === '10' && await head.text() === '', 'HEAD reports size without consuming audio')
check(memory.handle(new Request(media.url, { headers: { Range: 'bytes=10-' } })).status === 416, 'unsatisfiable audio ranges return 416')
check(memory.handle(new Request(media.url, { method: 'POST' })).status === 405, 'memory protocol refuses writes')
const second = await memory.prepare({ url: 'https://v95.douyinvod.com/b', playAuth: 'fixture' })
check(memory.handle(new Request(media.url)).status === 404 && memory.handle(new Request(second.url)).status === 200, 'bounded cache evicts prior media')
memory.clear()
check(memory.handle(new Request(second.url)).status === 404, 'logout clears cached decrypted audio')
for (const phase of ['key','download','remux']) {
    const isolated = createQishuiAudio({
        runtime: { decodeKey: () => phase === 'key' ? new Promise(resolve => { releaseKey = resolve }) : Promise.resolve('0'.repeat(32)) },
        request: () => phase === 'download' ? new Promise(resolve => { releaseDownload = resolve }) : Promise.resolve({ data: buffer }),
        remux: () => phase === 'remux' ? new Promise(resolve => { releaseRemux = resolve }) : Promise.resolve(buffer)
    })
    const preparing = isolated.prepare({ url: 'https://v95.douyinvod.com/a', playAuth: 'fixture' })
    await new Promise(resolve => setImmediate(resolve)); isolated.clear()
    if (phase === 'key') releaseKey('0'.repeat(32))
    if (phase === 'download') releaseDownload({ data: buffer })
    if (phase === 'remux') releaseRemux(buffer)
    await assert.rejects(preparing, /账号已切换/); assertions++
}
console.log(`Qishui business checks passed: ${assertions} assertions; complete/preview access, entity search, comments/replies, favorite and playlist contracts, login isolation, rejected writes, stale accounts and media origin checks.`)
