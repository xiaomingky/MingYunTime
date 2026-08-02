<script setup>
// B站风格自定义播放器
// 支持 m3u8 (hls.js) 和直链 mp4
// 自定义控制条：进度条(带缓冲+预览) / 音量 / 全屏 / 分辨率 / 快捷键 / 自动隐藏
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import {
    Play, Pause, Volume2, Volume1, VolumeX,
    Maximize, Minimize, Loader2, Film, RefreshCw, SkipBack, SkipForward, Repeat
} from 'lucide-vue-next'

const props = defineProps({
    src: { type: String, default: '' },
    playType: { type: String, default: 'm3u8' }, // m3u8 | direct | flv | live
    // DASH 音视频分离时的音频地址（B站高画质流是纯视频，需同步播放音频）
    audioUrl: { type: String, default: '' },
    badge: { type: String, default: '' },
    autoplay: { type: Boolean, default: true },
    hasPrev: { type: Boolean, default: false },
    hasNext: { type: Boolean, default: false },
    episodes: { type: Array, default: () => [] },
    currentEpisode: { type: Object, default: null }
})
const emit = defineEmits(['ended', 'retry', 'ready', 'error', 'prev', 'next', 'selectEpisode'])

const videoEl = ref(null)
const wrapperEl = ref(null)
const progressBar = ref(null)
const volumeSlider = ref(null)

// 播放状态
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const buffered = ref(0)
const volume = ref(0.8)
const isMuted = ref(false)
// 音量增益倍数（1.0=100% 2.0=200% 3.0=300%），解决直播流声音太小问题
const gainBoost = ref(parseFloat(localStorage.getItem('bili_gain_boost')) || 1.0)
// Web Audio API 增益节点
let audioCtx = null
let gainNode = null
let mediaSource = null
const isFullscreen = ref(false)
const isLooping = ref(false)
const buffering = ref(false)
const loading = ref(false)
const playerError = ref('')

// 控制条
const controlsVisible = ref(true)
let hideControlsTimer = null

// 分辨率
const levels = ref([])
const currentLevel = ref(-1)
const showLevelMenu = ref(false)

// 倍速
const playbackRate = ref(1)
const showSpeedMenu = ref(false)
const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2]

// 选集面板
const showEpPanel = ref(false)

// 进度条 hover 预览
const hoverTime = ref(null)
const hoverPercent = ref(0)

let hls = null
let flvPlayer = null
// DASH 流的独立音频元素（B站高画质流：视频和音频分离）
let dashAudioEl = null

// 是否直播流（无 duration / 实时）
const isLive = computed(() => {
    if (props.playType === 'live') return true
    if (!props.src) return false
    // m3u8 with #EXT-X-PLAYLIST-TYPE:EVENT/VOID 且无 ENDLIST 视为直播
    return false
})

function destroyFlv() {
    if (flvPlayer) {
        try {
            flvPlayer.pause()
            flvPlayer.unload()
            flvPlayer.detachMediaElement()
            flvPlayer.destroy()
        } catch (e) {}
        flvPlayer = null
    }
}

// ===== 计算属性 =====
const playedPercent = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0)
const bufferedPercent = computed(() => duration.value > 0 ? (buffered.value / duration.value) * 100 : 0)
const currentLevelLabel = computed(() => {
    if (currentLevel.value === -1) return '自动'
    const lv = levels.value.find(l => l.index === currentLevel.value)
    return lv ? lv.label : '自动'
})

function formatTime(s) {
    if (!s || !isFinite(s)) return '00:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ===== 控制条自动隐藏 =====
function showControls() {
    controlsVisible.value = true
    if (hideControlsTimer) clearTimeout(hideControlsTimer)
    if (isPlaying.value) {
        hideControlsTimer = setTimeout(() => {
            if (isPlaying.value) controlsVisible.value = false
            showLevelMenu.value = false
            showSpeedMenu.value = false
            showEpPanel.value = false
        }, 2800)
    }
}
function hideControls() {
    if (hideControlsTimer) clearTimeout(hideControlsTimer)
    if (isPlaying.value) controlsVisible.value = false
    showLevelMenu.value = false
    showSpeedMenu.value = false
    showEpPanel.value = false
}

// ===== 播放控制 =====
function togglePlay() {
    const v = videoEl.value
    if (!v) return
    // 首次播放时初始化 GainNode（需 user gesture）
    if (!audioCtx && gainBoost.value > 1.0) initGainNode()
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume()
    if (v.paused) v.play().catch(() => {})
    else v.pause()
}

function onPlay() { isPlaying.value = true; showControls() }
function onPause() { isPlaying.value = false; controlsVisible.value = true }
function onTimeUpdate() {
    const v = videoEl.value
    if (!v) return
    currentTime.value = v.currentTime
}
function onProgress() {
    const v = videoEl.value
    if (!v || v.buffered.length === 0) return
    buffered.value = v.buffered.end(v.buffered.length - 1)
}
function onLoadedMetadata() {
    duration.value = videoEl.value?.duration || 0
    loading.value = false
    emit('ready')
}
function onEnded() { emit('ended') }
function onWaiting() { buffering.value = true }
function onPlaying() { buffering.value = false }
function onVolumeChange() {
    const v = videoEl.value
    if (!v) return
    // 有 GainNode 时 video.volume 固定为 1.0，不从原生 volume 同步（避免覆盖）
    if (!gainNode) volume.value = v.volume
    isMuted.value = v.muted
}

// ===== 指针/触摸辅助 =====
function pointerClient(e) {
    if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0]
    if (e.touches && e.touches.length) return e.touches[0]
    return e
}

