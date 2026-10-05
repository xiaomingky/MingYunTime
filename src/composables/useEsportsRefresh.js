import { onMounted, onBeforeUnmount } from 'vue'

export function useEsportsRefresh(refresh, interval, enabled = () => true) {
    let timer, running = false, disposed = false
    async function tick() {
        if (disposed || running || document.hidden || !enabled()) return
        running = true
        try { await refresh() } finally { running = false }
    }
    onMounted(() => {
        timer = setInterval(tick, interval)
        document.addEventListener('visibilitychange', tick)
    })
    onBeforeUnmount(() => {
        disposed = true
        clearInterval(timer)
        document.removeEventListener('visibilitychange', tick)
    })
}
