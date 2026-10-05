<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { AppleLyricPlayer } from '../utils/apple-lyric-player'
import '@applemusic-like-lyrics/core/style.css'
import { Settings, X, Heart, Plus, Download, Share2, MessageSquare, Film, RefreshCw, ArrowUpToLine } from 'lucide-vue-next'
import { usePlayerStore } from '../store/player'
import { useSongDetailStore } from '../store/song-detail'
import { toAppleLyrics } from '../utils/apple-lyrics'
import AppleCoverArt from './AppleCoverArt.vue'
import AppleAudioVisualizer from './AppleAudioVisualizer.vue'
import CustomSelect from './CustomSelect.vue'

const props = defineProps({
  source: String, qqSong: Boolean, isNonNetease: Boolean, commentsOpen: Boolean
})
const emit = defineEmits(['playlist', 'download', 'share', 'comment', 'album', 'source', 'local-mv', 'online-mv'])
const player = usePlayerStore()
const preferences = useSongDetailStore()
const settingsOpen = ref(false)
const renderer = ref(null)
const background = ref(null)
const visible = ref(!document.hidden)
const reducedMotion = ref(false)
const manuallyScrolled = ref(false)
const coverFailed = ref(false)
const cover = computed(() => player.currentSong.al?.picUrl || '')
const hasWords = computed(() => !!player.yrcLyrics?.length)
const running = computed(() => visible.value && player.showSongDetail && !props.commentsOpen)
const visualizerActive = computed(() => running.value && player.isPlaying && !reducedMotion.value)
const coverOptions = [
  { value: 'album', label: '专辑封面' }, { value: 'cd', label: 'CD 光碟' },
  { value: 'vinyl', label: '黑胶唱片' }, { value: 'sleeve', label: '唱片套' }
]
const fontOptions = [{ value: 'system', label: '系统无衬线' }, { value: 'serif', label: '宋体' }]
const fpsOptions = [{ value: 45, label: '均衡 · 45 FPS' }, { value: 30, label: '节能 · 30 FPS' }]
const lines = computed(() => toAppleLyrics({
  lyrics: player.lyrics, yrcLyrics: player.yrcLyrics, duration: player.currentSong.duration,
  mode: preferences.mode, translation: preferences.translation
}))
const typography = computed(() => ({
  '--apple-lyric-size': `${preferences.fontSize}px`,
  '--apple-translation-size': `${preferences.translationSize}px`,
  // Store half the requested gap so the CSS remains compatible with older Chromium
  // versions that do not support division inside calc().
  '--apple-line-spacing': `${preferences.lineSpacing / 2}px`,
  '--apple-lyric-font': preferences.font === 'serif' ? '"Noto Serif SC", "Songti SC", serif' : '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'
}))
let clockFrame = null
let media
let engine
let lastFrame = 0
let nextFrameTime = 0
let lastTime = -1
let settleUntil = 0
let followTimer = null
let backgroundRequest = 0

function sampleTime(force = false) {
  const time = Math.round((player.audio?.currentTime ?? player.currentTime) * 1000)
  if (!engine || (!force && time === lastTime)) return
  const seeking = force || lastTime < 0 || time < lastTime || Math.abs(time - lastTime) > 1000
  engine.setCurrentTime(time, seeking)
  lastTime = time
}
function stopClock() {
  if (clockFrame !== null) cancelAnimationFrame(clockFrame)
  clockFrame = null
}
function tick(time) {
  clockFrame = null
  if (!running.value || !engine) return
  const interval = 1000 / (preferences.performanceMode ? preferences.lyricFPS : 60)
  if (!lastFrame || time + .5 >= nextFrameTime) {
    sampleTime()
    engine.update(lastFrame ? Math.min(100, time - lastFrame) : 0)
    const overdue = nextFrameTime ? Math.max(0, time - nextFrameTime) % interval : 0
    nextFrameTime = time + interval - overdue
    lastFrame = time
  }
  if (player.isPlaying || time < settleUntil) clockFrame = requestAnimationFrame(tick)
}
function wake() {
  if (!running.value || !engine) return
  settleUntil = performance.now() + 1600
  if (clockFrame === null) { lastFrame = 0; nextFrameTime = 0; clockFrame = requestAnimationFrame(tick) }
}
watch([running, () => player.isPlaying], ([active, playing]) => {
  stopClock()
  if (!engine) return
  if (active && playing) engine.resume()
  else engine.pause()
  if (active) { sampleTime(true); wake() }
})
watch(() => player.currentTime, () => { if (clockFrame === null) { sampleTime(); wake() } })
watch(cover, () => { coverFailed.value = false })
watch(lines, loadLyrics)
watch([reducedMotion, () => preferences.blur], configureEngine)
watch([() => preferences.performanceMode, () => preferences.nearbyLyrics, () => preferences.lyricFPS], configureEngine)
watch([() => preferences.fontSize, () => preferences.font, () => preferences.translationSize, () => preferences.lineSpacing], async () => {
  await nextTick()
  engine?.calcLayout(true)
  wake()
})
watch(cover, paintBackground)

