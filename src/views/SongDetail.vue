<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { usePlayerStore } from '../store/player'
import { ChevronDown, Heart, Share2, Download, MessageSquare, Minus, Plus, User, ListMusic, Check, X, Image, ImagePlay, Film, BookOpen } from 'lucide-vue-next'
import EnglishAnalysis from '../components/EnglishAnalysis.vue'
import { getCommentMusic } from '../api'
import { useRouter } from 'vue-router'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'

const playerStore = usePlayerStore()
const userStore = useUserStore()
const messageStore = useMessageStore()
const router = useRouter()
const lyricFontSize = ref(32)
const showGifCover = ref(localStorage.getItem('song_detail_show_gif_cover') !== 'false')
const showEnglishAnalysis = ref(false)
// 歌词颜色是否跟随桌面歌词所选颜色
const lyricColorFollow = ref(localStorage.getItem('song_detail_lyric_color_follow') === 'true')

const toggleLyricColorFollow = () => {
    lyricColorFollow.value = !lyricColorFollow.value
    localStorage.setItem('song_detail_lyric_color_follow', lyricColorFollow.value)
}

// 当前歌词高亮颜色：开启跟随时使用桌面歌词所选颜色，否则使用黑色
const activeLyricColor = computed(() => {
    return lyricColorFollow.value ? (playerStore.desktopLyricColor || '#000000') : '#000000'
})

