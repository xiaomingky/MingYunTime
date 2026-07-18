<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { animeHome, animeSearch, animeMetaSearch } from '../api'
import { useAnimeStore } from '../store/anime'
import { useMessageStore } from '../store/message'
import { Sparkles, Star, Tag, Heart, Loader2, Film, Trash2, Calendar, ChevronLeft } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const messageStore = useMessageStore()
const animeStore = useAnimeStore()

function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/anime')
}

// ===== 源 =====
const sources = [
    { id: 'yhdm', label: '樱花动漫' }
]
const currentSource = ref('yhdm')

// ===== Tab =====
const tabs = [
    { id: 'season',   label: '季度新番', icon: Calendar },
    { id: 'ranking',  label: '评分榜',   icon: Star },
    { id: 'category', label: '类型筛选', icon: Tag },
    { id: 'fav',      label: '我的收藏', icon: Heart }
]
const activeTab = ref('season')

// ===== 季度切换 =====
function getRecentSeasons(n = 4) {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    let y = year, m = month
    const list = []
    for (let i = 0; i < n; i++) {
        const q = Math.ceil(m / 3)
        list.push({ id: `${y}-${q}`, label: `${y}年 Q${q}` })
        m -= 3
        if (m <= 0) { m += 12; y -= 1 }
    }
    return list
}
const seasons = getRecentSeasons(4)
const currentSeason = ref(seasons[0]?.id || '')

// ===== 数据 =====
const seasonList = ref([])
const seasonLoading = ref(false)

const rankingList = ref([])
const rankingLoading = ref(false)

const categories = ['番剧', '剧场版', 'OVA', '国产', '欧美', '恋爱', '热血', '校园', '搞笑', '科幻', '治愈', '冒险']
const currentCategory = ref('')
const categoryResults = ref([])
const categoryLoading = ref(false)

// ===== 评分缓存（避免同标题重复请求 Bangumi） =====
const metaCache = new Map()

async function fetchMeta(title) {
    if (!title) return null
    if (metaCache.has(title)) return metaCache.get(title)
    try {
        const res = await animeMetaSearch(title)
        if (res?.success && res.data) {
            metaCache.set(title, res.data)
            return res.data
        }
    } catch (e) { /* 忽略 */ }
    metaCache.set(title, null)
    return null
}

// 并发限流批量补全元信息
async function batchEnrich(items, limit = 3) {
    const queue = [...items]
    const results = []
    const workers = Array.from({ length: limit }, async () => {
        while (queue.length > 0) {
            const item = queue.shift()
            if (!item) continue
            const meta = await fetchMeta(item.title)
            results.push({
                ...item,
                bgmScore: meta?.score || 0,
                bgmSummary: meta?.summary || '',
                bgmCover: meta?.cover || '',
                bgmTags: meta?.tags?.slice(0, 3).map(t => t.name) || []
            })
        }
    })
    await Promise.all(workers)
    return results
}

// ===== Tab1 季度新番 =====
async function loadSeason() {
    seasonLoading.value = true
    try {
        const res = await animeHome(currentSource.value)
        if (res?.success && res.data) {
            // 去重（同 id 只保留第一个有封面的）
            const seen = new Set()
            const dedup = []
            for (const item of (res.data.latest || [])) {
                if (!seen.has(item.id)) { seen.add(item.id); dedup.push(item) }
            }
            // 批量补全元信息（限并发 3）
            const enriched = await batchEnrich(dedup.slice(0, 18), 3)
            seasonList.value = enriched
        } else {
            seasonList.value = []
            messageStore.error(res?.message || '加载失败')
        }
    } catch (e) {
        seasonList.value = []
        messageStore.error('加载失败: ' + e.message)
    } finally {
        seasonLoading.value = false
    }
}

// ===== Tab2 评分榜 =====
async function loadRanking() {
    rankingLoading.value = true
    try {
        const res = await animeHome(currentSource.value)
        if (res?.success && res.data) {
            const merged = [...(res.data.ranking || []), ...(res.data.latest || [])]
            // 去重
            const seen = new Set()
            const dedup = []
            for (const item of merged) {
                const key = `${item.source}_${item.id}`
                if (!seen.has(key)) { seen.add(key); dedup.push(item) }
            }
            const enriched = await batchEnrich(dedup.slice(0, 30), 3)
            // 按评分降序
            enriched.sort((a, b) => (b.bgmScore || 0) - (a.bgmScore || 0))
            rankingList.value = enriched.slice(0, 50)
        } else {
            rankingList.value = []
        }
    } catch (e) {
        rankingList.value = []
    } finally {
        rankingLoading.value = false
    }
}

