<script setup>
import { ref, onMounted, watch } from 'vue'
import { getMvAll, cloudSearch } from '../api'
import { Play, Search, Loader2 } from 'lucide-vue-next'
import { usePlayerStore } from '../store/player'
import { useSearchHistoryStore } from '../store/searchHistory'
import SearchSuggest from '../components/SearchSuggest.vue'

const playerStore = usePlayerStore()
const searchHistoryStore = useSearchHistoryStore()

const mvs = ref([])
const activeArea = ref('全部')
const areas = ['全部', '内地', '港台', '欧美', '日本', '韩国']

// 搜索
const keyword = ref('')
const searchResults = ref([])
const searchMode = ref(false)
const searchLoading = ref(false)
const showSearchSuggest = ref(false)

const fetchMvs = async () => {
    try {
        const res = await getMvAll(activeArea.value, 12)
        mvs.value = res.data
    } catch (err) {
        console.error('Fetch MV error:', err)
    }
}

const handleSearch = async () => {
    if (!keyword.value.trim()) return
    searchHistoryStore.addHistory('video', keyword.value)
    showSearchSuggest.value = false
    searchLoading.value = true
    searchMode.value = true
    try {
        const res = await cloudSearch(keyword.value, 1004)
        // 网易云 type=1004 返回字段是 mvs，不是 videos
        searchResults.value = res?.result?.mvs || res?.mvs || []
    } catch (err) {
        console.error('Search MV error:', err)
        searchResults.value = []
    } finally {
        searchLoading.value = false
    }
}

const onSelectSuggest = (kw) => {
    keyword.value = kw
    handleSearch()
}
// "您可能再找"实时搜索结果点击：mv → 直接播放
const onSelectItem = (item) => {
    showSearchSuggest.value = false
    if (item?.type === 'mv' && item.id) {
        playMv(item.id)
    }
}
const onSearchFocus = () => { showSearchSuggest.value = true }
const onSearchBlur = () => { setTimeout(() => { showSearchSuggest.value = false }, 200) }

const exitSearch = () => {
    searchMode.value = false
    keyword.value = ''
    searchResults.value = []
}

const playMv = (id) => {
    playerStore.playMv(id)
}

