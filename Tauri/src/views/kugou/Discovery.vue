<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { ChevronLeft, ChevronRight, Play } from 'lucide-vue-next'
import {
    kugouAlbumNew, kugouPlaylist,
    kugouBanner, kugouNewSong,
    normalizeKugouAlbum, normalizeKugouPlaylist, normalizeKugouSong, toKugouTrack
} from '../../api/kugou'

const router = useRouter()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const banners = ref([])
const newSongs = ref([])
const newDisks = ref([])
const recommendPlaylists = ref([])

// ===== Banner 轮播 =====
const currentBanner = ref(0)
let bannerTimer = null
const startBannerAuto = () => {
    if (banners.value.length > 1) {
        bannerTimer = setInterval(() => {
            currentBanner.value = (currentBanner.value + 1) % banners.value.length
        }, 5000)
    }
}
const stopBannerAuto = () => { clearInterval(bannerTimer); bannerTimer = null }
const prevBanner = () => { currentBanner.value = (currentBanner.value - 1 + banners.value.length) % banners.value.length }
const nextBanner = () => { currentBanner.value = (currentBanner.value + 1) % banners.value.length }

// 封面加载失败时隐藏 img,显示占位背景
const onImgError = (e) => {
    e.target.style.display = 'none'
    e.target.parentElement.classList.add('img-fallback')
}

const fetchAll = async (retryCount = 5) => {
    loading.value = true
    try {
        const [bannerRes, songRes, disksRes, hotRes] = await Promise.allSettled([
            kugouBanner(),
            kugouNewSong(),
            kugouAlbumNew(1, 10),
            kugouPlaylist(0, 0, 0, 1, 10)
        ])

        let hasData = false
        // Banner：/pc/diantai 实测返回 { status:1, data: { data: [ {code, title, url, isAd, jump_type, ...}, ... ] } }
        // code 是图片 URL，url 是跳转链接
        if (bannerRes.status === 'fulfilled') {
            const r = bannerRes.value || {}
            const arr = r?.data?.data || r?.data || []
            banners.value = (Array.isArray(arr) ? arr : [])
                .filter(b => b?.code && b?.url)
                .slice(0, 8)
                .map(b => ({
                    imageUrl: b.code,
                    url: b.url,
                    title: b.title || ''
                }))
            if (banners.value.length) { startBannerAuto(); hasData = true; }
        }
        // 新歌速递：/top/song 实测返回 { status:1, data: [ {hash, songname, author_name, authors[], album_audio_id, album_sizable_cover, timelength, ...}, ... ] }
        if (songRes.status === 'fulfilled') {
            const r = songRes.value || {}
            const list = Array.isArray(r?.data) ? r.data : (r?.data?.list || [])
            newSongs.value = (Array.isArray(list) ? list : []).slice(0, 12)
                .map(normalizeKugouSong).filter(Boolean)
            if (newSongs.value.length) hasData = true;
        }
        // 新碟上架：/top/album 实测返回 { status:1, data: [ {album_id, album_name, sizable_cover, author_name, publish_date, intro}, ... ] }
        if (disksRes.status === 'fulfilled') {
            const r = disksRes.value || {}
            const albums = Array.isArray(r?.data) ? r.data : (r?.data?.list || r?.data?.albums || [])
            newDisks.value = albums.slice(0, 10).map(normalizeKugouAlbum).filter(a => a.id)
            if (newDisks.value.length) hasData = true;
        }
        // 推荐歌单：/top/playlist 实测返回 { status:1, data: { special_list: [...] } }
        if (hotRes.status === 'fulfilled') {
            const r = hotRes.value || {}
            const list = r?.data?.special_list || r?.data?.list || r?.data?.playlists || []
            recommendPlaylists.value = (Array.isArray(list) ? list : []).slice(0, 10).map(normalizeKugouPlaylist).filter(p => p.id)
            if (recommendPlaylists.value.length) hasData = true;
        }

        if (!hasData && retryCount > 0) {
            setTimeout(() => fetchAll(retryCount - 1), 1200)
            return
        }
    } catch (e) {
        if (retryCount > 0) {
            setTimeout(() => fetchAll(retryCount - 1), 1200)
            return
        }
        console.error('[Kugou Discovery] fetch error:', e)
        messageStore.error('酷狗概念版数据加载失败')
    } finally {
        loading.value = false
    }
}

const goToAlbum = (albumid) => albumid && router.push(`/kugou/album/${albumid}`)
const goToPlaylist = (id) => id && router.push(`/kugou/playlist/${id}`)

const playNewSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = newSongs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const formatPlayCount = (n) => {
    if (!n) return ''
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
}

onMounted(fetchAll)
onUnmounted(() => stopBannerAuto())
</script>

