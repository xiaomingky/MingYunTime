<script setup>
import { ref, reactive, onUnmounted, watch, computed } from 'vue'
import { X, QrCode, Smartphone, Mail, FileCode, Info, User } from 'lucide-vue-next'
import { useUserStore } from '../store/user'
import { useQQUserStore } from '../store/qq-user'
import { useQishuiUserStore } from '../store/qishui-user'
import { qishuiInvoke } from '../api/qishui'
import { useQishuiPhoneLogin } from '../composables/useQishuiPhoneLogin'
import { useQQPhoneLogin } from '../composables/useQQPhoneLogin'
import { useQQQrLogin } from '../composables/useQQQrLogin'
import request from '../api'
import { useKugouUserStore } from '../store/kugou-user'
import {
    kugouCaptchaSent, kugouQrKey, kugouQrCreate, kugouQrCheck
} from '../api/kugou'
import { usePlatformStore } from '../store/platform'
import { useMessageStore } from '../store/message'

const props = defineProps(['show'])
const emit = defineEmits(['close'])

const userStore = useUserStore()
const qqUserStore = useQQUserStore()
const qishuiUserStore = useQishuiUserStore()
const kugouUserStore = useKugouUserStore()
const platformStore = usePlatformStore()
const messageStore = useMessageStore()
const loading = ref(false)
const loginMode = ref(platformStore.isQishui ? 'cookie' : 'qr') // qr, phone, email, cookie

// 是否 QQ 平台
const isQQ = computed(() => platformStore.isQQ)
const isQishui = computed(() => platformStore.isQishui)
const isKugou = computed(() => platformStore.isKugou)
const modalTitle = computed(() => {
    if (isQishui.value) return '登录汽水音乐'
    if (isQQ.value) return '登录 QQ 音乐'
    if (isKugou.value) return '登录酷狗概念版'
    return '登录网易云音乐'
})
const qrTipText = computed(() => '请使用网易云音乐 APP 扫码')

// Form Data
const phone = ref('')
const password = ref('')
const email = ref('')
const captcha = ref('')
const cookieInput = ref('')
const isCaptchaMode = ref(false)
const captchaTimer = ref(0)

// QR Data (网易云)
const qrKey = ref('')
const qrImg = ref('')
const qrStatus = ref(0) // 800: expired, 801: waiting, 802: authorizing, 803: success
let qrTimer = null
let qrGeneration = 0
const qrError = ref('')
const sodaQr = ref(''), sodaMessage = ref(''), sodaCookie = ref(''), sodaBusy = ref(false)
const sodaPhoneLogin = reactive(useQishuiPhoneLogin({ onConfirmed(profile) {
    qishuiUserStore.acceptProfile(profile)
    messageStore.success('汽水音乐登录成功')
    emit('close')
} }))
const sodaTabs = [
    { mode: 'cookie', label: 'Cookie 登录', icon: FileCode },
    { mode: 'qr', label: '汽水扫码', icon: QrCode },
    { mode: 'phone', label: '手机验证码', icon: Smartphone }
]
function focusSodaTab(event, index) {
    const selected = (index + sodaTabs.length) % sodaTabs.length
    loginMode.value = sodaTabs[selected].mode
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[selected]?.focus()
}
let sodaLoginId = '', sodaTimer = null, sodaGeneration = 0
function stopSodaLogin() {
    sodaGeneration++
    if (sodaTimer) clearTimeout(sodaTimer)
    sodaTimer = null
    if (sodaLoginId) qishuiInvoke('qr-cancel', { loginId: sodaLoginId }).catch(() => {})
    sodaLoginId = ''; sodaBusy.value = false
}
async function startSodaLogin() {
    stopSodaLogin(); sodaQr.value = ''; sodaMessage.value = '正在生成登录二维码…'; sodaBusy.value = true
    const generation = sodaGeneration
    try {
        const res = await qishuiInvoke('qr-create')
        if (generation !== sodaGeneration || !props.show) { qishuiInvoke('qr-cancel', { loginId: res.loginId }).catch(() => {}); return }
        sodaLoginId = res.loginId; sodaQr.value = res.image; sodaBusy.value = false
        const poll = async () => {
            if (generation !== sodaGeneration) return
            try {
                const status = await qishuiInvoke('qr-check', { loginId: res.loginId })
                if (generation !== sodaGeneration) return
                if (status.status === 'confirmed' && status.profile) {
                    qishuiUserStore.acceptProfile(status.profile); sodaMessage.value = '登录成功'
                    messageStore.success('汽水音乐登录成功'); stopSodaLogin(); emit('close'); return
                }
                if (['expired', 'cancelled'].includes(status.status)) { sodaMessage.value = '二维码已过期或取消，请刷新'; stopSodaLogin(); return }
                if (status.status === 'verification_required') {
                    sodaMessage.value = status.message || '请在弹出的窗口完成汽水安全验证，完成后会继续登录'
                    // Keep this QR and its isolated login session alive while the
                    // security window finishes. Schedule only after this request.
                    sodaTimer = setTimeout(poll, 2500)
                    return
                }
                sodaMessage.value = status.message || (['scanned', 'scaned'].includes(status.status) ? '已扫码，请在汽水音乐 App 中确认登录' : '请使用汽水音乐 App 扫码')
                sodaTimer = setTimeout(poll, 2500)
            } catch (e) {
                if (generation !== sodaGeneration) return
                sodaMessage.value = e.message || '汽水扫码状态获取失败，请刷新二维码'
                if (e.code === 'verification_required') sodaTimer = setTimeout(poll, 2500)
                else stopSodaLogin()
            }
        }
        await poll()
    } catch (e) { if (generation === sodaGeneration) { sodaMessage.value = e.message; sodaBusy.value = false } }
}
async function loginSodaCookie() {
    if (sodaBusy.value) return
    if (!sodaCookie.value.trim()) { sodaMessage.value = '请先粘贴汽水 Cookie'; return }
    const generation = sodaGeneration
    sodaMessage.value = ''
    sodaBusy.value = true
    try {
        await qishuiUserStore.cookieLogin(sodaCookie.value)
        sodaCookie.value = ''
        if (generation !== sodaGeneration || !props.show) return
        emit('close'); messageStore.success('汽水音乐登录成功')
    }
    catch (e) { if (generation === sodaGeneration) sodaMessage.value = e.message }
    finally { if (generation === sodaGeneration) sodaBusy.value = false }
}

