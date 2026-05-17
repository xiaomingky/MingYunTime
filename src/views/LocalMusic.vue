<script setup>
import { usePlayerStore } from '../store/player'
import { FolderOpen, Play, Search, Download, Trash2, FolderPlus, CheckSquare, Square, Image, ImagePlay, Edit3, X, Camera } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { cloudSearch, getNewLyric } from '../api'
import { useMessageStore } from '../store/message'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const loading = ref(false)
const selectedPaths = ref([])
const showGifCover = ref(localStorage.getItem('local_show_gif_cover') === 'true')

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

const findLyrics = async (song) => {
    const bridge = getBridge()
    if (!bridge) return
    try {
        const searchRes = await cloudSearch(song.name)
        const match = searchRes.result?.songs?.[0]
        if (!match) { messageStore.info(`《${song.name}》未找到匹配的在线歌词`); return; }

        const lyricRes = await getNewLyric(match.id)
        const lrc = lyricRes.lrc?.lyric || ''
        const tlrc = lyricRes.tlyric?.lyric || ''
        const yrcRaw = lyricRes.yrc?.lyric || ''
        const ytlrcRaw = lyricRes.ytlrc?.lyric || ''
        
        if (!lrc && !yrcRaw) { messageStore.info(`《${song.name}》暂无歌词文本`); return; }

        let fullContent = tlrc ? `${lrc}\n---trans---\n${tlrc}` : lrc
        if (yrcRaw) {
            fullContent += `\n---yrc---\n${yrcRaw}`
            if (ytlrcRaw) fullContent += `\n---ytlrc---\n${ytlrcRaw}`
        }

        const saveRes = await bridge.saveLyric({
            songPath: song.path,
            lyricContent: fullContent
        })

        if (saveRes.success) {
            // 如果当前正在播放这首歌，刷新播放器歌词
            if (playerStore.currentSong.path === song.path) {
                if (yrcRaw) {
                    playerStore.parseYrcLyrics(yrcRaw, ytlrcRaw)
                }
                if (lrc) {
                    playerStore.parseLyrics(lrc, tlrc)
                }
            }
            messageStore.success(`《${song.name}》${yrcRaw ? '逐词歌词' : (tlrc ? '双语歌词' : '歌词')}获取成功`)
        } else {
            messageStore.error(`《${song.name}》保存歌词失败：${saveRes.error}`)
        }
    } catch (err) {
        console.error('Find lyrics error:', err)
        messageStore.error('搜索歌词出错')
    }
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
const savingMeta = ref(false)

const openEditModal = async (song) => {
    editingSong.value = song
    editCover.value = ''
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

const saveMetadata = async () => {
    if (!editingSong.value) return
    savingMeta.value = true
    try {
        const bridge = getBridge()
        if (!bridge?.saveSongMetadata) { messageStore.error('Bridge未就绪'); return }
        const res = await bridge.saveSongMetadata({
            songPath: editingSong.value.path,
            metadata: JSON.parse(JSON.stringify(editMetadata.value)),
            coverDataUrl: editCover.value || ''
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
        <span class="count">共 {{ playerStore.localSongs.length }} 首</span>
        <div class="auto-lyric-toggle" @click="playerStore.toggleAutoFetchLyric()" :title="playerStore.autoFetchLyric ? '自动获取歌词已开启' : '自动获取歌词已关闭'">
          <span class="toggle-label">自动获取</span>
          <div class="toggle-switch" :class="{ active: playerStore.autoFetchLyric }">
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="play-all-btn" @click="playerStore.playSong(playerStore.localSongs[0], playerStore.localSongs)">
          <Play :size="16" fill="white" /> 播放全部
        </button>
        <button class="import-btn" @click="importSongs">
          <FolderOpen :size="16" /> 添加文件
        </button>
        <button class="import-btn" @click="importFolder" :disabled="loading">
          <FolderPlus :size="16" /> {{ loading ? '扫描中...' : '添加文件夹' }}
        </button>
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

    <div class="track-list">
      <div class="list-header">
        <div class="col-check" @click="toggleSelectAll">
            <CheckSquare v-if="isAllSelected" :size="16" class="check-icon active" />
            <Square v-else :size="16" class="check-icon" />
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
        :class="{ active: playerStore.currentSong.path === song.path, selected: selectedPaths.includes(song.path) }"
        @dblclick="playLocal(song)"
      >
        <div class="col-check" @click.stop="toggleSelect(song)">
            <CheckSquare v-if="selectedPaths.includes(song.path)" :size="16" class="check-icon active" />
            <Square v-else :size="16" class="check-icon" />
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

.header-left {
    display: flex;
    align-items: baseline;
    gap: 15px;
}

.title {
  font-size: 24px;
  font-weight: bold;
}

.count {
    color: #999;
    font-size: 14px;
}
.auto-lyric-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 20px;
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

.col-check {
    width: 30px;
    display: flex;
    align-items: center;
    cursor: pointer;
}

.check-icon {
    color: #ccc;
    transition: color 0.2s;
}

.check-icon.active {
    color: var(--primary-color);
}

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
