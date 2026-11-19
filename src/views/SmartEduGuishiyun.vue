<script setup>
// 桂师云教辅资源区（www.guishiyun.com）
// 目录（系列/学年/学科/年级/资源类型筛选 + 搜索）→ 单本资源清单（压缩包云解压）→ 下载
// 中考真题独立入口；电子书 PDF 需登录桂师云（捕获 Cookie gsy-Token）
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import CustomSelect from '../components/CustomSelect.vue'
import SelectionMark from '../components/SelectionMark.vue'
import { useMessageStore } from '../store/message'
import {
    guishiyunCatalog, guishiyunStats, guishiyunFiles, guishiyunExam, guishiyunEbook,
    guishiyunEbookIds, guishiyunDownload, guishiyunDownloadBatch, guishiyunOpenUrl,
    guishiyunLoginOpen, guishiyunLoginStatus, guishiyunLoginManual, guishiyunLogout,
    onGuishiyunLoginDone
} from '../api'
import {
    BookOpen, Search, Loader2, RefreshCw, KeyRound, LogOut, Download, ChevronLeft,
    ChevronDown, Copy, ExternalLink, X, FileText, GraduationCap
} from 'lucide-vue-next'

const props = defineProps({
    active: { type: Boolean, default: false }
})

const messageStore = useMessageStore()

const EXAM_ID = '__zgkzt__'
const PAGE_STEP = 60
const RESTYPE_ORDER = ['课件', '知识微课', '微课视频', '实验微课', '绘图资源', '拓展资源', '试卷', '答题卡', '听力音频', '衔接资源', '专题资源', '电子书 PDF', '中考真题']
const SERIES_ORDER = ['新课程学习与测评', '中考先锋', '全优中考']
const TYPE_TONES = {
    '课件': '#3b82f6',
    '知识微课': '#6366f1',
    '微课视频': '#8b5cf6',
    '实验微课': '#06b6d4',
    '绘图资源': '#14b8a6',
    '拓展资源': '#f59e0b',
    '试卷': '#ef4444',
    '答题卡': '#f97316',
    '听力音频': '#ec4899',
    '衔接资源': '#10b981',
    '专题资源': '#0ea5e9',
    '电子书 PDF': '#22c55e',
    '中考真题': '#dc2626'
}

// ===== 登录 =====
const loggedIn = ref(false)
const showLoginTips = ref(false)
const showManualToken = ref(false)
const manualToken = ref('')
const loginBusy = ref(false)
let loginDoneUn = null

async function loadLoginStatus() {
    try {
        const res = await guishiyunLoginStatus()
        if (res?.success) loggedIn.value = !!res.loggedIn
    } catch (e) {}
}

async function handleLogin() {
    if (loginBusy.value) return
    loginBusy.value = true
    try {
        const res = await guishiyunLoginOpen()
        if (res?.success) messageStore.info('请在打开的桂师云窗口完成登录，登录后自动生效')
        else messageStore.error(res?.error || '打开登录窗口失败')
    } catch (e) {
        messageStore.error('打开登录窗口失败: ' + e.message)
    } finally {
        loginBusy.value = false
    }
}

async function saveManualToken() {
    const raw = manualToken.value.trim()
    if (!raw) { messageStore.error('请输入 gsy-Token'); return }
    const res = await guishiyunLoginManual(raw)
    if (res?.success) {
        loggedIn.value = true
        showLoginTips.value = false
        manualToken.value = ''
        messageStore.success('桂师云令牌已保存')
        loadEbookFlags()
        if (view.value === 'book' && selectedBook.value && selectedBook.value.id !== EXAM_ID) {
            loadEbookFor(selectedBook.value)
        }
    } else {
        messageStore.error(res?.error || '保存失败')
    }
}

async function handleLogout() {
    await guishiyunLogout()
    loggedIn.value = false
    ebookIds.value = {}
    ebookState.value = { id: selectedBook.value?.id || '', status: 'need-login', file: null }
    showLoginTips.value = false
    messageStore.success('已退出桂师云')
}

// ===== 目录 =====
const books = ref([])
const catalogFilters = ref({})
const loading = ref(false)
const loadError = ref('')
const inited = ref(false)
const stats = ref({})
const statDone = ref(0)
const statFinished = ref(false)
const statsLoading = ref(false)
const ebookIds = ref({})
const coverFailed = ref({})
const searchText = ref('')
const filters = ref({ series: '', year: '', subject: '', grade: '', restype: '' })
const visibleCount = ref(PAGE_STEP)
const sentinel = ref(null)
let observer = null