// 将十六进制颜色转为带透明度的 rgba
const hexToRgba = (hex, alpha) => {
    if (!hex || hex[0] !== '#') return `rgba(0,0,0,${alpha})`
    let h = hex.slice(1)
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

const inactiveLyricColor = computed(() => hexToRgba(activeLyricColor.value, 0.2))

const toggleEnglishAnalysis = () => {
    showEnglishAnalysis.value = !showEnglishAnalysis.value
}

// 切换歌曲时关闭解析面板
watch(() => playerStore.currentSong.id, () => {
    showEnglishAnalysis.value = false
})

const toggleGifCover = () => {
    showGifCover.value = !showGifCover.value
    localStorage.setItem('song_detail_show_gif_cover', showGifCover.value)
}

const getCoverUrl = () => {
    const picUrl = playerStore.currentSong.al?.picUrl || ''
    if (!picUrl) return ''
    // 如果是本地歌曲的song-cover协议，根据设置添加参数
    if (picUrl.startsWith('song-cover:') && !showGifCover.value) {
        return picUrl + '?static=1'
    }
    return picUrl
}

// Visualizer logic
const rhythmBars = ref(Array.from({ length: 48 }, () => ({
  height: 4,
  opacity: 0.5
})))

// === 逐词歌词 (YRC) 支持 ===
const hasYrcLyrics = computed(() => !!playerStore.yrcLyrics && playerStore.yrcLyrics.length > 0)

// 显示用的歌词列表：优先 yrc，否则普通 lyrics
const displayLyrics = computed(() => {
    if (hasYrcLyrics.value) return playerStore.yrcLyrics
    return playerStore.lyrics
})

const getLineProgress = (index) => {
    if (hasYrcLyrics.value) return 0 // yrc 模式下不使用行级进度
    if (index !== currentLyricIndex.value) return 0
    const line = playerStore.lyrics[index]
    const nextLine = playerStore.lyrics[index + 1]
    if (!line) return 0
    
    const duration = nextLine ? (nextLine.time - line.time) : 5000
    const progress = (playerStore.currentTime * 1000 - line.time) / duration
    return Math.max(0.5, Math.min(100, progress * 100))
}

let animationId = null
let frameCount = 0
const isPageVisible = ref(!document.hidden)

const handleVisibilityChange = () => {
    isPageVisible.value = !document.hidden
}

// 逐词动画：只刷新当前高亮行内的 word，避免全量 DOM 遍历
const updateYrcWordProgress = () => {
    if (!hasYrcLyrics.value || !lyricContainer.value) return
    const nowMs = (playerStore.audio?.currentTime ?? playerStore.currentTime) * 1000
    const activeLine = lyricContainer.value.querySelector('.lyric-line.active .yrc-text')
    if (!activeLine) return
    const wordSpans = activeLine.querySelectorAll('.yrc-word')
    for (let i = 0; i < wordSpans.length; i++) {
        const el = wordSpans[i]
        const ws = parseFloat(el.dataset.ws) // word startTime ms
        const wd = parseFloat(el.dataset.wd) // word duration ms
        if (isNaN(ws) || isNaN(wd)) continue
        let progress = 0
        if (nowMs >= ws + wd) {
            progress = 1
        } else if (nowMs > ws && wd > 0) {
            progress = (nowMs - ws) / wd
        }
        el.style.setProperty('--wp', progress)
    }
}

const updateVisualizer = () => {
  if (!playerStore.showSongDetail) {
    if (animationId) cancelAnimationFrame(animationId)
    animationId = null
    return
  }

  // 页面不可见时空转，减少后台占用
  if (document.hidden) {
    animationId = requestAnimationFrame(updateVisualizer)
    return
  }

  // 气泡等待动画（使用 requestAnimationFrame 更丝滑）
  updateBubbleWait()

  // 逐词歌词动画更新（只刷新当前行）
  if (hasYrcLyrics.value && playerStore.isPlaying) {
      updateYrcWordProgress()
  }
  
  if (playerStore.isPlaying) {
    frameCount++
    if (frameCount % 3 === 0) {
        const data = playerStore.updateFrequencyData()
        if (data) {
          const bars = rhythmBars.value
          const len = bars.length
          const dataLen = data.length
          for (let i = 0; i < len; i++) {
            const start = Math.floor(i * (dataLen / len))
            const val = data[start] || 0
            const targetHeight = Math.max(4, (val / 255) * 80 + 4)
            bars[i].height += (targetHeight - bars[i].height) * 0.25
            bars[i].opacity = 0.4 + (val / 255) * 0.6
          }
        }
    }
  } else {
      rhythmBars.value.forEach(bar => {
          bar.height = Math.max(4, bar.height * 0.8)
          bar.opacity = Math.max(0.3, bar.opacity * 0.8)
      })
      // 暂停时也刷新一次 yrc 进度（停在当前位置）
      if (hasYrcLyrics.value) updateYrcWordProgress()
  }
  animationId = requestAnimationFrame(updateVisualizer)
}

const startVisualizer = () => {
  if (!animationId) {
    animationId = requestAnimationFrame(updateVisualizer)
  }
}

onMounted(() => {
  if (playerStore.showSongDetail) startVisualizer()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  if (animationId) cancelAnimationFrame(animationId)
  animationId = null
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

watch(() => playerStore.showSongDetail, (val) => {
  if (val) {
    startVisualizer()
  } else if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
})

const currentLyricIndex = computed(() => {
  const lrc = displayLyrics.value
  if (!lrc || !lrc.length) return -1
  const time = playerStore.currentTime + 0.2
  for (let i = 0; i < lrc.length; i++) {
    if (time < lrc[i].time) {
      return i - 1
    }
  }
  return lrc.length - 1
})

const lyricContainer = ref(null)
const lyricMode = ref('apple')
const leavingIndexes = ref(new Set())

const lyricFontFamily = computed(() => {
    return playerStore.desktopLyricFont ? `"${playerStore.desktopLyricFont}", "Noto Serif SC", "Songti SC", serif` : '"Noto Serif SC", "Songti SC", serif'
})

// 伪随机：相同 seed 始终得到相同结果，避免渲染时 CSS 变量无限变化
const pseudoRandom = (seed) => {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
}

const getParticleStyle = (lineIndex, charIndex) => {
    const base = lineIndex * 1000 + charIndex
    return {
        '--tx': (pseudoRandom(base) * 70 - 35) + 'px',
        '--ty': (pseudoRandom(base + 1) * 70 - 35) + 'px',
        '--r': (pseudoRandom(base + 2) * 40 - 20) + 'deg',
        '--d': (pseudoRandom(base + 3) * 0.25 + 0.45) + 's'
    }
}

const getLineBlur = (index) => {
    if (lyricMode.value !== 'apple') return 0
    const distance = Math.abs(index - currentLyricIndex.value)
    if (distance === 0) return 0
    if (distance === 1) return 2
    if (distance === 2) return 4
    return Math.min(8, 5 + (distance - 3) * 1)
}

// 预计算每行模糊等级，避免模板中逐行调用函数
const blurClassMap = computed(() => {
    const map = {}
    if (lyricMode.value !== 'apple') return map
    const current = currentLyricIndex.value
    displayLyrics.value.forEach((_, i) => {
        const d = Math.abs(i - current)
        if (d === 1) map[i] = 'blur-1'
        else if (d === 2) map[i] = 'blur-2'
        else if (d >= 3) map[i] = 'blur-far'
    })
    return map
})

// 歌词前/歌词间隙显示气泡等待动画（从右到左逐个戳破）
const bubbleWaitState = ref({ show: false, bubbles: [] })

const updateBubbleWait = () => {
    const lrc = displayLyrics.value
    if (!lrc || !lrc.length) {
        bubbleWaitState.value = { show: false, bubbles: [] }
        return
    }
    // 使用音频高精度时间，动画更丝滑
    const t = playerStore.audio?.currentTime ?? playerStore.currentTime
    const idx = currentLyricIndex.value

    let waitStart, waitEnd
    if (idx === -1) {
        waitStart = 0
        waitEnd = lrc[0].time
        if (waitEnd < 1.5) {
            bubbleWaitState.value = { show: false, bubbles: [] }
            return
        }
    } else {
        const cur = lrc[idx]
        const next = lrc[idx + 1]
        if (!next) {
            bubbleWaitState.value = { show: false, bubbles: [] }
            return
        }
        const curEnd = cur.time + (cur.duration ? cur.duration / 1000 : 0)
        waitStart = curEnd
        waitEnd = next.time
        if (waitEnd - waitStart < 2.0) {
            bubbleWaitState.value = { show: false, bubbles: [] }
            return
        }
    }

    if (t < waitStart + 0.1 || t > waitEnd - 0.1) {
        bubbleWaitState.value = { show: false, bubbles: [] }
        return
    }

    const totalWait = waitEnd - waitStart
    const count = Math.max(4, Math.min(10, Math.round(totalWait / 0.6)))
    const popInterval = totalWait / (count + 1)
    const bubbles = []

    for (let i = 0; i < count; i++) {
        // i=0 是最左侧，i=count-1 是最右侧
        // 从右到左戳破：最右侧（i=count-1）最先破
        const popAt = waitStart + (count - i) * popInterval
        const popProgress = Math.min(1, Math.max(0, (t - (popAt - 0.16)) / 0.16))
        const isPopped = t >= popAt
        const isPopping = t >= popAt - 0.16 && t < popAt

        let scale = 1
        let opacity = 0.85
        if (isPopped) {
            scale = 0
            opacity = 0
        } else if (isPopping) {
            // 戳破动画：ease-out 膨胀 -> ease-out 消失，更丝滑
            if (popProgress < 0.5) {
                const p = popProgress / 0.5
                const eased = 1 - Math.pow(1 - p, 2)
                scale = 1 + eased * 0.35
                opacity = 0.85 + eased * 0.15
            } else {
                const p = (popProgress - 0.5) / 0.5
                const eased = 1 - Math.pow(p, 2)
                scale = 1.35 * eased
                opacity = eased
            }
        }

        bubbles.push({ scale, opacity })
    }

    bubbleWaitState.value = { show: true, bubbles }
}

const scrollToCenter = async (index) => {
  await nextTick()
  if (!lyricContainer.value) return
  const lines = lyricContainer.value.querySelectorAll('.lyric-line')
  const activeLine = lines[index]
  if (!activeLine) return

  const containerRect = lyricContainer.value.getBoundingClientRect()
  const activeRect = activeLine.getBoundingClientRect()
  const containerCenter = containerRect.top + containerRect.height / 2
  const activeCenter = activeRect.top + activeRect.height / 2
  const currentScroll = lyricContainer.value.scrollTop
  const offset = activeCenter - containerCenter

  lyricContainer.value.scrollTo({
    top: currentScroll + offset,
    behavior: 'smooth'
  })
}

const toggleLyricMode = () => {
    lyricMode.value = lyricMode.value === 'apple' ? 'classic' : 'apple'
    if (currentLyricIndex.value >= 0) {
        scrollToCenter(currentLyricIndex.value)
    }
}

watch(currentLyricIndex, (newIndex, oldIndex) => {
  if (oldIndex != null && oldIndex >= 0 && oldIndex !== newIndex) {
    leavingIndexes.value.add(oldIndex)
    setTimeout(() => {
      leavingIndexes.value.delete(oldIndex)
    }, 700)
  }
  if (newIndex >= 0) {
    scrollToCenter(newIndex)
  }
})

const handleLyricClick = (time) => {
    // time is already in seconds from line.time
    playerStore.seek(time)
}

const handlePlayMv = () => {
    playerStore.playLocalMv()
}

const handleDownload = async () => {
    if (playerStore.currentSong.url) {
        const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
        if (bridge && bridge.invoke) {
            try {
                // 如果是本地音乐已经有路径了，就不需要下载了
                if (playerStore.currentSong.path) {
                    messageStore.info('此歌曲已在本地')
                    return
                }
                const res = await bridge.invoke('download-song', {
                    url: playerStore.currentSong.url,
                    name: playerStore.currentSong.name,
                    artist: playerStore.currentSong.artist,
                    picUrl: playerStore.currentSong.al?.picUrl
                })
                if (res && res.success) {
                    messageStore.success('歌曲下载并保存成功！')
                } else if (res && !res.canceled) {
                    messageStore.error(`下载失败：${res.error || '未知错误'}`)
                }
            } catch (err) {
                console.error('Download error:', err)
                messageStore.error('下载任务开启失败：' + (err.message || '网络或环境异常'))
            }
        } else {
            // Fallback for browser
            const link = document.createElement('a')
            link.href = playerStore.currentSong.url
            link.download = `${playerStore.currentSong.name} - ${playerStore.currentSong.artist}.mp3`
            link.target = '_blank'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        }
    } else {
        messageStore.warning('未获取到播放地址，无法下载')
    }
}

const handleShare = () => {
    const url = `https://music.163.com/#/song?id=${playerStore.currentSong.id}`
    navigator.clipboard.writeText(url).then(() => {
        messageStore.success('链接已复制到剪贴板')
    })
}

const goToAlbum = () => {
    if (playerStore.currentSong.al?.id) {
        router.push(`/album/${playerStore.currentSong.al.id}`)
    }
}

const comments = ref([])
const totalComments = ref(0)
const showCommentPanel = ref(false)

const fetchComments = async () => {
    if (!playerStore.currentSong.id) return
    try {
        const res = await getCommentMusic(playerStore.currentSong.id, 20)
        comments.value = res.hotComments || res.comments || []
        totalComments.value = res.total || 0
    } catch (err) {
        console.error('Fetch comments error:', err)
    }
}

watch(() => playerStore.currentSong.id, () => {
    if (playerStore.showSongDetail) {
        fetchComments()
    }
})

watch(() => playerStore.showSongDetail, (val) => {
    if (val) {
        fetchComments()
    }
})

const handleComment = () => {
    showCommentPanel.value = !showCommentPanel.value
}

const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const showPlaylistSelector = ref(false)
const addingToPlaylist = ref(false)
const handleAddToPlaylist = async (pid) => {
    if (addingToPlaylist.value) return
    
    // 更加稳健的本地歌曲判定：检查 ID 前缀或是否存在物理路径
    const isLocal = String(playerStore.currentSong.id).startsWith('local-') || !!playerStore.currentSong.path
    
    if (isLocal) {
        messageStore.warning('本地音乐无法添加到在线歌单')
        return
    }
    
    addingToPlaylist.value = true
    try {
        const result = await userStore.addTrackToPlaylist(pid, playerStore.currentSong.id)
        if (result.success) {
            messageStore.success('已成功添加到歌单')
            showPlaylistSelector.value = false
        } else {
            messageStore.error(result.message || '添加失败')
        }
    } finally {
        addingToPlaylist.value = false
    }
}

// 字体与颜色设置
const fonts = ref([])
const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler

const registerFonts = async () => {
    const b = getBridge()
    if (b && b.invoke) {
        const scannedFonts = await b.invoke('scan-fonts')
        fonts.value = scannedFonts // Update the reactive fonts list
        scannedFonts.forEach(async (f) => {
            const safeUrl = f.url.split('://')[0] + '://' + encodeURI(f.url.split('://')[1])
            try {
                // 使用 FontFace API 更加稳健
                const font = new FontFace(f.name, `url("${safeUrl}")`)
                await font.load()
                document.fonts.add(font)
                console.log('[DesktopLyrics] Font Activated:', f.name)
            } catch (e) {
                // 回退到 Style 注入
                const fontId = `font-face-${f.name.replace(/\s+/g, '-')}`
                if (!document.getElementById(fontId)) {
                    const style = document.createElement('style')
                    style.id = fontId
                    style.textContent = `@font-face { font-family: "${f.name}"; src: url("${safeUrl}"); }`
                    document.head.appendChild(style)
                }
            }
        })
    }
}

onMounted(() => {
    registerFonts()
})
</script>

<template>
  <div class="song-detail-overlay" :class="{ show: playerStore.showSongDetail, 'is-cover-mode': playerStore.bgMode === 'cover' }">
    <div class="bg-blur" v-show="playerStore.bgMode === 'cover'" :style="{ backgroundImage: `url(${getCoverUrl()})` }"></div>
    
    <!-- 顶部拖动区域：整个 header 可拖，只有关闭按钮不可拖 -->
    <div class="header drag-header">
      <ChevronDown class="close-btn no-drag" :size="30" @mousedown.stop @click.stop="playerStore.showSongDetail = false" />
    </div>

    <div class="main-content" :class="{ 'analysis-active': showEnglishAnalysis }">
      <div class="left-section" :class="{ 'analysis-mode': showEnglishAnalysis }">
        <!-- English Analysis Panel -->
        <div v-if="showEnglishAnalysis" class="analysis-wrapper">
            <EnglishAnalysis
                :lyrics="playerStore.lyrics"
                :songName="playerStore.currentSong.name"
                :artist="playerStore.currentSong.artist"
                :songPath="playerStore.currentSong.path || ''"
                :songId="playerStore.currentSong.id"
                :currentLyricIndex="currentLyricIndex"
                @scrollToLine="handleLyricClick"
            />
        </div>

        <!-- Normal Cover + Info -->
        <template v-else>
        <div class="cover-container">
            <div class="cover-glow" :style="{ backgroundImage: `url(${getCoverUrl()})` }"></div>
            <div class="cover-wrapper" :class="{ playing: playerStore.isPlaying }">
              <img :src="getCoverUrl()" class="square-cover" />
            </div>
            <!-- GIF/静态封面切换 -->
            <div v-if="playerStore.currentSong.al?.picUrl?.startsWith('song-cover:')" class="cover-toggle no-drag" @click="toggleGifCover">
                <div class="toggle-track" :class="{ active: showGifCover }">
                    <div class="toggle-thumb">
                        <ImagePlay v-if="showGifCover" :size="12" />
                        <Image v-else :size="12" />
                    </div>
                    <span class="toggle-label">{{ showGifCover ? 'GIF' : '静态' }}</span>
                </div>
            </div>
        </div>
        
        <div class="song-header">
            <div class="song-name-container">
                <h1 class="song-name">
                    {{ playerStore.currentSong.name }}
                    <span v-if="playerStore.currentSong.fee === 1" class="vip-badge-song">VIP</span>
                </h1>
            </div>
                <div class="song-info">
                  <span class="info-item">专辑：<span class="link" @click="goToAlbum">{{ playerStore.currentSong.al.name }}</span></span>
                  <span class="info-item">歌手：<span class="link">{{ playerStore.currentSong.artist }}</span></span>
                </div>
        </div>

        <div class="record-actions">
           <div class="action-item" :class="{ active: playerStore.isLiked }" @click="playerStore.toggleLike()">
              <Heart :size="22" :fill="playerStore.isLiked ? '#EC4141' : 'none'" :color="playerStore.isLiked ? '#EC4141' : 'currentColor'" />
           </div>
           <div class="action-item" @click="showPlaylistSelector = true"><Plus :size="24" /></div>
           <div class="action-item" @click="handleDownload"><Download :size="22" /></div>
           <div class="action-item" @click="handleShare"><Share2 :size="22" /></div>
           <div class="action-item" @click="handleComment"><MessageSquare :size="22" /></div>
        </div>

        <!-- Playlist Selector Modal -->
        <div v-if="showPlaylistSelector" class="playlist-selector-overlay" @click="showPlaylistSelector = false">
            <div class="playlist-selector-modal" @click.stop>
                <div class="modal-header">
                    <h3>收藏到歌单</h3>
                    <X :size="20" class="clickable" @click="showPlaylistSelector = false" />
                </div>
                <div class="modal-body">
                    <div 
                        v-for="p in userStore.playlists.filter(pl => pl.userId === userStore.profile?.userId)" 
                        :key="p.id" 
                        class="playlist-item clickable"
                        @click="handleAddToPlaylist(p.id)"
                    >
                        <div class="cover">
                            <img :src="p.coverImgUrl + '?param=40y40'" />
                        </div>
                        <div class="name">{{ p.name }}</div>
                        <div class="count">{{ p.trackCount }}首</div>
                    </div>
                </div>
            </div>
        </div>
        </template>
      </div>

      <div class="right-lyrics" v-show="!showCommentPanel">
        <div class="lyric-controls no-drag">
            <div class="group icon-group">
                <div class="icon-with-label action-item mv-btn" title="播放MV" @click="handlePlayMv">
                   <Film :size="18" />
                   <span class="icon-text">MV</span>
                </div>
                <div class="icon-with-label action-item en-btn" :class="{ active: showEnglishAnalysis }" title="英文解析" @click="toggleEnglishAnalysis">
                   <BookOpen :size="18" />
                   <span class="icon-text">解析</span>
                </div>
                <div class="icon-with-label action-item" :class="{ active: playerStore.bgMode === 'cover' }" :title="playerStore.bgMode === 'cover' ? '切换到经典样式' : '切换到沉浸模式'" @click="playerStore.toggleBgMode()">
                   <ImagePlay v-if="playerStore.bgMode === 'cover'" :size="18" />
                   <Image v-else :size="18" />
                   <span class="icon-text">{{ playerStore.bgMode === 'cover' ? '沉浸' : '经典' }}</span>
                </div>
                <div class="icon-with-label action-item lyric-mode-btn" :class="{ active: lyricMode === 'apple' }" :title="lyricMode === 'apple' ? '切换到经典歌词' : '切换到苹果风格歌词'" @click="toggleLyricMode">
                   <span class="mode-label">{{ lyricMode === 'apple' ? 'A' : 'C' }}</span>
                   <span class="icon-text">{{ lyricMode === 'apple' ? '苹果' : '经典' }}</span>
                </div>
            </div>
            <div class="group">
                <span class="label">桌面字体</span>
                <select class="font-select" v-model="playerStore.desktopLyricFont" @change="playerStore.setFont($event.target.value)">
                    <option value="">默认字体</option>
                    <option v-for="f in fonts" :key="f.name" :value="f.name">{{ f.name }}</option>
                </select>
            </div>
            <div class="group">
                <span class="label">颜色</span>
                <input type="color" :value="playerStore.desktopLyricColor" @input="playerStore.setColor($event.target.value)" class="color-picker" />
            </div>
            <div class="group">
                <span class="label">字号</span>
                <div class="size-btns">
                   <Minus :size="14" class="clickable" @click="lyricFontSize = Math.max(32, lyricFontSize - 2)" />
                   <span class="curr-size">{{ lyricFontSize }}</span>
                   <Plus :size="14" class="clickable" @click="lyricFontSize = lyricFontSize + 2" />
                </div>
            </div>
            <div class="group">
                <span class="label">歌词变色</span>
                <div class="switch-track" :class="{ active: lyricColorFollow }" @click="toggleLyricColorFollow" title="开启后歌词颜色跟随上方颜色选择器">
                    <div class="switch-thumb"></div>
                </div>
            </div>
        </div>

        <div class="lyric-wrapper" ref="lyricContainer" :class="['mode-' + lyricMode, { 'color-follow': lyricColorFollow }]" :style="{ '--active-color': activeLyricColor, '--active-color-faded': inactiveLyricColor }">
          <div class="lyric-track">
              <div 
                v-for="(line, index) in displayLyrics" 
                :key="index" 
                class="lyric-line"
                :class="[ 
                    index === currentLyricIndex ? 'active' : '',
                    hasYrcLyrics ? 'yrc-line' : '',
                    index < currentLyricIndex ? 'played' : '',
                    leavingIndexes.has(index) ? 'leaving' : '',
                    blurClassMap[index] || ''
                ]"
                :style="{ 
                    fontSize: (index === currentLyricIndex ? lyricFontSize + 4 : lyricFontSize) + 'px',
                    fontFamily: lyricFontFamily
                }"
                @click="handleLyricClick(line.time)"
              >
                <!-- 逐词歌词模式 -->
                <div v-if="hasYrcLyrics && line.words" class="main-text yrc-text">
                    <span 
                        v-for="(word, wi) in line.words" 
                        :key="wi"
                        class="yrc-word"
                        :data-ws="word.startTime"
                        :data-wd="word.duration"
                        style="--wp: 0"
                    >{{ word.text }}</span>
                </div>
                <!-- 普通歌词模式 -->
                <div 
                    v-else
                    class="main-text" 
                    :style="{ '--progress': index === currentLyricIndex ? getLineProgress(index) + '%' : '0%' }"
                >
                    <template v-if="leavingIndexes.has(index) && line.text.length <= 30">
                        <span 
                            v-for="(char, ci) in line.text" 
                            :key="ci"
                            class="lyric-char"
                            :style="getParticleStyle(index, ci)"
                        >{{ char }}</span>
                    </template>
                    <template v-else>{{ line.text }}</template>
                </div>
                <div v-if="line.ttext" class="trans-text">{{ line.ttext }}</div>
              </div>
              <div v-if="!displayLyrics.length" class="no-lyric">纯音乐，请欣赏</div>
          </div>
          <div
              v-if="bubbleWaitState.show"
              class="lyric-bubble-wait"
              :style="{ gap: Math.round(lyricFontSize / 3) + 'px' }"
          >
              <div
                  class="bubble"
                  v-for="(b, i) in bubbleWaitState.bubbles"
                  :key="i"
                  :style="{
                      opacity: b.opacity,
                      transform: `scale(${b.scale})`,
                      width: lyricFontSize + 'px',
                      height: lyricFontSize + 'px'
                  }"
              ></div>
          </div>
        </div>
      </div>

      <!-- Comment Section -->
      <div class="right-comments" v-show="showCommentPanel">
          <div class="comments-header">
              <span class="title">歌曲评论 ({{ totalComments }})</span>
              <button class="close-panel-btn" @click="showCommentPanel = false">返回歌词</button>
          </div>
          <div class="comments-list">
              <div v-for="comment in comments" :key="comment.commentId" class="comment-item">
                  <div class="user-avatar">
                      <img :src="comment.user.avatarUrl" />
                  </div>
                  <div class="comment-content">
                      <div class="user-info-row">
                          <span class="username">{{ comment.user.nickname }}:</span>
                          <span class="content-text">{{ comment.content }}</span>
                      </div>
                      <div v-if="comment.beReplied && comment.beReplied.length" class="replied-content">
                          <span class="username">@{{ comment.beReplied[0].user.nickname }}:</span>
                          {{ comment.beReplied[0].content }}
                      </div>
                      <div class="bottom-info">
                          <span class="time">{{ formatDate(comment.time) }}</span>
                      </div>
                  </div>
              </div>
              <div v-if="comments.length === 0" class="no-comment">暂无评论</div>
          </div>
      </div>
    </div>

    <div class="visualizer-container">
        <div 
            v-for="(bar, i) in rhythmBars" 
            :key="i" 
            class="v-bar" 
            :style="{ 
                height: bar.height + 'px',
                opacity: bar.opacity
            }"
        ></div>
    </div>
  </div>
