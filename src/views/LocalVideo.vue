<script setup>
// 本地视频 + 链接/直播流 播放
// - 本地视频：通过文件对话框导入，扫描元数据
// - 链接/直播流：用户添加 http(s)://...mp4/m3u8/flv 或直播流地址
//   支持：mp4/webm 直链、HLS(m3u8)、FLV；直播流自动识别并标记 LIVE
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { FolderOpen, Play, Trash2, FolderPlus, Film, Clock, Link2, Radio, Plus, Pencil, Check, X, Download, Search, Globe, User, LogOut, RefreshCw, Youtube, Copy, Send, MonitorPlay, ListFilter, ImagePlus, Bookmark, Square, CheckSquare, Settings, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { downloadVideo, parseVideoUrl, biliLoginQr, biliLoginCheck, biliLoginStatus, biliLogout, biliTvLoginQr, biliTvLoginCheck, biliTvLoginStatus, biliTvLogout, youtubeLoginOpen, youtubeLoginClose, youtubeLoginStatus, youtubeLogout, onYoutubeLoginDone, biliLiveRoom, biliLiveAreas, biliLiveStart, biliLiveUpdate, biliLiveStop, biliFavList, biliFavContent, biliFavSeason, biliArchives, downloadStart, onDownloadDone, onDownloadError, downloadGetDir, getBiliApiMode, setBiliApiMode } from '../api'
import CustomSelect from '../components/CustomSelect.vue'

// 平台图标（解析框上方滚动展示）
import platformDouyin from '../assets/icons/douyin.png'
import platformBilibili from '../assets/icons/bilibili.svg'
import platformKuaishou from '../assets/icons/kuaishou.svg'
import platformHuya from '../assets/icons/huya.png'
import platformDouyu from '../assets/icons/douyu.png'
import platformYoutube from '../assets/icons/youtube.svg'
import platformKick from '../assets/icons/kick.svg'
import platformTwitch from '../assets/icons/twitch.svg'
// 解析框上方滚动展示的平台与其用处说明
const platformScrollItems = [
    { id: 'douyin', name: '抖音', icon: platformDouyin, desc: '抖音：解析短视频与直播，官方接口无水印，支持播放与批量下载' },
    { id: 'bilibili', name: 'B站', icon: platformBilibili, desc: 'B站：解析视频/番剧/电影/直播，TV 接口无水印片源，登录解锁高清' },
    { id: 'kuaishou', name: '快手', icon: platformKuaishou, desc: '快手：解析短视频与直播，官方接口无水印，支持播放与批量下载' },
    { id: 'huya', name: '虎牙', icon: platformHuya, desc: '虎牙：解析直播流（FLV/HLS），可播放与下载' },
    { id: 'douyu', name: '斗鱼', icon: platformDouyu, desc: '斗鱼：解析直播流（FLV/HLS），可播放与下载' },
    { id: 'youtube', name: 'YouTube', icon: platformYoutube, desc: 'YouTube：解析视频与直播，登录后解锁高画质/受限内容' },
    { id: 'kick', name: 'Kick', icon: platformKick, desc: 'Kick：解析直播流（HLS），可播放与下载' },
    { id: 'twitch', name: 'Twitch', icon: platformTwitch, desc: 'Twitch：解析直播流，HLS 低延迟实时跟播' }
]
// 无缝滚动需要两组相同内容
const platformScrollGroups = [0, 1]

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const loading = ref(false)
const localVideos = ref(JSON.parse(localStorage.getItem('local_videos') || '[]'))

// 链接/直播流列表
const streams = ref(JSON.parse(localStorage.getItem('video_streams') || '[]'))

// ===== 列表分页（本地视频、链接/直播流）=====
const localPage = ref(1)
const localPageSize = 24
const streamsPage = ref(1)
const streamsPageSize = 10
const paginatedLocalVideos = computed(() => {
    const start = (localPage.value - 1) * localPageSize
    return localVideos.value.slice(start, start + localPageSize)
})
const localPageCount = computed(() => Math.max(1, Math.ceil(localVideos.value.length / localPageSize)))
const paginatedStreams = computed(() => {
    const start = (streamsPage.value - 1) * streamsPageSize
    return streams.value.slice(start, start + streamsPageSize)
})
const streamsPageCount = computed(() => Math.max(1, Math.ceil(streams.value.length / streamsPageSize)))
watch(localVideos, () => { if (localPage.value > localPageCount.value) localPage.value = localPageCount.value })
watch(streams, () => { if (streamsPage.value > streamsPageCount.value) streamsPage.value = streamsPageCount.value })
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

// 当前活动标签：local | streams | parse | biliLive
const activeTab = ref('local')

// ===== 网址解析 =====
const parseInput = ref('')
const parseLoading = ref(false)
const parseResults = ref([])  // [{url, type, title, audioUrl?, bili?}]
const parsePageTitle = ref('')
// 正在下载的解析结果 URL（用于禁用按钮）
const parsingDownloadingUrl = ref('')

// ===== 解析设置（B站接口模式：web | tv） =====
const parseSettingsOpen = ref(false)
const biliApiMode = ref('web')
const BILI_API_OPTIONS = [
    { value: 'web', label: 'Web 接口' },
    { value: 'tv', label: 'TV 接口' }
]
const parseSettingsRef = ref(null)
// 点击面板外部时关闭
const handleGlobalClick = (e) => {
    if (parseSettingsOpen.value && parseSettingsRef.value && !parseSettingsRef.value.contains(e.target)) {
        parseSettingsOpen.value = false
    }
}
// 读取主进程持久化的 B站解析接口模式
const loadBiliApiMode = async () => {
    try {
        const m = await getBiliApiMode()
        if (m === 'tv' || m === 'web') biliApiMode.value = m
    } catch (e) {}
}
const switchBiliApiMode = async (m) => {
    try {
        const r = await setBiliApiMode(m)
        if (r?.success) {
            biliApiMode.value = r.mode
            messageStore.success(r.mode === 'tv' ? 'B站解析已切换到 TV 接口（无水印片源，右上角 TV登录 可解锁高画质）' : 'B站解析已切换到 Web 接口（登录 Cookie 提画质）')
        }
    } catch (e) {}
}

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

// ===== B站 TV 端登录（云视听小电视 access_key，解锁 TV 接口高画质） =====
// TV 接口（api.snm0516.aisee.tv）不吃网页 Cookie，需用 B站手机 App 扫码完成 TV 端登录。
const biliTvLoggedIn = ref(false)
const biliTvMid = ref('')
const biliTvUserInfo = ref(null)
const showBiliTvQr = ref(false)
const biliTvQrUrl = ref('')
const biliTvAuthCode = ref('')
const biliTvLocalId = ref('')
const biliTvQrStatus = ref('')  // '' | 'waiting' | 'scanned' | 'expired' | 'error'
const biliTvQrError = ref('')
let biliTvPollTimer = null

async function loadBiliTvStatus() {
    try {
        const res = await biliTvLoginStatus()
        if (res?.success && res.loggedIn) {
            biliTvLoggedIn.value = true
            biliTvMid.value = res.mid || ''
            biliTvUserInfo.value = res.userInfo || null
        } else {
            biliTvLoggedIn.value = false
            biliTvMid.value = ''
            biliTvUserInfo.value = null
        }
    } catch (e) {}
}

async function openBiliTvLogin() {
    if (showBiliTvQr.value) return
    showBiliTvQr.value = true
    biliTvQrStatus.value = ''
    biliTvQrError.value = ''
    try {
        const res = await biliTvLoginQr()
        if (res?.success) {
            biliTvQrUrl.value = res.qrcodeUrl
            biliTvAuthCode.value = res.authCode
            biliTvLocalId.value = res.localId
            biliTvQrStatus.value = 'waiting'
            startBiliTvPoll()
        } else {
            biliTvQrStatus.value = 'error'
            biliTvQrError.value = res?.message || '获取二维码失败'
        }
    } catch (e) {
        biliTvQrStatus.value = 'error'
        biliTvQrError.value = e.message || '获取二维码失败'
    }
}

function startBiliTvPoll() {
    stopBiliTvPoll()
    biliTvPollTimer = setInterval(async () => {
        try {
            const res = await biliTvLoginCheck({ authCode: biliTvAuthCode.value, localId: biliTvLocalId.value })
            if (res?.loggedIn) {
                stopBiliTvPoll()
                biliTvLoggedIn.value = true
                showBiliTvQr.value = false
                await loadBiliTvStatus()
                messageStore.success('TV端登录成功，TV 接口已解锁高画质', 3000)
            } else if (res?.status === 'scanned') {
                biliTvQrStatus.value = 'scanned'
            } else if (res?.status === 'expired') {
                stopBiliTvPoll()
                biliTvQrStatus.value = 'expired'
            }
        } catch (e) {}
    }, 2000)
}

function stopBiliTvPoll() {
    if (biliTvPollTimer) { clearInterval(biliTvPollTimer); biliTvPollTimer = null }
}

function closeBiliTvQr() {
    showBiliTvQr.value = false
    stopBiliTvPoll()
}

async function refreshBiliTvQr() {
    stopBiliTvPoll()
    await openBiliTvLogin()
}

async function logoutBiliTv() {
    if (!await messageStore.confirm('确定退出 TV 端登录？TV 接口将回落 720P。', '退出TV登录')) return
    try {
        await biliTvLogout()
        biliTvLoggedIn.value = false
        biliTvMid.value = ''
        biliTvUserInfo.value = null
        messageStore.success('已退出 TV 端登录')
    } catch (e) { messageStore.error('退出失败') }
}

// ===== B站直播开播（OBS 推流参数）=====
// 状态：idle | ready | starting | live | stopping
const biliLiveState = ref('idle')
const liveRoomLoading = ref(false)
const liveRoomInfo = ref(null)   // {roomId, shortId, liveStatus, title}
const liveAreas = ref([])
const liveAreaLoading = ref(false)
const liveTitle = ref('')
const liveAreaV2 = ref(null)
// 上次使用的分区ID（来自直播间信息 area_v2），用于加载分区列表后自动选中
const lastLiveArea = ref(null)
// 推流平台：pc（电脑直播姬）| pc_link（直播间伴侣）
const livePlatform = ref('pc')
const livePlatformOptions = [
    { value: 'pc', label: 'PC 电脑直播姬' },
    { value: 'pc_link', label: 'pc_link 直播间伴侣' }
]
const liveStartLoading = ref(false)
const liveStreamInfo = ref(null) // {fullUrl, serverAddr, streamCode, streamCodeNoQ, liveKey}
const liveStopLoading = ref(false)
// 直播封面：dataURI 字符串；仅供 startLive 开播时附带
const liveCover = ref('')
const coverInputRef = ref(null)
// 封面预览比例切换：169（Web 端 16:9）| 43（移动端 4:3）
const coverRatio = ref('169')
const liveSaveLoading = ref(false)

// 选择封面图片并读取为 dataURI（B站 startLive 的 cover 参数）
// 不压缩、不限制大小：原图直传，由主进程官方接口链路上传
function onCoverPick(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(jpeg|png|jpg)$/i.test(file.type)) {
        messageStore.warning('仅支持 JPG/PNG 格式封面图', 3000)
        return
    }
    const reader = new FileReader()
    reader.onload = () => { liveCover.value = reader.result }
    reader.onerror = () => messageStore.error('读取封面图片失败')
    reader.readAsDataURL(file)
}

