<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { usePlayerStore } from '../store/player'
import { usePlatformStore } from '../store/platform'
import { useMessageStore } from '../store/message'
import { useUserStore } from '../store/user'
import { useQQUserStore } from '../store/qq-user'
import { useKugouUserStore } from '../store/kugou-user'
import {
    useSettingsStore,
    SHORTCUT_ITEMS,
    DEFAULT_SHORTCUTS,
    formatCombo,
    eventToCombo
} from '../store/settings'
import { API_LINES, switchApiLine } from '../api/index'
import { CheckSquare, Square, LogIn } from 'lucide-vue-next'
import { biliGetWebCookie, biliSetWebCookie, biliGetTvToken, biliSetTvToken } from '../api/index'

// ===== 侧边栏分区显示（设置不可隐藏） =====
const SIDEBAR_SECTIONS = [
    { id: '/', label: '发现音乐' },
    { id: '/video', label: 'MV' },
    { id: '/anime', label: '动漫区' },
    { id: '/movie', label: '影视区' },
    { id: '/bilibili', label: 'B站区' },
    { id: '/local', label: '本地音乐' },
    { id: '/local-video', label: '本地视频' },
    { id: '/recent', label: '最近播放' },
    { id: '/netease-cloud', label: '官方云盘' },
    { id: '/downloads', label: '下载' },
    { id: '/smart-edu', label: '智慧教材' },
]
const hiddenSections = ref(JSON.parse(localStorage.getItem('hidden_sections') || '[]'))
const isSectionHidden = (id) => hiddenSections.value.includes(id)

// ===== 设置二级导航（上方吸顶，点击滚动到对应卡片） =====
const sectionNav = ref([])
const activeSection = ref('')
function gotoSection(s) {
    activeSection.value = s.label
    s.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ===== 长按选择复制开关（关闭后全局禁止长按/拖动选中文本） =====
const longPressSelect = ref(localStorage.getItem('app_longpress_select') !== '0')
function applyLongPressSelect() {
    document.documentElement.classList.toggle('longpress-off', !longPressSelect.value)
}
function toggleLongPressSelect() {
    longPressSelect.value = !longPressSelect.value
    localStorage.setItem('app_longpress_select', longPressSelect.value ? '1' : '0')
    applyLongPressSelect()
}
function toggleSection(id) {
    hiddenSections.value = isSectionHidden(id)
        ? hiddenSections.value.filter(i => i !== id)
        : [...hiddenSections.value, id]
    localStorage.setItem('hidden_sections', JSON.stringify(hiddenSections.value))
    window.dispatchEvent(new Event('sections-changed'))
}

// ===== B站登录态（Web Cookie / TV Token） =====
const biliWebCookie = ref('')
const biliTvToken = ref('')
const biliCookieInput = ref('')
const showBiliCookieInput = ref(false)
const biliTvInput = ref('')
const showBiliTvInput = ref(false)
const biliAuthLoadError = ref('')
const loadBiliAuth = async () => {
    biliAuthLoadError.value = ''
    try {
        const [w, t] = await Promise.all([biliGetWebCookie(), biliGetTvToken()])
        biliWebCookie.value = w?.cookie || ''
        biliTvToken.value = t?.token || ''
    } catch (e) {
        // 典型原因：主进程为旧版本（未含读取接口），需重启应用
        biliAuthLoadError.value = '读取失败：' + (e.message || '未知错误') + '（若刚更新，请重启应用）'
    }
}
async function copyPlainText(text, tip) {
    if (!text) return
    try {
        await navigator.clipboard.writeText(text)
        messageStore.success(tip || '已复制到剪贴板', 1200)
    } catch (e) {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
            document.execCommand('copy')
            messageStore.success(tip || '已复制到剪贴板', 1200)
        } catch (err) {
            messageStore.error('复制失败，请手动选择文本复制')
        }
        document.body.removeChild(ta)
    }
}
async function biliTvTokenLogin() {
    const v = biliTvInput.value.trim()
    if (!v) return messageStore.warning('请先粘贴 TV Token')
    const res = await biliSetTvToken(v)
    if (res?.success) {
        messageStore.success('TV Token 登录成功')
        biliTvInput.value = ''
        showBiliTvInput.value = false
        loadBiliAuth()
    } else {
        messageStore.error(res?.message || 'TV Token 登录失败')
    }
}

async function biliCookieLogin() {
    const v = biliCookieInput.value.trim()
    if (!v) return messageStore.warning('请先粘贴 Cookie')
    const res = await biliSetWebCookie(v)
    if (res?.success) {
        messageStore.success('Cookie 登录成功')
        biliCookieInput.value = ''
        showBiliCookieInput.value = false
        loadBiliAuth()
    } else {
        messageStore.error(res?.message || 'Cookie 登录失败')
    }
}
import {
    kugouYouthVip,
    kugouYouthDayVip,
    kugouYouthDayVipUpgrade,
    kugouYouthMonthVipRecord,
    kugouYouthUnionVip
} from '../api/kugou'
import CustomSelect from '../components/CustomSelect.vue'
import {
    RotateCcw,
    Keyboard,
    Zap,
    SlidersHorizontal,
    Check,
    Copy,
    LogOut,
    User,
    Sparkles,
    CheckCircle2,
    AlertCircle,
    X,
    Download,
    FolderOpen,
    Globe
} from 'lucide-vue-next'
import { downloadCheckDir, downloadPickDir, downloadGetDir, downloadSaveDir, getMusicNaming, saveMusicNaming } from '../api'
// 支持平台图标（解析功能展示）
import platformDouyin from '../assets/icons/douyin.png'
import platformBilibili from '../assets/icons/bilibili.svg'
import platformKuaishou from '../assets/icons/kuaishou.svg'
import platformHuya from '../assets/icons/huya.png'
import platformDouyu from '../assets/icons/douyu.png'
import platformYoutube from '../assets/icons/youtube.svg'
import platformKick from '../assets/icons/kick.svg'
import platformTwitch from '../assets/icons/twitch.svg'
// 各平台用处说明
const supportedPlatforms = [
    { name: '抖音', icon: platformDouyin, use: '解析短视频与直播，官方接口无水印，可播放并批量下载' },
    { name: 'B站', icon: platformBilibili, use: '解析视频/番剧/电影/直播；TV 接口无水印片源，TV 端登录可解锁 1080P+' },
    { name: '快手', icon: platformKuaishou, use: '解析短视频与直播，官方接口无水印，可播放并批量下载' },
    { name: '虎牙', icon: platformHuya, use: '解析直播流（FLV/HLS），可播放与下载' },
    { name: '斗鱼', icon: platformDouyu, use: '解析直播流（FLV/HLS），可播放与下载' },
    { name: 'YouTube', icon: platformYoutube, use: '解析视频与直播，右上角 YT 登录后可解锁高画质/受限内容' },
    { name: 'Kick', icon: platformKick, use: '解析直播流（HLS），可播放与下载' },
    { name: 'Twitch', icon: platformTwitch, use: '解析直播流，HLS 低延迟实时跟播' }
]

