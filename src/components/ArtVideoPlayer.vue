<script setup>
// ArtPlayer 封装的视频播放器（引擎：ArtPlayer 5.x）
// 支持 m3u8 (hls.js) / FLV 直播 (mpegts.js) / 直链 mp4 / DASH 音视频分离
// 功能：选集面板 / 上一集下一集 / 音量增强(Web Audio 增益最高1000%) / 画质切换 / 倍速 / 快捷键
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Artplayer from 'artplayer'
import VideoEpisodeDrawer from './VideoEpisodeDrawer.vue'
import { normalizeLocalFileUrl } from '../utils/local-file-url'
import ArtplayerDanmuku from 'artplayer-plugin-danmuku'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { ChevronsLeftRight, Film, RefreshCw, X } from 'lucide-vue-next'
import { createVideoEnhancement, enhancementModes } from '../utils/video-enhancement'
import { installSeekPreview } from '../utils/video-seek-preview'
import { installMediaLoadWatchdog } from '../utils/media-load-watchdog'

const props = defineProps({
    src: { type: String, default: '' },
    playType: { type: String, default: 'm3u8' }, // m3u8 | direct | flv | live
    // DASH 音视频分离时的音频地址（B站高画质流是纯视频，需同步播放音频）
    audioUrl: { type: String, default: '' },
    // 多画质列表（B站TV）：[{ qn, label, videoUrl, audioUrl }]，多于 1 档时显示画质切换按钮
    qualities: { type: Array, default: () => [] },
    // 当前画质档位 qn（父层指定初始档，切换后通过 qualityChange 事件同步回父层）
    currentQn: { type: Number, default: 0 },
    // 弹幕列表（B站TV）：[{ text, time, mode(0滚动/1顶部/2底部), color, size }]
    danmaku: { type: Array, default: () => [] },
    badge: { type: String, default: '' },
    autoplay: { type: Boolean, default: true },
    hasPrev: { type: Boolean, default: false },
    hasNext: { type: Boolean, default: false },
    episodes: { type: Array, default: () => [] },
    currentEpisode: { type: Object, default: null },
    localMode: { type: Boolean, default: false },
    episodeTitle: { type: String, default: '' },
    episodeCover: { type: String, default: '' },
    // 续播记忆 key（如 bili:BVxx:cid）：5 秒节流记录播放位置，重新打开时自动跳转
    resumeKey: { type: String, default: '' },
    loadTimeoutMs: { type: Number, default: 0 }
})
const emit = defineEmits(['ended', 'retry', 'ready', 'error', 'prev', 'next', 'selectEpisode', 'playing', 'qualityChange'])

const artContainerEl = ref(null)
// ArtPlayer 根节点（$player，全屏目标）。遮罩层 Teleport 进去，全屏时仍可见
const playerEl = ref(null)

let art = null
let playerVersion = 0
let disposed = false
let destroying = Promise.resolve()
let stopLoadWatchdog = () => {}
const playerError = ref('')

const showEpPanel = ref(false)
// 真直播标识（duration=Infinity 时显示）
const liveBadge = ref(false)

// ===== 画质切换（B站TV 多档位 DASH）=====
const showQualityPanel = ref(false)
// 当前生效画质 qn（父层 currentQn 优先，否则取最高档）
const activeQn = ref(0)
const activeQualityLabel = computed(() => {
    const q = props.qualities.find(item => item.qn === activeQn.value)
    return q ? q.label : '画质'
})

// 切换画质：art.switchQuality 保持播放进度（ArtPlayer 5.x 的 switchUrl 会回到 0，勿用），
// DASH 音频各档共用同一地址，无需重挂音频
async function switchQuality(q) {
    showQualityPanel.value = false
    if (!art || !q || q.qn === activeQn.value) return
    const prevQn = activeQn.value
    activeQn.value = q.qn
    const time = art.currentTime || 0
    const wasPlaying = art.video && !art.video.paused
    try {
        await art.switchQuality(q.videoUrl)
        // 兜底恢复进度与播放状态
        if (art) {
            if (Math.abs((art.currentTime || 0) - time) > 1) {
                try { art.currentTime = time } catch (e) {}
            }
            if (wasPlaying) art.play().catch(() => {})
            else art.pause()
            art.notice.show = `画质已切换至 ${q.label}`
            updateQualityControl()
        }
        emit('qualityChange', q.qn)
    } catch (e) {
        activeQn.value = prevQn
        if (art) art.notice.show = '画质切换失败，请重试'
    }
}

// 同步控制条画质按钮文字
function updateQualityControl() {
    if (!art) return
    const dom = art.controls.biliQuality
    if (dom) dom.innerHTML = `<span class="avp-text-btn quality-active">${activeQualityLabel.value}</span>`
}

// ===== 弹幕（B站，滚动/顶部/底部）=====
// 显隐/透明度/速度用插件自带的设置面板开关（ArtPlayer 设置里的"显示弹幕"），不再另加控制条按钮
const danmakuOn = ref(true)

// ===== 音量增强（Web Audio API 增益节点，可超过系统 100%）=====
const boostSteps = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0]

// 流媒体增强只改变播放器的缓冲和恢复策略，不会伪造带宽。
// 默认开启；用户关闭后仍保留普通播放行为，偏好跨切集和重启保存。
const signalBoostEnabled = ref(localStorage.getItem('art_signal_boost') !== 'off')
const signalBoostLabel = computed(() => signalBoostEnabled.value ? '增强' : '标准')
function setSignalBoost(enabled) {
    signalBoostEnabled.value = Boolean(enabled)
    try { localStorage.setItem('art_signal_boost', signalBoostEnabled.value ? 'on' : 'off') } catch (e) {}
    if (art) art.notice.show = signalBoostEnabled.value
        ? '流媒体增强已开启：将提高缓冲并自动恢复卡顿'
        : '流媒体增强已关闭'
}

// 网络抖动时仅在确实停滞且有冷却间隔的情况下恢复，避免反复 reload 造成更大的卡顿。
function installSignalRecovery(video, artInstance, recover) {
    let timer = null
    let lastRecovery = 0
    let attempts = 0
    let windowStarted = 0
    const reset = () => { attempts = 0; windowStarted = performance.now() }
    const schedule = () => {
        if (!signalBoostEnabled.value || video.paused || video.ended || timer) return
        timer = setTimeout(() => {
            timer = null
            if (!signalBoostEnabled.value || video.paused || video.ended) return
            const now = performance.now()
            if (now - windowStarted > 30000) reset()
            if (attempts >= 4 || now - lastRecovery < 1800) return
            const ahead = (() => {
                try {
                    for (let i = 0; i < video.buffered.length; i++) {
                        if (video.currentTime >= video.buffered.start(i) - .15 && video.currentTime <= video.buffered.end(i)) {
                            return Math.max(0, video.buffered.end(i) - video.currentTime)
                        }
                    }
                } catch (e) {}
                return 0
            })()
            // 有缓冲但浏览器暂停派发播放事件时，先尝试继续播放；没有缓冲才重启底层加载器。
            if (ahead > .35) {
                video.play().catch(() => {})
                return
            }
            attempts += 1
            lastRecovery = now
            try { recover?.(attempts) } catch (e) {}
            video.play().catch(() => {})
        }, 650)
    }
    const onPlaying = () => reset()
    video.addEventListener('waiting', schedule)
    video.addEventListener('stalled', schedule)
    video.addEventListener('error', schedule)
    video.addEventListener('playing', onPlaying)
    const cleanup = () => {
        if (timer) clearTimeout(timer)
        timer = null
        video.removeEventListener('waiting', schedule)
        video.removeEventListener('stalled', schedule)
        video.removeEventListener('error', schedule)
        video.removeEventListener('playing', onPlaying)
    }
    artInstance.on('destroy', cleanup)
    return cleanup
}

