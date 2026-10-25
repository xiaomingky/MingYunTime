<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink, Loader2, RefreshCw, Play, UserRound, MessageCircle } from 'lucide-vue-next'
import ArtVideoPlayer from '../components/ArtVideoPlayer.vue'
import BiliIcon from '../components/BiliIcon.vue'
import { useBiliFeed } from '../composables/useBiliFeed'
import { biliVideoInteract, biliVideoLike, biliVideoCoin, biliVideoFav } from '../api'
import { useMessageStore } from '../store/message'

const router = useRouter(), messages = useMessageStore()
const { items, index, hasMore, listLoading, listError, loading, error, current, video, stream, danmaku, loadMore, playCurrent, move, start } = useBiliFeed()
const root = ref(null)
const liked = ref(false), favored = ref(false), coins = ref(0), busy = ref(false), showCoins = ref(false)
const currentQn = ref(0)
const info = computed(() => ({
    title: video.value?.title || current.value?.title,
    author: video.value?.owner?.name || current.value?.author || 'UP 主',
    face: video.value?.owner?.face || current.value?.authorFace,
    mid: video.value?.owner?.mid || current.value?.mid,
    cover: video.value?.cover || current.value?.cover,
    play: video.value?.stat?.view ?? current.value?.play,
    desc: video.value?.desc || ''
}))
const canNext = computed(() => index.value < items.value.length - 1 || hasMore.value)
const fmt = value => Number(value) >= 10000 ? `${(Number(value) / 10000).toFixed(1)}万` : String(value || 0)

let interactionRevision = 0
watch(video, async value => {
    const revision = ++interactionRevision
    liked.value = !!value?.reqUser?.like
    favored.value = !!value?.reqUser?.favorite
    coins.value = value?.reqUser?.coin || 0
    showCoins.value = false
    busy.value = false
    if (!value) return
    try {
        const result = await biliVideoInteract(value.aid, value.bvid)
        if (video.value !== value || revision !== interactionRevision || !result?.success || !result.data) return
        liked.value = !!result.data.liked
        favored.value = !!result.data.favored
        coins.value = result.data.coins || 0
    } catch { /* Interaction state must not block playback. */ }
}, { flush: 'sync' })
watch(stream, value => { currentQn.value = value?.qualities?.[0]?.qn || value?.quality || 0 })

async function interact(action, amount = 1) {
    const target = video.value
    if (!target || busy.value) return
    const revision = ++interactionRevision
    busy.value = true
    showCoins.value = false
    const nextLiked = !liked.value, nextFavored = !favored.value
    try {
        const result = action === 'like' ? await biliVideoLike(target.bvid, nextLiked ? 1 : 2)
            : action === 'fav' ? await biliVideoFav(target.aid, !nextFavored)
                : await biliVideoCoin(target.bvid, amount, 0, target.aid)
        if (!result?.success) throw new Error(result?.message || '操作失败，请先在 B站区登录')
        if (video.value === target && revision === interactionRevision) {
            if (action === 'like') liked.value = nextLiked
            else if (action === 'fav') favored.value = nextFavored
            else coins.value += amount
        }
        messages.success(action === 'coin' ? `已投出 ${amount} 枚硬币` : action === 'like' ? (nextLiked ? '已点赞' : '已取消点赞') : (nextFavored ? '已收藏' : '已取消收藏'))
    } catch (e) { messages.error(e.message) }
    finally { if (revision === interactionRevision) busy.value = false }
}

function openDetail() { if (current.value) router.push(`/bilibili/${current.value.bvid}`) }
function goAuthor() { if (info.value.mid) router.push(`/bilibili/user/${info.value.mid}`) }

