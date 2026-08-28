<script setup>
import { ref, computed, onMounted, onUnmounted, onActivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { biliVideoHome, biliVideoSearch, biliFavList, biliFavContent } from '../api'
import { useMessageStore } from '../store/message'
import { useSearchHistoryStore } from '../store/searchHistory'
import { useBiliTvLogin } from '../composables/useBiliTvLogin'
import { useBiliWebLogin } from '../composables/useBiliWebLogin'
import SearchSuggest from '../components/SearchSuggest.vue'
import BiliIcon from '../components/BiliIcon.vue'
import { Search, Loader2, Tv, Music, Gamepad2, BookOpen, Smartphone, Coffee, Dog, Wand2, Shirt, PartyPopper, Clapperboard, MonitorPlay, RefreshCw, X, Check, LogOut, Flame, TrendingUp, Play, MessageSquare, ChevronLeft, ChevronRight, Sparkles, Folder, Heart, Film, Star } from 'lucide-vue-next'
import './anime-common.css'

// keep-alive include 按组件名匹配（App.vue 缓存本列表页，返回时保留搜索/收藏夹状态）
defineOptions({ name: 'BilibiliVideo' })

const router = useRouter()
const messageStore = useMessageStore()
const searchHistoryStore = useSearchHistoryStore()

// ===== TV 端登录（composable 复用动漫专区逻辑，解锁 TV 接口 1080P+ 播放）=====
const {
    biliTvLoggedIn, biliTvUserInfo, biliTvMid,
    showBiliTvQr, biliTvQrImgUrl, biliTvQrStatus, biliTvQrError,
    loadBiliTvStatus, handleBiliLogin, closeBiliTvQr, refreshBiliTvQr,
    logoutBiliTv, onTvAvatarError
} = useBiliTvLogin(messageStore)

// ===== B站 Web 账号登录（与网址解析共用，解锁搜索稳定访问 + 收藏夹）=====
const {
    biliWebLoggedIn, biliWebUserInfo,
    showBiliWebQr, webQrImgUrl, webQrStatus, webQrError,
    loadWebStatus, handleWebLogin, closeWebQr, refreshWebQr, onWebAvatarError
} = useBiliWebLogin(messageStore)

// ===== 合并登录入口：单胶囊 + 下拉面板（Web 登录 / TV 登录 两行）=====
const showLoginMenu = ref(false)
function toggleLoginMenu() {
    showLoginMenu.value = !showLoginMenu.value
    if (showLoginMenu.value) {
        setTimeout(() => {
            const close = () => { showLoginMenu.value = false }
            document.addEventListener('click', close, { once: true })
        }, 0)
    }
}
// 胶囊摘要：优先显示 Web 账号，其次 TV 账号，都未登录显示"B站登录"
const loginSummary = computed(() => {
    if (biliWebLoggedIn.value) {
        return {
            avatar: biliWebUserInfo.value?.face || '',
            name: biliWebUserInfo.value?.uname || 'B站已登录',
            icon: Clapperboard
        }
    }
    if (biliTvLoggedIn.value) {
        return {
            avatar: biliTvUserInfo.value?.face || '',
            name: biliTvUserInfo.value?.uname || (biliTvMid.value ? `TV·${biliTvMid.value}` : 'TV已登录'),
            icon: MonitorPlay
        }
    }
    return null
})

// ===== 分区导航（仿B站官方顶部分区栏）=====
const categories = [
    { id: '推荐', icon: Sparkles },
    { id: '动画', icon: Clapperboard },
    { id: '番剧', icon: Tv },
    { id: '国创', icon: Flame },
    { id: '音乐', icon: Music },
    { id: '舞蹈', icon: PartyPopper },
    { id: '游戏', icon: Gamepad2 },
    { id: '知识', icon: BookOpen },
    { id: '数码', icon: Smartphone },
    { id: '生活', icon: Coffee },
    { id: '美食', icon: Coffee },
    { id: '动物', icon: Dog },
    { id: '鬼畜', icon: Wand2 },
    { id: '时尚', icon: Shirt },
    { id: '娱乐', icon: PartyPopper },
    { id: '影视', icon: Clapperboard }
]

const currentCat = ref('推荐')
const page = ref(1)
const hasMore = ref(false)

function switchCat(cat) {
    if (currentCat.value === cat) return
    // 收藏夹：需 Web 登录，未登录弹出扫码
    if (cat === '收藏夹') {
        if (!biliWebLoggedIn.value) {
            messageStore.info('浏览收藏夹需要登录B站账号', 2500)
            handleWebLogin()
            return
        }
        currentCat.value = cat
        page.value = 1
        exitSearch(false)
        loadFavFolders()
        return
    }
    currentCat.value = cat
    page.value = 1
    exitSearch(false)
    fetchHome()
}

// ===== 收藏夹（Web 登录账号的收藏夹，点击视频进入详情）=====
const favFolders = ref([])
const favLoading = ref(false)
const currentFolder = ref(null)   // 当前打开的收藏夹
const favList = ref([])           // 收藏夹内视频
const favPage = ref(1)
const favTotal = ref(0)
const favTotalPages = computed(() => Math.max(1, Math.ceil(favTotal.value / 20)))
// 页码条：页数多时只显示前几个 + 省略号 + 末尾页，保证一行不溢出（-1 为省略号标记）
const FAV_PAGE_HEAD = 3
const favPageItems = computed(() => {
    const total = favTotalPages.value
    if (total <= FAV_PAGE_HEAD + 1) return Array.from({ length: total }, (_, i) => i + 1)
    return [...Array.from({ length: FAV_PAGE_HEAD }, (_, i) => i + 1), -1, total]
})
const isFavCat = computed(() => currentCat.value === '收藏夹')

async function loadFavFolders() {
    favLoading.value = true
    currentFolder.value = null
    favFolders.value = []
    try {
        const res = await biliFavList()
        if (res?.success) {
            favFolders.value = res.list || []
        } else {
            messageStore.error(res?.message || '获取收藏夹失败')
        }
    } finally {
        favLoading.value = false
    }
}

async function openFavFolder(folder) {
    currentFolder.value = folder
    favPage.value = 1
    favTotal.value = 0
    await loadFavContent()
}

async function loadFavContent() {
    if (!currentFolder.value) return
    favLoading.value = true
    try {
        const res = await biliFavContent({ fid: currentFolder.value.id, pn: favPage.value, ps: 20 })
        if (res?.success) {
            // 仅展示普通视频（番剧/直播等类型跳过，属于其他专区）
            const items = (res.medias || []).filter(v => v.bvid)
            favList.value = items
            favTotal.value = res.total || favList.value.length
        } else {
            messageStore.error(res?.message || '获取收藏内容失败')
        }
    } finally {
        favLoading.value = false
    }
}

// 收藏夹页码翻页（每页 20 条）
function favGoPage(pn) {
    if (pn < 1 || pn > favTotalPages.value || favLoading.value) return
    favPage.value = pn
    loadFavContent()
}

function backToFolders() {
    currentFolder.value = null
    favList.value = []
}

// Web 登录成功后：若停留在收藏夹则加载文件夹，否则刷新首页（Cookie 生效）
watch(biliWebLoggedIn, (v) => {
    if (v && isFavCat.value) loadFavFolders()
})

// ===== 首页数据 =====
const homeData = ref({ list: [], hasMore: false, ranking: [] })
const loading = ref(false)

async function fetchHome() {
    loading.value = true
    try {
        const res = await biliVideoHome({ cat: currentCat.value, page: page.value })
        if (res?.success && res.data) {
            homeData.value = res.data
            hasMore.value = !!res.data.hasMore
        } else {
            messageStore.error(res?.message || '加载B站首页失败')
        }
    } catch (e) {
        messageStore.error('加载失败: ' + e.message)
    } finally {
        loading.value = false
    }
}

function prevPage() {
    if (page.value <= 1) return
    page.value--
    fetchHome()
    scrollToTop()
}
function nextPage() {
    if (!hasMore.value) return
    page.value++
    fetchHome()
    scrollToTop()
}
function scrollToTop() {
    const el = document.querySelector('.bili-video-view')
    if (el) el.scrollTop = 0
}

// ===== 搜索 =====
const keyword = ref('')
const searchMode = ref(false)
const searchLoading = ref(false)
const searchResults = ref([])
const searchPage = ref(1)
const searchHasMore = ref(false)
const showSearchSuggest = ref(false)
// 搜索类型：video 视频 / bangumi 番剧 / movie 影视（电影/纪录片等）
const searchType = ref('video')
const SEARCH_TYPES = [
    { key: 'video', label: '视频' },
    { key: 'bangumi', label: '番剧' },
    { key: 'movie', label: '影视' }
]
const isPgcSearch = computed(() => searchType.value !== 'video')
let blurTimer = null

const onSearchFocus = () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
    showSearchSuggest.value = true
}
const onSearchBlur = () => {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => { showSearchSuggest.value = false }, 200)
}

