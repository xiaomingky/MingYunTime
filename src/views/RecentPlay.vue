<script setup>
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { Play, Trash2 } from 'lucide-vue-next'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const formatTime = (seconds) => {
  if (!seconds) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const clearRecent = async () => {
    if (await messageStore.confirm('确定要清空最近播放记录吗？', '清空记录')) {
        playerStore.recentSongs = []
        localStorage.setItem('recent_songs', '[]')
    }
}
</script>

<template>
  <div class="recent-play-view">
    <div class="view-header">
      <div class="title-row">
        <h1 class="title">最近播放</h1>
        <span class="count">共 {{ playerStore.recentSongs.length }} 首</span>
      </div>
      <div class="actions">
        <button class="play-all-btn" @click="playerStore.playSong(playerStore.recentSongs[0], playerStore.recentSongs)">
          <Play :size="16" fill="white" /> 播放全部
        </button>
        <button class="clear-btn" @click="clearRecent">
          <Trash2 :size="16" /> 清空列表
        </button>
      </div>
    </div>

    <div class="track-list">
      <div class="list-header">
        <div class="col-index">#</div>
        <div class="col-title">标题</div>
        <div class="col-artist">歌手</div>
        <div class="col-album">专辑</div>
        <div class="col-duration">时长</div>
      </div>
      
      <div 
        v-for="(song, index) in playerStore.recentSongs" 
        :key="song.id" 
        class="track-item"
        :class="{ active: playerStore.currentSong.id === song.id }"
        @dblclick="playerStore.playSong(song, playerStore.recentSongs)"
      >
        <div class="col-index">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</div>
        <div class="col-title">
          <span class="song-name text-truncate">{{ song.name }}</span>
        </div>
        <div class="col-artist text-truncate">{{ song.artist }}</div>
        <div class="col-album text-truncate">{{ song.al?.name || '未知专辑' }}</div>
        <div class="col-duration">{{ formatTime(song.duration) }}</div>
      </div>
      
      <div v-if="playerStore.recentSongs.length === 0" class="empty-state">
        暂无播放记录
      </div>
    </div>
  </div>
</template>

<style scoped>
.recent-play-view {
  padding: 30px;
  flex: 1;
  overflow-y: auto;
}

.view-header {
  margin-bottom: 30px;
}

.title-row {
    display: flex;
    align-items: baseline;
    gap: 15px;
    margin-bottom: 20px;
}

.title {
  font-size: 24px;
  font-weight: bold;
}

.count {
    color: #999;
    font-size: 14px;
}

.actions {
    display: flex;
    gap: 15px;
}

.play-all-btn {
    background-color: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
}

.clear-btn {
    background: none;
    border: 1px solid #ddd;
    padding: 8px 16px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
    color: #666;
}

.clear-btn:hover {
    background-color: #f5f5f5;
}

.track-list {
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  padding: 10px;
  color: #999;
  font-size: 13px;
  border-bottom: 1px solid #eee;
}

.track-item {
  display: flex;
  padding: 10px;
  align-items: center;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
}

.track-item:hover {
  background-color: #f5f5f5;
}

.track-item.active {
    color: var(--primary-color);
    background-color: #fafafa;
}

.col-index { width: 40px; color: #999; }
.col-title { flex: 3; display: flex; align-items: center; gap: 8px; min-width: 0; }
.col-artist { flex: 2; min-width: 0; padding-right: 10px; }
.col-album { flex: 2; min-width: 0; padding-right: 10px; color: #666; }
.col-duration { width: 60px; color: #999; }

.text-truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
    text-align: center;
    padding: 100px 0;
    color: #999;
}
</style>
