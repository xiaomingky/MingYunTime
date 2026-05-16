<script setup>
import { useMessageStore } from '../store/message'
import { AlertTriangle } from 'lucide-vue-next'

const messageStore = useMessageStore()
</script>

<template>
  <Transition name="confirm">
    <div v-if="messageStore.confirmState.show" class="confirm-overlay" @click.self="messageStore.closeConfirm(false)">
      <div class="confirm-dialog">
        <div class="confirm-icon">
          <AlertTriangle :size="32" />
        </div>
        <h3 class="confirm-title">{{ messageStore.confirmState.title }}</h3>
        <p class="confirm-message">{{ messageStore.confirmState.message }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="messageStore.closeConfirm(false)">取消</button>
          <button class="confirm-btn ok" @click="messageStore.closeConfirm(true)">确定</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000;
}

.confirm-dialog {
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px 24px;
  width: 380px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.confirm-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #fef3c7;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  color: #f59e0b;
}

.confirm-title {
  font-size: 17px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 8px;
}

.confirm-message {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  margin: 0 0 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.confirm-btn {
  padding: 10px 32px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.confirm-btn.cancel {
  background: #f3f4f6;
  color: #666;
}
.confirm-btn.cancel:hover {
  background: #e5e7eb;
}

.confirm-btn.ok {
  background: #ef4444;
  color: #fff;
}
.confirm-btn.ok:hover {
  background: #dc2626;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.confirm-enter-active,
.confirm-leave-active {
  transition: all 0.25s ease;
}
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-from .confirm-dialog,
.confirm-leave-to .confirm-dialog {
  transform: scale(0.9) translateY(10px);
}
</style>
