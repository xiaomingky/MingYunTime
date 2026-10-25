import { ref, computed, onBeforeUnmount } from 'vue'
import { biliVideoHome, biliVideoDetail, biliAnimePlayurl, biliVideoPlayurl, biliAnimeDanmaku } from '../api'

// One active stream and a generation guard: late IPC replies must never replace the next video.
export function useBiliFeed(api = { home: biliVideoHome, detail: biliVideoDetail, tv: biliAnimePlayurl, web: biliVideoPlayurl, danmaku: biliAnimeDanmaku }) {
    const items = ref([]), index = ref(0), page = ref(0), hasMore = ref(true)
    const listLoading = ref(false), listError = ref(''), loading = ref(false), error = ref('')
    const video = ref(null), stream = ref(null), danmaku = ref([])
    const current = computed(() => items.value[index.value] || null)
    let generation = 0, disposed = false, pendingPage = null

    async function loadMore() {
        if (pendingPage) return pendingPage
        if (!hasMore.value || disposed) return
        listLoading.value = true
        listError.value = ''
        pendingPage = (async () => {
            try {
                const result = await api.home({ cat: '推荐', page: page.value + 1 })
                if (disposed) return
                if (!result?.success) throw new Error(result?.message || '推荐视频加载失败')
                const seen = new Set(items.value.map(item => item.bvid))
                const added = (result.data?.list || []).filter(item => {
                    if (!item.bvid || seen.has(item.bvid)) return false
                    seen.add(item.bvid)
                    return true
                })
                items.value.push(...added)
                page.value++
                hasMore.value = !!result.data?.hasMore
            } catch (e) {
                if (!disposed) listError.value = e.message || '推荐视频加载失败'
            } finally {
                listLoading.value = false
                pendingPage = null
            }
        })()
        return pendingPage
    }

    async function playCurrent() {
        if (disposed) return
        const item = current.value
        const token = ++generation
        video.value = null
        stream.value = null
        danmaku.value = []
        error.value = ''
        loading.value = false
        if (!item) return
        loading.value = true
        const active = () => !disposed && token === generation
        try {
            const detail = await api.detail(item.bvid)
            if (!active()) return
            if (detail?.data?.pgc) throw new Error('这条内容为番剧或影视，请打开详情观看')
            if (!detail?.success || !detail.data?.video) throw new Error(detail?.message || '视频详情加载失败')
            const info = detail.data.video
            video.value = info
            const cid = info.pages?.[0]?.cid || info.cid
            if (!cid) throw new Error('该视频暂无可播放的分P')
            let result = null
            if (!info.pay) {
                try { result = await api.tv({ aid: info.aid, bvid: info.bvid, cid }) } catch { /* Web fallback */ }
            }
            if (!active()) return
            if (!result?.success || !(result.videoUrl || result.url)) {
                result = await api.web({ bvid: info.bvid, cid, duration: info.pages?.[0]?.duration || info.duration, charge: !!info.pay })
            }
            if (!active()) return
            if (!result?.success || !(result.videoUrl || result.url)) throw new Error(result?.message || '视频暂时无法播放，请重试或切换下一条')
            stream.value = result
            Promise.resolve().then(() => api.danmaku({ cid })).then(result => {
                if (active() && result?.success && Array.isArray(result.data)) danmaku.value = result.data
            }).catch(() => {})
        } catch (e) {
            if (active()) error.value = e.message || '视频加载失败'
        } finally {
            if (active()) loading.value = false
        }
    }

    let moving = false
    async function move(direction) {
        if (moving || disposed || !current.value || ![-1, 1].includes(direction)) return
        const next = index.value + direction
        if (next < 0) return
        moving = true
        try {
            if (next >= items.value.length && hasMore.value) await loadMore()
            if (disposed || next >= items.value.length) return
            index.value = next
            // Allow fast navigation while the previous stream is still resolving.
            void playCurrent()
            if (items.value.length - index.value <= 4 && hasMore.value) void loadMore()
        } finally { moving = false }
    }

    async function start() {
        if (!current.value) {
            // A successful empty response can be retried from the first page.
            if (!pendingPage && !hasMore.value) { page.value = 0; hasMore.value = true }
            await loadMore()
        }
        if (!disposed && current.value) void playCurrent()
    }

    onBeforeUnmount(() => { disposed = true; generation++; stream.value = null })
    return { items, index, hasMore, listLoading, listError, loading, error, current, video, stream, danmaku, loadMore, playCurrent, move, start }
}
