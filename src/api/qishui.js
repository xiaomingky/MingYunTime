const bridge = () => window.__ELECTRON_BRIDGE__ || window.bridge
export async function qishuiInvoke(name, params = {}) {
    if (!bridge()?.invoke) throw new Error('汽水音乐需要在桌面应用中使用')
    const res = await bridge().invoke('qishui:' + name, params)
    if (res?.code !== 0) { const error = new Error(res?.message || '汽水音乐请求失败'); error.code = res?.errorCode; error.retryAt = res?.retryAt; throw error }
    return res.data
}
export async function downloadQishuiTrack(song, quality = localStorage.getItem('qishui_music_quality') || 'auto') {
    return qishuiInvoke('download', {id:String(song.qishuiId || song.id), name:song.name, quality:quality === 'platform' ? 'auto' : quality})
}
export function qishuiShareId(text) {
    const value = String(text || '').trim()
    if (/^\d{15,22}$/.test(value)) return value
    try {
        const url = new URL(value)
        if (!['music.douyin.com', 'www.qishui.com', 'qishui.douyin.com', 'api.qishui.com'].includes(url.hostname)) return ''
        const id = url.searchParams.get('track_id') || url.pathname.match(/\/(?:track|song)\/(\d+)/)?.[1] || ''
        return /^\d{15,22}$/.test(id) ? id : ''
    } catch { return '' }
}
export async function copyQishuiShare(type, id) {
    const data = await qishuiInvoke('share', { type, id: String(id) })
    await navigator.clipboard.writeText(data.url)
}