// ===== 音量增强面板（与选集/画质面板同款弹出样式） =====
const showGainPanel = ref(false)
const showEnhancementPanel = ref(false)
const enhancementMode = ref('off')
const frameInterpolation = ref(false)
const enhancementBusy = ref(false)
const enhancementStatus = ref(null)
const compareOriginal = ref(false)
const comparePosition = ref(50)
let savedEnhancement = {}
try { savedEnhancement = JSON.parse(localStorage.getItem('art_enhancement') || '{}') || {} } catch {}
const preferredMode = ref(enhancementModes.some(m => m.value === savedEnhancement.mode) ? savedEnhancement.mode : 'off')
const preferredInterpolation = ref(savedEnhancement.interpolate === true)
const showEnhancementInfo = ref(savedEnhancement.showInfo === true)
function saveEnhancement() {
    try { localStorage.setItem('art_enhancement', JSON.stringify({ mode: preferredMode.value, interpolate: preferredInterpolation.value, showInfo: showEnhancementInfo.value })) } catch {}
}
watch(showEnhancementInfo, saveEnhancement)
const enhancementHandle = shallowRef(null)
function updateEnhancementComparison(value) {
    comparePosition.value = Number(value)
    enhancementHandle.value?.setComparison(compareOriginal.value ? comparePosition.value : null)
}
function toggleEnhancementComparison() {
    compareOriginal.value = !compareOriginal.value
    enhancementHandle.value?.setComparison(compareOriginal.value ? comparePosition.value : null)
}
async function selectGain(s) {
    // 接线或恢复失败时保留原档位，避免只更新标签、实际音量没有改变。
    if (!await ensureAudioGraph(s)) return
    gainBoost.value = s
    localStorage.setItem('art_gain_boost', String(s))
    showGainPanel.value = false
}

// 面板锚定：用 art.controls[name]（即控件 DOM）实测按钮位置，把面板对准按钮正上方。
// 全屏/缩放导致尺寸变化时自动重锚
const savedGain = Number(localStorage.getItem('art_gain_boost') || localStorage.getItem('bili_gain_boost'))
const gainBoost = ref(boostSteps.includes(savedGain) ? savedGain : 1.0)
const gainLabel = computed(() => {
    const pct = Math.round(gainBoost.value * 100)
    return pct >= 1000 ? '1000%' : pct + '%'
})
let audioCtx = null
let gainNode = null
let videoSourceNode = null
let dashSourceNode = null
let graphVideoEl = null
let graphDashEl = null

// DASH 流的独立音频元素
let dashAudioEl = null
// FLV 加载超时定时器
let flvTimer = null

// ===== 音视频同步缓冲（DASH 分离音频"跟不上"时转圈等待对齐）=====
// 以视频为时间基准、音频跟随。大跨度跳转或音频缓冲不足时音频会落后画面很远，
// 此时暂停视频、显示转圈，等音频就绪且误差收敛后再恢复播放，避免"画面走了没声"。
const syncBuffering = ref(false)
let isResyncing = false
let resyncTimer = null
// 失步判定阈值：超过 1.5s 视为"跨越远了"，走转圈等待流程；0.5~1.5s 内仍静默快贴
const RESYNC_DRIFT_THRESHOLD = 1.5

function requestResync() {
    const v = art?.video
    if (!v || !dashAudioEl || isResyncing) return
    // 视频本来就暂停（用户按了暂停后拖进度条）：只对齐音频时间，无需转圈打扰
    if (v.paused) {
        try { dashAudioEl.currentTime = v.currentTime } catch (e) {}
        return
    }
    isResyncing = true
    syncBuffering.value = true
    try { v.pause() } catch (e) {}
    try { dashAudioEl.pause() } catch (e) {}
    // 视频此刻已暂停、时间不再走，音频朝它反复贴齐直到收敛
    const align = () => { try { dashAudioEl.currentTime = v.currentTime } catch (e) {} }
    align()
    let waited = 0
    function finish() {
        clearTimeout(resyncTimer)
        resyncTimer = null
        isResyncing = false
        syncBuffering.value = false
        if (art?.video && !art.video.ended) art.video.play().catch(() => {})
    }
    function poll() {
        if (!art?.video || !dashAudioEl) { finish(); return }
        const drift = Math.abs(dashAudioEl.currentTime - art.video.currentTime)
        // 音频已缓冲到可播（readyState >= 2）且误差收敛到 250ms 内：恢复播放
        if (dashAudioEl.readyState >= 2 && drift < 0.25) { finish(); return }
        if (drift > RESYNC_DRIFT_THRESHOLD) align()
        waited += 150
        // 兜底：8 秒仍未对齐则强制恢复，宁可短暂不同声也不把用户卡死在转圈上
        if (waited >= 8000) { finish(); return }
        resyncTimer = setTimeout(poll, 150)
    }
    resyncTimer = setTimeout(poll, 150)
}

function showError(msg) {
    stopLoadWatchdog()
    playerError.value = msg
    emit('error', msg)
}

// ===== 音量增强 =====
// 建立音频图：video(+dash audio) → GainNode → destination
// 实际音量 = ArtPlayer音量(0-1) × gainBoost
async function ensureAudioGraph(boost = gainBoost.value) {
    const video = art?.video
    if (!video) return false
    try {
        // 100% 未启用过增强时保持原生输出；一旦接入则必须同步写回 1。
        if (!audioCtx && boost === 1) return true
        if (!audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext
            if (!AudioCtx) throw new Error('当前环境不支持音量增强')
            audioCtx = new AudioCtx()
            gainNode = audioCtx.createGain()
            gainNode.connect(audioCtx.destination)
        }
        // 增益值每次调用都同步（旧实现只在创建时设置一次，切低档不生效）
        gainNode.gain.value = boost
        // video 元素随播放器实例重建，需重新接线
        if (graphVideoEl !== video) {
            if (videoSourceNode) { try { videoSourceNode.disconnect() } catch (e) {} }
            videoSourceNode = audioCtx.createMediaElementSource(video)
            videoSourceNode.connect(gainNode)
            graphVideoEl = video
        }
        // DASH 音频元素同样接入增益图，保证增强对分离音轨生效
        if (dashAudioEl && graphDashEl !== dashAudioEl) {
            if (dashSourceNode) { try { dashSourceNode.disconnect() } catch (e) {} }
            dashSourceNode = audioCtx.createMediaElementSource(dashAudioEl)
            dashSourceNode.connect(gainNode)
            graphDashEl = dashAudioEl
        }
        if (audioCtx.state === 'suspended') await audioCtx.resume()
        return true
    } catch (e) {
        console.error('initAudioGraph error:', e)
        if (art) art.notice.show = '音量增强启用失败，请重试'
        return false
    }
}

// 切换增益倍数：100% → 150% → 200% → 300% → 500% → 1000% → 100%

// ===== ArtPlayer 控制按钮 =====
function buildControls() {
    const list = []
    // 选集面板
    list.push({
        name: 'episodes',
        position: 'right',
        index: 7,
        html: '<span class="avp-text-btn">选集</span>',
        tooltip: '选集',
        click: () => { showEpPanel.value = !showEpPanel.value; showGainPanel.value = false; showQualityPanel.value = false; showEnhancementPanel.value = false }
    })
    // 画质切换（B站TV 多档位 DASH，多于 1 档时显示）
    if (props.qualities.length > 1) {
        list.push({
            name: 'biliQuality',
            position: 'right',
            index: 8,
            html: `<span class="avp-text-btn quality-active">${activeQualityLabel.value}</span>`,
            tooltip: '画质切换',
            click: () => { showQualityPanel.value = !showQualityPanel.value; showGainPanel.value = false; showEpPanel.value = false; showEnhancementPanel.value = false }
        })
    }
    return list
}

