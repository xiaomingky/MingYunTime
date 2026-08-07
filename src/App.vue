<script setup>
import { ref, onMounted, computed, onUnmounted, watch, provide } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getPendingLockTarget } from './router'
import { usePlayerStore } from './store/player'
import { useUserStore } from './store/user'
import { useMessageStore } from './store/message'
import SongDetail from './views/SongDetail.vue'
import LoginModal from './components/LoginModal.vue'
import LockModal from './components/LockModal.vue'
import MvPlayer from './components/MvPlayer.vue'
import VideoDownloadToast from './components/VideoDownloadToast.vue'
import Toast from './components/Toast.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import EqPanel from './components/EqPanel.vue'
import LyricSelector from './components/LyricSelector.vue'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mic,
  Settings,
  Minus,
  Square,
  X,
  Music,
  Tv,
  Heart,
  Download,
  HardDrive,
  Clock,
  Cloud,
  Database,
  Lock,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Volume2,
  ListMusic,
  Plus,
  Shuffle,
  Copy,
  Keyboard,
  Check,
  Github,
  HeartHandshake,
  Film,
  MonitorPlay,
  Sparkles,
  Zap,
  CheckSquare,
  Trash2
} from 'lucide-vue-next'
import SearchSuggest from './components/SearchSuggest.vue'
import { useSearchHistoryStore } from './store/searchHistory'
import { usePlatformStore } from './store/platform'
import { useQQUserStore } from './store/qq-user'
import { useKugouUserStore } from './store/kugou-user'
import { API_LINES, switchApiLine } from './api'
import {
    kugouYouthVip,
    kugouYouthDayVip,
    kugouYouthDayVipUpgrade,
    kugouYouthMonthVipRecord,
    kugouYouthUnionVip
} from './api/kugou'
import CustomSelect from './components/CustomSelect.vue'

const router = useRouter()
const route = useRoute()
const playerStore = usePlayerStore()
const userStore = useUserStore()
const messageStore = useMessageStore()
const searchHistoryStore = useSearchHistoryStore()
const platformStore = usePlatformStore()
const qqUserStore = useQQUserStore()
const kugouUserStore = useKugouUserStore()

// 当前平台的登录态（根据平台自动选择 userStore / qqUserStore / kugouUserStore）
const activeUserStore = computed(() =>
    platformStore.isQQ ? qqUserStore
    : platformStore.isKugou ? kugouUserStore
    : userStore
)
// 当前平台的"已登录"状态
const isLoggedIn = computed(() =>
    platformStore.isQQ ? qqUserStore.isLoggedIn
    : platformStore.isKugou ? kugouUserStore.isLoggedIn
    : userStore.isLoggedIn
)
// 当前平台的用户头像
const avatarUrl = computed(() => {
    if (platformStore.isQQ) {
        return qqUserStore.profile?.avatarUrl || ''
    }
    if (platformStore.isKugou) {
        return kugouUserStore.profile?.avatarUrl || ''
    }
    return userStore.profile?.avatarUrl || ''
})
// 当前平台的用户昵称
const nickname = computed(() => {
    if (platformStore.isQQ) {
        return qqUserStore.profile?.nickname || '未登录'
    }
    if (platformStore.isKugou) {
        return kugouUserStore.profile?.nickname || '未登录'
    }
    return userStore.isLoggedIn ? (userStore.profile?.nickname || '网易云用户') : '未登录'
})

const searchText = ref('')
const showSearchSuggest = ref(false)
const showLogin = ref(false)
const showUserMenu = ref(false)
const isMaximized = ref(false)
const showCreatePlaylist = ref(false)
const newPlaylistName = ref('')
const showSpeedMenu = ref(false)
const showQualityMenu = ref(false)
const showDonate = ref(false)
const showLockModal = ref(false)
const pendingProtectedPath = ref('')
// Cookie/Token 查看弹窗(可复制，QQ 与酷狗共用)
const showCookieModal = ref(false)
const cookieCopied = ref(false)
// 酷狗概念版领取 VIP 弹窗
const showYouthVipModal = ref(false)
const youthVipLoading = ref(false)
const youthVipClaiming = ref(false)
const youthVipUpgrading = ref(false)
const youthVipInfo = ref(null)
const youthMonthRecord = ref([])
const youthVipActionMsg = ref('')
// 打开领取 VIP 弹窗并加载状态
const openYouthVipModal = async () => {
    showYouthVipModal.value = true
    youthVipActionMsg.value = ''
    await refreshYouthVipInfo()
}
// 刷新 VIP 状态 + 当月已领取天数
const refreshYouthVipInfo = async () => {
    youthVipLoading.value = true
    try {
        const [unionRes, recordRes] = await Promise.allSettled([
            kugouYouthUnionVip(),
            kugouYouthMonthVipRecord()
        ])
        if (unionRes.status === 'fulfilled' && unionRes.value) {
            youthVipInfo.value = unionRes.value?.data || unionRes.value
        } else {
            youthVipInfo.value = null
        }
        if (recordRes.status === 'fulfilled' && recordRes.value) {
            const rd = recordRes.value?.data || recordRes.value
            youthMonthRecord.value = Array.isArray(rd) ? rd : (rd?.list || rd?.records || [])
        } else {
            youthMonthRecord.value = []
        }
    } catch (e) {
        console.error('[Kugou Youth Vip] 加载状态失败:', e)
        messageStore.error('获取 VIP 状态失败')
    } finally {
        youthVipLoading.value = false
    }
}
// 领取一天 VIP(默认今天)
const claimYouthDayVip = async () => {
    if (youthVipClaiming.value) return
    youthVipClaiming.value = true
    youthVipActionMsg.value = ''
    try {
        const today = new Date()
        const receiveDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        const res = await kugouYouthDayVip(receiveDay)
        const code = res?.status || res?.code || res?.error_code
        const msg = res?.errmsg || res?.error_msg || res?.message || res?.tip || ''
        if (code === 1 || res?.data || (msg && !String(code).startsWith('4'))) {
            youthVipActionMsg.value = msg || '领取成功'
        } else {
            youthVipActionMsg.value = `领取失败${msg ? '：' + msg : ''}`
        }
        await refreshYouthVipInfo()
    } catch (e) {
        console.error('[Kugou Youth Vip] 领取失败:', e)
        youthVipActionMsg.value = '领取失败,请稍后重试'
    } finally {
        youthVipClaiming.value = false
    }
}
// 领取 3 小时 VIP 时长(每天最多 8 次)
const claimYouthVipHours = async () => {
    if (youthVipClaiming.value) return
    youthVipClaiming.value = true
    youthVipActionMsg.value = ''
    try {
        const res = await kugouYouthVip()
        const code = res?.status || res?.code || res?.error_code
        const msg = res?.errmsg || res?.error_msg || res?.message || res?.tip || ''
        if (code === 1 || res?.data || (msg && !String(code).startsWith('4'))) {
            youthVipActionMsg.value = msg || '领取成功'
        } else {
            youthVipActionMsg.value = `领取失败${msg ? '：' + msg : ''}`
        }
        await refreshYouthVipInfo()
    } catch (e) {
        console.error('[Kugou Youth Vip] 领取时长失败:', e)
        youthVipActionMsg.value = '领取失败,请稍后重试'
    } finally {
        youthVipClaiming.value = false
    }
}
// 升级畅听 VIP(需先领取一天 VIP)
const upgradeYouthVip = async () => {
    if (youthVipUpgrading.value) return
    youthVipUpgrading.value = true
    youthVipActionMsg.value = ''
    try {
        const res = await kugouYouthDayVipUpgrade()
        const code = res?.status || res?.code || res?.error_code
        const msg = res?.errmsg || res?.error_msg || res?.message || res?.tip || ''
        if (code === 1 || res?.data || (msg && !String(code).startsWith('4'))) {
            youthVipActionMsg.value = msg || '升级成功'
        } else {
            youthVipActionMsg.value = `升级失败${msg ? '：' + msg : ''}`
        }
        await refreshYouthVipInfo()
    } catch (e) {
        console.error('[Kugou Youth Vip] 升级失败:', e)
        youthVipActionMsg.value = '升级失败,请稍后重试'
    } finally {
        youthVipUpgrading.value = false
    }
}
// 酷狗登录信息展示：token=xxx;userid=xxx 格式（用户可复制后用于 Cookie 登录）
const kugouCookieDisplay = computed(() => {
    const token = kugouUserStore.cookie || ''
    const userid = kugouUserStore.userid || ''
    if (!token) return ''
    return userid ? `token=${token};userid=${userid}` : `token=${token}`
})
// 酷狗歌单折叠状态：创建的歌单默认展开，收藏的歌单默认折叠
const kugouCreatedCollapsed = ref(false)
const kugouCollectedCollapsed = ref(true)
// 酷狗收藏歌单批量管理
const kugouPlaylistBatchMode = ref(false)
const kugouSelectedPlaylistIds = ref([])
const kugouBatchDeleting = ref(false)
const kugouShowBatchConfirm = ref(false)
const kugouTogglePlaylistBatch = () => {
    kugouPlaylistBatchMode.value = !kugouPlaylistBatchMode.value
    kugouSelectedPlaylistIds.value = []
}
const kugouTogglePlaylistSelect = (id) => {
    const idx = kugouSelectedPlaylistIds.value.indexOf(id)
    if (idx >= 0) kugouSelectedPlaylistIds.value.splice(idx, 1)
    else kugouSelectedPlaylistIds.value.push(id)
}
const kugouIsPlaylistSelected = (id) => kugouSelectedPlaylistIds.value.includes(id)
const kugouIsAllPlaylistsSelected = computed(() =>
    kugouCollectedPlaylists.value.length > 0 &&
    kugouSelectedPlaylistIds.value.length === kugouCollectedPlaylists.value.length
)
const kugouSelectAllPlaylists = () => {
    if (kugouIsAllPlaylistsSelected.value) {
        kugouSelectedPlaylistIds.value = []
    } else {
        kugouSelectedPlaylistIds.value = kugouCollectedPlaylists.value.map(p => p.id)
    }
}
const kugouBatchDeletePlaylists = async () => {
    kugouShowBatchConfirm.value = false
    if (!kugouSelectedPlaylistIds.value.length) return
    kugouBatchDeleting.value = true
    const ok = await kugouUserStore.batchDeletePlaylists(kugouSelectedPlaylistIds.value)
    if (ok) {
        kugouSelectedPlaylistIds.value = []
        kugouPlaylistBatchMode.value = false
    }
    kugouBatchDeleting.value = false
}
// 酷狗新建歌单弹窗
const kugouShowCreatePlaylist = ref(false)
const kugouNewPlaylistName = ref('')
const kugouCreating = ref(false)
const kugouCreatePlaylist = async () => {
    const name = kugouNewPlaylistName.value.trim()
    if (!name) {
        useMessageStore().warning('请输入歌单名称')
        return
    }
    kugouCreating.value = true
    const ok = await kugouUserStore.createPlaylist(name)
    if (ok) {
        kugouShowCreatePlaylist.value = false
        kugouNewPlaylistName.value = ''
    }
    kugouCreating.value = false
}
// 酷狗歌单分类：我创建的 / 我收藏的
const kugouCreatedPlaylists = computed(() => kugouUserStore.playlists.filter(p => p.isMine))
const kugouCollectedPlaylists = computed(() => kugouUserStore.playlists.filter(p => !p.isMine))
const cookieDisplayValue = computed(() => {
    return platformStore.isKugou ? kugouCookieDisplay.value : (qqUserStore.cookie || '')
})
const copyCookie = async () => {
    // QQ 走 qqUserStore.cookie；酷狗走 kugouCookieDisplay（含 userid）
    const cookie = cookieDisplayValue.value
    if (!cookie) return
    try {
        await navigator.clipboard.writeText(cookie)
        cookieCopied.value = true
        messageStore.success('Cookie 已复制到剪贴板', 2000)
        setTimeout(() => { cookieCopied.value = false }, 2000)
    } catch (e) {
        // 降级方案:创建 textarea 选区复制
        const ta = document.createElement('textarea')
        ta.value = cookie
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
            document.execCommand('copy')
            cookieCopied.value = true
            messageStore.success('Cookie 已复制到剪贴板', 2000)
            setTimeout(() => { cookieCopied.value = false }, 2000)
        } catch (err) {
            messageStore.error('复制失败,请手动选择文本复制')
        }
        document.body.removeChild(ta)
    }
}

