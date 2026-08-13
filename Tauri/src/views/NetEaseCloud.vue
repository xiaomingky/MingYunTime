<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { Play, Music, RefreshCw, GripVertical, Download, Trash2, Upload, Search, HardDrive, X, Image as ImageIcon, Link2, Unlink, Search as SearchIcon } from 'lucide-vue-next'
import { getUserCloud, deleteUserCloud, getSongUrl, matchCloud, cloudSearch, API_LINES } from '../api'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { useUserStore } from '../store/user'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const userStore = useUserStore()

const allSongs = ref([])
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadFileName = ref('')
const uploadStatus = ref('')
const searchKeyword = ref('')
const cloudCount = ref(0)

// 上传对话框：支持单文件/批量上传
const showUploadDialog = ref(false)
const pendingFiles = ref([])            // 文件列表 [{ filePath, fileName, title, artist, album, cover, lyrics }]
const dialogParsing = ref(false)
const dialogSubmitting = ref(false)
const isBatchMode = computed(() => pendingFiles.value.length > 1)

// 单文件模式下绑定到第一个文件
const pendingTitle = computed({
    get: () => pendingFiles.value[0]?.title || '',
    set: (v) => { if (pendingFiles.value[0]) pendingFiles.value[0].title = v }
})
const pendingArtist = computed({
    get: () => pendingFiles.value[0]?.artist || '',
    set: (v) => { if (pendingFiles.value[0]) pendingFiles.value[0].artist = v }
})
const pendingAlbum = computed({
    get: () => pendingFiles.value[0]?.album || '',
    set: (v) => { if (pendingFiles.value[0]) pendingFiles.value[0].album = v }
})
const pendingCover = computed({
    get: () => pendingFiles.value[0]?.cover || '',
    set: (v) => { if (pendingFiles.value[0]) pendingFiles.value[0].cover = v }
})
const pendingLyrics = computed({
    get: () => pendingFiles.value[0]?.lyrics || '',
    set: (v) => { if (pendingFiles.value[0]) pendingFiles.value[0].lyrics = v }
})
const pendingFileName = computed(() => pendingFiles.value[0]?.fileName || '')

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer

const selectCover = async () => {
    const bridge = getBridge()
    if (!bridge?.invoke) return
    const dataUrl = await bridge.invoke('open-cover-dialog')
    if (dataUrl && pendingFiles.value[0]) pendingFiles.value[0].cover = dataUrl
}

const clearCover = () => { if (pendingFiles.value[0]) pendingFiles.value[0].cover = '' }

// 选择歌词文件（.lrc/.txt）
const selectLyricsFile = async () => {
    const bridge = getBridge()
    if (!bridge?.invoke) return
    const content = await bridge.invoke('open-lyrics-dialog')
    if (content && pendingFiles.value[0]) pendingFiles.value[0].lyrics = content
}

const closeUploadDialog = () => {
    if (dialogSubmitting.value) return
    showUploadDialog.value = false
    pendingFiles.value = []
}

// 从文件名推测歌名/歌手（"歌手 - 歌名.mp3" 格式）
const guessFromFilename = (name) => {
    const base = name.replace(/\.[^.]+$/, '')
    const m = base.match(/^(.+?)\s*[-－—]\s*(.+)$/)
    if (m) return { artist: m[1].trim(), title: m[2].trim() }
    return { artist: '', title: base }
}

// 获取当前 API baseURL（传给主进程上传 IPC）
const getCurrentApiBaseUrl = () => {
    const savedKey = localStorage.getItem('api_line')
    if (savedKey) {
        const found = API_LINES.find(l => l.key === savedKey)
        if (found) return found.url
    }
    return API_LINES[0].url
}

// 监听主进程上传进度推送
const offUploadProgress = ref(null)
const setupProgressListener = () => {
    const bridge = getBridge()
    if (bridge?.on) {
        offUploadProgress.value = bridge.on('cloud-upload-progress', (_, { progress, status, filename }) => {
            uploadProgress.value = progress
            uploadStatus.value = status
            uploadFileName.value = filename
        })
    }
}
setupProgressListener()
onUnmounted(() => {
    if (offUploadProgress.value) offUploadProgress.value()
})

