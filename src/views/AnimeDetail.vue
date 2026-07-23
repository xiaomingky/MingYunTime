<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { animeDetail, animeParsePlayUrl, animeMetaSearch, animeMetaRelated, downloadVideo } from '../api'
import { useAnimeStore } from '../store/anime'
import { useMessageStore } from '../store/message'
import PlayDisclaimer from '../components/PlayDisclaimer.vue'
import BiliPlayer from '../components/BiliPlayer.vue'
import {
    ChevronLeft, Heart, Star, Loader2, Film, RefreshCw, Users, Clapperboard, Download
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const messageStore = useMessageStore()
const animeStore = useAnimeStore()

const source = computed(() => route.params.source)
const id = computed(() => route.params.id)

const loading = ref(true)
const detail = ref(null)
const meta = ref(null)
const related = ref([])

const currentRouteIdx = ref(0)
const currentEpisode = ref(null)

const routes = computed(() => detail.value?.routes || [])
const currentRoute = computed(() => routes.value[currentRouteIdx.value])
const episodes = computed(() => currentRoute.value?.episodes || [])

const watchedSet = ref(new Set())

// ===== 播放器状态 =====
const playUrl = ref('')          // 播放地址（m3u8 直链或 iframe src）
const playType = ref('iframe')   // iframe | m3u8
const playerError = ref('')
const showDisclaimer = ref(true) // 播放前免责声明（默认显示，点击开始播放后消失）
const pendingEpisode = ref(null) // 待播放的集数（用户点击开始后再解析）
const playScheme = ref(1)        // 播放方案：1=iframe快速解析（默认），2=m3u8直链BiliPlayer

const isFavorited = computed(() => {
    if (!detail.value) return false
    return animeStore.isFavorited(source.value, id.value)
})

// 标题/封面：优先 Bangumi，回退樱花源站
const displayTitle = computed(() => meta.value?.title || detail.value?.title || '')
const displayCover = computed(() => meta.value?.cover || detail.value?.cover || '')
const displaySummary = computed(() => meta.value?.summary || detail.value?.desc || '')

// ===== 加载详情 =====
async function loadDetail() {
    loading.value = true
    detail.value = null
    meta.value = null
    related.value = []
    playUrl.value = ''
    currentEpisode.value = null
    showDisclaimer.value = true   // 每次加载详情都重置免责声明
    pendingEpisode.value = null
    try {
        const res = await animeDetail(source.value, id.value)
        if (res?.success && res.data) {
            detail.value = res.data
            currentRouteIdx.value = 0
            const watched = animeStore.getWatchedEpisodes(source.value, id.value)
            watchedSet.value = new Set(watched)
            // 默认不自动播放，先显示免责声明，用户点击"开始播放"后再解析第一集
            if (episodes.value.length > 0) {
                pendingEpisode.value = episodes.value[0]
            }
            // 并发拉取 Bangumi 元信息
            fetchMetaAndRelated(res.data.title)
        } else {
            messageStore.error(res?.message || '加载详情失败')
        }
    } catch (e) {
        messageStore.error('加载详情失败: ' + e.message)
    } finally {
        loading.value = false
    }
}

async function fetchMetaAndRelated(title) {
    if (!title) return
    try {
        const res = await animeMetaSearch(title)
        if (res?.success && res.data) {
            // 优先使用 Bangumi 的标题/封面/简介等元信息
            // 樱花源站仅作为兜底（Bangumi 匹配失败时）
            meta.value = {
                title: res.data.title,                  // Bangumi 中文名（优先）
                titleOriginal: res.data.titleOriginal,  // 原始名/日文名
                cover: res.data.cover,                  // Bangumi 封面（优先）
                score: res.data.score,
                scoreCount: res.data.scoreCount,
                summary: res.data.summary,
                tags: res.data.tags,
                date: res.data.date,
                characters: res.data.characters,
                staff: res.data.staff,
                infobox: res.data.infobox,
                id: res.data.id
            }
            if (res.data.id) {
                const relRes = await animeMetaRelated(res.data.id)
                if (relRes?.success) {
                    related.value = relRes.data || []
                }
            }
        }
    } catch (e) { /* 忽略 */ }
}

function switchRoute(idx) {
    if (currentRouteIdx.value === idx) return
    currentRouteIdx.value = idx
    if (episodes.value.length > 0) {
        playEpisode(episodes.value[0])
    }
}

// ===== 播放器（iframe 嵌入式，由樱花3线路提供）=====
const playerLoading = ref(false)

function onIframeLoad() {
    playerLoading.value = false
}

// 用户点击免责声明的"开始播放"按钮
function startPlay() {
    showDisclaimer.value = false
    if (pendingEpisode.value) {
        const ep = pendingEpisode.value
        pendingEpisode.value = null
        playEpisode(ep)
    }
}

// 用户关闭免责声明（返回）
function closeDisclaimer() {
    goBack()
}

// ===== 播放指定集数 =====
async function playEpisode(ep) {
    if (!ep) return
    currentEpisode.value = ep
    playerError.value = ''
    playUrl.value = ''
    playerLoading.value = true  // 解析期间显示加载遮罩

    try {
        const res = await animeParsePlayUrl(ep.source || source.value, ep.url, playScheme.value)
        if (res?.success && res.url) {
            playUrl.value = res.url
            playType.value = res.type || 'iframe'
            // 添加到历史
            animeStore.addHistory({
                source: source.value,
                id: id.value,
                title: displayTitle.value,
                cover: displayCover.value
            }, ep)
            watchedSet.value.add(ep.title)
            animeStore.saveProgress(source.value, id.value, ep.title, 0, 0)
            // m3u8 由 BiliPlayer 自动加载并隐藏外层 loading
            if (playType.value === 'm3u8') {
                playerLoading.value = false
            }
            // iframe 模式等 @load 事件触发后隐藏 loading
        } else {
            playerError.value = res?.message || '解析播放地址失败'
            playerLoading.value = false
        }
    } catch (e) {
        playerError.value = '播放失败: ' + e.message
        playerLoading.value = false
    }
}

function onPlayerError(msg) {
    playerError.value = msg
}

function replayCurrent() {
    if (currentEpisode.value) {
        playEpisode(currentEpisode.value)
    }
}

// 切换播放方案：1=iframe快速解析，2=m3u8直链
function switchScheme(s) {
    if (playScheme.value === s) return
    playScheme.value = s
    // 切换方案后重播当前集
    if (currentEpisode.value && !showDisclaimer.value) {
        playEpisode(currentEpisode.value)
    }
}

// ===== 上一集 / 下一集（供 BiliPlayer 切换剧集）=====
const currentEpisodeIdx = computed(() => {
    if (!currentEpisode.value) return -1
    return episodes.value.findIndex(ep => ep.title === currentEpisode.value.title)
})
const hasPrevEpisode = computed(() => currentEpisodeIdx.value > 0)
const hasNextEpisode = computed(() => {
    const idx = currentEpisodeIdx.value
    return idx >= 0 && idx < episodes.value.length - 1
})
function playPrevEpisode() {
    const idx = currentEpisodeIdx.value
    if (idx > 0) playEpisode(episodes.value[idx - 1])
}
function playNextEpisode() {
    const idx = currentEpisodeIdx.value
    if (idx >= 0 && idx < episodes.value.length - 1) playEpisode(episodes.value[idx + 1])
}

function toggleFavorite() {
    if (!detail.value) return
    const added = animeStore.toggleFavorite({
        source: source.value,
        id: id.value,
        title: displayTitle.value,
        cover: displayCover.value
    })
    messageStore.success(added ? '已加入收藏' : '已取消收藏')
}

function openRelated(item) {
    // 跳转到动漫主页搜索，标记 from=related 避免覆盖用户主动搜索的 sessionStorage 状态
    router.push({ path: '/anime', query: { kw: item.name_cn || item.name, from: 'related' } })
}

function goBack() {
    // 优先返回上一级站内路由；若无历史或来自外部则回动漫主页
    const back = router.options.history.state?.back
    if (typeof back === 'string' && back && back !== '/' && !back.startsWith('http')) {
        router.back()
    } else {
        router.push('/anime')
    }
}

const formatScore = (s) => s ? s.toFixed(1) : '—'

watch([source, id], () => {
    loadDetail()
})

onMounted(() => {
    loadDetail()
})

onBeforeUnmount(() => {
    playUrl.value = ''
})

// ===== 下载当前剧集 =====
const downloadingEp = ref(false)
const handleDownloadEpisode = async () => {
    if (!currentEpisode.value) {
        messageStore.warning('请先选择要下载的集数')
        return
    }
    if (downloadingEp.value) {
        messageStore.info('正在下载中，请查看右下角下载列表')
        return
    }
    downloadingEp.value = true
    try {
        const epTitle = currentEpisode.value.title || '第1集'
        const name = `${displayTitle.value || '动漫'} - ${epTitle}`
        // 当前无直链（iframe 方案一）：自动用方案二重新解析拿 m3u8 直链
        let downUrl = playUrl.value
        let downType = playType.value === 'm3u8' ? 'm3u8' : ''
        if (playType.value !== 'm3u8' || !downUrl) {
            messageStore.info('正在解析直链用于下载...', 2000)
            const res = await animeParsePlayUrl(currentEpisode.value.source || source.value, currentEpisode.value.url, 2)
            if (!res?.success || !res?.url || res.type !== 'm3u8') {
                messageStore.error('无法获取直链，下载失败：' + (res?.message || '该源未提供 m3u8 直链'))
                return
            }
            downUrl = res.url
            downType = 'm3u8'
        }
        const result = await downloadVideo({
            url: downUrl,
            name,
            type: downType,
            category: 'anime'
        })
        if (result?.success) {
            messageStore.success(`已开始下载：${name}（进度见右下角）`, 3000)
        } else if (!result?.canceled) {
            messageStore.error('下载失败：' + (result?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e))
    } finally {
        downloadingEp.value = false
    }
}
</script>

<template>
    <div class="anime-detail">
        <!-- 顶部栏 -->
        <div class="top-bar">
            <button class="icon-btn" @click="goBack" title="返回">
                <ChevronLeft :size="20" />
            </button>
            <div class="top-title">
                {{ displayTitle || '加载中...' }}
                <span v-if="meta?.score" class="top-score">
                    <Star :size="12" /> {{ formatScore(meta.score) }}
                </span>
            </div>
            <button class="icon-btn fav-btn" :class="{ active: isFavorited }" @click="toggleFavorite" title="收藏">
                <Heart :size="20" :fill="isFavorited ? 'currentColor' : 'none'" />
            </button>
        </div>

        <div v-if="loading" class="loading-full">
            <Loader2 :size="36" class="spin" />
            <p>加载中...</p>
        </div>

        <div v-else-if="!detail" class="empty-full">
            <Film :size="48" />
            <p>未找到该动漫</p>
            <button class="btn-primary" @click="goBack">返回</button>
        </div>

        <div v-else class="detail-body">
            <!-- 左侧：播放器 + 选集 -->
            <div class="left-col">
                <!-- 播放器 -->
                <div class="player-wrapper">
                    <!-- 播放前免责声明（用户点击开始播放后消失） -->
                    <PlayDisclaimer
                        v-if="showDisclaimer"
                        :title="displayTitle"
                        :cover="displayCover"
                        type="动漫"
                        @start="startPlay"
                        @close="closeDisclaimer"
                    />

                    <!-- m3u8/mp4 直链用 BiliPlayer（B站风格自定义控制条 + 上一集/下一集） -->
                    <BiliPlayer
                        v-if="playUrl && playType === 'm3u8' && !playerError"
                        :src="playUrl"
                        play-type="m3u8"
                        :badge="currentEpisode ? `正在播放：${currentEpisode.title}` : ''"
                        :episodes="episodes"
                        :current-episode="currentEpisode"
                        :has-prev="hasPrevEpisode"
                        :has-next="hasNextEpisode"
                        @retry="replayCurrent"
                        @error="onPlayerError"
                        @prev="playPrevEpisode"
                        @next="playNextEpisode"
                        @selectEpisode="playEpisode"
                    />

                    <!-- iframe 嵌入式播放器（m3u8 提取失败时兜底，直接加载整页） -->
                    <iframe
                        v-else-if="playUrl && playType === 'iframe' && !playerError"
                        :src="playUrl"
                        class="video-iframe"
                        allowfullscreen
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        referrerpolicy="no-referrer"
                        @load="onIframeLoad"
                    ></iframe>

                    <!-- 加载遮罩（仅 iframe 模式） -->
                    <div v-if="playerLoading && playType !== 'm3u8'" class="player-mask">
                        <Loader2 :size="36" class="spin" />
                        <p>解析播放地址中...</p>
                    </div>

                    <!-- 错误遮罩（仅 iframe 模式；m3u8 由 BiliPlayer 自带错误遮罩） -->
                    <div v-if="playerError && playType !== 'm3u8'" class="player-mask error">
                        <Film :size="36" />
                        <p>{{ playerError }}</p>
                        <button class="btn-primary" @click="replayCurrent">
                            <RefreshCw :size="14" /> 重试
                        </button>
                    </div>
                </div>

                <!-- 播放方案切换条 -->
                <div class="scheme-bar">
                    <span class="scheme-label">播放方案</span>
                    <button
                        class="scheme-btn"
                        :class="{ active: playScheme === 1 }"
                        @click="switchScheme(1)"
                    >方案一</button>
                    <button
                        class="scheme-btn"
                        :class="{ active: playScheme === 2 }"
                        @click="switchScheme(2)"
                    >方案二</button>
                </div>

                <!-- 选集面板 -->
                <div class="episodes-panel">
                    <div v-if="routes.length > 1" class="route-tabs">
                        <button
                            v-for="(r, idx) in routes"
                            :key="idx"
                            class="route-tab"
                            :class="{ active: currentRouteIdx === idx }"
                            @click="switchRoute(idx)"
                        >{{ r.name }}</button>
                    </div>

                    <div class="episodes-header">
                        <span class="ep-title">选集 ({{ episodes.length }})</span>
                        <button
                            class="ep-download-btn"
                            :class="{ active: downloadingEp }"
                            :disabled="!currentEpisode || downloadingEp"
                            :title="!currentEpisode ? '请先选择集数' : '下载当前集（iframe 模式将自动解析直链）'"
                            @click="handleDownloadEpisode"
                        >
                            <Loader2 v-if="downloadingEp" :size="14" class="spin" />
                            <Download v-else :size="14" />
                            <span>下载当前集</span>
                        </button>
                    </div>

                    <div v-if="episodes.length === 0" class="ep-empty">暂无集数</div>
                    <div v-else class="episodes-grid">
                        <button
                            v-for="ep in episodes"
                            :key="ep.title"
                            class="ep-btn"
                            :class="{
                                active: currentEpisode?.title === ep.title,
                                watched: watchedSet.has(ep.title)
                            }"
                            @click="playEpisode(ep)"
                        >
                            {{ ep.title }}
                            <span v-if="watchedSet.has(ep.title)" class="watched-dot"></span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- 右侧：番剧信息 -->
            <div class="right-col">
                <div class="info-card">
                    <div class="info-cover">
                        <img
                            v-if="displayCover"
                            :src="displayCover"
                            referrerpolicy="no-referrer"
                            @error="$event.target.style.display='none'"
                        />
                        <div v-else class="info-cover-placeholder"><Film :size="40" /></div>
                    </div>

                    <h3 class="info-title">{{ displayTitle }}</h3>
                    <div v-if="meta?.titleOriginal && meta.titleOriginal !== displayTitle" class="info-subtitle">{{ meta.titleOriginal }}</div>

                    <div v-if="meta?.score" class="info-score">
                        <Star :size="16" />
                        <span class="score-num">{{ formatScore(meta.score) }}</span>
                        <span class="score-count" v-if="meta.scoreCount">{{ meta.scoreCount }} 人评分</span>
                    </div>

                    <div v-if="meta?.date" class="info-row">
                        <span class="info-label">放送日期：</span>
                        <span>{{ meta.date }}</span>
                    </div>

                    <div v-if="meta?.infobox && meta.infobox.length" class="info-infobox">
                        <div v-for="(row, idx) in meta.infobox" :key="idx" class="infobox-row">
                            <span class="infobox-key">{{ row.key || row.k || '' }}</span>
                            <span class="infobox-val">
                                <template v-if="Array.isArray(row.value || row.v)">
                                    <span
                                        v-for="(item, i) in (row.value || row.v)"
                                        :key="i"
                                        class="infobox-val-item"
                                    >{{ typeof item === 'string' ? item : (item.name || item.text || JSON.stringify(item)) }}<span v-if="i < (row.value || row.v).length - 1" class="infobox-sep">、</span></span>
                                </template>
                                <template v-else>{{ row.value || row.v || '' }}</template>
                            </span>
                        </div>
                    </div>

                    <div v-if="meta?.tags && meta.tags.length" class="info-tags">
                        <span v-for="t in meta.tags" :key="t.name" class="info-tag">{{ t.name }}</span>
                    </div>

                    <div v-if="displaySummary" class="info-summary">
                        {{ displaySummary }}
                    </div>

                    <div v-if="meta?.characters && meta.characters.length" class="info-section">
                        <div class="info-section-title">
                            <Users :size="14" /> 主要角色
                        </div>
                        <div class="cast-list">
                            <div v-for="c in meta.characters" :key="c.id" class="cast-item">
                                <img v-if="c.cover" :src="c.cover" class="cast-avatar" referrerpolicy="no-referrer" @error="$event.target.style.display='none'" />
                                <div v-else class="cast-avatar-placeholder"><Users :size="14" /></div>
                                <div>
                                    <div class="cast-name">{{ c.name }}</div>
                                    <div class="cast-rel">{{ c.relation }}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-if="meta?.staff && meta.staff.length" class="info-section">
                        <div class="info-section-title">
                            <Clapperboard :size="14" /> 制作人员
                        </div>
                        <div class="staff-list">
                            <div v-for="p in meta.staff" :key="p.id" class="staff-item">
                                <span class="staff-name">{{ p.name }}</span>
                                <span class="staff-rel">{{ p.relation }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-if="related.length > 0" class="related-card">
                    <div class="related-title">
                        <Film :size="14" /> 相关推荐
                    </div>
                    <div class="related-grid">
                        <div
                            v-for="r in related"
                            :key="r.id"
                            class="related-item"
                            @click="openRelated(r)"
                        >
                            <img v-if="r.cover" :src="r.cover" class="related-cover" referrerpolicy="no-referrer" @error="$event.target.style.display='none'" />
                            <div v-else class="related-cover-placeholder"><Film :size="20" /></div>
                            <div class="related-info">
                                <div class="related-name">{{ r.name_cn || r.name }}</div>
                                <div class="related-rel">{{ r.relation }}</div>
                                <div v-if="r.score" class="related-score">
                                    <Star :size="10" /> {{ formatScore(r.score) }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.anime-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #fafafa;
    color: #333;
}

.top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: #fff;
    border-bottom: 1px solid #eee;
    flex-shrink: 0;
}

.icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    color: #555;
    border-radius: 50%;
    cursor: pointer;
    transition: all .2s;
}