const playerStore = usePlayerStore()
const platformStore = usePlatformStore()
const messageStore = useMessageStore()
const settingsStore = useSettingsStore()
const userStore = useUserStore()
const qqUserStore = useQQUserStore()
const kugouUserStore = useKugouUserStore()

// ===== 用户信息 =====
const isLoggedIn = computed(() =>
    platformStore.isQQ ? qqUserStore.isLoggedIn
    : platformStore.isKugou ? kugouUserStore.isLoggedIn
    : userStore.isLoggedIn
)
const profile = computed(() =>
    platformStore.isQQ ? qqUserStore.profile
    : platformStore.isKugou ? kugouUserStore.profile
    : userStore.profile
)
const avatarUrl = computed(() => profile.value?.avatarUrl || '')
const nickname = computed(() => {
    if (platformStore.isQQ) return profile.value?.nickname || '未登录'
    if (platformStore.isKugou) return profile.value?.nickname || '未登录'
    return userStore.isLoggedIn ? (profile.value?.nickname || '网易云用户') : '未登录'
})
const logout = () => {
    if (platformStore.isQQ) qqUserStore.logout()
    else if (platformStore.isKugou) kugouUserStore.logout()
    else userStore.logout()
    messageStore.success('已退出登录', 1200)
}
const platformName = computed(() =>
    platformStore.isQQ ? 'QQ音乐' : platformStore.isKugou ? '酷狗概念版' : '网易云音乐'
)

// Cookie/Token 展示
const cookieDisplayValue = computed(() => {
    if (platformStore.isKugou) {
        const token = kugouUserStore.cookie || ''
        const userid = kugouUserStore.userid || ''
        if (!token) return ''
        return userid ? `token=${token};userid=${userid}` : `token=${token}`
    }
    return qqUserStore.cookie || ''
})
const cookieCopied = ref(false)
const copyCookie = async () => {
    const cookie = cookieDisplayValue.value
    if (!cookie) return
    try {
        await navigator.clipboard.writeText(cookie)
        cookieCopied.value = true
        messageStore.success('已复制到剪贴板', 1200)
        setTimeout(() => { cookieCopied.value = false }, 2000)
    } catch (e) {
        const ta = document.createElement('textarea')
        ta.value = cookie
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
            document.execCommand('copy')
            cookieCopied.value = true
            messageStore.success('已复制到剪贴板', 1200)
            setTimeout(() => { cookieCopied.value = false }, 2000)
        } catch (err) {
            messageStore.error('复制失败,请手动选择文本复制')
        }
        document.body.removeChild(ta)
    }
}

// 用户统计项（按平台）
const statItems = computed(() => {
    if (platformStore.isKugou) {
        return [
            { label: '酷狗ID', value: profile.value?.userid || '-' },
            { label: '粉丝', value: profile.value?.fans || profile.value?.fan_count || 0 },
            { label: '关注', value: profile.value?.follows || profile.value?.follow_count || 0 }
        ]
    }
    if (platformStore.isQQ) {
        return [{ label: 'QQ号', value: profile.value?.uin || '-' }]
    }
    return [
        { label: '动态', value: profile.value?.eventCount || 0 },
        { label: '关注', value: profile.value?.follows || 0 },
        { label: '粉丝', value: profile.value?.followeds || 0 }
    ]
})
const userExtra = computed(() => {
    if (platformStore.isKugou) {
        return { label: 'VIP状态', value: profile.value?.isVip ? 'VIP会员' : '普通用户' }
    }
    if (platformStore.isNetease) {
        return { label: '等级', value: 'Lv.' + (profile.value?.level || 0) }
    }
    return null
})

// ===== 快捷键录制 =====
const recordingId = ref(null)
const startRecord = (id) => { recordingId.value = id }
const onShortcutKeydown = (e) => {
    if (!recordingId.value) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { recordingId.value = null; return }
    const combo = eventToCombo(e)
    if (!combo) return
    settingsStore.setShortcut(recordingId.value, combo)
    recordingId.value = null
}
const resetShortcut = (id) => {
    settingsStore.resetShortcut(id)
    messageStore.success('已恢复默认', 1200)
}
const resetAllShortcuts = () => {
    for (const id of Object.keys(DEFAULT_SHORTCUTS)) settingsStore.resetShortcut(id)
    messageStore.success('已全部恢复默认', 1500)
}
const displayCombo = (id) =>
    recordingId.value === id ? '按下快捷键…(Esc 取消)' : formatCombo(settingsStore.shortcuts[id]) || '未设置'

// ===== 关闭行为 =====
const closeOptions = [
    { value: 'ask', label: '每次询问' },
    { value: 'tray', label: '缩小到托盘' },
    { value: 'quit', label: '直接退出' }
]

// ===== API 线路（仅网易云平台展示）=====
const apiLineOptions = computed(() => API_LINES.map(l => ({ value: l.key, label: l.label })))
const currentApiLine = computed(() => {
    const k = settingsStore.apiLine && API_LINES.find(l => l.key === settingsStore.apiLine) ? settingsStore.apiLine : API_LINES[0].key
    return k
})
const handleSwitchApiLine = (key) => {
    if (!key || key === localStorage.getItem('api_line')) return
    if (switchApiLine(key)) {
        settingsStore.setApiLine(key)
        const line = API_LINES.find(l => l.key === key)
        messageStore.success(`已切换到${line?.label || '新的'}线路，即将刷新页面...`, 1200)
        setTimeout(() => { window.location.reload() }, 800)
    } else {
        messageStore.error('线路切换失败')
    }
}