// ===== Tab3 类型筛选 =====
async function loadCategory(cat) {
    currentCategory.value = cat
    if (!cat) { categoryResults.value = []; return }
    categoryLoading.value = true
    try {
        const res = await animeSearch(currentSource.value, cat)
        if (res?.success) {
            // 去重（同 id 只保留第一个）
            const seen = new Set()
            const dedup = []
            for (const item of (res.data || [])) {
                if (!seen.has(item.id)) { seen.add(item.id); dedup.push(item) }
            }
            categoryResults.value = dedup
            if (categoryResults.value.length === 0) {
                messageStore.warning(`未找到"${cat}"类型动漫`)
            }
        } else {
            categoryResults.value = []
            messageStore.error(res?.message || '筛选失败')
        }
    } catch (e) {
        categoryResults.value = []
        messageStore.error('筛选失败: ' + e.message)
    } finally {
        categoryLoading.value = false
    }
}

// ===== Tab4 我的收藏 =====
const favorites = computed(() => animeStore.favorites)

const removeFav = (item) => {
    animeStore.removeFavorite(item.source, item.id)
    messageStore.success('已取消收藏')
}

// ===== 切 Tab =====
const switchTab = (tab) => {
    activeTab.value = tab
    if (tab === 'season' && seasonList.value.length === 0) loadSeason()
    else if (tab === 'ranking' && rankingList.value.length === 0) loadRanking()
    else if (tab === 'fav') { /* 实时读取 store，无需加载 */ }
}

// ===== 切源 =====
const switchSource = (src) => {
    if (currentSource.value === src) return
    currentSource.value = src
    animeStore.setSource(src)
    // 重置所有数据
    seasonList.value = []
    rankingList.value = []
    categoryResults.value = []
    metaCache.clear()
    // 重新加载当前 Tab
    if (activeTab.value === 'season') loadSeason()
    else if (activeTab.value === 'ranking') loadRanking()
    else if (activeTab.value === 'category' && currentCategory.value) loadCategory(currentCategory.value)
}

const openDetail = (item) => {
    router.push(`/anime/${item.source || currentSource.value}/${item.id}`)
}

const openRelated = (related) => {
    // Bangumi 关联作品跳转到动漫主页搜索
    router.push({ path: '/anime', query: { kw: related.name_cn || related.name } })
}

const formatScore = (s) => s ? s.toFixed(1) : '—'

onMounted(() => {
    // 路由 query.type 自动切到类型筛选 Tab
    if (route.query.type) {
        activeTab.value = 'category'
        loadCategory(route.query.type)
    } else {
        loadSeason()
    }
})

// 监听路由 query.type 变化
watch(() => route.query.type, (t) => {
    if (t) {
        activeTab.value = 'category'
        loadCategory(t)
    }
})
</script>

