<script setup>
// ArtPlayer 封装的视频播放器（引擎：ArtPlayer 5.x）
// 支持 m3u8 (hls.js) / FLV 直播 (mpegts.js) / 直链 mp4 / DASH 音视频分离
// 功能：选集面板 / 上一集下一集 / 音量增强(Web Audio 增益最高1000%) / 画质切换 / 倍速 / 快捷键
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { Film, RefreshCw, X } from 'lucide-vue-next'

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
const emit = defineEmits(['ended', 'retry', 'ready', 'error', 'prev', 'next', 'selectEpisode', 'playing'])

const artContainerEl = ref(null)
// ArtPlayer 根节点（$player，全屏目标）。遮罩层 Teleport 进去，全屏时仍可见
const playerEl = ref(null)

let art = null
const playerError = ref('')
const showEpPanel = ref(false)
// 真直播标识（duration=Infinity 时显示）
const liveBadge = ref(false)

// ===== 音量增强（Web Audio API 增益节点，可超过系统 100%）=====
const boostSteps = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0]
const gainBoost = ref(parseFloat(localStorage.getItem('art_gain_boost') || localStorage.getItem('bili_gain_boost')) || 1.0)
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

function showError(msg) {
    playerError.value = msg
    emit('error', msg)
}

// ===== 音量增强 =====
// 建立音频图：video(+dash audio) → GainNode → destination
// 实际音量 = ArtPlayer音量(0-1) × gainBoost
function ensureAudioGraph() {
    const video = art?.video
    if (!video) return
    try {
        if (!audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext
            audioCtx = new AudioCtx()
            gainNode = audioCtx.createGain()
            gainNode.gain.value = gainBoost.value
            gainNode.connect(audioCtx.destination)
        }
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
        if (audioCtx.state === 'suspended') audioCtx.resume()
    } catch (e) {
        console.error('initAudioGraph error:', e)
    }
}

// 切换增益倍数：100% → 150% → 200% → 300% → 500% → 1000% → 100%
function cycleGainBoost() {
    const idx = boostSteps.findIndex(s => Math.abs(s - gainBoost.value) < 0.01)
    gainBoost.value = boostSteps[(idx + 1) % boostSteps.length] || 1.0
    localStorage.setItem('art_gain_boost', String(gainBoost.value))
    if (gainBoost.value > 1.0) ensureAudioGraph()
    if (gainNode) gainNode.gain.value = gainBoost.value
    if (art) {
        art.notice.show = `音量增强：${gainLabel.value}`
        // 更新控制条按钮文字
        const dom = art.controls.gainBoost
        if (dom) {
            dom.innerHTML = `<span class="avp-text-btn${gainBoost.value > 1.0 ? ' boost-active' : ''}">${gainLabel.value}</span>`
        }
    }
}

// ===== ArtPlayer 控制按钮 =====
const ICON_PREV = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>'
const ICON_NEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'

