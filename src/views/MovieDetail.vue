<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { movieDetail, movieParsePlayUrl } from '../api'
import { useMessageStore } from '../store/message'
import BiliPlayer from '../components/BiliPlayer.vue'
import PlayDisclaimer from '../components/PlayDisclaimer.vue'
import {
    ChevronLeft, Loader2, Film, RefreshCw
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const messageStore = useMessageStore()

const source = computed(() => route.params.source)
const id = computed(() => route.params.id)

const loading = ref(true)
const detail = ref(null)

const currentRouteIdx = ref(0)
const currentEpisode = ref(null)

const routes = computed(() => detail.value?.routes || [])
const currentRoute = computed(() => routes.value[currentRouteIdx.value])
const episodes = computed(() => currentRoute.value?.episodes || [])

// ===== 播放器状态 =====
const playUrl = ref('')
const playType = ref('iframe')
const playerLoading = ref(false)
const playerError = ref('')
const showDisclaimer = ref(true) // 播放前免责声明
const pendingEpisode = ref(null) // 待播放的集数

// ===== 加载详情 =====
async function loadDetail() {
    loading.value = true
    detail.value = null
    playUrl.value = ''
    currentEpisode.value = null
    showDisclaimer.value = true
    pendingEpisode.value = null
    try {
        const res = await movieDetail(source.value, id.value)
        if (res?.success && res.data) {
            detail.value = res.data
            currentRouteIdx.value = 0
            // 默认不自动播放，先显示免责声明，用户点击"开始播放"后再解析第一集
            if (episodes.value.length > 0) {
                pendingEpisode.value = episodes.value[0]
            }
        } else {
            messageStore.error(res?.message || '加载详情失败')
        }
    } catch (e) {
        messageStore.error('加载详情失败: ' + e.message)
    } finally {
        loading.value = false
    }
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

function switchRoute(idx) {
    if (currentRouteIdx.value === idx) return
    currentRouteIdx.value = idx
    if (episodes.value.length > 0) {
        playEpisode(episodes.value[0])
    }
}

// ===== 播放器（由 BiliPlayer 组件内部管理 hls.js）=====
async function playEpisode(ep) {
    if (!ep) return
    currentEpisode.value = ep
    playerError.value = ''
    playUrl.value = ''
    playerLoading.value = true

    try {
        const res = await movieParsePlayUrl(ep.source || source.value, ep.url)
        if (res?.success && res.url) {
            playUrl.value = res.url
            playType.value = res.type || 'iframe'
            // m3u8 由 BiliPlayer 自动加载并隐藏外层 loading
            if (playType.value === 'm3u8') {
                playerLoading.value = false
            }
        } else {
            playerError.value = res?.message || '解析播放地址失败'
            playerLoading.value = false
        }
    } catch (e) {
        playerError.value = '播放失败: ' + e.message
        playerLoading.value = false
    }
}

function onIframeLoad() {
    playerLoading.value = false
}

function onPlayerError(msg) {
    playerError.value = msg
}

function replayCurrent() {
    if (currentEpisode.value) playEpisode(currentEpisode.value)
}

function goBack() { router.back() }

watch([source, id], () => { loadDetail() })
onMounted(() => { loadDetail() })
onBeforeUnmount(() => {
    playUrl.value = ''
})
</script>

<template>
    <div class="anime-detail">
        <!-- 顶部栏 -->
        <div class="top-bar">
            <button class="icon-btn" @click="goBack" title="返回">
                <ChevronLeft :size="20" />
            </button>
            <div class="top-title">
                {{ detail?.title || '加载中...' }}
            </div>
        </div>

        <div v-if="loading" class="loading-full">
            <Loader2 :size="36" class="spin" />
            <p>加载中...</p>
        </div>

        <div v-else-if="!detail" class="empty-full">
            <Film :size="48" />
            <p>未找到该电影</p>
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
                        :title="detail?.title || ''"
                        :cover="detail?.cover || ''"
                        type="影视"
                        @start="startPlay"
                        @close="closeDisclaimer"
                    />

                    <!-- m3u8 用 BiliPlayer（B站风格自定义控制条） -->
                    <BiliPlayer
                        v-if="playUrl && playType === 'm3u8'"
                        :src="playUrl"
                        play-type="m3u8"
                        :badge="currentEpisode ? `正在播放：${currentEpisode.title}` : ''"
                        @retry="replayCurrent"
                        @error="onPlayerError"
                    />

                    <iframe
                        v-else-if="playUrl && playType !== 'm3u8' && !playerError"
                        :src="playUrl"
                        class="video-iframe"
                        allowfullscreen
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        referrerpolicy="no-referrer"
                        @load="onIframeLoad"
                    ></iframe>

                    <!-- iframe 模式加载遮罩 -->
                    <div v-if="playerLoading && playType !== 'm3u8'" class="player-mask">
                        <Loader2 :size="36" class="spin" />
                        <p>解析播放地址中...</p>
                    </div>

                    <!-- iframe 模式错误遮罩 -->
                    <div v-if="playerError && playType !== 'm3u8'" class="player-mask error">
                        <Film :size="36" />
                        <p>{{ playerError }}</p>
                        <button class="btn-primary" @click="replayCurrent">
                            <RefreshCw :size="14" /> 重试
                        </button>
                    </div>
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
                    </div>

                    <div v-if="episodes.length === 0" class="ep-empty">暂无集数</div>
                    <div v-else class="episodes-grid">
                        <button
                            v-for="ep in episodes"
                            :key="ep.title"
                            class="ep-btn"
                            :class="{ active: currentEpisode?.title === ep.title }"
                            @click="playEpisode(ep)"
                        >{{ ep.title }}</button>
                    </div>
                </div>
            </div>

            <!-- 右侧：信息卡 -->
            <div class="right-col">
                <div class="info-card">
                    <img
                        v-if="detail.cover"
                        :src="detail.cover"
                        class="info-cover"
                        referrerpolicy="no-referrer"
                        @error="$event.target.style.display='none'"
                    />
                    <h3 class="info-title">{{ detail.title }}</h3>
                    <div v-if="detail.desc" class="info-desc">{{ detail.desc }}</div>
                </div>
            </div>
        </div>
    </div>
</template>

<style>
@import './anime-detail.css';
</style>
