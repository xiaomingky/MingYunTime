import { QishuiError, qishuiCookie } from './qishui-client.js'

const ORIGIN = 'https://api.qishui.com'
const COOLDOWN = 60000

// Official PC login SDK Ue/$O: UTF-8 bytes XOR 5, unpadded lowercase hex.
// This is the protocol's field encoding, not encryption for local storage.
export function qishuiPassportForm(values, fields) {
    const form = new URLSearchParams({ mix_mode: '1', fixed_mix_mode: '1' })
    for (const [name, value] of Object.entries(values)) {
        if (value === undefined) continue
        const text = String(value)
        form.set(name, fields.includes(name) ? [...Buffer.from(text)].map(byte => (byte ^ 5).toString(16)).join('') : text)
    }
    return form.toString()
}

export function qishuiPhone(phone, countryCode = '+86') {
    const country = String(countryCode).trim(), number = String(phone || '').replace(/[\s()-]/g, '')
    if (!/^\+[1-9]\d{0,3}$/.test(country) || !/^\d{5,15}$/.test(number) || country.length - 1 + number.length > 15 || (country === '+86' && !/^1[3-9]\d{9}$/.test(number))) {
        throw new QishuiError('invalid_phone', '请填写正确的国家区号和手机号')
    }
    return `${country} ${number}`
}

function merge(jar, values = []) {
    for (const value of Array.isArray(values) ? values : [values]) {
        const pair = String(value).split(';')[0], index = pair.indexOf('=')
        if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1))
    }
}