async function handleSearch() {
    if (!keyword.value.trim()) {
        messageStore.warning('请输入搜索关键词')
        return
    }
    searchHistoryStore.addHistory('bilibili-video', keyword.value)
    showSearchSuggest.value = false
    searchLoading.value = true
    searchMode.value = true
    searchPage.value = 1
    try {
        const res = await biliVideoSearch({ keyword: keyword.value, page: 1, type: searchType.value })
        if (res?.success && res.data) {
            searchResults.value = res.data.list || []
            searchHasMore.value = !!res.data.hasMore
            if (searchResults.value.length === 0) messageStore.warning('未找到相关内容')
        } else {
            messageStore.error(res?.message || '搜索失败')
        }
    } catch (e) {
        messageStore.error('搜索失败: ' + e.message)
    } finally {
        searchLoading.value = false
    }
}

// 切换搜索类型：已有关键词时自动重搜
function switchSearchType(t) {
    if (searchType.value === t) return
    searchType.value = t
    if (searchMode.value && keyword.value.trim()) handleSearch()
}

async function searchGoPage(p) {
    searchLoading.value = true
    try {
        const res = await biliVideoSearch({ keyword: keyword.value, page: p, type: searchType.value })
        if (res?.success && res.data) {
            searchResults.value = res.data.list || []
            searchHasMore.value = !!res.data.hasMore
            searchPage.value = p
            scrollToTop()
        }
    } catch (e) {
        messageStore.error('翻页失败: ' + e.message)
    } finally {
        searchLoading.value = false
    }
}

