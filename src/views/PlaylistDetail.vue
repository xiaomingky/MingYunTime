<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request, { getCommentPlaylist, playlistTracks } from '../api'
import { usePlayerStore } from '../store/player'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'

const userStore = useUserStore()
const messageStore = useMessageStore()
import { Play, Heart, Share2, Download, Search, Clock, Edit, Trash2, Camera, X } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const playlist = ref(null)
const tracks = ref([])
const loading = ref(false)

const fetchDetail = async () => {
    const id = route.params.id
    if (!id) return
    loading.value = true

    try {
        const res = await request.get('/playlist/detail', { params: { id, timestamp: Date.now() } })
        if (res && res.playlist) {
            playlist.value = res.playlist
            if (res.playlist.tracks && res.playlist.tracks.length > 0) {
                tracks.value = res.playlist.tracks
            } else {
                const trackRes = await request.get('/playlist/track/all', {
                    params: { id, limit: 1000, timestamp: Date.now() }
                })
                if (trackRes && trackRes.songs) tracks.value = trackRes.songs
            }
        } else {
            console.error('--- [Detail] API returned no playlist object:', res)
        }
    } catch (error) {
        console.error('Fetch playlist error:', error)
    } finally {
        loading.value = false
    }
}

watch(() => route.params.id, (newId) => {
  if (newId) fetchDetail()
}, { immediate: true })

const formatTime = (ms) => {
  const seconds = ms / 1000
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const toggleLike = async (track) => {
    if (!userStore.isLoggedIn) return messageStore.warning('请先登录后收藏')
    const isLiked = userStore.isSongLiked(track.id)
    try {
        const res = await request.get('/like', { 
            params: { id: track.id, like: !isLiked, timestamp: Date.now() } 
        })
        if (res.code === 200) {
            userStore.toggleLike(track.id, !isLiked)
            // If it's the current playing song, sync playerStore state too
            if (playerStore.currentSong.id === track.id) {
                playerStore.isLiked = !isLiked
            }
        }
    } catch (e) {
        console.error('Toggle like fail:', e)
    }
}

const selectMode = ref(false)
const selectedIds = ref([])
const toggleSelect = (track) => {
    const idx = selectedIds.value.indexOf(track.id)
    if (idx === -1) selectedIds.value.push(track.id)
    else selectedIds.value.splice(idx, 1)
}
const batchRemoveTracks = async () => {
    if (!selectedIds.value.length || !playlist.value) return
    if (!await messageStore.confirm(`确定要移除选中的 ${selectedIds.value.length} 首歌曲吗？`, '移除歌曲')) return
    const pid = playlist.value.id
    let done = 0
    for (const tid of selectedIds.value) {
        try {
            const res = await playlistTracks('del', pid, tid)
            if (res.code === 200) done++
        } catch (e) {}
    }
    tracks.value = tracks.value.filter(t => !selectedIds.value.includes(t.id))
    if (playlist.value) playlist.value.trackCount = tracks.value.length
    messageStore.success(`已移除 ${done} 首`)
    selectedIds.value = []
    selectMode.value = false
}

const activeTab = ref('tracks')
const comments = ref([])
const playlistCommentsCount = ref(0)
const commentsLoading = ref(false)

const fetchComments = async () => {
    if (!playlist.value?.id) return
    commentsLoading.value = true
    try {
        const res = await getCommentPlaylist(playlist.value.id)
        comments.value = res.hotComments || res.comments || []
        playlistCommentsCount.value = res.total || 0
    } catch (err) {
        console.error('Fetch playlist comments error:', err)
    } finally {
        commentsLoading.value = false
    }
}

const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

watch(activeTab, (val) => {
    if (val === 'comments' && !comments.value.length) {
        fetchComments()
    }
})

const isSubscribed = computed(() => {
    if (!playlist.value || !userStore.isLoggedIn) return false
    return userStore.playlists.some(p => Number(p.id) === Number(playlist.value.id))
})

const toggleSubscribe = async () => {
    if (!userStore.isLoggedIn) return messageStore.warning('请先登录后操作')
    const sub = !isSubscribed.value
    const success = await userStore.handleSubscribe(playlist.value.id, sub)
    if (success) {
        // Force refresh user playlists to ensure sidebar and header are updated
        await userStore.fetchUserPlaylists(userStore.profile.userId)
        
        if (sub) {
            playlist.value.subscribedCount++
        } else {
            playlist.value.subscribedCount = Math.max(0, playlist.value.subscribedCount - 1)
        }
        messageStore.success(sub ? '收藏成功' : '已取消收藏')
    } else {
        messageStore.error(sub ? '收藏失败' : '取消收藏失败')
    }
}

// Playlist Management
const showEditModal = ref(false)
const editForm = ref({ name: '', desc: '' })
const isOwner = computed(() => {
    return playlist.value?.creator?.userId === userStore.profile?.userId
})

const openEditModal = () => {
    editForm.value = { 
        name: playlist.value.name, 
        desc: playlist.value.description || '' 
    }
    showEditModal.value = true
}

const handleUpdatePlaylist = async () => {
    if (!editForm.value.name.trim()) return
    const success = await userStore.updatePlaylistInfo(playlist.value.id, editForm.value.name, editForm.value.desc)
    if (success) {
        playlist.value.name = editForm.value.name
        playlist.value.description = editForm.value.desc
        messageStore.success('歌单修改成功')
        showEditModal.value = false
    } else {
        messageStore.error('修改失败')
    }
}

const handleDeletePlaylist = async () => {
    if (!await messageStore.confirm('确定要删除这个歌单吗？', '删除歌单')) return
    const success = await userStore.deletePlaylist(playlist.value.id)
    if (success) {
        messageStore.success('歌单已删除')
        router.push('/')
    } else {
        messageStore.error('删除失败')
    }
}

const fileInput = ref(null)
const triggerCoverUpload = () => {
    fileInput.value?.click()
}
const handleCoverChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return messageStore.warning('封面不能大于 2MB')
    
    const success = await userStore.updatePlaylistCover(playlist.value.id, file)
    if (success) {
        messageStore.success('封面更新成功')
        fetchDetail() // Refresh to see original cover change
    } else {
        messageStore.error('封面更新失败')
    }
}
</script>

