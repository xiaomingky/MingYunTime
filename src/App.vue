<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePlayerStore } from './store/player'
import { useUserStore } from './store/user'
import { useMessageStore } from './store/message'
import SongDetail from './views/SongDetail.vue'
import LoginModal from './components/LoginModal.vue'
import MvPlayer from './components/MvPlayer.vue'
import Toast from './components/Toast.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import EqPanel from './components/EqPanel.vue'
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
  Clock,
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
  MonitorSpeaker,
  Check,
  Film
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const playerStore = usePlayerStore()
const userStore = useUserStore()
const messageStore = useMessageStore()

const searchText = ref('')
const showLogin = ref(false)
const showUserMenu = ref(false)
const isMaximized = ref(false)
const showCreatePlaylist = ref(false)
const newPlaylistName = ref('')
const showQualityMenu = ref(false)
const showDeviceMenu = ref(false)

// 自动更新检测
const updateInfo = ref({ available: false, version: '', notes: '', downloading: false, downloaded: false, progress: 0 })
const startDownloadUpdate = () => {
    updateInfo.value.downloading = true
    const b = getBridge(); if (b?.send) b.send('start-download-update')
}
const installUpdate = () => {
    const b = getBridge(); if (b?.send) b.send('install-update')
}

const getFooterCoverUrl = () => {
    const picUrl = playerStore.currentSong.al?.picUrl || ''
    if (!picUrl) return ''
    const showGif = localStorage.getItem('song_detail_show_gif_cover') !== 'false'
    if (picUrl.startsWith('song-cover:') && !showGif) {
        return picUrl + '?static=1'
    }
    return picUrl
}

const fetchDevices = async () => {
    await playerStore.fetchAudioDevices()
    showDeviceMenu.value = true
}

const selectDevice = (deviceId) => {
    playerStore.setAudioDevice(deviceId)
    showDeviceMenu.value = false
}