// 自动更新检测
const updateInfo = ref({ available: false, version: '', notes: '', downloadUrl: '' })

const getFooterCoverUrl = () => {
    const picUrl = playerStore.currentSong.al?.picUrl || ''
    if (!picUrl) return ''
    const showGif = localStorage.getItem('song_detail_show_gif_cover') !== 'false'
    if (picUrl.startsWith('song-cover:') && !showGif) {
        return picUrl + '?static=1'
    }
    return picUrl
}

// 网易云真实音质选项（已实测：6 档真实，jymaster/sky/dolby 全部映射成 jyeffect 故不显示）
// 参考 API: /song/url/v1 的 level 参数
const neteaseQualityLabels = {
    standard: '标准',
    higher: '较高',
    exhigh: '极高',
    lossless: '无损',
    hires: 'Hi-Res',
    jyeffect: '高清环绕声'
}

// QQ 音乐真实音质选项（已实测：API 仅支持这 4 种,master/atmos/ape 不可用）
// 对应 @sansenjian/qq-music-api 的 quality 参数: 128/320/m4a/flac
const qqQualityLabels = {
    '128': '标准',
    '320': '高品',
    m4a: '标准 AAC',
    flac: '无损'
}
// 酷狗概念版真实音质（已查 KuGouMusicApi song_url.js 源码确认：7 档真实）
// 隐藏 multitrack / viper_tape / 魔法音效（piano/acappella 等）
const kugouQualityLabels = {
    '128': '标准',
    '320': '高品',
    flac: '无损',
    high: 'Hi-Res',
    viper_atmos: '蝰蛇全景声',
    viper_clear: '蝰蛇清澈',
    super: '超品'
}
// 根据当前平台动态切换音质选项
const qualityLabels = computed(() =>
    platformStore.isQQ ? qqQualityLabels
    : platformStore.isKugou ? kugouQualityLabels
    : neteaseQualityLabels
)
// 顶部 badge 显示的短标签
const qualityBadgeLabel = computed(() => {
    const q = playerStore.quality
    if (platformStore.isQQ) return qqQualityLabels[q] || '标准'
    if (platformStore.isKugou) return kugouQualityLabels[q] || '标准'
    return neteaseQualityLabels[q] || '标准'
})

const toggleUserMenu = () => {
  showUserMenu.value = !showUserMenu.value
}

const logout = () => {
    if (platformStore.isQQ) {
        qqUserStore.logout()
        router.push('/qq')
    } else if (platformStore.isKugou) {
        kugouUserStore.logout()
        router.push('/kugou')
    } else {
        userStore.logout()
        router.push('/')
    }
    showUserMenu.value = false
}

// 平台切换：调用 store 切换并刷新页面
const switchPlatform = (key) => {
    platformStore.switchTo(key)
}
// 平台下拉框选项(酷狗概念版排在 QQ 音乐前面)
const platformOptions = computed(() => [
    { value: 'netease', label: '网易云' },
    { value: 'kugou', label: '酷狗概念版' },
    { value: 'qq', label: 'QQ音乐' }
])
// 下拉框切换平台
const onPlatformChange = (key) => {
    if (key && key !== platformStore.current) {
        switchPlatform(key)
    }
}

// 各平台侧边栏导航项（动态切换）
const neteaseNavItems = [
    { id: '/', label: '发现音乐', icon: Music },
    { id: '/video', label: 'MV', icon: Tv },
    { id: '/anime', label: '动漫', icon: MonitorPlay },
    { id: '/movie', label: '影视', icon: Film },
]
const qqNavItems = [
    { id: '/qq', label: '发现音乐', icon: Music },
    { id: '/qq/singers', label: '歌手', icon: Mic },
    { id: '/qq/categories', label: '歌单分类', icon: ListMusic },
    { id: '/anime', label: '动漫', icon: MonitorPlay },
    { id: '/movie', label: '影视', icon: Film },
]
// 酷狗概念版导航项（与 QQ 模式一致）
const kugouNavItems = [
    { id: '/kugou', label: '发现音乐', icon: Music },
    { id: '/kugou/singers', label: '歌手', icon: Mic },
    { id: '/kugou/categories', label: '歌单分类', icon: ListMusic },
    { id: '/anime', label: '动漫', icon: MonitorPlay },
    { id: '/movie', label: '影视', icon: Film },
]
// 本地资源导航（两平台共用，保留我们的自有功能）
const libraryNavItems = [
    { id: '/local', label: '本地音乐', icon: HardDrive },
    { id: '/local-video', label: '本地视频', icon: Film },
    { id: '/recent', label: '最近播放', icon: Clock },
    { id: '/cloud', label: '我的云音乐', icon: Cloud },
    { id: '/netease-cloud', label: '官方云盘', icon: Database },
    { id: '/downloads', label: '下载', icon: Download },
]

const toggleSongDetailOverlay = () => {
  if (playerStore.currentSong.id) {
      playerStore.showSongDetail = !playerStore.showSongDetail
  }
}

const handleMaximize = (_, status) => {
  isMaximized.value = status
}

const getBridge = () => {
  const b = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer || window.electron
  if (!b) {
    console.warn('--- [Diagnostic] IPC Bridge NOT FOUND in any known property')
    const keys = Object.keys(window).filter(k => 
      k.toLowerCase().includes('bridge') || 
      k.toLowerCase().includes('electron') || 
      k.toLowerCase().includes('ipc')
    )
    if (keys.length > 0) console.log('--- [Diagnostic] Potential candidates found in window:', keys)
  }
  return b
}

// 自动监听播放状态改变并广播给桌面歌词窗口（移除 deep，避免歌词数组深层遍历）
watch(
    () => playerStore.isPlaying,
    () => {
        if (playerStore.showDesktopLyrics) {
            playerStore.updateDesktopLyricsState()
        }
    }
)
// 歌词/歌曲变化时才通知桌面歌词（用引用对比，非 deep）
watch(
    [() => playerStore.currentSong.id, () => playerStore.lyrics, () => playerStore.yrcLyrics],
    () => {
        if (playerStore.showDesktopLyrics) {
            playerStore.updateDesktopLyricsState()
        }
    }
)

// 持久化保存播放状态 — 精确订阅 4 个字段，避免 currentTime 高频更新触发全量写入
let _persistTimer = null
function persistPlayState() {
    if (_persistTimer) return
    _persistTimer = setTimeout(() => {
        _persistTimer = null
        localStorage.setItem('current_song', JSON.stringify(playerStore.currentSong))
        localStorage.setItem('playlist', JSON.stringify(playerStore.playlist))
        localStorage.setItem('current_index', playerStore.currentIndex)
        localStorage.setItem('play_mode', playerStore.playMode)
    }, 1000)
}
watch(() => playerStore.currentSong, persistPlayState)
watch(() => playerStore.playlist, persistPlayState, { deep: false })
watch([() => playerStore.currentIndex, () => playerStore.playMode], persistPlayState)

