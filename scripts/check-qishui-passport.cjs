// Run: electron scripts/check-qishui-passport.cjs
// Offline integration: real sandboxed Chromium, production Passport, fake servers.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-qishui-passport-'))
app.setPath('userData', path.join(testRoot, 'profile'))
app.on('window-all-closed', () => {})
const hosts = [], results = [], fixtures = []
const origin = 'https://api.qishui.com'
const identity = { deviceId: '1234567890123456', installId: '123456789012345' }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const syntheticSDK = `window.bdms={init(){}}; window.ucSecondVerifyReact={};window.ucSecondVerifyReactDom={}; window.__test={renders:0,loads:[]};`
const emptySecondarySDK = `window.bdms={init(){}}; window.__test={renders:0,loads:[]};`
const officialUMD = `window.__test.loads.push({kind:'umd',portrait:window.$$account_verify_portrait_id});window.ucSecondVerifyReact={};window.ucSecondVerifyReactDom={};`
const captchaSDK = `window.verifySDK={initVerifyOptions:async options=>{window.__test.options=options},autoRender:options=>{window.__test.renders++;window.__test.render=options}};`
const secondarySDK = `window.__test.loads.push({kind:'decision',portrait:window.$$account_verify_portrait_id,dependencies:!!(window.ucSecondVerifyReact&&window.ucSecondVerifyReactDom)});window.ucWebSecondVerify=options=>{window.__test.renders++;window.__test.secondary=options};`
const spec = (endpoint = 'send_code', extra = {}) => ({ url: origin + '/passport/web/' + endpoint + '/', method: 'POST', params: { aid: 386088, device_id: identity.deviceId, install_id: identity.installId, did: identity.deviceId, iid: identity.installId, device_platform: 'PC', version_code: '3.7.0' }, data: 'mobile=synthetic&type=24', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-tt-passport-verify-portrait': 'synthetic.login', 'x-ss-stub': 'ORIGINAL' }, ...extra })
const success = { message: 'success', data: { error_code: 0, accepted: true } }
const captcha = { message: 'error', data: { error_code: 1105, verify_center_decision_conf: JSON.stringify({ mode: 'slide', verify_ticket: 'synthetic-ticket' }) } }
const secondary = { message: 'error', data: { error_code: 2046, url: 'https://static.qishui.com/secondary.js', biz_params: { verify_ticket: 'server-issued', flag: 1 }, sms_code_key: 'server-sms-key' } }
const evaluate = (entry, code) => entry.window.webContents.executeJavaScript(code, true)
const observe = promise => promise.then(value => ({ value }), error => ({ error }))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

async function until(test, label) {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) { if (await test()) return; await delay(15) }
    throw Error('Timed out: ' + label)
}
function checked(condition, label) { assert.ok(condition, label); results.push(label) }

app.whenReady().then(async () => {
    const { QishuiPassport } = await import('../electron/qishui-passport.js')
    const { qishuiVerifyResource } = await import('../electron/qishui-verification.js')
    for (const unsafe of [
        'https://qishui.com.attacker.test/verify.js', 'https://evilqishui.com/verify.js',
        'https://yhgfb-cn-static.com.attacker.test/verify.js', 'http://api.qishui.com/verify.js',
        'https://user:pass@api.qishui.com/verify.js', 'https://api.qishui.com:444/verify.js',
        { host: 'api.qishui.com:444', path: '/verify.js' },
    ]) { assert.throws(() => qishuiVerifyResource(unsafe), /组件地址无效/); results.push('unsafe verification URL rejected: ' + (typeof unsafe === 'string' ? unsafe : JSON.stringify(unsafe))) }
    checked(qishuiVerifyResource({ host: 'lf-ucenter-web.yhgfb-cn-static.com', path: 'official.js' }) === 'https://lf-ucenter-web.yhgfb-cn-static.com/official.js', 'official secondary resource object resolves only within allowed HTTPS hosts')
    function harness(route, timeout = 4000, secondaryGlobals = true) {
        const records = [], unexpected = [], resources = [], host = new QishuiPassport({ identity, verificationTimeout: timeout, request: async () => ({ data: secondaryGlobals ? syntheticSDK : emptySecondarySDK }) })
        // Every host in this test starts from an independent in-memory snapshot.
        host.security = { cookies: [], storage: {} }
        host.securityFile = path.join(testRoot, 'security-' + hosts.length + '.enc')
        const create = host.create.bind(host)
        host.create = async id => {
            const creating = create(id), entry = host.sessions.get(id)
            entry.window.show = () => {}; entry.window.focus = () => {}
            entry.session.protocol.unhandle('https')
            entry.session.protocol.handle('https', async request => {
                const url = new URL(request.url)
                resources.push(url)
                if (url.pathname === '/__mingyun_passport_sdk__') return new Response('<!doctype html><meta charset="utf-8"><p id="qishui-verify-status"></p>', { headers: { 'Content-Type': 'text/html' } })
                if (url.pathname.includes('/verifycenter/')) return new Response(captchaSDK, { headers: { 'Content-Type': 'application/javascript' } })
                if (url.hostname === 'lf-ucenter-web.yhgfb-cn-static.com' && url.pathname.endsWith('/uc-account-second-verification-web/1.0.16/dist/index.umd.production.js')) return new Response(officialUMD, { headers: { 'Content-Type': 'application/javascript' } })
                if (url.hostname === 'static.qishui.com' && url.pathname === '/secondary.js') return new Response(secondarySDK, { headers: { 'Content-Type': 'application/javascript' } })
                if (url.hostname === 'api.qishui.com' && url.pathname.startsWith('/passport/')) {
                    const record = { url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() }; records.push(record)
                    return new Response(JSON.stringify(await route(record, records)), { headers: { 'Content-Type': 'application/json' } })
                }
                unexpected.push(request.url); return new Response('Offline fixture blocks all other resources', { status: 503 })
            })
            return creating
        }
        hosts.push(host)
        const fixture = { host, records, unexpected, resources }; fixtures.push(fixture); return fixture
    }

    const slider = harness((_request, rows) => rows.length === 1 ? captcha : success)
    const sliderWork = observe(slider.host.request('slider', spec())), sliderEntry = slider.host.sessions.get('slider')
    await until(() => evaluate(sliderEntry, 'window.__test?.renders === 1'), 'slider renders')
    checked(slider.records.length === 1, 'captcha does not replay before official success callback')
    const sliderConfig = await evaluate(sliderEntry, 'window.__test.options.commonOptions')
    checked(sliderConfig.did === identity.deviceId && sliderConfig.iid === identity.installId && sliderConfig.aid === 386088, 'verification renderer receives the exact persistent device identity')
    await evaluate(sliderEntry, "localStorage.setItem('s_v_web_id','verified-fingerprint');window.__test.render.captchaOptions.successCb()")
    const sliderResult = await sliderWork
    assert.ifError(sliderResult.error)
    const retry = slider.records[1]
    checked(sliderResult.value.data.data.accepted && slider.records.length === 2 && retry.url.searchParams.get('isResend') === 'true' && retry.url.searchParams.get('fp') === 'verified-fingerprint' && retry.url.searchParams.get('verifyFp') === 'verified-fingerprint', 'successful captcha retries original request with SDK fingerprint and resend markers')
    checked(retry.body === slider.records[0].body, 'captcha preserves the original encoded SMS request body')
    await slider.host.closeAll()

    const second = harness((_request, rows) => rows.length === 1 ? secondary : success)
    const secondWork = observe(second.host.request('secondary', spec('sms_login'))), secondEntry = second.host.sessions.get('secondary')
    await until(() => evaluate(secondEntry, 'window.__test?.renders === 1'), 'secondary verification renders')
    checked(second.records.length === 1, 'secondary verification does not replay before verified completion')
    const secondaryConfig = await evaluate(secondEntry, '({portrait:window.__test.secondary.verify_portrait_id,did:window.__test.secondary.generalParams.did})')
    checked(secondaryConfig.portrait === 'synthetic.login' && secondaryConfig.did === identity.deviceId, 'secondary verification keeps passport portrait and request device context')
    await evaluate(secondEntry, 'window.__test.secondary.verifyFinishCallback({status:true})')
    const secondResult = await secondWork
    assert.ifError(secondResult.error)
    const secondRetry = second.records[1], secondForm = new URLSearchParams(secondRetry.body)
    checked(secondResult.value.data.data.accepted && secondForm.get('verify_ticket') === 'server-issued' && secondForm.get('flag') === '1' && secondForm.get('sms_code_key') === 'server-sms-key', 'verified secondary flow merges only server-provided business and SMS ticket fields')
    checked(secondRetry.headers['x-ss-stub'] === createHash('md5').update(secondRetry.body).digest('hex').toUpperCase() && secondRetry.headers['x-ss-stub'] !== 'ORIGINAL', 'secondary replay recalculates uppercase body MD5 after adding business fields')
    await second.host.closeAll()

    const loading = harness((_request, rows) => rows.length === 1 ? { message: 'error', data: { ...secondary.data, event_params: JSON.stringify({ verify_reason: 'synthetic reason', verify_scene: 'login' }) } } : success, 4000, false)
    const loadingWork = observe(loading.host.request('loading', spec('sms_login'))), loadingEntry = loading.host.sessions.get('loading')
    await until(() => evaluate(loadingEntry, 'window.__test?.renders === 1'), 'official UMD dependencies and decision script load')
    const loaded = await evaluate(loadingEntry, 'window.__test.loads')
    checked(loaded.length === 2 && loaded[0].kind === 'umd' && loaded[1].kind === 'decision' && loaded[1].dependencies, 'official UMD initializes secondary React dependencies before the decision script executes')
    checked(loaded.every(item => item.portrait === 'synthetic.login'), 'passport portrait is installed before both dependency and decision scripts execute')
    const resourceURL = loading.resources.find(url => url.hostname === 'static.qishui.com')
    checked(resourceURL.searchParams.get('aid') === '386088' && resourceURL.searchParams.get('verify_reason') === 'synthetic reason' && resourceURL.searchParams.get('verify_scene') === 'login', 'secondary decision resource carries official aid and decoded event reason and scene')
    checked(loading.records.length === 1, 'loading official UMD dependencies does not authorize premature login replay')
    await evaluate(loadingEntry, 'window.__test.secondary.verifyFinishCallback({status:true})')
    const loadingResult = await loadingWork
    assert.ifError(loadingResult.error)
    checked(loadingResult.value.data.data.accepted && loading.records.length === 2, 'secondary verification loaded through official UMD continues original login only after success')
    await loading.host.closeAll()

    const failedSecond = harness(() => secondary)
    const failedWork = observe(failedSecond.host.request('secondary-failed', spec('sms_login'))), failedEntry = failedSecond.host.sessions.get('secondary-failed')
    await until(() => evaluate(failedEntry, 'window.__test?.renders === 1'), 'secondary rejection renders')
    await evaluate(failedEntry, 'window.__test.secondary.verifyFinishCallback({status:false})')
    const failedResult = await failedWork
    checked(failedResult.error?.code === 'verification_required' && failedSecond.records.length === 1, 'secondary failure callback cannot authorize a replay')
    await failedSecond.host.closeAll()

    const packed = harness(request => {
        if (request.url.pathname.includes('/pack_verify_ways_data/')) return { message: 'success', data: { error_code: 0, url: secondary.data.url, biz_params: { expanded_ticket: 'B', shared: 'expanded' } } }
        if (request.url.searchParams.get('isResend') === 'true') return success
        return { message: 'error', data: { ...secondary.data, verify_from: 'verify_center', is_login: true, biz_params: { original_ticket: 'A', shared: 'original' } } }
    })
    const packedWork = observe(packed.host.request('packed', spec('sms_login'))), packedEntry = packed.host.sessions.get('packed')
    await until(() => evaluate(packedEntry, 'window.__test?.renders === 1'), 'expanded secondary challenge renders')
    const packRequest = packed.records[1], packBody = new URLSearchParams(packRequest.body)
    checked(packRequest.url.pathname === '/passport/safe/pack_verify_ways_data/' && packBody.get('did') === identity.deviceId && !packBody.has('is_login'), 'verify_center challenge expands with original context and omits is_login')
    checked(packed.records.length === 2, 'packing a challenge does not prematurely replay SMS login')
    checked(await evaluate(packedEntry, "window.__test.secondary.biz_params.expanded_ticket === 'B' && window.__test.secondary.biz_params.shared === 'expanded'"), 'expanded verification business fields are supplied to the verification SDK')
    await evaluate(packedEntry, 'window.__test.secondary.verifyFinishCallback({status:true})')
    const packedResult = await packedWork
    assert.ifError(packedResult.error)
    const originalForm = new URLSearchParams(packed.records[2].body)
    checked(originalForm.get('original_ticket') === 'A' && originalForm.get('shared') === 'original' && !originalForm.has('expanded_ticket'), 'secondary login replay retains original business parameters without replacement or merging by expansion data')
    await packed.host.closeAll()

    const jsonBiz = harness(request => request.url.searchParams.get('isResend') === 'true' ? success : { message: 'error', data: { ...secondary.data, biz_params: JSON.stringify({ original_ticket: 'JSON-A', shared: 'original', nested: { proof: 'synthetic' } }) } })
    const jsonWork = observe(jsonBiz.host.request('json-biz', spec('sms_login'))), jsonEntry = jsonBiz.host.sessions.get('json-biz')
    await until(() => evaluate(jsonEntry, 'window.__test?.renders === 1'), 'JSON business parameters verification renders')
    await evaluate(jsonEntry, 'window.__test.secondary.verifyFinishCallback({status:true})')
    const jsonResult = await jsonWork
    assert.ifError(jsonResult.error)
    const jsonForm = new URLSearchParams(jsonBiz.records[1].body)
    checked(jsonForm.get('original_ticket') === 'JSON-A' && jsonForm.get('shared') === 'original' && jsonForm.get('nested') === JSON.stringify({ proof: 'synthetic' }) && !jsonForm.has('0'), 'JSON-string business parameters decode as an object and retain original values during replay')
    await jsonBiz.host.closeAll()

    const cancelled = harness(() => captcha)
    const cancelledWork = observe(cancelled.host.request('cancelled', spec('check_qrconnect'))), cancelledEntry = cancelled.host.sessions.get('cancelled')
    await until(() => evaluate(cancelledEntry, 'window.__test?.renders === 1'), 'cancelled QR verification renders')
    cancelledEntry.window.close()
    const cancelResult = await cancelledWork
    checked(cancelResult.error?.code === 'verification_cancelled' && cancelled.records.length === 1 && !cancelledEntry.window.isDestroyed(), 'closing security window cancels verification without replay or destroying the QR browser session')
    const repeatResult = await observe(cancelled.host.request('cancelled', spec('check_qrconnect')))
    checked(repeatResult.error?.code === 'verification_required' && await evaluate(cancelledEntry, 'window.__test.renders') === 1, 'cancelled QR challenge does not reopen the verification window on subsequent polls')
    await cancelled.host.closeAll()

    const renderer = harness(() => success)
    const rendererEntry = await renderer.host.create('renderer')
    await evaluate(rendererEntry, `window.__heldScripts=[];window.__originalAppend=document.head.appendChild.bind(document.head);document.head.appendChild=script=>{if(script.tagName==='SCRIPT'){window.__heldScripts.push({script,onerror:script.onerror,onload:script.onload});return script}return window.__originalAppend(script)};window.__verifyArgs={challenge:{kind:'captcha',decision:{mode:'slide'}},identity:${JSON.stringify(identity)},generalParams:{},portrait:'renderer.login'};window.__cancelledDuringLoad=window.__qishuiVerify(window.__verifyArgs);void 0`)
    const immediate = await evaluate(rendererEntry, `(async()=>{window.__qishuiCancelVerify();return Promise.race([window.__cancelledDuringLoad,new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),200))])})()`)
    checked(immediate.cancelled === true && immediate.timeout !== true, 'cancelling while the verification component loads immediately settles its returned promise')
    const loadingState = await evaluate(rendererEntry, `window.__activeResult=null;window.__activeVerify=window.__qishuiVerify(window.__verifyArgs);window.__activeVerify.then(value=>{window.__activeResult=value});window.__newStatus=document.getElementById('qishui-verify-status').textContent;window.__heldScripts[0].onerror();new Promise(resolve=>setTimeout(()=>resolve({status:document.getElementById('qishui-verify-status').textContent,expected:window.__newStatus,result:window.__activeResult,held:window.__heldScripts.length}),30))`)
    checked(loadingState.status === loadingState.expected && loadingState.result === null && loadingState.held === 2, 'late error from a cancelled script cannot change new challenge status or complete the new challenge')
    await evaluate(rendererEntry, `window.verifySDK={initVerifyOptions:async()=>{},autoRender:options=>{window.__rendererRender=options}};window.__heldScripts[1].onload()`)
    await until(() => evaluate(rendererEntry, '!!window.__rendererRender'), 'second renderer challenge initialized')
    await evaluate(rendererEntry, 'window.__oldSdkCallbacks=window.__rendererRender;window.__qishuiCancelVerify()')
    await evaluate(rendererEntry, `window.__latestResult=null;window.__latestVerify=window.__qishuiVerify(window.__verifyArgs);window.__latestVerify.then(value=>{window.__latestResult=value});void 0`)
    await delay(20)
    const callbackState = await evaluate(rendererEntry, `window.__latestStatus=document.getElementById('qishui-verify-status').textContent;window.__oldSdkCallbacks.captchaOptions.successCb();window.__oldSdkCallbacks.captchaOptions.closeCb();new Promise(resolve=>setTimeout(()=>resolve({status:document.getElementById('qishui-verify-status').textContent,expected:window.__latestStatus,result:window.__latestResult}),25))`)
    checked(callbackState.status === callbackState.expected && callbackState.result === null, 'late success and close SDK callbacks from an old attempt cannot finish or alter a new attempt')
    await evaluate(rendererEntry, 'window.__rendererRender.captchaOptions.successCb()')
    checked((await evaluate(rendererEntry, 'window.__latestVerify')).ok === true, 'only the current attempt callback settles the active verification')
    await renderer.host.closeAll()

    const phoneRetry = harness(request => request.url.searchParams.get('isResend') === 'true' ? success : captcha)
    const firstPhone = observe(phoneRetry.host.request('phone-retry', spec())), phoneEntry = phoneRetry.host.sessions.get('phone-retry')
    await until(() => evaluate(phoneEntry, 'window.__test?.renders === 1'), 'phone challenge before cancel')
    await phoneEntry.session.cookies.set({ url: origin, name: 'msToken', value: 'kept-during-reset', secure: true })
    await evaluate(phoneEntry, "localStorage.setItem('s_v_web_id','kept-storage');window.__cancelledSdkMarker=true")
    phoneEntry.window.close()
    checked((await firstPhone).error?.code === 'verification_cancelled' && phoneEntry.rendererDirty, 'cancelled phone verification marks the renderer for a reset before another challenge')
    const bootstrapBefore = phoneRetry.resources.filter(url => url.pathname === '/__mingyun_passport_sdk__').length
    const secondPhone = observe(phoneRetry.host.request('phone-retry', spec()))
    await until(() => evaluate(phoneEntry, 'window.__test?.renders === 1 && window.__cancelledSdkMarker === undefined'), 'fresh renderer after phone retry')
    const resetCookies = await phoneEntry.session.cookies.get({}), resetStorage = await evaluate(phoneEntry, "localStorage.getItem('s_v_web_id')")
    checked(phoneRetry.resources.filter(url => url.pathname === '/__mingyun_passport_sdk__').length === bootstrapBefore + 1 && !phoneEntry.rendererDirty, 'phone retry reloads the bootstrap page and installs clean verification globals')
    checked(resetCookies.some(cookie => cookie.name === 'msToken' && cookie.value === 'kept-during-reset') && resetStorage === 'kept-storage', 'phone verification renderer reset preserves its existing cookie and storage jar')
    await evaluate(phoneEntry, 'window.__test.render.captchaOptions.successCb()')
    const phoneResult = await secondPhone
    checked(!phoneResult.error && phoneResult.value.data.data.accepted, 'a phone attempt after cancelling verification can complete with the new renderer')
    await phoneRetry.host.closeAll()

    const abandoned = harness(() => captcha)
    const abandonedWork = observe(abandoned.host.request('abandoned', spec('check_qrconnect'))), abandonedEntry = abandoned.host.sessions.get('abandoned')
    await until(() => evaluate(abandonedEntry, 'window.__test?.renders === 1'), 'abandoned login verification renders')
    await abandoned.host.close('abandoned')
    const abandonedResult = await abandonedWork
    checked(abandonedResult.error?.code === 'cancelled' && abandoned.records.length === 1 && abandoned.host.sessions.size === 0 && abandonedEntry.window.isDestroyed(), 'cancelling the login grant rejects outstanding verification and destroys its jar without replay')

    const bounded = harness(() => captcha)
    const boundedWork = observe(bounded.host.request('bounded', spec())), boundedEntry = bounded.host.sessions.get('bounded')
    for (const count of [1, 2]) {
        await until(() => evaluate(boundedEntry, 'window.__test?.renders === ' + count), 'bounded verification render ' + count)
        await evaluate(boundedEntry, 'window.__test.render.captchaOptions.successCb()')
    }
    const boundedResult = await boundedWork
    checked(boundedResult.error?.code === 'verification_required' && bounded.records.length === 3 && await evaluate(boundedEntry, 'window.__test.renders') === 2, 'repeated server challenges stop after two verification attempts and three sends')
    await bounded.host.closeAll()

    const timed = harness(() => captcha, 150)
    const timedWork = observe(timed.host.request('timed', spec())), timedEntry = timed.host.sessions.get('timed')
    const timedResult = await timedWork
    checked(timedResult.error?.code === 'verification_timeout' && timed.records.length === 1, 'verification deadline fails without replaying the original request')
    checked(await evaluate(timedEntry, 'window.__qishuiCancelVerify === null'), 'timeout settles and clears the pending renderer verification callback')
    await timed.host.closeAll()

    const reuse = harness(() => success)
    const firstEntry = await reuse.host.create('state-one')
    await firstEntry.session.cookies.set({ url: origin, name: 'msToken', value: 'security-cookie', secure: true })
    await firstEntry.session.cookies.set({ url: origin, name: 'sessionid', value: 'account-cookie', secure: true })
    await firstEntry.session.cookies.set({ url: origin, name: 'unrelated', value: 'other-cookie', secure: true })
    await evaluate(firstEntry, "localStorage.setItem('s_v_web_id','security-storage');localStorage.setItem('sessionid','account-storage');localStorage.setItem('custom','other-storage')")
    await reuse.host.close('state-one')
    const nextEntry = await reuse.host.create('state-two')
    const cookies = await nextEntry.session.cookies.get({}), storage = await evaluate(nextEntry, 'Object.fromEntries(Object.entries(localStorage))')
    checked(cookies.some(cookie => cookie.name === 'msToken' && cookie.value === 'security-cookie') && !cookies.some(cookie => ['sessionid', 'unrelated'].includes(cookie.name)), 'new login jar reuses security cookie only and never an authenticated session or arbitrary cookie')
    checked(storage.s_v_web_id === 'security-storage' && !('sessionid' in storage) && !('custom' in storage), 'new browser flow reuses approved device storage only and never account or arbitrary localStorage')
    checked(firstEntry.session !== nextEntry.session && firstEntry.window.isDestroyed(), 'each login uses its own browser session and closed flow window is destroyed')
    await reuse.host.closeAll()

    checked(safeStorage.isEncryptionAvailable(), 'isolated Windows test supports encrypting the saved security snapshot')
    for (const initialization of ['cancelled', 'failed']) {
        const sdkPending = deferred(), early = new QishuiPassport({ identity, request: () => sdkPending.promise })
        hosts.push(early)
        const snapshot = { identity, cookies: [{ name: 'msToken', value: 'saved-security', domain: 'api.qishui.com', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction' }], storage: { s_v_web_id: 'saved-device-fp' } }
        early.security = structuredClone(snapshot)
        early.securityFile = path.join(testRoot, 'early-' + initialization + '.enc')
        const originalBytes = safeStorage.encryptString(JSON.stringify(snapshot)); fs.writeFileSync(early.securityFile, originalBytes)
        const creating = observe(early.create('early')), earlyEntry = early.sessions.get('early')
        earlyEntry.window.show = () => {}; earlyEntry.window.focus = () => {}
        checked(!earlyEntry.securityRestored, initialization + ': pending SDK has not restored any security state')
        if (initialization === 'cancelled') {
            await early.close('early'); sdkPending.resolve({ data: syntheticSDK })
        } else sdkPending.reject(Error('Synthetic SDK download failure'))
        const earlyResult = await creating
        checked(!!earlyResult.error && early.sessions.size === 0 && earlyEntry.window.isDestroyed(), initialization + ': early login initialization rejects and destroys its window')
        checked(JSON.stringify(early.security) === JSON.stringify(snapshot) && fs.readFileSync(early.securityFile).equals(originalBytes), initialization + ': early empty jar cannot replace the previous security snapshot or encrypted file')
    }
    checked(fixtures.every(fixture => fixture.unexpected.length === 0), 'all renderer network requests stay within explicitly mocked offline resources')
    checked(hosts.every(host => host.sessions.size === 0), 'all test login sessions release their windows and jars')
    console.log(JSON.stringify({ success: true, assertions: results.length, checks: results, network: 'All HTTPS responses mocked; no SMS, account login or external requests.' }, null, 2))
}).catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(async () => {
    await Promise.all(hosts.map(host => host.closeAll().catch(() => {})))
    app.exit(process.exitCode || 0)
})
