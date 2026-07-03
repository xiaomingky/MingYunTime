<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { Play, Cloud, Music, ExternalLink, RefreshCw } from 'lucide-vue-next'
import { getCloudSongs } from '../api'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { useUserStore } from '../store/user'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const userStore = useUserStore()

const songs = ref([])
const loading = ref(false)

const canFetchCloud = () => {
    // 必须有同步令牌；若已上锁，则必须通过密码验证
    return userStore.lockStatus.token && (!userStore.lockStatus.locked || userStore.lockStatus.unlocked)
}

const fetchSongs = async (skipLockCheck = false) => {
    if (!userStore.lockStatus.token) {
        return messageStore.warning('账号未同步，请重新登录')
    }
    // 手动刷新按钮可跳过密码锁验证；页面自动加载仍受锁保护
    if (!skipLockCheck && !userStore.lockStatus.unlocked && userStore.lockStatus.locked) {
        return messageStore.warning('请先验证账号密码锁')
    }
    loading.value = true
    try {
        const res = await getCloudSongs()
        if (res.songs) {
            songs.value = res.songs
        } else if (res.message) {
            messageStore.error(res.message)
        }
    } catch (e) {
        console.error('Fetch cloud songs error:', e)
        messageStore.error('获取云音乐失败，请检查后端服务')
    } finally {
        loading.value = false
    }
}

const toTrack = (song) => ({
    id: `cloud-${song.id}`,
    name: song.name,
    artist: song.artist,
    al: { picUrl: song.coverUrl || '' },
    picUrl: song.coverUrl || '',
    url: song.url,
    dt: song.duration * 1000,
    ar: [{ name: song.artist }],
    lyricUrl: song.lyricUrl || '',
    duration: song.duration
})

const tracks = computed(() => songs.value.map(toTrack))

const playSong = (song) => {
    const track = toTrack(song)
    playerStore.playSong(track, tracks.value)
}

const getBridge = () => {
    return window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer || window.electron
}

const openAdmin = () => {
    const userId = userStore.profile?.userId || ''
    const url = `https://music-admin.xiaomingky.cn?userId=${userId}`
    const b = getBridge()
    if (b && b.send) {
        b.send('open-external', url)
    } else {
        window.open(url, '_blank')
    }
}

const formatDuration = (seconds) => {
    if (!seconds) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

onMounted(() => {
    if (userStore.isLoggedIn && canFetchCloud()) {
        fetchSongs()
    }
})

// 账号同步或密码验证完成后自动加载，避免 token 未就绪时请求导致 401
watch(
    [() => userStore.lockStatus.token, () => userStore.lockStatus.locked, () => userStore.lockStatus.unlocked],
    () => {
        if (userStore.isLoggedIn && canFetchCloud()) {
            fetchSongs()
        }
    }
)

defineExpose({ refreshData: fetchSongs })
</script>

<template>
  <main class="content">
    <div class="content-header">
      <div class="title-row">
        <Cloud :size="24" />
        <h2>我的云音乐</h2>
      </div>
      <div class="header-actions">
        <button class="icon-btn refresh-btn" title="刷新" @click="fetchSongs(true)" :disabled="loading">
          <RefreshCw :size="16" :class="{ spinning: loading }" />
        </button>
        <button class="manage-btn" @click="openAdmin">
          <ExternalLink :size="14" />
          去后台管理
        </button>
      </div>
    </div>

    <div class="scroll-content">
      <div v-if="!userStore.isLoggedIn" class="empty-state">请先登录网易云账号</div>
      <div v-else-if="loading && songs.length === 0" class="empty-state">加载中...</div>
      <div v-else-if="songs.length === 0" class="empty-state">
        暂无云音乐，请登录后端网站上传
      </div>
      <div v-else class="song-list">
        <div v-for="song in songs" :key="song.id" class="song-row" @dblclick="playSong(song)">
          <img v-if="song.coverUrl" :src="song.coverUrl" class="song-cover" />
          <div v-else class="song-cover placeholder">
            <Music :size="20" />
          </div>
          <div class="song-info">
            <div class="song-name">{{ song.name }}</div>
            <div class="song-meta">{{ song.artist }} · {{ formatDuration(song.duration) }}</div>
          </div>
          <button class="play-btn" @click="playSong(song)">
            <Play :size="18" />
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.content {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-main);
}
.content-header {
  padding: 20px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.manage-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 20px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.05);
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}
.icon-btn:hover:not(:disabled) {
  background: rgba(0,0,0,0.1);
  color: #333;
}
.icon-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 30px 30px;
}
.empty-state {
  text-align: center;
  padding: 60px 0;
  color: #999;
  font-size: 14px;
}
.song-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.song-row {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  padding: 12px 16px;
  border-radius: 10px;
  transition: background 0.2s;
}
.song-row:hover {
  background: #f9f9f9;
}
.song-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
}
.song-cover.placeholder {
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}
.song-info {
  flex: 1;
  min-width: 0;
}
.song-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}
.song-meta {
  font-size: 12px;
  color: #999;
}
.play-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ff6b6b, var(--primary-color));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(236, 65, 65, 0.35);
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.play-btn:hover {
  transform: scale(1.12) rotate(5deg);
  box-shadow: 0 6px 18px rgba(236, 65, 65, 0.45);
}
.play-btn:active {
  transform: scale(0.95);
}
</style>