</template>

<style scoped>
.song-detail-overlay {
  position: fixed;
  top: 100%;
  left: 0;
  width: 100%;
  height: 100%; /* 占满全屏，延伸到footer下方 */
  padding-bottom: var(--footer-height); /* 防止内容被footer挡住 */
  background-color: #fff;
  z-index: 1000;
  transition: top 0.4s cubic-bezier(0.2, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: none;
}

.song-detail-overlay.show {
  top: 0;
  transform: translateZ(0);
  pointer-events: auto;
}

.bg-blur {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-size: cover;
  background-position: center;
  filter: blur(40px) saturate(1.5); /* 降低blur提升老设备性能，增加饱和度让背景颜色跟随封面更明显 */
  opacity: 0.35; /* 增加透明度让白色底色透出，形成柔和浅色背景，保证黑色文字可读性 */
  z-index: -1; /* 必须是负数，否则会遮挡上方内容的点击事件 */
  transform: scale(1.5) translateZ(0); /* 开启硬件加速，加大缩放比例防止边缘漏底 */
  will-change: transform;
}

.header {
  position: relative;
  z-index: 1;
  padding: 15px 30px;
  flex-shrink: 0;
  background-color: transparent !important;
}
.drag-header {
  -webkit-app-region: drag;
}

.close-btn {
  cursor: pointer;
  color: #666;
  opacity: 0.5;
  transition: opacity 0.2s;
}
.close-btn:hover {
    opacity: 1;
}

.main-content {
  position: relative;
  z-index: 1; /* 确保内容在模糊层之上 */
  display: flex;
  flex: 1;
  padding: 0 5%; 
  gap: 40px;    
  overflow: hidden;
  align-items: center;
  justify-content: center;
  max-height: 85vh; 
}

.main-content.analysis-active {
  align-items: stretch;
  justify-content: flex-start;
  max-height: none;
  padding: 0 3%;
  gap: 24px;
}

.left-section {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  overflow-y: auto;
  overflow-x: hidden;
}

.left-section.analysis-mode {
  align-items: stretch;
  text-align: left;
  flex: 1.2;
  max-width: 55%;
  min-width: 380px;
  transition: flex 0.3s, max-width 0.3s;
}

.left-section:not(.analysis-mode) {
  flex: 1;
  max-width: none;
  min-width: 0;
  transition: flex 0.3s;
}

.analysis-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  animation: slideLeft 0.35s ease;
}

