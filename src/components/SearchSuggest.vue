<script setup>
// 搜索建议下拉组件（搜索历史 + 相似推荐 + 您可能再找 + TOP 热度榜）
// 供全局搜索栏和各页面搜索框共用
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Search, Clock, Trash2, Flame, X, ArrowUpRight, TrendingUp, Loader2 } from 'lucide-vue-next'
import { useSearchHistoryStore } from '../store/searchHistory'
import { usePlatformStore } from '../store/platform'
import { cloudSearch, animeSearch, movieSearch, biliVideoSearch } from '../api'
import { qqSearch, normalizeQQSong } from '../api/qq'
import { kugouSearch, normalizeKugouSong } from '../api/kugou'

const props = defineProps({
    module: { type: String, required: true }, // music | anime | movie | video
    query: { type: String, default: '' },     // 当前输入
    visible: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'clear-history', 'remove-item', 'select-item'])

const historyStore = useSearchHistoryStore()
const platformStore = usePlatformStore()

// 音乐模块按当前平台细分历史(music-netease/music-kugou/music-qq),互不干扰
const historyModule = computed(() =>
    props.module === 'music' ? `music-${platformStore.current}` : props.module
)

const history = computed(() => historyStore.getHistory(historyModule.value))
const suggestions = computed(() => historyStore.getSuggestions(historyModule.value, props.query))
const hotKeywords = computed(() => historyStore.getHotKeywords(historyModule.value))

// ===== 您可能再找：实时搜索结果（输入时触发，300ms 防抖） =====
const liveResults = ref([])        // 实时搜索结果列表
const liveLoading = ref(false)     // 加载中状态
let liveSearchTimer = null

async function doLiveSearch(kw) {
    if (!kw || !kw.trim()) {
        liveResults.value = []
        return
    }
    liveLoading.value = true
    try {
        const module = props.module
        if (module === 'music') {
            // 根据当前平台调用相应的搜索 API
            if (platformStore.isQQ) {
                // QQ 音乐：catZhida=0 表示搜索歌曲
                const res = await qqSearch(kw, 6, 1, 0)
                const data = res?.data || res
                const list = data?.list || data?.song?.list || data?.songlist?.list || []
                const songs = (Array.isArray(list) ? list : []).map(normalizeQQSong).filter(Boolean)
                liveResults.value = songs.slice(0, 6).map(s => ({
                    id: s.id,
                    name: s.name,
                    sub: s.artist || '',
                    cover: s.picUrl || '',
                    type: 'song'
                }))
            } else if (platformStore.isKugou) {
                // 酷狗：type=song 搜索单曲
                const res = await kugouSearch(kw, 1, 6, 'song')
                const list = res?.data?.lists || res?.data?.info || res?.data?.list || []
                const songs = (Array.isArray(list) ? list : []).map(normalizeKugouSong).filter(Boolean)
                liveResults.value = songs.slice(0, 6).map(s => ({
                    id: s.id,
                    name: s.name,
                    sub: s.artist || '',
                    cover: s.picUrl || '',
                    type: 'song'
                }))
            } else {
                // 网易云：type=1 单曲
                const res = await cloudSearch(kw, 1)
                const songs = res?.result?.songs || res?.songs || []
                liveResults.value = songs.slice(0, 6).map(s => ({
                    id: s.id,
                    name: s.name,
                    sub: (s.ar || s.artists || []).map(a => a.name).join(' / '),
                    cover: s.al?.picUrl || s.album?.picUrl || '',
                    type: 'song'
                }))
            }
        } else if (module === 'video') {
            // type=1004 MV
            const res = await cloudSearch(kw, 1004)
            const mvs = res?.result?.mvs || res?.mvs || []
            liveResults.value = mvs.slice(0, 6).map(m => ({
                id: m.id,
                name: m.name,
                sub: (m.artists || []).map(a => a.name).join(' / '),
                cover: m.cover || m.imgurl || '',
                type: 'mv'
            }))
        } else if (module === 'anime') {
            // 动漫搜索：用默认线路 yhf。返回 { success, data: [...] }
            const res = await animeSearch('yhf', kw)
            const list = Array.isArray(res?.data) ? res.data : (res?.data?.list || res?.list || [])
            liveResults.value = list.slice(0, 6).map(a => ({
                id: a.id,
                source: a.source || 'yhf',
                name: a.title,
                sub: a.tags || a.desc || '',
                cover: a.cover || '',
                type: 'anime'
            }))
        } else if (module === 'movie') {
            // 影视搜索。返回 { success, data: [...] }
            const res = await movieSearch('smdyu', kw)
            const list = Array.isArray(res?.data) ? res.data : (res?.data?.list || res?.list || [])
            liveResults.value = list.slice(0, 6).map(m => ({
                id: m.id,
                source: m.source || 'smdyu',
                name: m.title,
                sub: m.tags || m.desc || '',
                cover: m.cover || '',
                type: 'movie'
            }))
        } else if (module === 'bilibili-video') {
            // B站视频专区实时搜索。返回 { success, data: { list: [...] } }
            const res = await biliVideoSearch({ keyword: kw, page: 1 })
            const list = Array.isArray(res?.data?.list) ? res.data.list : []
            liveResults.value = list.slice(0, 6).map(v => ({
                id: v.bvid,
                bvid: v.bvid,
                name: v.title,
                sub: v.author || '',
                cover: v.cover || '',
                type: 'bilibili-video'
            }))
        }
    } catch (e) {
        console.error('[SearchSuggest] 实时搜索失败:', props.module, kw, e?.message || e)
        liveResults.value = []
    } finally {
        liveLoading.value = false
    }
}