function configureEngine() {
  if (!engine) return
  const wasLimited = engine.performanceMode
  engine.performanceMode = preferences.performanceMode
  engine.nearbyOnly = preferences.nearbyLyrics
  engine.setOverscanPx(preferences.nearbyLyrics ? 0 : 300)
  if (wasLimited && !preferences.performanceMode && player.isPlaying && running.value) engine.resume()
  engine.setEnableSpring(!reducedMotion.value)
  engine.setEnableScale(!reducedMotion.value)
  engine.setEnableBlur(preferences.blur && !reducedMotion.value)
  engine.setAlignPosition(.46)
  engine.setWordFadeWidth(.65)
  engine.setLinePosYSpringParams({ mass: 1, stiffness: 110, damping: 22 })
  wake()
}
function loadLyrics() {
  if (!engine) return
  clearTimeout(followTimer)
  manuallyScrolled.value = false
  engine.setLyricLines(lines.value)
  sampleTime(true)
  wake()
}
function paintBackground() {
  const canvas = background.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  const request = ++backgroundRequest
  context.fillStyle = '#252a28'
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (!cover.value) return
  const image = new Image()
  image.onload = () => {
    if (request !== backgroundRequest) return
    // Rasterize the blur once on a tiny canvas instead of filtering a full window every frame.
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    context.filter = 'blur(8px) saturate(1.25)'
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, -16, -16, 128, 128)
    context.filter = 'none'
  }
  image.src = cover.value
}
function manualScroll() {
  manuallyScrolled.value = true
  clearTimeout(followTimer)
  followTimer = setTimeout(followCurrentLine, 4000)
  wake()
}

function followCurrentLine() {
  clearTimeout(followTimer)
  engine?.resetScroll()
  sampleTime(true)
  engine?.calcLayout()
  manuallyScrolled.value = false
  wake()
}
function seekLine(event) {
  const line = lines.value[event.lineIndex]
  if (!line) return
  player.seek(line.startTime / 1000)
  followCurrentLine()
}
function visibilityChange() { visible.value = !document.hidden }
function motionChange() { reducedMotion.value = media.matches }
function outsideClick(event) {
  if (!event.target.closest('.apple-settings, .apple-select-menu')) settingsOpen.value = false
}
function escapeSettings(event) {
  if (event.key === 'Escape' && settingsOpen.value) { settingsOpen.value = false; event.stopPropagation() }
}
function selectClassic() { settingsOpen.value = false; preferences.style = 'classic' }
onMounted(() => {
  media = matchMedia('(prefers-reduced-motion: reduce)')
  motionChange()
  // Keep the imperative animation engine outside Vue's deep reactive graph.
  engine = new AppleLyricPlayer()
  renderer.value.appendChild(engine.getElement())
  engine.addEventListener('line-click', seekLine)
  engine.getElement().addEventListener('wheel', manualScroll, { passive: true })
  engine.getElement().addEventListener('touchmove', manualScroll, { passive: true })
  configureEngine()
  loadLyrics()
  if (player.isPlaying && running.value) engine.resume()
  else engine.pause()
  paintBackground()
  media.addEventListener('change', motionChange)
  document.addEventListener('visibilitychange', visibilityChange)
  document.addEventListener('pointerdown', outsideClick)
  document.addEventListener('keydown', escapeSettings, true)
})
onUnmounted(() => {
  stopClock()
  clearTimeout(followTimer)
  backgroundRequest++
  engine?.removeEventListener('line-click', seekLine)
  engine?.getElement().removeEventListener('wheel', manualScroll)
  engine?.getElement().removeEventListener('touchmove', manualScroll)
  engine?.dispose()
  engine = null
  media?.removeEventListener('change', motionChange)
  document.removeEventListener('visibilitychange', visibilityChange)
  document.removeEventListener('pointerdown', outsideClick)
  document.removeEventListener('keydown', escapeSettings, true)
})
</script>