function exitSearch(refresh = true) {
    searchMode.value = false
    keyword.value = ''
    searchResults.value = []
    showSearchSuggest.value = false
    if (refresh) {
        page.value = 1
        fetchHome()
    }
}

const onSelectSuggest = (kw) => {
    keyword.value = kw
    handleSearch()
}
const onSelectItem = (item) => {
    showSearchSuggest.value = false
    if (item?.bvid) router.push(`/bilibili/${item.bvid}`)
}

// ===== 刷新 =====
const refreshing = ref(false)
async function refreshCurrent() {
    if (refreshing.value) return
    refreshing.value = true
    try {
        if (searchMode.value && keyword.value.trim()) {
            await searchGoPage(searchPage.value)
        } else if (isFavCat.value) {
            if (currentFolder.value) {
                favPage.value = 1
                await loadFavContent()
            } else {
                await loadFavFolders()
            }
        } else {
            await fetchHome()
        }
        messageStore.success('已刷新')
    } finally {
        refreshing.value = false
    }
}

// ===== 展示辅助 =====
const failedCovers = ref(new Set())
function onCoverError(url) {
    if (!url) return
    failedCovers.value = new Set([...failedCovers.value, url])
}
function isCoverFailed(url) {
    return failedCovers.value.has(url)
}

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

function openDetail(item) {
    // PGC（番剧/电影）卡片：季详情路由
    if (item?.pgc && item.seasonId) {
        router.push(`/bilibili/season/${item.seasonId}`)
        return
    }
    if (!item?.bvid) return
    router.push(`/bilibili/${item.bvid}`)
}

// 点击作者进入 UP 主主页（阻止冒泡避免触发整卡跳详情）
function goUserSpace(mid) {
    if (!mid) return
    router.push(`/bilibili/user/${mid}`)
}

onMounted(() => {
    fetchHome()
    loadBiliTvStatus()
    loadWebStatus()
})

// keep-alive 返回激活：刷新登录状态（用户可能在详情页完成登录/登出），不重拉列表保留浏览位置
onActivated(() => {
    loadBiliTvStatus()
    loadWebStatus()
})

onUnmounted(() => {
    if (blurTimer) clearTimeout(blurTimer)
})
</script>