// 监听输入变化，防抖触发实时搜索（immediate 让初次显示时也能触发）
watch(() => props.query, (newQ) => {
    if (liveSearchTimer) clearTimeout(liveSearchTimer)
    const q = (newQ || '').trim()
    if (!q) {
        liveResults.value = []
        liveLoading.value = false
        return
    }
    liveSearchTimer = setTimeout(() => doLiveSearch(q), 350)
}, { immediate: true })

// 组件卸载时清理
onBeforeUnmount(() => {
    if (liveSearchTimer) clearTimeout(liveSearchTimer)
})

// 区分「有输入时显示相似推荐 + 您可能再找」和「无输入时显示历史+热门」
const showSuggestions = computed(() => props.query.trim().length > 0 && suggestions.value.length > 0)
const showLiveResults = computed(() => props.query.trim().length > 0)
const showHistory = computed(() => props.query.trim().length === 0 && history.value.length > 0)
const showHot = computed(() => props.query.trim().length === 0)

function selectKeyword(kw) {
    emit('select', kw)
}

function selectLiveItem(item) {
    emit('select-item', item)
}

function removeItem(kw, e) {
    e.stopPropagation()
    historyStore.removeHistory(historyModule.value, kw)
}

function clearAll() {
    historyStore.clearHistory(historyModule.value)
    emit('clear-history')
}
</script>

<template>
    <transition name="suggest-fade">
        <div v-if="visible" class="search-suggest">
            <!-- 您可能再找：实时搜索结果（有输入时） -->
            <div v-if="showLiveResults" class="suggest-section">
                <div class="section-title">
                    <TrendingUp :size="12" /> 您可能再找
                    <Loader2 v-if="liveLoading" :size="12" class="spin" />
                </div>
                <div v-if="liveResults.length === 0 && !liveLoading" class="live-empty">
                    暂无相关结果
                </div>
                <div v-else class="live-list">
                    <div
                        v-for="item in liveResults"
                        :key="item.type + '-' + item.id"
                        class="live-item"
                        @mousedown.prevent="selectLiveItem(item)"
                    >
                        <div class="live-cover" v-if="item.cover">
                            <img :src="item.cover" referrerpolicy="no-referrer" @error="$event.target.style.display='none'" />
                        </div>
                        <div class="live-cover placeholder" v-else>
                            <Search :size="14" />
                        </div>
                        <div class="live-info">
                            <div class="live-name">{{ item.name }}</div>
                            <div class="live-sub" v-if="item.sub">{{ item.sub }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 相似推荐（有输入时） -->
            <div v-if="showSuggestions" class="suggest-section">
                <div class="section-title">
                    <Search :size="12" /> 相似推荐
                </div>
                <div class="suggest-list">
                    <div
                        v-for="kw in suggestions"
                        :key="'sug-' + kw"
                        class="suggest-item"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <ArrowUpRight :size="14" class="item-icon" />
                        <span class="item-text">{{ kw }}</span>
                    </div>
                </div>
            </div>

            <!-- 搜索历史（无输入时） -->
            <div v-if="showHistory" class="suggest-section">
                <div class="section-title">
                    <Clock :size="12" /> 搜索历史
                    <span class="clear-btn" @click="clearAll" title="清空历史">
                        <Trash2 :size="12" /> 清空
                    </span>
                </div>
                <div class="history-tags">
                    <div
                        v-for="kw in history"
                        :key="'his-' + kw"
                        class="history-tag"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <span class="tag-text">{{ kw }}</span>
                        <span
                            class="tag-remove"
                            @click="removeItem(kw, $event)"
                            @mousedown.stop.prevent
                            title="删除"
                        >
                            <X :size="10" />
                        </span>
                    </div>
                </div>
            </div>

            <!-- TOP 热度榜（无输入时） -->
            <div v-if="showHot" class="suggest-section">
                <div class="section-title">
                    <Flame :size="12" /> TOP 热度榜
                </div>
                <div class="hot-list">
                    <div
                        v-for="(kw, idx) in hotKeywords"
                        :key="'hot-' + kw"
                        class="hot-item"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <span class="hot-rank" :class="{ top: idx < 3 }">{{ idx + 1 }}</span>
                        <span class="hot-text">{{ kw }}</span>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<style scoped>
.search-suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 6px;
    background: rgba(255, 255, 255, .98);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(0, 0, 0, .08);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, .15);
    z-index: 1000;
    min-width: 360px;
    max-height: 520px;
    overflow-y: auto;
    padding: 10px 0;
}

