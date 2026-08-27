<script setup>
// 歌词获取面板（本地音乐页 Tab）
// 支持：QQ音乐 / 酷狗 / 网易云（可选全部），搜索歌曲获取歌词
// 选项：版本（详情页解析版 / 原始文本）、歌词数据（逐行LRC / 逐词YRC）、是否带翻译
// 命名格式（歌名-作者 / 作者-歌名）、保存地址（自定义目录，持久化 userData/lyric-dir.json）
// 结果可预览并另存为 .lrc 文件（格式与本地歌词文件/播放器完全兼容）
import { ref, computed, watch, onMounted } from 'vue'
import { Search, Loader2, Music, Save, AlertCircle, FileText, X, Folder, FolderCog, FolderOpen } from 'lucide-vue-next'
import { cloudSearch, getNewLyric } from '../api'
import { useMessageStore } from '../store/message'
import CustomSelect from '../components/CustomSelect.vue'

const messageStore = useMessageStore()

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.electron

// ===== 配置选项 =====
const songName = ref('')
const artist = ref('')
const platform = ref('all') // all | qq | kugou | netease
const version = ref('parsed') // parsed 解析版 | raw 原始文本
const format = ref('word') // word 逐词 | line 逐行
const withTrans = ref(true)
const naming = ref(localStorage.getItem('lyric_naming_format') || 'song-artist') // song-artist 歌名-作者 | artist-song 作者-歌名

// ===== 歌词保存目录（主进程持久化 userData/lyric-dir.json） =====
const lyricDir = ref('')
const lyricDirConfigured = ref(false)

async function loadLyricDir() {
    const bridge = getBridge()
    if (!bridge || !bridge.lyricGetDir) return
    const res = await bridge.lyricGetDir()
    if (res?.success) {
        lyricDir.value = res.dir || ''
        lyricDirConfigured.value = !!res.configured
    }
}

async function pickDir() {
    const bridge = getBridge()
    if (!bridge || !bridge.lyricPickDir) { messageStore.error('Electron 桥接不可用'); return }
    try {
        const res = await bridge.lyricPickDir()
        if (res?.success) {
            const saved = await bridge.lyricSaveDir(res.dir)
            if (saved?.success) {
                lyricDir.value = saved.dir
                lyricDirConfigured.value = !!res.dir
                messageStore.success('歌词保存地址已更新')
            } else {
                messageStore.error('保存地址失败：' + (saved?.error || '未知错误'))
            }
        }
    } catch (e) {
        messageStore.error('选择目录失败: ' + (e.message || e))
    }
}

async function openDir() {
    const bridge = getBridge()
    if (!bridge || !bridge.openPath) { messageStore.error('Electron 桥接不可用'); return }
    if (!lyricDir.value) return
    const res = await bridge.openPath(lyricDir.value)
    if (res && res.success === false) messageStore.error('打开目录失败：' + (res.error || ''))
}

onMounted(loadLyricDir)

// ===== 搜索状态 =====
const loading = ref(false)
const qqResults = ref([])
const kugouResults = ref([])
const neteaseResults = ref([])
const errors = ref({ qq: null, kugou: null, netease: null })
const fetchingId = ref('')
const selected = ref(null) // 当前选中的候选
const partsCache = ref({ lrc: '', yrc: '', trans: '' }) // 源站原始歌词
const preview = ref('') // 按选项组装后的内容
const saving = ref(false)

const hasAnyResult = computed(() => qqResults.value.length || kugouResults.value.length || neteaseResults.value.length)
const previewLines = computed(() => (preview.value ? preview.value.split('\n').length : 0))

// 平台是否启用（决定搜索结果列显隐）
function wantQQ() { return platform.value === 'all' || platform.value === 'qq' }
function wantKG() { return platform.value === 'all' || platform.value === 'kugou' }
function wantNE() { return platform.value === 'all' || platform.value === 'netease' }

function artistText(singers) {
    if (Array.isArray(singers)) return singers.join(' / ')
    return singers || '未知歌手'
}

