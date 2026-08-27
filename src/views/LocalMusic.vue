<script setup>
import { usePlayerStore } from '../store/player'
import { FolderOpen, Play, Search, Download, Trash2, FolderPlus, Image, ImagePlay, Edit3, X, Camera, GripVertical, Wand2, Music, FileText, ChevronDown } from 'lucide-vue-next'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { cloudSearch, getNewLyric } from '../api'
import { useMessageStore } from '../store/message'
import FormatConvert from './FormatConvert.vue'
import LyricFetch from './LyricFetch.vue'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const loading = ref(false)
const selectedPaths = ref([])
const showGifCover = ref(localStorage.getItem('local_show_gif_cover') === 'true')
// Tabs：本地音乐 / 格式转换（与本地视频页的分 Tab 结构一致）
const activeTab = ref('local')

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer || window.electron

const importSongs = async () => {
    const bridge = getBridge()
    if (!bridge) { messageStore.error('环境错误：bridge 未加载'); return; }
    try {
        const songs = await bridge.openFileDialog()
        if (songs && songs.length > 0) {
            playerStore.addLocalSongs(songs)
        }
    } catch (err) {
        console.error('Import songs error:', err)
        messageStore.error('导入失败: ' + err.message)
    }
}

const importFolder = async () => {
    const bridge = getBridge()
    if (!bridge || !bridge.openDirectoryDialog) { 
        messageStore.error('环境错误：接口未就绪'); 
        return; 
    }
    try {
        loading.value = true
        const songs = await bridge.openDirectoryDialog()
        if (songs && songs.length > 0) {
            playerStore.addLocalSongs(songs)
            messageStore.success(`成功识别并导入 ${songs.length} 首歌曲`)
        } else {
            messageStore.info('未在该文件夹中找到支持的音频文件')
        }
    } catch (err) {
        console.error('Import folder error:', err)
        messageStore.error('导入文件夹失败')
    } finally {
        loading.value = false
    }
}

// 添加按钮下拉菜单（添加文件 / 添加文件夹）
const addMenuOpen = ref(false)
const addDropdownRef = ref(null)
function pickAdd(type) {
    addMenuOpen.value = false
    if (type === 'file') importSongs()
    else if (type === 'folder' && !loading.value) importFolder()
}
function onDocDown(e) {
    const el = addDropdownRef.value
    if (el && !el.contains(e.target)) addMenuOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

const findLyrics = (song) => {
    // 触发 LyricSelector 弹窗（QQ + 酷狗 + 网易云兜底）
    // 与播放本地歌曲时自动弹出的逻辑保持一致
    const cleanArtist = String(song.artist || '').replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
    window.dispatchEvent(new CustomEvent('show-lyric-selector', {
        detail: {
            songName: song.name,
            artist: cleanArtist,
            songPath: song.path
        }
    }))
}

const fetchingCover = ref(new Map())
const fetchCover = async (song) => {
    const bridge = getBridge()
    if (!bridge) return
    if (fetchingCover.value.get(song.path)) return
    fetchingCover.value.set(song.path, true)
    try {
        const searchRes = await cloudSearch(song.name)
        const match = searchRes.result?.songs?.[0]
        if (!match || !match.al?.picUrl) { messageStore.info(`《${song.name}》未找到匹配的在线封面`); return }

        const result = await bridge.invoke('download-cover-for-song', {
            songPath: song.path,
            coverUrl: match.al.picUrl
        })
        if (result.success) {
            const encodedPath = encodeURI(song.path.replace(/\\/g, '/'))
            song.al.picUrl = `song-cover:///${encodedPath}`
            // 如果当前正在播放这首歌，同步更新详情页封面
            if (playerStore.currentSong.path === song.path) {
                playerStore.currentSong.al.picUrl = song.al.picUrl
            }
            // 触发 store 保存
            playerStore.addLocalSongs(playerStore.localSongs)
            messageStore.success(`《${song.name}》封面获取成功`)
        } else {
            messageStore.error(`《${song.name}》封面获取失败：${result.error}`)
        }
    } catch (err) {
        console.error('Fetch cover error:', err)
        messageStore.error(`《${song.name}》封面获取出错`)
    } finally {
        fetchingCover.value.set(song.path, false)
    }
}

const formatSize = (bytes) => {
    if (!bytes) return '0 MB'
    const mb = bytes / (1024 * 1024)
    return mb.toFixed(1) + ' MB'
}

const playLocal = (song) => {
    playerStore.playSong(song, playerStore.localSongs)
}

const removeSong = async (song) => {
    if (await messageStore.confirm(`确定要从列表中移除 "${song.name}" 吗？`, '移除歌曲')) {
        playerStore.removeLocalSong(song.path)
    }
}

// 批量操作
const isAllSelected = computed(() => {
    return playerStore.localSongs.length > 0 && selectedPaths.value.length === playerStore.localSongs.length
})

const toggleSelectAll = () => {
    if (isAllSelected.value) {
        selectedPaths.value = []
    } else {
        selectedPaths.value = playerStore.localSongs.map(s => s.path)
    }
}

const toggleSelect = (song) => {
    const index = selectedPaths.value.indexOf(song.path)
    if (index === -1) {
        selectedPaths.value.push(song.path)
    } else {
        selectedPaths.value.splice(index, 1)
    }
}

const batchRemove = async () => {
    if (selectedPaths.value.length === 0) return
    if (await messageStore.confirm(`确定要移除选中的 ${selectedPaths.value.length} 首歌曲吗？`, '批量移除')) {
        playerStore.removeLocalSongs(selectedPaths.value)
        selectedPaths.value = []
    }
}

const toggleGifCover = () => {
    showGifCover.value = !showGifCover.value
    localStorage.setItem('local_show_gif_cover', showGifCover.value)
}

// 拖拽排序
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
    if (dragFromIndex.value !== -1 && dragFromIndex.value !== index) {
        playerStore.reorderLocalSongs(dragFromIndex.value, index)
    }
    resetDrag()
}

