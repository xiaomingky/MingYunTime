<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { animeHome, animeSearch } from '../api'
import { useMessageStore } from '../store/message'
import { useAnimeStore } from '../store/anime'
import { useSearchHistoryStore } from '../store/searchHistory'
import SearchSuggest from '../components/SearchSuggest.vue'
import { Search, Loader2, Film, Tv, ChevronLeft, ChevronRight, Sparkles, Flame, TrendingUp, Clock, RefreshCw, Heart, Trash2, X } from 'lucide-vue-next'
import './anime-common.css'

const router = useRouter()
const messageStore = useMessageStore()
const animeStore = useAnimeStore()
const searchHistoryStore = useSearchHistoryStore()

const showSearchSuggest = ref(false)

// 封面加载失败的 URL 集合（用于切换到占位图）
const failedCovers = ref(new Set())
function onCoverError(url) {
    if (!url) return
    failedCovers.value = new Set([...failedCovers.value, url])
}
function isCoverFailed(url) {
    return failedCovers.value.has(url)
}

// ===== 源配置（4线路：官方/推荐/经典/备用，由后端 anime.js 自动故障转移）=====
const sources = [
    { id: 'yhfs', label: '官方线路', desc: '官方直连' },
    { id: 'yhf', label: '推荐线路', desc: '稳定优先' },
    { id: 'xdm', label: '经典线路', desc: '资源全' },
    { id: 'yhdmfan', label: '备用线路', desc: '兜底' }
]

const currentSource = ref('yhfs')

// ===== 刷新当前视图（首页 / 搜索结果）=====
const refreshing = ref(false)
async function refreshCurrent() {
    if (refreshing.value) return
    refreshing.value = true
    try {
        if (searchMode.value && keyword.value.trim()) {
            await handleSearch()
        } else {
            await fetchHome()
        }
        messageStore.success('已刷新')
    } finally {
        refreshing.value = false
    }
}

// ===== 数据 =====
const homeData = ref({ latest: [], hot: [], ranking: [] })
const loading = ref(false)
const keyword = ref('')
const searchResultsRaw = ref([])
const searchMode = ref(false)
const searchLoading = ref(false)

// 搜索结果去重 + 过滤无封面项（避免出现"有名字没图片"的重复项）
// 优先保留有封面的项；同 id 只保留第一个
const searchResults = computed(() => {
    const seen = new Map()
    // 先放有封面的
    for (const item of searchResultsRaw.value) {
        if (item.cover && !seen.has(item.id)) {
            seen.set(item.id, item)
        }
    }
    // 再放无封面的（仅当 id 未出现过）
    for (const item of searchResultsRaw.value) {
        if (!item.cover && !seen.has(item.id)) {
            seen.set(item.id, item)
        }
    }
    return Array.from(seen.values())
})

// ===== 分页 =====
const PAGE_SIZE = 24
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(searchResults.value.length / PAGE_SIZE)))
const pagedSearchResults = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE
    return searchResults.value.slice(start, start + PAGE_SIZE)
})
function goToPage(p) {
    if (p < 1 || p > totalPages.value) return
    currentPage.value = p
    // 滚动到顶部
    const el = document.querySelector('.anime-page')
    if (el) el.scrollTop = 0
}
// 显示的页码按钮（最多 7 个，当前页居中）
const pageNumbers = computed(() => {
    const total = totalPages.value
    const cur = currentPage.value
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const pages = new Set([1, total, cur, cur - 1, cur + 1, cur - 2, cur + 2])
    return Array.from(pages).filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
})

// ===== 轮播图 =====
const carouselIndex = ref(0)
let carouselTimer = null
const carouselItems = computed(() => homeData.value.latest.slice(0, 5))

const nextCarousel = () => {
    if (carouselItems.value.length === 0) return
    carouselIndex.value = (carouselIndex.value + 1) % carouselItems.value.length
}
const prevCarousel = () => {
    if (carouselItems.value.length === 0) return
    carouselIndex.value = (carouselIndex.value - 1 + carouselItems.value.length) % carouselItems.value.length
}
const startCarousel = () => {
    stopCarousel()
    carouselTimer = setInterval(nextCarousel, 4000)
}
const stopCarousel = () => {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null }
}

// ===== 分类导航 =====
const categories = [
    { id: '番剧', icon: Tv },
    { id: '剧场版', icon: Film },
    { id: 'OVA', icon: Film },
    { id: '国产', icon: Film },
    { id: '欧美', icon: Film },
    { id: '恋爱', icon: Film },
    { id: '热血', icon: Flame }
]