function formatDuration(sec) {
    if (!sec || sec <= 0) return ''
    const s = Math.round(sec)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ===== 网易云搜索（与 LyricSelector 一致：带作者 → 纯歌名兜底） =====
async function searchNetease(name, ar) {
    const cleanArtist = String(ar || '').replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
    const fullQuery = cleanArtist ? `${name} ${cleanArtist}` : name
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
    const res1 = await cloudSearch(fullQuery)
    pushSongs(res1.result?.songs)
    if (merged.length < 3) {
        const stripped = name.replace(/\(.*\)|\[.*\]|（.*）|【.*】/g, '').trim()
        if (stripped && stripped !== name) {
            const res2 = await cloudSearch(stripped)
            pushSongs(res2.result?.songs)
        }
    }
    return merged
}

async function doSearch() {
    if (!songName.value.trim()) { messageStore.warning('请输入歌名'); return }
    loading.value = true
    selected.value = null
    partsCache.value = { lrc: '', yrc: '', trans: '' }
    preview.value = ''
    qqResults.value = []
    kugouResults.value = []
    neteaseResults.value = []
    errors.value = { qq: null, kugou: null, netease: null }
    const bridge = getBridge()
    const kw = songName.value.trim()
    const ar = artist.value.trim()

    const tasks = []
    if (wantQQ() || wantKG()) {
        const rawPromise = (bridge && bridge.searchMultiLyric)
            ? bridge.searchMultiLyric({ songName: kw, artist: ar })
                .then(r => ({ qq: r.qq || [], kugou: r.kugou || [], errors: r.errors || {} }))
                .catch(e => ({ qq: [], kugou: [], errors: { qq: e.message, kugou: e.message } }))
            : Promise.resolve({ qq: [], kugou: [], errors: { qq: 'IPC 桥接不可用', kugou: 'IPC 桥接不可用' } })
        tasks.push(rawPromise.then(res => {
            qqResults.value = wantQQ() ? res.qq.slice(0, 30) : []
            kugouResults.value = wantKG() ? res.kugou.slice(0, 30) : []
            errors.value.qq = wantQQ() ? res.errors.qq : null
            errors.value.kugou = wantKG() ? res.errors.kugou : null
        }))
    }
    if (wantNE()) {
        tasks.push(searchNetease(kw, ar)
            .then(list => { neteaseResults.value = list })
            .catch(e => { errors.value.netease = e.message }))
    }
    await Promise.all(tasks)
    loading.value = false
    if (!hasAnyResult.value) messageStore.info('未找到相关歌曲，可尝试调整平台或去掉歌手')
}

// ===== 歌词解析（纯函数，不改播放器状态） =====
function parseLrc(text) {
    if (!text) return []
    const pattern = /\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
    const out = []
    for (const line of text.split('\n')) {
        const matches = [...line.matchAll(pattern)]
        if (!matches.length) continue
        let content = line.replace(pattern, '').trim()
        if (!content || content === '//') continue // 跳过 QQ/酷狗空行占位符
        for (const m of matches) {
            const min = parseInt(m[1])
            const sec = parseInt(m[2])
            const p = m[3] || '0'
            const ms = p.length >= 3 ? parseInt(p) / 1000 : p.length === 2 ? parseInt(p) / 100 : parseInt(p) / 10
            out.push({ time: min * 60 + sec + ms, text: content })
        }
    }
    return out.sort((a, b) => a.time - b.time)
}

function fmtTs(time) {
    const min = Math.floor(time / 60)
    const sec = Math.floor(time % 60)
    const ms = Math.round((time - Math.floor(time)) * 1000)
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function encodeLrc(entries) {
    return entries.map(e => `[${fmtTs(e.time)}]${e.text}`).join('\n')
}

function parseYrc(text) {
    if (!text) return []
    const wordPattern = /\((\d+),(\d+),(\d+)\)((?:(?!\(\d+,\d+,\d+\)).)*)/g
    const out = []
    for (const line of text.split('\n')) {
        if (!line.trim() || line.trim().startsWith('{')) continue
        const h = line.match(/^\s*\[(\d+),(\d+)\]/)
        if (!h) continue
        const words = []
        let m
        wordPattern.lastIndex = 0
        const content = line.replace(/^\s*\[\d+,\d+\]/, '')
        while ((m = wordPattern.exec(content)) !== null) {
            if (m[4]) words.push({ startTime: parseInt(m[1]), duration: parseInt(m[2]), text: m[4] })
        }
        if (!words.length) continue
        out.push({ startTime: parseInt(h[1]), duration: parseInt(h[2]), words })
    }
    return out
}

function encodeYrc(entries) {
    return entries.map(e =>
        `[${e.startTime},${e.duration}]` + e.words.map(w => `(${w.startTime},${w.duration},0)${w.text}`).join('')
    ).join('\n')
}

// 按当前选项组装最终文件内容
function assemble(parts) {
    const { lrc, yrc, trans } = parts
    const transRaw = (withTrans.value && trans && trans.trim()) ? trans.trim() : ''
    const lrcClean = version.value === 'parsed' ? encodeLrc(parseLrc(lrc)) : (lrc || '').trim()
    const wordMode = format.value === 'word' && yrc && yrc.trim()

    if (!wordMode) {
        let out = lrcClean
        if (transRaw) out += (out ? '\n---trans---\n' : '') + transRaw
        return out.trim()
    }

    const yrcClean = version.value === 'parsed' ? encodeYrc(parseYrc(yrc)) : yrc.trim()
    let out = lrcClean
    if (out) out += '\n'
    if (transRaw) out += '---trans---\n' + transRaw + '\n'
    out += '---yrc---\n' + yrcClean
    if (transRaw) out += '\n---ytlrc---\n' + transRaw
    return out.trim()
}

function buildPreview() {
    preview.value = assemble(partsCache.value)
}

// 选项变化时重新组装
watch([version, format, withTrans], () => {
    if (selected.value) buildPreview()
})

// 命名格式持久化
watch(naming, v => localStorage.setItem('lyric_naming_format', v))

// ===== 选中候选 → 获取歌词 =====
async function selectCandidate(item) {
    if (fetchingId.value) return
    fetchingId.value = String(item.id) + item.source
    try {
        let parts = { lrc: '', yrc: '', trans: '' }
        if (item.source === 'netease') {
            const res = await getNewLyric(item.id)
            parts = {
                lrc: res.lrc?.lyric || '',
                yrc: res.yrc?.lyric || '',
                trans: res.tlyric?.lyric || res.ytlrc?.lyric || ''
            }
        } else {
            const bridge = getBridge()
            const plain = JSON.parse(JSON.stringify(item))
            const br = await bridge.fetchLyricByCandidate(plain)
            parts = { lrc: br.lrc || '', yrc: br.yrc || '', trans: br.trans || '' }
        }
        selected.value = item
        partsCache.value = parts
        buildPreview()
        if (!preview.value) {
            messageStore.error(format.value === 'word'
                ? '该候选没有可用的逐词歌词（可切换为逐行）'
                : '该候选没有可用的逐行歌词（可切换为逐词）')
        }
    } catch (e) {
        messageStore.error('获取歌词失败: ' + e.message)
    } finally {
        fetchingId.value = ''
    }
}

// ===== 保存 =====
async function saveFile() {
    const bridge = getBridge()
    if (!bridge || !bridge.saveLyricAs) { messageStore.error('Electron 桥接不可用'); return }
    if (!preview.value) { messageStore.warning('暂无可保存的歌词内容'); return }
    saving.value = true
    try {
        const singer = artistText(selected.value?.singer) || ''
        const namePart = selected.value ? selected.value.songname || '歌词' : '歌词'
        const hasSinger = !!(singer && singer !== '未知歌手')
        let base = namePart
        if (hasSinger) {
            base = naming.value === 'artist-song' ? `${singer} - ${namePart}` : `${namePart} - ${singer}`
        }
        const res = await bridge.saveLyricAs({
            defaultName: base,
            content: preview.value,
            dir: lyricDirConfigured.value ? lyricDir.value : ''
        })
        if (res?.success) {
            messageStore.success(`歌词已保存：${res.path}`)
        } else if (!res?.canceled) {
            messageStore.error('保存失败：' + (res?.error || '未知错误'))
        }
    } catch (e) {
        messageStore.error('保存失败: ' + (e.message || e))
    } finally {
        saving.value = false
    }
}

function clearFields() {
    songName.value = ''
    artist.value = ''
    qqResults.value = []
    kugouResults.value = []
    neteaseResults.value = []
    selected.value = null
    partsCache.value = { lrc: '', yrc: '', trans: '' }
    preview.value = ''
}
</script>

<template>
  <div class="lyric-fetch-view">
    <!-- 顶部：搜索 + 选项 -->
    <div class="panel">
      <div class="search-row">
        <div class="search-input">
          <Search :size="16" class="input-icon" />
          <input
            v-model="songName"
            class="text-input"
            placeholder="输入歌名"
            @keyup.enter="doSearch"
          />
          <button v-if="songName" class="clear-btn" @click="songName = ''"><X :size="13" /></button>
        </div>
        <div class="search-input artist-input">
          <Music :size="16" class="input-icon" />
          <input
            v-model="artist"
            class="text-input"
            placeholder="歌手（可选）"
            @keyup.enter="doSearch"
          />
        </div>
        <button class="primary-btn" :disabled="loading" @click="doSearch">
          <Loader2 v-if="loading" :size="15" class="spinning" />
          <Search v-else :size="15" />
          {{ loading ? '搜索中…' : '搜索歌词' }}
        </button>
        <button class="ghost-btn" @click="clearFields"><X :size="14" /> 清空</button>
      </div>

      <!-- 选项行：平台 / 版本 / 数据格式 / 带翻译 -->
      <div class="options-row">
        <div class="opt-group">
          <span class="opt-label">歌词源</span>
          <div class="seg">
            <button
              class="seg-btn"
              :class="{ active: platform === 'all' }"
              @click="platform = 'all'"
            >全部</button>
            <button
              class="seg-btn"
              :class="{ active: platform === 'qq' }"
              @click="platform = 'qq'"
            >QQ音乐</button>
            <button
              class="seg-btn"
              :class="{ active: platform === 'kugou' }"
              @click="platform = 'kugou'"
            >酷狗</button>
            <button
              class="seg-btn"
              :class="{ active: platform === 'netease' }"
              @click="platform = 'netease'"
            >网易云</button>
          </div>
        </div>

        <div class="opt-group">
          <span class="opt-label">版本</span>
          <CustomSelect
            v-model="version"
            class="opt-select"
            :options="[{ value: 'parsed', label: '解析版（详情页）' }, { value: 'raw', label: '原始文本' }]"
          />
        </div>

        <div class="opt-group">
          <span class="opt-label">数据格式</span>
          <CustomSelect
            v-model="format"
            class="opt-select"
            :options="[{ value: 'word', label: '逐词（YRC 卡拉OK）' }, { value: 'line', label: '逐行（LRC）' }]"
          />
        </div>

        <div class="opt-group">
          <span class="opt-label">命名格式</span>
          <CustomSelect
            v-model="naming"
            class="opt-select"
            :options="[{ value: 'song-artist', label: '歌名 - 作者' }, { value: 'artist-song', label: '作者 - 歌名' }]"
          />
        </div>

        <div class="opt-group trans-group" @click="withTrans = !withTrans" :title="withTrans ? '当前带翻译，点击关闭' : '当前不带翻译，点击开启'">
          <span class="opt-label">带翻译</span>
          <div class="switch" :class="{ on: withTrans }">
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>

      <!-- 保存地址行 -->
      <div class="dir-row">
        <div class="opt-group dir-group">
          <span class="opt-label">保存地址</span>
          <div class="dir-box" :title="lyricDir || '未设置，保存时将弹出选择框'">
            <FolderOpen :size="13" />
            <span class="dir-text">{{ lyricDirConfigured ? lyricDir : '未设置（保存时选择）' }}</span>
          </div>
          <button class="mini-btn" @click="pickDir" :title="'选择歌词保存目录（当前：' + (lyricDir || '未设置') + '）'">
            <FolderCog :size="13" /> 选择
          </button>
          <button class="mini-btn" @click="openDir" :disabled="!lyricDir" :title="lyricDir ? '打开目录：' + lyricDir : '暂无目录可打开'">
            <Folder :size="13" /> 打开
          </button>
        </div>
      </div>
    </div>

    <!-- 搜索结果 + 预览 -->
    <div class="content-row">
      <div class="results-area">
        <div class="area-title">
          搜索结果
          <span class="area-sub">点击候选项获取歌词</span>
        </div>

        <div class="searching-hint" v-if="loading">
          <Loader2 :size="16" class="spinning" /> 正在搜索 {{ platform === 'all' ? '全平台' : platform === 'qq' ? 'QQ音乐' : platform === 'kugou' ? '酷狗' : '网易云' }}…
        </div>
        <div v-else-if="!hasAnyResult" class="search-empty">
          <FileText :size="40" />
          <span>输入歌名后搜索，选择候选获取并保存歌词</span>
        </div>

        <div v-else class="columns">
          <!-- QQ 音乐列 -->
          <div v-show="wantQQ()" class="platform-col">
            <div class="col-header">
              <Music :size="13" /> QQ音乐
              <span class="count">{{ qqResults.length }}</span>
              <span v-if="errors.qq" class="err-tip" :title="errors.qq"><AlertCircle :size="12" /></span>
            </div>
            <div class="result-list">
              <div v-if="!qqResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in qqResults"
                :key="'qq-' + item.id"
                class="result-item"
                :class="{ fetching: fetchingId === String(item.id) + item.source, selected: selected === item }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.interval)" class="item-duration">{{ formatDuration(item.interval) }}</span>
                </div>
                <Loader2 v-if="fetchingId === String(item.id) + item.source" :size="12" class="spinning item-loading" />
              </div>
            </div>
          </div>

          <!-- 酷狗列 -->
          <div v-show="wantKG()" class="platform-col">
            <div class="col-header">
              <Music :size="13" /> 酷狗音乐
              <span class="count">{{ kugouResults.length }}</span>
              <span v-if="errors.kugou" class="err-tip" :title="errors.kugou"><AlertCircle :size="12" /></span>
            </div>
            <div class="result-list">
              <div v-if="!kugouResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in kugouResults"
                :key="'kg-' + item.id"
                class="result-item"
                :class="{ fetching: fetchingId === String(item.id) + item.source, selected: selected === item }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.duration)" class="item-duration">{{ formatDuration(item.duration) }}</span>
                </div>
                <Loader2 v-if="fetchingId === String(item.id) + item.source" :size="12" class="spinning item-loading" />
              </div>
            </div>
          </div>

          <!-- 网易云列 -->
          <div v-show="wantNE()" class="platform-col">
            <div class="col-header">
              <Music :size="13" /> 网易云
              <span class="count">{{ neteaseResults.length }}</span>
              <span v-if="errors.netease" class="err-tip" :title="errors.netease"><AlertCircle :size="12" /></span>
            </div>
            <div class="result-list">
              <div v-if="!neteaseResults.length" class="empty-tip">暂无结果</div>
              <div
                v-for="item in neteaseResults"
                :key="'ne-' + item.id"
                class="result-item"
                :class="{ fetching: fetchingId === String(item.id) + item.source, selected: selected === item }"
                @click="selectCandidate(item)"
              >
                <div class="item-name">{{ item.songname }}</div>
                <div class="item-meta">
                  <span class="item-artist">{{ artistText(item.singer) }}</span>
                  <span v-if="formatDuration(item.duration)" class="item-duration">{{ formatDuration(item.duration) }}</span>
                </div>
                <Loader2 v-if="fetchingId === String(item.id) + item.source" :size="12" class="spinning item-loading" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 预览 -->
      <div class="preview-area">
        <div class="area-title">
          歌词预览
          <span v-if="preview" class="area-sub">{{ version === 'parsed' ? '解析版（详情页）' : '原始文本' }} · {{ format === 'word' ? '逐词' : '逐行' }} {{ withTrans ? '· 带翻译' : '' }} · {{ previewLines }} 行</span>
          <button v-if="preview" class="save-btn" :disabled="saving" @click="saveFile">
            <Loader2 v-if="saving" :size="14" class="spinning" />
            <Save v-else :size="14" />
            {{ lyricDirConfigured ? '保存歌词' : '保存为 .lrc' }}
          </button>
        </div>
        <div v-if="!preview" class="preview-empty">
          <FileText :size="40" />
          <span>选择结果后在此预览歌词内容</span>
        </div>
        <pre v-else class="lyric-preview">{{ preview }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyric-fetch-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    min-height: 560px;
}

/* ===== 顶部面板 ===== */
.panel {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.search-input {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0 10px;
    background: var(--bg-input, #fff);
    flex: 1;
    min-width: 180px;
    max-width: 320px;
    transition: border-color 0.15s;
}
.search-input:focus-within { border-color: var(--primary-color); }
.input-icon { color: var(--text-light); flex-shrink: 0; }
.text-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    padding: 8px 0;
    color: var(--text-main);
    min-width: 0;
}
.clear-btn {
    border: none;
    background: none;
    color: var(--text-light);
    cursor: pointer;
    padding: 2px;
    display: flex;
    border-radius: 4px;
}
.clear-btn:hover { color: var(--text-main); background: var(--hover-bg); }
.artist-input { max-width: 220px; }

.primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--primary-color);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
    white-space: nowrap;
}
.primary-btn:hover:not(:disabled) { opacity: 0.88; }
.primary-btn:active:not(:disabled) { transform: scale(0.97); }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
}
.ghost-btn:hover { background: var(--hover-bg); color: var(--text-main); }

