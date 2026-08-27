<script setup>
// 音乐格式转换（加密格式还原）
// 支持：网易云 .ncm / QQ音乐 .qmc* .mflac .mgg / 酷狗 .kgm .kgma .vpr
// 原理：本地字节级解密还原，不转码 —— 输出原生 FLAC/MP3/OGG/M4A 等，与原始音质一致
// 支持多选文件导入，并自动解析封面/标题/歌手/专辑等元数据
import { ref, computed } from 'vue'
import { FolderOpen, RefreshCw, Play, Loader2, FileAudio, Wand2, CheckSquare, Square, Trash2 } from 'lucide-vue-next'
import { unlockOpenFiles, unlockParseInfo, unlockConvertFile } from '../api'
import { useMessageStore } from '../store/message'

const messageStore = useMessageStore()

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.electron

// embedded=true 时嵌入本地音乐页（隐藏独立页头，由外层提供入口）
const props = defineProps({
    embedded: { type: Boolean, default: false },
})

// 支持格式说明
const supportedFormats = [
    { label: '网易云', exts: 'ncm', color: '#EC4141' },
    { label: 'QQ 音乐', exts: 'qmc0~6 · qmcflac · mflac · mgg', color: '#31C27C' },
    { label: '酷狗', exts: 'kgm · kgma · vpr', color: '#2CA2F5' },
]

const parsing = ref(false)
const converting = ref(false)
const files = ref([]) // { path, name, ext, size, label, selected, status, out?, error?, title?, artist?, album?, cover? }

const selectedCount = computed(() => files.value.filter(f => f.selected && f.status !== 'success' && f.status !== 'converting').length)
const okCount = computed(() => files.value.filter(f => f.status === 'success').length)
const failCount = computed(() => files.value.filter(f => f.status === 'fail').length)
const totalCount = computed(() => files.value.length)
const convertedCount = computed(() => files.value.filter(f => f.status === 'success' || f.status === 'fail').length)
const progress = computed(() => {
    if (convertedCount.value === 0) return 0
    return Math.round((convertedCount.value / totalCount.value) * 100)
})

const allChecked = computed(() => files.value.length > 0 && files.value.every(f => f.selected))
const allCheckedIndeterminate = computed(() => {
    const sel = files.value.filter(f => f.selected).length
    return sel > 0 && sel < files.value.length
})

function toggleAll() {
    const next = !allChecked.value
    files.value.forEach(f => {
        if (f.status !== 'success' && f.status !== 'converting') f.selected = next
    })
}

function fmtSize(size) {
    if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
    if (size >= 1024) return (size / 1024).toFixed(0) + ' KB'
    return size + ' B'
}

function extOf(path) {
    const lower = path.toLowerCase()
    // 文件名叫 "xxx.kgm.flac" 时，标记是 kgm，扩展名是 flac —— 用内嵌标记区分来源
    const m = lower.match(/\.(kgma|kgm|vpr|mggl|mgg2|mgg[01]?|mflac0?|qmc[0-9]|qmcflac|qmcogg|ncm)\b/)
    if (m) return '.' + m[1]
    const dot = lower.lastIndexOf('.')
    return dot >= 0 ? lower.slice(dot) : ''
}

function labelOf(path) {
    const ext = extOf(path)
    if (ext === '.ncm') return '网易云'
    if (ext.startsWith('.kgm') || ext === '.kgma' || ext === '.vpr') return '酷狗'
    return 'QQ'
}

// 多选导入文件（可多次追加，自动去重）
async function pickFiles() {
    const bridge = getBridge()
    if (!bridge) return messageStore.error('Electron 桥接不可用')
    try {
        const paths = await unlockOpenFiles()
        if (!paths || paths.length === 0) return
        const existing = new Set(files.value.map(f => f.path.toLowerCase()))
        const fresh = paths.filter(p => !existing.has(p.toLowerCase()))
        if (fresh.length === 0) { messageStore.info('这些文件已在列表中'); return }
        const added = fresh.map(p => {
            const name = p.split(/[\\/]/).pop()
            return { path: p, name, ext: extOf(p), label: labelOf(p), size: 0, selected: true, status: 'wait', out: '', error: '', title: '', artist: '', album: '', cover: '', parsing: true }
        })
        files.value.push(...added)
        messageStore.success(`已添加 ${added.length} 个文件`)
        parseAll(added)
    } catch (e) {
        messageStore.error('选择文件失败：' + (e.message || e))
    }
}

