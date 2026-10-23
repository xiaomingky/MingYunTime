import Hls from 'hls.js'

// A separate, muted decoder keeps hover scrubbing independent of main playback.
export function installSeekPreview(art) {
    const root = art.template.$player
    const progress = root.querySelector('.art-progress')
    if (!progress) return () => {}
    const card = document.createElement('div')
    card.className = 'avp-seek-preview'
    card.hidden = true
    const canvas = document.createElement('canvas')
    canvas.width = 192; canvas.height = 108
    const caption = document.createElement('span')
    const loading = document.createElement('span')
    loading.className = 'avp-seek-preview-loading'
    loading.textContent = '正在预览…'
    card.append(canvas, loading, caption); root.append(card)
    const ctx = canvas.getContext('2d')
    let decoder, hls, source = '', timer, idleTimer, seekTimer
    let dragging = false, inside = false, disposed = false, busy = false
    let wanted = 0, generation = 0, revision = 0
    const cache = new Map()
    const listen = (node, event, fn) => { node.addEventListener(event, fn); return () => node.removeEventListener(event, fn) }
    const decoderListeners = []
    const release = () => {
        generation++; busy = false; source = ''
        clearTimeout(timer); clearTimeout(seekTimer)
        decoderListeners.splice(0).forEach(fn => fn())
        hls?.destroy(); hls = null
        if (decoder) { decoder.pause(); decoder.removeAttribute('src'); decoder.load(); decoder.remove(); decoder = null }
        cache.clear()
    }
    const hide = () => {
        inside = false; card.hidden = true; clearTimeout(timer)
        clearTimeout(idleTimer); idleTimer = setTimeout(release, 10000)
    }
    const showCached = key => {
        const frame = cache.get(key)
        if (!frame) return false
        ctx.drawImage(frame, 0, 0); canvas.hidden = false; loading.hidden = true
        return true
    }
    const pump = () => {
        if (disposed || card.hidden || busy || !decoder || decoder.readyState < 1) return
        const key = Math.round(wanted * 2) / 2
        if (showCached(key)) return
        const video = decoder, epoch = generation, request = revision
        busy = true
        const done = () => {
            clearTimeout(seekTimer)
            video.removeEventListener('seeked', done)
            if (epoch !== generation || disposed) return
            busy = false
            if (video.readyState >= 2) {
                const frame = document.createElement('canvas')
                frame.width = 192; frame.height = 108
                const context = frame.getContext('2d')
                context.fillStyle = '#111'; context.fillRect(0, 0, 192, 108)
                const scale = Math.min(192 / video.videoWidth, 108 / video.videoHeight)
                if (Number.isFinite(scale)) {
                    context.drawImage(video, (192 - video.videoWidth * scale) / 2, (108 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale)
                    cache.set(key, frame)
                    if (cache.size > 24) cache.delete(cache.keys().next().value)
                    if (request === revision && !card.hidden) showCached(key)
                }
            }
            if (request !== revision && !card.hidden) timer = setTimeout(pump, 60)
        }
        video.addEventListener('seeked', done, { once: true })
        seekTimer = setTimeout(() => {
            video.removeEventListener('seeked', done)
            if (epoch !== generation) return
            busy = false
            loading.textContent = '此处画面暂不可用'
            if (request !== revision) timer = setTimeout(pump, 100)
        }, 6000)
        try {
            const target = Math.min(key, Math.max(0, video.duration - 0.05))
            if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) done()
            else video.currentTime = target
        } catch { done() }
    }
    const ensureDecoder = () => {
        const url = art.video.currentSrc || art.video.src
        if (!url) return
        if (source === url && decoder) return
        release(); source = url
        const video = decoder = document.createElement('video')
        video.muted = true; video.defaultMuted = true; video.preload = 'metadata'
        video.crossOrigin = art.video.crossOrigin || 'anonymous'
        video.playsInline = true
        decoderListeners.push(listen(video, 'loadeddata', pump), listen(video, 'error', () => { loading.textContent = '此处画面暂不可用' }))
        if (art.hls && Hls.isSupported()) {
            hls = new Hls({ autoStartLoad: true, maxBufferLength: 2, maxMaxBufferLength: 4, backBufferLength: 0, startLevel: 0 })
            hls.loadSource(art.option.url); hls.attachMedia(video)
        } else video.src = url
    }
    const move = event => {
        if (disposed || (!inside && !dragging)) return
        const duration = art.video.duration
        if (!Number.isFinite(duration) || duration <= 0 || art.flv) { hide(); return }
        const bar = progress.getBoundingClientRect(), bounds = root.getBoundingClientRect()
        if (!bar.width) return
        clearTimeout(idleTimer); clearTimeout(timer)
        wanted = Math.min(duration - 0.05, Math.max(0, (event.clientX - bar.left) / bar.width * duration))
        revision++
        const seconds = Math.floor(wanted)
        caption.textContent = (seconds >= 3600 ? Math.floor(seconds / 3600) + ':' : '') + String(Math.floor(seconds / 60) % 60).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
        card.style.left = Math.max(8, Math.min(bounds.width - 208, event.clientX - bounds.left - 100)) + 'px'
        card.style.bottom = Math.max(8, bounds.bottom - bar.top + 12) + 'px'
        card.hidden = false
        loading.textContent = '正在预览…'
        canvas.hidden = true; loading.hidden = false
        ensureDecoder()
        if (!showCached(Math.round(wanted * 2) / 2)) timer = setTimeout(pump, dragging ? 65 : 100)
    }
    const enter = event => { inside = true; move(event) }
    const down = event => { if (event.button !== 0) return; dragging = true; inside = true; move(event) }
    // A completed seek is a distinct gesture from hover. Clear the preview on
    // pointerup even when the release happened over the bar; the next
    // pointermove/enter will create a fresh timestamp instead of leaving a
    // stale frame above the controls.
    const up = () => { if (!dragging) return; dragging = false; hide() }
    const leave = () => { inside = false; if (!dragging) hide() }
    const reset = () => { hide(); release() }
    const listeners = [
        listen(progress, 'pointerenter', enter), listen(progress, 'pointermove', move),
        listen(progress, 'pointerdown', down), listen(progress, 'pointerleave', leave),
        listen(document, 'pointermove', event => { if (dragging) move(event) }),
        listen(document, 'pointerup', up), listen(document, 'pointercancel', () => { dragging = false; hide() }),
        listen(window, 'blur', () => { dragging = false; hide() }),
        listen(art.video, 'emptied', reset),
    ]
    return () => {
        disposed = true; listeners.forEach(fn => fn())
        clearTimeout(idleTimer); release(); card.remove()
    }
}
