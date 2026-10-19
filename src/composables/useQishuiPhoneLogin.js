import { ref, computed, watch, onScopeDispose } from 'vue'
import { qishuiInvoke } from '../api/qishui'

export function useQishuiPhoneLogin({ invoke: request = qishuiInvoke, onConfirmed, now = Date.now } = {}) {
    const phone = ref(''), countryCode = ref('+86'), code = ref(''), consent = ref(false)
    const busy = ref(false), message = ref(''), accounts = ref([]), needsVerification = ref(false)
    const retryAt = ref(0), clock = ref(now())
    const seconds = computed(() => Math.max(0, Math.ceil((retryAt.value - clock.value) / 1000)))
    let generation = 0, loginId = '', timer, resetting = false
    const close = id => { if (id) request('login-cancel', { loginId: id }).catch(() => {}) }
    function cancel(clearForm = true) {
        generation++
        close(loginId); loginId = ''
        clearInterval(timer); timer = undefined
        retryAt.value = 0
        busy.value = false; code.value = ''; accounts.value = []; message.value = ''; needsVerification.value = false
        if (clearForm) {
            resetting = true
            phone.value = ''; countryCode.value = '+86'; consent.value = false
            resetting = false
        }
    }
    const active = value => value === generation
    function countdown(until) {
        if (!Number.isFinite(until) || until <= now()) return
        retryAt.value = until; clock.value = now()
        clearInterval(timer)
        timer = setInterval(() => { clock.value = now(); if (!seconds.value) { clearInterval(timer); timer = undefined } }, 1000)
    }
    async function flow(current) {
        if (loginId) return loginId
        const created = await request('phone-create')
        if (!active(current)) { close(created.loginId); return '' }
        loginId = created.loginId
        return loginId
    }
    async function run(callback) {
        if (busy.value) return
        if (!consent.value) { message.value = '请先阅读并同意用户登录指引协议'; return }
        if (!/^\+[1-9]\d{0,3}$/.test(countryCode.value.trim()) || !/^\d{5,15}$/.test(phone.value.replace(/[\s()-]/g, ''))) { message.value = '请填写正确的国家区号和手机号'; return }
        const current = generation
        busy.value = true; message.value = ''; needsVerification.value = false
        try {
            const id = await flow(current)
            if (!active(current)) return
            await callback(id, current)
        } catch (error) {
            if (active(current)) {
                const verificationMessages = {
                    verification_required: '汽水安全验证尚未完成，请重新操作并完成弹出的验证窗口',
                    verification_cancelled: '已关闭汽水安全验证窗口，请重新操作并完成验证',
                    verification_timeout: '汽水安全验证已超时，请重新操作并完成弹出的验证窗口'
                }
                message.value = verificationMessages[error.code] || error.message || '登录失败，请稍后重试'
                needsVerification.value = Object.hasOwn(verificationMessages, error.code)
                countdown(error.retryAt)
                if (['cancelled', 'login_expired'].includes(error.code)) { close(loginId); loginId = ''; accounts.value = []; code.value = '' }
            }
        } finally { if (active(current)) busy.value = false }
    }
    async function send(channel = 'sms') {
        if (seconds.value) return
        return run(async (id, current) => {
            message.value = '正在请求验证码，如弹出汽水安全验证窗口，请在窗口中完成验证…'
            const result = await request('phone-send-code', { loginId: id, phone: phone.value, countryCode: countryCode.value, channel })
            if (!active(current)) return
            if (result.sent !== true) throw new Error('汽水尚未确认验证码发送，请重试')
            accounts.value = []; code.value = ''; message.value = result.message
            countdown(result.retryAt)
        })
    }
    async function login(accountChoice) {
        if (accountChoice === undefined && !/^\d{6}$/.test(code.value.trim())) { message.value = '请输入 6 位数字验证码'; return }
        return run(async (id, current) => {
            message.value = '正在验证登录，如弹出汽水安全验证窗口，请在窗口中完成验证…'
            const result = await request('phone-login', { loginId: id, ...(accountChoice === undefined ? { phone: phone.value, countryCode: countryCode.value, code: code.value } : { accountChoice }) })
            if (!active(current)) return
            if (result.status === 'select_account' && Array.isArray(result.accounts) && result.accounts.length) { accounts.value = result.accounts; message.value = '请选择要登录的账号'; return }
            if (result.status !== 'confirmed' || !result.profile?.userId) throw new Error('汽水账号验证尚未完成，请重试')
            cancel()
            onConfirmed?.(result.profile)
        })
    }
    watch([phone, countryCode], () => { if (!resetting) cancel(false) }, { flush: 'sync' })
    onScopeDispose(() => cancel())
    return { phone, countryCode, code, consent, busy, message, accounts, seconds, needsVerification, send, login, cancel }
}
