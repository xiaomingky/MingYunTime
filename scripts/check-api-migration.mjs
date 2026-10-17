import assert from 'node:assert/strict'
import fs from 'node:fs'
import { KugouClient } from '../electron/kugou-client.js'
import { isKugouDirectRoute } from '../src/api/kugou-direct.js'
import { NeteaseClient } from '../electron/netease-client.js'
import { NETEASE_DIRECT_ROUTES } from '../src/api/netease-direct.js'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const lock = fs.readFileSync('package-lock.json', 'utf8')
for (const name of ['qq-music-api', 'kugou-music-api', 'netease-api', 'kugou-music-api-src', 'netease-api-src']) {
    assert.equal(fs.existsSync('resources/' + name), false, name + ' removed')
    assert.ok(!JSON.stringify(pkg).includes(name), name + ' excluded from packaging')
    assert.ok(!lock.includes(name), name + ' absent from lockfile')
}
const frontend = fs.readFileSync('src/api/kugou.js', 'utf8')
for (const match of frontend.matchAll(/kugouRequest\.(?:get|post)\('([^']+)'/g)) {
    assert.ok(isKugouDirectRoute(match[1], { id: '123', ids: '123' }), 'native route: ' + match[1])
}
const neteaseFrontend = fs.readFileSync('src/api/index.js', 'utf8')
for (const match of neteaseFrontend.matchAll(/request\.(?:get|post)\(['"`]([^'"`?$]+)/g)) {
    assert.ok(NETEASE_DIRECT_ROUTES.has(match[1]), 'native NetEase route: ' + match[1])
}
for (const path of ['electron/netease-api.js', 'electron/api-runtime.cjs', 'electron/local-service.js', 'electron/service-lifecycle.js', 'src/utils/local-service.js']) {
    assert.equal(fs.existsSync(path), false, path + ' removed')
}
for (const [route, params] of [['/search', { type: 'mv' }], ['/top/playlist', { category_id: 123 }], ['/top/album', { type: 2 }], ['/artist/lists', { sextypes: 2 }]]) {
    assert.ok(isKugouDirectRoute(route, params), 'native filter: ' + route)
}
let requests = [], response = { status: 1, error_code: 0, data: {} }
const client = new KugouClient({ request: async config => { requests.push(config); return { data: response } } })
const auth = { token: 'synthetic-migration-token', userid: '123' }
await client.call('/playlist/add', { ...auth, name: '测试歌单' })
assert.equal(requests.at(-1).url, 'https://gateway.kugou.com/cloudlist.service/v4/add_list')
assert.equal(JSON.parse(requests.at(-1).data).name, '测试歌单')
await client.call('/playlist/tracks/add', { ...auth, listid: '7', songs: [{ name: '测试歌曲', hash: 'A'.repeat(32), album_id: '23', mixsongid: '42' }] })
assert.equal(requests.at(-1).url, 'https://gateway.kugou.com/cloudlist.service/v4/add_song')
assert.equal(JSON.parse(requests.at(-1).data).data[0].mixsongid, 42)
await client.call('/playlist/tracks/del', { ...auth, listid: '7', fileids: ['91'] })
assert.equal(requests.at(-1).headers['x-router'], 'cloudlist.service.kugou.com')
assert.deepEqual(JSON.parse(requests.at(-1).data).data, [{ fileid: 91 }])
response = { status: 0, error_code: 34175, data: { users: [{ userid: '123' }] } }
assert.equal((await client.call('/login/cellphone', { mobile: '13800000000', code: '123456' })).error_code, 34175)
assert.ok(!JSON.stringify(requests.at(-1)).includes('13800000000'), 'phone remains encrypted')
assert.ok(!JSON.stringify(requests.at(-1)).includes('123456'), 'verification code remains encrypted')
assert.ok(requests.every(r => new URL(r.url).hostname.endsWith('.kugou.com')))
const neteaseRequests = []
let neteaseResponse = { code: 200 }
const netease = new NeteaseClient({ request: async config => { neteaseRequests.push(config); return { data: neteaseResponse, headers: {} } } })
netease.playlists.set('7', { data: {} })
await netease.call('/playlist/tracks', { op: 'add', pid: '7', tracks: '11,12' }, '__csrf=synthetic-csrf; MUSIC_U=synthetic-session')
assert.equal(netease.playlists.size, 0, 'successful playlist mutations invalidate cached tracks')
const encryptedRequest = neteaseRequests.at(-1)
assert.equal(encryptedRequest.url, 'https://music.163.com/weapi/playlist/manipulate/tracks?csrf_token=synthetic-csrf')
const encryptedForm = new URLSearchParams(encryptedRequest.data)
assert.match(encryptedForm.get('encSecKey'), /^[a-f0-9]{256}$/)
assert.ok(Buffer.from(encryptedForm.get('params'), 'base64').length > 16)
assert.ok(!encryptedRequest.data.includes('trackIds'), 'mutation payload uses encrypted WeAPI transport')
netease.playlists.set('7', { data: {} })
neteaseResponse = { code: 401, message: 'login required' }
assert.equal((await netease.call('/playlist/tracks', { op: 'del', pid: '7', tracks: '11' })).code, 401)
assert.equal(netease.playlists.size, 1, 'rejected mutation preserves cached state')
const sentCount = neteaseRequests.length
await assert.rejects(netease.call('/playlist/create', { name: 'test' }, 'bad\r\nCookie'), /无效/)
await assert.rejects(netease.call('/playlist/tracks', { op: 'invalid', pid: '7', tracks: '11' }), /无效/)
assert.equal(neteaseRequests.length, sentCount, 'invalid inputs never reach the network')
console.log('API migration checks passed: removed modules, native route coverage, APK playlist contracts, encrypted login and multi-account response.')