async function loadCatalog(force = false) {
    if (loading.value) return
    loading.value = true
    loadError.value = ''
    try {
        const res = await guishiyunCatalog(force)
        if (!res?.success) throw new Error(res?.error || '桂师云目录加载失败')
        catalogFilters.value = res.data?.filters || {}
        books.value = Array.isArray(res.data?.books) ? res.data.books : []
        visibleCount.value = PAGE_STEP
        if (!books.value.length) loadError.value = '桂师云没有返回任何教辅，请稍后重试'
    } catch (e) {
        loadError.value = e.message
    } finally {
        loading.value = false
    }
    if (books.value.length) {
        loadStats()
        loadEbookFlags()
    }
}

// 资源统计：按 40 本/批渐进补齐（主进程内部 8 并发）
async function loadStats() {
    if (statsLoading.value) return
    statsLoading.value = true
    statFinished.value = false
    statDone.value = 0
    const ids = books.value.map(b => b.id).filter(Boolean)
    const batch = 40
    for (let i = 0; i < ids.length; i += batch) {
        const chunk = ids.slice(i, i + batch)
        try {
            const res = await guishiyunStats(chunk)
            if (res?.success && res.data) {
                stats.value = { ...stats.value, ...res.data }
            }
        } catch (e) {}
        statDone.value = Math.min(i + batch, ids.length)
        await new Promise(r => setTimeout(r, 0))
    }
    statFinished.value = true
    statsLoading.value = false
}

async function loadEbookFlags() {
    if (!loggedIn.value || !books.value.length) return
    try {
        const res = await guishiyunEbookIds(books.value.map(b => b.id))
        if (res?.success) {
            const map = {}
            for (const id of (res.data || [])) map[id] = true
            ebookIds.value = map
        }
    } catch (e) {}
}

const statOf = (id) => stats.value[id] || null
const statText = computed(() => {
    if (!books.value.length) return ''
    if (statFinished.value) return `资源统计完成：${books.value.length} 本`
    return `资源统计 ${statDone.value}/${books.value.length} 本`
})

function within(book, dims) {
    if (dims.series && book.series !== dims.series) return false
    if (dims.year && book.year !== dims.year) return false
    if (dims.subject && book.subject !== dims.subject) return false
    if (dims.grade && book.grade !== dims.grade) return false
    return true
}

function uniq(values) {
    return Array.from(new Set(values.filter(v => v !== '' && v !== null && v !== undefined)))
}

const afterSeries = computed(() => books.value.filter(b => !filters.value.series || b.series === filters.value.series))
const afterYear = computed(() => afterSeries.value.filter(b => !filters.value.year || b.year === filters.value.year))
const afterSubject = computed(() => afterYear.value.filter(b => !filters.value.subject || b.subject === filters.value.subject))

const seriesOpts = computed(() =>
    uniq(books.value.map(b => b.series))
        .sort((a, b) => {
            const ra = SERIES_ORDER.indexOf(a)
            const rb = SERIES_ORDER.indexOf(b)
            return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
        })
        .map(v => ({ value: v, label: v }))
)

const yearOpts = computed(() =>
    uniq(afterSeries.value.map(b => b.year))
        .sort((a, b) => String(b).localeCompare(String(a), 'zh-CN'))
        .map(v => ({ value: v, label: v }))
)

// 学科 / 年级按站点 getfilterconf 的顺序排，选项表没覆盖的新值补在后面
function orderedDimOptions(values, dimKey) {
    const present = new Set(uniq(values))
    const out = []
    for (const o of (catalogFilters.value[dimKey] || [])) {
        if (present.has(o.label) && !out.includes(o.label)) out.push(o.label)
    }
    for (const v of Array.from(present).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
        if (!out.includes(v)) out.push(v)
    }
    return out.map(v => ({ value: v, label: v }))
}

const subjectOpts = computed(() => orderedDimOptions(afterYear.value.map(b => b.subject), 'subject_id'))
const gradeOpts = computed(() => orderedDimOptions(afterSubject.value.map(b => b.grade), 'grade'))

const restypeOpts = computed(() => {
    const present = new Set()
    for (const b of afterSubject.value) {
        const st = stats.value[b.id]
        if (st?.types) for (const t of st.types) present.add(t)
        if (ebookIds.value[b.id]) present.add('电子书 PDF')
    }
    return RESTYPE_ORDER.filter(l => present.has(l)).map(l => ({ value: l, label: l }))
})

