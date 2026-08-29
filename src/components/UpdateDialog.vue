<script setup>
import { ref } from 'vue'
import { useMessageStore } from '../store/message'
import { X, Download, Sparkles } from 'lucide-vue-next'

const props = defineProps({
    visible: Boolean,
    version: String,
    notes: String,
    downloadUrl: String
})
const emit = defineEmits(['close'])
const messageStore = useMessageStore()

const downloading = ref(false)

// 直接走应用统一下载管理器（下载页"文档"分类，不跳浏览器）
const handleDownload = async () => {
    if (downloading.value) return
    downloading.value = true
    try {
        const { downloadStart } = await import('../api')
        const fileName = (props.downloadUrl || '').split('?')[0].split('/').pop()
        await downloadStart({
            url: props.downloadUrl,
            name: fileName || undefined,
            category: 'document'
        })
        messageStore.success('安装包已加入下载列表')
        setTimeout(() => emit('close'), 1200)
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || '未知错误'))
        downloading.value = false
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
            {{ downloading ? '已加入下载列表' : '立即下载' }}
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
  width: min(680px, 92vw);
  max-height: 78vh;
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
  padding: 22px 28px 18px;
  background: linear-gradient(135deg, #fb7299, #f0567a);
  color: #fff;
}
.header-icon {
  background: rgba(255,255,255,0.22);
  width: 46px; height: 46px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
}
.header-text h2 {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.5px;
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
  line-height: 1.85;
  color: #444;
  scrollbar-width: thin;
}
.dialog-body :deep(p) { margin: 6px 0; }
.dialog-body :deep(ul) { margin: 4px 0 8px; padding-left: 4px; }
.dialog-body :deep(h4:first-child) { margin-top: 0; }
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
.btn-skip:hover { background: #f5f5f5; color: #666; border-color: #ccc; }
.btn-download {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 24px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #fb7299, #f0567a);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-download:hover { box-shadow: 0 4px 20px rgba(251,114,153,0.45); transform: translateY(-1px); }
.btn-download.loading { opacity: 0.7; pointer-events: none; }

.dialog-enter-active { transition: opacity 0.2s ease; }
.dialog-leave-active { transition: opacity 0.15s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .update-dialog { transform: scale(0.95) translateY(12px); }
.dialog-leave-to .update-dialog { transform: scale(0.98); }
.update-dialog { transition: transform 0.2s ease; }
</style>
