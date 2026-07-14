<script setup>
import { ref, onMounted, watch } from 'vue'
import { getMvAll } from '../api'
import { Play } from 'lucide-vue-next'
import { usePlayerStore } from '../store/player'

const playerStore = usePlayerStore()
const mvs = ref([])
const activeArea = ref('全部')
const areas = ['全部', '内地', '港台', '欧美', '日本', '韩国']

const fetchMvs = async () => {
    try {
        const res = await getMvAll(activeArea.value, 12)
        mvs.value = res.data
    } catch (err) {
        console.error('Fetch MV error:', err)
    }
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

watch(activeArea, () => {
    fetchMvs()
})

onMounted(() => {
    fetchMvs()
})
</script>

<template>
  <div class="video-view">
    <div class="header-tabs">
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
</template>

<style scoped>
.video-view {
  padding: 20px 30px;
  flex: 1;
  overflow-y: auto;
}

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
</style>
