export function queueEntries(items, currentIndex) {
    const entries = []
    const rows = []
    let height = 0
    items.forEach((song, index) => {
        const label = index === 0 && currentIndex > 0 ? '播放记录' : index === currentIndex ? '正在播放' : index === 0 || index === currentIndex + 1 ? '接下来' : ''
        if (label) { entries.push({ label, top: height, height: 32, key: `section-${label}` }); height += 32 }
        const row = { song, index, top: height, height: 64, key: song.queueItemId || `${song.id}-${index}` }
        entries.push(row)
        rows.push(row)
        height += 64
    })
    return { entries, rows, height }
}

export function queueWindow(entries, scrollTop, viewport, overscan = 384) {
    const start = Math.max(0, scrollTop - overscan)
    const end = scrollTop + viewport + overscan
    let lo = 0, hi = entries.length
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (entries[mid].top + entries[mid].height <= start) lo = mid + 1
        else hi = mid
    }
    const from = lo
    while (lo < entries.length && entries[lo].top < end) lo++
    return entries.slice(from, lo)
}
