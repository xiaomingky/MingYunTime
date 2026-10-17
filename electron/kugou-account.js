import { createHash, randomBytes, createCipheriv, createDecipheriv, publicEncrypt, constants } from 'node:crypto'
import QRCode from 'qrcode'
import { kugouRsa, kugouAes, kugouParamsKey } from './kugou-operations.js'

// Public web protocol from the official kguser.v2 and infSign bundles. This is
// the published web client signing salt, not a user credential or private key.
const WEB_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const RSA_MODULUS = 'B1B1EC76A1BBDBF0D18E8CD9A87E53FA3881E2F004C67C9DDA2CA677DBEFA3D61DF8463FE12D84FF4B4699E02C9D41CAB917F5A8FB9E35580C4BDF97763A0420A476295D763EE10174E6F9EBF7DF8A77BA5B20CDA4EE705DEF5BBA3C88567B9656E52C9CD5CD95CA735FF2D25F762B133273EEEB7B4F3EA8B6DA29040F3B67CD'
const md5 = s => createHash('md5').update(s).digest('hex')
export function kugouValidatedCredentials(data, key, token, userid) {
    if (!data || String(data.userid || data.user_id || '') !== String(userid)) throw new Error('酷狗登录响应缺少匹配的账号信息')
    const { secu_params: encrypted, ...profile } = data
    let credentials = {}
    if (encrypted !== undefined) {
        try {
            if (typeof encrypted !== 'string' || !/^[a-fA-F0-9]+$/.test(encrypted) || encrypted.length % 32 || encrypted.length > 16384) throw new Error()
            const cipherKey = md5(key)
            const decipher = createDecipheriv('aes-256-cbc', Buffer.from(cipherKey), Buffer.from(cipherKey.slice(-16)))
            const clear = Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]).toString('utf8')
            try { credentials = JSON.parse(clear) } catch { credentials = { token: clear } }
            if (typeof credentials === 'string') credentials = { token: credentials }
            if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || !/^[a-zA-Z0-9_-]{8,2048}$/.test(credentials.token || '')) throw new Error()
        } catch { throw new Error('酷狗登录凭据解密失败，请重新登录') }
        const identity = credentials.userid || credentials.user_id
        if (identity && String(identity) !== String(userid)) throw new Error('酷狗登录响应缺少匹配的账号信息')
    }
    const validatedToken = credentials.token || profile.token || token
    if (!/^[a-zA-Z0-9_-]{8,2048}$/.test(validatedToken || '')) throw new Error('酷狗登录响应缺少有效凭据')
    return { ...profile, token: validatedToken, userid: String(userid) }
}
export function kugouWebSign(params, now = Date.now(), mid = String(now)) {
    const result = { srcappid: 2919, clientver: 20000, clienttime: now, mid, uuid: mid, dfid: '-', ...params }
    result.signature = md5(WEB_SALT + Object.keys(result).sort().map(k => `${k}=${result[k]}`).join('') + WEB_SALT).toUpperCase()
    return result
}
export class KugouAccount {
    constructor({ send, privateValidate, privateCall, now = () => Date.now(), qrImage = url => QRCode.toDataURL(url, { width: 300, margin: 2 }) }) {
        Object.assign(this, { send, privateValidate, privateCall, now, qrImage }); this.qr = new Map(); this.mid = randomBytes(16).toString('hex')
    }
    async login(route, p) {
        const mobile = String(p.mobile || '')
        if (route !== '/login' && !/^1\d{10}$/.test(mobile)) throw new Error('请输入有效手机号')
        if (route === '/login/cellphone' && !/^\d{4,8}$/.test(String(p.code || ''))) throw new Error('请输入有效验证码')
        if (route === '/login' && (!p.username || !p.password)) throw new Error('请输入用户名和密码')
        const time = this.now(), key = randomBytes(8).toString('hex')
        const secret = route === '/login' ? {pwd:String(p.password),code:p.code || '',clienttime_ms:time} : {mobile,...(route === '/login/cellphone' ? {code:String(p.code)} : {})}
        const data = {plat:1,clienttime_ms:time,pk:kugouRsa({clienttime_ms:time,key}),params:kugouAes(secret,key)}
        if (route === '/captcha/sent') Object.assign(data,{businessid:5,mobile:mobile.slice(0,2)+'*****'+mobile.slice(-1)})
        else Object.assign(data,{support_multi:1,key:kugouParamsKey(time),...(route === '/login' ? {username:String(p.username)} : {mobile:mobile.slice(0,2)+'*****'+mobile.slice(-1),...(p.userid ? {userid:String(p.userid)} : {})})})
        const endpoint = route === '/captcha/sent' ? '/v8/send_mobile_code' : route === '/login' ? '/v9/login_by_pwd' : '/v7/login_by_verifycode'
        const result = await this.privateCall(endpoint,{}, {host:route === '/login/cellphone' ? 'loginserviceretry.kugou.com' : 'login.user.kugou.com',anonymous:true,data,allowErrors:[34175],headers:{'support-calm':'1'}})
        if (route === '/captcha/sent' || Number(result.error_code) === 34175) return result
        return {...result,data:kugouValidatedCredentials(result.data,key,'',result.data?.userid)}
    }
    async request(path, params, host = 'login-user.kugou.com', method = 'GET') {
        return this.send(`https://${host}/${path}`, kugouWebSign({ appid: 1014, plat: 4, ...params }, this.now(), this.mid), method)
    }
    async validate(token, userid) {
        if (!/^[a-zA-Z0-9_-]{8,2048}$/.test(String(token || '')) || !/^[1-9]\d{0,17}$/.test(String(userid || ''))) throw new Error('请提供有效的 token 和 userid')
        // A concept token and a web token have different scopes. Preserve a
        // working concept token rather than replacing it with web credentials.
        if (this.privateValidate) {
            try {
                const vip = await this.privateValidate({token,userid})
                return {status:1,error_code:0,data:{userid:String(userid),token,vipInfo:vip.data,conceptAuthenticated:true}}
            } catch { /* Web-only sessions still support the official web player. */ }
        }
        const ts = this.now(), key = randomBytes(8).toString('hex').toUpperCase(), cipherKey = md5(key)
        const cipher = createCipheriv('aes-256-cbc', Buffer.from(cipherKey), Buffer.from(cipherKey.slice(-16)))
        const params = Buffer.concat([cipher.update(JSON.stringify({ token })), cipher.final()]).toString('hex')
        const clear = Buffer.alloc(128); Buffer.from(JSON.stringify({ clienttime_ms: ts, key })).copy(clear)
        const pk = publicEncrypt({ key: { kty: 'RSA', n: Buffer.from(RSA_MODULUS, 'hex').toString('base64url'), e: 'AQAB' }, format: 'jwk', padding: constants.RSA_NO_PADDING }, clear).toString('hex')
        const result = await this.request('v1/login_by_token_get', { userid, dev: 'web', clienttime: Math.floor(ts / 1000), clienttime_ms: ts, pk, params }, 'loginservice.kugou.com', 'POST')
        if (result.status !== 1 || result.error_code) throw new Error(result.error_code === 20017 ? '酷狗登录凭据无效或已过期' : `酷狗未确认登录（${result.error_code || '需要验证'}）`)
        return { status: 1, error_code: 0, data: kugouValidatedCredentials(result.data, key, token, userid) }
    }
    async call(route, params = {}) {
        if (['/login','/login/cellphone','/captcha/sent'].includes(route)) return this.login(route,params)
        if (['/login/wx/create','/login/wx/check','/login/openplat'].includes(route)) throw new Error('微信登录需要酷狗官方开放平台授权配置，请使用酷狗扫码或手机验证码登录')
        if (route === '/login/token') return this.validate(params.token, params.userid)
        for (const [key, value] of this.qr) if (this.now() - value.time > 180000) this.qr.delete(key)
        if (route === '/login/qr/key') {
            if (this.qr.size >= 10) throw new Error('二维码创建过多，请稍后再试')
            const prefix = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=3116&'
            const result = await this.request('v2/qrcode', { appid:1001, type: 1, qrcode_txt: prefix })
            const key = result.data?.qrcode
            if (result.status !== 1 || result.error_code || !/^[a-zA-Z0-9_-]{8,150}$/.test(key || '')) throw new Error('酷狗二维码创建失败，请重试')
            const image = await this.qrImage(prefix + 'qrcode=' + encodeURIComponent(key))
            this.qr.set(key, { time: this.now(), image })
            return { status: 1, data: { qrcode: key, qrcode_img: image } }
        }
        const key = String(params.key || ''), state = this.qr.get(key)
        if (route === '/login/qr/cancel') { this.qr.delete(key); return { status: 1 } }
        if (!state) return { status: 1, data: { status: 0 } }
        if (route === '/login/qr/create') return { status: 1, data: { base64: state.image } }
        if (route !== '/login/qr/check') throw new Error('酷狗登录操作不支持')
        if (state.pending) return state.pending
        state.pending = (async () => {
            const result = await this.request('v2/get_userinfo_qrcode', { appid:3116, qrcode: key })
            if (this.qr.get(key) !== state) return { status: 1, data: { status: 0 } }
            if (result.status !== 1 || result.error_code || ![0,1,2,4].includes(result.data?.status)) throw new Error('酷狗扫码状态获取失败，请刷新重试')
            if (result.data.status === 4) {
                const account = await this.validate(result.data.token, result.data.userid)
                if (this.qr.get(key) !== state) return { status: 1, data: { status: 0 } }
                this.qr.delete(key)
                return { status: 1, data: { ...account.data, status: 4 } }
            }
            if (result.data.status === 0) this.qr.delete(key)
            return result
        })().finally(() => { state.pending = null })
        return state.pending
    }
}