const onDragEnd = () => resetDrag()

const getCoverUrl = (song) => {
    if (!song.al?.picUrl) return ''
    if (!showGifCover.value && song.al.picUrl.startsWith('song-cover:')) {
        return song.al.picUrl + '?static=1'
    }
    return song.al.picUrl
}

// ── 元数据编辑 ──
const showEditModal = ref(false)
const editingSong = ref(null)
const editMetadata = ref({ title: '', artist: '', album: '', year: '', genre: '', track: '' })
const editCover = ref('')
const editLyrics = ref('')
const savingMeta = ref(false)

const openEditModal = async (song) => {
    editingSong.value = song
    editCover.value = ''
    editLyrics.value = ''
    const bridge = getBridge()
    if (bridge?.readSongMetadata) {
        try {
            const res = await bridge.readSongMetadata(song.path)
            if (res.success) {
                editMetadata.value = {
                    title: res.metadata.title || song.name,
                    artist: res.metadata.artist || song.artist,
                    album: res.metadata.album || song.al?.name || '',
                    year: res.metadata.year || '',
                    genre: res.metadata.genre || '',
                    track: res.metadata.track || ''
                }
                editCover.value = res.metadata.coverData || ''
                editLyrics.value = res.metadata.lyrics || ''
            }
        } catch (e) { /* fallback to song data */ }
    }
    if (!editMetadata.value.title) {
        editMetadata.value = {
            title: song.name || '',
            artist: song.artist || '',
            album: song.al?.name || '',
            year: '', genre: '', track: ''
        }
    }
    showEditModal.value = true
}

const handleCoverSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { editCover.value = ev.target.result }
    reader.readAsDataURL(file)
}

// 选择歌词文件（.lrc/.txt）
const selectLyricsFile = async () => {
    const bridge = getBridge()
    if (!bridge?.invoke) return
    const content = await bridge.invoke('open-lyrics-dialog')
    if (content) editLyrics.value = content
}

const saveMetadata = async () => {
    if (!editingSong.value) return
    savingMeta.value = true
    try {
        const bridge = getBridge()
        if (!bridge?.saveSongMetadata) { messageStore.error('Bridge未就绪'); return }
        const res = await bridge.saveSongMetadata({
            songPath: editingSong.value.path,
            metadata: JSON.parse(JSON.stringify(editMetadata.value)),
            coverDataUrl: editCover.value || '',
            lyrics: editLyrics.value || ''
        })
        if (res.success) {
            // 更新列表中的显示
            const song = playerStore.localSongs.find(s => s.path === editingSong.value.path)
            if (song) {
                song.name = editMetadata.value.title
                song.artist = editMetadata.value.artist
                song.ar = [{ name: editMetadata.value.artist }]
                song.al.name = editMetadata.value.album
                // 封面刷新
                if (editCover.value) {
                    song.al.picUrl = `song-cover:///${encodeURI(editingSong.value.path.replace(/\\/g, '/'))}`
                }
            }
            playerStore.addLocalSongs(playerStore.localSongs) // trigger save
            messageStore.success('元数据已保存到文件')
            showEditModal.value = false
        } else {
            messageStore.error('保存失败：' + (res.error || '未知错误'))
        }
    } catch (e) { messageStore.error('保存出错: ' + e.message) }
    finally { savingMeta.value = false }
}
</script>

