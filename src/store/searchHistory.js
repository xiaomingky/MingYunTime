// 搜索历史 store - localStorage 持久化
// 按模块分类存储：music / anime / movie / video
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'search_history'
const MAX_HISTORY = 20  // 每个模块最多保留 20 条

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        return JSON.parse(raw)
    } catch {
        return {}
    }
}

function saveToStorage(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* 忽略写入失败 */ }
}

// 热门推荐词（内置，按模块区分）
const HOT_KEYWORDS = {
    music: ['周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '薛之谦', '毛不易', '李荣浩', '华晨宇', '王菲', '五月天'],
    anime: ['斗罗大陆', '斗破苍穹', '一人之下', '进击的巨人', '鬼灭之刃', '咒术回战', '海贼王', '火影忍者', '名侦探柯南', '间谍过家家'],
    movie: ['流浪地球', '满江红', '消失的她', '封神第一部', '长津湖', '战狼', '你好李焕英', '唐人街探案', '红海行动', '哪吒之魔童降世'],
    video: ['周杰伦 MV', '林俊杰 MV', '邓紫棋 MV', 'BLACKPINK', 'BTS', 'May J Lee', '1M舞蹈室', '红昭愿', '漠河舞厅', '起风了'],
    'bilibili-video': ['鬼畜全明星', '原神', '明日方舟', 'LOL精彩集锦', 'Python教程', '美食探店', '猫咪日常', '健身环大冒险', '考研数学', '电子钢琴']
}

export const useSearchHistoryStore = defineStore('searchHistory', () => {
    const allHistory = ref(loadFromStorage())

    // 获取某模块的历史（最新在前）
    function getHistory(module) {
        return allHistory.value[module] || []
    }

    // 添加搜索记录（去重，最多保留 MAX_HISTORY 条）
    function addHistory(module, keyword) {
        const kw = keyword.trim()
        if (!kw) return
        const list = allHistory.value[module] || []
        // 去重
        const filtered = list.filter(item => item !== kw)
        // 头部插入
        filtered.unshift(kw)
        // 截断
        // 用对象展开创建新引用，确保响应式触发
        allHistory.value = { ...allHistory.value, [module]: filtered.slice(0, MAX_HISTORY) }
        saveToStorage(allHistory.value)
    }

    // 删除单条
    function removeHistory(module, keyword) {
        const list = allHistory.value[module] || []
        allHistory.value = { ...allHistory.value, [module]: list.filter(item => item !== keyword) }
        saveToStorage(allHistory.value)
    }

    // 清空某模块历史
    function clearHistory(module) {
        allHistory.value = { ...allHistory.value, [module]: [] }
        saveToStorage(allHistory.value)
    }

    // 获取某模块的热门推荐
    // 音乐模块按平台细分(music-netease/music-kugou/music-qq),热门词回退到 music
    function getHotKeywords(module) {
        if (module && module.startsWith('music-')) return HOT_KEYWORDS['music'] || []
        return HOT_KEYWORDS[module] || []
    }

    // 相似推荐：从历史 + 热门中匹配包含输入字符的项
    function getSuggestions(module, query) {
        const q = (query || '').trim().toLowerCase()
        if (!q) {
            // 无输入时返回热门词
            return getHotKeywords(module).slice(0, 8)
        }
        const history = getHistory(module)
        const hot = getHotKeywords(module)
        const all = [...history, ...hot]
        const seen = new Set()
        const result = []
        for (const kw of all) {
            if (seen.has(kw)) continue
            if (kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase())) {
                seen.add(kw)
                result.push(kw)
            }
            if (result.length >= 8) break
        }
        return result
    }

    return {
        allHistory,
        getHistory,
        addHistory,
        removeHistory,
        clearHistory,
        getHotKeywords,
        getSuggestions
    }
})
