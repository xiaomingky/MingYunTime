<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { kugouAlbumDetail, kugouAlbumSongs, normalizeKugouSong, normalizeKugouAlbum, toKugouTrack } from '../../api/kugou'
import KugouComment from '../../components/KugouComment.vue'

const route = useRoute()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const album = ref(null)
const songs = ref([])

const fetchAlbum = async () => {
    const albumid = route.params.id
    if (!albumid) return
    loading.value = true
    try {
        // /album/detail 实测返回 { status:1, data: [ {...} ] }（data 是数组，取第一个）
        // 字段：album_id/album_name/sizable_cover/author_name/publish_date/intro
        // /album/songs 返回 { status:1, data: { list: [...] } } 或 { status:1, data: [...] }
        const [infoRes, songsRes] = await Promise.allSettled([
            kugouAlbumDetail(albumid),
            kugouAlbumSongs(albumid, 1, 50)
        ])
        // 专辑详情：data 是数组，取第一个；兼容 data 是对象
        const infoData = (infoRes.status === 'fulfilled' && infoRes.value?.data) || {}
        const infoObj = Array.isArray(infoData) ? (infoData[0] || {}) : infoData
        const norm = normalizeKugouAlbum(infoObj) || {}
        album.value = {
            id: albumid,
            name: norm.name || '未知专辑',
            picUrl: norm.picUrl || '',
            artist: norm.artist || '',
            publishTime: norm.publishTime || '',
            intro: norm.intro || ''
        }
        // 歌曲列表：/album/songs 实测返回 data.list 或 data 是数组
        const songsData = (songsRes.status === 'fulfilled' && songsRes.value?.data) || {}
        // 调试日志：打印原始响应结构，便于排查字段名问题
        console.log('[Kugou Album] /album/songs 原始响应:',
            JSON.parse(JSON.stringify(songsData))?.toString?.()?.slice(0, 500) ||
            JSON.stringify(songsData).slice(0, 500))
        const songList = Array.isArray(songsData) ? songsData :
            (songsData?.list || songsData?.songs || songsData?.info || songsData?.lists || [])
        songs.value = (Array.isArray(songList) ? songList : []).map(normalizeKugouSong).filter(Boolean)
        if (songs.value.length === 0 && songList.length > 0) {
            console.warn('[Kugou Album] 歌曲标准化后为空,原始字段:', songList.slice(0, 2))
        }
    } catch (e) {
        console.error('[Kugou Album] error:', e)
        messageStore.error('酷狗专辑加载失败')
    } finally {
        loading.value = false
    }
}

const playSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = songs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

// 视图切换：歌曲列表 / 评论
const viewTab = ref('songs')

watch(() => route.params.id, fetchAlbum)
onMounted(fetchAlbum)
</script>

<template>
    <div class="kugou-album-page" v-loading="loading">
        <div class="kugou-album-header" v-if="album">
            <img :src="album.picUrl" class="kugou-album-cover" />
            <div class="kugou-album-info">
                <h1 class="kugou-album-name">{{ album.name }}</h1>
                <div class="kugou-album-artist">歌手：{{ album.artist }}</div>
                <div class="kugou-album-time" v-if="album.publishTime">发行：{{ album.publishTime }}</div>
            </div>
        </div>

        <!-- 视图切换标签 -->
        <div class="kugou-view-tabs">
            <div class="kugou-view-tab" :class="{ active: viewTab === 'songs' }" @click="viewTab = 'songs'">歌曲列表</div>
            <div class="kugou-view-tab" :class="{ active: viewTab === 'comments' }" @click="viewTab = 'comments'">评论</div>
        </div>

        <div v-if="viewTab === 'songs'" class="kugou-song-list">
            <div v-for="(s, i) in songs" :key="s.id || i" class="kugou-song-item" @dblclick="playSong(s)">
                <span class="kugou-song-index">{{ i + 1 }}</span>
                <div class="kugou-song-info">
                    <div class="kugou-song-name">
                        <span class="name-text">{{ s.name }}</span>
                        <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                    </div>
                    <div class="kugou-song-artist">{{ s.artist }}</div>
                </div>
                <div class="kugou-song-duration">{{ Math.floor(s.duration / 60000) }}:{{ String(Math.floor(s.duration / 1000 % 60)).padStart(2, '0') }}</div>
            </div>
        </div>

        <div v-if="viewTab === 'songs' && !loading && !songs.length" class="kugou-empty">专辑为空或加载失败</div>

        <!-- 评论区 (专辑评论) -->
        <KugouComment v-if="viewTab === 'comments' && album" :id="route.params.id" type="album" />
    </div>
</template>

<style scoped>
.kugou-album-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.kugou-album-header { display: flex; gap: 24px; margin-bottom: 28px; }
.kugou-album-cover { width: 180px; height: 180px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.kugou-album-info { flex: 1; display: flex; flex-direction: column; }
.kugou-album-name { font-size: 24px; color: var(--text-main); margin-bottom: 12px; }
.kugou-album-artist, .kugou-album-time { color: var(--text-secondary); font-size: 14px; margin-bottom: 6px; }
.kugou-song-list { display: flex; flex-direction: column; }
.kugou-song-item {
    display: flex; align-items: center; padding: 8px 12px;
    border-radius: 6px; cursor: pointer; gap: 12px;
}
.kugou-song-item:hover { background: var(--hover-bg); }
.kugou-song-index { width: 28px; color: var(--text-light); font-size: 13px; text-align: center; }
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
.kugou-song-duration { font-size: 12px; color: var(--text-light); width: 50px; text-align: right; }
.kugou-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
/* 视图切换标签 */
.kugou-view-tabs {
    display: flex;
    gap: 4px;
    margin: 16px 0 12px;
    border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
}
.kugou-view-tab {
    padding: 8px 20px;
    font-size: 14px;
    color: var(--text-secondary, #666);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px;
}
.kugou-view-tab:hover { color: var(--primary-color, #2CA2F5); }
.kugou-view-tab.active {
    color: var(--primary-color, #2CA2F5);
    border-bottom-color: var(--primary-color, #2CA2F5);
    font-weight: 500;
}
</style>