// 批量解析元数据（封面/标题/歌手/专辑）
async function parseAll(list) {
    parsing.value = true
    try {
        const res = await unlockParseInfo(list.map(f => f.path))
        const byPath = {}
        if (res?.success && Array.isArray(res.items)) {
            for (const it of res.items) byPath[it.path.toLowerCase()] = it
        }
        for (const f of list) {
            const it = byPath[f.path.toLowerCase()]
            if (it?.success) {
                f.title = it.title || f.name
                f.artist = it.artist || ''
                f.album = it.album || ''
                f.cover = it.cover || ''
                if (it.size) f.size = it.size
            } else {
                f.title = f.name
                f.status = it?.error ? 'fail' : 'wait'
                if (it?.error) f.error = it.error
            }
            f.parsing = false
        }
    } catch (e) {
        for (const f of list) { f.parsing = false; f.title = f.name }
        messageStore.error('元数据解析失败：' + (e.message || e))
    } finally {
        parsing.value = false
    }
}

// 批量转换：4 路并发（避免大文件同时读入爆内存）
async function startConvert() {
    const targets = files.value.filter(f => f.selected && f.status === 'wait')
    if (targets.length === 0) {
        messageStore.warning('请先选择要转换的文件')
        return
    }
    converting.value = true
    for (const f of targets) f.status = 'wait'
    let index = 0
    const worker = async () => {
        while (index < targets.length) {
            const f = targets[index++]
            if (f.status === 'success') continue
            f.status = 'converting'
            const res = await unlockConvertFile(f.path)
            if (res?.success) {
                f.status = 'success'
                f.out = res.out
                f.outExt = res.outExt
            } else {
                f.status = 'fail'
                f.error = res?.error || '转换失败'
            }
        }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    converting.value = false
    const ok = okCount.value
    const fail = failCount.value
    if (fail === 0) messageStore.success(`转换完成：成功 ${ok} 个`)
    else messageStore.warning(`转换完成：成功 ${ok} 个，失败 ${fail} 个`)
}

function openOutDir(f) {
    if (!f.out) return
    getBridge()?.openPath(f.out)
}

// 移除列表中未转换的文件
function removePending(f) {
    if (f.status === 'converting') return
    const i = files.value.indexOf(f)
    if (i !== -1) files.value.splice(i, 1)
}
</script>

<template>
  <div class="format-convert-view" :class="{ embedded: props.embedded }">
    <div class="view-header" v-if="!props.embedded">
      <div class="header-left">
        <div class="page-title">
          <Wand2 :size="22" class="title-icon" />
          格式转换
        </div>
        <div class="page-subtitle">加密音乐本地无损还原（不转码，输出与原曲质一致）</div>
      </div>
      <div class="actions">
        <button class="primary-btn" :disabled="parsing || converting" @click="pickFiles">
          <FolderOpen :size="16" /> 选择文件
        </button>
        <button class="ghost-btn" :disabled="files.length === 0 || converting" @click="files = []">
          <Trash2 :size="15" /> 清空列表
        </button>
      </div>
    </div>

    <!-- 支持格式说明 -->
    <div class="support-bar">
      <div v-for="s in supportedFormats" :key="s.label" class="support-item">
        <span class="dot" :style="{ background: s.color }"></span>
        <span class="support-label">{{ s.label }}</span>
        <span class="support-exts">{{ s.exts }}</span>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="files.length === 0" class="empty-state">
      <div class="empty-icon"><FileAudio :size="52" /></div>
      <div class="empty-title">选择需要还原的加密音乐文件</div>
      <div class="empty-desc">支持网易云 ncm、QQ音乐 qmc*/mflac/mgg、酷狗 kgm/kgma/vpr，可多选文件，自动解析封面与歌曲信息</div>
      <button class="primary-btn big" @click="pickFiles" :disabled="parsing">
        <FolderOpen :size="18" /> 选择文件（可多选）
      </button>
    </div>

    <!-- 文件列表 -->
    <template v-else>
      <div class="toolbar">
        <div class="dir-info" :title="'共 ' + totalCount + ' 个文件'">
          <FolderOpen :size="15" />
          <span class="file-count">共 {{ totalCount }} 个文件</span>
          <span v-if="parsing" class="parsing-hint"><Loader2 :size="13" class="spinning" /> 正在解析歌曲信息…</span>
        </div>
        <div class="toolbar-right">
          <button class="ghost-btn add-btn" :disabled="converting" @click="pickFiles">
            <FolderOpen :size="14" /> 添加文件
          </button>
          <label class="check-all" @click="toggleAll">
            <CheckSquare v-if="allChecked" :size="16" class="check-icon active" />
            <Square v-else :size="16" class="check-icon" />
            全选
          </label>
          <button class="primary-btn" :disabled="converting || selectedCount === 0" @click="startConvert">
            <Play v-if="!converting" :size="15" />
            <Loader2 v-else :size="15" class="spinning" />
            {{ converting ? '转换中…' : `开始转换（${selectedCount}）` }}
          </button>
        </div>
      </div>

      <!-- 进度条 -->
      <div v-if="converting || convertedCount > 0" class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-text">
          <span>已完成 {{ convertedCount }} / {{ totalCount }}</span>
          <span class="ok">成功 {{ okCount }}</span>
          <span v-if="failCount" class="fail">失败 {{ failCount }}</span>
          <span>{{ progress }}%</span>
        </div>
      </div>

      <div class="file-table-wrap">
        <table class="file-table">
          <thead>
            <tr>
              <th class="col-check"></th>
              <th class="col-cover"></th>
              <th>歌曲</th>
              <th class="col-artist">歌手</th>
              <th class="col-album">专辑</th>
              <th class="col-label">来源</th>
              <th class="col-size">大小</th>
              <th class="col-result">结果</th>
              <th class="col-action">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in files" :key="f.path" :class="[f.status, { disabled: f.status === 'success' }]">
              <td class="col-check">
                <span
                  v-if="f.status === 'wait' || f.status === 'fail'"
                  class="check-icon-wrap"
                  @click.stop="f.selected = !f.selected"
                >
                  <CheckSquare v-if="f.selected" :size="16" class="check-icon active" />
                  <Square v-else :size="16" class="check-icon" />
                </span>
                <Loader2 v-else-if="f.status === 'converting'" :size="15" class="spinning icon-wait" />
                <span v-else-if="f.status === 'success'" class="ok-mark"><CheckSquare :size="16" class="icon-success" /></span>
                <span v-else class="ok-mark"><Square :size="16" class="icon-success" /></span>
              </td>
              <td class="col-cover">
                <img v-if="f.cover" :src="f.cover" class="cover-thumb" />
                <div v-else class="cover-ph"><Loader2 v-if="f.parsing" :size="14" class="spinning icon-wait" /><FileAudio v-else :size="16" /></div>
              </td>
              <td class="col-title" :title="f.path">
                <span class="song-name">{{ f.title || f.name }}</span>
                <span class="ext-tag">{{ (f.ext || '').replace('.', '').toUpperCase() }}</span>
              </td>
              <td class="col-artist">{{ f.artist || '未知' }}</td>
              <td class="col-album">{{ f.album || '未知' }}</td>
              <td class="col-label"><span class="label-tag">{{ f.label }}</span></td>
              <td class="col-size">{{ fmtSize(f.size) }}</td>
              <td class="col-result">
                <span v-if="f.status === 'success'" class="result-ok">{{ f.outExt?.toUpperCase() }} 已还原</span>
                <span v-else-if="f.status === 'fail'" class="result-fail" :title="f.error">失败</span>
                <span v-else-if="f.status === 'converting'" class="result-wait">转换中…</span>
                <span v-else class="result-wait">等待</span>
              </td>
              <td class="col-action">
                <button
                  v-if="f.status === 'success' && f.out"
                  class="open-btn"
                  title="打开所在目录"
                  @click="openOutDir(f)"
                >
                  <FolderOpen :size="14" /> 打开
                </button>
                <button
                  v-else-if="f.status === 'fail'"
                  class="retry-btn"
                  title="重新转换"
                  :disabled="converting"
                  @click="f.status = 'wait'; f.error = ''"
                >
                  <RefreshCw :size="13" /> 重试
                </button>
                <button
                  v-else
                  class="retry-btn"
                  title="从列表移除"
                  :disabled="converting"
                  @click="removePending(f)"
                >
                  <Trash2 :size="13" /> 移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.format-convert-view {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 18px 22px;
    gap: 14px;
    overflow: hidden;
}

/* 嵌入模式（本地音乐页内）：去独立页头与整体 padding，跟随父级滚动 */
.format-convert-view.embedded {
    height: auto;
    padding: 0;
    overflow: visible;
}
.format-convert-view.embedded .file-table-wrap {
    flex: none;
    max-height: 50vh;
}

/* ===== 顶部 ===== */
.view-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
}
.header-left { display: flex; flex-direction: column; gap: 6px; }
.page-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 22px;
    font-weight: 700;
    color: var(--text-main);
}
.title-icon { color: var(--primary-color); }
.page-subtitle { font-size: 13px; color: var(--text-light); }

