<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Music, X, Loader2, AlertCircle } from 'lucide-vue-next'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'
import { cloudSearch, getNewLyric } from '../api'

const playerStore = usePlayerStore()
const messageStore = useMessageStore()

const visible = ref(false)
const loading = ref(false)
const fetchingId = ref('')
const songInfo = ref({ songName: '', artist: '', songPath: '', duration: 0 })
const qqResults = ref([])
const kugouResults = ref([])
const neteaseResults = ref([])
const errors = ref({ qq: null, kugou: null, netease: null })
// 是否带上歌手搜索（持久化）
const withArtist = ref(localStorage.getItem('lyric_search_with_artist') !== 'false')

function toggleWithArtist() {
    withArtist.value = !withArtist.value
    localStorage.setItem('lyric_search_with_artist', withArtist.value)
    if (visible.value) doSearch()
}

// 实际用于搜索的歌手：关闭时传空，让后端只按歌名搜索
function effectiveArtist() {
    return withArtist.value ? songInfo.value.artist : ''
}

function getBridge() {
    return window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
}

function onShowSelector(e) {
    const { songName, artist, songPath, duration } = e.detail || {}
    songInfo.value = {
        songName: songName || '',
        artist: artist || '',
        songPath: songPath || '',
        duration: duration || 0
    }
    visible.value = true
    doSearch()
}

onMounted(() => {
    window.addEventListener('show-lyric-selector', onShowSelector)
})
onBeforeUnmount(() => {
    window.removeEventListener('show-lyric-selector', onShowSelector)
})

// 网易云搜索：两阶段（带作者 → 纯歌名兜底），合并去重最多 30 条
async function searchNetease(songName, artist) {
    const cleanArtist = String(artist || '').replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
    const fullQuery = cleanArtist ? `${songName} ${cleanArtist}` : songName
    const seenIds = new Set()
    const merged = []

    const pushSongs = (songs) => {
        for (const s of songs || []) {
            if (seenIds.has(s.id)) continue
            seenIds.add(s.id)
            merged.push({
                id: s.id,
                songname: s.name,
                singer: (s.artists || s.ar || []).map(a => a.name || a),
                duration: (s.duration || s.dt || 0) / 1000,
                source: 'netease'
            })
            if (merged.length >= 30) break
        }
    }

    try {
        const res1 = await cloudSearch(fullQuery)
        pushSongs(res1.result?.songs)
        if (merged.length < 3) {
            const strippedName = songName.replace(/\(.*\)|\[.*\]|（.*）|【.*】/g, '').trim()
            if (strippedName && strippedName !== songName) {
                const res2 = await cloudSearch(strippedName)
                pushSongs(res2.result?.songs)
            }
        }
    } catch (e) {
        throw e
    }
    return merged
}

async function doSearch() {
    loading.value = true
    qqResults.value = []
    kugouResults.value = []
    neteaseResults.value = []
    errors.value = { qq: null, kugou: null, netease: null }
    const bridge = getBridge()
    const artist = effectiveArtist()

    // QQ + 酷狗 走 IPC（Node.js 解密）
    const ipcPromise = (bridge && bridge.searchMultiLyric)
        ? bridge.searchMultiLyric({ songName: songInfo.value.songName, artist })
            .then(res => ({
                qq: res.qq || [],
                kugou: res.kugou || [],
                errors: res.errors || { qq: null, kugou: null }
            }))
            .catch(e => ({ qq: [], kugou: [], errors: { qq: e.message, kugou: e.message } }))
        : Promise.resolve({ qq: [], kugou: [], errors: { qq: 'IPC bridge 不可用', kugou: 'IPC bridge 不可用' } })

    // 网易云走前端 API
    const neteasePromise = searchNetease(songInfo.value.songName, artist)
        .then(list => ({ list, err: null }))
        .catch(e => ({ list: [], err: e.message }))

    const [ipcRes, ncRes] = await Promise.all([ipcPromise, neteasePromise])
    qqResults.value = ipcRes.qq
    kugouResults.value = ipcRes.kugou
    neteaseResults.value = ncRes.list
    errors.value = {
        qq: ipcRes.errors.qq,
        kugou: ipcRes.errors.kugou,
        netease: ncRes.err
    }
    loading.value = false
}

function artistText(singers) {
    if (Array.isArray(singers)) return singers.join(' / ')
    return singers || '未知歌手'
}

// 时长格式化：秒 → m:ss
function formatDuration(sec) {
    if (!sec || sec <= 0) return ''
    const s = Math.round(sec)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
}

