// Shared account rules. Keep large WeChat IDs as strings.
export function qqMembershipFromIcons(levels = []) {
    let result = { isVip: false, vipLevel: 0, vipIcon: '' }
    for (const entry of Array.isArray(levels) ? levels : []) {
        let url
        try { url = new URL(entry?.iconurl) } catch { continue }
        // QQ returns svip_g.png for ordinary/expired users too. Its grey
        // invitation icon is not evidence of an active subscription.
        const name = url.pathname.split('/').pop().replace(/@2x(?=\.)/i, '')
        const match = name.match(/^n?(svip|sui|vip)(\d*)\.(png|webp|svg)$/i)
        if (!match || !['y.gtimg.cn', 'y.qq.com'].includes(url.hostname)) continue
        const vipLevel = match[1].toLowerCase() === 'svip' ? 2 : 1
        if (vipLevel > result.vipLevel) result = { isVip: true, vipLevel, vipIcon: url.href.replace(/^http:/, 'https:') }
    }
    return result
}

export function qqCookieValue(cookie, name) {
    const match = String(cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
    return match ? match.slice(name.length + 1).trim() : ''
}

export function qqAccountId(cookie) {
    for (const name of ['uin', 'qqmusic_uin', 'wxuin']) {
        const value = qqCookieValue(cookie, name).replace(/^[oO]/, '').replace(/^0+/, '')
        if (/^\d+$/.test(value)) return value
    }
    return ''
}

export function qqGtk(cookie) {
    const value = qqCookieValue(cookie, 'p_skey') || qqCookieValue(cookie, 'skey') || qqCookieValue(cookie, 'qm_keyst')
    let hash = 5381
    for (const char of value) hash += (hash << 5) + char.charCodeAt(0)
    return hash & 0x7fffffff
}

export function qqPage(items, offset = 0, limit = 100) {
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const count = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)))
    return { items: items.slice(start, start + count), total: items.length, hasMore: start + count < items.length }
}