const goToCategory = (cat) => {
    // 改为本地搜索（不再跳转推荐页）
    keyword.value = cat
    handleSearch()
}

// ===== 我的收藏面板（首页线路一旁） =====
const showFavPanel = ref(false)
const favorites = computed(() => animeStore.favorites)
const toggleFavPanel = () => {
    showFavPanel.value = !showFavPanel.value
}
const closeFavPanel = () => {
    showFavPanel.value = false
}
const removeFav = (item) => {
    animeStore.removeFavorite(item.source, item.id)
    messageStore.success('已取消收藏')
}
const openFavDetail = (item) => {
    showFavPanel.value = false
    router.push(`/anime/${item.source || currentSource.value}/${item.id}`)
}

// ===== 数据加载 =====
const fetchHome = async () => {
    loading.value = true
    searchMode.value = false
    try {
        const res = await animeHome(currentSource.value)
        if (res?.success && res.data) {
            // 去重（同 id 只保留第一个）
            const dedup = (arr) => {
                const seen = new Set()
                const out = []
                for (const item of (arr || [])) {
                    if (!seen.has(item.id)) { seen.add(item.id); out.push(item) }
                }
                return out
            }
            homeData.value = {
                latest: dedup(res.data.latest).slice(0, 30),
                hot: dedup(res.data.hot).slice(0, 18),
                ranking: dedup(res.data.ranking).slice(0, 10)
            }
            carouselIndex.value = 0
            startCarousel()
        } else {
            messageStore.error(res?.message || '加载失败')
            homeData.value = { latest: [], hot: [], ranking: [] }
        }
    } catch (e) {
        messageStore.error('加载失败: ' + e.message)
        homeData.value = { latest: [], hot: [], ranking: [] }
    } finally {
        loading.value = false
    }
}

const handleSearch = async () => {
    if (!keyword.value.trim()) {
        messageStore.warning('请输入搜索关键词')
        return
    }
    // 从详情页"相关推荐"跳转过来的搜索（URL 带 from=related），不覆盖 sessionStorage
    // 这样用户从详情页返回时，仍能恢复"主动搜索"的状态，而不是"最新搜索"
    const isFromRelated = router.currentRoute.value.query.from === 'related'
    if (!isFromRelated) {
        searchHistoryStore.addHistory('anime', keyword.value)
    }
    showSearchSuggest.value = false
    searchLoading.value = true
    searchMode.value = true
    try {
        const res = await animeSearch(currentSource.value, keyword.value)
        if (res?.success) {
            searchResultsRaw.value = res.data || []
            currentPage.value = 1
            if (searchResultsRaw.value.length === 0) {
                messageStore.warning('未找到相关动漫')
            }
            // 仅在用户主动搜索时保存状态到 sessionStorage
            // 从"相关推荐"跳转过来的搜索不保存，避免覆盖用户原搜索状态
            if (!isFromRelated) {
                sessionStorage.setItem('anime_search_state', JSON.stringify({
                    keyword: keyword.value,
                    source: currentSource.value,
                    results: searchResultsRaw.value,
                    page: currentPage.value,
                    ts: Date.now()
                }))
            }
        } else {
            messageStore.error(res?.message || '搜索失败')
        }
    } catch (e) {
        messageStore.error('搜索失败: ' + e.message)
    } finally {
        searchLoading.value = false
    }
}

// 恢复搜索状态（从详情页返回时）
function restoreSearchState() {
    try {
        const raw = sessionStorage.getItem('anime_search_state')
        if (!raw) return false
        const state = JSON.parse(raw)
        // 超过 30 分钟视为过期
        if (Date.now() - state.ts > 30 * 60 * 1000) {
            sessionStorage.removeItem('anime_search_state')
            return false
        }
        keyword.value = state.keyword || ''
        currentSource.value = state.source || 'yhfs'
        searchResultsRaw.value = state.results || []
        currentPage.value = state.page || 1
        searchMode.value = true
        return true
    } catch { return false }
}

const exitSearch = () => {
    searchMode.value = false
    keyword.value = ''
    searchResultsRaw.value = []
    showSearchSuggest.value = false
    sessionStorage.removeItem('anime_search_state')
}

const onSelectSuggest = (kw) => {
    keyword.value = kw
    handleSearch()
}

