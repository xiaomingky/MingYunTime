<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { getKugouCookie, getKugouUserid } from '../../api/kugou'
import {
    kugouSearch, kugouSearchHot, kugouSearchSuggest,
    normalizeKugouSong, normalizeKugouPlaylist, normalizeKugouAlbum, normalizeKugouSinger, toKugouTrack,
    flattenKugouSingerList
} from '../../api/kugou'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const keywords = ref(route.query.keywords || '')
const localInput = ref(route.query.keywords || '')
const activeTab = ref('song') // song | playlist | singer | album | mv
const loading = ref(false)
const songs = ref([])
const playlists = ref([])
const singers = ref([])
const albums = ref([])
const page = ref(1)
const total = ref(0)
const loadingMore = ref(false)
const needLogin = ref(false) // 搜索接口需要登录 token

const tabs = [
    { key: 'song', label: '歌曲' },
    { key: 'playlist', label: '歌单' },
    { key: 'singer', label: '歌手' },
    { key: 'album', label: '专辑' }
]

// 热搜词
// 实测 /search/hot 返回 { status:1, data: { list: [ { name, keywords: [{keyword, reason}, ...] } ] } }
const hotKeys = ref([])
const fetchHotKeys = async () => {
    try {
        const res = await kugouSearchHot()
        const list = res?.data?.list || []
        // 取第一个分组（热搜榜）的 keywords 数组
        const keywordsArr = (Array.isArray(list) ? list : []).flatMap(g => g?.keywords || [])
        hotKeys.value = keywordsArr.map(k => k.keyword || k.reason || '').filter(Boolean).slice(0, 30)
    } catch (e) {
        console.error('[Kugou Hotkey] error:', e)
    }
}

// 搜索联想
// 实测 /search/suggest 返回 { status:1, data: [ { RecordDatas: [{HintInfo, ...}, ...] } ] }
const suggests = ref([])
let suggestTimer = null
const fetchSuggests = (val) => {
    if (suggestTimer) clearTimeout(suggestTimer)
    if (!val || !val.trim()) {
        suggests.value = []
        return
    }
    suggestTimer = setTimeout(async () => {
        try {
            const res = await kugouSearchSuggest(val.trim())
            const dataArr = Array.isArray(res?.data) ? res.data : []
            // 扁平化 RecordDatas 数组，取 HintInfo 字段
            const hints = dataArr.flatMap(d => d?.RecordDatas || []).map(r => r.HintInfo || r.hintInfo || '').filter(Boolean)
            suggests.value = hints.slice(0, 8)
        } catch (e) {
            suggests.value = []
        }
    }, 250)
}

const showSuggest = ref(false)
const onInputFocus = () => { showSuggest.value = true }
const onInputBlur = () => { setTimeout(() => { showSuggest.value = false }, 200) }
const pickSuggest = (text) => {
    localInput.value = text
    keywords.value = text
    suggests.value = []
    showSuggest.value = false
    doSearch()
}

// 当前 tab 已加载数量（用于判断是否还有更多）
const currentCount = computed(() => {
    if (activeTab.value === 'song') return songs.value.length
    if (activeTab.value === 'playlist') return playlists.value.length
    if (activeTab.value === 'singer') return singers.value.length
    if (activeTab.value === 'album') return albums.value.length
    return 0
})
// 是否还有更多可加载
const hasMore = computed(() => total.value > 0 && currentCount.value < total.value)

