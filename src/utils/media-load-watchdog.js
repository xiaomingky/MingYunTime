// Optional bounded loading for remote sources. Deliberate pauses never count as stalls.
export function installMediaLoadWatchdog(video, onTimeout, { timeoutMs = 20000, intervalMs = 1000, now = Date.now } = {}) {
    if (!timeoutMs || !video) return () => {}
    let frameLoaded = video.readyState >= 2, lastTime = video.currentTime || 0, lastProgress = now(), stopped = false
    const progress = () => { frameLoaded = true; lastProgress = now() }
    const reset = () => { lastProgress = now() }
    const listeners = [['loadeddata', progress], ['playing', progress], ['seeked', reset], ['seeking', reset], ['play', reset], ['pause', reset]]
    for (const [name, listener] of listeners) video.addEventListener(name, listener)
    const timer = setInterval(() => {
        if (stopped) return
        const time = video.currentTime || 0
        if (time !== lastTime) { frameLoaded = true; lastProgress = now(); lastTime = time }
        if (video.ended || (frameLoaded && video.paused && !video.seeking)) { lastProgress = now(); return }
        if (now() - lastProgress < timeoutMs) return
        cleanup()
        onTimeout(frameLoaded ? '视频缓冲超时，请重试或更换线路' : '播放地址未能在限定时间内加载，请重试或更换播放源')
    }, intervalMs)
    function cleanup() { stopped = true; clearInterval(timer); for (const [name, listener] of listeners) video.removeEventListener(name, listener) }
    return cleanup
}
