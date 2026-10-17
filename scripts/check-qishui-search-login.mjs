import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import os from 'node:os'
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
const flow = new QishuiClient({ now: () => now, save: value => { saved = value }, request: async () => { throw Error('Unexpected unsigned QR request') },
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
check(passportCalls.length === 1 && passportCalls[0].params.device_id.length === 16 && passportCalls[0].params.install_id.length === 15, 'QR uses fresh isolated device identity')
check(passportCalls[0].headers['x-tt-passport-verify-portrait'].endsWith('.login'), 'official portrait trace is supplied')
check((await flow.qrCheck(qr.loginId)).status === 'new', 'unscanned signed poll remains anonymous')
const poll = passportCalls.at(-1)
check(poll.params.device_id === passportCalls[0].params.device_id && poll.params.msToken === passportCalls[0].params.msToken, 'create and poll share exact device and msToken')
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
console.log(`Qishui search/login checks passed: ${checks} assertions; grouped search, signed PC discovery, official scan_login QR, cooling and session confirmation.`)
