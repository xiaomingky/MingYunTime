<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import {
    kugouSingerDetail, kugouSingerSong, kugouSingerAlbum,
    normalizeKugouSong, normalizeKugouAlbum, normalizeKugouSinger, toKugouTrack
} from '../../api/kugou'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const singer = ref(null)
const hotSongs = ref([])
const albums = ref([])
const songPage = ref(1)
const songLoadingMore = ref(false)

// 是否还有更多歌曲：最后一次请求返回条数 = pagesize 时认为还有更多
const hasMoreSongs = ref(false)

// 通用分页拉取歌手歌曲（append 为 true 时追加）
const fetchSingerSongs = async (singerid, targetPage, append) => {
    const res = await kugouSingerSong(singerid, targetPage, 30)
    const list = Array.isArray(res?.data) ? res.data : (res?.data?.list || res?.data?.songs || [])
    const normalized = (Array.isArray(list) ? list : []).map(normalizeKugouSong).filter(Boolean)
    if (append) hotSongs.value.push(...normalized)
    else hotSongs.value = normalized
    hasMoreSongs.value = normalized.length >= 30
    return normalized
}

const fetchSinger = async () => {
    const singerid = route.params.id
    if (!singerid) return
    loading.value = true
    songPage.value = 1
    hasMoreSongs.value = false
    hotSongs.value = []
    try {
        const [detailRes, songRes, albumRes] = await Promise.allSettled([
            kugouSingerDetail(singerid),
            fetchSingerSongs(singerid, 1, false),
            kugouSingerAlbum(singerid, 1, 10)
        ])
        // 歌手基本信息：/artist/detail 返回 { status:1, data: { author_id, author_name, sizable_avatar, fansnums, song_count, album_count, intro, long_intro } }
        singer.value = {
            id: singerid,
            name: '未知歌手',
            picUrl: '',
            desc: '',
            fansCount: 0
        }
        if (detailRes.status === 'fulfilled' && detailRes.value) {
            const d = detailRes.value?.data || {}
            const norm = normalizeKugouSinger(d)
            if (norm) {
                singer.value.name = norm.name || singer.value.name
                singer.value.picUrl = norm.picUrl || ''
                singer.value.fansCount = norm.fansCount || 0
            }
            // intro 是简介，long_intro 是详细描述，优先 long_intro
            singer.value.desc = d.long_intro || d.intro || d.desc || d.description || ''
        }
        // 热门歌曲：/artist/audios 返回 { status:1, data: [...] }（data 直接是数组）
        // 字段：hash/audio_name/album_id/audio_id/album_audio_id/songid/author_name/timelength(毫秒)/extname/privilege/trans_param
        if (songRes.status === 'fulfilled') {
            // 从歌曲中提取歌手名（detail 失败时的降级方案）
            if (singer.value.name === '未知歌手' && hotSongs.value.length) {
                const firstArtist = hotSongs.value[0].artist
                if (firstArtist && firstArtist !== '未知歌手') singer.value.name = firstArtist
            }
        }
        // 专辑：/artist/albums 返回 { status:1, data: [...] }（data 直接是数组）
        // 字段：album_id/album_name/sizable_cover/author_name/publish_date/intro
        if (albumRes.status === 'fulfilled') {
            const r = albumRes.value
            const list = Array.isArray(r?.data) ? r.data : (r?.data?.list || r?.data?.albums || [])
            albums.value = (Array.isArray(list) ? list : []).map(normalizeKugouAlbum).filter(Boolean)
        }
    } catch (e) {
        console.error('[Kugou Singer] error:', e)
        messageStore.error('酷狗歌手加载失败')
    } finally {
        loading.value = false
    }
}

const playSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = hotSongs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

// 加载更多歌手歌曲
const loadMoreSongs = async () => {
    if (songLoadingMore.value || loading.value) return
    if (!hasMoreSongs.value) return
    songLoadingMore.value = true
    try {
        const nextPage = songPage.value + 1
        const normalized = await fetchSingerSongs(route.params.id, nextPage, true)
        songPage.value = nextPage
        // 返回条数少于 pagesize 时不再显示加载更多
        hasMoreSongs.value = normalized.length >= 30
    } catch (e) {
        console.error('[Kugou Singer] loadMore error:', e)
        messageStore.error('加载更多失败')
    } finally {
        songLoadingMore.value = false
    }
}