.actions { display: flex; gap: 10px; }
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
}
.primary-btn:hover:not(:disabled) { opacity: 0.88; }
.primary-btn:active:not(:disabled) { transform: scale(0.97); }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.primary-btn.big { padding: 12px 26px; font-size: 15px; }

.ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}
.ghost-btn:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--text-main);
}
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ===== 支持格式说明 ===== */
.support-bar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}
.support-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    font-size: 12px;
}
.support-item .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.support-label { font-weight: 600; color: var(--text-main); }
.support-exts { color: var(--text-light); }

/* ===== 空状态 ===== */
.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-light);
}
.empty-icon { opacity: 0.4; }
.empty-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); }
.empty-desc { font-size: 13px; text-align: center; max-width: 460px; }

/* ===== 工具栏 ===== */
.toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.dir-info {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: 13px;
    color: var(--text-secondary);
}
.dir-info svg { flex-shrink: 0; color: var(--primary-color); }
.file-count {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 20px;
    background: var(--hover-bg);
    font-size: 12px;
    color: var(--text-secondary);
}
.parsing-hint {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--primary-color);
}
.toolbar-right { display: flex; align-items: center; gap: 14px; }
.check-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
}
.add-btn { padding: 7px 12px; font-size: 12px; }

/* ===== 复选框（本地音乐同款 CheckSquare/Square 图标） ===== */
.check-icon-wrap { cursor: pointer; display: inline-flex; vertical-align: middle; }
.check-icon { color: var(--text-light); vertical-align: middle; transition: color 0.15s; }
.check-icon:hover { color: var(--text-secondary); }
.check-icon.active { color: var(--primary-color); }
.ok-mark { display: inline-flex; vertical-align: middle; }