/* ===== 选项行 ===== */
.options-row {
    display: flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px dashed var(--border-color);
}
.opt-group { display: flex; align-items: center; gap: 9px; }
.opt-label { font-size: 12px; color: var(--text-light); flex-shrink: 0; }
.seg {
    display: flex;
    gap: 2px;
    background: var(--hover-bg);
    padding: 2px;
    border-radius: 8px;
}
.seg-btn {
    border: none;
    background: transparent;
    padding: 4px 11px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}
.seg-btn.active {
    background: var(--bg-card, #fff);
    color: var(--primary-color);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.opt-select { width: auto; }
.opt-select :deep(.cs-trigger) {
    padding: 5px 10px;
    font-size: 12px;
    background: var(--bg-input, #fff);
    border-color: var(--border-color);
    color: var(--text-main);
}
.opt-select :deep(.cs-label) { font-size: 12px; color: var(--text-main); }
.trans-group { cursor: pointer; user-select: none; }
.switch {
    width: 34px;
    height: 18px;
    border-radius: 10px;
    background: var(--border-color);
    position: relative;
    transition: background 0.2s;
}
.switch.on { background: var(--primary-color); }
.switch-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.switch.on .switch-knob { transform: translateX(16px); }

/* ===== 保存地址行 ===== */
.dir-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px dashed var(--border-color);
}
.dir-group { flex: 1; min-width: 0; }
.dir-box {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input, #fff);
    padding: 6px 10px;
    color: var(--text-light);
    overflow: hidden;
}
.dir-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-secondary);
}
.mini-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
}
.mini-btn:hover:not(:disabled) {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: rgba(194, 12, 12, 0.05);
}
.mini-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ===== 内容区 ===== */
.content-row {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.results-area, .preview-area {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-card, #fff);
    overflow: hidden;
}
.area-title {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
}
.area-sub { font-size: 11px; font-weight: 400; color: var(--text-light); margin-right: auto; }

/* 搜索结果列 */
.columns {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    overflow: hidden;
}
.platform-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.col-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-main);
    padding: 0 4px 8px;
    border-bottom: 2px solid var(--primary-color);
    margin-bottom: 6px;
    flex-shrink: 0;
}
.count {
    background: rgba(194, 12, 12, 0.1);
    color: var(--primary-color);
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
}
.err-tip { color: #f59e0b; margin-left: auto; cursor: help; }
.result-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.empty-tip { padding: 20px 4px; text-align: center; color: var(--text-light); font-size: 12px; }
.result-item {
    padding: 7px 9px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    position: relative;
}
.result-item:hover { background: rgba(194, 12, 12, 0.06); }
.result-item.selected {
    background: rgba(194, 12, 12, 0.09);
    box-shadow: inset 3px 0 0 var(--primary-color);
}
.result-item.fetching { opacity: 0.6; pointer-events: none; }
.item-name {
    font-size: 13px;
    color: var(--text-main);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 14px;
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
    color: var(--text-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
}
.item-duration { font-size: 11px; color: var(--primary-color); font-weight: 600; flex-shrink: 0; }
.item-loading { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--primary-color); }

.searching-hint, .search-empty, .preview-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-light);
    font-size: 13px;
    padding: 20px;
}
.searching-hint { flex-direction: row; }

/* 预览 */
.save-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border: none;
    border-radius: 7px;
    background: var(--primary-color);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    flex-shrink: 0;
}
.save-btn:hover:not(:disabled) { opacity: 0.88; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.lyric-preview {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-secondary);
    background: var(--bg-code, rgba(0,0,0,0.02));
    font-family: Consolas, 'Courier New', monospace;
    white-space: pre-wrap;
    word-break: break-all;
}

.spinning { animation: lf-spin 1s linear infinite; }
@keyframes lf-spin { to { transform: rotate(360deg); } }

/* 滚动条 */
.result-list::-webkit-scrollbar,
.lyric-preview::-webkit-scrollbar { width: 5px; }
.result-list::-webkit-scrollbar-thumb,
.lyric-preview::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
</style>