// 通用分页拉取（targetPage 为目标页码，append 为 true 时追加到现有列表）
const fetchSearchResults = async (targetPage, append) => {
    // 文档：/search 接口支持 type 参数按分类搜索，每页 pagesize=30
    // /search/complex 是综合搜索,每类只返回少量结果(约7条),不适合按 tab 浏览
    // 改用 /search?type=song|special|author|album|mv 获取对应分类的完整结果
    // 拦截器自动附加 cookie=token=xxx;userid=xxx;dfid=xxx
    const typeMap = {
        song: 'song',
        playlist: 'special',
        singer: 'author',
        album: 'album'
    }
    const searchType = typeMap[activeTab.value] || 'song'
    const res = await kugouSearch(keywords.value.trim(), targetPage, 30, searchType)
    // error_code 152 = 未携带认证信息或 token 失效
    const errCode = res?.error_code || res?.ErrorCode || 0
    if (errCode === 152) {
        needLogin.value = true
        return { count: 0, total: 0 }
    }
    // /search 响应结构(实测)：
    //   歌曲(/v3/search/song): { status:1, data: { total, lists:[...] } }  ← 字段名是 lists
    //   歌单/歌手/专辑(/v1/search/{type}): { status:1, data: { total, info:[...] } }  ← 字段名是 info
    // 同时兼容 lists 和 info 两种字段名
    const list = res?.data?.lists || res?.data?.info || res?.data?.list || []
    const newTotal = res?.data?.total || 0

    if (activeTab.value === 'song') {
        const normalized = (Array.isArray(list) ? list : []).map(normalizeKugouSong).filter(Boolean)
        if (append) songs.value.push(...normalized)
        else songs.value = normalized
    } else if (activeTab.value === 'playlist') {
        const normalized = (Array.isArray(list) ? list : []).map(p => normalizeKugouPlaylist(p)).filter(p => p.id)
        if (append) playlists.value.push(...normalized)
        else playlists.value = normalized
    } else if (activeTab.value === 'singer') {
        // 歌手搜索可能返回分组结构 data.info[].singer[] 或扁平结构 data.info[]
        // 先尝试扁平化（如果返回分组结构），如果扁平化后为空则用原始 list
        const flatSingers = flattenKugouSingerList(res?.data)
        const singerList = flatSingers.length > 0 ? flatSingers : (Array.isArray(list) ? list : [])
        const normalized = singerList.map(normalizeKugouSinger).filter(s => s.id)
        if (append) singers.value.push(...normalized)
        else singers.value = normalized
    } else if (activeTab.value === 'album') {
        const normalized = (Array.isArray(list) ? list : []).map(normalizeKugouAlbum).filter(a => a.id)
        if (append) albums.value.push(...normalized)
        else albums.value = normalized
    }
    return { count: Array.isArray(list) ? list.length : 0, total: newTotal }
}

const doSearch = async () => {
    const kw = keywords.value.trim()
    if (!kw) return
    router.replace({ path: '/kugou/search', query: { keywords: kw } })
    loading.value = true
    needLogin.value = false
    page.value = 1
    total.value = 0
    songs.value = []; playlists.value = []; singers.value = []; albums.value = []
    try {
        const result = await fetchSearchResults(1, false)
        total.value = result.total
    } catch (e) {
        console.error('[Kugou Search] error:', e)
        messageStore.error('酷狗搜索失败')
    } finally {
        loading.value = false
    }
}

// 加载更多（下一页，追加到列表）
const loadMoreSearch = async () => {
    if (loading.value || loadingMore.value) return
    if (!hasMore.value) return
    loadingMore.value = true
    try {
        const nextPage = page.value + 1
        const result = await fetchSearchResults(nextPage, true)
        page.value = nextPage
        total.value = result.total
    } catch (e) {
        console.error('[Kugou Search] loadMore error:', e)
        messageStore.error('加载更多失败')
    } finally {
        loadingMore.value = false
    }
}

const submitSearch = () => {
    keywords.value = localInput.value
    suggests.value = []
    activeTab.value = 'song'
    page.value = 1
    songs.value = []; playlists.value = []; singers.value = []; albums.value = []
    doSearch()
}

const searchHotKey = (kw) => {
    localInput.value = kw
    keywords.value = kw
    activeTab.value = 'song'
    page.value = 1
    doSearch()
}

const switchTab = (key) => {
    if (activeTab.value === key) return
    activeTab.value = key
    page.value = 1
    songs.value = []
    playlists.value = []
    singers.value = []
    albums.value = []
    if (keywords.value) doSearch()
}

const playSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = songs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const goToPlaylist = (id) => id && router.push(`/kugou/playlist/${id}`)
const goToSinger = (id) => id && router.push(`/kugou/singer/${id}`)
const goToAlbum = (id) => id && router.push(`/kugou/album/${id}`)

watch(() => route.query.keywords, (val) => {
    keywords.value = val || ''
    localInput.value = val || ''
    page.value = 1
    activeTab.value = 'song'
    if (val) doSearch()
})

onMounted(() => {
    fetchHotKeys()
    if (keywords.value) doSearch()
})