onMounted(() => {
  playerStore.initAudio()

  // 平台隔离：QQ 平台不调网易云 fetchStatus；网易云平台不调 QQ fetchUserPlaylists
  if (platformStore.isNetease) {
      userStore.fetchStatus().then(async () => {
          if (userStore.isLoggedIn && userStore.profile?.userId) {
              await userStore.syncCloudAccount()
              await userStore.checkLockStatus()
          }
      })
  } else if (platformStore.isQQ && qqUserStore.isLoggedIn && qqUserStore.uin) {
      qqUserStore.fetchUserPlaylists()
      // 启动时刷新真实昵称/头像/VIP状态(解决重启后显示"已登录"的问题)
      qqUserStore.fetchRealProfile()
  } else if (platformStore.isKugou && kugouUserStore.isLoggedIn && kugouUserStore.userid) {
      kugouUserStore.fetchUserPlaylists()
      kugouUserStore.fetchRealProfile()
      kugouUserStore.fetchVipInfo()
  }

  const b = getBridge()
  if (b && b.on) {
    b.on('window-maximize-status', handleMaximize)
    b.on('player-command', (event, cmd) => {
        if (cmd === 'prev') playerStore.prev()
        else if (cmd === 'next') playerStore.next()
        else if (cmd === 'togglePlay') playerStore.togglePlay()
    })

    // 系统级"打开方式"：通过文件关联启动时接收音频文件并播放
    b.on('open-audio-file', (event, song) => {
        if (song && song.url) {
            // 加入本地曲库并立即播放
            playerStore.addLocalSongs([song])
            playerStore.playSong(song)
        }
    })

    // 系统级"打开方式"：通过文件关联启动时接收视频文件并播放
    b.on('open-video-file', (event, video) => {
        if (video && video.url) {
            playerStore.playVideoFile(video)
        }
    })

    b.on('request-lyric-sync', () => {
        playerStore.updateDesktopLyricsState()
    })

    // 更新检测事件
    b.on('update-checking', () => { useMessageStore().info('正在检查更新...', 2000) })
    b.on('update-available', (_, version, notes, downloadUrl) => { updateInfo.value = { available: true, version, notes: notes || '', downloadUrl: downloadUrl || '' } })
    b.on('update-not-available', (_, currentVersion) => { useMessageStore().success(`已是最新版本 v${currentVersion}`, 3000) })
    b.on('update-error', (_, msg) => { useMessageStore().error(msg, 3000) })
    b.on('update-download-progress', (_, pct) => { updateInfo.value.progress = pct })
    b.on('update-downloaded', () => { updateInfo.value = { ...updateInfo.value, downloading: false, downloaded: true } })

    // 初始化桌面歌词窗口状态
    if (playerStore.showDesktopLyrics) {
        b.send('toggle-desktop-lyrics', true)
        playerStore._startDesktopLyricInterval()
    }

    // 窗口隐藏时释放渲染进程非必要资源（降低后台内存）
    // 注意：不暂停 Audio（用户可能在后台听歌），只释放可视化/图片缓存
    b.on('window-hidden-release', () => {
        try {
            // 1. 通知 player store 释放频谱分析器等非必要资源
            if (typeof playerStore.releaseVisualizerResources === 'function') {
                playerStore.releaseVisualizerResources()
            }
            // 2. 触发 V8 GC（需 --expose-gc 标志，渲染进程也生效）
            if (typeof window.gc === 'function') {
                window.gc()
            }
        } catch (e) { /* 静默 */ }
    })

    // 窗口重新显示时恢复资源（重建 analyser）
    b.on('window-shown-recover', () => {
        try {
            if (typeof playerStore.rebuildAudioGraph === 'function' && playerStore.audio) {
                playerStore.rebuildAudioGraph()
            }
        } catch (e) { /* 静默 */ }
    })
  }
})

onUnmounted(() => {
  const b = getBridge()
  if (b && b.off) {
    b.off('window-maximize-status', handleMaximize)
  }
})

const formatTime = (seconds) => {
  if (!seconds) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const minimize = () => {
    const b = getBridge()
    if (b) b.send('window-minimize')
    else messageStore.error('控制失效：bridge 未加载')
}
const toggleMaximize = () => {
    const b = getBridge()
    if (b) b.send('window-maximize')
    else messageStore.error('控制失效：bridge 未加载')
}

const showCloseOptions = ref(false)
const closePref = ref(localStorage.getItem('close_action') || 'ask')

// API 线路选择（主线路 / 推荐线路 / 备用线路）
const currentApiLine = ref(localStorage.getItem('api_line') || API_LINES[0].key)
const currentApiLineLabel = computed(() => {
    return API_LINES.find(l => l.key === currentApiLine.value)?.label || ''
})
const apiLineOptions = computed(() => API_LINES.map(l => ({ value: l.key, label: l.label })))
const handleSwitchApiLine = (lineKey) => {
    if (!lineKey || lineKey === localStorage.getItem('api_line')) return
    if (switchApiLine(lineKey)) {
        const line = API_LINES.find(l => l.key === lineKey)
        messageStore.success(`已切换到${line?.label || '新'}线路，即将刷新页面...`, 1500)
        // 切换 baseURL 后刷新页面，确保所有已发出请求与缓存状态重置
        setTimeout(() => {
            window.location.reload()
        }, 800)
    } else {
        messageStore.error('线路切换失败')
    }
}

const openCloseOptions = () => {
    if (closePref.value === 'tray') {
        minimizeToTray()
    } else if (closePref.value === 'quit') {
        quitApp()
    } else {
        showCloseOptions.value = true
    }
}

const minimizeToTray = () => {
    showCloseOptions.value = false
    const b = getBridge()
    if (b) b.send('window-minimize-to-tray')
}

const quitApp = () => {
    showCloseOptions.value = false
    const b = getBridge()
    if (b) b.send('window-quit')
}

const saveClosePref = (pref) => {
    closePref.value = pref
    localStorage.setItem('close_action', pref)
    showCloseOptions.value = false
}

watch(showCloseOptions, (val) => {
    if (val) {
        setTimeout(() => {
            document.addEventListener('click', () => { showCloseOptions.value = false }, { once: true })
        }, 0)
    }
})

const navigateTo = (path) => {
  router.push(path)
}

const handleSearch = () => {
  if (searchText.value.trim()) {
    // 音乐搜索历史按当前平台细分(music-netease/music-kugou/music-qq)
    searchHistoryStore.addHistory(`music-${platformStore.current}`, searchText.value)
    showSearchSuggest.value = false
    // 根据当前平台跳转搜索页
    const searchPath = platformStore.isQQ ? '/qq/search' : platformStore.isKugou ? '/kugou/search' : '/search'
    router.push({ path: searchPath, query: { keywords: searchText.value, t: Date.now() } })
  }
}

const onSelectSuggest = (kw) => {
  searchText.value = kw
  handleSearch()
}

// "您可能再找"实时搜索结果点击：song → 跳转到搜索页用歌名搜索
const onSelectItem = (item) => {
  showSearchSuggest.value = false
  if (item?.type === 'song' && item.name) {
    searchText.value = item.name
    handleSearch()
  }
}

const onSearchFocus = () => {
  showSearchSuggest.value = true
}

const onSearchBlur = () => {
  // 延迟关闭，让点击事件先触发
  setTimeout(() => { showSearchSuggest.value = false }, 200)
}

const handleCreatePlaylist = () => {
    if (!userStore.isLoggedIn) {
        showLogin.value = true
        return
    }
    newPlaylistName.value = ''
    showCreatePlaylist.value = true
}

const submitCreatePlaylist = async () => {
    if (newPlaylistName.value && newPlaylistName.value.trim()) {
        const success = await userStore.createPlaylist(newPlaylistName.value.trim())
        if (success) {
            messageStore.success('歌单创建成功')
            showCreatePlaylist.value = false
        } else {
            messageStore.error('创建歌单失败')
        }
    }
}

const goToPlaylist = (id) => {
    // 强制刷新：即使同一歌单也重新加载
    router.push({ path: `/playlist/${id}`, query: { _t: Date.now() } })
}

const isOwnPlaylist = (id) => {
    if (!userStore.isLoggedIn) return false
    if (String(id) === String(userStore.likedPlaylistId)) return true
    return userStore.playlists.some(p => String(p.id) === String(id))
}

const requireLockForPlaylist = async (id) => {
    if (!userStore.isLoggedIn || !isOwnPlaylist(id)) {
        goToPlaylist(id)
        return
    }

    // 已确认上锁且未解锁，点击立即弹窗，不等待页面加载
    if (userStore.lockStatus.checked && userStore.lockStatus.locked && !userStore.lockStatus.unlocked) {
        pendingProtectedPath.value = `/playlist/${id}`
        showLockModal.value = true
        return
    }

    // 若还没有后端 token，先同步账号（桌面程序登录后必须拿到 token 才能判断锁状态）
    if (!userStore.lockStatus.token) {
        try {
            await userStore.syncCloudAccount()
        } catch (e) {
            console.error('syncCloudAccount error:', e)
        }
    }

    // 强制重新检查一次最新锁状态
    try {
        await userStore.checkLockStatus()
    } catch (e) {
        console.error('checkLockStatus error:', e)
    }

    if (!userStore.lockStatus.locked || userStore.lockStatus.unlocked) {
        goToPlaylist(id)
        return
    }
    pendingProtectedPath.value = `/playlist/${id}`
    showLockModal.value = true
}

provide('requireLockForPlaylist', requireLockForPlaylist)

const onLockVerified = () => {
    if (pendingProtectedPath.value) {
        router.push({ path: pendingProtectedPath.value, query: { _t: Date.now() } })
        pendingProtectedPath.value = ''
    }
}

let drawerListRef = ref(null)

watch(() => playerStore.currentIndex, () => {
    if (playerStore.showPlaylist && drawerListRef.value) {
        setTimeout(() => {
            const active = drawerListRef.value.querySelector('.list-item.active')
            if (active) {
                active.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
        }, 100)
    }
})

let draggedPlaylistIndex = -1

const onDragStart = (index, e) => {
    draggedPlaylistIndex = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index)
}

const onDragOver = (index, e) => {
    e.preventDefault()
    if (draggedPlaylistIndex === -1 || draggedPlaylistIndex === index) return
    playerStore.movePlaylistItem(draggedPlaylistIndex, index)
    draggedPlaylistIndex = index
}

const onDragEnd = () => {
    draggedPlaylistIndex = -1
}

// Draggable Progress/Volume
const isDraggingProgress = ref(false)
const isDraggingVolume = ref(false)

const startDragProgress = (e) => {
    isDraggingProgress.value = true
    handleProgressDrag(e)
    window.addEventListener('mousemove', handleProgressDrag)
    window.addEventListener('mouseup', stopDragProgress)
}

const handleProgressDrag = (e) => {
    if (!isDraggingProgress.value) return
    const barra = document.querySelector('.progress-bar')
    if (!barra) return
    const rect = barra.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    playerStore.setProgress(percent)
}

const stopDragProgress = () => {
    isDraggingProgress.value = false
    window.removeEventListener('mousemove', handleProgressDrag)
    window.removeEventListener('mouseup', stopDragProgress)
}

const startDragVolume = (e) => {
    isDraggingVolume.value = true
    handleVolumeDrag(e)
    window.addEventListener('mousemove', handleVolumeDrag)
    window.addEventListener('mouseup', stopDragVolume)
}

const handleVolumeDrag = (e) => {
    if (!isDraggingVolume.value) return
    const barra = document.querySelector('.volume-slider')
    if (!barra) return
    const rect = barra.getBoundingClientRect()
    // 音量条满格 100(增益通过 boost 按钮实现,不通过拖拽)
    const vol = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
    playerStore.setVolume(vol)
}

const stopDragVolume = () => {
    isDraggingVolume.value = false
    window.removeEventListener('mousemove', handleVolumeDrag)
    window.removeEventListener('mouseup', stopDragVolume)
}

// 音量滚轮调整:步进 10(向上增大,向下减小),范围 0-100
const onVolumeWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 10 : -10
    playerStore.setVolume(playerStore.volume + delta)
}