// ===== 网易云扫码 =====
const startQrPolling = async () => {
    stopQrPolling()
    if (isQishui.value) return
    if (isQQ.value) return // QQ 走官网登录逻辑
    const generation = qrGeneration
    qrImg.value = ''; qrStatus.value = 0; qrError.value = ''
    const data = await userStore.getQrCodeData()
    if (generation !== qrGeneration || !props.show || loginMode.value !== 'qr') {
        if (data?.unikey) request.get('/login/qr/cancel', { params: { key: data.unikey } }).catch(() => {})
        return
    }
    if (!data) { qrError.value = '二维码加载失败，请重试'; return }
    qrKey.value = data.unikey
    qrImg.value = data.qrimg
    qrStatus.value = 801

    const poll = async () => {
        if (generation !== qrGeneration) return
        const res = await userStore.checkQrCodeStatus(data.unikey, () => generation === qrGeneration)
        if (generation !== qrGeneration) return
        qrStatus.value = res.code
        if (res.code === 803) {
            stopQrPolling()
            messageStore.success('登录成功，欢迎回来', 3000, userStore.profile)
            emit('close')
        } else if (res.code === 800) {
            stopQrPolling()
        } else if (![801,802].includes(res.code)) {
            qrError.value = res.message || '扫码状态获取失败，请重试'; stopQrPolling()
        } else qrTimer = setTimeout(poll, 3000)
    }
    qrTimer = setTimeout(poll, 3000)
}

const stopQrPolling = () => {
    qrGeneration++
    if (qrKey.value) { request.get('/login/qr/cancel', { params: { key: qrKey.value } }).catch(() => {}); qrKey.value = '' }
    if (qrTimer) {
        clearTimeout(qrTimer)
        qrTimer = null
    }
}

// QQ / WeChat grants are exchanged for full music credentials in main process.
const qqCookieInput = ref('')
const qqPhoneLogin = reactive(useQQPhoneLogin({acceptSession:(...args)=>qqUserStore.acceptSession(...args),onSuccess(){messageStore.success('QQ 音乐登录成功');emit('close')}}))
watch(loginMode, (mode,previous) => {if(previous==='qq-phone'&&mode!==previous)qqPhoneLogin.cancel()})
watch(()=>props.show,show=>{if(!show)qqPhoneLogin.cancel()})
const qqOfficialMode = ref('qq')
const qqQrLogin = reactive(useQQQrLogin({acceptSession:(...args)=>qqUserStore.acceptSession(...args),onSuccess(){messageStore.success('QQ 音乐登录成功');emit('close')}}))
watch(qqOfficialMode,()=>{if(props.show&&isQQ.value&&loginMode.value==='qr')qqQrLogin.start(qqOfficialMode.value)})
// QQ Cookie 登录
const handleQQCookieLogin = async () => {
    const input = qqCookieInput.value.trim()
    if (!input) return messageStore.warning('请输入 Cookie')
    loading.value = true
    try {
        const res = await qqUserStore.cookieLogin(input)
        if (res?.success) {
            messageStore.success('QQ 音乐 Cookie 登录成功', 3000, qqUserStore.profile)
            emit('close')
            qqCookieInput.value = ''
        } else {
            messageStore.error(res?.message || '登录失败,请检查 Cookie 是否包含 qm_keyst')
        }
    } catch (e) {
        messageStore.error(e?.message || '登录异常')
    } finally {
        loading.value = false
    }
}

// ===== 酷狗概念版登录 =====
const kugouPhone = ref('')
const kugouCode = ref('')
const kugouCodeSending = ref(false)
const kugouCodeCountdown = ref(0)
// 多账户选择弹窗（手机号关联多个酷狗账户时显示）
const kugouMultiAccounts = ref([])
const showKugouAccountPicker = ref(false)
const kugouAccountPicking = ref(false)
const kugouQrImg = ref('')
const kugouQrStatus = ref(0)
const kugouQrMessage = ref('')
let kugouQrTimer = null
let kugouQrGeneration = 0
const kugouCookieInput = ref('')

// 酷狗用户名登录
const kugouUsername = ref('')
const kugouPassword = ref('')

const sendKugouCode = async () => {
    if (!kugouPhone.value || !/^1\d{10}$/.test(kugouPhone.value)) {
        messageStore.error('请输入正确的手机号')
        return
    }
    if (kugouCodeCountdown.value > 0) return
    kugouCodeSending.value = true
    try {
        await kugouCaptchaSent(kugouPhone.value)
        messageStore.success('验证码已发送')
        kugouCodeCountdown.value = 60
        const timer = setInterval(() => {
            kugouCodeCountdown.value--
            if (kugouCodeCountdown.value <= 0) clearInterval(timer)
        }, 1000)
    } catch (e) {
        messageStore.error('验证码发送失败')
    } finally {
        kugouCodeSending.value = false
    }
}

const doKugouPhoneLogin = async () => {
    if (!kugouPhone.value || !kugouCode.value) {
        messageStore.error('请输入手机号和验证码')
        return
    }
    const result = await kugouUserStore.phoneLogin(kugouPhone.value, kugouCode.value)
    // 多账户场景：返回 { multiAccounts: [...] }，弹出选择框
    if (result && typeof result === 'object' && result.multiAccounts) {
        kugouMultiAccounts.value = result.multiAccounts
        showKugouAccountPicker.value = true
        return
    }
    // 登录成功（result === true）或失败（result === false）
    if (result === true) emit('close')
}

// 多账户选择：用指定 userid 完成登录
const pickKugouAccount = async (account) => {
    if (kugouAccountPicking.value) return
    kugouAccountPicking.value = true
    try {
        const ok = await kugouUserStore.phoneLoginWithUserid(
            kugouPhone.value, kugouCode.value, account.userid
        )
        if (ok) {
            showKugouAccountPicker.value = false
            kugouMultiAccounts.value = []
            emit('close')
        }
    } finally {
        kugouAccountPicking.value = false
    }
}

const cancelKugouAccountPicker = () => {
    showKugouAccountPicker.value = false
    kugouMultiAccounts.value = []
}