function progressRatioFromClientX(clientX) {
    const bar = progressBar.value
    if (!bar || duration.value === 0) return null
    const rect = bar.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

// ===== 进度条交互（支持鼠标+触摸拖动） =====
let isDragging = false
function seek(e) {
    const v = videoEl.value
    if (!v) return
    const ratio = progressRatioFromClientX(pointerClient(e).clientX)
    if (ratio === null) return
    v.currentTime = ratio * duration.value
}
function onProgressHover(e) {
    const ratio = progressRatioFromClientX(pointerClient(e).clientX)
    if (ratio === null) return
    hoverPercent.value = ratio * 100
    hoverTime.value = ratio * duration.value
}
function onProgressMouseDown(e) {
    // 鼠标按下：开始拖动
    isDragging = true
    const v = videoEl.value
    if (v && !v.paused) v.pause()
    seek(e)
    // 拖动期间跟踪鼠标移动（绑定到 window 以便超出进度条也能继续拖动）
    window.addEventListener('mousemove', onProgressDragging)
    window.addEventListener('mouseup', onProgressMouseUp)
    e.preventDefault()
}
function onProgressDragging(e) {
    if (!isDragging) return
    const v = videoEl.value
    const ratio = progressRatioFromClientX(pointerClient(e).clientX)
    if (!v || ratio === null) return
    // 实时更新 currentTime 让用户看到进度条跟随
    v.currentTime = ratio * duration.value
    currentTime.value = ratio * duration.value
    hoverPercent.value = ratio * 100
    hoverTime.value = ratio * duration.value
}
function onProgressMouseUp() {
    if (!isDragging) return
    isDragging = false
    const v = videoEl.value
    // 拖动结束后恢复播放
    if (v) v.play().catch(() => {})
    window.removeEventListener('mousemove', onProgressDragging)
    window.removeEventListener('mouseup', onProgressMouseUp)
}

// 进度条触摸
function onProgressTouchStart(e) {
    isDragging = true
    const v = videoEl.value
    if (v && !v.paused) v.pause()
    seek(e)
    window.addEventListener('touchmove', onProgressTouchMove, { passive: false })
    window.addEventListener('touchend', onProgressTouchEnd)
    window.addEventListener('touchcancel', onProgressTouchEnd)
    e.preventDefault()
    e.stopPropagation()
}
function onProgressTouchMove(e) {
    if (!isDragging) return
    onProgressDragging(e)
    e.preventDefault()
}
function onProgressTouchEnd() {
    if (!isDragging) return
    isDragging = false
    const v = videoEl.value
    if (v) v.play().catch(() => {})
    window.removeEventListener('touchmove', onProgressTouchMove)
    window.removeEventListener('touchend', onProgressTouchEnd)
    window.removeEventListener('touchcancel', onProgressTouchEnd)
}

// ===== 音量 =====
// 初始化 Web Audio API 增益节点（需 user gesture 后调用）
function initGainNode() {
    if (audioCtx) return
    const v = videoEl.value
    if (!v) return
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        audioCtx = new AudioCtx()
        gainNode = audioCtx.createGain()
        mediaSource = audioCtx.createMediaElementSource(v)
        mediaSource.connect(gainNode)
        gainNode.connect(audioCtx.destination)
        // 应用当前音量和增益
        gainNode.gain.value = volume.value * gainBoost.value
    } catch (e) {
        console.error('initGainNode error:', e)
    }
}
// 实际输出音量 = volume * gainBoost（通过 GainNode 控制可超过 1.0）
function onVolumeInput() {
    const v = videoEl.value
    if (!v) return
    if (gainNode) {
        // 通过 GainNode 控制音量（支持增益 >1.0）
        v.volume = 1.0
        v.muted = volume.value === 0
        gainNode.gain.value = isMuted.value ? 0 : volume.value * gainBoost.value
    } else {
        // 未初始化 GainNode 时走原生音量
        v.volume = volume.value
        v.muted = volume.value === 0
    }
}
function toggleMute() {
    const v = videoEl.value
    if (!v) return
    v.muted = !v.muted
}
// 切换增益倍数：100% → 150% → 200% → 300% → 500% → 1000% → 100%
function cycleGainBoost() {
    const steps = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0]
    const idx = steps.findIndex(s => Math.abs(s - gainBoost.value) < 0.01)
    gainBoost.value = steps[(idx + 1) % steps.length] || 1.0
    localStorage.setItem('bili_gain_boost', String(gainBoost.value))
    if (!audioCtx) initGainNode()
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume()
    onVolumeInput()
}
const gainLabel = computed(() => {
    const pct = Math.round(gainBoost.value * 100)
    return pct >= 1000 ? '1000%' : pct + '%'
})

function setVolumeFromClientX(clientX) {
    const bar = volumeSlider.value
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    volume.value = ratio
    onVolumeInput()
}
function onVolumeTouchStart(e) {
    setVolumeFromClientX(pointerClient(e).clientX)
    window.addEventListener('touchmove', onVolumeTouchMove, { passive: false })
    window.addEventListener('touchend', onVolumeTouchEnd)
    window.addEventListener('touchcancel', onVolumeTouchEnd)
    e.preventDefault()
    e.stopPropagation()
}
function onVolumeTouchMove(e) {
    setVolumeFromClientX(pointerClient(e).clientX)
    e.preventDefault()
}
function onVolumeTouchEnd() {
    window.removeEventListener('touchmove', onVolumeTouchMove)
    window.removeEventListener('touchend', onVolumeTouchEnd)
    window.removeEventListener('touchcancel', onVolumeTouchEnd)
}

