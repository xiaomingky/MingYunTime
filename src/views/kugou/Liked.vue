<script setup>
import { ref, onMounted, computed } from 'vue'
import { Heart, Plus, Trash2, X, CheckSquare, Square } from 'lucide-vue-next'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { useKugouUserStore } from '../../store/kugou-user'
import {
    kugouUserPlaylist, kugouPlaylistSongs, kugouPlaylistSongsNew,
    normalizeKugouSong, normalizeKugouPlaylist, toKugouTrack
} from '../../api/kugou'
import ConfirmModal from '../../components/ConfirmModal.vue'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const kugouUserStore = useKugouUserStore()

// 线上"我喜欢"歌曲列表(从酷狗概念版 API 拉取)
const likedSongs = ref([])
const loading = ref(false)
const error = ref('')

// 添加到歌单弹窗
const showAddToPlaylist = ref(false)
const addTargetSong = ref(null)
// 新建歌单弹窗
const showCreatePlaylist = ref(false)
const newPlaylistName = ref('')
const creating = ref(false)

// 批量管理
const batchMode = ref(false)
const selectedSongs = ref([])
const batchUnliking = ref(false)

const toggleBatchMode = () => {
    batchMode.value = !batchMode.value
    if (!batchMode.value) selectedSongs.value = []
}

const toggleSelect = (song) => {
    const idx = selectedSongs.value.findIndex(s => s.hash === song.hash)
    if (idx >= 0) selectedSongs.value.splice(idx, 1)
    else selectedSongs.value.push(song)
}

const isSelected = (hash) => selectedSongs.value.some(s => s.hash === hash)

const selectAll = () => {
    if (selectedSongs.value.length === likedSongs.value.length) {
        selectedSongs.value = []
    } else {
        selectedSongs.value = likedSongs.value.slice()
    }
}

const isAllSelected = computed(() =>
    likedSongs.value.length > 0 && selectedSongs.value.length === likedSongs.value.length
)

const showBatchConfirm = ref(false)
const batchUnlike = async () => {
    showBatchConfirm.value = false
    if (!selectedSongs.value.length) return
    batchUnliking.value = true
    const ok = await kugouUserStore.batchUnlikeSongs(selectedSongs.value)
    if (ok) {
        const removedHashes = new Set(selectedSongs.value.map(s => s.hash))
        likedSongs.value = likedSongs.value.filter(s => !removedHashes.has(s.hash))
        selectedSongs.value = []
        batchMode.value = false
    }
    batchUnliking.value = false
}

const loadLiked = async () => {
    // 未登录:显示空(线上 API 需要 userid + token)
    if (!kugouUserStore.isLoggedIn || !kugouUserStore.userid) {
        likedSongs.value = []
        error.value = '请先登录酷狗概念版'
        return
    }
    loading.value = true
    error.value = ''
    try {
        // 1. 拉取用户歌单，找到"我喜欢"歌单
        const res = await kugouUserPlaylist(1, 100)
        const list = res?.data?.info || res?.data?.list || res?.data || []
        const playlists = (Array.isArray(list) ? list : []).map(normalizeKugouPlaylist).filter(p => p.id)
        const liked = playlists.find(p => /我喜欢|我喜歡|favorite|喜歡的歌/i.test(p.name))
        if (!liked || !liked.id) {
            likedSongs.value = []
            error.value = '未找到"我喜欢"歌单'
            return
        }
        // 2. 拉取"我喜欢"歌单的歌曲(分页加载)
        const PAGE_SIZE = 300
        const fetcher = liked.listid ? kugouPlaylistSongsNew : kugouPlaylistSongs
        const fetchId = liked.listid || liked.global_collection_id || liked.id
        let page = 1
        const rawAllSongs = []
        while (true) {
            const songsRes = await fetcher(fetchId, page, PAGE_SIZE)
            const data = songsRes?.data || songsRes
            const songList = data?.info || data?.lists || data?.list || data?.songs || []
            const arr = Array.isArray(songList) ? songList : []
            rawAllSongs.push(...arr)
            if (arr.length < PAGE_SIZE) break
            page++
            if (page > 10) break
        }
        // 排序：酷狗接口返回正序(最早收藏的在前)，反序后最新收藏的在前
        const sortedRaw = rawAllSongs.slice().reverse()
        const allSongs = sortedRaw.map(normalizeKugouSong).filter(Boolean)
        likedSongs.value = allSongs
        // 同步到本地收藏缓存,让播放器 checkIfLiked 能识别红心状态
        localStorage.setItem('kugou_liked_songs', JSON.stringify(likedSongs.value.map(s => ({
            id: s.hash || s.id,
            hash: s.hash,
            name: s.name,
            artist: s.artist,
            al: { name: s.album, picUrl: s.picUrl },
            platform: 'kugou'
        }))))
        console.log('[Kugou Liked] 线上我喜欢歌曲:', likedSongs.value.length, '首')
    } catch (e) {
        console.error('[Kugou Liked] 加载失败:', e)
        error.value = '加载失败: ' + (e?.message || '未知错误')
        likedSongs.value = []
    } finally {
        loading.value = false
    }
}

const playSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = likedSongs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const playAll = () => {
    if (!likedSongs.value.length) return
    playSong(likedSongs.value[0])
}

// 从"我喜欢"移除歌曲
const removeFromLiked = async (song, event) => {
    event?.stopPropagation()
    if (!song?.hash) return
    const ok = await kugouUserStore.toggleLikeSong(song)
    if (ok) {
        // 从列表移除
        likedSongs.value = likedSongs.value.filter(s => s.hash !== song.hash)
    }
}

// 打开"添加到歌单"弹窗
const openAddToPlaylist = (song, event) => {
    event?.stopPropagation()
    addTargetSong.value = song
    showAddToPlaylist.value = true
}

// 添加到指定歌单
const addToPlaylist = async (playlist) => {
    if (!addTargetSong.value || !playlist?.id) return
    const ok = await kugouUserStore.addSongToPlaylist(playlist.id, addTargetSong.value)
    if (ok) {
        showAddToPlaylist.value = false
        addTargetSong.value = null
    }
}

// 新建歌单
const createPlaylist = async () => {
    const name = newPlaylistName.value.trim()
    if (!name) {
        messageStore.warning('请输入歌单名称')
        return
    }
    creating.value = true
    const ok = await kugouUserStore.createPlaylist(name)
    if (ok) {
        showCreatePlaylist.value = false
        newPlaylistName.value = ''
    }
    creating.value = false
}

// 可添加目标的歌单列表(排除"我喜欢"歌单)
const targetPlaylists = computed(() => {
    return kugouUserStore.playlists.filter(p =>
        p.id !== kugouUserStore.likedPlaylistId && p.isMine
    )
})

const isEmpty = computed(() => likedSongs.value.length === 0)

onMounted(loadLiked)
</script>