const filteredBooks = computed(() => {
    const kw = searchText.value.trim().toLowerCase()
    return books.value.filter(b => {
        if (!within(b, filters.value)) return false
        if (filters.value.restype) {
            const st = stats.value[b.id]
            const hasType = (st?.types || []).includes(filters.value.restype)
            const hasEbook = filters.value.restype === '电子书 PDF' && !!ebookIds.value[b.id]
            if (!hasType && !hasEbook) return false
        }
        if (kw && !String(b.name || '').toLowerCase().includes(kw)) return false
        return true
    })
})

const visibleBooks = computed(() => filteredBooks.value.slice(0, visibleCount.value))

function onFilterChange() {
    const f = filters.value
    if (f.year && !yearOpts.value.some(o => o.value === f.year)) f.year = ''
    if (f.subject && !subjectOpts.value.some(o => o.value === f.subject)) f.subject = ''
    if (f.grade && !gradeOpts.value.some(o => o.value === f.grade)) f.grade = ''
    if (f.restype && !restypeOpts.value.some(o => o.value === f.restype)) f.restype = ''
    visibleCount.value = PAGE_STEP
}

watch(searchText, () => { visibleCount.value = PAGE_STEP })

function setupObserver() {
    observer?.disconnect?.()
    observer = null
    if (!sentinel.value) return
    observer = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting) && visibleBooks.value.length < filteredBooks.value.length) {
            visibleCount.value += PAGE_STEP
        }
    }, { root: null, rootMargin: '240px 0px' })
    observer.observe(sentinel.value)
}
watch(visibleBooks, () => nextTick(setupObserver))
watch(filteredBooks, () => nextTick(setupObserver))

function onCoverError(book) {
    coverFailed.value = { ...coverFailed.value, [book.id]: true }
}

async function refresh() {
    await loadCatalog(true)
    if (view.value === 'book' && selectedBook.value) {
        await openBook(selectedBook.value, true)
    }
}

// ===== 单本资源清单 =====
const view = ref('catalog') // catalog | book
const selectedBook = ref(null)
const files = ref([])
const filesLoading = ref(false)
const fileRestype = ref('')
const fileSearch = ref('')
const selected = ref({})
const expandAll = ref(false)
const ebookState = ref({ id: '', status: '', file: null })
let lastEbookBookId = ''

function buildPackages(list) {
    const byParent = new Map()
    const tops = []
    for (const f of list) {
        if (f.inner) {
            if (!f.parent) continue
            if (!byParent.has(f.parent)) byParent.set(f.parent, [])
            byParent.get(f.parent).push(f)
        } else {
            tops.push(f)
        }
    }

    const matched = new Set()
    for (const f of tops) {
        const kids = f.packaged ? (byParent.get(f.name) || []) : []
        f.children = kids
        f.expanded = false
        for (const k of kids) matched.add(k)
    }
    // 兜底：没配到同名包的成员仍然列出来，避免丢资源
    for (const f of list) {
        if (!f.inner || matched.has(f)) continue
        f.children = []
        f.expanded = false
        f.orphan = true
        tops.push(f)
    }
    return tops
}

async function openBook(book, force = false) {
    selectedBook.value = book
    view.value = 'book'
    files.value = []
    filesLoading.value = true
    selected.value = {}
    fileRestype.value = ''
    fileSearch.value = ''
    expandAll.value = false
    lastEbookBookId = ''
    ebookState.value = { id: book.id, status: loggedIn.value ? '' : 'need-login', file: null }

    try {
        const res = book.id === EXAM_ID ? await guishiyunExam() : await guishiyunFiles(book.id, book.name)
        if (!res?.success) throw new Error(res?.error || '资源清单加载失败')
        files.value = buildPackages(Array.isArray(res.data) ? res.data : [])
    } catch (e) {
        messageStore.error(e.message)
    } finally {
        filesLoading.value = false
    }

    if (book.id !== EXAM_ID && loggedIn.value && (force || lastEbookBookId !== book.id)) {
        loadEbookFor(book)
    }
}

function backToCatalog() {
    view.value = 'catalog'
    selectedBook.value = null
    files.value = []
    selected.value = {}
    ebookState.value = { id: '', status: '', file: null }
    nextTick(setupObserver)
}

async function openExam() {
    await openBook({ id: EXAM_ID, name: '中考真题', series: '中考真题', exam: true })
}

