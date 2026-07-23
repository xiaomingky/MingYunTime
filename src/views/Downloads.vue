<script setup>
// 下载专区 —— 统一管理所有下载任务（音乐/影视/动漫/MV/视频）
// 显示：速度、进度、详情信息（名称/类型/链接/保存路径/时间）、状态
// 操作：取消、重试、移除、清空
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
    downloadStart, downloadList, downloadCancel, downloadRemove, downloadClear, downloadRetry,
    onDownloadStarted, onDownloadProgress, onDownloadDone, onDownloadError
} from '../api'
import { useMessageStore } from '../store/message'
import {
    Download, Music, Film, MonitorPlay, Video, X, RefreshCw, Trash2,
    CheckCircle2, AlertCircle, Loader2, Clock, FolderOpen, Link2, Copy
} from 'lucide-vue-next'

const messageStore = useMessageStore()

// 所有下载记录：id -> record
const tasks = ref({})
const activeFilter = ref('all') // all | downloading | done | error | canceled
const categoryFilter = ref('all') // all | music | movie | anime | mv | video
const expandedId = ref(null) // 展开详情的记录 id
const customUrl = ref('')   // 自定义下载链接
const customName = ref('')  // 自定义文件名

// 分类配置
const categoryConfig = {
    music:  { label: '音乐', icon: Music, color: '#ec4141' },
    movie:  { label: '影视', icon: Film, color: '#8b5cf6' },
    anime:  { label: '动漫', icon: MonitorPlay, color: '#3b82f6' },
    mv:     { label: 'MV',   icon: Video, color: '#f59e0b' },
    video:  { label: '视频', icon: Video, color: '#10b981' }
}

// 状态配置
const statusConfig = {
    pending:     { label: '等待中', color: '#888' },
    downloading: { label: '下载中', color: '#3b82f6' },
    done:        { label: '已完成', color: '#22c55e' },
    error:       { label: '失败',   color: '#ef4444' },
    canceled:    { label: '已取消', color: '#999' },
    interrupted: { label: '已中断', color: '#f59e0b' }
}

let unsubStarted = null, unsubProgress = null, unsubDone = null, unsubError = null

// 过滤后的列表
const filteredTasks = computed(() => {
    let list = Object.values(tasks.value)
    if (activeFilter.value !== 'all') {
        list = list.filter(t => t.status === activeFilter.value)
    }
    if (categoryFilter.value !== 'all') {
        list = list.filter(t => t.type === categoryFilter.value)
    }
    return list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
})

// 统计
const stats = computed(() => {
    const all = Object.values(tasks.value)
    return {
        total: all.length,
        downloading: all.filter(t => t.status === 'downloading' || t.status === 'pending').length,
        done: all.filter(t => t.status === 'done').length,
        error: all.filter(t => t.status === 'error' || t.status === 'canceled' || t.status === 'interrupted').length
    }
})