const startKugouQrLogin = async () => {
    const generation = ++kugouQrGeneration
    if (kugouQrTimer) kugouQrTimer()
    kugouQrImg.value = ''
    kugouQrStatus.value = 0
    kugouQrMessage.value = ''
    const stopFn = await kugouUserStore.qrLogin(kugouQrImg, kugouQrStatus, kugouQrMessage,
        () => generation === kugouQrGeneration && props.show && isKugou.value && loginMode.value === 'qr')
    if (generation !== kugouQrGeneration) stopFn?.()
    else if (stopFn) kugouQrTimer = stopFn
}

const doKugouCookieLogin = async () => {
    if (!kugouCookieInput.value.trim()) {
        messageStore.error('请粘贴 token 或 "token=xxx; userid=xxx" 格式的 Cookie')
        return
    }
    const ok = await kugouUserStore.cookieLogin(kugouCookieInput.value)
    if (ok) emit('close')
}

// 酷狗用户名登录
const doKugouUsernameLogin = async () => {
    if (!kugouUsername.value || !kugouPassword.value) {
        messageStore.error('请输入用户名和密码')
        return
    }
    const ok = await kugouUserStore.usernameLogin(kugouUsername.value, kugouPassword.value)
    if (ok) emit('close')
}

// 酷狗扫码成功后关闭弹窗
watch(kugouQrStatus, (val) => {
    if (val === 4) emit('close')
})

// 统一启动扫码（按平台分发）
const startPlatformQr = () => {
    if (isQishui.value) {
        startSodaLogin()
    } else if (isQQ.value) {
        qqQrLogin.start(qqOfficialMode.value)
    } else if (isKugou.value) {
        // 酷狗默认 tab 是概念版二维码
        startKugouQrLogin()
    } else {
        startQrPolling()
    }
}

const stopAllPolling = () => {
    qqQrLogin.cancel()
    kugouQrGeneration++
    stopSodaLogin()
    sodaPhoneLogin.cancel()
    stopQrPolling()
    if (kugouQrTimer) {
        kugouQrTimer()
        kugouQrTimer = null
    }
}

const handlePhoneLogin = async () => {
    if (!phone.value) return messageStore.warning('请输入手机号')
    loading.value = true
    const data = { phone: phone.value }
    if (isCaptchaMode.value) {
        if (!captcha.value) {
            loading.value = false
            return messageStore.warning('请输入验证码')
        }
        data.captcha = captcha.value
    } else {
        if (!password.value) {
            loading.value = false
            return messageStore.warning('请输入密码')
        }
        data.password = password.value
    }

    const res = await userStore.loginWithPhone(data)
    if (res.success) {
        messageStore.success('登录成功，准备开启音乐之旅', 3000, res.profile)
        emit('close')
    } else {
        messageStore.error(res.message || '登录失败')
    }
    loading.value = false
}

const handleEmailLogin = async () => {
    if (!email.value || !password.value) return messageStore.warning('请填写完整信息')
    loading.value = true
    const res = await userStore.loginWithEmail({ email: email.value, password: password.value })
    if (res.success) {
        messageStore.success('登录成功，欢迎回来', 3000, res.profile)
        emit('close')
    } else {
        messageStore.error(res.message || '登录失败')
    }
    loading.value = false
}

const handleSendCaptcha = async () => {
    if (!phone.value) return messageStore.warning('请输入手机号')
    messageStore.info('正在发送验证码...')
    const res = await userStore.sendCaptcha(phone.value)
    if (res.success) {
        messageStore.success(res.message || '验证码已发送')
        captchaTimer.value = 60
        const timer = setInterval(() => {
            captchaTimer.value--
            if (captchaTimer.value <= 0) clearInterval(timer)
        }, 1000)
    } else {
        messageStore.error(res.message || '验证码发送失败')
    }
}

const handleCookieLogin = async () => {
    let input = cookieInput.value.trim()
    if (!input) return messageStore.warning('请输入 Cookie')
    loading.value = true
    let res
    try { res = await userStore.loginWithCookie(input) }
    catch (e) { messageStore.error(e.message || '登录验证失败，请重试'); loading.value = false; return }
    if (res.success) {
        messageStore.success('Cookie 登录成功', 3000, res.profile)
        emit('close')
        cookieInput.value = ''
    } else {
        messageStore.error('登录失败，请检查 Cookie 是否有效')
    }
    loading.value = false
}

watch(() => props.show, (newVal) => {
    if (newVal) {
        if (loginMode.value === 'qr') startPlatformQr()
    } else {
        stopAllPolling()
    }
}, { immediate: true })

watch(loginMode, (newVal) => {
    if (isQishui.value) { sodaMessage.value = ''; sodaPhoneLogin.cancel(); if (newVal === 'qr' && props.show) startSodaLogin(); else stopSodaLogin(); return }
    // 先停止所有轮询
    stopAllPolling()
    if (isKugou.value) {
        // 酷狗平台：qr=概念版二维码
        if (newVal === 'qr') startKugouQrLogin()
    } else if (newVal === 'qr') {
        startPlatformQr()
    }
})

// 平台切换时重置登录态
watch(() => platformStore.currentPlatform, () => {
    stopAllPolling()
    loginMode.value = isQishui.value ? 'cookie' : 'qr'
    qrImg.value = ''
    qrStatus.value = 0
    if (props.show && loginMode.value === 'qr') startPlatformQr()
})

onUnmounted(() => { stopAllPolling(); stopSodaLogin() })
</script>