// 选中候选项：QQ/酷狗走 IPC，网易云走前端 API
async function selectCandidate(item) {
    if (fetchingId.value) return
    fetchingId.value = String(item.id) + item.source
    const bridge = getBridge()
    try {
        let lyricRes = { lrc: '', yrc: '', trans: '' }

        if (item.source === 'netease') {
            // 网易云：前端 API 获取歌词
            const lRes = await getNewLyric(item.id)
            lyricRes = {
                lrc: lRes.lrc?.lyric || '',
                yrc: lRes.yrc?.lyric || '',
                trans: lRes.tlyric?.lyric || (lRes.ytlrc?.lyric || '')
            }
        } else {
            // QQ/酷狗：IPC 获取（item 是 Vue Proxy，需解包）
            const plainItem = JSON.parse(JSON.stringify(item))
            lyricRes = await bridge.fetchLyricByCandidate(plainItem)
        }

        if (!lyricRes.lrc && !lyricRes.yrc) {
            messageStore.error('该候选无歌词文本')
            return
        }

        if (lyricRes.yrc) {
            playerStore.parseYrcLyrics(lyricRes.yrc, lyricRes.trans || '')
        }
        if (lyricRes.lrc) {
            playerStore.parseLyrics(lyricRes.lrc, lyricRes.trans || '')
        }
        playerStore.lyricSource = item.source

        // 保存到本地 .lrc 文件（含 yrc 段）；云音乐 songPath 为空，不保存
        if (bridge.saveLyric && songInfo.value.songPath) {
            let saveContent = lyricRes.lrc || ''
            if (lyricRes.trans) saveContent += `\n---trans---\n${lyricRes.trans}`
            if (lyricRes.yrc) {
                saveContent += `\n---yrc---\n${lyricRes.yrc}`
                if (lyricRes.trans) saveContent += `\n---ytlrc---\n${lyricRes.trans}`
            }
            await bridge.saveLyric({
                songPath: songInfo.value.songPath,
                lyricContent: saveContent
            })
        }

        const sourceName = item.source === 'qq' ? 'QQ音乐' : (item.source === 'kugou' ? '酷狗' : '网易云')
        messageStore.success(`已应用${sourceName}歌词：《${songInfo.value.songName}》`)
        visible.value = false
    } catch (e) {
        messageStore.error('获取歌词失败: ' + e.message)
    } finally {
        fetchingId.value = ''
    }
}

function close() {
    if (fetchingId.value) return
    visible.value = false
}
</script>