// 酷狗概念版领取 VIP（内嵌卡片，仅酷狗登录后展示）
const youthVipLoading = ref(false)
const youthVipClaiming = ref(false)
const youthVipUpgrading = ref(false)
const youthVipInfo = ref(null)
const youthMonthRecord = ref([])
const youthVipActionMsg = ref('')

// ===== 酷狗 VIP 状态解析（基于真实返回结构）=====
// union.data.busi_vip[] 为具体业务 VIP（busi_type=concept），含 is_vip / vip_end_time
const VIP_TYPE_LABEL = { svip: 'SVIP 畅听', tvip: 'TVIP 音乐包', mvip: 'MVIP' }
const unionStatus = computed(() => {
    const info = youthVipInfo.value
    if (!info || typeof info !== 'object') return { isVip: false, rows: [] }
    const now = Date.now()
    const dayMs = 86400000
    const parseRow = (b) => {
        const end = b?.vip_end_time || ''
        let remain = null
        let endTs = null
        if (end && /20\d\d-\d\d-\d\d/.test(end)) {
            const t = new Date(end.replace(/-/g, '/')).getTime()
            if (!isNaN(t)) { endTs = t; remain = Math.max(0, Math.ceil((t - now) / dayMs)) }
        }
        return {
            type: b?.product_type || '',
            typeLabel: VIP_TYPE_LABEL[b?.product_type] || String(b?.product_type || 'VIP').toUpperCase(),
            end,
            remain,
            isVip: !!b?.is_vip
        }
    }
    let rows = (Array.isArray(info.busi_vip) ? info.busi_vip : []).map(parseRow)
    // 兜底：顶层只有一个 vip_end_time 时也当作一行
    if (!rows.length && info.vip_end_time) {
        rows = [{ ...parseRow(info), typeLabel: 'VIP' }]
    }
    const active = rows.filter(r => r.isVip && r.end)
    return { isVip: active.length > 0, rows: active }
})

// 剩余天数最高值（用于状态行快速展示）
const unionMaxRemain = computed(() => {
    const rows = unionStatus.value.rows
    if (!rows.length) return null
    return Math.max(...rows.map(r => r.remain ?? 0))
})

const refreshYouthVipInfo = async () => {
    if (!platformStore.isKugou || !kugouUserStore.isLoggedIn) return
    youthVipLoading.value = true
    youthVipActionMsg.value = ''
    try {
        const [unionRes, recordRes] = await Promise.allSettled([
            kugouYouthUnionVip(),
            kugouYouthMonthVipRecord()
        ])
        console.log('[KUGOU-YOUTH] isKugou=', platformStore.isKugou,
            'isLoggedIn=', kugouUserStore.isLoggedIn,
            '\nunion=', JSON.stringify(unionRes.value),
            '\nrecord=', JSON.stringify(recordRes.value))
        youthVipInfo.value = unionRes.status === 'fulfilled' && unionRes.value
            ? (unionRes.value?.data || unionRes.value)
            : null
        if (recordRes.status === 'fulfilled' && recordRes.value) {
            const rd = recordRes.value?.data || recordRes.value
            youthMonthRecord.value = Array.isArray(rd) ? rd : (rd?.list || rd?.records || [])
        } else {
            youthMonthRecord.value = []
        }
    } catch (e) {
        youthVipInfo.value = null
    } finally {
        youthVipLoading.value = false
    }
}

const runYouthVipAction = async (fn, type) => {
    if (youthVipClaiming.value || youthVipUpgrading.value) return
    if (type === 'upgrade') youthVipUpgrading.value = true
    else youthVipClaiming.value = true
    youthVipActionMsg.value = ''
    try {
        const res = await fn()
        console.log('[KUGOU-YOUTH][action]', type, JSON.stringify(res))
        const code = res?.status || res?.code || res?.error_code
        const msg = res?.errmsg || res?.error_msg || res?.message || res?.tip || res?.msg || ''
        const ok = code === 1 || res?.data || (msg && !String(code).startsWith('4'))
        const resultMsg = ok
            ? (msg || (type === 'upgrade' ? '升级成功' : '领取成功'))
            : (type === 'upgrade' ? '升级失败' : '领取失败') + (msg ? '：' + msg : '')
        youthVipActionMsg.value = resultMsg
        openYouthResult({ ok, msg: resultMsg, type })
        await refreshYouthVipInfo()
    } catch (e) {
        console.error('[Kugou Youth Vip] 操作失败:', e)
        youthVipActionMsg.value = '操作失败,请稍后重试'
        openYouthResult({ ok: false, msg: '操作失败，请稍后重试', type })
    } finally {
        if (type === 'upgrade') youthVipUpgrading.value = false
        else youthVipClaiming.value = false
    }
}

// 领取结果弹窗
const youthResultModal = ref(false)
const youthResult = ref({ ok: false, msg: '' })
const openYouthResult = ({ ok, msg, type }) => {
    youthResult.value = {
        ok,
        msg,
        typeLabel: type === 'upgrade' ? '升级畅听 VIP' : type === 'day' ? '领取一天 VIP' : '领取 3 小时 VIP'
    }
    youthResultModal.value = true
}

const claimYouthDayVip = () => {
    const today = new Date()
    const receiveDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    runYouthVipAction(() => kugouYouthDayVip(receiveDay), 'day')
}
const claimYouthVipHours = () => runYouthVipAction(kugouYouthVip, 'hours')
const upgradeYouthVip = () => runYouthVipAction(kugouYouthDayVipUpgrade, 'upgrade')

// ---------- 下载专区：统一下载目录（音乐/视频/自定义下载等所有下载共用） ----------
// 目录由主进程持久化（userData/download-dir.json），本地不再用 localStorage
const videoDownloadDir = ref('')
const systemDownloadDir = ref('')
const dirChecking = ref(false)

