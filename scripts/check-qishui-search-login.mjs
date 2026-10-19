import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { QishuiClient } from '../electron/qishui-client.js'

let checks = 0
const check = (value, label) => { assert.ok(value, label); checks++ }
const raw = { id: '7079108541549643812', name: '小半', artists: [{ name: '陈粒' }], album: { name: '小梦大半' }, duration: 100000 }
let mode = 'group', captured, pending
const client = new QishuiClient({ request: async () => { throw Error('Unexpected unsigned request') }, pcRequest: async spec => {
    captured = spec
    if (mode === 'pending') return new Promise(resolve => { pending = resolve })
    if (mode === 'error') return { data: { status_code: 1000016, message: 'expired' } }
    if (mode === 'empty') return { data: '' }
    if (mode === 'invalid') return { data: { status_info: {} } }
    if (mode === 'zero') return { data: { result_groups: [] } }
    if (mode === 'legacy') return { data: { tracks: [raw], has_more: true, next_cursor: '40' } }
    return { data: { result_groups: [
        { id: 'playlists', data: [{ entity: { playlist: { id: 'p1' } } }] },
        { id: 'tracks', next_cursor: '20', has_more: true, data: [{ entity: { track: raw } }, { entity: { track: raw } }] }
    ] } }
} })
await assert.rejects(client.search(''), error => error.code === 'invalid_query'); checks++
const first = await client.search(' 陈粒 ')
check(first.scope === 'platform' && first.songs.length === 1 && first.songs[0].id === raw.id, 'official grouped search returns real unique tracks')
check(first.hasMore && first.cursor === '20', 'official group pagination is retained')
check(captured.path === '/luna/pc/search/track' && captured.params.q === '陈粒' && captured.method === 'GET', 'real PC search goes through the signed request provider')
await client.search('小半', first.cursor)
check(captured.params.cursor === '20', 'next page sends exact server cursor')
mode = 'legacy'
check((await client.search('小半')).cursor === '40', 'legacy upstream track shape remains supported')
mode = 'zero'
check((await client.search('无结果')).songs.length === 0, 'valid empty result groups stay empty')
mode = 'error'
await assert.rejects(client.search('陈粒'), error => error.code === '1000016'); checks++
mode = 'empty'
await assert.rejects(client.search('陈粒'), error => error.code === 'upstream_empty_response'); checks++
mode = 'invalid'
await assert.rejects(client.search('陈粒'), error => error.code === 'search_unavailable'); checks++
mode = 'pending'
const stale = client.search('陈粒'); await Promise.resolve(); client.logout()
pending({ data: { tracks: [raw] } })
await assert.rejects(stale, error => error.code === 'cancelled'); checks++

const scanURL = 'https://bff-pc.qishui.com/ucenter_web/app/sdk-next?next_url=https%3A%2F%2Fbff-pc.qishui.com%2Fucenter_web%2Fapp%2Fsdk-next&token=secret-token&uc_sdk=scan-auth'
let now = 0, qrMode = 'new', saved = '', closed = [], passportCalls = [], profileCookie = ''
const identity = { deviceId: '1234567890123456', installId: '123456789012345' }
const flow = new QishuiClient({ identity, now: () => now, save: value => { saved = value }, request: async () => { throw Error('Unexpected unsigned QR request') },
    pcRequest: async spec => { profileCookie = spec.cookie; return { data: { my_info: { id: '123', nickname: 'Test user' } } } },
    passportClose: id => { closed.push(id) }, passportRequest: async (id, spec) => {
        passportCalls.push({ id, ...spec })
        if (spec.url.includes('get_qrcode')) return { data: { message: 'success', data: { token: 'secret-token', qrcode: 'unused-old-image', qrcode_index_url: scanURL, expire_time: 180 } }, headers: { 'set-cookie': ['flow=isolated;'] } }
        const data = qrMode === 'limited' ? { error_code: 7 } : qrMode === 'verify' ? { error_code: 2046 } : { status: qrMode, error_code: 0 }
        return { data: { message: 'success', data }, headers: qrMode === '3' ? { 'set-cookie': ['sessionid_ss=test-session;'] } : {} }
    } })
