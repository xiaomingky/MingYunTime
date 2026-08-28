<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { biliVideoUserSpace, biliVideoUserSeasons, biliVideoSeasonArchives } from '../api'
import { useMessageStore } from '../store/message'
import BiliIcon from '../components/BiliIcon.vue'
import { ChevronLeft, Clapperboard, Loader2, Tv, Heart, Users, ChevronRight, BadgeCheck, ListVideo, X } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const messageStore = useMessageStore()

const mid = computed(() => route.params.mid || '')

const loading = ref(true)
const user = ref(null)
const list = ref([])
const page = ref(1)
const total = ref(0)
const failedCovers = ref(new Set())

function onCoverError(url) {
    if (!url) return
    failedCovers.value = new Set([...failedCovers.value, url])
}
function isCoverFailed(url) {
    return failedCovers.value.has(url)
}

function fmtCount(n) {
    const v = Number(n) || 0
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
    return String(v)
}

function fmtDuration(sec) {
    const s = Number(sec) || 0
    const pad = (x) => String(x).padStart(2, '0')
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}

// 投稿每页 30 条（后端 ps: 30）
const POST_PAGE_SIZE = 30
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / POST_PAGE_SIZE)))
// 页码条：页数多时只显示前几个 + 省略号 + 末尾页，保证一行不溢出（-1 为省略号标记）
const POST_PAGE_HEAD = 3
const pageItems = computed(() => {
    const t = totalPages.value
    if (t <= POST_PAGE_HEAD + 1) return Array.from({ length: t }, (_, i) => i + 1)
    return [...Array.from({ length: POST_PAGE_HEAD }, (_, i) => i + 1), -1, t]
})

async function loadUser(pn = 1) {
    if (!mid.value) return
    loading.value = true
    try {
        const res = await biliVideoUserSpace(mid.value, pn)
        if (res?.success) {
            user.value = res.data.user
            list.value = res.data.list || []
            total.value = res.data.total || list.value.length
            page.value = pn
        } else {
            messageStore.error(res?.message || '加载 UP 主主页失败')
        }
    } catch (e) {
        messageStore.error('加载 UP 主主页失败: ' + e.message)
    } finally {
        loading.value = false
    }
}

function goPage(pn) {
    if (pn < 1 || pn > totalPages.value || loading.value || pn === page.value) return
    loadUser(pn)
}

function openVideo(item) {
    if (!item?.bvid) return
    router.push(`/bilibili/${item.bvid}`)
}

// ===== 合集（UP 主合集和系列）=====
// 实测：seasons_series 接口 page_num 失效（翻页重复返回同一批数据）且 page_size 上限 20，
// 因此一次拉取全部后在前端做页码分页（每页 SEASON_PAGE_SIZE 个合集）
const SEASON_PAGE_SIZE = 12
const seasons = ref([])
const seasonLoading = ref(false)
const seasonListPage = ref(1)
const seasonTotalPages = computed(() => Math.max(1, Math.ceil(seasons.value.length / SEASON_PAGE_SIZE)))
const pagedSeasons = computed(() => seasons.value.slice((seasonListPage.value - 1) * SEASON_PAGE_SIZE, seasonListPage.value * SEASON_PAGE_SIZE))
// 页码条：页数多时只显示前几个 + 省略号 + 末尾页，保证一行不溢出（-1 为省略号标记）
const SEASON_PAGE_HEAD = 3
const seasonPageItems = computed(() => {
    const total = seasonTotalPages.value
    if (total <= SEASON_PAGE_HEAD + 1) return Array.from({ length: total }, (_, i) => i + 1)
    return [...Array.from({ length: SEASON_PAGE_HEAD }, (_, i) => i + 1), -1, total]
})
const activeSeason = ref(null)
const seasonVideos = ref([])
const seasonVideosLoading = ref(false)
const seasonPage = ref(1)
const seasonVTotal = ref(0)
// 合集内视频每页 30 条（后端 ps: 30）
const SEASON_VID_PAGE_SIZE = 30
const seasonVTotalPages = computed(() => Math.max(1, Math.ceil(seasonVTotal.value / SEASON_VID_PAGE_SIZE)))
const seasonVPageItems = computed(() => {
    const t = seasonVTotalPages.value
    if (t <= POST_PAGE_HEAD + 1) return Array.from({ length: t }, (_, i) => i + 1)
    return [...Array.from({ length: POST_PAGE_HEAD }, (_, i) => i + 1), -1, t]
})

