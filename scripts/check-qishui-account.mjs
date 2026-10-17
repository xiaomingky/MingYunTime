import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { QishuiClient } from '../electron/qishui-client.js'
import { QishuiAccount, qishuiPassportForm, qishuiPhone } from '../electron/qishui-account.js'

let checks = 0
const ok = (condition, label) => { assert.ok(condition, label); checks++ }
const rejects = async (promise, code) => { await assert.rejects(promise, error => error.code === code); checks++ }
const pending = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const phone = { phone: '13800000000', countryCode: '+86' } // Synthetic; requests below never reach the network.
const response = (data = {}, cookies = []) => ({ status: 200, data: { message: 'success', data }, headers: { 'set-cookie': cookies } })
let time = 100000, requests = [], saved = [], mode = 'send', wait, profileWait
const client = new QishuiClient({ now: () => time, save: value => saved.push(value), load: () => 'sessionid=existing',
    request: async () => { throw Error('Unexpected live/unsigned request') },
    pcRequest: async spec => {
        if (profileWait) return profileWait.promise
        return { data: { my_info: { id: '12345', nickname: 'Synthetic music account' } } }
    }, passportRequest: async (id, spec) => {
        requests.push({ id, ...spec })
        if (mode === 'pending') return wait.promise
        if (mode === 'denied') return { ...response({ error_code: 16, description: '该应用无权限' }), data: { message: 'error', data: { error_code: 16 } } }
        if (mode === 'verify') return response({ error_code: 2046, verify_center_decision_conf: 'sensitive-challenge' })
        if (mode === 'malformed') return { status: 200, data: {} }
        if (mode === 'choices') return { ...response(), data: { message: 'error', data: { error_code: 1454, sms_code_key: 'private-key', sub_account: [{ sec_uid: 'private-uid', nickname: '账号甲' }] } } }
        if (mode === 'login') return response({ user_id: 'public-info-does-not-authenticate' }, ['sessionid_ss=verified-session;'])
        if (mode === 'redirect') return spec.method === 'GET' ? response({}, ['sessionid_ss=redirected;']) : response({ redirect_url: 'https://bff-pc.qishui.com/passport/callback' })
        if (mode === 'unsafeRedirect') return response({ redirect_url: 'https://example.com/steal' })
        return response()
    }
})
const account = new QishuiAccount(client)
const form = new URLSearchParams(qishuiPassportForm({ mobile: '+86 ', code: '123456', type: 24, optional: undefined }, ['mobile', 'code', 'type']))
ok(form.get('mobile') === '2e3d3325' && form.get('code') === '343736313033' && form.get('type') === '3731', 'official XOR5 encoding matches known protocol values')
ok(form.get('mix_mode') === '1' && form.get('fixed_mix_mode') === '1' && !form.has('optional'), 'mixed field markers and omitted optional fields')
ok(qishuiPhone('138 0000-0000') === '+86 13800000000' && qishuiPhone('91234567', '+852') === '+852 91234567', 'national number and international prefix match original SDK format')
assert.throws(() => qishuiPhone('not-a-number'), error => error.code === 'invalid_phone'); checks++
const flow = account.create(), args = { ...phone, loginId: flow.loginId }
ok(requests.length === 0 && flow.expiresAt === time + 600000, 'creating a phone flow sends nothing and has a bounded lifetime')
await rejects(account.sendCode({ ...args, phone: '123' }), 'invalid_phone')
await rejects(account.sendCode({ ...args, channel: 'email' }), 'invalid_channel')
await rejects(account.login({ ...args, code: '123' }), 'invalid_code')
ok(requests.length === 0, 'invalid phone, code and channel never send requests')
const sent = await account.sendCode(args), sendRequest = requests.at(-1)
ok(sent.sent && sent.channel === 'sms' && sent.retryAt === time + 60000, 'server acknowledgement returns real send state and retry deadline')
ok(sendRequest.url.endsWith('/passport/web/send_code/') && sendRequest.method === 'POST', 'SMS uses official PC endpoint')
const sendForm = new URLSearchParams(sendRequest.data)
ok(sendForm.get('type') === '3731' && sendForm.get('is6Digits') === '1', 'login type 24 and six digit code are requested')
ok(sendRequest.headers['x-ss-stub'] === createHash('md5').update(sendRequest.data).digest('hex').toUpperCase(), 'exact encoded body has matching passport stub')
ok(!JSON.stringify(sent).includes('sessionid') && !JSON.stringify(sent).includes(phone.phone), 'send result contains no cookie or mobile credentials')
await rejects(account.sendCode({ ...args, channel: 'voice' }), 'send_cooldown')
const second = account.create()
await rejects(account.sendCode({ ...phone, loginId: second.loginId }), 'send_cooldown')
time += 60001
await account.sendCode({ ...args, channel: 'voice' })
ok(requests.at(-1).url.endsWith('/passport/web/send_voice_code/'), 'voice has its own original endpoint and shares cooldown with SMS')
mode = 'login'
const loggedIn = await account.login({ ...args, code: '123456' })
const loginRequest = requests.at(-1), loginForm = new URLSearchParams(loginRequest.data)
ok(loggedIn.status === 'confirmed' && loggedIn.profile.userId === '12345', 'music profile is validated before successful login')
ok(loginRequest.id === sendRequest.id && loginRequest.params.device_id === sendRequest.params.device_id, 'send and login retain isolated jar and device identity')
ok(loginRequest.url.endsWith('/passport/web/sms_login/') && loginForm.get('login_only') === 'true' && loginForm.get('service') === 'https://api.qishui.com', 'SMS login follows official login-only contract without implicit registration')
ok(saved.at(-1).includes('sessionid_ss=verified-session') && client.logins.size === 0, 'verified credentials commit once and all login flows are cleared')
ok(!JSON.stringify(loggedIn).includes('verified-session'), 'session cookie never reaches renderer')

