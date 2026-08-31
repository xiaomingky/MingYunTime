<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { smartEduCatalog, smartEduDetail, smartEduPreview, smartEduAudios, smartEduLoginOpen, smartEduLoginStatus, smartEduLoginManual, smartEduTestToken, smartEduLogout, smartEduDownloadPdf, smartEduDownloadAudio, smartEduProbeAudio, smartEduFetchImage, onSmartEduLoginDone } from '../api'
import { useMessageStore } from '../store/message'
import CustomSelect from '../components/CustomSelect.vue'
import { ChevronLeft, BookOpen, Download, LogOut, Search, Loader2, FileText, Headphones, RefreshCw, KeyRound, X, ZoomIn, Highlighter, Eraser, Play, Pause, Trash2, Maximize, Minimize, CheckSquare, Square, GripVertical, Move } from 'lucide-vue-next'

defineOptions({ name: 'SmartEduTextbook' })

const messageStore = useMessageStore()

// ===== 登录态 =====
const loggedIn = ref(false)
const userName = ref('')
const showLoginTips = ref(false)

async function loadLoginStatus() {
    try {
        const res = await smartEduLoginStatus()
        if (res?.success) {
            loggedIn.value = !!res.loggedIn
            userName.value = res.userName || ''
        }
    } catch (e) {}
}
// 登录窗口捕获到令牌后自动刷新登录态
let loginDoneUn = null
onMounted(() => {
    loginDoneUn = onSmartEduLoginDone(async (data) => {
        loggedIn.value = true
        userName.value = data?.userName || '已登录用户'
        messageStore.success('智慧教育登录成功')
        await loadCatalog()
    })
    document.addEventListener('fullscreenchange', onFsChange)
    loadLoginStatus()
    loadCatalog()
    // 列表触底自动加载更多（分页渲染避免一次性渲染几千卡片）
    loadMoreObserver = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting) && visibleBooks.value.length < books.value.length) {
            loadMore()
        }
    }, { root: null, rootMargin: '200px 0px' })
    nextTick(() => {
        if (loadMoreSentinel.value && loadMoreObserver) loadMoreObserver.observe(loadMoreSentinel.value)
    })
    // 筛选/搜索后 DOM 重建，需重新观察触底哨兵
    const rewatchSentinel = () => nextTick(() => {
        loadMoreObserver?.disconnect?.()
        if (loadMoreSentinel.value) loadMoreObserver?.observe?.(loadMoreSentinel.value)
    })
    watch(visibleBooks, rewatchSentinel)
    watch(books, rewatchSentinel)
})
onUnmounted(() => {
    loginDoneUn?.()
    loadMoreObserver?.disconnect()
    document.removeEventListener('fullscreenchange', onFsChange)
})

async function handleLogin() {
    try {
        const res = await smartEduLoginOpen()
        if (res?.success) messageStore.info('请在打开的登录窗口完成登录，登录成功后自动生效')
        else messageStore.error(res?.error || '打开登录窗口失败')
    } catch (e) {
        messageStore.error('打开登录窗口失败: ' + e.message)
    }
}

const showManualToken = ref(false)
const manualToken = ref('')
async function saveManualToken() {
    const raw = manualToken.value.trim()
    if (!raw) { messageStore.error('请输入令牌'); return }
    const res = await smartEduLoginManual(raw)
    if (res?.success) {
        showManualToken.value = false
        manualToken.value = ''
        messageStore.success('已保存令牌')
        await loadLoginStatus()
    } else {
        messageStore.error(res?.error || '保存失败')
    }
}

async function handleLogout() {
    await smartEduLogout()
    loggedIn.value = false
    userName.value = ''
    messageStore.success('已退出登录')
}

// ===== 教材目录 =====
const allBooks = ref([])
const books = ref([])
const loading = ref(false)
// 分页渲染：目录可能几千本，一次性渲染 3841 个卡片 + 封面图会导致界面卡顿、内存暴涨
const PAGE_STEP = 60
const pageSize = ref(PAGE_STEP)
const visibleBooks = computed(() => books.value.slice(0, pageSize.value))
let loadMoreObserver = null
const loadMoreSentinel = ref(null)
function loadMore() {
    if (pageSize.value < books.value.length) {
        pageSize.value = Math.min(pageSize.value + PAGE_STEP, books.value.length)
    }
}
function resetPaging() {
    pageSize.value = PAGE_STEP
}

// 级联筛选选项（用 Set 去重，保留目录顺序 → 排序显示）
const filters = {
    stage: ref(''), subject: ref(''), version: ref(''), grade: ref(''), term: ref('')
}
const searchText = ref('')

// 级联选项：下一个下拉的候选项 = 上一级已选维度过滤后的书集合
const stageList = computed(() => opts(allBooks.value.map(b => b.stage)))
const subjectList = computed(() => opts(filterBase('stage').map(b => b.subject)))
const versionList = computed(() => opts(filterBase(['stage', 'subject']).map(b => b.version)))
const gradeList = computed(() => opts(filterBase(['stage', 'subject', 'version']).map(b => b.grade)))
const termList = computed(() => opts(filterBase(['stage', 'subject', 'version', 'grade']).map(b => b.term)))

// 按前 n 级已选维度过滤（用于派生下一级候选项）
function filterBase(steps) {
    const keys = Array.isArray(steps) ? steps : [steps]
    const active = (k) => filters[k].value
    return allBooks.value.filter(b => {
        for (const k of keys) {
            if (active(k) && b[k] !== active(k)) return false
        }
        return true
    })
}

