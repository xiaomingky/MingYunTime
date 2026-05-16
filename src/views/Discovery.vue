<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { 
  getBanner, 
  getPersonalizedPlaylist, 
  getNewSongs,
  getTopPlaylist,
  getToplist,
  getTopArtists,
  getTopSongs
} from '../api'
import { usePlayerStore } from '../store/player'
import { useUserStore } from '../store/user'
import { ChevronLeft, ChevronRight, Play, User, RefreshCw } from 'lucide-vue-next'

const router = useRouter()
const playerStore = usePlayerStore()
const userStore = useUserStore()

const banners = ref([])
const currentBanner = ref(0)
let bannerTimer = null
const startBannerAuto = () => { if (banners.value.length > 1) bannerTimer = setInterval(() => { currentBanner.value = (currentBanner.value + 1) % banners.value.length }, 4000) }
const stopBannerAuto = () => { clearInterval(bannerTimer); bannerTimer = null }
const prevBanner = () => { currentBanner.value = (currentBanner.value - 1 + banners.value.length) % banners.value.length }
const nextBanner = () => { currentBanner.value = (currentBanner.value + 1) % banners.value.length }

const playlists = ref([])
const newSongs = ref([])
const rankLists = ref([])
const artists = ref([])
const activeTab = ref('recommend')
const loading = ref(false)
const refreshing = ref(false)

const fetchData = async (forceRefresh = false) => {
  loading.value = true
  try {
    if (forceRefresh || banners.value.length === 0) {
      const bannerRes = await getBanner()
      banners.value = bannerRes?.banners || []
      if (banners.value.length > 0) startBannerAuto()
    }

    if (activeTab.value === 'recommend') {
        const playlistRes = await getPersonalizedPlaylist(10)
        playlists.value = playlistRes?.result || playlistRes?.playlists || []

        const newSongRes = await getNewSongs(12)
        newSongs.value = newSongRes?.result || newSongRes?.data || []
    } else if (activeTab.value === 'playlist') {
        const topPlaylistRes = await getTopPlaylist('全部', 20)
        playlists.value = topPlaylistRes?.playlists || topPlaylistRes?.result || []
    } else if (activeTab.value === 'rank') {
        const rankRes = await getToplist()
        rankLists.value = rankRes?.list || []
    } else if (activeTab.value === 'artist') {
        const artistRes = await getTopArtists(30)
        artists.value = artistRes?.artists || []
    } else if (activeTab.value === 'new') {
        const topSongRes = await getTopSongs(0) // 0: 全部
        newSongs.value = topSongRes?.data?.slice(0, 30) || topSongRes?.result || []
    }
  } catch (error) {
    console.error('Failed to fetch data:', error)
  } finally {
    loading.value = false
  }
}

const refreshCount = ref(0)
const refreshData = async () => {
    refreshCount.value++
    refreshing.value = true
    try {
        await fetchData(true)
        if (userStore.isLoggedIn && userStore.profile?.userId) {
            await userStore.fetchUserPlaylists(userStore.profile.userId)
        }
        await playerStore.fetchAudioDevices()
    } finally {
        refreshCount.value--
        if (refreshCount.value <= 0) {
            refreshing.value = false
            refreshCount.value = 0
        }
    }
}

defineExpose({ refreshData })

const goToPlaylist = (id) => {
  router.push(`/playlist/${id}`)
}

const goToArtist = (id) => {
  // router.push(`/artist/${id}`)
  console.log('Go to artist:', id)
}

watch(activeTab, () => {
    fetchData()
})

watch(() => userStore.playlistChanged, () => {
    refreshData()
})

onMounted(() => {
  fetchData()
})
onUnmounted(() => { clearInterval(bannerTimer) })
</script>