async function loadDefaultDownloadDir() {
    try {
        // 迁移旧版 localStorage 配置到主进程统一下载目录
        const legacy = localStorage.getItem('video_download_dir')
        if (legacy) {
            const legacyDir = legacy.replace(/[\\/]+$/, '')
            await downloadSaveDir(legacyDir).catch(() => {})
            localStorage.removeItem('video_download_dir')
        }
        const res = await downloadGetDir()
        if (res?.success) {
            // configured 表示用户已自定义；未配置时展示系统下载区
            videoDownloadDir.value = res.configured ? (res.dir || '') : ''
            systemDownloadDir.value = res.dir || ''
        }
    } catch (e) {}
}
async function pickVideoDownloadDir() {
    try {
        const res = await downloadPickDir()
        if (res?.canceled) return
        if (!res?.success || !res.dir) {
            messageStore.error('选择目录失败：' + (res?.error || '未知错误'), 4000)
            return
        }
        const dir = res.dir
        dirChecking.value = true
        const ok = await downloadCheckDir(dir)
        if (ok?.success) {
            const saved = await downloadSaveDir(dir)
            if (saved?.success) {
                videoDownloadDir.value = dir
                systemDownloadDir.value = dir
                messageStore.success('统一下载目录已更新，所有下载将保存到此位置', 3000)
            } else {
                messageStore.error('保存目录失败：' + (saved?.error || '未知错误'), 4000)
            }
        } else {
            messageStore.error('目录不可用：' + (ok?.error || '无法创建'), 4000)
        }
    } catch (e) {
        messageStore.error('选择目录失败：' + (e?.message || e), 4000)
    } finally {
        dirChecking.value = false
    }
}
function resetVideoDownloadDir() {
    videoDownloadDir.value = ''
    downloadSaveDir('').then((res) => {
        if (res?.success) systemDownloadDir.value = res.dir || ''
    }).catch(() => {})
    messageStore.success('已恢复为系统默认下载目录', 2500)
}
loadDefaultDownloadDir()

// ---------- 音乐命名格式：下载音乐命名 + 本地音乐识别（主进程持久化 music-naming.json） ----------
const MUSIC_NAMING_OPTIONS = [
    { value: 'song-artist', label: '歌名 - 作者' },
    { value: 'artist-song', label: '作者 - 歌名' }
]
const downloadNaming = ref('song-artist')
const localNaming = ref('song-artist')
async function loadMusicNaming() {
    try {
        const res = await getMusicNaming()
        if (res) {
            if (res.download) downloadNaming.value = res.download
            if (res.local) localNaming.value = res.local
        }
    } catch (e) {}
}
async function handleDownloadNamingChange(val) {
    if (!val || val === downloadNaming.value) return
    downloadNaming.value = val
    try {
        const res = await saveMusicNaming({ download: val })
        if (res?.success) messageStore.success('下载音乐命名格式已更新', 2000)
    } catch (e) {}
}
async function handleLocalNamingChange(val) {
    if (!val || val === localNaming.value) return
    localNaming.value = val
    try {
        const res = await saveMusicNaming({ local: val })
        if (res?.success) messageStore.success('本地音乐识别格式已更新，重新扫描本地音乐后生效', 2500)
    } catch (e) {}
}
loadMusicNaming()

onMounted(() => {
    window.addEventListener('keydown', onShortcutKeydown)
    loadBiliAuth()
    // 二级导航：从各设置卡片标题自动收集
    nextTick(() => {
        const cards = [...document.querySelectorAll('.settings-page .settings-card')]
        sectionNav.value = cards.map((c, i) => ({
            el: c,
            label: (c.querySelector('.card-title span:last-of-type')?.textContent || `分区 ${i + 1}`).trim()
        }))
    })
    // 长按选择复制开关：启动即应用
    applyLongPressSelect()
    if (platformStore.isKugou && kugouUserStore.isLoggedIn) {
        refreshYouthVipInfo()
    }
})
onUnmounted(() => {
    window.removeEventListener('keydown', onShortcutKeydown)
})
</script>