function clearLiveCover() {
    liveCover.value = ''
}

// ===== B站管理子 Tab（直播推流 / 收藏夹 / UP投稿）=====
const biliSubTab = ref('live')
function switchBiliSubTab(t) {
    biliSubTab.value = t
    if (t === 'favs') { if (!favList.value.length) loadFavList() }
}


// ---------- 收藏夹 ----------
const favList = ref([])
const favLoading = ref(false)
const favOpen = ref(false)
const favFolderTitle = ref('')
const favMedias = ref([])
const favPage = ref(1)
const favTotal = ref(0)
const favHasMore = ref(false)
const favSelected = ref(new Set())
const favLoadingContent = ref(false)
const favTotalPages = computed(() => Math.max(1, Math.ceil(favTotal.value / 20)))
async function loadFavList() {
    favLoading.value = true
    try {
        const res = await biliFavList()
        if (res?.success) favList.value = res.list || []
        else messageStore.warning(res?.message || '获取收藏夹失败', 3000)
    } catch (e) { messageStore.error('获取收藏夹失败') }
    finally { favLoading.value = false }
}
async function openFav(f) {
    favOpen.value = true
    favFolderTitle.value = f.title
    favPage.value = 1
    favMedias.value = []
    favTotal.value = 0
    favSelected.value = new Set()
    await loadFavContent(1)
}
function closeFav() {
    favOpen.value = false
    favFolderTitle.value = ''
    favMedias.value = []
    favTotal.value = 0
    favSelected.value = new Set()
}
async function loadFavContent(pn) {
    favLoadingContent.value = true
    try {
        const cur = favList.value.find(x => x.title === favFolderTitle.value)
        if (!cur) return
        const res = await biliFavContent({ fid: cur.id, pn, ps: 20 })
        if (res?.success) {
            favMedias.value = res.medias || []
            favHasMore.value = !!res.hasMore
            favTotal.value = res.total || 0
            favPage.value = pn
        } else {
            messageStore.warning(res?.message || '获取收藏内容失败', 3000)
        }
    } catch (e) { messageStore.error('获取收藏内容失败') }
    finally { favLoadingContent.value = false }
}
function toggleFavSel(id) {
    const s = new Set(favSelected.value)
    if (s.has(id)) s.delete(id); else s.add(id)
    favSelected.value = s
}
const favAllChecked = computed(() => favMedias.value.length > 0 && favSelected.value.size === favMedias.value.filter(m => m.downloadable).length)
function toggleFavAll() {
    if (favAllChecked.value) favSelected.value = new Set()
    else favSelected.value = new Set(favMedias.value.filter(m => m.downloadable).map(m => m.id))
}
// 复制收藏项分享链接（带 bvid 用标准分享格式；无 bvid 用原始链接），可粘贴到「网址解析」
function copyBiliShare(m) {
    const url = m.bvid
        ? `https://www.bilibili.com/video/${m.bvid}/?share_source=copy_web&vd_source=`
        : (m.link || '')
    if (!url) { messageStore.warning('该收藏项无分享链接', 2000); return }
    copyToClipboard(url, '分享链接')
}

// ---------- 收藏夹：合集/番剧展开 ----------
// 合集(type21)展开为普通视频；番剧/影视(type4)走 pgc 集数接口；
// 普通视频(type2)点"查合集"走 ugc_season 查询（收藏的可能是合集下的单条视频）
const seasonExpanded = ref(new Set())
const seasonData = ref({})
async function toggleSeason(m) {
    const id = m.id
    const s = new Set(seasonExpanded.value)
    if (s.has(id)) { s.delete(id); seasonExpanded.value = s; return }
    s.add(id)
    seasonExpanded.value = s
    if (!seasonData.value[id]) {
        seasonData.value = { ...seasonData.value, [id]: { title: m.title, archives: [], loading: true, error: '' } }
        try {
            const res = await biliFavSeason({
                mid: m.upperMid,
                seasonId: m.seasonId || 0,
                bvid: m.bvid || '',
                epId: m.epId || 0,
                pn: 1, ps: 30,
                isPgc: m.type === 4 || m.isBangumi
            })
            if (res?.success) {
                seasonData.value = { ...seasonData.value, [id]: { title: res.seasonTitle || m.title, archives: res.archives || [], loading: false, error: '' } }
            } else {
                seasonData.value = { ...seasonData.value, [id]: { title: m.title, archives: [], loading: false, error: res?.message || '加载失败' } }
            }
        } catch (e) {
            seasonData.value = { ...seasonData.value, [id]: { title: m.title, archives: [], loading: false, error: '加载失败' } }
        }
    }
}
async function downloadSeasonBatch(seasonId) {
    const data = seasonData.value[seasonId]
    if (!data || !data.archives.length) return
    if (!await messageStore.confirm(`将串行下载本合集 ${data.archives.length} 个视频到下载专区（完成一个再下下一个），确定？`, '批量下载合集')) return
    batchDownloading.value = true
    batchTotal.value = data.archives.length
    batchDone.value = 0
    batchFail.value = 0
    for (const v of data.archives) {
        batchCurrentName.value = v.title
        try {
            const ok = await downloadOne('https://www.bilibili.com/video/' + v.bvid, v.title)
            if (ok) batchDone.value++; else batchFail.value++
        } catch (e) { batchFail.value++ }
    }
    batchDownloading.value = false
    batchCurrentName.value = ''
    messageStore.success(`合集下载完成：成功 ${batchDone.value} 个，失败 ${batchFail.value} 个`, 4000)
}

// ---------- 批量下载（串行：第一个完成后再下第二个） ----------
// 下载目录：设置页"下载专区"配置的统一下载目录（音乐/视频等所有下载共用，主进程持久化），未配置时用系统下载区
async function resolveVideoDownloadDir() {
    try {
        const d = await downloadGetDir()
        if (d?.success && d.dir) return d.dir.replace(/[\\/]+$/, '')
    } catch (e) {}
    return ''
}
const batchDownloading = ref(false)
const batchTotal = ref(0)
const batchDone = ref(0)
const batchFail = ref(0)
const batchCurrentName = ref('')
function waitDownloadDone(id) {
    return new Promise((resolve) => {
        let settled = false
        const finish = (ok) => {
            if (settled) return
            settled = true
            try { offD() } catch (e) {}
            try { offE() } catch (e) {}
            resolve(ok)
        }
        const offD = onDownloadDone((d) => { if (d && d.id === id) finish(true) })
        const offE = onDownloadError((d) => { if (d && d.id === id) finish(false) })
        setTimeout(() => finish(false), 30 * 60 * 1000)
    })
}
async function downloadOne(input, title, tag) {
    let s
    if (typeof input === 'string') {
        const res = await parseVideoUrl(input)
        if (!res?.success || !res.streams?.length) throw new Error((tag ? tag + '：' : '') + (res?.message || '解析失败，无可用视频流'))
        s = res.streams[0]
    } else {
        s = input
    }
    const safe = String(title || 'video').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'video'
    const baseDir = await resolveVideoDownloadDir()
    // 图文图片按 .jpg 保存，其余视频一律 .mp4
    const filePath = baseDir ? `${baseDir}\\${safe}\\${safe}${input && input.isImage ? '.jpg' : '.mp4'}` : ''
    const params = {
        url: s.url,
        name: safe,
        category: 'video',
        type: s.type === 'm3u8' ? 'm3u8' : undefined,
        audioUrl: s.audioUrl || '',
        ytSrc: s.ytSrc || '',
        ytHeight: s.ytHeight || 0,
        askPath: false,
        savePath: filePath || undefined
    }
    const r = await downloadStart(params)
    if (!r?.success) throw new Error((tag ? tag + '：' : '') + (r?.error || '启动下载失败'))
    return await waitDownloadDone(r.downloadId)
}
async function downloadBiliVideo(url, title) {
    if (batchDownloading.value) { messageStore.info('批量下载进行中，请稍候', 2500); return }
    try {
        await downloadOne(url, title)
        messageStore.success('下载完成：' + title, 3000)
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e), 4000)
    }
}
async function downloadFavBatch() {
    const items = favMedias.value.filter(m => favSelected.value.has(m.id))
    if (!items.length) { messageStore.warning('请先勾选要下载的视频', 2500); return }
    if (!await messageStore.confirm(`将串行下载 ${items.length} 个视频到下载专区（完成一个再下下一个），确定？`, '批量下载')) return
    batchDownloading.value = true
    batchTotal.value = items.length
    batchDone.value = 0
    batchFail.value = 0
    for (const m of items) {
        batchCurrentName.value = m.title
        try {
            const ok = await downloadOne('https://www.bilibili.com/video/' + m.bvid, m.title)
            if (ok) batchDone.value++; else batchFail.value++
        } catch (e) { batchFail.value++ }
    }
    batchDownloading.value = false
    batchCurrentName.value = ''
    messageStore.success(`批量下载完成：成功 ${batchDone.value} 个，失败 ${batchFail.value} 个`, 4000)
}