<template>
    <div class="anime-recommend">
        <!-- 页头 -->
        <div class="page-header">
            <div class="header-left">
                <button class="back-btn" @click="goBack" title="返回">
                    <ChevronLeft :size="20" />
                </button>
                <h2 class="page-title">
                    <Sparkles :size="22" /> 动漫推荐
                </h2>
            </div>
            <div v-if="sources.length > 1" class="source-tabs">
                <button
                    v-for="s in sources"
                    :key="s.id"
                    class="source-tab"
                    :class="{ active: currentSource === s.id }"
                    @click="switchSource(s.id)"
                >{{ s.label }}</button>
            </div>
        </div>

        <!-- Tab 切换 -->
        <div class="tab-bar">
            <button
                v-for="t in tabs"
                :key="t.id"
                class="tab-btn"
                :class="{ active: activeTab === t.id }"
                @click="switchTab(t.id)"
            >
                <component :is="t.icon" :size="16" />
                <span>{{ t.label }}</span>
                <span v-if="t.id === 'fav' && favorites.length > 0" class="badge">{{ favorites.length }}</span>
            </button>
        </div>

        <!-- Tab1 季度新番 -->
        <div v-if="activeTab === 'season'" class="tab-content">
            <div class="season-bar">
                <Calendar :size="16" />
                <select v-model="currentSeason" class="season-select">
                    <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.label }}</option>
                </select>
                <span class="season-tip">数据来自当前源最新更新</span>
            </div>
            <div v-if="seasonLoading" class="loading">
                <Loader2 :size="28" class="spin" /> 加载中...
            </div>
            <div v-else-if="seasonList.length === 0" class="empty">
                <Film :size="48" />
                <p>暂无数据</p>
            </div>
            <div v-else class="anime-grid">
                <div
                    v-for="item in seasonList"
                    :key="`s-${item.source}-${item.id}`"
                    class="anime-card"
                    @click="openDetail(item)"
                >
                    <div class="cover-wrapper">
                        <img
                            v-if="item.bgmCover || item.cover"
                            :src="item.bgmCover || item.cover"
                            class="cover"
                            loading="lazy"
                            @error="$event.target.style.display='none'"
                        />
                        <div v-else class="cover-placeholder"><Film :size="32" /></div>
                        <div v-if="item.bgmScore" class="score-badge">
                            <Star :size="10" /> {{ formatScore(item.bgmScore) }}
                        </div>
                    </div>
                    <div class="anime-info">
                        <div class="anime-title" :title="item.title">{{ item.title }}</div>
                        <div v-if="item.bgmTags && item.bgmTags.length" class="anime-tags">
                            <span v-for="t in item.bgmTags" :key="t" class="tag">{{ t }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab2 评分榜 -->
        <div v-else-if="activeTab === 'ranking'" class="tab-content">
            <div v-if="rankingLoading" class="loading">
                <Loader2 :size="28" class="spin" /> 评分数据加载中...
            </div>
            <div v-else-if="rankingList.length === 0" class="empty">
                <Star :size="48" />
                <p>暂无评分数据</p>
            </div>
            <div v-else class="ranking-list">
                <div
                    v-for="(item, idx) in rankingList"
                    :key="`r-${item.source}-${item.id}`"
                    class="ranking-item"
                    :class="{ top: idx < 3 }"
                    @click="openDetail(item)"
                >
                    <div class="rank-num" :class="`rank-${idx + 1}`">{{ idx + 1 }}</div>
                    <img
                        v-if="item.bgmCover || item.cover"
                        :src="item.bgmCover || item.cover"
                        class="rank-cover"
                        loading="lazy"
                        @error="$event.target.style.display='none'"
                    />
                    <div v-else class="rank-cover-placeholder"><Film :size="20" /></div>
                    <div class="rank-info">
                        <div class="rank-title">{{ item.title }}</div>
                        <div v-if="item.bgmSummary" class="rank-summary">{{ item.bgmSummary.slice(0, 80) }}...</div>
                        <div v-if="item.bgmTags && item.bgmTags.length" class="anime-tags">
                            <span v-for="t in item.bgmTags" :key="t" class="tag">{{ t }}</span>
                        </div>
                    </div>
                    <div v-if="item.bgmScore" class="rank-score">
                        <Star :size="14" />
                        <span>{{ formatScore(item.bgmScore) }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab3 类型筛选 -->
        <div v-else-if="activeTab === 'category'" class="tab-content">
            <div class="category-cloud">
                <button
                    v-for="cat in categories"
                    :key="cat"
                    class="cat-tag"
                    :class="{ active: currentCategory === cat }"
                    @click="loadCategory(cat)"
                >{{ cat }}</button>
            </div>
            <div v-if="categoryLoading" class="loading">
                <Loader2 :size="28" class="spin" /> 筛选中...
            </div>
            <div v-else-if="categoryResults.length === 0" class="empty">
                <Tag :size="48" />
                <p>{{ currentCategory ? `未找到"${currentCategory}"类型动漫` : '请选择类型' }}</p>
            </div>
            <div v-else class="anime-grid">
                <div
                    v-for="item in categoryResults"
                    :key="`c-${item.source}-${item.id}`"
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
                        <div v-else class="cover-placeholder"><Film :size="32" /></div>
                    </div>
                    <div class="anime-info">
                        <div class="anime-title" :title="item.title">{{ item.title }}</div>
                        <div v-if="item.desc" class="anime-desc">{{ item.desc }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab4 我的收藏 -->
        <div v-else-if="activeTab === 'fav'" class="tab-content">
            <div v-if="favorites.length === 0" class="empty">
                <Heart :size="48" />
                <p>还没有收藏动漫</p>
                <small>在详情页点击收藏即可</small>
            </div>
            <div v-else class="anime-grid">
                <div
                    v-for="item in favorites"
                    :key="`f-${item.source}-${item.id}`"
                    class="anime-card fav-card"
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
                        <div v-else class="cover-placeholder"><Film :size="32" /></div>
                        <button class="fav-remove" @click.stop="removeFav(item)" title="取消收藏">
                            <Trash2 :size="14" />
                        </button>
                    </div>
                    <div class="anime-info">
                        <div class="anime-title" :title="item.title">{{ item.title }}</div>
                        <div class="anime-desc">收藏于 {{ new Date(item.addedAt).toLocaleDateString() }}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.anime-recommend {
    height: 100%;
    box-sizing: border-box;
    padding: 20px 28px;
    overflow-y: auto;
    color: #333;
}

.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    color: #555;
    border-radius: 50%;
    cursor: pointer;
    transition: all .2s;
}

.back-btn:hover { background: #f5f5f5; color: #c20c0c; }

/* 让滚动条更细 */
.anime-recommend::-webkit-scrollbar { width: 6px; }
.anime-recommend::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
.anime-recommend::-webkit-scrollbar-thumb:hover { background: #c20c0c; }

.page-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 22px;
    font-weight: 600;
    color: #c20c0c;
    margin: 0;
}

.source-tabs {
    display: flex;
    gap: 4px;
    background: #f5f5f5;
    border-radius: 8px;
    padding: 3px;
}

.source-tab {
    padding: 6px 14px;
    border: none;
    background: transparent;
    color: #666;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    transition: all .2s;
}

.source-tab:hover { color: #c20c0c; }
.source-tab.active {
    background: #c20c0c;
    color: #fff;
}

.tab-bar {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid #eee;
    margin-bottom: 20px;
}

.tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border: none;
    background: transparent;
    color: #666;
    font-size: 14px;
    cursor: pointer;
    position: relative;
    transition: color .2s;
}

.tab-btn:hover { color: #c20c0c; }

.tab-btn.active {
    color: #c20c0c;
    font-weight: 600;
}

.tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: #c20c0c;
}

.badge {
    background: #c20c0c;
    color: #fff;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
}

.tab-content { min-height: 400px; }

.season-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    color: #666;
}

.season-select {
    padding: 5px 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    font-size: 13px;
    color: #333;
    cursor: pointer;
}

.season-tip {
    font-size: 12px;
    color: #999;
}

.loading, .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
    color: #999;
    gap: 10px;
}

.empty small { color: #bbb; font-size: 12px; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.anime-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
}

.anime-card {
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: all .25s cubic-bezier(.4, 0, .2, 1);
    box-shadow: 0 2px 8px rgba(0,0,0,.05);
    border: 1px solid #f0f0f0;
}

.anime-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 20px rgba(194, 12, 12, .15);
    border-color: #c20c0c;
}