// 本地排序顺序（songId -> sortOrder），云盘 API 不支持排序，用 localStorage 保存
const STORAGE_KEY = 'netease_cloud_order'
const loadOrder = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
const saveOrder = (order) => localStorage.setItem(STORAGE_KEY, JSON.stringify(order))

const normalizeSong = (s) => {
    const simple = s.simpleSong || {}
    const ar = simple.ar || simple.artists || []
    const al = simple.al || {}
    return {
        id: s.songId,
        songId: s.songId,
        name: simple.name || s.name || '未知歌曲',
        artist: ar.map(a => a.name).join('/') || s.artist || '未知歌手',
        album: al.name || s.album || '',
        coverUrl: al.picUrl || simple.al?.picUrl || '',
        size: s.size || 0,
        duration: (simple.dt || 0) / 1000,
        al,
        ar,
        dt: simple.dt || 0
    }
}

const fetchSongs = async () => {
    if (!userStore.isLoggedIn) return
    loading.value = true
    try {
        const res = await getUserCloud(1000, 0)
        const list = res.data || []
        cloudCount.value = res.count || list.length
        const order = loadOrder()
        allSongs.value = list.map(normalizeSong)
        // 按本地排序顺序排列（未配置的按原顺序靠后）
        allSongs.value.sort((a, b) => {
            const oa = order[a.id]
            const ob = order[b.id]
            if (oa === undefined && ob === undefined) return 0
            if (oa === undefined) return 1
            if (ob === undefined) return -1
            return oa - ob
        })
    } catch (e) {
        console.error('Fetch netease cloud error:', e)
        messageStore.error('获取云盘失败')
    } finally {
        loading.value = false
    }
}

const filteredSongs = computed(() => {
    if (!searchKeyword.value.trim()) return allSongs.value
    const kw = searchKeyword.value.toLowerCase()
    return allSongs.value.filter(s =>
        s.name.toLowerCase().includes(kw) ||
        s.artist.toLowerCase().includes(kw) ||
        s.album.toLowerCase().includes(kw)
    )
})

const toTrack = (song) => ({
    id: song.songId,
    name: song.name,
    artist: song.artist,
    al: { picUrl: song.coverUrl, name: song.album },
    picUrl: song.coverUrl,
    dt: song.duration * 1000,
    duration: song.duration,
    ar: [{ name: song.artist }]
})

const tracks = computed(() => filteredSongs.value.map(toTrack))

const playSong = (song) => {
    playerStore.playSong(toTrack(song), tracks.value)
}

const handleDelete = async (song) => {
    const confirmed = await messageStore.confirm(`确定从云盘删除《${song.name}》吗？`, '删除云盘歌曲')
    if (!confirmed) return
    try {
        const res = await deleteUserCloud(song.songId)
        if (res.code === 200) {
            messageStore.success('删除成功')
            // 删除后强制重新拉取列表（不依赖本地删除，确保与服务端一致）
            await fetchSongs()
        } else {
            messageStore.error(res.message || res.msg || `删除失败（code: ${res.code}）`)
        }
    } catch (e) {
        console.error('Delete cloud error:', e)
        messageStore.error('删除失败：' + (e.message || '网络异常'))
    }
}

// ============ 歌曲匹配管理 ============
// 每首歌可单独匹配网易云歌曲（asid=歌曲ID）或取消匹配（asid=0）
const showMatchDialog = ref(false)
const matchTargetSong = ref(null)      // 当前操作的歌曲
const matchKeyword = ref('')            // 搜索关键词
const matchResults = ref([])            // 搜索结果
const matchSearching = ref(false)
const matchSubmitting = ref(false)

const selectedMatchId = ref(null)       // 用户选中的网易云歌曲 ID
const selectedMatchSong = ref(null)      // 用户选中的歌曲对象

const openMatchDialog = (song) => {
    matchTargetSong.value = song
    matchKeyword.value = `${song.artist} ${song.name}`.trim()
    matchResults.value = []
    selectedMatchId.value = null
    selectedMatchSong.value = null
    showMatchDialog.value = true
    // 自动搜索一次
    searchNeteaseSongs()
}