<template>
  <div class="settings-page">
    <div class="settings-inner">

      <div class="page-head">
        <h1 class="page-title"><Keyboard :size="20" /> 设置</h1>
        <p class="page-sub">自定义播放器行为与全局快捷键</p>
      </div>

      <!-- 二级导航（吸顶，点击滚动到对应设置卡片） -->
      <div class="settings-nav">
        <button
            v-for="s in sectionNav"
            :key="s.label"
            class="nav-chip"
            :class="{ active: activeSection === s.label }"
            @click="gotoSection(s)"
        >{{ s.label }}</button>
      </div>

      <!-- 账号与登录信息 -->
      <section class="settings-card account-card">
        <div class="card-head">
          <div class="card-title">
            <User :size="16" />
            <span>账号信息（{{ platformName }}）</span>
          </div>
        </div>

        <div class="account-body">
          <div class="account-main">
            <img v-if="isLoggedIn && avatarUrl" :src="avatarUrl" class="account-avatar" />
            <div v-else class="account-avatar placeholder">
              <User :size="22" />
            </div>
            <div class="account-meta">
              <div class="account-nickname">
                {{ isLoggedIn ? nickname : '未登录' }}
                <span v-if="platformStore.isKugou && profile?.isVip" class="account-vip-badge">VIP</span>
                <span v-if="platformStore.isQQ && profile?.isVip" class="account-vip-badge qq">VIP</span>
              </div>
              <div class="account-platform">{{ platformName }}</div>
            </div>
          </div>

          <div class="account-stats" v-if="isLoggedIn">
            <div v-for="s in statItems" :key="s.label" class="account-stat">
              <span class="stat-value">{{ s.value }}</span>
              <span class="stat-label">{{ s.label }}</span>
            </div>
          </div>

          <div v-if="isLoggedIn" class="account-extra">
            <span class="extra-key">{{ userExtra?.label }}</span>
            <span class="extra-value">{{ userExtra?.value }}</span>
          </div>

          <!-- 具体业务 VIP（剩 N 天 + 到期），位于 VIP 状态右边 -->
          <div v-if="platformStore.isKugou && unionStatus.rows.length" class="account-vip-list">
            <div v-for="(r, idx) in unionStatus.rows" :key="idx" class="account-vip-chip">
              <span class="chip-type">{{ r.typeLabel }}</span>
              <span class="chip-end">至 {{ r.end.slice(5, 10) }}</span>
              <em v-if="r.remain !== null" class="chip-remain">剩 {{ r.remain }} 天</em>
            </div>
            <span v-if="!unionStatus.rows.length && !youthVipLoading" class="account-vip-empty">未开通业务 VIP</span>
          </div>
        </div>

        <!-- Cookie / Token（QQ 与酷狗都要有；网易云无 Cookie 不展示） -->
        <div v-if="!platformStore.isNetease && cookieDisplayValue" class="cookie-block">
          <div class="cookie-head">
            <span class="cookie-title">
              {{ platformStore.isKugou ? '酷狗 Token' : 'QQ 音乐 Cookie' }}
            </span>
            <button class="copy-btn clickable" @click="copyCookie">
              <Copy :size="13" />
              {{ cookieCopied ? '已复制' : '复制' }}
            </button>
          </div>
          <textarea class="cookie-value" :value="cookieDisplayValue" readonly rows="3"></textarea>
        </div>

        <!-- 酷狗概念版：领取 VIP（仅酷狗登录后展示，内嵌展开） -->
        <div v-if="platformStore.isKugou && isLoggedIn" class="youth-vip-block">
          <div class="youth-vip-head">
            <div class="youth-vip-status">
              <span class="youth-vip-status-label">当前状态</span>
              <span class="youth-vip-status-value">
                {{ youthVipLoading ? '加载中…' : (unionStatus.isVip ? 'VIP有效' : '未激活') }}
              </span>
            </div>
            <div class="youth-vip-status">
              <span class="youth-vip-status-label">当月已领取</span>
              <span class="youth-vip-status-value">{{ youthMonthRecord.length }} 天</span>
            </div>
          </div>

          <div class="youth-vip-actions">
            <button class="youth-btn primary clickable" :disabled="youthVipClaiming" @click="claimYouthDayVip">
              {{ youthVipClaiming ? '领取中…' : '领取今天一天 VIP' }}
            </button>
            <button class="youth-btn clickable" :disabled="youthVipClaiming" @click="claimYouthVipHours">
              {{ youthVipClaiming ? '领取中…' : '领取 3 小时 VIP' }}
            </button>
            <button class="youth-btn clickable" :disabled="youthVipUpgrading" @click="upgradeYouthVip">
              {{ youthVipUpgrading ? '升级中…' : '升级畅听 VIP' }}
            </button>
          </div>

          <div v-if="youthVipActionMsg" class="youth-vip-msg">{{ youthVipActionMsg }}</div>

          <p class="youth-vip-tips">
            提示：这些接口来自酷狗概念版测试接口,部分用户可能不可用；领取 3 小时每天最多 8 次;升级畅听 VIP 需先领取一天 VIP。
          </p>
        </div>

        <button v-if="isLoggedIn" class="logout-btn clickable" @click="logout">
          <LogOut :size="14" /> 退出登录
        </button>
      </section>

      <!-- 核心播放快捷键 -->
      <section class="settings-card">
        <div class="card-head">
          <div class="card-title">
            <Zap :size="16" />
            <span>核心播放快捷键</span>
          </div>
          <button class="link-btn clickable" @click="resetAllShortcuts">
            <RotateCcw :size="13" /> 全部恢复默认
          </button>
        </div>
        <p class="card-tip">点击快捷键输入框，再按下一组按键即可重新绑定；支持空格、方向键以及 Ctrl / Alt 等组合键。</p>

        <div class="shortcut-list">
          <div v-for="item in SHORTCUT_ITEMS" :key="item.id" class="shortcut-row">
            <span class="shortcut-label">{{ item.label }}</span>
            <div class="shortcut-actions">
              <button
                class="key-capture"
                :class="{ recording: recordingId === item.id }"
                @click="startRecord(item.id)"
              >
                {{ displayCombo(item.id) }}
              </button>
              <button
                class="reset-btn clickable"
                :title="'恢复默认: ' + formatCombo(DEFAULT_SHORTCUTS[item.id])"
                @click="resetShortcut(item.id)"
              >
                <RotateCcw :size="13" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 播放器通用设置 -->
      <section class="settings-card">
        <div class="card-head">
          <div class="card-title">
            <SlidersHorizontal :size="16" />
            <span>播放器其他设置</span>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">关闭主窗口时</div>
            <div class="setting-desc">选择关闭按钮触发的行为</div>
          </div>
          <div class="close-options">
            <span
              v-for="opt in closeOptions"
              :key="opt.value"
              class="close-opt"
              :class="{ active: settingsStore.closePrefer === opt.value }"
              @click="settingsStore.setClosePrefer(opt.value)"
            >
              {{ opt.label }}
            </span>
          </div>
        </div>

        <!-- 网易云 API 线路（仅网易云平台显示，用美化下拉） -->
        <div v-if="platformStore.isNetease" class="setting-row">
          <div class="setting-info">
            <div class="setting-label">网易云 API 线路</div>
            <div class="setting-desc">选择网易云数据源线路</div>
          </div>
          <CustomSelect
            :model-value="currentApiLine"
            :options="apiLineOptions"
            :width="160"
            @change="handleSwitchApiLine"
          >
            <template #trigger-prefix>
              <Sparkles :size="13" class="api-line-icon" />
            </template>
          </CustomSelect>
        </div>
      </section>

      <!-- 下载专区 -->
      <section class="settings-card">
        <div class="card-head">
          <div class="card-title">
            <Download :size="16" />
            <span>下载专区</span>
          </div>
        </div>
        <p class="card-tip">统一下载目录：音乐下载、视频解析下载、MV/动漫/电影下载、自定义下载等所有下载操作都会保存到这里。未设置时使用系统默认下载区。</p>
        <div class="download-dir-row">
          <span class="download-dir-label">下载目录</span>
          <div class="download-dir-value" :title="videoDownloadDir || systemDownloadDir">
            {{ videoDownloadDir || systemDownloadDir || '系统下载区' }}
          </div>
          <button class="download-dir-btn clickable" :disabled="dirChecking" @click="pickVideoDownloadDir">
            <FolderOpen :size="13" /> 选择目录
          </button>
          <button class="download-dir-btn clickable" :disabled="!videoDownloadDir" @click="resetVideoDownloadDir">
            <RotateCcw :size="13" /> 恢复默认
          </button>
        </div>
      </section>

      <!-- 支持解析平台 -->
      <section class="settings-card">
        <div class="card-head">
          <div class="card-title">
            <Globe :size="16" />
            <span>支持解析平台</span>
          </div>
        </div>
        <p class="card-tip">「本地视频 → 网址解析」支持以下平台：粘贴对应链接即可自动解析视频/直播流，支持播放与下载。各平台用处如下：</p>
        <div class="platform-grid">
          <div v-for="p in supportedPlatforms" :key="p.name" class="platform-item">
            <img :src="p.icon" :alt="p.name" class="platform-item-icon" />
            <div class="platform-item-info">
              <div class="platform-item-name">{{ p.name }}</div>
              <div class="platform-item-use">{{ p.use }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 音乐命名格式 -->
      <section class="settings-card">
        <div class="card-head">
          <div class="card-title">
            <SlidersHorizontal :size="16" />
            <span>音乐命名格式</span>
          </div>
        </div>
        <p class="card-tip">下载的音乐文件名格式，以及本地音乐扫描时从文件名识别「歌名/作者」的格式。</p>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">下载音乐命名格式</div>
            <div class="setting-desc">下载歌曲时使用的文件名格式</div>
          </div>
          <CustomSelect
            :model-value="downloadNaming"
            :options="MUSIC_NAMING_OPTIONS"
            :width="160"
            @change="handleDownloadNamingChange"
          />
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">本地音乐识别格式</div>
            <div class="setting-desc">按文件名解析 歌名/作者（标签缺失时生效）</div>
          </div>
          <CustomSelect
            :model-value="localNaming"
            :options="MUSIC_NAMING_OPTIONS"
            :width="160"
            @change="handleLocalNamingChange"
          />
        </div>
      </section>

      <!-- 侧边栏分区显示 -->
      <section class="settings-card">
        <div class="card-title">
          <Check :size="16" />
          <span>侧边栏分区显示</span>
        </div>
        <p class="card-tip">取消勾选的分区将从侧边栏隐藏（"设置"不可隐藏），立即生效。</p>
        <div class="section-checks">
          <label
            v-for="sec in SIDEBAR_SECTIONS"
            :key="sec.id"
            class="section-check"
            :title="isSectionHidden(sec.id) ? '点击显示该分区' : '点击隐藏该分区'"
            @click.prevent="toggleSection(sec.id)"
          >
            <CheckSquare v-if="!isSectionHidden(sec.id)" :size="15" class="check-icon active" />
            <Square v-else :size="15" class="check-icon" />
            <span>{{ sec.label }}</span>
          </label>
        </div>
      </section>

      <!-- 长按选择复制 -->
      <section class="settings-card">
        <div class="card-title">
          <Check :size="16" />
          <span>长按选择复制</span>
        </div>
        <p class="card-tip">开启后长按/拖动可选中界面文字进行复制；关闭后全局禁用选中（输入框不受影响）。</p>
        <label class="section-check" @click.prevent="toggleLongPressSelect">
          <CheckSquare v-if="longPressSelect" :size="15" class="check-icon active" />
          <Square v-else :size="15" class="check-icon" />
          <span>{{ longPressSelect ? '已开启（可长按选择复制）' : '已关闭（禁止选中）' }}</span>
        </label>
      </section>

      <!-- B站登录态 -->
      <section class="settings-card">
        <div class="card-title">
          <Check :size="16" />
          <span>B站登录态（Cookie / Token）</span>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Web 端 Cookie</div>
            <div class="setting-desc">B站 Web 扫码登录产生的 Cookie，可复制或粘贴登录</div>
          </div>
          <div class="bili-cookie-actions">
            <button class="mini-btn" @click="copyPlainText(biliWebCookie, 'Web Cookie 已复制')"><Copy :size="13" /> 复制</button>
            <button class="mini-btn" @click="showBiliCookieInput = !showBiliCookieInput"><LogIn :size="13" /> {{ showBiliCookieInput ? '收起' : 'Cookie 登录' }}</button>
          </div>
        </div>
        <div v-if="biliAuthLoadError" class="bili-auth-error">{{ biliAuthLoadError }}</div>
        <textarea v-if="biliWebCookie" class="bili-cookie-view" readonly>{{ biliWebCookie }}</textarea>
        <div v-else class="bili-cookie-empty">未登录（无 Cookie）</div>
        <div class="collapse-wrap" :class="{ collapsed: !showBiliCookieInput }">
          <div class="collapse-inner">
            <div class="bili-cookie-login">
              <textarea v-model="biliCookieInput" class="bili-cookie-view" placeholder="粘贴 Cookie：SESSDATA=xxx; bili_jct=xxx; ...（也支持 JSON 格式）"></textarea>
              <button class="mini-btn primary" @click="biliCookieLogin"><LogIn :size="13" /> 登录</button>
            </div>
          </div>
        </div>

        <div class="setting-row" style="margin-top: 14px">
          <div class="setting-info">
            <div class="setting-label">TV 端 Token</div>
            <div class="setting-desc">TV 扫码登录凭证（accessKey 等），可复制备用</div>
          </div>
          <div class="bili-cookie-actions">
            <button class="mini-btn" @click="copyPlainText(biliTvToken, 'TV Token 已复制')"><Copy :size="13" /> 复制</button>
            <button class="mini-btn" @click="showBiliTvInput = !showBiliTvInput"><LogIn :size="13" /> {{ showBiliTvInput ? '收起' : 'Token 登录' }}</button>
          </div>
        </div>
        <div class="collapse-wrap" :class="{ collapsed: !showBiliTvInput }">
          <div class="collapse-inner">
            <div class="bili-cookie-login">
              <textarea v-model="biliTvInput" class="bili-cookie-view" placeholder="粘贴 TV Token JSON（含 accessKey），或直接粘贴 accessKey 字符串"></textarea>
              <button class="mini-btn primary" @click="biliTvTokenLogin"><LogIn :size="13" /> 登录</button>
            </div>
          </div>
        </div>
        <textarea v-if="biliTvToken" class="bili-cookie-view" readonly>{{ biliTvToken }}</textarea>
        <div v-else class="bili-cookie-empty">未登录（无 TV Token）</div>
      </section>

      <!-- 关于 -->
      <section class="settings-card">
        <div class="card-title">
          <Check :size="16" />
          <span>关于快捷键</span>
        </div>
        <p class="card-tip">
          快捷键在应用程序内全局生效（包括桌面歌词窗口），当正在输入文本时自动跳过，不会误触。
        </p>
      </section>

    </div>
  </div>

  <!-- 领取 VIP 结果弹窗 -->
  <Teleport to="body">
    <Transition name="modal-pop">
    <div v-if="youthResultModal" class="youth-result-overlay" @click.self="youthResultModal = false">
      <div class="youth-result-modal modal-panel">
        <div class="youth-result-icon" :class="youthResult.ok ? 'ok' : 'fail'">
          <CheckCircle2 v-if="youthResult.ok" :size="36" />
          <AlertCircle v-else :size="36" />
        </div>
        <h3 class="youth-result-title">{{ youthResult.ok ? '领取成功' : '领取未成功' }}</h3>
        <p class="youth-result-op">{{ youthResult.typeLabel }}</p>
        <p class="youth-result-msg">{{ youthResult.msg }}</p>
        <button class="youth-result-btn clickable" @click="youthResultModal = false">知道了</button>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-page {
    height: 100%;
    overflow-y: auto;
    padding: 24px 32px 60px;
    box-sizing: border-box;
    background: var(--bg-main, #fff);
}
.settings-inner {
    max-width: 760px;
    margin: 0 auto;
}
.page-head {
    margin-bottom: 24px;
}
.page-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-main, #1a1a1a);
}
.page-sub {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--text-light, #999);
}

.settings-card {
    background: var(--bg-sidebar, #fafafa);
    border: 1px solid var(--border-color, rgba(0,0,0,0.06));
    border-radius: 12px;
    padding: 20px 22px;
    margin-bottom: 18px;
}
.card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.card-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-main, #1a1a1a);
}
.card-tip {
    margin: 2px 0 16px;
    font-size: 12px;
    color: var(--text-light, #999);
    line-height: 1.6;
}
.link-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: none;
    color: var(--primary-color, #c20c0c);
    font-size: 12px;
    cursor: pointer;
}

/* ===== 账号信息 ===== */
.account-body {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    flex-wrap: wrap;
}
.account-main {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
}
.account-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.account-avatar.placeholder {
    background: var(--hover-bg, rgba(0,0,0,0.08));
    color: var(--text-light, #999);
    display: flex;
    align-items: center;
    justify-content: center;
}
.account-nickname {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-main, #1a1a1a);
}
.account-vip-badge {
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, #2CA2F5, #4AD295);
    padding: 1px 6px;
    border-radius: 3px;
}
.account-vip-badge.qq {
    background: linear-gradient(135deg, #ffd700, #ff9500);
}
.account-platform {
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-light, #999);
}
.account-stats {
    display: flex;
    gap: 22px;
    align-items: center;
    flex-shrink: 0;
}
.account-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
}
.stat-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-main, #1a1a1a);
}
.stat-label {
    font-size: 11px;
    color: var(--text-light, #999);
}
.account-extra {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 16px;
    background: var(--hover-bg, rgba(0,0,0,0.05));
    align-self: center;
}

/* 具体业务 VIP 徽章（VIP 状态右边） */
.account-vip-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    align-self: center;
}
.account-vip-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 16px;
    background: linear-gradient(135deg, #2CA2F5, #4AD295);
    color: #fff;
    font-size: 12px;
}
.chip-type {
    font-weight: 700;
    white-space: nowrap;
}
.chip-end {
    opacity: 0.92;
    white-space: nowrap;
}
.chip-remain {
    font-style: normal;
    font-weight: 700;
    border-left: 1px solid rgba(255, 255, 255, 0.4);
    padding-left: 6px;
    white-space: nowrap;
}
.account-vip-empty {
    font-size: 12px;
    color: var(--text-light, #999);
    align-self: center;
}
.extra-key {
    font-size: 12px;
    color: var(--text-light, #999);
}
.extra-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-color, #c20c0c);
}

/* Cookie / Token */
.cookie-block {
    margin-top: 18px;
}
.cookie-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.cookie-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main, #333);
}
.copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border: 1px solid var(--border-color, rgba(0,0,0,0.12));
    border-radius: 14px;
    background: var(--bg-main, #fff);
    color: var(--primary-color, #c20c0c);
    font-size: 12px;
}
.copy-btn:hover {
    border-color: var(--primary-color, #c20c0c);
}
.cookie-value {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-color, rgba(0,0,0,0.1));
    border-radius: 8px;
    font-size: 11px;
    font-family: Consolas, Monaco, monospace;
    line-height: 1.5;
    background: var(--bg-main, #fff);
    color: var(--text-main, #333);
    resize: vertical;
    box-sizing: border-box;
    word-break: break-all;
    white-space: pre-wrap;
}
.logout-btn {
    margin-top: 16px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border: 1px solid #e0e0e0;
    border-radius: 18px;
    background: var(--bg-main, #fff);
    color: #e81123;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
}
.logout-btn:hover {
    background: #fff5f5;
    border-color: #e81123;
}

/* ===== 酷狗领取 VIP（内嵌卡片）===== */
.youth-vip-block {
    margin-top: 16px;
    padding: 14px 16px;
    background: linear-gradient(135deg, rgba(44, 162, 245, 0.06), rgba(74, 210, 149, 0.06));
    border: 1px solid rgba(44, 162, 245, 0.2);
    border-radius: 10px;
}
.youth-vip-head {
    display: flex;
    flex-wrap: wrap;
    gap: 20px 28px;
    margin-bottom: 12px;
}
.youth-vip-status {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.youth-vip-status-label {
    font-size: 11px;
    color: var(--text-light, #999);
}
.youth-vip-status-value {
    font-size: 15px;
    font-weight: 700;
    color: #2CA2F5;
}
.youth-vip-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.youth-btn {
    padding: 8px 16px;
    border: 1px solid rgba(44, 162, 245, 0.4);
    border-radius: 18px;
    background: #fff;
    color: #2CA2F5;
    font-size: 13px;
    transition: all 0.15s;
}
.youth-btn:hover {
    background: rgba(44, 162, 245, 0.1);
}
.youth-btn.primary {
    background: linear-gradient(135deg, #2CA2F5, #4AD295);
    border-color: transparent;
    color: #fff;
}
.youth-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.youth-vip-msg {
    margin-top: 10px;
    font-size: 12px;
    color: #2CA2F5;
}

/* 领取结果弹窗 */
.youth-result-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
}
.youth-result-modal {
    width: 340px;
    background: #fff;
    border-radius: 14px;
    padding: 26px 24px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.youth-result-icon {
    display: flex;
    align-items: center;
    justify-content: center;
}
.youth-result-icon.ok { color: #2CA2F5; }
.youth-result-icon.fail { color: #e81123; }
.youth-result-title {
    margin: 12px 0 2px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-main, #1a1a1a);
}
.youth-result-op {
    margin: 0;
    font-size: 12px;
    color: var(--text-light, #999);
}
.youth-result-msg {
    margin: 12px 0 18px;
    font-size: 14px;
    color: var(--text-main, #333);
    line-height: 1.6;
    word-break: break-all;
}
.youth-result-btn {
    width: 100%;
    padding: 10px 0;
    border: none;
    border-radius: 18px;
    background: linear-gradient(135deg, #2CA2F5, #4AD295);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}
.youth-vip-tips {
    margin: 10px 0 0;
    font-size: 11px;
    color: var(--text-light, #999);
}

/* ===== 快捷键 ===== */
.shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 0;
    border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.05));
}
.shortcut-row:last-child { border-bottom: none; }
.shortcut-label { font-size: 14px; color: var(--text-main, #333); }
.shortcut-actions { display: flex; align-items: center; gap: 8px; }
.key-capture {
    min-width: 160px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-color, rgba(0,0,0,0.12));
    border-radius: 6px;
    background: var(--bg-main, #fff);
    color: var(--text-main, #333);
    font-size: 13px;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.key-capture:hover { border-color: var(--primary-color, #c20c0c); }
.key-capture.recording {
    border-color: var(--primary-color, #c20c0c);
    color: var(--primary-color, #c20c0c);
    box-shadow: 0 0 0 3px rgba(194, 12, 12, 0.10);
    animation: key-blink 1s ease-in-out infinite;
}
@keyframes key-blink {
    50% { opacity: 0.55; }
}
.reset-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--text-light, #999);
    border-radius: 6px;
}
.reset-btn:hover { background: var(--hover-bg, rgba(0,0,0,0.05)); color: var(--primary-color, #c20c0c); }

.setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 0;
    border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.05));
}
.setting-row:last-child { border-bottom: none; }
.setting-info { display: flex; flex-direction: column; gap: 3px; }
.setting-label { font-size: 14px; color: var(--text-main, #333); }
.setting-desc { font-size: 12px; color: var(--text-light, #999); }

.close-options { display: flex; gap: 6px; }
.close-opt {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: 15px;
    background: var(--hover-bg, rgba(0,0,0,0.06));
    color: var(--text-secondary, #666);
    cursor: pointer;
    transition: all 0.15s;
    user-select: none;
}
.close-opt:hover { background: rgba(0,0,0,0.1); }
.close-opt.active {
    background: var(--primary-color, #c20c0c);
    color: #fff;
}

.api-line-icon {
    color: var(--primary-color, #c20c0c);
}

/* ===== 下载专区 ===== */
.download-dir-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    flex-wrap: wrap;
}
.download-dir-label { font-size: 13px; color: #555; flex-shrink: 0; }
.download-dir-value {
    flex: 1;
    min-width: 160px;
    padding: 7px 10px;
    background: rgba(0, 0, 0, .04);
    border: 1px solid rgba(0, 0, 0, .1);
    border-radius: 6px;
    font-size: 12px;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.download-dir-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 12px;
    border: 1px solid rgba(0, 0, 0, .15);
    background: transparent;
    color: #555;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all .15s;
    flex-shrink: 0;
}
.download-dir-btn:hover:not(:disabled) { border-color: #c20c0c; color: #c20c0c; }
.download-dir-btn:disabled { opacity: .45; cursor: not-allowed; }

/* ===== 支持解析平台 ===== */
.platform-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
    margin-top: 10px;
}
.platform-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(0, 0, 0, .08);
    border-radius: 10px;
    background: rgba(255, 255, 255, .5);
    transition: all .15s;
}
.platform-item:hover {
    border-color: rgba(194, 12, 12, .35);
    box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
}
.platform-item-icon {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border-radius: 7px;
    flex-shrink: 0;
    margin-top: 1px;
}
.platform-item-info { min-width: 0; }
.platform-item-name {
    font-size: 13px;
    font-weight: 600;
    color: #333;
}
.platform-item-use {
    margin-top: 3px;
    font-size: 12px;
    color: #888;
    line-height: 1.5;
}
</style>
<style scoped>
/* 侧边栏分区勾选 */
/* 二级导航（吸顶） */
.settings-nav {
    position: sticky;
    top: -24px; /* 抵消 settings-page 顶部内边距，贴住滚动容器顶端 */
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 4px;
    background: var(--bg-main, #fff);
}
.nav-chip {
    padding: 6px 14px;
    border: 1px solid #e5e5e5;
    border-radius: 999px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}
.nav-chip:hover { border-color: #fb7299; color: #fb7299; }
.nav-chip.active { background: #fb7299; border-color: #fb7299; color: #fff; }
.settings-card { scroll-margin-top: 52px; }

.section-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
}
.section-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #555;
    cursor: pointer;
    user-select: none;
}
.section-check:hover { color: #333; }

/* B站登录态 */
.bili-cookie-actions { display: flex; gap: 8px; }
.mini-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}
.mini-btn:hover { border-color: #fb7299; color: #fb7299; }
.mini-btn.primary { background: #fb7299; border-color: #fb7299; color: #fff; }
.mini-btn.primary:hover { background: #fc8bab; }
.bili-cookie-view {
    width: 100%;
    min-height: 64px;
    max-height: 140px;
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    font-size: 12px;
    font-family: Consolas, monospace;
    color: #555;
    resize: vertical;
    box-sizing: border-box;
    word-break: break-all;
}
.bili-cookie-login { margin-top: 10px; }
.bili-cookie-login .bili-cookie-view { min-height: 80px; }
.bili-cookie-login .mini-btn { margin-top: 8px; }
.bili-auth-error {
    margin-top: 10px;
    padding: 8px 12px;
    border: 1px solid #f5c2c7;
    border-radius: 8px;
    background: #fff5f6;
    color: #c0392b;
    font-size: 12px;
}
.bili-cookie-empty {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px dashed #e0e0e0;
    border-radius: 8px;
    font-size: 12px;
    color: #aaa;
}
</style>
