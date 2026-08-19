import { defineStore } from 'pinia'

// 核心播放快捷键默认配置（记录格式：修饰键 + 主键，用 '+' 拼接，如 Ctrl+ArrowRight、Space）
export const DEFAULT_SHORTCUTS = {
    togglePlay: 'Space',        // 播放 / 暂停
    next: 'Ctrl+ArrowRight',    // 下一首
    prev: 'Ctrl+ArrowLeft',     // 上一首
    volumeUp: 'Ctrl+ArrowUp',   // 音量加
    volumeDown: 'Ctrl+ArrowDown', // 音量减
    favorite: 'Ctrl+F',         // 红心收藏
    togglePlayMode: 'Ctrl+T'    // 切换播放模式
}

// 设置专区中"快捷键"区块的展示项（顺序即展示顺序）
export const SHORTCUT_ITEMS = [
    { id: 'togglePlay', label: '播放 / 暂停' },
    { id: 'next', label: '下一首' },
    { id: 'prev', label: '上一首' },
    { id: 'volumeUp', label: '音量加' },
    { id: 'volumeDown', label: '音量减' },
    { id: 'favorite', label: '红心收藏' },
    { id: 'togglePlayMode', label: '切换播放模式' }
]

// 监听事件转换/比较快捷键（与保存格式保持一致）
export function eventToCombo(e) {
    const mods = []
    if (e.ctrlKey) mods.push('Ctrl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    if (e.metaKey) mods.push('Meta')
    let key = e.key
    if (key === ' ' || key === 'Spacebar') key = 'Space'
    return [...mods, key].join('+')
}

export function comboMatches(e, combo) {
    return !!combo && eventToCombo(e) === combo
}

// 人类可读的快捷键展示（Space -> 空格，ArrowRight -> →）
export function formatCombo(combo) {
    if (!combo) return ''
    const MAP = {
        Space: '空格',
        ArrowRight: '→',
        ArrowLeft: '←',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        Enter: '回车'
    }
    return combo.split('+').map(p => MAP[p] || p).join(' + ')
}

export const useSettingsStore = defineStore('settings', {
    state: () => {
        let saved = {}
        try {
            saved = JSON.parse(localStorage.getItem('app_settings') || '{}') || {}
        } catch (e) { saved = {} }
        return {
            shortcuts: { ...DEFAULT_SHORTCUTS, ...(saved.shortcuts || {}) },
            // 兼容旧配置：若新配置缺失，则回退读取原 'close_action' / 'api_line' 的本地值
            closePrefer: saved.closePrefer ?? localStorage.getItem('close_action') ?? 'ask',
            apiLine: saved.apiLine ?? localStorage.getItem('api_line') ?? null
        }
    },
    actions: {
        persist() {
            localStorage.setItem('app_settings', JSON.stringify({
                shortcuts: this.shortcuts,
                closePrefer: this.closePrefer,
                apiLine: this.apiLine
            }))
            // 同步旧的独立键，方便旧逻辑/外部读取保持同步
            localStorage.setItem('close_action', this.closePrefer)
            if (this.apiLine) localStorage.setItem('api_line', this.apiLine)
        },
        setShortcut(id, combo) {
            this.shortcuts[id] = combo
            this.persist()
        },
        resetShortcut(id) {
            this.shortcuts[id] = DEFAULT_SHORTCUTS[id]
            this.persist()
        },
        setClosePrefer(v) {
            this.closePrefer = v
            this.persist()
        },
        setApiLine(key) {
            this.apiLine = key
            this.persist()
        }
    }
})