const getDeviceLabel = (device) => {
    if (device.label) return device.label
    if (device.deviceId === 'default') return '系统默认'
    return `输出设备 (${device.deviceId.slice(0, 8)}...)`
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

onMounted(() => {
  playerStore.initAudio()

  // 持久化保存播放状态 (当前歌曲、播放列表、播放模式等)
  playerStore.$subscribe((mutation, state) => {
      localStorage.setItem('current_song', JSON.stringify(state.currentSong))
      localStorage.setItem('playlist', JSON.stringify(state.playlist))
      localStorage.setItem('current_index', state.currentIndex)
      localStorage.setItem('play_mode', state.playMode)
  })

  userStore.fetchStatus()

  const b = getBridge()
  if (b && b.on) {
    b.on('window-maximize-status', handleMaximize)
    b.on('player-command', (event, cmd) => {
        if (cmd === 'prev') playerStore.prev()
        else if (cmd === 'next') playerStore.next()
        else if (cmd === 'togglePlay') playerStore.togglePlay()
    })

    b.on('request-lyric-sync', () => {
        playerStore.updateDesktopLyricsState()
    })

    // 更新检测事件
    b.on('update-available', (_, version, notes) => { updateInfo.value = { ...updateInfo.value, available: true, version, notes: notes || '' } })
    b.on('update-not-available', () => { updateInfo.value.available = false })
    b.on('update-download-progress', (_, pct) => { updateInfo.value.progress = pct })
    b.on('update-downloaded', () => { updateInfo.value = { ...updateInfo.value, downloading: false, downloaded: true } })

    // 初始化桌面歌词窗口状态
    if (playerStore.showDesktopLyrics) {
        b.send('toggle-desktop-lyrics', true)
    }
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
    router.push({ path: '/search', query: { keywords: searchText.value, t: Date.now() } })
  }
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
    navigateTo(`/playlist/${id}`)
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

// 动态切换根节点类名，彻底解决全透明问题
import { watch } from 'vue'
watch(() => route.path, (newPath) => {
    if (newPath === '/desktop-lyrics') {
        document.documentElement.classList.add('is-lyrics-window')
        document.body.style.backgroundColor = 'transparent'
    } else {
        document.documentElement.classList.remove('is-lyrics-window')
        document.body.style.backgroundColor = ''
    }
}, { immediate: true })

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
    if (b) b.send('open-external', 'https://xiaomingky.cn')
}

</script>

<template>
  <div class="app-container" :class="{ 'is-desktop-lyrics': route.path === '/desktop-lyrics' }">
    <Toast />
    <ConfirmModal />

    <div v-if="route.path !== '/desktop-lyrics'" class="normal-layout-wrapper">
      <!-- 更新提示条 -->
      <div v-if="updateInfo.available" class="update-bar">
        <span class="update-text">🎉 发现新版本 v{{ updateInfo.version }}，</span>
        <button v-if="!updateInfo.downloading && !updateInfo.downloaded" class="update-btn" @click="startDownloadUpdate">立即更新</button>
        <span v-if="updateInfo.downloading" class="update-progress">下载中 {{ Math.round(updateInfo.progress) }}%</span>
        <button v-if="updateInfo.downloaded" class="update-btn ready" @click="installUpdate">点击安装并重启</button>
        <span v-if="updateInfo.notes" class="update-notes-toggle" @click="updateInfo.showNotes = !updateInfo.showNotes">
          {{ updateInfo.showNotes ? '收起' : '查看更新内容' }}
        </span>
        <X :size="14" class="update-close" @click="updateInfo.available = false" />
        <div v-if="updateInfo.showNotes && updateInfo.notes" class="update-notes" v-html="updateInfo.notes.replace(/\n/g, '<br>')"></div>
      </div>
      <SongDetail />
      <LoginModal :show="showLogin" @close="showLogin = false" />
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
              <input type="text" v-model="searchText" placeholder="搜索" @keyup.enter="handleSearch" />
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
          </div>
        </div>
        
        <div class="header-right no-drag">
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
                  { id: '/video', label: '视频', icon: Tv },
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

            <!-- Library -->
            <div class="sidebar-label">我的音乐</div>
            <div class="sidebar-section">
              <div 
                v-for="item in [
                  { id: '/local', label: '本地音乐', icon: Download },
                  { id: '/local-video', label: '本地视频', icon: Film },
                  { id: '/recent', label: '最近播放', icon: Clock },
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
                   @click="goToPlaylist(userStore.likedPlaylistId)">
                <Heart :size="18" />
                <span class="menu-label">我喜欢的音乐</span>
              </div>

              <div 
                v-for="p in userStore.playlists.slice(1)" 
                :key="p.id" 
                class="menu-item playlist-item"
                :class="{ active: route.path === `/playlist/${p.id}` }"
                @click="goToPlaylist(p.id)"
              >
                <ListMusic :size="16" />
                <span class="menu-label truncate">{{ p.name }}</span>
              </div>
            </div>
        </div>
      </aside>

      <div class="main-content-wrapper">
         <router-view />
      </div>
    </div>

    <footer class="footer">
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

        <div class="device-selector-container">
            <MonitorSpeaker :size="16" class="clickable hover-red" @click="fetchDevices" title="播放设备" />
            <div v-if="showDeviceMenu" class="device-menu no-drag">
                <div 
                    v-for="device in playerStore.audioDevices" 
                    :key="device.deviceId" 
                    class="device-option"
                    :class="{ active: playerStore.currentDeviceId === device.deviceId || (!playerStore.currentDeviceId && device.deviceId === 'default') }"
                    @click="selectDevice(device.deviceId)"
                >
                    <span class="device-label">{{ getDeviceLabel(device) }}</span>
                    <Check v-if="playerStore.currentDeviceId === device.deviceId || (!playerStore.currentDeviceId && device.deviceId === 'default')" :size="12" />
                </div>
                <div v-if="playerStore.audioDevices.length === 0" class="device-option disabled">
                    未检测到设备
                </div>
            </div>
            <div v-if="showDeviceMenu" class="device-menu-backdrop" @click="showDeviceMenu = false"></div>
        </div>
        <EqPanel />
        
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

/* 更新提示条 */
.update-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: linear-gradient(135deg, #6366f1, #4f46e5);
    color: #fff;
    padding: 6px 16px;
    font-size: 13px;
    flex-shrink: 0;
    z-index: 5001;
    position: relative;
}
.update-btn {
    background: #fff;
    color: #4f46e5;
    border: none;
    padding: 3px 14px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}
.update-btn:hover { background: #eef2ff; }
.update-btn.ready { background: #fbbf24; color: #78350f; }
.update-progress { font-size: 12px; opacity: 0.9; }
.update-close {
    position: absolute;
    right: 12px;
    cursor: pointer;
    opacity: 0.6;
}
.update-close:hover { opacity: 1; }
.update-notes-toggle {
    font-size: 11px;
    cursor: pointer;
    opacity: 0.7;
    text-decoration: underline;
}
.update-notes-toggle:hover { opacity: 1; }
.update-notes {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: 480px;
    max-height: 300px;
    overflow-y: auto;
    background: #1e1b4b;
    color: #e2e8f0;
    padding: 14px 18px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.7;
    margin-top: 4px;
    z-index: 9999;
    box-shadow: 0 8px 30px rgba(0,0,0,0.3);
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

/* Device Selector Styles */
.device-selector-container {
    position: relative;
    display: flex;
    align-items: center;
}

.device-menu {
    position: absolute;
    bottom: calc(100% + 15px);
    left: 50%;
    transform: translateX(-50%);
    background: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    border-radius: 8px;
    min-width: 160px;
    padding: 6px 0;
    z-index: 10002;
}

.device-menu::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: white;
}

.device-option {
    padding: 10px 16px;
    font-size: 12px;
    color: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    white-space: nowrap;
    gap: 10px;
}

.device-option:hover {
    background: #f5f5f5;
}

.device-option.active {
    color: var(--primary-color);
    font-weight: 600;
}

.device-option.disabled {
    color: #bbb;
    cursor: default;
}

.device-label {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.device-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
}
</style>
