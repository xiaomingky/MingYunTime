// Cookie request headers do not carry the browser's Expires/Max-Age attributes.
// Only report a date when the platform supplies an explicit expiry value.
export function cookieExpiresAt(platform, cookie) {
    if (platform !== 'qishui') return 0
    const guard = String(cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid_guard='))?.slice(10)
    if (!guard) return 0
    try {
        const parts = decodeURIComponent(guard).split('|')
        const start = Number(parts[1]), lifetime = Number(parts[2])
        const value = (start + lifetime) * 1000
        return parts.length >= 3 && Number.isSafeInteger(start) && start > 1000000000 && Number.isSafeInteger(lifetime) && lifetime > 0 && Number.isSafeInteger(value) ? value : 0
    } catch { return 0 }
}
export function sessionValidity({ platform, cookie, loggedIn, checkedAt = 0, error = '', now = Date.now() }) {
    const expiresAt = cookieExpiresAt(platform, cookie)
    return { expiresAt, checkedAt, state: !cookie ? 'empty' : error ? 'unconfirmed' : !loggedIn ? 'unconfirmed' : expiresAt && expiresAt <= now ? 'expired' : checkedAt ? 'valid' : 'unconfirmed',
        expiryLabel: expiresAt ? new Date(expiresAt).toLocaleString('zh-CN', { hour12: false }) : '平台未提供固定到期时间',
        remaining: expiresAt ? Math.max(0, expiresAt - now) : null }
}