// ===== 快退/快进 10秒 =====
function skipBack() {
    const v = videoEl.value
    if (!v) return
    v.currentTime = Math.max(0, v.currentTime - 10)
    showControls()
}
function skipForward() {
    const v = videoEl.value
    if (!v) return
    v.currentTime = Math.min(duration.value, v.currentTime + 10)
    showControls()
}

// ===== 倍速 =====
function changeSpeed(speed) {
    const v = videoEl.value
    if (!v) return
    v.playbackRate = speed
    playbackRate.value = speed
    showSpeedMenu.value = false
    showControls()
}
function toggleSpeedMenu() {
    showSpeedMenu.value = !showSpeedMenu.value
    if (showSpeedMenu.value) {
        showLevelMenu.value = false
        showEpPanel.value = false
    }
}

// ===== 循环播放 =====
function toggleLoop() {
    const v = videoEl.value
    if (!v) return
    isLooping.value = !isLooping.value
    v.loop = isLooping.value
    showControls()
}

// ===== 选集面板 =====
function toggleEpPanel() {
    showEpPanel.value = !showEpPanel.value
    if (showEpPanel.value) {
        showSpeedMenu.value = false
        showLevelMenu.value = false
    }
}
function onEpisodeSelect(ep) {
    emit('selectEpisode', ep)
    showEpPanel.value = false
    showControls()
}

// ===== 全屏 =====
function toggleFullscreen() {
    const el = wrapperEl.value
    if (!el) return
    if (!document.fullscreenElement) {
        el.requestFullscreen?.().then(() => { isFullscreen.value = true }).catch(() => {})
    } else {
        document.exitFullscreen?.().then(() => { isFullscreen.value = false }).catch(() => {})
    }
}
function onFullscreenChange() {
    isFullscreen.value = !!document.fullscreenElement
}

// ===== 分辨率切换 =====
function switchLevel(idx) {
    if (!hls) return
    hls.currentLevel = idx
    currentLevel.value = idx
    showLevelMenu.value = false
}

// ===== 快捷键 =====
function onKeydown(e) {
    if (!wrapperEl.value || !wrapperEl.value.contains(document.activeElement) && document.activeElement !== document.body) return
    const v = videoEl.value
    if (!v) return
    if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        const ratio = parseInt(e.key, 10) / 10
        v.currentTime = ratio * duration.value
        showControls()
        return
    }
    switch (e.key) {
        case ' ':
        case 'k':
            e.preventDefault(); togglePlay(); break
        case 'ArrowLeft':
            e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); break
        case 'ArrowRight':
            e.preventDefault(); v.currentTime = Math.min(duration.value, v.currentTime + 5); break
        case 'ArrowUp':
            e.preventDefault(); volume.value = Math.min(1, volume.value + 0.1); onVolumeInput(); break
        case 'ArrowDown':
            e.preventDefault(); volume.value = Math.max(0, volume.value - 0.1); onVolumeInput(); break
        case 'f':
        case 'F':
            e.preventDefault(); toggleFullscreen(); break
        case 'm':
        case 'M':
            e.preventDefault(); toggleMute(); break
    }
    showControls()
}

// ===== HLS / FLV 加载 =====
function destroyHls() {
    if (hls) {
        try { hls.destroy() } catch (e) {}
        hls = null
    }
    destroyFlv()
    destroyDashAudio()
    const v = videoEl.value
    if (v) {
        try { v.pause(); v.removeAttribute('src'); v.load() } catch (e) {}
    }
    levels.value = []
    currentLevel.value = -1
}

// ===== DASH 音频销毁 =====
function destroyDashAudio() {
    if (dashAudioEl) {
        const v = videoEl.value
        const h = dashAudioEl._syncHandlers
        if (v && h) {
            v.removeEventListener('play', h.syncPlay)
            v.removeEventListener('pause', h.syncPause)
            v.removeEventListener('seeked', h.syncSeek)
            v.removeEventListener('seeking', h.syncSeek)
            v.removeEventListener('volumechange', h.syncVolume)
            v.removeEventListener('ratechange', h.syncRate)
            v.removeEventListener('timeupdate', h.syncDrift)
            v.removeEventListener('waiting', h.syncPause)
            v.removeEventListener('playing', h.syncPlay)
        }
        try { dashAudioEl.pause(); dashAudioEl.src = ''; dashAudioEl.load() } catch (e) {}
        dashAudioEl = null
    }
}