function buildControls() {
    const list = []
    // 上一集 / 下一集（有剧集时显示，图标按钮省空间）
    if (props.episodes.length > 0) {
        list.push({
            name: 'prevEp',
            position: 'right',
            index: 5,
            html: ICON_PREV,
            tooltip: '上一集',
            click: () => emit('prev')
        })
        list.push({
            name: 'nextEp',
            position: 'right',
            index: 6,
            html: ICON_NEXT,
            tooltip: '下一集',
            click: () => emit('next')
        })
    }
    // 选集面板
    list.push({
        name: 'episodes',
        position: 'right',
        index: 7,
        html: '<span class="avp-text-btn">选集</span>',
        tooltip: '选集',
        click: () => { showEpPanel.value = !showEpPanel.value }
    })
    // 音量增强
    list.push({
        name: 'gainBoost',
        position: 'right',
        index: 8,
        html: `<span class="avp-text-btn${gainBoost.value > 1.0 ? ' boost-active' : ''}">${gainLabel.value}</span>`,
        tooltip: '音量增强（点击切换）',
        click: () => cycleGainBoost()
    })
    return list
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
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false, // YouTube 直播关闭低延迟模式，避免音频丢失
            // 直播低延迟：播放头贴近直播边缘（liveSyncDurationCount=2 ≈ 4-6s 延迟，20→8 收紧最大容忍）
            maxBufferLength: isLive ? 20 : 60,
            backBufferLength: isLive ? 20 : 30,
            liveSyncDurationCount: isLive ? 2 : undefined,
            liveMaxLatencyDurationCount: isLive ? 8 : undefined,
            liveDurationInfinity: false,
            // 强制加载音频轨道
            forceKeyFrameOnDiscontinuity: true,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4,
            // 确保音频和视频同步
            appendErrorMaxRetry: 6
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
        // 直播流收到 LOADING_COMPLETE 多为 seek 追赶最新时读到缓冲边界，并非结束；
        // 真正的下播是服务器断开连接，会走 ERROR 分支。故仅点播才视为播放完毕。
        if (!isLiveStream) showError('播放完毕')
    })
    flvPlayer.on(mpegts.Events.MEDIA_INFO, (info) => {
        if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
        flvReady = true
        // H.265 检测提示（Chromium MSE 可能不支持解码）
        if (info?.videoCodec && /hevc|h265|265/i.test(info.videoCodec)) {
            console.warn('[FLV] 检测到 H.265 编码，当前环境可能不支持 MSE H.265 解码')
        }
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
        try { dashAudioEl.pause(); dashAudioEl.src = ''; dashAudioEl.load() } catch (e) {}
        if (graphDashEl === dashAudioEl) graphDashEl = null
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
    const syncSeek = () => { if (dashAudioEl) { try { dashAudioEl.currentTime = v.currentTime } catch (e) {} } }
    const syncVolume = () => { if (dashAudioEl) { dashAudioEl.volume = v.volume; dashAudioEl.muted = v.muted } }
    const syncRate = () => { if (dashAudioEl) dashAudioEl.playbackRate = v.playbackRate }
    // 漂移阈值：0.5s 兼顾直播和视频，避免过松或过紧
    const syncDrift = () => {
        if (!dashAudioEl) return
        const drift = dashAudioEl.currentTime - v.currentTime
        if (Math.abs(drift) > 0.5) {
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
    dashAudioEl._syncHandlers = { syncPlay, syncPause, syncSeek, syncVolume, syncRate, syncDrift }
    // 音量增强已激活时，DASH 音频也接入增益图
    if (audioCtx) ensureAudioGraph()
}

// ===== 播放器实例生命周期 =====
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
    liveBadge.value = false
    if (!art) return
    const inst = art
    art = null
    // 先解除 Teleport（遮罩层回到 wrapper 内），再销毁 ArtPlayer DOM
    playerEl.value = null
    await nextTick()
    if (flvTimer) { clearTimeout(flvTimer); flvTimer = null }
    destroyDashAudio()
    try { inst.destroy() } catch (e) {}
}

async function createPlayer(src) {
    await destroyPlayer()
    if (!src || !artContainerEl.value) return
    playerError.value = ''
    showEpPanel.value = false

    const artType = resolveArtType(src)

    art = new Artplayer({
        container: artContainerEl.value,
        url: src,
        // direct（本地视频/MV直链）时必须传空字符串：
        // ArtPlayer 5.x 对 undefined 的 option.type 会抛 TypeError 导致播放器创建失败
        type: artType || '',
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
        controls: buildControls()
    })

    // 遮罩层 Teleport 到 $player 内（全屏时仍可见）
    playerEl.value = art.template.$player

    // 直播检测：duration 无限大 → 真直播，显示 LIVE 标识
    art.on('video:durationchange', () => {
        const d = art?.video?.duration
        liveBadge.value = (d === Infinity || (typeof d === 'number' && d > 86400 * 365))
    })

    art.on('ready', () => {
        emit('ready')
        // 增益已激活时为新 video 元素重新接线
        if (audioCtx) ensureAudioGraph()
    })
    art.on('video:playing', () => emit('playing'))
    art.on('video:ended', () => emit('ended'))
    art.on('video:error', () => {
        if (!playerError.value) showError('视频加载失败，请重试或更换线路')
    })

    // DASH 音视频分离同步
    initDashAudio()
}

// 监听 src 变化（切集 / 换源）
watch(() => props.src, (newSrc) => {
    if (!newSrc) {
        destroyPlayer()
        return
    }
    nextTick(() => createPlayer(newSrc))
})

// 仅 audioUrl 变化（src 不变）时重挂 DASH 音频
watch(() => props.audioUrl, () => {
    if (art && props.src) initDashAudio()
})

onMounted(() => {
    if (props.src) nextTick(() => createPlayer(props.src))
})

onBeforeUnmount(() => {
    destroyPlayer()
    // 清理 Web Audio API
    if (videoSourceNode) { try { videoSourceNode.disconnect() } catch (e) {} videoSourceNode = null }
    if (dashSourceNode) { try { dashSourceNode.disconnect() } catch (e) {} dashSourceNode = null }
    if (gainNode) { try { gainNode.disconnect() } catch (e) {} gainNode = null }
    if (audioCtx) { try { audioCtx.close() } catch (e) {} audioCtx = null }
    graphVideoEl = null
    graphDashEl = null
})

defineExpose({ art })
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

            <!-- 选集面板 -->
            <transition name="avp-slide">
                <div v-if="showEpPanel && !playerError" class="avp-ep-panel" @click.stop>
                    <div class="avp-ep-header">
                        <span>选集 ({{ episodes.length }})</span>
                        <button class="avp-ep-close" @click="showEpPanel = false"><X :size="14" /></button>
                    </div>
                    <div v-if="!episodes.length" class="avp-ep-empty">暂无集数</div>
                    <div v-else class="avp-ep-list">
                        <button
                            v-for="ep in episodes"
                            :key="ep.title"
                            class="avp-ep-item"
                            :class="{ active: currentEpisode?.title === ep.title }"
                            @click="onEpisodeSelect(ep)"
                        >{{ ep.title }}</button>
                    </div>
                </div>
            </transition>

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
</style>