<template>
  <Transition name="lyric-selector">
    <div v-if="visible" class="selector-overlay" @click.self="close">
      <div class="selector-dialog">
        <div class="selector-header">
          <div class="header-left">
            <h3 class="selector-title">
              选择歌词 <span class="song-name">《{{ songInfo.songName }}》</span>
              <span v-if="formatDuration(songInfo.duration)" class="current-duration">当前 {{ formatDuration(songInfo.duration) }}</span>
              <Loader2 v-if="loading" :size="14" class="spin" />
            </h3>
            <button class="artist-toggle" :class="{ active: withArtist }" @click="toggleWithArtist" :disabled="!!fetchingId" :title="withArtist ? '当前：带上歌手搜索，点击关闭' : '当前：仅按歌名搜索，点击开启'">
              {{ withArtist ? '✓ 带歌手' : '仅歌名' }}
            </button>
          </div>
          <button class="close-btn" @click="close" :disabled="!!fetchingId">
            <X :size="18" />
          </button>
        </div>

        <div class="selector-body">
          <!-- QQ 音乐列 -->
          <div class="platform-col">
            <div class="col-header">
              <Music :size="14" /> QQ音乐
              <span class="count">{{ qqResults.length }}</span>
              <span v-if="errors.qq" class="err-tip" :title="errors.qq">
                <AlertCircle :size="12" />
              </span>
            </div>
            <div class="result-list">
              <div v-if="loading && !qqResults.length" class="loading-tip">
                <Loader2 :size="14" class="spin" /> 搜索中...
              </div>
              <div v-else-if="!qqResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in qqResults"
                :key="'qq-' + item.id"
                class="result-item"
                :class="{
                  fetching: fetchingId === item.id + item.source,
                  'duration-match': songInfo.duration && Math.abs((item.interval || 0) - songInfo.duration) <= 1
                }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.interval)" class="item-duration">{{ formatDuration(item.interval) }}</span>
                </div>
                <Loader2 v-if="fetchingId === item.id + item.source" :size="12" class="spin item-loading" />
              </div>
            </div>
          </div>

          <!-- 酷狗列 -->
          <div class="platform-col">
            <div class="col-header">
              <Music :size="14" /> 酷狗音乐
              <span class="count">{{ kugouResults.length }}</span>
              <span v-if="errors.kugou" class="err-tip" :title="errors.kugou">
                <AlertCircle :size="12" />
              </span>
            </div>
            <div class="result-list">
              <div v-if="loading && !kugouResults.length" class="loading-tip">
                <Loader2 :size="14" class="spin" /> 搜索中...
              </div>
              <div v-else-if="!kugouResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in kugouResults"
                :key="'kg-' + item.id"
                class="result-item"
                :class="{
                  fetching: fetchingId === item.id + item.source,
                  'duration-match': songInfo.duration && Math.abs((item.duration || 0) - songInfo.duration) <= 1
                }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.duration)" class="item-duration">{{ formatDuration(item.duration) }}</span>
                </div>
                <Loader2 v-if="fetchingId === item.id + item.source" :size="12" class="spin item-loading" />
              </div>
            </div>
          </div>

          <!-- 网易云列 -->
          <div class="platform-col">
            <div class="col-header">
              <Music :size="14" /> 网易云
              <span class="count">{{ neteaseResults.length }}</span>
              <span v-if="errors.netease" class="err-tip" :title="errors.netease">
                <AlertCircle :size="12" />
              </span>
            </div>
            <div class="result-list">
              <div v-if="loading && !neteaseResults.length" class="loading-tip">
                <Loader2 :size="14" class="spin" /> 搜索中...
              </div>
              <div v-else-if="!neteaseResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in neteaseResults"
                :key="'ne-' + item.id"
                class="result-item"
                :class="{
                  fetching: fetchingId === String(item.id) + item.source,
                  'duration-match': songInfo.duration && Math.abs((item.duration || 0) - songInfo.duration) <= 1
                }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.duration)" class="item-duration">{{ formatDuration(item.duration) }}</span>
                </div>
                <Loader2 v-if="fetchingId === String(item.id) + item.source" :size="12" class="spin item-loading" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.selector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000;
  will-change: opacity;
}
.selector-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.selector-dialog {
  background: #fff;
  border-radius: 16px;
  width: 900px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
  position: relative;
  z-index: 1;
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.selector-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.artist-toggle {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: #fff;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.artist-toggle:hover:not(:disabled) {
  border-color: #c20c0c;
  color: #c20c0c;
}
.artist-toggle.active {
  background: #c20c0c;
  border-color: #c20c0c;
  color: #fff;
}
.artist-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.song-name {
  color: #c20c0c;
  font-weight: 600;
}
.current-duration {
  font-size: 12px;
  color: #fff;
  background: #c20c0c;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.15s;
  display: flex;
}
.close-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: #333;
}
.close-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.selector-body {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 280px;
}
.platform-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  padding: 0 4px 8px;
  border-bottom: 2px solid #c20c0c;
  margin-bottom: 6px;
}
.count {
  background: rgba(194, 12, 12, 0.1);
  color: #c20c0c;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}
.err-tip {
  color: #f59e0b;
  margin-left: auto;
  cursor: help;
}

.result-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.loading-tip, .empty-tip {
  padding: 24px 8px;
  text-align: center;
  color: #999;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.result-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.result-item:hover {
  background: rgba(194, 12, 12, 0.06);
}
.result-item.fetching {
  opacity: 0.6;
  pointer-events: none;
}
/* 时长匹配项高亮（差 ≤1 秒） */
.result-item.duration-match {
  background: rgba(194, 12, 12, 0.08);
  box-shadow: inset 3px 0 0 #c20c0c;
}
.result-item.duration-match .item-duration {
  background: #c20c0c;
  color: #fff;
  padding: 1px 6px;
  border-radius: 8px;
}
.item-name {
  font-size: 13px;
  color: #333;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  min-width: 0;
}
.item-artist {
  font-size: 11px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.item-duration {
  font-size: 11px;
  color: #c20c0c;
  font-weight: 600;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.item-loading {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: #c20c0c;
}

.spin {
  animation: ls-spin 1s linear infinite;
}
@keyframes ls-spin { to { transform: rotate(360deg); } }

/* 滚动条 */
.result-list::-webkit-scrollbar,
.selector-body::-webkit-scrollbar { width: 5px; }
.result-list::-webkit-scrollbar-thumb,
.selector-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

/* 过渡动画 */
.lyric-selector-enter-active { transition: opacity 0.2s ease; }
.lyric-selector-leave-active { transition: opacity 0.15s ease; }
.lyric-selector-enter-from,
.lyric-selector-leave-to { opacity: 0; }
.lyric-selector-enter-from .selector-dialog { transform: scale(0.96) translateY(8px); }
.lyric-selector-leave-to .selector-dialog { transform: scale(0.98); }
.selector-dialog { transition: transform 0.2s ease; }
</style>