<template>
    <div class="bili-video-view">
        <!-- 页头：标题 + B站登录/TV登录胶囊 + 刷新 -->
        <div class="page-header">
            <h2 class="page-title bili-brand">
                <BiliIcon name="logo" :size="22" /> B站视频
            </h2>
            <!-- 合并登录入口：单胶囊 + 下拉面板（Web / TV 两行） -->
            <div class="bili-login-wrap login-merged" @click.stop>
                <button
                    v-if="!loginSummary"
                    class="login-capsule"
                    @click.stop="handleWebLogin"
                    title="登录B站账号（Web + TV 可分别登录）"
                >
                    <Clapperboard :size="13" /><span>B站登录</span>
                </button>
                <button
                    v-else
                    class="login-capsule logged"
                    @click.stop="toggleLoginMenu"
                    title="账号与登录管理"
                >
                    <img
                        v-if="loginSummary.avatar"
                        :src="loginSummary.avatar"
                        class="capsule-avatar"
                        alt=""
                        referrerpolicy="no-referrer"
                        @error="loginSummary.avatar === biliWebUserInfo?.face ? onWebAvatarError() : onTvAvatarError()"
                    />
                    <component v-else :is="loginSummary.icon" :size="13" />
                    <span class="capsule-name">{{ loginSummary.name }}</span>
                    <ChevronDown :size="12" style="transition: transform 0.2s" :style="{ transform: showLoginMenu ? 'rotate(180deg)' : '' }" />
                </button>
                <transition name="modal">
                    <div v-if="showLoginMenu" class="login-menu" @click.stop>
                        <!-- Web 账号行 -->
                        <div class="login-menu-row">
                            <img v-if="biliWebLoggedIn && biliWebUserInfo?.face" :src="biliWebUserInfo.face" class="menu-avatar" alt="" referrerpolicy="no-referrer" @error="onWebAvatarError" />
                            <Clapperboard v-else :size="16" class="menu-avatar-icon" />
                            <div class="menu-account">
                                <p class="menu-label">B站账号</p>
                                <p class="menu-name">{{ biliWebLoggedIn ? (biliWebUserInfo?.uname || '已登录') : '未登录（搜索/收藏夹）' }}</p>
                            </div>
                            <button class="menu-btn" :class="{ on: biliWebLoggedIn }" @click="handleWebLogin">
                                {{ biliWebLoggedIn ? '退出' : '登录' }}
                            </button>
                        </div>
                        <div class="login-menu-divider"></div>
                        <!-- TV 账号行 -->
                        <div class="login-menu-row">
                            <img v-if="biliTvLoggedIn && biliTvUserInfo?.face" :src="biliTvUserInfo.face" class="menu-avatar" alt="" referrerpolicy="no-referrer" @error="onTvAvatarError" />
                            <MonitorPlay v-else :size="16" class="menu-avatar-icon" />
                            <div class="menu-account">
                                <p class="menu-label">TV 端（解锁 1080P+）</p>
                                <p class="menu-name">{{ biliTvLoggedIn ? (biliTvUserInfo?.uname || (biliTvMid ? `TV·${biliTvMid}` : '已登录')) : '未登录（封顶 720P）' }}</p>
                            </div>
                            <button class="menu-btn" :class="{ on: biliTvLoggedIn }" @click="biliTvLoggedIn ? logoutBiliTv() : handleBiliLogin()">
                                {{ biliTvLoggedIn ? '退出' : '登录' }}
                            </button>
                        </div>
                    </div>
                </transition>
            </div>
            <button
                class="refresh-btn"
                @click="refreshCurrent"
                :disabled="refreshing || loading"
                title="刷新当前页面"
            >
                <RefreshCw :size="16" :class="{ spin: refreshing }" />
                <span>{{ refreshing ? '刷新中' : '刷新' }}</span>
            </button>
        </div>

        <!-- 分区导航（仿B站官方分区栏，末位为收藏夹入口） -->
        <div class="region-nav">
            <button
                v-for="cat in categories"
                :key="cat.id"
                class="region-tab"
                :class="{ active: currentCat === cat.id && !searchMode }"
                @click="switchCat(cat.id)"
            >
                <component :is="cat.icon" :size="14" />
                <span>{{ cat.id }}</span>
            </button>
            <button
                class="region-tab fav-tab"
                :class="{ active: isFavCat && !searchMode }"
                @click="switchCat('收藏夹')"
            >
                <Heart :size="14" />
                <span>收藏夹</span>
            </button>
        </div>

        <!-- 搜索栏 -->
        <div class="search-bar">
            <Search :size="16" class="search-icon" />
            <input
                v-model="keyword"
                placeholder="搜索B站视频..."
                @keyup.enter="handleSearch"
                @focus="onSearchFocus"
                @blur="onSearchBlur"
            />
            <SearchSuggest
                module="bilibili-video"
                :query="keyword"
                :visible="showSearchSuggest"
                @select="onSelectSuggest"
                @select-item="onSelectItem"
            />
            <button class="search-btn bili-accent" @click="handleSearch" :disabled="searchLoading">
                <Loader2 v-if="searchLoading" :size="14" class="spin" />
                <Search v-else :size="14" />
                搜索
            </button>
            <!-- 搜索类型切换：视频 / 番剧 / 影视 -->
            <div class="search-type-tabs">
                <button
                    v-for="t in SEARCH_TYPES"
                    :key="t.key"
                    class="search-type-tab"
                    :class="{ active: searchType === t.key }"
                    @click="switchSearchType(t.key)"
                >
                    <component :is="t.key === 'video' ? Clapperboard : (t.key === 'bangumi' ? Tv : Film)" :size="13" />
                    {{ t.label }}
                </button>
            </div>
            <button v-if="searchMode" class="back-btn" @click="exitSearch()">返回首页</button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading || searchLoading || (isFavCat && favLoading)" class="loading">
            <Loader2 :size="36" class="spin" />
            <p>加载中...</p>
        </div>

        <!-- 搜索结果模式 -->
        <template v-else-if="searchMode">
            <div class="results-info">共找到 {{ searchResults.length }} 个{{ isPgcSearch ? (searchType === 'bangumi' ? '番剧' : '影视') : '视频' }}{{ searchHasMore ? '（当前页）' : '' }}</div>
            <!-- PGC（番剧/影视）搜索结果卡片 -->
            <div class="bili-grid" v-if="isPgcSearch && searchResults.length">
                <div
                    v-for="item in searchResults"
                    :key="item.seasonId"
                    class="bili-card pgc"
                    @click="openDetail(item)"
                >
                    <div class="bili-cover">
                        <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                        <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                        <span v-if="item.badge" class="pgc-badge" :class="{ vip: item.badge === '会员' }">{{ item.badge }}</span>
                        <span class="pgc-score" v-if="item.mediaScore"><Star :size="10" style="vertical-align: -1px" /> {{ item.mediaScore.toFixed(1) }}</span>
                    </div>
                    <div class="bili-info">
                        <p class="bili-title" :title="item.title">{{ item.title }}</p>
                        <p class="bili-pgc-meta">
                            <span class="pgc-type" :class="item.seasonType === 2 ? 'movie' : 'bangumi'">{{ item.seasonType === 2 ? '电影' : '番剧' }}</span>
                            <span v-if="item.indexShow" class="pgc-index">{{ item.indexShow }}</span>
                        </p>
                        <p class="bili-pgc-areas" v-if="item.areas.length">{{ item.areas.join(' / ') }}</p>
                    </div>
                </div>
            </div>
            <!-- 普通视频搜索结果 -->
            <div class="bili-grid" v-if="!isPgcSearch && searchResults.length">
                <div
                    v-for="item in searchResults"
                    :key="item.bvid"
                    class="bili-card"
                    @click="openDetail(item)"
                >
                    <div class="bili-cover">
                        <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                        <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                        <span class="bili-duration">{{ fmtDuration(item.duration) }}</span>
                        <span class="bili-play-stat"><BiliIcon name="play" :size="11" /> {{ fmtCount(item.play) }} <BiliIcon name="danmaku" :size="11" /> {{ fmtCount(item.danmaku) }}</span>
                    </div>
                    <div class="bili-info">
                        <p class="bili-title" :title="item.title">{{ item.title }}</p>
                        <p class="bili-author" :class="{ link: item.mid }" :title="item.mid ? '查看 UP 主主页' : ''" @click.stop="goUserSpace(item.mid || 0)"><Tv :size="12" /> {{ item.author }}</p>
                    </div>
                </div>
            </div>
            <div v-else-if="!isPgcSearch && !searchResults.length" class="empty">
                <Clapperboard :size="48" />
                <p>未找到相关视频</p>
            </div>
            <div v-if="isPgcSearch && !searchResults.length" class="empty">
                <Clapperboard :size="48" />
                <p>未找到相关{{ searchType === 'bangumi' ? '番剧' : '影视' }}</p>
            </div>
            <!-- 搜索翻页 -->
            <div class="pagination" v-if="searchResults.length">
                <button class="page-btn" :disabled="searchPage <= 1" @click="searchGoPage(searchPage - 1)">
                    <ChevronLeft :size="14" /> 上一页
                </button>
                <span class="page-num active">{{ searchPage }}</span>
                <button class="page-btn" :disabled="!searchHasMore" @click="searchGoPage(searchPage + 1)">
                    下一页 <ChevronRight :size="14" />
                </button>
            </div>
        </template>

        <!-- 收藏夹模式（需 Web 登录） -->
        <template v-else-if="isFavCat">
            <!-- 收藏夹内容视图 -->
            <div v-if="currentFolder" class="bili-home-layout">
                <div class="bili-main">
                    <div class="section-header">
                        <button class="fav-back" @click="backToFolders">
                            <ChevronLeft :size="15" /> 返回收藏夹列表
                        </button>
                        <h3 class="section-title bili-section">
                            <Folder :size="16" /> {{ currentFolder.title }}（{{ currentFolder.mediaCount }}）
                        </h3>
                    </div>
                    <div class="bili-grid" v-if="favList.length">
                        <div
                            v-for="item in favList"
                            :key="item.id"
                            class="bili-card"
                            @click="openDetail(item)"
                        >
                            <div class="bili-cover">
                                <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                                <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                                <span class="bili-duration">{{ fmtDuration(item.duration) }}</span>
                                <span class="bili-play-stat"><Play :size="11" /> {{ item.upper }}</span>
                            </div>
                            <div class="bili-info">
                                <p class="bili-title" :title="item.title">{{ item.title }}</p>
                                <p class="bili-author"><Tv :size="12" /> {{ item.upper }}</p>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="!favLoading" class="empty">
                        <Folder :size="48" />
                        <p>该收藏夹暂无视频</p>
                    </div>
                    <!-- 收藏夹页码分页（每页 20 条） -->
                    <div class="pagination" v-if="favTotalPages > 1">
                        <button class="page-btn" :disabled="favPage <= 1 || favLoading" @click="favGoPage(favPage - 1)">
                            <ChevronLeft :size="14" /> 上一页
                        </button>
                        <template v-for="n in favPageItems" :key="n">
                            <span v-if="n === -1" class="page-ellipsis">…</span>
                            <button v-else class="page-num" :class="{ active: n === favPage }" @click="favGoPage(n)">{{ n }}</button>
                        </template>
                        <button class="page-btn" :disabled="favPage >= favTotalPages || favLoading" @click="favGoPage(favPage + 1)">
                            下一页 <ChevronRight :size="14" />
                        </button>
                    </div>
                </div>
            </div>

            <!-- 收藏夹文件夹列表视图 -->
            <div v-else class="fav-folders">
                <div class="section-header">
                    <h3 class="section-title bili-section"><Heart :size="16" /> 我的收藏夹</h3>
                </div>
                <div class="fav-folder-grid" v-if="favFolders.length">
                    <div
                        v-for="folder in favFolders"
                        :key="folder.id"
                        class="fav-folder-card"
                        @click="openFavFolder(folder)"
                    >
                        <div class="fav-folder-cover">
                            <img v-if="folder.cover && !isCoverFailed(folder.cover)" :src="folder.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(folder.cover)" />
                            <div v-else class="cover-placeholder"><Folder :size="36" /></div>
                        </div>
                        <div class="fav-folder-info">
                            <p class="fav-folder-title" :title="folder.title">{{ folder.title }}</p>
                            <p class="fav-folder-count">{{ folder.mediaCount }} 个内容</p>
                        </div>
                    </div>
                </div>
                <div v-else-if="!favLoading" class="empty">
                    <Folder :size="48" />
                    <p>暂无收藏夹</p>
                </div>
            </div>
        </template>

        <!-- 首页模式：视频网格 + 排行榜 -->
        <template v-else>
            <div class="bili-home-layout">
                <!-- 左侧：视频列表 -->
                <div class="bili-main">
                    <div class="section-header">
                        <h3 class="section-title bili-section">
                            <component :is="categories.find(c => c.id === currentCat)?.icon || Sparkles" :size="16" />
                            {{ currentCat === '推荐' ? '综合热门' : `${currentCat} · 最新投稿` }}
                        </h3>
                    </div>
                    <div class="bili-grid" v-if="homeData.list.length">
                        <div
                            v-for="item in homeData.list"
                            :key="item.bvid"
                            class="bili-card"
                            @click="openDetail(item)"
                        >
                            <div class="bili-cover">
                                <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                                <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                                <span class="bili-duration">{{ fmtDuration(item.duration) }}</span>
                                <span class="bili-play-stat"><BiliIcon name="play" :size="11" /> {{ fmtCount(item.play) }} <BiliIcon name="danmaku" :size="11" /> {{ fmtCount(item.danmaku) }}</span>
                            </div>
                            <div class="bili-info">
                                <p class="bili-title" :title="item.title">{{ item.title }}</p>
                                <p class="bili-author" :class="{ link: item.mid }" :title="item.mid ? '查看 UP 主主页' : ''" @click.stop="goUserSpace(item.mid || 0)"><Tv :size="12" /> {{ item.author }}</p>
                            </div>
                        </div>
                    </div>
                    <div v-else class="empty">
                        <Clapperboard :size="48" />
                        <p>该分区暂无内容</p>
                    </div>
                    <!-- 翻页 -->
                    <div class="pagination" v-if="homeData.list.length">
                        <button class="page-btn" :disabled="page <= 1" @click="prevPage">
                            <ChevronLeft :size="14" /> 上一页
                        </button>
                        <span class="page-num active">{{ page }}</span>
                        <button class="page-btn" :disabled="!hasMore" @click="nextPage">
                            下一页 <ChevronRight :size="14" />
                        </button>
                    </div>
                </div>

                <!-- 右侧：排行榜 -->
                <div class="bili-aside" v-if="homeData.ranking.length">
                    <div class="section-header">
                        <h3 class="section-title bili-section"><TrendingUp :size="16" /> {{ currentCat === '推荐' ? '全站排行' : currentCat + '排行' }}</h3>
                    </div>
                    <div class="ranking-list">
                        <div
                            v-for="(item, idx) in homeData.ranking"
                            :key="item.bvid"
                            class="ranking-item"
                            @click="openDetail(item)"
                        >
                            <span class="ranking-no" :class="{ top: idx < 3 }">{{ idx + 1 }}</span>
                            <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" class="ranking-cover-wide" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                            <div v-else class="ranking-cover-wide ranking-cover-placeholder"><Clapperboard :size="20" /></div>
                            <div class="ranking-info">
                                <p class="ranking-title" :title="item.title">{{ item.title }}</p>
                                <p class="ranking-desc"><BiliIcon name="play" :size="11" /> {{ fmtCount(item.play) }} · <span class="ranking-author" :class="{ link: item.mid }" @click.stop="goUserSpace(item.mid || 0)">{{ item.author }}</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <!-- B站 Web 账号扫码登录弹窗 -->
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
                            <p v-if="webQrStatus === 'waiting'">请使用 <strong>B站手机 App</strong> 扫描二维码登录</p>
                            <p v-else-if="webQrStatus === 'scanned'">等待确认中...</p>
                            <p class="bili-qr-benefit">登录后可浏览收藏夹，搜索更稳定（与网址解析共用登录）</p>
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
                        </div>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.bili-video-view {
    padding: 20px 30px;
    flex: 1;
    overflow-y: auto;
    background: #f5f5f5;
}