for (const [testMode, code] of [['send', 'invalid_cookie'], ['denied', 'login_method_unavailable'], ['verify', 'verification_required'], ['malformed', 'invalid_response']]) {
    mode = testMode
    const f = account.create(), before = saved.length
    await rejects(account.login({ ...phone, loginId: f.loginId, code: '123456' }), code)
    ok(saved.length === before && client.cookie.includes('verified-session'), testMode + ': failed login preserves existing session')
    client.qrCancel(f.loginId)
}
mode = 'unsafeRedirect'
const unsafe = account.create(), beforeRedirect = requests.length
await rejects(account.login({ ...phone, loginId: unsafe.loginId, code: '123456' }), 'invalid_login_redirect')
ok(requests.length === beforeRedirect + 1, 'untrusted callback is never requested')
mode = 'redirect'
const redirectFlow = account.create()
await account.login({ ...phone, loginId: redirectFlow.loginId, code: '123456' })
ok(client.cookie.includes('redirected') && requests.at(-1).id === redirectFlow.loginId, 'official callback keeps isolated jar and validates final music profile')
mode = 'choices'
let choiceFlow = account.create()
const choices = await account.login({ ...phone, loginId: choiceFlow.loginId, code: '123456' })
ok(choices.status === 'select_account' && choices.accounts[0].nickname === '账号甲' && !/private-key|private-uid/.test(JSON.stringify(choices)), 'multi-account choice hides server tickets and identifiers')
await rejects(account.login({ loginId: choiceFlow.loginId, accountChoice: 10 }), 'invalid_account_choice')
mode = 'login'
await account.login({ loginId: choiceFlow.loginId, accountChoice: 0 })
const choiceForm = new URLSearchParams(requests.at(-1).data)
ok(choiceForm.get('sec_uid') === 'private-uid' && choiceForm.get('sms_code_key') === 'private-key' && choiceForm.get('sms_code_key_not_mix') === '1', 'selected account uses server-issued ticket with original not-mix marker')

mode = 'pending'; wait = pending()
const cancelled = account.create(), beforeCancel = saved.length
let work = account.login({ ...phone, loginId: cancelled.loginId, code: '123456' })
client.qrCancel(cancelled.loginId); wait.resolve(response({}, ['sessionid_ss=late;']))
await rejects(work, 'cancelled')
ok(saved.length === beforeCancel, 'cancelled request cannot persist late credentials')

mode = 'login'; profileWait = pending()
const staleProfile = account.create()
work = account.login({ ...phone, loginId: staleProfile.loginId, code: '123456' })
await new Promise(resolve => setImmediate(resolve))
client.logout(); profileWait.resolve({ data: { my_info: { id: '99999' } } })
await rejects(work, 'cancelled')
ok(client.cookie === '' && saved.at(-1) === '', 'logout during profile validation cannot restore old account')
profileWait = null

const expired = account.create(); time += 600001
await rejects(account.login({ ...phone, loginId: expired.loginId, code: '123456' }), 'login_expired')
ok(!client.logins.has(expired.loginId), 'expired flow releases isolated session')