.icon-btn:hover { background: #f5f5f5; color: #c20c0c; }
.fav-btn.active { color: #c20c0c; }
.fav-btn.active:hover { background: rgba(194, 12, 12, .08); }

.top-title {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
    color: #333;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.top-score {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 13px;
    color: #c20c0c;
    background: rgba(194, 12, 12, .08);
    padding: 2px 8px;
    border-radius: 4px;
}

.loading-full, .empty-full {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #999;
}
.empty-full .btn-primary { margin-top: 8px; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.detail-body {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 16px;
    padding: 16px;
    overflow: hidden;
    min-height: 0;
}

.left-col, .right-col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    overflow-y: auto;
}

/* ===== 播放器 ===== */
.player-wrapper {
    position: relative;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    aspect-ratio: 16/9;
    flex-shrink: 0;
}

.video-iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
}

.video-el {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
    outline: none;
}

/* 美化 video 原生控件（Chrome/Electron） */
.video-el::-webkit-media-controls-panel {
    background: linear-gradient(to top, rgba(0, 0, 0, .85), rgba(0, 0, 0, 0));
}

.video-el::-webkit-media-controls-play-button,
.video-el::-webkit-media-controls-mute-button {
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, .5));
}

.video-el::-webkit-media-controls-current-time-display,
.video-el::-webkit-media-controls-time-remaining-display {
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, .8);
    font-size: 12px;
}