const formatTime = (ms) => {
  if (!ms) return '00:00'
  const seconds = Math.floor(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// 格式化播放次数（搜索结果可能用 playTime 字段）
const formatPlayCount = (n) => {
    if (!n) return '0'
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return n.toString()
}

watch(activeArea, () => {
    if (!searchMode.value) fetchMvs()
})

onMounted(() => {
    fetchMvs()
})
</script>

<template>
  <div class="video-view">
    <!-- 搜索栏 -->
    <div class="mv-search-bar">
        <Search :size="16" class="search-icon" />
        <input
            v-model="keyword"
            placeholder="搜索 MV..."
            @keyup.enter="handleSearch"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
        />
        <SearchSuggest
            module="video"
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
        <button v-if="searchMode" class="back-btn" @click="exitSearch">返回</button>
    </div>

    <!-- 分类标签（非搜索模式显示） -->
    <div v-if="!searchMode" class="header-tabs">
        <span
            v-for="area in areas"
            :key="area"
            class="tab"
            :class="{ active: activeArea === area }"
            @click="activeArea = area"
        >
            {{ area === '全部' ? '全部MV' : area }}
        </span>
    </div>

    <!-- 搜索结果 -->
    <div v-if="searchMode" class="search-results-area">
        <div v-if="searchLoading" class="loading">
            <Loader2 :size="28" class="spin" /> 搜索中...
        </div>
        <div v-else-if="searchResults.length === 0" class="empty">
            <Play :size="48" />
            <p>未找到相关 MV</p>
        </div>
        <template v-else>
            <div class="results-info">共 {{ searchResults.length }} 个结果</div>
            <div class="video-grid">
                <div v-for="mv in searchResults" :key="mv.vid || mv.id" class="video-card" @click="playMv(mv.vid || mv.id)">
                    <div class="cover-wrapper">
                        <img :src="mv.cover || mv.imgurl || mv.coverUrl" class="cover" />
                        <div class="play-count" v-if="mv.playTime || mv.playCount">
                            <Play :size="12" fill="white" /> {{ formatPlayCount(mv.playTime || mv.playCount) }}
                        </div>
                        <div class="duration" v-if="mv.duration">{{ formatTime(mv.duration) }}</div>
                        <div class="play-overlay">
                            <Play :size="40" fill="white" color="white" />
                        </div>
                    </div>
                    <div class="title" :title="mv.name || mv.title">{{ mv.name || mv.title }}</div>
                    <div class="artist">{{ (mv.artists || mv.creator || []).map(c => c.name).join(' / ') }}</div>
                </div>
            </div>
        </template>
    </div>

    <!-- 默认 MV 列表 -->
    <div v-else>
        <div class="video-grid">
            <div v-for="mv in mvs" :key="mv.id" class="video-card" @click="playMv(mv.id)">
                <div class="cover-wrapper">
                    <img :src="mv.cover" class="cover" />
                    <div class="play-count">
                        <Play :size="12" fill="white" /> {{ (mv.playCount / 10000).toFixed(1) }}万
                    </div>
                    <div class="duration">{{ formatTime(mv.duration) }}</div>
                    <div class="play-overlay">
                        <Play :size="40" fill="white" color="white" />
                    </div>
                </div>
                <div class="title" :title="mv.name">{{ mv.name }}</div>
                <div class="artist">{{ mv.artistName }}</div>
            </div>
        </div>

        <div v-if="mvs.length === 0" class="loading">加载中...</div>
    </div>
  </div>
</template>

<style scoped>
.video-view {
  padding: 20px 30px;
  flex: 1;
  overflow-y: auto;
}

/* 搜索栏 */
.mv-search-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border-radius: 20px;
    padding: 8px 16px;
    margin-bottom: 20px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
}
.mv-search-bar .search-icon { color: #999; }
.mv-search-bar input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: #333;
}
.mv-search-bar .search-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    background: #c20c0c;
    color: #fff;
    border: none;
    border-radius: 16px;
    font-size: 13px;
    cursor: pointer;
    transition: background .2s;
}
.mv-search-bar .search-btn:hover { background: #a30a0a; }
.mv-search-bar .search-btn:disabled { background: #ccc; cursor: not-allowed; }
.mv-search-bar .back-btn {
    padding: 6px 14px;
    background: transparent;
    color: #666;
    border: 1px solid #ddd;
    border-radius: 16px;
    font-size: 13px;
    cursor: pointer;
    transition: all .2s;
}
.mv-search-bar .back-btn:hover { border-color: #c20c0c; color: #c20c0c; }

.header-tabs {
    display: flex;
    gap: 30px;
    margin-bottom: 25px;
    border-bottom: 1px solid #eee;
}

.tab {
    padding: 10px 0;
    cursor: pointer;
    font-size: 14px;
    color: #666;
    transition: all 0.2s;
}

.tab:hover {
    color: var(--primary-color);
}

.tab.active {
    color: #333;
    font-weight: bold;
    border-bottom: 3px solid var(--primary-color);
}

.video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 30px 20px;
}

.video-card {
    cursor: pointer;
}

.cover-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 10px;
    background-color: #f0f0f0;
}

.cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.video-card:hover .cover {
    transform: scale(1.05);
}

.play-count {
    position: absolute;
    top: 5px;
    right: 10px;
    color: white;
    font-size: 12px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 2;
}

.duration {
    position: absolute;
    bottom: 5px;
    right: 10px;
    color: white;
    font-size: 12px;
    z-index: 2;
}

.play-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s;
}

.video-card:hover .play-overlay {
    opacity: 1;
}

.title {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    color: #333;
}

.artist {
    font-size: 12px;
    color: #999;
}

.loading {
    text-align: center;
    padding: 50px;
    color: #999;
}

/* 搜索结果区 */
.search-results-area { min-height: 300px; }
.results-info {
    color: #666;
    font-size: 13px;
    margin-bottom: 16px;
}
.empty {
    text-align: center;
    padding: 60px;
    color: #999;
}
.empty p { margin: 12px 0 0; font-size: 14px; }
.spin { animation: mv-spin 1s linear infinite; }
@keyframes mv-spin { to { transform: rotate(360deg); } }
</style>