<template>
  <Transition name="modal-pop">
  <div class="login-modal-overlay" v-if="show" @click.self="emit('close')">
    <div class="login-modal modal-panel" :class="{ 'soda-login-modal': isQishui }" role="dialog" aria-modal="true" :aria-label="modalTitle">
      <div class="header">
        <span class="title">{{ modalTitle }}</span>
        <X class="close-btn" @click="emit('close')" />
      </div>

      <!-- 汽水：独立账号验证、官方扫码与手机验证码 -->
      <template v-if="isQishui">
        <p class="soda-login-intro">把你的音乐喜好带过来</p>
        <div class="login-tabs" role="tablist" aria-label="汽水登录方式">
          <button v-for="(tab, index) in sodaTabs" :key="tab.mode" :id="'soda-' + tab.mode + '-tab'" class="tab" :class="{ active: loginMode === tab.mode }" role="tab" :aria-selected="loginMode === tab.mode" :tabindex="loginMode === tab.mode ? 0 : -1" aria-controls="soda-login-panel" @click="loginMode = tab.mode" @keydown.right.prevent="focusSodaTab($event, index + 1)" @keydown.left.prevent="focusSodaTab($event, index - 1)" @keydown.home.prevent="focusSodaTab($event, 0)" @keydown.end.prevent="focusSodaTab($event, sodaTabs.length - 1)"><component :is="tab.icon" :size="17" /><span>{{ tab.label }}</span></button>
        </div>
        <div id="soda-login-panel" class="content" role="tabpanel" :aria-labelledby="'soda-' + loginMode + '-tab'">
          <div v-if="loginMode === 'qr'" class="qr-login">
            <div class="qr-container"><img v-if="sodaQr" :src="sodaQr" alt="汽水登录二维码" /><div v-else class="qr-placeholder"><QrCode :size="38" /><span>{{ sodaBusy ? '正在准备二维码' : '二维码暂不可用' }}</span></div></div>
            <p class="qr-tip" role="status" aria-live="polite">{{ sodaMessage || '请使用汽水音乐 App 扫码' }}</p>
            <button class="login-btn" :disabled="sodaBusy" @click="startSodaLogin">{{ sodaBusy ? '生成中…' : '刷新二维码' }}</button>
            <button v-if="!sodaBusy && !sodaQr" class="soda-cookie-fallback" @click="loginMode = 'cookie'">使用 Cookie 登录</button>
          </div>
          <form v-else-if="loginMode === 'phone'" class="form soda-phone-form" @submit.prevent="sodaPhoneLogin.login()">
            <div class="soda-login-copy"><h3>用手机号找回你的音乐</h3><p class="qr-tip">使用汽水绑定的抖音账号手机号，输入验证码完成登录。</p></div>
            <div class="input-item soda-phone-number">
              <input class="soda-country-code" v-model="sodaPhoneLogin.countryCode" aria-label="国家或地区区号" autocomplete="tel-country-code" placeholder="+86" maxlength="5" :disabled="sodaPhoneLogin.busy" />
              <input v-model="sodaPhoneLogin.phone" type="tel" aria-label="汽水账号手机号" autocomplete="tel-national" placeholder="手机号" maxlength="20" :disabled="sodaPhoneLogin.busy" />
            </div>
            <div class="input-item soda-phone-code">
              <input v-model="sodaPhoneLogin.code" aria-label="汽水登录验证码" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" :disabled="sodaPhoneLogin.busy" />
              <button type="button" class="soda-send-code" :disabled="sodaPhoneLogin.busy || sodaPhoneLogin.seconds > 0 || !sodaPhoneLogin.consent || !sodaPhoneLogin.phone" @click="sodaPhoneLogin.send('sms')">{{ sodaPhoneLogin.seconds ? `${sodaPhoneLogin.seconds}s 后重发` : '获取验证码' }}</button>
            </div>
            <label class="soda-login-agreement"><input type="checkbox" v-model="sodaPhoneLogin.consent" :disabled="sodaPhoneLogin.busy" /><span>我已阅读并同意<a href="https://luna-web.douyin.com/login-guide" target="_blank" rel="noopener noreferrer">《用户登录指引协议》</a></span></label>
            <div v-if="sodaPhoneLogin.accounts.length" class="soda-account-choices" aria-label="选择汽水登录账号">
              <p>该手机号关联多个账号，请选择：</p>
              <button v-for="account in sodaPhoneLogin.accounts" :key="account.choice" type="button" :disabled="sodaPhoneLogin.busy" @click="sodaPhoneLogin.login(account.choice)"><User :size="17" /><span>{{ account.nickname }}</span><span>登录</span></button>
            </div>
            <button v-else type="submit" class="login-btn" :disabled="sodaPhoneLogin.busy || !sodaPhoneLogin.consent || sodaPhoneLogin.code.length !== 6">{{ sodaPhoneLogin.busy ? '正在处理…' : '验证并登录' }}</button>
            <p v-if="sodaPhoneLogin.message" class="qr-tip soda-phone-message" role="status" aria-live="polite">{{ sodaPhoneLogin.message }}</p>
            <div class="soda-phone-help"><span>收不到短信？</span><button type="button" :disabled="sodaPhoneLogin.busy || sodaPhoneLogin.seconds > 0 || !sodaPhoneLogin.consent || !sodaPhoneLogin.phone" @click="sodaPhoneLogin.send('voice')">使用语音验证码</button><button v-if="sodaPhoneLogin.needsVerification" type="button" @click="loginMode = 'qr'">改用扫码</button></div>
          </form>
          <div v-else class="form">
            <div class="soda-login-copy"><h3>使用已有登录状态</h3><p class="qr-tip">粘贴含 sessionid 或 sessionid_ss 的完整汽水 Cookie，也支持导出的 JSON。验证成功后同步账号与个人歌单。</p></div>
            <div class="input-item"><textarea v-model="sodaCookie" placeholder="sessionid=…; 其他 Cookie=…" aria-label="汽水音乐 Cookie" rows="4" autocomplete="off" spellcheck="false" :disabled="sodaBusy"></textarea></div>
            <button class="login-btn" :disabled="sodaBusy" @click="loginSodaCookie">{{ sodaBusy ? '验证中…' : '验证并登录' }}</button>
            <p class="qr-tip" role="status" aria-live="polite">{{ sodaMessage }}</p>
          </div>
        </div>
        <p class="soda-login-footnote"><Info :size="13" />凭据保留在本机，支持时加密保存</p>
      </template>
      <template v-else-if="isQQ">
        <div class="login-tabs">
          <button type="button" class="tab" :class="{ active: loginMode === 'qr' && qqOfficialMode !== 'wechat' }" @click="loginMode = 'qr'; qqOfficialMode = 'qq'"><QrCode :size="16" />QQ 登录</button>
          <button type="button" class="tab" :class="{ active: loginMode === 'qr' && qqOfficialMode === 'wechat' }" @click="loginMode = 'qr'; qqOfficialMode = 'wechat'"><Smartphone :size="16" />微信登录</button>
          <button type="button" class="tab" :class="{active:loginMode==='qq-phone'}" @click="loginMode='qq-phone'"><Smartphone :size="16" />手机验证码</button>
          <div class="tab" :class="{ active: loginMode === 'cookie' }" @click="loginMode = 'cookie'">
            <FileCode :size="16" />
            Cookie 登录
          </div>
        </div>
        <div class="content">
          <form v-if="loginMode==='qq-phone'" class="form qq-native-phone" @submit.prevent="qqPhoneLogin.login()">
            <div class="soda-login-copy"><h3>手机号登录</h3><p class="qr-tip">直连 QQ 音乐 APK 手机登录接口，登录绑定的音乐账号。</p></div>
            <div class="input-item"><input v-model.trim="qqPhoneLogin.phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="中国大陆手机号 +86" aria-label="QQ 音乐手机号" :disabled="qqPhoneLogin.busy" /></div>
            <div class="input-item qq-phone-code"><input v-model.trim="qqPhoneLogin.code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="短信验证码" aria-label="QQ 音乐短信验证码" :disabled="qqPhoneLogin.busy" /><button type="button" :disabled="qqPhoneLogin.busy||qqPhoneLogin.seconds>0||!qqPhoneLogin.consent" @click="qqPhoneLogin.send()">{{ qqPhoneLogin.seconds>0 ? `${qqPhoneLogin.seconds}s 后重试` : '获取验证码' }}</button></div>
            <label class="qq-phone-consent"><input v-model="qqPhoneLogin.consent" type="checkbox" />我已阅读并同意 <a href="https://y.qq.com/i/user_terms.html" target="_blank" rel="noopener noreferrer">用户协议</a>和<a href="https://y.qq.com/m/client/intro/privacy.html" target="_blank" rel="noopener noreferrer">隐私政策</a></label>
            <button type="submit" class="login-btn" :disabled="qqPhoneLogin.busy||!qqPhoneLogin.consent">{{ qqPhoneLogin.busy ? '正在处理…' : '验证并登录' }}</button>
            <p v-if="qqPhoneLogin.message" class="qr-tip" role="status" aria-live="polite">{{ qqPhoneLogin.message }}</p>
            <a v-if="qqPhoneLogin.securityURL" :href="qqPhoneLogin.securityURL" target="_blank" rel="noopener noreferrer">打开 QQ 官方安全验证</a>
          </form>
          <div v-else-if="loginMode === 'qr'" class="qq-inline-qr qr-login" :class="{ 'qq-qr-wechat': qqOfficialMode === 'wechat' }">
            <div class="qq-scan-heading"><span class="qq-scan-eyebrow">QQ MUSIC · 安全扫码</span><h3>{{ qqOfficialMode === 'wechat' ? '微信扫一扫，音乐即刻回来' : '用手机 QQ，连接你的音乐' }}</h3></div>
            <div class="qq-qr-frame">
              <img v-if="qqQrLogin.image" :src="qqQrLogin.image" :alt="qqOfficialMode === 'wechat' ? '微信官方登录二维码' : 'QQ 官方登录二维码'" :class="{ blur: ['expired','cancelled','error'].includes(qqQrLogin.status) }" />
              <div v-else class="qq-qr-placeholder"><QrCode :size="42" /><span>{{ qqQrLogin.status === 'loading' ? '正在准备官方二维码…' : '二维码暂不可用' }}</span></div>
              <div v-if="['scanned','confirming','expired','cancelled','error'].includes(qqQrLogin.status)" class="qq-qr-state">
                <template v-if="['scanned','confirming'].includes(qqQrLogin.status)"><Smartphone :size="30" /><strong>{{ qqQrLogin.status === 'confirming' ? '正在连接音乐账号' : '已扫码，请在手机确认' }}</strong></template>
                <template v-else><QrCode :size="30" /><strong>{{ qqQrLogin.status === 'expired' ? '二维码已过期' : '请刷新二维码' }}</strong><button type="button" @click="qqQrLogin.start(qqOfficialMode)">重新获取</button></template>
              </div>
            </div>
            <p class="qq-scan-status" role="status" aria-live="polite">{{ qqQrLogin.message }}</p>
            <button v-if="['waiting','loading'].includes(qqQrLogin.status)" type="button" class="qq-qr-refresh" :disabled="qqQrLogin.status === 'loading'" @click="qqQrLogin.start(qqOfficialMode)">刷新二维码</button>
            <p class="qq-scan-account-tip">QQ 与微信可能对应不同歌单，请选择常用的音乐账号。</p>
          </div>
          <!-- Cookie 登录 -->
          <div v-else-if="loginMode === 'cookie'" class="form">
            <div class="info-box">
              <Info :size="14" />
              <span>粘贴包含 qm_keyst 的 QQ 音乐 Cookie</span>
            </div>
            <div class="input-item">
              <textarea v-model="qqCookieInput" placeholder="在此粘贴 QQ 音乐 Cookie(含 qm_keyst)" rows="5"></textarea>
            </div>
            <button class="login-btn" :disabled="loading" @click="handleQQCookieLogin">
              {{ loading ? '正在验证...' : '登录' }}
            </button>
          </div>
        </div>
      </template>

      <!-- 酷狗概念版平台：扫码 + 手机 + 用户名 + Cookie -->
      <template v-else-if="isKugou">
        <div class="login-tabs">
          <div class="tab" :class="{ active: loginMode === 'qr' }" @click="loginMode = 'qr'">
            <QrCode :size="16" />
            扫码
          </div>
          <div class="tab" :class="{ active: loginMode === 'phone' }" @click="loginMode = 'phone'">
            <Smartphone :size="16" />
            手机
          </div>
          <div class="tab" :class="{ active: loginMode === 'username' }" @click="loginMode = 'username'">
            <User :size="16" />
            用户名
          </div>
          <div class="tab" :class="{ active: loginMode === 'cookie' }" @click="loginMode = 'cookie'">
            <FileCode :size="16" />
            Cookie
          </div>
        </div>

        <div class="content">
          <!-- 概念版扫码登录 -->
          <div v-if="loginMode === 'qr'" class="qr-login">
            <div class="qr-container">
              <img :src="kugouQrImg" v-if="kugouQrImg" :class="{ blur: kugouQrStatus === 4 || kugouQrMessage.includes('过期') }" />
              <div class="qr-overlay" v-if="kugouQrStatus === 4">
                <div class="success-icon">✓</div>
                <p>登录成功</p>
              </div>
              <div class="qr-overlay" v-if="kugouQrMessage.includes('过期')">
                <p>二维码已过期</p>
                <button @click="startKugouQrLogin">刷新</button>
              </div>
            </div>
            <p class="qr-tip">{{ kugouQrMessage || '请使用酷狗概念版 APP 扫码' }}</p>
            <button class="login-btn" :disabled="kugouQrMessage === '正在生成二维码…'" @click="startKugouQrLogin">刷新二维码</button>
          </div>

          <!-- 手机号 + 验证码 -->
          <div v-if="loginMode === 'phone'" class="form">
            <div class="input-item">
              <input type="text" v-model="kugouPhone" placeholder="请输入手机号" />
            </div>
            <div class="input-item captcha-group">
              <input type="text" v-model="kugouCode" placeholder="验证码" />
              <button class="captcha-btn" :disabled="kugouCodeCountdown > 0" @click="sendKugouCode">
                {{ kugouCodeCountdown > 0 ? `${kugouCodeCountdown}s` : '获取验证码' }}
              </button>
            </div>
            <button class="login-btn" :disabled="kugouUserStore.logining" @click="doKugouPhoneLogin">
              {{ kugouUserStore.logining ? '正在登录...' : '登录' }}
            </button>
          </div>

          <!-- 用户名 + 密码 -->
          <div v-if="loginMode === 'username'" class="form">
            <div class="info-box">
              <Info :size="14" />
              <span>用户名登录可能需要验证，推荐使用扫码或手机登录</span>
            </div>
            <div class="input-item">
              <input type="text" v-model="kugouUsername" placeholder="请输入用户名" />
            </div>
            <div class="input-item">
              <input type="password" v-model="kugouPassword" placeholder="请输入密码" />
            </div>
            <button class="login-btn" :disabled="kugouUserStore.logining" @click="doKugouUsernameLogin">
              {{ kugouUserStore.logining ? '正在登录...' : '登录' }}
            </button>
          </div>

          <!-- Cookie/Token 登录 -->
          <div v-if="loginMode === 'cookie'" class="form">
            <div class="info-box">
              <Info :size="14" />
              <span>粘贴完整的 "token=xxx; userid=xxx"，官方验证通过后登录</span>
            </div>
            <div class="input-item">
              <textarea v-model="kugouCookieInput" placeholder="token=你的 token; userid=你的用户 ID" rows="4"></textarea>
            </div>
            <button class="login-btn" :disabled="kugouUserStore.logining" @click="doKugouCookieLogin">
              {{ kugouUserStore.logining ? '正在验证...' : '登录' }}
            </button>
          </div>
        </div>
      </template>

      <!-- 网易云平台：4 种登录方式 -->
      <template v-else>
        <div class="login-tabs">
          <div class="tab" :class="{ active: loginMode === 'qr' }" @click="loginMode = 'qr'">
            <QrCode :size="16" />
            扫码登录
          </div>
          <div class="tab" :class="{ active: loginMode === 'phone' }" @click="loginMode = 'phone'">
            <Smartphone :size="16" />
            手机登录
          </div>
          <div class="tab" :class="{ active: loginMode === 'email' }" @click="loginMode = 'email'">
            <Mail :size="16" />
            邮箱登录
          </div>
          <div class="tab" :class="{ active: loginMode === 'cookie' }" @click="loginMode = 'cookie'">
            <FileCode :size="16" />
            Cookie
          </div>
        </div>

        <div class="content">
          <!-- QR Code Login -->
          <div v-if="loginMode === 'qr'" class="qr-login">
            <div class="qr-container">
              <img :src="qrImg" v-if="qrImg" :class="{ blur: qrStatus === 800 || qrStatus === 802 }" />
              <div class="qr-overlay" v-if="qrStatus === 800">
                <p>二维码已过期</p>
                <button @click="startQrPolling">刷新</button>
              </div>
              <div class="qr-overlay" v-if="qrStatus === 802">
                <div class="success-icon">✓</div>
                <p>扫描成功</p>
                <p class="sub">请在手机上确认登录</p>
              </div>
            </div>
            <p class="qr-tip" v-if="qrStatus === 801">{{ qrTipText }}</p>
            <p v-if="qrError" class="qr-tip" role="alert">{{ qrError }} <button @click="startQrPolling">重试</button></p>
          </div>

          <!-- Phone Login -->
          <div v-if="loginMode === 'phone'" class="form">
            <div class="input-item">
              <input type="text" v-model="phone" placeholder="请输入手机号" />
            </div>
            <div class="input-item" v-if="!isCaptchaMode">
              <input type="password" v-model="password" placeholder="请输入密码" />
            </div>
            <div class="input-item captcha-group" v-else>
              <input type="text" v-model="captcha" placeholder="验证码" />
              <button class="captcha-btn" :disabled="captchaTimer > 0" @click="handleSendCaptcha">
                {{ captchaTimer > 0 ? `${captchaTimer}s` : '获取验证码' }}
              </button>
            </div>
            <div class="form-options">
              <span @click="isCaptchaMode = !isCaptchaMode">
                {{ isCaptchaMode ? '使用密码登录' : '使用验证码登录' }}
              </span>
            </div>
            <button class="login-btn" :disabled="loading" @click="handlePhoneLogin">
               {{ loading ? '正在登录...' : '登录' }}
            </button>
          </div>

          <!-- Email Login -->
          <div v-if="loginMode === 'email'" class="form">
            <div class="input-item">
              <input type="email" v-model="email" placeholder="请输入网易邮箱" />
            </div>
            <div class="input-item">
              <input type="password" v-model="password" placeholder="请输入密码" />
            </div>
            <button class="login-btn" :disabled="loading" @click="handleEmailLogin">
               {{ loading ? '正在登录...' : '登录' }}
            </button>
          </div>

          <!-- Cookie Login -->
          <div v-if="loginMode === 'cookie'" class="form">
              <div class="info-box">
                  <Info :size="14" />
                  <span>贴入包含 MUSIC_U 的原始 Cookie</span>
              </div>
              <div class="input-item">
                  <textarea v-model="cookieInput" placeholder="在此粘贴 Cookie" rows="4"></textarea>
              </div>
              <button class="login-btn" :disabled="loading" @click="handleCookieLogin">
                   {{ loading ? '正在验证...' : '登录' }}
              </button>
          </div>
        </div>
      </template>
    </div>
  </div>
  </Transition>

    <!-- 酷狗多账户选择弹窗（手机号关联多个账户时显示） -->
    <Transition name="modal-pop">
    <div v-if="showKugouAccountPicker" class="account-picker-overlay" @click.self="cancelKugouAccountPicker">
      <div class="account-picker-modal modal-panel">
        <div class="account-picker-header">
          <span class="account-picker-title">请选择要登录的账户</span>
          <X :size="18" class="account-picker-close" @click="cancelKugouAccountPicker" />
        </div>
        <div class="account-picker-body">
          <p class="account-picker-tip">该手机号关联了 {{ kugouMultiAccounts.length }} 个酷狗账户，请选择要登录的账户：</p>
          <div
            v-for="acc in kugouMultiAccounts"
            :key="acc.userid"
            class="account-picker-item"
            :class="{ disabled: kugouAccountPicking }"
            @click="pickKugouAccount(acc)"
          >
            <img v-if="acc.pic" :src="acc.pic" class="account-picker-avatar" referrerpolicy="no-referrer" @error="$event.target.style.display='none'" />
            <div v-else class="account-picker-avatar placeholder">
              <User :size="20" />
            </div>
            <div class="account-picker-info">
              <div class="account-picker-name">{{ acc.username || '未设置昵称' }}</div>
              <div class="account-picker-meta">ID: {{ acc.userid }}<span v-if="acc.mobile"> · {{ acc.mobile }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.login-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2100;
  backdrop-filter: blur(4px);
}