function buildSettings() {
    const gainSelector = boostSteps.map(step => ({
        value: step,
        name: `gain-${step}`,
        default: Math.abs(gainBoost.value - step) < 0.01,
        html: `${Math.round(step * 100)}%`
    }))
    const enhancementSelector = [
        ...enhancementModes.map(mode => ({
            value: mode.value,
            name: `enhancement-${mode.value}`,
            default: preferredMode.value === mode.value && !preferredInterpolation.value,
            html: mode.label
        })),
        {
            value: 'advanced',
            name: 'enhancement-advanced',
            html: '高级设置…'
        }
    ]
    return [
        {
            name: 'gainBoostSettings',
            html: '音量增强',
            width: 200,
            tooltip: gainLabel.value,
            selector: gainSelector,
            onSelect(item) {
                void selectGain(Number(item.value))
                return item.html
            }
        },
        {
            name: 'videoEnhancementSettings',
            html: '画面增强',
            width: 200,
            tooltip: preferredMode.value === 'off' ? '关闭' : enhancementModes.find(mode => mode.value === preferredMode.value)?.label || '关闭',
            selector: enhancementSelector,
            onSelect(item) {
                if (item.value === 'advanced') {
                    this.setting.show = false
                    showEnhancementPanel.value = true
                    showGainPanel.value = false
                    showEpPanel.value = false
                    showQualityPanel.value = false
                    return '高级设置'
                }
                void setEnhancement(item.value, preferredInterpolation.value)
                return item.html
            }
        },
        {
            name: 'signalBoostSettings',
            html: '流媒体增强',
            width: 200,
            tooltip: signalBoostLabel.value,
            selector: [
                { value: true, name: 'signal-boost-on', default: signalBoostEnabled.value, html: '增强' },
                { value: false, name: 'signal-boost-off', default: !signalBoostEnabled.value, html: '标准' }
            ],
            onSelect(item) {
                setSignalBoost(item.value === true || item.value === 'true')
                return item.html
            }
        }
    ]
}

function onEpisodeSelect(ep) {
    showEpPanel.value = false
    emit('selectEpisode', ep)
}

// 选择最优音频轨道：优先 AAC（hls.js 不支持 opus/webm）
function selectBestAudioTrack(hls) {
    if (!hls || !hls.audioTracks || hls.audioTracks.length === 0) return
    // 优先找 AAC（mp4a）轨道
    let bestIdx = 0
    for (let i = 0; i < hls.audioTracks.length; i++) {
        const t = hls.audioTracks[i]
        const codec = (t.codec || t.type || '').toLowerCase()
        if (codec.includes('mp4a') || codec.includes('aac') || codec.includes('audio/mp4')) {
            bestIdx = i
            break
        }
    }
    // 只在需要切换时才设置
    if (hls.audioTrack !== bestIdx) {
        hls.audioTrack = bestIdx
    }
}

// ===== m3u8 (hls.js) =====
function playM3u8(video, url, artInstance) {
    if (Hls.isSupported()) {
        if (artInstance.hls) { try { artInstance.hls.destroy() } catch (e) {} }
        const isLive = props.playType === 'live' || /live|stream|rtmp|twitch|ttvnw|kick|googlevideo/i.test(url)
        const boosted = signalBoostEnabled.value
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false, // YouTube 直播关闭低延迟模式，避免音频丢失
            // 直播低延迟：播放头贴近直播边缘（liveSyncDurationCount=2 ≈ 4-6s 延迟，20→8 收紧最大容忍）
            maxBufferLength: isLive ? (boosted ? 28 : 20) : (boosted ? 60 : 30),
            backBufferLength: isLive ? (boosted ? 12 : 10) : (boosted ? 30 : 15),
            maxBufferSize: boosted ? 120 * 1000 * 1000 : 60 * 1000 * 1000,
            maxBufferHole: boosted ? 0.35 : 0.5,
            liveSyncDurationCount: isLive ? 2 : undefined,
            liveMaxLatencyDurationCount: isLive ? 8 : undefined,
            liveDurationInfinity: false,
            // 强制加载音频轨道
            forceKeyFrameOnDiscontinuity: true,
            startFragPrefetch: boosted,
            fragLoadingMaxRetry: boosted ? 10 : 6,
            fragLoadingRetryDelay: boosted ? 700 : 1000,
            manifestLoadingMaxRetry: boosted ? 7 : 4,
            manifestLoadingRetryDelay: boosted ? 700 : 1000,
            levelLoadingMaxRetry: boosted ? 7 : 4,
            levelLoadingRetryDelay: boosted ? 700 : 1000,
            // 确保音频和视频同步
            appendErrorMaxRetry: boosted ? 10 : 6
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        artInstance.hls = hls
        artInstance.on('destroy', () => { try { hls.destroy() } catch (e) {} })

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
            const list = (data.levels || [])
                .map((lv, idx) => ({
                    index: idx,
                    height: lv.height || 0,
                    bitrate: lv.bitrate || 0,
                    label: lv.height ? `${lv.height}P` : (lv.bitrate ? `${Math.round(lv.bitrate / 1000)}kbps` : `线路${idx + 1}`)
                }))
                .sort((a, b) => b.height - a.height)
            addQualitySetting(artInstance, hls, list)
            // 有独立 audioUrl 时由 DASH 音频同步处理，hls.js 只负责视频
            if (!props.audioUrl) selectBestAudioTrack(hls)
        })
        // 音频轨道列表更新时也确保选中
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
            if (!props.audioUrl) selectBestAudioTrack(hls)
        })
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (!data.fatal) return
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                try { hls.startLoad() } catch (e) {}
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                try { hls.recoverMediaError() } catch (e) {}
            } else {
                showError('播放失败：' + (data.details || '致命错误'))
            }
        })
        installSignalRecovery(video, artInstance, () => {
            try {
                if (hls.media !== video) hls.attachMedia(video)
                hls.startLoad(Math.max(0, Number(video.currentTime) || 0))
            } catch (e) {}
        })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
    } else {
        showError('当前环境不支持 HLS 播放')
    }
}

// 动态添加画质设置（hls 多清晰度时）
function addQualitySetting(artInstance, hls, levels) {
    if (levels.length < 2) return
    try {
        artInstance.setting.remove('quality')
        artInstance.setting.add({
            name: 'quality',
            html: '画质',
            width: 200,
            tooltip: '自动',
            selector: [
                { html: '自动', level: -1, default: true },
                ...levels.map(lv => ({ html: lv.label, level: lv.index }))
            ],
            onSelect(item) {
                hls.currentLevel = item.level
                return item.html
            }
        })
    } catch (e) { /* 忽略 */ }
}

// ===== FLV / 直播 (mpegts.js) =====
function playFlv(video, url, artInstance) {
    if (!mpegts.isSupported()) {
        showError('当前环境不支持 FLV 播放（需 MSE 支持）')
        return
    }
    const isLiveStream = props.playType === 'live' || (props.playType === 'flv' && /live|stream/i.test(url))
    const boosted = signalBoostEnabled.value
    const flvPlayer = mpegts.createPlayer({
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
        stashInitialSize: isLiveStream ? (boosted ? 2048 : 1024) : (boosted ? 768 : 256),
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 10,
        autoCleanupMinBackwardDuration: 5,
        liveBufferLatencyChasing: isLiveStream,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 1,
        liveSync: isLiveStream,
        lazyLoad: false,
        lazyLoadMaxDuration: boosted ? 120 : 60,
        fixAudioTimestampGap: true,
        fetchOptions: { mode: 'cors' },
        // 修复部分直播流 seek 越界
        rangeLoadZeroStart: isLiveStream,
        // mpegts.js 特有：重用重定向后的 URL（避免重复重定向）
        reuseRedirectedURL: true
    })
    artInstance.flv = flvPlayer
    artInstance.on('destroy', () => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
        try {
            flvPlayer.pause()
            flvPlayer.unload()
            flvPlayer.detachMediaElement()
            flvPlayer.destroy()
        } catch (e) {}
    })
    flvPlayer.attachMediaElement(video)
    let flvReady = false
    let flvLoadFailed = false
    // 加载超时检测：12 秒未就绪则报错，避免一直卡住
    flvTimer = setTimeout(() => {
        if (!flvReady && !flvLoadFailed) {
            flvLoadFailed = true
            showError('FLV 直播流连接超时（12秒未收到数据），可能是不支持的编码（H.265）或 CDN 防盗链')
            try { flvPlayer.pause() } catch (e) {}
        }
    }, 12000)
    flvPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
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
        showError('FLV 播放失败：' + (errDetail || errType))
    })
    flvPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
        // Download completion means bytes arrived, not that buffered playback ended.
        // Native video:ended handles the actual end of playback.

    })
    flvPlayer.on(mpegts.Events.MEDIA_INFO, (info) => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
        flvReady = true
        // H.265 检测提示（Chromium MSE 可能不支持解码）
        if (info?.videoCodec && /hevc|h265|265/i.test(info.videoCodec)) {
            console.warn('[FLV] 检测到 H.265 编码，当前环境可能不支持 MSE H.265 解码')
        }
    })
    installSignalRecovery(video, artInstance, () => {
        try {
            flvPlayer.pause()
            flvPlayer.unload()
            flvPlayer.load()
        } catch (e) {}
    })
    const onMeta = () => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
        flvReady = true
        video.removeEventListener('loadedmetadata', onMeta)
    }
    video.addEventListener('loadedmetadata', onMeta)
    flvPlayer.load()
    if (props.autoplay) {
        flvPlayer.play().catch(() => {})
    }
}