<template>
    <div class="kugou-liked-page" v-loading="loading">
        <div class="kugou-liked-header">
            <div class="kugou-liked-cover">
                <Heart :size="100" :fill="'white'" :color="'white'" class="kugou-liked-heart-icon" />
            </div>
            <div class="kugou-liked-info">
                <h1 class="kugou-liked-title">我喜欢的音乐</h1>
                <div class="kugou-liked-meta">共 {{ likedSongs.length }} 首 · 酷狗概念版线上</div>
                <div class="kugou-liked-actions">
                    <button class="kugou-play-btn" @click="playAll" :disabled="isEmpty || loading">播放全部</button>
                    <button
                        v-if="likedSongs.length"
                        :class="batchMode ? 'kugou-batch-btn-active' : 'kugou-collect-btn'"
                        @click="toggleBatchMode"
                    >
                        <Trash2 :size="14" />
                        <span>{{ batchMode ? '退出批量' : '批量管理' }}</span>
                    </button>
                </div>
            </div>
        </div>

        <div v-if="error" class="kugou-error">{{ error }}</div>

        <div class="kugou-song-list" v-if="likedSongs.length">
            <!-- 批量操作栏 -->
            <div v-if="batchMode" class="kugou-batch-bar">
                <div class="kugou-batch-select-all" @click="selectAll">
                    <CheckSquare v-if="isAllSelected" :size="16" class="kugou-check-icon active" />
                    <Square v-else :size="16" class="kugou-check-icon" />
                    <span>全选</span>
                </div>
                <span class="kugou-batch-count">已选 {{ selectedSongs.length }} 首</span>
                <button class="kugou-batch-remove-btn" @click="showBatchConfirm = true" :disabled="!selectedSongs.length || batchUnliking">
                    {{ batchUnliking ? '取消中...' : '取消喜欢' }}
                </button>
            </div>
            <div v-for="(s, i) in likedSongs" :key="s.id || i" class="kugou-song-item" @click="batchMode && toggleSelect(s)" @dblclick="!batchMode && playSong(s)">
                <div v-if="batchMode" class="kugou-col-check" @click.stop="toggleSelect(s)">
                    <CheckSquare v-if="isSelected(s.hash)" :size="16" class="kugou-check-icon active" />
                    <Square v-else :size="16" class="kugou-check-icon" />
                </div>
                <span class="kugou-song-index">{{ i + 1 }}</span>
                <img
                    v-if="s.picUrl"
                    :src="s.picUrl"
                    class="kugou-song-cover"
                    loading="lazy"
                />
                <div v-else class="kugou-song-cover-placeholder">
                    <Heart :size="16" />
                </div>
                <div class="kugou-song-info">
                    <div class="kugou-song-name">
                        <span class="name-text">{{ s.name }}</span>
                        <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                    </div>
                    <div class="kugou-song-artist">{{ s.artist }}</div>
                </div>
                <div class="kugou-song-album">{{ s.album }}</div>
                <div v-if="!batchMode" class="kugou-song-actions">
                    <Plus :size="16" class="kugou-action-icon" title="添加到歌单" @click="openAddToPlaylist(s, $event)" />
                    <Trash2 :size="16" class="kugou-action-icon kugou-remove-icon" title="从喜欢移除" @click="removeFromLiked(s, $event)" />
                </div>
            </div>
        </div>

        <div v-if="!loading && !error && isEmpty" class="kugou-empty">
            还没有喜欢的歌曲
        </div>

        <!-- 添加到歌单弹窗 -->
        <div v-if="showAddToPlaylist" class="kugou-modal-overlay" @click.self="showAddToPlaylist = false">
            <div class="kugou-modal">
                <div class="kugou-modal-header">
                    <span class="kugou-modal-title">添加到歌单</span>
                    <X :size="18" class="kugou-modal-close" @click="showAddToPlaylist = false" />
                </div>
                <div class="kugou-modal-body">
                    <div class="kugou-modal-add-new" @click="showCreatePlaylist = true; showAddToPlaylist = false">
                        <Plus :size="16" />
                        <span>新建歌单</span>
                    </div>
                    <div v-if="!targetPlaylists.length" class="kugou-modal-empty">暂无其他歌单</div>
                    <div
                        v-for="p in targetPlaylists"
                        :key="p.id"
                        class="kugou-modal-playlist-item"
                        @click="addToPlaylist(p)"
                    >
                        <Heart v-if="p.id === kugouUserStore.likedPlaylistId" :size="16" :fill="'#EC4141'" :color="'#EC4141'" />
                        <img v-else-if="p.coverImgUrl" :src="p.coverImgUrl" class="kugou-modal-cover" />
                        <div v-else class="kugou-modal-cover-placeholder"><Heart :size="14" /></div>
                        <span class="kugou-modal-playlist-name">{{ p.name }}</span>
                        <span class="kugou-modal-playlist-count">{{ p.songCount || 0 }}首</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 新建歌单弹窗 -->
        <div v-if="showCreatePlaylist" class="kugou-modal-overlay" @click.self="showCreatePlaylist = false">
            <div class="kugou-modal kugou-modal-sm">
                <div class="kugou-modal-header">
                    <span class="kugou-modal-title">新建歌单</span>
                    <X :size="18" class="kugou-modal-close" @click="showCreatePlaylist = false" />
                </div>
                <div class="kugou-modal-body">
                    <input
                        v-model="newPlaylistName"
                        class="kugou-modal-input"
                        placeholder="请输入歌单名称"
                        @keyup.enter="createPlaylist"
                        autofocus
                    />
                    <button class="kugou-modal-confirm-btn" @click="createPlaylist" :disabled="creating">
                        {{ creating ? '创建中...' : '创建' }}
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 批量取消喜欢确认弹窗 -->
    <ConfirmModal
        :visible="showBatchConfirm"
        title="取消喜欢"
        :message="`确定取消喜欢选中的 ${selectedSongs.length} 首歌曲吗？`"
        confirmText="取消喜欢"
        @confirm="batchUnlike"
        @cancel="showBatchConfirm = false"
    />