<template>
    <div class="kugou-page" v-loading="loading">
        <!-- Banner 轮播 -->
        <section v-if="banners.length" class="kugou-banner-section">
            <div class="kugou-banner-container" @mouseenter="stopBannerAuto" @mouseleave="startBannerAuto">
                <Transition name="banner-fade" mode="out-in">
                    <img
                        :key="currentBanner"
                        :src="banners[currentBanner].imageUrl"
                        :alt="banners[currentBanner].title"
                        class="kugou-banner-img"
                    />
                </Transition>
                <div v-if="banners.length > 1" class="kugou-banner-arrows">
                    <div class="kugou-banner-arrow left" @click="prevBanner"><ChevronLeft :size="22" /></div>
                    <div class="kugou-banner-arrow right" @click="nextBanner"><ChevronRight :size="22" /></div>
                </div>
                <div v-if="banners.length > 1" class="kugou-banner-dots">
                    <span
                        v-for="(b, i) in banners"
                        :key="i"
                        class="kugou-banner-dot"
                        :class="{ active: i === currentBanner }"
                        @click="currentBanner = i"
                    ></span>
                </div>
            </div>
        </section>

        <!-- 推荐歌单 -->
        <section v-if="recommendPlaylists.length" class="kugou-section">
            <h2 class="kugou-section-title">推荐歌单</h2>
            <div class="kugou-card-grid">
                <div v-for="p in recommendPlaylists" :key="p.id" class="kugou-card" @click="goToPlaylist(p.id)">
                    <div class="kugou-card-img-wrap">
                        <img :src="p.coverImgUrl" :alt="p.name" class="kugou-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="kugou-card-name" :title="p.name">{{ p.name }}</div>
                    <div class="kugou-card-meta" v-if="p.playCount">播放 {{ formatPlayCount(p.playCount) }}</div>
                </div>
            </div>
        </section>

        <!-- 新歌速递 -->
        <section v-if="newSongs.length" class="kugou-section">
            <h2 class="kugou-section-title">新歌速递</h2>
            <div class="kugou-song-grid">
                <div
                    v-for="(s, i) in newSongs"
                    :key="s.id || i"
                    class="kugou-song-item"
                    @click="playNewSong(s)"
                >
                    <div class="kugou-song-rank">{{ i + 1 < 10 ? '0' + (i + 1) : i + 1 }}</div>
                    <div class="kugou-song-thumb">
                        <img :src="s.picUrl" @error="onImgError" />
                        <div class="kugou-song-play">
                            <Play :size="10" fill="white" />
                        </div>
                    </div>
                    <div class="kugou-song-info">
                        <div class="kugou-song-name" :title="s.name">
                            <span class="name-text">{{ s.name }}</span>
                            <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                        </div>
                        <div class="kugou-song-artist" :title="s.artist">{{ s.artist }}</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 新碟上架 -->
        <section v-if="newDisks.length" class="kugou-section">
            <h2 class="kugou-section-title">新碟上架</h2>
            <div class="kugou-card-grid">
                <div v-for="a in newDisks" :key="a.id" class="kugou-card" @click="goToAlbum(a.id)">
                    <div class="kugou-card-img-wrap">
                        <img :src="a.picUrl" :alt="a.name" class="kugou-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="kugou-card-name" :title="a.name">{{ a.name }}</div>
                    <div class="kugou-card-meta">{{ a.artist }}</div>
                </div>
            </div>
        </section>

        <div v-if="!loading && !recommendPlaylists.length && !newDisks.length && !newSongs.length && !banners.length" class="kugou-empty">
            酷狗概念版数据加载失败，请稍后重试
        </div>
    </div>
</template>

<style scoped>
.kugou-page {
    padding: 20px 28px;
    overflow-y: auto;
    height: 100%;
}

/* ===== Banner ===== */
.kugou-banner-section {
    margin-bottom: 32px;
}
.kugou-banner-container {
    position: relative;
    width: 100%;
    height: 180px;
    border-radius: 10px;
    overflow: hidden;
    background: var(--hover-bg);
}
.kugou-banner-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.kugou-banner-arrows {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 8px;
    pointer-events: none;
}
/* 漂浮圆形箭头:默认隐藏,鼠标靠近 banner 时才显现 */
.kugou-banner-arrow {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.35);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    pointer-events: auto;
    opacity: 0;
    transition: opacity 0.25s, background 0.18s;
}
.kugou-banner-container:hover .kugou-banner-arrow {
    opacity: 1;
}
.kugou-banner-arrow:hover {
    background: rgba(0, 0, 0, 0.6);
}
.kugou-banner-dots {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
}
.kugou-banner-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    transition: all 0.2s;
}
.kugou-banner-dot.active {
    background: white;
    width: 20px;
    border-radius: 4px;
}
.banner-fade-enter-active, .banner-fade-leave-active {
    transition: opacity 0.4s ease;
}
.banner-fade-enter-from, .banner-fade-leave-to {
    opacity: 0;
}

/* ===== Section ===== */
.kugou-section {
    margin-bottom: 36px;
}
.kugou-section-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-main);
    border-left: 3px solid var(--primary-color);
    padding-left: 10px;
}

/* ===== 新歌速递 ===== */
.kugou-song-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 8px 16px;
}
.kugou-song-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
}
.kugou-song-item:hover {
    background: var(--hover-bg);
}
.kugou-song-rank {
    font-size: 14px;
    color: var(--text-light);
    width: 24px;
    text-align: center;
    font-family: monospace;
    flex-shrink: 0;
}
.kugou-song-thumb {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
    background: var(--hover-bg);
}
.kugou-song-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.kugou-song-thumb.img-fallback::before {
    content: '♪';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 18px;
    color: var(--text-light);
    opacity: 0.4;
}
.kugou-song-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 22px;
    height: 22px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
}
.kugou-song-item:hover .kugou-song-play {
    opacity: 1;
}
.kugou-song-info {
    flex: 1;
    min-width: 0;
}
.kugou-song-name {
    font-size: 13px;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 4px;
}
.kugou-song-name .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
}
.kugou-song-artist {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ===== Card Grid ===== */
.kugou-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 18px;
}
.kugou-card {
    cursor: pointer;
    transition: transform 0.18s ease;
}
.kugou-card:hover {
    transform: translateY(-3px);
}
.kugou-card-img-wrap {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: var(--hover-bg);
    position: relative;
}
.kugou-card-img-wrap.img-fallback::before {
    content: '♪';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 36px;
    color: var(--text-light);
    opacity: 0.4;
}
.kugou-card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.kugou-card-name {
    font-size: 13px;
    margin-top: 8px;
    color: var(--text-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kugou-card-meta {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kugou-empty {
    text-align: center;
    color: var(--text-light);
    padding: 80px 0;
    font-size: 14px;
}
</style>