// ===== 网址解析结果：多选批量下载（串行）=====
const parseSel = ref(new Set())
const parseAllChecked = computed(() => parseResults.value.length > 0 && parseSel.value.size === parseResults.value.length)
function toggleParseSel(url) {
    const s = new Set(parseSel.value)
    if (s.has(url)) s.delete(url); else s.add(url)
    parseSel.value = s
}
function toggleParseAll() {
    if (parseAllChecked.value) parseSel.value = new Set()
    else parseSel.value = new Set(parseResults.value.map(x => x.url))
}
async function downloadParseBatch() {
    const items = parseResults.value.filter(x => parseSel.value.has(x.url))
    if (!items.length) { messageStore.warning('请先勾选要下载的视频流', 2500); return }
    if (!await messageStore.confirm(`将串行下载 ${items.length} 个视频流到下载专区（完成一个再下下一个），确定？`, '批量下载')) return
    batchDownloading.value = true
    batchTotal.value = items.length
    batchDone.value = 0
    batchFail.value = 0
    for (const s of items) {
        // 批量下载：文件名剥掉 [画质]（如 [1080p]）/（已登录）等装饰，只留主体标题（与单条下载一致）；
        // 图文图片保留 [图N/M] 序号，避免同名覆盖
        batchCurrentName.value = s.isImage
            ? ((s.title || parsePageTitle.value || '图文图片').trim() || '图文图片')
            : (s.title || parsePageTitle.value || '视频流')
                .replace(/\s*\[[^\]]*\]\s*/g, '')
                .replace(/\s*[（(]已登录[）)]\s*/g, '')
                .trim() || parsePageTitle.value || '视频流'
        try {
            const ok = await downloadOne(s, batchCurrentName.value, '下载')
            if (ok) batchDone.value++; else batchFail.value++
        } catch (e) { batchFail.value++ }
    }
    batchDownloading.value = false
    batchCurrentName.value = ''
    messageStore.success(`批量下载完成：成功 ${batchDone.value} 个，失败 ${batchFail.value} 个`, 4000)
}

