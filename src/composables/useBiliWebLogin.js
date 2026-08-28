// B站 Web 账号扫码登录（与网址解析的「B站登录」共用 bilibili-cookie.json）
// B站区用它解锁：搜索稳定访问、收藏夹浏览
import { ref, computed, onUnmounted } from 'vue'
import { biliLoginQr, biliLoginCheck, biliLoginStatus, biliLogout } from '../api'

export function useBiliWebLogin(messageStore) {
    const biliWebLoggedIn = ref(false)
    const biliWebUserInfo = ref(null)
    const showBiliWebQr = ref(false)
    const webQrUrl = ref('')
    const webQrKey = ref('')
    const webQrStatus = ref('')  // '' | 'waiting' | 'scanned' | 'expired' | 'error'
    const webQrError = ref('')
    let webPollTimer = null
    const webQrImgUrl = computed(() => {
        if (!webQrUrl.value) return ''
        return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(webQrUrl.value)}`
    })

    async function loadWebStatus() {
        try {
            const res = await biliLoginStatus()
            if (res?.success && res.loggedIn) {
                biliWebLoggedIn.value = true
                biliWebUserInfo.value = res.userInfo || null
            } else {
                biliWebLoggedIn.value = false
                biliWebUserInfo.value = null
            }
        } catch (e) {}
    }

    async function handleWebLogin() {
        // 已登录则提示
        try {
            const st = await biliLoginStatus()
            if (st?.success && st.loggedIn) {
                const uname = st.userInfo?.uname || ''
                const ok = await messageStore.confirm(`已登录B站账号「${uname}」，是否退出登录？`, '账号管理')
                if (!ok) return
                await biliLogout()
                biliWebLoggedIn.value = false
                biliWebUserInfo.value = null
                messageStore.success('已退出B站登录')
                return
            }
        } catch (e) {}
        openWebQr()
    }

    async function openWebQr() {
        if (showBiliWebQr.value) return
        showBiliWebQr.value = true
        webQrStatus.value = ''
        webQrError.value = ''
        try {
            const res = await biliLoginQr()
            if (res?.success) {
                webQrUrl.value = res.qrcodeUrl
                webQrKey.value = res.qrcodeKey
                webQrStatus.value = 'waiting'
                startWebPoll()
            } else {
                webQrStatus.value = 'error'
                webQrError.value = res?.message || '获取二维码失败'
            }
        } catch (e) {
            webQrStatus.value = 'error'
            webQrError.value = e.message || '获取二维码失败'
        }
    }

    function startWebPoll() {
        stopWebPoll()
        webPollTimer = setInterval(async () => {
            try {
                const res = await biliLoginCheck(webQrKey.value)
                if (res?.loggedIn) {
                    stopWebPoll()
                    biliWebLoggedIn.value = true
                    showBiliWebQr.value = false
                    await loadWebStatus()
                    messageStore.success('B站登录成功，搜索与收藏夹已解锁', 3000)
                } else if (res?.status === 'scanned') {
                    webQrStatus.value = 'scanned'
                } else if (res?.status === 'expired') {
                    stopWebPoll()
                    webQrStatus.value = 'expired'
                }
            } catch (e) {}
        }, 2000)
    }

    function stopWebPoll() {
        if (webPollTimer) { clearInterval(webPollTimer); webPollTimer = null }
    }

    function closeWebQr() {
        showBiliWebQr.value = false
        stopWebPoll()
    }

    async function refreshWebQr() {
        stopWebPoll()
        await openWebQr()
    }

    function onWebAvatarError() {
        if (biliWebUserInfo.value) biliWebUserInfo.value = { ...biliWebUserInfo.value, face: '' }
    }

    onUnmounted(() => {
        stopWebPoll()
    })

    return {
        biliWebLoggedIn, biliWebUserInfo,
        showBiliWebQr, webQrImgUrl, webQrStatus, webQrError,
        loadWebStatus, handleWebLogin, closeWebQr, refreshWebQr, onWebAvatarError
    }
}