<template>
  <div class="local-music-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="title">本地音乐</h1>
        <div class="tabs">
          <button class="tab-btn" :class="{ active: activeTab === 'local' }" @click="activeTab = 'local'">
            <Music :size="14" /> 本地音乐 <span class="tab-count">{{ playerStore.localSongs.length }}</span>
          </button>
          <button class="tab-btn" :class="{ active: activeTab === 'convert' }" @click="activeTab = 'convert'">
            <Wand2 :size="14" /> 格式转换
          </button>
          <button class="tab-btn" :class="{ active: activeTab === 'lyric' }" @click="activeTab = 'lyric'">
            <FileText :size="14" /> 歌词获取
          </button>
        </div>
        <div v-if="activeTab === 'local'" class="auto-lyric-toggle" @click="playerStore.toggleAutoFetchLyric()" :title="playerStore.autoFetchLyric ? '自动获取歌词已开启' : '自动获取歌词已关闭'">
          <span class="toggle-label">自动获取</span>
          <div class="toggle-switch" :class="{ active: playerStore.autoFetchLyric }">
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>
      <div class="actions" v-if="activeTab === 'local'">
        <button class="play-all-btn" @click="playerStore.playSong(playerStore.localSongs[0], playerStore.localSongs)">
          <Play :size="16" fill="white" /> 播放全部
        </button>
        <div class="add-dropdown" ref="addDropdownRef">
          <button class="import-btn add-trigger" @click="addMenuOpen = !addMenuOpen" :title="'添加音乐（文件或文件夹）'">
            <FolderPlus :size="16" /> 添加
            <ChevronDown :size="13" class="add-chevron" :class="{ open: addMenuOpen }" />
          </button>
          <Transition name="dd">
            <div v-if="addMenuOpen" class="add-menu">
              <button class="add-menu-item" @click="pickAdd('file')">
                <FolderOpen :size="14" /> 添加文件
              </button>
              <div class="dd-sep"></div>
              <button class="add-menu-item" @click="pickAdd('folder')" :disabled="loading">
                {{ loading ? '扫描中...' : '添加文件夹' }}
              </button>
            </div>
          </Transition>
        </div>
        <button 
          class="import-btn gif-toggle-btn" 
          :class="{ active: showGifCover }"
          @click="toggleGifCover"
          :title="showGifCover ? '点击切换为静态封面' : '点击切换为GIF封面'"
        >
          <ImagePlay v-if="showGifCover" :size="16" />
          <Image v-else :size="16" />
          {{ showGifCover ? 'GIF封面' : '静态封面' }}
        </button>
        <button 
          v-if="selectedPaths.length > 0" 
          class="batch-delete-btn" 
          @click="batchRemove"
        >
          <Trash2 :size="16" /> 批量移除 ({{ selectedPaths.length }})
        </button>
      </div>
    </div>

    <!-- 格式转换 Tab -->
    <template v-if="activeTab === 'convert'">
      <div class="convert-section">
        <FormatConvert :embedded="true" />
      </div>
    </template>

    <!-- 歌词获取 Tab -->
    <template v-else-if="activeTab === 'lyric'">
      <div class="lyric-section">
        <LyricFetch />
      </div>
    </template>

    <!-- 本地音乐 Tab -->
    <template v-else>
    <div class="track-list">
      <div class="list-header">
        <div class="col-drag"></div>
        <div class="col-check" @click="toggleSelectAll">
            <svg class="check-svg" :class="{ on: isAllSelected }" viewBox="0 0 16 16" fill="none">
                <circle class="check-box" cx="8" cy="8" r="7" />
                <path class="check-path" d="M4.5 8.1l2.3 2.4 4.6-5" />
            </svg>
        </div>
        <div class="col-index">#</div>
        <div class="col-title">标题</div>
        <div class="col-artist">专辑</div>
        <div class="col-album">大小</div>
        <div class="col-actions">操作</div>
      </div>

      <div
        v-for="(song, index) in playerStore.localSongs"
        :key="song.path"
        class="track-item"
        :class="{ active: playerStore.currentSong.path === song.path, selected: selectedPaths.includes(song.path), dragging: dragFromIndex === index, 'drag-over': dragOverIndex === index && dragFromIndex !== index }"
        @dblclick="playLocal(song)"
        @dragover.prevent="onDragOver(index, $event)"
        @drop.prevent="onDrop(index, $event)"
        @dragleave="onDragLeave"
      >
        <div class="col-drag" draggable="true" @dragstart.stop="onDragStart(index, $event)" @dragend.stop="onDragEnd">
            <GripVertical :size="16" />
        </div>
        <div class="col-check" @click.stop="toggleSelect(song)">
            <svg class="check-svg" :class="{ on: selectedPaths.includes(song.path) }" viewBox="0 0 16 16" fill="none">
                <circle class="check-box" cx="8" cy="8" r="7" />
                <path class="check-path" d="M4.5 8.1l2.3 2.4 4.6-5" />
            </svg>
        </div>
        <div class="col-index">{{ index + 1 < 10 ? '0' + (index + 1) : index + 1 }}</div>
        <div class="col-title">
          <img v-if="getCoverUrl(song)" :src="getCoverUrl(song)" class="song-cover-thumb" />
          <div v-else class="song-cover-placeholder"></div>
          <span class="song-name text-truncate">{{ song.name }}</span>
        </div>
        <div class="col-artist text-truncate">{{ song.al.name }}</div>
        <div class="col-album">{{ formatSize(song.size) }}</div>
        <div class="col-actions">
            <button class="icon-btn" title="编辑元数据" @click.stop="openEditModal(song)">
                <Edit3 :size="14" />
            </button>
            <button class="icon-btn" title="获取封面" @click.stop="fetchCover(song)">
                <Camera :size="14" />
            </button>
            <button class="icon-btn" title="搜索并保存歌词" @click.stop="findLyrics(song)">
                <Search :size="14" />
            </button>
            <button class="icon-btn delete-btn" title="移除歌曲" @click.stop="removeSong(song)">
                <Trash2 :size="14" />
            </button>
        </div>
      </div>
      
      <div v-if="playerStore.localSongs.length === 0" class="empty-state">
        <div class="empty-icon"><Download :size="48" /></div>
        <p>还没有添加本地音乐</p>
        <button class="import-link" @click="importSongs">立即添加</button>
      </div>
    </div>

    <!-- 元数据编辑弹窗 -->
    <div v-if="showEditModal" class="modal-overlay" @click="showEditModal = false">
      <div class="edit-modal" @click.stop>
        <div class="modal-header">
          <h3>编辑元数据</h3>
          <span class="modal-format">{{ editingSong?.name }}</span>
          <X :size="18" class="clickable" @click="showEditModal = false" />
        </div>
        <div class="edit-body">
          <div class="edit-cover" @click="$refs.coverInput.click()">
            <img v-if="editCover" :src="editCover" />
            <Image v-else :size="40" />
            <span>点击更换封面</span>
            <input ref="coverInput" type="file" accept="image/*" hidden @change="handleCoverSelect" />
          </div>
          <div class="edit-fields">
            <div class="field">
              <label>标题</label>
              <input v-model="editMetadata.title" />
            </div>
            <div class="field">
              <label>歌手</label>
              <input v-model="editMetadata.artist" />
            </div>
            <div class="field">
              <label>专辑</label>
              <input v-model="editMetadata.album" />
            </div>
            <div class="field-row">
              <div class="field small">
                <label>年份</label>
                <input v-model="editMetadata.year" />
              </div>
              <div class="field small">
                <label>曲号</label>
                <input v-model="editMetadata.track" />
              </div>
              <div class="field small">
                <label>风格</label>
                <input v-model="editMetadata.genre" />
              </div>
            </div>
            <div class="field">
              <label>
                <span>歌词</span>
                <button class="lyrics-file-btn" @click="selectLyricsFile">选择 .lrc 文件</button>
              </label>
              <textarea v-model="editLyrics" class="lyrics-textarea" placeholder="粘贴 LRC 歌词或点击上方按钮选择 .lrc 文件&#10;支持时间标签，留空则不写入歌词元数据" rows="4"></textarea>
            </div>
          </div>
        </div>
        <div class="edit-footer">
          <button class="cancel-btn" @click="showEditModal = false">取消</button>
          <button class="save-btn" :disabled="savingMeta" @click="saveMetadata">
            {{ savingMeta ? '保存中...' : '写入文件' }}
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.local-music-view {
  padding: 30px;
  flex: 1;
  overflow-y: auto;
}