// 数字/时长格式化（空间数据、收藏夹展示）
function fmtNum(n) {    if (n === null || n === undefined) return '-'
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
}
function fmtDuration(s) {
    if (!s) return ''
    s = Math.floor(s)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0')
}
function formatPubTime(ts) {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 父分区分组（供 CustomSelect 分组渲染）
const liveAreaOptions = computed(() => {
    const groups = {}
    for (const a of liveAreas.value) {
        if (!groups[a.parentName]) groups[a.parentName] = []
        groups[a.parentName].push({ value: a.id, label: a.name })
    }
    return Object.entries(groups).map(([name, children]) => ({ group: name, children }))
})

async function loadBiliLiveRooms() {
    if (!biliLoggedIn.value) return
    liveRoomLoading.value = true
    try {
        const res = await biliLiveRoom()
        if (res?.success) {
            liveRoomInfo.value = res
            if (res.title) liveTitle.value = res.title
            // 读取之前设置的直播封面（仅当用户尚未新选封面时才覆盖，避免覆盖正在选择的图）
            if (!liveCover.value && res.cover) liveCover.value = res.cover
            // 记住上次使用的分区ID，加载分区列表后自动选中
            if (res.areaV2) lastLiveArea.value = res.areaV2
            if (res.liveStatus === 1) biliLiveState.value = 'live'
            else biliLiveState.value = 'ready'
            if (liveAreas.value.length === 0) loadBiliLiveAreas()
        } else {
            liveRoomInfo.value = null
            biliLiveState.value = 'idle'
            if (res?.notOpen) messageStore.warning('尚未开通直播间，请先在B站直播中心开通', 4000)
            else if (res?.message) messageStore.warning(res.message, 4000)
        }
    } catch (e) {
        biliLiveState.value = 'idle'
        messageStore.error('获取直播间信息失败')
    } finally {
        liveRoomLoading.value = false
    }
}

async function loadBiliLiveAreas() {
    if (liveAreas.value.length > 0) return
    liveAreaLoading.value = true
    try {
        const res = await biliLiveAreas()
        if (res?.success) {
            liveAreas.value = res.areas || []
            // 优先选中上次使用的分区（若存在），否则默认选“视频”/“聊天”
            const remembered = lastLiveArea.value && liveAreas.value.find(a => a.id === lastLiveArea.value)
            if (remembered) {
                liveAreaV2.value = remembered.id
            } else {
                const first = liveAreas.value.find(a => a.name === '视频' || a.name === '聊天')
                if (first) liveAreaV2.value = first.id
            }
        } else {
            messageStore.warning(res?.message || '获取分区列表失败', 3000)
        }
    } catch (e) {
        messageStore.error('获取分区列表失败')
    } finally {
        liveAreaLoading.value = false
    }
}

async function saveBiliLiveInfo() {
    if (!liveRoomInfo.value?.roomId) return
    if (!liveAreaV2.value) { messageStore.warning('请选择直播分区', 3000); return }
    liveSaveLoading.value = true
    try {
        const res = await biliLiveUpdate({
            roomId: liveRoomInfo.value.roomId,
            title: liveTitle.value,
            areaV2: liveAreaV2.value,
            cover: liveCover.value || undefined
        })
        if (res?.success) {
            messageStore.success('直播间信息已保存', 2500)
        } else {
            messageStore.error(res?.message || '保存直播间信息失败', 4000)
        }
    } catch (e) {
        messageStore.error('保存失败：' + (e.message || '网络错误'))
    } finally {
        liveSaveLoading.value = false
    }
}

async function startBiliLive() {
    if (!liveRoomInfo.value?.roomId) return
    if (!liveAreaV2.value) { messageStore.warning('请选择直播分区', 3000); return }
    // 明确告知：生成推流参数 = 立即开播，黑屏转圈属正常（需 OBS 推流才有画面）
    if (!await messageStore.confirm('生成推流参数会立即开播直播间（B站将显示"直播中"，黑屏转圈属正常）。\n请先准备好 OBS：确定继续开播？', '开播确认')) return
    liveStartLoading.value = true
    try {
        const res = await biliLiveStart({
            roomId: liveRoomInfo.value.roomId,
            areaV2: liveAreaV2.value,
            title: liveTitle.value,
            platform: livePlatform.value,
            cover: liveCover.value || undefined
        })
        if (res?.success) {
            liveStreamInfo.value = res
            // 记录实际生效的平台，供关播时保持一致
            if (res.platform) livePlatform.value = res.platform
            biliLiveState.value = 'live'
            if (res.coverErr) {
                messageStore.warning(`已开播！将服务器地址/串流密钥填入 OBS 开始推流（黑屏正常，推流后即有画面）。标题/封面设置失败：${res.coverErr}`, 6000)
            } else {
                messageStore.success(`已开播！请将服务器地址/串流密钥复制到 OBS（黑屏正常，推流后即有画面）。平台：${livePlatform.value}`, 5000)
            }
        } else {
            // 平台要求认证时正常提示，不绕过
            if (res?.code === 60024) {
                messageStore.error('该分区开播需要人脸认证，请到B站直播中心完成认证后重试', 5000)
            } else {
                messageStore.error(res?.message || '开播失败', 4000)
            }
        }
    } catch (e) {
        messageStore.error('开播失败：' + (e.message || '网络错误'))
    } finally {
        liveStartLoading.value = false
    }
}

async function stopBiliLive() {
    if (!liveRoomInfo.value?.roomId) return
    liveStopLoading.value = true
    try {
        const res = await biliLiveStop({ roomId: liveRoomInfo.value.roomId, platform: livePlatform.value })
        if (res?.success) {
            liveStreamInfo.value = null
            biliLiveState.value = 'ready'
            messageStore.success('已停止直播')
        } else {
            messageStore.error(res?.message || '停止直播失败')
        }
    } catch (e) {
        messageStore.error('停止直播失败')
    } finally {
        liveStopLoading.value = false
    }
}

// 复制文本到剪贴板
async function copyToClipboard(text, label) {
    try {
        await navigator.clipboard.writeText(text)
        messageStore.success(`${label} 已复制`, 2000)
    } catch (e) {
        try {
            const ta = document.createElement('textarea')
            ta.value = text
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            messageStore.success(`${label} 已复制`, 2000)
        } catch (e2) {
            messageStore.error('复制失败')
        }
    }
}

// 头像加载失败时清空 face，回退到 User 图标
function onAvatarError() {
    if (biliUserInfo.value) biliUserInfo.value = { ...biliUserInfo.value, face: '' }
}
// TV 端头像加载失败时回退到 MonitorPlay 图标
function onTvAvatarError() {
    if (biliTvUserInfo.value) biliTvUserInfo.value = { ...biliTvUserInfo.value, face: '' }
}

// 二维码图片 URL（用在线 API 生成）
const biliQrImgUrl = computed(() => {
    if (!biliQrUrl.value) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(biliQrUrl.value)}`
})
// TV 端登录二维码图片 URL（qrcodeUrl 是链接字符串，需转成二维码图片）
const biliTvQrImgUrl = computed(() => {
    if (!biliTvQrUrl.value) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(biliTvQrUrl.value)}`
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

// 切换到 B站推流 Tab 时自动加载直播间信息
watch(activeTab, (tab) => {
    if (tab === 'biliLive') {
        if (biliLoggedIn.value) loadBiliLiveRooms()
        else messageStore.info('请先登录B站账号', 2500)
    }
})

// 从粘贴文本中提取第一个链接（支持 B站分享文案如「【标题】 https://...」直接粘贴，无需手动删文字）
function extractVideoUrl(text) {
    const t = String(text || '').trim()
    const m = t.match(/https?:\/\/[^\s"'<>，。！？、]+/i)
    return m ? m[0].replace(/[，。！？、]+$/, '') : t
}

const handleParseUrl = async () => {
    const url = extractVideoUrl(parseInput.value)
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
    if (/\b2k\b/.test(t)) return 1440
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

// 封面图加载失败时隐藏（抖音/快手封面 CDN 偶尔需要 Referer，加载不出就不显示）
const onParseCoverError = (e) => { if (e?.target) e.target.style.display = 'none' }

// ===== 图文图集浏览（抖音/快手图文作品解析出的图片流）=====
const galleryOpen = ref(false)
const galleryList = ref([])      // 图片 URL 全列表
const galleryIndex = ref(0)      // 当前图片下标
const galleryTitle = ref('')     // 图集标题（剥离 [图N/M] 装饰）
const galleryLoading = ref(false)
const openParseGallery = (s) => {
    galleryList.value = (Array.isArray(s.imageList) && s.imageList.length) ? s.imageList : [s.url]
    galleryIndex.value = Math.max(0, galleryList.value.indexOf(s.url))
    galleryTitle.value = String(s.title || parsePageTitle.value || '图集').replace(/\s*\[图\d+\/\d+\]\s*/g, '').trim() || '图集'
    galleryLoading.value = false
    galleryOpen.value = true
}
const galleryPrev = () => { galleryIndex.value = galleryIndex.value > 0 ? galleryIndex.value - 1 : galleryList.value.length - 1 }
const galleryNext = () => { galleryIndex.value = galleryIndex.value < galleryList.value.length - 1 ? galleryIndex.value + 1 : 0 }
const onGalleryImgError = () => { galleryLoading.value = false }
const downloadGalleryImage = async (u) => {
    const url = u || galleryList.value[galleryIndex.value] || ''
    if (!url) { messageStore.warning('图片地址无效'); return }
    try {
        const baseDir = await resolveVideoDownloadDir()
        const safe = String(galleryTitle.value || '图集').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '图集'
        const idx = galleryList.value.length > 1 ? `_${galleryIndex.value + 1}` : ''
        const r = await downloadStart({
            url,
            name: `${safe}${idx}`,
            category: 'video',
            askPath: false,
            savePath: `${baseDir}\\${safe}\\${safe}${idx}.jpg`
        })
        if (r?.success) messageStore.success('图片开始下载，进度见下载专区', 3000)
        else if (!r?.canceled) messageStore.error('图片下载失败：' + (r?.error || '未知错误'))
    } catch (e) {
        messageStore.error('图片下载失败：' + (e.message || e))
    }
}

const playParsedStream = (s, baseOverride) => {
    // 图文作品图片流 → 打开图集浏览，不走视频播放
    if (s.isImage) { openParseGallery(s); return }
    const baseName = baseOverride || parsePageTitle.value || '网址解析视频'
    // 显示名同样只取 s.title 剥 [画质] 装饰，避免"标题 - 标题 [画质]"重复
    const name = baseOverride ? baseName : ((s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').trim() || baseName)
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
    playerStore.currentMvDanmakuCid = s.cid || null   // B站流携带 cid：播放器按 cid 拉取该 P 弹幕
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
        if (s.isImage) {
            // 图文图片：保留标题的 [图N/M] 序号标识，避免同图集多图下载重名互相覆盖
            name = (s.title || baseName).trim() || baseName
        } else if (s.bili) {
            name = (s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').replace(/\s*[（(]已登录[）)]\s*/g, '').trim() || baseName
        } else if (s.ytSrc) {
            // YouTube：文件名取原标题主体，去掉 [画质] 装饰，交给 yt-dlp 下载
            name = (s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').trim() || baseName
        } else {
            // 抖音/快手/直播等：s.title 已含完整标题，只剥 [画质] 装饰，
            // 不再拼接页面标题（否则出现"标题 - 标题 [画质]"重复超长文件名）
            name = (s.title || baseName).replace(/\s*\[[^\]]*\]\s*/g, '').trim() || baseName
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
        const result = await (async () => {
            // 优先使用"下载专区"目录：存到 下载区/标题/标题.mp4（文件夹区分，不弹窗）
            const baseDir = await resolveVideoDownloadDir()
            if (baseDir) {
                const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'video'
                // 图文图片按 .jpg 保存（图片直链下载，无需 ffmpeg 合并）
                const ext = s.isImage ? '.jpg' : '.mp4'
                return downloadStart({ ...params, askPath: false, savePath: `${baseDir}\\${safe}\\${safe}${ext}` })
            }
            // 拿不到目录时：走旧逻辑弹窗选择
            return downloadVideo(params)
        })()
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

onMounted(() => { loadThumbnails(); loadBiliApiMode(); loadBiliTvStatus(); window.addEventListener('click', handleGlobalClick) })
onBeforeUnmount(() => { thumbActive = false; window.removeEventListener('click', handleGlobalClick) })

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
    playerStore.currentMvDanmakuCid = null
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
    playerStore.currentMvAudioUrl = s.audioUrl || ''
    playerStore.currentMvDanmakuCid = null
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
            <button class="tab-btn" :class="{ active: activeTab === 'biliLive' }" @click="activeTab = 'biliLive'">
                <MonitorPlay :size="14" /> B站管理
            </button>
        </div>
      </div>
      <div class="actions">
        <!-- B站 / YouTube 登录胶囊（始终显示在右上角） -->
        <div class="login-capsules">
          <template v-if="biliApiMode === 'web'">
            <button v-if="!biliLoggedIn" class="login-capsule bili" @click="openBiliLogin">
              <User :size="13" /><span>B站登录</span>
            </button>
            <button v-else class="login-capsule bili logged" title="点击退出B站登录" @click="logoutBili">
              <img v-if="biliUserInfo?.face" :src="biliUserInfo.face" class="capsule-avatar" alt="" referrerpolicy="no-referrer" @error="onAvatarError" />
              <User v-else :size="13" />
              <span class="capsule-name">{{ biliUserInfo?.uname || 'B站' }}</span>
            </button>
          </template>
          <!-- TV 接口模式下显示 TV 端登录（云视听小电视 access_key，解锁 TV 高画质） -->
          <button v-if="biliApiMode === 'tv' && !biliTvLoggedIn" class="login-capsule bili-tv" @click="openBiliTvLogin" title="TV 接口需单独扫码登录才能解锁 1080P+">
            <MonitorPlay :size="13" /><span>TV登录</span>
          </button>
          <button v-else-if="biliApiMode === 'tv'" class="login-capsule bili-tv logged" title="点击退出 TV 端登录" @click="logoutBiliTv">
            <img v-if="biliTvUserInfo?.face" :src="biliTvUserInfo.face" class="capsule-avatar" alt="" referrerpolicy="no-referrer" @error="onTvAvatarError" />
            <MonitorPlay v-else :size="13" />
            <span class="capsule-name">{{ biliTvUserInfo?.uname || (biliTvMid ? `TV·${biliTvMid}` : 'TV已登录') }}</span>
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
                v-for="video in paginatedLocalVideos"
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

        <div v-if="localPageCount > 1" class="pagination">
            <button @click="localPage = 1" :disabled="localPage === 1">首页</button>
            <button @click="localPage--" :disabled="localPage === 1">上一页</button>
            <span
                v-for="i in localPageCount"
                :key="i"
                class="page-num"
                :class="{ active: i === localPage }"
                @click="localPage = i"
            >{{ i }}</span>
            <button @click="localPage++" :disabled="localPage === localPageCount">下一页</button>
            <button @click="localPage = localPageCount" :disabled="localPage === localPageCount">尾页</button>
        </div>

        <div v-else-if="localVideos.length === 0" class="empty-state">
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
            <div v-for="s in paginatedStreams" :key="s.id" class="stream-card">
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

        <div v-if="streamsPageCount > 1" class="pagination">
            <button @click="streamsPage = 1" :disabled="streamsPage === 1">首页</button>
            <button @click="streamsPage--" :disabled="streamsPage === 1">上一页</button>
            <span
                v-for="i in streamsPageCount"
                :key="i"
                class="page-num"
                :class="{ active: i === streamsPage }"
                @click="streamsPage = i"
            >{{ i }}</span>
            <button @click="streamsPage++" :disabled="streamsPage === streamsPageCount">下一页</button>
            <button @click="streamsPage = streamsPageCount" :disabled="streamsPage === streamsPageCount">尾页</button>
        </div>
    </div>

    <!-- 网址解析 -->
    <div v-else-if="activeTab === 'parse'" class="parse-section">
        <!-- 平台图标滚动条 -->
        <div class="platform-scroll">
            <div class="platform-scroll-track">
                <div class="platform-scroll-group" v-for="(group, gIdx) in platformScrollGroups" :key="gIdx" :aria-hidden="gIdx === 1 ? 'true' : null">
                    <span v-for="p in platformScrollItems" :key="p.id" class="platform-chip" :title="p.desc">
                        <img :src="p.icon" :alt="p.name" class="platform-chip-icon" />
                        <span class="platform-chip-name">{{ p.name }}</span>
                    </span>
                </div>
            </div>
        </div>
        <div class="parse-input-bar">
            <Globe :size="18" class="parse-input-icon" />
            <input
                type="text"
                v-model="parseInput"
                class="parse-input"
                placeholder="输入影视/视频网页地址，自动解析出视频流"
                @keyup.enter="handleParseUrl"
            />
            <div class="parse-settings" ref="parseSettingsRef">
                <button class="parse-settings-btn" :class="{ active: parseSettingsOpen }" title="解析设置" @click="parseSettingsOpen = !parseSettingsOpen">
                    <Settings :size="16" />
                </button>
                <transition name="pop">
                    <div v-if="parseSettingsOpen" class="parse-settings-panel">
                        <div class="parse-settings-head">
                            <Settings :size="14" />
                            <span>解析设置</span>
                        </div>
                        <div class="parse-setting-row">
                            <div class="parse-setting-info">
                                <div class="parse-setting-label">B站解析接口</div>
                                <div class="parse-setting-desc">{{ biliApiMode === 'tv' ? 'TV 接口：无水印片源，TV端登录可解锁 1080P+' : 'Web 接口：登录 Cookie 提升画质' }}</div>
                            </div>
                            <CustomSelect
                                :model-value="biliApiMode"
                                :options="BILI_API_OPTIONS"
                                :width="110"
                                compact
                                @change="switchBiliApiMode"
                            />
                        </div>
                        <div class="parse-settings-tip">· TV 接口（云视听小电视）：无水印片源<br />· 未登录 TV 档位封顶 720P；请用右上角「TV登录」扫码，登录后可解锁 1080P+/大会员档<br />· Web 接口：需右上角「B站登录」后 Cookie 解锁 1080P+</div>
                    </div>
                </transition>
            </div>
            <button class="parse-btn" :disabled="parseLoading" @click="handleParseUrl">
                <Search v-if="!parseLoading" :size="16" />
                <Clock v-else :size="16" class="spin" />
                {{ parseLoading ? '解析中...' : '解析' }}
            </button>
        </div>
        <div class="parse-tips">
            <p>· 支持解析影视页面（自动提取 m3u8/mp4 直链）、含 player_aaaa 的 maccms 播放页</p>
            <p>· 抖音 / 快手 视频：通过官方接口解析，视频流 <b>无水印</b>，可直接播放并批量下载</p>
            <p>· 解析到的视频流会列出供你点击播放</p>
        </div>

        <div v-if="parseResults.length > 0" class="parse-results">
            <div class="parse-results-title">
                <span>共解析到 {{ parseResults.length }} 个视频流{{ parsePageTitle ? ` · ${parsePageTitle}` : '' }}</span>
                <span class="parse-batch-actions">
                    <label class="parse-check-all"><input type="checkbox" :checked="parseAllChecked" @change="toggleParseAll" /> 全选</label>
                    <button class="live-start-btn small" :disabled="!parseSel.size || batchDownloading" @click="downloadParseBatch">
                        <Download :size="13" /> 批量下载{{ parseSel.size ? `（${parseSel.size}）` : '' }}
                    </button>
                </span>
            </div>
            <div v-if="batchDownloading" class="batch-progress">
                <Clock :size="13" class="spin" />
                批量下载 {{ batchDone + batchFail }}/{{ batchTotal }} · 当前：{{ batchCurrentName }}
            </div>
            <template v-for="(g, gi) in parseGroups" :key="gi">
                <div v-if="gi > 0" class="parse-group-divider"></div>
                <transition-group name="fold" tag="div" class="parse-group-wrap">
                    <div v-for="(s, i) in (parseGroupOpen[g.key] ? g.list : g.list.slice(0, 1))" :key="s.url" class="parse-result-card" :class="{ 'parse-group-sub': i > 0 }">
                        <label class="parse-check" @click.stop>
                            <input type="checkbox" class="visually-hidden" :checked="parseSel.has(s.url)" @change="toggleParseSel(s.url)" />
                            <CheckSquare v-if="parseSel.has(s.url)" :size="16" class="check-icon active" />
                            <Square v-else :size="16" class="check-icon" />
                        </label>
                        <div class="parse-result-index" @click="playParsedStream(s)">{{ i + 1 }}</div>
                        <div v-if="s.cover" class="parse-result-cover" @click="playParsedStream(s)">
                            <img :src="s.cover" referrerpolicy="no-referrer" alt="" loading="lazy" @error="onParseCoverError" />
                        </div>
                        <div class="parse-result-info" @click="playParsedStream(s)">
                            <div class="parse-result-name">
                                {{ s.title || parsePageTitle || `视频流 ${i + 1}` }}
                                <span class="parse-type-tag">{{ s.type === 'image' ? '图文' : s.type }}</span>
                                <span v-if="s.isImage" class="parse-nwm-tag" title="图文作品图片，点击浏览图集">图片</span>
                                <span v-if="s.watermarkFree" class="parse-nwm-tag" title="已通过官方接口解析，视频流本身无水印">无水印</span>
                                <span v-if="s.audioUrl" class="parse-dash-tag" title="DASH 音视频分离，下载时自动合并">DASH·合并</span>
                            </div>
                            <div class="parse-result-url" :title="s.url">{{ s.url }}</div>
                        </div>
                        <button class="parse-result-download" :disabled="parsingDownloadingUrl === s.url" :title="parsingDownloadingUrl === s.url ? '下载中...' : (s.isImage ? '下载图片' : '下载')" @click.stop="downloadParsedStream(s)">
                            <Clock v-if="parsingDownloadingUrl === s.url" :size="16" class="spin" />
                            <Download v-else :size="16" />
                        </button>
                        <div class="parse-result-play" :title="s.isImage ? '浏览图集' : '播放'" @click="playParsedStream(s)">
                            <ImagePlus v-if="s.isImage" :size="20" />
                            <Play v-else :size="20" fill="currentColor" />
                        </div>
                    </div>
                </transition-group>
                <div v-if="g.list.length > 1" class="parse-more-toggle" @click="parseGroupOpen[g.key] = !parseGroupOpen[g.key]">
                    {{ parseGroupOpen[g.key] ? '收起' : (g.list[0] && g.list[0].isImage ? `该图文还有其他图片（${g.list.length - 1}）` : `该视频还有其他画质（${g.list.length - 1}）`) }}
                </div>
            </template>
        </div>

        <!-- 图文图集浏览灯箱（抖音/快手图文作品） -->
        <teleport to="body">
            <div v-if="galleryOpen" class="parse-gallery-mask" @click.self="galleryOpen = false">
                <div class="parse-gallery-box">
                    <div class="parse-gallery-top">
                        <span class="parse-gallery-title" :title="galleryTitle">{{ galleryTitle }}</span>
                        <span class="parse-gallery-count" v-if="galleryList.length > 1">{{ galleryIndex + 1 }} / {{ galleryList.length }}</span>
                        <button class="parse-gallery-close" @click="galleryOpen = false"><X :size="20" /></button>
                    </div>
                    <div class="parse-gallery-body">
                        <button v-if="galleryList.length > 1" class="parse-gallery-nav prev" @click.stop="galleryPrev"><ChevronLeft :size="24" /></button>
                        <img
                            :src="galleryList[galleryIndex]"
                            :key="galleryList[galleryIndex]"
                            class="parse-gallery-img"
                            referrerpolicy="no-referrer"
                            alt=""
                            @error="onGalleryImgError"
                        />
                        <button v-if="galleryList.length > 1" class="parse-gallery-nav next" @click.stop="galleryNext"><ChevronRight :size="24" /></button>
                    </div>
                    <div class="parse-gallery-bottom">
                        <button class="live-start-btn small" @click="downloadGalleryImage()"><Download :size="13" /> 下载当前图</button>
                        <button class="parse-gallery-close-btn" @click="galleryOpen = false">关闭</button>
                    </div>
                </div>
            </div>
        </teleport>
    </div>

<!-- B站管理（直播推流 / 稿件管理 / 空间管理 / 收藏夹） -->
    <div v-else-if="activeTab === 'biliLive'" class="bili-manage-section">
        <!-- 子 Tab 导航 -->
        <div class="bili-sub-tabs">
            <button :class="{ active: biliSubTab === 'live' }" @click="biliSubTab = 'live'"><Radio :size="13" /> 直播推流</button>
            <button :class="{ active: biliSubTab === 'favs' }" @click="switchBiliSubTab('favs')"><Bookmark :size="13" /> 收藏夹</button>
        </div>

        <!-- 直播推流 -->
        <div v-if="biliSubTab === 'live'" class="bili-live-section">
        <div v-if="!biliLoggedIn" class="empty-state">
            <MonitorPlay :size="48" />
            <p>请先登录B站账号后才能获取推流参数</p>
            <button class="import-link" @click="openBiliLogin">立即扫码登录</button>
        </div>

        <div v-else-if="liveRoomLoading" class="empty-state">
            <Clock :size="48" class="spin" />
            <p>正在获取直播间信息...</p>
        </div>

        <!-- 未开通直播间 -->
        <div v-else-if="biliLiveState === 'idle'" class="empty-state">
            <MonitorPlay :size="48" />
            <p>未能获取到直播间信息</p>
            <p class="empty-hint">请确认已在B站直播中心开通直播间，并检查是否正确登录</p>
            <button class="import-link" @click="loadBiliLiveRooms">重新检测</button>
        </div>

        <template v-else>
            <!-- 步骤一：直播间信息 -->
            <div class="live-step">
                <div class="live-step-head">
                    <span class="live-step-num">1</span>
                    <h3>直播间信息</h3>
                    <span v-if="liveRoomInfo" class="live-room-id">房间号：{{ liveRoomInfo.roomId }}<template v-if="liveRoomInfo.shortId && liveRoomInfo.shortId !== liveRoomInfo.roomId">（短号 {{ liveRoomInfo.shortId }}）</template></span>
                    <button class="refetch-btn" @click="loadBiliLiveRooms" :disabled="liveRoomLoading">
                        <RefreshCw :size="13" :class="{ spin: liveRoomLoading }" /> 刷新
                    </button>
                    <button class="refetch-btn save" :disabled="liveSaveLoading" @click="saveBiliLiveInfo">
                        <Check v-if="!liveSaveLoading" :size="13" />
                        <Clock v-else :size="13" class="spin" />
                        {{ liveSaveLoading ? '保存中...' : '保存信息' }}
                    </button>
                </div>
                <div class="live-form-grid">
                    <div class="live-form-row">
                        <label>直播标题</label>
                        <input type="text" v-model="liveTitle" class="live-input" placeholder="输入吸引观众的直播标题" />
                    </div>
                    <div class="live-form-row">
                        <label>直播分区 <span v-if="liveAreaLoading" class="loading-text">（加载中...）</span></label>
                        <CustomSelect
                            v-model="liveAreaV2"
                            :options="liveAreaOptions"
                            :disabled="liveAreaLoading"
                            placeholder="选择分区"
                        />
                    </div>
                    <div class="live-form-row">
                        <label>推流平台</label>
                        <CustomSelect
                            v-model="livePlatform"
                            :options="livePlatformOptions"
                            placeholder="选择平台"
                        />
                    </div>
                    <div class="live-form-row live-cover-row">
                        <label>直播封面 <span class="loading-text">（可选，JPG/PNG）</span></label>
                        <div class="live-cover-box" @click="coverInputRef && coverInputRef.click()">
                            <template v-if="liveCover">
                                <Check :size="18" />
                                <span>已选择封面，点击更换</span>
                                <button class="live-cover-clear" @click.stop="clearLiveCover" title="移除封面">
                                    <X :size="14" />
                                </button>
                            </template>
                            <template v-else>
                                <ImagePlus :size="22" />
                                <span>点击选择封面图</span>
                            </template>
                            <input
                                ref="coverInputRef"
                                type="file"
                                accept="image/jpeg,image/png,image/jpg"
                                class="live-cover-input"
                                @change="onCoverPick"
                            />
                        </div>
                        <!-- 封面预览：比例切换（Web 16:9 / 移动 4:3） -->
                        <template v-if="liveCover">
                            <div class="cover-preview-box">
                                <div class="cover-preview-bar">
                                    <span class="cover-preview-title">封面预览</span>
                                    <div class="cover-ratio-switch">
                                        <button :class="{ active: coverRatio === '169' }" @click="coverRatio = '169'">Web 16:9</button>
                                        <button :class="{ active: coverRatio === '43' }" @click="coverRatio = '43'">移动 4:3</button>
                                    </div>
                                </div>
                                <div class="cover-frame" :class="coverRatio === '169' ? 'cover-frame-169' : 'cover-frame-43'">
                                    <img :src="liveCover" :alt="coverRatio === '169' ? 'Web端预览' : '移动端预览'" />
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            </div>

            <!-- 步骤二：生成推流参数 -->
            <div class="live-step">
                <div class="live-step-head">
                    <span class="live-step-num">2</span>
                    <h3>生成推流参数</h3>
                </div>
                <p class="live-step-desc">点击按钮获取 B站分配的推流服务器地址和串流密钥，用于配置 OBS</p>
                <div class="live-start-actions">
                    <button v-if="biliLiveState !== 'live'" class="live-start-btn" :disabled="liveStartLoading" @click="startBiliLive">
                        <Send v-if="!liveStartLoading" :size="15" />
                        <Clock v-else :size="15" class="spin" />
                        {{ liveStartLoading ? '生成中...' : '生成推流参数' }}
                    </button>
                    <button v-else class="live-stop-btn" :disabled="liveStopLoading" @click="stopBiliLive">
                        <X :size="15" />
                        {{ liveStopLoading ? '停止中...' : '停止直播' }}
                    </button>
                </div>
            </div>

            <!-- 步骤三：推流参数结果 -->
            <div v-if="liveStreamInfo" class="live-stream-result">
                <div class="live-step-head">
                    <span class="live-step-num">3</span>
                    <h3>复制推流信息（配置 OBS）</h3>
                </div>

                <!-- OBS 推荐填法 -->
                <div class="obs-box">
                    <div class="obs-box-title">OBS 直播设置推荐填法</div>
                    <div class="obs-row">
                        <label>服务器地址</label>
                        <button class="obs-copy-btn" @click="copyToClipboard(liveStreamInfo.serverAddr, '服务器地址')">
                            <Copy :size="13" /> 复制
                        </button>
                    </div>
                    <div class="obs-value" :title="liveStreamInfo.serverAddr">{{ liveStreamInfo.serverAddr }}</div>
                    <div class="obs-row">
                        <label>串流密钥 <span class="obs-key-hint">（含前导 ?，必填）</span></label>
                        <button class="obs-copy-btn" @click="copyToClipboard(liveStreamInfo.streamCode, '串流密钥')">
                            <Copy :size="13" /> 复制
                        </button>
                    </div>
                    <div class="obs-value" :title="liveStreamInfo.streamCode">{{ liveStreamInfo.streamCode }}</div>
                </div>

                <!-- 完整推流 URL（FFmpeg / 其他推流工具） -->
                <div class="full-url-box">
                    <div class="obs-row">
                        <label>完整推流地址（FFmpeg / 兼容工具）</label>
                        <button class="obs-copy-btn" @click="copyToClipboard(liveStreamInfo.fullUrl, '完整推流地址')">
                            <Copy :size="13" /> 复制完整地址
                        </button>
                    </div>
                    <div class="obs-value long" :title="liveStreamInfo.fullUrl">{{ liveStreamInfo.fullUrl }}</div>
                </div>

                <div class="live-tips">
                    <p>· 推流地址有效期很短，请「先复制参数→马上填 OBS→立即推流」，超时会被 B站作废导致重连</p>
                    <p>· OBS：设置 → 直播 → 服务器填「服务器地址」，串流密钥填「串流密钥」</p>
                    <p>· 串流密钥必须带前导「?」（OBS 会拼成完整推流地址，去掉 ? 会导致发布路径错误而重连）</p>
                    <p>· 若连接成功但立刻断开重连：多为地址过期，请重新「生成推流参数」；同时关闭代理/VPN（可能干扰 RTMP）</p>
                    <p>· 若提示需要人脸认证，请先在B站直播中心完成认证后再开播</p>
                </div>
            </div>
        </template>
        </div>

        <!-- 收藏夹 -->
        <div v-else-if="biliSubTab === 'favs'" class="bili-sub-page">
            <div v-if="!biliLoggedIn" class="empty-state">
                <Bookmark :size="48" /><p>请先登录B站账号</p>
                <button class="import-link" @click="openBiliLogin">立即扫码登录</button>
            </div>
            <div v-else-if="favLoading" class="empty-state"><Clock :size="48" class="spin" /><p>正在加载收藏夹...</p></div>

            <!-- 收藏夹列表 -->
            <template v-else-if="!favOpen">
                <div class="bili-list-head">
                    <span>我的收藏夹</span>
                    <button class="refetch-btn" @click="loadFavList()"><RefreshCw :size="13" /> 刷新</button>
                </div>
                <div v-if="!favList.length" class="bili-sub-empty">暂无收藏夹</div>
                <div class="bili-item-list">
                    <div v-for="f in favList" :key="f.id" class="bili-item clickable" @click="openFav(f)">
                        <img class="bili-item-cover" :src="f.cover" alt="" referrerpolicy="no-referrer" @error="f.cover = ''" />
                        <div class="bili-item-info">
                            <div class="bili-item-title" :title="f.title">{{ f.title }}</div>
                            <div class="bili-item-meta">{{ f.mediaCount }} 个内容</div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- 收藏夹内容（可勾选批量下载） -->
            <template v-else>
                <div class="bili-list-head">
                    <button class="back-btn" @click="closeFav"><X :size="13" /> 返回</button>
                    <span class="bili-folder-title">{{ favFolderTitle }}</span>
                    <div class="bili-batch-actions">
                        <button class="refetch-btn" @click="toggleFavAll">{{ favAllChecked ? '取消全选' : '全选' }}</button>
                        <button class="live-start-btn small" :disabled="!favSelected.size || batchDownloading" @click="downloadFavBatch">
                            <Download :size="13" />
                            {{ batchDownloading ? '下载中...' : `批量下载${favSelected.size ? `（${favSelected.size}）` : ''}` }}
                        </button>
                    </div>
                </div>
                <div v-if="batchDownloading" class="batch-progress">
                    <Clock :size="13" class="spin" />
                    批量下载 {{ batchDone + batchFail }}/{{ batchTotal }} · 当前：{{ batchCurrentName }}
                </div>
                <div v-if="favLoadingContent" class="empty-state mini"><Clock :size="32" class="spin" /><p>加载中...</p></div>
                <div class="bili-item-list">
                    <div v-for="m in favMedias" :key="m.id" class="bili-item">
                        <label class="bili-check" @click.stop>
                            <input type="checkbox" class="visually-hidden" :disabled="!m.downloadable" :checked="favSelected.has(m.id)" @change="toggleFavSel(m.id)" />
                            <CheckSquare v-if="favSelected.has(m.id)" :size="16" class="check-icon active" />
                            <Square v-else :size="16" class="check-icon" />
                        </label>
                        <img class="bili-item-cover" :src="m.cover" alt="" referrerpolicy="no-referrer" @error="m.cover = ''" />
                        <div class="bili-item-info">
                            <div class="bili-item-title" :title="m.title">
                                {{ m.title }}
                                <span v-if="m.typeName && m.typeName !== '视频'" class="bili-type-badge">{{ m.typeName }}</span>
                            </div>
                            <div class="bili-item-meta">
                                {{ m.upper }} · {{ fmtDuration(m.duration) }}
                                <template v-if="m.type !== 2 && m.type !== 1 && m.type !== 22"><span class="bili-type-raw">类型{{ m.type }}</span></template>
                            </div>
                            <!-- 合集展开 / 查合集 / 番剧展开 -->
                            <div v-if="m.expandable" class="season-block">
                                <button class="season-toggle" @click="toggleSeason(m)">
                                    {{ seasonExpanded.has(m.id) ? '收起' : (m.isBangumi ? '展开番剧' : (m.seasonId || m.type === 21 ? '展开合集' : '查合集')) }}
                                </button>
                                <transition name="season-fold">
                                    <div v-if="seasonExpanded.has(m.id)" class="season-list">
                                        <div v-if="seasonData[m.id]?.loading" class="season-tip"><Clock :size="14" class="spin" /> 加载中...</div>
                                        <div v-else-if="seasonData[m.id]?.error" class="season-tip error">{{ seasonData[m.id].error }}</div>
                                        <div v-else-if="seasonData[m.id]?.archives.length">
                                            <div class="season-title-line">{{ seasonData[m.id].title }}（{{ seasonData[m.id].archives.length }} 集）</div>
                                            <button class="season-dl-all" :disabled="batchDownloading" @click="downloadSeasonBatch(m.id)">
                                                <Download :size="13" /> 批量下载本合集（{{ seasonData[m.id].archives.length }}）
                                            </button>
                                            <div v-for="v in seasonData[m.id].archives" :key="v.id" class="season-item">
                                                <img class="season-cover" :src="v.cover" alt="" referrerpolicy="no-referrer" @error="v.cover = ''" />
                                                <span class="season-title" :title="v.title">{{ v.title }}</span>
                                                <button class="bili-item-action" :disabled="batchDownloading" @click="downloadBiliVideo('https://www.bilibili.com/video/' + v.bvid, v.title)"><Download :size="13" /> 下载</button>
                                            </div>
                                        </div>
                                        <div v-else class="season-tip">合集暂无内容</div>
                                    </div>
                                </transition>
                            </div>
                        </div>
                        <button class="bili-item-action" :disabled="!m.downloadable" :title="m.downloadable ? '下载' : (m.expandable ? '合集请展开后下载' : '番剧/影视暂不支持直接下载')" @click="downloadBiliVideo('https://www.bilibili.com/video/' + m.bvid, m.title)"><Download :size="14" /> 下载</button>
                        <button class="bili-item-action" title="复制分享链接，可粘贴到「网址解析」" @click="copyBiliShare(m)"><Link2 :size="14" /> 复制链接</button>
                    </div>
                </div>
                <div v-if="favMedias.length > 0" class="bili-pager">
                    <button class="page-num" :disabled="favPage <= 1 || favLoadingContent" @click="loadFavContent(favPage - 1)">上一页</button>
                    <span class="bili-pager-info">第 {{ favPage }} / {{ favTotalPages }} 页 · 共 {{ favTotal }} 项</span>
                    <button class="page-num" :disabled="favPage >= favTotalPages || favLoadingContent" @click="loadFavContent(favPage + 1)">下一页</button>
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

    <!-- B站 TV 端登录弹窗（云视听小电视 access_key，解锁 TV 接口高画质） -->
    <transition name="modal">
    <div v-if="showBiliTvQr" class="form-overlay" @click.self="closeBiliTvQr">
        <div class="bili-qr-modal">
            <div class="form-header">
                <h3>TV 端扫码登录</h3>
                <X :size="18" class="clickable" @click="closeBiliTvQr" />
            </div>
            <div class="bili-qr-body">
                <div v-if="biliTvQrStatus === 'error'" class="bili-qr-error">
                    <p>{{ biliTvQrError }}</p>
                    <button class="form-btn save" @click="refreshBiliTvQr">
                        <RefreshCw :size="14" /> 重新获取
                    </button>
                </div>
                <div v-else-if="biliTvQrStatus === 'expired'" class="bili-qr-expired">
                    <p>二维码已过期</p>
                    <button class="form-btn save" @click="refreshBiliTvQr">
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
                    <p class="bili-qr-benefit">TV 接口与网页登录相互独立，TV 端登录后解锁 1080P+/大会员档</p>
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

/* 平台图标滚动条（解析框上方） */
.platform-scroll {
    overflow: hidden;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.35);
    border: 1px solid rgba(0, 0, 0, 0.05);
    padding: 6px 0;
    margin-bottom: 10px;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}
.platform-scroll-track {
    display: flex;
    width: max-content;
    animation: platform-marquee 30s linear infinite;
}
.platform-scroll:hover .platform-scroll-track {
    animation-play-state: paused;
}
.platform-scroll-group {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: 10px;
}
.platform-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(0, 0, 0, 0.05);
    font-size: 12px;
    color: #4a4a4a;
    white-space: nowrap;
    cursor: default;
    transition: all 0.15s;
}
.platform-chip:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.platform-chip-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
    border-radius: 5px;
}
.platform-chip-name {
    font-weight: 500;
}
@keyframes platform-marquee {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
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

.login-capsule.bili-tv {
    background: rgba(0, 150, 255, 0.1);
    color: #0a7ee0;
    border-color: rgba(0, 150, 255, 0.32);
}
.login-capsule.bili-tv:hover {
    background: rgba(0, 150, 255, 0.16);
}
.login-capsule.bili-tv.logged {
    color: #0a7ee0;
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

/* 解析设置按钮与下拉面板 */
.parse-settings {
    position: relative;
    flex-shrink: 0;
}
.parse-settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #999;
    cursor: pointer;
    transition: all 0.15s;
}
.parse-settings-btn:hover { background: #f5f5f7; color: var(--primary-color, #c20c0c); }
.parse-settings-btn.active { background: rgba(194, 12, 12, 0.08); color: var(--primary-color, #c20c0c); }
.parse-settings-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 320px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.14);
    border: 1px solid #eee;
    padding: 12px 14px;
    z-index: 300;
}
.parse-settings-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin-bottom: 10px;
}
.parse-setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 0 10px;
    border-bottom: 1px solid #f2f2f4;
    margin-bottom: 10px;
}
.parse-setting-info { min-width: 0; }
.parse-setting-label { font-size: 13px; color: #333; font-weight: 500; }
.parse-setting-desc { font-size: 11px; color: #999; margin-top: 2px; }
.parse-settings-tip {
    font-size: 11px;
    color: #aaa;
    line-height: 1.8;
}
/* 下拉面板淡入/缩放动画 */
.pop-enter-active, .pop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
.pop-enter-to, .pop-leave-from { opacity: 1; transform: translateY(0) scale(1); }

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

/* 图文图集浏览灯箱（teleport 到 body，需 :global 命中） */
:global(.parse-gallery-mask) {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(6px);
    animation: parseGalleryIn 0.18s ease;
}
@keyframes parseGalleryIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
:global(.parse-gallery-box) {
    display: flex;
    flex-direction: column;
    width: min(92vw, 980px);
    max-height: 88vh;
    background: #fff;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
}
:global(.parse-gallery-top) {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    background: #fafafa;
}
:global(.parse-gallery-title) {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
:global(.parse-gallery-count) {
    font-size: 12px;
    color: #e0454b;
    font-weight: 600;
}
:global(.parse-gallery-close) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
}
:global(.parse-gallery-close:hover) {
    background: #fdeaea;
    color: #e0454b;
}
:global(.parse-gallery-body) {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 260px;
    background: #111;
    overflow: hidden;
}
:global(.parse-gallery-img) {
    max-width: 100%;
    max-height: calc(88vh - 130px);
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
}
:global(.parse-gallery-nav) {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 56px;
    border: none;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    cursor: pointer;
    backdrop-filter: blur(4px);
    transition: all 0.2s;
}
:global(.parse-gallery-nav:hover) {
    background: rgba(255, 255, 255, 0.3);
}
:global(.parse-gallery-nav.prev) { left: 14px; }
:global(.parse-gallery-nav.next) { right: 14px; }
:global(.parse-gallery-bottom) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid #f0f0f0;
    background: #fafafa;
}
:global(.parse-gallery-close-btn) {
    padding: 6px 18px;
    border: 1px solid #e4e4e4;
    border-radius: 8px;
    background: #fff;
    color: #666;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}
:global(.parse-gallery-close-btn:hover) {
    background: #f5f5f5;
    color: #333;
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

.parse-result-cover {
    width: 64px;
    height: 80px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: #f2f2f2;
    display: flex;
    align-items: center;
    justify-content: center;
}
.parse-result-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.parse-nwm-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #f6ffed;
    color: #52c41a;
    border: 1px solid #b7eb8f;
    flex-shrink: 0;
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
/* ===== B站直播开播（OBS 推流）===== */
.bili-live-section {
    max-width: 860px;
}

.live-step {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 16px;
}

.live-step-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
}

.live-step-num {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--primary-color, #c20c0c);
    color: #fff;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.live-step-head h3 {
    margin: 0;
    font-size: 15px;
}

.live-room-id {
    font-size: 12px;
    color: #888;
    background: #f5f5f5;
    padding: 3px 10px;
    border-radius: 12px;
}

.refetch-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    border: 1px solid #ddd;
    background: #fff;
    color: #666;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
}

.refetch-btn:hover { background: #f7f7f7; }
.refetch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.refetch-btn.save {
    margin-left: 0;
    border-color: var(--primary-color, #c20c0c);
    color: var(--primary-color, #c20c0c);
    background: #fff;
}
.refetch-btn.save:hover { background: rgba(194, 12, 12, 0.06); }

.live-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}

.live-form-row { display: flex; flex-direction: column; gap: 6px; }

.live-form-row label {
    font-size: 12px;
    color: #666;
}

.live-cover-row { grid-column: 1 / -1; }

.live-cover-box {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    height: 96px;
    border: 1px dashed #d0d0d0;
    border-radius: 10px;
    color: #999;
    font-size: 13px;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.2s, background 0.2s;
}
.live-cover-box:hover { border-color: var(--primary-color, #c20c0c); color: var(--primary-color, #c20c0c); background: #fafafa; }

.live-cover-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.live-cover-clear {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    cursor: pointer;
    z-index: 2;
}
.live-cover-clear:hover { background: rgba(0, 0, 0, 0.75); }

.live-cover-input { display: none; }

/* 封面预览：比例切换 */
.cover-preview-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid #eee;
    border-radius: 10px;
    padding: 12px;
    background: #fafafa;
    max-width: 360px;
}
.cover-preview-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.cover-preview-title {
    font-size: 12px;
    color: #888;
}
.cover-ratio-switch {
    display: flex;
    gap: 4px;
    background: #f0f0f0;
    border-radius: 14px;
    padding: 2px;
}
.cover-ratio-switch button {
    border: none;
    background: transparent;
    color: #888;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
}
.cover-ratio-switch button.active {
    background: #fff;
    color: var(--primary-color, #c20c0c);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.cover-frame {
    width: 100%;
    overflow: hidden;
    border-radius: 8px;
    background: #f2f2f2;
    max-width: 320px;
}
.cover-frame-169 { aspect-ratio: 16 / 9; }
.cover-frame-43 { aspect-ratio: 4 / 3; }
.cover-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    referrerpolicy: no-referrer;
}

.loading-text { color: #bbb; }

.live-input {
    padding: 9px 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
}

.live-input:focus { border-color: var(--primary-color, #c20c0c); }

.live-step-desc {
    font-size: 12px;
    color: #999;
    margin: 0 0 14px;
}

.live-start-actions { display: flex; gap: 12px; }

.live-start-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--primary-color, #c20c0c);
    color: #fff;
    border: none;
    padding: 9px 20px;
    border-radius: 20px;
    font-size: 14px;
    cursor: pointer;
}

.live-start-btn:hover:not(:disabled) { opacity: 0.9; }
.live-start-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.live-stop-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    background: #666;
    color: #fff;
    border: none;
    padding: 9px 20px;
    border-radius: 20px;
    font-size: 14px;
    cursor: pointer;
}

.live-stop-btn:hover:not(:disabled) { opacity: 0.9; }
.live-stop-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.live-stream-result {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 12px;
    padding: 20px 24px;
}

.obs-box, .full-url-box {
    margin-top: 12px;
}

.obs-box-title {
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin-bottom: 10px;
}

.obs-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
}

.obs-row label {
    font-size: 12px;
    color: #666;
}
.obs-key-hint { font-size: 11px; color: #c20c0c; }

.obs-copy-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--primary-color, #c20c0c);
    background: transparent;
    color: var(--primary-color, #c20c0c);
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
}

.obs-copy-btn:hover { background: var(--primary-color, #c20c0c); color: #fff; }

.obs-value {
    margin-top: 6px;
    background: #f7f7f7;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #333;
    overflow-x: auto;
    white-space: nowrap;
    user-select: all;
}

.obs-value.long {
    white-space: normal;
    word-break: break-all;
    line-height: 1.6;
}

.full-url-box { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #eee; }

.live-tips {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #f0f0f0;
}

.live-tips p {
    font-size: 12px;
    color: #999;
    margin: 4px 0;
}

/* 分区分组的下拉样式保持原生，避免被其它样式覆盖 */
.bili-live-section select.live-input {
    max-height: 300px;
}

/* ===== 列表分页 ===== */
.pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 20px;
    flex-wrap: wrap;
}
.pagination button {
    border: none;
    background: transparent;
    color: #888;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
}
.pagination button:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.06);
    color: var(--primary-color, #c20c0c);
}
.pagination button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.page-num {
    min-width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 12px;
    color: #666;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
}
.page-num:hover {
    background: rgba(0, 0, 0, 0.06);
}
.page-num.active {
    background: var(--primary-color, #c20c0c);
    color: #fff;
}

/* ===== B站管理：子 Tab 导航 ===== */
.bili-sub-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(0, 0, 0, .08);
    padding-bottom: 10px;
    flex-wrap: wrap;
}
.bili-sub-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: 1px solid rgba(0, 0, 0, .12);
    background: transparent;
    color: #555;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: all .15s;
}
.bili-sub-tabs button:hover { border-color: rgba(194, 12, 12, .4); color: #c20c0c; }
.bili-sub-tabs button.active {
    background: #c20c0c;
    border-color: #c20c0c;
    color: #fff;
}
.bili-sub-page { min-height: 200px; }

/* ===== B站管理：列表通用 ===== */
.bili-list-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0 10px;
    font-size: 13px;
    color: #666;
    flex-wrap: wrap;
}
.bili-list-head .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid rgba(0, 0, 0, .15);
    background: transparent;
    color: #555;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: all .15s;
}
.bili-list-head .back-btn:hover { border-color: #c20c0c; color: #c20c0c; }
.bili-folder-title { font-weight: 500; color: #333; }
.bili-batch-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.live-start-btn.small {
    padding: 6px 12px;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.batch-progress {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    margin-bottom: 10px;
    background: rgba(194, 12, 12, .06);
    border: 1px solid rgba(194, 12, 12, .2);
    color: #a32d2d;
    border-radius: 6px;
    font-size: 12px;
}
.bili-item-list { display: flex; flex-direction: column; gap: 8px; }
.bili-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid rgba(0, 0, 0, .08);
    border-radius: 8px;
    background: rgba(0, 0, 0, .02);
    transition: background .15s, border-color .15s;
}
.bili-item:hover { background: rgba(0, 0, 0, .04); border-color: rgba(0, 0, 0, .15); }
.bili-item.clickable { cursor: pointer; }
.bili-item-cover {
    width: 96px;
    height: 56px;
    object-fit: cover;
    border-radius: 4px;
    background: #eee;
    flex-shrink: 0;
}
.bili-item-info { flex: 1; min-width: 0; }
.bili-item-title {
    font-size: 13px;
    color: #333;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.bili-item-meta { font-size: 12px; color: #999; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bili-item-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid rgba(0, 0, 0, .12);
    background: transparent;
    color: #555;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all .15s;
}
.bili-item-action:hover { border-color: #c20c0c; color: #c20c0c; }
.bili-load-more { text-align: center; margin-top: 12px; }
.bili-sub-empty { text-align: center; color: #999; font-size: 13px; padding: 30px 0; }
/* 复选框（本地音乐样式：Square/CheckSquare 图标） */
.bili-check, .parse-check {
    display: flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
}
.visually-hidden {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
}
.bili-check .check-icon, .parse-check .check-icon {
    color: #ccc;
    transition: color .2s;
    flex-shrink: 0;
}
.bili-check .check-icon.active, .parse-check .check-icon.active {
    color: var(--primary-color, #c20c0c);
}
.bili-check:hover .check-icon, .parse-check:hover .check-icon { color: #999; }
.bili-check:hover .check-icon.active, .parse-check:hover .check-icon.active { color: #c20c0c; }
/* 收藏夹类型徽章 */
.bili-type-badge {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    color: #0f6e56;
    border: 1px solid rgba(15, 110, 86, .35);
    border-radius: 3px;
    padding: 0 5px;
    vertical-align: 1px;
}
/* 未识别的原始类型（诊断用，用户反馈后补映射） */
.bili-type-raw {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    color: #a32d2d;
    border: 1px dashed rgba(163, 45, 45, .4);
    border-radius: 3px;
    padding: 0 5px;
    vertical-align: 1px;
}
/* 收藏夹分页 */
.bili-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 14px;
}
.bili-pager .page-num {
    padding: 5px 12px;
    border: 1px solid rgba(0, 0, 0, .15);
    background: transparent;
    border-radius: 6px;
    font-size: 12px;
    color: #555;
    cursor: pointer;
    transition: all .15s;
}
.bili-pager .page-num:hover:not(:disabled) { border-color: #c20c0c; color: #c20c0c; }
.bili-pager .page-num:disabled { opacity: .4; cursor: not-allowed; }
.bili-pager-info { font-size: 12px; color: #999; }

/* ===== 收藏夹：合集展开 ===== */
.season-block { margin-top: 6px; }
.season-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px dashed rgba(15, 110, 86, .4);
    background: rgba(15, 110, 86, .04);
    color: #0f6e56;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    transition: all .15s;
}
.season-toggle:hover { background: rgba(15, 110, 86, .1); }
.season-list {
    margin-top: 8px;
    padding: 8px;
    background: rgba(0, 0, 0, .03);
    border: 1px solid rgba(0, 0, 0, .06);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.season-tip { font-size: 12px; color: #999; display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.season-title-line { font-size: 12px; color: #0f6e56; font-weight: 500; padding: 2px 0 6px; }
/* 合集/番剧展开折叠动画 */
.season-fold-enter-active, .season-fold-leave-active {
    transition: opacity .18s ease, transform .18s ease;
    overflow: hidden;
}
.season-fold-enter-from, .season-fold-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}
.season-tip.error { color: #a32d2d; }
.season-dl-all {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: none;
    background: #0f6e56;
    color: #fff;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: opacity .15s;
}
.season-dl-all:disabled { opacity: .5; cursor: not-allowed; }
.season-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, .05);
}
.season-item:hover { border-color: rgba(0, 0, 0, .15); }
.season-cover { width: 64px; height: 38px; object-fit: cover; border-radius: 4px; background: #eee; flex-shrink: 0; }
.season-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ===== 网址解析：批量下载勾选 ===== */
.parse-check { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.parse-batch-actions { display: flex; align-items: center; gap: 10px; }
.parse-check-all {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #666;
    cursor: pointer;
}

/* ===== UP 投稿页 ===== */
.up-search-row { display: flex; gap: 8px; margin-bottom: 12px; }
.up-search-row .live-input { flex: 1; }
.space-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    border: 1px solid rgba(0, 0, 0, .08);
    border-radius: 10px;
    background: rgba(0, 0, 0, .02);
    margin-bottom: 12px;
}
.space-avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; background: #eee; flex-shrink: 0; }
.space-ident { min-width: 0; }
.space-name { font-size: 15px; font-weight: 500; color: #333; }
.space-sign { font-size: 12px; color: #999; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

</style>
