<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { qqSearch, qqHotkey, qqSmartbox, qqMvPlay, normalizeQQSong, toQQTrack, enrichQQSongWithDetail, getQQCookie } from '../../api/qq'

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
const mvs = ref([])
const page = ref(1)
const total = ref(0)

const tabs = [
    { key: 'song', label: '歌曲' },
    { key: 'playlist', label: '歌单' },
    { key: 'singer', label: '歌手' },
    { key: 'album', label: '专辑' },
    { key: 'mv', label: 'MV' }
]

// 热搜词
const hotKeys = ref([])
const fetchHotKeys = async () => {
    try {
        const res = await qqHotkey()
        const data = res?.data || res
        const list = data?.hotkey || data?.list || data?.data || []
        hotKeys.value = list.map(k => k.k || k.query || k.word || k).filter(Boolean).slice(0, 20)
    } catch (e) {
        console.error('[QQ Hotkey] error:', e)
    }
}

// 搜索联想
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
            const res = await qqSmartbox(val.trim())
            const data = res?.data || res
            // getSmartbox 返回 { album:{itemlist}, mv:{itemlist}, song:{itemlist} }
            const songList = data?.song?.itemlist || []
            suggests.value = songList.map(s => s.name || s.songname || s.title || '').filter(Boolean).slice(0, 8)
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