// "您可能再找"实时搜索结果点击：anime → 跳转到动漫详情页
const onSelectItem = (item) => {
    showSearchSuggest.value = false
    if (item?.type === 'anime' && item.id) {
        router.push(`/anime/${item.source || 'yhfs'}/${item.id}`)
    }
}

// 搜索框 focus/blur：保存 timer 句柄，避免竞态导致下拉框刚显示就被隐藏
let blurTimer = null
const onSearchFocus = () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
    showSearchSuggest.value = true
}
const onSearchBlur = () => {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => { showSearchSuggest.value = false }, 200)
}

const switchSource = (src) => {
    if (currentSource.value === src) return
    currentSource.value = src
    animeStore.setSource(src)
    if (searchMode.value && keyword.value) {
        handleSearch()
    } else {
        fetchHome()
    }
}

const openDetail = (item) => {
    router.push(`/anime/${item.source || currentSource.value}/${item.id}`)
}

onMounted(() => {
    // 优先从 URL query 接管搜索（例如从详情页"找相似"跳转过来）
    const kw = router.currentRoute.value.query.kw
    if (kw && typeof kw === 'string' && kw.trim()) {
        keyword.value = kw.trim()
        handleSearch()
        return
    }
    // 否则尝试恢复上次搜索状态（从详情页返回时）
    if (restoreSearchState()) {
        // 恢复成功，不加载首页
        return
    }
    fetchHome()
})

onUnmounted(() => {
    stopCarousel()
})
</script>