const closeMatchDialog = () => {
    if (matchSubmitting.value) return
    showMatchDialog.value = false
    matchTargetSong.value = null
    matchResults.value = []
    matchKeyword.value = ''
    selectedMatchId.value = null
    selectedMatchSong.value = null
}

const searchNeteaseSongs = async () => {
    const kw = matchKeyword.value.trim()
    if (!kw) { matchResults.value = []; return }
    matchSearching.value = true
    selectedMatchId.value = null
    selectedMatchSong.value = null
    try {
        const res = await cloudSearch(kw, 1)
        // cloudsearch 返回 {code:200, result:{songs:[...]}}，axios 拦截器可能拆包，兼容两种
        const songs = res?.result?.songs || res?.songs || []
        matchResults.value = songs.slice(0, 20).map(s => ({
            id: s.id,
            name: s.name,
            artist: (s.ar || []).map(a => a.name).join('/'),
            album: s.al?.name || ''
        }))
        if (matchResults.value.length === 0) {
            console.warn('[match] search empty, raw response:', res)
        }
    } catch (e) {
        console.error('Search netease error:', e)
        messageStore.error('搜索失败：' + (e.message || '网络异常'))
    } finally {
        matchSearching.value = false
    }
}

// 选中搜索结果中的歌曲
const selectMatchItem = (neteaseSong) => {
    selectedMatchId.value = neteaseSong.id
    selectedMatchSong.value = neteaseSong
}

// 确认匹配选中的网易云歌曲
const confirmMatchSong = async () => {
    if (!matchTargetSong.value || !userStore.profile?.userId || !selectedMatchSong.value) return
    matchSubmitting.value = true
    try {
        const res = await matchCloud(
            String(userStore.profile.userId),
            String(matchTargetSong.value.songId),
            String(selectedMatchSong.value.id)
        )
        if (res.code === 200) {
            messageStore.success(`已匹配《${selectedMatchSong.value.name}》，刷新列表中...`)
            showMatchDialog.value = false
            await fetchSongs()
        } else {
            messageStore.error(res.message || res.msg || `匹配失败（code: ${res.code}）`)
        }
    } catch (e) {
        console.error('Match song error:', e)
        messageStore.error('匹配失败：' + (e.message || '网络异常'))
    } finally {
        matchSubmitting.value = false
    }
}

// 取消匹配（asid=0，恢复文件原信息）
const handleUnmatchSong = async (song) => {
    if (!userStore.profile?.userId) return
    const confirmed = await messageStore.confirm(
        `确定取消《${song.name}》的网易云匹配吗？\n取消后将恢复为文件原始信息（歌名/歌手/封面/歌词来自文件元数据）。`,
        '取消匹配'
    )
    if (!confirmed) return
    try {
        const res = await matchCloud(String(userStore.profile.userId), String(song.songId), 0)
        if (res.code === 200) {
            messageStore.success('已取消匹配，刷新列表中...')
            await fetchSongs()
        } else {
            messageStore.error(res.message || res.msg || `取消匹配失败（code: ${res.code}）`)
        }
    } catch (e) {
        console.error('Unmatch song error:', e)
        messageStore.error('取消匹配失败：' + (e.message || '网络异常'))
    }
}

// 选择文件：主进程弹文件对话框（支持多选），再解析元数据预填
const handleUpload = async () => {
    if (!userStore.isLoggedIn) { messageStore.warning('请先登录'); return }
    const bridge = getBridge()
    if (!bridge?.invoke) { messageStore.error('需要在桌面客户端中使用'); return }
    const filePaths = await bridge.invoke('open-cloud-upload-dialog')
    if (!filePaths || filePaths.length === 0) return
    // 构建文件列表
    pendingFiles.value = filePaths.map(fp => {
        const filename = fp.split(/[\\/]/).pop() || fp
        const guess = guessFromFilename(filename)
        return { filePath: fp, fileName: filename, title: guess.title, artist: guess.artist, album: '', cover: '', lyrics: '' }
    })
    showUploadDialog.value = true
    // 批量解析元数据（并行，但有并发限制）
    dialogParsing.value = true
    const PARSE_CONCURRENCY = 3
    for (let i = 0; i < pendingFiles.value.length; i += PARSE_CONCURRENCY) {
        const batch = pendingFiles.value.slice(i, i + PARSE_CONCURRENCY)
        await Promise.all(batch.map(async (f) => {
            try {
                const res = await bridge.invoke('parse-upload-file', f.filePath)
                if (res?.success && res.metadata) {
                    if (res.metadata.title) f.title = res.metadata.title
                    if (res.metadata.artist) f.artist = res.metadata.artist
                    if (res.metadata.album) f.album = res.metadata.album
                    if (res.metadata.coverData) f.cover = res.metadata.coverData
                }
            } catch (err) {
                console.warn('Parse upload file failed:', err)
            }
        }))
    }
    dialogParsing.value = false
}

