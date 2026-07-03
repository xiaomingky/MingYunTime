<script setup>
import { ref, watch, onMounted, computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { cloudSearch } from '../api'
import { usePlayerStore } from '../store/player'
import { Play, Heart, Download } from 'lucide-vue-next'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'

const userStore = useUserStore()
const messageStore = useMessageStore()

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const requireLockForPlaylist = inject('requireLockForPlaylist')
const songs = ref([])
const artists = ref([])
const albums = ref([])
const mvList = ref([])
const playlists = ref([])
const loading = ref(false)
const activeTab = ref(1)

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
    if (!q) return
    loading.value = true
    try {
        const res = await cloudSearch(q, activeTab.value)
        if (activeTab.value === 1) songs.value = res.result.songs || []
        else if (activeTab.value === 10) albums.value = res.result.albums || []
        else if (activeTab.value === 100) artists.value = res.result.artists || []
        else if (activeTab.value === 1000) playlists.value = res.result.playlists || []
        else if (activeTab.value === 1004) mvList.value = res.result.videos || []
    } catch (err) {
        console.error('Search error:', err)
    } finally {
        loading.value = false
    }
}

const changeTab = (type) => {
    activeTab.value = type
    handleSearch()
}

watch(() => route.query.keywords, handleSearch)

const toggleLike = async (song) => {
    if (!userStore.isLoggedIn) return messageStore.warning('请先登录后收藏')
    const isLiked = userStore.isSongLiked(song.id)
    try {
        const res = await (await import('../api')).default.get('/like', { 
            params: { id: song.id, like: !isLiked, timestamp: Date.now() } 
        })
        if (res.code === 200) {
            userStore.toggleLike(song.id, !isLiked)
            if (playerStore.currentSong.id === song.id) {
                playerStore.isLiked = !isLiked
            }
        }
    } catch (e) {
        console.error('Toggle like error:', e)
    }
}

const goToPlaylist = (id) => {
    if (requireLockForPlaylist) {
        requireLockForPlaylist(id)
    } else {
        router.push(`/playlist/${id}`)
    }
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
          <tr v-for="(song, index) in songs" :key="song.id" @dblclick="playerStore.playSong(song, songs)" class="track-row">
            <td class="index-cell">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</td>
            <td class="operation-cell">
                <Heart 
                    :size="14" 
                    class="clickable" 
                    :class="{ 'text-red': userStore.isSongLiked(song.id) }"
                    :fill="userStore.isSongLiked(song.id) ? '#EC4141' : 'none'"
                    :color="userStore.isSongLiked(song.id) ? '#EC4141' : 'currentColor'"
                    @click.stop="toggleLike(song)"
                /> 
                <Download :size="14" />
            </td>
            <td class="title-cell" :title="song.name">
                <div class="title-container">
                    <span class="name-text">{{ song.name }}</span>
                    <span v-if="song.fee === 1" class="vip-tag-mini">VIP</span>
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
        <div v-for="item in albums" :key="item.id" class="playlist-card clickable">
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
    <div v-else-if="isEmpty" class="loading">暂无搜索结果</div>
  </div>
</template>

<style scoped>
.search-view {
    padding: 30px;
    flex: 1;
    overflow-y: auto;
}

.search-info h1 {
    font-size: 20px;
    margin-bottom: 20px;
}

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