async function loadSeasons() {
    if (!mid.value) return
    seasonLoading.value = true
    try {
        const res = await biliVideoUserSeasons(mid.value, 1, 20)
        if (res?.success) {
            seasons.value = res.data.list || []
            seasonListPage.value = 1
        }
        // 合集加载失败不打扰用户（主页主体仍可用）
    } catch (e) { /* 静默 */ }
    finally { seasonLoading.value = false }
}

function goSeasonPage(pn) {
    if (pn < 1 || pn > seasonTotalPages.value) return
    seasonListPage.value = pn
}

function toggleSeason(s) {
    if (!s?.seasonId) return
    // 再次点击已展开的合集 = 收起
    if (activeSeason.value?.seasonId === s.seasonId) { closeSeason(); return }
    activeSeason.value = s
    loadSeasonVideos(1)
}

function closeSeason() {
    activeSeason.value = null
    seasonVideos.value = []
    seasonVideosLoading.value = false
    seasonPage.value = 1
    seasonVTotal.value = 0
}

async function loadSeasonVideos(pn = 1) {
    if (!activeSeason.value?.seasonId) return
    seasonVideosLoading.value = true
    try {
        const res = await biliVideoSeasonArchives(mid.value, activeSeason.value.seasonId, pn)
        if (res?.success) {
            seasonVideos.value = res.data.list || []
            seasonVTotal.value = res.data.total || seasonVideos.value.length
            seasonPage.value = pn
        } else {
            messageStore.error(res?.message || '加载合集视频失败')
        }
    } catch (e) {
        messageStore.error('加载合集视频失败: ' + e.message)
    } finally {
        seasonVideosLoading.value = false
    }
}

function goSeasonVideoPage(pn) {
    if (pn < 1 || pn > seasonVTotalPages.value || seasonVideosLoading.value || pn === seasonPage.value) return
    loadSeasonVideos(pn)
}

function goBack() {
    if (window.history.length > 1) {
        router.back()
    } else {
        router.push('/bilibili')
    }
}

onMounted(() => { loadUser(1); loadSeasons() })
watch(mid, () => {
    if (mid.value) {
        loadUser(1)
        seasonListPage.value = 1
        loadSeasons()
        closeSeason()
    }
})
</script>