/* 进度条滑块红色主题 */
.video-el::-webkit-media-controls-timeline {
    color: #c20c0c;
    background-color: rgba(255, 255, 255, .2);
    border-radius: 2px;
    height: 4px;
}

.video-el::-webkit-media-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #c20c0c;
    box-shadow: 0 0 4px rgba(194, 12, 12, .6);
    cursor: pointer;
}

.video-el::-webkit-media-slider-container {
    background: rgba(255, 255, 255, .15);
}

/* 音量滑块 */
.video-el::-webkit-media-controls-volume-slider {
    color: #c20c0c;
    background-color: rgba(255, 255, 255, .2);
    border-radius: 2px;
}

/* 全屏按钮 */
.video-el::-webkit-media-controls-fullscreen-button {
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, .5));
}

.player-mask {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(0, 0, 0, .7);
    color: #fff;
    z-index: 5;
}

.player-mask.error { background: rgba(0, 0, 0, .85); }
.player-mask p { margin: 0; font-size: 14px; }

.current-ep-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(194, 12, 12, .92);
    color: #fff;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    z-index: 4;
    pointer-events: none;
}

/* 分辨率切换器 */
.level-switcher {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(0, 0, 0, .6);
    color: #fff;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    z-index: 6;
    user-select: none;
    transition: background .2s;
}