// ===== DASH 音频初始化与同步（B站高画质流音视频分离）=====
function destroyDashAudio() {
    if (dashAudioHls) { try { dashAudioHls.destroy() } catch (e) {} dashAudioHls = null }
    if (dashAudioEl) {
        const v = art?.video
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
        if (h && h.syncAudioStall) dashAudioEl.removeEventListener('waiting', h.syncAudioStall)
        try { dashAudioEl.pause(); dashAudioEl.src = ''; dashAudioEl.load() } catch (e) {}
        if (graphDashEl === dashAudioEl) {
            try { dashSourceNode?.disconnect() } catch (e) {}
            dashSourceNode = null
            graphDashEl = null
        }
        dashAudioEl = null
    }
}

// YouTube HLS 音频的 hls.js 实例（独立于视频的 hls.js）
let dashAudioHls = null

function initDashAudio() {
    destroyDashAudio()
    if (!props.audioUrl) return
    const v = art?.video
    if (!v) return
    dashAudioEl = new Audio()
    // 在设置 src 前允许 Web Audio 读取音轨，避免无 CORS 的媒体被增益图静音。
    dashAudioEl.crossOrigin = 'anonymous'
    dashAudioEl.preload = 'auto'
    dashAudioEl.volume = v.volume
    dashAudioEl.muted = v.muted

    // 判断音频 URL 是否是 m3u8（YouTube HLS 直播的音频是独立 m3u8）
    // 注意 YT 音频 URL 可能是 rr*.googlevideo.com/videoplayback?...m3u8...（m3u8 藏在 query 里），
    // 只要域名是 googlevideo 且 query 含 m3u8 也按 HLS 处理，否则原生 <audio> 播不了 HLS
    const isM3u8Audio = /\.m3u8(\?|$|#)/i.test(props.audioUrl) ||
        /manifest\.googlevideo\.com/i.test(props.audioUrl) ||
        (/googlevideo/i.test(props.audioUrl) && /m3u8/i.test(props.audioUrl))
    if (isM3u8Audio && Hls.isSupported()) {
        // 用 hls.js 加载 m3u8 音频流（直播时同样贴近直播边缘，避免音视频延迟差触发频繁纠偏）
        dashAudioHls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 20,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 8
        })
        dashAudioHls.on(Hls.Events.FRAG_PARSED, () => { if (dashAudioEl && !dashAudioEl.dataset.done) dashAudioEl.dataset.done = '1' })
        dashAudioHls.loadSource(props.audioUrl)
        dashAudioHls.attachMedia(dashAudioEl)
        dashAudioHls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                try { dashAudioHls.startLoad() } catch (e) {}
            }
        })
    } else {
        // DASH fMP4 / 直链音频：用 hls.js 无法解析 fMP4，交给原生 <audio>
        dashAudioEl.src = props.audioUrl
        dashAudioEl.load()
        dashAudioEl.addEventListener('error', (e) => {
            console.warn('[DASH音频] 原生<audio>加载失败:', props.audioUrl?.slice(0, 80))
        })
    }

    // === 同步策略：以视频为准，音频跟随（直播和视频统一逻辑）===
    const syncPlay = () => { if (dashAudioEl) dashAudioEl.play().catch(() => {}) }
    const syncPause = () => { if (dashAudioEl) dashAudioEl.pause() }
    const syncSeek = () => {
        if (!dashAudioEl) return
        // 跳转跨度大（跨越远了）：音频重新缓冲需要时间，转圈等待对齐后再继续，
        // 避免出现"画面已经走到新位置、音频还在慢慢追"的长时间无声
        if (Math.abs(dashAudioEl.currentTime - v.currentTime) > RESYNC_DRIFT_THRESHOLD) {
            requestResync()
            return
        }
        try {
            dashAudioEl.currentTime = v.currentTime
            // 大跳转后音频需要重新缓冲：确保音频跟随播放状态，避免"画面追上音频没跟上"
            if (!v.paused) dashAudioEl.play().catch(() => {})
        } catch (e) {}
    }
    const syncVolume = () => { if (dashAudioEl) { dashAudioEl.volume = v.volume; dashAudioEl.muted = v.muted } }
    const syncRate = () => { if (dashAudioEl) dashAudioEl.playbackRate = v.playbackRate }
    // 漂移阈值：0.5s 兼顾直播和视频，避免过松或过紧；超过 1.5s 走转圈等待对齐流程
    const syncDrift = () => {
        if (!dashAudioEl) return
        const drift = dashAudioEl.currentTime - v.currentTime
        if (Math.abs(drift) > RESYNC_DRIFT_THRESHOLD) {
            requestResync()
            return
        }
        if (Math.abs(drift) > 0.5) {
            try { dashAudioEl.currentTime = v.currentTime } catch (e) {}
        }
    }
    // 音频中途缓冲不足（网络抖动/音频源慢）：暂停视频转圈等待，音频恢复后自动继续。
    // requestResync 内部用 isResyncing 防重入，转圈期间音频自身的 waiting 事件不会再触发暂停
    const syncAudioStall = () => { if (v && !v.paused && !v.ended) requestResync() }

    v.addEventListener('play', syncPlay)
    v.addEventListener('pause', syncPause)
    v.addEventListener('seeked', syncSeek)
    // 只在 seeked（跳转完成）时同步一次：seeking+seeked 双次设置会让音频重复重启缓冲，拉长等待
    v.addEventListener('volumechange', syncVolume)
    v.addEventListener('ratechange', syncRate)
    v.addEventListener('timeupdate', syncDrift)
    v.addEventListener('waiting', syncPause)
    v.addEventListener('playing', syncPlay)
    dashAudioEl.addEventListener('waiting', syncAudioStall)
    dashAudioEl._syncHandlers = { syncPlay, syncPause, syncSeek, syncVolume, syncRate, syncDrift, syncAudioStall }
    // 音量增强已激活时，DASH 音频也接入增益图
    if (audioCtx || gainBoost.value > 1) ensureAudioGraph()
}

