import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAnimeStore = defineStore('anime', () => {
    // ===== 收藏夹 =====
    const favorites = ref(JSON.parse(localStorage.getItem('anime_favorites') || '[]'))

    // ===== 播放记忆 =====
    const progress = ref(JSON.parse(localStorage.getItem('anime_progress') || '{}'))

    // ===== 当前源 =====
    const currentSource = ref(localStorage.getItem('anime_current_source') || 'yhdm')

    // ===== 观看历史 =====
    const history = ref(JSON.parse(localStorage.getItem('anime_history') || '[]'))

    // ===== 持久化 =====
    const persistFavorites = () => {
        localStorage.setItem('anime_favorites', JSON.stringify(favorites.value))
    }
    const persistProgress = () => {
        localStorage.setItem('anime_progress', JSON.stringify(progress.value))
    }
    const persistHistory = () => {
        localStorage.setItem('anime_history', JSON.stringify(history.value))
    }

    // ===== 收藏操作 =====
    const addFavorite = (anime) => {
        // anime: { source, id, title, cover, addedAt }
        const exists = favorites.value.find(f => f.source === anime.source && f.id === anime.id)
        if (!exists) {
            favorites.value.unshift({ ...anime, addedAt: Date.now() })
            persistFavorites()
        }
    }

    const removeFavorite = (source, id) => {
        const idx = favorites.value.findIndex(f => f.source === source && f.id === id)
        if (idx >= 0) {
            favorites.value.splice(idx, 1)
            persistFavorites()
        }
    }

    const isFavorited = (source, id) => {
        return favorites.value.some(f => f.source === source && f.id === id)
    }

    const toggleFavorite = (anime) => {
        if (isFavorited(anime.source, anime.id)) {
            removeFavorite(anime.source, anime.id)
            return false
        } else {
            addFavorite(anime)
            return true
        }
    }

    // ===== 播放记忆 =====
    const progressKey = (source, id, ep) => `${source}_${id}_${ep}`

    const saveProgress = (source, id, ep, currentTime, duration) => {
        if (!ep) return
        const key = progressKey(source, id, ep)
        progress.value[key] = {
            currentTime,
            duration,
            updatedAt: Date.now()
        }
        persistProgress()
    }

    const getProgress = (source, id, ep) => {
        const key = progressKey(source, id, ep)
        return progress.value[key] || null
    }

    const clearProgress = (source, id, ep) => {
        const key = progressKey(source, id, ep)
        delete progress.value[key]
        persistProgress()
    }

    const clearAllProgress = (source, id) => {
        const prefix = `${source}_${id}_`
        Object.keys(progress.value).forEach(key => {
            if (key.startsWith(prefix)) delete progress.value[key]
        })
        persistProgress()
    }

    // ===== 历史 =====
    const addHistory = (anime, ep) => {
        // anime: { source, id, title, cover }
        const item = {
            source: anime.source,
            id: anime.id,
            title: anime.title,
            cover: anime.cover,
            ep: ep?.title || '',
            watchedAt: Date.now()
        }
        // 去重（同源同 id 同集数）
        const idx = history.value.findIndex(h =>
            h.source === item.source && h.id === item.id && h.ep === item.ep
        )
        if (idx >= 0) history.value.splice(idx, 1)
        history.value.unshift(item)
        // 最多保留 100 条
        if (history.value.length > 100) history.value = history.value.slice(0, 100)
        persistHistory()
    }

    const clearHistory = () => {
        history.value = []
        persistHistory()
    }

    // ===== 源切换 =====
    const setSource = (source) => {
        currentSource.value = source
        localStorage.setItem('anime_current_source', source)
    }

    // ===== 已观看集数（用于详情页显示红点） =====
    const getWatchedEpisodes = (source, id) => {
        const prefix = `${source}_${id}_`
        const watched = []
        Object.keys(progress.value).forEach(key => {
            if (key.startsWith(prefix)) {
                const ep = key.replace(prefix, '')
                const p = progress.value[key]
                // 已观看：进度超过 80%
                if (p.duration && p.currentTime / p.duration > 0.8) {
                    watched.push(ep)
                }
            }
        })
        return watched
    }

    return {
        favorites,
        progress,
        currentSource,
        history,
        addFavorite,
        removeFavorite,
        isFavorited,
        toggleFavorite,
        saveProgress,
        getProgress,
        clearProgress,
        clearAllProgress,
        addHistory,
        clearHistory,
        setSource,
        getWatchedEpisodes
    }
})