@keyframes slideLeft {
    from { opacity: 0; transform: translateX(-30px); }
    to { opacity: 1; transform: translateX(0); }
}

.cover-container {
    position: relative;
    width: 340px;
    height: 340px;
}

.cover-glow {
    position: absolute;
    top: 20px;
    left: 20px;
    right: 20px;
    bottom: 0;
    background-size: cover;
    filter: blur(30px);
    opacity: 0.4;
    border-radius: 12px;
    z-index: 0;
}

.cover-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    z-index: 1;
    box-shadow: 0 20px 50px rgba(0,0,0,0.15);
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    transform: scale(0.92);
}

.cover-wrapper.playing {
    transform: scale(1);
    box-shadow: 0 30px 80px rgba(0,0,0,0.25);
}

.square-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-toggle {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 10;
    cursor: pointer;
}

.toggle-track {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(10px);
    padding: 4px 4px 4px 10px;
    border-radius: 20px;
    transition: all 0.3s ease;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.toggle-track:hover {
    background: rgba(0, 0, 0, 0.7);
}

.toggle-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.toggle-track.active .toggle-thumb {
    transform: translateX(2px);
    background: var(--primary-color);
    color: white;
}

.toggle-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 500;
    padding-right: 6px;
    user-select: none;
}

.song-name-container {
    display: block;
    width: 100%;
    margin-top: 20px;
    margin-bottom: 5px;
    text-align: center;
    min-height: 2.6em; /* 预留出两行的高度，防止抖动 */
}