function loadSource(url) {
    const v = videoEl.value
    if (!v) return
    destroyHls()
    playerError.value = ''
    loading.value = true
    v.loop = isLooping.value

    // FLV 流（mpegts.js — flv.js 的升级版，支持 H.265 + 修复 streaming bug）
    if (props.playType === 'flv' || /\.flv(\?|$)/i.test(url)) {
        if (mpegts.isSupported()) {
            const isLiveStream = props.playType === 'live' || (props.playType === 'flv' && /live|stream/i.test(url))
            flvPlayer = mpegts.createPlayer({
                type: 'flv',
                url: url,
                isLive: isLiveStream,
                cors: true,
                hasAudio: true,
                hasVideo: true
            }, {
                enableWorker: true,
                // 直播流必须启用 stashBuffer，否则缓冲不足导致一直卡在解析
                enableStashBuffer: true,
                stashInitialSize: isLiveStream ? 1024 : 256,
                autoCleanupSourceBuffer: true,
                autoCleanupMaxBackwardDuration: 10,
                autoCleanupMinBackwardDuration: 5,
                liveBufferLatencyChasing: isLiveStream,
                liveBufferLatencyMaxLatency: 3,
                liveBufferLatencyMinRemain: 1,
                liveSync: isLiveStream,
                lazyLoad: false,
                fixAudioTimestampGap: true,
                // 网络重试
                fetchOptions: { mode: 'cors' },
                // 修复部分直播流 seek 越界
                rangeLoadZeroStart: isLiveStream,
                // mpegts.js 特有：重用重定向后的 URL（避免重复重定向）
                reuseRedirectedURL: true
            })
            flvPlayer.attachMediaElement(v)
            let flvReady = false
            let flvLoadFailed = false
            // 加载超时检测：12 秒未就绪则报错，避免一直卡在"解析中"
            const flvLoadTimer = setTimeout(() => {
                if (!flvReady && !flvLoadFailed) {
                    flvLoadFailed = true
                    playerError.value = 'FLV 直播流连接超时（12秒未收到数据），可能是不支持的编码（H.265）或 CDN 防盗链'
                    loading.value = false
                    emit('error', playerError.value)
                    try { flvPlayer.pause() } catch (e) {}
                }
            }, 12000)
            flvPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
                if (flvLoadTimer) clearTimeout(flvLoadTimer)
                flvLoadFailed = true
                // 直播流网络错误自动重连一次
                if (isLiveStream && errType === mpegts.ErrorTypes.NETWORK_ERROR && !flvPlayer._retried) {
                    flvPlayer._retried = true
                    try {
                        flvPlayer.pause()
                        flvPlayer.unload()
                        setTimeout(() => { try { flvPlayer.load(); flvPlayer.play().catch(() => {}) } catch (e) {} }, 1000)
                        return
                    } catch (e) {}
                }
                playerError.value = 'FLV 播放失败：' + (errDetail || errType)
                loading.value = false
                emit('error', playerError.value)
            })
            flvPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
                if (flvLoadTimer) clearTimeout(flvLoadTimer)
                // 直播流收到 LOADING_COMPLETE 表示流已结束
                if (isLiveStream) {
                    loading.value = false
                    playerError.value = '直播流已结束'
                    emit('error', playerError.value)
                }
            })
            flvPlayer.on(mpegts.Events.MEDIA_INFO, (info) => {
                if (flvLoadTimer) clearTimeout(flvLoadTimer)
                flvReady = true
                loading.value = false
                // 检测编码：如果是 H.265/HEVC，提示用户（mpegts.js 解复用 H.265，但 Chromium MSE 可能不支持解码）
                if (info?.videoCodec && /hevc|h265|265/i.test(info.videoCodec)) {
                    console.warn('[FLV] 检测到 H.265 编码，当前 Chromium 可能不支持 MSE H.265 解码')
                }
            })
            // 兜底：监听 video 元数据加载完成
            const onMeta = () => {
                if (flvLoadTimer) clearTimeout(flvLoadTimer)
                flvReady = true
                loading.value = false
                v.removeEventListener('loadedmetadata', onMeta)
            }
            v.addEventListener('loadedmetadata', onMeta)
            flvPlayer.load()
            if (props.autoplay) {
                v.play().then(() => { loading.value = false }).catch(() => { loading.value = false })
            } else {
                loading.value = false
            }
            return
        }
        playerError.value = '当前环境不支持 FLV 播放（需 MSE 支持）'
        loading.value = false
        emit('error', playerError.value)
        return
    }

    // 原生 HLS（Safari）
    if (v.canPlayType('application/vnd.apple.mpegurl') && /\.m3u8/i.test(url)) {
        v.src = url
        v.play().then(() => { loading.value = false }).catch(() => { loading.value = false })
        return
    }
    // 直链非 m3u8（mp4/webm 等）
    if (!/\.m3u8/i.test(url)) {
        v.src = url
        v.play().then(() => { loading.value = false }).catch(() => { loading.value = false })
        return
    }
    // hls.js
    if (Hls.isSupported()) {
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 60,
            backBufferLength: 30,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4
        })
        hls.loadSource(url)
        hls.attachMedia(v)
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
            loading.value = false
            const list = (data.levels || []).map((lv, idx) => ({
                index: idx,
                height: lv.height || 0,
                bitrate: lv.bitrate || 0,
                label: lv.height ? `${lv.height}p` : (lv.bitrate ? `${Math.round(lv.bitrate / 1000)}kbps` : `线路${idx + 1}`)
            })).sort((a, b) => b.height - a.height)
            levels.value = list
            currentLevel.value = -1
            if (props.autoplay) v.play().catch(() => {})
        })
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
            currentLevel.value = data.level
        })
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    try { hls.startLoad() } catch (e) {}
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    try { hls.recoverMediaError() } catch (e) {}
                } else {
                    playerError.value = '播放失败：' + (data.details || '致命错误')
                    loading.value = false
                    emit('error', playerError.value)
                    destroyHls()
                }
            }
        })
    } else {
        playerError.value = '当前环境不支持 HLS 播放'
        loading.value = false
        emit('error', playerError.value)
    }

    // ===== DASH 音视频分离流：初始化独立音频元素并同步播放 =====
    // B站高画质流（fnval=16）返回的 mp4 只有视频，音频需单独播放并同步
    initDashAudio()
}

