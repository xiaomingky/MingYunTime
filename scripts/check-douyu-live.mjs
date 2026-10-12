import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import https from 'node:https'
import crypto from 'node:crypto'

const source = fs.readFileSync(new URL('../electron/douyu-live.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace('export async function', 'async function')
function load(request, fetch = async () => { throw new Error('unexpected fallback') }) {
    const sandbox = { axios: { request }, net: { fetch }, https, crypto, URL, URLSearchParams, AbortSignal,
        setTimeout: callback => setTimeout(callback, 0), console: { log() {} } }
    vm.createContext(sandbox)
    vm.runInContext(source + '\nglobalThis.api = { douyuRequest, parseDouyu, douyuSignStream }', sandbox)
    return sandbox.api
}
const tls = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' })
let nodeCalls = 0, fallbackCalls = 0, sent
const recovered = load(async () => { nodeCalls++; throw tls }, async (url, config) => {
    fallbackCalls++; sent = { url, ...config }
    return new Response(JSON.stringify({ error: 0, data: { recovered: true } }))
})
const recoveredResponse = await recovered.douyuRequest({ url: 'https://www.douyu.com/test', params: { rid: '42' }, method: 'POST',
    headers: { Referer: 'https://www.douyu.com/42', 'Content-Type': 'application/x-www-form-urlencoded' }, data: new URLSearchParams({ rate: '0', cdn: 'hs-h5' }) })
assert.equal(recoveredResponse.data.data.recovered, true)
assert.equal(nodeCalls, 1)
assert.equal(fallbackCalls, 1)
assert.equal(new URL(sent.url).searchParams.get('rid'), '42')
assert.equal(sent.body, 'rate=0&cdn=hs-h5')
assert.equal(sent.headers.Referer, 'https://www.douyu.com/42')
assert.equal(sent.signal.aborted, false)
const certificateError = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
const badCert = load(async config => {
    assert.notEqual(config.httpsAgent.options.rejectUnauthorized, false)
    throw certificateError
}, async () => { throw new Error('certificate failure must not use fallback') })
await assert.rejects(badCert.douyuRequest({ url: 'https://www.douyu.com/test' }), error => error === certificateError)
let attempts = 0
const down = load(async () => { attempts++; throw tls }, async () => { throw tls })
await assert.rejects(down.douyuRequest({ url: 'https://www.douyu.com/test' }), /TLS connection/)
assert.equal(attempts, 3)
await assert.rejects(down.douyuRequest({ url: 'https://www.douyu.com/test', signal: AbortSignal.abort() }), error => error.name === 'AbortError')
assert.equal(attempts, 3, 'cancelled calls never start a connection')

const encryption = { rand_str: 'random', key: 'key', enc_time: 2, enc_data: 'signed', is_special: '0' }
function parser({ status = '1', loop = 0, primaryError, primaryFail = false, allFail = false, nonJSON = false } = {}) {
    const calls = []
    const api = load(async config => {
        calls.push(config)
        if (allFail) throw tls
        if (config.url.includes('m.douyu.com')) return { status: 200, data: 'roomInfo":{"rid":12345' }
        if (config.url.includes('/betard/')) return { status: 200, data: { room: { room_id: 67890, room_name: 'test room', show_status: status, videoLoop: loop } } }
        if (config.url.includes('/getEncryption')) return { status: 200, data: { error: 0, data: encryption } }
        assert.ok(config.url.endsWith('/67890'), 'canonical room ID used for stream requests')
        const form = new URLSearchParams(config.data)
        assert.equal(form.get('rid'), '67890')
        assert.ok(form.get('auth'))
        if (nonJSON) return { status: 200, data: '<html>upstream unavailable</html>' }
        if (form.get('cdn') === 'hw-h5' && primaryError) return { status: 200, data: JSON.stringify({ error: primaryError }) }
        if (form.get('cdn') === 'hw-h5' && primaryFail) throw new Error('primary CDN unavailable')
        return { status: 200, data: JSON.stringify({ error: 0, data: { rtmp_url: 'https://hw1a.douyucdn2.cn',
            rtmp_live: `${form.get('cdn')}-${form.get('rate')}.flv`, rtmp_cdn: form.get('cdn'),
            multirates: [{ rate: 0, name: '蓝光' }, { rate: 123, name: '超清' }] } }) }
    })
    const streams = []
    return { calls, streams, run: () => api.parseDouyu('https://m.douyu.com/room/alias', (...args) => streams.push(args)) }
}
const live = parser()
assert.equal((await live.run()).title, 'test room')
assert.ok(live.calls.some(c => c.url.endsWith('/betard/12345')))
assert.ok(live.streams.some(s => s[2].includes('超清')))
assert.ok(live.streams.length >= 3)
assert.ok(live.streams.every(s => s[1] === 'flv' && s[3].isLive === true))
const alternate = parser({ primaryFail: true })
assert.equal((await alternate.run()).title, 'test room')
assert.ok(alternate.streams.some(s => s[0].includes('hs-h5')))
await assert.rejects(parser({ status: '2' }).run(), /未开播/)
await assert.rejects(parser({ loop: '1' }).run(), /录像/)
await assert.rejects(parser({ primaryError: -5 }).run(), /未开播/)
await assert.rejects(parser({ primaryError: 126 }).run(), /版权或地区/)
assert.equal(await parser({ nonJSON: true }).run(), null)
await assert.rejects(parser({ allFail: true }).run(), /房间信息连接失败.*TLS connection/)
assert.throws(() => live && recovered.douyuSignStream({ ...encryption, enc_time: 1e9 }, '1', 1), /密钥无效/)
console.log('Douyu checks passed: TLS fallback, certificate validation, bounded retries/cancellation, canonical rooms, quality rates, backup CDN, live metadata and offline/restricted errors.')