<template>
    <div class="anime-view">
        <!-- 页头 -->
        <div class="page-header">
            <h2 class="page-title">
                <Film :size="22" /> 动漫
            </h2>
            <div v-if="sources.length > 1" class="source-tabs">
                <button
                    v-for="s in sources"
                    :key="s.id"
                    class="source-tab"
                    :class="{ active: currentSource === s.id }"
                    @click="switchSource(s.id)"
                >
                    {{ s.label }}
                </button>
            </div>
            <!-- 我的收藏按钮（线路一旁） -->
            <div class="fav-entry">
                <button
                    class="fav-toggle-btn"
                    :class="{ active: showFavPanel }"
                    @click="toggleFavPanel"
                    title="我的收藏"
                >
                    <Heart :size="16" :fill="showFavPanel ? 'currentColor' : 'none'" />
                    <span>我的收藏</span>
                    <span v-if="favorites.length > 0" class="fav-badge">{{ favorites.length }}</span>
                </button>
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

        <!-- 我的收藏面板（侧滑） -->
        <transition name="fav-slide">
            <div v-if="showFavPanel" class="fav-panel">
                <div class="fav-panel-header">
                    <h3>
                        <Heart :size="18" :fill="'currentColor'" /> 我的收藏
                        <span class="fav-count">{{ favorites.length }}</span>
                    </h3>
                    <button class="fav-close" @click="closeFavPanel" title="关闭">
                        <X :size="18" />
                    </button>
                </div>
                <div v-if="favorites.length === 0" class="fav-empty">
                    <Heart :size="48" />
                    <p>还没有收藏动漫</p>
                    <small>在详情页点击收藏即可</small>
                </div>
                <div v-else class="fav-list">
                    <div
                        v-for="item in favorites"
                        :key="`fav-${item.source}-${item.id}`"
                        class="fav-item"
                        @click="openFavDetail(item)"
                    >
                        <div class="fav-cover">
                            <img
                                v-if="item.cover"
                                :src="item.cover"
                                referrerpolicy="no-referrer"
                                @error="$event.target.style.display='none'"
                            />
                            <div v-else class="fav-cover-placeholder"><Film :size="20" /></div>
                        </div>
                        <div class="fav-info">
                            <div class="fav-title" :title="item.title">{{ item.title }}</div>
                            <div class="fav-date">收藏于 {{ new Date(item.addedAt).toLocaleDateString() }}</div>
                        </div>
                        <button class="fav-remove" @click.stop="removeFav(item)" title="取消收藏">
                            <Trash2 :size="14" />
                        </button>
                    </div>
                </div>
            </div>
        </transition>

        <!-- 搜索栏 -->
        <div class="search-bar">
            <Search :size="16" class="search-icon" />
            <input
                v-model="keyword"
                :placeholder="`在 ${sources.find(s => s.id === currentSource)?.label} 搜索动漫...`"
                @keyup.enter="handleSearch"
                @focus="onSearchFocus"
                @blur="onSearchBlur"
            />
            <SearchSuggest
                module="anime"
                :query="keyword"
                :visible="showSearchSuggest"
                @select="onSelectSuggest"
                @select-item="onSelectItem"
            />
            <button class="search-btn" @click="handleSearch" :disabled="searchLoading">
                <Loader2 v-if="searchLoading" :size="14" class="spin" />
                <Search v-else :size="14" />
                搜索
            </button>
            <button v-if="searchMode" class="back-btn" @click="exitSearch">返回首页</button>
        </div>

        <!-- 加载骨架屏 -->
        <div v-if="loading" class="skeleton-area">
            <div class="skeleton-carousel"></div>
            <div class="skeleton-row" v-for="i in 3" :key="i">
                <div class="skeleton-card" v-for="j in 6" :key="j"></div>
            </div>
        </div>

        <!-- 搜索结果模式 -->
        <template v-else-if="searchMode">
            <div class="results-area">
                <div v-if="searchLoading" class="loading">
                    <Loader2 :size="28" class="spin" /> 搜索中...
                </div>
                <div v-else-if="searchResults.length === 0" class="empty">
                    <Film :size="48" />
                    <p>未找到相关动漫</p>
                    <small>试试其他关键词或切换源</small>
                </div>
                <template v-else>
                    <div class="results-info">共 {{ searchResults.length }} 条结果，第 {{ currentPage }} / {{ totalPages }} 页</div>
                    <div class="anime-grid">
                        <div
                            v-for="item in pagedSearchResults"
                            :key="`${item.source}-${item.id}`"
                            class="anime-card"
                            @click="openDetail(item)"
                        >
                            <div class="cover-wrapper">
                                <img
                                    v-if="item.cover && !isCoverFailed(item.cover)"
                                    :src="item.cover"
                                    class="cover"
                                    loading="lazy"
                                    @error="onCoverError(item.cover)"
                                />
                                <div v-else class="cover-placeholder">
                                    <Film :size="32" />
                                </div>
                            </div>
                            <div class="anime-info">
                                <div class="anime-title" :title="item.title">{{ item.title }}</div>
                                <div v-if="item.desc" class="anime-desc">{{ item.desc }}</div>
                            </div>
                        </div>
                    </div>
                    <!-- 分页控件 -->
                    <div v-if="totalPages > 1" class="pagination">
                        <button
                            class="page-btn"
                            :disabled="currentPage === 1"
                            @click="goToPage(currentPage - 1)"
                        >
                            <ChevronLeft :size="16" /> 上一页
                        </button>
                        <template v-for="(p, idx) in pageNumbers" :key="idx">
                            <span v-if="idx > 0 && p - pageNumbers[idx - 1] > 1" class="page-ellipsis">...</span>
                            <button
                                class="page-num"
                                :class="{ active: p === currentPage }"
                                @click="goToPage(p)"
                            >{{ p }}</button>
                        </template>
                        <button
                            class="page-btn"
                            :disabled="currentPage === totalPages"
                            @click="goToPage(currentPage + 1)"
                        >
                            下一页 <ChevronRight :size="16" />
                        </button>
                    </div>
                </template>
            </div>
        </template>

        <!-- 主页内容 -->
        <template v-else>
            <!-- 轮播图 -->
            <div v-if="carouselItems.length > 0" class="carousel" @mouseenter="stopCarousel" @mouseleave="startCarousel">
                <div class="carousel-track">
                    <div
                        v-for="(item, idx) in carouselItems"
                        :key="idx"
                        class="carousel-slide"
                        :class="{ active: carouselIndex === idx }"
                        @click="openDetail(item)"
                    >
                        <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" class="carousel-img" @error="onCoverError(item.cover)" />
                        <div class="carousel-placeholder" v-else>
                            <Film :size="60" />
                        </div>
                        <div class="carousel-mask"></div>
                        <div class="carousel-caption">
                            <div class="carousel-title">{{ item.title }}</div>
                            <div v-if="item.desc" class="carousel-desc">{{ item.desc }}</div>
                        </div>
                    </div>
                </div>
                <button class="carousel-arrow prev" @click.stop="prevCarousel">
                    <ChevronLeft :size="24" />
                </button>
                <button class="carousel-arrow next" @click.stop="nextCarousel">
                    <ChevronRight :size="24" />
                </button>
                <div class="carousel-dots">
                    <span
                        v-for="(item, idx) in carouselItems"
                        :key="idx"
                        class="dot"
                        :class="{ active: carouselIndex === idx }"
                        @click="carouselIndex = idx"
                    ></span>
                </div>
            </div>

            <!-- 分类导航 -->
            <div class="category-nav">
                <div
                    v-for="cat in categories"
                    :key="cat.id"
                    class="category-card"
                    @click="goToCategory(cat.id)"
                >
                    <component :is="cat.icon" :size="22" />
                    <span>{{ cat.id }}</span>
                </div>
            </div>

            <!-- 最新更新 -->
            <section v-if="homeData.latest.length > 0" class="section">
                <div class="section-header">
                    <h3 class="section-title">
                        <Clock :size="16" /> 最新更新
                    </h3>
                </div>
                <div class="horizontal-scroll">
                    <div
                        v-for="item in homeData.latest"
                        :key="`${item.source}-${item.id}`"
                        class="anime-card horizontal"
                        @click="openDetail(item)"
                    >
                        <div class="cover-wrapper">
                            <img
                                v-if="item.cover && !isCoverFailed(item.cover)"
                                :src="item.cover"
                                class="cover"
                                loading="lazy"
                                @error="onCoverError(item.cover)"
                            />
                            <div v-else class="cover-placeholder">
                                <Film :size="28" />
                            </div>
                        </div>
                        <div class="anime-title" :title="item.title">{{ item.title }}</div>
                    </div>
                </div>
            </section>

            <!-- 热门推荐 -->
            <section v-if="homeData.hot.length > 0" class="section">
                <div class="section-header">
                    <h3 class="section-title">
                        <Flame :size="16" /> 热门推荐
                    </h3>
                </div>
                <div class="anime-grid">
                    <div
                        v-for="item in homeData.hot"
                        :key="`hot-${item.source}-${item.id}`"
                        class="anime-card"
                        @click="openDetail(item)"
                    >
                        <div class="cover-wrapper">
                            <img
                                v-if="item.cover && !isCoverFailed(item.cover)"
                                :src="item.cover"
                                class="cover"
                                loading="lazy"
                                @error="onCoverError(item.cover)"
                            />
                            <div v-else class="cover-placeholder">
                                <Film :size="32" />
                            </div>
                        </div>
                        <div class="anime-info">
                            <div class="anime-title" :title="item.title">{{ item.title }}</div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 周排行 -->
            <section v-if="homeData.ranking.length > 0" class="section">
                <div class="section-header">
                    <h3 class="section-title">
                        <TrendingUp :size="16" /> 周排行 Top{{ homeData.ranking.length }}
                    </h3>
                </div>
                <div class="ranking-list">
                    <div
                        v-for="(item, idx) in homeData.ranking"
                        :key="`rank-${item.source}-${item.id}`"
                        class="ranking-item"
                        @click="openDetail(item)"
                    >
                        <div class="ranking-no" :class="{ top: idx < 3 }">{{ idx + 1 }}</div>
                        <img
                            v-if="item.cover && !isCoverFailed(item.cover)"
                            :src="item.cover"
                            class="ranking-cover"
                            loading="lazy"
                            @error="onCoverError(item.cover)"
                        />
                        <div v-else class="ranking-cover-placeholder">
                            <Film :size="16" />
                        </div>
                        <div class="ranking-info">
                            <div class="ranking-title">{{ item.title }}</div>
                            <div v-if="item.desc" class="ranking-desc">{{ item.desc }}</div>
                        </div>
                    </div>
                </div>
            </section>

        </template>
    </div>
