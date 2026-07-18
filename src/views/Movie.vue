<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { movieHome, movieSearch } from '../api'
import { useMessageStore } from '../store/message'
import { Search, Loader2, Film, Tv, ChevronLeft, ChevronRight, Sparkles, Flame, TrendingUp, Clock } from 'lucide-vue-next'

const router = useRouter()
const messageStore = useMessageStore()

// ===== 源配置 =====
const sources = [
    { id: 'smdyu', label: '神马电影', desc: '主源·资源全' }
]
const currentSource = ref('smdyu')

// ===== 数据 =====
const homeData = ref({ latest: [], hot: [], ranking: [] })
const loading = ref(false)
const keyword = ref('')
const searchResultsRaw = ref([])
const searchMode = ref(false)
const searchLoading = ref(false)

// 搜索结果去重 + 过滤无封面项
const searchResults = computed(() => {
    const seen = new Map()
    for (const item of searchResultsRaw.value) {
        if (item.cover && !seen.has(item.id)) seen.set(item.id, item)
    }
    for (const item of searchResultsRaw.value) {
        if (!item.cover && !seen.has(item.id)) seen.set(item.id, item)
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
    const el = document.querySelector('.movie-page')
    if (el) el.scrollTop = 0
}
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
    { id: '动作', icon: Film },
    { id: '喜剧', icon: Film },
    { id: '爱情', icon: Film },
    { id: '科幻', icon: Film },
    { id: '悬疑', icon: Film },
    { id: '惊悚', icon: Film },
    { id: '恐怖', icon: Flame },
    { id: '剧情', icon: Film }
]
const goToCategory = (cat) => {
    router.push({ path: '/movie', query: { kw: cat } })
}

// ===== 数据加载 =====
const fetchHome = async () => {
    loading.value = true
    searchMode.value = false
    try {
        const res = await movieHome(currentSource.value)
        if (res?.success && res.data) {
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
    searchLoading.value = true
    searchMode.value = true
    try {
        const res = await movieSearch(currentSource.value, keyword.value)
        if (res?.success) {
            searchResultsRaw.value = res.data || []
            currentPage.value = 1
            if (searchResultsRaw.value.length === 0) {
                messageStore.warning('未找到相关电影')
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

const switchSource = (src) => {
    if (currentSource.value === src) return
    currentSource.value = src
    if (searchMode.value && keyword.value) {
        handleSearch()
    } else {
        fetchHome()
    }
}

const openDetail = (item) => {
    router.push(`/movie/${item.source || currentSource.value}/${item.id}`)
}

const exitSearch = () => {
    searchMode.value = false
    keyword.value = ''
    searchResultsRaw.value = []
}

import { useRoute } from 'vue-router'
const route = useRoute()
onMounted(() => {
    // 路由 query.kw 自动搜索（从分类导航进入）
    if (route.query.kw) {
        keyword.value = route.query.kw
        handleSearch()
    } else {
        fetchHome()
    }
})
onUnmounted(() => { stopCarousel() })
</script>

<template>
    <div class="movie-page anime-view">
        <!-- 页头 -->
        <div class="page-header">
            <h2 class="page-title">
                <Film :size="22" /> 电影 / 动漫 / 电视剧
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
        </div>

        <!-- 搜索栏 -->
        <div class="search-bar">
            <Search :size="16" class="search-icon" />
            <input
                v-model="keyword"
                :placeholder="`在 ${sources.find(s => s.id === currentSource)?.label} 搜索电影...`"
                @keyup.enter="handleSearch"
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
                    <p>未找到相关电影</p>
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
                                    v-if="item.cover"
                                    :src="item.cover"
                                    class="cover"
                                    loading="lazy"
                                    @error="$event.target.style.display='none'"
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
                        <img v-if="item.cover" :src="item.cover" class="carousel-img" @error="$event.target.style.display='none'" />
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
                                v-if="item.cover"
                                :src="item.cover"
                                class="cover"
                                loading="lazy"
                                @error="$event.target.style.display='none'"
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
                                v-if="item.cover"
                                :src="item.cover"
                                class="cover"
                                loading="lazy"
                                @error="$event.target.style.display='none'"
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
                            v-if="item.cover"
                            :src="item.cover"
                            class="ranking-cover"
                            loading="lazy"
                            @error="$event.target.style.display='none'"
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

<style>
@import './anime-common.css';
</style>
