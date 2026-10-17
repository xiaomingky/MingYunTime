<script setup>
import QQSongBadge from '../../components/QQSongBadge.vue'
import { ref, onBeforeUnmount, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { useQQUserStore } from '../../store/qq-user'
import { qqPlaylistDetail, qqRanks, qqOperSonglist, normalizeQQSong, toQQTrack, enrichQQSongWithDetail, getQQCookie } from '../../api/qq'
import QQComment from '../../components/QQComment.vue'
import SongActionsMenu from '../../components/SongActionsMenu.vue'
import { ListPlus, Play, SkipForward, Trash2 } from 'lucide-vue-next'

const route = useRoute()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const qqUserStore = useQQUserStore()
const removing = ref(false)
const canRemove = computed(() => !route.meta.qqRank && qqUserStore.isLoggedIn && qqUserStore.createdPlaylists.some(p => String(p.id) === String(route.params.id)))
async function removeSong(song) {
    if (!canRemove.value || removing.value) return
    const playlistId = String(route.params.id), accountRevision = qqUserStore.revision
    const confirmed = await messageStore.confirm('确定从当前歌单移除「' + song.name + '」吗？', '移除歌曲')
    if (!confirmed || playlistId !== String(route.params.id) || accountRevision !== qqUserStore.revision || !canRemove.value) return
    removing.value = true
    try {
        const result = await qqOperSonglist('delsong', { dissid: playlistId, songmid: [song.songmid || song.id] }, qqUserStore.cookie)
        if (accountRevision !== qqUserStore.revision || playlistId !== String(route.params.id)) return
        if (result?.code !== 0) throw Error(result?.message || 'QQ 歌曲移除失败')
        await fetchDetail()
        await qqUserStore.fetchUserPlaylists()
        messageStore.success('已从歌单移除')
    } catch (e) { messageStore.error(e.message || '移除失败，请重试') }
    finally { removing.value = false }
}

const loading = ref(false)
const detail = ref(null)
const songs = ref([])
const error = ref('')
const hasMore = ref(false)
let revision = 0, offset = 0
const normalizedTracks = computed(() => songs.value.map(toQQTrack).filter(Boolean))

const fetchDetail = async (append = false) => {
    const disstid = route.params.id
    if (!disstid || (append && loading.value)) return
    const requestId = ++revision
    if (!append) { detail.value = null; songs.value = []; offset = 0; hasMore.value = false }
    loading.value = true; error.value = ''
    try {
        const rank = !!route.meta.qqRank
        const res = rank ? await qqRanks({ topId: disstid, limit: 100, page: offset }) : await qqPlaylistDetail(disstid, offset, 100)
        if (requestId !== revision) return
        if (res?.code !== 0) throw new Error(res?.message || 'QQ 音乐返回错误')
        if (rank && res.req_1?.code !== undefined && res.req_1.code !== 0) throw new Error('QQ 榜单暂不可用，请重试')
        const rankData = res?.req_1?.data || res?.data || {}
        const rankInfo = rankData.topInfo || {}
        // 解包 response 后：{ code, cdlist: [{ dissname, logo, desc, nickname, songlist:[...] }] }
        const info = rank ? { dissname: rankInfo.title, logo: rankInfo.frontPicUrl || rankInfo.headPicUrl, desc: rankInfo.intro, songnum: rankInfo.totalNum } : (res?.cdlist?.[0] || res?.data?.cdlist?.[0] || {})
        detail.value = {
            id: disstid,
            name: info.dissname || info.title || info.name || '未知歌单',
            coverImgUrl: info.logo || info.picurl || info.imgurl || info.pic || '',
            creator: info.nickname || info.creator?.name || info.creator || '',
            description: info.desc || info.intro || '',
            playCount: info.listennum || info.visitnum || 0,
            songCount: info.songnum || 0
        }
        const songList = rank ? (rankData.songInfoList || rankData.songlist || []) : (info.songlist || [])
        const batch = songList.map(normalizeQQSong).filter(Boolean)
        const previousLength = songs.value.length
        songs.value = [...new Map([...(append ? songs.value : []), ...batch].map(song => [song.id, song])).values()]
        offset += songList.length
        hasMore.value = songList.length > 0 && songs.value.length > previousLength && (rank
            ? offset < Number(rankInfo.totalNum || rankData.totalNum || 0)
            : res.hasMore === true)
        // 无专辑封面(albummid 缺失)的歌曲,调官方 song-detail 接口拿真实 albummid
        // 拿不到 albummid 时,enrichQQSongWithDetail 内部用歌手头像(T001)兜底
        const cookie = getQQCookie()
        songs.value.forEach((s, i) => {
            if (!s.picUrl || !s.picUrl.includes('T002R300x300M000')) {
                enrichQQSongWithDetail(s, cookie).then(updated => {
                    if (requestId === revision && updated.picUrl && songs.value[i]?.id === s.id) songs.value[i] = updated
                }).catch(() => {})
            }
        })
    } catch (e) {
        if (requestId === revision) { error.value = e.message || 'QQ 歌单加载失败'; messageStore.error(error.value) }
    } finally {
        if (requestId === revision) loading.value = false
    }
}

const playAll = () => {
    if (!songs.value.length) return
    const list = normalizedTracks.value
    playerStore.playNow(list[0], list)
}

const playSong = (song, event = null) => {
    const track = toQQTrack(song)
    if (!track) return
    playerStore.handleSongClick(track, normalizedTracks.value, event)
}

const enqueueAll = () => normalizedTracks.value.length && playerStore.enqueue(normalizedTracks.value)
const playNextAll = () => normalizedTracks.value.length && playerStore.playNext(normalizedTracks.value)

watch(() => route.fullPath, () => fetchDetail(), { immediate: true })
onBeforeUnmount(() => revision++)
</script>

<template>
    <div class="qq-playlist-page" v-loading="loading">
        <div class="qq-playlist-header" v-if="detail">
            <img :src="detail.coverImgUrl" class="qq-playlist-cover" />
            <div class="qq-playlist-info">
                <h1 class="qq-playlist-name">{{ detail.name }}</h1>
                <div class="qq-playlist-creator">创建者：{{ detail.creator }}</div>
                <div class="qq-playlist-meta">
                    <span v-if="detail.songCount">歌曲数：{{ detail.songCount }}</span>
                    <span v-if="detail.playCount">播放：{{ detail.playCount }}</span>
                </div>
                <div class="qq-playlist-desc" v-if="detail.description">{{ detail.description }}</div>
                <div class="qq-play-actions">
                    <button class="qq-play-btn" @click="playAll"><Play :size="15" fill="currentColor" />播放全部</button>
                    <button class="qq-queue-btn" @click="enqueueAll"><ListPlus :size="15" />加入队列</button>
                    <button class="qq-queue-btn" @click="playNextAll"><SkipForward :size="15" />下一首播放</button>
                </div>
            </div>
        </div>

        <div class="qq-song-list">
            <div v-for="(s, i) in songs" :key="s.id || i" class="qq-song-item" @click="playSong(s, $event)">
                <span class="qq-song-index">{{ i + 1 }}</span>
                <img v-if="s.picUrl" :src="s.picUrl" class="qq-song-cover" loading="lazy" />
                <div class="qq-song-info">
                    <div class="qq-song-name"><span class="qq-song-title">{{ s.name }}</span><QQSongBadge :song="s" /></div>
                    <div class="qq-song-artist">{{ s.artist }}</div>
                </div>
                <div class="qq-song-album">{{ s.album }}</div>
                <div class="qq-song-duration">{{ Math.floor(s.duration / 60000) }}:{{ String(Math.floor(s.duration / 1000 % 60)).padStart(2, '0') }}</div>
                <SongActionsMenu :song="toQQTrack(s)" :list="normalizedTracks" compact />
                <button v-if="canRemove" class="qq-queue-btn qq-remove-song" title="从歌单移除" aria-label="从歌单移除" :disabled="removing" @click.stop="removeSong(s)"><Trash2 :size="15" /></button>
            </div>
        </div>

        <div v-if="error" class="qq-empty" role="alert">{{ error }} <button class="qq-queue-btn" :disabled="loading" @click="fetchDetail(songs.length > 0)">重试</button></div>
        <div v-if="!loading && !error && !songs.length" class="qq-empty">歌单为空</div>
        <button v-if="hasMore" class="qq-queue-btn" :disabled="loading" @click="fetchDetail(true)">{{ loading ? '正在加载…' : '加载更多歌曲' }}</button>

        <!-- 评论区（biztype=3 歌单） -->
        <QQComment v-if="detail" :id="route.params.id" :biztype="route.meta.qqRank ? 4 : 3" />
    </div>
</template>

<style scoped>
.qq-playlist-page {
    padding: 20px 28px;
    height: 100%;
    overflow-y: auto;
}
.qq-playlist-header {
    display: flex;
    gap: 24px;
    margin-bottom: 28px;
}
.qq-playlist-cover {
    width: 200px;
    height: 200px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
}
.qq-playlist-info {
    flex: 1;
    display: flex;
    flex-direction: column;
}
.qq-playlist-name {
    font-size: 24px;
    color: var(--text-main);
    margin-bottom: 12px;
}
.qq-playlist-creator {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 8px;
}
.qq-playlist-meta {
    color: var(--text-light);
    font-size: 13px;
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
}
.qq-playlist-desc {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 16px;
    max-height: 80px;
    overflow-y: auto;
}
.qq-play-btn {
    align-self: flex-start;
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 28px;
    border-radius: 18px;
    cursor: pointer;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.qq-play-btn:hover { opacity: 0.9; }
.qq-play-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.qq-queue-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--border-color, #e6e6e6);
    background: #fff;
    color: var(--text-secondary, #666);
    border-radius: 16px;
    padding: 7px 13px;
    cursor: pointer;
    font-size: 13px;
}
.qq-queue-btn:hover { color: var(--primary-color); border-color: var(--primary-color); }
.qq-song-list {
    display: flex;
    flex-direction: column;
}
.qq-song-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    gap: 12px;
}
.qq-song-item:hover { background: var(--hover-bg); }
.qq-song-index {
    width: 28px;
    color: var(--text-light);
    font-size: 13px;
    text-align: center;
    flex-shrink: 0;
}
.qq-song-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
}
.qq-song-info { flex: 1; min-width: 0; }
.qq-song-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-song-name {
    display:flex;align-items:center;
    font-size: 14px;
    color: var(--text-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-song-artist {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
}
.qq-song-album {
    font-size: 12px;
    color: var(--text-light);
    width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-song-duration {
    font-size: 12px;
    color: var(--text-light);
    width: 50px;
    text-align: right;
}
.qq-empty {
    text-align: center;
    color: var(--text-light);
    padding: 80px 0;
    font-size: 14px;
}
</style>