const qr = await flow.qrCreate()
const officialScan = new URL('https://bff-pc.qishui.com/light/invoke/scan_login')
officialScan.searchParams.set('token', 'secret-token')
officialScan.searchParams.set('os', process.platform === 'darwin' ? 'Mac' : 'Windows')
officialScan.searchParams.set('computer_name', os.hostname())
check(qr.image === await QRCode.toDataURL(officialScan.href.replaceAll('+', '%20'), { width: 320, margin: 2, errorCorrectionLevel: 'M' }), 'QR uses the official PC Qishui App confirmation page, not the internal SDK 404 route')
check(!JSON.stringify(qr).includes('secret-token') && !JSON.stringify(qr).includes('isolated'), 'only opaque flow ID and image reach renderer')
check(passportCalls.length === 1 && passportCalls[0].params.device_id === identity.deviceId && passportCalls[0].params.install_id === identity.installId, 'QR uses the persistent runtime device identity')
check(!Object.hasOwn(passportCalls[0].params, 'msToken'), 'passport leaves msToken to the real security SDK instead of inventing it')
check(passportCalls[0].params.p_zt === '0' && decodeURIComponent(passportCalls[0].params.request_host) === 'https://api.qishui.com', 'passport reports the actual zero-trust SDK state and security page origin')
check(passportCalls[0].headers['x-tt-passport-verify-portrait'].endsWith('.login'), 'official portrait trace is supplied')
check((await flow.qrCheck(qr.loginId)).status === 'new', 'unscanned signed poll remains anonymous')
const poll = passportCalls.at(-1)
check(poll.params.device_id === identity.deviceId && poll.params.install_id === identity.installId && !Object.hasOwn(poll.params, 'msToken'), 'create and poll share the runtime identity without synthetic SDK tokens')
check(/^[0-9A-F]{32}$/.test(poll.headers['x-ss-stub']) && new URLSearchParams(poll.data).get('token') === 'secret-token', 'poll has real token form and uppercase MD5 body stub')
await flow.qrCheck(qr.loginId)
check(passportCalls.at(-1) === poll, 'fast duplicate polls respect 2.5 second minimum')
now += 2600; qrMode = 'limited'
check((await flow.qrCheck(qr.loginId)).status === 'new', 'error 7 keeps flow alive instead of expiring it')
const limitedCount = passportCalls.length; now += 2600; await flow.qrCheck(qr.loginId)
check(passportCalls.length === limitedCount, 'rate limit cools down for five seconds')
now += 2600; qrMode = 'verify'
check((await flow.qrCheck(qr.loginId)).status === 'verification_required', 'additional verification is explicit, never fake login')
now += 2600; qrMode = '3'
check((await flow.qrCheck(qr.loginId)).status === 'confirmed' && saved.includes('sessionid_ss=test-session'), 'numeric confirmed state and secure session cookie validate before persistence')
check(profileCookie.includes('sessionid_ss=test-session'), 'authenticated profile is validated through the signed PC provider')
await Promise.resolve()
check(closed.includes(qr.loginId) && flow.logins.size === 0, 'successful login releases its browser jar')
const nextFlow = flow.beginLogin('phone'), repeatedFlow = flow.beginLogin('qr')
check(nextFlow.deviceId === identity.deviceId && repeatedFlow.installId === identity.installId && nextFlow.id !== repeatedFlow.id && nextFlow.jar !== repeatedFlow.jar, 'different phone and QR attempts retain device identity while separating login grants and cookies')
flow.clearLogins()
const fallbackFirst = client.beginLogin(), fallbackSecond = client.beginLogin('phone')
check(/^\d{16}$/.test(fallbackFirst.deviceId) && /^\d{15}$/.test(fallbackFirst.installId) && fallbackFirst.deviceId === fallbackSecond.deviceId && fallbackFirst.installId === fallbackSecond.installId, 'standalone client generates one device identity per client rather than per attempt')
client.clearLogins()
let discoverPending, discoverSpec
const discoverClient = new QishuiClient({ load:()=> 'sessionid=account',request:async()=>{throw Error('Unsigned discovery is forbidden')},pcRequest:async spec=>{
    discoverSpec=spec
    if(spec.data.cursor==='stale')return new Promise(resolve=>{discoverPending=resolve})
    return {data:{status_info:{},inner_block:[{resources:[{playlist:{id:'123',title:'Recommended'}}]}],has_more:true,next_cursor:'next'}}
} })
const discovery=await discoverClient.discover()
check(discoverSpec.path==='/luna/pc/discover/mix'&&discoverSpec.cookie==='sessionid=account'&&discoverSpec.data.count===20,'authenticated discovery uses signed PC contract with the current account')
check(discovery.playlists.length===1&&discovery.cursor==='next'&&discovery.hasMore,'discovery preserves playlists and pagination')
const staleDiscovery=discoverClient.discover('stale');await Promise.resolve();discoverClient.logout();discoverPending({data:{status_info:{},inner_block:[]}})
await assert.rejects(staleDiscovery,error=>error.code==='cancelled');checks++