.view-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
}

/* ===== Tabs（与本地视频页一致） ===== */
.tabs {
    display: flex;
    gap: 2px;
    background: #f0f0f0;
    padding: 2px;
    border-radius: 8px;
}

.tab-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1;
    color: #666;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
}

.tab-btn.active {
    background: #fff;
    color: var(--primary-color, #c20c0c);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.tab-count {
    font-size: 10px;
    background: rgba(0,0,0,0.08);
    padding: 1px 6px;
    border-radius: 8px;
    color: #888;
}

.tab-btn.active .tab-count {
    background: rgba(194, 12, 12, 0.12);
    color: var(--primary-color, #c20c0c);
}

.convert-section {
    display: flex;
    flex-direction: column;
}

/* 歌词获取面板 Tab：与格式转换一致，随页面自然撑开 */
.convert-section, .lyric-section {
    display: flex;
    flex-direction: column;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

.title {
  font-size: 24px;
  font-weight: bold;
  white-space: nowrap;
  flex-shrink: 0;
}

.auto-lyric-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 12px;
    cursor: pointer;
    user-select: none;
}
.toggle-label {
    font-size: 12px;
    color: #999;
}
.toggle-switch {
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: #ccc;
    transition: background 0.25s;
    position: relative;
}
.toggle-switch.active {
    background: var(--primary-color);
}
.toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: left 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toggle-switch.active .toggle-knob {
    left: 20px;
}

.actions {
    display: flex;
    gap: 12px;
}

.play-all-btn {
    background-color: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 18px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
}

.import-btn {
    background: #fff;
    border: 1px solid #ddd;
    padding: 8px 16px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
    color: #333;
    transition: all 0.2s;
}

.import-btn:hover:not(:disabled) {
    background-color: #f5f5f5;
    border-color: #ccc;
}

/* ===== 添加下拉（添加文件 / 添加文件夹） ===== */
.add-dropdown {
    position: relative;
}

.add-trigger { white-space: nowrap; }

.add-chevron {
    transition: transform 0.2s;
    color: #999;
}

.add-chevron.open {
    transform: rotate(180deg);
    color: var(--primary-color, #c20c0c);
}

.add-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 150px;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    padding: 5px;
    z-index: 100;
}

.add-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    border-radius: 7px;
    font-size: 13px;
    color: #333;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
}

.add-menu-item:hover:not(:disabled) {
    background: rgba(194, 12, 12, 0.08);
    color: var(--primary-color, #c20c0c);
}

.add-menu-item:disabled {
    color: #bbb;
    cursor: not-allowed;
}

.dd-sep {
    height: 1px;
    background: #f0f0f0;
    margin: 5px 6px;
}

.dd-enter-active,
.dd-leave-active {
    transition: opacity 0.16s, transform 0.16s;
}

.dd-enter-from,
.dd-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}

.batch-delete-btn {
    background: #fff;
    border: 1px solid #ff4d4f;
    color: #ff4d4f;
    padding: 8px 16px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}

.batch-delete-btn:hover {
    background-color: #fff1f0;
}

.track-list {
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  padding: 10px;
  color: #999;
  font-size: 13px;
  border-bottom: 1px solid #eee;
  align-items: center;
}

.track-item {
  display: flex;
  padding: 10px;
  align-items: center;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  transition: background 0.2s;
}

.track-item:hover {
  background-color: #f7f7f7;
}

.track-item.active {
    background-color: #fef2f2;
}

.track-item.active .song-name {
    color: var(--primary-color);
    font-weight: 500;
}

.track-item.selected {
    background-color: #f0f0f0;
}

.col-drag {
    width: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
    cursor: grab;
    user-select: none;
}

.col-drag:active {
    cursor: grabbing;
}

.track-item.dragging {
    opacity: 0.45;
}

.track-item.drag-over {
    border-top: 2px solid var(--primary-color);
}

.col-check {
    width: 30px;
    display: flex;
    align-items: center;
    cursor: pointer;
}

.check-svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: block;
}
.check-box {
    fill: none;
    stroke: #ccc;
    stroke-width: 1.5;
    transition: stroke 0.2s, fill 0.2s;
}
.check-svg.on .check-box {
    stroke: var(--primary-color, #c20c0c);
    fill: var(--primary-color, #c20c0c);
}
.check-path {
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 12;
    stroke-dashoffset: 12;
    transition: stroke-dashoffset 0.25s ease 0.05s;
}
.check-svg.on .check-path { stroke-dashoffset: 0; }

.col-index { width: 40px; color: #bbb; text-align: center; font-size: 12px; }
.col-title { flex: 3; display: flex; align-items: center; gap: 8px; min-width: 0; padding-left: 10px; }

.song-cover-thumb {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
}

.song-cover-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    background: #f0f0f0;
    flex-shrink: 0;
}

.gif-toggle-btn.active {
    background-color: var(--primary-color);
    color: white;
    border-color: var(--primary-color);
}
.col-artist { flex: 2; min-width: 0; padding-right: 10px; color: #666; }
.col-album { flex: 1; min-width: 0; color: #999; }
.col-actions { width: 120px; display: flex; gap: 8px; justify-content: flex-end; }

/* Edit Modal */
.modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex;
    align-items: center; justify-content: center; z-index: 10000;
}
.edit-modal {
    background: white; width: 500px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
}
.edit-modal .modal-header {
    padding: 16px 20px; display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid #f0f0f0;
}
.edit-modal .modal-header h3 { margin: 0; font-size: 16px; }
.modal-format { font-size: 11px; color: #bbb; background: #f5f5f5; padding: 2px 8px; border-radius: 4px; }
.edit-body { display: flex; gap: 20px; padding: 20px; }
.edit-cover {
    width: 150px; height: 150px; border-radius: 8px; background: #f5f5f5;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; cursor: pointer; overflow: hidden; flex-shrink: 0; border: 2px dashed #ddd;
    color: #bbb; font-size: 11px;
}
.edit-cover img { width: 100%; height: 100%; object-fit: cover; }
.edit-cover:hover { border-color: var(--primary-color); }
.edit-fields { flex: 1; display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 3px; }
.field label { font-size: 11px; color: #999; font-weight: 500; }
.field input {
    padding: 7px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;
    outline: none;
}
.field input:focus { border-color: var(--primary-color); }
.field > label {
  display: flex; align-items: center; justify-content: space-between;
}
.lyrics-file-btn {
  padding: 2px 10px; border: 1px solid rgba(0,0,0,0.15); border-radius: 10px;
  background: transparent; color: #666; font-size: 11px; cursor: pointer;
  transition: all 0.15s;
}
.lyrics-file-btn:hover { border-color: var(--primary-color); color: var(--primary-color); }
.lyrics-textarea {
    padding: 7px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;
    font-family: 'Consolas', 'Monaco', monospace; outline: none; resize: vertical;
    min-height: 60px; line-height: 1.5; white-space: pre;
}
.lyrics-textarea:focus { border-color: var(--primary-color); }
.field-row { display: flex; gap: 10px; }
.field.small { flex: 1; }
.field.small input { width: 100%; box-sizing: border-box; }
.edit-footer {
    padding: 12px 20px; border-top: 1px solid #f0f0f0;
    display: flex; justify-content: flex-end; gap: 10px;
}
.edit-footer button {
    padding: 8px 24px; border-radius: 20px; border: 1px solid #ddd;
    background: white; cursor: pointer; font-size: 13px;
}
.edit-footer .save-btn {
    background: var(--primary-color); color: white; border: none;
}
.edit-footer .save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.icon-btn {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    padding: 5px;
    border-radius: 4px;
    transition: all 0.2s;
}

.icon-btn:hover {
    color: var(--primary-color);
    background: #f0f0f0;
}

.delete-btn:hover {
    color: #ff4d4f !important;
}

.text-truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
    text-align: center;
    padding: 100px 0;
    color: #999;
}

.empty-icon {
    margin-bottom: 20px;
    opacity: 0.2;
}

.import-link {
    margin-top: 15px;
    color: var(--primary-color);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    font-size: 14px;
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