.song-name {
  font-size: min(30px, 4vh);
  color: #222;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
  
  /* 解决不换行问题的核心：允许单词内部断行 */
  word-break: break-all;
  white-space: normal;
  
  display: -webkit-box;
  -webkit-line-clamp: 2; 
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  
  padding: 0 5px;
  width: 100%;
}

.vip-badge-song {
    font-size: 10px;
    color: var(--primary-color);
    border: 1px solid var(--primary-color);
    padding: 0 4px;
    border-radius: 2px;
    margin-left: 8px;
    height: 16px;
    line-height: 14px;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    position: relative;
    top: -2px;
}

.song-info {
  font-size: 14px;
  color: #888;
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 10px;
  flex-wrap: wrap;
  width: 100%;
}

.info-item {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
    display: inline-block;
}

.link:hover {
  color: var(--primary-color);
  text-decoration: underline;
  cursor: pointer;
}

.record-actions {
    display: flex;
    gap: 30px;
    margin-top: 30px;
}

.action-item {
    width: 44px;
    height: 44px;
    background: rgba(0,0,0,0.03);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    cursor: pointer;
    transition: all 0.2s;
}

.lyric-controls .action-item {
    border-radius: 12px;
}

.action-item:hover {
    background: rgba(236, 65, 65, 0.1);
    color: var(--primary-color);
    transform: translateY(-2px);
}

