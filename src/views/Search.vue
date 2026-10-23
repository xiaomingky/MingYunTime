<script setup>
import SongVipBadge from '../components/SongVipBadge.vue'
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { cloudSearch } from '../api'
import { usePlayerStore } from '../store/player'
import { Play, Heart, Download } from 'lucide-vue-next'
import SongActionsMenu from '../components/SongActionsMenu.vue'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'

const userStore = useUserStore()
const messageStore = useMessageStore()

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const songs = ref([])
const artists = ref([])
const albums = ref([])
const mvList = ref([])
const playlists = ref([])
const loading = ref(false)
const activeTab = ref(1)
const page = ref(0), total = ref(0), searchError = ref('')
let searchRevision = 0

const isEmpty = computed(() => {
    if (activeTab.value === 1) return songs.value.length === 0
    if (activeTab.value === 10) return albums.value.length === 0
    if (activeTab.value === 100) return artists.value.length === 0
    if (activeTab.value === 1000) return playlists.value.length === 0
    if (activeTab.value === 1004) return mvList.value.length === 0
    return false
})

const tabItems = [
    { label: '单曲', type: 1 },
    { label: '歌手', type: 100 },
    { label: '专辑', type: 10 },
    { label: '视频', type: 1004 },
    { label: '歌单', type: 1000 }
]

