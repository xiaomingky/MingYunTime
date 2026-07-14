<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { Play, Cloud, Music, ExternalLink, RefreshCw, GripVertical } from 'lucide-vue-next'
import { getCloudSongs, reorderCloudSongs } from '../api'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { useUserStore } from '../store/user'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const userStore = useUserStore()

const allSongs = ref([])
const currentCategory = ref('')
const loading = ref(false)

const categories = computed(() => {
    const set = new Set(allSongs.value.map(s => s.category).filter(Boolean))
    return Array.from(set).sort()
})

const songs = computed(() => {
    if (!currentCategory.value) return allSongs.value
    return allSongs.value.filter(s => s.category === currentCategory.value)
})

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
            allSongs.value = res.songs
            if (currentCategory.value && !categories.value.includes(currentCategory.value)) {
                currentCategory.value = ''
            }
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
    const url = `${import.meta.env.VITE_CLOUD_BASE_URL}?userId=${userId}`
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

// 拖拽排序
const dragFromIndex = ref(-1)
const dragOverIndex = ref(-1)

const resetDrag = () => {
    dragFromIndex.value = -1
    dragOverIndex.value = -1
}

const onDragStart = (index, e) => {
    dragFromIndex.value = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
}

const onDragOver = (index, e) => {
    e.preventDefault()
    dragOverIndex.value = index
}

const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
        dragOverIndex.value = -1
    }
}

const onDrop = async (index, e) => {
    e.preventDefault()
    const from = dragFromIndex.value
    if (from === -1 || from === index) {
        resetDrag()
        return
    }

    const visible = [...songs.value]
    const [moved] = visible.splice(from, 1)
    visible.splice(index, 0, moved)

    let moves
    if (!currentCategory.value) {
        // 全部分类：直接按可见顺序赋值 sort_order
        moves = visible.map((s, i) => ({ id: s.id, sortOrder: i }))
    } else {
        // 单个分类：用最大 sort_order 之后的区间，避免打乱其他分类
        const maxSort = Math.max(0, ...allSongs.value.map(s => s.sortOrder || 0))
        moves = visible.map((s, i) => ({ id: s.id, sortOrder: maxSort + 1 + i }))
    }

    try {
        const res = await reorderCloudSongs(moves)
        if (res.success) {
            messageStore.success('排序已保存')
            await fetchSongs(true)
        } else {
            messageStore.error(res.message || '排序保存失败')
        }
    } catch (err) {
        console.error('Reorder cloud songs error:', err)
        messageStore.error('排序保存失败，请检查后端服务')
    } finally {
        resetDrag()
    }
}

const onDragEnd = () => resetDrag()

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
      <div v-else-if="allSongs.length === 0" class="empty-state">
        暂无云音乐，请登录后端网站上传
      </div>
      <div v-else>
        <div v-if="categories.length > 0" class="category-tabs">
          <button
            class="category-tab"
            :class="{ active: currentCategory === '' }"
            @click="currentCategory = ''"
          >
            全部
          </button>
          <button
            v-for="cat in categories"
            :key="cat"
            class="category-tab"
            :class="{ active: currentCategory === cat }"
            @click="currentCategory = cat"
          >
            {{ cat }}
          </button>
        </div>
        <div v-if="songs.length === 0" class="empty-state">该分类下暂无歌曲</div>
        <div v-else class="song-list">
        <div
          v-for="(song, index) in songs"
          :key="song.id"
          class="song-row"
          :class="{ dragging: dragFromIndex === index, 'drag-over': dragOverIndex === index && dragFromIndex !== index }"
          @dblclick="playSong(song)"
          @dragover.prevent="onDragOver(index, $event)"
          @drop.prevent="onDrop(index, $event)"
          @dragleave="onDragLeave"
        >
          <div class="drag-handle" draggable="true" @dragstart.stop="onDragStart(index, $event)" @dragend.stop="onDragEnd">
            <GripVertical :size="16" />
          </div>
          <img v-if="song.coverUrl" :src="song.coverUrl" class="song-cover" />
          <div v-else class="song-cover placeholder">
            <Music :size="20" />
          </div>
          <div class="song-info">
            <div class="song-name">
              {{ song.name }}
              <span v-if="song.category" class="category-tag">{{ song.category }}</span>
            </div>
            <div class="song-meta">{{ song.artist }} · {{ formatDuration(song.duration) }}</div>
          </div>
          <button class="play-btn" @click="playSong(song)">
            <Play :size="18" />
          </button>
        </div>
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
.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  padding: 0 2px;
}
.category-tab {
  padding: 6px 14px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.08);
  background: rgba(255,255,255,0.7);
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.category-tab:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.category-tab.active {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.25);
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
.song-row.dragging {
  opacity: 0.45;
}
.song-row.drag-over {
  border-top: 2px solid var(--primary-color);
}
.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ccc;
  cursor: grab;
  user-select: none;
  margin-left: -6px;
}
.drag-handle:active {
  cursor: grabbing;
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
.category-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(236, 65, 65, 0.1);
  color: var(--primary-color);
  font-size: 10px;
  font-weight: 500;
  margin-left: 6px;
  vertical-align: middle;
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
