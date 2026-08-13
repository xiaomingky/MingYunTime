<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAlbum } from '../api'
import { usePlayerStore } from '../store/player'
import { Play, Heart, ChevronLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()

const album = ref(null)
const tracks = ref([])
const loading = ref(false)

const fetchAlbum = async () => {
    if (!route.params.id) return
    loading.value = true
    try {
        const res = await getAlbum(route.params.id)
        if (res && res.album) {
            album.value = res.album
            tracks.value = res.songs || res.album.songs || []
        }
    } catch (err) {
        console.error('Fetch album error:', err)
    } finally {
        loading.value = false
    }
}

const formatTime = (ms) => {
  const seconds = ms / 1000
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const goBack = () => {
    router.back()
}

watch(() => route.params.id, (newId) => {
  if (newId) fetchAlbum()
}, { immediate: true })

onMounted(() => {
    fetchAlbum()
})
</script>

<template>
  <div class="album-detail-view">
    <div v-if="loading" class="loading-state">加载中...</div>
    <template v-else-if="album">
        <div class="album-header">
            <ChevronLeft :size="24" class="back-btn clickable" @click="goBack" />
            <div class="album-info">
                <div class="album-cover">
                    <img :src="album.picUrl + '?param=200y200'" />
                </div>
                <div class="album-meta">
                    <h1 class="album-name">{{ album.name }}</h1>
                    <p class="album-artist">{{ album.artist?.name || album.artists?.map(a => a.name).join('/') || '未知歌手' }}</p>
                    <p class="album-desc" v-if="album.description">{{ album.description }}</p>
                    <p class="album-misc">
                        <span v-if="album.publishTime">发布时间：{{ new Date(album.publishTime).toLocaleDateString('zh-CN') }}</span>
                        <span v-if="album.company">发行公司：{{ album.company }}</span>
                    </p>
                    <button class="play-all-btn" @click="playerStore.playSong(tracks[0], tracks)">
                        <Play :size="16" fill="white" /> 播放全部
                    </button>
                </div>
            </div>
        </div>

        <div class="track-list">
            <div class="list-header">
                <div class="col-index">#</div>
                <div class="col-title">歌曲</div>
                <div class="col-artist">歌手</div>
                <div class="col-duration">时长</div>
            </div>
            <div 
                v-for="(track, index) in tracks" 
                :key="track.id" 
                class="track-item"
                :class="{ active: playerStore.currentSong.id === track.id }"
                @dblclick="playerStore.playSong(track, tracks)"
            >
                <div class="col-index">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</div>
                <div class="col-title">
                    <span class="title-text">{{ track.name }}</span>
                </div>
                <div class="col-artist">{{ track.ar?.map(a => a.name).join('/') || track.artists?.map(a => a.name).join('/') || '未知' }}</div>
                <div class="col-duration">{{ formatTime(track.dt) }}</div>
            </div>
            <div v-if="tracks.length === 0" class="empty-state">暂无歌曲</div>
        </div>
    </template>
    <div v-else class="empty-state">未找到专辑信息</div>
  </div>
</template>

<style scoped>
.album-detail-view {
    padding: 30px;
    flex: 1;
    overflow-y: auto;
}

.loading-state, .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #999;
    font-size: 14px;
}

.back-btn {
    margin-bottom: 20px;
    color: #666;
    transition: color 0.2s;
}

.back-btn:hover {
    color: var(--primary-color);
}

.album-header {
    margin-bottom: 30px;
}

.album-info {
    display: flex;
    gap: 25px;
}

.album-cover {
    width: 200px;
    height: 200px;
    border-radius: 12px;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
}

.album-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.album-meta {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
}

.album-name {
    font-size: 24px;
    font-weight: 700;
    color: #1a1a2e;
}

.album-artist {
    font-size: 14px;
    color: #888;
}

.album-desc {
    font-size: 13px;
    color: #aaa;
    max-width: 500px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.album-misc {
    display: flex;
    gap: 20px;
    font-size: 12px;
    color: #bbb;
}

.play-all-btn {
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 24px;
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: 20px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    align-self: flex-start;
}

.play-all-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
}

.track-list {
    border-top: 1px solid #f0f0f0;
    padding-top: 15px;
}

.list-header {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px;
    padding: 8px 12px;
    font-size: 12px;
    color: #999;
}

.track-item {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px;
    padding: 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 13px;
}

.track-item:hover {
    background: #f5f5f5;
}

.track-item.active {
    color: var(--primary-color);
}

.col-index {
    color: #ccc;
    font-size: 12px;
}

.col-title .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
}

.col-artist {
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.col-duration {
    color: #bbb;
    text-align: right;
    font-size: 12px;
}
</style>
