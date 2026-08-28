// B站TV 端登录逻辑（云视听小电视 access_key，解锁 TV 接口 1080P+）
// 供 B站视频专区首页/详情页共用（逻辑与动漫专区 Anime.vue 一致）
import { ref, computed, onUnmounted } from 'vue'
import { biliTvLoginQr, biliTvLoginCheck, biliTvLoginStatus, biliTvLogout, biliLoginStatus } from '../api'

export function useBiliTvLogin(messageStore) {
    const biliTvLoggedIn = ref(false)
    const biliTvMid = ref('')
    const biliTvUserInfo = ref(null)
    const showBiliTvQr = ref(false)
    const biliTvQrUrl = ref('')
    const biliTvAuthCode = ref('')
    const biliTvLocalId = ref('')
    const biliTvQrStatus = ref('')  // '' | 'waiting' | 'scanned' | 'expired' | 'error'
    const biliTvQrError = ref('')
    let biliTvPollTimer = null
    const biliTvQrImgUrl = computed(() => {
        if (!biliTvQrUrl.value) return ''
        return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(biliTvQrUrl.value)}`
    })

    async function loadBiliTvStatus() {
        try {
            const res = await biliTvLoginStatus()
            if (res?.success && res.loggedIn) {
                biliTvLoggedIn.value = true
                biliTvMid.value = res.mid || ''
                biliTvUserInfo.value = res.userInfo || null
            } else {
                biliTvLoggedIn.value = false
                biliTvMid.value = ''
                biliTvUserInfo.value = null
            }
        } catch (e) {}
    }

    // 点击登录胶囊：先检测网址解析登录状态 → 已登录提示复用 / 未登录扫码
    async function handleBiliLogin() {
        try {
            const tv = await biliTvLoginStatus()
            if (tv?.success && tv.loggedIn) {
                const uname = tv.userInfo?.uname || tv.mid || ''
                const ok = await messageStore.confirm(`检测到网址解析已登录 B站TV 账号「${uname}」，是否使用该账号？`, '使用已有账号')
                if (ok) {
                    biliTvLoggedIn.value = true
                    biliTvMid.value = tv.mid || ''
                    biliTvUserInfo.value = tv.userInfo || null
                    messageStore.success(`已使用 TV 账号「${uname}」`, 2500)
                    return
                }
            } else {
                const web = await biliLoginStatus()
                if (web?.success && web.loggedIn) {
                    const uname = web.userInfo?.uname || ''
                    const ok = await messageStore.confirm(
                        `已检测到网址解析的 B站网页账号「${uname}」。TV 接口需 TV 端账号才能解锁高清，是否现在打开 TV 扫码登录？`,
                        'TV端登录'
                    )
                    if (!ok) return
                }
            }
            openBiliTvQr()
        } catch (e) {
            openBiliTvQr()
        }
    }

    async function openBiliTvQr() {
        if (showBiliTvQr.value) return
        showBiliTvQr.value = true
        biliTvQrStatus.value = ''
        biliTvQrError.value = ''
        try {
            const res = await biliTvLoginQr()
            if (res?.success) {
                biliTvQrUrl.value = res.qrcodeUrl
                biliTvAuthCode.value = res.authCode
                biliTvLocalId.value = res.localId
                biliTvQrStatus.value = 'waiting'
                startBiliTvPoll()
            } else {
                biliTvQrStatus.value = 'error'
                biliTvQrError.value = res?.message || '获取二维码失败'
            }
        } catch (e) {
            biliTvQrStatus.value = 'error'
            biliTvQrError.value = e.message || '获取二维码失败'
        }
    }

    function startBiliTvPoll() {
        stopBiliTvPoll()
        biliTvPollTimer = setInterval(async () => {
            try {
                const res = await biliTvLoginCheck({ authCode: biliTvAuthCode.value, localId: biliTvLocalId.value })
                if (res?.loggedIn) {
                    stopBiliTvPoll()
                    biliTvLoggedIn.value = true
                    showBiliTvQr.value = false
                    await loadBiliTvStatus()
                    messageStore.success('TV端登录成功，TV 接口已解锁高清', 3000)
                } else if (res?.status === 'scanned') {
                    biliTvQrStatus.value = 'scanned'
                } else if (res?.status === 'expired') {
                    stopBiliTvPoll()
                    biliTvQrStatus.value = 'expired'
                }
            } catch (e) {}
        }, 2000)
    }

    function stopBiliTvPoll() {
        if (biliTvPollTimer) { clearInterval(biliTvPollTimer); biliTvPollTimer = null }
    }

    function closeBiliTvQr() {
        showBiliTvQr.value = false
        stopBiliTvPoll()
    }

    async function refreshBiliTvQr() {
        stopBiliTvPoll()
        await openBiliTvQr()
    }

    async function logoutBiliTv() {
        if (!await messageStore.confirm('确定退出 TV 端登录？TV 接口将回落 720P。', '退出TV登录')) return
        try {
            await biliTvLogout()
            biliTvLoggedIn.value = false
            biliTvMid.value = ''
            biliTvUserInfo.value = null
            messageStore.success('已退出 TV 端登录')
        } catch (e) { messageStore.error('退出失败') }
    }

    function onTvAvatarError() {
        if (biliTvUserInfo.value) biliTvUserInfo.value = { ...biliTvUserInfo.value, face: '' }
    }

    onUnmounted(() => {
        stopBiliTvPoll()
    })

    return {
        biliTvLoggedIn, biliTvMid, biliTvUserInfo,
        showBiliTvQr, biliTvQrImgUrl, biliTvQrStatus, biliTvQrError,
        loadBiliTvStatus, handleBiliLogin, closeBiliTvQr, refreshBiliTvQr,
        logoutBiliTv, onTvAvatarError
    }
}