const formatFans = (n) => {
    if (!n) return '0'
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
}

watch(() => route.params.id, fetchSinger)
onMounted(fetchSinger)
</script>

<template>
    <div class="kugou-singer-page" v-loading="loading">
        <div class="kugou-singer-header" v-if="singer">
            <img :src="singer.picUrl" class="kugou-singer-pic" />
            <div class="kugou-singer-info">
                <h1 class="kugou-singer-name">{{ singer.name }}</h1>
                <div class="kugou-singer-meta" v-if="singer.fansCount">粉丝数：{{ formatFans(singer.fansCount) }}</div>
                <div class="kugou-singer-desc" v-if="singer.desc">{{ singer.desc }}</div>
            </div>
        </div>

        <section class="kugou-section" v-if="hotSongs.length">
            <h2 class="kugou-section-title">热门歌曲</h2>
            <div class="kugou-song-list">
                <div v-for="(s, i) in hotSongs" :key="s.id || i" class="kugou-song-item" @dblclick="playSong(s)">
                    <span class="kugou-song-index">{{ i + 1 }}</span>
                    <img v-if="s.picUrl" :src="s.picUrl" class="kugou-song-cover" loading="lazy" />
                    <div class="kugou-song-info">
                        <div class="kugou-song-name">
                            <span class="name-text">{{ s.name }}</span>
                            <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                        </div>
                        <div class="kugou-song-artist">{{ s.artist }}</div>
                    </div>
                    <div class="kugou-song-album">{{ s.album }}</div>
                </div>
            </div>
            <!-- 加载更多 -->
            <div v-if="hasMoreSongs" class="kugou-loadmore-wrap">
                <button class="kugou-loadmore-btn" :disabled="songLoadingMore" @click="loadMoreSongs">
                    {{ songLoadingMore ? '加载中...' : '加载更多' }}
                </button>
                <span class="kugou-loadmore-tip">已加载 {{ hotSongs.length }} 首</span>
            </div>
        </section>

        <section class="kugou-section" v-if="albums.length">
            <h2 class="kugou-section-title">专辑</h2>
            <div class="kugou-card-grid">
                <div v-for="a in albums" :key="a.id" class="kugou-card" @click="router.push(`/kugou/album/${a.id}`)">
                    <img :src="a.picUrl" :alt="a.name" class="kugou-card-img" loading="lazy" />
                    <div class="kugou-card-name">{{ a.name }}</div>
                </div>
            </div>
        </section>
    </div>
</template>

<style scoped>
.kugou-singer-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.kugou-singer-header { display: flex; gap: 24px; margin-bottom: 28px; }
.kugou-singer-pic { width: 180px; height: 180px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.kugou-singer-info { flex: 1; display: flex; flex-direction: column; }
.kugou-singer-name { font-size: 26px; color: var(--text-main); margin-bottom: 8px; }
.kugou-singer-meta { font-size: 13px; color: var(--primary-color); margin-bottom: 8px; }
.kugou-singer-desc { color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-height: 120px; overflow-y: auto; }
.kugou-section { margin-bottom: 32px; }
.kugou-section-title {
    font-size: 18px; font-weight: 600; margin-bottom: 14px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
.kugou-song-list { display: flex; flex-direction: column; }
.kugou-song-item {
    display: flex; align-items: center; padding: 8px 12px;
    border-radius: 6px; cursor: pointer; gap: 12px;
}
.kugou-song-item:hover { background: var(--hover-bg); }
.kugou-song-index { width: 28px; color: var(--text-light); font-size: 13px; text-align: center; }
.kugou-song-cover { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
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
    font-size: 12px; color: var(--text-light); width: 200px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 18px;
}
.kugou-card { cursor: pointer; transition: transform 0.18s; }
.kugou-card:hover { transform: translateY(-3px); }
.kugou-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.kugou-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-loadmore-wrap {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 20px 0 8px;
}
.kugou-loadmore-btn {
    background: var(--primary-color); color: white; border: none;
    padding: 8px 28px; border-radius: 18px; cursor: pointer; font-size: 13px;
    transition: opacity 0.18s;
}
.kugou-loadmore-btn:hover { opacity: 0.9; }
.kugou-loadmore-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.kugou-loadmore-tip { font-size: 12px; color: var(--text-light); }
</style>
