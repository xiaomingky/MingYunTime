<script setup>
import { ref } from 'vue'
import { X, Download, Sparkles, ChevronRight, ExternalLink } from 'lucide-vue-next'

const props = defineProps({
    visible: Boolean,
    version: String,
    notes: String,
    downloadUrl: String
})
const emit = defineEmits(['close'])

const downloading = ref(false)

const handleDownload = () => {
    downloading.value = true
    // 优先用 bridge 打开（Electron 内会用默认浏览器下载）
    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
    if (bridge?.invoke) {
        bridge.invoke('open-external', { url: props.downloadUrl })
    } else {
        // 直接用 a 标签触发下载
        const a = document.createElement('a')
        a.href = props.downloadUrl
        a.download = ''
        a.click()
    }
}

const formatNotes = (raw) => {
    if (!raw) return ''
    return raw
        .replace(/###?\s+(.+)/g, '<h4>$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.+)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="visible" class="dialog-overlay" @click.self="emit('close')">
      <div class="update-dialog">
        <div class="dialog-header">
          <div class="header-icon">
            <Sparkles :size="28" />
          </div>
          <div class="header-text">
            <h2>发现新版本</h2>
            <span class="version-badge">{{ version }}</span>
          </div>
          <X :size="20" class="close-icon" @click="emit('close')" />
        </div>

        <div class="dialog-body" v-html="formatNotes(notes)"></div>

        <div class="dialog-footer">
          <button class="btn-skip" @click="emit('close')">稍后提醒</button>
          <button class="btn-download" :class="{ loading: downloading }" @click="handleDownload">
            <Download :size="18" />
            {{ downloading ? '已打开下载页' : '立即下载' }}
            <ExternalLink :size="12" />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30000;
  will-change: opacity;
}
.dialog-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.update-dialog {
  background: #fff;
  border-radius: 20px;
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  position: relative;
  z-index: 1;
}
.dialog-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 28px 16px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
}
.header-icon {
  background: rgba(255,255,255,0.2);
  width: 48px; height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.header-text h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
}
.version-badge {
  font-size: 12px;
  background: rgba(255,255,255,0.2);
  padding: 2px 10px;
  border-radius: 10px;
}
.close-icon {
  margin-left: auto;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s;
  flex-shrink: 0;
}
.close-icon:hover { opacity: 1; }
.dialog-body {
  padding: 20px 28px;
  overflow-y: auto;
  flex: 1;
  font-size: 14px;
  line-height: 1.8;
  color: #444;
}
.dialog-body :deep(h4) {
  font-size: 14px;
  color: #1a1a2e;
  margin: 12px 0 4px;
}
.dialog-body :deep(li) {
  margin-left: 16px;
  color: #555;
}
.dialog-body :deep(strong) {
  color: #333;
}
.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 28px 20px;
  border-top: 1px solid #f0f0f0;
}
.btn-skip {
  padding: 10px 24px;
  border-radius: 10px;
  border: 1px solid #ddd;
  background: #fff;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-skip:hover { background: #f5f5f5; color: #666; }
.btn-download {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-download:hover { box-shadow: 0 4px 20px rgba(99,102,241,0.4); transform: translateY(-1px); }
.btn-download.loading { opacity: 0.7; pointer-events: none; }

.dialog-enter-active { transition: opacity 0.2s ease; }
.dialog-leave-active { transition: opacity 0.15s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .update-dialog { transform: scale(0.95) translateY(12px); }
.dialog-leave-to .update-dialog { transform: scale(0.98); }
.update-dialog { transition: transform 0.2s ease; }
</style>