.login-modal {
  width: 380px;
  max-width: calc(100vw - 32px);
  background: var(--bg-main);
  color: var(--text-main);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0,0,0,0.3);
}

.header {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header .title {
    font-size: 16px;
    font-weight: 600;
}

.close-btn {
  cursor: pointer;
  color: #999;
}

.login-tabs {
    display: flex;
    border-bottom: 1px solid #f0f0f0;
}

.tab {
    font-family: inherit;
    background: transparent;
    border: 0;
    flex: 1;
    padding: 12px 0;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
}

.tab:hover {
    color: var(--primary-color);
}

.tab.active {
    color: var(--primary-color);
    border-bottom-color: var(--primary-color);
    font-weight: 600;
}

.content {
  padding: 30px 40px;
  min-height: 260px;
  display: flex;
  flex-direction: column;
}

.qr-login {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 15px;
}

.qr-container {
    width: 180px;
    height: 180px;
    position: relative;
    border: 1px solid #eee;
    padding: 10px;
    background: white;
}

.qr-container img {
    width: 100%;
    height: 100%;
}

.qr-container img.blur {
    filter: blur(8px);
    opacity: 0.3;
}

.qr-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #ccc;
    font-size: 13px;
}

.qr-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    width: 100%;
}

.qr-overlay p {
    font-size: 14px;
    color: #333;
    margin-bottom: 10px;
}

