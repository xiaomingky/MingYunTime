<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { SkipBack, SkipForward, Play, Pause, X, Music, Lock, Unlock } from 'lucide-vue-next'

const currentLyric = ref('茗韵时光')
const currentTlyric = ref('')
const nextLyric = ref('')
const nextTlyric = ref('')
const prevLyric = ref('')
const songName = ref('')
const artist = ref('')
const picUrl = ref('')
const isPlaying = ref(false)
const currentFont = ref('')
const currentColor = ref('#ec4141')
const isLocked = ref(false)

// 逐词歌词高频动画插值所用的状态
const currentWords = ref(null)
const currentMs = ref(0)
let lastFrameTime = performance.now()
let animFrameId = null

// Marquee 滚动状态（JS驱动）
let marqueeState = { active: false, amount: 0, duration: 0, startTime: 0 }
let lastLyricKey = ''
let marqueeCheckTimer = null
let needMarqueeCheck = false

// 歌词切换动画状态
const lyricTransition = ref(false)
const lyricKeyCounter = ref(0)

const getBridge = () => {
  return window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer || window.electron
}

let removeListener = null

const registerFonts = async () => {
    const b = getBridge()
    if (b && b.invoke) {
        const fonts = await b.invoke('scan-fonts')
        fonts.forEach(async (f) => {
            const safeUrl = f.url.split('://')[0] + '://' + encodeURI(f.url.split('://')[1])
            try {
                const font = new FontFace(f.name, `url("${safeUrl}")`)
                await font.load()
                document.fonts.add(font)
            } catch (e) {
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

// 60fps 主循环：逐字高亮 + marquee滚动
const updateYrcProgress = () => {
    const now = performance.now()
    const delta = now - lastFrameTime
    lastFrameTime = now
    
    if (isPlaying.value && currentWords.value && currentWords.value.length > 0) {
        currentMs.value += delta
        
        const wordSpans = document.querySelectorAll('.yrc-word')
        wordSpans.forEach(el => {
            const ws = parseFloat(el.dataset.ws)
            const wd = parseFloat(el.dataset.wd)
            if (!isNaN(ws) && !isNaN(wd)) {
                let progress = 0
                if (currentMs.value >= ws + wd) {
                    progress = 1
                } else if (currentMs.value > ws && wd > 0) {
                    progress = (currentMs.value - ws) / wd
                }
                el.style.setProperty('--wp', progress)
            }
        })
    } else {
        lastFrameTime = now
    }
    
    // JS驱动的marquee滚动（与逐词进度同步）
    if (marqueeState.active && marqueeWrapRef.value) {
        const wrap = marqueeWrapRef.value
        const elapsed = (now - marqueeState.startTime) % (marqueeState.duration * 1000)
        const phase = elapsed / (marqueeState.duration * 1000)
        
        let t = 0
        if (phase > 0.12 && phase < 0.88) {
            t = (phase - 0.12) / 0.76
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        } else if (phase >= 0.88) {
            t = 1
        }
        
        wrap.style.transform = `translateX(${t * marqueeState.amount}px)`
    }
    
    animFrameId = requestAnimationFrame(updateYrcProgress)
}

const handleStateChange = (_, data) => {
    if (!data) return
    
    const lyricChanged = data.lyric !== currentLyric.value || 
        (data.words && JSON.stringify(data.words) !== JSON.stringify(currentWords.value))
    
    prevLyric.value = data.prevLyric || ''
    currentLyric.value = data.lyric !== undefined && data.lyric !== null ? data.lyric : (data.songName ? '' : '茗韵时光')
    currentTlyric.value = data.tlyric || ''
    nextLyric.value = data.nextLyric || ''
    nextTlyric.value = data.nextTlyric || ''
    isPlaying.value = !!data.isPlaying
    songName.value = data.songName || ''
    artist.value = data.artist || ''
    picUrl.value = data.picUrl || ''
    currentFont.value = data.font || ''
    currentColor.value = data.color && data.color !== '#00E5FF' ? data.color : '#ec4141'
    
    if (data.words && Array.isArray(data.words) && data.words.length > 0) {
        currentWords.value = data.words
        currentMs.value = data.currentMs || 0
        lastFrameTime = performance.now()
    } else {
        currentWords.value = null
    }
    
    // 歌词变化时触发切换动画 + 标记需要重新检测滚动
    if (lyricChanged) {
        lyricKeyCounter.value++
        needMarqueeCheck = true
        lastLyricKey = ''
        setTimeout(() => {
            lyricTransition.value = true
        }, 20)
    }
}

const currentLyricRef = ref(null)
const marqueeWrapRef = ref(null)

const checkMarquee = () => {
    if (marqueeCheckTimer) clearTimeout(marqueeCheckTimer)
    
    marqueeCheckTimer = setTimeout(() => {
        needMarqueeCheck = false
        const wrap = marqueeWrapRef.value
        if (!wrap) return
        
        const lyricKey = currentWords.value 
            ? currentWords.value.map(w => w.text).join('') 
            : currentLyric.value
        
        if (lyricKey === lastLyricKey) return
        lastLyricKey = lyricKey
        
        const contentWidth = wrap.scrollWidth
        const containerWidth = wrap.parentElement ? wrap.parentElement.clientWidth : 700
        
        if (contentWidth > containerWidth + 5 && contentWidth > 50) {
            const scrollAmount = -(contentWidth - containerWidth + 16)
            const duration = Math.max(5, Math.min(14, Math.abs(scrollAmount) / 22))
            
            marqueeState.active = true
            marqueeState.amount = scrollAmount
            marqueeState.duration = duration
            marqueeState.startTime = performance.now()
        } else {
            marqueeState.active = false
            wrap.style.transform = ''
        }
    }, 200)
}

watch([currentLyric, currentWords], () => {
    if (needMarqueeCheck) {
        checkMarquee()
    }
}, { deep: true, flush: 'post' })

// 鼠标追踪：精确检测是否在可交互区域上 → 控制穿透
let ignoreMouseTimer = null
const onMouseMove = (e) => {
    if (ignoreMouseTimer) return
    ignoreMouseTimer = requestAnimationFrame(() => {
        ignoreMouseTimer = null
        const el = document.elementFromPoint(e.clientX, e.clientY)
        let interactive = false
        if (isLocked.value) {
            interactive = !!el?.closest('.floating-actions')
        } else {
            interactive = !!el?.closest('.widget-card, .floating-actions')
        }
        const b = getBridge()
        if (b?.send) b.send('lyric-card-hover', interactive)
    })
}

onMounted(() => {
    registerFonts()
    const b = getBridge()
    if (b && b.on) {
        removeListener = b.on('lyric-state-change', handleStateChange)
        b.on('lyric-lock-state-changed', (_, locked) => {
            isLocked.value = locked
        })
    }
    if (b && b.send) {
        b.send('request-lyric-state')
    }
    // 全局 mousemove 追踪穿透状态
    document.addEventListener('mousemove', onMouseMove)
    // 开启高亮插值轮询
    lastFrameTime = performance.now()
    animFrameId = requestAnimationFrame(updateYrcProgress)
    
    // 首次加载触发淡入动画 + 滚动检测
    setTimeout(() => {
        lyricTransition.value = true
        needMarqueeCheck = true
        checkMarquee()
    }, 400)
})

onUnmounted(() => {
    if (removeListener) removeListener()
    if (animFrameId) cancelAnimationFrame(animFrameId)
    document.removeEventListener('mousemove', onMouseMove)
})

const sendCommand = (cmd) => {
    const b = getBridge()
    if (b && b.send) {
        b.send('lyric-window-command', cmd)
    }
}

const toggleLock = () => {
    isLocked.value = !isLocked.value
    const b = getBridge()
    if (b && b.send) {
        b.send('lyric-window-lock', { locked: isLocked.value })
    }
}

const close = () => {
    const b = getBridge()
    if (b && b.send) {
        b.send('toggle-desktop-lyrics', false)
    }
}
</script>

<template>
  <div class="desktop-lyric-container" :class="{ locked: isLocked }">
    <div class="widget-card" :class="{ 'card-locked': isLocked }">
      <!-- 拖拽层：未锁定时可拖动整个卡片区域 -->
      <div class="drag-overlay" :class="{ 'no-drag': isLocked }"></div>
      
      <!-- 左侧：封面与控制器 -->
      <div class="left-panel no-drag">
        <div class="cover-wrapper" :class="{ playing: isPlaying }">
          <img v-if="picUrl" :src="picUrl" class="cover-img" />
          <div v-else class="cover-fallback">
            <Music :size="32" class="music-icon" />
          </div>
        </div>
        
        <div class="compact-controls">
          <button class="icon-btn" @click="sendCommand('prev')" title="上一首">
            <SkipBack :size="14" fill="currentColor" />
          </button>
          <button class="play-btn-circle" @click="sendCommand('togglePlay')" :title="isPlaying ? '暂停' : '播放'">
            <Play v-if="!isPlaying" :size="12" fill="currentColor" style="margin-left: 1px;" />
            <Pause v-else :size="12" fill="currentColor" />
          </button>
          <button class="icon-btn" @click="sendCommand('next')" title="下一首">
            <SkipForward :size="14" fill="currentColor" />
          </button>
        </div>
      </div>

      <!-- 右侧：歌曲信息与歌词 -->
      <div class="right-panel">
        <div class="song-header">
          <span class="song-title" :title="songName">{{ songName || '茗韵时光' }}</span>
          <span class="song-artist" :title="artist">{{ artist || '享受音乐' }}</span>
        </div>

        <div class="lyric-content-area" :style="{ fontFamily: currentFont ? `'${currentFont}', sans-serif` : '' }">
          <div class="lyric-line-current" :class="{ 'lyric-fade-in': lyricTransition }" :key="lyricKeyCounter">
            <div class="marquee-scroll-wrap" ref="marqueeWrapRef">
              <div 
                v-if="currentWords && currentWords.length > 0" 
                ref="currentLyricRef"
                class="lyric-text-current yrc-text" 
                :style="{ color: currentColor }"
              >
                <span 
                    v-for="(word, wi) in currentWords" 
                    :key="wi"
                    class="yrc-word"
                    :data-ws="word.startTime"
                    :data-wd="word.duration"
                    style="--wp: 0"
                >{{ word.text }}</span>
              </div>
              <span 
                v-else 
                ref="currentLyricRef"
                class="lyric-text-current" 
                :style="{ color: currentColor }"
              >{{ currentLyric }}</span>
            </div>
            
            <span v-if="currentTlyric" class="lyric-trans-current" :style="{ color: currentColor }">{{ currentTlyric }}</span>
          </div>
          <div class="lyric-line-next" v-if="nextLyric">
            <span class="lyric-text-next">{{ nextLyric }}</span>
          </div>
        </div>
      </div>

      <!-- 右上角控制按钮：始终可见，锁定/解锁在同一位置 -->
      <div class="floating-actions no-drag always-clickable">
        <template v-if="!isLocked">
          <button class="action-btn-mini lock-btn" @click="toggleLock" title="锁定桌面歌词">
            <Lock :size="13" />
          </button>
          <button class="action-btn-mini close-btn" @click="close" title="关闭">
            <X :size="13" />
          </button>
        </template>
        <button v-else class="action-btn-mini unlock-btn-inline" @click="toggleLock" title="点击解锁">
          <Unlock :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(body), :deep(html), .desktop-lyric-container {
  background-color: transparent !important;
  background: transparent !important;
}

.desktop-lyric-container {
  width: 100vw;
  height: 100vh;
  position: relative;
  user-select: none;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 拖拽底层 - 仅未锁定时生效 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -webkit-app-region: drag;
  z-index: 1;
}

.drag-overlay.no-drag {
  -webkit-app-region: no-drag;
  pointer-events: none;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.widget-card {
  position: relative;
  z-index: 10;
  width: 860px;
  height: 176px;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 24px;
  padding: 18px 24px;
  box-sizing: border-box;
  box-shadow: 
    0 16px 40px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.widget-card.card-locked {
  background: rgba(255, 255, 255, 0.88) !important;
  backdrop-filter: blur(24px) saturate(200%) brightness(1.02) !important;
  -webkit-backdrop-filter: blur(24px) saturate(200%) brightness(1.02) !important;
  border-color: rgba(236, 65, 65, 0.12) !important;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(236, 65, 65, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
}

.left-panel {
  width: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  margin-right: 24px;
  z-index: 2;
}

.cover-wrapper {
  position: relative;
  width: 90px;
  height: 90px;
  border-radius: 18px;
  overflow: hidden;
  background: #f5f5f5;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.05);
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.cover-wrapper.playing {
  box-shadow: 0 8px 20px rgba(236, 65, 65, 0.25);
  transform: scale(1.03);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.cover-wrapper:hover .cover-img {
  transform: scale(1.1);
}

.cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ec4141;
  background: linear-gradient(135deg, #fff 0%, #f5f5f5 100%);
}

.music-icon {
  animation: pulse-icon 2s infinite ease-in-out;
}

@keyframes pulse-icon {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.08); opacity: 0.8; }
}

.compact-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #555555;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  border-radius: 50%;
}

.icon-btn:hover {
  color: #ec4141;
  transform: scale(1.15);
}

.play-btn-circle {
  width: 26px;
  height: 26px;
  background: #ec4141;
  border: none;
  border-radius: 50%;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.3);
}

.play-btn-circle:hover {
  background: #d32f2f;
  transform: scale(1.12);
  box-shadow: 0 4px 12px rgba(236, 65, 65, 0.4);
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  min-width: 0;
  z-index: 2;
  padding: 4px 0;
}

.song-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  padding-bottom: 6px;
  transition: all 0.3s ease;
}

.card-locked .song-header {
  border-bottom-color: rgba(236, 65, 65, 0.08);
}

.song-title {
  font-size: 16px;
  font-weight: 700;
  color: #333333;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.card-locked .song-title {
  color: #1a1a1a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.song-artist {
  font-size: 12px;
  color: #666666;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-locked .song-artist {
  color: #777777;
  text-shadow: none;
}

.lyric-content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
}

.lyric-line-current {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}

/* 歌词切换动画：淡入 + 微上滑 */
.lyric-line-current.lyric-fade-in {
  animation: lyric-slide-in 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

@keyframes lyric-slide-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 独立滚动容器：与歌词内容分离，避免transform冲突 */
.marquee-scroll-wrap {
  display: inline-block;
  max-width: 100%;
  overflow: visible;
}

.lyric-text-current {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.25;
  white-space: nowrap;
  display: inline-block;
  width: max-content;
  max-width: none;
  transition: color 0.3s ease;
  color: #111111;
  text-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.card-locked .lyric-text-current {
  color: #ec4141;
  text-shadow: 0 1px 3px rgba(236, 65, 65, 0.15);
}

.lyric-trans-current {
  font-size: 15px;
  font-weight: 400;
  opacity: 0.85;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #555555;
  text-shadow: 0 1px 1px rgba(0,0,0,0.05);
}

.card-locked .lyric-trans-current {
  color: #999999;
  text-shadow: none;
}

.yrc-text {
  display: inline-block !important;
  white-space: nowrap !important;
}

.yrc-word {
  display: inline-block;
  white-space: pre;
  background: linear-gradient(to right, currentColor calc(var(--wp, 0) * 100%), rgba(0, 0, 0, 0.32) calc(var(--wp, 0) * 100%));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  transition: background 0.05s linear;
}

.card-locked .yrc-word {
  background: linear-gradient(to right, #ec4141 calc(var(--wp, 0) * 100%), #cccccc calc(var(--wp, 0) * 100%));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.lyric-line-next {
  min-width: 0;
  margin-top: 2px;
}

.lyric-text-next {
  font-size: 14px;
  font-weight: 400;
  color: #888888;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.3s ease;
}

.card-locked .lyric-text-next {
  color: #aaaaaa;
  text-shadow: none;
}

/* 右上角控制按钮 - 始终可见 */
.floating-actions {
  position: absolute;
  top: 14px;
  right: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 100;
}

/* 关键：锁定状态下此区域仍可点击 */
.always-clickable {
  pointer-events: auto !important;
}

.action-btn-mini {
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  color: #555555;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.card-locked .action-btn-mini {
  background: rgba(236, 65, 65, 0.08);
  border-color: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.action-btn-mini:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #111;
  transform: scale(1.08);
}

.card-locked .action-btn-mini:hover {
  background: rgba(236, 65, 65, 0.18);
  color: #d32f2f;
}

.lock-btn:hover {
  color: #ec4141 !important;
  background: rgba(236, 65, 65, 0.1) !important;
  border-color: rgba(236, 65, 65, 0.15) !important;
}

.close-btn:hover {
  color: #ff4d4d !important;
  background: rgba(255, 77, 77, 0.1) !important;
  border-color: rgba(255, 77, 77, 0.15) !important;
}

.unlock-btn-inline:hover {
  color: #ec4141 !important;
  background: rgba(236, 65, 65, 0.15) !important;
  border-color: rgba(236, 65, 65, 0.2) !important;
}
</style>
