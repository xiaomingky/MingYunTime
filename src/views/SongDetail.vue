<script setup>
import { computed, ref, shallowRef, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { usePlayerStore } from '../store/player'
import { ChevronDown, Heart, Share2, Download, MessageSquare, Minus, Plus, User, ListMusic, Check, X, Image, ImagePlay, Film, RefreshCw, Type, LayoutGrid, AlignLeft, Settings, ThumbsUp, MessageCircle, Trash2, CornerDownLeft } from 'lucide-vue-next'
import CustomSelect from '../components/CustomSelect.vue'
import { getCommentNew, likeComment, sendComment } from '../api'
import { useRouter } from 'vue-router'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'
import { useQQUserStore } from '../store/qq-user'
import { qqOperSonglist } from '../api/qq'
import { kugouCommentSong, kugouSongDetail } from '../api/kugou'
import { useKugouUserStore } from '../store/kugou-user'
import KugouComment from '../components/KugouComment.vue'

const playerStore = usePlayerStore()
const userStore = useUserStore()
const messageStore = useMessageStore()
const qqUserStore = useQQUserStore()
const kugouUserStore = useKugouUserStore()
const router = useRouter()
// 是否 QQ 平台歌曲(QQ 歌曲评论用 QQComment 组件,不走网易云 getCommentNew)
const isQQSong = computed(() => playerStore.currentSong.platform === 'qq' || !!playerStore.currentSong.songmid)
// 是否酷狗概念版平台歌曲
const isKugouSong = computed(() => playerStore.currentSong.platform === 'kugou' || !!playerStore.currentSong.hash)
// 非网易云歌曲(用于统一隐藏网易云专属功能:歌单管理、云盘等)
const isNonNeteaseSong = computed(() => isQQSong.value || isKugouSong.value)
const lyricFontSize = ref(32)
const noScale = ref(localStorage.getItem('song_detail_no_scale') === 'true')
watch(noScale, (v) => { localStorage.setItem('song_detail_no_scale', v) })
const showGifCover = ref(localStorage.getItem('song_detail_show_gif_cover') !== 'false')
// 歌词设置项默认折叠收起
const showLyricSettings = ref(false)

// 切换歌曲时重置歌词滚动到开头
watch(() => playerStore.currentSong.id, () => {
    if (lyricContainer.value) {
        lyricContainer.value.scrollTo({ top: 0, behavior: 'auto' })
    }
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

// Visualizer logic — 用 shallowRef 避免深层响应式追踪，直接 DOM 操作绕过 Vue 重渲染
const rhythmBars = shallowRef(Array.from({ length: 80 }, () => ({
  height: 3,
  opacity: 0.5
})))
const visualizerContainer = ref(null)
// 缓存 DOM 元素引用，避免每帧 querySelectorAll
let _barEls = null
function getBarEls() {
    if (!_barEls && visualizerContainer.value) {
        _barEls = visualizerContainer.value.querySelectorAll('.v-bar')
    }
    return _barEls
}

// === 逐词歌词 (YRC) 支持 ===
// 当用户切换到"逐行"模式时，强制使用普通 lyrics 渲染（不渲染 yrc-word）
const hasYrcLyrics = computed(() => !!playerStore.yrcLyrics && playerStore.yrcLyrics.length > 0)
const useYrcRender = computed(() => hasYrcLyrics.value && playerStore.lyricDisplayMode === 'word')

// 显示用的歌词列表
// - 逐词模式：用 yrcLyrics（含 words）
// - 逐行模式：优先用普通 lyrics（覆盖更全），无则用 yrcLyrics 的行级 text
const displayLyrics = computed(() => {
    if (useYrcRender.value) return playerStore.yrcLyrics
    if (playerStore.lyrics && playerStore.lyrics.length > 0) return playerStore.lyrics
    if (hasYrcLyrics.value) return playerStore.yrcLyrics
    return playerStore.lyrics
})

const getLineProgress = (index) => {
    // 逐词渲染模式下不使用行级进度（由 yrc-word 接管）
    if (useYrcRender.value) return 0
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
    // 页面重新可见时，如果详情页打开且正在播放，重启 RAF
    if (!document.hidden && playerStore.showSongDetail && !animationId) {
        startVisualizer()
    }
}

// 逐词动画：只刷新当前高亮行内的 word，缓存上次 progress 跳过未变化项
// 性能要点：
// 1. 已完成(progress=1)的 word 标记 data-done，后续帧直接跳过
// 2. 未开始(progress=0)的 word 跳过，不写 DOM
// 3. 正在进行的 word 缓存上次值，差值 < 0.008 视为无变化跳过
// 4. 仅对当前激活行操作，避免全量遍历
const updateYrcWordProgress = () => {
    if (!useYrcRender.value || !lyricContainer.value) return
    const nowMs = (playerStore.audio?.currentTime ?? playerStore.currentTime) * 1000
    const activeLine = lyricContainer.value.querySelector('.lyric-line.active .yrc-text')
    if (!activeLine) return
    const wordSpans = activeLine.querySelectorAll('.yrc-word')
    for (let i = 0; i < wordSpans.length; i++) {
        const el = wordSpans[i]
        // 已完成的 word 直接跳过（progress 已是 1）
        if (el.dataset.done === '1') continue
        const ws = parseFloat(el.dataset.ws) // word startTime ms
        const wd = parseFloat(el.dataset.wd) // word duration ms
        if (isNaN(ws) || isNaN(wd)) continue
        let progress = 0
        if (nowMs >= ws + wd) {
            progress = 1
            el.dataset.done = '1' // 标记完成，后续帧跳过
        } else if (nowMs > ws && wd > 0) {
            progress = (nowMs - ws) / wd
        } else {
            // 未开始，跳过（保持 0）
            continue
        }
        // 缓存上次值，差值过小不更新（减少 DOM 写入）
        const last = parseFloat(el.dataset.lastp)
        if (!isNaN(last) && Math.abs(progress - last) < 0.008) continue
        el.style.setProperty('--wp', progress)
        el.dataset.lastp = progress
    }
}

// 切换激活行时重置该行 word 的缓存标记，让新行能正常推进
const resetYrcLineCache = () => {
    if (!lyricContainer.value) return
    const activeLine = lyricContainer.value.querySelector('.lyric-line.active .yrc-text')
    if (!activeLine) return
    const wordSpans = activeLine.querySelectorAll('.yrc-word')
    for (let i = 0; i < wordSpans.length; i++) {
        const el = wordSpans[i]
        el.dataset.done = ''
        el.dataset.lastp = ''
        el.style.setProperty('--wp', '0')
    }
}

const updateVisualizer = () => {
  if (!playerStore.showSongDetail) {
    if (animationId) cancelAnimationFrame(animationId)
    animationId = null
    return
  }

  // 页面不可见时完全停止 RAF，可见时由 visibilitychange 重新启动
  if (document.hidden) {
    animationId = null
    return
  }

  // 逐词歌词动画更新（只刷新当前行）
  // YRC 逐字进度跟随 RAF 更新，但内部有差值<0.008 跳过机制，实际 DOM 写入很少
  if (useYrcRender.value && playerStore.isPlaying) {
      updateYrcWordProgress()
  }

  if (playerStore.isPlaying) {
    frameCount++
    // 频谱采样从 20fps(%3) 降到 12fps(%5)，视觉无感知差异但 CPU 显著降低
    // 80 根 bar 的 DOM 写入是主要开销，降频后每秒少写 160 次 style 属性
    if (frameCount % 5 === 0) {
        const data = playerStore.updateFrequencyData()
        if (data) {
          const bars = rhythmBars.value
          const len = bars.length
          const half = Math.floor(len / 2)
          const dataLen = data.length
          const els = getBarEls()
          // 镜像对称采样：i 与 len-1-i 取同一频段，形成中间向两边起伏
          // 插值系数从 0.32 提到 0.4，补偿低帧率下的跟手感
          for (let i = 0; i < len; i++) {
            const mirrorIdx = i < half ? i : len - 1 - i
            const start = Math.floor(mirrorIdx * (dataLen / half / 2))
            const val = data[start] || 0
            const targetHeight = Math.max(3, (val / 255) * 76 + 3)
            bars[i].height += (targetHeight - bars[i].height) * 0.4
            bars[i].opacity = 0.45 + (val / 255) * 0.55
            // 直接写 DOM，绕过 Vue 响应式重渲染
            if (els && els[i]) {
              els[i].style.height = bars[i].height + 'px'
              els[i].style.opacity = bars[i].opacity
            }
          }
        }
    }
  } else {
      // 暂停时执行一次衰减后停止 RAF，避免空转
      const bars = rhythmBars.value
      const els = getBarEls()
      let needStop = true
      for (let i = 0; i < bars.length; i++) {
          bars[i].height = Math.max(3, bars[i].height * 0.85)
          bars[i].opacity = Math.max(0.3, bars[i].opacity * 0.85)
          if (els && els[i]) {
            els[i].style.height = bars[i].height + 'px'
            els[i].style.opacity = bars[i].opacity
          }
          // 还有明显高度的 bar 继续衰减一帧
          if (bars[i].height > 4) needStop = false
      }
      // 暂停时也刷新一次 yrc 进度（停在当前位置）
      if (hasYrcLyrics.value) updateYrcWordProgress()
      if (needStop) {
          animationId = null
          return
      }
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
  _barEls = null    // 清理 DOM 引用缓存
  // 清理所有 leaving 定时器
  for (const [, timer] of _leavingTimers) {
    clearTimeout(timer)
  }
  _leavingTimers.clear()
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

// 播放状态变化时：播放→重启 RAF（暂停时已停止），暂停→无需额外操作（RAF 自然衰减停止）
watch(() => playerStore.isPlaying, (playing) => {
  if (playing && playerStore.showSongDetail && !document.hidden && !animationId) {
    startVisualizer()
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
    const distance = Math.abs(index - currentLyricIndex.value)
    if (distance === 0) return 0
    if (distance === 1) return 2
    if (distance === 2) return 4
    return Math.min(8, 5 + (distance - 3) * 1)
}

// 预计算每行模糊等级，避免模板中逐行调用函数
const blurClassMap = computed(() => {
    const map = {}
    const current = currentLyricIndex.value
    displayLyrics.value.forEach((_, i) => {
        const d = Math.abs(i - current)
        if (d === 1) map[i] = 'blur-1'
        else if (d === 2) map[i] = 'blur-2'
        else if (d >= 3) map[i] = 'blur-far'
    })
    return map
})

// 气泡等待动画已移除（用户要求取消）

const scrollToCenter = async (index, instant = false) => {
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
    behavior: instant ? 'auto' : 'smooth'
  })
}

// 歌词源切换 ===
const lyricSourceText = computed(() => {
    const map = { qq: 'QQ音乐', kugou: '酷狗', netease: '网易云', local: '本地', '': '未加载' }
    return map[playerStore.lyricSource] || '未加载'
})

// 切换歌词源：弹出 LyricSelector（本地和线上都弹窗）
// 本地歌曲选后保存到 .lrc 文件；线上歌曲不保存（songPath 为空）
const switchLyricSource = () => {
    const song = playerStore.currentSong
    const isLocal = typeof song.id === 'string' && song.id.startsWith('local-')
    const cleanArtist = isLocal
        ? String(song.artist || '').replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
        : String(song.artist || '').trim()
    window.dispatchEvent(new CustomEvent('show-lyric-selector', {
        detail: {
            songName: song.name,
            artist: cleanArtist,
            songPath: isLocal ? song.path : '',
            duration: song.duration || 0  // 秒，用于在弹窗中显示并高亮匹配项
        }
    }))
}

// leavingIndexes 定时器 Map，每个索引独立定时器，避免清除时遗漏导致 pointer-events 永久锁定
let _leavingTimers = new Map()
watch(currentLyricIndex, (newIndex, oldIndex) => {
  if (oldIndex != null && oldIndex >= 0 && oldIndex !== newIndex) {
    leavingIndexes.value.add(oldIndex)
    // 清除该索引的旧定时器（如果有），然后创建新定时器
    if (_leavingTimers.has(oldIndex)) {
      clearTimeout(_leavingTimers.get(oldIndex))
    }
    _leavingTimers.set(oldIndex, setTimeout(() => {
      leavingIndexes.value.delete(oldIndex)
      _leavingTimers.delete(oldIndex)
    }, 1300))
  }
  if (newIndex >= 0) {
    scrollToCenter(newIndex)
  }
  // 切换激活行时重置新行的 word 缓存，让逐字动画能从头推进
  if (useYrcRender.value) {
    nextTick(() => {
        resetYrcLineCache()
        // 立即根据当前播放进度设置 --wp，避免整行停留在 0（浅灰色）再逐步变黑
        updateYrcWordProgress()
    })
  }
})

// 歌词变化时（切歌加载新歌词）立即定位到当前行（通常为第一行），无动画
watch(displayLyrics, () => {
    if (lyricContainer.value) {
        lyricContainer.value.scrollTo({ top: 0, behavior: 'auto' })
    }
    nextTick(() => {
        if (currentLyricIndex.value >= 0) {
            scrollToCenter(currentLyricIndex.value, true)
        }
    })
})

const handleLyricClick = (time) => {
    // time is already in seconds from line.time
    playerStore.seek(time)
}

const showMvMenu = ref(false)

const handlePlayMv = () => {
    showMvMenu.value = !showMvMenu.value
}

const playLocalMv = () => {
    showMvMenu.value = false
    playerStore.playLocalMv()
}

const playOnlineMv = () => {
    showMvMenu.value = false
    playerStore.playOnlineMv()
}

const playKugouMv = () => {
    showMvMenu.value = false
    playerStore.playKugouMv()
}

const playMvCandidate = (mv) => {
    playerStore.playMvCandidate(mv)
}

const closeMvMenu = () => {
    showMvMenu.value = false
}

const formatPlayCount = (n) => {
    if (!n) return ''
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
}

// 点击外部关闭 MV 下拉
watch(showMvMenu, (val) => {
    if (val) {
        setTimeout(() => {
            document.addEventListener('click', closeMvMenu, { once: true })
        }, 0)
    }
})

const handleDownload = async () => {
    // 本地音乐已有路径，无需下载
    if (playerStore.currentSong.path) {
        messageStore.info('此歌曲已在本地')
        return
    }

    // QQ 平台歌曲：走 playerStore.downloadQQSong 统一处理（qqDownload 拉高品质 URL + IPC 落盘）
    if (isQQSong.value) {
        await playerStore.downloadQQSong(playerStore.currentSong)
        return
    }
    // 酷狗概念版平台歌曲：走 playerStore.downloadKugouSong 统一处理
    if (isKugouSong.value) {
        await playerStore.downloadKugouSong(playerStore.currentSong)
        return
    }

    if (playerStore.currentSong.url) {
        const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
        if (bridge && bridge.invoke) {
            try {
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
// 评论分页 / 排序 / 操作状态
const commentSortType = ref(3) // 1推荐 2热度 3时间
const commentPageNo = ref(1)
const commentCursor = ref('')
const commentHasMore = ref(false)
const commentLoading = ref(false)
const commentText = ref('')
const replyTarget = ref(null) // 回复目标评论对象
const commentSubmitting = ref(false)
const commentsListRef = ref(null)

const canManageComment = (comment) => {
    return userStore.isLoggedIn && userStore.profile?.userId === comment.user?.userId
}

const fetchComments = async (reset = true) => {
    if (!playerStore.currentSong.id) return
    if (commentLoading.value) return
    if (reset) {
        commentPageNo.value = 1
        commentCursor.value = ''
        comments.value = []
    }
    commentLoading.value = true
    try {
        // QQ 平台:调用 fcg_global_comment_h5.fcg(用 songid 作 topid)
        // QQ 评论排序: 2=热评(cmd=6), 其他=最新(cmd=8)
        if (isQQSong.value) {
            const { qqComments } = await import('../api/qq')
            const { useQQUserStore } = await import('../store/qq-user')
            const qqUser = useQQUserStore()
            // songmid 必传,songid 可选(主进程 songid 缺失时自动调 song-detail 补全)
            const songmid = playerStore.currentSong.songmid || playerStore.currentSong.id
            const songid = playerStore.currentSong.songid || 0
            if (!songmid) {
                messageStore.warning('该歌曲缺少 songmid,无法获取评论')
                commentLoading.value = false
                return
            }
            const cmd = commentSortType.value === 2 ? 6 : 8  // 6=热评, 8=最新
            const res = await qqComments(songmid, songid, cmd, commentPageNo.value - 1, 20, commentCursor.value, qqUser.cookie)
            const list = res?.data?.comments || []
            if (reset) {
                comments.value = list
            } else {
                comments.value.push(...list)
            }
            totalComments.value = res?.data?.total || 0
            commentHasMore.value = !!res?.data?.hasMore
            // QQ 分页游标:上一页最后一条评论的 commentId
            if (list.length > 0) {
                commentCursor.value = res?.data?.lasthotcommentid || list[list.length - 1].commentId || ''
            }
        } else if (isKugouSong.value) {
            // 酷狗歌曲评论由 KugouComment 组件独立加载(只读),此处跳过内置评论逻辑
            commentLoading.value = false
            commentHasMore.value = false
            comments.value = []
            return
        } else {
            // 网易云/本地歌曲评论
            const res = await getCommentNew({
                id: playerStore.currentSong.id,
                type: 0,
                pageNo: commentPageNo.value,
                pageSize: 20,
                sortType: commentSortType.value,
                cursor: commentCursor.value
            })
            const list = res.data?.comments || res.comments || []
            if (reset) {
                comments.value = list
            } else {
                comments.value.push(...list)
            }
            totalComments.value = res.data?.totalCount || res.total || 0
            commentHasMore.value = !!(res.data?.hasMore ?? res.hasMore)
            // sortType=3 时，cursor 为上一页最后一条的 time
            if (list.length > 0 && commentSortType.value === 3) {
                commentCursor.value = String(list[list.length - 1].time)
            }
        }
    } catch (err) {
        console.error('Fetch comments error:', err)
        messageStore.error('获取评论失败')
    } finally {
        commentLoading.value = false
    }
}

const loadMoreComments = () => {
    if (!commentHasMore.value || commentLoading.value) return
    commentPageNo.value++
    fetchComments(false)
}

const onCommentsScroll = (e) => {
    const el = e.target
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60 && commentHasMore.value && !commentLoading.value) {
        loadMoreComments()
    }
}

const switchCommentSort = (type) => {
    if (commentSortType.value === type || commentLoading.value) return
    commentSortType.value = type
    fetchComments(true)
}

const toggleLike = async (comment) => {
    if (!userStore.isLoggedIn) { messageStore.warning('请先登录后再点赞'); return }
    const wasLiked = !!comment.liked
    // 乐观更新
    comment.liked = !wasLiked
    comment.likedCount = (comment.likedCount || 0) + (wasLiked ? -1 : 1)
    try {
        await likeComment(playerStore.currentSong.id, comment.commentId, wasLiked ? 0 : 1, 0)
    } catch (err) {
        // 回滚
        comment.liked = wasLiked
        comment.likedCount = (comment.likedCount || 0) + (wasLiked ? 1 : -1)
        messageStore.error('点赞操作失败')
    }
}

const startReply = (comment) => {
    if (!userStore.isLoggedIn) { messageStore.warning('请先登录后再回复'); return }
    replyTarget.value = comment
    commentText.value = ''
}

const cancelReply = () => {
    replyTarget.value = null
    commentText.value = ''
}

const submitComment = async () => {
    const text = commentText.value.trim()
    if (!text) { messageStore.warning('请输入评论内容'); return }
    if (!userStore.isLoggedIn) { messageStore.warning('请先登录'); return }
    if (commentSubmitting.value) return
    commentSubmitting.value = true
    try {
        const isReply = !!replyTarget.value
        const res = await sendComment({
            t: isReply ? 2 : 1,
            type: 0,
            id: playerStore.currentSong.id,
            content: text,
            commentId: isReply ? replyTarget.value.commentId : undefined
        })
        if (res.code === 200) {
            messageStore.success(isReply ? '回复成功' : '评论成功')
            commentText.value = ''
            replyTarget.value = null
            await fetchComments(true)
        } else {
            messageStore.error(res.message || res.msg || (isReply ? '回复失败' : '评论失败'))
        }
    } catch (err) {
        console.error('Submit comment error:', err)
        messageStore.error('提交失败，请稍后重试')
    } finally {
        commentSubmitting.value = false
    }
}

const deleteComment = async (comment) => {
    if (!canManageComment(comment)) return
    const confirmed = await messageStore.confirm('确定删除这条评论吗？', '删除评论')
    if (!confirmed) return
    try {
        const res = await sendComment({
            t: 0,
            type: 0,
            id: playerStore.currentSong.id,
            commentId: comment.commentId
        })
        if (res.code === 200) {
            messageStore.success('删除成功')
            const idx = comments.value.findIndex(c => c.commentId === comment.commentId)
            if (idx !== -1) {
                comments.value.splice(idx, 1)
                totalComments.value = Math.max(0, totalComments.value - 1)
            }
        } else {
            messageStore.error(res.message || res.msg || '删除失败')
        }
    } catch (err) {
        console.error('Delete comment error:', err)
        messageStore.error('删除失败，请稍后重试')
    }
}

watch(() => playerStore.currentSong.id, () => {
    if (playerStore.showSongDetail) {
        fetchComments(true)
    }
})

watch(() => playerStore.showSongDetail, (val) => {
    if (val) {
        fetchComments(true)
    }
})

const handleComment = () => {
    showCommentPanel.value = !showCommentPanel.value
    // 打开评论面板时如果评论为空,自动拉取
    if (showCommentPanel.value && comments.value.length === 0 && !commentLoading.value) {
        fetchComments(true)
    }
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

// 酷狗平台: 添加当前歌曲到指定歌单
const handleAddToKugouPlaylist = async (listid) => {
    if (addingToPlaylist.value) return
    addingToPlaylist.value = true
    try {
        const song = playerStore.currentSong
        const ok = await kugouUserStore.addSongToPlaylist(listid, song)
        if (ok) {
            showPlaylistSelector.value = false
        }
    } finally {
        addingToPlaylist.value = false
    }
}

// 字体与颜色设置
const fonts = ref([])
const fontOptions = computed(() => {
    return [{ value: '', label: '默认字体' }, ...fonts.value.map(f => ({ value: f.name, label: f.name }))]
})
const onFontChange = (val) => playerStore.setFont(val)
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

    <div class="main-content">
      <div class="left-section">
        <!-- Normal Cover + Info -->
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
           <!-- QQ 平台取消歌单管理,网易云和酷狗显示添加到歌单 -->
           <div v-if="!isQQSong" class="action-item" @click="showPlaylistSelector = true"><Plus :size="24" /></div>
           <div class="action-item" @click="handleDownload"><Download :size="22" /></div>
           <div v-if="!isNonNeteaseSong" class="action-item" @click="handleShare"><Share2 :size="22" /></div>
           <!-- 评论按钮:所有平台显示 -->
           <div class="action-item" @click="handleComment"><MessageSquare :size="22" /></div>
        </div>

        <!-- Playlist Selector Modal (网易云 + 酷狗) -->
        <div v-if="showPlaylistSelector" class="playlist-selector-overlay" @click="showPlaylistSelector = false">
            <div class="playlist-selector-modal" @click.stop>
                <div class="modal-header">
                    <h3>收藏到歌单</h3>
                    <X :size="20" class="clickable" @click="showPlaylistSelector = false" />
                </div>
                <div class="modal-body">
                    <!-- 酷狗平台: 显示酷狗歌单 -->
                    <template v-if="isKugouSong">
                        <div
                            v-for="p in kugouUserStore.playlists.filter(pl => pl.isMine && pl.id !== kugouUserStore.likedPlaylistId)"
                            :key="p.id"
                            class="playlist-item clickable"
                            @click="handleAddToKugouPlaylist(p.id)"
                        >
                            <div class="cover">
                                <img v-if="p.coverImgUrl" :src="p.coverImgUrl" />
                                <Heart v-else :size="20" :fill="'#EC4141'" :color="'#EC4141'" />
                            </div>
                            <div class="name">{{ p.name }}</div>
                            <div class="count">{{ p.songCount || 0 }}首</div>
                        </div>
                    </template>
                    <!-- 网易云平台: 原有逻辑 -->
                    <template v-else>
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
                    </template>
                </div>
            </div>
        </div>
      </div>

      <div class="right-lyrics" v-show="!showCommentPanel">
        <div class="lyric-controls no-drag">
            <div class="group icon-group">
                <div class="mv-dropdown-wrap">
                    <div class="icon-with-label action-item mv-btn" title="播放MV" @click="handlePlayMv">
                        <Film :size="18" />
                        <span class="icon-text">MV</span>
                    </div>
                    <div v-if="showMvMenu" class="mv-dropdown-menu" @click.stop>
                        <div class="mv-menu-item" @click="playLocalMv">
                            <Film :size="14" />
                            <span>本地 MV</span>
                            <small>从歌曲同目录/mv 文件夹匹配</small>
                        </div>
                        <div class="mv-menu-item" @click="playOnlineMv">
                            <Film :size="14" />
                            <span>线上 MV</span>
                            <small>用网易云 MV API 按歌名匹配</small>
                        </div>
                    </div>
                </div>
                <div class="icon-with-label action-item" :class="{ active: playerStore.bgMode === 'cover' }" :title="playerStore.bgMode === 'cover' ? '切换到经典样式' : '切换到沉浸模式'" @click="playerStore.toggleBgMode()">
                   <ImagePlay v-if="playerStore.bgMode === 'cover'" :size="18" />
                   <Image v-else :size="18" />
                   <span class="icon-text">{{ playerStore.bgMode === 'cover' ? '沉浸' : '经典' }}</span>
                </div>
                <div class="icon-with-label action-item lyric-source-btn" :title="`当前: ${lyricSourceText}，点击切换歌词源`" @click="switchLyricSource">
                   <RefreshCw :size="16" />
                   <span class="icon-text">{{ lyricSourceText }}</span>
                </div>
                <div v-if="hasYrcLyrics" class="icon-with-label action-item lyric-display-mode-btn" :class="{ active: playerStore.lyricDisplayMode === 'word' }" :title="playerStore.lyricDisplayMode === 'word' ? '当前逐词，点击切换逐行' : '当前逐行，点击切换逐词'" @click="playerStore.toggleLyricDisplayMode()">
                   <Type :size="16" />
                   <span class="icon-text">{{ playerStore.lyricDisplayMode === 'word' ? '逐词' : '逐行' }}</span>
                </div>
                <!-- 设置折叠/展开切换按钮 -->
                <div class="icon-with-label action-item settings-toggle-btn" :class="{ active: showLyricSettings }" :title="showLyricSettings ? '收起歌词设置' : '展开歌词设置'" @click="showLyricSettings = !showLyricSettings">
                   <Settings :size="16" />
                   <span class="icon-text">设置</span>
                </div>
            </div>
            <!-- 歌词设置项：默认折叠，点击「设置」按钮展开 -->
            <transition name="lyric-settings-collapse">
                <div v-show="showLyricSettings" class="lyric-settings-wrap">
                    <div class="group">
                        <span class="label">桌面字体</span>
                        <CustomSelect
                            v-model="playerStore.desktopLyricFont"
                            :options="fontOptions"
                            compact
                            @change="onFontChange"
                        />
                    </div>
                    <div class="group">
                        <span class="label">颜色</span>
                        <input type="color" :value="playerStore.desktopLyricColor" @input="playerStore.setColor($event.target.value)" class="color-picker" />
                    </div>
                    <div class="group">
                        <span class="label">桌面模式</span>
                        <div class="dlyric-mode-btns">
                           <div class="mode-chip" :class="{ active: playerStore.desktopLyricMode === 'complex' }" title="复杂模式：封面+控制+歌词" @click="playerStore.setDesktopLyricMode('complex')">
                              <LayoutGrid :size="13" />
                              <span>复杂</span>
                           </div>
                           <div class="mode-chip" :class="{ active: playerStore.desktopLyricMode === 'simple' }" title="简约模式：仅显示歌词" @click="playerStore.setDesktopLyricMode('simple')">
                              <AlignLeft :size="13" />
                              <span>简约</span>
                           </div>
                        </div>
                    </div>
                    <div class="group">
                        <span class="label">背景透明</span>
                        <div class="opacity-row">
                           <input type="range" min="0" max="100" :value="100 - playerStore.desktopLyricOpacity" @input="playerStore.setDesktopLyricOpacity(100 - $event.target.value)" class="opacity-slider" />
                           <span class="opacity-val">{{ 100 - playerStore.desktopLyricOpacity }}%</span>
                        </div>
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
                        <span class="label">高亮行</span>
                        <div class="mode-chip" :class="{ active: noScale }" title="切换高亮行是否放大" @click="noScale = !noScale">
                            <span>{{ noScale ? '等大' : '放大' }}</span>
                        </div>
                    </div>
                </div>
            </transition>
        </div>

        <div class="lyric-wrapper mode-apple" ref="lyricContainer">
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
                    fontSize: (index === currentLyricIndex && !noScale ? lyricFontSize + 4 : lyricFontSize) + 'px',
                    fontFamily: lyricFontFamily
                }"
                @click="handleLyricClick(line.time)"
              >
                <!-- 逐词歌词模式 -->
                <div v-if="useYrcRender && line.words" class="main-text yrc-text">
                    <span
                        v-for="(word, wi) in line.words"
                        :key="wi"
                        class="yrc-word"
                        :data-ws="word.startTime"
                        :data-wd="word.duration"
                        style="--wp: 0"
                    >{{ word.text }}</span>
                </div>
                <!-- 普通歌词模式（含逐行模式） -->
                <div
                    v-else
                    class="main-text"
                    :style="{ '--progress': index === currentLyricIndex ? getLineProgress(index) + '%' : '0%' }"
                >{{ line.text }}
                </div>
                <div v-if="line.ttext" class="trans-text">{{ line.ttext }}</div>
              </div>
              <div v-if="!displayLyrics.length" class="no-lyric">纯音乐，请欣赏</div>
          </div>
        </div>
      </div>

      <!-- Comment Section -->
      <div class="right-comments" v-show="showCommentPanel">
          <div class="comments-header">
              <span class="title">歌曲评论 <span v-if="!isKugouSong">({{ totalComments }})</span></span>
              <button class="close-panel-btn" @click="showCommentPanel = false">返回歌词</button>
          </div>
          <!-- 酷狗平台:使用 KugouComment 组件(只读) -->
          <div v-if="isKugouSong && playerStore.currentSong.mixsongid" class="comments-list">
              <KugouComment
                  :id="playerStore.currentSong.mixsongid"
                  type="song"
              />
          </div>
          <div v-else-if="isKugouSong" class="no-comment">该歌曲暂无评论信息</div>
          <!-- QQ 平台:评论(只读,不支持发送/点赞/删除) -->
          <!-- 网易云/本地歌曲评论:完整评论逻辑(支持发送/点赞/删除) -->
          <template v-else-if="!isKugouSong">
          <div class="comments-toolbar">
              <button v-if="!isNonNeteaseSong" class="sort-btn" :class="{ active: commentSortType === 3 }" @click="switchCommentSort(3)">按时间</button>
              <button class="sort-btn" :class="{ active: commentSortType === 2 }" @click="switchCommentSort(2)">按热度</button>
              <button v-if="!isNonNeteaseSong" class="sort-btn" :class="{ active: commentSortType === 1 }" @click="switchCommentSort(1)">推荐</button>
              <span v-if="isQQSong" class="sort-btn" style="cursor:default;opacity:0.6">最新评论</span>
          </div>
          <div class="comments-list" ref="commentsListRef" @scroll="onCommentsScroll">
                  <div v-for="comment in comments" :key="comment.commentId" class="comment-item">
                      <div class="user-avatar">
                          <img :src="comment.user.avatarUrl || ''" @error="$event.target.style.visibility='hidden'" />
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
                              <div v-if="!isNonNeteaseSong" class="comment-actions">
                                  <button class="action-btn like-btn" :class="{ liked: comment.liked }" @click="toggleLike(comment)" :title="comment.liked ? '取消点赞' : '点赞'">
                                      <ThumbsUp :size="14" :fill="comment.liked ? 'currentColor' : 'none'" />
                                      <span v-if="comment.likedCount">{{ comment.likedCount }}</span>
                                  </button>
                                  <button class="action-btn" @click="startReply(comment)" title="回复">
                                      <MessageCircle :size="14" />
                                      <span>回复</span>
                                  </button>
                                  <button v-if="canManageComment(comment)" class="action-btn danger" @click="deleteComment(comment)" title="删除">
                                      <Trash2 :size="14" />
                                      <span>删除</span>
                                  </button>
                              </div>
                              <div v-else class="comment-actions">
                                  <span v-if="comment.likedCount" class="qq-like-count">👍 {{ comment.likedCount }}</span>
                              </div>
                          </div>
                      </div>
                  </div>
                  <div v-if="commentLoading" class="comment-loading">{{ comments.length === 0 ? '加载中...' : '加载更多...' }}</div>
                  <div v-else-if="!commentHasMore && comments.length > 0" class="comment-loading">没有更多评论了</div>
                  <div v-if="!commentLoading && comments.length === 0" class="no-comment">暂无评论，快来抢沙发吧</div>
              </div>
              <div v-if="!isNonNeteaseSong" class="comment-input-box">
                  <div v-if="replyTarget" class="reply-banner">
                      <span>回复 @{{ replyTarget.user.nickname }}</span>
                      <button class="cancel-reply" @click="cancelReply"><X :size="14" /></button>
                  </div>
                  <div class="comment-input-row">
                      <textarea
                          v-model="commentText"
                          class="comment-input"
                          :placeholder="replyTarget ? `回复 @${replyTarget.user.nickname}...` : '发表评论...'"
                          rows="1"
                          @keydown.enter.exact.prevent="submitComment"
                      ></textarea>
                      <button class="send-btn" :disabled="commentSubmitting || !commentText.trim()" @click="submitComment">
                          <CornerDownLeft :size="16" />
                          {{ commentSubmitting ? '发送中' : '发送' }}
                      </button>
                  </div>
              </div>
          </template>
      </div>
    </div>

    <div class="visualizer-container" ref="visualizerContainer">
        <div
            v-for="(bar, i) in rhythmBars"
            :key="i"
            class="v-bar"
        ></div>
    </div>

    <!-- MV 候选选择面板（线上搜索返回多个候选时弹出） -->
    <div v-if="playerStore.showMvSearchPicker" class="mv-picker-overlay" @click.self="playerStore.showMvSearchPicker = false">
        <div class="mv-picker-modal">
            <div class="mv-picker-header">
                <h3>选择线上 MV</h3>
                <X :size="18" class="clickable" @click="playerStore.showMvSearchPicker = false" />
            </div>
            <div class="mv-picker-body">
                <div
                    v-for="mv in playerStore.mvSearchCandidates"
                    :key="mv.id"
                    class="mv-candidate-item"
                    @click="playMvCandidate(mv)"
                >
                    <img v-if="mv.cover" :src="mv.cover" class="mv-cover" loading="lazy" />
                    <div v-else class="mv-cover placeholder"><Film :size="20" /></div>
                    <div class="mv-info">
                        <div class="mv-name">{{ mv.name }}</div>
                        <div class="mv-artist">{{ mv.artistName }}</div>
                    </div>
                    <span v-if="mv.playCount" class="mv-plays">{{ formatPlayCount(mv.playCount) }}</span>
                </div>
            </div>
        </div>
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

/* 沉浸封面模式：完全不透明白底，bg-blur 自身调到朦胧深度 */
.song-detail-overlay.is-cover-mode {
  background-color: #fafafa;  /* 完全不透明，略带暖调 */
}

.song-detail-overlay.show {
  top: 0;
  /* 注意：不要在这里加 transform（如 translateZ(0)），
     会导致 -webkit-app-region: drag 顶部拖动区域命中失效（时灵时不灵） */
  pointer-events: auto;
}

.bg-blur {
  position: absolute;
  top: -5%;
  left: -5%;
  right: -5%;
  bottom: -5%;
  background-size: cover;
  background-position: center;
  /* 恢复 blur 模拟沉浸朦胧感。
     安全要点：本元素无 transition，filter 只在切歌（背景图变化）时重算一次，
     之前的 CPU 50% 真正元凶是 v-bar transition/box-shadow 和 [DL-Debug] 日志，已修复。
     scale 放大 5% 避免模糊后边缘出现透明 */
  filter: blur(60px) saturate(1.3);
  opacity: 0.55;
  z-index: 0;
  pointer-events: none;
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
    /* 恢复 blur 光晕效果，无 transition 安全 */
    filter: blur(30px);
    opacity: 0.35;
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
  color: #444;
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

.link {
  color: #333;
  font-weight: 500;
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

.lyric-controls .mv-btn {
    width: 48px;
    height: 48px;
}

/* MV 下拉菜单 */
.mv-dropdown-wrap {
    position: relative;
    display: inline-block;
}

.mv-dropdown-menu {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 8px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
    padding: 6px 0;
    min-width: 220px;
    z-index: 100;
    animation: mvMenuFade 0.15s ease;
}

@keyframes mvMenuFade {
    from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.mv-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    color: #333;
    transition: background 0.12s;
}

.mv-menu-item span {
    font-size: 13px;
    font-weight: 500;
    flex-shrink: 0;
}

.mv-menu-item small {
    font-size: 10px;
    color: #999;
    flex: 1;
    text-align: right;
}

.mv-menu-item:hover {
    background: #f5f5f5;
    color: var(--primary-color);
}

/* MV 候选选择面板 */
.mv-picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 15000;
    backdrop-filter: blur(4px);
}

.mv-picker-modal {
    background: #fff;
    border-radius: 14px;
    width: min(480px, 92vw);
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.mv-picker-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0f0f0;
}

.mv-picker-header h3 {
    margin: 0;
    font-size: 16px;
    color: #1a1a2e;
}

.mv-picker-header .clickable {
    color: #999;
    cursor: pointer;
}

.mv-picker-header .clickable:hover {
    color: #333;
}

.mv-picker-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
}

.mv-candidate-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    cursor: pointer;
    transition: background 0.12s;
}

.mv-candidate-item:hover {
    background: #f5f5f5;
}

.mv-cover {
    width: 80px;
    height: 45px;
    border-radius: 6px;
    object-fit: cover;
    background: #f0f0f0;
    flex-shrink: 0;
}

.mv-cover.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
}

.mv-info {
    flex: 1;
    min-width: 0;
}

.mv-name {
    font-size: 14px;
    color: #1a1a2e;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mv-artist {
    font-size: 12px;
    color: #999;
    margin-top: 2px;
}

.mv-plays {
    font-size: 11px;
    color: #bbb;
    flex-shrink: 0;
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

/* 歌词设置项折叠容器：独占一行，靠右对齐 */
.lyric-settings-wrap {
    width: 100%;
    justify-content: flex-end;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    overflow: hidden;
}

.lyric-settings-collapse-enter-active,
.lyric-settings-collapse-leave-active {
    transition: max-height 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
    overflow: hidden;
    max-height: 80px;
}

.lyric-settings-collapse-enter-from,
.lyric-settings-collapse-leave-to {
    opacity: 0;
    max-height: 0;
    margin-top: -10px;
}

.settings-toggle-btn {
    opacity: 0.7;
}
.settings-toggle-btn.active {
    opacity: 1;
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

/* 歌词源切换按钮 */
.lyric-source-btn .icon-text {
    font-size: 10px;
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

/* 桌面歌词模式切换 chips */
.dlyric-mode-btns {
    display: flex;
    align-items: center;
    gap: 6px;
}
.mode-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 14px;
    font-size: 12px;
    color: #666;
    background: rgba(0,0,0,0.04);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
}
.mode-chip:hover {
    background: rgba(236,65,65,0.08);
    color: var(--primary-color, #ec4141);
}
.mode-chip.active {
    background: var(--primary-color, #ec4141);
    color: #fff;
    border-color: var(--primary-color, #ec4141);
}

/* 透明度滑块 */
.opacity-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.opacity-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 90px;
    height: 4px;
    border-radius: 2px;
    background: rgba(0,0,0,0.12);
    outline: none;
    cursor: pointer;
}
.opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--primary-color, #ec4141);
    border: 2px solid #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    cursor: pointer;
}
.opacity-val {
    font-size: 11px;
    color: #888;
    min-width: 32px;
    text-align: right;
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
  padding: 30vh 0 50vh;
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
  /* 过渡动画：慢速 + 自然缓动，营造真实感 */
  transition:
    color 1.2s cubic-bezier(0.25, 0.1, 0.25, 1),
    opacity 1.2s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.lyric-line.active {
  will-change: opacity;
}

.is-cover-mode .lyric-line {
  color: rgba(0, 0, 0, 0.75);
  opacity: 0.75;
}

/* 沉浸模式：加深已播放/景深行的透明度，保证在封面背景上可读 */
.is-cover-mode .lyric-line.played {
  opacity: 0.5;
  color: rgba(0,0,0,0.6);
}

.is-cover-mode .lyric-line.leaving {
  opacity: 0.5;
}

.is-cover-mode .lyric-line.blur-1 {
  opacity: 0.7;
}

.is-cover-mode .lyric-line.blur-2 {
  opacity: 0.55;
}

.is-cover-mode .lyric-line.blur-far {
  opacity: 0.4;
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
}

.lyric-line.leaving {
  opacity: 0.35;
  pointer-events: none;
}

.lyric-line.leaving .lyric-char,
.lyric-line.leaving .yrc-word {
  animation: none;
}

/* 移除 filter:blur，改用 opacity 模拟景深，避免 GPU 反复计算模糊 */
.lyric-line.blur-1 {
  opacity: 0.6;
}

.lyric-line.blur-2 {
  opacity: 0.4;
}

.lyric-line.blur-far {
  opacity: 0.25;
}

/* === 歌词变色模式：高亮行使用所选颜色 === */

.lyric-line.active .main-text {
     /* 未填充部分保持 0.75 可读性,避免新激活行进度极低时整行过浅 */
     background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.75) var(--progress));
     -webkit-background-clip: text;
     background-clip: text;
     -webkit-text-fill-color: transparent;
}

/* yrc-text 包含逐词 yrc-word 子元素：子级自带 background-clip:text 梯度，
   父级再套一层会导致 --wp=0 时子级灰色与父级黑色层叠，歌词变浅灰。
   此处禁用父级背景，由每个 yrc-word 自行控制渐变 */
.main-text.yrc-text,
.lyric-line.active .main-text.yrc-text,
.is-cover-mode .lyric-line.active .main-text.yrc-text {
     background: none !important;
     -webkit-background-clip: unset !important;
     background-clip: unset !important;
     -webkit-text-fill-color: unset !important;
}

.is-cover-mode .lyric-line.active .main-text {
     background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.75) var(--progress));
     -webkit-background-clip: text;
     background-clip: text;
     -webkit-text-fill-color: transparent;
}

/* 气泡等待条样式已移除 */

.no-lyric {
    color: rgba(0,0,0,0.3);
    font-size: 18px;
    white-space: nowrap;
    pointer-events: none;
    padding: 40vh 0;
    text-align: center;
}

.is-cover-mode .no-lyric {
    color: rgba(0,0,0,0.5);
}

.main-text {
  background: linear-gradient(to right, #000 var(--progress), rgba(0,0,0,0.7) var(--progress));
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
    /* 继承 .lyric-line 的轻量 transition，不再重复定义 filter/回弹曲线 */
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
    /* 用 background-position 移动固定渐变代替 calc(var(--wp) * 100%) 颜色断点
       前者只触发 GPU 合成层位移（丝滑），后者每帧重绘 background（顿挫） */
    background-image: linear-gradient(to right,
        #000 0%, #000 50%,
        rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.4) 100%);
    background-size: 200% 100%;
    background-position: calc(100% - var(--wp) * 100%) 0;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

/* 仅激活行的 word 启用 will-change，避免大量元素同时占用 GPU 合成层 */
.lyric-line.active .yrc-word {
    will-change: background-position;
}

.is-cover-mode .yrc-word {
    background-image: linear-gradient(to right,
        #000 0%, #000 50%,
        rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.45) 100%);
    background-size: 200% 100%;
    background-position: calc(100% - var(--wp) * 100%) 0;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-line.active .yrc-word {
    background-image: linear-gradient(to right,
        #000 0%, #000 50%,
        rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.4) 100%);
    background-size: 200% 100%;
    background-position: calc(100% - var(--wp) * 100%) 0;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-line:not(.active) .yrc-word {
    background: none;
    -webkit-text-fill-color: rgba(0,0,0,0.55);
}

/* 沉浸模式：加深非激活行逐字歌词颜色 */
.is-cover-mode .lyric-line:not(.active) .yrc-word {
    -webkit-text-fill-color: rgba(0,0,0,0.7);
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
    background-image: linear-gradient(to right,
        var(--active-color) 0%, var(--active-color) 50%,
        var(--active-color-faded) 50%, var(--active-color-faded) 100%);
    background-size: 200% 100%;
    background-position: calc(100% - var(--wp) * 100%) 0;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

.lyric-wrapper.color-follow .lyric-line.active .yrc-word {
    background-image: linear-gradient(to right,
        var(--active-color) 0%, var(--active-color) 50%,
        var(--active-color-faded) 50%, var(--active-color-faded) 100%);
    background-size: 200% 100%;
    background-position: calc(100% - var(--wp) * 100%) 0;
    background-repeat: no-repeat;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
}

.comment-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}

.qq-like-count {
    font-size: 12px;
    color: #999;
    user-select: none;
}

.action-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    border: none;
    background: none;
    color: #888;
    font-size: 12px;
    cursor: pointer;
    border-radius: 12px;
    transition: all 0.2s;
}

.action-btn:hover {
    background: rgba(0,0,0,0.06);
    color: #555;
}

.action-btn.like-btn.liked {
    color: var(--primary-color);
}

.action-btn.danger:hover {
    background: rgba(236, 65, 65, 0.1);
    color: var(--primary-color);
}

.comments-toolbar {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
}

.sort-btn {
    padding: 3px 12px;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 14px;
    background: transparent;
    color: #666;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.sort-btn:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
}

.sort-btn.active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
}

.comment-loading {
    text-align: center;
    padding: 14px 0;
    color: #999;
    font-size: 12px;
}

.comment-input-box {
    border-top: 1px solid rgba(0,0,0,0.06);
    padding-top: 10px;
    margin-top: 6px;
}

.reply-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--primary-color);
    padding: 4px 8px;
    margin-bottom: 6px;
    background: rgba(236, 65, 65, 0.06);
    border-radius: 6px;
}

.cancel-reply {
    border: none;
    background: none;
    color: #999;
    cursor: pointer;
    padding: 2px;
    display: flex;
}

.cancel-reply:hover {
    color: var(--primary-color);
}

.comment-input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
}

.comment-input {
    flex: 1;
    resize: none;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 16px;
    padding: 8px 14px;
    font-size: 13px;
    background: rgba(255,255,255,0.7);
    outline: none;
    max-height: 80px;
    line-height: 1.5;
    font-family: inherit;
}

.comment-input:focus {
    border-color: var(--primary-color);
    background: #fff;
}

.send-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border: none;
    border-radius: 16px;
    background: var(--primary-color);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
    opacity: 0.9;
}

.send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

/* Visualizer Bars —— 镜像对称式：中间高两边低，三色渐变，铺满整行 */
.visualizer-container {
    height: 80px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;  /* 两端贴边、整体铺满 */
    gap: 2px;
    padding: 0 24px 22px;
    opacity: 0.95;
}

.v-bar {
    flex: 1;
    min-width: 2px;
    max-width: 4px;  /* 细条更精致 */
    min-height: 3px;
    /* 三色渐变 + 顶部高光：深红→亮红→暖白 */
    background:
        linear-gradient(to top,
            #8a0a0a 0%,
            #c20c0c 30%,
            #ff4d4d 70%,
            #ffe5e5 100%);
    border-radius: 2px 2px 0 0;
    /* 移除 transition/box-shadow：80 根 bar 每帧更新时这两个属性会触发大量合成与重绘开销 */
    /* 顶部内高光改用渐变本身表达，无需 box-shadow */
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
      width: min(320px, 80vw);
      height: auto;
      aspect-ratio: 1/1;
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
      gap: 2px;
      padding: 0 12px 12px;
  }
  .v-bar {
      max-width: 4px;
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

/* QQ 新建歌单按钮 */
.create-playlist-row {
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--primary-color, #31C27C);
    font-size: 14px;
    border-bottom: 1px solid #f0f0f0;
}
.create-playlist-row:hover { background: #f9f9f9; }

.empty-tip {
    padding: 30px 20px;
    text-align: center;
    color: #999;
    font-size: 13px;
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