.qr-overlay button {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 6px 15px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 13px;
}

.qr-overlay .success-icon {
    width: 40px;
    height: 40px;
    background: #52c41a;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    margin: 0 auto 10px;
}

.qr-tip {
    font-size: 13px;
    color: #666;
}

.form {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.input-item {
    border: 1px solid #ddd;
    border-radius: 6px;
    overflow: hidden;
}

.qq-native-phone{gap:16px}
.qq-phone-code{display:flex;align-items:center;gap:10px}
.qq-phone-code input{min-width:0;flex:1}
.qq-phone-code button{flex-shrink:0;padding:10px 12px;border:0;border-radius:9px;background:color-mix(in srgb,var(--primary-color) 12%,var(--bg-main));color:var(--primary-color);font:inherit;font-size:12px;cursor:pointer}
.qq-phone-code button:disabled{opacity:.45;cursor:not-allowed}
.qq-phone-consent{display:block;color:var(--text-secondary);font-size:11px;line-height:1.8;text-align:left}
.qq-phone-consent input{vertical-align:middle;margin:0 6px 0 0;accent-color:var(--primary-color)}
.qq-phone-consent a{color:var(--primary-color);text-decoration:none;margin:0 3px}
.qq-phone-code button:focus-visible,.qq-phone-consent a:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}