// 音量增益:每次 +50%,最大 500%;达到 500% 后再次点击重置为 100%
const boostVolume = () => {
    const v = playerStore.volume
    if (v >= 500) {
        playerStore.setVolume(100)
    } else if (v < 100) {
        playerStore.setVolume(100)
    } else {
        playerStore.setVolume(Math.min(500, v + 50))
    }
}

// 处理被路由守护拦截的受保护歌单
watch(() => route.fullPath, () => {
    const target = getPendingLockTarget()
    if (target) {
        pendingProtectedPath.value = target
        showLockModal.value = true
    }
})

// 直接访问/刷新受保护歌单页面时的兜底拦截
watch(
    [() => route.params.id, () => userStore.lockStatus.locked, () => userStore.lockStatus.unlocked, () => userStore.playlists.length],
    () => {
        const id = route.params.id
        if (!id || !userStore.isLoggedIn || !userStore.lockStatus.locked || userStore.lockStatus.unlocked) return
        const isOwn = String(id) === String(userStore.likedPlaylistId) ||
            userStore.playlists.some(p => String(p.id) === String(id))
        if (isOwn && !showLockModal.value) {
            pendingProtectedPath.value = route.fullPath
            showLockModal.value = true
        }
    }
)

// 动态切换根节点类名，彻底解决全透明问题
watch(() => route.path, (newPath) => {
    if (newPath === '/desktop-lyrics') {
        document.documentElement.classList.add('is-lyrics-window')
        document.body.style.backgroundColor = 'transparent'
    } else {
        document.documentElement.classList.remove('is-lyrics-window')
        document.body.style.backgroundColor = ''
    }
}, { immediate: true })

// 登录后先同步账号再检查锁状态
watch(() => userStore.isLoggedIn, async (val) => {
    if (val && userStore.profile?.userId) {
        await userStore.syncCloudAccount()
        await userStore.checkLockStatus()
    }
})

// 监听歌单变化，立即刷新侧边栏
watch(() => userStore.playlistChanged, async () => {
    if (userStore.isLoggedIn && userStore.profile?.userId) {
        await userStore.fetchUserPlaylists(userStore.profile.userId)
    }
})

const openOsk = () => {
    const b = getBridge()
    if (b) b.send('open-osk')
}

const openAuthorLink = () => {
    const b = getBridge()
    if (b) b.send('open-external', import.meta.env.VITE_AUTHOR_URL || '')
}
const openGithub = () => {
    const b = getBridge()
    if (b) b.send('open-external', 'https://github.com/xiaomingky/MingYunTime')
}

</script>

<template>
  <div class="app-container" :class="{ 'is-desktop-lyrics': route.path === '/desktop-lyrics' }" :data-platform="platformStore.current">
    <Toast />
    <VideoDownloadToast />
    <ConfirmModal
        :visible="messageStore.confirmState.show"
        :title="messageStore.confirmState.title"
        :message="messageStore.confirmState.message"
        @confirm="messageStore.closeConfirm(true)"
        @cancel="messageStore.closeConfirm(false)"
    />
    <!-- 酷狗批量取消收藏歌单确认弹窗 -->
    <ConfirmModal
        :visible="kugouShowBatchConfirm"
        title="取消收藏歌单"
        :message="`确定取消收藏选中的 ${kugouSelectedPlaylistIds.length} 个歌单吗？`"
        confirmText="取消收藏"
        @confirm="kugouBatchDeletePlaylists"
        @cancel="kugouShowBatchConfirm = false"
    />
    <LyricSelector />
    <UpdateDialog :visible="updateInfo.available" :version="updateInfo.version" :notes="updateInfo.notes" :downloadUrl="updateInfo.downloadUrl" @close="updateInfo.available = false" />

    <!-- 赞赏弹窗 -->
    <Transition name="donate">
      <div v-if="showDonate" class="donate-overlay" @click.self="showDonate = false">
        <div class="donate-modal">
          <div class="donate-header">
            <h3>赞赏支持</h3>
            <span class="donate-sub">如果觉得好用，欢迎请开发者喝杯咖啡 ☕</span>
            <X :size="18" class="clickable" @click="showDonate = false" />
          </div>
          <div class="donate-body">
            <img src="/赞赏.png" alt="赞赏码" class="donate-qr" />
          </div>
          <p class="donate-thanks">感谢你的支持 ❤️</p>
        </div>
      </div>
    </Transition>

    <div v-if="route.path !== '/desktop-lyrics'" class="normal-layout-wrapper">
      <SongDetail />
      <LoginModal :show="showLogin" @close="showLogin = false" />
      <LockModal :show="showLockModal" @close="showLockModal = false" @verified="onLockVerified" />
      <MvPlayer />

      <!-- Custom Create Playlist Modal -->
    <div class="modal-overlay" v-if="showCreatePlaylist" @click="showCreatePlaylist = false">
        <div class="custom-modal" @click.stop>
            <div class="modal-header">
                <h3>新建歌单</h3>
                <X class="clickable" :size="20" @click="showCreatePlaylist = false" />
            </div>
            <div class="modal-body">
                <input
                    type="text"
                    v-model="newPlaylistName"
                    placeholder="请输入新歌单标题"
                    autofocus
                    @keyup.enter="submitCreatePlaylist"
                />
            </div>
            <div class="modal-footer">
                <button class="cancel-btn clickable" @click="showCreatePlaylist = false">取消</button>
                <button
                  class="save-btn clickable"
                  :disabled="!newPlaylistName.trim()"
                  @click="submitCreatePlaylist"
                >创建</button>
            </div>
        </div>
</div>

    <!-- QQ Cookie 查看弹窗(可复制) -->
    <div v-if="showCookieModal" class="modal-overlay" @click.self="showCookieModal = false">
        <div class="custom-modal" @click.stop>
            <div class="modal-header">
                <h3>{{ platformStore.isKugou ? '酷狗 Token' : 'QQ 音乐 Cookie' }}</h3>
                <X class="clickable" :size="20" @click="showCookieModal = false" />
            </div>
            <div class="modal-body">
                <textarea
                    class="cookie-textarea"
                    :value="cookieDisplayValue"
                    readonly
                    rows="10"
                ></textarea>
            </div>
            <div class="modal-footer">
                <button class="cancel-btn clickable" @click="showCookieModal = false">关闭</button>
                <button class="save-btn clickable" @click="copyCookie">
                    {{ cookieCopied ? '已复制' : (platformStore.isKugou ? '复制 Token' : '复制 Cookie') }}
                </button>
            </div>
        </div>
    </div>

    <!-- 酷狗概念版领取 VIP 弹窗 -->
    <div v-if="showYouthVipModal" class="modal-overlay" @click.self="showYouthVipModal = false">
        <div class="custom-modal youth-vip-modal" @click.stop>
            <div class="modal-header">
                <h3>领取酷狗概念版 VIP</h3>
                <X class="clickable" :size="20" @click="showYouthVipModal = false" />
            </div>
            <div class="modal-body">
                <div class="youth-vip-status">
                    <div class="youth-vip-status-label">当前状态</div>
                    <div class="youth-vip-status-value">
                        {{ youthVipLoading ? '加载中...' : (youthVipInfo?.is_vip || youthVipInfo?.isVip || youthVipInfo?.vip_status ? 'VIP 会员' : '普通用户') }}
                    </div>
                </div>
                <div class="youth-vip-status">
                    <div class="youth-vip-status-label">当月已领取天数</div>
                    <div class="youth-vip-status-value">{{ youthMonthRecord.length }} 天</div>
                </div>
                <div class="youth-vip-actions">
                    <button class="youth-vip-btn primary" :disabled="youthVipClaiming" @click="claimYouthDayVip">
                        {{ youthVipClaiming ? '领取中...' : '领取今天一天 VIP' }}
                    </button>
                    <button class="youth-vip-btn" :disabled="youthVipClaiming" @click="claimYouthVipHours">
                        {{ youthVipClaiming ? '领取中...' : '领取 3 小时' }}
                    </button>
                    <button class="youth-vip-btn" :disabled="youthVipUpgrading" @click="upgradeYouthVip">
                        {{ youthVipUpgrading ? '升级中...' : '升级畅听 VIP' }}
                    </button>
                </div>
                <div v-if="youthVipActionMsg" class="youth-vip-msg">{{ youthVipActionMsg }}</div>
                <div class="youth-vip-tips">
                    提示：这些接口来自酷狗概念版测试接口,部分用户可能不可用；领取 3 小时每天最多 8 次;升级畅听 VIP 需先领取一天 VIP。
                </div>
            </div>
            <div class="modal-footer">
                <button class="cancel-btn clickable" @click="showYouthVipModal = false">关闭</button>
            </div>
        </div>
    </div>