<template>
    <div class="user-space">
        <!-- 顶部栏 -->
        <div class="us-topbar">
            <button class="us-back" @click="goBack"><ChevronLeft :size="16" /> 返回</button>
            <div class="us-top-title">{{ user?.name || (loading ? '加载中...' : 'UP 主主页') }}</div>
            <div class="us-top-spacer"></div>
        </div>

        <div v-if="loading && !user" class="empty"><Loader2 :size="40" class="spin" /><p>正在加载 UP 主主页...</p></div>

        <!-- 用户信息卡（仿B站官方空间页） -->
        <div class="us-card" v-if="user">
            <div class="us-user-row">
                <img v-if="user.face" :src="user.face" class="us-avatar" alt="" referrerpolicy="no-referrer" />
                <div v-else class="us-avatar us-avatar-placeholder"><Users :size="36" /></div>
                <div class="us-user-info">
                    <div class="us-name-row">
                        <span class="us-name">{{ user.name }}</span>
                        <span v-if="user.vip" class="us-vip-badge" title="大会员">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z"/></svg>
                        </span>
                        <span v-if="user.official" class="us-official" title="官方认证">
                            <BadgeCheck :size="14" /> {{ user.official }}
                        </span>
                        <span class="us-level" :class="'lv' + Math.min(user.level || 0, 6)">LV{{ user.level || 0 }}</span>
                    </div>
                    <div class="us-stats">
                        <span class="us-stat"><Users :size="13" /> {{ fmtCount(user.fans) }} 粉丝</span>
                        <span class="us-stat"><Heart :size="13" /> {{ fmtCount(user.likes) }} 获赞</span>
                        <span class="us-stat"><Clapperboard :size="13" /> {{ fmtCount(user.videoCount || list.length) }} 投稿</span>
                    </div>
                    <p class="us-sign" v-if="user.sign">「{{ user.sign }}」</p>
                </div>
            </div>
        </div>

        <!-- 合集和列表 -->
        <div class="us-section" v-if="seasonLoading || seasons.length">
            <h3 class="us-section-title"><ListVideo :size="16" /> 合集和列表</h3>
            <div v-if="seasonLoading && !seasons.length" class="empty" style="padding: 16px 0">
                <Loader2 :size="22" class="spin" /><p style="font-size: 12px">正在加载合集...</p>
            </div>
            <div v-else class="us-season-row">
                <div v-for="s in pagedSeasons" :key="s.seasonId" class="us-season-card"
                     :class="{ active: activeSeason?.seasonId === s.seasonId }" @click="toggleSeason(s)">
                    <div class="us-season-cover">
                        <img v-if="s.cover && !isCoverFailed(s.cover)" :src="s.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(s.cover)" />
                        <div v-else class="cover-placeholder"><ListVideo :size="28" /></div>
                        <span class="us-season-count">{{ fmtCount(s.total) }} 个视频</span>
                    </div>
                    <p class="us-season-title" :title="s.title">{{ s.title }}</p>
                    <p class="us-season-latest" v-if="s.latest" :title="s.latest">最新：{{ s.latest }}</p>
                </div>
            </div>
            <!-- 合集页码分页（每页 12 个），仅合集数超过一页时显示 -->
            <div class="pagination" v-if="seasonTotalPages > 1">
                <button class="page-btn" :disabled="seasonListPage <= 1" @click="goSeasonPage(seasonListPage - 1)">
                    <ChevronLeft :size="14" /> 上一页
                </button>
                <template v-for="n in seasonPageItems" :key="n">
                    <span v-if="n === -1" class="page-ellipsis">…</span>
                    <button v-else class="page-btn page-num" :class="{ active: n === seasonListPage }" @click="goSeasonPage(n)">{{ n }}</button>
                </template>
                <button class="page-btn" :disabled="seasonListPage >= seasonTotalPages" @click="goSeasonPage(seasonListPage + 1)">
                    下一页 <ChevronRight :size="14" />
                </button>
            </div>

            <!-- 展开的合集视频 -->
            <div v-if="activeSeason" class="us-season-detail">
                <div class="us-season-detail-head">
                    <h4 class="us-season-detail-title"><ListVideo :size="15" /> {{ activeSeason.title }}</h4>
                    <button class="us-season-close" @click="closeSeason" title="收起合集"><X :size="14" /></button>
                </div>
                <div v-if="seasonVideosLoading" class="empty" style="padding: 24px 0">
                    <Loader2 :size="28" class="spin" /><p style="font-size: 12px">正在加载合集视频...</p>
                </div>
                <div v-else-if="seasonVideos.length" class="us-grid">
                    <div v-for="item in seasonVideos" :key="item.bvid" class="bili-card" @click="openVideo(item)">
                        <div class="bili-cover">
                            <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                            <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                            <span class="bili-duration">{{ fmtDuration(item.duration) }}</span>
                            <span class="bili-play-stat"><BiliIcon name="play" :size="11" /> {{ fmtCount(item.play) }} <BiliIcon name="danmaku" :size="11" /> {{ fmtCount(item.danmaku) }}</span>
                        </div>
                        <div class="bili-info">
                            <p class="bili-title" :title="item.title">{{ item.title }}</p>
                            <p class="bili-owner"><Tv :size="12" /> {{ user.name }}</p>
                        </div>
                    </div>
                </div>
                <div v-else class="empty" style="padding: 24px 0"><p style="font-size: 12px">该合集暂无视频</p></div>
                <div class="pagination" v-if="seasonVTotalPages > 1">
                    <button class="page-btn" :disabled="seasonPage <= 1 || seasonVideosLoading" @click="goSeasonVideoPage(seasonPage - 1)">
                        <ChevronLeft :size="14" /> 上一页
                    </button>
                    <template v-for="n in seasonVPageItems" :key="n">
                        <span v-if="n === -1" class="page-ellipsis">…</span>
                        <button v-else class="page-btn page-num" :class="{ active: n === seasonPage }" @click="goSeasonVideoPage(n)">{{ n }}</button>
                    </template>
                    <button class="page-btn" :disabled="seasonPage >= seasonVTotalPages || seasonVideosLoading" @click="goSeasonVideoPage(seasonPage + 1)">
                        下一页 <ChevronRight :size="14" />
                    </button>
                </div>
            </div>
        </div>

        <!-- 投稿网格 -->
        <div class="us-section" v-if="list.length">
            <h3 class="us-section-title"><Clapperboard :size="16" /> 全部投稿</h3>
            <div class="us-grid">
                <div v-for="item in list" :key="item.bvid" class="bili-card" @click="openVideo(item)">
                    <div class="bili-cover">
                        <img v-if="item.cover && !isCoverFailed(item.cover)" :src="item.cover" alt="" referrerpolicy="no-referrer" @error="onCoverError(item.cover)" />
                        <div v-else class="cover-placeholder"><Clapperboard :size="32" /></div>
                        <span class="bili-duration">{{ fmtDuration(item.duration) }}</span>
                        <span class="bili-play-stat"><BiliIcon name="play" :size="11" /> {{ fmtCount(item.play) }} <BiliIcon name="danmaku" :size="11" /> {{ fmtCount(item.danmaku) }}</span>
                    </div>
                    <div class="bili-info">
                        <p class="bili-title" :title="item.title">{{ item.title }}</p>
                        <p class="bili-owner"><Tv :size="12" /> {{ user.name }}</p>
                    </div>
                </div>
            </div>
            <div class="pagination" v-if="totalPages > 1">
                <button class="page-btn" :disabled="page <= 1 || loading" @click="goPage(page - 1)">
                    <ChevronLeft :size="14" /> 上一页
                </button>
                <template v-for="n in pageItems" :key="n">
                    <span v-if="n === -1" class="page-ellipsis">…</span>
                    <button v-else class="page-btn page-num" :class="{ active: n === page }" @click="goPage(n)">{{ n }}</button>
                </template>
                <button class="page-btn" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">
                    下一页 <ChevronRight :size="14" />
                </button>
            </div>
        </div>

        <div v-else-if="!loading && user" class="empty">
            <Clapperboard :size="48" />
            <p>该 UP 主暂无投稿</p>
        </div>
    </div>