<template>
  <main class="content">
    <div class="content-header">
      <div class="tab-nav">
        <span class="tab-item" :class="{ active: activeTab === 'recommend' }" @click="activeTab = 'recommend'">个性推荐</span>
        <span class="tab-item" :class="{ active: activeTab === 'playlist' }" @click="activeTab = 'playlist'">歌单</span>
        <span class="tab-item" :class="{ active: activeTab === 'rank' }" @click="activeTab = 'rank'">排行榜</span>
        <span class="tab-item" :class="{ active: activeTab === 'artist' }" @click="activeTab = 'artist'">歌手</span>
        <span class="tab-item" :class="{ active: activeTab === 'new' }" @click="activeTab = 'new'">最新音乐</span>
      </div>
      <div class="refresh-btn" @click="refreshData" :class="{ spinning: refreshing }" title="刷新">
        <RefreshCw :size="16" />
      </div>
    </div>
    
    <div class="scroll-content">
      <!-- Loading Indicator -->
      <div v-if="loading && !banners.length" class="loading-state">
         加载中...
      </div>

      <!-- Banner Carousel -->
      <section v-if="activeTab === 'recommend'" class="banner-section">
        <div class="banner-container" @mouseenter="stopBannerAuto" @mouseleave="startBannerAuto">
          <Transition name="banner-fade" mode="out-in">
            <img v-if="banners.length > 0" :key="currentBanner" :src="banners[currentBanner].imageUrl" alt="Banner" class="banner-img" />
            <img v-else key="fallback" src="https://p1.music.126.net/6y-U6QnSjd_5419m1B0R_g==/109951165034938831.jpg" alt="Banner" class="banner-img" />
          </Transition>
          <div v-if="banners.length > 1" class="banner-arrows">
            <div class="banner-arrow left" @click="prevBanner"><ChevronLeft :size="24" /></div>
            <div class="banner-arrow right" @click="nextBanner"><ChevronRight :size="24" /></div>
          </div>
          <div class="banner-dots" v-if="banners.length > 1">
            <span v-for="(b, index) in banners" :key="index" class="dot" :class="{ active: index === currentBanner }" @click="currentBanner = index"></span>
          </div>
        </div>
      </section>

      <!-- Recommendation Tab Content -->
      <template v-if="activeTab === 'recommend'">
        <section class="recommend-section">
          <h2 class="section-title">推荐歌单 <ChevronRight :size="20" /></h2>
          <div class="playlist-grid">
            <div class="playlist-card">
              <div class="card-cover daily-recommend" @click="console.log('Daily Recommend')">
                <div class="daily-date">
                  <div class="day">{{ new Date().getDate() }}</div>
                </div>
                <div class="play-btn">
                  <Play :size="16" fill="#EC4141" color="#EC4141" />
                </div>
              </div>
              <div class="card-title">每日歌曲推荐</div>
            </div>
            <div v-for="item in playlists" :key="item.id" class="playlist-card" @click="goToPlaylist(item.id)">
              <div class="card-cover">
                <div class="play-count">
                  <Play :size="12" fill="white" /> {{ (item.playCount / 10000).toFixed(1) }}万
                </div>
                <img :src="item.picUrl" class="cover-img" />
                <div class="play-btn">
                  <Play :size="16" fill="#EC4141" color="#EC4141" />
                </div>
              </div>
              <div class="card-title">{{ item.name }}</div>
            </div>
          </div>
        </section>

        <section class="new-songs-section">
          <h2 class="section-title">最新音乐 <ChevronRight :size="20" /></h2>
          <div class="new-songs-grid">
            <div v-for="(item, index) in newSongs" :key="item.id" class="song-item" @click="playerStore.playSong(item, newSongs)">
              <div class="song-rank">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</div>
              <div class="song-thumb">
                <img :src="item.picUrl" />
                <div class="thumb-play">
                  <Play :size="10" fill="#EC4141" color="#EC4141" />
                </div>
              </div>
              <div class="song-info-mini" v-if="item.song">
                <div class="mini-name">{{ item.name }}</div>
                <div class="mini-artist">{{ item.song.artists ? item.song.artists.map(a => a.name).join('/') : '未知歌手' }}</div>
              </div>
              <div class="song-info-mini" v-else>
                <div class="mini-name">{{ item.name }}</div>
                <div class="mini-artist">{{ item.artists ? item.artists.map(a => a.name).join('/') : '未知歌手' }}</div>
              </div>
            </div>
          </div>
        </section>
      </template>

      <!-- Playlist Tab Content -->
      <template v-else-if="activeTab === 'playlist'">
        <section class="playlist-section">
            <div class="playlist-grid">
                <div v-for="item in playlists" :key="item.id" class="playlist-card" @click="goToPlaylist(item.id)">
                    <div class="card-cover">
                        <div class="play-count">
                            <Play :size="12" fill="white" /> {{ (item.playCount / 10000).toFixed(1) }}万
                        </div>
                        <img :src="item.coverImgUrl" class="cover-img" />
                        <div class="play-btn">
                            <Play :size="16" fill="#EC4141" color="#EC4141" />
                        </div>
                    </div>
                    <div class="card-title">{{ item.name }}</div>
                </div>
            </div>
        </section>
      </template>

      <!-- Rank Tab Content -->
      <template v-else-if="activeTab === 'rank'">
        <section class="rank-section">
            <h2 class="section-title">官方榜</h2>
            <div class="rank-grid">
                <div v-for="item in rankLists.slice(0, 4)" :key="item.id" class="rank-card" @click="goToPlaylist(item.id)">
                    <div class="rank-cover">
                        <img :src="item.coverImgUrl" />
                        <div class="play-btn">
                            <Play :size="20" fill="#EC4141" color="#EC4141" />
                        </div>
                    </div>
                    <div class="rank-details">
                        <div v-for="(track, idx) in item.tracks" :key="idx" class="rank-track">
                             <span class="idx">{{ idx + 1 }}</span>
                             <span class="name">{{ track.first }}</span>
                             <span class="artist">- {{ track.second }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
      </template>

      <!-- Artist Tab Content -->
      <template v-else-if="activeTab === 'artist'">
        <section class="artist-section">
            <div class="artist-grid">
                <div v-for="item in artists" :key="item.id" class="artist-card" @click="goToArtist(item.id)">
                    <div class="artist-avatar">
                        <img :src="item.img1v1Url || item.picUrl" />
                    </div>
                    <div class="artist-name">{{ item.name }}</div>
                </div>
            </div>
        </section>
      </template>

      <!-- New Music Tab Content -->
      <template v-else-if="activeTab === 'new'">
        <section class="new-music-section">
            <div class="new-songs-grid">
                 <div v-for="(item, index) in newSongs" :key="item.id" class="song-item" @click="playerStore.playSong(item, newSongs)">
                    <div class="song-rank">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</div>
                    <div class="song-thumb">
                        <img :src="item.album?.picUrl || item.picUrl" />
                        <div class="thumb-play">
                            <Play :size="10" fill="#EC4141" color="#EC4141" />
                        </div>
                    </div>
                    <div class="song-info-mini">
                        <div class="mini-name">{{ item.name }}</div>
                        <div class="mini-artist">{{ item.artists ? item.artists.map(a => a.name).join('/') : (item.ar ? item.ar.map(a => a.name).join('/') : '未知歌手') }}</div>
                    </div>
                </div>
            </div>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.content {
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-main);
  display: flex;
  flex-direction: column;
}