time += 60001; mode = 'pending'; wait = pending()
const concurrent = account.create()
work = account.sendCode({ ...phone, loginId: concurrent.loginId })
await rejects(account.login({ ...phone, loginId: concurrent.loginId, code: '123456' }), 'login_busy')
client.qrCancel(concurrent.loginId); wait.resolve(response())
await rejects(work, 'cancelled')
const cooldownFlow = account.create()
await rejects(account.sendCode({ ...phone, loginId: cooldownFlow.loginId }), 'send_cooldown')
client.clearLogins()

// Execute the production Vue composable, with only its transport replaced.
const require = createRequire(import.meta.url)
const { effectScope } = require('vue')
const bundled = await build({ entryPoints: ['src/composables/useQishuiPhoneLogin.js'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] })
const module = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports)
const { useQishuiPhoneLogin } = module.exports
const scopes = []
function uiHarness() {
    const scope = effectScope(); scopes.push(scope)
    const calls = [], confirmed = [], handlers = {}
    const invoke = async (name, args) => { calls.push({ name, args }); return handlers[name] ? handlers[name](args) : name === 'phone-create' ? { loginId: 'test-flow' } : {} }
    const ui = scope.run(() => useQishuiPhoneLogin({ invoke, onConfirmed: profile => confirmed.push(profile), now: () => time }))
    ui.phone.value = phone.phone; ui.consent.value = true
    return { ui, scope, calls, confirmed, handlers }
}
try {
    const h = uiHarness()
    h.ui.consent.value = false; await h.ui.send()
    ok(h.calls.length === 0 && h.ui.message.value.includes('协议'), 'UI requires consent before any request')
    h.ui.consent.value = true
    h.handlers['phone-send-code'] = async () => ({ sent: true, retryAt: time + 60000, message: '验证码已发送' })
    await h.ui.send()
    ok(h.ui.seconds.value === 60 && h.ui.message.value === '验证码已发送', 'UI displays server-confirmed send and deadline')
    const callCount = h.calls.length; await h.ui.send('voice')
    ok(h.calls.length === callCount, 'UI voice button cannot evade resend cooldown')
    h.ui.code.value = '123456'; h.handlers['phone-login'] = async () => ({ status: 'confirmed', profile: { userId: '12345' } })
    await h.ui.login()
    ok(h.confirmed.length === 1 && h.ui.code.value === '' && h.ui.phone.value === '' && !h.ui.busy.value && h.ui.seconds.value === 0, 'successful UI login accepts verified profile and clears sensitive fields/timers')

    const c = uiHarness(), late = pending()
    c.handlers['phone-create'] = () => late.promise
    work = c.ui.send(); c.ui.cancel(); late.resolve({ loginId: 'late-created-flow' }); await work
    ok(c.calls.some(call => call.name === 'login-cancel' && call.args.loginId === 'late-created-flow') && !c.calls.some(call => call.name === 'phone-send-code'), 'closing while creating flow releases late context without sending SMS')

    const p = uiHarness(), pendingLogin = pending()
    p.ui.code.value = '123456'; p.handlers['phone-login'] = () => pendingLogin.promise
    work = p.ui.login(); await new Promise(resolve => setImmediate(resolve)); p.ui.cancel()
    pendingLogin.resolve({ status: 'confirmed', profile: { userId: '12345' } }); await work
    ok(p.confirmed.length === 0 && !p.ui.busy.value && !p.ui.code.value, 'late confirmed response after modal close is ignored')

    const v = uiHarness(); v.ui.code.value = '123456'
    v.handlers['phone-login'] = async () => { const error = new Error('extra verification'); error.code = 'verification_required'; throw error }
    await v.ui.login()
    ok(v.ui.needsVerification.value && v.confirmed.length === 0, 'security challenge remains explicit and never marks login success')
    v.handlers['phone-login'] = async () => ({ status: 'select_account', accounts: [{ choice: 0, nickname: '账号甲' }] })
    await v.ui.login()
    ok(v.ui.accounts.value.length === 1 && !v.confirmed.length, 'UI shows multi-account selection before success')
    v.ui.phone.value = '13900000000'
    ok(v.ui.accounts.value.length === 0 && v.ui.code.value === '' && v.calls.some(call => call.name === 'login-cancel'), 'editing mobile cancels previous identity and removes stale account choices')
} finally { scopes.forEach(scope => scope.stop()) }
console.log(`Qishui account checks passed: ${checks} assertions; official SMS/voice contracts, selection, cooldown, cancellation, session validation and production UI state. No real SMS or account writes.`)