// 上传后默认取消网易云匹配（asid=0），保持文件原信息，不阻塞、不重试
// 用户可在列表中手动点击"匹配"按钮重新匹配指定网易云歌曲
const cancelMatchAfterUpload = (songId, songName) => {
    if (!userStore.profile?.userId || !songId) return
    const uid = String(userStore.profile.userId)
    const sid = String(songId)
    // 延迟 3s 调用一次，不阻塞后续上传，不弹提示（失败可在列表手动管理）
    setTimeout(async () => {
        try {
            const r = await matchCloud(uid, sid, 0)
            if (r.code === 200) console.log(`[match] 已取消《${songName}》匹配`)
            else console.warn(`[match] 取消《${songName}》匹配返回:`, r.code)
        } catch (e) {
            console.warn(`[match] 取消《${songName}》匹配异常:`, e.message)
        }
    }, 3000)
}

// 对话框确认：逐个写入封面 + 上传
// 上传后默认取消匹配（不阻塞），用户可后续在列表手动匹配
const confirmUpload = async () => {
    if (pendingFiles.value.length === 0) return
    if (dialogSubmitting.value) return
    dialogSubmitting.value = true
    showUploadDialog.value = false
    uploading.value = true
    const bridge = getBridge()
    const total = pendingFiles.value.length
    let successCount = 0
    let failCount = 0
    for (let i = 0; i < total; i++) {
        const f = pendingFiles.value[i]
        uploadProgress.value = 0
        uploadFileName.value = f.fileName
        uploadStatus.value = `(${i + 1}/${total}) 上传中...`
        try {
            // 直接上传原文件（不写入封面/歌词，保持官方原版流程）
            // song/artist/album 从文件元数据解析，传给 complete 接口
            const uploadRes = await bridge.invoke('cloud-upload', {
                filePath: f.filePath,
                filename: f.fileName,
                cookie: userStore.cookie,
                apiBaseUrl: getCurrentApiBaseUrl(),
                song: f.title,
                artist: f.artist,
                album: f.album
            })
            if (uploadRes?.success) {
                successCount++
                if (uploadRes.needUpload === false) {
                    messageStore.warning(`《${f.title || f.fileName}》秒传成功（服务器已存在相同文件，可能覆盖之前同内容歌曲）`)
                } else {
                    messageStore.success(`《${f.title || f.fileName}》上传成功`)
                }
                // 默认取消网易云匹配（非阻塞，3s 后单次调用）
                cancelMatchAfterUpload(uploadRes.songId, f.title || f.fileName)
            } else {
                failCount++
                messageStore.error(`《${f.fileName}》上传失败：${uploadRes?.error || '未知错误'}`)
            }
        } catch (e) {
            console.error('Upload cloud error:', e)
            failCount++
            messageStore.error(`《${f.fileName}》上传失败：${e.message || '网络异常'}`)
        }
    }
    // 汇总
    if (total > 1) {
        if (failCount === 0) {
            messageStore.success(`全部 ${successCount} 首歌曲上传成功`)
        } else {
            messageStore.warning(`上传完成：成功 ${successCount} 首，失败 ${failCount} 首`)
        }
    }
    // 延迟刷新列表（服务器处理需要时间，多次渐进刷新确保数据同步）
    // 立即刷新一次 + 渐进延迟（服务器处理上传数据可能需要 30-60s）
    fetchSongs()
    setTimeout(() => { fetchSongs() }, 5000)
    setTimeout(() => { fetchSongs() }, 15000)
    setTimeout(() => { fetchSongs() }, 30000)
    setTimeout(() => { fetchSongs() }, 60000)
    dialogSubmitting.value = false
    uploading.value = false
    uploadProgress.value = 0
    uploadFileName.value = ''
    uploadStatus.value = ''
    pendingFiles.value = []
}

