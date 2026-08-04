<script setup>
import { AlertTriangle, X } from 'lucide-vue-next'

const props = defineProps({
    visible: { type: Boolean, default: false },
    title: { type: String, default: '确认操作' },
    message: { type: String, default: '' },
    confirmText: { type: String, default: '确定' },
    cancelText: { type: String, default: '取消' },
    danger: { type: Boolean, default: true }
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
    <Transition name="confirm-fade">
        <div v-if="visible" class="confirm-overlay" @click.self="emit('cancel')">
            <div class="confirm-modal">
                <div class="confirm-modal-close" @click="emit('cancel')">
                    <X :size="16" />
                </div>
                <div class="confirm-icon-wrap" :class="{ danger }">
                    <AlertTriangle :size="32" />
                </div>
                <h3 class="confirm-title">{{ title }}</h3>
                <p class="confirm-message">{{ message }}</p>
                <div class="confirm-actions">
                    <button class="confirm-cancel-btn" @click="emit('cancel')">{{ cancelText }}</button>
                    <button class="confirm-ok-btn" :class="{ danger }" @click="emit('confirm')">{{ confirmText }}</button>
                </div>
            </div>
        </div>
    </Transition>
</template>

<style scoped>
.confirm-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.45); z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
}
.confirm-modal {
    background: var(--bg-main, #fff);
    border-radius: 12px;
    width: 360px;
    padding: 28px 24px 20px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.04);
    text-align: center;
    position: relative;
    animation: confirm-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes confirm-slide-up {
    from { opacity: 0; transform: translateY(16px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.confirm-modal-close {
    position: absolute; top: 12px; right: 12px;
    cursor: pointer; color: var(--text-light, #999);
    padding: 4px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    transition: color 0.15s, background 0.15s;
}
.confirm-modal-close:hover {
    color: var(--text-main, #333);
    background: var(--hover-bg, rgba(0,0,0,0.05));
}
.confirm-icon-wrap {
    width: 56px; height: 56px; border-radius: 50%;
    margin: 0 auto 14px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255, 107, 107, 0.1);
    color: #ff6b6b;
}
.confirm-icon-wrap.danger {
    background: rgba(255, 107, 107, 0.1);
    color: #ff6b6b;
}
.confirm-title {
    font-size: 16px; font-weight: 600;
    color: var(--text-main, #333);
    margin-bottom: 8px;
}
.confirm-message {
    font-size: 14px;
    color: var(--text-secondary, #666);
    line-height: 1.6;
    margin-bottom: 22px;
}
.confirm-actions {
    display: flex; gap: 10px; justify-content: center;
}
.confirm-cancel-btn {
    flex: 1; padding: 9px 0; border-radius: 8px;
    border: 1px solid var(--border-color, rgba(0,0,0,0.1));
    background: transparent; color: var(--text-secondary, #666);
    cursor: pointer; font-size: 14px;
    transition: background 0.15s;
}
.confirm-cancel-btn:hover { background: var(--hover-bg, rgba(0,0,0,0.04)); }
.confirm-ok-btn {
    flex: 1; padding: 9px 0; border-radius: 8px;
    border: none; background: var(--primary-color, #2CA2F5); color: white;
    cursor: pointer; font-size: 14px; font-weight: 500;
    transition: opacity 0.15s, transform 0.1s;
}
.confirm-ok-btn:hover { opacity: 0.9; }
.confirm-ok-btn:active { transform: scale(0.98); }
.confirm-ok-btn.danger { background: #ff6b6b; }

.confirm-fade-enter-active, .confirm-fade-leave-active {
    transition: opacity 0.2s;
}
.confirm-fade-enter-from, .confirm-fade-leave-to {
    opacity: 0;
}
</style>
