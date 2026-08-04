<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { qqAlbumInfo, normalizeQQSong, toQQTrack } from '../../api/qq'
import QQComment from '../../components/QQComment.vue'

const route = useRoute()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const album = ref(null)
const songs = ref([])

const fetchAlbum = async () => {
    const albummid = route.params.id
    if (!albummid) return
    loading.value = true
    try {
        const res = await qqAlbumInfo(albummid)
        // 解包 response 后：{ code, data: { name, aDate, company, singers, list:[歌曲], desc, ... } }
        const info = res?.data || res || {}
        const singerName = Array.isArray(info.singers)
            ? info.singers.map(s => s.name || s.singername || '').filter(Boolean).join('/')
            : (info.singerName || info.singername || info.singer || '')
        album.value = {
            id: albummid,
            name: info.name || info.albumName || info.albumname || '未知专辑',
            picUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`,
            artist: singerName,
            publishTime: info.aDate || info.publicTime || info.pubTime || ''
        }
        songs.value = (info.list || info.songList || info.songs || []).map(normalizeQQSong).filter(Boolean)
    } catch (e) {
        console.error('[QQ Album] error:', e)
        messageStore.error('QQ 专辑加载失败')
    } finally {
        loading.value = false
    }
}

const playSong = (song) => {
    const track = toQQTrack(song)
    if (!track) return
    const list = songs.value.map(toQQTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

watch(() => route.params.id, fetchAlbum)
onMounted(fetchAlbum)
</script>

<template>
    <div class="qq-album-page" v-loading="loading">
        <div class="qq-album-header" v-if="album">
            <img :src="album.picUrl" class="qq-album-cover" />
            <div class="qq-album-info">
                <h1 class="qq-album-name">{{ album.name }}</h1>
                <div class="qq-album-artist">歌手：{{ album.artist }}</div>
                <div class="qq-album-time" v-if="album.publishTime">发行：{{ album.publishTime }}</div>
            </div>
        </div>

        <div class="qq-song-list">
            <div v-for="(s, i) in songs" :key="s.id || i" class="qq-song-item" @dblclick="playSong(s)">
                <span class="qq-song-index">{{ i + 1 }}</span>
                <div class="qq-song-info">
                    <div class="qq-song-name">{{ s.name }}</div>
                    <div class="qq-song-artist">{{ s.artist }}</div>
                </div>
                <div class="qq-song-duration">{{ Math.floor(s.duration / 60000) }}:{{ String(Math.floor(s.duration / 1000 % 60)).padStart(2, '0') }}</div>
            </div>
        </div>

        <div v-if="!loading && !songs.length" class="qq-empty">专辑为空或加载失败</div>

        <!-- 评论区（biztype=2 专辑） -->
        <QQComment v-if="album" :id="route.params.id" :biztype="2" />
    </div>
</template>

<style scoped>
.qq-album-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-album-header { display: flex; gap: 24px; margin-bottom: 28px; }
.qq-album-cover { width: 180px; height: 180px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.qq-album-info { flex: 1; display: flex; flex-direction: column; }
.qq-album-name { font-size: 24px; color: var(--text-main); margin-bottom: 12px; }
.qq-album-artist, .qq-album-time { color: var(--text-secondary); font-size: 14px; margin-bottom: 6px; }
.qq-song-list { display: flex; flex-direction: column; }
.qq-song-item {
    display: flex; align-items: center; padding: 8px 12px;
    border-radius: 6px; cursor: pointer; gap: 12px;
}
.qq-song-item:hover { background: var(--hover-bg); }
.qq-song-index { width: 28px; color: var(--text-light); font-size: 13px; text-align: center; }
.qq-song-info { flex: 1; min-width: 0; }
.qq-song-name {
    font-size: 14px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-song-artist { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.qq-song-duration { font-size: 12px; color: var(--text-light); width: 50px; text-align: right; }
.qq-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
</style>
