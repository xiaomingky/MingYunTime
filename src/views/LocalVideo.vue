<script setup>
// 本地视频 + 链接/直播流 播放
// - 本地视频：通过文件对话框导入，扫描元数据
// - 链接/直播流：用户添加 http(s)://...mp4/m3u8/flv 或直播流地址
//   支持：mp4/webm 直链、HLS(m3u8)、FLV；直播流自动识别并标记 LIVE
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { FolderOpen, Play, Trash2, FolderPlus, Film, Clock, Link2, Radio, Plus, Pencil, Check, X, Download, Search, Globe, User, LogOut, RefreshCw, Youtube } from 'lucide-vue-next'
import { downloadVideo, parseVideoUrl, biliLoginQr, biliLoginCheck, biliLoginStatus, biliLogout, youtubeLoginOpen, youtubeLoginClose, youtubeLoginStatus, youtubeLogout, onYoutubeLoginDone } from '../api'
import CustomSelect from '../components/CustomSelect.vue'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const loading = ref(false)
const localVideos = ref(JSON.parse(localStorage.getItem('local_videos') || '[]'))

// 链接/直播流列表
const streams = ref(JSON.parse(localStorage.getItem('video_streams') || '[]'))
// 添加/编辑表单
const showStreamForm = ref(false)
const editingId = ref(null)
const streamForm = ref({ name: '', url: '', type: 'auto' })
const streamTypes = [
    { value: 'auto', label: '自动识别' },
    { value: 'mp4', label: 'MP4/WebM 直链' },
    { value: 'm3u8', label: 'HLS (m3u8)' },
    { value: 'flv', label: 'FLV 流' },
    { value: 'live', label: '直播流（HLS/FLV）' }
]

// 当前活动标签：local | streams | parse
const activeTab = ref('local')

// ===== 网址解析 =====
const parseInput = ref('')
const parseLoading = ref(false)
const parseResults = ref([])  // [{url, type, title, audioUrl?, bili?}]
const parsePageTitle = ref('')
// 正在下载的解析结果 URL（用于禁用按钮）
const parsingDownloadingUrl = ref('')

// ===== B站登录（提升画质） =====
const biliLoggedIn = ref(false)
const biliUserInfo = ref(null)
const showBiliQr = ref(false)
const biliQrUrl = ref('')
const biliQrKey = ref('')
const biliQrStatus = ref('')  // '' | 'waiting' | 'scanned' | 'expired' | 'error'
const biliQrError = ref('')
let biliPollTimer = null

async function loadBiliStatus() {
    try {
        const res = await biliLoginStatus()
        if (res?.success && res.loggedIn) {
            biliLoggedIn.value = true
            biliUserInfo.value = res.userInfo
        } else {
            biliLoggedIn.value = false
            biliUserInfo.value = null
        }
    } catch (e) {}
}

async function openBiliLogin() {
    if (showBiliQr.value) return
    showBiliQr.value = true
    biliQrStatus.value = ''
    biliQrError.value = ''
    try {
        const res = await biliLoginQr()
        if (res?.success) {
            biliQrUrl.value = res.qrcodeUrl
            biliQrKey.value = res.qrcodeKey
            biliQrStatus.value = 'waiting'
            startBiliPoll()
        } else {
            biliQrStatus.value = 'error'
            biliQrError.value = res?.message || '获取二维码失败'
        }
    } catch (e) {
        biliQrStatus.value = 'error'
        biliQrError.value = e.message || '获取二维码失败'
    }
}

function startBiliPoll() {
    stopBiliPoll()
    biliPollTimer = setInterval(async () => {
        try {
            const res = await biliLoginCheck(biliQrKey.value)
            if (res?.loggedIn) {
                stopBiliPoll()
                biliLoggedIn.value = true
                biliUserInfo.value = res.userInfo
                showBiliQr.value = false
                messageStore.success('B站登录成功，解析画质已提升', 3000)
            } else if (res?.status === 'scanned') {
                biliQrStatus.value = 'scanned'
            } else if (res?.status === 'expired') {
                stopBiliPoll()
                biliQrStatus.value = 'expired'
            }
        } catch (e) {}
    }, 2000)
}

function stopBiliPoll() {
    if (biliPollTimer) { clearInterval(biliPollTimer); biliPollTimer = null }
}

function closeBiliQr() {
    showBiliQr.value = false
    stopBiliPoll()
}

async function refreshBiliQr() {
    stopBiliPoll()
    await openBiliLogin()
}

async function logoutBili() {
    if (!await messageStore.confirm('确定退出B站登录？', '退出登录')) return
    try {
        await biliLogout()
        biliLoggedIn.value = false
        biliUserInfo.value = null
        messageStore.success('已退出B站登录')
    } catch (e) { messageStore.error('退出失败') }
}

// 头像加载失败时清空 face，回退到 User 图标
function onAvatarError() {
    if (biliUserInfo.value) biliUserInfo.value = { ...biliUserInfo.value, face: '' }
}