.action-item.active {
    color: var(--primary-color);
    background: rgba(236, 65, 65, 0.1);
}

.mv-btn {
    background: rgba(236, 65, 65, 0.08);
    color: var(--primary-color);
}

.mv-btn:hover {
    background: var(--primary-color) !important;
    color: white !important;
}

.en-btn {
    background: rgba(99, 102, 241, 0.08);
    color: #6366f1;
    width: 48px;
    height: 48px;
}

.en-btn:hover {
    background: #6366f1 !important;
    color: white !important;
}

.en-btn.active {
    background: #6366f1;
    color: white;
}

.lyric-controls .mv-btn {
    width: 48px;
    height: 48px;
}

.lyric-controls .en-btn {
    width: 48px;
    height: 48px;
}

.right-lyrics {
  flex: 2;
  min-width: 0;
  height: 90%;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
}

.main-content.analysis-active .right-lyrics {
  flex: 1;
  min-width: 320px;
  height: 100%;
}

.main-content.analysis-active .right-lyrics .lyric-wrapper {
  padding: 0;
}

.lyric-controls {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 10px;
    margin-top: -10px;
    justify-content: flex-end;
    flex-wrap: wrap;
}

.lyric-controls .group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.icon-group {
    gap: 10px;
}

.icon-with-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    gap: 2px;
    padding: 4px 0;
}

