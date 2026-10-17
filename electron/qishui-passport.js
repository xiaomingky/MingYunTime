import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'

const ORIGIN = 'https://api.qishui.com'
const BOOTSTRAP = ORIGIN + '/__mingyun_passport_sdk__'
const SDK = 'https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.7.0 Chrome/136.0.7103.59 Electron/36.4.0 Safari/537.36'

// An independent, temporary browser jar per login. This never uses the application's
// normal renderer session or the user's Chrome profile.
export class QishuiPassport {
    constructor({ request }) { this.requestSDK = request; this.sessions = new Map(); this.sdkPromise = null }
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
            ? new Response('<!doctype html><meta charset="utf-8"><title>汽水登录验证</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
            : isolated.fetch(request, { bypassCustomProtocolHandlers: true }))
        const window = new BrowserWindow({ show: false, width: 900, height: 700,
            webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', (event, url) => { if (url !== BOOTSTRAP) event.preventDefault() })
        const entry = { window, session: isolated, promise: null }
        this.sessions.set(id, entry)
        entry.promise = (async () => {
            const code = await this.sdk()
            if (this.sessions.get(id) !== entry || window.isDestroyed()) throw new Error('汽水扫码登录已取消')
            await window.loadURL(BOOTSTRAP)
            await window.webContents.executeJavaScript(code)
            await window.webContents.executeJavaScript('window.bdms.init({aid:386088,paths:["/passport"]})')
            return entry
        })().catch(async error => { await this.close(id); throw error })
        return entry.promise
    }
    async request(id, { url, method = 'GET', data, params = {}, headers = {} }) {
        const target = new URL(url)
        if (target.protocol !== 'https:' || target.username || target.password || !['api.qishui.com', 'bff-pc.qishui.com', 'auth.zijieapi.com'].includes(target.hostname)) throw new Error('汽水登录请求地址无效')
        for (const [key, value] of Object.entries(params)) target.searchParams.set(key, String(value))
        const entry = await (this.sessions.get(id)?.promise || this.create(id))
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
        } catch { throw new Error('汽水登录请求失败，请稍后重试') }
        if (this.sessions.get(id) !== entry) throw new Error('汽水扫码登录已取消')
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
    async close(id) {
        const entry = this.sessions.get(id)
        this.sessions.delete(id)
        if (!entry) return
        if (!entry.window.isDestroyed()) entry.window.destroy()
        await entry.session.clearStorageData().catch(() => {})
        entry.session.protocol.unhandle('https')
    }
    closeAll() { return Promise.all([...this.sessions.keys()].map(id => this.close(id))) }
}
