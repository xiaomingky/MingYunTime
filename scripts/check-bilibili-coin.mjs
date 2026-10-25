import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../electron/bilibili-video.js', import.meta.url), 'utf8')
  .replace(/^import .*\r?\n/gm, '')

function load({ cookies = { SESSDATA: 'test-session', bili_jct: 'test-csrf' }, savedAt = Date.now(), code = 0 } = {}) {
  const handlers = new Map(), calls = []
  let reads = 0
  const sandbox = {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: { getPath: () => '/test-user-data' }, path, URL, URLSearchParams,
    fs: { readFileSync: () => { reads++; return JSON.stringify({ cookies, savedAt }) } },
    axios: {
      post: async (url, body, config) => {
        calls.push({ url, body: new URLSearchParams(body), ...config })
        return { status: 200, data: { code, message: 'upstream error' } }
      },
      get: async () => { throw new Error('unexpected GET') }
    }
  }
  vm.runInNewContext(source, sandbox)
  return { calls, reads: () => reads, coin: params => handlers.get('bilibili:video-coin')(null, params),
    like: params => handlers.get('bilibili:video-like')(null, params) }
}

for (const multiply of [1, 2]) {
  const api = load()
  const result = await api.coin({ aid: 12345, multiply, selectLike: 1 })
  assert.equal(result.success, true)
  assert.equal(api.reads(), 1, 'Cookie and CSRF use one login snapshot')
  assert.equal(api.calls.length, 1, 'coin writes are never automatically retried')
  const request = api.calls[0]
  assert.equal(request.url, 'https://api.bilibili.com/x/web-interface/coin/add')
  assert.equal(request.headers.Origin, 'https://www.bilibili.com')
  assert.equal(request.headers.Referer, 'https://www.bilibili.com/video/av12345/')
  assert.equal(request.headers.Cookie, 'SESSDATA=test-session; bili_jct=test-csrf')
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(request.body.get('csrf'), 'test-csrf')
  assert.equal(request.body.get('csrf_token'), 'test-csrf')
  assert.equal(request.body.get('aid'), '12345')
  assert.equal(request.body.get('multiply'), String(multiply))
  assert.equal(request.body.get('select_like'), '1')
  assert.equal(request.body.has('bvid'), false)
}

for (const options of [
  { cookies: {} },
  { cookies: { SESSDATA: 'session-without-csrf' } },
  { savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }
]) {
  const api = load(options)
  const result = await api.coin({ aid: 12345 })
  assert.equal(result.success, false)
  assert.match(result.message, /登录/)
  assert.equal(api.calls.length, 0, 'incomplete or expired login never sends a write')
}

for (const [code, message] of [
  [-101, /登录已失效/], [-111, /登录校验失败/], [-403, /非法访问/],
  [65006, /余额不足/], [34002, /不能重复投币/], [11001, /过于频繁/]
]) {
  const api = load({ code })
  const result = await api.coin({ aid: 12345 })
  assert.equal(result.success, false)
  assert.match(result.message, message)
  assert.equal(api.calls.length, 1, 'failed writes are not retried')
}

const likes = load()
assert.equal((await likes.like({ bvid: 'BV-test' })).success, true)
assert.equal(likes.calls[0].body.get('bvid'), 'BV-test')
assert.equal(likes.calls[0].headers.Referer, 'https://www.bilibili.com/')
console.log('Bilibili coin checks passed: request origin, video referer, matching Cookie/CSRF, 1/2 coins, login validation, API errors, no write retries and shared like requests.')