.input-item input, .input-item textarea {
    width: 100%;
    border: none;
    outline: none;
    padding: 12px;
    font-size: 14px;
    color: var(--text-main);
    background: var(--bg-main);
}

.soda-login-modal{width:430px;border-radius:22px;border:1px solid var(--border-color);box-shadow:0 24px 80px #143f3726}
.soda-login-modal .header{padding:26px 28px 9px;background:transparent;color:var(--text-main);height:auto}
.soda-login-modal .header .title{font-size:21px;letter-spacing:-.03em}
.soda-login-intro{padding:0 28px 22px;font-size:12px;color:var(--text-secondary)}
.soda-login-modal .login-tabs{margin:0 28px;padding:5px;gap:5px;border:1px solid var(--border-color);border-radius:13px;background:var(--hover-bg)}
.soda-login-modal .tab{padding:11px 8px;border-radius:9px;border-bottom:0;transition:background .18s,color .18s,box-shadow .18s}
.soda-login-modal .tab.active{background:var(--bg-main);box-shadow:0 2px 8px #143f3710;color:var(--primary-color)}
.soda-login-modal .tab:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.soda-login-modal .content{padding:24px 28px 8px;min-height:290px}
.soda-login-copy h3{margin:0 0 8px;font-size:14px;font-weight:600}
.soda-login-modal .qr-tip{font-size:12px;line-height:1.8;color:var(--text-secondary)}
.soda-login-modal .input-item{border-color:var(--border-color);border-radius:12px;background:var(--bg-main)}
.soda-login-modal .input-item:focus-within{border-color:var(--primary-color);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary-color) 12%,transparent)}
.soda-login-modal textarea{resize:vertical;min-height:105px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7}
.soda-login-modal .login-btn{border-radius:12px;margin-top:0;padding:13px;transition:filter .18s}
.soda-login-modal .login-btn:hover:not(:disabled){filter:brightness(1.08)}
.soda-login-modal .qr-container{width:202px;height:202px;border:8px solid white;border-radius:16px;padding:6px;background:white;box-shadow:0 0 0 1px var(--border-color)}
.soda-login-modal .qr-login .login-btn{width:auto;background:var(--hover-bg);color:var(--primary-color);font-size:12px;padding:9px 18px}
.soda-login-footnote{display:flex;align-items:center;justify-content:center;gap:6px;padding:16px 28px 23px;font-size:11px;color:var(--text-secondary)}
.soda-cookie-fallback{border:0;background:transparent;color:var(--primary-color);font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.soda-login-modal .login-tabs .tab{flex-direction:column;gap:6px;font-size:12px;white-space:nowrap}
.soda-phone-form .soda-phone-number .soda-country-code{flex:0 0 52px;width:52px;padding-right:10px;margin-right:10px;border-right:1px solid var(--border-color);border-radius:0}
.soda-phone-form .input-item input{min-width:0}
.soda-send-code{flex-shrink:0;background:transparent;border:0;border-left:1px solid var(--border-color);padding:0 0 0 12px;color:var(--primary-color);font-size:12px;cursor:pointer}
.soda-phone-form button:disabled{opacity:.45;cursor:not-allowed}
.soda-login-agreement{display:flex;gap:7px;align-items:flex-start;margin:2px 0 18px;font-size:11px;line-height:1.7;color:var(--text-secondary)}
.soda-login-agreement input{margin:3px 0 0;accent-color:var(--primary-color)}
.soda-login-agreement a{color:var(--primary-color);text-underline-offset:3px}
.soda-phone-help{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:15px 0 5px;font-size:11px;color:var(--text-secondary)}
.soda-phone-help button{padding:3px 0;border:0;background:transparent;color:var(--primary-color);font-size:11px;cursor:pointer}
.soda-phone-message{margin-bottom:0;line-height:1.8}
.soda-account-choices{display:grid;gap:8px}
.soda-account-choices p{margin:0 0 3px;color:var(--text-secondary);font-size:12px}
.soda-account-choices button{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-main);color:var(--text-main);cursor:pointer}
.soda-account-choices button span:first-of-type{flex:1;overflow:hidden;text-overflow:ellipsis;text-align:left;white-space:nowrap}
.soda-account-choices button span:last-child{font-size:11px;color:var(--primary-color)}