<template>
  <div class="playlist-detail">
    <div v-if="loading && !playlist" class="loading">加载中...</div>
    <div v-show="playlist">
        <div v-if="loading" class="refresh-bar">刷新中...</div>
        <div class="detail-header">
            <div class="cover-wrapper" :class="{ owner: isOwner }" @click="isOwner && triggerCoverUpload()">
                <img :src="playlist.coverImgUrl" class="cover-img" />
                <div v-if="isOwner" class="cover-edit-overlay">
                    <Camera :size="24" color="white" />
                    <span>更换封面</span>
                </div>
                <input type="file" ref="fileInput" hidden accept="image/*" @change="handleCoverChange" />
            </div>
            <div class="info">
                <div class="title-row">
                <span class="tag">歌单</span>
                <h1 class="playlist-info-title">{{ playlist.name }}</h1>
                <Edit v-if="isOwner" :size="18" class="edit-icon clickable" @click="openEditModal" />
                </div>
                <div class="creator-row" v-if="playlist.creator">
                <img :src="playlist.creator.avatarUrl" class="avatar" v-if="playlist.creator.avatarUrl" />
                <span class="name">{{ playlist.creator.nickname }}</span>
                <span class="time">{{ new Date(playlist.createTime).toLocaleDateString() }}创建</span>
                </div>
                <div class="actions">
                <button class="play-all" @click="playerStore.playSong(tracks[0], tracks)">
                    <Play :size="16" fill="white" /> 播放全部
                </button>
                <button class="action-btn" @click="toggleSubscribe">
                    <Heart :size="16" :fill="isSubscribed ? '#EC4141' : 'none'" :color="isSubscribed ? '#EC4141' : 'currentColor'" /> 
                    {{ isSubscribed ? '已收藏' : '收藏' }}({{ (playlist.subscribedCount / 10000).toFixed(1) }}万)
                </button>
                <button class="action-btn" v-if="isOwner" @click="selectMode = !selectMode">
                    <Trash2 :size="16" /> {{ selectMode ? '取消' : '移除歌曲' }}
                </button>
                <button v-if="selectMode && selectedIds.length > 0" class="play-all" style="background:#ff4d4f;" @click="batchRemoveTracks">
                    <Trash2 :size="16" fill="white" /> 删除选中 ({{ selectedIds.length }})
                </button>
                <button class="action-btn" @click="handleDeletePlaylist" v-if="isOwner">
                    <Trash2 :size="16" /> 删除歌单
                </button>
                <button class="action-btn"><Share2 :size="16" /> 分享({{ playlist.shareCount }})</button>
                </div>
                <div class="tags" v-if="playlist.tags && playlist.tags.length">
                标签：<span v-for="tag in playlist.tags" :key="tag" class="tag-item">{{ tag }}</span>
                </div>
                <div class="stats">
                歌曲：<span>{{ playlist.trackCount }}</span>
                播放：<span>{{ (playlist.playCount / 10000).toFixed(1) }}万</span>
                </div>
                <div class="desc" v-if="playlist.description">
                简介：<span>{{ playlist.description }}</span>
                </div>
            </div>
        </div>

        <div class="track-list-container">
            <div class="tabs">
                <span class="tab" :class="{ active: activeTab === 'tracks' }" @click="activeTab = 'tracks'">歌曲列表</span>
                <span class="tab" :class="{ active: activeTab === 'comments' }" @click="activeTab = 'comments'">
                    评论({{ playlist.commentCount || playlistCommentsCount }})
                </span>
                <span class="tab">收藏者</span>
            </div>
            
            <table v-show="activeTab === 'tracks'" class="track-table">
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
                <tr v-for="(track, index) in tracks" :key="track.id" @dblclick="playerStore.playSong(track, tracks)" class="track-row">
                    <td class="index-cell">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</td>
                    <td class="operation-cell">
                        <input v-if="selectMode" type="checkbox" :checked="selectedIds.includes(track.id)" @click.stop="toggleSelect(track)" class="track-checkbox" />
                        <Heart
                          :size="14"
                          class="icon clickable"
                          :class="{ 'text-red': playerStore.isLiked && playerStore.currentSong.id === track.id || userStore.isSongLiked(track.id) }"
                          :fill="(playerStore.isLiked && playerStore.currentSong.id === track.id || userStore.isSongLiked(track.id)) ? '#EC4141' : 'none'"
                          :color="(playerStore.isLiked && playerStore.currentSong.id === track.id || userStore.isSongLiked(track.id)) ? '#EC4141' : 'currentColor'"
                          @click.stop="toggleLike(track)"
                        />
                    </td>
                    <td class="title-cell" :title="track.name">
                        <div class="title-container">
                            <span class="name-text">{{ track.name }}</span>
                            <span v-if="track.fee === 1" class="vip-tag-mini">VIP</span>
                        </div>
                    </td>
                    <td class="artist-cell" :title="track.ar.map(a => a.name).join('/')">{{ track.ar.map(a => a.name).join('/') }}</td>
                    <td class="album-cell" :title="track.al.name">{{ track.al.name }}</td>
                    <td class="duration-cell">{{ formatTime(track.dt) }}</td>
                </tr>
                </tbody>
            </table>

            <!-- Playlist Comment Section -->
            <div v-show="activeTab === 'comments'" class="playlist-comments-view">
                <div v-if="commentsLoading" class="loading-small">加载评论中...</div>
                <div v-else class="comments-list">
                    <div v-for="comment in comments" :key="comment.commentId" class="comment-item">
                        <img :src="comment.user.avatarUrl" class="u-avatar" />
                        <div class="c-body">
                            <div class="c-user">
                                <span class="u-name">{{ comment.user.nickname }}:</span>
                                <span class="c-text">{{ comment.content }}</span>
                            </div>
                            <div v-if="comment.beReplied && comment.beReplied.length" class="c-replied">
                                <span class="u-name">@{{ comment.beReplied[0].user.nickname }}:</span>
                                {{ comment.beReplied[0].content }}
                            </div>
                            <div class="c-footer">
                                <span class="c-time">{{ formatDate(comment.time) }}</span>
                            </div>
                        </div>
                    </div>
                    <div v-if="!comments.length" class="no-data">暂无评论</div>
                </div>
            </div>
        </div>
    </div>
    <div v-else class="empty-state">
        <div class="empty-content">
            <Heart :size="64" color="#eee" />
            <p>{{ loading ? '努力加载中...' : '该歌单暂无内容或加载失败' }}</p>
            <button v-if="!loading" class="retry-btn" @click="fetchDetail">重新加载</button>
        </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click="showEditModal = false">
        <div class="custom-modal edit-modal" @click.stop>
            <div class="modal-header">
                <h3>编辑歌单信息</h3>
                <X :size="20" class="clickable" @click="showEditModal = false" />
            </div>
            <div class="modal-body">
                <div class="form-item">
                    <label>歌单名</label>
                    <input type="text" v-model="editForm.name" placeholder="请输入歌单名" />
                </div>
                <div class="form-item">
                    <label>简介</label>
                    <textarea v-model="editForm.desc" placeholder="请输入歌单简介" rows="4"></textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button class="cancel-btn clickable" @click="showEditModal = false">取消</button>
                <button class="save-btn clickable" @click="handleUpdatePlaylist" :disabled="!editForm.name.trim()">保存</button>
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.playlist-detail {
  padding: 30px;
  background-color: var(--bg-main);
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.loading {
    text-align: center;
    padding: 100px;
    color: #999;
}
.refresh-bar {
    text-align: center;
    padding: 6px;
    background: rgba(236,65,65,0.08);
    color: var(--primary-color);
    font-size: 12px;
    font-weight: 500;
}

.detail-header {
  display: flex;
  gap: 30px;
  margin-bottom: 30px;
}

.cover-img {
  width: 184px;
  height: 184px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid #eee;
  flex-shrink: 0;
}

.info {
  flex: 1;
  overflow: hidden;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.tag {
  color: var(--primary-color);
  border: 1px solid var(--primary-color);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 12px;
  white-space: nowrap;
}

.playlist-info-title {
  font-size: 24px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creator-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
  font-size: 13px;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.name {
  color: #507DAF;
  cursor: pointer;
}

.time {
  color: #999;
}

.actions {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.play-all {
  background-color: var(--primary-color);
  color: white;
  border: none;
  padding: 8px 15px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  white-space: nowrap;
}

.action-btn {
  background: white;
  border: 1px solid #ddd;
  padding: 8px 15px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.action-btn:hover {
  background: #f5f5f5;
}

.stats, .tags, .desc {
  font-size: 13px;
  margin-bottom: 5px;
  color: #333;
}

.desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.track-list-container {
  margin-top: 20px;
}

.tabs {
  display: flex;
  gap: 30px;
  border-bottom: 1px solid #eee;
  margin-bottom: 10px;
}

.tab {
  padding: 10px 0;
  cursor: pointer;
  font-size: 14px;
}

.tab.active {
  border-bottom: 3px solid var(--primary-color);
  font-weight: bold;
}

.track-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.track-table th {
  text-align: left;
  color: #999;
  font-weight: normal;
  padding: 8px 10px;
  background-color: #fff;
}

.track-table tr:nth-child(even) {
  background-color: #fafafa;
}

.track-table tr:hover {
  background-color: #f2f2f2;
}

.track-row {
  cursor: pointer;
}

.track-table td {
  padding: 8px 10px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-index { width: 50px; }
.col-oper { width: 60px; }
.col-title { width: auto; }
.col-artist { width: 20%; }
.col-album { width: 25%; }
.col-duration { width: 70px; }

.index-cell { color: #999; text-align: center; }
.operation-cell { color: #999; display: flex; gap: 8px; opacity: 0.6; }
.artist-cell, .album-cell { color: #666; }
.duration-cell { color: #999; }

.icon:hover {
  color: #333;
  opacity: 1;
}
.remove-icon:hover {
  color: #ff4d4f !important;
}

.title-container {
    display: flex;
    align-items: center;
    gap: 6px;
}

.track-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary-color); }
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
}

/* Comments Style */
.playlist-comments-view {
    margin-top: 20px;
    padding-bottom: 50px;
}

.u-avatar {
    width: 35px;
    height: 35px;
    border-radius: 50%;
    margin-right: 12px;
}

.c-body {
    flex: 1;
    font-size: 13px;
    line-height: 1.6;
}

.u-name {
    color: #507daf;
    margin-right: 8px;
    font-weight: 500;
}

.c-text {
    color: #333;
    white-space: pre-wrap;
    word-break: break-all;
}

.c-replied {
    background: #f4f4f4;
    padding: 8px 12px;
    border-radius: 4px;
    margin: 8px 0;
    color: #666;
    font-size: 12px;
}

.c-footer {
    margin-top: 5px;
    font-size: 12px;
    color: #999;
}

.loading-small, .no-data {
    text-align: center;
    padding: 40px;
    color: #999;
}

.empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    min-height: 400px;
}

.empty-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
}

.retry-btn {
    margin-top: 10px;
    padding: 8px 24px;
    border-radius: 20px;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    font-size: 14px;
}

.retry-btn:hover {
    background: #f5f5f5;
}

/* Edit UI Styles */
.cover-wrapper {
    position: relative;
    width: 184px;
    height: 184px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 8px;
}

.cover-wrapper.owner {
    cursor: pointer;
}

.cover-edit-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 12px;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.3s;
}

.cover-wrapper.owner:hover .cover-edit-overlay {
    opacity: 1;
}

.edit-icon {
    opacity: 0.3;
    transition: opacity 0.2s;
    margin-left: 10px;
}

.edit-icon:hover {
    opacity: 1;
    color: var(--primary-color);
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.custom-modal {
    background: white;
    width: 480px;
    border-radius: 8px;
    overflow: hidden;
}

.modal-header {
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #eee;
}

.form-item {
    padding: 15px 20px;
}

.form-item label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    color: #666;
}

.form-item input, .form-item textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    outline: none;
}

.modal-footer {
    padding: 15px 20px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    background: #f9f9f9;
}

.cancel-btn, .save-btn {
    padding: 8px 20px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
}

.cancel-btn {
    background: white;
    border: 1px solid #ddd;
}

.save-btn {
    background: var(--primary-color);
    color: white;
    border: none;
}

.save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