.content-header {
  padding: 20px 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tab-nav {
  display: flex;
  gap: 25px;
  border-bottom: 2px solid transparent;
}

.tab-item {
  font-size: 16px;
  cursor: pointer;
  color: #333;
  padding-bottom: 5px;
  transition: all 0.2s;
  position: relative;
}

.tab-item:hover {
  color: var(--primary-color);
}

.tab-item.active {
  font-size: 18px;
  font-weight: bold;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 10%;
  width: 80%;
  height: 3px;
  background-color: var(--primary-color);
  border-radius: 2px;
}

.refresh-btn {
  cursor: pointer;
  color: #666;
  padding: 6px;
  border-radius: 50%;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.refresh-btn:hover {
  color: var(--primary-color);
  background: rgba(0,0,0,0.05);
}

.refresh-btn.spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 30px 40px;
}

.loading-state {
    text-align: center;
    padding: 40px;
    color: #999;
}

.banner-section {
  margin-bottom: 30px;
}

.banner-container {
  width: 100%;
  height: 200px;
  position: relative;
  overflow: hidden;
  border-radius: 10px;
}

.banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.banner-dots {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 2;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: rgba(255,255,255,0.4);
  cursor: pointer;
  transition: all 0.3s;
}
.dot:hover { background-color: rgba(255,255,255,0.8); }

.dot.active {
  background-color: var(--primary-color);
  width: 16px;
  border-radius: 3px;
}

.banner-arrows {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  justify-content: space-between;
  padding: 0 10px;
  pointer-events: none;
  z-index: 2;
}
.banner-arrow {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0,0,0,0.3);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 0.3s;
}
.banner-container:hover .banner-arrow { opacity: 1; }
.banner-arrow:hover { background: rgba(0,0,0,0.6); }

.banner-fade-enter-active, .banner-fade-leave-active { transition: opacity 0.4s ease; }
.banner-fade-enter-from, .banner-fade-leave-to { opacity: 0; }

.section-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 20px;
  margin-bottom: 30px;
}

.playlist-card {
  cursor: pointer;
}

.card-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}

.daily-recommend {
  background: linear-gradient(135deg, #FF5E5E, #FF2E2E);
  display: flex;
  align-items: center;
  justify-content: center;
}

.daily-date {
  color: white;
  text-align: center;
}

.daily-date .day {
  font-size: 40px;
  font-weight: bold;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.playlist-card:hover .cover-img {
  transform: scale(1.05);
}

.play-count {
  position: absolute;
  top: 5px;
  right: 8px;
  color: white;
  font-size: 12px;
  z-index: 1;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  gap: 2px;
}

.play-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  background-color: rgba(255,255,255,0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
}

.playlist-card:hover .play-btn {
  opacity: 1;
  transform: translateY(0);
}

.card-title {
  font-size: 14px;
  line-height: 1.4;
  height: 40px;
  margin-top: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: #333;
}

.new-songs-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}

.song-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.song-item:hover {
  background-color: #f5f5f5;
}

.song-rank {
  font-size: 13px;
  color: #999;
  width: 20px;
}

.song-thumb {
  width: 50px;
  height: 50px;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.song-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  background: rgba(255,255,255,0.8);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.song-info-mini {
  flex: 1;
  overflow: hidden;
}

.mini-name {
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-artist {
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Rank section styles */
.rank-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
}

.rank-card {
    display: flex;
    gap: 30px;
    padding: 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s;
}

.rank-card:hover {
    background: #f9f9f9;
}

.rank-cover {
    width: 150px;
    height: 150px;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
}

.rank-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.rank-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 15px;
}

.rank-track {
    font-size: 14px;
    display: flex;
    gap: 10px;
    align-items: center;
}

.rank-track .idx {
    font-weight: bold;
    color: var(--primary-color);
}

.rank-track .artist {
    color: #999;
    font-size: 12px;
}

/* Artist section styles */
.artist-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 20px;
}

.artist-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    cursor: pointer;
}

.artist-avatar {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid #eee;
}

.artist-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.artist-card:hover img {
    transform: scale(1.1);
}

.artist-name {
    font-size: 14px;
    color: #333;
}
</style>