// Execute the production modal's QR controller with deterministic transport and
// scheduling. No browser, QR authorisation or account request reaches the network.
const modal = await readFile(new URL('../src/components/LoginModal.vue', import.meta.url), 'utf8')
const qrController = modal.slice(modal.indexOf("let sodaLoginId = ''"), modal.indexOf('async function loginSodaCookie()'))
check(qrController.startsWith("let sodaLoginId = ''"), 'production QR controller is available for lifecycle regression checks')
function uiHarness(handler) {
    const calls = [], accepted = [], timers = new Map(), props = { show: true }, model = {}, messages = [], emitted = []
    for (const name of ['sodaQr', 'sodaMessage', 'sodaBusy']) model[name] = { value: name === 'sodaBusy' ? false : '' }
    let timerId = 0
    const invoke = async (name, args) => { calls.push({ name, args }); return handler(name, args) }
    const schedule = callback => { const id = ++timerId; timers.set(id, callback); return id }
    const unschedule = id => timers.delete(id)
    const controller = new Function('qishuiInvoke', 'props', 'qishuiUserStore', 'messageStore', 'emit', 'setTimeout', 'clearTimeout', 'sodaQr', 'sodaMessage', 'sodaBusy', qrController + '\nreturn { startSodaLogin, stopSodaLogin }')(invoke, props, { acceptProfile: profile => accepted.push(profile) }, { success: value => messages.push(value) }, event => emitted.push(event), schedule, unschedule, model.sodaQr, model.sodaMessage, model.sodaBusy)
    const tick = async () => { check(timers.size === 1, 'only one next poll is scheduled'); const [id, callback] = timers.entries().next().value; timers.delete(id); await callback() }
    return { ...controller, calls, accepted, timers, props, model, messages, emitted, tick }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let statusIndex = 0
const ui = uiHarness(async name => name === 'qr-create' ? { loginId: 'same-flow', image: 'same-qr' } : name === 'qr-check' ? [
    { status: 'verification_required', message: '请完成安全验证' }, { status: 'scanned' }, { status: 'confirmed', profile: { userId: 'verified' } }
][statusIndex++] : {})
await ui.startSodaLogin()
check(ui.model.sodaQr.value === 'same-qr' && ui.model.sodaMessage.value === '请完成安全验证' && !ui.calls.some(call => call.name === 'qr-cancel'), 'security challenge preserves the existing QR and isolated login session')
await ui.tick(); await ui.tick()
check(ui.accepted.length === 1 && ui.emitted[0] === 'close' && ui.timers.size === 0 && ui.calls.filter(call => call.name === 'qr-check').every(call => call.args.loginId === 'same-flow'), 'successful post-verification poll accepts the validated account and releases the original flow')
const inFlight = deferred()
const serial = uiHarness(async name => name === 'qr-create' ? { loginId: 'serial-flow', image: 'qr' } : name === 'qr-check' ? inFlight.promise : {})
const starting = serial.startSodaLogin(); await new Promise(resolve => setImmediate(resolve))
check(serial.timers.size === 0 && serial.calls.filter(call => call.name === 'qr-check').length === 1, 'a pending verification request cannot schedule overlapping polls')
inFlight.resolve({ status: 'verification_required' }); await starting
check(serial.timers.size === 1 && serial.model.sodaMessage.value.includes('完成汽水安全验证'), 'pending request schedules one follow-up only after the response')
serial.stopSodaLogin()
check(serial.timers.size === 0 && serial.calls.some(call => call.name === 'qr-cancel' && call.args.loginId === 'serial-flow'), 'closing during security wait cancels the timer and original flow')
const latePoll = deferred()
const closing = uiHarness(async name => name === 'qr-create' ? { loginId: 'closing-flow', image: 'qr' } : name === 'qr-check' ? latePoll.promise : {})
const waiting = closing.startSodaLogin(); await new Promise(resolve => setImmediate(resolve)); closing.stopSodaLogin()
latePoll.resolve({ status: 'confirmed', profile: { userId: 'late' } }); await waiting
check(closing.accepted.length === 0 && closing.timers.size === 0 && closing.emitted.length === 0, 'a late confirmation after closing cannot accept an account or restart polling')
const verifyError = uiHarness(async name => {
    if (name === 'qr-create') return { loginId: 'retry-flow', image: 'qr' }
    if (name === 'qr-check') throw Object.assign(new Error('验证未完成'), { code: 'verification_required' })
    return {}
})
await verifyError.startSodaLogin()
check(verifyError.timers.size === 1 && !verifyError.calls.some(call => call.name === 'qr-cancel'), 'explicit unfinished-verification errors also preserve the flow for continuation')
verifyError.stopSodaLogin()
console.log(`Qishui search/login checks passed: ${checks} assertions; persistent identity, real browser context, signed PC discovery, QR verification continuation, serialized polling and cancellation.`)
