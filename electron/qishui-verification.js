// Passport decisions are handled in the same isolated browser jar as the request.
// A challenge callback only authorizes a retry; the server still decides login.
export function qishuiChallenge(payload) {
    const data = payload?.data
    if (!data || typeof data !== 'object') return null
    const decode = value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value
        if (typeof value !== 'string' || value.length > 262144) return null
        try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null } catch { return null }
    }
    for (const key of ['verify_center_decision_conf', 'verify_center_secondary_decision_conf']) {
        const decision = decode(data[key])
        if (decision) return { kind: 'captcha', decision, smsCodeKey: data.sms_code_key }
    }
    if (Number(data.error_code) === 2046 && data.url) return { kind: 'secondary', decision: data, smsCodeKey: data.sms_code_key }
    return null
}

export function qishuiVerifyResource(value) {
    let url
    try {
        url = new URL(typeof value === 'object' && value ? `https://${value.host}${String(value.path || '/').startsWith('/') ? '' : '/'}${value.path || '/'}` : value)
    } catch { throw new Error('汽水安全验证组件地址无效') }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !['qishui.com', 'bytetos.com', 'bytescm.com', 'yhgfb-cn-static.com', 'bytecdntp.com', 'bytegoofy.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('汽水安全验证组件地址无效')
    return url.href
}

// Stringified into a sandboxed renderer. Keep this function self-contained.
export function installQishuiVerification() {
    const resources = [
        'https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/@latest/index.js',
        'https://lf-rc2.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/@latest/index.js',
        'https://lf-cdn-tos.bytescm.com/obj/rc-verifycenter/verifycenter/@latest/index.js',
    ]
    const status = message => { document.getElementById('qishui-verify-status').textContent = message }
    const scripts = new Map()
    const load = (url, pending) => {
        if (!scripts.has(url)) {
            const record = {}
            record.promise = new Promise((resolve, reject) => {
                const script = document.createElement('script')
                let settled = false
                const finish = error => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer); script.onload = null; script.onerror = null
                    if (error) { script.remove(); reject(error) } else resolve()
                }
                const timer = setTimeout(() => finish(new Error('安全验证组件加载超时，请重试')), 15000)
                record.cancel = () => {
                    if (scripts.get(url) === record && !settled) scripts.delete(url)
                    finish(new Error('安全验证已取消'))
                }
                script.src = url
                script.onload = () => finish()
                script.onerror = () => finish(new Error('安全验证组件加载失败，请检查网络'))
                document.head.appendChild(script)
            }).catch(error => { if (scripts.get(url) === record) scripts.delete(url); throw error })
            scripts.set(url, record)
        }
        const record = scripts.get(url)
        pending.add(record.cancel)
        return record.promise.finally(() => pending.delete(record.cancel))
    }
    const fingerprint = () => {
        const cookie = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('s_v_web_id='))
        return cookie ? cookie.slice('s_v_web_id='.length) : localStorage.getItem('s_v_web_id') || ''
    }
    let active
    window.__qishuiVerify = ({ challenge, identity, resource, generalParams, portrait }) => {
        active?.cancel()
        status('正在加载汽水官方安全验证，请稍候…')
        let finish
        const completed = new Promise(resolve => { finish = resolve })
        let settled = false
        const pending = new Set()
        const attempt = {}
        const current = () => !settled && active === attempt
        const done = value => {
            if (!current()) return
            settled = true; active = null
            if (window.__qishuiCancelVerify === attempt.cancel) window.__qishuiCancelVerify = null
            for (const cancel of pending) cancel()
            finish(value)
        }
        attempt.cancel = () => done({ ok: false, cancelled: true })
        active = attempt
        window.__qishuiCancelVerify = attempt.cancel
        const start = async () => {
            if (challenge.kind === 'captcha') {
                if (!window.verifySDK?.initVerifyOptions) {
                    let lastError
                    for (const url of resources) {
                        if (!current()) return
                        try {
                            await load(url, pending)
                            if (!current()) return
                            if (window.verifySDK?.initVerifyOptions) break
                            throw new Error('汽水安全组件未就绪')
                        } catch (error) { if (!current()) return; lastError = error }
                    }
                    if (!window.verifySDK?.initVerifyOptions) throw lastError
                }
                if (!current()) return
                const captchaOptions = { sideSlide: 'disabled', lang: 'zh', showMode: 'mask', region: 'cn', app_name: '汽水音乐', h5_check_version: '4.0.12', ...(fingerprint() ? { fp: fingerprint() } : {}) }
                const secondVerifyWebOptions = { host: 'https://api.qishui.com', verifyAppName: '汽水音乐移动端', scene: '4',
                    callBack: () => done({ ok: true, secondary: true }), closeCallBack: () => done({ ok: false, cancelled: true }) }
                await window.verifySDK.initVerifyOptions({ commonOptions: { repoId: 579047, aid: 386088, did: identity.deviceId, iid: identity.installId }, captchaOptions, secondVerifyWebOptions })
                if (!current()) return
                status('请完成窗口中的安全验证，完成后会自动继续登录')
                await window.verifySDK.autoRender({ verify_data: challenge.decision, captchaOptions: {
                    successCb: () => done({ ok: true, fp: fingerprint() }), closeCb: () => done({ ok: false, cancelled: true }),
                }, secondVerifyWebOptions })
            } else {
                window.$$account_verify_portrait_id = portrait
                // Official browser UMD supplies the secondary renderer's React
                // environment. It is fetched on demand; no API modules are bundled.
                if (!window.ucSecondVerifyReact || !window.ucSecondVerifyReactDom) await load('https://lf-ucenter-web.yhgfb-cn-static.com/obj/passport-fe/ucenter_fe/@byted/uc-account-second-verification-web/1.0.16/dist/index.umd.production.js', pending)
                if (!current()) return
                await load(resource, pending)
                if (!current()) return
                if (typeof window.ucWebSecondVerify !== 'function') throw new Error('汽水二次验证组件未就绪')
                const time = Date.now()
                status('请完成窗口中的身份验证，完成后会自动继续登录')
                await window.ucWebSecondVerify({ ...challenge.decision, aid: 386088, isNewVerifyUI: true, generalParams,
                    event_params: typeof challenge.decision.event_params === 'string' ? JSON.parse(challenge.decision.event_params) : challenge.decision.event_params || {},
                    newSecondVerifyWebOptions: { host: 'https://api.qishui.com', verifyAppName: '汽水音乐移动端' },
                    newSecondVerificationCall: { reportAppLog: () => {} }, verify_portrait_id: portrait,
                    monitorTime: { startTime: time, fetchEndTime: time, scriptLoadStartTime: 0, scriptLoadEndTime: time, renderStartTime: time },
                    fun: challenge.decision.verify_from === 'verify_center' ? 'verify_center' : 'verify', uc_account_verify_version: '1.0.29',
                    verifyFinishCallback: result => done({ ok: result?.status === true }),
                })
            }
        }
        // The returned promise settles even if an SDK load/init never resolves.
        // Late work from a cancelled attempt cannot render or update a new one.
        start().catch(() => { if (!current()) return; status('汽水安全验证组件加载失败，请关闭窗口后重试'); done({ ok: false, failed: true }) })
        return completed
    }
}
