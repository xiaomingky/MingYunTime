<script setup>
import { ref, computed, onMounted, watch, defineComponent, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { biliVideoDetail, biliAnimePlayurl, biliVideoPlayurl, biliVideoSeasonDetail, biliVideoPgcPlayurl, biliAnimeDanmaku, biliVideoComments, biliVideoCommentReplies, biliVideoLike, biliVideoCoin, biliVideoFav, biliVideoInteract, downloadVideo } from '../api'
import { useMessageStore } from '../store/message'
import { useBiliTvLogin } from '../composables/useBiliTvLogin'
import { useBiliWebLogin } from '../composables/useBiliWebLogin'
import ArtVideoPlayer from '../components/ArtVideoPlayer.vue'
import BiliCookieLogin from '../components/BiliCookieLogin.vue'
import BiliIcon from '../components/BiliIcon.vue'
import {
    ChevronLeft, Loader2, Tv, Clapperboard, RefreshCw,
    Users, MonitorPlay, LogOut, X, Check, ChevronDown, ChevronUp, CheckSquare, Square, ZoomIn, ZoomOut, RotateCcw,
    MessageCircle, CornerDownRight, Download, Folder
} from 'lucide-vue-next'

// ===== B站官方风格实心图标：统一使用 components/BiliIcon.vue（与列表页共用）=====

const router = useRouter()
const route = useRoute()
const messageStore = useMessageStore()

const bvid = computed(() => route.params.bvid)
// PGC（番剧/电影）季模式：/bilibili/season/:seasonId，或视频详情接口识别到 PGC 重定向后自动切换
const routeSeasonId = computed(() => route.params.seasonId || '')

// ===== TV 端登录（composable 复用动漫专区逻辑）=====
const {
    biliTvLoggedIn, biliTvUserInfo, biliTvMid,
    showBiliTvQr, biliTvQrImgUrl, biliTvQrStatus, biliTvQrError,
    loadBiliTvStatus, handleBiliLogin, closeBiliTvQr, refreshBiliTvQr,
    logoutBiliTv, onTvAvatarError
} = useBiliTvLogin(messageStore)

// ===== B站 Web 账号登录（投币/收藏需要）=====
const {
    biliWebLoggedIn, biliWebUserInfo,
    showBiliWebQr, webQrImgUrl, webQrStatus, webQrError,
    loadWebStatus, handleWebLogin, closeWebQr, refreshWebQr, onWebAvatarError
} = useBiliWebLogin(messageStore)

// ===== 详情数据 =====
const loading = ref(true)
const detail = ref(null)
// PGC 季详情（番剧/电影）：season + episodes
const seasonDetail = ref(null)

// 季模式判定：路由直连 season_id 或视频详情识别到 PGC 内容
const isPgcMode = computed(() => !!seasonDetail.value)

const video = computed(() => detail.value?.video || null)
const ownerCard = computed(() => detail.value?.ownerCard || {})
const related = computed(() => detail.value?.related || [])
const season = computed(() => seasonDetail.value?.season || null)
const seasonEps = computed(() => seasonDetail.value?.episodes || [])
// 顶部标题：季模式显示季名，视频模式显示视频标题
const pageTitle = computed(() => isPgcMode.value
    ? (season.value?.title || '加载中...')
    : (video.value?.title || '加载中...'))

// 分P（ArtVideoPlayer 选集结构）
const episodes = computed(() => {
    const pages = video.value?.pages || []
    return pages.map(p => ({
        title: `P${p.page} ${p.part}`,
        page: p.page,
        part: p.part,
        cid: p.cid,
        duration: p.duration
    }))
})
const currentEpisode = ref(null)

// 合集（ugc_season：多个独立 BV 组成，与分P不同；与 PGC 季 season 区分命名）
const ugcSeason = computed(() => video.value?.season || null)
const ugcSeasonEpisodes = computed(() => ugcSeason.value?.episodes || [])
const ugcSeasonCurrentIdx = computed(() =>
    ugcSeasonEpisodes.value.findIndex(e => e.bvid === bvid.value)
)
function openUgcSeasonEpisode(ep) {
    if (!ep?.bvid || ep.bvid === bvid.value) return
    router.push(`/bilibili/${ep.bvid}`)
}

// ===== PGC（番剧/电影）分集播放 =====
const currentPgcEp = ref(null)
const currentPgcEpIdx = computed(() => {
    if (!currentPgcEp.value) return -1
    return seasonEps.value.findIndex(e => e.epId === currentPgcEp.value.epId)
})
// ArtVideoPlayer 选集结构（PGC 分集）
const pgcEpisodes = computed(() => seasonEps.value.map(ep => ({
    title: ep.longTitle ? `第${ep.title}话 ${ep.longTitle}` : `第${ep.title}话`,
    cid: ep.cid,
    epId: ep.epId,
    duration: ep.duration
})))

// 评论定位 aid：普通视频取 video.aid，PGC 取当前分集 aid
const commentAid = computed(() => isPgcMode.value
    ? (currentPgcEp.value?.aid || 0)
    : (video.value?.aid || 0))
// 互动定位：普通视频取 video，PGC 取当前分集（aid/bvid）
const interactAid = computed(() => isPgcMode.value
    ? (currentPgcEp.value?.aid || 0)
    : (video.value?.aid || 0))
const interactBvid = computed(() => isPgcMode.value
    ? (currentPgcEp.value?.bvid || '')
    : (video.value?.bvid || ''))

// 简介折叠
const descExpanded = ref(false)

// ===== 播放器状态 =====
const playUrl = ref('')
const dashAudioUrl = ref('')
const playerError = ref('')
const playerLoading = ref(false)

// TV 画质列表 + 当前档位（跨 P 记忆用户选择的画质）
const biliQualities = ref([])
const biliCurrentQn = ref(0)
let biliPreferredQn = 0

// TV 弹幕（异步拉取，播放不阻塞；播放器热加载）
const biliDanmaku = ref([])
function loadBiliDanmaku(cid) {
    biliDanmaku.value = []
    if (!cid) return
    biliAnimeDanmaku({ cid }).then(res => {
        if (res?.success && Array.isArray(res.data)) {
            biliDanmaku.value = res.data
        }
    }).catch(() => {})
}

// ===== 加载详情 =====
async function loadDetail() {
    loading.value = true
    detail.value = null
    seasonDetail.value = null
    playUrl.value = ''
    dashAudioUrl.value = ''
    playerError.value = ''
    currentEpisode.value = null
    currentPgcEp.value = null
    biliQualities.value = []
    biliCurrentQn.value = 0
    biliDanmaku.value = []
    descExpanded.value = false
    // 重置评论区（含加载标志：换视频时若上一次加载仍挂起，避免新视频永远卡在"加载中"）
    comments.value = []
    commentsLoading.value = false
    commentsTotal.value = 0
    commentsPage.value = 1
    commentsHasMore.value = false
    expandedReplies.value = {}
    try {
        if (routeSeasonId.value) {
            // 直连季详情（搜索/分区番剧电影卡片）
            const res = await biliVideoSeasonDetail({ seasonId: routeSeasonId.value })
            if (res?.success && res.data?.season) {
                seasonDetail.value = res.data
                if (seasonEps.value.length > 0) playPgcEpisode(seasonEps.value[0])
            } else {
                messageStore.error(res?.message || '加载番剧/电影详情失败')
            }
        } else {
            // BV 详情：PGC 分集 BV 会被 view 接口 redirect 识别，自动切季模式
            const res = await biliVideoDetail(bvid.value)
            if (res?.success && res.data?.pgc?.season) {
                seasonDetail.value = res.data.pgc
                if (seasonEps.value.length > 0) playPgcEpisode(seasonEps.value[0])
            } else if (res?.success && res.data?.video) {
                detail.value = res.data
                // 初始化互动状态（已登录时 reqUser 带初始点赞/收藏/投币态）
                initInteractionState()
                // 官方接口实时拉取本账号互动状态（打开即有初始态，与B站网页一致）
                refreshInteractState()
                // 异步加载评论（不阻塞播放）
                loadComments(res.data.video.aid, true)
                // 默认播放 P1
                if (episodes.value.length > 0) {
                    playPage(episodes.value[0])
                }
            } else {
                messageStore.error(res?.message || '加载视频详情失败')
            }
        }
    } catch (e) {
        messageStore.error('加载详情失败: ' + e.message)
    } finally {
        loading.value = false
    }
}

// ===== PGC 分集取流（TV 接口 ep_id 优先 → Web pgc playurl 回退）=====
async function playPgcEpisode(ep) {
    if (!ep || !ep.epId) return
    currentPgcEp.value = ep
    playerError.value = ''
    playUrl.value = ''
    dashAudioUrl.value = ''
    playerLoading.value = true
    biliDanmaku.value = []
    // 换集刷新本账号互动状态（番剧/电影分集）
    refreshInteractState()
    // 换集重置评论（评论挂当前分集 aid）
    comments.value = []
    commentsTotal.value = 0
    commentsPage.value = 1
    commentsHasMore.value = false
    let res = null
    try {
        res = await biliAnimePlayurl({ epId: ep.epId, aid: ep.aid, cid: ep.cid, bvid: ep.bvid })
        if (!res?.success || !(res.videoUrl || res.url)) res = null
    } catch (e) { res = null }
    // TV 接口失败 → Web PGC 接口回退（试看/大会员画质）
    if (!res) {
        try {
            const wres = await biliVideoPgcPlayurl({ epId: ep.epId, cid: ep.cid, bvid: ep.bvid })
            if (wres?.success) res = wres
            else if (wres?.message) playerError.value = wres.message
        } catch (e) {
            playerError.value = e.message || ''
        }
    }
    if (res?.success && (res.videoUrl || res.url)) {
        const qualities = res.qualities || []
        biliQualities.value = qualities
        let chosen = null
        if (biliPreferredQn) chosen = qualities.find(q => q.qn === biliPreferredQn) || null
        if (!chosen) chosen = qualities[0] || null
        if (chosen) biliCurrentQn.value = chosen.qn
        if (res.type === 'dash') {
            playUrl.value = (chosen && chosen.videoUrl) || res.videoUrl
            dashAudioUrl.value = ((chosen && chosen.audioUrl) || res.audioUrl) || ''
        } else {
            playUrl.value = (chosen && chosen.videoUrl) || res.url
            dashAudioUrl.value = ''
        }
        playerLoading.value = false
        loadBiliDanmaku(ep.cid)
    } else {
        biliQualities.value = []
        biliCurrentQn.value = 0
        if (!playerError.value) {
            playerError.value = '取流失败：TV 与 Web 接口均未取得视频流（大会员内容请尝试 TV 端登录）'
        }
        playerLoading.value = false
    }
    // 异步加载当前分集评论
    loadComments(commentAid.value, true)
}

// PGC 上一集 / 下一集
function playPrevPgcEp() {
    const idx = currentPgcEpIdx.value
    if (idx > 0) playPgcEpisode(seasonEps.value[idx - 1])
}
function playNextPgcEp() {
    const idx = currentPgcEpIdx.value
    if (idx >= 0 && idx < seasonEps.value.length - 1) playPgcEpisode(seasonEps.value[idx + 1])
}

// 播放器角标：多分集时显示"正在播放"
const playerBadge = computed(() => {
    if (isPgcMode.value) {
        return currentPgcEp.value ? `正在播放：第${currentPgcEp.value.title}话${currentPgcEp.value.longTitle ? ' ' + currentPgcEp.value.longTitle : ''}` : ''
    }
    return currentEpisode.value && episodes.value.length > 1 ? `正在播放：${currentEpisode.value.title}` : ''
})
// PGC 当前分集映射为播放器选集结构
const currentPgcEpisodeForPlayer = computed(() => {
    if (!currentPgcEp.value) return null
    return pgcEpisodes.value[currentPgcEpIdx.value] || null
})
// 播放器选集分发：PGC 季走分集取流，普通视频走分P
function onSelectEpisode(ep) {
    if (isPgcMode.value) {
        const found = seasonEps.value.find(e => e.epId === ep.epId)
        if (found) playPgcEpisode(found)
    } else {
        playPage(ep)
    }
}

// ===== 播放指定分P =====
// 取流顺序：TV 接口（无水印，登录解锁 1080P+）→ 失败回退 Web 接口（带 Web 登录 Cookie）
// 充电专属视频（rights.ugc_pay）：TV 接口无法取流，直接走 Web 接口（需「已登录且已向该UP充电」）
async function playPage(ep) {
    if (!ep || !video.value) return
    currentEpisode.value = ep
    playerError.value = ''
    playUrl.value = ''
    dashAudioUrl.value = ''
    playerLoading.value = true
    // 换 P 先清旧弹幕，取流成功后异步拉本 P 弹幕
    biliDanmaku.value = []
    // 互动状态跟随当前 P（aid/bvid 不变，但保持与官方一致实时刷新）
    refreshInteractState()
    let res = null
    // 充电专属视频跳过 TV 接口（TV 对 ugc_pay 内容必然失败），直接 Web
    if (!video.value?.pay) {
        try {
            res = await biliAnimePlayurl({ aid: video.value.aid, cid: ep.cid, bvid: video.value.bvid })
            if (!res?.success || !(res.videoUrl || res.url)) res = null
        } catch (e) { res = null }
    }
    // TV 接口失败 → Web 接口回退（充电视频/受限内容）
    if (!res) {
        try {
            const wres = await biliVideoPlayurl({ bvid: video.value.bvid, cid: ep.cid, duration: ep.duration || video.value.duration, charge: !!video.value?.pay })
            if (wres?.success) res = wres
            else if (wres?.message) playerError.value = wres.message
        } catch (e) {
            playerError.value = e.message || ''
        }
    }
    if (res?.success && (res.videoUrl || res.url)) {
        // 画质列表：优先沿用用户上次选择的档位，无记忆或不可用时取最高
        const qualities = res.qualities || []
        biliQualities.value = qualities
        let chosen = null
        if (biliPreferredQn) {
            chosen = qualities.find(q => q.qn === biliPreferredQn) || null
        }
        if (!chosen) chosen = qualities[0] || null
        if (chosen) biliCurrentQn.value = chosen.qn
        if (res.type === 'dash') {
            playUrl.value = (chosen && chosen.videoUrl) || res.videoUrl
            dashAudioUrl.value = ((chosen && chosen.audioUrl) || res.audioUrl) || ''
        } else {
            playUrl.value = (chosen && chosen.videoUrl) || res.url
            dashAudioUrl.value = ''
        }
        playerLoading.value = false
        // 异步拉取本 P 弹幕（不阻塞播放）
        loadBiliDanmaku(ep.cid)
    } else {
        biliQualities.value = []
        biliCurrentQn.value = 0
        if (!playerError.value) {
            playerError.value = '取流失败：TV 与 Web 接口均未取得视频流，请检查网络或登录状态'
        }
        playerLoading.value = false
    }
}

// 播放器内切换画质：记录偏好档位（换 P 沿用），实际切流由 ArtVideoPlayer 内部完成
function onBiliQualityChange(qn) {
    biliPreferredQn = qn
    biliCurrentQn.value = qn
}

function replayCurrent() {
    if (isPgcMode.value) {
        if (currentPgcEp.value) playPgcEpisode(currentPgcEp.value)
    } else if (currentEpisode.value) {
        playPage(currentEpisode.value)
    }
}

// ===== 上一P / 下一P =====
const currentEpisodeIdx = computed(() => {
    if (!currentEpisode.value) return -1
    return episodes.value.findIndex(ep => ep.title === currentEpisode.value.title)
})
const hasPrevEpisode = computed(() => currentEpisodeIdx.value > 0)
const hasNextEpisode = computed(() => {
    const idx = currentEpisodeIdx.value
    return idx >= 0 && idx < episodes.value.length - 1
})
function playPrevEpisode() {
    const idx = currentEpisodeIdx.value
    if (idx > 0) playPage(episodes.value[idx - 1])
}
function playNextEpisode() {
    const idx = currentEpisodeIdx.value
    if (idx >= 0 && idx < episodes.value.length - 1) playPage(episodes.value[idx + 1])
}

// ===== 续播记忆 key：普通视频按 bvid+分P cid，PGC 按季+epId =====
const resumeKey = computed(() => {
    if (isPgcMode.value) {
        const ep = currentPgcEp.value
        return ep ? `pgc:${routeSeasonId.value || season.value?.id || ''}:${ep.epId || ep.bvid || ''}` : ''
    }
    if (!video.value) return ''
    return `bili:${video.value.bvid}:${currentEpisode.value?.cid || 'p1'}`
})

// ===== 自动连播：合集(ugc_season) / PGC 季 / 多P 播完自动下一集（默认开，可关并记忆） =====
const autoNext = ref(localStorage.getItem('bili_autonext') !== 'false')
function toggleAutoNext() {
    autoNext.value = !autoNext.value
    localStorage.setItem('bili_autonext', autoNext.value ? 'true' : 'false')
    messageStore.info(autoNext.value ? '已开启自动连播' : '已关闭自动连播')
}
function onPlayEnded() {
    if (!autoNext.value) return
    if (isPgcMode.value) {
        if (currentPgcEpIdx.value >= 0 && currentPgcEpIdx.value < seasonEps.value.length - 1) {
            const next = seasonEps.value[currentPgcEpIdx.value + 1]
            messageStore.info(`自动连播：第${next.title}话 ${next.longTitle || ''}`)
            setTimeout(() => playPgcEpisode(next), 1200)
        }
        return
    }
    // 合集下一集优先，其次多P下一P
    const sIdx = ugcSeasonCurrentIdx.value
    if (sIdx >= 0 && sIdx < ugcSeasonEpisodes.value.length - 1) {
        const next = ugcSeasonEpisodes.value[sIdx + 1]
        messageStore.info(`自动连播：${next.title || '下一集'}`)
        setTimeout(() => openUgcSeasonEpisode(next), 1200)
        return
    }
    if (hasNextEpisode.value) {
        const next = episodes.value[currentEpisodeIdx.value + 1]
        messageStore.info(`自动连播：${next.title || '下一P'}`)
        setTimeout(() => playNextEpisode(), 1200)
    }
}

// ===== 相关推荐 =====
const failedCovers = ref(new Set())
function onCoverError(url) {
    if (!url) return
    failedCovers.value = new Set([...failedCovers.value, url])
}
function isCoverFailed(url) {
    return failedCovers.value.has(url)
}
function openRelated(item) {
    if (!item?.bvid) return
    router.push(`/bilibili/${item.bvid}`)
}


// 进入 UP 主主页
function goUserSpace(mid) {
    if (!mid) return
    router.push(`/bilibili/user/${mid}`)
}

function goBack() {
    if (window.history.length > 1) {
        router.back()
    } else {
        router.push('/bilibili')
    }
}

// ===== 互动：点赞 / 投币 / 收藏（需 Web 登录，与网址解析共用账号）=====
const liked = ref(false)
const favored = ref(false)
const coined = ref(false)
const likeCount = ref(0)
const coinCount = ref(0)
const favCount = ref(0)
const interacting = ref(false)
const showCoinPanel = ref(false)

// 从详情 reqUser 初始化互动状态（已登录时 view 接口返回）
function initInteractionState() {
    const ru = video.value?.reqUser
    liked.value = !!ru?.like
    favored.value = !!ru?.favorite
    coined.value = (ru?.coin || 0) > 0
    likeCount.value = video.value?.stat?.like || 0
    coinCount.value = video.value?.stat?.coin || 0
    favCount.value = video.value?.stat?.favorite || 0
}

// 官方接口实时拉取本账号互动状态（点赞 has/like、投币 coins、收藏 fav folder，与B站网页一致）
// 未登录时接口返回默认态；单独失败静默，保留 reqUser 初始值
async function refreshInteractState() {
    // PGC（番剧/电影）：点赞/投币/收藏总数按季级 stat 展示（官方无需按分集查）；
    // 普通视频 stat 在 initInteractionState 已赋值，按 P 不变、无需重复处理
    if (isPgcMode.value && season.value?.stat) {
        likeCount.value = season.value.stat.like || 0
        coinCount.value = season.value.stat.coin || 0
        favCount.value = season.value.stat.favorite || 0
    }
    const aid = interactAid.value
    const bvid = interactBvid.value
    if (!aid && !bvid) return
    let data = null
    try {
        const res = await biliVideoInteract(aid, bvid)
        if (res?.success) data = res.data
    } catch (e) { /* 静默 */ }
    if (!data) return
    liked.value = !!data.liked
    coined.value = (data.coins || 0) > 0
    favored.value = !!data.favored
}

// Web 登录态变化后同步互动状态：登录成功立即回显点赞/收藏/投币态，登出清除残留态
watch(biliWebLoggedIn, (v) => {
    if (v) {
        refreshInteractState()
    } else {
        liked.value = false
        coined.value = false
        favored.value = false
    }
})

async function handleLike() {
    if (interacting.value) return
    if (!interactBvid.value) {
        messageStore.warning('该分集缺少视频标识，暂不支持点赞')
        return
    }
    interacting.value = true
    try {
        const next = !liked.value
        const res = await biliVideoLike(interactBvid.value, next ? 1 : 2)
        if (res?.success) {
            liked.value = next
            likeCount.value += next ? 1 : -1
            messageStore.success(next ? '已点赞' : '已取消点赞', 2000)
            // B站官方交互：点赞后若未投币，提示顺便投币支持 UP 主
            if (next && !coined.value) {
                messageStore.info('已点赞！顺便投个硬币支持UP主吧~', 3500)
            }
        } else {
            messageStore.error(res?.message || '点赞失败')
        }
    } catch (e) {
        messageStore.error(e.message || '点赞失败')
    } finally {
        interacting.value = false
    }
}

async function handleCoin(multiply = 1) {
    if (interacting.value) return
    if (!interactBvid.value && !interactAid.value) {
        messageStore.warning('该分集缺少视频标识，暂不支持投币')
        return
    }
    showCoinPanel.value = false
    interacting.value = true
    try {
        const res = await biliVideoCoin(interactBvid.value, multiply, 0, interactAid.value)
        if (res?.success) {
            coined.value = true
            coinCount.value += multiply
            messageStore.success(`成功投出 ${multiply} 枚硬币`, 2500)
        } else {
            messageStore.error(res?.message || '投币失败')
        }
    } catch (e) {
        messageStore.error(e.message || '投币失败')
    } finally {
        interacting.value = false
    }
}

// 投币面板开合（打开时挂一次性 document 点击监听实现点外关闭）
function toggleCoinPanel() {
    if (showCoinPanel.value) {
        showCoinPanel.value = false
        return
    }
    showCoinPanel.value = true
    setTimeout(() => {
        const close = () => { showCoinPanel.value = false }
        document.addEventListener('click', close, { once: true })
    }, 0)
}

async function handleFav() {
    if (interacting.value) return
    if (!interactAid.value) {
        messageStore.warning('该分集缺少视频标识，暂不支持收藏')
        return
    }
    interacting.value = true
    try {
        const next = !favored.value
        const res = await biliVideoFav(interactAid.value, !next)
        if (res?.success) {
            favored.value = next
            favCount.value += next ? 1 : -1
            messageStore.success(next ? '已加入默认收藏夹' : '已取消收藏', 2000)
        } else {
            messageStore.error(res?.message || '收藏失败')
        }
    } catch (e) {
        messageStore.error(e.message || '收藏失败')
    } finally {
        interacting.value = false
    }
}

// ===== 下载当前视频（按当前画质，TV/Web 流的 UA、Referer、Cookie 由下载器自动注入）=====
const downloading = ref(false)
async function handleDownload() {
    if (downloading.value) {
        messageStore.info('正在下载中，请查看右下角下载列表')
        return
    }
    if (!playUrl.value) {
        messageStore.warning('视频尚未就绪，请等待播放开始后再下载')
        return
    }
    downloading.value = true
    try {
        const curQ = biliQualities.value.find(q => q.qn === biliCurrentQn.value) || biliQualities.value[0]
        const epSuffix = isPgcMode.value
            ? (currentPgcEp.value ? ` - 第${currentPgcEp.value.title}话${currentPgcEp.value.longTitle ? ' ' + currentPgcEp.value.longTitle : ''}` : '')
            : (currentEpisode.value && episodes.value.length > 1 ? ` - ${currentEpisode.value.part || currentEpisode.value.title}` : '')
        const name = `${pageTitle.value || 'B站视频'}${epSuffix}`
        // DASH：url=视频流 + audioUrl=音频流（下载后 ffmpeg 自动合并）；durl 整段有声
        const url = (curQ && curQ.videoUrl) || playUrl.value
        const audioUrl = (curQ && curQ.audioUrl) || dashAudioUrl.value || ''
        const result = await downloadVideo({
            url,
            name,
            type: 'mp4',
            category: 'video',
            audioUrl
        })
        if (result?.success) {
            messageStore.success(`已开始下载：${name}（进度见右下角）`, 3000)
        } else if (!result?.canceled) {
            messageStore.error('下载失败：' + (result?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e))
    } finally {
        downloading.value = false
    }
}

// ===== 分享：复制视频链接（PGC 分集复制 bangumi 链接）=====
async function handleShare() {
    let link = ''
    if (isPgcMode.value) {
        link = currentPgcEp.value?.epId
            ? `https://www.bilibili.com/bangumi/play/ep${currentPgcEp.value.epId}`
            : `https://www.bilibili.com/bangumi/media/md${season.value?.seasonId || ''}`
    } else if (video.value?.bvid) {
        link = `https://www.bilibili.com/video/${video.value.bvid}`
    }
    if (!link) return
    try {
        await navigator.clipboard.writeText(link)
        messageStore.success('视频链接已复制到剪贴板', 2500)
    } catch (e) {
        // 剪贴板不可用时退回旧 API
        try {
            const ta = document.createElement('textarea')
            ta.value = link
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            messageStore.success('视频链接已复制到剪贴板', 2500)
        } catch (e2) {
            messageStore.error('复制失败，链接：' + link)
        }
    }
}

// ===== 装扮牌图片：canvas 按 alpha 包围盒裁掉透明画布（官方素材为带大片透明的宽幅横牌） =====
const sailingCropCache = new Map()
function onSailingImgLoad(e) {
    const el = e.target
    const original = el.src
    if (!original || el.src.startsWith('data:')) return
    const cached = sailingCropCache.get(original)
    if (cached) { el.src = cached; return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
        try {
            const c = document.createElement('canvas')
            c.width = img.naturalWidth
            c.height = img.naturalHeight
            const ctx = c.getContext('2d')
            ctx.drawImage(img, 0, 0)
            const data = ctx.getImageData(0, 0, c.width, c.height).data
            let minX = c.width, minY = c.height, maxX = -1, maxY = -1
            for (let y = 0; y < c.height; y++) {
                for (let x = 0; x < c.width; x++) {
                    if (data[(y * c.width + x) * 4 + 3] > 8) {
                        if (x < minX) minX = x
                        if (x > maxX) maxX = x
                        if (y < minY) minY = y
                        if (y > maxY) maxY = y
                    }
                }
            }
            if (maxX < 0) return
            const pad = 3
            minX = Math.max(0, minX - pad)
            minY = Math.max(0, minY - pad)
            const w = Math.min(c.width - minX, maxX - minX + 1 + pad * 2)
            const h = Math.min(c.height - minY, maxY - minY + 1 + pad * 2)
            const c2 = document.createElement('canvas')
            c2.width = w
            c2.height = h
            c2.getContext('2d').drawImage(img, minX, minY, w, h, 0, 0, w, h)
            const out = c2.toDataURL('image/png')
            sailingCropCache.set(original, out)
            el.src = out
        } catch (err) { /* 画布污染等失败时保留原图 */ }
    }
    img.src = original
}

// ===== 图片评论预览灯箱：滚轮/按钮缩放 + 左键拖动平移 + 下载 =====
const imgPreview = ref({ show: false, url: '', scale: 1, x: 0, y: 0 })
let previewDrag = null
function openImgPreview(url) {
    imgPreview.value = { show: true, url, scale: 1, x: 0, y: 0 }
}
function closeImgPreview() { imgPreview.value.show = false }
function previewZoom(factor) {
    imgPreview.value.scale = Math.min(8, Math.max(0.25, imgPreview.value.scale * factor))
}
function onPreviewWheel(e) { previewZoom(e.deltaY < 0 ? 1.15 : 0.87) }
function resetImgPreview() {
    imgPreview.value.scale = 1
    imgPreview.value.x = 0
    imgPreview.value.y = 0
}
function onPreviewDragStart(e) {
    previewDrag = { sx: e.clientX, sy: e.clientY, ox: imgPreview.value.x, oy: imgPreview.value.y }
    window.addEventListener('mousemove', onPreviewDragMove)
    window.addEventListener('mouseup', onPreviewDragEnd)
}
function onPreviewDragMove(e) {
    if (!previewDrag) return
    imgPreview.value.x = previewDrag.ox + (e.clientX - previewDrag.sx)
    imgPreview.value.y = previewDrag.oy + (e.clientY - previewDrag.sy)
}
function onPreviewDragEnd() {
    previewDrag = null
    window.removeEventListener('mousemove', onPreviewDragMove)
    window.removeEventListener('mouseup', onPreviewDragEnd)
}
function onPreviewKeydown(e) { if (e.key === 'Escape') closeImgPreview() }
// 下载原图：直接走应用统一下载管理器（下载页"文档"分类，不弹位置选择）
async function downloadCommentImage(url) {
    try {
        const { downloadStart } = await import('../api')
        await downloadStart({
            url,
            name: 'bilibili评论图片_' + Date.now() + '.png',
            category: 'document'
        })
        messageStore.success('图片已加入下载列表')
    } catch (e) {
        messageStore.error('图片下载失败：' + (e.message || '未知错误'))
    }
}

// ===== 回到评论区顶部（滚过评论区后出现，sticky 悬浮右下角） =====
const detailViewRef = ref(null)
const commentsPanelRef = ref(null)
const showCommentBackTop = ref(false)
function onDetailScroll() {
    const el = detailViewRef.value
    const cp = commentsPanelRef.value
    showCommentBackTop.value = !!(el && cp && el.scrollTop > cp.offsetTop + 240)
}
function backToCommentsTop() {
    const el = detailViewRef.value
    const cp = commentsPanelRef.value
    if (el && cp) el.scrollTo({ top: Math.max(cp.offsetTop - 8, 0), behavior: 'smooth' })
}

// 打开评论图片原图（走 open-external 通道交给系统浏览器/看图工具）
function openCommentPicture(url) {
    const b = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
    if (b?.send) b.send('open-external', url)
}

// ===== 评论区（游客可读，加载不阻塞播放）=====
const comments = ref([])
const commentsTotal = ref(0)
const commentsPage = ref(1)
const commentsHasMore = ref(false)
const commentsLoading = ref(false)

// 已展开子楼的评论：{ rpid -> { list, total, pn, hasMore, loading } }
const expandedReplies = ref({})
const failedAvatars = ref(new Set())
function onAvatarError(u) {
    if (!u) return
    failedAvatars.value = new Set([...failedAvatars.value, u])
}
function isAvatarFailed(u) {
    return failedAvatars.value.has(u)
}

async function loadComments(aid, reset = true) {
    if (!aid || commentsLoading.value) return
    commentsLoading.value = true
    try {
        const res = await biliVideoComments(aid, commentsPage.value)
        if (res?.success && res.data) {
            const list = res.data.list || []
            comments.value = reset ? list : [...comments.value, ...list]
            commentsTotal.value = res.data.total || 0
            commentsHasMore.value = !!res.data.hasMore
            if (res.data.next) commentsPage.value = res.data.next
        } else if (reset) {
            comments.value = []
            commentsTotal.value = 0
            // 首屏失败给出原因（风控/登录态等），不再静默成"永远加载中"
            if (res && res.message) messageStore.warning(`评论加载失败：${res.message}`)
        }
    } catch (e) {
        if (reset) messageStore.warning(`评论加载失败：${e.message || '网络错误'}`)
    }
    finally { commentsLoading.value = false }
}

function loadMoreComments() {
    if (!commentsHasMore.value || commentsLoading.value) return
    loadComments(commentAid.value, false)
}

async function toggleReplies(c) {
    const key = String(c.rpid)
    if (expandedReplies.value[key]) {
        delete expandedReplies.value[key]
        expandedReplies.value = { ...expandedReplies.value }
        return
    }
    // 展开：首次加载全部子楼（主楼自带预览，此处拉完整分页）
    const state = { list: [], total: c.rcount || 0, pn: 1, hasMore: false, loading: true }
    expandedReplies.value = { ...expandedReplies.value, [key]: state }
    try {
        const res = await biliVideoCommentReplies(commentAid.value, c.rpid, 1)
        if (res?.success && res.data) {
            state.list = res.data.list || []
            state.total = res.data.total || state.list.length
            state.hasMore = !!res.data.hasMore
        }
    } catch (e) { /* 静默失败 */ }
    finally {
        state.loading = false
        expandedReplies.value = { ...expandedReplies.value, [key]: { ...state } }
    }
}

async function loadMoreReplies(c) {
    const key = String(c.rpid)
    const state = expandedReplies.value[key]
    if (!state || state.loading) return
    state.pn++
    state.loading = true
    try {
        const res = await biliVideoCommentReplies(commentAid.value, c.rpid, state.pn)
        if (res?.success && res.data) {
            state.list = [...state.list, ...(res.data.list || [])]
            state.hasMore = !!res.data.hasMore
        }
    } catch (e) { /* 静默失败 */ }
    finally {
        state.loading = false
        expandedReplies.value = { ...expandedReplies.value, [key]: { ...state } }
    }
}

function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const now = new Date()
    const diff = (now - d) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
    if (diff < 86400 && d.getDate() === now.getDate()) return Math.floor(diff / 3600) + '小时前'
    const pad = (x) => String(x).padStart(2, '0')
    const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return ymd
}

// ===== 评论表情还原：[xxx] → emote 图片（size 1 小表情 22px / size 2 大表情 48px）=====
function renderCommentHtml(message, emote) {
    if (!message) return ''
    // 文本先做 HTML 转义（防 XSS）
    let safe = String(message)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    if (emote && typeof emote === 'object') {
        for (const [key, val] of Object.entries(emote)) {
            if (!val?.url) continue
            // key 做 HTML 转义 + 正则转义后，在已转义的文本中全局替换
            const escapedKeyHtml = key
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const url = String(val.url).replace(/^http:\/\//, 'https://')
            const size = Number(val.size) === 2
                ? 'height:50px;vertical-align:-14px'   // 大表情
                : 'height:22px;vertical-align:-4px'    // 小表情（行内）
            const img = `<img class="bili-emote" src="${url}" style="${size}" alt="${key}" referrerpolicy="no-referrer" loading="lazy" />`
            safe = safe.replace(new RegExp(escapedKeyHtml, 'g'), img)
        }
    }
    return safe.replace(/\n/g, '<br>')
}

// ===== 展示辅助 =====
function fmtCount(n) {
    const v = Number(n) || 0
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
    return String(v)
}
function fmtDuration(sec) {
    const s = Number(sec) || 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    const pad = (x) => String(x).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}
function fmtDate(ts) {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
    loadDetail()
    loadBiliTvStatus()
    loadWebStatus()
    window.addEventListener('keydown', onPreviewKeydown)
})

// 路由参数变化时重新加载（相关推荐跳转 / 季详情跳季）
watch(() => [route.params.bvid, route.params.seasonId], ([nb, ns], [ob, os]) => {
    if (nb !== ob || ns !== os) loadDetail()
})
</script>

<template>
    <div ref="detailViewRef" class="bili-detail-view" @scroll="onDetailScroll">
        <!-- 顶部栏 -->
        <div class="top-bar">
            <button class="icon-btn" @click="goBack" title="返回">
                <ChevronLeft :size="20" />
            </button>
            <div class="top-title">{{ pageTitle }}</div>
            <!-- 登录入口：Web 登录（点赞/投币/收藏） + TV 登录（高清取流） -->
            <div class="bili-login-wrap">
                <button
                    v-if="!biliWebLoggedIn"
                    class="login-capsule bili-web"
                    @click="handleWebLogin"
                    title="登录后可点赞/投币/收藏，解锁搜索与收藏夹"
                >
                    <Clapperboard :size="13" /><span>B站登录</span>
                </button>
                <button
                    v-else
                    class="login-capsule bili-web logged"
                    @click="handleWebLogin"
                    title="已登录B站账号，点击退出"
                >
                    <img
                        v-if="biliWebUserInfo?.face"
                        :src="biliWebUserInfo.face"
                        class="capsule-avatar"
                        alt=""
                        referrerpolicy="no-referrer"
                        @error="onWebAvatarError"
                    />
                    <Clapperboard v-else :size="13" />
                    <span class="capsule-name">{{ biliWebUserInfo?.uname || 'B站已登录' }}</span>
                </button>
                <button
                    v-if="!biliTvLoggedIn"
                    class="login-capsule bili-tv"
                    @click="handleBiliLogin"
                    title="TV 接口需扫码登录才能解锁 1080P+"
                >
                    <MonitorPlay :size="13" /><span>TV登录</span>
                </button>
                <button
                    v-else
                    class="login-capsule bili-tv logged"
                    @click="logoutBiliTv"
                    title="点击退出 TV 端登录"
                >
                    <img
                        v-if="biliTvUserInfo?.face"
                        :src="biliTvUserInfo.face"
                        class="capsule-avatar"
                        alt=""
                        referrerpolicy="no-referrer"
                        @error="onTvAvatarError"
                    />
                    <MonitorPlay v-else :size="13" />
                    <span class="capsule-name">{{ biliTvUserInfo?.uname || (biliTvMid ? `TV·${biliTvMid}` : 'TV已登录') }}</span>
                    <LogOut :size="12" />
                </button>
            </div>
        </div>

        <div v-if="loading" class="loading-full">
            <Loader2 :size="36" class="spin" />
            <p>加载中...</p>
        </div>

        <div v-else-if="!video && !seasonDetail" class="empty-full">
            <Clapperboard :size="48" />
            <p>未找到该内容</p>
            <button class="btn-primary" @click="goBack">返回</button>
        </div>

        <div v-else class="detail-body">
            <!-- 左侧：播放器 + 视频信息 -->
            <div class="left-col">
                <div class="player-wrapper">
                    <!-- TV 接口 DASH 直链 ArtVideoPlayer（弹幕 + 画质切换 + 选集；普通视频/PGC 分集共用） -->
                    <ArtVideoPlayer
                        v-if="playUrl && !playerError"
                        :src="playUrl"
                        play-type="direct"
                        :audio-url="dashAudioUrl"
                        :qualities="biliQualities"
                        :current-qn="biliCurrentQn"
                        :danmaku="biliDanmaku"
                        :badge="playerBadge"
                        :episodes="isPgcMode ? pgcEpisodes : episodes"
                        :current-episode="isPgcMode ? currentPgcEpisodeForPlayer : currentEpisode"
                        :has-prev="isPgcMode ? currentPgcEpIdx > 0 : hasPrevEpisode"
                        :has-next="isPgcMode ? currentPgcEpIdx >= 0 && currentPgcEpIdx < seasonEps.length - 1 : hasNextEpisode"
                        :resume-key="resumeKey"
                        @retry="replayCurrent"
                        @ended="onPlayEnded"
                        @prev="isPgcMode ? playPrevPgcEp() : playPrevEpisode()"
                        @next="isPgcMode ? playNextPgcEp() : playNextEpisode()"
                        @selectEpisode="onSelectEpisode"
                        @qualityChange="onBiliQualityChange"
                    />

                    <!-- 加载遮罩 -->
                    <div v-if="playerLoading && !playerError" class="player-mask">
                        <Loader2 :size="36" class="spin" />
                        <p>解析播放地址中...</p>
                    </div>

                    <!-- 错误遮罩 -->
                    <div v-if="playerError" class="player-mask error">
                        <Clapperboard :size="36" />
                        <p>{{ playerError }}</p>
                        <button class="btn-primary" @click="replayCurrent">
                            <RefreshCw :size="14" /> 重试
                        </button>
                    </div>
                </div>

                <!-- PGC（番剧/电影）信息区：季名 + 评分 + 统计 + 互动 + 标签 + 简介 -->
                <div class="video-info-card" v-if="isPgcMode">
                    <div class="pgc-title-row">
                        <span class="pgc-type-badge" :class="season.type === 2 ? 'movie' : 'bangumi'">{{ season.typeName }}</span>
                        <h1 class="video-title">{{ season.title }}</h1>
                    </div>
                    <!-- 数据行（B站官方：播放/弹幕/追番/评分，右侧下载/分享） -->
                    <div class="stat-row">
                        <span class="stat-item"><BiliIcon name="playcount" :size="16" /> {{ fmtCount(season.stat.view) }}</span>
                        <span class="stat-item"><BiliIcon name="danmcount" :size="16" /> {{ fmtCount(season.stat.danmaku) }}</span>
                        <span class="stat-item time">{{ season.newEpDesc }}</span>
                        <span v-if="season.rating" class="stat-item rating" title="B站评分">评分 {{ season.rating.toFixed(1) }}</span>
                        <span class="stat-actions">
                            <button class="action-btn download" :disabled="downloading || !playUrl" @click="handleDownload" title="下载当前分集（按当前画质）">
                                <Loader2 v-if="downloading" :size="13" class="spin" />
                                <Download v-else :size="13" />
                                {{ downloading ? '下载中' : '下载' }}
                            </button>
                            <button class="action-btn share" @click="handleShare" title="复制分集链接">
                                <BiliIcon name="share" :size="13" /> 分享
                            </button>
                        </span>
                    </div>
                    <!-- 互动栏（作用于当前分集；需 Web 登录） -->
                    <div class="interact-bar">
                        <button class="interact-btn" :class="{ active: liked }" :disabled="interacting" @click="handleLike">
                            <BiliIcon name="like" :size="18" />
                            <span class="interact-num">{{ fmtCount(likeCount) }}</span>
                        </button>
                        <div class="interact-coin-wrap">
                            <button class="interact-btn coin" :class="{ active: coined }" :disabled="interacting || coined" @click.stop="toggleCoinPanel" title="投币">
                                <BiliIcon name="coin" :size="18" />
                                <span class="interact-num">{{ fmtCount(coinCount) }}</span>
                            </button>
                            <transition name="modal">
                                <div v-if="showCoinPanel" class="coin-panel" @click.stop>
                                    <button class="coin-option coin-fill" @click="handleCoin(1)">
                                        <BiliIcon name="coin" :size="20" /> 投 1 枚
                                    </button>
                                    <button class="coin-option coin-line" @click="handleCoin(2)">
                                        <BiliIcon name="coin" :size="20" /> 投 2 枚
                                    </button>
                                    <p class="coin-tip">硬币余额请在B站查看</p>
                                </div>
                            </transition>
                        </div>
                        <button class="interact-btn" :class="{ active: favored }" :disabled="interacting" @click="handleFav">
                            <BiliIcon name="star" :size="18" />
                            <span class="interact-num">{{ fmtCount(favCount) }}</span>
                        </button>
                        <button class="interact-btn plain" @click="handleShare" title="复制分集链接">
                            <BiliIcon name="share" :size="18" />
                            <span class="interact-num">{{ fmtCount(season.stat.share) }}</span>
                        </button>
                    </div>
                    <!-- 标签行：风格 + 地区 -->
                    <div class="pgc-tags" v-if="season.styles.length || season.areas.length">
                        <span v-for="s in season.styles" :key="'s' + s" class="pgc-tag">{{ s }}</span>
                        <span v-for="a in season.areas" :key="'a' + a" class="pgc-tag area">{{ a }}</span>
                        <span v-if="season.pubTime" class="pgc-tag time">{{ season.pubTime.slice(0, 10) }}</span>
                    </div>
                    <!-- 简介（可展开） -->
                    <div class="desc-block" v-if="season.desc">
                        <p class="desc-text" :class="{ expanded: descExpanded }">{{ season.desc }}</p>
                        <button v-if="season.desc.length > 80" class="desc-toggle" @click="descExpanded = !descExpanded">
                            {{ descExpanded ? '收起' : '展开' }}
                            <ChevronDown :size="13" :class="{ rotated: descExpanded }" />
                        </button>
                    </div>
                </div>

                <!-- 视频信息区（仿B站官方详情，普通视频模式） -->
                <div class="video-info-card" v-if="!isPgcMode && video">
                    <h1 class="video-title">{{ video.title }}</h1>
                    <!-- 数据行（B站官方：播放/弹幕 + 时间，右侧下载/分享） -->
                    <div class="stat-row">
                        <span class="stat-item"><BiliIcon name="playcount" :size="16" /> {{ fmtCount(video.stat.view) }}</span>
                        <span class="stat-item"><BiliIcon name="danmcount" :size="16" /> {{ fmtCount(video.stat.danmaku) }}</span>
                        <span class="stat-item time">{{ fmtDate(video.pubdate) }}</span>
                        <span class="stat-item time">时长 {{ fmtDuration(video.duration) }}</span>
                        <span class="stat-actions">
                            <button class="action-btn download" :disabled="downloading || !playUrl" @click="handleDownload" title="下载当前视频（按当前画质）">
                                <Loader2 v-if="downloading" :size="13" class="spin" />
                                <Download v-else :size="13" />
                                {{ downloading ? '下载中' : '下载' }}
                            </button>
                            <button class="action-btn share" @click="handleShare" title="复制视频链接">
                                <BiliIcon name="share" :size="13" /> 分享
                            </button>
                        </span>
                    </div>
                    <!-- 互动栏（B站官方：点赞/投币/收藏，激活粉色；需 Web 登录） -->
                    <div class="interact-bar">
                        <button class="interact-btn" :class="{ active: liked }" :disabled="interacting" @click="handleLike">
                            <BiliIcon name="like" :size="18" />
                            <span class="interact-num">{{ fmtCount(likeCount) }}</span>
                        </button>
                        <div class="interact-coin-wrap">
                            <button class="interact-btn coin" :class="{ active: coined }" :disabled="interacting || coined" @click.stop="toggleCoinPanel" title="投币">
                                <BiliIcon name="coin" :size="18" />
                                <span class="interact-num">{{ fmtCount(coinCount) }}</span>
                            </button>
                            <transition name="modal">
                                <div v-if="showCoinPanel" class="coin-panel" @click.stop>
                                    <button class="coin-option coin-fill" @click="handleCoin(1)">
                                        <BiliIcon name="coin" :size="20" /> 投 1 枚
                                    </button>
                                    <button class="coin-option coin-line" @click="handleCoin(2)">
                                        <BiliIcon name="coin" :size="20" /> 投 2 枚
                                    </button>
                                    <p class="coin-tip">硬币余额请在B站查看</p>
                                </div>
                            </transition>
                        </div>
                        <button class="interact-btn" :class="{ active: favored }" :disabled="interacting" @click="handleFav">
                            <BiliIcon name="star" :size="18" />
                            <span class="interact-num">{{ fmtCount(favCount) }}</span>
                        </button>
                        <button class="interact-btn plain" @click="handleShare" title="复制视频链接">
                            <BiliIcon name="share" :size="18" />
                            <span class="interact-num">{{ fmtCount(video.stat.share) }}</span>
                        </button>
                    </div>
                    <!-- UP主信息（点击进入 UP 主页） -->
                    <div class="owner-row" v-if="video.owner.mid">
                        <img v-if="video.owner.face" :src="video.owner.face" class="owner-avatar" alt="" referrerpolicy="no-referrer" @click="goUserSpace(video.owner.mid)" />
                        <div v-else class="owner-avatar owner-avatar-placeholder" @click="goUserSpace(video.owner.mid)"><Users :size="20" /></div>
                        <div class="owner-info" @click="goUserSpace(video.owner.mid)">
                            <p class="owner-name">{{ video.owner.name }}</p>
                            <p class="owner-fans" v-if="ownerCard.fans">{{ fmtCount(ownerCard.fans) }} 粉丝</p>
                        </div>
                        <span class="owner-more" @click="goUserSpace(video.owner.mid)" title="查看 UP 主主页">
                            <MonitorPlay :size="14" /> 主页
                        </span>
                    </div>
                    <!-- 简介（可展开） -->
                    <div class="desc-block" v-if="video.desc">
                        <p class="desc-text" :class="{ expanded: descExpanded }">{{ video.desc }}</p>
                        <button v-if="video.desc.length > 80" class="desc-toggle" @click="descExpanded = !descExpanded">
                            {{ descExpanded ? '收起' : '展开' }}
                            <ChevronDown :size="13" :class="{ rotated: descExpanded }" />
                        </button>
                    </div>
                </div>

                <!-- 合集面板（ugc_season：多个独立 BV 组成的系列，普通视频模式） -->
                <div class="pages-panel" v-if="!isPgcMode && ugcSeasonEpisodes.length">
                    <div class="pages-header">
                        <span class="pages-title">
                            <Folder :size="14" style="vertical-align: -2px; margin-right: 4px" />
                            合集 {{ ugcSeason.title ? `「${ugcSeason.title}」` : '' }}（{{ ugcSeasonEpisodes.length }} 集，当前第 {{ ugcSeasonCurrentIdx >= 0 ? ugcSeasonCurrentIdx + 1 : '?' }} 集）
                        </span>
                        <label class="autonext-toggle" title="播完自动播放下一集" @click.prevent="toggleAutoNext">
                            <CheckSquare v-if="autoNext" :size="15" class="check-icon active" />
                            <Square v-else :size="15" class="check-icon" />
                            <span>自动连播</span>
                        </label>
                    </div>
                    <div class="pages-grid season-grid">
                        <button
                            v-for="(ep, idx) in ugcSeasonEpisodes"
                            :key="ep.bvid"
                            class="page-btn"
                            :class="{ active: ep.bvid === bvid }"
                            :title="ep.title"
                            @click="openUgcSeasonEpisode(ep)"
                        >
                            <span class="page-label">{{ idx + 1 }}. {{ ep.title }}</span>
                            <span class="page-duration">{{ fmtDuration(ep.duration) }}</span>
                        </button>
                    </div>
                </div>

                <!-- PGC 分集面板（番剧/电影，B站官方封面卡片网格） -->
                <div class="pages-panel" v-if="isPgcMode && seasonEps.length">
                    <div class="pages-header">
                        <span class="pages-title">
                            <Folder :size="14" style="vertical-align: -2px; margin-right: 4px" />
                            选集（{{ seasonEps.length }} 集，当前第 {{ currentPgcEpIdx >= 0 ? currentPgcEpIdx + 1 : '?' }} 集）
                        </span>
                        <label class="autonext-toggle" title="播完自动播放下一话" @click.prevent="toggleAutoNext">
                            <CheckSquare v-if="autoNext" :size="15" class="check-icon active" />
                            <Square v-else :size="15" class="check-icon" />
                            <span>自动连播</span>
                        </label>
                    </div>
                    <div class="pgc-eps-grid">
                        <button
                            v-for="(ep, idx) in seasonEps"
                            :key="ep.epId"
                            class="pgc-ep-card"
                            :class="{ active: currentPgcEpIdx === idx }"
                            :title="`第${ep.title}话 ${ep.longTitle}`"
                            @click="playPgcEpisode(ep)"
                        >
                            <div class="pgc-ep-cover">
                                <img v-if="ep.cover && !isCoverFailed(ep.cover)" :src="ep.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(ep.cover)" />
                                <div v-else class="pgc-ep-cover-placeholder"><Clapperboard :size="18" /></div>
                                <span class="pgc-ep-duration">{{ fmtDuration(ep.duration) }}</span>
                                <span v-if="ep.badge" class="pgc-ep-badge" :class="ep.badgeType === 2 ? 'vip' : (ep.badgeType === 1 ? 'pay' : '')">{{ ep.badge }}</span>
                            </div>
                            <p class="pgc-ep-title">第{{ ep.title }}话 {{ ep.longTitle }}</p>
                        </button>
                    </div>
                </div>

                <!-- 分P选集面板（多P视频显示，普通视频模式） -->
                <div class="pages-panel" v-if="!isPgcMode && episodes.length > 1">
                    <div class="pages-header">
                        <span class="pages-title">分P列表 ({{ episodes.length }})</span>
                        <label class="autonext-toggle" title="播完自动播放下一P" @click.prevent="toggleAutoNext">
                            <CheckSquare v-if="autoNext" :size="15" class="check-icon active" />
                            <Square v-else :size="15" class="check-icon" />
                            <span>自动连播</span>
                        </label>
                    </div>
                    <div class="pages-grid">
                        <button
                            v-for="ep in episodes"
                            :key="ep.title"
                            class="page-btn"
                            :class="{ active: currentEpisode?.title === ep.title }"
                            :title="ep.title"
                            @click="playPage(ep)"
                        >
                            <span class="page-label">{{ ep.title }}</span>
                            <span class="page-duration">{{ fmtDuration(ep.duration) }}</span>
                        </button>
                    </div>
                </div>
                <!-- 评论区 -->
                <div ref="commentsPanelRef" class="comments-panel">
                    <div class="pages-header">
                        <span class="pages-title">评论 <span class="comments-count">{{ commentsTotal ? fmtCount(commentsTotal) : comments.length }}</span></span>
                        <button
                            v-if="comments.length"
                            class="comments-refresh"
                            :disabled="commentsLoading"
                            title="刷新评论"
                            @click="commentsPage = 1; loadComments(commentAid, true)"
                        >
                            <RefreshCw :size="13" :class="{ spin: commentsLoading }" />
                        </button>
                    </div>

                    <!-- 评论加载中（首次） -->
                    <div v-if="commentsLoading && !comments.length" class="comments-loading">
                        <Loader2 :size="22" class="spin" />
                        <span>评论加载中...</span>
                    </div>

                    <!-- 评论列表 -->
                    <template v-else>
                        <div v-if="comments.length" class="comments-list">
                            <div v-for="c in comments" :key="c.rpid" class="comment-item">
                                <!-- 主楼 -->
                                <img
                                    v-if="c.avatar && !isAvatarFailed(c.avatar)"
                                    :src="c.avatar"
                                    class="comment-avatar clickable-avatar"
                                    alt=""
                                    title="进入主页"
                                    referrerpolicy="no-referrer"
                                    @click="goUserSpace(c.mid)"
                                    @error="onAvatarError(c.avatar)"
                                />
                                <div v-else class="comment-avatar comment-avatar-placeholder clickable-avatar" title="进入主页" @click="goUserSpace(c.mid)"><Users :size="16" /></div>
                                <div class="comment-main" :class="{ decorated: c.decorate }" :style="c.decorate ? { backgroundImage: `url(${c.decorate.bgUrl})` } : null">
                                    <div class="comment-head">
                                        <span class="comment-uname" :class="{ vip: c.vip }" :title="c.vip === 2 ? '年度大会员' : (c.vip === 1 ? '大会员' : '')">{{ c.uname }}</span>
                                        <img
                                            v-if="c.vip"
                                            class="comment-vip-badge"
                                            :class="{ gray: c.vip === 1 }"
                                            src="https://i0.hdslb.com/bfs/vip/3788b674c69072f1ee252b79a31ecc8c43af3039.png"
                                            :title="c.vip === 2 ? '年度大会员' : '大会员'"
                                            alt=""
                                            referrerpolicy="no-referrer"
                                        />
                                        <span v-if="c.isUp" class="comment-up-badge">UP主</span>
                                        <span v-if="c.fan" class="comment-fan-badge">
                                            <span class="fan-name">{{ c.fan.name }}</span>
                                            <span class="fan-level">{{ c.fan.level }}</span>
                                        </span>
                                        <img
                                            v-if="c.level"
                                            class="comment-level-badge"
                                            :src="`https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/level_${c.senior && c.level >= 6 ? 'h' : Math.min(c.level, 6)}.svg`"
                                            :title="c.senior && c.level >= 6 ? '硬核会员 LV6' : `LV${c.level}`"
                                            alt=""
                                            referrerpolicy="no-referrer"
                                        />
                                    </div>
                                    <p class="comment-text" v-html="renderCommentHtml(c.message, c.emote)"></p>
                                    <div v-if="c.pictures && c.pictures.length" class="comment-pictures">
                                        <img
                                            v-for="(pc, pi) in c.pictures"
                                            :key="pi"
                                            :src="pc.url"
                                            class="comment-picture"
                                            alt=""
                                            loading="lazy"
                                            referrerpolicy="no-referrer"
                                            @click="openImgPreview(pc.url)"
                                        />
                                    </div>
                                    <div class="comment-actions">
                                        <span class="comment-time">{{ fmtTime(c.ctime) }}</span>
                                        <span class="comment-like"><BiliIcon name="like" :size="13" /> {{ fmtCount(c.like) }}</span>
                                        <button
                                            v-if="c.rcount > 0"
                                            class="comment-reply-toggle"
                                            @click="toggleReplies(c)"
                                        >
                                            <MessageCircle :size="12" />
                                            {{ expandedReplies[String(c.rpid)] ? '收起回复' : `共 ${c.rcount} 条回复` }}
                                        </button>
                                    </div>


                                    <!-- 子楼（预览：未展开时显示主楼自带的前几条） -->
                                    <div v-if="!expandedReplies[String(c.rpid)] && c.replies.length" class="sub-comments">
                                        <div v-for="sc in c.replies" :key="sc.rpid" class="sub-comment-item">
                                            <span class="sub-uname">{{ sc.uname }}：</span>
                                            <span class="sub-text" v-html="renderCommentHtml(sc.message, sc.emote)"></span>
                                        </div>
                                        <button v-if="c.rcount > c.replies.length" class="comment-reply-toggle" @click="toggleReplies(c)">
                                            <CornerDownRight :size="12" /> 展开 {{ c.rcount }} 条回复
                                        </button>
                                    </div>

                                    <!-- 子楼（展开：完整分页） -->
                                    <div v-if="expandedReplies[String(c.rpid)]" class="sub-comments expanded">
                                        <template v-if="expandedReplies[String(c.rpid)].loading && !expandedReplies[String(c.rpid)].list.length">
                                            <div class="comments-loading"><Loader2 :size="18" class="spin" /><span>回复加载中...</span></div>
                                        </template>
                                        <template v-else>
                                            <div v-for="sc in expandedReplies[String(c.rpid)].list" :key="sc.rpid" class="sub-comment-item full">
                                                <img
                                                    v-if="sc.avatar && !isAvatarFailed(sc.avatar)"
                                                    :src="sc.avatar"
                                                    class="sub-avatar clickable-avatar"
                                                    alt=""
                                                    title="进入主页"
                                                    referrerpolicy="no-referrer"
                                                    @click="goUserSpace(sc.mid)"
                                                    @error="onAvatarError(sc.avatar)"
                                                />
                                                <div v-else class="sub-avatar sub-avatar-placeholder"><Users :size="12" /></div>
                                                <div class="sub-main">
                                                    <div class="comment-head">
                                                        <span class="comment-uname" :class="{ vip: sc.vip }" :title="sc.vip === 2 ? '年度大会员' : (sc.vip === 1 ? '大会员' : '')">{{ sc.uname }}</span>
                                                        <img
                                                            v-if="sc.vip"
                                                            class="comment-vip-badge"
                                                            :class="{ gray: sc.vip === 1 }"
                                                            src="https://i0.hdslb.com/bfs/vip/3788b674c69072f1ee252b79a31ecc8c43af3039.png"
                                                            :title="sc.vip === 2 ? '年度大会员' : '大会员'"
                                                            alt=""
                                                            referrerpolicy="no-referrer"
                                                        />
                                                        <span v-if="sc.isUp" class="comment-up-badge">UP主</span>
                                                        <span v-if="sc.fan" class="comment-fan-badge">
                                                            <span class="fan-name">{{ sc.fan.name }}</span>
                                                            <span class="fan-level">{{ sc.fan.level }}</span>
                                                        </span>
                                                        <img
                                                            v-if="sc.level"
                                                            class="sub-level-badge"
                                                            :src="`https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/level_${sc.senior && sc.level >= 6 ? 'h' : Math.min(sc.level, 6)}.svg`"
                                                            :title="sc.senior && sc.level >= 6 ? '硬核会员 LV6' : `LV${sc.level}`"
                                                            alt=""
                                                            referrerpolicy="no-referrer"
                                                        />
                                                    </div>
                                                    <p class="comment-text" v-html="renderCommentHtml(sc.message, sc.emote)"></p>
                                                    <div class="comment-actions">
                                                        <span class="comment-time">{{ fmtTime(sc.ctime) }}</span>
                                                        <span class="comment-like"><BiliIcon name="like" :size="13" /> {{ fmtCount(sc.like) }}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                v-if="expandedReplies[String(c.rpid)].hasMore"
                                                class="comment-reply-toggle"
                                                :disabled="expandedReplies[String(c.rpid)].loading"
                                                @click="loadMoreReplies(c)"
                                            >
                                                <Loader2 v-if="expandedReplies[String(c.rpid)].loading" :size="12" class="spin" />
                                                加载更多回复
                                            </button>
                                        </template>
                                    </div>
                                </div>

                                <!-- 个性装扮牌：佩戴的装扮商城评论卡装饰（官方样式：评论右上角） -->
                                <div v-if="c.sailing" class="comment-sailing" :title="c.sailing.name">
                                    <img :src="c.sailing.image" alt="" referrerpolicy="no-referrer" @load="onSailingImgLoad" />
                                    <span v-if="c.sailing.numDesc" class="cs-no" :style="{ color: c.sailing.color || '#61666d' }">{{ c.sailing.numPrefix || 'No.' }}<b>{{ c.sailing.numDesc }}</b></span>
                                </div>
                            </div>
                        </div>

                        <!-- 空态 / 加载更多 -->
                        <div v-if="!comments.length" class="comments-empty">
                            <MessageCircle :size="36" />
                            <p>暂无评论</p>
                        </div>
                        <button
                            v-if="comments.length && commentsHasMore"
                            class="comments-more"
                            :disabled="commentsLoading"
                            @click="loadMoreComments"
                        >
                            <Loader2 v-if="commentsLoading" :size="14" class="spin" />
                            {{ commentsLoading ? '加载中' : '加载更多评论' }}
                        </button>
                        <div v-else-if="comments.length && !commentsHasMore" class="comments-end">— 已加载全部评论 —</div>
                    </template>
                </div>
            </div>

            <!-- 右侧：相关推荐 -->
            <div class="right-col" v-if="related.length">
                <div class="related-header">
                    <h3 class="related-title">相关推荐</h3>
                </div>
                <div class="related-list">
                    <div
                        v-for="item in related"
                        :key="item.bvid"
                        class="related-item"
                        @click="openRelated(item)"
                    >
                        <div class="related-cover">
                            <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                            <div v-else class="related-cover-placeholder"><Clapperboard :size="20" /></div>
                            <span class="related-duration">{{ fmtDuration(item.duration) }}</span>
                        </div>
                        <div class="related-info">
                            <p class="related-name" :title="item.title">{{ item.title }}</p>
                            <p class="related-meta">
                                <BiliIcon name="playcount" :size="12" /> {{ fmtCount(item.play) }}
                                <BiliIcon name="danmcount" :size="12" /> {{ fmtCount(item.danmaku) }}
                            </p>
                            <p class="related-author"><Tv :size="11" /> {{ item.author }}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Web 扫码登录弹窗 -->
        <transition name="modal">
            <div v-if="showBiliWebQr" class="anime-overlay" @click.self="closeWebQr">
                <div class="bili-qr-modal">
                    <div class="qr-header">
                        <h3>B站账号扫码登录</h3>
                        <X :size="18" class="clickable" @click="closeWebQr" />
                    </div>
                    <div class="bili-qr-body">
                        <div v-if="webQrStatus === 'error'" class="bili-qr-error">
                            <p>{{ webQrError }}</p>
                            <button class="qr-btn" @click="refreshWebQr">
                                <RefreshCw :size="14" /> 重新获取
                            </button>
                        </div>
                        <div v-else-if="webQrStatus === 'expired'" class="bili-qr-expired">
                            <p>二维码已过期</p>
                            <button class="qr-btn" @click="refreshWebQr">
                                <RefreshCw :size="14" /> 刷新二维码
                            </button>
                        </div>
                        <div v-else class="bili-qr-img-wrap">
                            <img v-if="webQrImgUrl" :src="webQrImgUrl" alt="B站登录二维码" class="bili-qr-img" />
                            <div v-if="webQrStatus === 'scanned'" class="bili-qr-scanned">
                                <Check :size="40" />
                                <p>已扫码，请在手机上确认</p>
                            </div>
                        </div>
                        <div class="bili-qr-tips">
                            <p v-if="webQrStatus === 'waiting'">请使用 <strong>B站手机 App</strong> 扫码登录</p>
                            <p v-else-if="webQrStatus === 'scanned'">等待确认中...</p>
                            <p class="bili-qr-benefit">登录后解锁点赞/投币/收藏与搜索稳定访问</p>
                            <BiliCookieLogin mode="web" @success="loadWebStatus()" />
                        </div>
                    </div>
                </div>
            </div>
        </transition>

        <!-- TV 扫码登录弹窗 -->
        <transition name="modal">
            <div v-if="showBiliTvQr" class="anime-overlay" @click.self="closeBiliTvQr">
                <div class="bili-qr-modal">
                    <div class="qr-header">
                        <h3>TV 端扫码登录</h3>
                        <X :size="18" class="clickable" @click="closeBiliTvQr" />
                    </div>
                    <div class="bili-qr-body">
                        <div v-if="biliTvQrStatus === 'error'" class="bili-qr-error">
                            <p>{{ biliTvQrError }}</p>
                            <button class="qr-btn" @click="refreshBiliTvQr">
                                <RefreshCw :size="14" /> 重新获取
                            </button>
                        </div>
                        <div v-else-if="biliTvQrStatus === 'expired'" class="bili-qr-expired">
                            <p>二维码已过期</p>
                            <button class="qr-btn" @click="refreshBiliTvQr">
                                <RefreshCw :size="14" /> 刷新二维码
                            </button>
                        </div>
                        <div v-else class="bili-qr-img-wrap">
                            <img v-if="biliTvQrImgUrl" :src="biliTvQrImgUrl" alt="TV端登录二维码" class="bili-qr-img" />
                            <div v-if="biliTvQrStatus === 'scanned'" class="bili-qr-scanned">
                                <Check :size="40" />
                                <p>已扫码，请在手机上确认</p>
                            </div>
                        </div>
                        <div class="bili-qr-tips">
                            <p v-if="biliTvQrStatus === 'waiting'">请使用 <strong>B站手机 App</strong> 扫描二维码完成 TV 端登录</p>
                            <p v-else-if="biliTvQrStatus === 'scanned'">等待确认中...</p>
                            <p class="bili-qr-benefit">登录后解锁 1080P+/大会员档，未登录封顶 720P</p>
                            <BiliCookieLogin mode="tv" @success="loadBiliTvStatus()" />
                        </div>
                    </div>
                </div>
            </div>
        </transition>

        <!-- 图片评论预览灯箱：缩放/拖动/下载 -->
        <transition name="menu-fade">
            <div v-if="imgPreview.show" class="img-preview-mask" @click.self="closeImgPreview" @wheel.prevent="onPreviewWheel">
                <div class="img-preview-toolbar" @click.stop>
                    <button title="放大" @click="previewZoom(1.25)"><ZoomIn :size="16" /></button>
                    <button title="缩小" @click="previewZoom(0.8)"><ZoomOut :size="16" /></button>
                    <button title="重置" @click="resetImgPreview"><RotateCcw :size="16" /></button>
                    <button title="下载原图" @click="downloadCommentImage(imgPreview.url)"><Download :size="16" /></button>
                    <button title="关闭" @click="closeImgPreview"><X :size="16" /></button>
                </div>
                <img
                    class="img-preview-img"
                    :src="imgPreview.url"
                    :style="{ transform: 'translate(' + imgPreview.x + 'px, ' + imgPreview.y + 'px) scale(' + imgPreview.scale + ')' }"
                    draggable="false"
                    @mousedown.prevent="onPreviewDragStart"
                    @dblclick="resetImgPreview"
                />
            </div>
        </transition>

        <!-- 回到评论区顶部：滚过评论区后出现，sticky 悬浮在详情页右下角 -->
        <transition name="menu-fade">
            <button v-if="showCommentBackTop" class="comment-backtop" title="回到评论区顶部" @click="backToCommentsTop">
                <ChevronUp :size="20" />
            </button>
        </transition>
    </div>
</template>

<style scoped>
.bili-detail-view {
    padding: 16px 24px 24px;
    flex: 1;
    overflow-y: auto;
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    position: relative; /* 评论区 offsetTop 计算基准 */
}

/* 回到评论区顶部：sticky 悬浮在滚动区右下角 */
.comment-backtop {
    position: sticky;
    bottom: 18px;
    flex-shrink: 0;
    min-height: 40px;
    margin-left: auto;
    margin-right: 6px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: #fff;
    color: #fb7299;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.comment-backtop:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
}

/* 图片评论预览灯箱 */
.img-preview-mask {
    position: fixed;
    inset: 0;
    z-index: 4000;
    background: rgba(0, 0, 0, 0.82);
    display: flex;
    align-items: center;
    justify-content: center;
}
.img-preview-toolbar {
    position: absolute;
    top: 110px; /* 应用标题栏（约 90px，z-index 更高）会盖住 fixed 层顶部，工具栏下移避开 */
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.img-preview-toolbar button {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #444;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}
.img-preview-toolbar button:hover { background: #f0f0f0; color: #fb7299; }
.img-preview-img {
    max-width: 64vw;
    max-height: 68vh;
    border-radius: 6px;
    cursor: grab;
    user-select: none;
    transition: transform 0.08s linear;
}
.img-preview-img:active { cursor: grabbing; }

/* 顶部栏 */
.top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
}

.icon-btn {
    background: #fff;
    border: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    transition: all 0.2s;
    flex-shrink: 0;
}

.icon-btn:hover { color: #fb7299; transform: translateX(-2px); }

.top-title {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 加载/空态 */
.loading-full, .empty-full {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #999;
}

.empty-full p { margin: 0; color: #666; }

.btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #fb7299;
    color: #fff;
    border: none;
    padding: 8px 18px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.2s;
}

.btn-primary:hover { background: #ff8bab; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 主体两栏 */
.detail-body {
    display: flex;
    gap: 18px;
    align-items: flex-start;
}

.left-col { flex: 1; min-width: 0; }

.right-col {
    width: 330px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
}

/* 播放器 */
.player-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.player-mask {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #fff;
    z-index: 5;
}

.player-mask p { margin: 0; font-size: 14px; }
.player-mask.error p { color: #ffb3c6; }

/* 视频信息卡 */
.video-info-card {
    background: #fff;
    border-radius: 10px;
    padding: 16px 18px;
    margin-top: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.video-title {
    margin: 0 0 10px;
    font-size: 17px;
    font-weight: 600;
    color: #333;
    line-height: 1.5;
}

.stat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #f0f0f0;
}

.stat-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #888;
    white-space: nowrap;
    min-width: max-content; /* 统计项永不收缩：容器再窄也整项换行，杜绝互相叠压 */
}
/* 官方统计字形（playcount/danmcount）图案在 24 视框内偏下，上移使图案与文字视觉居中 */
.stat-item :deep(svg) {
    transform: translateY(-2.5px);
}

.stat-item.time { color: #bbb; }

/* 操作按钮（下载/分享，仿B站官方详情页圆角按钮） */
.stat-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
}

.action-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}

.action-btn.download {
    background: #fb7299;
    color: #fff;
}

.action-btn.download:hover:not(:disabled) { background: #ff8bab; }
.action-btn.download:disabled { opacity: 0.55; cursor: default; }

.action-btn.share {
    background: #f1f2f3;
    color: #61666d;
}

.action-btn.share:hover { background: #e3e5e7; color: #fb7299; }

/* ===== 互动栏（B站官方风格：点赞/投币/收藏/分享 大按钮）===== */
.interact-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #f1f2f3;
}

.interact-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 18px;
    border-radius: 8px;
    border: none;
    background: #f1f2f3;
    color: #61666d;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}

.interact-btn:hover:not(:disabled) {
    background: rgba(251, 114, 153, 0.1);
    color: #fb7299;
}

.interact-btn:disabled {
    opacity: 0.7;
    cursor: default;
}

/* 激活态：B站粉 */
.interact-btn.active {
    background: rgba(251, 114, 153, 0.1);
    color: #fb7299;
}

.interact-btn.active:hover:not(:disabled) {
    background: rgba(251, 114, 153, 0.18);
    color: #fb7299;
}

.interact-btn.plain:hover:not(:disabled) { color: #61666d; background: #e3e5e7; }

.interact-num { font-weight: 500; }

/* ===== 投币按钮（B站官方金色主题：金币图标 + 金色激活态）===== */
.interact-btn.coin svg { color: #f0ab00; }
.interact-btn.coin:hover:not(:disabled) {
    background: rgba(240, 171, 0, 0.12);
    color: #c98f12;
}
.interact-btn.coin:hover:not(:disabled) svg { color: #f7b500; }
.interact-btn.coin.active {
    background: rgba(240, 171, 0, 0.13);
    color: #c98f12;
}
.interact-btn.coin.active svg { color: #f0ab00; }
.interact-btn.coin.active:hover:not(:disabled) {
    background: rgba(240, 171, 0, 0.2);
    color: #c98f12;
}
.interact-btn.coin:disabled { opacity: 0.55; }

/* 投币弹层（选 1/2 枚，B站官方投币面板：金色胶囊按钮） */
.interact-coin-wrap { position: relative; }

.coin-panel {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    padding: 10px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 150px;
}

.coin-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid #f1f2f3;
    background: #fafafa;
    color: #61666d;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
}

/* 投 1 枚：金色实底白字（官方主按钮） */
.coin-option.coin-fill {
    background: linear-gradient(135deg, #ffd75c, #ffa81f);
    border: none;
    color: #fff;
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(255, 168, 31, 0.35), inset 0 -2px 0 rgba(0, 0, 0, 0.08);
}
.coin-option.coin-fill svg { color: #fff; }
.coin-option.coin-fill:hover {
    background: linear-gradient(135deg, #ffd75c, #ffa81f);
    border-color: transparent;
    color: #fff;
    filter: brightness(1.06);
}

/* 投 2 枚：金色描边（官方次按钮） */
.coin-option.coin-line {
    background: #fff;
    border: 1px solid #ffcf5c;
    color: #d8990a;
}
.coin-option.coin-line svg { color: #f0ab00; }
.coin-option.coin-line:hover {
    border-color: #ffa81f;
    background: #fffaf0;
    color: #d8990a;
}

.coin-tip {
    margin: 2px 0 0;
    font-size: 11px;
    color: #c9ccd0;
    text-align: center;
}

/* ===== B站表情（评论区 emote 图片）===== */
.comment-text .bili-emote,
.sub-text .bili-emote {
    border-radius: 3px;
    margin: 0 1px;
}

.sub-text .bili-emote { max-height: 44px; }

/* UP主 */
.owner-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0;
}

.owner-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid #f0f0f0;
}

.owner-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f7f7f7;
    color: #ccc;
}

.owner-info { min-width: 0; }

.owner-name {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #fb7299;
}

.owner-fans { margin: 2px 0 0; font-size: 12px; color: #999; }

.owner-more {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #fb7299;
    background: rgba(251, 114, 153, 0.08);
    padding: 4px 10px;
    border-radius: 12px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.2s;
}

.owner-more:hover { background: rgba(251, 114, 153, 0.18); }

/* 简介 */
.desc-block { padding-top: 2px; }

.desc-text {
    margin: 0;
    font-size: 13px;
    color: #666;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    /* 折叠动画用纯 max-height 实现：-webkit-line-clamp 会把内容锁死在 3 行导致过渡失效 */
    overflow: hidden;
    max-height: calc(1.7em * 3);
    transition: max-height 0.35s ease;
}

.desc-text.expanded {
    max-height: 1200px;
    transition: max-height 0.45s ease;
}

.desc-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: none;
    border: none;
    color: #fb7299;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0 0;
}

.desc-toggle .rotated { transform: rotate(180deg); }

/* 分P列表 */
.pages-panel {
    background: #fff;
    border-radius: 10px;
    padding: 14px 16px;
    margin-top: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.pages-header {
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

/* 自动连播开关（合集/选集/分P面板头部右侧） */
.autonext-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    user-select: none;
    padding-right: 10px;
}
.autonext-toggle .check-icon { cursor: pointer; }
.autonext-toggle span { line-height: 1; }
.autonext-toggle:hover { color: #fb7299; }

.pages-title {
    font-size: 14px;
    font-weight: 600;
    color: #333;
    padding-left: 10px;
    border-left: 3px solid #fb7299;
}

.pages-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
}

.page-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    background: #f7f7f7;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
}

.page-btn:hover { border-color: #fb7299; background: #fff5f8; }

.page-btn.active {
    background: #fb7299;
    border-color: #fb7299;
}

.page-btn.active .page-label, .page-btn.active .page-duration { color: #fff; }

.page-label {
    font-size: 12px;
    color: #333;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.page-duration { font-size: 11px; color: #999; }

/* ===== PGC（番剧/电影）信息卡与分集 ===== */
.pgc-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.pgc-title-row .video-title { margin: 0; flex: 1; min-width: 0; }

.pgc-type-badge {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    padding: 2px 8px;
    border-radius: 4px;
}

.pgc-type-badge.bangumi { background: #fb7299; }
.pgc-type-badge.movie { background: #23ade5; }

.stat-item.rating {
    color: #ffb027;
    font-weight: 600;
}

.pgc-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
}

.pgc-tag {
    font-size: 11px;
    color: #61666d;
    background: #f1f2f3;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap; /* 日期标签不在连字符处竖向折行 */
}

.pgc-tag.area { color: #23ade5; background: rgba(35, 173, 229, 0.1); }
.pgc-tag.time { color: #999; }

/* PGC 分集封面卡片网格（仿B站官方选集） */
.pgc-eps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    max-height: 420px;
    overflow-y: auto;
}

.pgc-ep-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: none;
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 0;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
    overflow: hidden;
}

.pgc-ep-card:hover { border-color: rgba(251, 114, 153, 0.4); }

.pgc-ep-card.active {
    border-color: #fb7299;
    background: rgba(251, 114, 153, 0.04);
}

.pgc-ep-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: 6px;
    overflow: hidden;
    background: #f0f0f0;
}

.pgc-ep-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.pgc-ep-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
}

.pgc-ep-duration {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
}

.pgc-ep-badge {
    position: absolute;
    left: 0;
    top: 0;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    padding: 1px 6px;
    border-radius: 0 0 6px 0;
    background: #ffb027;
}

.pgc-ep-badge.vip { background: #fb7299; }
.pgc-ep-badge.pay { background: #ff6b00; }

.pgc-ep-title {
    margin: 0;
    font-size: 12px;
    color: #333;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding: 0 2px;
}

.pgc-ep-card.active .pgc-ep-title { color: #fb7299; font-weight: 600; }

/* ===== 评论官方徽章：大会员/UP主/粉丝牌 ===== */
.comment-avatar.clickable-avatar, .sub-avatar.clickable-avatar { cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.comment-avatar.clickable-avatar:hover, .sub-avatar.clickable-avatar:hover { transform: scale(1.08); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }

.comment-uname.vip { color: #fb7299; }

/* 大会员徽章：B站官方图标（i0.hdslb.com/bfs/vip）；月度大会员官方惯例为灰色 */
.comment-vip-badge {
    height: 14px;
    width: auto;
    flex-shrink: 0;
}
.comment-vip-badge.gray {
    filter: grayscale(1);
    opacity: 0.65;
}


.comment-up-badge {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: #fb7299;
    padding: 0 5px;
    border-radius: 3px;
    line-height: 1.6;
}

.comment-fan-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    border-radius: 3px;
    overflow: hidden;
    line-height: 1.5;
}

.comment-fan-badge .fan-name {
    font-size: 10px;
    color: #fff;
    background: #58b6e8;
    padding: 0 4px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.comment-fan-badge .fan-level {
    font-size: 10px;
    font-weight: 600;
    color: #58b6e8;
    background: #fff;
    border: 1px solid #58b6e8;
    border-left: none;
    padding: 0 3px;
    border-radius: 0 3px 3px 0;
}

/* ===== 评论区 ===== */
.comments-panel {
    background: #fff;
    border-radius: 10px;
    padding: 14px 16px;
    margin-top: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.comments-count { color: #fb7299; font-weight: 600; }

.comments-refresh {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: inline-flex;
    transition: all 0.2s;
}

.comments-refresh:hover:not(:disabled) { color: #fb7299; background: rgba(251, 114, 153, 0.08); }
.comments-refresh:disabled { opacity: 0.5; cursor: default; }

.comments-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 30px 0;
    color: #999;
    font-size: 13px;
}

.comments-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 30px 0;
    color: #ccc;
}

.comments-empty p { margin: 0; font-size: 13px; color: #999; }

.comments-list { display: flex; flex-direction: column; }

.comment-item {
    display: flex;
    gap: 10px;
    padding: 12px 0;
    border-bottom: 1px solid #f5f5f5;
}

.comment-item:last-child { border-bottom: none; }

.comment-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid #f0f0f0;
}

.comment-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f7f7f7;
    color: #ccc;
}

.comment-main { flex: 1; min-width: 0; }

.comment-head {
    display: flex;
    align-items: center;
    gap: 6px;
}

.comment-uname {
    font-size: 13px;
    font-weight: 600;
    color: #61666d;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 等级徽章（仿B站：低级灰绿→高级橙） */
/* 官方等级徽章 SVG（30x30 视框中徽章带居中），与用户名行垂直居中对齐 */
.comment-level-badge { flex-shrink: 0; width: 30px; height: 30px; }

/* 楼中楼等级徽章（官方 SVG，略小一号） */
.sub-level-badge { flex-shrink: 0; width: 26px; height: 26px; margin-top: -1px; }

/* 个性装扮牌：装扮图 + 编号（官方布局：评论右上角，编号在图右侧竖排） */
.comment-sailing {
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    flex-shrink: 0;
}
.comment-sailing img {
    height: 46px;
    width: auto;
    object-fit: contain;
}
.comment-sailing .cs-no {
    font-size: 10px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
}
.comment-sailing .cs-no b {
    display: block;
    font-size: 12px;
    letter-spacing: 0.5px;
}

/* 图片评论缩略图 */
.comment-pictures {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 2px 0 6px;
}
.comment-picture {
    max-height: 140px;
    max-width: 220px;
    border-radius: 8px;
    cursor: zoom-in;
    object-fit: cover;
}

/* 个性装扮评论卡：官方装扮卡背景整卡铺底，白字+阴影保证可读 */
.comment-main.decorated {
    background-size: 100% 100%;
    background-repeat: no-repeat;
    border-radius: 10px;
    padding: 10px 12px;
    min-height: 96px;
}
.comment-main.decorated .comment-uname { color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
.comment-main.decorated .comment-text { color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
.comment-main.decorated .comment-text :deep(img) { text-shadow: none; }
.comment-main.decorated .comment-time,
.comment-main.decorated .comment-like { color: rgba(255,255,255,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
.comment-main.decorated .comment-reply-toggle { color: rgba(255,255,255,0.9); }

.comment-text {
    margin: 4px 0 6px;
    font-size: 14px;
    color: #333;
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-word;
}

.comment-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 12px;
    color: #9499a0;
}

.comment-time { color: #9499a0; }

.comment-like {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.comment-reply-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: #9499a0;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s;
}

.comment-reply-toggle:hover:not(:disabled) { color: #fb7299; }
.comment-reply-toggle:disabled { opacity: 0.5; cursor: default; }

/* 子楼 */
.sub-comments {
    margin-top: 8px;
    background: #f7f8fa;
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.sub-comment-item {
    font-size: 13px;
    color: #333;
    line-height: 1.6;
}

.sub-comment-item.full { display: flex; gap: 8px; }

.sub-uname { color: #61666d; font-weight: 600; }

.sub-text { color: #333; word-break: break-word; }

.sub-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid #eee;
}

.sub-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ececec;
    color: #bbb;
}

.sub-main { flex: 1; min-width: 0; }

.comments-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    margin-top: 12px;
    background: rgba(251, 114, 153, 0.06);
    border: 1px solid rgba(251, 114, 153, 0.25);
    color: #fb7299;
    font-size: 13px;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
}

.comments-more:hover:not(:disabled) { background: rgba(251, 114, 153, 0.12); }
.comments-more:disabled { opacity: 0.6; cursor: default; }

.comments-end {
    text-align: center;
    font-size: 12px;
    color: #c9ccd0;
    padding: 12px 0 4px;
}

/* 相关推荐 */
.related-header { margin-bottom: 10px; }

.related-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #333;
    padding-left: 10px;
    border-left: 3px solid #fb7299;
}

.related-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.related-item {
    display: flex;
    gap: 10px;
    background: #fff;
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    transition: all 0.2s;
}

.related-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(251, 114, 153, 0.18);
}

.related-cover {
    position: relative;
    width: 130px;
    aspect-ratio: 16/9;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: #f0f0f0;
}

.related-cover img { width: 100%; height: 100%; object-fit: cover; }

.related-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
}

.related-duration {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
}

.related-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }

.related-name {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: #333;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.related-meta {
    margin: 0;
    font-size: 11px;
    color: #999;
    display: flex;
    align-items: center;
    gap: 8px;
}

.related-meta svg { margin-right: 1px; }

.related-author {
    margin: 0;
    font-size: 11px;
    color: #999;
    display: flex;
    align-items: center;
    gap: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 登录胶囊（web / TV） */
.bili-login-wrap { display: flex; align-items: center; gap: 8px; }

.login-capsule {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: 14px;
    border: 1px solid rgba(251, 114, 153, 0.5);
    background: rgba(251, 114, 153, 0.08);
    color: #fb7299;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.login-capsule.bili-tv:hover,
.login-capsule.bili-web:hover { background: rgba(251, 114, 153, 0.16); }

.login-capsule.logged {
    background: #fb7299;
    color: #fff;
    border-color: #fb7299;
}

.capsule-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
}

.capsule-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 弹窗遮罩与二维码 */
.anime-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.bili-qr-modal {
    background: #fff;
    border-radius: 12px;
    width: 320px;
    padding: 20px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.qr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.qr-header h3 { margin: 0; font-size: 16px; color: #333; }
.clickable { cursor: pointer; color: #999; }
.clickable:hover { color: #fb7299; }

.bili-qr-body { text-align: center; }

.bili-qr-img-wrap {
    position: relative;
    width: 240px;
    height: 240px;
    margin: 0 auto;
}

.bili-qr-img { width: 100%; height: 100%; }

.bili-qr-scanned {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #fb7299;
    border-radius: 8px;
}

.bili-qr-scanned p { margin: 0; font-size: 13px; color: #666; }

.bili-qr-error, .bili-qr-expired {
    padding: 30px 0;
    color: #999;
}

.bili-qr-error p, .bili-qr-expired p { margin: 0 0 12px; font-size: 14px; }

.qr-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #fb7299;
    color: #fff;
    border: none;
    padding: 8px 18px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.2s;
}

.qr-btn:hover { background: #ff8bab; }

.bili-qr-tips { margin-top: 14px; }

.bili-qr-tips p { margin: 4px 0; font-size: 12px; color: #888; }

.bili-qr-benefit { color: #bbb; }

/* 弹窗过渡 */
.modal-enter-active, .modal-leave-active { transition: opacity 0.25s ease; }
.modal-enter-active .bili-qr-modal, .modal-leave-active .bili-qr-modal { transition: transform 0.25s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .bili-qr-modal, .modal-leave-to .bili-qr-modal { transform: scale(0.92); }
</style>
