<script setup>
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import BiliPlayer from './BiliPlayer.vue'
import { X, Maximize, Minimize, Download } from 'lucide-vue-next'
import { ref, watch, computed } from 'vue'
import { downloadVideo } from '../api'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const containerRef = ref(null)
const isFullscreen = ref(false)
const isMaximized = ref(false)
const showSizeMenu = ref(false)
const isDownloading = ref(false)

// 显示标题：优先 MV 标题，回退歌曲名
const displayTitle = computed(() => {
    return playerStore.currentMvTitle || playerStore.currentSong?.name || '视频'
})

// 根据 URL 自动判断 BiliPlayer 的 playType（优先使用 playerStore 的显式提示）
const biliPlayType = computed(() => {
    // 显式类型优先（直播流等无标准后缀的场景）
    if (playerStore.currentMvPlayType) return playerStore.currentMvPlayType
    const url = playerStore.currentMvUrl || ''
    if (/\.flv(\?|$)/i.test(url)) return 'flv'
    if (/\.m3u8(\?|$)/i.test(url)) return 'm3u8'
    if (url.startsWith('local-file://') || url.startsWith('file://')) return 'direct'
    // 无扩展名但含 live/stream 关键词视为直播
    if (/live|stream|rtmp/i.test(url) && !/\.(mp4|webm|mkv|avi|mov)(\?|$)/i.test(url)) return 'live'
    return 'direct'
})

const close = () => {
    if (isFullscreen.value) {
        document.exitFullscreen().catch(() => {})
        isFullscreen.value = false
    }
    playerStore.showMvPlayer = false
    playerStore.currentMvUrl = ''
    playerStore.currentMvId = null
    playerStore.currentMvTitle = ''
    playerStore.currentMvAudioUrl = ''
    playerStore.currentMvPlayType = ''
}

// 下载当前 MV
const handleDownload = async () => {
    if (!playerStore.currentMvUrl) {
        messageStore.warning('暂无可下载的视频地址')
        return
    }
    if (isDownloading.value) {
        messageStore.info('正在下载中，请稍候...')
        return
    }
    isDownloading.value = true
    try {
        const name = displayTitle.value || playerStore.currentSong?.name || 'MV'
        const params = {
            url: playerStore.currentMvUrl,
            name,
            type: /\.m3u8(\?|$)/i.test(playerStore.currentMvUrl) ? 'm3u8' : undefined,
            category: 'mv'
        }
        // DASH 音视频分离流：传递 audioUrl 让后端用 ffmpeg 合并
        if (playerStore.currentMvAudioUrl) params.audioUrl = playerStore.currentMvAudioUrl
        const result = await downloadVideo(params)
        if (result?.success) {
            messageStore.success(`已保存到：${result.path}`, 4000)
        } else if (result?.canceled) {
            // 用户取消保存对话框
        } else {
            messageStore.error('下载失败：' + (result?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('下载失败：' + (e.message || e))
    } finally {
        isDownloading.value = false
    }
}

// 程序全屏（在窗口内最大化，不覆盖任务栏）
const enterAppFullscreen = () => {
    isMaximized.value = true
    isFullscreen.value = false
    showSizeMenu.value = false
}

// 屏幕全屏（Electron 窗口全屏，覆盖整个显示器）
const enterScreenFullscreen = async () => {
    const bridge = window.bridge || window.__ELECTRON_BRIDGE__
    if (bridge?.setWindowFullscreen) {
        await bridge.setWindowFullscreen()
    }
    isFullscreen.value = true
    isMaximized.value = false
    showSizeMenu.value = false
}

// 退出全屏/最大化
const exitFullscreen = async () => {
    if (isFullscreen.value) {
        const bridge = window.bridge || window.__ELECTRON_BRIDGE__
        if (bridge?.exitWindowFullscreen) {
            await bridge.exitWindowFullscreen()
        }
        isFullscreen.value = false
    }
    isMaximized.value = false
    showSizeMenu.value = false
}

const onSizeBtnClick = () => {
    if (isFullscreen.value || isMaximized.value) {
        exitFullscreen()
    } else {
        showSizeMenu.value = !showSizeMenu.value
    }
}

const closeSizeMenu = () => {
    showSizeMenu.value = false
}

const onContainerClick = (e) => {
    const wrap = e.currentTarget.querySelector('.size-toggle-wrap')
    if (wrap && wrap.contains(e.target)) return
    if (showSizeMenu.value) showSizeMenu.value = false
}

watch(() => playerStore.showMvPlayer, (val) => {
    if (val) {
        isMaximized.value = false
        isFullscreen.value = false
        showSizeMenu.value = false
    }
})
</script>

<template>
  <div v-if="playerStore.showMvPlayer" class="mv-player-overlay">
    <div
      class="mv-container"
      :class="{ maximized: isMaximized, 'screen-full': isFullscreen }"
      ref="containerRef"
      @click="onContainerClick"
    >
      <!-- 顶部标题栏 -->
      <div class="mv-top-bar" style="-webkit-app-region: drag;">
        <span class="mv-title" style="-webkit-app-region: no-drag;" :title="displayTitle">
          MV - {{ displayTitle }}
        </span>
        <div class="top-right-btns" style="-webkit-app-region: no-drag;">
          <span class="size-hint" v-if="isMaximized && !isFullscreen">已放大</span>

          <!-- 下载按钮 -->
          <div class="ctrl-btn download-btn" :class="{ active: isDownloading }" @click.stop="handleDownload" :title="isDownloading ? '正在下载...' : '下载此 MV'">
            <Download :size="18" />
            <span v-if="isDownloading" class="dl-spin"></span>
          </div>

          <!-- 放大模式选择 -->
          <div class="size-toggle-wrap">
            <div class="ctrl-btn size-toggle" @click.stop="onSizeBtnClick" :title="isFullscreen || isMaximized ? '退出全屏' : '放大'">
              <Minimize v-if="isMaximized && !isFullscreen" :size="18" />
              <Maximize v-else :size="18" />
            </div>
            <div v-if="showSizeMenu && !isFullscreen && !isMaximized" class="size-menu" @click.stop>
              <div class="size-menu-item" @click.stop="enterAppFullscreen">
                <Maximize :size="14" />
                <span>程序全屏</span>
                <small>在窗口内最大化</small>
              </div>
              <div class="size-menu-item" @click.stop="enterScreenFullscreen">
                <Maximize :size="14" />
                <span>屏幕全屏</span>
                <small>覆盖整个屏幕</small>
              </div>
            </div>
          </div>

          <X class="close-btn" @click="close" :size="24" title="关闭 (Esc)" />
        </div>
      </div>

      <!-- 统一使用 BiliPlayer 播放 -->
      <div class="video-wrapper" @click="closeSizeMenu">
        <BiliPlayer
          :src="playerStore.currentMvUrl"
          :playType="biliPlayType"
          :audioUrl="playerStore.currentMvAudioUrl"
          :autoplay="true"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-player-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.92);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
}

.mv-container {
  width: 80%;
  max-width: 1100px;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 50px rgba(0,0,0,0.5);
  position: relative;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
}

.mv-container.maximized {
  width: 95%;
  max-width: 95%;
  height: 95vh;
  border-radius: 8px;
}

.mv-container.maximized .video-wrapper {
  flex: 1;
  min-height: 0;
}

.mv-container.screen-full {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  border-radius: 0 !important;
  z-index: 99999 !important;
  margin: 0 !important;
}

.mv-container.screen-full .video-wrapper {
  flex: 1;
  min-height: 0;
}

.mv-top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 12px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
  z-index: 20;
  transition: opacity 0.3s;
  pointer-events: none;
}