<header class="header" v-show="!playerStore.showSongDetail && !playerStore.showMvPlayer">
        <div class="header-left no-drag">
          <div class="logo clickable" @click="navigateTo(platformStore.isQQ ? '/qq' : platformStore.isKugou ? '/kugou' : '/')">
            <div class="logo-icon">
              <Music :size="20" color="white" />
            </div>
            <span>茗韵时光</span>
          </div>
          <!-- 平台切换:下拉框(网易云 / 酷狗概念版 / QQ 音乐) -->
          <div class="platform-select-wrapper" :title="`当前：${platformStore.currentPlatform.label}`">
            <CustomSelect
                :model-value="platformStore.current"
                :options="platformOptions"
                transparent
                compact
                class="platform-select-sm"
                @change="onPlatformChange"
            />
          </div>
          <div class="nav-arrows">
            <div class="arrow-btn clickable" @click="router.back()">
                <ChevronLeft :size="18" />
            </div>
            <div class="arrow-btn clickable" @click="router.forward()">
                <ChevronRight :size="18" />
            </div>
          </div>
          <div class="header-search">
            <div class="search-input">
              <Search :size="14" class="search-icon clickable" @click="handleSearch" />
              <input
                type="text"
                v-model="searchText"
                placeholder="搜索"
                @keyup.enter="handleSearch"
                @focus="onSearchFocus"
                @blur="onSearchBlur"
              />
              <SearchSuggest
                module="music"
                :query="searchText"
                :visible="showSearchSuggest"
                @select="onSelectSuggest"
                @select-item="onSelectItem"
              />
            </div>
            <div class="mic-icon clickable">
              <Mic :size="16" />
            </div>
            <div class="keyboard-btn clickable no-drag" @click="openOsk" title="打开虚拟键盘">
                <Keyboard :size="18" />
            </div>
            <div class="author-tag clickable no-drag" @click="openAuthorLink">
                By XiaoMingKY
            </div>
            <div class="github-link no-drag" @click="openGithub" title="GitHub">
                <Github :size="16" />
            </div>
            <div class="donate-link no-drag" @click="showDonate = true" title="赞赏支持">
                <HeartHandshake :size="16" />
            </div>
          </div>
        </div>
        
        <div class="header-right no-drag">
          <div v-if="platformStore.isNetease" class="api-line-selector" :title="`当前：${currentApiLineLabel}`">
            <span class="api-line-icon"><Sparkles :size="12" /></span>
            <CustomSelect
                v-model="currentApiLine"
                :options="apiLineOptions"
                transparent
                @change="handleSwitchApiLine"
            />
          </div>
          <div class="user-info-container">
            <div class="user-info clickable" @click="!isLoggedIn && (showLogin = true)">
              <img v-if="isLoggedIn && avatarUrl" :src="avatarUrl" class="avatar" />
              <div v-else class="avatar"></div>
              <span class="nickname">{{ isLoggedIn ? nickname : '未登录' }}</span>
              <span v-if="platformStore.isKugou && kugouUserStore.profile?.isVip" class="kugou-vip-badge" title="酷狗概念版 VIP">VIP</span>
              <div v-if="!platformStore.isQQ && !platformStore.isKugou && userStore.vipInfo && userStore.vipInfo.redVipLevelIcon" class="vip-badge">
                 <img :src="userStore.vipInfo.redVipLevelIcon" class="vip-icon" />
              </div>
              <span v-if="platformStore.isQQ && qqUserStore.profile?.isVip" class="qq-vip-badge" :title="qqUserStore.profile?.vipLevel >= 2 ? '豪华绿钻' : '绿钻'">
                  <img v-if="qqUserStore.profile?.vipIcon" :src="qqUserStore.profile.vipIcon" class="qq-vip-icon" />
                  <template v-else>VIP</template>
              </span>
            </div>
          </div>

          <div class="theme-icons clickable" @click.stop="isLoggedIn ? toggleUserMenu() : null">
            <Settings :size="16" />

            <div class="user-dropdown" v-if="showUserMenu && isLoggedIn" @click.stop>
                <div class="dropdown-header">
                    <!-- 酷狗平台:显示酷狗用户数据 -->
                    <template v-if="platformStore.isKugou">
                    <div class="stats-item">
                        <span class="count">{{ kugouUserStore.profile?.userid || '-' }}</span>
                        <span class="label">酷狗ID</span>
                    </div>
                    <div class="stats-item">
                        <span class="count">{{ kugouUserStore.profile?.fans || kugouUserStore.profile?.fan_count || 0 }}</span>
                        <span class="label">粉丝</span>
                    </div>
                    <div class="stats-item">
                        <span class="count">{{ kugouUserStore.profile?.follows || kugouUserStore.profile?.follow_count || 0 }}</span>
                        <span class="label">关注</span>
                    </div>
                    </template>
                    <!-- QQ平台:显示QQ号 -->
                    <template v-else-if="platformStore.isQQ">
                    <div class="stats-item">
                        <span class="count">{{ qqUserStore.profile?.uin || '-' }}</span>
                        <span class="label">QQ号</span>
                    </div>
                    </template>
                    <!-- 网易云平台:显示动态/关注/粉丝 -->
                    <template v-else>
                    <div class="stats-item">
                        <span class="count">{{ userStore.profile?.eventCount || 0 }}</span>
                        <span class="label">动态</span>
                    </div>
                    <div class="stats-item">
                        <span class="count">{{ userStore.profile.follows || 0 }}</span>
                        <span class="label">关注</span>
                    </div>
                    <div class="stats-item">
                        <span class="count">{{ userStore.profile.followeds || 0 }}</span>
                        <span class="label">粉丝</span>
                    </div>
                    </template>
                </div>
                <div class="dropdown-list">
                    <div v-if="platformStore.isNetease" class="menu-sub-item">
                        <div class="left">等级</div>
                        <div class="right">Lv.{{ userStore.profile.level || 0 }}</div>
                    </div>
                    <!-- 酷狗平台:显示VIP状态 -->
                    <div v-if="platformStore.isKugou" class="menu-sub-item">
                        <div class="left">VIP状态</div>
                        <div class="right">{{ kugouUserStore.profile?.isVip ? 'VIP会员' : '普通用户' }}</div>
                    </div>
                    <!-- 酷狗平台:领取概念版 VIP -->
                    <div v-if="platformStore.isKugou" class="menu-sub-item clickable" @click="openYouthVipModal">
                        <div class="left">领取 VIP</div>
                        <div class="right"><Sparkles :size="14" /></div>
                    </div>
                    <!-- QQ/酷狗 平台:显示 Cookie(可复制) -->
                    <div v-if="(platformStore.isQQ && qqUserStore.cookie) || (platformStore.isKugou && kugouUserStore.cookie)" class="menu-sub-item" @click="showCookieModal = true">
                        <div class="left">查看 {{ platformStore.isKugou ? 'Token' : 'Cookie' }}</div>
                        <div class="right"><Copy :size="14" /></div>
                    </div>
                    <!-- 关闭行为设置 -->
                    <div class="menu-sub-item close-behavior-setting">
                        <div class="left">关闭行为</div>
                        <div class="close-behavior-options">
                            <span
                                class="behavior-opt"
                                :class="{ active: closePref === 'ask' }"
                                @click="saveClosePref('ask')"
                            >询问</span>
                            <span
                                class="behavior-opt"
                                :class="{ active: closePref === 'tray' }"
                                @click="saveClosePref('tray')"
                            >托盘</span>
                            <span
                                class="behavior-opt"
                                :class="{ active: closePref === 'quit' }"
                                @click="saveClosePref('quit')"
                            >退出</span>
                        </div>
                    </div>
                    <div class="menu-sub-item" @click="logout">
                        <div class="left">退出登录</div>
                    </div>
                </div>
            </div>
          </div>
          <div class="window-controls">
            <div class="win-btn clickable" @click="minimize"><Minus :size="16" /></div>
            <div class="win-btn clickable" @click="toggleMaximize">
                <Square v-if="!isMaximized" :size="14" />
                <Copy v-else :size="14" style="transform: rotate(180deg)" />
            </div>
            <div class="win-btn clickable close" @click="openCloseOptions"><X :size="16" /></div>

            <Transition name="dropdown">
                <div v-if="showCloseOptions" class="close-options-dropdown" @click.stop>
                    <div class="close-option-item" @click="minimizeToTray">
                        <Minus :size="14" /> 缩小到托盘
                    </div>
                    <div class="close-option-item danger" @click="quitApp">
                        <X :size="14" /> 彻底退出
                    </div>
                    <div class="close-option-divider"></div>
                    <div class="close-option-settings">
                        <span class="settings-label">默认行为：</span>
                        <span
                            class="setting-option"
                            :class="{ active: closePref === 'ask' }"
                            @click="saveClosePref('ask')"
                        >每次询问</span>
                        <span
                            class="setting-option"
                            :class="{ active: closePref === 'tray' }"
                            @click="saveClosePref('tray')"
                        >托盘</span>
                        <span
                            class="setting-option"
                            :class="{ active: closePref === 'quit' }"
                            @click="saveClosePref('quit')"
                        >退出</span>
                    </div>
                </div>
            </Transition>
          </div>
        </div>
    </header>

    <div class="main-layout">
      <aside class="sidebar">
        <div class="sidebar-scroll-container">
            <!-- Navigation：根据平台动态显示 -->
            <div class="sidebar-section">
              <div
                v-for="item in (platformStore.isQQ ? qqNavItems : platformStore.isKugou ? kugouNavItems : neteaseNavItems)"
                :key="item.id"
                class="menu-item"
                :class="{ active: (item.id === '/qq' || item.id === '/kugou' || item.id === '/') ? route.path === item.id : route.path.startsWith(item.id) }"
                @click="navigateTo(item.id)"
              >
                <component :is="item.icon" :size="18" />
                <span class="menu-label">{{ item.label }}</span>
              </div>
            </div>

            <!-- Library：本地资源(官方云盘仅网易云平台显示) -->
            <div class="sidebar-label">我的音乐</div>
            <div class="sidebar-section">
              <div
                v-for="item in libraryNavItems.filter(i => !(i.id === '/netease-cloud' && !platformStore.isNetease))"
                :key="item.id"
                class="menu-item"
                :class="{ active: route.path === item.id }"
                @click="navigateTo(item.id)"
              >
                <component :is="item.icon" :size="18" />
                <span class="menu-label">{{ item.label }}</span>
              </div>
            </div>

            <!-- 网易云：创建的歌单 -->
            <template v-if="platformStore.isNetease">
                <div v-if="userStore.isLoggedIn" class="sidebar-label">
                    <span>创建的歌单</span>
                    <Plus :size="14" class="clickable add-icon" @click.stop="handleCreatePlaylist" />
                </div>
                <div v-if="userStore.isLoggedIn" class="sidebar-section">
                  <div v-if="userStore.likedPlaylistId"
                       class="menu-item"
                       :class="{ active: route.path === `/playlist/${userStore.likedPlaylistId}` }"
                       @click="requireLockForPlaylist(userStore.likedPlaylistId)">
                    <Heart :size="18" />
                    <span class="menu-label">我喜欢的音乐</span>
                    <Lock v-if="userStore.lockStatus.locked" :size="12" class="lock-icon" />
                  </div>

                  <div
                    v-for="p in userStore.playlists.slice(1)"
                    :key="p.id"
                    class="menu-item playlist-item"
                    :class="{ active: route.path === `/playlist/${p.id}` }"
                    @click="requireLockForPlaylist(p.id)"
                  >
                    <ListMusic :size="16" />
                    <span class="menu-label truncate">{{ p.name }}</span>
                    <Lock v-if="userStore.lockStatus.locked" :size="12" class="lock-icon" />
                  </div>
                </div>
            </template>

            <!-- QQ 音乐：仅显示"我喜欢的音乐"(线上 API),不显示用户歌单列表 -->
            <template v-else-if="platformStore.isQQ">
                <div class="sidebar-label">
                    <span>QQ 音乐</span>
                </div>
                <div class="sidebar-section">
                  <div
                    class="menu-item"
                    :class="{ active: route.path === '/qq/liked' }"
                    @click="navigateTo('/qq/liked')"
                  >
                    <Heart :size="18" />
                    <span class="menu-label">我喜欢的音乐</span>
                  </div>
                </div>
            </template>

            <!-- 酷狗概念版：区分创建/收藏歌单，除我喜欢外自动折叠 -->
            <template v-else-if="platformStore.isKugou">
                <template v-if="kugouUserStore.isLoggedIn">
                    <!-- 我创建的歌单（含"我喜欢"） -->
                    <div class="sidebar-label clickable" @click="kugouCreatedCollapsed = !kugouCreatedCollapsed">
                        <ChevronRight v-if="kugouCreatedCollapsed" :size="12" />
                        <ChevronDown v-else :size="12" />
                        <span>我创建的歌单</span>
                        <Plus :size="14" class="sidebar-add-btn" title="新建歌单" @click.stop="kugouShowCreatePlaylist = true" />
                    </div>
                    <div v-if="!kugouCreatedCollapsed" class="sidebar-section">
                        <div
                            v-for="p in kugouCreatedPlaylists"
                            :key="p.id"
                            class="menu-item playlist-item"
                            :class="{ active: p.id === kugouUserStore.likedPlaylistId ? route.path === '/kugou/liked' : route.path === `/kugou/playlist/${p.id}` }"
                            @click="navigateTo(p.id === kugouUserStore.likedPlaylistId ? '/kugou/liked' : `/kugou/playlist/${p.id}`)"
                        >
                            <Heart v-if="p.id === kugouUserStore.likedPlaylistId" :size="16" :fill="'#EC4141'" :color="'#EC4141'" />
                            <ListMusic v-else :size="16" />
                            <span class="menu-label truncate">{{ p.name }}</span>
                        </div>
                    </div>
                    <!-- 我收藏的歌单 -->
                    <div v-if="kugouCollectedPlaylists.length" class="sidebar-label clickable" @click="kugouCollectedCollapsed = !kugouCollectedCollapsed">
                        <ChevronRight v-if="kugouCollectedCollapsed" :size="12" />
                        <ChevronDown v-else :size="12" />
                        <span>我收藏的歌单</span>
                        <Trash2
                            v-if="!kugouCollectedCollapsed"
                            :size="13"
                            class="sidebar-add-btn"
                            :title="kugouPlaylistBatchMode ? '退出批量' : '批量管理'"
                            @click.stop="kugouTogglePlaylistBatch"
                        />
                    </div>
                    <!-- 批量操作栏 -->
                    <div v-if="!kugouCollectedCollapsed && kugouPlaylistBatchMode && kugouCollectedPlaylists.length" class="kugou-sidebar-batch-bar">
                        <div class="kugou-sidebar-batch-select-all" @click="kugouSelectAllPlaylists">
                            <CheckSquare v-if="kugouIsAllPlaylistsSelected" :size="14" class="kugou-check-icon active" />
                            <Square v-else :size="14" class="kugou-check-icon" />
                            <span>全选</span>
                        </div>
                        <button
                            class="kugou-sidebar-batch-delete-btn"
                            @click="kugouShowBatchConfirm = true"
                            :disabled="!kugouSelectedPlaylistIds.length || kugouBatchDeleting"
                        >
                            {{ kugouBatchDeleting ? '删除中...' : `取消收藏(${kugouSelectedPlaylistIds.length})` }}
                        </button>
                    </div>
                    <div v-if="!kugouCollectedCollapsed && kugouCollectedPlaylists.length" class="sidebar-section">
                        <div
                            v-for="p in kugouCollectedPlaylists"
                            :key="p.id"
                            class="menu-item playlist-item"
                            :class="{ active: !kugouPlaylistBatchMode && route.path === `/kugou/playlist/${p.id}` }"
                            @click="kugouPlaylistBatchMode ? kugouTogglePlaylistSelect(p.id) : navigateTo(`/kugou/playlist/${p.id}`)"
                        >
                            <template v-if="kugouPlaylistBatchMode">
                                <CheckSquare v-if="kugouIsPlaylistSelected(p.id)" :size="16" class="kugou-check-icon active" />
                                <Square v-else :size="16" class="kugou-check-icon" />
                            </template>
                            <ListMusic v-else :size="16" />
                            <span class="menu-label truncate">{{ p.name }}</span>
                        </div>
                    </div>
                </template>
            </template>
        </div>
      </aside>

      <div class="main-content-wrapper">
         <router-view :key="$route.fullPath" />
      </div>
    </div>

    <footer class="footer" :class="{ 'is-transparent': playerStore.showSongDetail && playerStore.bgMode === 'cover' }">
      <div class="song-info" @click="toggleSongDetailOverlay">
        <img :src="getFooterCoverUrl()" class="song-cover" />
        <div class="song-detail">
          <div class="song-name-row">
            <span class="song-name" :title="playerStore.currentSong.name">{{ playerStore.currentSong.name }}</span>
            <span v-if="playerStore.currentSong.fee === 1 || playerStore.currentSong.isVip" class="vip-badge-footer">VIP</span>
            <Heart
              :size="16"
              class="heart-icon clickable hover-red"
              :class="{ 'text-red': playerStore.isLiked }"
              :fill="playerStore.isLiked ? platformStore.themeColor : 'none'"
              :color="playerStore.isLiked ? platformStore.themeColor : 'currentColor'"
              @click.stop="playerStore.toggleLike()"
            />
          </div>
          <span class="artist-name" :title="playerStore.currentSong.artist">{{ playerStore.currentSong.artist }}</span>
        </div>
      </div>

      <div class="player-controls">
        <div class="control-btns">
          <div class="mode-btn clickable hover-red" title="播放模式" @click="playerStore.togglePlayMode()">
             <Repeat v-if="playerStore.playMode === 0" :size="18" />
             <Repeat v-else-if="playerStore.playMode === 1" :size="18" class="text-red" />
             <Shuffle v-else :size="18" />
          </div>
          <SkipBack :size="20" fill="currentColor" class="clickable hover-red" @click="playerStore.prev()" />
          <div class="play-circle" @click="playerStore.togglePlay()">
             <Play v-if="!playerStore.isPlaying" :size="22" fill="#333" style="margin-left: 2px" />
             <Pause v-else :size="20" fill="#333" />
          </div>
          <SkipForward :size="20" fill="currentColor" class="clickable hover-red" @click="playerStore.next()" />
          <span class="lyric-btn-static clickable hover-red" @click="toggleSongDetailOverlay">词</span>
          <span
            class="desktop-lyric-btn clickable hover-red"
            :class="{ active: playerStore.showDesktopLyrics }"
            title="开启/关闭桌面歌词"
            @click="playerStore.toggleDesktopLyrics()"
          >
            <Tv :size="16" />
          </span>
        </div>
        <div class="progress-bar-container">
          <span class="time">{{ formatTime(playerStore.currentTime) }}</span>
          <div class="progress-bar" :class="{ dragging: isDraggingProgress }" @mousedown="startDragProgress">
            <div class="progress-fill" :style="{ width: (playerStore.currentTime / (playerStore.currentSong.duration || 1) * 100) + '%' }">
              <div class="progress-dot"></div>
            </div>
          </div>
          <span class="time">{{ formatTime(playerStore.currentSong.duration) }}</span>
        </div>
      </div>

      <div class="extra-controls">
        <div class="volume-control flex items-center gap-2">
          <Volume2 :size="18" class="clickable hover-red" />
          <div class="volume-slider" :class="{ dragging: isDraggingVolume, boosted: playerStore.volume > 100 }" @mousedown="startDragVolume" @wheel="onVolumeWheel">
            <div class="volume-fill" :style="{ width: Math.min(100, playerStore.volume) + '%' }">
               <div class="progress-dot"></div>
            </div>
          </div>
          <span class="volume-value">{{ playerStore.volume > 100 ? (playerStore.volume / 100).toFixed(1) + 'x' : playerStore.volume }}</span>
          <span class="boost-btn clickable" :class="{ active: playerStore.volume > 100 }" @click="boostVolume" title="音量增益(每次 +50%,最大 500%)">
            <Zap :size="14" />
          </span>
        </div>

        <EqPanel />
        
        <div class="speed-selector-container">
            <div class="quality-badge clickable" @click="showSpeedMenu = !showSpeedMenu">
                {{ playerStore.playbackRate }}x
            </div>
            <div v-if="showSpeedMenu" class="quality-menu no-drag">
                <div v-for="s in [0.5,0.75,1,1.25,1.5,2]" :key="s"
                    class="quality-option" :class="{ active: playerStore.playbackRate === s }"
                    @click="playerStore.setPlaybackRate(s); showSpeedMenu = false">
                    {{ s }}x
                    <Check v-if="playerStore.playbackRate === s" :size="14" />
                </div>
            </div>
        </div>

        <div class="quality-selector-container">
            <div class="quality-badge clickable" @click="showQualityMenu = !showQualityMenu">
                {{ qualityBadgeLabel }}
            </div>

            <div v-if="showQualityMenu" class="quality-menu no-drag">
                <div
                    v-for="(label, key) in qualityLabels"
                    :key="key"
                    class="quality-option"
                    :class="{ active: playerStore.quality === key }"
                    @click="playerStore.setQuality(key); showQualityMenu = false"
                >
                    {{ label }}
                    <Check v-if="playerStore.quality === key" :size="14" />
                </div>
            </div>
        </div>

        <ListMusic :size="18" class="clickable hover-red" @click="playerStore.showPlaylist = !playerStore.showPlaylist" />
      </div>
    </footer>

    <!-- Playlist Drawer -->
    <div class="playlist-drawer" :class="{ show: playerStore.showPlaylist }">
       <div class="drawer-header">
          <h3>当前播放 ({{ playerStore.playlist.length }})</h3>
          <span class="clear-btn clickable hover-red" @click="playerStore.clearPlaylist()">清空列表</span>
       </div>
       <div class="drawer-list" ref="drawerListRef">
          <div 
            v-for="(song, index) in playerStore.playlist" 
            :key="song.id" 
            class="list-item"
            :class="{ active: index === playerStore.currentIndex, dragging: draggedPlaylistIndex === index }"
            draggable="true"
            @dragstart="onDragStart(index, $event)"
            @dragover="onDragOver(index, $event)"
            @dragend="onDragEnd"
            @dblclick="playerStore.playSong(song)"
          >
             <span class="drag-handle no-drag">⠿</span>
             <span class="song-name truncate">{{ song.name }}</span>
             <span class="artist truncate">
                {{ song.ar ? (song.ar.length > 0 ? song.ar.map(a => a.name).join('/') : '未知歌手') : (song.artists ? song.artists.map(a => a.name).join('/') : (song.artist || '未知歌手')) }}
             </span>
             <span class="duration">{{ formatTime((song.dt || (song.duration ? song.duration * 1000 : 0)) / 1000) }}</span>
          </div>
       </div>
     </div>
    </div>
    <router-view v-if="route.path === '/desktop-lyrics'" />

    <!-- 酷狗新建歌单弹窗 -->
    <div v-if="kugouShowCreatePlaylist" class="kugou-modal-overlay" @click.self="kugouShowCreatePlaylist = false">
        <div class="kugou-modal kugou-modal-sm">
            <div class="kugou-modal-header">
                <span class="kugou-modal-title">新建歌单</span>
                <X :size="18" class="kugou-modal-close" @click="kugouShowCreatePlaylist = false" />
            </div>
            <div class="kugou-modal-body">
                <input
                    v-model="kugouNewPlaylistName"
                    class="kugou-modal-input"
                    placeholder="请输入歌单名称"
                    @keyup.enter="kugouCreatePlaylist"
                    autofocus
                />
                <button class="kugou-modal-confirm-btn" @click="kugouCreatePlaylist" :disabled="kugouCreating">
                    {{ kugouCreating ? '创建中...' : '创建' }}
                </button>
            </div>
        </div>
    </div>
  </div>
