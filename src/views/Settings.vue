<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
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
    FolderOpen
} from 'lucide-vue-next'
import { downloadDefaultDir, downloadCheckDir, downloadPickDir } from '../api'

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

// ---------- 下载专区：视频默认下载目录 ----------
// 存 localStorage('video_download_dir')，批量/单条下载时直接使用，不再弹窗
const videoDownloadDir = ref(localStorage.getItem('video_download_dir') || '')
const systemDownloadDir = ref('')
const dirChecking = ref(false)

async function loadDefaultDownloadDir() {
    try {
        const res = await downloadDefaultDir()
        if (res?.success) systemDownloadDir.value = res.dir
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
            videoDownloadDir.value = dir
            localStorage.setItem('video_download_dir', dir)
            messageStore.success('视频下载目录已更新', 2500)
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
    localStorage.removeItem('video_download_dir')
    messageStore.success('已恢复为系统默认下载目录', 2500)
}
loadDefaultDownloadDir()

onMounted(() => {
    window.addEventListener('keydown', onShortcutKeydown)
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
        <p class="card-tip">设置视频下载的默认保存位置后，下载时不再弹窗选择。每个视频会单独存放到「下载目录 / 视频标题 /」文件夹中，互不混淆。</p>
        <div class="download-dir-row">
          <span class="download-dir-label">视频下载目录</span>
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
    <div v-if="youthResultModal" class="youth-result-overlay" @click.self="youthResultModal = false">
      <div class="youth-result-modal">
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
</style>