onUnmounted(() => { if (suggestTimer) clearTimeout(suggestTimer) })
</script>

<template>
    <div class="kugou-search-page">
        <!-- 搜索框 -->
        <div class="kugou-search-box-wrap">
            <div class="kugou-search-box">
                <input
                    v-model="localInput"
                    placeholder="搜索酷狗概念版歌曲、歌单、歌手、专辑"
                    @focus="onInputFocus"
                    @blur="onInputBlur"
                    @input="fetchSuggests(localInput)"
                    @keyup.enter="submitSearch"
                />
                <button class="kugou-search-btn" @click="submitSearch">搜索</button>
                <!-- 联想下拉 -->
                <div class="kugou-suggest-list" v-if="showSuggest && suggests.length">
                    <div
                        v-for="(s, i) in suggests"
                        :key="i"
                        class="kugou-suggest-item"
                        @mousedown.prevent="pickSuggest(s)"
                    >{{ s }}</div>
                </div>
            </div>
        </div>

        <!-- 热搜词（未搜索时展示） -->
        <div v-if="!keywords && hotKeys.length" class="kugou-hotkeys">
            <h3 class="kugou-section-title">热门搜索</h3>
            <div class="kugou-hotkey-list">
                <div
                    v-for="(k, i) in hotKeys"
                    :key="i"
                    class="kugou-hotkey-item"
                    :class="{ 'top-three': i < 3 }"
                    @click="searchHotKey(k)"
                >
                    <span class="kugou-hotkey-index">{{ i + 1 }}</span>
                    <span class="kugou-hotkey-text">{{ k }}</span>
                </div>
            </div>
        </div>

        <!-- 搜索结果 -->
        <template v-if="keywords">
            <div class="kugou-search-header">
                <h2 class="kugou-search-title">搜索：{{ keywords }}</h2>
            </div>

            <div class="kugou-tabs">
                <div
                    v-for="t in tabs"
                    :key="t.key"
                    class="kugou-tab"
                    :class="{ active: activeTab === t.key }"
                    @click="switchTab(t.key)"
                >{{ t.label }}</div>
            </div>

            <div class="kugou-search-content" v-loading="loading">
                <!-- 需要登录提示 -->
                <div v-if="needLogin" class="kugou-empty">
                    酷狗搜索需要登录后才能使用，请先登录酷狗账号
                </div>

                <template v-else>
                    <!-- 歌曲 -->
                    <div v-if="activeTab === 'song'" class="kugou-song-list">
                        <div v-for="(s, i) in songs" :key="s.id || i" class="kugou-song-item" @dblclick="playSong(s)">
                            <span class="kugou-song-index">{{ i + 1 }}</span>
                            <img v-if="s.picUrl" :src="s.picUrl" class="kugou-song-cover" loading="lazy" />
                            <div class="kugou-song-info">
                                <div class="kugou-song-name">
                                    <span class="name-text">{{ s.name }}</span>
                                    <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                                </div>
                                <div class="kugou-song-artist">{{ s.artist }}</div>
                            </div>
                            <div class="kugou-song-album">{{ s.album }}</div>
                        </div>
                    </div>

                    <!-- 歌单 -->
                    <div v-if="activeTab === 'playlist'" class="kugou-card-grid">
                        <div v-for="p in playlists" :key="p.id" class="kugou-card" @click="goToPlaylist(p.id)">
                            <img :src="p.coverImgUrl" :alt="p.name" class="kugou-card-img" loading="lazy" />
                            <div class="kugou-card-name">{{ p.name }}</div>
                            <div class="kugou-card-meta">{{ p.creator }}</div>
                        </div>
                    </div>

                    <!-- 歌手 -->
                    <div v-if="activeTab === 'singer'" class="kugou-card-grid">
                        <div v-for="s in singers" :key="s.id" class="kugou-card" @click="goToSinger(s.id)">
                            <img :src="s.picUrl" :alt="s.name" class="kugou-card-img" loading="lazy" />
                            <div class="kugou-card-name">{{ s.name }}</div>
                        </div>
                    </div>

                    <!-- 专辑 -->
                    <div v-if="activeTab === 'album'" class="kugou-card-grid">
                        <div v-for="a in albums" :key="a.id" class="kugou-card" @click="goToAlbum(a.id)">
                            <img :src="a.picUrl" :alt="a.name" class="kugou-card-img" loading="lazy" />
                            <div class="kugou-card-name">{{ a.name }}</div>
                            <div class="kugou-card-meta">{{ a.artist }}</div>
                        </div>
                    </div>

                    <div v-if="!loading && !songs.length && !playlists.length && !singers.length && !albums.length" class="kugou-empty">
                        暂无搜索结果
                    </div>

                    <!-- 加载更多 -->
                    <div v-if="hasMore" class="kugou-loadmore-wrap">
                        <button class="kugou-loadmore-btn" :disabled="loadingMore" @click="loadMoreSearch">
                            {{ loadingMore ? '加载中...' : '加载更多' }}
                        </button>
                        <span class="kugou-loadmore-tip">已加载 {{ currentCount }} / {{ total }}</span>
                    </div>
                </template>
            </div>
        </template>
    </div>
