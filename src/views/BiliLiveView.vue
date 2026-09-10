<script setup>
// B站直播间播放页：搜索结果/主播主页点击直播卡片进入
// 取流：主进程 bilibili:live-playurl（getRoomPlayInfo → FLV 直链），无需登录即可观看
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { biliLivePlayurl } from '../api'
import ArtVideoPlayer from '../components/ArtVideoPlayer.vue'
import BiliIcon from '../components/BiliIcon.vue'
import { ChevronLeft, Loader2, RefreshCw, Radio, Tv, ChevronRight } from 'lucide-vue-next'

defineOptions({ name: 'BiliLiveView' })

const route = useRoute()
const router = useRouter()

const roomId = computed(() => String(route.params.roomId || ''))
const loading = ref(false)
const error = ref('')
const live = ref(null)       // 直播间信息（来自取流接口）
const streamUrl = ref('')    // FLV 直播直链
const failedCover = ref(false)

// 直播状态：1 直播中 / 2 轮播
const liveTitle = computed(() => live.value?.liveStatus === 2 ? '轮播中' : '直播中')

function fmtCount(n) {
    const v = Number(n) || 0
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
    return String(v)
}

async function load() {
    if (!roomId.value) { error.value = '直播间 ID 无效'; return }
    loading.value = true
    error.value = ''
    live.value = null
    streamUrl.value = ''
    failedCover.value = false
    try {
        const res = await biliLivePlayurl(roomId.value)
        if (res?.success && res.streamUrl) {
            live.value = res
            streamUrl.value = res.streamUrl
        } else {
            error.value = res?.message || '直播间加载失败'
        }
    } catch (e) {
        error.value = '直播间加载失败：' + (e.message || '网络错误')
    } finally {
        loading.value = false
    }
}

// 直播间内互相跳转 / 从搜索结果再次进入不同房间时重新加载
watch(roomId, (nv, ov) => {
    if (nv && nv !== ov) load()
})

function retry() { load() }

function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/bilibili')
}

function goUserSpace(uid) {
    if (!uid) return
    router.push(`/bilibili/user/${uid}`)
}
</script>

<template>
    <div class="bili-live-view">
        <!-- 顶部栏 -->
        <div class="top-bar">
            <button class="icon-btn" @click="goBack" title="返回">
                <ChevronLeft :size="20" />
            </button>
            <div class="top-title"><Radio :size="15" style="vertical-align:-2px" /> 直播间</div>
            <button class="refresh-btn" @click="retry" :disabled="loading" title="重新加载直播间">
                <RefreshCw :size="15" :class="{ spin: loading }" />
            </button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading" class="state-full">
            <Loader2 :size="36" class="spin" />
            <p>连接直播间中...</p>
        </div>

        <!-- 加载失败（未开播/已结束/取流失败） -->
        <div v-else-if="error" class="state-full">
            <Radio :size="48" class="state-icon" />
            <p class="state-error">{{ error }}</p>
            <button class="btn-primary" @click="retry">
                <RefreshCw :size="14" /> 重新加载
            </button>
        </div>

        <!-- 直播间内容 -->
        <template v-else-if="live">
            <!-- 播放器 -->
            <div class="player-wrapper">
                <ArtVideoPlayer
                    v-if="streamUrl"
                    :src="streamUrl"
                    play-type="flv"
                    autoplay
                />
            </div>

            <!-- 房间信息 -->
            <div class="room-info-card">
                <div class="room-main">
                    <img
                        v-if="live.cover && !failedCover"
                        :src="live.cover"
                        class="room-cover"
                        alt=""
                        referrerpolicy="no-referrer"
                        @error="failedCover = true"
                    />
                    <div v-else class="room-cover placeholder"><Radio :size="24" /></div>
                    <div class="room-text">
                        <h1 class="room-title">{{ live.title }}</h1>
                        <div class="room-meta">
                            <span class="live-dot" :class="{ replay: live.liveStatus === 2 }">{{ liveTitle }}</span>
                            <span class="room-online"><BiliIcon name="playcount" :size="13" /> {{ fmtCount(live.online) }}人观看</span>
                            <span v-if="live.areaName" class="room-area">{{ live.areaName }}</span>
                            <span class="room-uid">房间号 {{ live.roomId }}</span>
                        </div>
                    </div>
                </div>
                <div class="room-anchor">
                    <button class="anchor-link" :class="{ link: live.uid }" @click="goUserSpace(live.uid)" :title="live.uid ? '查看主播主页' : ''">
                        <Tv :size="13" /> 主播：{{ live.uname || '未知' }}
                        <ChevronRight :size="12" v-if="live.uid" />
                    </button>
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.bili-live-view {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    overflow-y: auto;
}

/* 顶部栏（与详情页一致） */
.top-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid #f1f2f3;
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(8px);
}

.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(251, 114, 153, 0.08);
    border-radius: 50%;
    color: #fb7299;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
}

.icon-btn:hover { background: rgba(251, 114, 153, 0.18); }

.top-title {
    font-size: 15px;
    font-weight: 600;
    color: #333;
    flex: 1;
}

.refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(251, 114, 153, 0.08);
    border-radius: 50%;
    color: #fb7299;
    cursor: pointer;
    transition: background 0.2s;
}

.refresh-btn:hover { background: rgba(251, 114, 153, 0.18); }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }

/* 加载中 / 错误 占满剩余空间 */
.state-full {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #999;
}

.state-full p { margin: 0; font-size: 13px; }

.state-error { color: #fb7299; max-width: 420px; text-align: center; line-height: 1.6; }

.state-icon { color: #ffd0da; }

.btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #fb7299;
    color: #fff;
    border: none;
    padding: 8px 20px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.2s;
}

.btn-primary:hover { background: #ff8bab; }

/* 播放器 */
.player-wrapper {
    flex-shrink: 0;
    background: #000;
}

.player-wrapper :deep(.art-video) { width: 100%; aspect-ratio: 16 / 9; }

/* 房间信息卡 */
.room-info-card {
    margin: 14px 20px 24px;
    background: #fff;
    border-radius: 12px;
    padding: 14px 16px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.room-main {
    display: flex;
    align-items: center;
    gap: 12px;
}

.room-cover {
    width: 64px;
    height: 64px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
}

.room-cover.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f7;
    color: #ddd;
}

.room-text { flex: 1; min-width: 0; }

.room-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.room-meta {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: #999;
    flex-wrap: wrap;
}

.live-dot {
    display: inline-flex;
    align-items: center;
    background: #fa4e4e;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 8px;
    line-height: 1.7;
}

.live-dot.replay { background: #a0a3ad; }

.room-online, .room-area, .room-uid {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

/* 主播行 */
.room-anchor {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #f5f5f7;
}

.anchor-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: none;
    color: #999;
    font-size: 13px;
    cursor: default;
    padding: 2px 0;
}

.anchor-link.link {
    color: #fb7299;
    cursor: pointer;
}

.anchor-link.link:hover { text-decoration: underline; }

/* 加载旋转 */
.spin { animation: rot 1s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
</style>