// ===== 电子书（需登录）=====
const ebookLabel = computed(() => {
    if (!selectedBook.value || selectedBook.value.id === EXAM_ID) return ''
    const s = ebookState.value
    if (s.id !== selectedBook.value.id) return '获取电子书'
    if (s.status === 'need-login') return '获取电子书（需登录）'
    if (s.status === 'loading') return '电子书获取中…'
    if (s.status === 'found') return '电子书已加入列表'
    if (s.status === 'none') return '无配套电子书'
    if (s.status === 'error') return '电子书获取失败，可重试'
    return '获取电子书'
})

const ebookDisabled = computed(() => {
    const s = ebookState.value
    if (s.id !== selectedBook.value?.id) return false
    return s.status === 'loading' || s.status === 'found' || s.status === 'none'
})

async function loadEbookFor(book) {
    if (!book || book.id === EXAM_ID) return
    if (!loggedIn.value) {
        ebookState.value = { id: book.id, status: 'need-login', file: null }
        return
    }
    ebookState.value = { id: book.id, status: 'loading', file: null }
    try {
        const res = await guishiyunEbook(book.id, book.name)
        if (res?.needLogin) {
            ebookState.value = { id: book.id, status: 'need-login', file: null }
            return
        }
        if (!res?.success) {
            ebookState.value = { id: book.id, status: 'error', file: null }
            return
        }
        if (!res.file) {
            ebookState.value = { id: book.id, status: 'none', file: null }
            return
        }
        lastEbookBookId = book.id
        ebookState.value = { id: book.id, status: 'found', file: res.file }
        if (!files.value.some(f => f.url === res.file.url)) {
            files.value = [{ ...res.file, children: [], expanded: false }, ...files.value]
        }
    } catch (e) {
        ebookState.value = { id: book.id, status: 'error', file: null }
    }
}

function handleEbookClick() {
    if (!selectedBook.value || ebookDisabled.value) return
    const s = ebookState.value
    if (s.id !== selectedBook.value.id || s.status === 'need-login') {
        if (!loggedIn.value) { handleLogin(); return }
    }
    loadEbookFor(selectedBook.value)
}

// ===== 清单筛选 / 选择 / 展开 =====
const fileRestypeOpts = computed(() => {
    const present = new Set()
    for (const f of files.value) {
        present.add(f.restypeLabel)
        for (const c of (f.children || [])) present.add(c.restypeLabel)
    }
    return RESTYPE_ORDER.filter(l => present.has(l)).map(l => ({ value: l, label: l }))
})

const fileRows = computed(() => {
    const kw = fileSearch.value.trim().toLowerCase()
    const rt = fileRestype.value
    const rows = []
    for (const f of files.value) {
        const topMatch = (!rt || f.restypeLabel === rt) && (!kw || String(f.name || '').toLowerCase().includes(kw))
        const kids = (f.children || []).filter(c =>
            (!rt || c.restypeLabel === rt) && (!kw || String(c.name || '').toLowerCase().includes(kw))
        )
        const showKids = !!f.children?.length && (f.expanded || !!kw || !!rt)
        if (topMatch) rows.push({ ...f, depth: 0, displayName: f.orphan ? `${f.parent} / ${f.name}` : f.name })
        if (showKids) for (const c of kids) rows.push({ ...c, depth: 1, displayName: `${f.name} / ${c.name}` })
    }
    return rows
})

const hasPackages = computed(() => files.value.some(f => f.children?.length))

const selectedCount = computed(() => Object.keys(selected.value).length)

function toggleSelect(row) {
    const next = { ...selected.value }
    if (next[row.url]) delete next[row.url]
    else next[row.url] = row
    selected.value = next
}

function selectAllVisible() {
    const next = { ...selected.value }
    for (const row of fileRows.value) next[row.url] = row
    selected.value = next
}

function clearSelection() {
    selected.value = {}
}

function togglePackage(row) {
    const target = files.value.find(f => f.url === row.url)
    if (target) target.expanded = !target.expanded
}

function toggleExpandAll() {
    expandAll.value = !expandAll.value
    for (const f of files.value) {
        if (f.children?.length) f.expanded = expandAll.value
    }
}

