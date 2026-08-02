<script setup>
import { ref, onUnmounted, watch, computed } from 'vue'
import { X, QrCode, Smartphone, Mail, FileCode, Info } from 'lucide-vue-next'
import { useUserStore } from '../store/user'
import { useQQUserStore } from '../store/qq-user'
import { usePlatformStore } from '../store/platform'
import { useMessageStore } from '../store/message'

const props = defineProps(['show'])
const emit = defineEmits(['close'])

const userStore = useUserStore()
const qqUserStore = useQQUserStore()
const platformStore = usePlatformStore()
const messageStore = useMessageStore()
const loading = ref(false)
const loginMode = ref('qr') // qr, phone, email, cookie

// 是否 QQ 平台
const isQQ = computed(() => platformStore.isQQ)
const modalTitle = computed(() => isQQ.value ? '登录 QQ 音乐' : '登录网易云音乐')
const qrTipText = computed(() => isQQ.value ? '请使用 QQ APP 扫码（不支持微信/QQ音乐扫码）' : '请使用网易云音乐 APP 扫码')

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

// ===== 网易云扫码 =====
const startQrPolling = async () => {
    stopQrPolling()
    if (isQQ.value) return // QQ 走官网登录逻辑
    const data = await userStore.getQrCodeData()
    if (!data) return
    qrKey.value = data.unikey
    qrImg.value = data.qrimg
    qrStatus.value = 801

    qrTimer = setInterval(async () => {
        const res = await userStore.checkQrCodeStatus(qrKey.value)
        qrStatus.value = res.code
        if (res.code === 803) {
            stopQrPolling()
            messageStore.success('登录成功，欢迎回来', 3000, userStore.profile)
            emit('close')
        } else if (res.code === 800) {
            stopQrPolling()
        }
    }, 3000)
}

const stopQrPolling = () => {
    if (qrTimer) {
        clearInterval(qrTimer)
        qrTimer = null
    }
}

// ===== QQ 官网扫码登录 =====
// 不再使用 API 二维码(API 登录 cookie 缺失 qqmusic_key 导致播放被限制)
// 改为打开 y.qq.com 官网登录页,扫码后采集完整 cookie
const qqLogining = ref(false)
const qqLoginMessage = ref('')
const qqCookieInput = ref('')

const startQQWebLogin = async () => {
    if (qqLogining.value) return
    qqLogining.value = true
    qqLoginMessage.value = '正在打开 QQ 音乐官网登录页,请在弹出的窗口中扫码...'
    try {
        const res = await qqUserStore.webLogin()
        if (res?.success) {
            qqLoginMessage.value = '登录成功'
            messageStore.success('QQ 音乐登录成功，欢迎回来', 3000, qqUserStore.profile)
            emit('close')
        } else {
            qqLoginMessage.value = res?.message || '登录失败'
            messageStore.error(qqLoginMessage.value)
        }
    } catch (e) {
        qqLoginMessage.value = e?.message || '登录异常'
        messageStore.error(qqLoginMessage.value)
    } finally {
        qqLogining.value = false
    }
}

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

// 统一启动扫码（按平台分发）
const startPlatformQr = () => {
    if (isQQ.value) {
        // QQ 平台不在弹窗内显示二维码,改为提示用户点击按钮触发官网登录
        // 用户点击 login-modal 中的"打开官网登录"按钮时调用 startQQWebLogin
    } else {
        startQrPolling()
    }
}

const stopAllPolling = () => {
    stopQrPolling()
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
    const res = await userStore.loginWithCookie(input)
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
})

watch(loginMode, (newVal) => {
    if (newVal === 'qr') startPlatformQr()
    else stopAllPolling()
})

// 平台切换时重置登录态
watch(isQQ, (val) => {
    stopAllPolling()
    loginMode.value = 'qr'
    qrImg.value = ''
    qrStatus.value = 0
    qqLoginMessage.value = ''
    if (props.show) startPlatformQr()
})

onUnmounted(() => stopAllPolling())
</script>

<template>
  <div class="login-modal-overlay" v-if="show" @click.self="emit('close')">
    <div class="login-modal">
      <div class="header">
        <span class="title">{{ modalTitle }}</span>
        <X class="close-btn" @click="emit('close')" />
      </div>

      <!-- QQ 平台：官网扫码登录 + Cookie 登录 -->
      <template v-if="isQQ">
        <div class="login-tabs">
          <div class="tab" :class="{ active: loginMode === 'qr' }" @click="loginMode = 'qr'">
            <QrCode :size="16" />
            官网扫码
          </div>
          <div class="tab" :class="{ active: loginMode === 'cookie' }" @click="loginMode = 'cookie'">
            <FileCode :size="16" />
            Cookie 登录
          </div>
        </div>
        <div class="content">
          <!-- 官网扫码登录 -->
          <div v-if="loginMode === 'qr'" class="qq-web-login">
            <div class="qq-web-login-icon">
              <QrCode :size="64" color="#31C27C" />
            </div>
            <p class="qq-web-login-title">QQ 音乐官网扫码登录</p>
            <p class="qq-web-login-tip">
              点击下方按钮将打开 QQ 音乐官网登录页面<br/>
              请使用 <strong>QQ APP</strong> 扫码完成登录<br/>
              登录成功后窗口会自动关闭
            </p>
            <p class="qq-web-login-warn">
              <Info :size="12" />
              必须通过官网登录才能获取完整鉴权 cookie,否则播放链接将被限制
            </p>
            <button class="login-btn qq-web-login-btn" :disabled="qqLogining" @click="startQQWebLogin">
              {{ qqLogining ? '正在登录...' : '打开官网登录' }}
            </button>
            <p class="qq-web-login-msg" v-if="qqLoginMessage">{{ qqLoginMessage }}</p>
          </div>
          <!-- Cookie 登录 -->
          <div v-if="loginMode === 'cookie'" class="form">
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
  background: white;
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
    flex: 1;
    padding: 12px 0;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    color: #666;
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

.input-item input, .input-item textarea {
    width: 100%;
    border: none;
    outline: none;
    padding: 12px;
    font-size: 14px;
}

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

/* ===== QQ 官网登录 ===== */
.qq-web-login {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
}

.qq-web-login-icon {
    margin-bottom: 4px;
}

.qq-web-login-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
}

.qq-web-login-tip {
    font-size: 13px;
    color: #666;
    text-align: center;
    line-height: 1.7;
}

.qq-web-login-tip strong {
    color: #31C27C;
}

.qq-web-login-warn {
    font-size: 12px;
    color: #fa8c16;
    background: #fff7e6;
    padding: 8px 10px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    line-height: 1.5;
}

.qq-web-login-btn {
    width: 80%;
    background-color: #31C27C;
    margin-top: 8px;
}

.qq-web-login-btn:hover:not(:disabled) {
    background-color: #28a76b;
}

.qq-web-login-msg {
    font-size: 12px;
    color: #999;
    text-align: center;
    min-height: 16px;
}
</style>