// 二维码图片 URL（用在线 API 生成）
const biliQrImgUrl = computed(() => {
    if (!biliQrUrl.value) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(biliQrUrl.value)}`
})

loadBiliStatus()

// ===== YouTube 登录（官方网页登录，用邮箱/账号，捕获 Cookie 供 yt-dlp） =====
const ytLoggedIn = ref(false)
const ytUserInfo = ref(null)
const showYtLogin = ref(false)
const ytStatus = ref('')  // '' | 'opening' | 'error'
const ytError = ref('')
let ytLoginDoneListener = null

async function loadYtStatus() {
    try {
        const res = await youtubeLoginStatus()
        if (res?.success && res.loggedIn) {
            ytLoggedIn.value = true
            ytUserInfo.value = res.userInfo
        } else {
            ytLoggedIn.value = false
            ytUserInfo.value = null
        }
    } catch (e) {}
}

// 监听主进程登录成功事件，自动刷新状态
function setupYtLoginDoneListener() {
    ytLoginDoneListener = onYoutubeLoginDone(async () => {
        ytStatus.value = ''
        showYtLogin.value = false
        await loadYtStatus()
        if (ytLoggedIn.value) messageStore.success('YouTube已登录，画质已提升', 3000)
    })
}

async function openYtLogin() {
    try {
        const res = await youtubeLoginOpen()
        if (!res?.success) {
            ytStatus.value = 'error'
            ytError.value = (res && res.message) || '打开登录窗口失败'
            return
        }
        // 打开官方网页登录窗口（用邮箱/账号在浏览器里正常登录）
        ytStatus.value = 'opening'
        showYtLogin.value = true
    } catch (e) {
        ytStatus.value = 'error'
        ytError.value = e.message || '打开登录窗口失败'
    }
}

async function closeYtLogin() {
    showYtLogin.value = false
    ytStatus.value = ''
    try { await youtubeLoginClose() } catch (e) {}
    await loadYtStatus()
}

async function logoutYt() {
    if (!await messageStore.confirm('确定退出YouTube登录？', '退出登录')) return
    try {
        await youtubeLogout()
        ytLoggedIn.value = false
        ytUserInfo.value = null
        messageStore.success('已退出YouTube登录')
    } catch (e) { messageStore.error('退出失败') }
}

function onYtAvatarError() {
    if (ytUserInfo.value) ytUserInfo.value = { ...ytUserInfo.value, face: '' }
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text || '')
        messageStore.success('已复制')
    } catch (e) {
        messageStore.error('复制失败，请手动选择复制')
    }
}

loadBiliStatus()
loadYtStatus()
setupYtLoginDoneListener()

const handleParseUrl = async () => {
    const url = parseInput.value.trim()
    if (!url) {
        messageStore.warning('请输入网页地址')
        return
    }
    parseLoading.value = true
    parseResults.value = []
    for (const k in parseGroupOpen) delete parseGroupOpen[k]
    parsePageTitle.value = ''
    try {
        const res = await parseVideoUrl(url)
        if (res?.success) {
            parsePageTitle.value = res.pageTitle || ''
            const list = res.streams || []
            if (list.length === 0) {
                messageStore.warning('未在该页面解析到视频流')
            } else {
                // 统一列出供用户选择，不自动播放
                parseResults.value = list
                messageStore.success(`解析到 ${list.length} 个视频流，请点击播放`)
            }
        } else {
            messageStore.error(res?.message || '解析失败')
        }
    } catch (e) {
        messageStore.error('解析失败: ' + (e.message || e))
    } finally {
        parseLoading.value = false
    }
}

// ===== 画质分组与折叠 =====
// 同一视频的不同画质（仅标题里的画质/分辨率/码率标记不同）归为一组，
// 组内默认只留最高画质、其余折叠；不同命名之间的分组用分割线隔开。
const qualityScore = (s) => {
    const t = ((s.title || '') + ' ' + (s.url || '')).toLowerCase()
    if (/8k/.test(t)) return 4320
    if (/\b4k\b/.test(t)) return 2160
    if (/蓝光8m|蓝光8 /.test(t)) return 4000
    if (/蓝光4m|蓝光4 /.test(t)) return 3500
    if (/蓝光/.test(t)) return 3000
    if (/原画|最佳|best|source|origin|最高|最大/.test(t)) return 2500
    if (/超清/.test(t)) return 2000
    if (/高清/.test(t)) return 1500
    if (/720p/.test(t)) return 720
    if (/标清|540p/.test(t)) return 600
    if (/流畅|极速|240p|360p/.test(t)) return 360
    const m = t.match(/(\d{3,4})p/)
    if (m) return parseInt(m[1], 10)
    const br = t.match(/(\d+(?:\.\d+)?)\s*(mbps|m|kbps|kb)\b/i)
    if (br) {
        const val = parseFloat(br[1])
        const unit = (br[2] || '').toLowerCase()
        return (unit === 'kbps' || unit === 'kb') ? Math.round(val * 0.3) : Math.round(val * 300)
    }
    return 720
}
const sortStreams = (list) => [...list].sort((a, b) => qualityScore(b) - qualityScore(a))

// 提取括号内"结构标识"（协议/线路/来源等非画质信息），作为分组依据；
// 纯画质括号返回空串（表示该括号可整体剥离）。
const groupTag = (inner) => String(inner || '')
    .replace(/[2-8]k|\d{3,4}p|mbps|kbps/ig, '')
    .replace(/\d+(?:\.\d+)?\s*(?:k|mb|p|mbps|kbps)?/ig, '')
    .replace(/蓝光\d*m?|原画|超清|高清|标清|流畅|极速|直播|itag|best|source|origin|最高|最大|全高清|夜月|hd|sd/ig, '')
    .replace(/[^0-9a-z\u4e00-\u9fa5]/ig, '')
    .toUpperCase()

// 按命名 + 结构标识（协议/线路）分组，组内按画质降序
// - 标题括号内含协议/线路（如 [蓝光8M FLV AL]）→ 保留 [FLVAL]，FLV 与 HLS 各自成组，画质在组内折叠
// - 标题括号只有纯画质（如 [1080P]）→ 用流类型二次区分 FLV/HLS
const makeGroups = (list) => {
    const map = new Map()
    for (const s of list) {
        let hasTag = false
        const base = String(s.title || '')
            .replace(/\s*[\[【｛（(]([^\]】｝）)]*)[\]】｝）)]/g, (m, inner) => {
                const tag = groupTag(inner)
                if (tag) { hasTag = true; return ` [${tag}]` }
                return ''
            })
            .replace(/\s+/g, ' ').trim()
        let key = base || String(s.title || '').trim() || '—'
        if (!hasTag && s.type) key = key + ` [${s.type}]`
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(s)
    }
    return [...map.entries()].map(([key, arr]) => ({ key, list: sortStreams(arr) }))
}
const parseGroups = computed(() => makeGroups(parseResults.value))
const parseGroupOpen = reactive({})   // 组 key -> 是否展开该组更多画质
const liveGroups = computed(() => makeGroups(livePickStreams.value))
const liveGroupOpen = reactive({})

const playParsedStream = (s, baseOverride) => {
    const baseName = baseOverride || parsePageTitle.value || '网址解析视频'
    const name = baseOverride ? baseName : (s.title ? `${baseName} - ${s.title}` : baseName)
    playerStore.currentSong = {
        id: 'parse-' + Date.now(),
        name,
        artist: '网址解析',
        al: { name: '网址解析', picUrl: '' },
        duration: 0,
        url: s.url,
        path: ''
    }
    playerStore.currentMvUrl = s.url
    playerStore.currentMvId = null
    playerStore.currentMvTitle = name
    playerStore.currentMvAudioUrl = s.audioUrl || ''  // DASH 流的音频地址，供播放器内下载时合并
    // 根据解析流类型设置播放模式（m3u8/flv/live/direct）
    // YouTube DASH 流（type='mp4'）用 direct 模式：原生 <video> 播放 + 独立 <audio> 同步音频
    // 真正的 HLS/FLV 直播才用 live/flv 模式
    const st = s.type || ''
    const isM3u8 = st === 'm3u8' || /\.m3u8(\?|$|#)/i.test(s.url)
    const isFlv = st === 'flv' || /\.flv(\?|$|#)/i.test(s.url)
    if (s.isLive && isM3u8) playerStore.currentMvPlayType = 'm3u8'
    else if (s.isLive && isFlv) playerStore.currentMvPlayType = 'flv'
    else if (isFlv) playerStore.currentMvPlayType = 'flv'
    else if (isM3u8) playerStore.currentMvPlayType = 'm3u8'
    else playerStore.currentMvPlayType = 'direct'
    playerStore.showMvPlayer = true
    if (playerStore.isPlaying) {
        playerStore.audio.pause()
        playerStore.isPlaying = false
    }
}

// ===== 直播链接解析（表单保存后，点击播放时解析并行弹出选画质/线路）=====
const liveParseUrl = ref('')
const liveParseLoading = ref(false)
const showLivePick = ref(false)
const livePickStreams = ref([])
const livePickTitle = ref('')
const handleLiveParse = async (urlArg) => {
    const url = (urlArg || liveParseUrl.value || '').trim()
    if (!url) { messageStore.warning('链接无效'); return }
    liveParseLoading.value = true
    livePickStreams.value = []
    for (const k in liveGroupOpen) delete liveGroupOpen[k]
    try {
        const res = await parseVideoUrl(url)
        if (res?.success && res.streams?.length) {
            livePickTitle.value = res.pageTitle || ''
            livePickStreams.value = res.streams
            showLivePick.value = true
        } else {
            messageStore.error(res?.message || '未解析到直播流，该链接可能是点播或其他格式')
        }
    } catch (e) {
        messageStore.error('解析失败: ' + (e.message || e))
    } finally {
        liveParseLoading.value = false
    }
}
const playLivePick = (s) => {
    const name = s.title || livePickTitle.value || '直播流'
    playParsedStream(s, name)
    showLivePick.value = false
}

// 下载解析到的视频流（B站 DASH 流会自动合并音频，可选去水印）
const downloadParsedStream = async (s) => {
    if (parsingDownloadingUrl.value) {
        messageStore.info('已有下载任务进行中，请查看下载专区')
        return
    }
    parsingDownloadingUrl.value = s.url
    try {
        const baseName = parsePageTitle.value || '网址解析视频'
        // B站流：文件名只取原标题主体（剥离 [画质]/（已登录） 等装饰），其它平台沿用旧命名
        let name
        if (s.bili) {
            name = (s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').replace(/\s*[（(]已登录[）)]\s*/g, '').trim() || baseName
        } else if (s.ytSrc) {
            // YouTube：文件名取原标题主体，去掉 [画质] 装饰，交给 yt-dlp 下载
            name = (s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').trim() || baseName
        } else {
            name = s.title ? `${baseName} - ${s.title}` : baseName
        }
        const params = {
            url: s.url,
            name,
            type: s.type === 'm3u8' ? 'm3u8' : undefined,
            category: 'video'
        }
        // B站 DASH 流：传递 audioUrl 让后端用 ffmpeg 合并音视频
        if (s.audioUrl) params.audioUrl = s.audioUrl
        // YouTube：传递 ytSrc/ytHeight 让后端用 yt-dlp 下载（自动合并音视频并可选账号画质）
        if (s.ytSrc) {
            params.ytSrc = s.ytSrc
            if (s.ytHeight) params.ytHeight = s.ytHeight
        }
        const result = await downloadVideo(params)
        if (result?.success) {
            messageStore.success(`已开始下载：${name}（进度见下载专区）`, 3000)
        } else if (!result?.canceled) {
            messageStore.error('下载失败：' + (result?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e))
    } finally {
        parsingDownloadingUrl.value = ''
    }
}

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler

const saveVideos = () => {
    localStorage.setItem('local_videos', JSON.stringify(localVideos.value))
}

const saveStreams = () => {
    localStorage.setItem('video_streams', JSON.stringify(streams.value))
}

// ===== 封面识别：用 Chromium 系统解码 + canvas 截帧（无需 ffmpeg，支持所有浏览器可解码格式）=====
// 原理：把本地视频喂给隐藏 <video>（走 local-file:// 协议，已在主进程开启 CORS），
// seek 到时长 10% 处（第2帧起），draw 到 320px 宽的 canvas 生成 JPEG dataURL，按路径缓存
let thumbActive = true

function grabFrameDataURL(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(null)
        const v = document.createElement('video')
        v.muted = true
        v.playsInline = true
        v.preload = 'auto'
        v.crossOrigin = 'anonymous'
        v.src = url
        let settled = false
        const finish = (val) => { if (!settled) { settled = true; resolve(val) } }
        const cleanup = () => { try { v.removeAttribute('src'); v.load() } catch (e) {} }
        v.addEventListener('error', () => { cleanup(); finish(null) })
        const onMeta = () => {
            const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 60
            try { v.currentTime = Math.min(dur * 0.1, 60) } catch (e) {}
        }
        const onSeek = () => {
            try {
                const w = v.videoWidth || 0
                const h = v.videoHeight || 0
                if (!w || !h) return finish(null)
                const cw = Math.min(w, 320)
                const ch = Math.round(h * (cw / w))
                const cvs = document.createElement('canvas')
                cvs.width = cw
                cvs.height = ch
                cvs.getContext('2d').drawImage(v, 0, 0, cw, ch)
                finish(cvs.toDataURL('image/jpeg', 0.8))
            } catch (e) { finish(null) } finally { cleanup() }
        }
        v.addEventListener('loadedmetadata', onMeta)
        v.addEventListener('seeked', onSeek)
        // 兜底：10 秒内未完成则放弃（避免阻塞后续）
        setTimeout(() => finish(null), 10000)
    })
}

async function loadThumbnails() {
    thumbActive = true
    const targets = localVideos.value.filter(v => v.url && !v.thumbnail)
    if (!targets.length) return
    let idx = 0
    const worker = async () => {
        while (idx < targets.length && thumbActive) {
            const v = targets[idx++]
            const dataUrl = await grabFrameDataURL(v.url)
            if (dataUrl) {
                v.thumbnail = dataUrl
                saveVideosThrottled()
            }
        }
    }
    await Promise.all([worker(), worker()])
    flushVideosSave()
}

// 封面 dataURL 较大，限制持久化规模（>40 张则不再写入 localStorage，只在本次会话内展示）
let pendingSaveVideos = 0
function saveVideosThrottled() {
    if (localVideos.value.filter(x => x.thumbnail).length > 40) return
    if (++pendingSaveVideos >= 3) { pendingSaveVideos = 0; saveVideos() }
}
function flushVideosSave() {
    if (pendingSaveVideos > 0) { pendingSaveVideos = 0; saveVideos() }
}

onMounted(() => { loadThumbnails() })
onBeforeUnmount(() => { thumbActive = false })

const importFiles = async () => {
    const bridge = getBridge()
    if (!bridge?.openVideoFileDialog) { messageStore.error('Bridge 未加载'); return }
    try {
        const videos = await bridge.openVideoFileDialog()
        if (videos?.length > 0) {
            const existing = new Set(localVideos.value.map(v => v.path))
            localVideos.value.push(...videos.filter(v => !existing.has(v.path)))
            saveVideos()
            loadThumbnails()
        }
    } catch (err) { messageStore.error('导入失败: ' + err.message) }
}

const importFolder = async () => {
    const bridge = getBridge()
    if (!bridge?.openVideoDirectoryDialog) { messageStore.error('接口未就绪'); return }
    try {
        loading.value = true
        const videos = await bridge.openVideoDirectoryDialog()
        if (videos?.length > 0) {
            const existing = new Set(localVideos.value.map(v => v.path))
            localVideos.value.push(...videos.filter(v => !existing.has(v.path)))
            saveVideos()
            loadThumbnails()
            messageStore.success(`成功识别 ${videos.length} 个视频`)
        } else { messageStore.info('未找到支持的视频文件') }
    } catch (err) { messageStore.error('导入文件夹失败') }
    finally { loading.value = false }
}

// ===== 链接/直播流：识别类型 =====
const detectType = (url, hint) => {
    if (hint && hint !== 'auto') return hint
    if (/\.flv(\?|$|#)/i.test(url)) return 'flv'
    if (/\.m3u8(\?|$|#)/i.test(url)) return 'm3u8'
    // 支持任何视频格式：mp4/webm/avi/mkv/mov/wmv/m4v/ts 等
    if (/\.(mp4|webm|avi|mkv|mov|wmv|m4v|ts|mpg|mpeg|mpe|3gp|asf|f4v|ogv|mts|m2ts|vob|rm|rmvb)(\?|$|#)/i.test(url)) return 'mp4'
    // 含直播关键词且无明确视频扩展名，视为直播流
    if (/live|stream|rtmp|rtsp/i.test(url)) return 'live'
    // 默认按 m3u8 处理（直播常见）
    return 'm3u8'
}

// 是否直播
const isStreamLive = (s) => {
    if (s.type === 'live') return true
    if (/live|stream|tv|radio|rtmp|rtsp/i.test(s.url)) return true
    return false
}

const playTypeForBili = (s) => {
    const t = detectType(s.url, s.type)
    if (t === 'flv') return 'flv'
    if (t === 'm3u8') return 'm3u8'
    if (t === 'live') return 'live'
    return 'direct'
}

const playVideo = (video) => {
    playerStore.currentSong = {
        id: video.id,
        name: video.name,
        artist: video.format || '本地视频',
        al: { name: '本地视频', picUrl: '' },
        duration: video.duration / 1000 || 0,
        url: video.url,
        path: video.path
    }
    playerStore.currentMvUrl = video.url
    playerStore.currentMvId = null
    playerStore.currentMvTitle = video.name
    playerStore.currentMvAudioUrl = ''
    playerStore.currentMvPlayType = ''  // 本地视频走 direct
    playerStore.showMvPlayer = true
    if (playerStore.isPlaying) {
        playerStore.audio.pause()
        playerStore.isPlaying = false
    }
}

// 播放链接/直播流
// 若填的是平台直播网页链接（斗鱼/虎牙/抖音/B站直播/Twitch/Kick 等），点击播放时先解析，
// 弹窗列出各画质/线路供选择；否则按媒体直链直接播放
const STREAM_HOSTS = /(douyu\.com|huya\.com|live\.douyin\.com|live\.bilibili\.com|twitch\.tv|kick\.com|youtube\.com|youtu\.be)/i
const isMediaDirect = (u) => /\.(m3u8|mp4|flv|m4s|webm|mkv|avi|mov)(\?|#|$)/i.test(u) || /^rtmp:|^rtsp:/i.test(u)
const playStream = async (s) => {
    if (STREAM_HOSTS.test(s.url) && !isMediaDirect(s.url)) {
        await handleLiveParse(s.url)
        return
    }
    playerStore.currentSong = {
        id: 'stream-' + s.id,
        name: s.name,
        artist: isStreamLive(s) ? '直播流' : '在线视频',
        al: { name: '链接/直播流', picUrl: '' },
        duration: 0,
        url: s.url,
        path: ''
    }
    playerStore.currentMvUrl = s.url
    playerStore.currentMvId = null
    playerStore.currentMvTitle = s.name + (isStreamLive(s) ? ' [LIVE]' : '')
    playerStore.currentMvAudioUrl = ''
    // 设置播放类型提示，解决直播流无 .m3u8/.flv 后缀时播放失败
    playerStore.currentMvPlayType = playTypeForBili(s)
    playerStore.showMvPlayer = true
    if (playerStore.isPlaying) {
        playerStore.audio.pause()
        playerStore.isPlaying = false
    }
}

// 添加/编辑表单
const openAddForm = () => {
    editingId.value = null
    streamForm.value = { name: '', url: '', type: 'auto' }
    showStreamForm.value = true
}

const openEditForm = (s) => {
    editingId.value = s.id
    streamForm.value = { name: s.name, url: s.url, type: s.type || 'auto' }
    showStreamForm.value = true
}

const saveStream = () => {
    const name = streamForm.value.name.trim()
    const url = streamForm.value.url.trim()
    if (!name || !url) {
        messageStore.warning('请填写名称和链接')
        return
    }
    if (!/^https?:\/\//i.test(url) && !/^rtmp:\/\//i.test(url) && !/^rtsp:\/\//i.test(url)) {
        messageStore.warning('链接需以 http:// 或 https:// 开头（RTMP/RTSP 暂不支持直接播放）')
        return
    }
    if (editingId.value) {
        const idx = streams.value.findIndex(s => s.id === editingId.value)
        if (idx !== -1) {
            streams.value[idx] = { ...streams.value[idx], name, url, type: streamForm.value.type }
        }
        messageStore.success('已更新')
    } else {
        streams.value.push({
            id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            name,
            url,
            type: streamForm.value.type,
            addedAt: Date.now()
        })
        messageStore.success('已添加链接')
    }
    saveStreams()
    showStreamForm.value = false
}

const cancelForm = () => {
    showStreamForm.value = false
    editingId.value = null
}

const removeStream = async (s) => {
    if (await messageStore.confirm(`确定要移除 "${s.name}" 吗？`, '移除链接')) {
        streams.value = streams.value.filter(x => x.id !== s.id)
        saveStreams()
    }
}

// 下载链接视频（直播流不支持下载）
const downloadingId = ref(null)
const handleDownloadStream = async (s) => {
    if (isStreamLive(s)) {
        messageStore.warning('直播流无法下载，请使用录屏工具')
        return
    }
    if (downloadingId.value) {
        messageStore.info('已有下载任务进行中，请查看右下角')
        return
    }
    downloadingId.value = s.id
    try {
        const t = detectType(s.url, s.type)
        const result = await downloadVideo({
            url: s.url,
            name: s.name,
            type: t === 'm3u8' ? 'm3u8' : undefined
        })
        if (result?.success) {
            messageStore.success(`已开始下载：${s.name}（进度见右下角）`, 3000)
        } else if (!result?.canceled) {
            messageStore.error('下载失败：' + (result?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e))
    } finally {
        downloadingId.value = null
    }
}

const removeVideo = async (video) => {
    if (await messageStore.confirm(`确定要移除 "${video.name}" 吗？`, '移除视频')) {
        localVideos.value = localVideos.value.filter(v => v.path !== video.path)
        saveVideos()
    }
}

// ===== 批量删除 =====
const batchDeleteMode = ref(false)
const selectedDelete = reactive(new Set())
const toggleBatchDelete = () => {
    batchDeleteMode.value = !batchDeleteMode.value
    selectedDelete.clear()
}
const toggleSelect = (video) => {
    if (selectedDelete.has(video.path)) selectedDelete.delete(video.path)
    else selectedDelete.add(video.path)
}
const exitBatch = () => {
    batchDeleteMode.value = false
    selectedDelete.clear()
}
const toggleSelectAll = () => {
    if (selectedDelete.size === localVideos.value.length) { selectedDelete.clear(); return }
    selectedDelete.clear()
    localVideos.value.forEach(v => selectedDelete.add(v.path))
}
const batchRemove = async () => {
    if (selectedDelete.size === 0) { messageStore.error('请先勾选要移除的视频'); return }
    if (await messageStore.confirm(`确定要移除选中的 ${selectedDelete.size} 个视频吗？`, '批量移除')) {
        localVideos.value = localVideos.value.filter(v => !selectedDelete.has(v.path))
        saveVideos()
        exitBatch()
    }
}

const formatSize = (bytes) => {
    if (!bytes) return '0 MB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const formatTime = (ms) => {
    if (!ms) return '--:--'
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const typeLabel = (s) => {
    const t = detectType(s.url, s.type)
    const map = { mp4: 'MP4', m3u8: 'HLS', flv: 'FLV', live: 'LIVE' }
    if (map[t]) return map[t]
    // 显示具体扩展名
    const ext = s.url.match(/\.(\w+)(?:[?#]|$)/i)?.[1]?.toUpperCase()
    return ext || '视频'
}
</script>

<template>
  <div class="local-video-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="title">本地视频</h1>
        <div class="tabs">
            <button class="tab-btn" :class="{ active: activeTab === 'local' }" @click="activeTab = 'local'">
                <Film :size="14" /> 本地视频 <span class="tab-count">{{ localVideos.length }}</span>
            </button>
            <button class="tab-btn" :class="{ active: activeTab === 'streams' }" @click="activeTab = 'streams'">
                <Link2 :size="14" /> 链接/直播流 <span class="tab-count">{{ streams.length }}</span>
            </button>
            <button class="tab-btn" :class="{ active: activeTab === 'parse' }" @click="activeTab = 'parse'">
                <Globe :size="14" /> 网址解析
            </button>
        </div>
      </div>
      <div class="actions">
        <!-- B站 / YouTube 登录胶囊（始终显示在右上角） -->
        <div class="login-capsules">
          <button v-if="!biliLoggedIn" class="login-capsule bili" @click="openBiliLogin">
            <User :size="13" /><span>B站登录</span>
          </button>
          <button v-else class="login-capsule bili logged" title="点击退出B站登录" @click="logoutBili">
            <img v-if="biliUserInfo?.face" :src="biliUserInfo.face" class="capsule-avatar" alt="" referrerpolicy="no-referrer" @error="onAvatarError" />
            <User v-else :size="13" />
            <span class="capsule-name">{{ biliUserInfo?.uname || 'B站' }}</span>
          </button>
          <button v-if="!ytLoggedIn" class="login-capsule yt" @click="openYtLogin">
            <Youtube :size="13" /><span>YT登录</span>
          </button>
          <button v-else class="login-capsule yt logged" title="点击退出YouTube登录" @click="logoutYt">
            <img v-if="ytUserInfo?.face" :src="ytUserInfo.face" class="capsule-avatar" alt="" referrerpolicy="no-referrer" @error="onYtAvatarError" />
            <User v-else :size="13" />
            <span class="capsule-name">{{ ytUserInfo?.uname || 'YT' }}</span>
          </button>
        </div>
        <template v-if="activeTab === 'local'">
            <template v-if="batchDeleteMode">
                <button class="import-btn" @click="toggleSelectAll">
                    <Check :size="16" /> {{ selectedDelete.size === localVideos.length ? '取消全选' : '全选' }}
                </button>
                <button class="import-btn danger" @click="batchRemove" :disabled="selectedDelete.size === 0">
                    <Trash2 :size="16" /> 删除选中 ({{ selectedDelete.size }})
                </button>
                <button class="import-btn" @click="exitBatch">
                    <X :size="16" /> 取消
                </button>
            </template>
            <template v-else>
                <button class="import-btn" @click="importFiles">
                    <FolderOpen :size="16" /> 添加文件
                </button>
                <button class="import-btn" @click="importFolder" :disabled="loading">
                    <FolderPlus :size="16" /> {{ loading ? '扫描中...' : '添加文件夹' }}
                </button>
                <button v-if="localVideos.length > 0" class="import-btn" @click="toggleBatchDelete">
                    <Check :size="16" /> 批量删除
                </button>
            </template>
        </template>
        <template v-else-if="activeTab === 'streams'">
            <button class="import-btn primary" @click="openAddForm">
                <Plus :size="16" /> 添加链接/直播流
            </button>
        </template>
      </div>
    </div>

    <!-- 本地视频 -->
    <div v-if="activeTab === 'local'">
        <div class="video-grid" v-if="localVideos.length > 0">
            <div
                v-for="video in localVideos"
                :key="video.path"
                class="video-card"
                :class="{ selecting: batchDeleteMode, selected: selectedDelete.has(video.path) }"
                @dblclick="playVideo(video)"
                @click="batchDeleteMode && toggleSelect(video)"
            >
                <div class="card-poster" @click.stop="batchDeleteMode ? toggleSelect(video) : playVideo(video)">
                    <!-- ffmpeg 截帧封面；无封面时回退 Film 图标 -->
                    <img v-if="video.thumbnail" :src="video.thumbnail" class="poster-img" :alt="video.name" @error="video.thumbnail = ''" />
                    <Film v-else :size="40" class="poster-icon" />
                    <div class="play-overlay"><Play :size="28" fill="white" /></div>
                    <div v-if="batchDeleteMode" class="card-select">
                        <Check v-if="selectedDelete.has(video.path)" :size="16" />
                    </div>
                </div>
                <div class="card-info">
                    <span class="card-name" :title="video.name">{{ video.name }}</span>
                    <span class="card-meta">{{ video.format }} · {{ formatSize(video.size) }}</span>
                    <span class="card-dur"><Clock :size="10" /> {{ formatTime(video.duration) }}</span>
                </div>
                <button v-if="!batchDeleteMode" class="card-remove" title="移除" @click.stop="removeVideo(video)">
                    <Trash2 :size="14" />
                </button>
            </div>
        </div>

        <div v-else class="empty-state">
            <Film :size="48" />
            <p>还没有添加本地视频</p>
            <button class="import-link" @click="importFiles">立即添加</button>
        </div>
    </div>

    <!-- 链接/直播流 -->
    <div v-else-if="activeTab === 'streams'" class="streams-section">
        <div v-if="streams.length === 0" class="empty-state">
            <Radio :size="48" />
            <p>还没有添加链接或直播流</p>
            <p class="empty-hint">支持 MP4/WebM 直链、HLS(m3u8)、FLV 流；也可填斗鱼/虎牙/抖音/B站/Twitch/Kick 直播链接，播放时自动解析。</p>
            <button class="import-link" @click="openAddForm">立即添加</button>
        </div>

        <div v-else class="streams-list">
            <div v-for="s in streams" :key="s.id" class="stream-card">
                <div class="stream-icon-wrap" @click="playStream(s)">
                    <Radio v-if="isStreamLive(s)" :size="24" class="stream-icon live" />
                    <Link2 v-else :size="24" class="stream-icon" />
                    <div class="play-overlay"><Play :size="22" fill="white" /></div>
                    <span v-if="isStreamLive(s)" class="live-badge">LIVE</span>
                </div>
                <div class="stream-info" @click="playStream(s)">
                    <div class="stream-name" :title="s.name">
                        {{ s.name }}
                        <span class="stream-type-tag">{{ typeLabel(s) }}</span>
                    </div>
                    <div class="stream-url" :title="s.url">{{ s.url }}</div>
                </div>
                <div class="stream-actions">
                    <button class="stream-action-btn" title="下载" :disabled="isStreamLive(s) || downloadingId === s.id" @click.stop="handleDownloadStream(s)">
                        <Download v-if="downloadingId !== s.id" :size="14" />
                        <Clock v-else :size="14" class="spin" />
                    </button>
                    <button class="stream-action-btn" title="编辑" @click.stop="openEditForm(s)">
                        <Pencil :size="14" />
                    </button>
                    <button class="stream-action-btn danger" title="移除" @click.stop="removeStream(s)">
                        <Trash2 :size="14" />
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 网址解析 -->
    <div v-else-if="activeTab === 'parse'" class="parse-section">
        <div class="parse-input-bar">
            <Globe :size="18" class="parse-input-icon" />
            <input
                type="text"
                v-model="parseInput"
                class="parse-input"
                placeholder="输入影视/视频网页地址，自动解析出视频流"
                @keyup.enter="handleParseUrl"
            />
            <button class="parse-btn" :disabled="parseLoading" @click="handleParseUrl">
                <Search v-if="!parseLoading" :size="16" />
                <Clock v-else :size="16" class="spin" />
                {{ parseLoading ? '解析中...' : '解析' }}
            </button>
        </div>
        <div class="parse-tips">
            <p>· 支持解析影视页面（自动提取 m3u8/mp4 直链）、含 player_aaaa 的 maccms 播放页</p>
            <p>· 解析到的视频流会列出供你点击播放</p>
        </div>

        <div v-if="parseResults.length > 0" class="parse-results">
            <div class="parse-results-title">
                共解析到 {{ parseResults.length }} 个视频流{{ parsePageTitle ? ` · ${parsePageTitle}` : '' }}
            </div>
            <template v-for="(g, gi) in parseGroups" :key="gi">
                <div v-if="gi > 0" class="parse-group-divider"></div>
                <transition-group name="fold" tag="div" class="parse-group-wrap">
                    <div v-for="(s, i) in (parseGroupOpen[g.key] ? g.list : g.list.slice(0, 1))" :key="s.url" class="parse-result-card" :class="{ 'parse-group-sub': i > 0 }">
                        <div class="parse-result-index" @click="playParsedStream(s)">{{ i + 1 }}</div>
                        <div class="parse-result-info" @click="playParsedStream(s)">
                            <div class="parse-result-name">
                                {{ s.title || parsePageTitle || `视频流 ${i + 1}` }}
                                <span class="parse-type-tag">{{ s.type }}</span>
                                <span v-if="s.audioUrl" class="parse-dash-tag" title="DASH 音视频分离，下载时自动合并">DASH·合并</span>
                            </div>
                            <div class="parse-result-url" :title="s.url">{{ s.url }}</div>
                        </div>
                        <button class="parse-result-download" :disabled="parsingDownloadingUrl === s.url" :title="parsingDownloadingUrl === s.url ? '下载中...' : '下载'" @click.stop="downloadParsedStream(s)">
                            <Clock v-if="parsingDownloadingUrl === s.url" :size="16" class="spin" />
                            <Download v-else :size="16" />
                        </button>
                        <div class="parse-result-play" @click="playParsedStream(s)">
                            <Play :size="20" fill="currentColor" />
                        </div>
                    </div>
                </transition-group>
                <div v-if="g.list.length > 1" class="parse-more-toggle" @click="parseGroupOpen[g.key] = !parseGroupOpen[g.key]">
                    {{ parseGroupOpen[g.key] ? '收起画质' : `该视频还有其他画质（${g.list.length - 1}）` }}
                </div>
            </template>
        </div>
    </div>

    <!-- 直播解析结果选择弹窗 -->
    <transition name="modal">
    <div v-if="showLivePick" class="form-overlay" @click.self="showLivePick = false">
        <div class="live-pick-modal">
            <div class="form-header">
                <h3>选择直播线路/画质</h3>
                <X :size="18" class="clickable" @click="showLivePick = false" />
            </div>
            <div class="live-pick-title" v-if="livePickTitle">{{ livePickTitle }}</div>
            <div class="live-pick-list">
                <template v-for="(g, gi) in liveGroups" :key="gi">
                    <div v-if="gi > 0" class="parse-group-divider"></div>
                    <transition-group name="fold" tag="div" class="parse-group-wrap">
                        <div v-for="(s, i) in (liveGroupOpen[g.key] ? g.list : g.list.slice(0, 1))" :key="s.url" class="parse-result-card live-pick-item" :class="{ 'parse-group-sub': i > 0 }" @click="playLivePick(s)">
                            <div class="parse-result-index">{{ i + 1 }}</div>
                            <div class="parse-result-info">
                                <div class="parse-result-name">
                                    {{ s.title || `线路 ${i + 1}` }}
                                    <span class="parse-type-tag">{{ s.type }}</span>
                                </div>
                                <div class="parse-result-url" :title="s.url">{{ s.url }}</div>
                            </div>
                            <div class="parse-result-play" @click.stop="playLivePick(s)">
                                <Play :size="20" fill="currentColor" />
                            </div>
                        </div>
                    </transition-group>
                    <div v-if="g.list.length > 1" class="parse-more-toggle" @click="liveGroupOpen[g.key] = !liveGroupOpen[g.key]">
                        {{ liveGroupOpen[g.key] ? '收起画质' : `该线路还有其他画质（${g.list.length - 1}）` }}
                    </div>
                </template>
            </div>
        </div>
    </div>
    </transition>

    <!-- 添加/编辑链接表单 -->
    <transition name="modal">
    <div v-if="showStreamForm" class="form-overlay" @click.self="cancelForm">
        <div class="form-modal">
            <div class="form-header">
                <h3>{{ editingId ? '编辑链接' : '添加链接/直播流' }}</h3>
                <X :size="18" class="clickable" @click="cancelForm" />
            </div>
            <div class="form-body">
                <div class="form-row">
                    <label>名称</label>
                    <input type="text" v-model="streamForm.name" placeholder="例如：CCTV-1 直播 / 我的视频点播" autofocus />
                </div>
                <div class="form-row">
                    <label>链接地址</label>
                    <input type="text" v-model="streamForm.url" placeholder="https://...  支持 mp4/m3u8/flv" />
                </div>
                <div class="form-row">
                    <label>类型</label>
                    <CustomSelect v-model="streamForm.type" :options="streamTypes" />
                </div>
                <div class="form-tips">
                    <p>· 自动识别：按 URL 后缀判断（.flv → FLV，.m3u8 → HLS，.mp4 → 直链）</p>
                    <p>· 直播流：勾选后会标记 LIVE 并禁用下载</p>
                    <p>· RTMP/RTSP 协议暂不支持在浏览器内核直接播放</p>
                </div>
            </div>
            <div class="form-footer">
                <button class="form-btn cancel" @click="cancelForm">取消</button>
                <button class="form-btn save" @click="saveStream">
                    <Check :size="14" /> {{ editingId ? '保存' : '添加' }}
                </button>
            </div>
        </div>
    </div>
    </transition>

    <!-- B站二维码登录弹窗 -->
    <transition name="modal">
    <div v-if="showBiliQr" class="form-overlay" @click.self="closeBiliQr">
        <div class="bili-qr-modal">
            <div class="form-header">
                <h3>B站扫码登录</h3>
                <X :size="18" class="clickable" @click="closeBiliQr" />
            </div>
            <div class="bili-qr-body">
                <div v-if="biliQrStatus === 'error'" class="bili-qr-error">
                    <p>{{ biliQrError }}</p>
                    <button class="form-btn save" @click="refreshBiliQr">
                        <RefreshCw :size="14" /> 重新获取
                    </button>
                </div>
                <div v-else-if="biliQrStatus === 'expired'" class="bili-qr-expired">
                    <p>二维码已过期</p>
                    <button class="form-btn save" @click="refreshBiliQr">
                        <RefreshCw :size="14" /> 刷新二维码
                    </button>
                </div>
                <div v-else class="bili-qr-img-wrap">
                    <img v-if="biliQrImgUrl" :src="biliQrImgUrl" alt="B站登录二维码" class="bili-qr-img" />
                    <div v-if="biliQrStatus === 'scanned'" class="bili-qr-scanned">
                        <Check :size="40" />
                        <p>已扫码，请在手机上确认</p>
                    </div>
                </div>
                <div class="bili-qr-tips">
                    <p v-if="biliQrStatus === 'waiting'">请使用 <strong>B站手机 App</strong> 扫描二维码登录</p>
                    <p v-else-if="biliQrStatus === 'scanned'">等待确认中...</p>
                    <p class="bili-qr-benefit">登录后解析B站视频可解锁更高画质（1080P/4K）</p>
                </div>
            </div>
        </div>
    </div>
    </transition>

    <!-- YouTube 官方网页登录弹窗 -->
    <transition name="modal">
    <div v-if="showYtLogin" class="form-overlay" @click.self="closeYtLogin">
        <div class="yt-login-modal">
            <div class="form-header">
                <h3>YouTube 登录</h3>
                <X :size="18" class="clickable" @click="closeYtLogin" />
            </div>
            <div class="yt-login-body">
                <div v-if="ytStatus === 'error'" class="yt-login-error">
                    <p>{{ ytError }}</p>
                    <div class="yt-login-err-actions">
                        <button class="form-btn save" @click="openYtLogin">
                            <RefreshCw :size="14" /> 重新打开
                        </button>
                        <button class="form-btn" @click="closeYtLogin">关闭</button>
                    </div>
                </div>
                <div v-else class="yt-login-loading">
                    <Youtube :size="26" class="spin" />
                    <p>已在独立窗口打开 YouTube 官方登录页</p>
                    <div class="yt-login-tip">请在窗口中用 <strong>邮箱/账号</strong> 正常登录 Google 或 YouTube，登录成功后窗口会自动关闭并提升画质。</div>
                    <div class="yt-login-err-actions">
                        <button class="form-btn" @click="closeYtLogin">关闭登录窗口</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    </transition>
  </div>
</template>

<style scoped>
.local-video-view {
  padding: 30px;
  flex: 1;
  overflow-y: auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left { display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap; }
.title { font-size: 24px; font-weight: bold; }

.tabs {
    display: flex;
    gap: 4px;
    background: #f0f0f0;
    padding: 3px;
    border-radius: 8px;
}

.tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    color: #666;
    cursor: pointer;
    transition: all 0.15s;
}

.tab-btn.active {
    background: #fff;
    color: var(--primary-color, #c20c0c);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.tab-count {
    font-size: 10px;
    background: rgba(0,0,0,0.08);
    padding: 1px 6px;
    border-radius: 8px;
    color: #888;
}

.tab-btn.active .tab-count {
    background: rgba(194, 12, 12, 0.12);
    color: var(--primary-color, #c20c0c);
}

.count { color: #999; font-size: 14px; }

.actions { display: flex; gap: 12px; }

.import-btn {
  background: #fff;
  border: 1px solid #ddd;
  padding: 8px 16px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  transition: all 0.2s;
}

.import-btn:hover:not(:disabled) { background-color: #f5f5f5; border-color: #ccc; }
.import-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.import-btn.primary {
    background: var(--primary-color, #c20c0c);
    color: #fff;
    border-color: var(--primary-color, #c20c0c);
}

.import-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
    background: var(--primary-color, #c20c0c);
}

/* Grid */
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.video-card {
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #eee;
  transition: all 0.2s;
  position: relative;
}

.video-card:hover {
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  transform: translateY(-2px);
}

.card-poster {
  aspect-ratio: 16/9;
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
}

.poster-icon { color: rgba(255,255,255,0.3); }

/* ffmpeg 截帧封面铺满卡片 */
.poster-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  opacity: 0;
  transition: opacity 0.2s;
  color: white;
}

.card-poster:hover .play-overlay { opacity: 1; }

.card-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-meta {
  font-size: 11px;
  color: #999;
}

.card-dur {
  font-size: 11px;
  color: #bbb;
  display: flex;
  align-items: center;
  gap: 3px;
}

.card-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.video-card:hover .card-remove { opacity: 1; }
.card-remove:hover { background: rgba(220, 38, 38, 0.85); }

/* 批量删除选择模式 */
.video-card.selecting { cursor: pointer; }
.video-card.selected { border-color: #e60012; box-shadow: 0 0 0 2px rgba(230,0,18,0.15); }
.card-select {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.9);
  background: rgba(0,0,0,0.35);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.video-card.selected .card-select { background: #e60012; border-color: #e60012; }
.import-btn.danger { background: #fdecec; color: #d92c2c; border-color: #f5c6c6; cursor: pointer; }
.import-btn.danger:hover:not(:disabled) { background: #d92c2c; color: #fff; }
.import-btn.danger:disabled { opacity: 0.5; cursor: not-allowed; }

/* 链接/直播流 */
.streams-section {
    padding-top: 8px;
}

.stream-parse-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 6px 6px 6px 16px;
    transition: border-color 0.2s;
    max-width: 900px;
    margin-bottom: 14px;
}
.stream-parse-bar:focus-within {
    border-color: var(--primary-color, #c20c0c);
    box-shadow: 0 0 0 3px rgba(194, 12, 12, 0.08);
}

.live-pick-modal {
    width: 480px;
    max-width: 92vw;
    max-height: 78vh;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.live-pick-title {
    padding: 8px 20px 0;
    font-size: 13px;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.live-pick-list {
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.live-pick-item { cursor: pointer; }

.streams-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 900px;
}

.stream-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #fff;
    border: 1px solid #eee;
    border-radius: 10px;
    padding: 12px 16px;
    transition: all 0.2s;
}

.stream-card:hover {
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    border-color: #e0e0e0;
}

.stream-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    background: #1a1a2e;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    color: rgba(255,255,255,0.5);
}

.stream-icon.live { color: #ef4444; }

.stream-icon-wrap .play-overlay {
    background: rgba(194, 12, 12, 0.8);
}

.stream-icon-wrap:hover .play-overlay { opacity: 1; }

.live-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #ef4444;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    letter-spacing: 0.5px;
    animation: livePulse 1.6s ease-in-out infinite;
}

@keyframes livePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

.stream-info {
    flex: 1;
    min-width: 0;
    cursor: pointer;
}

.stream-name {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a2e;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.stream-type-tag {
    font-size: 10px;
    background: #f0f0f0;
    color: #666;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
}

.stream-url {
    font-size: 11px;
    color: #999;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.stream-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}

.stream-action-btn {
    width: 30px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid #e5e5e5;
    background: #fff;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}

.stream-action-btn:hover:not(:disabled) {
    background: #f5f5f5;
    color: #333;
}

.stream-action-btn.danger:hover { color: #ef4444; border-color: #ef4444; }

.stream-action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: #999;
}

.empty-state p { margin: 10px 0; font-size: 14px; }

.empty-hint {
    font-size: 12px !important;
    color: #bbb !important;
}

.import-link {
  margin-top: 15px;
  background: var(--primary-color, #c20c0c);
  color: white;
  border: none;
  padding: 8px 24px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
}

/* 表单 */
.form-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 12000;
    backdrop-filter: blur(4px);
}

/* 弹窗淡入/缩放动画 */
.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.2s ease;
}
.modal-enter-active .form-modal,
.modal-leave-active .form-modal,
.modal-enter-active .live-pick-modal,
.modal-leave-active .live-pick-modal,
.modal-enter-active .bili-qr-modal,
.modal-leave-active .bili-qr-modal,
.modal-enter-active .yt-login-modal,
.modal-leave-active .yt-login-modal {
    transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
.modal-enter-from .form-modal,
.modal-leave-to .form-modal,
.modal-enter-from .live-pick-modal,
.modal-leave-to .live-pick-modal,
.modal-enter-from .bili-qr-modal,
.modal-leave-to .bili-qr-modal,
.modal-enter-from .yt-login-modal,
.modal-leave-to .yt-login-modal {
    transform: scale(0.92) translateY(10px);
    opacity: 0;
}
.modal-enter-to .form-modal,
.modal-leave-from .form-modal,
.modal-enter-to .live-pick-modal,
.modal-leave-from .live-pick-modal,
.modal-enter-to .bili-qr-modal,
.modal-leave-from .bili-qr-modal,
.modal-enter-to .yt-login-modal,
.modal-leave-from .yt-login-modal {
    transform: scale(1) translateY(0);
    opacity: 1;
}

.form-modal {
    background: #fff;
    border-radius: 14px;
    width: min(520px, 92vw);
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    overflow: hidden;
}

.form-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0f0f0;
}

.form-header h3 {
    margin: 0;
    font-size: 16px;
    color: #1a1a2e;
}

.form-header .clickable {
    color: #999;
    cursor: pointer;
}

.form-header .clickable:hover { color: #333; }

.form-body {
    padding: 18px 20px;
}

.form-row {
    margin-bottom: 14px;
}

.form-row label {
    display: block;
    font-size: 12px;
    color: #666;
    margin-bottom: 6px;
    font-weight: 500;
}

.form-row input,
.form-row select {
    width: 100%;
    height: 38px;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 0 12px;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
}

.form-row input:focus,
.form-row select:focus {
    border-color: var(--primary-color, #c20c0c);
}

.form-tips {
    margin-top: 10px;
    padding: 10px 12px;
    background: #f9f9fb;
    border-radius: 8px;
    font-size: 11px;
    color: #888;
    line-height: 1.7;
}

.form-tips p { margin: 0; }

.form-footer {
    padding: 12px 20px 18px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.form-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: 1px solid #ddd;
    background: #fff;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
}

.form-btn.cancel:hover { background: #f5f5f5; }

.form-btn.save {
    background: var(--primary-color, #c20c0c);
    color: #fff;
    border-color: var(--primary-color, #c20c0c);
}

.form-btn.save:hover { opacity: 0.9; }

/* 网址解析 */
.parse-section {
    padding-top: 8px;
    max-width: 900px;
}

/* B站 / YouTube 登录胶囊（右上角） */
.login-capsules {
    display: flex;
    gap: 8px;
    align-items: center;
}

.login-capsule {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 12px;
    border-radius: 14px;
    border: 1px solid transparent;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
}

.login-capsule.bili {
    background: rgba(251, 114, 153, 0.12);
    color: #fc3a6e;
    border-color: rgba(251, 114, 153, 0.35);
}
.login-capsule.bili:hover {
    background: rgba(251, 114, 153, 0.2);
}

.login-capsule.yt {
    background: rgba(255, 0, 0, 0.08);
    color: #e60012;
    border-color: rgba(255, 0, 0, 0.3);
}
.login-capsule.yt:hover {
    background: rgba(255, 0, 0, 0.14);
}

.login-capsule.logged {
    padding: 0 6px 0 4px;
}
.login-capsule.logged:hover { opacity: 0.85; }

.capsule-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(0,0,0,0.08);
}

.capsule-name {
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* B站二维码弹窗 */
.bili-qr-modal {
    background: #fff;
    border-radius: 14px;
    width: min(360px, 92vw);
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    overflow: hidden;
}

.bili-qr-body {
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}

.bili-qr-img-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}

.bili-qr-img {
    width: 240px;
    height: 240px;
    border-radius: 10px;
    border: 1px solid #eee;
}

.bili-qr-scanned {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.92);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #22c55e;
    font-size: 13px;
}

.bili-qr-error, .bili-qr-expired {
    text-align: center;
    color: #ef4444;
    font-size: 14px;
    padding: 40px 0;
}

.bili-qr-error .form-btn, .bili-qr-expired .form-btn {
    margin-top: 16px;
}

.bili-qr-tips {
    text-align: center;
    font-size: 12px;
    color: #888;
    line-height: 1.8;
}

.bili-qr-tips strong { color: var(--primary-color, #c20c0c); }
.bili-qr-benefit { color: #fb7299; margin-top: 4px; }

/* YouTube 设备码登录弹窗 */
.yt-login-modal {
    background: #fff;
    border-radius: 14px;
    width: min(420px, 92vw);
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    overflow: hidden;
}
.yt-login-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}
.yt-login-error {
    text-align: center;
    color: #ef4444;
    font-size: 14px;
    padding: 30px 0;
}
.yt-login-error .form-btn { margin-top: 14px; }
.yt-login-err-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: center;
    margin-top: 14px;
}
.yt-login-waiting {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.yt-login-step {
    font-size: 13px;
    color: #444;
    display: flex;
    align-items: center;
    gap: 6px;
}
.yt-step-num {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #e60012;
    color: #fff;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.yt-verify-url {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f9f9fb;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 8px 10px;
}
.yt-verify-text {
    flex: 1;
    font-size: 12px;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
}
.yt-verify-url a {
    color: var(--primary-color, #c20c0c);
    text-decoration: none;
    font-size: 12px;
    flex-shrink: 0;
}
.yt-copy {
    font-size: 11px;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
    padding: 2px 6px;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
}
.yt-copy:hover { color: #333; }
.yt-code-box {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 6px;
    color: #1a1a2e;
    text-align: center;
    padding: 14px;
    border: 2px dashed #e5e5e5;
    border-radius: 10px;
    cursor: pointer;
    user-select: all;
}
.yt-code-box:hover { border-color: var(--primary-color, #c20c0c); }
.yt-login-tip {
    font-size: 12px;
    color: #999;
    text-align: center;
}
.yt-login-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #999;
    padding: 30px 0;
    font-size: 13px;
}

.parse-input-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 6px 6px 6px 16px;
    transition: border-color 0.2s;
}

.parse-input-bar:focus-within {
    border-color: var(--primary-color, #c20c0c);
    box-shadow: 0 0 0 3px rgba(194, 12, 12, 0.08);
}

.parse-input-icon {
    color: #bbb;
    flex-shrink: 0;
}

.parse-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 14px;
    background: transparent;
    height: 38px;
    min-width: 0;
}

.parse-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 18px;
    height: 38px;
    border: none;
    border-radius: 8px;
    background: var(--primary-color, #c20c0c);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.15s;
    flex-shrink: 0;
}

.parse-btn:hover:not(:disabled) { opacity: 0.9; }
.parse-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.parse-tips {
    margin-top: 14px;
    padding: 12px 16px;
    background: #f9f9fb;
    border-radius: 10px;
    font-size: 12px;
    color: #888;
    line-height: 1.8;
}

.parse-tips p { margin: 0; }

.parse-results {
    margin-top: 20px;
}

.parse-more-toggle {
    margin-top: 4px;
    padding: 8px 0;
    text-align: center;
    font-size: 12px;
    color: #e0454b;
    background: #fff;
    border: 1px dashed #e8d0d2;
    border-radius: 10px;
    cursor: pointer;
    user-select: none;
    transition: background 0.2s;
}

.parse-more-toggle:hover {
    background: #fdf3f4;
}

.parse-group-divider {
    height: 1px;
    margin: 14px 0;
    background: linear-gradient(90deg, transparent, #e6e6ea, transparent);
}

.parse-group-sub {
    opacity: 0.86;
}

/* 画质折叠加收起动画 */
.fold-enter-active,
.fold-leave-active {
    transition: all 0.22s ease;
    overflow: hidden;
}
.fold-enter-from,
.fold-leave-to {
    opacity: 0;
    transform: translateY(-6px);
    height: 0 !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
}
.fold-enter-to,
.fold-leave-from {
    opacity: 1;
}
.fold-move {
    transition: transform 0.22s ease;
}
.parse-group-wrap {
    display: flex;
    flex-direction: column;
}
.parse-group-wrap .parse-result-card {
    margin-top: 8px;
}

.parse-results-title {
    font-size: 13px;
    color: #666;
    margin-bottom: 12px;
    font-weight: 500;
}

.parse-result-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #fff;
    border: 1px solid #eee;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 10px;
    cursor: pointer;
    transition: all 0.2s;
}

.parse-dash-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #e6f7ff;
    color: #1890ff;
    border: 1px solid #91d5ff;
    flex-shrink: 0;
}

.parse-result-download {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid #ddd;
    background: #fff;
    color: #666;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
}

.parse-result-download:hover:not(:disabled) {
    background: var(--primary-color, #c20c0c);
    color: #fff;
    border-color: var(--primary-color, #c20c0c);
}

.parse-result-download:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.parse-result-card:hover {
    box-shadow: 0 4px 16px rgba(194, 12, 12, 0.1);
    border-color: var(--primary-color, #c20c0c);
    transform: translateY(-1px);
}

.parse-result-index {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #f0f0f0;
    color: #666;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.parse-result-card:hover .parse-result-index {
    background: var(--primary-color, #c20c0c);
    color: #fff;
}

.parse-result-info {
    flex: 1;
    min-width: 0;
}

.parse-result-name {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a2e;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.parse-type-tag {
    font-size: 10px;
    background: rgba(194, 12, 12, 0.1);
    color: var(--primary-color, #c20c0c);
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    text-transform: uppercase;
}

.parse-result-url {
    font-size: 11px;
    color: #999;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.parse-result-play {
    color: var(--primary-color, #c20c0c);
    flex-shrink: 0;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.parse-result-card:hover .parse-result-play { opacity: 1; }
</style>