const handleDownload = async (song) => {
    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
    try {
        const res = await getSongUrl(song.songId, 'exhigh')
        const url = res.data?.[0]?.url
        if (!url) {
            messageStore.error('无法获取下载地址，可能需要登录')
            return
        }
        if (bridge && bridge.invoke) {
            const r = await bridge.invoke('download-song', {
                url,
                name: song.name,
                artist: song.artist,
                picUrl: song.coverUrl
            })
            if (r && r.success) {
                messageStore.success('开始下载')
            } else if (r && !r.canceled) {
                messageStore.error(`下载失败：${r.error || '未知错误'}`)
            }
        } else {
            const link = document.createElement('a')
            link.href = url
            link.download = `${song.artist} - ${song.name}.mp3`
            link.target = '_blank'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        }
    } catch (e) {
        console.error('Download cloud error:', e)
        messageStore.error('下载失败，请稍后重试')
    }
}

// 拖拽排序（本地保存）
const dragFromIndex = ref(-1)
const dragOverIndex = ref(-1)
const resetDrag = () => {
    dragFromIndex.value = -1
    dragOverIndex.value = -1
}

const onDragStart = (index, e) => {
    dragFromIndex.value = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
}

const onDragOver = (index, e) => {
    e.preventDefault()
    dragOverIndex.value = index
}

const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
        dragOverIndex.value = -1
    }
}

const onDrop = (index, e) => {
    e.preventDefault()
    const from = dragFromIndex.value
    if (from === -1 || from === index) { resetDrag(); return }
    const visible = [...filteredSongs.value]
    const [moved] = visible.splice(from, 1)
    visible.splice(index, 0, moved)
    // 重新计算全量顺序
    const newOrder = {}
    let orderIdx = 0
    visible.forEach(s => { newOrder[s.id] = orderIdx++ })
    allSongs.value.forEach(s => {
        if (!(s.id in newOrder)) newOrder[s.id] = orderIdx++
    })
    saveOrder(newOrder)
    allSongs.value.sort((a, b) => (newOrder[a.id] ?? 0) - (newOrder[b.id] ?? 0))
    messageStore.success('排序已保存')
    resetDrag()
}

const onDragEnd = () => resetDrag()

