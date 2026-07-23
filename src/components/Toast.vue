<script setup>
import { useMessageStore } from '../store/message'
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-vue-next'

const messageStore = useMessageStore()

const getIcon = (type) => {
    switch (type) {
        case 'success': return CheckCircle2
        case 'error': return AlertCircle
        case 'warning': return AlertTriangle
        default: return Info
    }
}
</script>

<template>
    <TransitionGroup name="toast" tag="div" class="toast-container">
        <div 
            v-for="msg in messageStore.messages" 
            :key="msg.id" 
            class="toast-item"
            :class="[msg.type, { 'has-profile': msg.profile }]"
        >
            <div v-if="msg.profile" class="toast-profile">
                <img :src="msg.profile.avatarUrl" class="toast-avatar" />
            </div>
            <component v-else :is="getIcon(msg.type)" :size="18" />
            
            <div class="toast-content">
                <div v-if="msg.profile" class="toast-nickname">{{ msg.profile.nickname }}</div>
                <span class="toast-text">{{ msg.text }}</span>
            </div>
        </div>
    </TransitionGroup>
</template>

<style scoped>
.toast-container {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    pointer-events: none;
}

.toast-item {
    background: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 200px;
    justify-content: center;
    font-size: 14px;
    border: 1px solid #eee;
    animation: toast-in 0.3s ease-out;
}

.toast-item.success {
    color: #52c41a;
    background: #f6ffed;
    border-color: #b7eb8f;
}

.toast-item.error {
    color: #ff4d4f;
    background: #fff2f0;
    border-color: #ffccc7;
}

.toast-item.warning {
    color: #faad14;
    background: #fffbe6;
    border-color: #ffe58f;
}

.toast-item.info {
    color: #1890ff;
    background: #e6f7ff;
    border-color: #91d5ff;
}

.toast-item.has-profile {
    padding: 10px 20px;
    min-width: 240px;
    justify-content: flex-start;
}

.toast-profile {
    flex-shrink: 0;
}

.toast-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.toast-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.toast-nickname {
    font-weight: 600;
    font-size: 14px;
    color: #333;
}

.toast-text {
    font-size: 13px;
    opacity: 0.8;
}

@keyframes toast-in {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.toast-leave-to {
    opacity: 0;
    transform: translateY(-20px);
}

.toast-leave-active {
    transition: all 0.3s ease-in;
    position: absolute;
}
</style>