</template>

<style scoped>
.kugou-liked-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.kugou-liked-header { display: flex; gap: 24px; margin-bottom: 28px; }
.kugou-liked-cover {
    width: 180px; height: 180px; border-radius: 10px;
    background: linear-gradient(135deg, #2CA2F5, #4ad295);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 16px rgba(44, 162, 245, 0.3);
}
.kugou-liked-heart-icon {
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.2));
}
.kugou-liked-info { flex: 1; display: flex; flex-direction: column; }
.kugou-liked-title { font-size: 24px; color: var(--text-main); margin-bottom: 12px; }
.kugou-liked-meta { color: var(--text-light); font-size: 13px; margin-bottom: 16px; }
.kugou-play-btn {
    align-self: flex-start; background: var(--primary-color); color: white;
    border: none; padding: 8px 28px; border-radius: 18px; cursor: pointer; font-size: 14px;
}
.kugou-play-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kugou-liked-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.kugou-collect-btn {
    display: flex; align-items: center; gap: 4px;
    background: transparent; color: var(--primary-color);
    border: 1px solid var(--primary-color);
    padding: 7px 16px; border-radius: 18px; cursor: pointer; font-size: 13px;
    transition: all 0.15s;
}
.kugou-collect-btn:hover { background: var(--primary-color); color: white; }
.kugou-batch-btn-active {
    display: flex; align-items: center; gap: 4px;
    background: var(--primary-color); color: white;
    border: none; padding: 7px 16px; border-radius: 18px; cursor: pointer; font-size: 13px;
}
.kugou-batch-bar {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 12px; margin-bottom: 8px;
    background: var(--hover-bg); border-radius: 6px;
}
.kugou-batch-select-all {
    display: flex; align-items: center; gap: 6px;
    cursor: pointer; font-size: 13px; color: var(--text-main);
}
.kugou-batch-count { font-size: 13px; color: var(--text-light); }
.kugou-batch-remove-btn {
    margin-left: auto; padding: 6px 16px; border-radius: 14px;
    border: none; background: #ff6b6b; color: white; cursor: pointer; font-size: 13px;
    transition: opacity 0.15s;
}
.kugou-batch-remove-btn:hover:not(:disabled) { opacity: 0.85; }
.kugou-batch-remove-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kugou-col-check {
    width: 20px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; cursor: pointer;
}
.kugou-check-icon {
    color: var(--text-light);
    transition: color 0.15s;
}
.kugou-check-icon:hover { color: var(--text-secondary); }
.kugou-check-icon.active {
    color: var(--primary-color);
}
.kugou-error { color: #ff6b6b; padding: 20px 0; text-align: center; }
.kugou-song-list { display: flex; flex-direction: column; }
.kugou-song-item {
    display: flex; align-items: center; padding: 8px 12px;
    border-radius: 6px; cursor: pointer; gap: 12px;
}
.kugou-song-item:hover { background: var(--hover-bg); }
.kugou-song-index { width: 28px; color: var(--text-light); font-size: 13px; text-align: center; flex-shrink: 0; }
.kugou-song-cover { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
.kugou-song-cover-placeholder {
    width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;
    background: var(--hover-bg); color: var(--text-light);
    display: flex; align-items: center; justify-content: center;
}
.kugou-song-info { flex: 1; min-width: 0; }
.kugou-song-name {
    font-size: 14px; color: var(--text-main);
    display: flex; align-items: center; gap: 4px;
}
.kugou-song-name .name-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 0 1 auto; min-width: 0;
}
.kugou-song-artist { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.kugou-song-album {
    font-size: 12px; color: var(--text-light);
    max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex-shrink: 0;
}
.kugou-song-actions {
    display: flex; gap: 8px; flex-shrink: 0;
    opacity: 0; transition: opacity 0.15s;
}
.kugou-song-item:hover .kugou-song-actions { opacity: 1; }
.kugou-action-icon {
    cursor: pointer; color: var(--text-light);
    transition: color 0.15s, transform 0.15s;
}
.kugou-action-icon:hover { color: var(--primary-color); transform: scale(1.2); }
.kugou-remove-icon:hover { color: #ff6b6b; }
.kugou-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }

/* 弹窗样式复用 App.vue 全局 .kugou-modal-* 类,此处不再重复定义 */
</style>