// ===== 下载 / 复制 / 浏览器打开 =====
function formatSize(bytes) {
    const n = Number(bytes) || 0
    if (n <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = n
    let i = 0
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
    return i === 0 ? `${v} ${units[i]}` : `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

function typeColor(label) {
    return TYPE_TONES[label] || '#64748b'
}

function typeBg(label) {
    const c = typeColor(label)
    return c + '1f'
}

async function downloadFile(row) {
    try {
        const res = await guishiyunDownload({
            url: row.url,
            name: row.name,
            bookName: selectedBook.value?.name || '桂师云资源'
        })
        if (res?.success) messageStore.success(`已加入下载：${row.name}`)
        else messageStore.error(res?.error || '下载失败')
    } catch (e) {
        messageStore.error('下载失败: ' + e.message)
    }
}

async function downloadSelected() {
    const items = Object.values(selected.value)
        .filter(f => f && f.url)
        .map(f => ({ url: f.url, name: f.name, bookName: selectedBook.value?.name || '桂师云资源' }))
    if (!items.length) return
    try {
        const res = await guishiyunDownloadBatch(items)
        if (res?.success) {
            messageStore.success(`已加入下载队列 ${res.added} 个文件${res.failed ? `，失败 ${res.failed} 个` : ''}`)
            selected.value = {}
        } else {
            messageStore.error(res?.error || '批量下载失败')
        }
    } catch (e) {
        messageStore.error('批量下载失败: ' + e.message)
    }
}

async function copyLink(row) {
    try {
        await navigator.clipboard.writeText(row.url)
        messageStore.success('直链已复制，可交给 aria2 / IDM')
    } catch (e) {
        messageStore.error('复制失败')
    }
}

async function previewFile(row) {
    const res = await guishiyunOpenUrl(row.url)
    if (!res?.success) messageStore.error(res?.error || '打开失败')
}

// ===== 初始化 =====
function init() {
    if (inited.value) return
    inited.value = true
    loginDoneUn = onGuishiyunLoginDone(async () => {
        loggedIn.value = true
        showLoginTips.value = false
        messageStore.success('桂师云登录成功')
        loadEbookFlags()
        if (view.value === 'book' && selectedBook.value && selectedBook.value.id !== EXAM_ID) {
            loadEbookFor(selectedBook.value)
        }
    })
    loadLoginStatus()
    loadCatalog()
}

watch(() => props.active, (v) => {
    if (v) init()
    else nextTick(setupObserver)
}, { immediate: true })

onMounted(() => {
    if (props.active) init()
})

onUnmounted(() => {
    loginDoneUn?.()
    observer?.disconnect?.()
})
</script>

<template>
    <div class="gsy-view">
        <!-- 工具条：登录态 + 刷新 -->
        <div class="gsy-toolbar">
            <div class="gsy-brand">
                <GraduationCap :size="16" />
                <span class="brand-name">桂师云</span>
                <span class="brand-sub">广西师范大学出版社 · 教辅资源</span>
            </div>
            <div class="gsy-actions">
                <div v-if="loggedIn" class="login-capsule logged" @click="showLoginTips = !showLoginTips">
                    <span class="capsule-avatar"><KeyRound :size="12" /></span>
                    <span class="capsule-name">桂师云已登录</span>
                    <LogOut :size="12" style="cursor:pointer" @click.stop="handleLogout" />
                </div>
                <button v-else class="login-capsule" @click="handleLogin">
                    <KeyRound :size="13" /><span>登录桂师云</span>
                </button>
                <button class="refresh-btn" :disabled="loading" @click="refresh">
                    <RefreshCw :size="15" :class="{ spin: loading }" /><span>刷新</span>
                </button>
            </div>
        </div>

        <!-- 登录说明 / 手动令牌 -->
        <transition name="modal">
            <div v-if="showLoginTips" class="login-tips">
                <div class="tips-row">
                    <p class="tips-text">
                        登录桂师云后可获取配套电子书 PDF。<br />
                        请在打开的官方登录窗口中完成登录，程序会自动捕获登录 Cookie。
                    </p>
                    <button class="ghost-btn" @click="showManualToken = !showManualToken">
                        {{ showManualToken ? '收起' : '手动粘贴令牌' }}
                    </button>
                </div>
                <div v-if="showManualToken" class="manual-token">
                    <input v-model="manualToken" class="token-input" placeholder="粘贴 Cookie gsy-Token 的值" @keyup.enter="saveManualToken" />
                    <button class="primary-btn" @click="saveManualToken">保存并应用</button>
                </div>
                <button class="sheet-close" @click="showLoginTips = false"><X :size="14" /></button>
            </div>
        </transition>

        <!-- 目录视图 -->
        <template v-if="view === 'catalog'">
            <div class="filter-bar">
                <label class="filter-item">
                    <span>系列</span>
                    <CustomSelect class="gsy-drop" width="132" :options="seriesOpts" v-model="filters.series" placeholder="全部" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>学年</span>
                    <CustomSelect class="gsy-drop" width="100" :options="yearOpts" v-model="filters.year" placeholder="全部" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>学科</span>
                    <CustomSelect class="gsy-drop" width="116" :options="subjectOpts" v-model="filters.subject" placeholder="全部" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>年级</span>
                    <CustomSelect class="gsy-drop" width="128" :options="gradeOpts" v-model="filters.grade" placeholder="全部" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>资源类型</span>
                    <CustomSelect class="gsy-drop" width="128" :options="restypeOpts" v-model="filters.restype" placeholder="全部" compact @change="onFilterChange" />
                </label>
                <div class="filter-search">
                    <Search :size="14" />
                    <input v-model="searchText" placeholder="搜索教辅名称…" />
                </div>
                <span class="filter-count">共 {{ filteredBooks.length }} 本</span>
                <span class="stat-line">{{ statText }}</span>
                <button class="exam-btn" @click="openExam">中考真题</button>
            </div>

            <div v-if="loading" class="detail-loading"><Loader2 :size="28" class="spin" /></div>
            <div v-else-if="loadError" class="detail-empty">
                {{ loadError }}
                <button class="ghost-btn retry-btn" @click="refresh">重试</button>
            </div>
            <div v-else class="book-grid">
                <div v-for="b in visibleBooks" :key="b.id" class="book-card" @click="openBook(b)">
                    <div class="book-cover">
                        <img
                            v-if="b.coverUrl && !coverFailed[b.id]"
                            :src="b.coverUrl"
                            class="cover-img"
                            alt=""
                            referrerpolicy="no-referrer"
                            loading="lazy"
                            @error="onCoverError(b)"
                        />
                        <BookOpen v-else :size="34" class="cover-fallback" />
                        <span v-if="ebookIds[b.id]" class="ebook-badge">电子书</span>
                    </div>
                    <div class="book-info">
                        <p class="book-title" :title="b.name">{{ b.name }}</p>
                        <p class="book-tags">
                            <span v-if="b.series">{{ b.series }}</span>
                            <span v-if="b.year">{{ b.year }}</span>
                            <span v-if="b.grade">{{ b.grade }}</span>
                        </p>
                        <p class="book-stat" :title="statOf(b.id)?.text || ''">
                            {{ statOf(b.id) ? (statOf(b.id).total ? `${statOf(b.id).total} 个资源` : '无资源') : '统计中…' }}
                        </p>
                    </div>
                </div>
                <div v-if="!filteredBooks.length" class="detail-empty">没有匹配的教辅</div>
                <div v-if="visibleBooks.length && visibleBooks.length < filteredBooks.length" ref="sentinel" class="list-more">
                    <Loader2 :size="16" class="spin" /> 已加载 {{ visibleBooks.length }} / {{ filteredBooks.length }}，继续滚动加载…
                </div>
            </div>
        </template>

        <!-- 单本书资源清单 -->
        <template v-else>
            <div class="reader-toolbar">
                <button class="back-btn" @click="backToCatalog"><ChevronLeft :size="16" /> 返回桂师云</button>
                <div class="reader-title" :title="selectedBook?.name">{{ selectedBook?.name }}</div>
                <div class="reader-tools">
                    <span v-if="selectedBook?.series && !selectedBook?.exam" class="meta-chip">{{ selectedBook.series }}</span>
                    <span v-if="selectedBook?.grade && !selectedBook?.exam" class="meta-chip">{{ selectedBook.grade }}</span>
                    <span v-if="selectedBook?.subject && !selectedBook?.exam" class="meta-chip">{{ selectedBook.subject }}</span>
                    <button
                        v-if="selectedBook && selectedBook.id !== EXAM_ID"
                        class="ebook-btn"
                        :disabled="ebookDisabled"
                        :title="ebookLabel"
                        @click="handleEbookClick"
                    >
                        <FileText :size="14" /> {{ ebookLabel }}
                    </button>
                </div>
            </div>

            <div class="file-toolbar">
                <CustomSelect class="gsy-drop" width="132" :options="fileRestypeOpts" v-model="fileRestype" placeholder="全部类型" compact />
                <div class="filter-search file-search">
                    <Search :size="14" />
                    <input v-model="fileSearch" placeholder="搜索资源名称…" />
                </div>
                <span class="filter-count">共 {{ fileRows.length }} 个资源</span>
                <div class="file-actions">
                    <button class="ghost-btn" @click="selectAllVisible">全选</button>
                    <button class="ghost-btn" @click="clearSelection">清空</button>
                    <button v-if="hasPackages" class="ghost-btn" @click="toggleExpandAll">
                        {{ expandAll ? '收起全部包' : '展开全部包' }}
                    </button>
                    <button class="primary-btn" :disabled="!selectedCount" @click="downloadSelected">
                        <Download :size="14" /> 下载所选{{ selectedCount ? `（${selectedCount}）` : '' }}
                    </button>
                </div>
            </div>

            <div v-if="filesLoading" class="detail-loading"><Loader2 :size="28" class="spin" /></div>
            <div v-else class="file-list">
                <div
                    v-for="(row, idx) in fileRows"
                    :key="row.url + ':' + idx"
                    class="file-row"
                    :class="{ inner: row.depth === 1 }"
                >
                    <SelectionMark :checked="!!selected[row.url]" :size="16" class="check-icon" @click.stop="toggleSelect(row)" />
                    <button v-if="row.children?.length" class="pkg-toggle" :class="{ open: row.expanded }" @click="togglePackage(row)">
                        <ChevronDown :size="14" />
                    </button>
                    <span v-else class="pkg-spacer"></span>
                    <span class="type-chip" :style="{ color: typeColor(row.restypeLabel), background: typeBg(row.restypeLabel) }">
                        {{ row.restypeLabel }}
                    </span>
                    <span class="file-name" :title="row.displayName || row.name">
                        <span v-if="row.depth === 1" class="tree-guide"></span>{{ row.name }}
                    </span>
                    <span v-if="row.packaged" class="pkg-badge">压缩包{{ row.children?.length ? ` · ${row.children.length} 个文件` : '' }}</span>
                    <span class="file-size">{{ formatSize(row.size) }}</span>
                    <button class="row-btn" title="复制直链" @click="copyLink(row)"><Copy :size="14" /></button>
                    <button class="row-btn" title="在浏览器打开" @click="previewFile(row)"><ExternalLink :size="14" /></button>
                    <button class="row-btn primary" title="下载" @click="downloadFile(row)"><Download :size="14" /></button>
                </div>
                <div v-if="!fileRows.length" class="detail-empty">没有匹配的资源</div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.gsy-view {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
}
.gsy-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}
.gsy-brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary, #18191c);
    font-size: 14px;
    font-weight: 600;
}
.brand-name { font-size: 15px; }
.brand-sub { font-size: 12px; font-weight: 400; color: var(--text-secondary, #9499a0); }
.gsy-actions { display: flex; align-items: center; gap: 8px; }

.login-capsule {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid #e5e6e7;
    border-radius: 16px;
    background: #fff;
    color: #666;
    font-size: 12px;
    cursor: pointer;
    transition: all .2s;
}
.login-capsule:hover { border-color: #6aa1ff; color: #6aa1ff; }
.login-capsule.logged { border-color: #6aa1ff; color: #6aa1ff; }
.capsule-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #6aa1ff;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.capsule-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.refresh-btn, .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 13px;
    border: 1px solid #e5e6e7;
    border-radius: 16px;
    background: #fff;
    color: #666;
    font-size: 12px;
    cursor: pointer;
    transition: all .2s;
}
.refresh-btn:hover, .ghost-btn:hover { border-color: #6aa1ff; color: #6aa1ff; }
.refresh-btn:disabled { opacity: .6; cursor: default; }
.spin { animation: rot 1s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }

.login-tips {
    position: relative;
    padding: 12px 40px 12px 16px;
    border: 1px solid #dbe8ff;
    border-radius: 10px;
    background: #f4f8ff;
    font-size: 12px;
}
.tips-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.tips-text { margin: 0; color: #444; flex: 1; min-width: 220px; line-height: 1.6; }
.manual-token { display: flex; gap: 8px; margin-top: 10px; }
.token-input {
    flex: 1;
    min-width: 180px;
    padding: 7px 10px;
    border: 1px solid #d9dee5;
    border-radius: 8px;
    font-size: 12px;
    outline: none;
}
.token-input:focus { border-color: #6aa1ff; }
.primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border: none;
    border-radius: 8px;
    background: #6aa1ff;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
}
.primary-btn:disabled { opacity: .55; cursor: default; }
.sheet-close {
    position: absolute;
    top: 8px;
    right: 8px;
    border: none;
    background: transparent;
    color: #999;
    cursor: pointer;
}

/* 筛选栏 */
.filter-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
}
.filter-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #666; }
.filter-item :deep(.custom-select) { width: auto; }
.filter-search {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid #e5e6e7;
    border-radius: 8px;
    background: #fff;
    color: #999;
    min-width: 170px;
}
.filter-search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: #333;
}
.filter-count { font-size: 12px; color: #8a9199; }
.stat-line { font-size: 12px; color: #8a9199; }
.exam-btn {
    margin-left: auto;
    padding: 6px 14px;
    border: 1px solid #f0d9d9;
    border-radius: 16px;
    background: #fff7f7;
    color: #d9534f;
    font-size: 12px;
    cursor: pointer;
    transition: all .2s;
}
.exam-btn:hover { border-color: #dc2626; color: #b91c1c; background: #fff1f1; }

/* 教辅网格 */
.book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 14px;
}
.book-grid > .detail-empty {
    grid-column: 1 / -1;
}
.book-card {
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
}
.book-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, .08); }
.book-cover {
    position: relative;
    aspect-ratio: 3 / 4;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f2f4f7;
    overflow: hidden;
}
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-fallback { color: #c3c9d1; }
.ebook-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 2px 7px;
    border-radius: 9px;
    background: rgba(34, 197, 94, .92);
    color: #fff;
    font-size: 10px;
    line-height: 16px;
}
.book-info { padding: 8px 10px 10px; }
.book-title {
    margin: 0 0 4px;
    font-size: 12.5px;
    font-weight: 600;
    color: #222;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 34px;
}
.book-tags { display: flex; gap: 4px; flex-wrap: wrap; margin: 0 0 4px; }
.book-tags span {
    padding: 1px 6px;
    border-radius: 6px;
    background: #f2f5f9;
    color: #7b8494;
    font-size: 10.5px;
}
.book-stat {
    margin: 0;
    font-size: 10.5px;
    color: #9aa1aa;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* 阅读/清单工具条 */
.reader-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
}
.back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: 1px solid #e5e6e7;
    border-radius: 8px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
}
.back-btn:hover { border-color: #6aa1ff; color: #6aa1ff; }
.reader-title {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    color: #222;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.reader-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.meta-chip {
    padding: 2px 8px;
    border-radius: 9px;
    background: #f2f5f9;
    color: #7b8494;
    font-size: 11px;
}
.ebook-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid #cfe0ff;
    border-radius: 8px;
    background: #f4f8ff;
    color: #3a72d8;
    font-size: 12px;
    cursor: pointer;
}
.ebook-btn:disabled { opacity: .65; cursor: default; }

.file-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
}
.file-search { min-width: 200px; }
.file-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }

.file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
}
.file-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    transition: background .15s;
}
.file-row:hover { background: #f7f9fc; }
.file-row.inner { margin-left: 26px; background: #fbfcfe; }
.check-icon { color: #c3c9d1; cursor: pointer; flex-shrink: 0; }
.check-icon.active { color: #6aa1ff; }
.pkg-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: #8a9199;
    cursor: pointer;
    transition: transform .15s;
}
.pkg-toggle.open { transform: rotate(180deg); }
.pkg-spacer { width: 20px; flex-shrink: 0; }
.type-chip {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 8px;
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
}
.file-name {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: #333;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.tree-guide {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 2px;
    border-left: 1px solid #d9e0ea;
    border-bottom: 1px solid #d9e0ea;
    border-bottom-left-radius: 4px;
    vertical-align: middle;
}
.pkg-badge {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 7px;
    background: #eef3fb;
    color: #5b7aa8;
    font-size: 10.5px;
    white-space: nowrap;
}
.file-size { flex-shrink: 0; font-size: 11px; color: #9aa1aa; min-width: 52px; text-align: right; }
.row-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid #e8ebef;
    border-radius: 7px;
    background: #fff;
    color: #7b8494;
    cursor: pointer;
    transition: all .15s;
}
.row-btn:hover { border-color: #6aa1ff; color: #6aa1ff; }
.row-btn.primary { border-color: #cfe0ff; background: #f4f8ff; color: #3a72d8; }
.row-btn.primary:hover { background: #e8f1ff; }

.detail-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #8a9199;
}
.detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 50px 0;
    color: #8a9199;
    font-size: 13px;
}
.retry-btn { padding: 4px 10px; }
.list-more {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 0;
    color: #9aa1aa;
    font-size: 12px;
}
.modal-enter-active, .modal-leave-active { transition: opacity .18s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