const formatDuration = (seconds) => {
    if (!seconds) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const formatSize = (bytes) => {
    if (!bytes) return ''
    const mb = bytes / 1024 / 1024
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

onMounted(() => {
    if (userStore.isLoggedIn) fetchSongs()
})

watch(() => userStore.isLoggedIn, (val) => {
    if (val) fetchSongs()
})

defineExpose({ refreshData: fetchSongs })
</script>

<template>
  <main class="content">
    <div class="content-header">
      <div class="title-row">
        <HardDrive :size="24" />
        <h2>官方云盘</h2>
        <span v-if="cloudCount" class="count-badge">{{ cloudCount }} 首</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn refresh-btn" title="刷新" @click="fetchSongs" :disabled="loading">
          <RefreshCw :size="16" :class="{ spinning: loading }" />
        </button>
        <button class="upload-btn" @click="handleUpload" :disabled="uploading">
          <Upload :size="14" />
          {{ uploading ? '上传中' : '上传歌曲' }}
        </button>
      </div>
    </div>

    <div v-if="uploading" class="upload-float">
      <div class="upload-float-header">
        <span class="upload-float-name" :title="uploadFileName">{{ uploadFileName }}</span>
        <span class="upload-float-percent">{{ uploadProgress }}%</span>
      </div>
      <div class="upload-float-status">{{ uploadStatus }}</div>
      <div class="upload-float-track"><div class="upload-float-fill" :style="{ width: uploadProgress + '%' }"></div></div>
    </div>

    <!-- 上传对话框：单文件可编辑元数据，批量模式显示文件列表 -->
    <div v-if="showUploadDialog" class="dialog-mask" @click.self="closeUploadDialog">
      <div class="upload-dialog">
        <div class="dialog-header">
          <span>上传歌曲{{ isBatchMode ? `（${pendingFiles.length} 首）` : '' }}</span>
          <button class="dialog-close" @click="closeUploadDialog"><X :size="18" /></button>
        </div>
        <div class="dialog-body">
          <div v-if="dialogParsing" class="dialog-parsing">正在解析文件元数据...</div>
          <!-- 批量模式：显示文件列表 -->
          <template v-if="isBatchMode">
            <div class="batch-file-list">
              <div v-for="(f, idx) in pendingFiles" :key="idx" class="batch-file-item">
                <span class="batch-file-name" :title="f.fileName">{{ f.fileName }}</span>
                <span class="batch-file-meta">{{ f.artist }} - {{ f.title }}</span>
              </div>
            </div>
          </template>
          <!-- 单文件模式：可编辑元数据 -->
          <template v-else>
            <div class="form-row">
              <label>歌曲名</label>
              <input v-model="pendingTitle" placeholder="歌曲名" />
            </div>
            <div class="form-row">
              <label>歌手</label>
              <input v-model="pendingArtist" placeholder="歌手" />
            </div>
            <div class="form-row">
              <label>专辑</label>
              <input v-model="pendingAlbum" placeholder="专辑" />
            </div>
          </template>
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="closeUploadDialog">取消</button>
          <button class="confirm-btn" :disabled="dialogSubmitting || dialogParsing" @click="confirmUpload">开始上传</button>
        </div>
      </div>
    </div>

    <!-- 匹配网易云歌曲对话框 -->
    <div v-if="showMatchDialog" class="dialog-mask" @click.self="closeMatchDialog">
      <div class="dialog match-dialog">
        <div class="dialog-header">
          <h3>匹配网易云歌曲</h3>
          <button class="dialog-close" @click="closeMatchDialog"><X :size="18" /></button>
        </div>
        <div class="dialog-body">
          <div class="match-target">
            <span class="match-label">云盘歌曲：</span>
            <span class="match-target-name">{{ matchTargetSong?.name }}</span>
            <span class="match-target-artist"> - {{ matchTargetSong?.artist }}</span>
          </div>
          <div class="search-box match-search">
            <SearchIcon :size="14" />
            <input v-model="matchKeyword" placeholder="搜索要匹配的网易云歌曲" @keyup.enter="searchNeteaseSongs" />
            <button class="search-btn" @click="searchNeteaseSongs" :disabled="matchSearching">搜索</button>
          </div>
          <div v-if="matchSearching" class="match-loading">搜索中...</div>
          <div v-else-if="matchResults.length === 0" class="match-empty">输入关键词搜索网易云歌曲</div>
          <div v-else class="match-results">
            <div
              v-for="r in matchResults"
              :key="r.id"
              class="match-result-item"
              :class="{ active: selectedMatchId === r.id }"
              @click="selectMatchItem(r)"
            >
              <input type="radio" :checked="selectedMatchId === r.id" @click.stop="selectMatchItem(r)" />
              <div class="match-result-info">
                <div class="match-result-name">{{ r.name }}</div>
                <div class="match-result-meta">{{ r.artist }}<span v-if="r.album" class="sep">·</span><span v-if="r.album">{{ r.album }}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="closeMatchDialog">取消</button>
          <button class="confirm-btn" :disabled="!selectedMatchSong || matchSubmitting" @click="confirmMatchSong">
            {{ matchSubmitting ? '匹配中...' : '确认匹配' }}
          </button>
        </div>
      </div>
    </div>

    <div class="scroll-content">
      <div v-if="!userStore.isLoggedIn" class="empty-state">请先登录网易云账号</div>
      <div v-else-if="loading && allSongs.length === 0" class="empty-state">加载中...</div>
      <div v-else-if="allSongs.length === 0" class="empty-state">
        云盘暂无歌曲，点击右上角"上传歌曲"添加
      </div>
      <div v-else>
        <div class="search-box">
          <Search :size="14" />
          <input v-model="searchKeyword" placeholder="搜索云盘歌曲" />
        </div>
        <div v-if="filteredSongs.length === 0" class="empty-state">未找到匹配歌曲</div>
        <div v-else class="song-list">
          <div
            v-for="(song, index) in filteredSongs"
            :key="song.id"
            class="song-row"
            :class="{ dragging: dragFromIndex === index, 'drag-over': dragOverIndex === index && dragFromIndex !== index, playing: playerStore.currentSong.id === song.songId }"
            @dblclick="playSong(song)"
            @dragover.prevent="onDragOver(index, $event)"
            @drop.prevent="onDrop(index, $event)"
            @dragleave="onDragLeave"
          >
            <div class="drag-handle" draggable="true" @dragstart.stop="onDragStart(index, $event)" @dragend.stop="onDragEnd">
              <GripVertical :size="16" />
            </div>
            <img v-if="song.coverUrl" :src="song.coverUrl" class="song-cover" />
            <div v-else class="song-cover placeholder">
              <Music :size="20" />
            </div>
            <div class="song-info">
              <div class="song-name">{{ song.name }}</div>
              <div class="song-meta">
                {{ song.artist }}
                <span v-if="song.album" class="sep">·</span>
                <span v-if="song.album">{{ song.album }}</span>
                <span v-if="song.duration" class="sep">·</span>
                <span v-if="song.duration">{{ formatDuration(song.duration) }}</span>
                <span v-if="song.size" class="sep">·</span>
                <span v-if="song.size" class="size">{{ formatSize(song.size) }}</span>
              </div>
            </div>
            <div class="row-actions">
              <button class="row-btn" @click="playSong(song)" title="播放"><Play :size="16" /></button>
              <button class="row-btn" @click="openMatchDialog(song)" title="匹配网易云歌曲"><Link2 :size="16" /></button>
              <button class="row-btn" @click="handleUnmatchSong(song)" title="取消匹配（恢复文件原信息）"><Unlink :size="16" /></button>
              <button class="row-btn" @click="handleDownload(song)" title="下载"><Download :size="16" /></button>
              <button class="row-btn danger" @click="handleDelete(song)" title="删除"><Trash2 :size="16" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.content {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-main);
}
.content-header {
  padding: 20px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
}
.count-badge {
  font-size: 12px;
  font-weight: 500;
  color: #999;
  background: rgba(0,0,0,0.05);
  padding: 2px 8px;
  border-radius: 10px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.upload-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 20px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.upload-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.upload-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.upload-float {
  position: fixed;
  top: 70px;
  right: 30px;
  width: 280px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 12px 14px;
  z-index: 1000;
}
.upload-float-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.upload-float-name {
  font-size: 12px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.upload-float-percent {
  font-size: 12px;
  color: var(--primary-color);
  font-weight: 600;
  flex-shrink: 0;
}
.upload-float-status {
  font-size: 11px;
  color: #999;
  margin-bottom: 6px;
}
.upload-float-track {
  height: 4px;
  background: rgba(0,0,0,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.upload-float-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff6b6b, var(--primary-color));
  transition: width 0.2s;
}

/* 上传预填对话框 */
.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.upload-dialog {
  width: 460px;
  max-height: 85vh;
  background: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0,0,0,0.2);
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.dialog-close {
  border: none;
  background: none;
  color: #999;
  cursor: pointer;
  padding: 4px;
  display: flex;
}
.dialog-close:hover {
  color: #333;
}
.dialog-body {
  padding: 18px 20px;
  overflow-y: auto;
  flex: 1;
}
.dialog-parsing {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 8px 0 14px;
}
.batch-file-list {
  max-height: 280px;
  overflow-y: auto;
  margin-bottom: 14px;
}
.batch-file-item {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-card, rgba(0,0,0,0.03));
  margin-bottom: 6px;
}
.batch-file-name {
  font-size: 13px;
  color: var(--text-primary, #333);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.batch-file-meta {
  font-size: 12px;
  color: var(--text-secondary, #999);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.form-row {
  margin-bottom: 14px;
}
.form-row label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #666;
  margin-bottom: 6px;
}
.lyrics-file-btn {
  padding: 2px 10px;
  border: 1px solid rgba(0,0,0,0.15);
  border-radius: 10px;
  background: transparent;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.lyrics-file-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.form-row input[type="text"],
.form-row input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fafafa;
  box-sizing: border-box;
}
.form-row input:focus {
  border-color: var(--primary-color);
  background: #fff;
}
.lyrics-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  outline: none;
  background: #fafafa;
  box-sizing: border-box;
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
}
.lyrics-input:focus {
  border-color: var(--primary-color);
  background: #fff;
}
.lyrics-input::placeholder {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #bbb;
  white-space: pre-wrap;
}
.cover-area {
  display: flex;
  align-items: center;
}
.cover-preview {
  position: relative;
  width: 80px;
  height: 80px;
}
.cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
}
.clear-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: #333;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 1px dashed rgba(0,0,0,0.2);
  border-radius: 8px;
  background: #fafafa;
  color: #666;
  font-size: 13px;
  cursor: pointer;
}
.pick-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.pick-btn.small {
  padding: 5px 10px;
  font-size: 12px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid rgba(0,0,0,0.06);
}
.cancel-btn {
  padding: 8px 18px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 18px;
  background: #fff;
  color: #666;
  font-size: 13px;
  cursor: pointer;
}
.cancel-btn:hover {
  background: #f5f5f5;
}
.confirm-btn {
  padding: 8px 22px;
  border: none;
  border-radius: 18px;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.confirm-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* 匹配对话框样式 */
.match-dialog {
  max-width: 560px;
}
.match-target {
  padding: 10px 12px;
  background: rgba(0,0,0,0.03);
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.match-label { color: #999; }
.match-target-name { color: var(--primary-color); font-weight: 500; }
.match-target-artist { color: #666; }
.match-search {
  margin-bottom: 12px;
}
.match-search .search-btn {
  padding: 4px 12px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  background: var(--primary-color);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.match-search .search-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.match-loading, .match-empty {
  text-align: center;
  padding: 24px;
  color: #999;
  font-size: 13px;
}
.match-results {
  max-height: 320px;
  overflow-y: auto;
}
.match-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  border: 1px solid transparent;
}
.match-result-item:hover {
  background: rgba(0,0,0,0.04);
}
.match-result-item.active {
  background: rgba(var(--primary-rgb, 220, 38, 38), 0.08);
  border-color: var(--primary-color);
}
.match-result-item input[type="radio"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--primary-color);
}
.match-result-info { flex: 1; min-width: 0; }
.match-result-name {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-result-meta {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-result-meta .sep { margin: 0 4px; }
.switch-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
}
.switch-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary-color);
}
.switch-hint {
  font-size: 11px;
  color: #999;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.05);
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}
.icon-btn:hover:not(:disabled) {
  background: rgba(0,0,0,0.1);
  color: #333;
}
.icon-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 30px 30px;
}
.empty-state {
  text-align: center;
  padding: 60px 0;
  color: #999;
  font-size: 14px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 18px;
  padding: 7px 14px;
  margin-bottom: 14px;
  color: #999;
}
.search-box input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  color: #333;
}
.song-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.song-row {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  padding: 10px 16px;
  border-radius: 10px;
  transition: background 0.2s;
}
.song-row:hover {
  background: #f9f9f9;
}
.song-row.dragging {
  opacity: 0.45;
}
.song-row.drag-over {
  border-top: 2px solid var(--primary-color);
}
.song-row.playing {
  background: rgba(236, 65, 65, 0.06);
}
.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ccc;
  cursor: grab;
  user-select: none;
  margin-left: -6px;
}
.drag-handle:active {
  cursor: grabbing;
}
.song-cover {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
}
.song-cover.placeholder {
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}
.song-info {
  flex: 1;
  min-width: 0;
}
.song-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-meta {
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-meta .sep {
  margin: 0 5px;
  color: #ddd;
}
.song-meta .size {
  color: #bbb;
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.row-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.04);
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.row-btn:hover {
  background: rgba(236, 65, 65, 0.12);
  color: var(--primary-color);
}
.row-btn.danger:hover {
  background: rgba(236, 65, 65, 0.15);
  color: var(--primary-color);
}
.row-btn:first-child {
  background: linear-gradient(135deg, #ff6b6b, var(--primary-color));
  color: #fff;
}
.row-btn:first-child:hover {
  opacity: 0.9;
  color: #fff;
}
</style>
