<script setup>
import { ref } from 'vue'
import { usePlayerStore } from '../store/player'
import { FolderOpen, Play, Trash2, FolderPlus, Film, Clock } from 'lucide-vue-next'
import { useMessageStore } from '../store/message'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const loading = ref(false)
const localVideos = ref(JSON.parse(localStorage.getItem('local_videos') || '[]'))

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler

const saveVideos = () => {
    localStorage.setItem('local_videos', JSON.stringify(localVideos.value))
}

const importFiles = async () => {
    const bridge = getBridge()
    if (!bridge?.openVideoFileDialog) { messageStore.error('Bridge 未加载'); return }
    try {
        const videos = await bridge.openVideoFileDialog()
        if (videos?.length > 0) {
            const existing = new Set(localVideos.value.map(v => v.path))
            localVideos.value.push(...videos.filter(v => !existing.has(v.path)))
            saveVideos()
        }
    } catch (err) { messageStore.error('导入失败: ' + err.message) }
}

const importFolder = async () => {
    const bridge = getBridge()
    if (!bridge?.openVideoDirectoryDialog) { messageStore.error('接口未就绪'); return }
    try {
        loading.value = true
        const videos = await bridge.openVideoDirectoryDialog()
        if (videos?.length > 0) {
            const existing = new Set(localVideos.value.map(v => v.path))
            localVideos.value.push(...videos.filter(v => !existing.has(v.path)))
            saveVideos()
            messageStore.success(`成功识别 ${videos.length} 个视频`)
        } else { messageStore.info('未找到支持的视频文件') }
    } catch (err) { messageStore.error('导入文件夹失败') }
    finally { loading.value = false }
}

const playVideo = (video) => {
    playerStore.currentSong = {
        id: video.id,
        name: video.name,
        artist: video.format || '本地视频',
        al: { name: '本地视频', picUrl: '' },
        duration: video.duration / 1000 || 0,
        url: video.url,
        path: video.path
    }
    playerStore.currentMvUrl = video.url
    playerStore.currentMvId = null
    playerStore.showMvPlayer = true
    if (playerStore.isPlaying) {
        playerStore.audio.pause()
        playerStore.isPlaying = false
    }
}

const removeVideo = async (video) => {
    if (await messageStore.confirm(`确定要移除 "${video.name}" 吗？`, '移除视频')) {
        localVideos.value = localVideos.value.filter(v => v.path !== video.path)
        saveVideos()
    }
}

const formatSize = (bytes) => {
    if (!bytes) return '0 MB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const formatTime = (ms) => {
    if (!ms) return '--:--'
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="local-video-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="title">本地视频</h1>
        <span class="count">共 {{ localVideos.length }} 个</span>
      </div>
      <div class="actions">
        <button class="import-btn" @click="importFiles">
          <FolderOpen :size="16" /> 添加文件
        </button>
        <button class="import-btn" @click="importFolder" :disabled="loading">
          <FolderPlus :size="16" /> {{ loading ? '扫描中...' : '添加文件夹' }}
        </button>
      </div>
    </div>

    <div class="video-grid" v-if="localVideos.length > 0">
      <div
        v-for="video in localVideos"
        :key="video.path"
        class="video-card"
        @dblclick="playVideo(video)"
      >
        <div class="card-poster" @click="playVideo(video)">
          <Film :size="40" class="poster-icon" />
          <div class="play-overlay"><Play :size="28" fill="white" /></div>
        </div>
        <div class="card-info">
          <span class="card-name" :title="video.name">{{ video.name }}</span>
          <span class="card-meta">{{ video.format }} · {{ formatSize(video.size) }}</span>
          <span class="card-dur"><Clock :size="10" /> {{ formatTime(video.duration) }}</span>
        </div>
        <button class="card-remove" title="移除" @click.stop="removeVideo(video)">
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <div v-else class="empty-state">
      <Film :size="48" />
      <p>还没有添加本地视频</p>
      <button class="import-link" @click="importFiles">立即添加</button>
    </div>
  </div>
</template>

<style scoped>
.local-video-view {
  padding: 30px;
  flex: 1;
  overflow-y: auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.header-left { display: flex; align-items: baseline; gap: 15px; }
.title { font-size: 24px; font-weight: bold; }
.count { color: #999; font-size: 14px; }

.actions { display: flex; gap: 12px; }

.import-btn {
  background: #fff;
  border: 1px solid #ddd;
  padding: 8px 16px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  transition: all 0.2s;
}

.import-btn:hover:not(:disabled) { background-color: #f5f5f5; border-color: #ccc; }
.import-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Grid */
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.video-card {
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #eee;
  transition: all 0.2s;
  position: relative;
}

.video-card:hover {
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  transform: translateY(-2px);
}

.card-poster {
  aspect-ratio: 16/9;
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
}

.poster-icon { color: rgba(255,255,255,0.15); }

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  opacity: 0;
  transition: opacity 0.2s;
}

.card-poster:hover .play-overlay { opacity: 1; }

.card-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-meta { font-size: 11px; color: #999; }
.card-dur { font-size: 11px; color: #bbb; display: flex; align-items: center; gap: 3px; }

.card-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0,0,0,0.5);
  border: none;
  color: white;
  padding: 4px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
}

.video-card:hover .card-remove { opacity: 1; }
.card-remove:hover { background: #e81123; }

.empty-state {
  text-align: center;
  padding: 100px 0;
  color: #ccc;
}

.empty-state p { margin: 15px 0 0; font-size: 16px; color: #999; }

.import-link {
  margin-top: 15px;
  color: var(--primary-color);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  font-size: 14px;
}
</style>
