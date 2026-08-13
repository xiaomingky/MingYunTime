import { defineStore } from 'pinia'
import { PLATFORMS, getCurrentPlatform, setCurrentPlatform } from '../api'

// 平台切换 Store
// 维护当前平台状态，提供切换方法（切换后由调用方触发页面刷新）
// 平台隔离：网易云登录态在 music_cookie/user_profile，QQ 登录态在 qq_cookie/qq_profile，酷狗登录态在 kugou_cookie/kugou_profile
export const usePlatformStore = defineStore('platform', {
    state: () => ({
        current: getCurrentPlatform(),
        platforms: PLATFORMS
    }),
    getters: {
        isNetease: (state) => state.current === 'netease',
        isQQ: (state) => state.current === 'qq',
        isKugou: (state) => state.current === 'kugou',
        currentPlatform: (state) => PLATFORMS[state.current] || PLATFORMS.netease,
        themeColor: (state) => (PLATFORMS[state.current] || PLATFORMS.netease).themeColor
    },
    actions: {
        // 切换平台：写入 localStorage 并刷新页面（保证所有 store/路由状态彻底重置）
        switchTo(key) {
            if (!PLATFORMS[key] || key === this.current) return false
            setCurrentPlatform(key)
            this.current = key
            const targetHash = key === 'qq' ? '#/qq' : (key === 'kugou' ? '#/kugou' : '#/')
            window.location.href = window.location.pathname + window.location.search + targetHash
            window.location.reload()
            return true
        },
        // 仅更新内存状态（不刷新页面，用于初始化时同步）
        syncFromStorage() {
            this.current = getCurrentPlatform()
        }
    }
})
