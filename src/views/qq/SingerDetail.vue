<script setup>
import ArtVideoPlayer from '../../components/ArtVideoPlayer.vue'
import QQSongBadge from '../../components/QQSongBadge.vue'
import { ref, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import {
    qqSingerDesc, qqSingerHotsong, qqSingerAlbum,
    qqSingerMv, qqSimilarSinger, qqSingerStarNum,
    qqMvPlay,
    normalizeQQSong, normalizeQQAlbum, normalizeQQSinger, toQQTrack,
    enrichQQSongWithDetail, getQQCookie
} from '../../api/qq'
import SongActionsMenu from '../../components/SongActionsMenu.vue'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const singer = ref(null)
const hotSongs = ref([])
const albums = ref([])
const mvs = ref([])
const similarSingers = ref([])
const starNum = ref(0)
const error = ref('')
const songPage = ref(1), albumPage = ref(1), songTotal = ref(0), albumTotal = ref(0)
const moreSongs = ref(false), moreAlbums = ref(false), songLoading = ref(false), albumLoading = ref(false)
const songError = ref(''), albumError = ref('')
let revision = 0

const fetchSinger = async () => {
    const singermid = route.params.id
    if (!singermid) return
    const requestId = ++revision
    loading.value = true
    singer.value = null; hotSongs.value = []; albums.value = []; mvs.value = []; similarSingers.value = []; starNum.value = 0; error.value = ''
    songPage.value = 1; albumPage.value = 1; songTotal.value = 0; albumTotal.value = 0
    moreSongs.value = false; moreAlbums.value = false; songError.value = ''; albumError.value = ''
    songLoading.value = false; albumLoading.value = false
    try {
        const [descRes, songRes, albumRes, mvRes, similarRes, starRes] = await Promise.allSettled([
            qqSingerDesc(singermid),
            qqSingerHotsong(singermid, 30, 1),
            qqSingerAlbum(singermid, 10, 1),
            qqSingerMv(singermid, 12, 'time'),
            qqSimilarSinger(singermid),
            qqSingerStarNum(singermid)
        ])
        if (requestId !== revision) return
        const unavailable = [descRes, songRes, albumRes].map((result, index) =>
            result.status === 'rejected' || result.value?.code !== 0 ? ['歌手资料', '热门歌曲', '专辑'][index] : '').filter(Boolean)
        if (unavailable.length) error.value = `${unavailable.join('、')}加载失败，请重试`
        // 歌手基本信息（getSingerDesc 常返回 referer error，容错处理）
        singer.value = {
            id: singermid,
            name: '未知歌手',
            picUrl: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singermid}.jpg`,
            desc: ''
        }
        if (descRes.status === 'fulfilled' && descRes.value && typeof descRes.value === 'object') {
            const d = descRes.value
            singer.value.name = d?.singer?.name || d?.name || d?.singername || singer.value.name
            singer.value.picUrl = d?.singer?.pic || d?.singerPic || singer.value.picUrl
            singer.value.desc = d?.singer?.desc || d?.desc || ''
        }
        // 热门歌曲：解包后 { code, singer: { data: { songlist: [...] } } }
        if (songRes.status === 'fulfilled') {
            const r = songRes.value
            const list = r?.singer?.data?.songlist || r?.data?.songlist || r?.data?.list || []
            hotSongs.value = list.map(normalizeQQSong).filter(Boolean)
            songTotal.value = Number(r?.data?.total ?? hotSongs.value.length)
            moreSongs.value = list.length > 0 && hotSongs.value.length < songTotal.value
            // 无专辑封面(albummid 缺失)的歌曲,调官方 song-detail 接口拿真实 albummid 构造 T002 封面
            const cookie = getQQCookie()
            hotSongs.value.forEach((s, i) => {
                if (!s.picUrl || !s.picUrl.includes('T002R300x300M000')) {
                    enrichQQSongWithDetail(s, cookie).then(updated => {
                        if (requestId === revision && updated.picUrl && hotSongs.value[i]?.id === s.id) hotSongs.value[i] = updated
                    }).catch(() => {})
                }
            })
            // 从歌曲中提取歌手名（getSingerDesc 失败时的降级方案）
            if (singer.value.name === '未知歌手' && hotSongs.value.length) {
                const firstArtist = hotSongs.value[0].artist
                if (firstArtist && firstArtist !== '未知歌手') singer.value.name = firstArtist
            }
        }
        // 专辑：解包后可能为 { code, singerAlbum: { data: { list: [...] } } } 或 { code, data: { list: [...] } }
        if (albumRes.status === 'fulfilled') {
            const r = albumRes.value
            const list = r?.singerAlbum?.data?.list || r?.data?.list || r?.data?.albumList || []
            albums.value = list.map(normalizeQQAlbum).filter(Boolean)
            albumTotal.value = Number(r?.data?.total ?? albums.value.length)
            moreAlbums.value = list.length > 0 && albums.value.length < albumTotal.value
        }
        // MV：解包后可能为 { code, mv: { data: { list: [...] } } } 或 { code, data: { mvlist: [...] } }
        if (mvRes.status === 'fulfilled') {
            const r = mvRes.value
            const list = r?.mv?.data?.list || r?.data?.list || r?.data?.mvlist || []
            mvs.value = list.map(m => ({
                id: m.vid || m.mv_id || m.mvId,
                vid: m.vid || m.mv_id || m.mvId,
                name: m.mv_name || m.title || m.songname || m.name || '',
                artist: m.singer_name || m.singername || m.singerName || '',
                picUrl: m.mv_pic_url || m.pic || m.picUrl || ''
            })).filter(m => m.vid)
        }
        // 相似歌手
        if (similarRes.status === 'fulfilled') {
            const r = similarRes.value
            const list = r?.singerList?.data?.singerlist || r?.data?.singerlist || r?.data?.list || []
            similarSingers.value = list.map(normalizeQQSinger).filter(s => s.id).slice(0, 8)
        }
        // 粉丝数
        if (starRes.status === 'fulfilled') {
            const r = starRes.value
            starNum.value = r?.star_num || r?.starNum || r?.fans || r?.data?.star_num || r?.data?.starNum || 0
        }
    } catch (e) {
        if (requestId === revision) { error.value = e.message || 'QQ 歌手加载失败'; messageStore.error(error.value) }
    } finally {
        if (requestId === revision) loading.value = false
    }
}

const loadMore = async (kind) => {
    const songs = kind === 'songs', busy = songs ? songLoading : albumLoading
    const hasMore = songs ? moreSongs : moreAlbums, page = songs ? songPage : albumPage
    const list = songs ? hotSongs : albums, failure = songs ? songError : albumError
    if (busy.value || !hasMore.value) return
    const requestId = revision, id = route.params.id
    busy.value = true; failure.value = ''
    try {
        const response = await (songs ? qqSingerHotsong(id, 30, page.value + 1) : qqSingerAlbum(id, 10, page.value + 1))
        if (requestId !== revision) return
        if (response?.code !== 0) throw new Error(response?.message || '加载失败，请重试')
        const raw = songs ? response.data?.songlist : response.data?.list
        if (!Array.isArray(raw)) throw new Error('QQ 分页响应不完整，请重试')
        const normalized = raw.map(songs ? normalizeQQSong : normalizeQQAlbum).filter(item => item?.id)
        const known = new Set(list.value.map(item => String(item.id)))
        const next = normalized.filter(item => { const key = String(item.id); if (known.has(key)) return false; known.add(key); return true })
        if (raw.length && !next.length) throw new Error('QQ 返回了重复分页，请稍后重试')
        list.value.push(...next); page.value++
        hasMore.value = raw.length > 0 && list.value.length < (songs ? songTotal.value : albumTotal.value)
    } catch (e) { if (requestId === revision) failure.value = e.message }
    finally { if (requestId === revision) busy.value = false }
}

const playSong = (song, event = null) => {
    const track = toQQTrack(song)
    if (!track) return
    const list = hotSongs.value.map(toQQTrack).filter(Boolean)
    playerStore.handleSongClick(track, list, event)
}

// MV 播放
const currentMv = ref(null)
const playMv = async (mv) => {
    if (!mv.vid) return
    try {
        const res = await qqMvPlay(mv.vid)
        const data = res?.data || res
        let url = data?.url || data?.mp4Url || data?.h264Url
        if (!url && data?.midurlinfo?.length) url = data.midurlinfo[0].purl || data.midurlinfo[0].url
        if (!url && data?.urls?.length) url = data.urls[0]
        if (url) {
            currentMv.value = {
                vid: mv.vid, name: mv.name, artist: mv.artist,
                url: url.startsWith('http') ? url : `https:${url}`,
                picUrl: mv.picUrl
            }
        } else {
            messageStore.warning('MV 暂不可播放（VIP 或版权限制）')
        }
    } catch (e) {
        console.error('[QQ Singer] playMv error:', e)
        messageStore.error('MV 播放失败')
    }
}
const closeMv = () => { currentMv.value = null }

const formatFans = (n) => {
    if (!n) return '0'
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
}

watch(() => route.params.id, fetchSinger, { immediate: true })
onBeforeUnmount(() => revision++)
</script>

<template>
    <div class="qq-singer-page" v-loading="loading">
        <div v-if="error" class="qq-empty" role="alert">{{ error }} <button :disabled="loading" @click="fetchSinger">重试</button></div>
        <div class="qq-singer-header" v-if="singer">
            <img :src="singer.picUrl" class="qq-singer-pic" />
            <div class="qq-singer-info">
                <h1 class="qq-singer-name">{{ singer.name }}</h1>
                <div class="qq-singer-meta" v-if="starNum">粉丝数：{{ formatFans(starNum) }}</div>
                <div class="qq-singer-desc" v-if="singer.desc">{{ singer.desc }}</div>
            </div>
        </div>

        <section class="qq-section" v-if="hotSongs.length">
            <h2 class="qq-section-title">热门歌曲 <small>{{ hotSongs.length }} / {{ songTotal }}</small></h2>
            <div class="qq-song-list">
                <div v-for="(s, i) in hotSongs" :key="s.id || i" class="qq-song-item" @click="playSong(s, $event)">
                    <span class="qq-song-index">{{ i + 1 }}</span>
                    <div class="qq-song-info">
                        <div class="qq-song-name"><span class="qq-song-title">{{ s.name }}</span><QQSongBadge :song="s" /></div>
                        <div class="qq-song-artist">{{ s.artist }}</div>
                    </div>
                    <div class="qq-song-album">{{ s.album }}</div>
                    <SongActionsMenu :song="toQQTrack(s)" :list="hotSongs.map(toQQTrack).filter(Boolean)" compact />
                </div>
            </div>
            <p v-if="songError" role="alert">{{ songError }}</p>
            <button v-if="moreSongs" class="qq-singer-more" :disabled="songLoading" @click="loadMore('songs')">{{ songLoading ? '加载中…' : '加载更多歌曲' }}</button>
        </section>

        <section class="qq-section" v-if="albums.length">
            <h2 class="qq-section-title">专辑 <small>{{ albums.length }} / {{ albumTotal }}</small></h2>
            <div class="qq-card-grid">
                <div v-for="a in albums" :key="a.id" class="qq-card" @click="router.push(`/qq/album/${a.id}`)">
                    <img :src="a.picUrl" :alt="a.name" class="qq-card-img" loading="lazy" />
                    <div class="qq-card-name">{{ a.name }}</div>
                </div>
            </div>
            <p v-if="albumError" role="alert">{{ albumError }}</p>
            <button v-if="moreAlbums" class="qq-singer-more" :disabled="albumLoading" @click="loadMore('albums')">{{ albumLoading ? '加载中…' : '加载更多专辑' }}</button>
        </section>

        <section class="qq-section" v-if="mvs.length">
            <h2 class="qq-section-title">MV</h2>
            <div class="qq-mv-grid">
                <div v-for="m in mvs" :key="m.id" class="qq-card qq-mv-card" @click="playMv(m)">
                    <div class="qq-mv-cover-wrap">
                        <img :src="m.picUrl" :alt="m.name" class="qq-card-img" loading="lazy" />
                        <div class="qq-mv-play-overlay">▶</div>
                    </div>
                    <div class="qq-card-name">{{ m.name }}</div>
                </div>
            </div>
        </section>

        <section class="qq-section" v-if="similarSingers.length">
            <h2 class="qq-section-title">相似歌手</h2>
            <div class="qq-card-grid">
                <div v-for="s in similarSingers" :key="s.id" class="qq-card" @click="router.push(`/qq/singer/${s.id}`)">
                    <img :src="s.picUrl" :alt="s.name" class="qq-singer-thumb" loading="lazy" />
                    <div class="qq-card-name">{{ s.name }}</div>
                </div>
            </div>
        </section>

        <!-- MV 播放器浮层 -->
        <div v-if="currentMv" class="qq-mv-player" @click.self="closeMv">
            <div class="qq-mv-player-box">
                <div class="qq-mv-player-header">
                    <span>{{ currentMv.name }} - {{ currentMv.artist }}</span>
                    <span class="qq-mv-close" @click="closeMv">×</span>
                </div>
                <ArtVideoPlayer :src="currentMv.url" :episode-title="currentMv.name" :episode-cover="currentMv.picUrl" :episodes="mvs" :current-episode="currentMv" @selectEpisode="playMv" play-type="direct" :autoplay="true" class="qq-mv-video" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.qq-singer-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-singer-more { display: block; margin: 18px auto; padding: 10px 24px; border: 1px solid var(--primary-color); border-radius: 20px; color: var(--primary-color); background: transparent; cursor: pointer; }
.qq-singer-more:disabled { opacity: .6; cursor: wait; }
.qq-section-title small { font-size: 12px; font-weight: normal; color: var(--text-secondary); margin-left: 10px; }
.qq-singer-header { display: flex; gap: 24px; margin-bottom: 28px; }
.qq-singer-pic { width: 180px; height: 180px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.qq-singer-info { flex: 1; display: flex; flex-direction: column; }
.qq-singer-name { font-size: 26px; color: var(--text-main); margin-bottom: 8px; }
.qq-singer-meta { font-size: 13px; color: var(--primary-color); margin-bottom: 8px; }
.qq-singer-desc { color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-height: 120px; overflow-y: auto; }
.qq-section { margin-bottom: 32px; }
.qq-section-title {
    font-size: 18px; font-weight: 600; margin-bottom: 14px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
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
.qq-song-album {
    font-size: 12px; color: var(--text-light); width: 200px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 18px;
}
.qq-mv-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px;
}
.qq-card { cursor: pointer; transition: transform 0.18s; }
.qq-card:hover { transform: translateY(-3px); }
.qq-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.qq-singer-thumb {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 50%; background: var(--hover-bg);
}
.qq-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-mv-cover-wrap { position: relative; }
.qq-mv-play-overlay {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 40px; height: 40px; border-radius: 50%;
    background: rgba(0,0,0,0.55); color: white; display: flex;
    align-items: center; justify-content: center; font-size: 16px;
    opacity: 0; transition: opacity 0.2s;
}
.qq-mv-card:hover .qq-mv-play-overlay { opacity: 1; }
.qq-mv-player {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); z-index: 999;
    display: flex; align-items: center; justify-content: center;
}
.qq-mv-player-box {
    width: 80%; max-width: 960px; background: #000;
    border-radius: 8px; overflow: hidden;
}
.qq-mv-player-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; color: white; background: rgba(0,0,0,0.7);
    font-size: 14px;
}
.qq-mv-close { cursor: pointer; font-size: 22px; line-height: 1; }
.qq-mv-video { width: 100%; max-height: 70vh; display: block; background: #000; }
</style>