.mv-top-bar > * {
  pointer-events: auto;
}

.top-right-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mv-title {
  font-size: 15px;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.size-hint {
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  background: rgba(255,255,255,0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.close-btn {
  cursor: pointer;
  color: white;
  opacity: 0.85;
  transition: opacity 0.2s;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
}

.close-btn:hover {
  opacity: 1;
}

.ctrl-btn {
  color: white;
  opacity: 0.85;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.ctrl-btn:hover {
  opacity: 1;
  background: rgba(255,255,255,0.15);
}

.size-toggle-wrap {
  position: relative;
}

.download-btn.active {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}

.dl-spin {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(245, 158, 11, 0.3);
  border-top-color: #f59e0b;
  border-radius: 50%;
  animation: dlSpin 0.8s linear infinite;
  margin-left: 4px;
  display: inline-block;
}

@keyframes dlSpin {
  to { transform: rotate(360deg); }
}

.size-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  background: rgba(30, 30, 30, 0.95);
  border-radius: 8px;
  padding: 6px 0;
  min-width: 160px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  backdrop-filter: blur(10px);
  animation: menuFadeIn 0.15s ease;
  z-index: 30;
}

@keyframes menuFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.size-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  cursor: pointer;
  color: rgba(255,255,255,0.85);
  transition: all 0.12s;
}

.size-menu-item:hover {
  background: rgba(255,255,255,0.1);
  color: white;
}

.size-menu-item span {
  font-size: 13px;
  flex: 1;
}

.size-menu-item small {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
}

.video-wrapper {
  width: 100%;
  aspect-ratio: 16/9;
  background: #000;
  position: relative;
}

/* 让 BiliPlayer 填满容器，不保留默认 16:9 比例 */
.video-wrapper :deep(.bili-player) {
  aspect-ratio: auto !important;
  height: 100% !important;
}

/* Responsive */
@media (max-width: 768px) {
  .mv-container {
    width: 100%;
    height: 100%;
    max-width: none;
    border-radius: 0;
  }
  .mv-container.maximized {
    width: 100%;
    height: 100%;
    border-radius: 0;
  }
}
</style>
