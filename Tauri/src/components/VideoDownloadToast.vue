<script setup>
// 全局视频下载进度浮窗
// - 监听主进程的 video-download-progress / done / error 事件
// - 多任务并行展示，可取消
import { ref, onMounted, onUnmounted } from 'vue'
import { Download, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-vue-next'
import { onVideoDownloadProgress, onVideoDownloadStarted, onVideoDownloadDone, onVideoDownloadError, cancelVideoDownload } from '../api'
import { useMessageStore } from '../store/message'

const messageStore = useMessageStore()

// downloadId -> { id, name, path, percent, received, total, speed, status, currentTime }
const tasks = ref({})
const collapsed = ref(false)

let unsubStarted = null
let unsubProgress = null
let unsubDone = null
let unsubError = null

const formatBytes = (b) => {
    if (!b && b !== 0) return ''
    if (b < 1024) return b + ' B'
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

const formatSpeed = (bps) => {
    if (!bps) return ''
    return formatBytes(bps) + '/s'
}

const formatTime = (s) => {
    if (!s && s !== 0) return ''
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

const taskList = () => Object.values(tasks.value)

const removeTask = (id) => {
    delete tasks.value[id]
}

const onCancel = async (id) => {
    try {
        await cancelVideoDownload(id)
    } catch (e) {}
    delete tasks.value[id]
}

onMounted(() => {
    // 监听 started 事件：立即在浮窗显示任务（防止快速下载完成前看不到）
    unsubStarted = onVideoDownloadStarted((data) => {
        if (!data?.downloadId) return
        tasks.value[data.downloadId] = {
            id: data.downloadId,
            name: data.name || '',
            status: 'downloading',
            percent: 0,
            category: data.category
        }
    })
    unsubProgress = onVideoDownloadProgress((data) => {
        if (!data?.downloadId) return
        const existing = tasks.value[data.downloadId] || { id: data.downloadId, name: '', status: 'downloading' }
        tasks.value[data.downloadId] = { ...existing, ...data, status: 'downloading' }
    })
    unsubDone = onVideoDownloadDone((data) => {
        if (!data?.downloadId) return
        const t = tasks.value[data.downloadId]
        if (t) {
            t.status = 'done'
            t.percent = 100
            if (data.speed) t.speed = data.speed
        }
        // 用事件中的 name 兜底（防止快速下载时 task 还没建立）
        const name = t?.name || data.name || ''
        messageStore.success(`下载完成：${name}`, 3500)
        // 5 秒后自动移除
        setTimeout(() => removeTask(data.downloadId), 5000)
    })
    unsubError = onVideoDownloadError((data) => {
        if (!data?.downloadId) return
        const t = tasks.value[data.downloadId]
        if (t) {
            t.status = 'error'
            t.error = data.error
        }
    })
})

onUnmounted(() => {
    unsubStarted?.()
    unsubProgress?.()
    unsubDone?.()
    unsubError?.()
})
</script>

<template>
    <div v-if="taskList().length > 0" class="vdl-container" :class="{ collapsed }">
        <div class="vdl-header" @click="collapsed = !collapsed">
            <div class="vdl-title">
                <Download :size="14" />
                <span>下载 ({{ taskList().length }})</span>
            </div>
            <div class="vdl-actions">
                <X :size="14" class="clickable" @click.stop="tasks = {}" title="清空列表" />
            </div>
        </div>
        <div v-show="!collapsed" class="vdl-list">
            <div
                v-for="t in taskList()"
                :key="t.id"
                class="vdl-item"
                :class="t.status"
            >
                <div class="vdl-item-info">
                    <div class="vdl-item-name" :title="t.name">{{ t.name || '下载内容' }}</div>
                    <div class="vdl-item-meta">
                        <span v-if="t.status === 'done'" class="meta-done">
                            <CheckCircle2 :size="11" /> 已完成
                            <span v-if="t.speed" style="margin-left: 4px; color: #888;">{{ formatSpeed(t.speed) }}</span>
                        </span>
                        <span v-else-if="t.status === 'error'" class="meta-error">
                            <AlertCircle :size="11" /> {{ t.error || '失败' }}
                        </span>
                        <template v-else>
                            <Loader2 :size="11" class="spin" />
                            <span v-if="t.percent !== undefined && t.total">{{ t.percent.toFixed(1) }}%</span>
                            <span v-if="t.received !== undefined && t.total">{{ formatBytes(t.received) }} / {{ formatBytes(t.total) }}</span>
                            <span v-else-if="t.currentTime !== undefined">已录 {{ formatTime(t.currentTime) }}</span>
                            <span v-if="t.speed">{{ formatSpeed(t.speed) }}</span>
                        </template>
                    </div>
                </div>
                <div class="vdl-item-actions">
                    <div v-if="t.status === 'downloading'" class="vdl-cancel clickable" @click="onCancel(t.id)" title="取消">
                        <X :size="14" />
                    </div>
                    <div v-else class="vdl-remove clickable" @click="removeTask(t.id)" title="移除">
                        <X :size="14" />
                    </div>
                </div>
                <!-- 进度条 -->
                <div class="vdl-progress" v-if="t.status === 'downloading'">
                    <div
                        class="vdl-progress-fill"
                        :style="{ width: (t.percent !== undefined ? t.percent : (t.currentTime ? 30 : 0)) + '%' }"
                    ></div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.vdl-container {
    position: fixed;
    right: 20px;
    bottom: 80px;
    width: 320px;
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    z-index: 9000;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.06);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.vdl-header {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #f8f9fa, #eef0f2);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid #eee;
}

.vdl-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #1a1a2e;
}

.vdl-actions {
    color: #999;
    cursor: pointer;
}

.vdl-actions :deep(svg) {
    display: block;
}

.vdl-list {
    max-height: 280px;
    overflow-y: auto;
    padding: 4px;
}

.vdl-item {
    padding: 8px 10px 10px;
    border-radius: 8px;
    position: relative;
    transition: background 0.15s;
    overflow: hidden;
}

.vdl-item:hover {
    background: #f9f9fb;
}

.vdl-item.error {
    background: rgba(239, 68, 68, 0.04);
}

.vdl-item.done {
    background: rgba(34, 197, 94, 0.04);
}

.vdl-item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 22px;
}

.vdl-item-name {
    font-size: 12px;
    color: #1a1a2e;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vdl-item-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #888;
    flex-wrap: wrap;
}

.vdl-item-meta .spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.meta-done {
    color: #22c55e;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 500;
}

.meta-error {
    color: #ef4444;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 500;
}

.vdl-item-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    color: #999;
}

.vdl-cancel:hover,
.vdl-remove:hover {
    color: #ef4444;
}

.vdl-progress {
    margin-top: 6px;
    height: 3px;
    background: #eee;
    border-radius: 2px;
    overflow: hidden;
}

.vdl-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--primary-color, #ec4141), #ff6b6b);
    border-radius: 2px;
    transition: width 0.3s ease;
}

.vdl-container.collapsed {
    width: 180px;
}

.vdl-container.collapsed .vdl-list {
    display: none;
}
</style>
