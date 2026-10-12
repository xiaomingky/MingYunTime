// Request-time readiness: importing an unused platform never starts its backend.
const requests = new Map()
const bases = { netease: 'http://localhost:3100', kugou: 'http://localhost:3300' }
export function ensureLocalService(name) {
    const cached = requests.get(name)
    if (cached && (cached.pending || Date.now() < cached.expires)) return cached.promise
    const entry = { pending: true, expires: 0 }
    entry.promise = (async () => {
        try {
            if (window.bridge?.invoke) return !!(await window.bridge.invoke('local-service:ensure', name))
            const response = await fetch(`${bases[name]}/`, { signal: AbortSignal.timeout(1500) })
            return response.status < 500
        } catch { return false }
    })().then(ok => {
        entry.pending = false
        entry.expires = Date.now() + (ok ? 1000 : 5000)
        return ok
    })
    requests.set(name, entry)
    return entry.promise
}