.cover-wrapper {
    position: relative;
    aspect-ratio: 3/4;
    background: #f5f5f5;
    overflow: hidden;
}

.cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #ccc;
}

.score-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(194, 12, 12, .92);
    color: #fff;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 2px;
    font-weight: 600;
}

.anime-info {
    padding: 8px 10px 10px;
}

.anime-title {
    font-size: 13px;
    font-weight: 600;
    color: #333;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    min-height: 36px;
}

.anime-desc {
    font-size: 11px;
    color: #999;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.anime-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}

.tag {
    font-size: 10px;
    color: #c20c0c;
    background: rgba(194, 12, 12, .08);
    padding: 1px 6px;
    border-radius: 3px;
}

/* ===== 评分榜 ===== */
.ranking-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ranking-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    background: #fff;
    border-radius: 8px;
    cursor: pointer;
    transition: all .2s;
    border: 1px solid #f0f0f0;
}

.ranking-item:hover {
    transform: translateX(4px);
    border-color: #c20c0c;
    box-shadow: 0 4px 12px rgba(194, 12, 12, .1);
}

.ranking-item.top {
    background: linear-gradient(90deg, rgba(194, 12, 12, .04), transparent);
}

.rank-num {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: #999;
    background: #f5f5f5;
    border-radius: 50%;
    flex-shrink: 0;
}

.rank-1 { background: #c20c0c; color: #fff; }
.rank-2 { background: #ff6b6b; color: #fff; }
.rank-3 { background: #ffa502; color: #fff; }

.rank-cover {
    width: 50px;
    height: 65px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
}

.rank-cover-placeholder {
    width: 50px;
    height: 65px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    color: #ccc;
    border-radius: 4px;
    flex-shrink: 0;
}

.rank-info {
    flex: 1;
    min-width: 0;
}

.rank-title {
    font-size: 14px;
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rank-summary {
    font-size: 12px;
    color: #888;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.rank-score {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #c20c0c;
    font-size: 16px;
    font-weight: 700;
    flex-shrink: 0;
}

/* ===== 类型筛选 ===== */
.category-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
}

.cat-tag {
    padding: 6px 16px;
    border: 1px solid #ddd;
    background: #fff;
    color: #555;
    font-size: 13px;
    border-radius: 18px;
    cursor: pointer;
    transition: all .2s;
}

.cat-tag:hover {
    border-color: #c20c0c;
    color: #c20c0c;
}

.cat-tag.active {
    background: #c20c0c;
    color: #fff;
    border-color: #c20c0c;
}

/* ===== 收藏 ===== */
.fav-card { position: relative; }

.fav-remove {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0, 0, 0, .6);
    color: #fff;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity .2s;
    z-index: 2;
}

.fav-card:hover .fav-remove { opacity: 1; }
.fav-remove:hover { background: #c20c0c; }
</style>