.icon-with-label :deep(svg) {
    flex-shrink: 0;
}

.icon-text {
    font-size: 10px;
    color: inherit;
    line-height: 1;
    user-select: none;
    font-weight: 500;
}

.lyric-mode-btn .mode-label {
    font-size: 12px;
    font-weight: 700;
}

.lyric-mode-btn .icon-text {
    font-size: 9px;
}

/* 歌词变色开关 */
.switch-track {
    width: 36px;
    height: 20px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    transition: all 0.25s ease;
    flex-shrink: 0;
}

.switch-track.active {
    background: var(--primary-color);
}

.switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.switch-track.active .switch-thumb {
    transform: translateX(16px);
}

.font-select {
    background: rgba(0,0,0,0.05);
    border: none;
    outline: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 13px;
    color: #333;
}

.color-picker {
    width: 30px;
    height: 30px;
    border: none;
    padding: 0;
    background: none;
    cursor: pointer;
    border-radius: 50%;
    overflow: hidden;
}

.size-btns {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0,0,0,0.04);
    padding: 6px 14px;
    border-radius: 20px;
}

.lyric-wrapper {
  flex: 1;
  position: relative;
  overflow-y: auto;
  scroll-behavior: smooth;
  mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
}

.lyric-track {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 50vh 0;
}

.lyric-line {
  line-height: 1.7;
  overflow-wrap: break-word;
  word-break: break-word;
  white-space: normal;
  padding: 16px 24px;
  width: 100%;
  max-width: 90%;
  cursor: pointer;
  text-align: center;
  color: rgba(0,0,0,0.55);
  box-sizing: border-box;
  transform-origin: center center;
  opacity: 0.55;
  transition:
    color 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 0.55s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lyric-line.active,
.lyric-line.leaving {
  will-change: transform, opacity;
}

.is-cover-mode .lyric-line {
  color: rgba(0, 0, 0, 0.6);
}

.lyric-line:hover {
    color: rgba(0,0,0,0.85);
    opacity: 0.85;
}

.lyric-line.played {
  opacity: 0.3;
  color: rgba(0,0,0,0.45);
}

.lyric-line.active {
  color: #000 !important;
  font-weight: 700;
  opacity: 1;
  animation: lyric-enter 0.55s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes lyric-enter {
  0% {
    opacity: 0.2;
    transform: translateY(24px) scale(0.94);
    filter: blur(4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

.lyric-line.leaving {
  opacity: 0.35 !important;
  transform: none !important;
  pointer-events: none;
}

.lyric-line.leaving .lyric-char,
.lyric-line.leaving .yrc-word {
  animation: none;
}

.lyric-line.blur-1 {
  filter: blur(2px);
}

.lyric-line.blur-2 {
  filter: blur(4px);
}

.lyric-line.blur-far {
  filter: blur(8px);
}

.mode-classic .lyric-line.blur-1,
.mode-classic .lyric-line.blur-2,
.mode-classic .lyric-line.blur-far {
  filter: none !important;
}

@keyframes particle-scatter {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: translate(var(--tx), var(--ty)) rotate(var(--r));
  }
}

@keyframes particle-scatter-word {
  0% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(-18px);
  }
}

.lyric-line.active .main-text {
     background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.15) var(--progress));
     -webkit-background-clip: text;
     background-clip: text;
     -webkit-text-fill-color: transparent;
}

.is-cover-mode .lyric-line.active .main-text {
     background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.3) var(--progress));
     -webkit-background-clip: text;
     background-clip: text;
     -webkit-text-fill-color: transparent;
}

.lyric-bubble-wait {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 90%;
    padding: 0 24px;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 5;
}

.lyric-bubble-wait .bubble {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--primary-color);
    flex-shrink: 0;
    opacity: 0.85;
    will-change: transform, opacity;
}

.no-lyric {
    color: rgba(0,0,0,0.3);
    font-size: 18px;
    white-space: nowrap;
    pointer-events: none;
    padding: 40vh 0;
    text-align: center;
}

.main-text {
  background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.4) var(--progress));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  display: block;
  max-width: 100%;
  margin: 0 auto;
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: normal;
}

.lyric-char {
  display: inline-block;
  will-change: transform, opacity;
}

.trans-text {
    font-size: 0.82em;
    margin-top: 8px;
    opacity: 0.85;
    font-weight: 400;
    line-height: 1.45;
    color: inherit;
}