.captcha-group {
    display: flex;
}

.captcha-btn {
    border: none;
    background: none;
    color: #507DAF;
    padding: 0 15px;
    font-size: 13px;
    cursor: pointer;
    border-left: 1px solid #ddd;
}

.captcha-btn:disabled {
    color: #999;
}

.form-options {
    text-align: right;
}

.form-options span {
    color: #666;
    font-size: 12px;
    cursor: pointer;
}

.form-options span:hover {
    color: var(--primary-color);
}

.login-btn {
  width: 100%;
  background-color: var(--primary-color);
  color: white;
  border: none;
  padding: 12px;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 10px;
}

.login-btn:disabled {
    opacity: 0.6;
}

.info-box {
    background-color: #f0f7ff;
    padding: 8px 12px;
    border-radius: 4px;
    color: #0056b3;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
}

/* 酷狗多账户选择弹窗 */
.account-picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
}
.account-picker-modal {
    background: #fff;
    border-radius: 12px;
    width: 380px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
    animation: account-picker-in 0.2s ease;
}
@keyframes account-picker-in {
    from { opacity: 0; transform: scale(0.95) translateY(-10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}
.account-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #f0f0f0;
}
.account-picker-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
}
.account-picker-close {
    color: #999;
    cursor: pointer;
    transition: color 0.15s, transform 0.15s;
}
.account-picker-close:hover {
    color: #333;
    transform: rotate(90deg);
}
.account-picker-body {
    padding: 16px 20px;
    overflow-y: auto;
}
.account-picker-tip {
    font-size: 12px;
    color: #999;
    margin-bottom: 12px;
    line-height: 1.5;
}
.account-picker-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    margin-bottom: 6px;
}
.account-picker-item:hover {
    background: rgba(44, 162, 245, 0.08);
}
.account-picker-item.disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
}
.account-picker-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: #f5f5f5;
}
.account-picker-avatar.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
}
.account-picker-info {
    flex: 1;
    min-width: 0;
}
.account-picker-name {
    font-size: 14px;
    color: #333;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.account-picker-meta {
    font-size: 12px;
    color: #999;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
<style scoped>
.qq-inline-qr{padding:7px 0 10px;gap:0}.qq-scan-heading{text-align:center;margin-bottom:22px}.qq-scan-eyebrow{font-size:10px;letter-spacing:1.8px;color:var(--primary-color)}.qq-scan-heading h3{font-size:17px;letter-spacing:.2px;font-weight:600;margin:9px 0 0;color:var(--text-main)}.qq-qr-frame{width:208px;height:208px;position:relative;box-sizing:border-box;border:12px solid #fff;border-radius:20px;background:white;box-shadow:0 8px 32px #00000012,0 0 0 1px var(--border-color);overflow:hidden}.qq-qr-frame>img{width:100%;height:100%;object-fit:contain}.qq-qr-frame>img.blur{filter:blur(5px);opacity:.35}.qq-qr-placeholder{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#66706b;font-size:11px}.qq-qr-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:#ffffffed;color:#233b31}.qq-qr-state strong{font-size:13px}.qq-qr-state button{border:0;border-radius:9px;padding:9px 17px;background:#147b50;color:white;cursor:pointer}.qq-scan-status{margin:20px 0 8px;max-width:310px;text-align:center;font-size:12px;color:var(--text-secondary);line-height:1.8}.qq-qr-refresh{border:0;background:none;color:var(--primary-color);font:inherit;font-size:12px;cursor:pointer;padding:7px 12px}.qq-qr-refresh:disabled{opacity:.5;cursor:wait}.qq-scan-account-tip{font-size:11px;line-height:1.8;margin:18px 12px 0;color:var(--text-secondary);text-align:center}.qq-qr-frame button:focus-visible,.qq-qr-refresh:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
</style>