</template>

<style>
/* 平台切换下拉:缩小选项字体(下拉浮层 Teleport 到 body,需全局样式) */
.platform-select-wrapper .cs-dropdown.cs-dropdown-fixed .cs-option {
    font-size: 12px;
    padding: 5px 10px;
}

.is-lyrics-window, .is-lyrics-window body, .is-lyrics-window #app, .is-lyrics-window .app-container {
    background: transparent !important;
    background-color: transparent !important;
}

.normal-layout-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
}


/* App Specific Layout Fixes */
.header {
    height: 60px;
    background-color: var(--header-bg);
    -webkit-app-region: drag;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 15px;
    flex-shrink: 0;
    position: relative;
    z-index: 5000;
}

.header-search { position: relative; }
.header-search .search-input { position: relative; }

.no-drag, .clickable, .search-input, .window-controls, .user-info, .logo, .nav-arrows, .mic-icon, .theme-icons, .keyboard-btn, .author-tag {
    -webkit-app-region: no-drag !important;
    pointer-events: auto !important;
}

.window-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    position: relative;
    z-index: 9999;
}

.win-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    opacity: 0.8;
    border-radius: 4px;
    cursor: pointer !important;
    pointer-events: auto !important;
    -webkit-app-region: no-drag !important;
}

.win-btn:hover {
    opacity: 1;
    background-color: rgba(255, 255, 255, 0.1);
}