// ===== DASH 音频初始化与同步 =====
function initDashAudio() {
    destroyDashAudio()
    if (!props.audioUrl) return  // 非 DASH 流无需音频
    const v = videoEl.value
    if (!v) return
    dashAudioEl = new Audio()
    // 不设 crossOrigin：B站 CDN 不一定支持 CORS，webSecurity:false 已允许跨域
    dashAudioEl.src = props.audioUrl
    dashAudioEl.load()
    // 音量与主视频同步
    dashAudioEl.volume = v.volume
    dashAudioEl.muted = v.muted

    // === 同步策略：以视频为准，音频跟随 ===
    // 视频播放/暂停时音频跟随
    const syncPlay = () => { if (dashAudioEl) { dashAudioEl.play().catch(() => {}) } }
    const syncPause = () => { if (dashAudioEl) dashAudioEl.pause() }
    // 视频seek时音频跟随
    const syncSeek = () => { if (dashAudioEl) { try { dashAudioEl.currentTime = v.currentTime } catch (e) {} } }
    // 音量/静音同步
    const syncVolume = () => { if (dashAudioEl) { dashAudioEl.volume = v.volume; dashAudioEl.muted = v.muted } }
    // 倍速同步
    const syncRate = () => { if (dashAudioEl) dashAudioEl.playbackRate = v.playbackRate }
    // 缓冲对齐：音频比视频超前太多时拉回
    const syncDrift = () => {
        if (!dashAudioEl) return
        const drift = dashAudioEl.currentTime - v.currentTime
        if (Math.abs(drift) > 0.3) {
            try { dashAudioEl.currentTime = v.currentTime } catch (e) {}
        }
    }

    v.addEventListener('play', syncPlay)
    v.addEventListener('pause', syncPause)
    v.addEventListener('seeked', syncSeek)
    v.addEventListener('seeking', syncSeek)
    v.addEventListener('volumechange', syncVolume)
    v.addEventListener('ratechange', syncRate)
    v.addEventListener('timeupdate', syncDrift)
    v.addEventListener('waiting', syncPause)
    v.addEventListener('playing', syncPlay)
    // 保存引用以便销毁时移除监听
    dashAudioEl._syncHandlers = { syncPlay, syncPause, syncSeek, syncVolume, syncRate, syncDrift }
}

// 监听 src 变化
watch(() => props.src, (newSrc) => {
    if (!newSrc) {
        destroyHls()
        playerError.value = ''
        loading.value = false
        return
    }
    nextTick(() => loadSource(newSrc))
})

onMounted(() => {
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKeydown)
    if (props.src) nextTick(() => loadSource(props.src))
})

onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onKeydown)
    if (hideControlsTimer) clearTimeout(hideControlsTimer)
    destroyHls()
    // 清理 Web Audio API
    if (mediaSource) { try { mediaSource.disconnect() } catch (e) {} mediaSource = null }
    if (gainNode) { try { gainNode.disconnect() } catch (e) {} gainNode = null }
    if (audioCtx) { try { audioCtx.close() } catch (e) {} audioCtx = null }
})

defineExpose({ videoEl })
</script>