/* ===== 进度 ===== */
.progress-wrap { display: flex; flex-direction: column; gap: 6px; }
.progress-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--hover-bg);
    overflow: hidden;
}
.progress-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--primary-color);
    transition: width 0.25s ease;
}
.progress-text {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: var(--text-secondary);
}
.progress-text .ok { color: #2ecc71; font-weight: 600; }
.progress-text .fail { color: #e74c3c; font-weight: 600; }

/* ===== 文件表格 ===== */
.file-table-wrap {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-footer);
}
.file-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.file-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 10px 12px;
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
}
.file-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
.file-table tbody tr:last-child td { border-bottom: none; }
.file-table tbody tr:hover { background: var(--hover-bg); }
.file-table tbody tr.disabled { opacity: 0.65; }

.col-check { width: 36px; text-align: center !important; overflow: visible; }
.col-cover { width: 44px; }
.col-title { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.col-artist { width: 130px; min-width: 90px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary); }
.col-album { width: 150px; min-width: 90px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary); }
.col-label { width: 70px; }
.col-size { width: 80px; color: var(--text-secondary); }
.col-result { width: 105px; }
.col-action { width: 90px; }

/* 封面缩略图 */
.cover-thumb {
    width: 38px;
    height: 38px;
    border-radius: 4px;
    object-fit: cover;
    vertical-align: middle;
    display: block;
    background: var(--hover-bg);
}
.cover-ph {
    width: 38px;
    height: 38px;
    border-radius: 4px;
    background: var(--hover-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-light);
}
.song-name { display: inline-block; max-width: 210px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
.ext-tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    background: var(--hover-bg);
    color: var(--text-light);
    vertical-align: middle;
}

.label-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    background: var(--hover-bg);
    color: var(--primary-color);
}

.result-ok { color: #2ecc71; font-weight: 600; }
.result-fail { color: #e74c3c; font-weight: 600; }
.result-wait { color: var(--text-light); }
.icon-success { color: #2ecc71; vertical-align: middle; }
.icon-wait { color: var(--text-light); vertical-align: middle; }

.open-btn, .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}
.open-btn:hover { background: var(--primary-color); border-color: var(--primary-color); color: #fff; }
.retry-btn:hover { background: var(--hover-bg); color: var(--text-main); }
.retry-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.empty-cell {
    text-align: center !important;
    color: var(--text-light);
    padding: 26px !important;
}

/* ===== 动画 ===== */
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>