import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMessageStore = defineStore('message', () => {
    const messages = ref([])

    const show = (text, type = 'info', duration = 3000, profile = null) => {
        const id = Date.now()
        messages.value.push({ id, text, type, profile })
        setTimeout(() => {
            const index = messages.value.findIndex(m => m.id === id)
            if (index !== -1) messages.value.splice(index, 1)
        }, duration)
    }

    const success = (text, duration, profile = null) => show(text, 'success', duration, profile)
    const error = (text, duration) => show(text, 'error', duration)
    const info = (text, duration) => show(text, 'info', duration)
    const warning = (text, duration) => show(text, 'warning', duration)

    const clearAll = () => {
        messages.value = []
    }

    // 确认弹窗
    const confirmState = ref({ show: false, title: '', message: '', resolve: null })
    const confirm = (message, title = '确认操作') => {
        return new Promise((resolve) => {
            confirmState.value = { show: true, title, message, resolve }
        })
    }
    const closeConfirm = (result) => {
        if (confirmState.value.resolve) confirmState.value.resolve(result)
        confirmState.value = { show: false, title: '', message: '', resolve: null }
    }

    return {
        messages,
        show,
        success,
        error,
        info,
        warning,
        clearAll,
        confirmState,
        confirm,
        closeConfirm
    }
})
