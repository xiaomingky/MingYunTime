<script setup>
import { ref } from 'vue'
import { X, Lock, Shield } from 'lucide-vue-next'
import { useUserStore } from '../store/user'
import { useMessageStore } from '../store/message'

const props = defineProps({
    show: Boolean
})
const emit = defineEmits(['close', 'verified'])

const userStore = useUserStore()
const messageStore = useMessageStore()
const password = ref('')
const loading = ref(false)

const handleVerify = async () => {
    if (!password.value) return messageStore.warning('请输入密码')
    loading.value = true
    const res = await userStore.verifyLockPassword(password.value)
    loading.value = false
    if (res.success) {
        messageStore.success('验证通过')
        password.value = ''
        emit('verified')
        emit('close')
    } else {
        messageStore.error(res.message)
    }
}
</script>

<template>
  <Transition name="modal-pop">
    <div class="lock-modal-overlay" v-if="show" @click.self="emit('close')">
      <div class="lock-modal modal-panel">
        <div class="header">
          <Shield :size="22" />
          <span>访问受保护内容</span>
          <X class="close-btn" :size="20" @click="emit('close')" />
        </div>

        <div class="body">
          <p class="tip">该账号已开启密码保护，请输入密码后继续。<br>如未设置或忘记密码，请登录后端网站管理。</p>
          <div class="input-item">
            <Lock :size="16" />
            <input type="password" v-model="password" placeholder="请输入密码" @keyup.enter="handleVerify" />
          </div>
          <button class="primary-btn" :disabled="loading" @click="handleVerify">
            {{ loading ? '验证中...' : '解锁' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lock-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
  backdrop-filter: blur(4px);
}
.lock-modal {
  width: 360px;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2);
}
.header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid #f0f0f0;
}
.close-btn {
  margin-left: auto;
  cursor: pointer;
  color: #999;
}
.body {
  padding: 24px;
}
.tip {
  font-size: 13px;
  color: #888;
  margin-bottom: 16px;
  line-height: 1.6;
}
.input-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 0 12px;
  margin-bottom: 12px;
}
.input-item input {
  flex: 1;
  border: none;
  outline: none;
  padding: 12px 0;
  font-size: 14px;
}
.primary-btn {
  width: 100%;
  border: none;
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--primary-color);
}
.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