/* B站品牌粉 */
.bili-brand { color: #fb7299; }

/* 分区导航栏 */
.region-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    background: #fff;
    border-radius: 12px;
    padding: 8px 10px;
    margin-bottom: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.region-tab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    color: #666;
    transition: all 0.2s;
}

.region-tab:hover { color: #fb7299; background: rgba(251, 114, 153, 0.08); }
.region-tab.active { background: #fb7299; color: #fff; }

/* 搜索按钮 B站粉 */
.search-btn.bili-accent { background: #fb7299; }
.search-btn.bili-accent:hover:not(:disabled) { background: #ff8bab; }

/* 首页布局：左视频右排行 */
.bili-home-layout {
    display: flex;
    gap: 20px;
    align-items: flex-start;
}

.bili-main { flex: 1; min-width: 0; }

.bili-aside {
    width: 320px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
}

.bili-section { border-left-color: #fb7299; }

/* 视频卡片网格（16:9） */
.bili-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 16px 14px;
}

.bili-card {
    cursor: pointer;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    transition: transform 0.2s, box-shadow 0.2s;
}

.bili-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 16px rgba(251, 114, 153, 0.2);
}

.bili-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    background: #f0f0f0;
    overflow: hidden;
}

.bili-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.bili-card:hover .bili-cover img { transform: scale(1.05); }

.bili-cover .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
}

.bili-duration {
    position: absolute;
    right: 6px;
    bottom: 6px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    line-height: 1.5;
}

.bili-play-stat {
    position: absolute;
    left: 6px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
    color: #fff;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    line-height: 1.5;
}

.bili-info { padding: 8px 10px 10px; }

.bili-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: #333;
    line-height: 1.45;
    height: 2.9em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.bili-author {
    margin: 6px 0 0;
    font-size: 12px;
    color: #999;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bili-author.link,
.ranking-author.link {
    color: #fb7299;
    cursor: pointer;
}

.bili-author.link:hover,
.ranking-author.link:hover {
    text-decoration: underline;
}

.ranking-author { color: inherit; }

/* 排行榜横版封面 */
.ranking-cover-wide {
    width: 80px;
    height: 50px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
}

.ranking-cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
    background: #f0f0f0;
}

/* TV 登录胶囊（B站粉配色） */
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

.login-capsule.bili-tv:hover, .login-capsule.bili-web:hover { background: rgba(251, 114, 153, 0.16); }

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

/* ===== 合并登录下拉面板 ===== */
.login-merged { position: relative; }

.login-capsule:hover { background: rgba(251, 114, 153, 0.16); }

.login-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 260px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    padding: 10px;
    z-index: 60;
}