function opts(values) {
    const seen = new Set()
    const arr = []
    for (const v of values) {
        if (v && !seen.has(v)) { seen.add(v); arr.push(v) }
    }
    return arr.sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function filterBooks() {
    return filterBase(['stage', 'subject', 'version', 'grade', 'term'])
}

function applyFilter() {
    let q = filterBooks()
    const kw = searchText.value.trim()
    if (kw) q = q.filter(b => (b.title || '').includes(kw))
    books.value = q
    resetPaging()
}

function onFilterChange() {
    // 级联：下层已选值若已不在新候选中则重置
    const resetIfMissing = (key) => {
        if (!filters[key].value) return
        const ok = filterBase(siblingKeys(key)).some(b => b[key] === filters[key].value)
        if (!ok) filters[key].value = ''
    }
    resetIfMissing('subject')
    resetIfMissing('version')
    resetIfMissing('grade')
    resetIfMissing('term')
    applyFilter()
}

// 级联顺序：学段→学科→版本→年级→册次
const cascadeKeys = ['stage', 'subject', 'version', 'grade', 'term']

// CustomSelect options（首项"全部"）
function selectOpts(list) {
    const opts = [{ value: '', label: '全部' }]
    for (const v of list) opts.push({ value: v, label: String(v) })
    return opts
}
// 选项数组缓存为 computed：引用稳定，CustomSelect 的 normalizedOptions 才能命中缓存，
// 避免每次打开下拉都全量重建大数组
const stageOpts = computed(() => selectOpts(stageList.value))
const subjectOpts = computed(() => selectOpts(subjectList.value))
const versionOpts = computed(() => selectOpts(versionList.value))
const gradeOpts = computed(() => selectOpts(gradeList.value))
const termOpts = computed(() => selectOpts(termList.value))
function siblingKeys(key) {
    const idx = cascadeKeys.indexOf(key)
    return cascadeKeys.slice(0, idx)
}

async function loadCatalog() {
    loading.value = true
    try {
        const res = await smartEduCatalog()
        if (res?.success) {
            allBooks.value = res.data || []
            applyFilter()
        } else {
            messageStore.error(res?.error || '教材目录加载失败')
        }
    } catch (e) {
        messageStore.error('教材目录加载失败: ' + e.message)
    } finally {
        loading.value = false
    }
}

// ===== 教材详情/阅读 =====
const selectedBook = ref(null)
const detail = ref(null)
const loadingDetail = ref(false)
const previewImages = ref([])
const pageCount = ref(0)
const currentImage = ref('')
const pageLoading = ref(false)   // 当前页图片正在载入（占位态，不再直出 CDN URL 避免 403）
const pageFail = ref(false)      // 当前页加载失败（展示重试）
const imagesLoading = ref(false)
const audios = ref([])
const audiosLoading = ref(false)

function openBook(book) {
    imgGen++ // 使旧教材仍在途的取图任务失效，防止串用缓存
    selectedBook.value = book
    detail.value = null
    previewImages.value = []
    pageCount.value = 0
    void loadDetail(book)
}

async function loadDetail(book) {
    loadingDetail.value = true
    audios.value = []
    audioSelected.value = []
    try {
        const res = await smartEduDetail(book.id)
        if (res?.success) {
            detail.value = res.data
            pageCount.value = res.data.pageCount || 0
            if (res.data.previewDir && pageCount.value > 0) {
                imagesLoading.value = true
                const pv = await smartEduPreview(book.id)
                if (pv?.success && pv.data?.images?.length) {
                    previewImages.value = pv.data.images
                    curPageIdx.value = 1
                    currentImage.value = ''
                    // 后台就近预热整本 + 首屏取图（IPC 主进程下载转 dataURL，杜绝渲染进程直连 CDN 的 403）
                    startWarmup()
                    loadPageFor(0)
                }
                imagesLoading.value = false
            }
            // 异步拉音频
            void loadAudios(book.id)
        } else {
            messageStore.error(res?.error || '教材详情失败')
        }
    } catch (e) {
        messageStore.error('教材详情失败: ' + e.message)
    } finally {
        loadingDetail.value = false
    }
}

async function loadAudios(contentId) {
    audiosLoading.value = true
    try {
        const res = await smartEduAudios(contentId)
        if (res?.success) audios.value = res.data || []
    } catch (e) {} finally {
        audiosLoading.value = false
    }
}

function closeBook() {
    stopAudio()
    selectedBook.value = null
    annotations.clear()
    resetView()
    currentImage.value = ''
    pageLoading.value = false
    pageFail.value = false
    clearTimeout(pageLoadTimer)
    imgGen++ // 使在途取图任务失效 → 不再写入本教材缓存，避免跨教材串用
    pageCache.clear()
    inflight.clear()
}

// ===== 预览图翻页 =====

// ===== 预览工具栏：可拖动悬浮（默认钉在顶部，按住手柄拖动，双击复位） =====
// 浮动定位相对预览容器（.page-preview）而非视口：全屏预览时坐标基准统一，
// 避免 position:fixed 在全屏元素内定位/事件异常导致「全屏后拖不动工具栏」。
const toolbarPos = ref({ x: null, y: null })
let toolbarDrag = null
function onToolbarDragStart(e) {
    if (e.button !== 0) return
    // 拖动手柄或工具栏空白处可拖动；其余按钮（工具/缩放/全屏等）保持点击行为
    const handle = e.target.closest('.drag-handle')
    if (!handle && e.target.closest('button, input, select')) return
    e.preventDefault()
    const box = previewBoxRef.value
    if (!box) return
    const br = box.getBoundingClientRect()
    const r = e.currentTarget.getBoundingClientRect()
    toolbarPos.value = { x: r.left - br.left, y: r.top - br.top }
    toolbarDrag = {
        sx: e.clientX, sy: e.clientY,
        ox: r.left - br.left, oy: r.top - br.top,
        w: r.width, boxW: br.width, boxH: br.height
    }
    window.addEventListener('mousemove', onToolbarDragMove)
    window.addEventListener('mouseup', onToolbarDragEnd)
}
function onToolbarDragMove(e) {
    if (!toolbarDrag) return
    const { ox, oy, w, sx, sy, boxW, boxH } = toolbarDrag
    const x = Math.max(4, Math.min(boxW - w - 4, ox + (e.clientX - sx)))
    const y = Math.max(4, Math.min(boxH - 44, oy + (e.clientY - sy)))
    toolbarPos.value = { x, y }
}
function onToolbarDragEnd() {
    toolbarDrag = null
    window.removeEventListener('mousemove', onToolbarDragMove)
    window.removeEventListener('mouseup', onToolbarDragEnd)
}
function resetToolbarPos() { toolbarPos.value = { x: null, y: null } }
// 当前页码：curPageIdx 为 1-based 唯一真相源（currentImage 可能是内存缓存的 dataURL，不能再用 indexOf 定位）
const currentPage = computed(() => curPageIdx.value)
function setImage(n, animate = true) {
    if (n < 1 || n > previewImages.value.length || n === currentPage.value) return
    const dir = n > currentPage.value ? 1 : -1
    curPageIdx.value = n
    showLens.value = false
    resetView()
    // 显示源：内存缓存 dataURL 秒显；未命中则进入占位载入态（不再直出 CDN URL，避免 403 破图），
    // 取图完成后仍在本页时无缝替换。跳页期间后台就近预热会先把目标页「攒」进内存/磁盘，连续翻页基本全命中。
    const idx = n - 1
    const cached = pageCache.get(idx)
    if (cached) {
        currentImage.value = cached
        pageLoading.value = false
        pageFail.value = false
    } else {
        currentImage.value = ''
        loadPageFor(idx)
    }
    if (animate) {
        // 翻页滑入动画：新页先从对侧进入起点，下一帧再滑到 0
        slideX.value = -dir * 60
        setPaneTransition('transform .18s ease')
        nextTick(() => requestAnimationFrame(() => { slideX.value = 0 }))
    } else {
        // 滑块拖动/数字键盘定位：即时切换，不做位移动画，保证跟手
        slideX.value = 0
        setPaneTransition('none')
        nextTick(() => { setPaneTransition('transform .18s ease') })
    }
}

// 底部滑块：拖动自由跳转到任意页（即时切换，无动画延迟）
function onSliderInput(e) {
    setImage(Number(e.target.value), false)
}

// 页码指示器 → 小数字键盘精准跳转
const showNumpad = ref(false)
const numpadValue = ref('')
let numpadDirty = false
function openNumpad() {
    if (showNumpad.value) { showNumpad.value = false; return } // 再点一次关闭
    numpadValue.value = String(currentPage.value)
    numpadDirty = false
    showNumpad.value = true
}
function numpadKey(k) {
    if (k === 'go') { numpadGo(); return }
    if (k === 'back') {
        if (numpadDirty) {
            numpadValue.value = numpadValue.value.slice(0, -1)
            if (!numpadValue.value) numpadDirty = false
        }
        return
    }
    if (!numpadDirty) {
        if (k === '0') return // 首位 0 无意义
        numpadValue.value = k
        numpadDirty = true
        return
    }
    if (numpadValue.value.length < 4) numpadValue.value += k
}
function numpadGo() {
    if (!showNumpad.value) return
    showNumpad.value = false
    const n = parseInt(numpadValue.value, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= previewImages.value.length) setImage(n)
}

// ===== 预览工具：放大镜 / 笔记 / 橡皮擦 / 长按拖动 =====
const activeTool = ref('') // '' | 'mag' | 'pen' | 'eraser'
const zoom = ref(1)
// 平移画布「始终最新」偏移：拖动期间直接写 DOM style（不经 Vue 响应式渲染 → 逐帧 0 重渲染，彻底消除拖动卡顿），
// paneTransform() 同步读取 —— 拖动中即使其他状态变化触发重渲染，也不会用旧值覆盖当前手势位置
const livePan = { x: 0, y: 0 }
let panStartX = 0, panStartY = 0 // 本次手势平移起点快照（基于 down 坐标算总量，避免逐帧累计漂移）
function applyPaneStyle() {
    const el = paneRef.value
    if (el) el.style.transform = `translate(${livePan.x + slideX.value}px, ${livePan.y}px) scale(${zoom.value})`
}
function setPaneTransition(t) {
    paneTransition.value = t
    const el = paneRef.value
    if (el) el.style.transition = t // 同步写 DOM：Vue 的 ref 写入要等微任务才落 DOM，慢半拍会被 .18s 过度动画拖成粘滞
}
const showLens = ref(false)
const lensStyle = ref({})
const stageRef = ref(null)
const paneRef = ref(null)
const canvasRef = ref(null)
const imgRef = ref(null)
const imgW = ref(0)
const imgH = ref(0)
const curPageIdx = ref(1)
const MAG = 2.6 // 放大镜倍率
// 每页笔记笔画：pageIdx -> [{ tool, color, width, points: [{x,y}] }]
const annotations = new Map()

const toolHint = computed(() => {
    if (activeTool.value === 'mag') return '放大镜：悬停查看细节 · 按住拖动查看图片位置'
    if (activeTool.value === 'drag') return '拖动：按住左键拖动页面位置（放大后浏览细节）'
    if (activeTool.value === 'pen') return '笔记：按住拖动书写标注'
    if (activeTool.value === 'eraser') return '橡皮擦：按住拖动擦除笔记'
    return zoom.value > 1 ? '已放大：按住左键拖动查看图片位置 · 滚轮缩放' : '拖动底部滑块自由跳页 · 点击右上角页码用数字键盘精确跳转'
})

// —— 翻页位移动画状态 ——
// slideX：翻页滑入动画的起点位移（新页从对侧滑入）
// paneTransition：缩放/平移拖动时禁过渡（跟手），松手恢复 ease 让滑入/回弹平滑
const slideX = ref(0)
const paneTransition = ref('transform .18s ease')

function paneTransform() {
    return `translate(${livePan.x + slideX.value}px, ${livePan.y}px) scale(${zoom.value})`
}

// —— 预览图缓存体系（内存 dataURL LRU + 主进程磁盘缓存）——
// 智教 CDN 对渲染进程的 `new Image()` 请求返回 403（且坏响应会污染 HTTP 缓存，实测 Node 层同 URL 全 200），
// 因此所有图片一律经主进程 IPC 下载（主进程还带磁盘缓存，二次命中原生读盘）转 dataURL。
// 命中内存/磁盘即秒显 → 翻页秒级；配合后台就近预热整本，任意跳页基本一触即达。
// 内存控制：LRU 上限 16 张（约 1MB/张 ≈ 16MB），其余页全落在磁盘缓存，极致压缩内存。
const pageCache = new Map()     // 页码 idx(0-based) -> dataURL（LRU）
const inflight = new Map()      // idx -> Promise（并发去重：同一页只发起一次 IPC 取图）
const WARM_POOL = 2             // 后台预热并发数：并发过多会触发 CDN 防护，串行又太慢，取 2 平衡
let imgGen = 0                  // 教材代次：切书/关书后使在途取图任务失效，防止缓存串用
let warmSeq = 0                 // 预热代次
let warmRunning = 0
let pageLoadTimer = null

// 由主进程下载一页图片 → 缓存为 dataURL；同一 idx 并发去重（返回同一个 Promise）
function fetchPageData(idx) {
    const u = previewImages.value[idx]
    if (!u || /^data:/i.test(u) || pageCache.has(idx)) return Promise.resolve(pageCache.has(idx) ? idx : null)
    if (inflight.has(idx)) return inflight.get(idx)
    const gen = imgGen
    const p = smartEduFetchImage(u).then((res) => {
        inflight.delete(idx)
        if (gen !== imgGen) return null // 已切换/关闭教材，丢弃结果
        if (res?.ok && res.b64) {
            pageCache.set(idx, `data:${res.mime || 'image/jpeg'};base64,${res.b64}`)
            trimPageCache()
            return idx
        }
        return null
    }).catch(() => { inflight.delete(idx); return null })
    inflight.set(idx, p)
    return p
}
function trimPageCache() {
    while (pageCache.size > 16) {
        const first = pageCache.keys().next().value
        if (first == null) break
        pageCache.delete(first)
    }
}

// 当前页取图（带 120ms 防抖：滑块快速拖动时只对最终落点发请求，避免一次拖拽并发十几张触发 CDN 防护）
// 取图完成后若仍在本页则无缝替换；失败则保持占位态并提供重试
function loadPageFor(idx, immediate = false) {
    if (idx < 0 || idx >= previewImages.value.length) return
    pageFail.value = false
    pageLoading.value = true
    const doFetch = () => {
        fetchPageData(idx).then((fidx) => {
            if (currentPage.value - 1 !== idx) return // 已跳去其他页，等缓存命中时再秒显
            if (fidx !== null && pageCache.has(idx)) {
                currentImage.value = pageCache.get(idx)
                pageLoading.value = false
            } else {
                pageFail.value = true // 保持 pageLoading=true，展示失败重试而非「无预览图」
            }
        })
    }
    clearTimeout(pageLoadTimer)
    if (immediate) doFetch()
    else pageLoadTimer = setTimeout(doFetch, 120)
}

// 后台就近预热整本：WARM_POOL 个工人持续取「距当前页最近且未加载」的页。
// 用户无论跳到哪，目标页大概率已被预热 → 命中内存/磁盘缓存，跳转无感。
function startWarmup() {
    warmSeq++
    const seq = warmSeq
    const needed = WARM_POOL - warmRunning
    for (let i = 0; i < needed; i++) {
        warmRunning++
        warmWorker(seq).finally(() => warmRunning--)
    }
}
function nextWarmIdx() {
    const list = previewImages.value
    if (!list.length) return -1
    const cur = currentPage.value - 1
    let best = -1, bestD = Infinity
    for (let i = 0; i < list.length; i++) {
        if (pageCache.has(i) || inflight.has(i)) continue
        const d = Math.abs(i - cur)
        if (d < bestD) { bestD = d; best = i }
    }
    return best
}
async function warmWorker(seq) {
    while (warmSeq === seq) {
        const i = nextWarmIdx()
        if (i < 0) break
        await fetchPageData(i)
    }
}

function setTool(t) {
    activeTool.value = activeTool.value === t ? '' : t
    showLens.value = false
    panning.value = false
}

function applyZoom(d) {
    zoom.value = Math.min(4, Math.max(0.6, Math.round((zoom.value + d) * 10) / 10))
    if (zoom.value === 1) { livePan.x = 0; livePan.y = 0 }
}
function resetView() {
    zoom.value = 1; livePan.x = 0; livePan.y = 0
}
function onStageWheel(e) {
    applyZoom(e.deltaY < 0 ? 0.2 : -0.2)
}

function onImgLoaded() {
    const img = imgRef.value
    if (!img) return
    imgW.value = img.clientWidth
    imgH.value = img.clientHeight
    const canvas = canvasRef.value
    if (canvas) {
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(imgW.value * dpr)
        canvas.height = Math.round(imgH.value * dpr)
        canvas.style.width = imgW.value + 'px'
        canvas.style.height = imgH.value + 'px'
        canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    redrawAnnotations()
}

// 鼠标相对画面（pane 变换后显示区域）映射到画布布局坐标
function eventPos(e) {
    const rect = paneRef.value?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    return {
        x: (e.clientX - rect.left) / rect.width * (imgW.value || rect.width),
        y: (e.clientY - rect.top) / rect.height * (imgH.value || rect.height)
    }
}

// ---- 绘制状态 ----
let drawing = false
const panning = ref(false)
let pressed = false
let longPressTimer = null
let activeStroke = null
let downX = 0, downY = 0
let downMoved = false

function paintSegment(s, p0, p1) {
    const ctx = canvasRef.value?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
}

// 预览容器全屏
const previewBoxRef = ref(null)
const isFullscreen = ref(false)
function toggleFullscreen() {
    const el = previewBoxRef.value
    if (!el) return
    try {
        if (document.fullscreenElement) document.exitFullscreen()
        else el.requestFullscreen?.()
    } catch (e) {}
}
function onFsChange() {
    isFullscreen.value = !!document.fullscreenElement
    // 全屏状态改变后画布/放大镜尺寸变化，重设画布
    nextTick(() => onImgLoaded())
}

function onStageDown(e) {
    if (e.button !== 0) return
    const pos = eventPos(e)
    if (!pos) return
    // 指针捕获：拖动过程中鼠标移出 pane/舞台也不会中断，避免"拖不动/半路停"
    try { e.currentTarget?.setPointerCapture?.(e.pointerId) } catch (err) {}
    downX = e.clientX; downY = e.clientY; downMoved = false
    pressed = true
    // 拖动过程禁过渡，保证图片跟手无粘滞（同步写 DOM，避免微任务延迟被 .18s 过渡拖慢）
    setPaneTransition('none')
    if (activeTool.value === 'pen' || activeTool.value === 'eraser') {
        drawing = true
        activeStroke = {
            tool: activeTool.value,
            // 橡皮擦 destination-out 混合只取源 alpha：必须用不透明色，alpha=0 时公式 dst*(1-0)=dst 什么都擦不掉
            color: activeTool.value === 'pen' ? '#EC4141' : '#000000',
            width: activeTool.value === 'pen' ? 3 : 22,
            points: [pos]
        }
        const strokes = annotations.get(curPageIdx.value) || []
        strokes.push(activeStroke)
        annotations.set(curPageIdx.value, strokes)
        return
    }
    if (activeTool.value === 'drag') {
        // 拖动工具：按住立即平移页面位置（不做画笔、不受长按等待，放大后浏览位置专用）
        panning.value = true
        panStartX = livePan.x; panStartY = livePan.y
        showLens.value = false
        return
    }
    // 放大镜/默认模式：长按（350ms 不移动）进入拖动位置
    longPressTimer = setTimeout(() => {
        if (zoom.value > 1 && pressed) {
            panning.value = true
            panStartX = livePan.x; panStartY = livePan.y
        }
    }, 350)
}

function onStageMove(e) {
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) downMoved = true
    // 画笔/橡皮擦绘制必须优先于「放大后拖动平移」：
    // 否则缩放超过 100% 时按住画笔，移动会被下方的平移分支抢走（panning → return），画不出线
    if (drawing && activeStroke) {
        const pos = eventPos(e)
        if (pos) {
            const pts = activeStroke.points
            const prev = pts[pts.length - 1]
            if (prev) paintSegment(activeStroke, prev, pos)
            pts.push(pos)
        }
        return
    }
    if (panning.value) {
        livePan.x = panStartX + (e.clientX - downX)
        livePan.y = panStartY + (e.clientY - downY)
        applyPaneStyle() // 直接写 DOM style：逐帧 0 次 Vue 重渲染，跟手不卡
        return
    }
    // 放大/缩小后，按下左键拖动即时生效（无需等 350ms，且不受 5px 阈值干扰）
    if (pressed && !drawing && zoom.value > 1 && downMoved && activeTool.value !== 'mag') {
        panning.value = true
        panStartX = livePan.x; panStartY = livePan.y
        showLens.value = false
        return
    }
    if (activeTool.value === 'mag') updateLens(e)
    else showLens.value = false
}

function onStageUp(e) {
    clearTimeout(longPressTimer)
    panning.value = false
    drawing = false
    pressed = false
    activeStroke = null
    // 恢复过渡：翻页滑入动画 / 未翻页回弹
    setPaneTransition('transform .18s ease')
    if (slideX.value !== 0) slideX.value = 0
}

function onStageLeave(e) {
    showLens.value = false
    // 拖动中（指针已被捕获到 pane）不在此中断，等 pointerup 统一收尾；仅空闲时复位
    if (!pressed) onStageUp()
}

function updateLens(e) {
    const stage = stageRef.value
    const pane = paneRef.value
    if (!stage || !pane) return
    const sRect = stage.getBoundingClientRect()
    const pRect = pane.getBoundingClientRect()
    const size = 180
    const sx = e.clientX - sRect.left
    const sy = e.clientY - sRect.top
    if (sx < 0 || sy < 0 || sx > sRect.width || sy > sRect.height || !pRect.width || !pRect.height) {
        showLens.value = false
        return
    }
    showLens.value = true
    const rx = (e.clientX - pRect.left) / pRect.width
    const ry = (e.clientY - pRect.top) / pRect.height
    // 顶部保留工具条高度，方便查看顶部区域
    const bgW = pRect.width * MAG
    const bgH = pRect.height * MAG
    lensStyle.value = {
        left: (sx - size / 2) + 'px',
        top: (sy - size / 2) + 'px',
        width: size + 'px',
        height: size + 'px',
        backgroundImage: `url("${currentImage.value}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${-(rx * bgW - size / 2)}px ${-(ry * bgH - size / 2)}px`
    }
}

function redrawAnnotations() {
    const canvas = canvasRef.value
    if (!canvas || !imgW.value) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, imgW.value, imgH.value)
    const strokes = annotations.get(curPageIdx.value) || []
    for (let i = 0; i < strokes.length; i++) {
        const s = strokes[i]
        ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over'
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const pts = s.points
        ctx.beginPath()
        pts.forEach((p, idx) => (idx ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
}

function clearAnnotations() {
    annotations.delete(curPageIdx.value)
    redrawAnnotations()
    messageStore.info('已清空本页笔记')
}

// ===== 音频播放 =====
let audioEl = null
// 暂停状态独立记录：playingIdx 只表示"当前是第几个音频"，暂停后图标要切回播放
const audioPaused = ref(false)
const playingIdx = ref(-1)
function ensureAudio() {
    if (!audioEl) audioEl = new Audio()
    // 播放/暂停事件反向同步图标状态（含切集、加载失败等所有路径）
    audioEl.onplay = () => { audioPaused.value = false }
    audioEl.onpause = () => { audioPaused.value = true }
}
function stopAudio() {
    if (audioEl) { audioEl.pause(); audioEl.src = '' }
    playingIdx.value = -1
}
async function togglePlay(a, i) {
    const url = a.mp3Url || a.oggUrl
    if (!url) { messageStore.error('该音频无可播放地址'); return }
    ensureAudio()
    if (playingIdx.value === i && !audioEl.paused) { audioEl.pause(); return }
    // 播放前先探测该 URL 的认证方式（匿名 / X-Nd-Auth / Authorization）。
    // 探测成功后主进程会在 mediaAuthMap 里记录正确认证头，后续 <audio> 请求自动注入，避免 403
    const probe = await smartEduProbeAudio(url)
    if (!probe?.success) {
        messageStore.error('音频播放失败：未获取到播放权限（令牌可能已失效，请点「测试令牌」验证或重新登录）')
        return
    }
    audioEl.onerror = () => { messageStore.error('音频加载失败（403：令牌可能已失效，请点「测试令牌」验证或重新登录）'); playingIdx.value = -1 }
    audioEl.onended = () => { playingIdx.value = -1 }
    if (playingIdx.value !== i) { audioEl.pause(); audioEl.currentTime = 0; audioEl.src = url }
    playingIdx.value = i
    audioPaused.value = false
    try { audioEl.play().catch(() => {}) } catch (e) {}
}

// ===== 音频批量选择下载 =====
const audioSelected = ref([])
const allAudioSelected = computed(() => audios.value.length > 0 && audioSelected.value.length === audios.value.length)
function toggleAudioSelect(i) {
    audioSelected.value = audioSelected.value.includes(i)
        ? audioSelected.value.filter(x => x !== i)
        : [...audioSelected.value, i]
}
function toggleSelectAllAudios() {
    audioSelected.value = allAudioSelected.value ? [] : audios.value.map((_, i) => i)
}
async function downloadOneAudio(a) {
    if (!loggedIn.value) { messageStore.error('下载音频需要登录，请先登录'); return }
    const url = a.mp3Url || a.oggUrl
    if (!url) return
    const res = await smartEduDownloadAudio(url, `${selectedBook.value.title}_${a.title || '音频'}`)
    if (res?.success) messageStore.success('已加入下载队列，请到「下载」页查看')
    else if (res?.error && !res?.success) messageStore.error(res.error)
}
async function downloadSelectedAudios() {
    if (!audioSelected.value.length) { messageStore.error('请先勾选要下载的音频'); return }
    if (!loggedIn.value) { messageStore.error('下载音频需要登录，请先登录'); return }
    let ok = 0
    for (const i of audioSelected.value) {
        const a = audios.value[i]
        const url = a.mp3Url || a.oggUrl
        if (!url) continue
        const res = await smartEduDownloadAudio(url, `${selectedBook.value.title}_${a.title || '音频'}`)
        if (res?.success) ok++
    }
    messageStore.success(ok ? `已加入 ${ok} 个音频下载队列，请到「下载」页查看` : '没有可下载的音频')
}

async function downloadPdf() {
    if (!loggedIn.value) { messageStore.error('下载 PDF 需要登录，请先登录'); return }
    const res = await smartEduDownloadPdf(selectedBook.value.id, selectedBook.value.title)
    if (res?.success) {
        messageStore.success('已加入下载队列，请到「下载」页查看')
    } else {
        messageStore.error(res?.error || '下载失败，请检查登录令牌是否有效')
    }
}

async function testToken() {
    const res = await smartEduTestToken()
    if (res?.success) {
        messageStore[res.valid ? 'success' : 'error'](res.valid ? '令牌有效，可下载 PDF' : '令牌已失效，请重新登录')
    } else {
        messageStore.error(res?.error || '测试失败')
    }
}

function fmtCount(n) {
    return Number(n) || 0
}
</script>

<template>
    <div class="smart-edu-view">
        <!-- 页头 -->
        <div class="page-header">
            <h2 class="page-title">
                <BookOpen :size="20" /> 智慧教材
                <span class="sub">国家中小学智慧教育平台</span>
            </h2>
            <div class="header-actions">
                <!-- 登录态胶囊 -->
                <div v-if="loggedIn" class="login-capsule logged" @click="showLoginTips = !showLoginTips">
                    <span class="capsule-avatar"><KeyRound :size="12" /></span>
                    <span class="capsule-name">{{ userName }}</span>
                    <LogOut :size="12" @click.stop="handleLogout" style="cursor:pointer" />
                </div>
                <button v-else class="login-capsule" @click="handleLogin">
                    <KeyRound :size="13" /><span>智慧教育登录</span>
                </button>
                <button class="refresh-btn" @click="loadCatalog" :disabled="loading">
                    <RefreshCw :size="15" :class="{ spin: loading }" /><span>刷新</span>
                </button>
            </div>
        </div>

        <!-- 登录提示 / 手动粘贴 -->
        <transition name="modal">
        <div v-if="showLoginTips || showManualToken" class="login-tips sheet" @click.stop>
            <div class="tips-row">
                <p class="tips-text">
                    登录后可使用「下载 PDF / 音频」功能。<br />
                    请在打开的官方登录窗口中完成登录，程序会自动从请求头捕获令牌。
                </p>
                <button class="ghost-btn" @click="showManualToken = !showManualToken">{{ showManualToken ? '收起' : '手动粘贴令牌' }}</button>
                <button class="ghost-btn" @click="testToken">测试令牌</button>
            </div>
            <div v-if="showManualToken" class="manual-token">
                <input v-model="manualToken" class="token-input" placeholder="粘贴 X-Nd-Auth 或 Authorization: MAC ... 的令牌内容" @keyup.enter="saveManualToken" />
                <button class="primary-btn" @click="saveManualToken">保存并应用</button>
            </div>
            <button class="sheet-close" @click="showLoginTips = false; showManualToken = false"><X :size="14" /></button>
        </div>
        </transition>

        <!-- 阅读视图 -->
        <template v-if="selectedBook">
            <div
                class="reader-toolbar"
            >
                <button class="back-btn" @click="closeBook"><ChevronLeft :size="16" /> 返回教材库</button>
                <div class="reader-title">{{ selectedBook.title }}</div>
                <div class="reader-tools">
                    <button class="pdf-btn" @click="downloadPdf" :disabled="!loggedIn">
                        <Download :size="15" /> 下载 PDF{{ loggedIn ? '' : '（需登录）' }}
                    </button>
                </div>
            </div>

            <div v-if="loadingDetail" class="detail-loading"><Loader2 :size="24" class="spin" /></div>
            <template v-else>
                <div class="reader-layout">
                    <div class="page-preview" ref="previewBoxRef">
                        <!-- 预览工具条：可拖动悬浮（按住左侧手柄拖动，双击复位） -->
                        <div
                            v-if="currentImage || pageLoading"
                            class="tool-strip"
                            :class="{ floating: toolbarPos.x !== null }"
                            :style="toolbarPos.x !== null ? { left: toolbarPos.x + 'px', top: toolbarPos.y + 'px' } : {}"
                            @mousedown="onToolbarDragStart"
                            @dblclick="resetToolbarPos"
                        >
                            <button class="drag-handle" title="拖动工具栏（双击复位）"><GripVertical :size="13" /></button>
                            <span class="tool-sep"></span>
                            <button class="tool-btn" :class="{ on: activeTool === 'drag' }" :title="activeTool === 'drag' ? '退出拖动' : '拖动（浏览页面位置）'" @click="setTool('drag')"><Move :size="15" /></button>
                            <button class="tool-btn" :class="{ on: activeTool === 'mag' }" :title="activeTool === 'mag' ? '关闭放大镜' : '放大镜'" @click="setTool('mag')"><ZoomIn :size="15" /></button>
                            <button class="tool-btn" :class="{ on: activeTool === 'pen' }" :title="activeTool === 'pen' ? '关闭画笔' : '笔记（画笔）'" @click="setTool('pen')"><Highlighter :size="15" /></button>
                            <button class="tool-btn" :class="{ on: activeTool === 'eraser' }" :title="activeTool === 'eraser' ? '关闭橡皮擦' : '橡皮擦'" @click="setTool('eraser')"><Eraser :size="15" /></button>
                            <button class="tool-btn" title="清空本页笔记" @click="clearAnnotations"><Trash2 :size="15" /></button>
                            <span class="tool-sep"></span>
                            <button class="tool-btn" title="缩小" :disabled="zoom <= 0.6" @click="applyZoom(-0.2)">−</button>
                            <span class="zoom-val">{{ Math.round(zoom * 100) }}%</span>
                            <button class="tool-btn" title="放大" :disabled="zoom >= 4" @click="applyZoom(0.2)">+</button>
                            <button class="tool-btn" title="重置视图" @click="resetView"><RefreshCw :size="14" /></button>
                            <span class="tool-sep"></span>
                            <button class="tool-btn" :title="isFullscreen ? '退出全屏' : '全屏预览'" @click="toggleFullscreen">
                                <Maximize v-if="!isFullscreen" :size="15" />
                                <Minimize v-else :size="15" />
                            </button>
                        </div>

                        <template v-if="currentImage">
                            <div class="img-stage" ref="stageRef" :class="{ penning: activeTool === 'pen' || activeTool === 'eraser', magging: activeTool === 'mag', dragging: activeTool === 'drag', 'panning-cursor': panning }">
                                <div
                                    class="pane"
                                    ref="paneRef"
                                    :style="{ transform: paneTransform(), transition: paneTransition }"
                                    @pointerdown="onStageDown"
                                    @pointermove="onStageMove"
                                    @pointerup="onStageUp"
                                    @pointercancel="onStageUp"
                                    @mouseleave="onStageLeave"
                                    @wheel.prevent="onStageWheel"
                                >
                                    <img :src="currentImage" ref="imgRef" class="page-img" alt="" referrerpolicy="no-referrer" draggable="false" @load="onImgLoaded" @dragstart.prevent />
                                    <canvas ref="canvasRef" class="annot-canvas"></canvas>
                                </div>
                                <div v-show="showLens && activeTool === 'mag'" class="mag-lens" :style="lensStyle"></div>
                            </div>
                            <p v-if="toolHint" class="tool-hint">{{ toolHint }}</p>
                            <div class="page-nav">
                                <button class="page-arrow" @click="setImage(currentPage - 1)" :disabled="currentPage <= 1"><ChevronLeft :size="20" /></button>
                                <div class="nav-slider-wrap">
                                    <input
                                        type="range"
                                        class="page-slider"
                                        min="1"
                                        :max="previewImages.length"
                                        :value="currentPage"
                                        :style="{ '--fill': (previewImages.length > 1 ? (currentPage - 1) / (previewImages.length - 1) * 100 : 100) + '%' }"
                                        @input="onSliderInput"
                                    />
                                </div>
                                <button class="page-arrow" @click="setImage(currentPage + 1)" :disabled="currentPage >= previewImages.length"><ChevronLeft :size="20" style="transform:rotate(180deg)" /></button>
                            </div>
                        </template>
                        <!-- 当前页正在取图（主进程 IPC 下载，占位载入态） -->
                        <div v-else-if="pageLoading" class="detail-loading page-loading">
                            <Loader2 :size="24" class="spin" />
                            <span v-if="pageFail" class="page-fail-tip">第 {{ currentPage }} 页加载失败
                                <button class="page-retry" @click="loadPageFor(currentPage - 1, true)">重试</button>
                            </span>
                            <span v-else class="page-fail-tip">第 {{ currentPage }} 页加载中…</span>
                        </div>
                        <div v-else-if="imagesLoading" class="detail-loading"><Loader2 :size="24" class="spin" /></div>
                        <div v-else class="detail-empty">无预览图</div>
                        <span class="page-ind" v-if="previewImages.length" title="点击用数字键盘跳转">
                            <button class="page-jump" @click="openNumpad">{{ currentPage }}</button>
                            / {{ previewImages.length }}
                        </span>
                        <!-- 小数字键盘：精准跳转 -->
                        <div v-if="showNumpad" class="page-numpad">
                            <div class="np-val">{{ numpadValue || '—' }}</div>
                            <div class="np-grid">
                                <button v-for="k in [7, 8, 9, 4, 5, 6, 1, 2, 3]" :key="k" class="np-key" @click="numpadKey(String(k))">{{ k }}</button>
                                <button class="np-key" @click="numpadKey('0')">0</button>
                                <button class="np-key back" title="删除" @click="numpadKey('back')"><Trash2 :size="13" /></button>
                                <button class="np-key go" @click="numpadKey('go')">跳转</button>
                            </div>
                        </div>
                    </div>
                    <div class="reader-side">
                        <div class="side-card">
                            <div class="audio-head">
                                <h4><Headphones :size="16" /> 配套音频（{{ audios.length }}）</h4>
                                <div class="audio-actions">
                                    <button class="batch-dl" :disabled="!audioSelected.length || audiosLoading" @click="downloadSelectedAudios">
                                        下载所选{{ audioSelected.length ? `（${audioSelected.length}）` : '' }}
                                    </button>
                                </div>
                            </div>
                            <div class="audio-head select-row">
                                <span
                                    class="select-all"
                                    :class="{ on: allAudioSelected }"
                                    @click="toggleSelectAllAudios"
                                >
                                    <CheckSquare v-if="allAudioSelected" :size="16" class="check-icon active" />
                                    <Square v-else :size="16" class="check-icon" />
                                    全选
                                </span>
                            </div>
                            <ul class="audio-list">
                                <li v-for="(a, i) in audios" :key="i" class="audio-item" :class="{ playing: playingIdx === i }">
                                    <CheckSquare
                                        v-if="audioSelected.includes(i)"
                                        :size="16"
                                        class="check-icon audio-check active"
                                        @click.stop="toggleAudioSelect(i)"
                                    />
                                    <Square
                                        v-else
                                        :size="16"
                                        class="check-icon audio-check"
                                        @click.stop="toggleAudioSelect(i)"
                                    />
                                    <button class="audio-play" :title="playingIdx === i && !audioPaused ? '暂停' : '播放'" @click="togglePlay(a, i)">
                                        <Play v-if="playingIdx !== i || audioPaused" :size="14" />
                                        <Pause v-else :size="14" />
                                    </button>
                                    <span class="audio-title" :title="a.title || ('音频 ' + (i + 1))">{{ a.title || ('音频 ' + (i + 1)) }}</span>
                                    <span class="audio-tag">{{ a.mp3Url ? 'mp3' : 'ogg' }}</span>
                                    <button class="audio-dl" :title="loggedIn ? '下载' : '需登录'" @click="downloadOneAudio(a)">
                                        <Download :size="14" />
                                    </button>
                                </li>
                            </ul>
                            <p v-if="audiosLoading" class="muted">加载中…</p>
                            <p v-else-if="!audios.length" class="muted">暂无配套音频</p>
                        </div>
                        <div class="side-card">
                            <h4><FileText :size="16" /> 信息</h4>
                            <p class="meta-line"><span>学段</span>{{ selectedBook.stage || '-' }}</p>
                            <p class="meta-line"><span>学科</span>{{ selectedBook.subject || '-' }}</p>
                            <p class="meta-line"><span>版本</span>{{ selectedBook.version || '-' }}</p>
                            <p class="meta-line"><span>年级</span>{{ selectedBook.grade || '-' }}</p>
                            <p class="meta-line"><span>册次</span>{{ selectedBook.term || '-' }}</p>
                            <p class="meta-line"><span>页数</span>{{ fmtCount(pageCount) || '-' }}</p>
                        </div>
                    </div>
                </div>
            </template>
        </template>

        <!-- 教材库视图 -->
        <template v-else>
            <!-- 级联筛选 -->
            <div class="filter-bar">
                <label class="filter-item">
                    <span>学段</span>
                    <CustomSelect class="fs-drop" width="116" :options="stageOpts" v-model="filters.stage.value" :placeholder="'全部'" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>学科</span>
                    <CustomSelect class="fs-drop" width="116" :options="subjectOpts" v-model="filters.subject.value" :placeholder="'全部'" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>版本</span>
                    <CustomSelect class="fs-drop" width="116" :options="versionOpts" v-model="filters.version.value" :placeholder="'全部'" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>年级</span>
                    <CustomSelect class="fs-drop" width="116" :options="gradeOpts" v-model="filters.grade.value" :placeholder="'全部'" compact @change="onFilterChange" />
                </label>
                <label class="filter-item">
                    <span>册次</span>
                    <CustomSelect class="fs-drop" width="116" :options="termOpts" v-model="filters.term.value" :placeholder="'全部'" compact @change="onFilterChange" />
                </label>
                <div class="filter-search">
                    <Search :size="14" />
                    <input v-model="searchText" placeholder="搜索教材名称…" @input="applyFilter" />
                </div>
                <span class="filter-count">共 {{ books.length }} 本</span>
            </div>

            <div v-if="loading" class="detail-loading"><Loader2 :size="28" class="spin" /></div>
            <div v-else class="book-grid">
                <div v-for="b in visibleBooks" :key="b.id" class="book-card" @click="openBook(b)">
                    <div class="book-cover">
                        <img v-if="b.coverUrl" :src="b.coverUrl" class="cover-img" alt="" referrerpolicy="no-referrer" loading="lazy" />
                        <BookOpen v-else :size="34" class="cover-fallback" />
                    </div>
                    <div class="book-info">
                        <p class="book-title" :title="b.title">{{ b.title }}</p>
                        <p class="book-tags">
                            <span v-if="b.stage">{{ b.stage }}</span>
                            <span v-if="b.grade">{{ b.grade }}</span>
                        </p>
                    </div>
                </div>
                <div v-if="!books.length && !loading" class="detail-empty">没有匹配的教材</div>
                <div v-if="visibleBooks.length && visibleBooks.length < books.length" ref="loadMoreSentinel" class="list-more">
                    <Loader2 :size="16" class="spin" /> 已加载 {{ visibleBooks.length }} / {{ books.length }}，继续滚动加载…
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.smart-edu-view {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-primary, #f7f8fa);
}
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
}
.page-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary, #18191c);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
}
.page-title .sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-secondary, #9499a0);
}
.header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
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
    width: 18px; height: 18px;
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
.spin { animation: rot 1s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }

/* 登录提示 */
.login-tips {
    position: relative;
    padding: 12px 16px;
    border: 1px solid #dbe8ff;
    border-radius: 10px;
    background: #f4f8ff;
    font-size: 12px;
}
.tips-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.tips-text { margin: 0; color: #444; flex: 1; min-width: 220px; }
.manual-token { display: flex; gap: 8px; margin-top: 10px; }
.token-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #d3d9e0;
    border-radius: 8px;
    font-size: 12px;
    background: #fff;
}
.primary-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: #6aa1ff;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
}
.sheet-close {
    position: absolute;
    top: 8px; right: 8px;
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
.filter-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #666;
}
/* 自定义下拉：小字体、紧凑贴合筛选栏 */
.filter-item :deep(.custom-select) { width: 116px; }
.filter-item :deep(.cs-trigger) {
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 6px;
    border-color: #e5e6e7;
}
.filter-item :deep(.cs-label) { font-size: 12px; }
.filter-item :deep(.cs-dropdown-fixed .cs-option) { font-size: 12px; padding: 5px 10px; }
.filter-search {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px solid #e5e6e7;
    border-radius: 6px;
    background: #f7f8fa;
    color: #999;
}
.filter-search input {
    border: none;
    background: transparent;
    outline: none;
    font-size: 12px;
    width: 160px;
}
.filter-count { margin-left: auto; font-size: 12px; color: #9499a0; }

/* 教材网格 */
.book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 14px;
}
.book-card {
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
}
.book-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.08); }
.book-cover {
    aspect-ratio: 3 / 4;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f2f4f7;
    overflow: hidden;
}
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-fallback { color: #c3c9d1; }
.book-info { padding: 8px 10px 10px; }
.book-title {
    font-size: 12.5px;
    font-weight: 600;
    color: #222;
    margin: 0 0 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 34px;
}
.book-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.book-tags span {
    font-size: 10.5px;
    color: #6aa1ff;
    background: #f0f6ff;
    border-radius: 4px;
    padding: 1px 6px;
}

/* 详情/阅读 */
.reader-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    position: relative;
    z-index: 30;
}
.back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    color: #6aa1ff;
    font-size: 13px;
    cursor: pointer;
    padding: 4px 6px;
}
.reader-title { flex: 1; font-size: 15px; font-weight: 600; color: #222; }
.reader-tools { display: flex; gap: 8px; }
.pdf-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border: none;
    border-radius: 16px;
    background: #6aa1ff;
    color: #fff;
    font-size: 12.5px;
    cursor: pointer;
    transition: all .2s;
}
.pdf-btn:hover { background: #5590f0; }
.pdf-btn:disabled { background: #c9d6ef; cursor: not-allowed; }

.reader-layout {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    min-height: 0;
}
.page-preview {
    position: relative;
    flex: 1;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
    padding: 44px 14px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    min-height: 480px;
    overflow: hidden;
    user-select: none;
}
/* 全屏预览时占满视口：深色底、去掉边框圆角，图片放宽高度 */
.page-preview:fullscreen {
    width: 100vw;
    height: 100vh;
    background: #111318;
    border: none;
    border-radius: 0;
    padding: 46px 28px 24px;
    justify-content: center;
}
.page-preview:fullscreen .page-img {
    max-height: calc(100vh - 110px);
}
.page-preview:fullscreen .img-stage {
    max-width: calc(100vw - 60px);
}

/* 工具条 */
.tool-strip {
    position: absolute;
    top: 8px; left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: rgba(255,255,255,.92);
    border: 1px solid #ececec;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,.08);
    z-index: 6;
}
/* 拖动后定点悬浮（按住左侧手柄拖动，双击复位）——相对 .page-preview 定位（absolute），
   全屏预览时容器坐标与视口一致，避免 fixed 在全屏元素内的定位异常导致全屏后拖不动 */
.tool-strip.floating {
    position: absolute;
    transform: none;
    background: rgba(20,24,34,.92);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
    cursor: grab;
    z-index: 40;
}
.tool-strip.floating:active { cursor: grabbing; }
.tool-strip.floating .drag-handle { color: #d8d8e0; }
.tool-strip.floating .drag-handle:hover { background: rgba(255,255,255,.1); color: #EC4141; }
.tool-strip.floating .tool-btn { color: #d8d8e0; }
.tool-strip.floating .tool-btn:hover { background: rgba(255,255,255,.1); color: #EC4141; }
.tool-strip.floating .tool-btn.on { background: rgba(236,65,65,.18); color: #EC4141; }
.tool-strip.floating .tool-btn:disabled { opacity: .35; }
.tool-strip.floating .tool-sep { background: rgba(255,255,255,.15); }
.tool-strip.floating .zoom-val { color: #a8a8b5; }
/* 工具栏拖动手柄 */
.drag-handle {
    min-width: 18px;
    height: 26px;
    border: none;
    background: transparent;
    border-radius: 6px;
    color: #aaa;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    padding: 0 3px;
    transition: all .15s;
}
.drag-handle:hover { background: #f0f0f0; color: #EC4141; }
.tool-btn {
    min-width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    border-radius: 6px;
    color: #666;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all .15s;
    padding: 0 6px;
}
.tool-btn:hover { background: #f0f0f0; color: #EC4141; }
.tool-btn.on { background: rgba(236,65,65,.12); color: #EC4141; }
.tool-btn:disabled { opacity: .35; cursor: not-allowed; }
.tool-sep { width: 1px; height: 16px; background: #ececec; margin: 0 3px; }
.zoom-val { font-size: 11px; color: #888; min-width: 38px; text-align: center; }

.img-stage {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    overflow: visible;
}
.img-stage.penning { cursor: crosshair; }
.img-stage.magging { cursor: crosshair; }
.img-stage.dragging { cursor: grab; }
.img-stage.panning-cursor { cursor: grabbing; }
.img-stage.dragging.panning-cursor { cursor: grabbing; }

.pane {
    position: relative;
    display: inline-block;
    transform-origin: center center;
    /* 提升到合成层：拖动平移时只走 GPU 合成，不触发布局/绘制，消除卡顿 */
    will-change: transform;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,.12);
    border-radius: 2px;
}
.page-img {
    display: block;
    max-width: 100%;
    max-height: 640px;
    border-radius: 2px;
    -webkit-user-drag: none;
}
.annot-canvas {
    position: absolute;
    left: 0; top: 0;
    z-index: 2;
    pointer-events: none;
    border-radius: 2px;
}

/* 放大镜 */
.mag-lens {
    position: absolute;
    z-index: 4;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 4px 18px rgba(0,0,0,.35), inset 0 0 0 1px rgba(0,0,0,.08);
    pointer-events: none;
    background-color: #fff;
}
.tool-hint {
    position: absolute;
    left: 12px; bottom: 50px;
    margin: 0;
    font-size: 11px;
    color: #666;
    background: rgba(255,255,255,.92);
    border: 1px solid #ececec;
    border-radius: 6px;
    padding: 3px 10px;
    pointer-events: none;
    z-index: 5;
}
.page-nav {
    position: absolute;
    left: 0; right: 0; bottom: 10px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 14px;
    z-index: 5;
}
.page-arrow {
    width: 38px; height: 38px;
    border-radius: 50%;
    border: 1px solid #e5e6e7;
    background: rgba(255,255,255,.9);
    color: #555;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.1);
    flex: none;
}
.page-arrow:disabled { opacity: .35; cursor: not-allowed; }
/* 页码滑条：拖动自由跳页 */
.nav-slider-wrap {
    flex: 1;
    max-width: 360px;
    display: flex;
    align-items: center;
}
.page-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, #EC4141, #EC4141 var(--fill, 50%), #e5e6e7 var(--fill, 50%));
    outline: none;
    cursor: pointer;
}
.page-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #EC4141;
    box-shadow: 0 1px 4px rgba(0,0,0,.22);
    transition: transform .12s;
}
.page-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
.page-ind {
    position: absolute;
    top: 12px; right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(0,0,0,.45);
    color: #fff;
    font-size: 11px;
    border-radius: 10px;
    padding: 2px 9px;
    z-index: 6;
}
/* 页码跳转：点击页码打开数字键盘 */
.page-jump {
    border: none;
    background: transparent;
    color: #fff;
    font-size: 11px;
    line-height: 1;
    padding: 0 2px;
    min-width: 20px;
    text-align: center;
    cursor: pointer;
    border-bottom: 1px dashed rgba(255,255,255,.55);
    transition: color .15s;
}
.page-jump:hover { color: #ff9d9d; }
/* 小数字键盘：输入页码精准跳转 */
.page-numpad {
    position: absolute;
    top: 34px; right: 12px;
    width: 168px;
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,.16);
    padding: 10px;
    z-index: 40;
    animation: np-in .16s ease;
}
@keyframes np-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: none; }
}
.np-val {
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    color: #222;
    padding: 4px 0 8px;
    margin-bottom: 8px;
    border-bottom: 1px dashed #ececec;
    letter-spacing: 1px;
    min-height: 26px;
}
.np-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
}
.np-key {
    height: 32px;
    border: 1px solid #ececec;
    background: #fafbfc;
    border-radius: 6px;
    font-size: 14px;
    color: #333;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all .12s;
}
.np-key:hover { background: #f0f1f3; }
.np-key:active { transform: scale(.96); }
.np-key.back { color: #888; }
.np-key.go {
    background: #EC4141;
    border-color: #EC4141;
    color: #fff;
    font-size: 12px;
}
.np-key.go:hover { background: #d93a3a; }

.reader-side {
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.side-card {
    background: #fff;
    border: 1px solid #eef0f2;
    border-radius: 10px;
    padding: 12px 14px;
}
.side-card h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #333;
    margin: 0;
}
.audio-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.audio-head h4 { margin: 0; flex: 1; }
.audio-actions { display: flex; align-items: center; }
.batch-dl {
    border: 1px solid #6aa1ff;
    background: #f0f6ff;
    color: #6aa1ff;
    border-radius: 14px;
    padding: 3px 12px;
    font-size: 11px;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
}
.batch-dl:hover:not(:disabled) { background: #6aa1ff; color: #fff; }
.batch-dl:disabled { opacity: .45; cursor: not-allowed; }
.select-row {
    display: flex;
    align-items: center;
    border-bottom: 1px dashed #f0f1f3;
    padding-bottom: 6px;
    margin-bottom: 4px;
}
.select-all {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    user-select: none;
}
.select-all:hover { color: #EC4141; }

.audio-list { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.audio-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 2px;
    border-bottom: 1px dashed #f0f1f3;
    font-size: 12px;
    color: #444;
}
.audio-item.playing { background: rgba(236,65,65,.05); border-radius: 6px; }
.audio-item .audio-check { flex-shrink: 0; cursor: pointer; }
.audio-play {
    width: 24px; height: 24px;
    flex-shrink: 0;
    border: 1px solid #e5e6e7;
    border-radius: 50%;
    background: #fff;
    color: #666;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all .15s;
    padding: 0;
}
.audio-play:hover { border-color: #6aa1ff; color: #6aa1ff; }
.audio-item.playing .audio-play { border-color: #EC4141; color: #EC4141; }
.audio-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audio-tag { font-size: 10px; color: #6aa1ff; background: #f0f6ff; border-radius: 4px; padding: 1px 6px; flex-shrink: 0; }
.audio-dl {
    width: 22px; height: 22px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: #aaa;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    padding: 0;
    transition: all .15s;
}
.audio-dl:hover { color: #6aa1ff; background: #f0f6ff; }
.meta-line { display: flex; justify-content: space-between; font-size: 12px; color: #666; margin: 5px 0; }
.meta-line span { color: #999; }
.muted { color: #a0a4ab; font-size: 12px; }

.detail-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #8a9199;
}
.page-loading { flex-direction: column; gap: 12px; min-height: 320px; }
.page-fail-tip { font-size: 12px; color: #a0a4ab; display: inline-flex; align-items: center; gap: 8px; }
.page-retry {
    font-size: 12px;
    color: #ec4141;
    border: 1px solid #f0c6c6;
    background: #fff5f5;
    border-radius: 4px;
    padding: 2px 10px;
    cursor: pointer;
    transition: all .15s;
}
.page-retry:hover { background: #ec4141; color: #fff; border-color: #ec4141; }
.detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #a0a4ab;
    font-size: 13px;
}
/* 触底加载提示 */
.list-more {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 0 8px;
    font-size: 12px;
    color: #9499a0;
}
.list-more .spin { color: var(--primary-color, #EC4141); }
</style>