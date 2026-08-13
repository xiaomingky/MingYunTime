<script setup>
import { ref, onMounted, computed } from 'vue'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { useQQUserStore } from '../../store/qq-user'
import { qqUserLikedSongs, normalizeQQSong, toQQTrack, enrichQQSongWithDetail } from '../../api/qq'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const qqUserStore = useQQUserStore()

// 线上"我喜欢"歌曲列表(从 QQ 音乐 API 拉取)
const likedSongs = ref([])
const loading = ref(false)
const error = ref('')
// 歌单封面(用于无封面歌曲兜底)
const playlistCover = ref('')

const loadLiked = async () => {
    // 未登录:显示空(线上 API 需要 uin + cookie)
    if (!qqUserStore.isLoggedIn || !qqUserStore.uin) {
        likedSongs.value = []
        error.value = '请先登录 QQ 音乐'
        return
    }
    loading.value = true
    error.value = ''
    try {
        const res = await qqUserLikedSongs(qqUserStore.uin, qqUserStore.cookie, 0, 200)
        // 解包:res = { code, data: { songs: [...], info: { cover } } }
        const data = res?.data || res || {}
        const list = data?.songs || data?.list || data?.songlist || []
        // 保存歌单封面,用于无封面歌曲兜底
        playlistCover.value = data?.info?.cover || ''
        likedSongs.value = list.map(normalizeQQSong).filter(Boolean)
        // 同步到本地收藏缓存,让播放器 checkIfLiked 能识别红心状态
        localStorage.setItem('qq_liked_songs', JSON.stringify(likedSongs.value.map(s => ({
            id: s.songmid || s.id,
            songmid: s.songmid,
            name: s.name,
            artist: s.artist,
            al: { name: s.album, picUrl: s.picUrl },
            platform: 'qq'
        }))))
        // 封面策略:normalizeQQSong 已从 albummid 构造 T002 专辑封面
        // 无 albummid 的歌曲调 enrichQQSongWithDetail 拿真实 albummid;拿不到时用歌手头像(T001)兜底
        const cookie = qqUserStore.cookie || ''
        likedSongs.value.forEach((s, i) => {
            // picUrl 为空 或 不是 T002 专辑封面 → 尝试补全
            if (!s.picUrl || !s.picUrl.includes('T002R300x300M000')) {
                enrichQQSongWithDetail(s, cookie).then(updated => {
                    if (updated.picUrl) likedSongs.value[i] = updated
                }).catch(() => {})
            }
        })
        console.log('[QQ Liked] 线上我喜欢歌曲:', likedSongs.value.length, '首, 歌单封面:', playlistCover.value || '(无)')
    } catch (e) {
        console.error('[QQ Liked] 加载失败:', e)
        error.value = '加载失败: ' + (e?.message || '未知错误')
        likedSongs.value = []
    } finally {
        loading.value = false
    }
}

const playSong = (song) => {
    const track = toQQTrack(song)
    if (!track) return
    const list = likedSongs.value.map(toQQTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const playAll = () => {
    if (!likedSongs.value.length) return
    playSong(likedSongs.value[0])
}

// 封面加载失败(T002 404 等)时,用歌单封面兜底;歌单封面也失败则清空 picUrl 显示占位图标
const onCoverError = (e, song) => {
    if (playlistCover.value && song.picUrl !== playlistCover.value) {
        // 先尝试歌单封面
        song.picUrl = playlistCover.value
    } else {
        // 歌单封面也失败(或已是歌单封面),清空 picUrl 让模板显示占位图标
        song.picUrl = ''
    }
}

const isEmpty = computed(() => likedSongs.value.length === 0)

onMounted(loadLiked)
</script>

<template>
    <div class="qq-liked-page" v-loading="loading">
        <div class="qq-liked-header">
            <div class="qq-liked-cover">
                <img v-if="playlistCover" :src="playlistCover" class="qq-liked-cover-img" />
                <svg v-else viewBox="0 0 24 24" width="60" height="60" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            </div>
            <div class="qq-liked-info">
                <h1 class="qq-liked-title">我喜欢的音乐</h1>
                <div class="qq-liked-meta">共 {{ likedSongs.length }} 首 · QQ 音乐线上</div>
                <button class="qq-play-btn" @click="playAll" :disabled="isEmpty || loading">播放全部</button>
            </div>
        </div>

        <div v-if="error" class="qq-error">{{ error }}</div>

        <div class="qq-song-list" v-if="likedSongs.length">
            <div v-for="(s, i) in likedSongs" :key="s.id || i" class="qq-song-item" @dblclick="playSong(s)">
                <span class="qq-song-index">{{ i + 1 }}</span>
                <img
                    v-if="s.picUrl"
                    :src="s.picUrl"
                    class="qq-song-cover"
                    loading="lazy"
                    @error="onCoverError($event, s)"
                />
                <div v-else class="qq-song-cover-placeholder">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="qq-song-info">
                    <div class="qq-song-name">{{ s.name }}</div>
                    <div class="qq-song-artist">{{ s.artist }}</div>
                </div>
                <div class="qq-song-album">{{ s.album }}</div>
            </div>
        </div>

        <div v-if="!loading && !error && isEmpty" class="qq-empty">
            还没有喜欢的歌曲
        </div>
    </div>
</template>

<style scoped>
.qq-liked-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-liked-header { display: flex; gap: 24px; margin-bottom: 28px; }
.qq-liked-cover {
    width: 180px; height: 180px; border-radius: 10px;
    background: linear-gradient(135deg, var(--primary-color), #4ad295);
    color: white; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; overflow: hidden;
}
.qq-liked-cover-img {
    width: 100%; height: 100%; object-fit: cover; border-radius: 10px;
}
.qq-liked-info { flex: 1; display: flex; flex-direction: column; }
.qq-liked-title { font-size: 24px; color: var(--text-main); margin-bottom: 12px; }
.qq-liked-meta { color: var(--text-light); font-size: 13px; margin-bottom: 16px; }
.qq-play-btn {
    align-self: flex-start; background: var(--primary-color); color: white;
    border: none; padding: 8px 28px; border-radius: 18px; cursor: pointer; font-size: 14px;
}
.qq-play-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qq-error { color: #ff6b6b; padding: 20px 0; text-align: center; }
.qq-song-list { display: flex; flex-direction: column; }
.qq-song-item {
    display: flex; align-items: center; padding: 8px 12px;
    border-radius: 6px; cursor: pointer; gap: 12px;
}
.qq-song-item:hover { background: var(--hover-bg); }
.qq-song-index { width: 28px; color: var(--text-light); font-size: 13px; text-align: center; flex-shrink: 0; }
.qq-song-cover { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
.qq-song-cover-placeholder {
    width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;
    background: var(--hover-bg); color: var(--text-light);
    display: flex; align-items: center; justify-content: center;
}
.qq-song-info { flex: 1; min-width: 0; }
.qq-song-name {
    font-size: 14px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-song-artist { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.qq-song-album {
    font-size: 12px; color: var(--text-light);
    max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex-shrink: 0;
}
.qq-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
</style>
