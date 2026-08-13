<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import {
    qqNewDisks, qqPlaylistList,
    qqDigitalAlbums, qqTicketInfo, qqTopLists,
    normalizeQQSong, normalizeQQAlbum, normalizeQQPlaylist, toQQTrack
} from '../../api/qq'

const router = useRouter()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const loading = ref(false)
const newDisks = ref([])
const recommendPlaylists = ref([])
const topLists = ref([])
const digitalAlbums = ref([])
const ticketInfo = ref(null)

// 封面加载失败时隐藏 img,显示占位背景
const onImgError = (e) => {
    e.target.style.display = 'none'
    e.target.parentElement.classList.add('img-fallback')
}

const fetchAll = async (retryCount = 5) => {
    loading.value = true
    try {
        const [disksRes, hotRes, digitalRes, ticketRes, topRes] = await Promise.allSettled([
            qqNewDisks(10, 1),
            qqPlaylistList({ categoryId: 10000000, limit: 10, page: 1 }),
            qqDigitalAlbums(10, 1),
            qqTicketInfo(),
            qqTopLists()
        ])

        // 新碟上架
        if (disksRes.status === 'fulfilled') {
            const r = disksRes.value
            const albums = r?.new_album?.data?.albums || r?.data?.albums || r?.data?.newDisks || []
            newDisks.value = albums.slice(0, 10).map(normalizeQQAlbum).filter(a => a.id)
        }
        // 推荐歌单
        if (hotRes.status === 'fulfilled') {
            const r = hotRes.value
            const list = r?.data?.list || r?.list || []
            recommendPlaylists.value = list.slice(0, 10).map(normalizeQQPlaylist).filter(p => p.id)
        }
        // 排行榜
        if (topRes.status === 'fulfilled') {
            const r = topRes.value
            const list = r?.data?.topList || r?.data?.list || r?.data || []
            topLists.value = (Array.isArray(list) ? list : []).slice(0, 10).map(t => ({
                id: t.topId || t.id || t.topid || '',
                name: t.topName || t.title || t.name || '',
                picUrl: t.frontPicUrl || t.picUrl || t.pic || '',
                description: t.description || t.intro || ''
            })).filter(t => t.id)
        }
        // 数字专辑
        if (digitalRes.status === 'fulfilled') {
            const r = digitalRes.value
            const list = r?.data?.albumList || r?.data?.list || r?.data?.digitalAlbums || []
            digitalAlbums.value = list.slice(0, 10).map(a => {
                const mid = a.albumMID || a.albummid || a.mid || a.id
                return {
                    id: mid,
                    name: a.albumName || a.albumname || a.name || '',
                    picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : (a.picurl || a.imgurl || ''),
                    artist: a.singerName || a.singername || '',
                    price: a.price || a.albumPrice || ''
                }
            }).filter(a => a.id)
        }
        // 演出票务
        if (ticketRes.status === 'fulfilled') {
            const r = ticketRes.value
            const t = r?.data?.ticketInfo || r?.data || r
            if (t && (t.title || t.name || (t.list && t.list.length))) {
                ticketInfo.value = {
                    title: t.title || t.name || '演出票务',
                    list: (t.list || t.shows || t.tickets || []).slice(0, 6).map(s => ({
                        id: s.id || s.showId,
                        name: s.name || s.title || s.showName,
                        time: s.showTime || s.time || s.date || '',
                        place: s.place || s.venue || s.city || ''
                    }))
                }
            }
        }
    } catch (e) {
        console.error('[QQ Discovery] fetch error:', e)
        messageStore.error('QQ 音乐数据加载失败')
    } finally {
        loading.value = false
    }
}

const goToAlbum = (albummid) => albummid && router.push(`/qq/album/${albummid}`)
const goToPlaylist = (disstid) => disstid && router.push(`/qq/playlist/${disstid}`)

onMounted(fetchAll)
</script>

