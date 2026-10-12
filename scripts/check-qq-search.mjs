import assert from 'node:assert/strict'
import { searchQQWithFallback } from '../electron/qq-search.js'
const unavailable = new Error('primary search failed')
let calls = 0, request
const primary = async () => { throw unavailable }
const get = async (url, config) => {
    calls++; request = { url, ...config }
    return { data: { code: 0, subcode: 0, data: { song: { list: [{ songmid: 'test' }], total: 1 }, album: { list: [{ albumMID: 'album' }], total: 1 } } } }
}
const song = await searchQQWithFallback({ primary, get, key: '晴天', page: 2, limit: 10, cookie: 'test=value' })
assert.equal(song.data.song.list.length, 1)
assert.deepEqual(request.params, { w: '晴天', n: 10, p: 2, t: 0, format: 'json' })
assert.equal(request.headers.Referer, 'https://y.qq.com/')
assert.equal(request.headers.Cookie, 'test=value')
await searchQQWithFallback({ primary, get, key: '专辑', catZhida: 2 })
assert.equal(request.params.t, 8)
const before = calls
const result = { code: 0, data: { song: { list: [] } } }
assert.equal(await searchQQWithFallback({ primary: async () => result, get, key: 'no results' }), result)
assert.equal(calls, before, 'legitimate empty searches do not trigger fallback')
await assert.rejects(searchQQWithFallback({ primary, get, key: '歌单', catZhida: 3 }), error => error === unavailable)
await assert.rejects(searchQQWithFallback({ primary, get: async () => ({ data: { code: 0, subcode: -10001, data: {} } }), key: 'rejected' }), error => error === unavailable)
console.log('QQ search checks passed: primary, public fallback, categories, paging and rejected responses.')