<template>
    <div
        class="bili-player"
        ref="wrapperEl"
        @mousemove="showControls"
        @mouseleave="hideControls"
        @click="togglePlay"
        @dblclick.stop="toggleFullscreen"
        tabindex="0"
    >
        <video
            ref="videoEl"
            class="bili-video"
            playsinline
            @timeupdate="onTimeUpdate"
            @progress="onProgress"
            @play="onPlay"
            @pause="onPause"
            @ended="onEnded"
            @waiting="onWaiting"
            @playing="onPlaying"
            @loadedmetadata="onLoadedMetadata"
            @volumechange="onVolumeChange"
        ></video>

        <!-- 中央播放按钮（暂停时） -->
        <transition name="bili-fade">
            <div v-if="!isPlaying && !playerError && !loading && !buffering" class="center-play" @click.stop="togglePlay">
                <Play :size="56" fill="currentColor" />
            </div>
        </transition>

        <!-- 缓冲 spinner -->
        <div v-if="buffering && !playerError && !loading" class="buffer-spinner">
            <Loader2 :size="40" class="spin" />
        </div>

        <!-- 加载遮罩 -->
        <div v-if="loading" class="player-mask">
            <Loader2 :size="36" class="spin" />
            <p>解析播放地址中...</p>
        </div>

        <!-- 错误遮罩 -->
        <div v-if="playerError" class="player-mask error" @click.stop>
            <Film :size="36" />
            <p>{{ playerError }}</p>
            <button class="btn-primary" @click.stop="emit('retry')">
                <RefreshCw :size="14" /> 重试
            </button>
        </div>

        <!-- 集数提示 -->
        <div v-if="badge && !playerError" class="current-ep-badge">{{ badge }}</div>

        <!-- 分辨率切换 -->
        <div
            v-if="levels.length > 1 && !playerError"
            class="level-switcher"
            :class="{ visible: controlsVisible }"
            @click.stop="showLevelMenu = !showLevelMenu"
        >
            <span class="level-label">{{ currentLevelLabel }}</span>
            <div v-if="showLevelMenu" class="level-menu" @click.stop>
                <div class="level-menu-item" :class="{ active: currentLevel === -1 }" @click="switchLevel(-1)">自动</div>
                <div
                    v-for="lv in levels"
                    :key="lv.index"
                    class="level-menu-item"
                    :class="{ active: currentLevel === lv.index }"
                    @click="switchLevel(lv.index)"
                >{{ lv.label }}</div>
            </div>
        </div>

        <!-- 控制条 -->
        <div
            v-if="!playerError && !loading"
            class="control-bar"
            :class="{ visible: controlsVisible || !isPlaying }"
            @click.stop
        >
            <!-- 进度条（支持拖动） -->
            <div
                class="progress-bar"
                ref="progressBar"
                @mousedown="onProgressMouseDown"
                @mousemove="onProgressHover"
                @mouseleave="hoverTime = null"
                @touchstart="onProgressTouchStart"
                @touchmove="onProgressTouchMove"
                @touchend="onProgressTouchEnd"
                @touchcancel="onProgressTouchEnd"
            >
                <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
                <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
                <div class="progress-thumb" :style="{ left: playedPercent + '%' }"></div>
                <div v-if="hoverTime !== null" class="progress-preview" :style="{ left: hoverPercent + '%' }">
                    {{ formatTime(hoverTime) }}
                </div>
            </div>

            <!-- 按钮组 -->
            <div class="controls-row">
                <div class="left-controls">
                    <button class="ctrl-btn" @click="skipBack" title="后退10秒">
                        <SkipBack :size="18" />
                    </button>
                    <button class="ctrl-btn play-btn" @click="togglePlay" :title="isPlaying ? '暂停 (空格)' : '播放 (空格)'">
                        <Pause v-if="isPlaying" :size="22" fill="currentColor" />
                        <Play v-else :size="22" fill="currentColor" />
                    </button>
                    <button class="ctrl-btn" @click="skipForward" title="前进10秒">
                        <SkipForward :size="18" />
                    </button>

                    <div class="volume-group">
                        <button class="ctrl-btn" @click="toggleMute" title="静音 (M)">
                            <Volume2 v-if="!isMuted && volume > 0.5" :size="20" />
                            <Volume1 v-else-if="!isMuted && volume > 0" :size="20" />
                            <VolumeX v-else :size="20" />
                        </button>
                        <div
                            class="volume-slider"
                            ref="volumeSlider"
                            @touchstart="onVolumeTouchStart"
                            @touchmove="onVolumeTouchMove"
                            @touchend="onVolumeTouchEnd"
                            @touchcancel="onVolumeTouchEnd"
                        >
                            <div class="volume-track">
                                <div class="volume-fill" :style="{ width: (isMuted ? 0 : volume * 100) + '%' }"></div>
                            </div>
                            <input type="range" min="0" max="1" step="0.01" v-model.number="volume" @input="onVolumeInput" />
                        </div>
                        <!-- 音量增益按钮：100% → 150% → 200% → 300%，解决直播流声音太小 -->
                        <button class="ctrl-btn gain-btn" :class="{ 'gain-active': gainBoost > 1.0 }" @click="cycleGainBoost" :title="`音量增益 ${gainLabel}（点击切换）`">
                            {{ gainLabel }}
                        </button>
                    </div>

                    <span class="time-display">
                        <span class="current-time">{{ formatTime(currentTime) }}</span>
                        <span class="time-sep">/</span>
                        <span class="duration">{{ formatTime(duration) }}</span>
                    </span>
                </div>

                <div class="right-controls">
                    <!-- 倍速 -->
                    <div class="speed-switcher" @click.stop="toggleSpeedMenu">
                        <span class="speed-label">{{ playbackRate }}x</span>
                        <div v-if="showSpeedMenu" class="speed-menu" @click.stop>
                            <div
                                v-for="sp in speedOptions"
                                :key="sp"
                                class="speed-menu-item"
                                :class="{ active: playbackRate === sp }"
                                @click="changeSpeed(sp)"
                            >{{ sp }}x</div>
                        </div>
                    </div>

                    <!-- 循环播放 -->
                    <button
                        class="ctrl-btn"
                        :class="{ active: isLooping }"
                        @click.stop="toggleLoop"
                        :title="isLooping ? '关闭循环' : '循环播放'"
                    >
                        <Repeat :size="18" :class="{ 'loop-active': isLooping }" />
                    </button>

                    <!-- 选集 -->
                    <div class="ep-panel-wrapper">
                        <button class="ep-switch-btn" @click.stop="toggleEpPanel" title="选集">选集</button>
                        <div v-if="showEpPanel" class="ep-panel" @click.stop>
                            <div v-if="!episodes.length" class="ep-panel-empty">暂无集数</div>
                            <div v-else class="ep-panel-list">
                                <button
                                    v-for="ep in episodes"
                                    :key="ep.title"
                                    class="ep-panel-item"
                                    :class="{ active: currentEpisode?.title === ep.title }"
                                    @click="onEpisodeSelect(ep)"
                                >{{ ep.title }}</button>
                            </div>
                        </div>
                    </div>

                    <!-- 上一集 / 下一集（剧集切换） -->
                    <button
                        v-if="hasPrev"
                        class="ep-switch-btn"
                        @click.stop="emit('prev')"
                        title="上一集"
                    >上一集</button>
                    <button
                        v-if="hasNext"
                        class="ep-switch-btn"
                        @click.stop="emit('next')"
                        title="下一集"
                    >下一集</button>

                    <button class="ctrl-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏 (F)' : '全屏 (F)'">
                        <Minimize v-if="isFullscreen" :size="20" />
                        <Maximize v-else :size="20" />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.bili-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    max-height: 100%;
    background: #000;
    overflow: hidden;
    cursor: pointer;
    outline: none;
}
.bili-player:fullscreen { border-radius: 0; }

.bili-video {
    width: 100%;
    height: 100%;
    max-height: 100%;
    display: block;
    background: #000;
    object-fit: contain;
}

/* ===== 中央播放按钮 ===== */
.center-play {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 76px; height: 76px;
    border-radius: 50%;
    background: rgba(0, 0, 0, .55);
    backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    cursor: pointer;
    z-index: 4;
    transition: all .2s;
    box-shadow: 0 4px 24px rgba(0, 0, 0, .4);
}
.center-play:hover {
    background: rgba(194, 12, 12, .85);
    transform: translate(-50%, -50%) scale(1.08);
}
.center-play svg { margin-left: 4px; }

/* ===== 缓冲 spinner ===== */
.buffer-spinner {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: #fff;
    z-index: 4;
    background: rgba(0, 0, 0, .35);
    width: 64px; height: 64px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
}

