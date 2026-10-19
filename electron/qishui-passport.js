import { BrowserWindow, session, app, safeStorage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { qishuiChallenge, qishuiVerifyResource, installQishuiVerification } from './qishui-verification.js'

const ORIGIN = 'https://api.qishui.com'
const BOOTSTRAP = ORIGIN + '/__mingyun_passport_sdk__'
const SDK = 'https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.7.0 Chrome/136.0.7103.59 Electron/36.4.0 Safari/537.36'
const SECURITY_COOKIES = new Set(['msToken', 's_v_web_id', 'ttwid', 'odin_tt', '__ac_nonce', '__ac_signature'])
const SECURITY_STORAGE = new Set(['s_v_web_id', 'xmst', 'bdms'])
const HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>汽水音乐安全验证</title><style>body{margin:0;padding:32px;background:#f5f5f7;color:#222;font:15px system-ui}h1{font-size:22px}#qishui-verify-status{line-height:1.8}</style><h1>汽水音乐安全验证</h1><p id="qishui-verify-status">正在准备安全验证…</p>'
const failure = (code, message) => Object.assign(new Error(message), { code })
const qishuiDomain = value => { const host = value.replace(/^\./, ''); return host === 'qishui.com' || host.endsWith('.qishui.com') }
const businessParams = value => {
    if (typeof value === 'string') {
        try { value = JSON.parse(value) } catch { return {} }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

// Each login keeps an independent anonymous jar. Only known device/security state
// survives a flow; authenticated cookies never enter another flow's browser jar.
export class QishuiPassport {
    constructor({ request, identity, verificationTimeout = 180000 }) {
        this.requestSDK = request; this.sessions = new Map(); this.sdkPromise = null
        this.identity = identity || {}; this.verificationTimeout = verificationTimeout
        this.securityFile = path.join(app.getPath('userData'), 'qishui-security.enc')
        this.security = { cookies: [], storage: {} }
        try {
            if (safeStorage.isEncryptionAvailable() && fs.existsSync(this.securityFile)) {
                const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.securityFile)))
                if (saved.identity?.deviceId === this.identity.deviceId && saved.identity?.installId === this.identity.installId) this.security = saved
            }
        } catch {}
    }
    async sdk() {
        if (!this.sdkPromise) this.sdkPromise = this.requestSDK({ url: SDK, method: 'GET', timeout: 15000 })
            .then(response => {
                if (typeof response.data !== 'string' || !response.data.includes('window.bdms')) throw new Error('汽水官方安全组件返回无效')
                return response.data
            }).catch(error => { this.sdkPromise = null; throw error })
        return this.sdkPromise
    }
    async create(id) {
        const isolated = session.fromPartition('qishui-passport-' + randomUUID())
        isolated.setUserAgent(UA)
        isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
        isolated.setPermissionCheckHandler(() => false)
        isolated.protocol.handle('https', request => request.url === BOOTSTRAP
            ? new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
            : isolated.fetch(request, { bypassCustomProtocolHandlers: true }))
        const window = new BrowserWindow({ show: false, width: 900, height: 700,
            webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', (event, url) => { if (url !== BOOTSTRAP) event.preventDefault() })
        const entry = { window, session: isolated, promise: null, verificationBlocked: false, securityRestored: false, rendererDirty: false }
        window.on('close', event => {
            if (entry.cancelVerify) { event.preventDefault(); entry.cancelVerify(failure('verification_cancelled', '已关闭汽水安全验证，请重新操作')); window.hide() }
        })
        this.sessions.set(id, entry)
        entry.promise = (async () => {
            const code = await this.sdk()
            if (this.sessions.get(id) !== entry || window.isDestroyed()) throw new Error('汽水扫码登录已取消')
            for (const cookie of this.security.cookies || []) {
                if (!SECURITY_COOKIES.has(cookie.name) || !qishuiDomain(cookie.domain || '') || (cookie.expirationDate && cookie.expirationDate <= Date.now() / 1000)) continue
                await isolated.cookies.set({ ...cookie, url: 'https://' + cookie.domain.replace(/^\./, '') + (cookie.path || '/') }).catch(() => {})
            }
            await window.loadURL(BOOTSTRAP)
            const storage = Object.fromEntries(Object.entries(this.security.storage || {}).filter(([key, value]) => SECURITY_STORAGE.has(key) && typeof value === 'string'))
            await window.webContents.executeJavaScript(`for(const [key,value] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(key,value)`)
            entry.securityRestored = true
            await this.installRenderer(entry, code)
            return entry
        })().catch(async error => { await this.close(id); throw error })
        return entry.promise
    }
    async installRenderer(entry, code) {
        await entry.window.webContents.executeJavaScript(code)
        await entry.window.webContents.executeJavaScript('window.bdms.init({aid:386088,paths:["/passport"]})')
        await entry.window.webContents.executeJavaScript(`(${installQishuiVerification.toString()})()`)
    }
    async request(id, options) {
        const entry = await (this.sessions.get(id)?.promise || this.create(id))
        let spec = { ...options, params: { ...options.params }, headers: { ...options.headers } }
        let response
        for (let attempt = 0; attempt < 3; attempt++) {
            response = await this.send(id, entry, spec)
            const challenge = qishuiChallenge(response.data)
            if (!challenge) { await this.rememberSecurity(entry).catch(() => {}); return response }
            if (attempt === 2) throw failure('verification_required', '汽水仍要求安全验证，请稍后重试')
            if (entry.verificationBlocked) throw failure('verification_required', '汽水安全验证尚未完成，请刷新二维码后重试')
            try {
                const result = await this.verify(id, entry, challenge, spec)
                spec.params = { ...spec.params, isResend: true, ...(result.fp ? { fp: result.fp, verifyFp: result.fp } : {}) }
                const extra = result.secondary ? { ...result.bizParams, ...(challenge.smsCodeKey ? { sms_code_key: challenge.smsCodeKey } : {}) } : {}
                if (Object.keys(extra).length) {
                    if ((spec.method || 'GET').toUpperCase() === 'GET') Object.assign(spec.params, extra)
                    else {
                        const form = new URLSearchParams(spec.data || '')
                        for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== null) form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
                        spec.data = form.toString()
                        spec.headers['x-ss-stub'] = createHash('md5').update(spec.data).digest('hex').toUpperCase()
                    }
                }
                await this.rememberSecurity(entry).catch(() => {})
            } catch (error) { if (spec.url.includes('/check_qrconnect/')) entry.verificationBlocked = true; throw error }
        }
        return response
    }
    async send(id, entry, { url, method = 'GET', data, params = {}, headers = {} }) {
        const target = new URL(url)
        if (target.protocol !== 'https:' || target.username || target.password || !['api.qishui.com', 'bff-pc.qishui.com', 'auth.zijieapi.com'].includes(target.hostname)) throw new Error('汽水登录请求地址无效')
        for (const [key, value] of Object.entries(params)) target.searchParams.set(key, String(value))
        if (this.sessions.get(id) !== entry || entry.window.isDestroyed()) throw failure('cancelled', '汽水登录已取消')
        // Cookie and user agent headers belong to Chromium's isolated jar.
        const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => !/^(cookie|host|user-agent|origin|referer)$/i.test(name)))
        const cookiesForOrigin = await entry.session.cookies.get({ url: ORIGIN })
        const csrf = cookiesForOrigin.find(cookie => cookie.name === 'passport_csrf_token')
            || cookiesForOrigin.find(cookie => cookie.name === 'passport_csrf_token_default')
        if (csrf) safeHeaders['x-tt-passport-csrf-token'] = csrf.value
        const spec = { url: target.href, method, headers: safeHeaders, body: method === 'GET' ? null : data ?? null }
        let response
        try {
            response = await entry.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
                const spec=${JSON.stringify(spec)}, xhr=new XMLHttpRequest();
                xhr.open(spec.method,spec.url,true);xhr.withCredentials=true;xhr.timeout=15000;
                for(const [name,value] of Object.entries(spec.headers)) xhr.setRequestHeader(name,String(value));
                xhr.onload=()=>resolve({status:xhr.status,text:xhr.responseText});
                xhr.onerror=()=>reject(new Error('汽水登录网络请求失败'));
                xhr.ontimeout=()=>reject(new Error('汽水登录请求超时'));xhr.send(spec.body);
            })`)
        } catch { throw failure(this.sessions.get(id) !== entry ? 'cancelled' : 'network_error', '汽水登录请求失败，请稍后重试') }
        if (this.sessions.get(id) !== entry) throw failure('cancelled', '汽水登录已取消')
        let payload
        try { payload = JSON.parse(response.text) } catch {
            if (target.pathname.startsWith('/passport/web/')) throw new Error('汽水登录接口未返回有效数据')
            payload = null // A confirmed login redirect can return an HTML document.
        }
        const cookies = await entry.session.cookies.get({})
        const allowedCookies = cookies.filter(cookie => /(^|\.)qishui\.com$/.test(cookie.domain.replace(/^\./, '')))
        return { status: response.status, data: payload,
            headers: { 'set-cookie': allowedCookies.map(cookie => `${cookie.name}=${cookie.value};`) } }
    }
    async verify(id, entry, challenge, spec) {
        if (entry.verifying) return entry.verifying
        entry.verifying = this.showVerification(id, entry, challenge, spec)
        try { return await entry.verifying } finally { entry.verifying = null }
    }
    async showVerification(id, entry, challenge, spec) {
        // Expansion config belongs to the verification SDK. Login replay keeps
        // the original server-issued business parameters captured beforehand.
        const originalBizParams = businessParams(challenge.decision.biz_params)
        if (entry.rendererDirty) {
            // Keep the isolated cookie/storage jar, but remove cancelled SDKs,
            // pending scripts and UI before another phone-login challenge.
            const code = await this.sdk()
            if (this.sessions.get(id) !== entry || entry.window.isDestroyed()) throw failure('cancelled', '汽水登录已取消')
            await entry.window.loadURL(BOOTSTRAP)
            await this.installRenderer(entry, code)
            entry.rendererDirty = false
        }
        const generalParams = Object.fromEntries(['device_id', 'install_id', 'did', 'iid', 'device_platform', 'version_code'].map(key => [key, spec.params?.[key]]).filter(([, value]) => value !== undefined))
        const portrait = spec.headers?.['x-tt-passport-verify-portrait'] || ''
        if (challenge.kind === 'secondary' && challenge.decision.verify_from === 'verify_center') {
            const values = { aid: 386088, ...challenge.decision, ...generalParams }
            delete values.is_login
            const body = new URLSearchParams()
            for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
            const dataToSend = body.toString()
            const result = await this.send(id, entry, { url: ORIGIN + '/passport/safe/pack_verify_ways_data/', method: 'POST', params: { aid: 386088 }, data: dataToSend, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-tt-passport-verify-portrait': portrait, 'x-ss-stub': createHash('md5').update(dataToSend).digest('hex').toUpperCase() } })
            const data = result.data?.data
            if (result.status !== 200 || !data || Number(data.error_code || 0) !== 0) throw failure('verification_required', '汽水安全验证方式获取失败，请重试')
            challenge = { ...challenge, decision: { ...challenge.decision, ...data } }
        }
        let resource
        if (challenge.kind === 'secondary') {
            const target = new URL(qishuiVerifyResource(challenge.decision.url))
            let event = challenge.decision.event_params || {}
            if (typeof event === 'string') { try { event = JSON.parse(event) } catch { event = {} } }
            target.searchParams.set('aid', '386088')
            target.searchParams.set('verify_reason', String(event?.verify_reason || ''))
            target.searchParams.set('verify_scene', String(event?.verify_scene || ''))
            resource = target.href
        }
        entry.window.show(); entry.window.focus()
        let timer
        const cancelled = new Promise((_resolve, reject) => {
            entry.cancelVerify = reject
            timer = setTimeout(() => reject(failure('verification_timeout', '汽水安全验证已超时，请重新操作')), this.verificationTimeout)
        })
        try {
            const args = { challenge, identity: { deviceId: String(spec.params?.did || this.identity.deviceId || '0'), installId: String(spec.params?.iid || this.identity.installId || '0') }, resource, generalParams, portrait }
            const execution = entry.window.webContents.executeJavaScript(`window.__qishuiVerify(${JSON.stringify(args)})`, true)
            const result = await Promise.race([execution, cancelled])
            if (this.sessions.get(id) !== entry) throw failure('cancelled', '汽水登录已取消')
            if (result?.ok !== true) throw failure(result?.cancelled ? 'verification_cancelled' : 'verification_required', result?.cancelled ? '汽水安全验证已取消，请重新操作' : '汽水安全验证未完成，请重试')
            return { ...result, secondary: challenge.kind === 'secondary' || result.secondary, bizParams: originalBizParams }
        } catch (error) {
            entry.rendererDirty = true
            throw error
        } finally {
            clearTimeout(timer); entry.cancelVerify = null
            if (!entry.window.isDestroyed()) {
                entry.window.hide()
                await entry.window.webContents.executeJavaScript('window.__qishuiCancelVerify?.()').catch(() => {})
            }
        }
    }
    async rememberSecurity(entry) {
        // An early cancellation or SDK download failure has no restored state
        // to save. Never replace the last known device snapshot with that jar.
        if (!entry.securityRestored) return
        const cookies = (await entry.session.cookies.get({})).filter(cookie => SECURITY_COOKIES.has(cookie.name) && qishuiDomain(cookie.domain))
            .map(({ name, value, domain, path, secure, httpOnly, sameSite, expirationDate }) => ({ name, value, domain, path, secure, httpOnly, sameSite, ...(expirationDate ? { expirationDate } : {}) }))
        let storage = {}
        if (!entry.window.isDestroyed()) storage = await entry.window.webContents.executeJavaScript(`Object.fromEntries(${JSON.stringify([...SECURITY_STORAGE])}.map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>typeof value==='string'))`).catch(() => ({}))
        this.security = { identity: this.identity, cookies, storage }
        if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(this.securityFile, safeStorage.encryptString(JSON.stringify(this.security)))
    }
    async close(id) {
        const entry = this.sessions.get(id)
        this.sessions.delete(id)
        if (!entry) return
        entry.cancelVerify?.(failure('cancelled', '汽水登录已取消'))
        await this.rememberSecurity(entry).catch(() => {})
        if (!entry.window.isDestroyed()) entry.window.destroy()
        await entry.session.clearStorageData().catch(() => {})
        entry.session.protocol.unhandle('https')
    }
    closeAll() { return Promise.all([...this.sessions.keys()].map(id => this.close(id))) }
}