.suggest-section {
    padding: 6px 0;
    border-bottom: 1px solid rgba(0, 0, 0, .05);
}
.suggest-section:last-child { border-bottom: none; }

.section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    font-size: 11px;
    color: #999;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
}
.clear-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 3px;
    color: #999;
    cursor: pointer;
    font-size: 11px;
    font-weight: 400;
    transition: color .15s;
}
.clear-btn:hover { color: #c20c0c; }

/* 相似推荐列表 */
.suggest-list { padding: 2px 6px; }
.suggest-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 6px;
    transition: background .15s;
}
.suggest-item:hover { background: rgba(194, 12, 12, .08); }
.suggest-item .item-icon { color: #c20c0c; flex-shrink: 0; }
.suggest-item .item-text {
    color: #333;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 您可能再找 - 实时搜索结果 */
.live-list { padding: 2px 6px; }
.live-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 6px;
    transition: background .15s;
}
.live-item:hover { background: rgba(194, 12, 12, .08); }
.live-cover {
    width: 36px; height: 36px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    background: #f5f5f5;
}
.live-cover img {
    width: 100%; height: 100%;
    object-fit: cover;
}
.live-cover.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
}
.live-info {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}
.live-name {
    font-size: 13px;
    color: #333;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.live-sub {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.live-empty {
    padding: 16px;
    text-align: center;
    color: #999;
    font-size: 12px;
}
.spin { animation: suggest-spin 1s linear infinite; }
@keyframes suggest-spin { to { transform: rotate(360deg); } }

/* 历史标签 */
.history-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 14px;
    max-height: 180px;
    overflow-y: auto;
}
.history-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px 5px 12px;
    background: rgba(0, 0, 0, .05);
    border-radius: 14px;
    cursor: pointer;
    transition: all .15s;
    max-width: 240px;
}
.history-tag:hover { background: rgba(194, 12, 12, .12); }
.tag-text {
    font-size: 12px;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tag-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    color: #999;
    transition: all .15s;
}
.tag-remove:hover {
    background: #c20c0c;
    color: #fff;
}

/* 热门列表 */
.hot-list {
    padding: 2px 6px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px 12px;
}
.hot-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 6px;
    transition: background .15s;
}
.hot-item:hover { background: rgba(194, 12, 12, .08); }
.hot-rank {
    width: 18px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    color: #999;
    font-style: italic;
}
.hot-rank.top { color: #c20c0c; }
.hot-text {
    font-size: 13px;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 空状态 */
.suggest-empty {
    padding: 16px;
    text-align: center;
    color: #999;
    font-size: 12px;
}

/* 滚动条 */
.search-suggest::-webkit-scrollbar { width: 6px; }
.search-suggest::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, .15);
    border-radius: 3px;
}
.search-suggest::-webkit-scrollbar-thumb:hover { background: rgba(194, 12, 12, .4); }

/* 过渡 */
.suggest-fade-enter-active, .suggest-fade-leave-active {
    transition: opacity .2s, transform .2s;
}
.suggest-fade-enter-from, .suggest-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}

/* 响应式 */
@media (max-width: 640px) {
    .hot-list { grid-template-columns: 1fr; }
}
</style>