const doSearch = async () => {
    const kw = keywords.value.trim()
    if (!kw) return
    router.replace({ path: '/qq/search', query: { keywords: kw } })
    loading.value = true
    try {
        // catZhida: 0 歌曲, 1 歌手, 2 专辑, 3 歌单, 4 MV (按 QQ API 文档)
        const zhidaMap = { song: 0, singer: 1, album: 2, playlist: 3, mv: 4 }
        const res = await qqSearch(kw, 30, page.value, zhidaMap[activeTab.value])
        const data = res?.data || res
        const list = data?.list || data?.song?.list || data?.singer?.list || data?.album?.list || data?.songlist?.list || data?.mv?.list || []
        total.value = data?.total || data?.song?.total || data?.singer?.total || data?.album?.total || data?.songlist?.total || data?.mv?.total || 0

        if (activeTab.value === 'song') {
            songs.value = list.map(normalizeQQSong).filter(Boolean)
            // 无专辑封面(albummid 缺失)的歌曲,调官方 song-detail 接口拿真实 albummid 构造 T002 封面
            const cookie = getQQCookie()
            songs.value.forEach((s, i) => {
                if (!s.picUrl || !s.picUrl.includes('T002R300x300M000')) {
                    enrichQQSongWithDetail(s, cookie).then(updated => {
                        if (updated.picUrl) songs.value[i] = updated
                    }).catch(() => {})
                }
            })
        } else if (activeTab.value === 'playlist') {
            playlists.value = list.map(p => ({
                id: p.dissid || p.disstid,
                name: p.dissname || p.title,
                coverImgUrl: p.imgurl || p.picurl || '',
                creator: p.creator?.name || p.nickname || '',
                playCount: p.listennum || 0
            }))
        } else if (activeTab.value === 'singer') {
            singers.value = list.map(s => ({
                id: s.singerMID || s.singermid,
                name: s.singerName || s.singername,
                picUrl: s.singerPic || (s.singerMID ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${s.singerMID}.jpg` : '')
            }))
        } else if (activeTab.value === 'album') {
            albums.value = list.map(a => ({
                id: a.albumMID || a.albummid,
                name: a.albumName || a.albumname,
                picUrl: (a.albumMID || a.albummid) ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${a.albumMID || a.albummid}.jpg` : '',
                artist: a.singerName || a.singername || ''
            }))
        } else if (activeTab.value === 'mv') {
            mvs.value = list.map(m => ({
                id: m.vid || m.mv_id,
                vid: m.vid || m.mv_id,
                name: m.mv_name || m.title || m.songname,
                artist: m.singer_name || m.singername || '',
                picUrl: m.mv_pic_url || m.pic || ''
            }))
        }
    } catch (e) {
        console.error('[QQ Search] error:', e)
        messageStore.error('QQ 搜索失败')
    } finally {
        loading.value = false
    }
}

const submitSearch = () => {
    keywords.value = localInput.value
    suggests.value = []
    activeTab.value = 'song'
    page.value = 1
    songs.value = []; playlists.value = []; singers.value = []; albums.value = []; mvs.value = []
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
    mvs.value = []
    doSearch()
}

const playSong = (song) => {
    const track = toQQTrack(song)
    if (!track) return
    const list = songs.value.map(toQQTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const goToPlaylist = (id) => id && router.push(`/qq/playlist/${id}`)
const goToSinger = (id) => id && router.push(`/qq/singer/${id}`)
const goToAlbum = (id) => id && router.push(`/qq/album/${id}`)

// MV 播放
const currentMv = ref(null)
const playMv = async (mv) => {
    if (!mv.vid) return
    loading.value = true
    try {
        const res = await qqMvPlay(mv.vid)
        const data = res?.data || res
        let url = data?.url || data?.mp4Url || data?.h264Url
        if (!url && data?.midurlinfo?.length) url = data.midurlinfo[0].purl || data.midurlinfo[0].url
        if (!url && data?.urls?.length) url = data.urls[0]
        if (url) {
            currentMv.value = {
                vid: mv.vid,
                name: mv.name,
                artist: mv.artist,
                url: url.startsWith('http') ? url : `https:${url}`,
                picUrl: mv.picUrl
            }
        } else {
            messageStore.warning('MV 暂不可播放（VIP 或版权限制）')
        }
    } catch (e) {
        console.error('[QQ Search] playMv error:', e)
        messageStore.error('MV 播放失败')
    } finally {
        loading.value = false
    }
}
const closeMv = () => { currentMv.value = null }

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
    <div class="qq-search-page">
        <!-- 搜索框 -->
        <div class="qq-search-box-wrap">
            <div class="qq-search-box">
                <input
                    v-model="localInput"
                    placeholder="搜索 QQ 音乐歌曲、歌单、歌手、专辑、MV"
                    @focus="onInputFocus"
                    @blur="onInputBlur"
                    @input="fetchSuggests(localInput)"
                    @keyup.enter="submitSearch"
                />
                <button class="qq-search-btn" @click="submitSearch">搜索</button>
                <!-- 联想下拉 -->
                <div class="qq-suggest-list" v-if="showSuggest && suggests.length">
                    <div
                        v-for="(s, i) in suggests"
                        :key="i"
                        class="qq-suggest-item"
                        @mousedown.prevent="pickSuggest(s)"
                    >{{ s }}</div>
                </div>
            </div>
        </div>

        <!-- 热搜词（未搜索时展示） -->
        <div v-if="!keywords && hotKeys.length" class="qq-hotkeys">
            <h3 class="qq-section-title">热门搜索</h3>
            <div class="qq-hotkey-list">
                <div
                    v-for="(k, i) in hotKeys"
                    :key="i"
                    class="qq-hotkey-item"
                    :class="{ 'top-three': i < 3 }"
                    @click="searchHotKey(k)"
                >
                    <span class="qq-hotkey-index">{{ i + 1 }}</span>
                    <span class="qq-hotkey-text">{{ k }}</span>
                </div>
            </div>
        </div>

        <!-- 搜索结果 -->
        <template v-if="keywords">
            <div class="qq-search-header">
                <h2 class="qq-search-title">搜索：{{ keywords }}</h2>
            </div>

            <div class="qq-tabs">
                <div
                    v-for="t in tabs"
                    :key="t.key"
                    class="qq-tab"
                    :class="{ active: activeTab === t.key }"
                    @click="switchTab(t.key)"
                >{{ t.label }}</div>
            </div>

            <div class="qq-search-content" v-loading="loading">
                <!-- 歌曲 -->
                <div v-if="activeTab === 'song'" class="qq-song-list">
                    <div v-for="(s, i) in songs" :key="s.id || i" class="qq-song-item" @click="playSong(s)">
                        <span class="qq-song-index">{{ i + 1 }}</span>
                        <img v-if="s.picUrl" :src="s.picUrl" class="qq-song-cover" loading="lazy" />
                        <div class="qq-song-info">
                            <div class="qq-song-name">{{ s.name }}</div>
                            <div class="qq-song-artist">{{ s.artist }}</div>
                        </div>
                        <div class="qq-song-album">{{ s.album }}</div>
                    </div>
                </div>

                <!-- 歌单 -->
                <div v-if="activeTab === 'playlist'" class="qq-card-grid">
                    <div v-for="p in playlists" :key="p.id" class="qq-card" @click="goToPlaylist(p.id)">
                        <img :src="p.coverImgUrl" :alt="p.name" class="qq-card-img" loading="lazy" />
                        <div class="qq-card-name">{{ p.name }}</div>
                        <div class="qq-card-meta">{{ p.creator }}</div>
                    </div>
                </div>

                <!-- 歌手 -->
                <div v-if="activeTab === 'singer'" class="qq-card-grid">
                    <div v-for="s in singers" :key="s.id" class="qq-card" @click="goToSinger(s.id)">
                        <img :src="s.picUrl" :alt="s.name" class="qq-card-img" loading="lazy" />
                        <div class="qq-card-name">{{ s.name }}</div>
                    </div>
                </div>

                <!-- 专辑 -->
                <div v-if="activeTab === 'album'" class="qq-card-grid">
                    <div v-for="a in albums" :key="a.id" class="qq-card" @click="goToAlbum(a.id)">
                        <img :src="a.picUrl" :alt="a.name" class="qq-card-img" loading="lazy" />
                        <div class="qq-card-name">{{ a.name }}</div>
                        <div class="qq-card-meta">{{ a.artist }}</div>
                    </div>
                </div>

                <!-- MV（可点击播放） -->
                <div v-if="activeTab === 'mv'" class="qq-card-grid">
                    <div v-for="m in mvs" :key="m.id" class="qq-card qq-mv-card" @click="playMv(m)">
                        <div class="qq-mv-cover-wrap">
                            <img :src="m.picUrl" :alt="m.name" class="qq-card-img" loading="lazy" />
                            <div class="qq-mv-play-overlay">▶</div>
                        </div>
                        <div class="qq-card-name">{{ m.name }}</div>
                        <div class="qq-card-meta">{{ m.artist }}</div>
                    </div>
                </div>

                <div v-if="!loading && !songs.length && !playlists.length && !singers.length && !albums.length && !mvs.length" class="qq-empty">
                    暂无搜索结果
                </div>
            </div>
        </template>

        <!-- MV 播放器浮层 -->
        <div v-if="currentMv" class="qq-mv-player" @click.self="closeMv">
            <div class="qq-mv-player-box">
                <div class="qq-mv-player-header">
                    <span>{{ currentMv.name }} - {{ currentMv.artist }}</span>
                    <span class="qq-mv-close" @click="closeMv">×</span>
                </div>
                <video :src="currentMv.url" controls autoplay class="qq-mv-video" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.qq-search-page {
    padding: 20px 28px;
    height: 100%;
    overflow-y: auto;
}
.qq-search-box-wrap {
    margin-bottom: 20px;
}
.qq-search-box {
    position: relative;
    display: flex;
    gap: 8px;
    max-width: 560px;
}
.qq-search-box input {
    flex: 1;
    border: 1px solid var(--border-color);
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.18s;
}
.qq-search-box input:focus {
    border-color: var(--primary-color);
}
.qq-search-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 0 20px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
}
.qq-search-btn:hover { opacity: 0.9; }
.qq-suggest-list {
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
.qq-suggest-item {
    padding: 8px 16px;
    font-size: 13px;
    color: var(--text-main);
    cursor: pointer;
}
.qq-suggest-item:hover {
    background: var(--hover-bg);
    color: var(--primary-color);
}
.qq-hotkeys {
    margin-top: 10px;
}
.qq-section-title {
    font-size: 15px;
    color: var(--text-main);
    margin-bottom: 14px;
}
.qq-hotkey-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
}
.qq-hotkey-item {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
}
.qq-hotkey-item:hover {
    color: var(--primary-color);
}
.qq-hotkey-index {
    width: 18px;
    color: var(--text-light);
    font-size: 12px;
}
.qq-hotkey-item.top-three .qq-hotkey-index {
    color: var(--primary-color);
    font-weight: 700;
}
.qq-search-title {
    font-size: 18px;
    color: var(--text-main);
    margin-bottom: 16px;
}
.qq-tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 18px;
}
.qq-tab {
    padding: 8px 0;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 14px;
    position: relative;
}
.qq-tab.active {
    color: var(--primary-color);
    font-weight: 600;
}
.qq-tab.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--primary-color);
}
.qq-song-list {
    display: flex;
    flex-direction: column;
}
.qq-song-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    gap: 12px;
}
.qq-song-item:hover {
    background: var(--hover-bg);
}
.qq-song-index {
    width: 28px;
    color: var(--text-light);
    font-size: 13px;
    text-align: center;
}
.qq-song-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
}
.qq-song-info {
    flex: 1;
    min-width: 0;
}
.qq-song-name {
    font-size: 14px;
    color: var(--text-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-song-artist {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
}
.qq-song-album {
    font-size: 12px;
    color: var(--text-light);
    width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 18px;
}
.qq-card { cursor: pointer; transition: transform 0.18s; }
.qq-card:hover { transform: translateY(-3px); }
.qq-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.qq-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-card-meta {
    font-size: 12px; color: var(--text-light); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-mv-cover-wrap { position: relative; }
.qq-mv-play-overlay {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 40px; height: 40px; border-radius: 50%;
    background: rgba(0,0,0,0.55); color: white; display: flex;
    align-items: center; justify-content: center; font-size: 16px;
    opacity: 0; transition: opacity 0.2s;
}
.qq-mv-card:hover .qq-mv-play-overlay { opacity: 1; }
.qq-empty {
    text-align: center; color: var(--text-light);
    padding: 80px 0; font-size: 14px;
}
.qq-mv-player {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); z-index: 999;
    display: flex; align-items: center; justify-content: center;
}
.qq-mv-player-box {
    width: 80%; max-width: 960px; background: #000;
    border-radius: 8px; overflow: hidden;
}
.qq-mv-player-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; color: white; background: rgba(0,0,0,0.7);
    font-size: 14px;
}
.qq-mv-close { cursor: pointer; font-size: 22px; line-height: 1; }
.qq-mv-video { width: 100%; max-height: 70vh; display: block; background: #000; }
</style>