export class QishuiAccount {
    constructor(client) { this.client = client; this.cooldowns = new Map() }
    create() {
        const login = this.client.beginLogin('phone', 10 * 60000)
        return { loginId: login.id, expiresAt: login.expiresAt }
    }
    active(login) {
        if (!login || login.kind !== 'phone' || this.client.logins.get(login.id) !== login || login.revision !== this.client.revision) throw new QishuiError('cancelled', '登录已取消，请重新打开手机号登录')
        if (login.expiresAt <= this.client.now()) { this.client.qrCancel(login.id); throw new QishuiError('login_expired', '登录已超时，请重新打开手机号登录') }
        return login
    }
    async run(id, callback) {
        const login = this.active(this.client.logins.get(id))
        if (login.busy) throw new QishuiError('login_busy', '正在处理登录请求，请稍候')
        login.busy = true
        try { return await callback(login) } finally { login.busy = false }
    }
    async call(login, endpoint, form) {
        const response = await this.client.passportCall(login, endpoint, { method: 'POST', data: form })
        this.active(login)
        if (response.status !== undefined && (response.status < 200 || response.status >= 300)) throw new QishuiError('passport_network_error', '汽水登录服务暂不可用，请稍后重试')
        if (!response.data || typeof response.data !== 'object' || !response.data.data || typeof response.data.data !== 'object') throw new QishuiError('invalid_response', '汽水登录接口未返回有效数据，请重试')
        return response
    }
    error(response) {
        const p = response.data.data, code = Number(p.error_code ?? response.data.error_code ?? 0)
        if (p.verify_center_decision_conf || p.verify_center_secondary_decision_conf || [1105, 2032, 2046].includes(code)) throw new QishuiError('verification_required', '汽水要求额外安全验证，请改用扫码登录，或在官方客户端验证后导入 Cookie')
        if (response.data.message === 'success' && code === 0) return
        if (code === 16) throw new QishuiError('login_method_unavailable', '汽水暂未向当前客户端开放此登录方式，请使用扫码或 Cookie 登录')
        throw new QishuiError(String(code || 'login_rejected'), String(p.description || p.message || '汽水未接受登录请求，请重试').slice(0, 300))
    }
    async sendCode({ loginId, phone, countryCode, channel = 'sms' }) {
        const mobile = qishuiPhone(phone, countryCode)
        if (!['sms', 'voice'].includes(channel)) throw new QishuiError('invalid_channel', '验证码发送方式无效')
        return this.run(loginId, async login => {
            for (const [number, until] of this.cooldowns) if (until <= this.client.now()) this.cooldowns.delete(number)
            if (this.cooldowns.get(mobile) > this.client.now()) {
                const error = new QishuiError('send_cooldown', '请求过于频繁，请倒计时结束后重试')
                error.retryAt = this.cooldowns.get(mobile)
                throw error
            }
            // Reserve the cooldown before awaiting: separate login jars cannot send concurrently.
            const until = this.client.now() + COOLDOWN
            this.cooldowns.set(mobile, until)
            login.pending = null
            const form = qishuiPassportForm({ is6Digits: 1, mobile, type: 24 }, ['mobile', 'type'])
            let response
            try {
                response = await this.call(login, channel === 'voice' ? '/passport/web/send_voice_code/' : '/passport/web/send_code/', form)
                this.error(response)
            } catch (error) { error.retryAt = until; throw error }
            merge(login.jar, response.headers?.['set-cookie'])
            return { sent: true, channel, retryAt: until, message: channel === 'voice' ? '语音验证码已发送，请留意手机来电' : '验证码已发送，请查看手机短信' }
        })
    }
    async login({ loginId, phone, countryCode, code, accountChoice }) {
        return this.run(loginId, async login => {
            let fields
            if (accountChoice !== undefined) {
                const pending = login.pending
                if (!pending || !Number.isInteger(accountChoice) || !pending.accounts[accountChoice]) throw new QishuiError('invalid_account_choice', '请选择本次验证返回的账号')
                fields = { ...pending.fields, ignore_reused_mobile: 1, sms_code_key: pending.key, sms_code_key_not_mix: 1, sec_uid: pending.accounts[accountChoice].sec_uid, safe_mobile_register_to_login: true }
            } else {
                const mobile = qishuiPhone(phone, countryCode), value = String(code || '').trim()
                if (!/^\d{6}$/.test(value)) throw new QishuiError('invalid_code', '请输入 6 位数字验证码')
                login.pending = null
                fields = { service: ORIGIN, mobile, code: value, login_only: true }
            }
            const response = await this.call(login, '/passport/web/sms_login/', qishuiPassportForm(fields, ['mobile', 'code']))
            const p = response.data.data
            if (Number(p.error_code) === 1454 && Array.isArray(p.sub_account) && typeof p.sms_code_key === 'string' && p.sms_code_key) {
                const accounts = p.sub_account.filter(account => typeof account?.sec_uid === 'string' && account.sec_uid)
                if (!accounts.length) throw new QishuiError('invalid_response', '汽水未返回可选择的账号，请重新登录')
                login.pending = { fields, key: p.sms_code_key, accounts }
                return { status: 'select_account', accounts: accounts.map((account, index) => ({ choice: index, nickname: String(account.nickname || account.name || `账号 ${index + 1}`).slice(0, 80) })) }
            }
            this.error(response)
            merge(login.jar, response.headers?.['set-cookie'])
            if (!['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'].some(key => login.jar.get(key)) && p.redirect_url) {
                let target
                try { target = new URL(p.redirect_url) } catch {}
                if (!target || target.protocol !== 'https:' || target.username || target.password || !['api.qishui.com', 'bff-pc.qishui.com'].includes(target.hostname)) throw new QishuiError('invalid_login_redirect', '汽水返回的登录回调地址无效，请重新登录')
                const redirected = this.client.passportRequest
                    ? await this.client.passportRequest(login.id, { url: target.href, method: 'GET' })
                    : await this.client.request({ url: target.href, method: 'GET', headers: { Cookie: [...login.jar].map(([key, value]) => `${key}=${value}`).join('; ') }, timeout: 15000, maxRedirects: 0 })
                this.active(login)
                merge(login.jar, redirected.headers?.['set-cookie'])
            }
            // Passport's public account info alone is not an authenticated music session.
            const cookie = qishuiCookie([...login.jar].map(([key, value]) => `${key}=${value}`).join('; '))
            const profile = await this.client.profile(cookie)
            this.active(login)
            this.client.save(cookie)
            this.client.cookie = cookie
            this.client.revision++
            this.client.clearLogins()
            return { status: 'confirmed', profile }
        })
    }
}