.login-menu-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
}

.login-menu-divider {
    height: 1px;
    background: #f1f2f3;
    margin: 4px 0;
}

.menu-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid #f0f0f0;
}

.menu-avatar-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(251, 114, 153, 0.08);
    color: #fb7299;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.menu-account { flex: 1; min-width: 0; }

.menu-label {
    margin: 0;
    font-size: 10px;
    color: #999;
}

.menu-name {
    margin: 1px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.menu-btn {
    flex-shrink: 0;
    padding: 4px 14px;
    border-radius: 12px;
    border: 1px solid rgba(251, 114, 153, 0.5);
    background: rgba(251, 114, 153, 0.08);
    color: #fb7299;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.menu-btn:hover { background: rgba(251, 114, 153, 0.16); }

.menu-btn.on {
    background: #fb7299;
    color: #fff;
    border-color: #fb7299;
}

/* ===== 搜索类型切换（视频/番剧/影视）===== */
.search-type-tabs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #fff;
    border-radius: 16px;
    padding: 3px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.search-type-tab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: none;
    color: #61666d;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
}

.search-type-tab:hover { color: #fb7299; background: rgba(251, 114, 153, 0.06); }

.search-type-tab.active {
    background: #fb7299;
    color: #fff;
}

/* ===== PGC（番剧/影视）搜索结果卡片 ===== */
.bili-card.pgc .bili-cover { aspect-ratio: 3/4; }

.pgc-badge {
    position: absolute;
    left: 0;
    top: 0;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: #ffb027;
    padding: 1px 6px;
    border-radius: 0 0 6px 0;
}

.pgc-badge.vip { background: #fb7299; }

.pgc-score {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #ffb027;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
}

.bili-pgc-meta {
    margin: 3px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #999;
}

.pgc-type {
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    padding: 0 5px;
    border-radius: 3px;
    line-height: 1.6;
}

.pgc-type.bangumi { background: #fb7299; }
.pgc-type.movie { background: #23ade5; }

.pgc-index { color: #61666d; }

.bili-pgc-areas {
    margin: 2px 0 0;
    font-size: 11px;
    color: #bbb;
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

/* 弹窗过渡（fade-in 缩放） */
.modal-enter-active, .modal-leave-active { transition: opacity 0.25s ease; }
.modal-enter-active .bili-qr-modal, .modal-leave-active .bili-qr-modal { transition: transform 0.25s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .bili-qr-modal, .modal-leave-to .bili-qr-modal { transform: scale(0.92); }

/* ===== 收藏夹 ===== */
/* 分区栏收藏夹入口（心形，与分区 tab 同款） */
.region-tab.fav-tab { color: #999; }
.region-tab.fav-tab:hover { color: #fb7299; background: rgba(251, 114, 153, 0.08); }
.region-tab.fav-tab.active { background: #fb7299; color: #fff; }

/* 收藏夹返回按钮 */
.fav-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: #999;
    font-size: 13px;
    cursor: pointer;
    padding: 2px 0;
    transition: color 0.2s;
}

.fav-back:hover { color: #fb7299; }

/* 收藏夹文件夹网格 */
.fav-folder-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 16px 14px;
}

.fav-folder-card {
    cursor: pointer;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    transition: transform 0.2s, box-shadow 0.2s;
}

.fav-folder-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 16px rgba(251, 114, 153, 0.2);
}

.fav-folder-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    background: #f0f0f0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}

.fav-folder-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.fav-folder-card:hover .fav-folder-cover img { transform: scale(1.05); }

.fav-folder-cover .cover-placeholder { color: #ddd; }

.fav-folder-info { padding: 8px 10px 10px; }

.fav-folder-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fav-folder-count { margin: 5px 0 0; font-size: 12px; color: #999; }

/* ===== B站式分页：覆盖 anime-common.css 的红色直角，与 UP 主页/页面粉色主题统一 ===== */
.pagination .page-btn,
.pagination .page-num {
    border: 1px solid #e5e6e7;
    background: #fff;
    color: #666;
    border-radius: 16px;
    padding: 6px 16px;
    font-size: 12px;
    box-shadow: none;
    transform: none;
}
.pagination .page-btn:hover:not(:disabled),
.pagination .page-num:hover:not(.active) {
    border-color: #fb7299;
    color: #fb7299;
    background: rgba(251, 114, 153, 0.08);
    transform: none;
    box-shadow: none;
}
.pagination .page-btn:disabled {
    opacity: 0.5;
    cursor: default;
    background: #f5f5f5;
}
.pagination .page-num {
    min-width: 30px;
    padding: 6px 4px;
    justify-content: center;
}
.pagination .page-num.active {
    background: #fb7299;
    border-color: #fb7299;
    color: #fff;
    font-weight: 600;
    box-shadow: none;
}
.pagination .page-ellipsis { color: #999; padding: 0 4px; user-select: none; }

</style>