</template>

<style scoped>
.user-space {
    padding: 8px 4px 28px;
    max-width: 1100px;
    margin: 0 auto;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.us-topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
}

.us-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid #e5e6e7;
    background: #fff;
    border-radius: 16px;
    padding: 5px 14px;
    font-size: 12px;
    color: #fb7299;
    cursor: pointer;
    transition: all 0.2s;
}

.us-back:hover { background: rgba(251, 114, 153, 0.08); }

.us-top-title {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.us-top-spacer { width: 60px; }

/* 用户信息卡 */
.us-card {
    background: #fff;
    border-radius: 10px;
    padding: 18px 20px;
    margin-bottom: 14px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.us-user-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
}

.us-avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #fff;
    box-shadow: 0 0 0 1px #f0f0f0;
    flex-shrink: 0;
}

.us-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f7f7f7;
    color: #ccc;
}

.us-user-info { min-width: 0; flex: 1; }

.us-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.us-name {
    font-size: 18px;
    font-weight: 700;
    color: #222;
}

.us-vip-badge {
    color: #fb7299;
    display: inline-flex;
    align-items: center;
}

.us-official {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: #fff;
    background: #23ade5;
    padding: 1px 7px;
    border-radius: 3px;
}

.us-level {
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: #e0e0e0;
    padding: 1px 6px;
    border-radius: 3px;
    line-height: 1.6;
}