<template>
  <div class="apple-detail" :style="typography">
    <Teleport to=".song-detail-overlay"><div class="apple-background" aria-hidden="true">
      <canvas ref="background" width="96" height="96" class="apple-background-image"></canvas>
      <div class="apple-background-shade"></div>
    </div></Teleport>
    <section class="apple-album">
      <div class="apple-cover">
        <AppleCoverArt class="apple-cover-artwork" :cover="coverFailed ? '' : cover" :title="player.currentSong.name" :variant="preferences.coverStyle" :playing="player.isPlaying" :animate="running && preferences.coverMotion && !reducedMotion" @error="coverFailed = true" />
      </div>
      <div class="apple-song-heading">
        <div class="apple-title-row">
          <h1>{{ player.currentSong.name }}</h1>
          <button class="apple-icon apple-like" :class="{ liked: player.isLiked }" :aria-pressed="player.isLiked" title="喜欢" aria-label="喜欢" @click="player.toggleLike()"><Heart :size="25" :fill="player.isLiked ? 'currentColor' : 'none'" /></button>
        </div>
        <p class="apple-artist">{{ player.currentSong.artist }}</p>
        <div class="apple-song-tools">
        <div class="apple-song-meta">
        <button class="apple-album-name" @click="emit('album')">{{ player.currentSong.al?.name }}</button>
        <div class="apple-actions">
          <button v-if="!qqSong" class="apple-icon" title="收藏到歌单" aria-label="收藏到歌单" @click="emit('playlist')"><Plus :size="22" /></button>
          <button class="apple-icon" title="下载" aria-label="下载" @click="emit('download')"><Download :size="21" /></button>
          <button v-if="!isNonNetease" class="apple-icon" title="分享" aria-label="分享" @click="emit('share')"><Share2 :size="21" /></button>
          <button class="apple-icon" :aria-pressed="commentsOpen" title="评论" aria-label="评论" @click="emit('comment')"><MessageSquare :size="21" /></button>
        </div>
        </div>
        <div v-if="preferences.visualizer" class="apple-spectrum-region" aria-label="音频频谱"><AppleAudioVisualizer :active="visualizerActive" /></div>
        </div>
      </div>
    </section>
    <section v-show="!commentsOpen" class="apple-lyrics" aria-label="歌曲歌词">
      <div ref="renderer" v-show="lines.length" class="apple-lyric-engine"></div>
      <div v-if="!lines.length" class="apple-no-lyrics">纯音乐，请欣赏</div>
      <button v-if="manuallyScrolled && lines.length" class="apple-follow" @click="followCurrentLine"><ArrowUpToLine :size="16" />回到当前句</button>
    </section>
    <div class="apple-settings no-drag">
      <button class="apple-icon apple-settings-trigger" title="歌词设置" aria-label="歌词设置" :aria-expanded="settingsOpen" aria-controls="apple-detail-settings" @click="settingsOpen = !settingsOpen"><Settings :size="21" /></button>
      <Transition name="apple-settings-fade">
        <section v-if="settingsOpen" id="apple-detail-settings" class="apple-settings-panel" aria-label="歌词设置">
          <div class="apple-settings-heading"><strong>歌词设置</strong><button class="apple-icon" title="关闭设置" aria-label="关闭设置" @click="settingsOpen = false"><X :size="18" /></button></div>
          <div class="apple-setting-row"><span>页面风格</span><div class="apple-segment" role="group" aria-label="页面风格"><button @click="selectClassic">经典</button><button class="selected" aria-pressed="true">Apple Music</button></div></div>
          <div class="apple-setting-row"><span>封面样式</span><CustomSelect v-model="preferences.coverStyle" :options="coverOptions" apple label="封面样式" /></div>
          <label class="apple-setting-row"><span>唱片旋转</span><input v-model="preferences.coverMotion" type="checkbox" /></label>
          <div class="apple-setting-row"><span>歌词模式</span><div class="apple-segment" role="group" aria-label="歌词模式"><button :class="{ selected: preferences.mode === 'word' }" :disabled="!hasWords" :aria-pressed="preferences.mode === 'word'" @click="preferences.mode = 'word'">逐词</button><button :class="{ selected: preferences.mode === 'line' }" :aria-pressed="preferences.mode === 'line'" @click="preferences.mode = 'line'">逐行</button></div></div>
          <label class="apple-setting-row"><span>性能模式</span><input v-model="preferences.performanceMode" type="checkbox" /></label>
          <div class="apple-setting-row"><span>动画帧率</span><CustomSelect v-model="preferences.lyricFPS" :options="fpsOptions" :disabled="!preferences.performanceMode" apple label="动画帧率" /></div>
          <label class="apple-setting-row"><span>仅更新附近歌词</span><input v-model="preferences.nearbyLyrics" type="checkbox" /></label>
          <label class="apple-setting-row"><span>音频可视化</span><input v-model="preferences.visualizer" type="checkbox" /></label>
          <div class="apple-setting-row"><span>歌词来源</span><button class="apple-setting-command" @click="emit('source')"><RefreshCw :size="15" />{{ source }}</button></div>
          <div class="apple-setting-row"><span>MV</span><div class="apple-mv-commands"><button class="apple-setting-command" @click="emit('local-mv')"><Film :size="15" />本地</button><button class="apple-setting-command" @click="emit('online-mv')"><Film :size="15" />线上</button></div></div>
          <label class="apple-setting-row"><span>翻译</span><input v-model="preferences.translation" type="checkbox" aria-label="显示翻译" /></label>
          <label class="apple-setting-row"><span>翻译字号</span><div class="apple-size-control"><input v-model.number="preferences.translationSize" type="range" min="12" max="30" step="1" :disabled="!preferences.translation" /><output>{{ preferences.translationSize }} px</output></div></label>
          <label class="apple-setting-row"><span>歌词间距</span><div class="apple-size-control"><input v-model.number="preferences.lineSpacing" type="range" min="0" max="24" step="2" /><output>{{ preferences.lineSpacing }} px</output></div></label>
          <label class="apple-setting-row"><span>远处歌词模糊</span><input v-model="preferences.blur" type="checkbox" /></label>
          <label class="apple-setting-row"><span>字号</span><div class="apple-size-control"><input v-model.number="preferences.fontSize" type="range" min="24" max="64" step="2" /><output>{{ preferences.fontSize }}</output></div></label>
          <div class="apple-setting-row"><span>字体</span><CustomSelect v-model="preferences.font" :options="fontOptions" apple label="字体" /></div>
        </section>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.apple-detail { display: contents; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
.apple-background { position: absolute; inset: 0; z-index: 0; background: #252a28; pointer-events: none; overflow: hidden; }
.apple-background-image { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .72; }
.apple-background-shade { position: absolute; inset: 0; background: rgba(9, 12, 11, .42); }
.apple-album { grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; width: 100%; max-width: 440px; max-height: 100%; box-sizing: border-box; overflow: hidden; justify-self: center; display: flex; flex-direction: column; gap: 28px; padding: 16px 0; }
.apple-cover { width: min(100%, max(100px, calc(100vh - var(--footer-height) - 310px))); aspect-ratio: 1; flex-shrink: 0; }
.apple-cover { position: relative; display: grid; place-items: center; box-sizing: border-box; }
.apple-cover-artwork { width: 100%; height: 100%; min-height: 0; }
.apple-cover-artwork.cover-cd, .apple-cover-artwork.cover-vinyl { overflow: hidden; border-radius: 50%; }
.apple-song-heading { min-width: 0; }
.apple-song-tools { display: flex; align-items: flex-end; gap: 18px; min-width: 0; }
.apple-song-meta { flex: 0 1 auto; min-width: 0; max-width: 60%; }
.apple-song-meta .apple-album-name { max-width: 100%; }
.apple-spectrum-region { flex: 1 1 0; min-width: 0; height: 84px; opacity: .78; }
.apple-title-row { display: flex; align-items: center; gap: 12px; }
.apple-title-row h1 { font-size: 28px; line-height: 1.2; font-weight: 750; margin: 0; overflow-wrap: anywhere; flex: 1; min-width: 0; }
.apple-artist { margin: 10px 0 5px; color: #ffffffb3; font-size: 19px; overflow-wrap: anywhere; }
.apple-album-name { background: transparent; border: 0; padding: 0; color: #ffffff80; text-align: left; font: inherit; font-size: 13px; cursor: pointer; overflow-wrap: anywhere; }
.apple-actions { display: flex; gap: 13px; margin-top: 18px; }
.apple-icon { flex-shrink: 0; width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; transition: background .18s, transform .18s; -webkit-app-region: no-drag; }
.apple-icon:hover { background: #ffffff14; }
.apple-icon:active { transform: scale(.91); }
.apple-icon:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.apple-like.liked { color: #ff6b82; }
.apple-lyrics { position: relative; grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; align-self: stretch; }
.apple-lyric-engine { height: 100%; width: 100%; min-width: 0; font-family: var(--apple-lyric-font); font-weight: 750; --amll-lp-font-size: var(--apple-lyric-size); --amll-lp-color: #fff; }
.apple-lyric-engine :deep(.amll-lyric-player) { contain: strict; }
.apple-lyric-engine :deep(.amll-lyric-player) { mix-blend-mode: normal; --amll-lp-line-width-aspect: 1; --amll-lp-line-padding-x: .2em; }
.apple-lyric-engine :deep(.FmKaba_lyricLine) { box-sizing: border-box; padding: calc(.5em + var(--apple-line-spacing)) .2em; cursor: pointer; }
.apple-lyric-engine :deep(.FmKaba_lyricMainLine), .apple-lyric-engine :deep(.FmKaba_lyricSubLine) { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
.apple-lyric-engine :deep(.FmKaba_lyricSubLine) { font-size: var(--apple-translation-size); font-weight: 500; margin-top: 10px; line-height: 1.35; }
.apple-no-lyrics { height: 100%; display: grid; place-content: center; font-size: 24px; color: #ffffff99; }
.apple-follow { position: absolute; bottom: 15px; left: 50%; transform: translateX(-50%); border: 1px solid #ffffff26; border-radius: 6px; color: #fff; background: #202623eb; padding: 8px 12px; display: flex; gap: 8px; align-items: center; white-space: nowrap; cursor: pointer; }
.apple-settings { position: fixed; top: 12px; right: 28px; z-index: 5; color: #fff; }
.apple-settings-panel { position: absolute; top: 46px; right: 0; width: 332px; max-width: calc(100vw - 32px); max-height: calc(100vh - var(--footer-height) - 85px); overflow-y: auto; padding: 10px 18px 16px; background: #262b29f5; border: 1px solid #ffffff1c; border-radius: 8px; box-shadow: 0 18px 55px #0004; }
.apple-settings-panel { box-sizing: border-box; }
.apple-settings-panel::-webkit-scrollbar { width: 5px; }
.apple-settings-panel::-webkit-scrollbar-track { background: transparent; }
.apple-settings-panel::-webkit-scrollbar-thumb { background: #ffffff38; border-radius: 4px; }
.apple-settings-heading { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; font-size: 14px; }
.apple-setting-row { display: flex; min-height: 47px; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #ffffff12; font-size: 13px; }
.apple-setting-row > span { flex-shrink: 0; color: #ffffffb3; }
.apple-setting-row input[type=checkbox] { appearance: none; -webkit-appearance: none; flex: 0 0 auto; position: relative; width: 38px; height: 22px; margin: 0; padding: 0; border: 1px solid #ffffff38; border-radius: 999px; background: #ffffff24; cursor: pointer; transition: background .18s, border-color .18s, box-shadow .18s; }
.apple-setting-row input[type=checkbox]::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px #0007; transition: transform .18s ease; }
.apple-setting-row input[type=checkbox]:checked { border-color: #ff6179; background: #ff6179; box-shadow: 0 0 0 3px #ff61791c; }
.apple-setting-row input[type=checkbox]:checked::after { transform: translateX(16px); }
.apple-setting-row input[type=checkbox]:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.apple-segment { display: flex; padding: 3px; background: #ffffff0a; border-radius: 6px; }
.apple-segment button { background: transparent; color: #ffffffa6; padding: 6px 10px; border: 0; border-radius: 4px; cursor: pointer; font: inherit; white-space: nowrap; }
.apple-segment button.selected { background: #ffffff20; color: #fff; }
.apple-segment button:disabled { opacity: .3; cursor: default; }
.apple-mv-commands { display: flex; gap: 12px; }
.apple-setting-command { display: flex; align-items: center; gap: 7px; color: #fff; background: transparent; border: 0; padding: 7px 0; font: inherit; cursor: pointer; }
.apple-size-control { display: flex; align-items: center; gap: 10px; }
.apple-size-control input { width: 135px; accent-color: #ff6179; }
.apple-size-control input:disabled { opacity: .4; cursor: not-allowed; }
.apple-size-control output { width: 42px; flex-shrink: 0; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.apple-settings-fade-enter-active, .apple-settings-fade-leave-active { transition: opacity .2s, transform .2s; }
.apple-settings-fade-enter-from, .apple-settings-fade-leave-to { opacity: 0; transform: translateY(-6px); }
.apple-cover-change-enter-active, .apple-cover-change-leave-active { transition: opacity .3s; }
.apple-background-change-enter-active, .apple-background-change-leave-active { transition: opacity .8s; }
.apple-cover-change-enter-from, .apple-cover-change-leave-to,
.apple-background-change-enter-from, .apple-background-change-leave-to { opacity: 0; }
@media (max-height: 740px) and (min-width: 761px) { .apple-album { max-width: 320px; gap: 18px; } .apple-title-row h1 { font-size: 24px; } .apple-actions { margin-top: 12px; gap: 8px; } .apple-spectrum-region { height: 58px; } }
@media (max-width: 760px) {
  .apple-album { grid-column: 1; grid-row: 1; max-width: none; max-height: none; flex-direction: row; align-items: center; gap: 16px; padding: 0; }
  .apple-cover { width: 100px; flex-shrink: 0; }
  .apple-song-heading { flex: 1; }
  .apple-song-tools { flex-wrap: wrap; gap: 6px; }
  .apple-song-meta { max-width: 100%; }
  .apple-spectrum-region { flex-basis: 100%; height: 24px; }
  .apple-title-row h1 { font-size: 20px; }
  .apple-artist { font-size: 14px; margin-top: 5px; }
  .apple-album-name { display: none; }
  .apple-actions { gap: 6px; margin-top: 5px; }
  .apple-actions .apple-icon { width: 30px; height: 30px; }
  .apple-lyrics { grid-column: 1; grid-row: 2; }
  .apple-lyric-engine { --amll-lp-font-size: min(var(--apple-lyric-size), 34px); }
  .apple-settings { right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .apple-background-image { animation: none; }
  .apple-cover, .apple-icon, .apple-settings-fade-enter-active, .apple-settings-fade-leave-active { transition: none; }
  .apple-cover-change-enter-active, .apple-cover-change-leave-active,
  .apple-background-change-enter-active, .apple-background-change-leave-active { transition: none; }
}
</style>
