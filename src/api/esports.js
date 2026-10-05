export async function esports(operation, params = {}) {
    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge
    if (!bridge?.invoke) throw new Error('请在桌面客户端中打开娱乐专区')
    const response = await bridge.invoke('esports:request', { operation, params })
    if (!response?.success) throw new Error(response?.message || '赛事加载失败')
    return response.data
}