<template>
    <div class="qq-page" v-loading="loading">
        <!-- 推荐歌单 -->
        <section class="qq-section" v-if="recommendPlaylists.length">
            <h2 class="qq-section-title">推荐歌单</h2>
            <div class="qq-card-grid">
                <div v-for="p in recommendPlaylists" :key="p.id" class="qq-card" @click="goToPlaylist(p.id)">
                    <div class="qq-card-img-wrap">
                        <img :src="p.coverImgUrl" :alt="p.name" class="qq-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="qq-card-name" :title="p.name">{{ p.name }}</div>
                    <div class="qq-card-meta" v-if="p.playCount">播放 {{ p.playCount }}</div>
                </div>
            </div>
        </section>

        <!-- 排行榜 -->
        <section class="qq-section" v-if="topLists.length">
            <h2 class="qq-section-title">排行榜</h2>
            <div class="qq-card-grid">
                <div v-for="t in topLists" :key="t.id" class="qq-card" @click="goToPlaylist(t.id)">
                    <div class="qq-card-img-wrap">
                        <img :src="t.picUrl" :alt="t.name" class="qq-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="qq-card-name" :title="t.name">{{ t.name }}</div>
                </div>
            </div>
        </section>

        <!-- 新碟上架 -->
        <section class="qq-section" v-if="newDisks.length">
            <h2 class="qq-section-title">新碟上架</h2>
            <div class="qq-card-grid">
                <div v-for="a in newDisks" :key="a.id" class="qq-card" @click="goToAlbum(a.id)">
                    <div class="qq-card-img-wrap">
                        <img :src="a.picUrl" :alt="a.name" class="qq-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="qq-card-name" :title="a.name">{{ a.name }}</div>
                    <div class="qq-card-meta">{{ a.artist }}</div>
                </div>
            </div>
        </section>

        <!-- 数字专辑 -->
        <section class="qq-section" v-if="digitalAlbums.length">
            <h2 class="qq-section-title">数字专辑</h2>
            <div class="qq-card-grid">
                <div v-for="a in digitalAlbums" :key="a.id" class="qq-card" @click="goToAlbum(a.id)">
                    <div class="qq-card-img-wrap">
                        <img :src="a.picUrl" :alt="a.name" class="qq-card-img" loading="lazy" @error="onImgError" />
                    </div>
                    <div class="qq-card-name" :title="a.name">{{ a.name }}</div>
                    <div class="qq-card-meta">{{ a.artist }}<span v-if="a.price"> · ¥{{ a.price }}</span></div>
                </div>
            </div>
        </section>

        <!-- 演出票务 -->
        <section class="qq-section" v-if="ticketInfo && ticketInfo.list && ticketInfo.list.length">
            <h2 class="qq-section-title">{{ ticketInfo.title }}</h2>
            <div class="qq-ticket-list">
                <div v-for="t in ticketInfo.list" :key="t.id" class="qq-ticket-item">
                    <div class="qq-ticket-info">
                        <div class="qq-ticket-name">{{ t.name }}</div>
                        <div class="qq-ticket-meta">
                            <span v-if="t.time">{{ t.time }}</span>
                            <span v-if="t.place"> · {{ t.place }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <div v-if="!loading && !recommendPlaylists.length && !newDisks.length" class="qq-empty">
            QQ 音乐数据加载失败，请稍后重试
        </div>
    </div>
</template>

<style scoped>
.qq-page {
    padding: 20px 28px;
    overflow-y: auto;
    height: 100%;
}
.qq-section {
    margin-bottom: 36px;
}
.qq-section-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-main);
    border-left: 3px solid var(--primary-color);
    padding-left: 10px;
}
.qq-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 18px;
}
.qq-card {
    cursor: pointer;
    transition: transform 0.18s ease;
}
.qq-card:hover {
    transform: translateY(-3px);
}
.qq-card-img-wrap {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: var(--hover-bg);
    position: relative;
}
.qq-card-img-wrap.img-fallback::before {
    content: '♪';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 36px;
    color: var(--text-light);
    opacity: 0.4;
}
.qq-card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.qq-card-name {
    font-size: 13px;
    margin-top: 8px;
    color: var(--text-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-card-meta {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-empty {
    text-align: center;
    color: var(--text-light);
    padding: 80px 0;
    font-size: 14px;
}
.qq-ticket-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.qq-ticket-item {
    padding: 12px 16px;
    background: var(--bg-sidebar);
    border-radius: 8px;
    border-left: 3px solid var(--primary-color);
}
.qq-ticket-name {
    font-size: 14px;
    color: var(--text-main);
    margin-bottom: 4px;
}
.qq-ticket-meta {
    font-size: 12px;
    color: var(--text-light);
}
</style>