/* ===== 遮罩 ===== */
.player-mask {
    position: absolute;
    inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px;
    background: rgba(0, 0, 0, .75);
    color: #fff;
    z-index: 6;
}
.player-mask.error { background: rgba(0, 0, 0, .88); }
.player-mask p { margin: 0; font-size: 14px; }

.btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px;
    background: #c20c0c;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    transition: background .2s;
    margin-top: 6px;
}
.btn-primary:hover { background: #a30a0a; }

.spin { animation: bili-spin 1s linear infinite; }
@keyframes bili-spin { to { transform: rotate(360deg); } }

/* ===== 集数提示 ===== */
.current-ep-badge {
    position: absolute;
    top: 12px; left: 12px;
    background: rgba(0, 0, 0, .6);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    z-index: 5;
    pointer-events: none;
    opacity: 1;
    transition: opacity .25s;
}
.bili-player:hover .current-ep-badge { opacity: 0; }

/* ===== 分辨率切换 ===== */
.level-switcher {
    position: absolute;
    top: 12px; right: 12px;
    background: rgba(0, 0, 0, .6);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 12px;
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    z-index: 6;
    user-select: none;
    transition: background .2s, opacity .25s;
    opacity: 0;
}
.level-switcher.visible { opacity: 1; }
.level-switcher:hover { background: rgba(194, 12, 12, .92); }
.level-label { font-weight: 600; }

.level-menu {
    position: absolute;
    top: 100%; right: 0;
    margin-top: 6px;
    background: rgba(0, 0, 0, .92);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 88px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .5);
    cursor: default;
}
.level-menu-item {
    padding: 7px 14px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    transition: background .15s;
    text-align: center;
}
.level-menu-item:hover { background: rgba(255, 255, 255, .12); }
.level-menu-item.active { color: #ff6b6b; background: rgba(194, 12, 12, .22); }

/* ===== 倍速切换器 ===== */
.speed-switcher {
    position: relative;
    padding: 0 12px;
    height: 32px;
    display: flex;
    align-items: center;
    cursor: pointer;
    border-radius: 4px;
    transition: background .15s;
    user-select: none;
}
.speed-switcher:hover { background: rgba(255, 255, 255, .15); }
.speed-label {
    color: #fff;
    font-size: 13px;
    font-weight: 600;
}
.speed-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 6px;
    background: rgba(0, 0, 0, .92);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 72px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .5);
    cursor: default;
}
.speed-menu-item {
    padding: 7px 14px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    transition: background .15s;
    text-align: center;
}
.speed-menu-item:hover { background: rgba(255, 255, 255, .12); }
.speed-menu-item.active { color: #ff6b6b; background: rgba(194, 12, 12, .22); }

/* ===== 控制条 ===== */
.control-bar {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    padding: 12px 14px 6px;
    background: linear-gradient(to top, rgba(0, 0, 0, .85) 0%, rgba(0, 0, 0, .5) 60%, rgba(0, 0, 0, 0) 100%);
    z-index: 5;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity .25s, transform .25s;
    pointer-events: none;
}
.control-bar.visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
}

/* ===== 进度条（可拖动 + 美化，无白底） ===== */
.progress-bar {
    position: relative;
    width: 100%;
    height: 18px;
    margin-bottom: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
}
/* 底色：完全透明，无白底 */
.progress-bar::before {
    content: '';
    position: absolute;
    left: 0; right: 0;
    height: 4px;
    background: transparent;
    border-radius: 4px;
    transition: height .15s;
}
.progress-bar:hover::before,
.progress-bar:active::before { height: 6px; }

/* 缓冲条：用半透明深灰，不用白色 */
.progress-buffered {
    position: absolute;
    left: 0;
    height: 4px;
    background: rgba(0, 0, 0, .25);
    border-radius: 4px;
    transition: height .15s;
}
.progress-bar:hover .progress-buffered,
.progress-bar:active .progress-buffered { height: 6px; }

.progress-played {
    position: absolute;
    left: 0;
    height: 4px;
    background: linear-gradient(to right, #c20c0c, #ff4d4d);
    border-radius: 4px;
    transition: height .15s;
    box-shadow: 0 0 10px rgba(255, 77, 77, .65);
}
.progress-bar:hover .progress-played,
.progress-bar:active .progress-played { height: 6px; }

.progress-thumb {
    position: absolute;
    top: 50%;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #ff4d4d;
    transform: translate(-50%, -50%) scale(0);
    transition: transform .15s, background .15s;
    box-shadow: 0 0 0 4px rgba(255, 77, 77, .25), 0 2px 8px rgba(0, 0, 0, .5);
    pointer-events: none;
}
.progress-bar:hover .progress-thumb { transform: translate(-50%, -50%) scale(1); }
.progress-bar:active .progress-thumb {
    transform: translate(-50%, -50%) scale(1.25);
    background: #c20c0c;
    box-shadow: 0 0 0 6px rgba(255, 77, 77, .35), 0 2px 12px rgba(0, 0, 0, .6);
}

.progress-preview {
    position: absolute;
    top: -34px;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, .9);
    color: #fff;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 3px;
    pointer-events: none;
    white-space: nowrap;
}
.progress-preview::after {
    content: '';
    position: absolute;
    top: 100%; left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: rgba(0, 0, 0, .9);
}

/* ===== 按钮组 ===== */
.controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 32px;
}
.left-controls, .right-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}

