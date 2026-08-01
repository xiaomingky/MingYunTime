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
  Sparkles
} from 'lucide-vue-next'
import SearchSuggest from './components/SearchSuggest.vue'
import { useSearchHistoryStore } from './store/searchHistory'
import { API_LINES, switchApiLine } from './api'
import CustomSelect from './components/CustomSelect.vue'

const router = useRouter()
const route = useRoute()
const playerStore = usePlayerStore()
const userStore = useUserStore()
const messageStore = useMessageStore()
const searchHistoryStore = useSearchHistoryStore()

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

const qualityLabels = {
    standard: '标准',
    higher: '较高',
    exhigh: '极高',
    lossless: '无损'
}

const toggleUserMenu = () => {
  showUserMenu.value = !showUserMenu.value
}

const logout = () => {
    userStore.logout()
    showUserMenu.value = false
    router.push('/')
}

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

  userStore.fetchStatus().then(async () => {
      if (userStore.isLoggedIn && userStore.profile?.userId) {
          await userStore.syncCloudAccount()
          await userStore.checkLockStatus()
      }
  })

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
    searchHistoryStore.addHistory('music', searchText.value)
    showSearchSuggest.value = false
    router.push({ path: '/search', query: { keywords: searchText.value, t: Date.now() } })
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
    const vol = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
    playerStore.setVolume(vol)
}

const stopDragVolume = () => {
    isDraggingVolume.value = false
    window.removeEventListener('mousemove', handleVolumeDrag)
    window.removeEventListener('mouseup', stopDragVolume)
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
  <div class="app-container" :class="{ 'is-desktop-lyrics': route.path === '/desktop-lyrics' }">
    <Toast />
    <VideoDownloadToast />
    <ConfirmModal />
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

<header class="header" v-show="!playerStore.showSongDetail && !playerStore.showMvPlayer">
        <div class="header-left no-drag">
          <div class="logo clickable" @click="navigateTo('/')">
            <div class="logo-icon">
              <Music :size="20" color="white" />
            </div>
            <span>茗韵时光</span>
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
          <div class="api-line-selector" :title="`当前：${currentApiLineLabel}`">
            <span class="api-line-icon"><Sparkles :size="12" /></span>
            <CustomSelect
                v-model="currentApiLine"
                :options="apiLineOptions"
                transparent
                @change="handleSwitchApiLine"
            />
          </div>
          <div class="user-info-container">
            <div class="user-info clickable" @click="!userStore.isLoggedIn && (showLogin = true)">
              <img v-if="userStore.isLoggedIn && userStore.profile" :src="userStore.profile.avatarUrl" class="avatar" />
              <div v-else class="avatar"></div>
              <span class="nickname">{{ userStore.isLoggedIn ? userStore.profile.nickname : '未登录' }}</span>
              <div v-if="userStore.vipInfo && userStore.vipInfo.redVipLevelIcon" class="vip-badge">
                 <img :src="userStore.vipInfo.redVipLevelIcon" class="vip-icon" />
              </div>
            </div>
          </div>

          <div class="theme-icons clickable" @click.stop="userStore.isLoggedIn ? toggleUserMenu() : null">
            <Settings :size="16" />
            
            <div class="user-dropdown" v-if="showUserMenu && userStore.isLoggedIn" @click.stop>
                <div class="dropdown-header">
                    <div class="stats-item">
                        <span class="count">{{ userStore.profile.eventCount || 0 }}</span>
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
                </div>
                <div class="dropdown-list">
                    <div class="menu-sub-item">
                        <div class="left">等级</div>
                        <div class="right">Lv.{{ userStore.profile.level || 0 }}</div>
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
            <!-- Navigation -->
            <div class="sidebar-section">
              <div
                v-for="item in [
                  { id: '/', label: '发现音乐', icon: Music },
                  { id: '/video', label: 'MV', icon: Tv },
                  { id: '/anime', label: '动漫', icon: MonitorPlay },
                  { id: '/movie', label: '影视', icon: Film },
                ]"
                :key="item.id"
                class="menu-item"
                :class="{ active: item.id === '/' ? route.path === '/' : route.path.startsWith(item.id) }"
                @click="navigateTo(item.id)"
              >
                <component :is="item.icon" :size="18" />
                <span class="menu-label">{{ item.label }}</span>
              </div>
            </div>

            <!-- Library -->
            <div class="sidebar-label">我的音乐</div>
            <div class="sidebar-section">
              <div
                v-for="item in [
                  { id: '/local', label: '本地音乐', icon: HardDrive },
                  { id: '/local-video', label: '本地视频', icon: Film },
                  { id: '/recent', label: '最近播放', icon: Clock },
                  { id: '/cloud', label: '我的云音乐', icon: Cloud },
                  { id: '/downloads', label: '下载', icon: Download },
                ]"
                :key="item.id"
                class="menu-item"
                :class="{ active: route.path === item.id }"
                @click="navigateTo(item.id)"
              >
                <component :is="item.icon" :size="18" />
                <span class="menu-label">{{ item.label }}</span>
              </div>
            </div>

            <!-- Playlists -->
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
            <Heart 
              :size="16" 
              class="heart-icon clickable hover-red" 
              :class="{ 'text-red': playerStore.isLiked }"
              :fill="playerStore.isLiked ? '#EC4141' : 'none'"
              :color="playerStore.isLiked ? '#EC4141' : 'currentColor'"
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
          <div class="volume-slider" :class="{ dragging: isDraggingVolume }" @mousedown="startDragVolume">
            <div class="volume-fill" :style="{ width: playerStore.volume + '%' }">
               <div class="progress-dot"></div>
            </div>
          </div>
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
                {{ qualityLabels[playerStore.quality] || '标准' }}
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
  </div>
</template>

<style>
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

.vip-badge {
    margin-left: 5px;
}

.vip-icon {
    height: 12px;
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
    border: 1px solid #999;
    color: #666;
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