let lastWheel = 0, wheelTotal = 0, wheelTime = 0
const gestureControls = 'button, input, textarea, select, [contenteditable], .art-controls, .art-settings, .art-progress, .avp-ep-panel, .ved-panel, .info-content'
function onWheel(event) {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    if (event.target.closest(gestureControls)) return
    event.preventDefault()
    event.stopPropagation()
    const now = Date.now()
    if (now - lastWheel < 700) return
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
    if (now - wheelTime > 180 || Math.sign(delta) !== Math.sign(wheelTotal)) wheelTotal = 0
    wheelTime = now
    wheelTotal += delta
    if (Math.abs(wheelTotal) < 55) return
    lastWheel = now
    void move(wheelTotal > 0 ? 1 : -1)
    wheelTotal = 0
}
let touchStart = null
function onTouchStart(event) {
    touchStart = null
    if (event.touches.length !== 1 || event.target.closest(gestureControls)) return
    touchStart = { id: event.touches[0].identifier, x: event.touches[0].clientX, y: event.touches[0].clientY }
}
function onTouchEnd(event) {
    if (!touchStart) return
    const start = touchStart
    touchStart = null
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start.id)
    if (!end) return
    const dy = start.y - end.clientY, dx = start.x - end.clientX
    if (Math.abs(dy) > 65 && Math.abs(dy) > Math.abs(dx) * 1.3) void move(dy > 0 ? 1 : -1)
}
function onKey(event) {
    if (event.target.closest('input, textarea, select, [contenteditable], [role="slider"], .art-settings, .avp-ep-panel, .ved-panel') || event.altKey || event.ctrlKey || event.metaKey) return
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) void move(['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1)
}
onMounted(() => { root.value?.focus({ preventScroll: true }); void start() })
</script>

<template>
    <section ref="root" class="bili-feed" tabindex="0" aria-label="B站推荐视频流" @wheel.capture="onWheel" @keydown.capture="onKey"
        @touchstart.capture.passive="onTouchStart" @touchend.capture.passive="onTouchEnd" @touchcancel="touchStart = null">
        <header class="feed-header">
            <button class="quiet-button" @click="router.push('/bilibili')"><ArrowLeft :size="17" /> 返回 B站区</button>
            <div class="feed-brand"><BiliIcon name="logo" :size="23" /><h1>推荐放映</h1><span>发现下一份喜欢</span></div>
            <button class="quiet-button" @click="router.push('/bilibili')"><UserRound :size="16" /> 账号管理</button>
        </header>

        <div v-if="!current" class="feed-empty" role="status">
            <Loader2 v-if="listLoading" :size="36" class="spin" />
            <BiliIcon v-else name="logo" :size="52" />
            <h2>{{ listLoading ? '正在准备推荐视频' : listError ? '推荐暂时没有加载出来' : '暂时没有推荐视频' }}</h2>
            <p>{{ listError || '来自 B站的热门视频，向上滑动，继续发现。' }}</p>
            <button v-if="!listLoading" class="pink-button" @click="start"><RefreshCw :size="15" /> 重新加载</button>
        </div>

        <main v-else class="feed-layout">
            <div class="feed-screen">
                <div class="screen-topline"><span class="live-dot"></span> 为你放映 <span class="screen-counter">{{ String(index + 1).padStart(2, '0') }} / {{ items.length }}{{ hasMore ? '+' : '' }}</span></div>
                <div class="video-stage">
                    <img v-if="!stream && info.cover" class="loading-cover" :src="info.cover" alt="" referrerpolicy="no-referrer" />
                    <Transition name="feed-video" mode="out-in">
                        <ArtVideoPlayer v-if="stream" :key="current.bvid" :src="stream.videoUrl || stream.url" play-type="direct"
                            :audio-url="stream.type === 'dash' ? stream.audioUrl || '' : ''" :qualities="stream.qualities || []"
                            :current-qn="currentQn" :danmaku="danmaku" :episode-title="info.title" :episode-cover="info.cover"
                            :has-prev="index > 0" :has-next="canNext" :load-timeout-ms="25000"
                            @prev="move(-1)" @next="move(1)" @retry="playCurrent" @quality-change="currentQn = $event" />
                    </Transition>
                    <div v-if="loading || error" class="stage-mask" role="status">
                        <Loader2 v-if="loading" :size="32" class="spin" /><Play v-else :size="32" />
                        <p>{{ error || '正在加载视频…' }}</p>
                        <div v-if="error" class="error-actions"><button class="pink-button" @click="playCurrent"><RefreshCw :size="15" /> 重试</button><button class="quiet-button" @click="openDetail">打开详情</button></div>
                    </div>
                </div>
                <div class="screen-bottomline"><span><ArrowUpDown :size="13" /> 滚轮 / 上下滑动切换</span><span>↑ ↓ 方向键也可以</span></div>
            </div>

            <aside class="feed-info">
                <div class="info-eyebrow"><span>正在播放</span><span>热门推荐</span></div>
                <div :key="current.bvid" class="info-content">
                    <h2 class="video-title">{{ info.title }}</h2>
                    <button class="author-button" :disabled="!info.mid" @click="goAuthor">
                        <img v-if="info.face" :src="info.face" alt="" referrerpolicy="no-referrer" /><UserRound v-else :size="20" />
                        <span>{{ info.author }}</span><ExternalLink :size="13" />
                    </button>
                    <p class="view-count"><BiliIcon name="playcount" :size="14" /> {{ fmt(info.play) }} 次播放</p>
                    <p v-if="info.desc" class="feed-description">{{ info.desc }}</p>
                </div>
                <div class="feed-actions">
                    <button :class="{ selected: liked }" :aria-pressed="liked" :disabled="!video || busy" @click="interact('like')"><BiliIcon name="like" :size="23" /><span>{{ liked ? '已点赞' : '点赞' }}</span></button>
                    <div class="coin-action">
                        <button :class="{ selected: coins > 0 }" :aria-expanded="showCoins" :disabled="!video || busy || coins > 0" @click="showCoins = !showCoins"><BiliIcon name="coin" :size="23" /><span>{{ coins ? '已投币' : '投币' }}</span></button>
                        <div v-if="showCoins" class="coin-picker"><button @click="interact('coin', 1)">投 1 枚</button><button @click="interact('coin', 2)">投 2 枚</button><button @click="showCoins = false">取消</button></div>
                    </div>
                    <button :class="{ selected: favored }" :aria-pressed="favored" :disabled="!video || busy" @click="interact('fav')"><BiliIcon name="star" :size="23" /><span>{{ favored ? '已收藏' : '收藏' }}</span></button>
                    <button @click="openDetail"><MessageCircle :size="23" /><span>详情 / 评论</span></button>
                </div>
                <div class="feed-navigation">
                    <button class="previous-button" :disabled="index === 0" aria-label="上一个视频" title="上一个视频（↑）" @click="move(-1)"><ArrowUp :size="21" /></button>
                    <button class="pink-button next-button" :disabled="!canNext || (listLoading && index === items.length - 1)" @click="move(1)">
                        <Loader2 v-if="listLoading && index === items.length - 1" :size="18" class="spin" /><ArrowDown v-else :size="18" /> 下一个视频
                    </button>
                </div>
                <div class="feed-status" role="status">
                    <template v-if="listError"><span>{{ listError }}</span><button @click="loadMore">重试加载</button></template>
                    <template v-else-if="listLoading">正在准备更多视频…</template>
                    <template v-else-if="!canNext">已经看到最后一条，向上可回看</template>
                    <template v-else>喜欢就停一会儿，下一条也值得期待</template>
                </div>
            </aside>
        </main>
    </section>
</template>

<style scoped>
.bili-feed { --feed-pink: #fb7299; flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: #141519; color: #f4f4f6; padding: 0 28px 22px; outline: none; font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
.feed-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 78px; flex-shrink: 0; border-bottom: 1px solid #ffffff0e; }
.feed-brand { display: flex; align-items: center; gap: 9px; color: var(--feed-pink); }
.feed-brand h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: 1px; }
.feed-brand > span { margin-left: 12px; color: #8e909b; font-size: 12px; letter-spacing: 1px; }
button { font: inherit; cursor: pointer; transition: background .18s, color .18s; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible { outline: 2px solid var(--feed-pink); outline-offset: 4px; }
.quiet-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; color: #b0b1bd; background: transparent; border: 0; padding: 9px 0; font-size: 12px; }
.quiet-button:hover { color: #fff; }
.pink-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; color: #fff; background: var(--feed-pink); border: 0; border-radius: 10px; padding: 12px 18px; font-size: 13px; font-weight: 600; }
.pink-button:hover:not(:disabled) { background: #ed5e89; }
.feed-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 268px; gap: 30px; padding-top: 24px; }
.feed-screen { min-height: 0; min-width: 0; display: flex; flex-direction: column; background: #090a0c; border: 1px solid #ffffff0e; border-radius: 16px; overflow: hidden; }
.screen-topline, .screen-bottomline { display: flex; align-items: center; gap: 8px; flex-shrink: 0; padding: 14px 18px; color: #a5a6b1; font-size: 11px; }
.screen-topline { letter-spacing: 2px; }
.screen-counter { margin-left: auto; color: #737580; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.live-dot { width: 5px; height: 5px; background: var(--feed-pink); border-radius: 50%; }
.video-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #000; touch-action: pan-x; }
.video-stage :deep(.art-player-wrap) { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; }
.loading-cover { width: 100%; height: 100%; object-fit: contain; opacity: .25; }
.screen-bottomline { justify-content: space-between; gap: 12px; color: #777985; font-size: 11px; }
.screen-bottomline span { display: flex; align-items: center; gap: 6px; }
.stage-mask { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; background: #090a0c88; padding: 24px; text-align: center; }
.stage-mask p { font-size: 13px; line-height: 1.8; max-width: 420px; margin: 0; }
.error-actions { display: flex; align-items: center; gap: 18px; }
.feed-info { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 10px 0 0; }
.info-eyebrow { display: flex; align-items: center; justify-content: space-between; font-size: 11px; letter-spacing: 2px; color: #9596a2; margin-bottom: 22px; }
.info-eyebrow span:last-child { color: var(--feed-pink); background: #fb729912; border: 1px solid #fb729925; padding: 5px 8px; border-radius: 5px; letter-spacing: 1px; }
.info-content { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.video-title { font-size: 21px; line-height: 1.7; font-weight: 600; letter-spacing: .5px; margin: 0 0 22px; overflow-wrap: anywhere; }
.author-button { display: flex; align-items: center; gap: 10px; max-width: 100%; padding: 0; background: none; color: #e2e2e8; border: 0; font-size: 13px; }
.author-button img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; }
.author-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author-button:hover:not(:disabled) { color: var(--feed-pink); }
.view-count { display: flex; gap: 6px; align-items: center; color: #858793; font-size: 11px; margin: 16px 0 20px; }
.feed-description { color: #92939f; font-size: 12px; line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; margin: 0 0 20px; }
.feed-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; border-top: 1px solid #ffffff10; padding: 20px 0; flex-shrink: 0; }
.feed-actions button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 9px; background: none; border: 0; color: #b4b5c0; padding: 4px 0; font-size: 10px; white-space: nowrap; }
.feed-actions button:hover:not(:disabled), .feed-actions button.selected { color: var(--feed-pink); }
.coin-action { position: relative; }
.coin-picker { position: absolute; bottom: calc(100% + 14px); left: 50%; transform: translateX(-50%); width: 116px; padding: 8px; border: 1px solid #ffffff1a; border-radius: 10px; background: #303139; box-shadow: 0 6px 20px #0006; z-index: 5; }
.coin-picker button { padding: 10px; font-size: 12px; }
.feed-navigation { display: flex; gap: 10px; }
.previous-button { width: 44px; display: grid; place-items: center; flex-shrink: 0; color: #cccdd5; background: #24252c; border: 1px solid #ffffff12; border-radius: 10px; }
.previous-button:hover:not(:disabled) { background: #31323a; }
.next-button { flex: 1; min-height: 44px; }
.feed-status { min-height: 32px; color: #727480; font-size: 10px; line-height: 1.8; margin-top: 12px; }
.feed-status button { color: var(--feed-pink); background: none; border: 0; font-size: inherit; padding: 0 6px; }
.feed-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; color: #9b9ca8; }
.feed-empty h2 { margin: 0; color: #e1e1e8; font-size: 18px; }
.feed-empty p { margin: 0; font-size: 13px; }
.spin { animation: feed-spin 1s linear infinite; }
@keyframes feed-spin { to { transform: rotate(360deg); } }
.feed-video-enter-active, .feed-video-leave-active { transition: opacity .12s; }
.feed-video-enter-from, .feed-video-leave-to { opacity: 0; }
@media (max-width: 1100px) { .bili-feed { padding: 0 18px 16px; } .feed-layout { grid-template-columns: minmax(0, 1fr) 220px; gap: 20px; padding-top: 18px; } .video-title { font-size: 18px; } .feed-brand > span { display: none; } }
@media (max-width: 760px) { .feed-layout { grid-template-columns: 1fr; grid-template-rows: minmax(170px, 1fr) auto; gap: 12px; } .feed-header { min-height: 60px; } .feed-brand h1 { font-size: 16px; } .feed-info { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 8px 16px; padding: 0; } .info-eyebrow, .feed-description, .view-count, .screen-bottomline span:last-child { display: none; } .info-content { grid-column: 1; grid-row: 1 / 3; max-height: 130px; } .video-title { font-size: 14px; line-height: 1.6; margin-bottom: 8px; } .feed-actions { grid-column: 2; padding: 0 0 8px; border: 0; } .feed-navigation { grid-column: 2; } .feed-status { grid-column: 1 / -1; margin-top: 0; min-height: 18px; } }
@media (prefers-reduced-motion: reduce) { *, .feed-video-enter-active, .feed-video-leave-active { transition: none; } }
</style>