/* === 逐词歌词 (YRC) 风格 === */
.yrc-line {
    transition:
        color 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
        filter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
        opacity 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.yrc-text {
    display: inline;
    line-height: 1.8;
}

.yrc-word {
    --wp: 0;
    display: inline-block;
    white-space: pre;
    color: transparent;
    background: linear-gradient(to right, #000 calc(var(--wp) * 100%), rgba(0,0,0,0.25) calc(var(--wp) * 100%));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    will-change: background;
}

.is-cover-mode .yrc-word {
    background: linear-gradient(to right, #000 calc(var(--wp) * 100%), rgba(0,0,0,0.4) calc(var(--wp) * 100%));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-line.active .yrc-word {
    background: linear-gradient(
        to right,
        #000 calc(var(--wp) * 100%),
        rgba(0,0,0,0.15) calc(var(--wp) * 100%)
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-line:not(.active) .yrc-word {
    background: none;
    -webkit-text-fill-color: rgba(0,0,0,0.55);
}

/* === 经典模式 === */
.mode-classic .lyric-line {
    filter: none !important;
    transform: none !important;
    opacity: 0.65;
    color: rgba(0,0,0,0.55);
}

.mode-classic .lyric-line.active {
    opacity: 1;
    color: #000 !important;
}

.mode-classic .lyric-line.played {
    opacity: 0.35;
}

.mode-classic .lyric-line.leaving {
    opacity: 0.35 !important;
    transform: none !important;
}

.mode-classic .lyric-line.leaving .lyric-char,
.mode-classic .lyric-line.leaving .yrc-word {
    animation: none;
}

.mode-classic .lyric-line:not(.active) .yrc-word {
    -webkit-text-fill-color: rgba(0,0,0,0.55);
}

/* === 歌词模式切换按钮 === */
.lyric-mode-btn .mode-label {
    font-size: 11px;
    font-weight: 700;
    color: inherit;
}

/* === 歌词变色模式：高亮行使用所选颜色 === */
.lyric-wrapper.color-follow .lyric-line.active {
    color: var(--active-color) !important;
}

.lyric-wrapper.color-follow .lyric-line.active .main-text {
    background: linear-gradient(to right, var(--active-color) var(--progress), var(--active-color-faded) var(--progress));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-wrapper.color-follow .main-text {
    background: linear-gradient(to right, var(--active-color) var(--progress), var(--active-color-faded) var(--progress));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-wrapper.color-follow .yrc-word {
    background: linear-gradient(to right, var(--active-color) calc(var(--wp) * 100%), var(--active-color-faded) calc(var(--wp) * 100%));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-wrapper.color-follow .lyric-line.active .yrc-word {
    background: linear-gradient(to right, var(--active-color) calc(var(--wp) * 100%), var(--active-color-faded) calc(var(--wp) * 100%));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-wrapper.color-follow .lyric-line:not(.active) .yrc-word {
    background: none;
    -webkit-text-fill-color: var(--active-color-faded);
}

.lyric-wrapper.color-follow .lyric-line {
    color: var(--active-color-faded);
}

.lyric-wrapper.color-follow .lyric-line.played {
    color: var(--active-color-faded);
}

/* Comment Styles */
.right-comments {
    flex: 1.5;
    height: 90%;
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, 0.4);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 20px;
    min-height: 0;
}

.comments-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(0,0,0,0.05);
    padding-bottom: 10px;
}

.comments-header .title {
    font-size: 18px;
    font-weight: bold;
}

.close-panel-btn {
    font-size: 12px;
    color: var(--primary-color);
    background: none;
    border: none;
    cursor: pointer;
}

.comments-list {
    flex: 1;
    overflow-y: auto;
    padding-right: 10px;
}

.comment-item {
    display: flex;
    gap: 12px;
    padding: 15px 0;
    border-bottom: 1px solid rgba(0,0,0,0.05);
}

.user-avatar img {
    width: 35px;
    height: 35px;
    border-radius: 50%;
}

.comment-content {
    flex: 1;
    font-size: 13px;
    line-height: 1.6;
}

.user-info-row {
    margin-bottom: 5px;
}

.username {
    color: #507daf;
    margin-right: 8px;
}

.content-text {
    white-space: pre-wrap;
    word-break: break-all;
}

.replied-content {
    background: rgba(0,0,0,0.05);
    padding: 8px 12px;
    border-radius: 4px;
    margin: 8px 0;
    color: #666;
    white-space: pre-wrap;
    word-break: break-all;
}

.bottom-info {
    font-size: 12px;
    color: #999;
}

.no-comment {
    text-align: center;
    padding: 50px 0;
    color: #999;
}

.comments-list::-webkit-scrollbar {
    width: 6px;
}

.comments-list::-webkit-scrollbar-thumb {
    background: rgba(0,0,0,0.1);
    border-radius: 3px;
}

.lyric-wrapper::-webkit-scrollbar {
  width: 0;
}

/* Visualizer Bars */
.visualizer-container {
    height: 80px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 6px;
    padding-bottom: 20px;
    opacity: 0.8;
}

.v-bar {
    width: 4px;
    background: linear-gradient(to top, var(--primary-color), #ff6b6b);
    border-radius: 3px;
}

/* Responsive Adaptation */
@media (max-width: 1000px) {
  .main-content {
      gap: 40px;
      padding: 0 5%;
  }
  .cover-container {
      width: 280px;
      height: 280px;
  }
  .song-name {
      font-size: 28px;
  }
}

@media (max-width: 768px) {
  .main-content {
      flex-direction: column;
      gap: 30px;
      padding: 20px 5%;
      overflow-y: auto;
      justify-content: flex-start;
      mask-image: none;
  }
  .left-section {
      flex: none;
  }
  .right-lyrics {
      flex: none;
      width: 100%;
      height: 400px;
      mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
  }
  .cover-container {
      width: 200px;
      height: 200px;
  }
  .song-name {
      font-size: 24px;
      margin-top: 15px;
  }
  .record-actions {
      margin-top: 20px;
      gap: 20px;
  }
  .visualizer-container {
      height: 60px;
      gap: 3px;
  }
  .v-bar {
      width: 3px;
  }
}

.no-drag {
    -webkit-app-region: no-drag !important;
}
.action-item svg {
    transition: transform 0.2s;
}

.action-item:hover svg {
    transform: scale(1.1);
}

/* Playlist Selector Modal */
.playlist-selector-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10005;
}

.playlist-selector-modal {
    background: white;
    width: 360px;
    max-height: 480px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
}

.playlist-selector-modal .modal-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0f0f0;
}

.playlist-selector-modal .modal-header h3 {
    margin: 0;
    font-size: 16px;
    color: #333;
}

.playlist-selector-modal .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 0;
}

.playlist-item {
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background 0.2s;
}

.playlist-item:hover {
    background: #f5f5f5;
}

.playlist-item .cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    overflow: hidden;
    background: #eee;
}

.playlist-item .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.playlist-item .name {
    flex: 1;
    font-size: 14px;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.playlist-item .count {
    font-size: 12px;
    color: #999;
}
</style>