.ctrl-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    border: none;
    background: transparent;
    color: #fff;
    cursor: pointer;
    border-radius: 4px;
    transition: background .15s, color .15s;
}
.ctrl-btn:hover { background: rgba(255, 255, 255, .15); color: #ff6b6b; }
.ctrl-btn.active { color: #ff6b6b; }
.ctrl-btn.active:hover { color: #ff4d4d; }

.loop-active { color: #ff6b6b; }

/* 音量组（常驻显示，更易调节） */
.volume-group {
    display: flex;
    align-items: center;
    gap: 0;
    position: relative;
}

/* 音量增益按钮 */
.gain-btn {
    min-width: 42px;
    font-size: 11px;
    font-weight: 700;
    padding: 0 6px;
    color: rgba(255, 255, 255, 0.6);
}
.gain-btn.gain-active {
    color: #ff6b6b;
}
.gain-btn:hover {
    color: #ff6b6b;
    background: rgba(255, 255, 255, .15);
}
.volume-slider {
    width: 70px;
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    margin-left: 2px;
}

.volume-track {
    position: absolute;
    left: 4px; right: 4px;
    height: 4px;
    background: transparent;
    border-radius: 2px;
    pointer-events: none;
}
.volume-fill {
    height: 100%;
    background: linear-gradient(to right, #c20c0c, #ff4d4d);
    border-radius: 2px;
    box-shadow: 0 0 6px rgba(255, 77, 77, .5);
}
.volume-slider input[type=range] {
    width: 70px;
    margin: 0 4px;
    height: 14px;
    background: transparent;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    cursor: pointer;
    position: relative;
    z-index: 2;
    outline: none;
    border: none;
}
/* 音量滑块 track（清除描边，透明由 .volume-track 显示底色） */
.volume-slider input[type=range]::-webkit-slider-runnable-track {
    -webkit-appearance: none;
    height: 4px;
    background: transparent;
    border-radius: 2px;
    border: none;
}
.volume-slider input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #ff4d4d;
    box-shadow: 0 0 0 3px rgba(255, 77, 77, .25), 0 2px 6px rgba(0, 0, 0, .4);
    cursor: pointer;
    margin-top: -4px;
    outline: none;
    transition: transform .15s, box-shadow .15s;
}
.volume-slider input[type=range]:hover::-webkit-slider-thumb {
    transform: scale(1.15);
    box-shadow: 0 0 0 4px rgba(255, 77, 77, .35), 0 2px 8px rgba(0, 0, 0, .5);
}
.volume-slider input[type=range]:focus { outline: none; }
.volume-slider input[type=range]:focus::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px rgba(255, 77, 77, .35), 0 0 6px rgba(255, 77, 77, .7);
}

/* Firefox 音量滑块 */
.volume-slider input[type=range]::-moz-range-track {
    height: 4px;
    background: transparent;
    border: none;
    border-radius: 2px;
}
.volume-slider input[type=range]::-moz-range-thumb {
    width: 12px; height: 12px;
    border: none;
    border-radius: 50%;
    background: #ff4d4d;
    box-shadow: 0 0 0 3px rgba(255, 77, 77, .25), 0 2px 6px rgba(0, 0, 0, .4);
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
}
.volume-slider input[type=range]:hover::-moz-range-thumb {
    transform: scale(1.15);
    box-shadow: 0 0 0 4px rgba(255, 77, 77, .35), 0 2px 8px rgba(0, 0, 0, .5);
}
.volume-slider input[type=range]:focus::-moz-range-thumb {
    box-shadow: 0 0 0 4px rgba(255, 77, 77, .35), 0 0 6px rgba(255, 77, 77, .7);
}
.volume-slider input[type=range]::-moz-focus-outer { border: 0; }

/* 时间显示 */
.time-display {
    color: #fff;
    font-size: 12px;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0, 0, 0, .6);
}
.time-sep { margin: 0 3px; opacity: .6; }
.duration { opacity: .8; }

/* 上一集/下一集按钮 */
.ep-switch-btn {
    padding: 0 10px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, .35);
    background: rgba(255, 255, 255, .08);
    color: #fff;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background .15s, border-color .15s, color .15s;
    white-space: nowrap;
}
.ep-switch-btn:hover {
    background: rgba(194, 12, 12, .9);
    border-color: #c20c0c;
    color: #fff;
}

/* 选集面板 */
.ep-panel-wrapper { position: relative; }
.ep-panel {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: 220px;
    max-height: 260px;
    overflow-y: auto;
    background: rgba(0, 0, 0, .92);
    border-radius: 6px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .5);
    z-index: 10;
    cursor: default;
}
.ep-panel-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: 6px;
}
.ep-panel-item {
    padding: 6px 4px;
    border: 1px solid rgba(255, 255, 255, .15);
    background: rgba(255, 255, 255, .06);
    color: #fff;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all .15s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ep-panel-item:hover {
    background: rgba(255, 255, 255, .12);
    border-color: rgba(255, 255, 255, .25);
}
.ep-panel-item.active {
    color: #ff6b6b;
    background: rgba(194, 12, 12, .22);
    border-color: rgba(194, 12, 12, .5);
}
.ep-panel-empty {
    color: #aaa;
    font-size: 12px;
    text-align: center;
    padding: 12px 0;
}

/* ===== 过渡动画 ===== */
.bili-fade-enter-active, .bili-fade-leave-active {
    transition: opacity .25s, transform .25s;
}
.bili-fade-enter-from, .bili-fade-leave-to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(.7);
}

/* 全屏样式 */
.bili-player:fullscreen .control-bar { padding: 16px 20px 8px; }
.bili-player:fullscreen .ctrl-btn { width: 40px; height: 40px; }
.bili-player:fullscreen .controls-row { height: 40px; }
.bili-player:fullscreen .center-play { width: 96px; height: 96px; }
</style>
