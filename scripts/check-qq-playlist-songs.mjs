import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { QQClient } from '../electron/qq-client.js'

const cookie = 'wxuin=1152921504606846977; qm_keyst=synthetic'
const requests = []
const client = new QQClient()
client.send = async (_url, options) => {
  const req = options.data.req
  requests.push(req)
  if (req.method === 'CgiGetSelfDiss') return { code: 0, req: { code: 0, data: { code: 0, code_selfDirs: 0, selfdirnum: 2, selfDirs: [
    { disstid: '9000001234', dirid: 7, title: '自建' },
    { disstid: '9000000201', dirid: 201, title: '我喜欢' }
  ] } } }
  if (req.method === 'get_song_detail') {
    const key = req.param.song_mid || String(req.param.song_id)
    return { code: 0, req: { code: 0, data: { track_info: { mid: /^\d+$/.test(key) ? 'mid123' : key, id: /^\d+$/.test(key) ? Number(key) : 123456, type: 111 } } } }
  }
  if (req.method === 'AddSonglist' || req.method === 'DelSonglist') return { code: 0, req: { code: 0 } }
  throw new Error(`unexpected ${req.module}.${req.method}`)
}

await client.mutatePlaylistSongs('9000001234', ['midA', 'midA', '123456'], cookie)
assert.deepEqual(requests.at(-1), { module: 'music.musicasset.PlaylistDetailWrite', method: 'AddSonglist', param: { dirId: 7, v_songInfo: [{ songType: 111, songId: 123456 }] } })
await client.mutatePlaylistSongs('9000000201', ['midB'], cookie, true)
assert.deepEqual(requests.at(-1), { module: 'music.musicasset.PlaylistDetailWrite', method: 'DelSonglist', param: { dirId: 201, v_songInfo: [{ songType: 111, songId: 123456 }] } })
assert.equal(requests.find(item => item.method === 'CgiGetSelfDiss')?.param.uin, '1152921504606846977')

await assert.rejects(() => client.mutatePlaylistSongs('9000009999', ['midA'], cookie), /未找到可编辑/)
await assert.rejects(() => client.mutatePlaylistSongs('9000001234', [], cookie), /请选择/)
await assert.rejects(() => client.mutatePlaylistSongs('9000001234', ['midA'], ''), /先登录/)

const failing = new QQClient()
failing.send = async () => ({ code: 0, req: { code: 0, data: { code: 0, code_selfDirs: 2001 } } })
await assert.rejects(() => failing.mutatePlaylistSongs('9000001234', ['midA'], cookie), /个人歌单同步被拒绝/)

// Execute the official site's helper and compare its actual wire contract.
const official = fs.readFileSync('dev/qq-official-common.js', 'utf8')
const marker = official.indexOf('method:o,param:{dirId:e,v_songInfo:r}')
const start = official.lastIndexOf('w=function(e,t,n)', marker)
const end = official.indexOf(',O=function', start)
assert.ok(marker > 0 && start > 0 && end > start)
let reference
const officialWrite = vm.runInNewContext('(' + official.slice(start + 2, end) + ')', {
  a: { j: () => ({ request: async calls => { reference = JSON.parse(JSON.stringify(calls[0])); return [{ code: 0 }] } }) },
  c: { a: { show() {} } }
})
for (const [playlist, directory] of [['9000001234', 7], ['9000000201', 201]]) {
  for (const remove of [false, true]) {
    await client.mutatePlaylistSongs(playlist, ['midA'], cookie, remove)
    assert.equal(await officialWrite(directory, [{ type: 111, id: 123456 }], remove), true)
    assert.deepEqual(requests.at(-1), reference)
  }
}
assert.ok(requests.some(req => req.method === 'get_song_detail' && req.param.song_id === 123456))
for (const response of [{ code: 500 }, { code: 0, req: { code: 1000 } }, { code: 0, req: { code: 0, data: { code: 2001 } } }]) {
  const rejected = new QQClient()
  rejected.userPlaylists = async () => [{ dissid: '9000001234', directoryId: 7 }]
  rejected.track = async () => ({ mid: 'midA', id: 123456, type: 111 })
  rejected.send = async () => response
  await assert.rejects(() => rejected.mutatePlaylistSongs('9000001234', ['midA'], cookie), /500|1000|2001/)
}
const mismatch = new QQClient()
mismatch.userPlaylists = async () => [{ dissid: '9000001234', directoryId: 7 }]
mismatch.track = async () => ({ mid: 'wrong', id: 999, type: 0 })
mismatch.send = async () => { throw new Error('must not write mismatched song') }
await assert.rejects(() => mismatch.mutatePlaylistSongs('9000001234', ['midA'], cookie), /不匹配/)
const main = fs.readFileSync('electron/qq-music.js', 'utf8')
const businessCalls = []
const context = vm.createContext({ qqClient: { mutatePlaylistSongs: async (...args) => { businessCalls.push(args); return { code: 0 } } } })
vm.runInContext(main.slice(main.indexOf('async function operMyLikeSonglist'), main.indexOf('// 触发打开官网登录窗口')), context)
await context.operSonglist('addsong', { dissid: '9000001234', songmids: ['midA'] }, cookie)
await context.operSonglist('delsong', { dissid: '9000001234', songmids: ['midA'] }, cookie)
await context.operMyLikeSonglist(1, 'midA', cookie, '9000000201')
await context.operMyLikeSonglist(2, 'midA', cookie, '9000000201')
assert.deepEqual(businessCalls.map(args => args[3]), [false, true, false, true])
console.log('QQ playlist mutation checks passed: official helper parity; own/favorite lists; add/remove; numeric IDs; types; deduplication; rejection and identity guards; business routes.')