</template>

<style scoped>
.anime-view {
    padding: 20px 30px;
    flex: 1;
    overflow-y: auto;
    background: #f5f5f5;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 12px;
}

.page-title {
    margin: 0;
    font-size: 22px;
    color: #333;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
}

.source-tabs {
    display: flex;
    gap: 4px;
    background: #fff;
    padding: 4px;
    border-radius: 20px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.source-tab {
    padding: 6px 14px;
    background: transparent;
    border: none;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    color: #666;
    transition: all 0.2s;
}

.source-tab:hover {
    color: #c20c0c;
}

.source-tab.active {
    background: #c20c0c;
    color: #fff;
}

.search-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border-radius: 20px;
    padding: 8px 16px;
    margin-bottom: 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.search-icon {
    color: #999;
}

.search-bar input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: #333;
}

.search-btn {
    background: #c20c0c;
    color: #fff;
    border: none;
    padding: 8px 18px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
}

.search-btn:hover:not(:disabled) {
    background: #d11515;
    transform: translateY(-1px);
}

.search-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.back-btn {
    background: transparent;
    color: #999;
    border: 1px solid #ddd;
    padding: 8px 14px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.back-btn:hover {
    color: #c20c0c;
    border-color: #c20c0c;
}

/* 轮播图 */
.carousel {
    position: relative;
    width: 100%;
    height: 280px;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
    background: #fff;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.carousel-track {
    position: relative;
    width: 100%;
    height: 100%;
}

.carousel-slide {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.6s ease;
    cursor: pointer;
    pointer-events: none; /* 非激活的不接收点击，避免误触第一个 */
}

.carousel-slide.active {
    opacity: 1;
    pointer-events: auto; /* 只有激活的接收点击 */
}

.carousel-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.carousel-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f5f5f5, #e0e0e0);
    color: #ccc;
}