.level-switcher:hover { background: rgba(194, 12, 12, .9); }

.level-label { font-weight: 600; }

.level-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: rgba(0, 0, 0, .92);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 80px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .4);
}

.level-menu-item {
    padding: 6px 14px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    transition: background .15s;
}

.level-menu-item:hover { background: rgba(255, 255, 255, .12); }
.level-menu-item.active { color: #ff6b6b; background: rgba(194, 12, 12, .18); }

/* ===== 选集 ===== */
.episodes-panel {
    background: #fff;
    border-radius: 8px;
    padding: 14px 16px;
    border: 1px solid #f0f0f0;
}

.route-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.route-tab {
    padding: 5px 12px;
    border: 1px solid #ddd;
    background: #fff;
    color: #666;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all .2s;
}

.route-tab:hover { border-color: #c20c0c; color: #c20c0c; }
.route-tab.active { background: #c20c0c; color: #fff; border-color: #c20c0c; }

/* 播放方案切换条 */
.scheme-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    margin-bottom: 4px;
    flex-wrap: wrap;
}
.scheme-label {
    font-size: 12px;
    color: #888;
    margin-right: 8px;
}
.scheme-btn {
    padding: 5px 12px;
    border: 1px solid #ddd;
    background: #fff;
    color: #666;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all .2s;
}
.scheme-btn:hover { border-color: #c20c0c; color: #c20c0c; }
.scheme-btn.active { background: #c20c0c; color: #fff; border-color: #c20c0c; }

.episodes-header {
    margin-bottom: 10px;
    font-size: 13px;
    color: #888;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.ep-download-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    font-size: 12px;
    border: 1px solid #e0e0e0;
    background: #fff;
    color: #555;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
}

.ep-download-btn:hover:not(:disabled) {
    border-color: var(--primary-color, #c20c0c);
    color: var(--primary-color, #c20c0c);
    background: rgba(194, 12, 12, 0.05);
}

.ep-download-btn.active {
    color: #f59e0b;
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
}

.ep-download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ep-empty {
    color: #999;
    text-align: center;
    padding: 20px;
    font-size: 13px;
}

.episodes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 8px;
}

.ep-btn {
    position: relative;
    padding: 8px 6px;
    border: 1px solid #eee;
    background: #fafafa;
    color: #555;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all .2s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ep-btn:hover { border-color: #c20c0c; color: #c20c0c; }
.ep-btn.active { background: #c20c0c; color: #fff; border-color: #c20c0c; }
.ep-btn.watched:not(.active) { background: rgba(194, 12, 12, .06); color: #c20c0c; }

.watched-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 5px;
    height: 5px;
    background: #c20c0c;
    border-radius: 50%;
}

.ep-btn.active .watched-dot { background: #fff; }

/* ===== 右侧信息 ===== */
.info-card {
    background: #fff;
    border-radius: 8px;
    padding: 16px;
    border: 1px solid #f0f0f0;
}

.info-cover {
    width: 100%;
    aspect-ratio: 3/4;
    border-radius: 6px;
    overflow: hidden;
    background: #f5f5f5;
    margin-bottom: 12px;
}

.info-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.info-cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #ccc;
}

.info-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
    margin: 0 0 4px;
}

.info-subtitle {
    font-size: 12px;
    color: #999;
    margin-bottom: 8px;
}

.info-score {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #c20c0c;
    margin-bottom: 10px;
}

.score-num { font-size: 18px; font-weight: 700; }
.score-count { font-size: 11px; color: #999; margin-left: 4px; }

.info-row {
    font-size: 12px;
    color: #666;
    margin-bottom: 6px;
}

.info-label { color: #999; }

.info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 10px 0;
}

.info-tag {
    font-size: 11px;
    color: #c20c0c;
    background: rgba(194, 12, 12, .08);
    padding: 2px 8px;
    border-radius: 3px;
}

.info-summary {
    font-size: 12px;
    color: #555;
    line-height: 1.7;
    margin: 10px 0;
    max-height: 200px;
    overflow-y: auto;
}

.info-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid #f0f0f0;
}

.info-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #c20c0c;
    margin-bottom: 8px;
}

.cast-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.cast-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
}

.cast-avatar, .cast-avatar-placeholder {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
}

.cast-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    color: #ccc;
}

.cast-name { font-weight: 600; color: #333; }
.cast-rel { color: #999; font-size: 10px; }

.staff-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.staff-item {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
}

.staff-name { color: #333; }
.staff-rel { color: #999; }

.related-card {
    background: #fff;
    border-radius: 8px;
    padding: 14px 16px;
    border: 1px solid #f0f0f0;
}

.related-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #c20c0c;
    margin-bottom: 10px;
}

.related-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.related-item {
    display: flex;
    gap: 8px;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: background .2s;
}

.related-item:hover { background: #f9f9f9; }

.related-cover, .related-cover-placeholder {
    width: 40px;
    height: 54px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
}

.related-cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    color: #ccc;
}

.related-info {
    flex: 1;
    min-width: 0;
    font-size: 12px;
}

.related-name {
    color: #333;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.related-rel {
    color: #999;
    font-size: 11px;
    margin: 2px 0;
}

.related-score {
    display: flex;
    align-items: center;
    gap: 2px;
    color: #c20c0c;
    font-size: 11px;
}

.btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: #c20c0c;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    transition: background .2s;
}

.btn-primary:hover { background: #a30a0a; }

.left-col::-webkit-scrollbar,
.right-col::-webkit-scrollbar,
.info-summary::-webkit-scrollbar { width: 6px; }

.left-col::-webkit-scrollbar-thumb,
.right-col::-webkit-scrollbar-thumb,
.info-summary::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }

.left-col::-webkit-scrollbar-thumb:hover,
.right-col::-webkit-scrollbar-thumb:hover { background: #c20c0c; }

@media (max-width: 900px) {
    .detail-body { grid-template-columns: 1fr; }
    .right-col { order: -1; }
    .info-card { padding: 12px; }
}
</style>
