export function lyricIndexAt(lines, seconds) {
    let low = 0, high = lines.length
    while (low < high) {
        const mid = (low + high) >>> 1
        if (lines[mid].time <= seconds) low = mid + 1
        else high = mid
    }
    return low - 1
}

export function wordProgressAt(start, duration, milliseconds) {
    if (milliseconds < start) return 0
    if (duration <= 0) return 1
    return Math.max(0, Math.min(1, (milliseconds - start) / duration))
}
