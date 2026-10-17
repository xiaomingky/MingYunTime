<script setup>
import QQSongBadge from '../../components/QQSongBadge.vue'
import { ref, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { qqAlbumInfo, qqAlbumTracks, normalizeQQSong, toQQTrack } from '../../api/qq'
import QQComment from '../../components/QQComment.vue'
import SongActionsMenu from '../../components/SongActionsMenu.vue'

const route = useRoute()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const album = ref(null)
const songs = ref([])
const error = ref('')
const hasMore = ref(false)
let revision = 0, offset = 0

const fetchAlbum = async (append = false) => {
    const albummid = route.params.id
    if (!albummid || (append && loading.value)) return
    const requestId = ++revision
    if (!append) { album.value = null; songs.value = []; offset = 0; hasMore.value = false }
    loading.value = true
    error.value = ''
    try {
        const res = append ? await qqAlbumTracks(albummid, offset) : await qqAlbumInfo(albummid)
        if (requestId !== revision) return
        if (res?.code !== 0) throw new Error(res?.message || 'QQ 专辑加载失败')
        // 解包 response 后：{ code, data: { name, aDate, company, singers, list:[歌曲], desc, ... } }
        const info = res?.data || res || {}
        const singerName = Array.isArray(info.singers)
            ? info.singers.map(s => s.name || s.singername || '').filter(Boolean).join('/')
            : (info.singerName || info.singername || info.singer || '')
        if (!append) album.value = {
            id: albummid,
            resourceId: info.id,
            name: info.name || info.albumName || info.albumname || '未知专辑',
            picUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`,
            artist: singerName,
            publishTime: info.aDate || info.publicTime || info.pubTime || '',
            description: info.desc || '',
            company: info.company || '',
            total: info.total || 0
        }
        const raw = info.list || info.songList || info.songs || []
        const batch = raw.map(normalizeQQSong).filter(Boolean)
        const previousLength = songs.value.length
        songs.value = [...new Map([...(append ? songs.value : []), ...batch].map(song => [song.id, song])).values()]
        offset += raw.length
        hasMore.value = info.hasMore === true && songs.value.length > previousLength
    } catch (e) {
        if (requestId === revision) { error.value = e.message || 'QQ 专辑加载失败'; messageStore.error(error.value) }
    } finally {
        if (requestId === revision) loading.value = false
    }
}

const playSong = (song, event = null) => {
    const track = toQQTrack(song)
    if (!track) return
    const list = songs.value.map(toQQTrack).filter(Boolean)
    playerStore.handleSongClick(track, list, event)
}

watch(() => route.params.id, () => fetchAlbum(), { immediate: true })
onBeforeUnmount(() => revision++)
</script>

<template>
    <div class="qq-album-page" v-loading="loading">
        <div class="qq-album-header" v-if="album">
            <img :src="album.picUrl" class="qq-album-cover" />
            <div class="qq-album-info">
                <h1 class="qq-album-name">{{ album.name }}</h1>
                <div class="qq-album-artist">歌手：{{ album.artist }}</div>
                <div class="qq-album-time" v-if="album.publishTime">发行：{{ album.publishTime }}</div>
                <div class="qq-album-time" v-if="album.company">唱片公司：{{ album.company }}</div>
                <div class="qq-album-time" v-if="album.total">{{ album.total }} 首歌曲</div>
            </div>
        </div>
        <details v-if="album?.description" class="qq-album-description"><summary>专辑介绍</summary><p>{{ album.description }}</p></details>

        <div class="qq-song-list">
            <div v-for="(s, i) in songs" :key="s.id || i" class="qq-song-item" @click="playSong(s, $event)">
                <span class="qq-song-index">{{ i + 1 }}</span>
                <div class="qq-song-info">
                    <div class="qq-song-name"><span class="qq-song-title">{{ s.name }}</span><QQSongBadge :song="s" /></div>
                    <div class="qq-song-artist">{{ s.artist }}</div>
                </div>
                <div class="qq-song-duration">{{ Math.floor(s.duration / 60000) }}:{{ String(Math.floor(s.duration / 1000 % 60)).padStart(2, '0') }}</div>
                <SongActionsMenu :song="toQQTrack(s)" :list="songs.map(toQQTrack).filter(Boolean)" compact />
            </div>
        </div>

        <div v-if="error" class="qq-empty" role="alert">{{ error }} <button :disabled="loading" @click="fetchAlbum(songs.length > 0)">重试</button></div>
        <div v-if="!loading && !error && !songs.length" class="qq-empty">专辑暂无曲目</div>
        <button v-if="hasMore" :disabled="loading" @click="fetchAlbum(true)">{{ loading ? '正在加载…' : '加载更多歌曲' }}</button>

        <!-- 评论区（biztype=2 专辑） -->
        <QQComment v-if="album?.resourceId" :id="String(album.resourceId)" :biztype="2" />
    </div>
</template>

<style scoped>
.qq-album-description { color: var(--text-secondary); margin-bottom: 24px; line-height: 1.8; }
.qq-album-description summary { cursor: pointer; color: var(--text-main); }
.qq-album-description p { white-space: pre-wrap; }
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
.qq-song-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-song-name {
    display:flex;align-items:center;
    font-size: 14px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-song-artist { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.qq-song-duration { font-size: 12px; color: var(--text-light); width: 50px; text-align: right; }
.qq-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
</style>
