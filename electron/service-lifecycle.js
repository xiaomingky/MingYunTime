// One startup promise per service. Quit cancels startup and kills only our child.
export function createServiceLifecycle({ probe, launch, wait, ready = () => {}, log = () => {}, now = Date.now, idleMs = 180000 }) {
    let child = null
    let pending = null
    let stopped = false
    let checkedAt = -Infinity
    let controller = null
    let healthy = false
    let idleTimer = null
    let closing = null
    function touch() {
        clearTimeout(idleTimer)
        // API calls finish within their 30s request timeout. Streaming playback and
        // downloads use their own connections and do not depend on this child.
        idleTimer = setTimeout(() => {
            if (pending || !child) return
            const idle = child
            child = null
            healthy = false
            checkedAt = -Infinity
            closing = new Promise(resolve => {
                const timer = setTimeout(resolve, 1000)
                timer.unref?.()
                const done = () => { clearTimeout(timer); resolve() }
                idle.once('exit', done)
                idle.once('error', done)
            })
            idle.kill()
            log('Idle backend released; the next request will start it again')
        }, idleMs)
        idleTimer.unref?.()
    }
    async function boot() {
        if (closing) { await closing; closing = null }
        if (await probe()) {
            if (stopped) throw new Error('Service stopped')
            healthy = true
            checkedAt = now()
            ready()
            touch()
            return true
        }
        if (stopped) throw new Error('Service stopped')
        healthy = false
        if (!child) {
            const launched = launch()
            child = launched
            const exited = () => {
                if (child !== launched) return
                child = null
                healthy = false
                checkedAt = -Infinity
            }
            launched.once('exit', exited)
            launched.once('error', exited)
        }
        controller = new AbortController()
        const ok = await wait(controller.signal)
        if (stopped) throw new Error('Service stopped')
        if (!ok) {
            const failed = child
            child = null
            failed?.kill()
            throw new Error('Local music service did not become ready')
        }
        healthy = true
        checkedAt = now()
        ready()
        touch()
        return true
    }
    return {
        ensure() {
            if (stopped) return Promise.reject(new Error('Service stopped'))
            touch()
            if (pending) return pending
            if (healthy && now() - checkedAt < 10000) return Promise.resolve(true)
            pending = boot().catch(error => { log(error.message); throw error }).finally(() => { pending = null })
            return pending
        },
        stop() {
            stopped = true
            clearTimeout(idleTimer)
            controller?.abort()
            const owned = child
            child = null
            healthy = false
            owned?.kill()
        },
        isHealthy: () => healthy
    }
}