.carousel-mask {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85), transparent 60%);
}

.carousel-caption {
    position: absolute;
    bottom: 30px;
    left: 30px;
    right: 30px;
    color: #fff;
    z-index: 2;
}

.carousel-title {
    font-size: 22px;
    font-weight: 600;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    margin-bottom: 4px;
}

.carousel-desc {
    font-size: 13px;
    opacity: 0.9;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.carousel-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    z-index: 3;
}

.carousel-arrow:hover {
    background: rgba(194, 12, 12, 0.8);
}

.carousel-arrow.prev {
    left: 12px;
}

.carousel-arrow.next {
    right: 12px;
}

.carousel-dots {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    z-index: 3;
}

.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.2s;
}

.dot.active {
    background: #c20c0c;
    width: 24px;
    border-radius: 4px;
}

/* 分类导航 */
.category-nav {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 10px;
    margin-bottom: 24px;
}

.category-card {
    background: #fff;
    border-radius: 8px;
    padding: 16px 8px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    color: #666;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.category-card:hover {
    color: #c20c0c;
    transform: translateY(-3px);
    box-shadow: 0 4px 16px rgba(194, 12, 12, 0.15);
}

.category-card span {
    font-size: 13px;
}

/* Section */
.section {
    margin-bottom: 28px;
}

.section-header {
    margin-bottom: 12px;
}

.section-title {
    margin: 0;
    font-size: 16px;
    color: #333;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 10px;
    border-left: 3px solid #c20c0c;
    font-weight: 600;
}

/* 横向滚动 */
.horizontal-scroll {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 8px;
}

.horizontal-scroll::-webkit-scrollbar {
    height: 6px;
}

.horizontal-scroll::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 3px;
}

.horizontal-scroll::-webkit-scrollbar-thumb:hover {
    background: #c20c0c;
}

/* 番剧卡片网格 */
.anime-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 16px 12px;
}

.anime-card {
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.anime-card.horizontal {
    flex: 0 0 120px;
}

.anime-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 16px rgba(194, 12, 12, 0.15);
    border: 1px solid #c20c0c;
}

.cover-wrapper {
    width: 100%;
    aspect-ratio: 3/4;
    background: #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.anime-card:hover .cover {
    transform: scale(1.05);
}

.cover-placeholder {
    color: #ddd;
}

.anime-info {
    padding: 6px 8px;
    text-align: center;
}

.anime-title {
    font-size: 13px;
    font-weight: 500;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 6px;
}

.anime-desc {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 6px 6px;
}

/* 排行榜 */
.ranking-list {
    background: #fff;
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.ranking-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;
}

.ranking-item:hover {
    background: rgba(194, 12, 12, 0.06);
}

.ranking-no {
    width: 28px;
    text-align: center;
    font-size: 16px;
    font-weight: 700;
    color: #999;
}

.ranking-no.top {
    color: #c20c0c;
}

.ranking-cover {
    width: 50px;
    height: 66px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
}

.ranking-cover-placeholder {
    width: 50px;
    height: 66px;
    background: #f0f0f0;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
    flex-shrink: 0;
}

.ranking-info {
    flex: 1;
    min-width: 0;
}