// 格式化
const formatBytes = (b) => {
    if (!b && b !== 0) return '-'
    if (b < 1024) return b + ' B'
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

const formatSpeed = (bps) => {
    if (!bps) return '-'
    return formatBytes(bps) + '/s'
}

const formatTime = (s) => {
    if (!s && s !== 0) return '-'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

const formatDate = (ts) => {
    if (!ts) return '-'
    const d = new Date(ts)
    const pad = (n) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const formatDuration = (ms) => {
    if (!ms) return '-'
    const sec = Math.floor(ms / 1000)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h > 0) return `${h}h${m}m`
    if (m > 0) return `${m}m${s}s`
    return `${s}s`
}

// ETA 估算
const eta = (t) => {
    if (t.status !== 'downloading') return '-'
    if (!t.speed || !t.total || t.received >= t.total) return '-'
    const remain = t.total - t.received
    const sec = remain / t.speed
    if (sec > 3600) return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
    if (sec > 60) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60)}s`
    return `${Math.floor(sec)}s`
}

// 操作
const onCancel = async (id) => {
    try { await downloadCancel(id) } catch (e) {}
}

const onRetry = async (id) => {
    try {
        const res = await downloadRetry(id)
        if (res?.success) {
            messageStore.success('已重新开始下载')
            // 移除旧记录（新记录会通过 started 事件加入）
            delete tasks.value[id]
        } else {
            messageStore.error('重试失败：' + (res?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('重试失败：' + e.message)
    }
}

const onRemove = async (id) => {
    try {
        const res = await downloadRemove(id)
        if (res?.success) {
            delete tasks.value[id]
        } else {
            messageStore.warning(res?.error || '无法移除')
        }
    } catch (e) {}
}

const onClear = async (status) => {
    try {
        const res = await downloadClear(status)
        if (res?.success) {
            // 清除本地对应记录
            for (const [id, t] of Object.entries(tasks.value)) {
                if (t.status !== 'downloading' && t.status !== 'pending') {
                    if (!status || t.status === status) delete tasks.value[id]
                }
            }
            messageStore.success(`已清除 ${res.cleared || 0} 条记录`)
        }
    } catch (e) {}
}

const openFolder = (p) => {
    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge
    if (bridge?.openPath) {
        // 打开文件所在目录
        const dir = p.replace(/[/\\][^/\\]+$/, '')
        bridge.openPath(dir)
    }
}

// 复制文本到剪贴板
const copyText = async (text, label) => {
    if (!text) return
    try {
        await navigator.clipboard.writeText(text)
        messageStore.success(`${label || '内容'}已复制`, 2000)
    } catch (e) {
        // fallback
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); messageStore.success(`${label || '内容'}已复制`, 2000) } catch (er) {}
        document.body.removeChild(ta)
    }
}

const toggleExpand = (id) => {
    expandedId.value = expandedId.value === id ? null : id
}

// 从 URL 自动提取文件名
const deriveNameFromUrl = (url) => {
    try {
        const u = new URL(url)
        const pathname = u.pathname
        const last = pathname.split('/').filter(Boolean).pop() || ''
        // 去掉扩展名后的文件名
        const name = last.replace(/\.\w+$/, '')
        if (name && name.length > 0 && name.length <= 100) return decodeURIComponent(name)
    } catch (e) {}
    return ''
}

// 自定义链接下载
const startCustomDownload = async () => {
    const url = customUrl.value.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
        messageStore.error('请输入有效的 http/https 链接', 3000)
        return
    }
    const name = customName.value.trim() || deriveNameFromUrl(url) || undefined
    try {
        const result = await downloadStart({
            url,
            name,
            category: 'video'
        })
        if (result?.success) {
            messageStore.success('已添加到下载队列', 2000)
            customUrl.value = ''
            customName.value = ''
        } else {
            messageStore.error(result?.error || '下载失败', 3000)
        }
    } catch (e) {
        messageStore.error(e.message || '下载失败', 3000)
    }
}

// URL 变化时自动填充文件名
const onCustomUrlInput = () => {
    // 仅当用户未手动输入文件名时自动填充
    if (!customName.value.trim()) {
        const derived = deriveNameFromUrl(customUrl.value.trim())
        if (derived) customName.value = derived
    }
}

// 加载列表
const loadList = async () => {
    try {
        const res = await downloadList()
        if (res?.success && Array.isArray(res.data)) {
            const map = {}
            for (const item of res.data) {
                map[item.id] = item
            }
            tasks.value = map
        }
    } catch (e) {
        console.error('Load download list failed:', e)
    }
}

onMounted(() => {
    loadList()
    unsubStarted = onDownloadStarted((data) => {
        if (data?.id) tasks.value[data.id] = { ...tasks.value[data.id], ...data }
    })
    unsubProgress = onDownloadProgress((data) => {
        const id = data?.id
        if (!id) return
        const t = tasks.value[id]
        if (t) {
            Object.assign(t, data)
            t.status = t.status || 'downloading'
        }
    })
    unsubDone = onDownloadDone((data) => {
        const id = data?.id
        if (!id) return
        const t = tasks.value[id]
        if (t) {
            t.status = 'done'
            t.percent = 100
            t.path = data.path || t.path
            t.endTime = Date.now()
            if (data.speed) t.speed = data.speed
        }
    })
    unsubError = onDownloadError((data) => {
        const id = data?.id
        if (!id) return
        const t = tasks.value[id]
        if (t) {
            t.status = 'error'
            t.error = data.error
            t.endTime = Date.now()
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
    <div class="downloads-view">
        <!-- 头部 -->
        <div class="view-header">
            <div class="header-left">
                <h1 class="title">
                    <Download :size="22" />
                    下载专区
                </h1>
                <div class="stats-bar">
                    <span class="stat-item" :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">
                        全部 <span class="stat-num">{{ stats.total }}</span>
                    </span>
                    <span class="stat-item downloading" :class="{ active: activeFilter === 'downloading' }" @click="activeFilter = activeFilter === 'downloading' ? 'all' : 'downloading'">
                        <Loader2 v-if="stats.downloading > 0" :size="11" class="spin" />
                        下载中 <span class="stat-num">{{ stats.downloading }}</span>
                    </span>
                    <span class="stat-item done" :class="{ active: activeFilter === 'done' }" @click="activeFilter = activeFilter === 'done' ? 'all' : 'done'">
                        已完成 <span class="stat-num">{{ stats.done }}</span>
                    </span>
                    <span class="stat-item error" :class="{ active: activeFilter === 'error' }" @click="activeFilter = activeFilter === 'error' ? 'all' : 'error'">
                        失败 <span class="stat-num">{{ stats.error }}</span>
                    </span>
                </div>
            </div>
            <div class="actions">
                <button class="action-btn" @click="loadList" title="刷新">
                    <RefreshCw :size="14" />
                </button>
                <button class="action-btn danger" @click="onClear('done')" title="清除已完成">
                    <Trash2 :size="14" />
                    清除已完成
                </button>
            </div>
        </div>

        <!-- 自定义下载链接 -->
        <div class="custom-download-bar">
            <input
                v-model="customUrl"
                type="text"
                class="custom-url-input"
                placeholder="粘贴下载链接（支持 mp4 / m3u8 / mp3 等直链）"
                @input="onCustomUrlInput"
                @keyup.enter="startCustomDownload"
            />
            <input
                v-model="customName"
                type="text"
                class="custom-name-input"
                placeholder="文件名（可选）"
                @keyup.enter="startCustomDownload"
            />
            <button class="custom-download-btn" @click="startCustomDownload" :disabled="!customUrl.trim()">
                <Download :size="14" />
                开始下载
            </button>
        </div>

        <!-- 分类筛选 -->
        <div class="category-bar">
            <span class="cat-item" :class="{ active: categoryFilter === 'all' }" @click="categoryFilter = 'all'">全部类型</span>
            <span v-for="(cfg, key) in categoryConfig" :key="key"
                  class="cat-item" :class="{ active: categoryFilter === key }"
                  @click="categoryFilter = key">
                <component :is="cfg.icon" :size="12" />
                {{ cfg.label }}
            </span>
        </div>

        <!-- 下载列表 -->
        <div class="download-list" v-if="filteredTasks.length > 0">
            <div v-for="t in filteredTasks" :key="t.id"
                 class="download-card"
                 :class="[t.status, { expanded: expandedId === t.id }]">

                <!-- 主行 -->
                <div class="card-main" @click="toggleExpand(t.id)">
                    <!-- 类型图标 -->
                    <div class="card-type-icon" :style="{ background: (categoryConfig[t.type] || {}).color || '#666' }">
                        <component :is="(categoryConfig[t.type] || {}).icon || Video" :size="16" />
                    </div>

                    <!-- 信息 -->
                    <div class="card-info">
                        <div class="card-name-row">
                            <span class="card-name" :title="t.name">{{ t.name || '未命名' }}</span>
                            <span class="card-type-tag">{{ (categoryConfig[t.type] || {}).label || '视频' }}</span>
                        </div>
                        <div class="card-meta-row">
                            <!-- 状态 -->
                            <span class="meta-status" :style="{ color: (statusConfig[t.status] || {}).color || '#888' }">
                                <Loader2 v-if="t.status === 'downloading'" :size="10" class="spin" />
                                <CheckCircle2 v-else-if="t.status === 'done'" :size="10" />
                                <AlertCircle v-else-if="t.status === 'error' || t.status === 'canceled' || t.status === 'interrupted'" :size="10" />
                                <Clock v-else :size="10" />
                                {{ (statusConfig[t.status] || {}).label || t.status }}
                            </span>

                            <!-- 进度百分比 -->
                            <span v-if="t.status === 'downloading' && t.percent !== undefined" class="meta-percent">
                                {{ t.percent.toFixed(1) }}%
                            </span>

                            <!-- 已下载/总大小 -->
                            <span v-if="t.total" class="meta-size">
                                {{ formatBytes(t.received) }} / {{ formatBytes(t.total) }}
                            </span>

                            <!-- 速度（下载中显示实时速度，完成显示平均速度） -->
                            <span v-if="t.status === 'downloading' && t.speed" class="meta-speed">
                                {{ formatSpeed(t.speed) }}
                            </span>
                            <span v-else-if="t.status === 'done' && t.speed" class="meta-duration">
                                平均 {{ formatSpeed(t.speed) }}
                            </span>

                            <!-- ETA -->
                            <span v-if="t.status === 'downloading' && eta(t) !== '-'" class="meta-eta">
                                剩余 {{ eta(t) }}
                            </span>

                            <!-- ffmpeg 进度（已录时长） -->
                            <span v-if="t.status === 'downloading' && t.currentTime && !t.total" class="meta-time">
                                已录 {{ formatTime(t.currentTime) }}
                            </span>

                            <!-- 错误信息 -->
                            <span v-if="t.status === 'error' && t.error" class="meta-error" :title="t.error">
                                {{ t.error }}
                            </span>

                            <!-- 完成耗时 -->
                            <span v-if="t.status === 'done' && t.endTime" class="meta-duration">
                                耗时 {{ formatDuration(t.endTime - t.startTime) }}
                            </span>
                        </div>

                        <!-- 进度条 -->
                        <div class="card-progress" v-if="t.status === 'downloading' || t.status === 'done'">
                            <div class="progress-track">
                                <div class="progress-fill"
                                     :style="{
                                         width: (t.percent !== undefined ? t.percent : (t.currentTime ? 30 : 0)) + '%',
                                         background: t.status === 'done' ? '#22c55e' : 'linear-gradient(90deg, var(--primary-color, #ec4141), #ff6b6b)'
                                     }">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="card-actions" @click.stop>
                        <button v-if="t.status === 'downloading' || t.status === 'pending'" class="action-icon-btn" title="取消" @click="onCancel(t.id)">
                            <X :size="14" />
                        </button>
                        <button v-if="t.status === 'error' || t.status === 'canceled' || t.status === 'interrupted'" class="action-icon-btn retry" title="重试" @click="onRetry(t.id)">
                            <RefreshCw :size="14" />
                        </button>
                        <button v-if="t.status !== 'downloading' && t.status !== 'pending'" class="action-icon-btn danger" title="移除" @click="onRemove(t.id)">
                            <Trash2 :size="14" />
                        </button>
                    </div>
                </div>

                <!-- 展开详情 -->
                <div v-if="expandedId === t.id" class="card-details">
                    <div class="detail-row">
                        <span class="detail-label">下载链接</span>
                        <span class="detail-value link" :title="t.urlMasked || t.url">{{ t.urlMasked || t.url || '-' }}</span>
                        <Copy v-if="t.url" :size="12" class="clickable copy-btn" title="复制链接" @click="copyText(t.url, '下载链接')" />
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">保存路径</span>
                        <span class="detail-value path" :title="t.path">
                            {{ t.path || '-' }}
                            <Copy v-if="t.path" :size="12" class="clickable copy-btn" title="复制路径" @click="copyText(t.path, '保存路径')" />
                            <FolderOpen v-if="t.path" :size="12" class="clickable" @click="openFolder(t.path)" />
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">开始时间</span>
                        <span class="detail-value">{{ formatDate(t.startTime) }}</span>
                    </div>
                    <div class="detail-row" v-if="t.endTime">
                        <span class="detail-label">结束时间</span>
                        <span class="detail-value">{{ formatDate(t.endTime) }}</span>
                    </div>
                    <div class="detail-row" v-if="t.error">
                        <span class="detail-label">错误信息</span>
                        <span class="detail-value error">{{ t.error }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="empty-state">
            <Download :size="56" />
            <p v-if="activeFilter === 'all'">还没有下载任务</p>
            <p v-else>没有符合条件的下载任务</p>
            <p class="empty-hint">在音乐、影视、动漫、MV 页面点击下载按钮，任务会自动出现在这里</p>
        </div>
    </div>
</template>

<style scoped>
.downloads-view {
    padding: 24px 30px;
    flex: 1;
    overflow-y: auto;
    background: var(--bg-main, #f5f5f7);
}

.view-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
}

.header-left {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-width: 0;
}

.title {
    font-size: 22px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    margin: 0;
    text-align: left;
    color: #1a1a2e;
}

.stats-bar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-start;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: #fff;
    border: 1px solid #e8e8e8;
    border-radius: 16px;
    font-size: 12px;
    color: #666;
    cursor: pointer;
    transition: all 0.15s;
    user-select: none;
}

.stat-item:hover { border-color: #ccc; background: #fafafa; }
.stat-item.active { border-color: var(--primary-color, #c20c0c); color: var(--primary-color, #c20c0c); background: rgba(194, 12, 12, 0.05); }

.stat-item.downloading.active { border-color: #3b82f6; color: #3b82f6; background: rgba(59, 130, 246, 0.05); }
.stat-item.done.active { border-color: #22c55e; color: #22c55e; background: rgba(34, 197, 94, 0.05); }
.stat-item.error.active { border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.05); }

.stat-num {
    font-weight: 600;
    font-size: 11px;
}

.actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 12px;
    color: #555;
    cursor: pointer;
    transition: all 0.15s;
}

.action-btn:hover { background: #f5f5f5; border-color: #ccc; }
.action-btn.danger:hover { color: #ef4444; border-color: #ef4444; }

/* 自定义下载栏 */
.custom-download-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 18px;
    align-items: center;
}

.custom-url-input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
    background: #fff;
}

.custom-url-input:focus { border-color: var(--primary-color, #c20c0c); }

.custom-name-input {
    width: 180px;
    flex-shrink: 0;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
    background: #fff;
}

.custom-name-input:focus { border-color: var(--primary-color, #c20c0c); }

.custom-download-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--primary-color, #c20c0c);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.2s;
    flex-shrink: 0;
}

.custom-download-btn:hover { opacity: 0.9; }
.custom-download-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.category-bar {
    display: flex;
    gap: 6px;
    margin-bottom: 18px;
    flex-wrap: wrap;
}

.cat-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    color: #888;
    cursor: pointer;
    background: transparent;
    transition: all 0.15s;
    user-select: none;
}

.cat-item:hover { background: #fff; color: #555; }
.cat-item.active { background: #fff; color: var(--primary-color, #c20c0c); font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }

.download-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 1000px;
}

.download-card {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.15s;
}

.download-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.05); border-color: #e0e0e0; }
.download-card.downloading { border-left: 3px solid #3b82f6; }
.download-card.done { border-left: 3px solid #22c55e; }
.download-card.error { border-left: 3px solid #ef4444; }
.download-card.canceled { border-left: 3px solid #999; }
.download-card.interrupted { border-left: 3px solid #f59e0b; }

.card-main {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    cursor: pointer;
}

.card-type-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    flex-shrink: 0;
}

.card-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.card-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.card-name {
    font-size: 13px;
    font-weight: 500;
    color: #1a1a2e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
}

.card-type-tag {
    font-size: 10px;
    background: #f0f0f0;
    color: #666;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
}

.card-meta-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: #888;
    flex-wrap: wrap;
}

.meta-status {
    display: flex;
    align-items: center;
    gap: 3px;
    font-weight: 500;
}

.meta-percent { color: #3b82f6; font-weight: 600; }
.meta-speed { color: #ec4141; font-weight: 500; }
.meta-eta { color: #888; }
.meta-time { color: #3b82f6; }
.meta-error { color: #ef4444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.meta-duration { color: #22c55e; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.card-progress {
    margin-top: 2px;
    width: 100%;
}

.progress-track {
    height: 4px;
    background: #eee;
    border-radius: 2px;
    overflow: hidden;
    width: 100%;
    position: relative;
}

.progress-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    border-radius: 2px;
    transition: width 0.3s ease;
    max-width: 100%;
}

.card-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.action-icon-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid #e5e5e5;
    background: #fff;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}

.action-icon-btn:hover { background: #f5f5f5; color: #333; }
.action-icon-btn.retry:hover { color: #3b82f6; border-color: #3b82f6; }
.action-icon-btn.danger:hover { color: #ef4444; border-color: #ef4444; }

/* 详情展开 */
.card-details {
    padding: 0 14px 12px 62px;
    border-top: 1px solid #f5f5f5;
    background: #fafafb;
}

.detail-row {
    display: flex;
    gap: 12px;
    padding: 6px 0;
    font-size: 11px;
    align-items: flex-start;
}

.detail-label {
    color: #999;
    width: 70px;
    flex-shrink: 0;
}

.detail-value {
    color: #555;
    word-break: break-all;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
}

.detail-value.link { color: #3b82f6; }
.detail-value.path { color: #666; }
.detail-value.error { color: #ef4444; }
.detail-value .clickable { color: #3b82f6; cursor: pointer; }
.detail-value .clickable:hover { color: var(--primary-color, #c20c0c); }
.detail-value .copy-btn { flex-shrink: 0; opacity: 0.6; transition: opacity 0.15s; }
.detail-value .copy-btn:hover { opacity: 1; }

/* 空状态 */
.empty-state {
    text-align: center;
    padding: 80px 20px;
    color: #bbb;
}

.empty-state p {
    margin: 10px 0;
    font-size: 14px;
    color: #999;
}

.empty-hint {
    font-size: 12px !important;
    color: #bbb !important;
    margin-top: 6px !important;
}
</style>