const formatTime = (ms) => {
  const seconds = ms / 1000
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const handleSearch = async () => {
    const q = route.query.keywords
    const requestId = ++searchRevision
    if (!q) { loading.value = false; songs.value = []; albums.value = []; artists.value = []; playlists.value = []; mvList.value = []; return }
    loading.value = true
    searchError.value = ''
    try {
        const type = activeTab.value
        const res = await cloudSearch(q, type, 30, page.value * 30)
        if (requestId !== searchRevision) return
        if (!res || res.code !== 200) throw new Error(res?.message || '网易云搜索暂不可用，请重试')
        const result = res.result || {}
        if (type === 1) songs.value = result.songs || []
        else if (type === 10) albums.value = result.albums || []
        else if (type === 100) artists.value = result.artists || []
        else if (type === 1000) playlists.value = result.playlists || []
        else if (type === 1004) mvList.value = result.videos || []
        total.value = Number(res.total || result.songCount || result.albumCount || result.artistCount || result.playlistCount || result.mvCount || 0)
    } catch (err) {
        if (requestId === searchRevision) searchError.value = err.message || '搜索失败，请重试'
    } finally {
        if (requestId === searchRevision) loading.value = false
    }
}

const changeTab = (type) => {
    activeTab.value = type
    page.value = 0
    handleSearch()
}
const changePage = next => { page.value = Math.max(0, page.value + next); handleSearch() }

watch(() => route.query.keywords, () => { page.value = 0; handleSearch() })
onBeforeUnmount(() => searchRevision++)

const toggleLike = async (song) => {
    if (!userStore.isLoggedIn) return messageStore.warning('请先登录后收藏')
    const isLiked = userStore.isSongLiked(song.id)
    try {
        if (await userStore.setSongLiked(song.id, !isLiked)) {
            if (String(playerStore.currentSong.id) === String(song.id)) playerStore.isLiked = !isLiked
            messageStore.success(!isLiked ? '已添加到我喜欢的音乐' : '已取消喜欢')
        }
    } catch (e) {
        messageStore.error(e.message || '喜欢状态更新失败，请重试')
    }
}

const goToPlaylist = (id) => {
    router.push(`/playlist/${id}`)
}

const goToAlbum = (id) => {
    if (id) router.push(`/album/${id}`)
}

onMounted(handleSearch)
</script>

<template>
  <div class="search-view">
    <div class="search-info">
        <h1>搜索 "{{ route.query.keywords }}"</h1>
        <div class="tabs">
            <span 
                v-for="tab in tabItems" 
                :key="tab.type" 
                class="tab"
                :class="{ active: activeTab === tab.type }"
                @click="changeTab(tab.type)"
            >
                {{ tab.label }}
            </span>
        </div>
    </div>

    <!-- Song List (Type 1) -->
    <div class="track-list" v-if="!loading && activeTab === 1">
      <table class="track-table">
        <thead>
          <tr>
            <th class="col-index">#</th>
            <th class="col-oper">操作</th>
            <th class="col-title">标题</th>
            <th class="col-artist">歌手</th>
            <th class="col-album">专辑</th>
            <th class="col-duration">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(song, index) in songs" :key="song.id" @click="playerStore.handleSongClick(song, songs, $event)" class="track-row">
            <td class="index-cell">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</td>
            <td class="operation-cell">
                <Heart 
                    :size="14" 
                    class="clickable" 
                    :class="{ 'text-red': userStore.isSongLiked(song.id), 'like-pending': userStore.pendingLikeIds.has(Number(song.id)) }"
                    :aria-busy="userStore.pendingLikeIds.has(Number(song.id))"
                    :fill="userStore.isSongLiked(song.id) ? '#EC4141' : 'none'"
                    :color="userStore.isSongLiked(song.id) ? '#EC4141' : 'currentColor'"
                    @click.stop="toggleLike(song)"
                /> 
                <Download :size="14" />
                <SongActionsMenu :song="song" :list="songs" compact />
            </td>
            <td class="title-cell" :title="song.name">
                <div class="title-container">
                    <span class="name-text">{{ song.name }}</span>
                    <SongVipBadge :song="song" platform="netease" />
                </div>
            </td>
            <td class="artist-cell" :title="song.ar.map(a => a.name).join('/')">{{ song.ar.map(a => a.name).join('/') }}</td>
            <td class="album-cell" :title="song.al.name"><span class="link" @click.stop="goToAlbum(song.al.id)">{{ song.al.name }}</span></td>
            <td class="duration-cell">{{ formatTime(song.dt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Artist List (Type 100) -->
    <div class="artist-grid" v-if="!loading && activeTab === 100">
        <div v-for="item in artists" :key="item.id" class="artist-card clickable">
            <img :src="item.picUrl + '?param=200y200'" class="artist-avatar" />
            <span class="name">{{ item.name }}</span>
        </div>
    </div>

    <!-- Album List (Type 10) -->
    <div class="playlist-grid" v-if="!loading && activeTab === 10">
        <div v-for="item in albums" :key="item.id" class="playlist-card clickable" @click="goToAlbum(item.id)">
            <div class="card-cover">
                <img :src="item.picUrl + '?param=200y200'" />
            </div>
            <span class="card-title">{{ item.name }}</span>
            <span class="card-artist">{{ item.artist.name }}</span>
        </div>
    </div>

    <!-- Playlist List (Type 1000) -->
    <div class="playlist-grid" v-if="!loading && activeTab === 1000">
        <div v-for="item in playlists" :key="item.id" class="playlist-card clickable" @click="goToPlaylist(item.id)">
            <div class="card-cover">
                <img :src="item.coverImgUrl + '?param=200y200'" />
            </div>
            <span class="card-title">{{ item.name }}</span>
        </div>
    </div>

    <div v-if="loading" class="loading">正在搜索...</div>
    <div v-else-if="searchError" class="loading search-error" role="alert">{{ searchError }} <button @click="handleSearch">重试</button></div>
    <div v-else-if="isEmpty" class="loading">暂无搜索结果</div>
    <div v-if="!loading && total > 30" class="search-pagination">
        <button :disabled="page===0" @click="changePage(-1)">上一页</button>
        <span>第 {{ page + 1 }} 页 · 共 {{ total }} 条</span>
        <button :disabled="(page + 1) * 30 >= total" @click="changePage(1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
:deep(.like-pending) { opacity: .45; pointer-events: none; }
.search-view {
    padding: 30px;
    flex: 1;
    overflow-y: auto;
}

.search-info h1 {
    font-size: 20px;
    margin-bottom: 20px;
}
.search-pagination { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 24px 0; color: var(--text-secondary); }
.search-pagination button, .search-error button { border: 1px solid var(--primary-color); color: var(--primary-color); background: transparent; border-radius: 4px; padding: 7px 14px; cursor: pointer; }
.search-pagination button:disabled { opacity: .45; cursor: default; }

.tabs {
    display: flex;
    gap: 30px;
    margin-bottom: 20px;
    border-bottom: 1px solid #eee;
}

.tab {
    padding: 10px 0;
    cursor: pointer;
    font-size: 14px;
}

.tab.active {
    font-weight: bold;
    border-bottom: 3px solid var(--primary-color);
    color: #333;
}

/* Grid Layouts to match Discovery.vue */
.artist-grid, .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 20px;
}

.artist-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}

.artist-avatar {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid #f0f0f0;
}

.playlist-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.card-cover {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background-color: #f5f5f5;
}

.card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.card-title {
    font-size: 14px;
    color: #333;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.artist-card, .playlist-card {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.artist-card:hover, .playlist-card:hover {
    transform: translateY(-5px);
}

.card-artist {
    font-size: 12px;
    color: #999;
}

.track-row {
    cursor: pointer;
}

.loading {
    text-align: center;
    color: #999;
    padding: 50px;
}

.title-container {
    display: flex;
    align-items: center;
    gap: 6px;
}

.vip-tag-mini {
    font-size: 10px;
    color: var(--primary-color);
    border: 1px solid var(--primary-color);
    padding: 0 3px;
    border-radius: 2px;
    line-height: 12px;
    flex-shrink: 0;
}

.name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.text-red {
    color: var(--primary-color) !important;
}

.link {
    color: #507daf;
    cursor: pointer;
}

.link:hover {
    text-decoration: underline;
}

.track-table {
    width: 100%;
    border-collapse: collapse;
}

.track-table th, .track-table td {
    padding: 12px 10px;
    text-align: left;
    border-bottom: 1px solid #f2f2f2;
}
</style>