// ===== 播放器实例生命周期 =====
let enhancementRevision = 0
async function setEnhancement(mode, interpolate, restore = false) {
    if (enhancementBusy.value || !art) return
    if (!restore) { preferredMode.value = mode; preferredInterpolation.value = interpolate; saveEnhancement() }
    const instance = art, revision = ++enhancementRevision
    enhancementBusy.value = true
    enhancementHandle.value?.stop(); enhancementHandle.value = null; enhancementStatus.value = null
    enhancementMode.value = 'off'; frameInterpolation.value = false
    try {
        if (mode === 'off' && !interpolate) { compareOriginal.value = false; return }
        const handle = await createVideoEnhancement({ video: instance.video, container: instance.template.$player, mode, interpolate,
            onStatus: status => { if (revision === enhancementRevision) enhancementStatus.value = status },
            onError: message => {
                if (revision !== enhancementRevision) return
                enhancementHandle.value = null; enhancementMode.value = 'off'; frameInterpolation.value = false; enhancementStatus.value = null
                compareOriginal.value = false
                instance.notice.show = message
                // Only a source dimension change warrants rebuilding automatically.
                // Driver failure and overload keep the original video without a retry loop.
                if (message === '视频分辨率已变化，请重新开启增强') queueMicrotask(restoreEnhancement)
            }
        })
        if (revision !== enhancementRevision || art !== instance) { handle.stop(); return }
        enhancementHandle.value = handle; enhancementMode.value = mode; frameInterpolation.value = interpolate
        handle.setComparison(compareOriginal.value ? comparePosition.value : null)
        instance.notice.show = interpolate ? '已开启运动补偿补帧；增加约一帧画面延迟' : '已开启 Anime4K 超分'
    } catch (error) { if (art === instance) instance.notice.show = error.message || '画面增强开启失败' }
    finally { if (revision === enhancementRevision) enhancementBusy.value = false }
}
function restoreEnhancement() {
    if (!enhancementHandle.value && !enhancementBusy.value && (preferredMode.value !== 'off' || preferredInterpolation.value)) {
        void setEnhancement(preferredMode.value, preferredInterpolation.value, true)
    }
}
function resolveArtType(url) {
    const pt = props.playType
    // URL 优先判断：m3u8/FLV 以实际地址为准
    if (/\.m3u8(\?|$|#)/i.test(url) || pt === 'm3u8') return 'm3u8'
    if (/\.flv(\?|$|#)/i.test(url) || pt === 'flv') return 'flv'
    // playType='live' 时根据 URL 判断：真正的 HLS 走 m3u8，其他（含 YouTube DASH）走 direct
    // 注意：YouTube DASH URL (googlevideo) 是 fragmented MP4，不是 m3u8，不能用 hls.js 播放
    if (pt === 'live') return /\.m3u8(\?|$|#)/i.test(url) || /\/hls\//i.test(url) ? 'm3u8' : ''
    return ''
}

async function destroyPlayer() {
    stopLoadWatchdog(); stopLoadWatchdog = () => {}
    enhancementRevision++; enhancementBusy.value = false
    enhancementHandle.value?.stop(); enhancementHandle.value = null
    enhancementMode.value = 'off'; frameInterpolation.value = false; enhancementStatus.value = null
    compareOriginal.value = false; comparePosition.value = 50
    showEnhancementPanel.value = false
    liveBadge.value = false
    if (!art) return destroying
    const inst = art
    clearTimeout(resyncTimer)
    resyncTimer = null
    isResyncing = false
    syncBuffering.value = false
    destroyDashAudio()
    try { videoSourceNode?.disconnect() } catch (e) {}
    videoSourceNode = null
    graphVideoEl = null
    art = null
    playerEl.value = null
    if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
    destroying = nextTick().then(() => { try { inst.destroy() } catch {} })
    return destroying
}

async function createPlayer(src) {
    src = normalizeLocalFileUrl(src)
    const version = ++playerVersion
    await destroyPlayer()
    if (disposed || version !== playerVersion || !src || !artContainerEl.value) return
    playerError.value = ''
    showEpPanel.value = false
    showQualityPanel.value = false
    showEnhancementPanel.value = false
    // 画质档位随新流重置：父层指定档优先，否则取最高档
    activeQn.value = props.currentQn || (props.qualities[0]?.qn || 0)

    const artType = resolveArtType(src)

    art = new Artplayer({
        container: artContainerEl.value,
        url: src,
        // direct（本地视频/MV直链）时必须传空字符串：
        // ArtPlayer 5.x 对 undefined 的 option.type 会抛 TypeError 导致播放器创建失败
        type: artType || '',
        // 必须在 ArtPlayer 设置 src 前设置；事后接入 Web Audio 无法消除媒体污染。
        moreVideoAttr: { crossOrigin: 'anonymous', preload: signalBoostEnabled.value ? 'auto' : 'metadata' },
        customType: {
            m3u8: playM3u8,
            flv: playFlv
        },
        // isLive 恒为 false：ArtPlayer 的 isLive 会隐藏进度条，
        // URL 含 live/stream 字样的点播流曾被误判为直播导致无进度条。
        // 真直播 duration=Infinity 时进度条自动不可 seek，且下方 liveBadge 会显示 LIVE 标识
        isLive: false,
        autoplay: props.autoplay,
        volume: 0.8,
        theme: '#c20c0c',
        lang: 'zh-cn',
        setting: true,
        settings: buildSettings(),
        playbackRate: true,
        aspectRatio: true,
        screenshot: true,
        pip: true,
        fullscreen: true,
        // 不启用 fullscreenWeb（网页全屏）：Electron 下与 Teleport 遮罩层冲突，
        // 点击后黑屏且无法退出；窗口全屏/系统全屏已够用
        hotkey: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        miniProgressBar: true,
        controls: buildControls(),
        // 弹幕插件（B站TV）：滚动/顶部/底部，防重叠，随倍速同步
        plugins: [
            ArtplayerDanmuku({
                danmaku: props.danmaku,
                speed: 6,
                opacity: 0.9,
                fontSize: 22,
                antiOverlap: true,
                synchronousPlayback: true,
                visible: danmakuOn.value,
                // Keep the emitter in the shared control row until the player is genuinely narrow.
                width: 640
            })
        ]
    })

    // 弹幕插件就绪后恢复隐藏状态（visible 仅在 emit 时生效，初始隐藏需手动 hide）
    if (!danmakuOn.value) {
        nextTick(() => { try { art?.plugins?.artplayerPluginDanmuku?.hide() } catch (e) {} })
    }

    // 遮罩层 Teleport 到 $player 内（全屏时仍可见）
    playerEl.value = art.template.$player
    const disposePreview = installSeekPreview(art)
    art.on('destroy', disposePreview)
    // ResizeObserver also follows fullscreen and sidebars, unlike viewport media queries.
    const layoutInstance = art
    const layoutObserver = new ResizeObserver(([entry]) => {
        layoutInstance.template.$player.classList.toggle('avp-compact', entry.contentRect.width < 680)
        layoutInstance.template.$player.classList.toggle('avp-has-danmaku', props.danmaku.length > 0)
    })
    layoutObserver.observe(playerEl.value)
    art.on('destroy', () => layoutObserver.disconnect())
    art.on('video:loadeddata', restoreEnhancement)
    // A new resolution needs new GPU textures; preserve the user's requested mode.
    art.on('video:loadedmetadata', () => {
        enhancementRevision++; enhancementBusy.value = false
        enhancementHandle.value?.stop(); enhancementHandle.value = null; enhancementStatus.value = null
    })
    const restoreAfterResize = () => {
        if (enhancementHandle.value && (enhancementHandle.value.sourceWidth !== layoutInstance.video.videoWidth || enhancementHandle.value.sourceHeight !== layoutInstance.video.videoHeight)) {
            enhancementRevision++; enhancementBusy.value = false
            enhancementHandle.value.stop(); enhancementHandle.value = null; enhancementStatus.value = null
        }
        restoreEnhancement()
    }
    // ArtPlayer does not forward the media element's resize event.
    layoutInstance.video.addEventListener('resize', restoreAfterResize)
    layoutInstance.on('destroy', () => layoutInstance.video.removeEventListener('resize', restoreAfterResize))

    // 直播检测：duration 无限大 → 真直播，显示 LIVE 标识
    art.on('video:durationchange', () => {
        const d = art?.video?.duration
        liveBadge.value = (d === Infinity || (typeof d === 'number' && d > 86400 * 365))
    })

    art.on('ready', () => {
        emit('ready')
        // 增益已激活时为新 video 元素重新接线
        if (audioCtx || gainBoost.value > 1) ensureAudioGraph()
        // 续播：有记忆位置且未接近结尾时自动跳转
        if (props.resumeKey) {
            try {
                const saved = Number(localStorage.getItem('art-resume:' + props.resumeKey) || 0)
                const dur = art.video?.duration || 0
                if (saved > 20 && dur && saved < dur - 15) {
                    art.seek(saved)
                    const m = Math.floor(saved / 60), s = Math.floor(saved % 60)
                    art.notice.show = `已从 ${m}:${String(s).padStart(2, '0')} 续播`
                }
            } catch (e) {}
        }
    })
    // 点击播放器空白处时收起各面板

    // 跳转进度后（拖进度条/续播/点选集）：清掉上一时间戳仍在飘的旧弹幕，
    // 按新位置的时间戳重新对齐发射。弹幕插件 seek 时不会自动清屏，
    // 否则开头发射的弹幕会残留漂移到别的进度位置（"跳别处开头弹幕还飘着"）。
    art.on('video:seeked', () => {
        const dk = art?.plugins?.artplayerPluginDanmuku
        if (!dk || !props.danmaku.length) return
        try {
            const cur = Math.max(0, Number(art?.currentTime) || 0)
            // 预读误差：保留当前时间戳前 1 秒的弹幕，避免跳跃后首屏漏弹
            const future = props.danmaku.filter(d => Number(d?.time || 0) >= cur - 1)
            // 更换数据源后无参 load()：插件内部会 reset + 清空画布 + 按当前时间戳重排发射队列
            if (dk.option) dk.option.danmuku = future
            dk.load()
        } catch (e) {}
    })

    art.on('video:ended', () => {
        // 播完清除续播记忆
        try { if (props.resumeKey) localStorage.removeItem('art-resume:' + props.resumeKey) } catch (e) {}
        emit('ended')
    })
    // 续播位置记录：5 秒节流（片头 20s 内/片尾 15s 内不记）
    let resumeSaveTimer = 0
    const resumeInstance = art
    const resumeKey = props.resumeKey
    art.on('destroy', () => clearTimeout(resumeSaveTimer))
    art.on('video:timeupdate', () => {
        if (!resumeKey || resumeSaveTimer) return
        resumeSaveTimer = setTimeout(() => {
            resumeSaveTimer = 0
            try {
                const v = resumeInstance?.video
                if (!v || !v.duration || v.duration === Infinity) return
                const cur = v.currentTime || 0
                if (cur > 20 && cur < v.duration - 15) localStorage.setItem('art-resume:' + resumeKey, String(Math.floor(cur)))
                else localStorage.removeItem('art-resume:' + resumeKey)
            } catch (e) {}
        }, 5000)
    })
    const watchedInstance = art
    stopLoadWatchdog = installMediaLoadWatchdog(art.video, message => {
        if (disposed || art !== watchedInstance || version !== playerVersion || playerError.value) return
        try { watchedInstance.pause() } catch {}
        showError(message)
    }, { timeoutMs: props.loadTimeoutMs })
    art.on('video:error', () => {
        if (!playerError.value) showError('视频加载失败，请重试或更换线路')
    })
    art.on('video:playing', () => {
        if (audioCtx || gainBoost.value > 1) ensureAudioGraph()
        emit('playing')
    })

    // DASH 音视频分离同步
    initDashAudio()
}

// 监听 src 变化（切集 / 换源）
watch(() => props.src, (newSrc) => {
    if (!newSrc) {
        playerVersion++
        destroyPlayer()
        return
    }
    nextTick(() => createPlayer(newSrc))
})

// 仅 audioUrl 变化（src 不变）时重挂 DASH 音频
watch(() => props.audioUrl, () => {
    if (art && props.src) initDashAudio()
})

// 弹幕数据后到（异步拉取完成）或更新：load() 换弹幕源，无需重建播放器
// 显隐交给插件自带设置面板（"显示弹幕"开关），此处只负责喂数据
// 音量增强档位变化：同步控制条按钮标签
watch(gainBoost, () => {
    const setting = art?.setting?.find('gainBoostSettings')
    if (setting) art.setting.update({ name: 'gainBoostSettings', tooltip: gainLabel.value })
})

watch(() => props.danmaku, (list) => {
    const dk = art?.plugins?.artplayerPluginDanmuku
    if (!dk || !art) return
    if ((list || []).length === 0) return
    // 同步到插件数据源：跳转后无参 load() 需引用最新弹幕列表
    if (dk.option) dk.option.danmuku = list
    dk.load(list).catch(() => {})
}, { deep: false })

onMounted(() => {
    if (props.src) nextTick(() => createPlayer(props.src))
})

onBeforeUnmount(() => {
    disposed = true
    playerVersion++
    destroyPlayer()

    // 清理 Web Audio API
    if (videoSourceNode) { try { videoSourceNode.disconnect() } catch (e) {} videoSourceNode = null }
    if (dashSourceNode) { try { dashSourceNode.disconnect() } catch (e) {} dashSourceNode = null }
    if (gainNode) { try { gainNode.disconnect() } catch (e) {} gainNode = null }
    if (audioCtx) { try { audioCtx.close() } catch (e) {} audioCtx = null }
    graphVideoEl = null
    graphDashEl = null
})

defineExpose({ get art() { return art } })
</script>

<template>
    <div class="art-player-wrap">
        <!-- ArtPlayer 挂载点 -->
        <div class="art-container" ref="artContainerEl"></div>

        <!-- 遮罩层 Teleport 进 ArtPlayer 根节点（全屏时仍可见） -->
        <Teleport v-if="playerEl" :to="playerEl">
            <!-- 集数提示 -->
            <div v-if="badge && !playerError" class="avp-badge">{{ badge }}</div>

            <!-- 直播标识（duration 无限大的真直播流） -->
            <div v-if="liveBadge && !playerError" class="avp-live-badge">
                <span class="avp-live-dot"></span>LIVE
            </div>

            <div v-if="compareOriginal && enhancementHandle && !playerError" class="avp-compare-overlay" @click.stop>
                <div class="avp-compare-labels" aria-hidden="true"><span>原画</span><span>增强</span></div>
                <div class="avp-compare-divider" :style="{ left: `${comparePosition}%` }" aria-hidden="true">
                    <span><ChevronsLeftRight :size="18" /></span>
                </div>
                <input
                    class="avp-compare-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    :value="comparePosition"
                    aria-label="原画与增强画面对比分割位置"
                    @input="updateEnhancementComparison($event.target.value)"
                />
            </div>

            <!-- 音视频同步缓冲指示（大跳转/音频缓冲不足时转圈等待对齐） -->
            <div v-if="syncBuffering && !playerError" class="avp-sync-mask" @click.stop>
                <div class="avp-sync-spinner"></div>
                <p>音视频同步中…</p>
            </div>

            <!-- 所有分区共用选集抽屉 -->
            <VideoEpisodeDrawer
                :open="showEpPanel && !playerError"
                :episodes="episodes"
                :current-episode="currentEpisode"
                :title="episodeTitle"
                :cover="episodeCover"
                :local-mode="localMode"
                @close="showEpPanel = false"
                @select="onEpisodeSelect"
            />

            <!-- 画质面板（B站TV 多档位，与选集面板互斥） -->
            <transition name="avp-slide">
                <div v-if="showQualityPanel && !playerError" class="avp-ep-panel avp-quality-panel" @click.stop>
                    <div class="avp-ep-header">
                        <span>画质 ({{ qualities.length }})</span>
                        <button class="avp-ep-close" aria-label="关闭画质选择" @click="showQualityPanel = false"><X :size="14" /></button>
                    </div>
                    <transition-group name="avp-qual" tag="div" class="avp-ep-list avp-quality-list">
                        <button
                            v-for="q in qualities"
                            :key="q.qn"
                            class="avp-ep-item"
                            :class="{ active: q.qn === activeQn }"
                            @click="switchQuality(q)"
                        >{{ q.label }}</button>
                    </transition-group>
                </div>
            </transition>

            <!-- 音量增强面板（与选集/画质同款弹出样式，档位 100%~1000%） -->
            <transition name="avp-slide">
                <div v-if="showGainPanel && !playerError" class="avp-ep-panel avp-quality-panel avp-gain-panel" @click.stop>
                    <div class="avp-ep-header">
                        <span>音量增强</span>
                        <button class="avp-ep-close" aria-label="关闭音量增强" @click="showGainPanel = false"><X :size="14" /></button>
                    </div>
                    <div class="avp-ep-list avp-quality-list">
                        <button
                            v-for="s in boostSteps"
                            :key="s"
                            class="avp-ep-item"
                            :class="{ active: Math.abs(gainBoost - s) < 0.01 }"
                            @click="selectGain(s)"
                        >{{ Math.round(s * 100) }}%</button>
                    </div>
                </div>
            </transition>

            <transition name="avp-slide">
                <div v-if="showEnhancementPanel && !playerError" class="avp-ep-panel avp-quality-panel avp-enhancement-panel" @click.stop>
                    <div class="avp-ep-header"><span>画面增强</span><button class="avp-ep-close" aria-label="关闭画面增强" @click="showEnhancementPanel = false"><X :size="14" /></button></div>
                    <div class="avp-enhancement-body">
                    <div class="avp-ep-list avp-quality-list">
                        <button v-for="mode in enhancementModes" :key="mode.value" class="avp-ep-item" :class="{ active: enhancementMode === mode.value }" :disabled="enhancementBusy" @click="setEnhancement(mode.value, frameInterpolation)">{{ mode.label }}</button>
                        <button class="avp-ep-item" :class="{ active: frameInterpolation }" :disabled="enhancementBusy" @click="setEnhancement(enhancementMode, !frameInterpolation)">运动补偿补帧 · {{ frameInterpolation ? '开启' : '关闭' }}</button>
                    </div>
                    <button class="avp-info-toggle" role="switch" :aria-checked="showEnhancementInfo" @click="showEnhancementInfo = !showEnhancementInfo">
                        <span>右上角实时信息</span><span class="avp-switch" :class="{ active: showEnhancementInfo }"></span>
                    </button>
                    <button class="avp-info-toggle" role="switch" :aria-checked="compareOriginal" :disabled="!enhancementHandle || enhancementBusy" @click="toggleEnhancementComparison">
                        <span>原画对比</span><span class="avp-switch" :class="{ active: compareOriginal }"></span>
                    </button>
                    <p class="avp-enhancement-note">增强设置自动记忆，切集、切换画质后继续应用。</p>
                    <p class="avp-enhancement-note">{{ enhancementBusy ? '正在编译显卡着色器…' : '本地 WebGPU 处理；最高 4K，低分辨率最多放大 4 倍。补帧以显示器刷新率输出，快速运动可能产生伪影；小窗同样会增加显卡负载。' }}</p>
                    <p v-if="enhancementStatus" class="avp-enhancement-note">输出 {{ enhancementStatus.width }} × {{ enhancementStatus.height }} · 输入 {{ enhancementStatus.sourceFps }} fps · 绘制 {{ enhancementStatus.displayFps }} fps<span v-if="frameInterpolation"> · {{ enhancementStatus.algorithm }}</span></p>
                    </div>
                </div>
            </transition>
            <div v-if="showEnhancementInfo && (enhancementStatus || enhancementBusy)" class="avp-enhancement-info" :class="{ 'with-live': liveBadge }" aria-live="off">
                <strong>{{ enhancementMode === 'off' ? '画面增强' : 'Anime4K' }}<span v-if="frameInterpolation"> · 运动补偿</span></strong>
                <template v-if="enhancementStatus">
                    <span>输入 {{ enhancementStatus.sourceWidth }} × {{ enhancementStatus.sourceHeight }}</span>
                    <span>输出 {{ enhancementStatus.width }} × {{ enhancementStatus.height }}</span>
                    <span>输入 {{ enhancementStatus.sourceFps }} fps · 绘制 {{ enhancementStatus.displayFps }} fps</span>
                </template>
                <span v-else>正在准备增强…</span>
            </div>
            <!-- 错误遮罩 -->
            <div v-if="playerError" class="avp-error-mask" @click.stop>
                <Film :size="36" />
                <p>{{ playerError }}</p>
                <button class="avp-btn-primary" @click.stop="emit('retry')">
                    <RefreshCw :size="14" /> 重试
                </button>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
.avp-quality-panel.avp-enhancement-panel { width: 320px; max-width: calc(100% - 24px); }
.avp-enhancement-note { color: #b9b9c0; font-size: 11px; line-height: 1.65; margin: 10px 14px; }
.art-player-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    max-height: 100%;
    background: #000;
    overflow: hidden;
}
.art-player-wrap:fullscreen { border-radius: 0; }

/* ArtPlayer 撑满 wrapper */
.art-container {
    position: absolute;
    inset: 0;
}
.art-container :deep(.art-video-player) {
    width: 100%;
    height: 100%;
}

/* ===== 自定义控制按钮（文字型）===== */
.art-container :deep(.art-control .avp-text-btn) {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    padding: 0 4px;
    white-space: nowrap;
    line-height: 1;
}
.art-container :deep(.art-control .avp-text-btn.boost-active) {
    color: #ff6b6b;
}

/* Keep the primary controls and danmaku tools on one bottom row whenever space allows. */
.art-container :deep(.art-controls-left),
.art-container :deep(.art-controls-right) {
    flex-shrink: 0 !important;
}
.art-container :deep(.art-video-player) { --art-control-height: 36px; --art-control-icon-size: 28px; }
.art-container :deep(.art-controls) { display: flex; align-items: center; height: 36px; padding: 0; }
.art-container :deep(.art-controls-left) { height: 36px; align-items: center; gap: 5px; }
.art-container :deep(.art-controls-right) { min-width: 0; height: 36px; gap: 5px; align-items: center; justify-content: flex-end; }
.art-container :deep(.art-controls-center) { display: flex !important; flex: 1 1 auto; height: 36px; min-width: 0; padding: 0 6px; }
.art-container :deep(.art-video-player:not(.avp-has-danmaku) .art-controls-center) { display: none !important; }
/* The progress track also has .art-control; size only buttons in the control row. */
.art-container :deep(.art-controls .art-control) { flex-shrink: 0; min-width: 32px; min-height: 34px; margin: 0; }
.art-container :deep(.art-control-time) { padding: 0 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
.art-container :deep(.art-control .avp-text-btn) {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 28px; padding: 0 8px; border-radius: 7px;
    background: rgba(30,32,38,.36); border: 1px solid rgba(255,255,255,.13);
    max-width: 112px; overflow: hidden; text-overflow: ellipsis;
}
.art-container :deep(.art-control:hover .avp-text-btn) { background: rgba(255,255,255,.18); }
.art-container :deep(.avp-compact .art-controls) { display: grid; grid-template-columns: minmax(0,1fr) auto; grid-template-rows: 36px; grid-auto-rows: 36px; gap: 0 4px; height: auto; flex-shrink: 0; }
.art-container :deep(.avp-compact .art-controls-left) { grid-column: 1; grid-row: 1; width: auto; height: 36px; order: 0; }
.art-container :deep(.avp-compact .art-controls-right) { grid-column: 2; grid-row: 1; width: auto; height: 36px; flex-wrap: nowrap; justify-content: flex-end; order: 1; }
.art-container :deep(.avp-compact .art-controls-center) { grid-column: 1 / -1; grid-row: 2; height: 36px; width: 100%; min-width: 0; box-sizing: border-box; order: 2; justify-content: flex-end; padding: 0; }
.art-container :deep(.avp-compact .art-controls-center:empty) { display: none !important; }
.art-container :deep(.avp-compact .art-controls-right .art-control) { margin: 0; min-width: 32px; min-height: 34px; }
.art-container :deep(.avp-compact .art-controls-right .avp-text-btn) { padding: 0 7px; }
.art-container :deep(.avp-compact .avp-ep-panel) { bottom: 100px; max-height: calc(100% - 116px); }
.art-container :deep(.art-control .avp-text-btn.quality-active) { color: #fff; }
.art-container :deep(.avp-seek-preview) { position: absolute; width: 200px; padding: 3px; box-sizing: border-box; background: rgba(22,24,29,.94); border: 1px solid rgba(255,255,255,.22); border-radius: 9px; box-shadow: 0 8px 28px rgba(0,0,0,.4); pointer-events: none; z-index: 1100; overflow: hidden; }
.art-container :deep(.avp-seek-preview[hidden]),
.art-container :deep(.avp-seek-preview [hidden]) { display: none !important; }
.art-container :deep(.avp-seek-preview canvas) { display: block; width: 192px; height: 108px; border-radius: 5px; }
.art-container :deep(.avp-seek-preview > span:last-child) { display: block; color: #fff; padding: 6px 0 3px; font-size: 12px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
.art-container :deep(.avp-seek-preview-loading) { display: grid; place-items: center; width: 192px; height: 108px; color: #c8cad0; background: #202127; font-size: 12px; }

/* ===== 集数提示 ===== */
.avp-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(0, 0, 0, .6);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    z-index: 1000;
    pointer-events: none;
    opacity: 1;
    transition: opacity .25s;
}
.art-player-wrap :deep(.art-video-player:not(.art-hide) ~ *) .avp-badge,
.avp-badge:hover { opacity: 1; }
/* 控制条显示时隐藏集数提示（悬停可见） */
:deep(.art-video-player:hover) .avp-badge { opacity: 0; }

/* ===== 直播标识 ===== */
.avp-live-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 5px;
    background: rgba(194, 12, 12, .92);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 10px;
    border-radius: 4px;
    z-index: 1000;
    pointer-events: none;
}
.avp-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #fff;
    animation: avp-live-blink 1.2s infinite;
}
@keyframes avp-live-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: .25; }
}

/* ===== 音视频同步缓冲指示 ===== */
.avp-sync-mask {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(0, 0, 0, .55);
    color: #fff;
    z-index: 1000;
    pointer-events: none; /* 不挡操作，同步完成后自动消失 */
}
.avp-sync-mask p {
    margin: 0;
    font-size: 13px;
    opacity: .9;
}
.avp-sync-spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, .25);
    border-top-color: #fb7299;
    animation: avp-sync-spin .8s linear infinite;
}
@keyframes avp-sync-spin {
    to { transform: rotate(360deg); }
}

/* ===== 选集面板 ===== */
.avp-ep-panel {
    position: absolute;
    right: 12px;
    bottom: 64px;
    width: 300px;
    max-height: 55%;
    display: flex;
    flex-direction: column;
    background: rgba(0, 0, 0, .92);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, .5);
    z-index: 1000;
    overflow: hidden;
}
.avp-ep-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
}
.avp-ep-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: rgba(255, 255, 255, .08);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    transition: transform .25s, background .15s;
}
.avp-ep-close:hover {
    background: rgba(255, 255, 255, .18);
    transform: rotate(90deg);
}
.avp-ep-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
    padding: 6px 12px 12px;
    overflow-y: auto;
}
.avp-ep-item {
    padding: 7px 4px;
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
.avp-ep-item:hover {
    background: rgba(255, 255, 255, .12);
    border-color: rgba(255, 255, 255, .25);
}
.avp-ep-item.active {
    color: #ff6b6b;
    background: rgba(194, 12, 12, .22);
    border-color: rgba(194, 12, 12, .5);
}
.avp-ep-empty {
    color: #aaa;
    font-size: 12px;
    text-align: center;
    padding: 14px 0;
}

/* ===== 错误遮罩 ===== */
.avp-error-mask {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(0, 0, 0, .85);
    color: #fff;
    z-index: 1001;
    cursor: default;
}
.avp-error-mask p {
    margin: 0;
    font-size: 14px;
    padding: 0 20px;
    text-align: center;
}
.avp-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
.avp-btn-primary:hover { background: #a30a0a; }

/* ===== 过渡动画 ===== */
.avp-slide-enter-active, .avp-slide-leave-active {
    transition: opacity .2s, transform .2s;
}
.avp-slide-enter-from, .avp-slide-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

/* ===== 画质切换 ===== */
.art-container :deep(.art-control .avp-text-btn.quality-active) {
    color: #ff9f9f;
}
/* 画质面板：单列较窄，贴右侧控制条上方 */
/* 音量增强滑条（控制栏内联，100%~1000%） */
.avp-gain-wrap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.avp-gain-slider {
    width: 84px;
    accent-color: #fb7299;
    cursor: pointer;
}
.avp-gain-label {
    font-size: 12px;
    color: #ddd;
    min-width: 34px;
    text-align: right;
}
.avp-gain-label.boost-active { color: #fb7299; font-weight: 600; }

.avp-quality-panel {
    width: 150px;
}
.avp-gain-panel {
    width: 150px;
}
.avp-quality-list {
    grid-template-columns: 1fr;
}
/* Shared glass surfaces; every panel keeps a fixed header and a scrollable body. */
.avp-ep-panel {
    box-sizing: border-box; max-width: calc(100% - 24px); max-height: calc(100% - 88px);
    background: rgba(25,27,33,.86); backdrop-filter: blur(24px) saturate(145%);
    border: 1px solid rgba(255,255,255,.16); border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0,0,0,.4);
}
.avp-ep-header { padding: 12px; border-bottom: 1px solid rgba(255,255,255,.09); }
.avp-ep-close { width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0; }
.avp-ep-close:hover { transform: none; }
.avp-ep-list { min-height: 0; padding: 10px; gap: 7px; scrollbar-width: thin; }
.avp-ep-item { min-height: 34px; padding: 8px 10px; border-radius: 6px; }
.avp-ep-item.active { color: #fff; background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.4); }
.avp-quality-panel, .avp-gain-panel { width: 212px; }
.avp-quality-list .avp-ep-item { text-align: left; white-space: normal; overflow-wrap: anywhere; }
.avp-gain-panel .avp-quality-list { grid-template-columns: repeat(2,minmax(0,1fr)); }
.avp-gain-panel .avp-ep-item { text-align: center; font-variant-numeric: tabular-nums; }
.avp-enhancement-body { min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.avp-enhancement-body .avp-ep-list { overflow: visible; }
.avp-info-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: calc(100% - 20px); margin: 0 10px; padding: 10px; border: 0; border-radius: 6px; background: rgba(255,255,255,.06); color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.avp-info-toggle:disabled { opacity: .45; cursor: not-allowed; }
.avp-switch { width: 30px; height: 18px; border-radius: 12px; background: #62636b; padding: 2px; box-sizing: border-box; flex-shrink: 0; }
.avp-switch::after { content: ''; display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
.avp-switch.active { background: #32a865; }
.avp-switch.active::after { transform: translateX(12px); }
.avp-ep-panel button:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
.avp-ep-item:disabled { opacity: .5; cursor: wait; }
.avp-enhancement-info { position: absolute; top: 12px; right: 12px; max-width: calc(100% - 24px); display: grid; gap: 5px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; background: rgba(25,27,33,.76); backdrop-filter: blur(16px); color: #eee; font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums; pointer-events: none; z-index: 45; }
.avp-enhancement-info.with-live { top: 48px; }
.avp-compare-overlay { position: absolute; inset: 0; z-index: 30; pointer-events: none; }
.avp-compare-labels { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; justify-content: space-between; color: #fff; font-size: 11px; line-height: 1; text-shadow: 0 1px 5px #000; }
.avp-compare-labels span { padding: 6px 8px; border: 1px solid rgba(255,255,255,.24); border-radius: 4px; background: rgba(12,14,18,.68); backdrop-filter: blur(8px); }
.avp-compare-divider { position: absolute; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); background: rgba(255,255,255,.94); box-shadow: 0 0 8px rgba(0,0,0,.7); }
.avp-compare-divider span { position: absolute; top: 50%; left: 50%; display: grid; width: 38px; height: 38px; place-items: center; transform: translate(-50%,-50%); border: 1px solid rgba(255,255,255,.8); border-radius: 50%; background: rgba(20,22,27,.88); color: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.45); }
.avp-compare-slider { position: absolute; top: calc(50% - 22px); left: 0; width: 100%; height: 44px; margin: 0; appearance: none; background: transparent; cursor: ew-resize; pointer-events: auto; }
.avp-compare-slider::-webkit-slider-runnable-track { height: 44px; background: transparent; }
.avp-compare-slider::-webkit-slider-thumb { width: 40px; height: 40px; appearance: none; border: 0; background: transparent; }
.avp-compare-slider::-moz-range-track { height: 44px; background: transparent; }
.avp-compare-slider::-moz-range-thumb { width: 40px; height: 40px; border: 0; background: transparent; }
.avp-compare-slider:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
/* 画质列表项折叠/展开动画 */
.avp-qual-enter-active, .avp-qual-leave-active {
    transition: opacity .18s, transform .18s;
}
.avp-qual-enter-from, .avp-qual-leave-to {
    opacity: 0;
    transform: translateX(10px);
}
.avp-qual-move {
    transition: transform .18s;
}
</style>