.us-level.lv1 { background: #78c4d4; }
.us-level.lv2 { background: #7ecf56; }
.us-level.lv3 { background: #61b251; }
.us-level.lv4 { background: #2782cd; }
.us-level.lv5 { background: #b472e8; }
.us-level.lv6 { background: #e27615; }

.us-stats {
    display: flex;
    gap: 16px;
    margin-top: 8px;
}

.us-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #61666d;
}

.us-sign {
    margin: 10px 0 0;
    font-size: 12px;
    color: #999;
    line-height: 1.6;
}

/* 投稿网格 */
.us-section {
    background: #fff;
    border-radius: 10px;
    padding: 14px 18px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.us-section-title {
    margin: 0 0 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #fb7299;
}

/* 合集卡片（横滑一行，仿B站空间合集入口） */
.us-season-row {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 6px;
    scrollbar-width: thin;
}

.us-season-card {
    flex-shrink: 0;
    width: 176px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
}

.us-season-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: 8px;
    overflow: hidden;
    background: #f0f1f2;
    border: 2px solid transparent;
    transition: border-color 0.2s, box-shadow 0.2s;
}

.us-season-card:hover .us-season-cover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); }
.us-season-card.active .us-season-cover { border-color: #fb7299; }
.us-season-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.us-season-count {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
}

.us-season-title {
    margin: 6px 0 0;
    font-size: 12px;
    font-weight: 500;
    color: #222;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.us-season-latest {
    margin: 2px 0 0;
    font-size: 11px;
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 展开的合集视频区 */
.us-season-detail {
    margin-top: 14px;
    border-top: 1px dashed #eee;
    padding-top: 12px;
}

.us-season-detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.us-season-detail-title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #fb7299;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.us-season-close {
    flex-shrink: 0;
    border: none;
    background: #f4f4f5;
    color: #888;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
}

.us-season-close:hover { background: rgba(251, 114, 153, 0.12); color: #fb7299; }

.us-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
}

.bili-card {
    background: none;
    border: none;
    border-radius: 8px;
    padding: 0;
    cursor: pointer;
    text-align: left;
    transition: transform 0.2s;
}

.bili-card:hover { transform: translateY(-2px); }

.bili-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: 8px;
    overflow: hidden;
    background: #f0f1f2;
}

.bili-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ddd;
}

.bili-duration {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
}

.bili-play-stat {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
    color: #fff;
    font-size: 10px;
}

.bili-info {
    padding: 2px 2px 0;
}

.bili-title {
    margin: 6px 0 0;
    font-size: 13px;
    font-weight: 500;
    color: #222;
    line-height: 1.4;
    height: 2.9em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.bili-owner {
    margin: 4px 0 0;
    font-size: 12px;
    color: #999;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
}

.page-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid #e5e6e7;
    background: #fff;
    border-radius: 16px;
    padding: 6px 16px;
    font-size: 12px;
    color: #fb7299;
    cursor: pointer;
    transition: all 0.2s;
}

.page-btn:hover { background: rgba(251, 114, 153, 0.08); }
.page-btn:disabled { opacity: 0.5; cursor: default; }

/* 页码数字按钮（合集分页） */
.page-num {
    min-width: 30px;
    padding: 6px 4px;
    justify-content: center;
    color: #666;
}
.page-num:hover:not(:disabled):not(.active) { border-color: #fb7299; color: #fb7299; background: rgba(251, 114, 153, 0.08); }
.page-num.active { background: #fb7299; border-color: #fb7299; color: #fff; }

/* 页码省略号 */
.page-ellipsis {
    color: #999;
    padding: 0 4px;
    user-select: none;
}

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: #999;
    padding: 60px 0;
    font-size: 13px;
}

.empty p { margin: 0; }

.spin { animation: spin 1s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>