.win-btn.close:hover {
    background-color: #e81123;
}

.close-options-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    width: 200px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    padding: 8px 0;
    z-index: 99999;
    cursor: default;
}

.close-option-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-size: 13px;
    color: #333;
    cursor: pointer;
    transition: background 0.15s;
}

.close-option-item:hover {
    background: #f5f5f5;
}

.close-option-item.danger:hover {
    color: #e81123;
}

.close-option-divider {
    height: 1px;
    background: #eee;
    margin: 6px 0;
}

.close-option-settings {
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.settings-label {
    font-size: 11px;
    color: #999;
    white-space: nowrap;
}

.setting-option {
    font-size: 11px;
    color: #999;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 10px;
    transition: all 0.2s;
}

.setting-option:hover {
    color: #333;
    background: #f0f0f0;
}

.setting-option.active {
    color: var(--primary-color);
    background: rgba(236, 65, 65, 0.08);
    font-weight: 600;
}

.dropdown-enter-active,
.dropdown-leave-active {
    transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
    opacity: 0;
    transform: translateY(-5px);
}

/* User Dropdown Styles */
.theme-icons {
    position: relative;
    z-index: 1000;
}

/* 平台切换下拉框（logo 右侧） */
.platform-select-wrapper {
    display: flex;
    align-items: center;
    padding: 0 4px;
    background: #fff;
    border: 1px solid rgba(236, 65, 65, 0.4);
    border-radius: 14px;
    height: 28px;
    transition: all 0.2s;
}
.platform-select-wrapper:hover {
    border-color: var(--primary-color);
    background: #fff;
}

/* API 线路选择器（用户头像左侧） */
.api-line-selector {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(236, 65, 65, 0.25);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    margin-right: 8px;
}

.api-line-selector:hover {
    border-color: var(--primary-color);
    background: #fff;
}

.api-line-icon {
    display: flex;
    align-items: center;
    color: var(--primary-color);
}

.main-content-wrapper {
    flex: 1;
    overflow: hidden;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.user-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    width: 250px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 25px rgba(0,0,0,0.2);
    margin-top: 15px;
    color: #333;
    overflow: hidden;
    cursor: default;
}

.keyboard-btn {
    margin-left: 10px;
    color: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
}

.keyboard-btn:hover {
    color: white;
}

.author-tag {
    margin-left: 20px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.2s;
}

.author-tag:hover {
    color: white;
    text-shadow: 0 0 8px rgba(255,255,255,0.4);
}
.github-link {
    margin-left: 12px;
    color: rgba(255,255,255,0.6);
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: all 0.2s;
}
.github-link:hover {
    color: white;
}
.donate-link {
    margin-left: 10px;
    color: #f59e0b;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: all 0.2s;
}
.donate-link:hover {
    color: #fbbf24;
    transform: scale(1.1);
}

/* 赞赏弹窗 */
.donate-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 40000;
    will-change: opacity;
}
.donate-overlay::after {
    content: ''; position: absolute; inset: 0;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
}
.donate-modal {
    background: #fff; border-radius: 16px; width: 320px; text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden;
    position: relative; z-index: 1;
}
.donate-header {
    padding: 20px 20px 0; position: relative;
}
.donate-header h3 { margin: 0; font-size: 18px; color: #1a1a2e; }
.donate-sub { font-size: 12px; color: #999; display: block; margin-top: 4px; }
.donate-header .clickable { position: absolute; top: 16px; right: 16px; color: #bbb; }
.donate-body { padding: 16px 20px; }
.donate-qr { width: 220px; height: 220px; object-fit: contain; border-radius: 8px; }
.donate-thanks { font-size: 13px; color: #f59e0b; padding-bottom: 16px; margin: 0; }

.donate-enter-active { transition: opacity 0.2s ease; }
.donate-leave-active { transition: opacity 0.15s ease; }
.donate-enter-from, .donate-leave-to { opacity: 0; }
.donate-enter-from .donate-modal { transform: scale(0.95) translateY(8px); }
.donate-leave-to .donate-modal { transform: scale(0.98); }
.donate-modal { transition: transform 0.2s ease; }

.dropdown-header {
    display: flex;
    justify-content: space-around;
    padding: 20px 0;
    border-bottom: 1px solid #f0f0f0;
}

.stats-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

.stats-item .count {
    font-size: 16px;
    font-weight: bold;
}

.sidebar-label {
    padding: 10px 20px 5px;
    font-size: 12px;
    color: #999;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.sidebar-label.clickable {
    cursor: pointer;
    gap: 6px;
    justify-content: flex-start;
    user-select: none;
}
.sidebar-label.clickable:hover { color: #666; }
.sidebar-label.clickable svg { flex-shrink: 0; }
.sidebar-add-btn {
    margin-left: auto;
    opacity: 0.5;
    cursor: pointer;
    transition: opacity 0.15s, color 0.15s;
}
.sidebar-add-btn:hover {
    opacity: 1;
    color: var(--primary-color, #2CA2F5);
}

/* 酷狗侧边栏批量管理 */
.kugou-sidebar-batch-bar {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 14px; margin-bottom: 4px;
    background: var(--hover-bg, rgba(0,0,0,0.04));
    border-radius: 6px;
}
.kugou-sidebar-batch-select-all {
    display: flex; align-items: center; gap: 4px;
    cursor: pointer; font-size: 12px; color: var(--text-secondary, #666);
}
.kugou-sidebar-batch-delete-btn {
    margin-left: auto; padding: 4px 12px; border-radius: 12px;
    border: none; background: #ff6b6b; color: white;
    cursor: pointer; font-size: 12px;
    transition: opacity 0.15s;
}
.kugou-sidebar-batch-delete-btn:hover:not(:disabled) { opacity: 0.85; }
.kugou-sidebar-batch-delete-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kugou-check-icon {
    color: #ccc;
    transition: color 0.2s;
    flex-shrink: 0;
}
.kugou-check-icon.active {
    color: var(--primary-color, #2CA2F5);
}

/* 酷狗歌单管理弹窗(全局样式,各组件复用) */
.kugou-modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.45); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: kugou-modal-fade-in 0.2s ease;
}
@keyframes kugou-modal-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes kugou-modal-slide-up {
    from { opacity: 0; transform: translateY(16px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.kugou-modal {
    background: var(--bg-main, #fff) !important; border-radius: 12px;
    width: 400px; max-height: 500px; overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.04);
    display: flex; flex-direction: column;
    animation: kugou-modal-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.kugou-modal-sm { width: 340px; }
.kugou-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 22px; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
}
.kugou-modal-title {
    font-size: 16px; font-weight: 600; color: var(--text-main, #333);
    letter-spacing: 0.3px;
}
.kugou-modal-close {
    cursor: pointer; color: var(--text-light, #999);
    transition: color 0.15s, transform 0.15s;
    padding: 4px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
}
.kugou-modal-close:hover {
    color: var(--text-main, #333);
    background: var(--hover-bg, rgba(0,0,0,0.05));
    transform: rotate(90deg);
}
.kugou-modal-body { padding: 14px 22px 22px; overflow-y: auto; flex: 1; }
.kugou-modal-body::-webkit-scrollbar { width: 6px; }
.kugou-modal-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
.kugou-modal-add-new {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    color: var(--primary-color, #2CA2F5); font-size: 14px; margin-bottom: 8px;
    transition: background 0.15s;
}
.kugou-modal-add-new:hover { background: var(--hover-bg, rgba(0,0,0,0.04)); }
.kugou-modal-empty { text-align: center; color: var(--text-light, #999); padding: 30px 0; font-size: 13px; }
.kugou-modal-playlist-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 8px; cursor: pointer;
    transition: background 0.15s, transform 0.1s;
}
.kugou-modal-playlist-item:hover { background: var(--hover-bg, rgba(0,0,0,0.04)); }
.kugou-modal-playlist-item:active { transform: scale(0.99); }
.kugou-modal-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.kugou-modal-cover-placeholder {
    width: 36px; height: 36px; border-radius: 6px; flex-shrink: 0;
    background: var(--hover-bg, rgba(0,0,0,0.04)); color: var(--text-light, #999);
    display: flex; align-items: center; justify-content: center;
}
.kugou-modal-playlist-name {
    flex: 1; font-size: 14px; color: var(--text-main, #333);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-modal-playlist-count { font-size: 12px; color: var(--text-light, #999); flex-shrink: 0; }
.kugou-modal-input {
    width: 100%; padding: 10px 14px; border: 1.5px solid var(--border-color, rgba(0,0,0,0.1));
    border-radius: 8px; font-size: 14px; color: var(--text-main, #333);
    background: var(--bg-sidebar, #fff); box-sizing: border-box; margin-bottom: 14px;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.kugou-modal-input:focus {
    outline: none; border-color: var(--primary-color, #2CA2F5);
    box-shadow: 0 0 0 3px rgba(44, 162, 245, 0.12);
}
.kugou-modal-confirm-btn {
    width: 100%; padding: 11px; border: none; border-radius: 8px;
    background: var(--primary-color, #2CA2F5); color: white; cursor: pointer; font-size: 14px;
    font-weight: 500; letter-spacing: 0.5px;
    transition: opacity 0.15s, transform 0.1s;
}
.kugou-modal-confirm-btn:hover:not(:disabled) { opacity: 0.9; }
.kugou-modal-confirm-btn:active:not(:disabled) { transform: scale(0.98); }
.kugou-modal-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.add-icon {
    opacity: 0.6;
    transition: opacity 0.2s;
    cursor: pointer;
}

.add-icon:hover {
    opacity: 1;
    color: var(--primary-color);
}

.dropdown-list {
    padding: 10px 0;
}

.menu-sub-item {
    padding: 12px 20px;
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    cursor: pointer;
}

.menu-sub-item:hover {
    background-color: #f5f5f5;
}

/* 关闭行为设置 */
.close-behavior-setting {
    flex-direction: column;
    gap: 8px;
}
.close-behavior-setting:hover {
    background-color: transparent;
}
.close-behavior-options {
    display: flex;
    gap: 8px;
    padding: 0 20px 8px;
}
.behavior-opt {
    flex: 1;
    text-align: center;
    font-size: 12px;
    padding: 5px 0;
    border-radius: 4px;
    cursor: pointer;
    background: #f0f0f0;
    color: #666;
    transition: all 0.15s;
}
.behavior-opt:hover {
    background: #e0e0e0;
}
.behavior-opt.active {
    background: var(--primary-color, #c20c0c);
    color: #fff;
}

.vip-badge {
    margin-left: 5px;
}

.vip-icon {
    height: 12px;
}

/* QQ 音乐 VIP 角标 */
.qq-vip-badge {
    margin-left: 6px;
    margin-right: 6px;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, #ffd700, #ff9500);
    border-radius: 10px;
    line-height: 1.4;
    letter-spacing: 0.5px;
    box-shadow: 0 1px 3px rgba(255, 149, 0, 0.4);
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    flex-shrink: 0;
}
/* 酷狗概念版 VIP 角标 */
.kugou-vip-badge {
    margin-left: 6px;
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, #2CA2F5, #4AD295);
    padding: 1px 5px;
    border-radius: 3px;
    line-height: 16px;
    flex-shrink: 0;
}
.qq-vip-icon {
    height: 14px;
    display: block;
}

.nickname {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.hover-red:hover {
    color: var(--primary-color) !important;
}

.text-red {
    color: var(--primary-color);
}

.pause-bar {
    width: 3px;
    height: 12px;
    background-color: #333;
    border-radius: 2px;
}

.progress-bar.dragging .progress-dot,
.volume-slider.dragging .progress-dot {
    display: block;
}

.lyric-btn-static {
    font-size: 14px;
    font-weight: 500;
    margin-left: 10px;
}

.desktop-lyric-btn {
    margin-left: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.8;
    transition: all 0.2s;
}

.desktop-lyric-btn:hover {
    opacity: 1;
}

.desktop-lyric-btn.active {
    color: var(--primary-color);
    opacity: 1;
}


.sidebar {
    width: var(--sidebar-width);
    background-color: var(--bg-sidebar);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.sidebar-scroll-container {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 20px;
}

/* Sidebar item layout fix */
.menu-item {
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap; /* Fix for single line */
}

.menu-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lock-icon {
    color: #999;
    flex-shrink: 0;
}

/* Playlist Drawer Styles */
.playlist-drawer {
    position: fixed;
    right: -320px;
    bottom: var(--footer-height);
    width: 320px;
    height: 500px;
    background: white;
    box-shadow: -5px 0 20px rgba(0,0,0,0.1);
    z-index: 2000;
    transition: right 0.3s ease;
    display: flex;
    flex-direction: column;
    border-top-left-radius: 8px;
}

.playlist-drawer.show {
    right: 0;
}

.drawer-header {
    padding: 20px;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.drawer-header h3 {
    font-size: 18px;
    color: #333;
}

.clear-btn {
    font-size: 12px;
    color: #666;
}

.drawer-list {
    flex: 1;
    overflow-y: auto;
}

.list-item {
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    cursor: pointer;
}

.list-item:hover {
    background: #f9f9f9;
}

.list-item.active {
    color: var(--primary-color);
    background: #f5f5f5;
}

.list-item.dragging {
    opacity: 0.5;
    background: #f0f0f0;
}

.drag-handle {
    cursor: grab;
    color: #ccc;
    font-size: 14px;
    user-select: none;
    margin-right: 2px;
}

.drag-handle:active {
    cursor: grabbing;
}

.list-item .song-name {
    flex: 2;
}

.list-item .artist {
    flex: 1;
    color: #888;
}

.list-item .duration {
    width: 40px;
    color: #ccc;
    text-align: right;
}
/* Custom Modal Styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.custom-modal {
    background: white;
    width: 480px;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
}

/* 领取酷狗概念版 VIP 弹窗 */
.youth-vip-modal { width: 420px; }
.youth-vip-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #f0f0f0;
}
.youth-vip-status-label { font-size: 13px; color: var(--text-light); }
.youth-vip-status-value { font-size: 14px; font-weight: 600; color: #2CA2F5; }
.youth-vip-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
}
.youth-vip-btn {
    height: 38px;
    border-radius: 19px;
    border: 1px solid rgba(44, 162, 245, 0.5);
    background: #fff;
    color: #2CA2F5;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
}
.youth-vip-btn.primary {
    background: linear-gradient(135deg, #2CA2F5, #4ad295);
    border: none;
    color: #fff;
    font-weight: 600;
}
.youth-vip-btn:hover { opacity: 0.9; }
.youth-vip-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.youth-vip-msg {
    margin-top: 12px;
    font-size: 13px;
    color: #2CA2F5;
    text-align: center;
}
.youth-vip-tips {
    margin-top: 14px;
    font-size: 12px;
    color: #999;
    line-height: 1.6;
    background: #fafafa;
    border-radius: 6px;
    padding: 10px 12px;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
}

.modal-header h3 {
    margin: 0;
    font-size: 18px;
}

.modal-body input {
    width: 100%;
    height: 40px;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0 15px;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
}

.modal-body input:focus {
    border-color: var(--primary-color);
}

/* Cookie 查看 textarea(只读,可手动选择) */
.cookie-textarea {
    width: 100%;
    min-height: 180px;
    max-height: 320px;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 12px;
    font-family: Consolas, Monaco, monospace;
    line-height: 1.5;
    outline: none;
    box-sizing: border-box;
    resize: vertical;
    word-break: break-all;
    white-space: pre-wrap;
    background: #fafafa;
    color: #333;
}

.cookie-textarea:focus {
    border-color: var(--primary-color);
}

.modal-footer {
    margin-top: 30px;
    display: flex;
    justify-content: center;
    gap: 15px;
}

.modal-footer button {
    width: 130px;
    height: 38px;
    border-radius: 20px;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}

.modal-footer button.save-btn {
    background: var(--primary-color);
    color: white;
    border: none;
}

.modal-footer button.save-btn:disabled {
    background: #f59696;
    cursor: not-allowed;
}

.modal-footer button:hover:not(:disabled) {
    opacity: 0.9;
}

/* Quality Selector Styles */
.speed-selector-container {
    position: relative;
    z-index: 100;
}
.quality-selector-container {
    position: relative;
    z-index: 100;
}

.quality-badge {
    font-size: 10px;
    border: 1px solid #666;
    color: #333;
    padding: 0px 6px;
    border-radius: 2px;
    height: 18px;
    line-height: 18px;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    transition: all 0.2s;
}

.quality-badge:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
}

.quality-menu {
    position: absolute;
    bottom: calc(100% + 15px);
    left: 50%;
    transform: translateX(-50%);
    background: white;
    box-shadow: 0 4px 15px rgba(0,0,0,0.15);
    border-radius: 6px;
    width: 90px;
    padding: 5px 0;
    overflow: hidden;
}

.quality-menu::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: white;
}

.quality-option {
    padding: 10px 15px;
    font-size: 13px;
    color: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
}

.quality-option:hover {
    background: #f5f5f5;
}

.quality-option.active {
    color: var(--primary-color);
    font-weight: bold;
}
</style>