</template>

<style scoped>
.kugou-search-page {
    padding: 20px 28px;
    height: 100%;
    overflow-y: auto;
}
.kugou-search-box-wrap {
    margin-bottom: 20px;
}
.kugou-search-box {
    position: relative;
    display: flex;
    gap: 8px;
    max-width: 560px;
}
.kugou-search-box input {
    flex: 1;
    border: 1px solid var(--border-color);
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.18s;
}
.kugou-search-box input:focus {
    border-color: var(--primary-color);
}
.kugou-search-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 0 20px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
}
.kugou-search-btn:hover { opacity: 0.9; }
.kugou-suggest-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 90px;
    background: white;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    z-index: 100;
    overflow: hidden;
}
.kugou-suggest-item {
    padding: 8px 16px;
    font-size: 13px;
    color: var(--text-main);
    cursor: pointer;
}
.kugou-suggest-item:hover {
    background: var(--hover-bg);
    color: var(--primary-color);
}
.kugou-loadmore-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px 0 28px;
}
.kugou-loadmore-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 28px;
    border-radius: 18px;
    cursor: pointer;
    font-size: 13px;
    transition: opacity 0.18s;
}
.kugou-loadmore-btn:hover { opacity: 0.9; }
.kugou-loadmore-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.kugou-loadmore-tip { font-size: 12px; color: var(--text-light); }
.kugou-hotkeys {
    margin-top: 10px;
}
.kugou-section-title {
    font-size: 15px;
    color: var(--text-main);
    margin-bottom: 14px;
}
.kugou-hotkey-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
}
.kugou-hotkey-item {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
}
.kugou-hotkey-item:hover {
    color: var(--primary-color);
}
.kugou-hotkey-index {
    width: 18px;
    color: var(--text-light);
    font-size: 12px;
}
.kugou-hotkey-item.top-three .kugou-hotkey-index {
    color: var(--primary-color);
    font-weight: 700;
}
.kugou-search-title {
    font-size: 18px;
    color: var(--text-main);
    margin-bottom: 16px;
}
.kugou-tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 18px;
}
.kugou-tab {
    padding: 8px 0;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 14px;
    position: relative;
}
.kugou-tab.active {
    color: var(--primary-color);
    font-weight: 600;
}
.kugou-tab.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--primary-color);
}
.kugou-song-list {
    display: flex;
    flex-direction: column;
}
.kugou-song-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    gap: 12px;
}
.kugou-song-item:hover {
    background: var(--hover-bg);
}
.kugou-song-index {
    width: 28px;
    color: var(--text-light);
    font-size: 13px;
    text-align: center;
}
.kugou-song-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
}
.kugou-song-info {
    flex: 1;
    min-width: 0;
}
.kugou-song-name {
    font-size: 14px;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 4px;
}
.kugou-song-name .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
}
.kugou-song-artist {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
}
.kugou-song-album {
    font-size: 12px;
    color: var(--text-light);
    width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kugou-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 18px;
}
.kugou-card { cursor: pointer; transition: transform 0.18s; }
.kugou-card:hover { transform: translateY(-3px); }
.kugou-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.kugou-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-card-meta {
    font-size: 12px; color: var(--text-light); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-empty {
    text-align: center; color: var(--text-light);
    padding: 80px 0; font-size: 14px;
}
</style>