.ranking-title {
    font-size: 14px;
    color: #333;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ranking-desc {
    font-size: 12px;
    color: #999;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ===== 我的收藏按钮（线路一旁） ===== */
.fav-entry {
    margin-left: auto;
    margin-right: 8px;
}
.fav-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid rgba(194, 12, 12, .25);
    background: rgba(194, 12, 12, .06);
    color: #c20c0c;
    font-size: 13px;
    border-radius: 18px;
    cursor: pointer;
    transition: all .2s;
    position: relative;
}
.fav-toggle-btn:hover {
    background: rgba(194, 12, 12, .12);
    border-color: #c20c0c;
    transform: translateY(-1px);
}
.fav-toggle-btn.active {
    background: #c20c0c;
    color: #fff;
    border-color: #c20c0c;
}
.fav-badge {
    background: #c20c0c;
    color: #fff;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
    margin-left: 2px;
}
.fav-toggle-btn.active .fav-badge {
    background: #fff;
    color: #c20c0c;
}

/* ===== 收藏面板（侧滑） ===== */
.fav-panel {
    position: fixed;
    top: 60px;
    right: 0;
    bottom: 80px;
    width: 320px;
    background: #fff;
    box-shadow: -8px 0 32px rgba(0, 0, 0, .12);
    z-index: 50;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #eee;
}
.fav-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
}
.fav-panel-header h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #c20c0c;
}
.fav-count {
    background: rgba(194, 12, 12, .1);
    color: #c20c0c;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
    font-weight: 500;
}
.fav-close {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: #999;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all .15s;
}
.fav-close:hover { background: #f5f5f5; color: #c20c0c; }

.fav-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #ccc;
    text-align: center;
}
.fav-empty p { margin: 0; font-size: 14px; color: #999; }
.fav-empty small { font-size: 12px; color: #bbb; }

.fav-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
}
.fav-list::-webkit-scrollbar { width: 6px; }
.fav-list::-webkit-scrollbar-thumb { background: #eee; border-radius: 3px; }
.fav-list::-webkit-scrollbar-thumb:hover { background: #c20c0c; }

.fav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: background .15s;
}
.fav-item:hover { background: rgba(194, 12, 12, .06); }
.fav-cover {
    width: 44px;
    height: 60px;
    border-radius: 4px;
    overflow: hidden;
    background: #f5f5f5;
    flex-shrink: 0;
}
.fav-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.fav-cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #ccc;
}
.fav-info {
    flex: 1;
    min-width: 0;
}
.fav-title {
    font-size: 13px;
    font-weight: 500;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
}
.fav-date {
    font-size: 11px;
    color: #999;
}
.fav-remove {
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: #bbb;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all .15s;
    flex-shrink: 0;
}
.fav-remove:hover { background: rgba(194, 12, 12, .1); color: #c20c0c; }

/* 面板侧滑过渡 */
.fav-slide-enter-active, .fav-slide-leave-active {
    transition: transform .25s cubic-bezier(0.4, 0, 0.2, 1), opacity .25s;
}
.fav-slide-enter-from, .fav-slide-leave-to {
    transform: translateX(100%);
    opacity: 0;
}

/* 骨架屏 */
.skeleton-area {
    margin-top: 20px;
}

.skeleton-carousel {
    width: 100%;
    height: 280px;
    border-radius: 12px;
    background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    margin-bottom: 24px;
}

.skeleton-row {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
}

.skeleton-card {
    flex: 1;
    aspect-ratio: 3/4;
    border-radius: 8px;
    background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* 加载和空状态 */
.loading, .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 20px;
    color: #999;
}

.empty p {
    margin: 8px 0 0;
    font-size: 15px;
    color: #666;
}

.empty small {
    color: #bbb;
}

.spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* 搜索结果信息条 */
.results-info {
    font-size: 13px;
    color: #888;
    margin-bottom: 12px;
    padding-left: 2px;
}

/* 分页控件 */
.pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 28px;
    padding: 16px 0 8px;
}

.pagination .page-btn,
.pagination .page-num {
    border: 1px solid #e5e5e5;
    background: #fff;
    color: #555;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 36px;
    justify-content: center;
}

.pagination .page-btn:hover:not(:disabled),
.pagination .page-num:hover:not(.active) {
    border-color: #c20c0c;
    color: #c20c0c;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(194, 12, 12, 0.12);
}

.pagination .page-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    background: #f5f5f5;
}

.pagination .page-num.active {
    background: #c20c0c;
    border-color: #c20c0c;
    color: #fff;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(194, 12, 12, 0.3);
}

.pagination .page-ellipsis {
    color: #999;
    padding: 0 4px;
    user-select: none;
}
</style>
