<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Compass, CalendarDays, Search, Heart, History, Blocks, Plus, ArrowLeft, ArrowRight, Play, RefreshCw, Check, X, Loader2, Film, Trash2, FileJson, Download, ShieldCheck, ExternalLink, ChevronDown, ArrowDownUp, List, LayoutGrid, Clock3, Star } from 'lucide-vue-next'
import { animeRuleSources, animeRuleSearch, animeRuleDetail, animeRulePlay, animeRuleSave, animeRuleDelete, animeRuleImport, animeRuleCatalog, animeRuleInstall, animeRuleVerify, animeRuleCancel, animeSourceDiscovery, animeRuleRestore, animeRuleHealth } from '../api'
import ArtVideoPlayer from '../components/ArtVideoPlayer.vue'
import AnimeSourceSelect from '../components/AnimeSourceSelect.vue'
import AnimeSourceCover from '../components/AnimeSourceCover.vue'
import SearchInput from '../components/SearchInput.vue'
import SearchSuggest from '../components/SearchSuggest.vue'
import { useSearchHistoryStore } from '../store/searchHistory'
import { useAnimeStore } from '../store/anime'
import { useMessageStore } from '../store/message'

const library = useAnimeStore(), messages = useMessageStore()
const searchHistory = useSearchHistoryStore()
const showSearchSuggest = ref(false), searchInput = ref(null)
let searchBlurTimer
// Move the earlier page-only history into the same history UI used by music.
for (const term of [...readStored('anime_source_searches', [])].reverse()) searchHistory.addHistory('anime-source', term)
localStorage.removeItem('anime_source_searches')
const navigation = [{ id: 'discover', label: '推荐', icon: Compass }, { id: 'timeline', label: '时间表', icon: CalendarDays }, { id: 'search', label: '搜索', icon: Search }, { id: 'favorites', label: '追番', icon: Heart }, { id: 'history', label: '历史', icon: History }, { id: 'rules', label: '规则', icon: Blocks }]
const tab = ref('discover'), sources = ref([]), allRules = ref([]), source = ref('all'), keyword = ref('')
const recommendations = ref([]), calendar = ref([]), results = ref([]), sourceErrors = ref([]), pageError = ref('')
const busy = ref(false), searchBusy = ref(false), searched = ref(false), detailBusy = ref(false), playBusy = ref(false)
const catalog = ref([]), catalogBusy = ref(false), catalogError = ref(''), installing = ref(''), catalogFilter = ref('')
const selectedDay = ref(new Date().getDay() || 7), selected = ref(null), detail = ref(null), detailError = ref(''), matches = ref([]), matching = ref(false)
const routeIndex = ref(0), currentEpisode = ref(null), playUrl = ref(''), playType = ref(''), playError = ref(''), player = ref(null), playerSection = ref(null)
const ruleEditor = ref(false), ruleText = ref(''), ruleError = ref(''), saving = ref(false), importFile = ref(null)
const catalogMeta = ref(null), refreshing = ref(false), checking = ref(false), checkingIds = ref(new Set()), ruleFilter = ref(''), searchProgress = ref({ done: 0, total: 0 })
const episodeFilter = ref(''), reverseEpisodes = ref(false), episodeLayout = ref('grid'), fullSynopsis = ref(false), allMatches = ref(false), lastSource = ref(null)
const parseElapsed = ref(0), iframeRequested = ref(false), iframeLoaded = ref(false), iframeTimedOut = ref(false)
let parseClock, parseTimeout, iframeTimeout
let searchRevision = 0, detailRevision = 0, playRevision = 0, discoveryRevision = 0, disposed = false
function readStored(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback } catch { return fallback } }
const ruleSources = computed(() => new Set(allRules.value.map(rule => rule.id)))
const favorites = computed(() => library.favorites.filter(item => item.source === 'catalog' || ruleSources.value.has(item.source)))
const history = computed(() => { const seen = new Set(); return library.history.filter(item => { const key = `${item.source}:${item.id}`; if (seen.has(key) || (!ruleSources.value.has(item.source) && item.source !== 'catalog')) return false; seen.add(key); return true }) })
const visibleCards = computed(() => tab.value === 'timeline' ? calendar.value.find(day => day.weekday === selectedDay.value)?.items || [] : tab.value === 'favorites' ? favorites.value : tab.value === 'history' ? history.value : tab.value === 'search' ? results.value : recommendations.value)
const headings = { discover: ['找一部，慢慢看。', '从热门故事开始，也可以搜索你心里的那一部。'], timeline: ['这一周的新故事', '按放送日期浏览，点击番剧选择播放源。'], search: ['寻找你喜欢的动漫', '选择一个源，或同时搜索全部已启用的源。'], favorites: ['我的追番', '喜欢的故事，留在这里。'], history: ['继续上次的故事', '观看记录和播放位置保存在这台设备。'], rules: ['管理我的动漫源', '安装、导入和编辑规则，自由选择你的播放来源。'] }
const route = computed(() => detail.value?.routes?.[routeIndex.value])
const episodes = computed(() => route.value?.episodes || [])
const episodeIndex = computed(() => episodes.value.findIndex(item => item.url === currentEpisode.value?.url))
const activeSourceLabel = computed(() => sources.value.find(item => item.id === detail.value?.source)?.label || detail.value?.sourceLabel || '动漫源')
const isFavorite = computed(() => selected.value && library.isFavorited(selected.value.source, selected.value.id))
const filteredCatalog = computed(() => catalog.value.filter(item => item.name.toLowerCase().includes(catalogFilter.value.toLowerCase())))
const filteredRules = computed(() => allRules.value.filter(item => item.name.toLowerCase().includes(ruleFilter.value.toLowerCase())))
const featured = computed(() => recommendations.value[0])
function suggestAnime(value) {
    const query = value.trim().toLowerCase(), seen = new Set()
    return [...recommendations.value, ...calendar.value.flatMap(day => day.items || []), ...results.value]
        .filter(item => {
            const title = String(item.title || '')
            if (seen.has(title) || ![title, item.originalTitle].some(text => String(text || '').toLowerCase().includes(query))) return false
            seen.add(title)
            return true
        }).slice(0, 6).map(item => ({ id: `${item.source}:${item.id}`, name: item.title, cover: item.cover, sub: item.tags?.join(' · ') || item.originalTitle || item.sourceLabel || '', type: 'anime-source' }))
}
function searchFocus() { clearTimeout(searchBlurTimer); showSearchSuggest.value = true }
function searchBlur() { searchBlurTimer = setTimeout(() => { showSearchSuggest.value = false }, 200) }
function searchKeys(event) { if (event.key === 'Escape') { showSearchSuggest.value = false; event.stopPropagation() } }
function coverUrl(value) {
    try {
        const url = new URL(value)
        if (url.hostname === 'lain.bgm.tv' || (url.hostname === 'api.bgm.tv' && /^\/v0\/subjects\/\d+\/image$/.test(url.pathname))) {
            return `https://wsrv.nl/?${new URLSearchParams({ url: url.host + url.pathname + url.search, w: '400', output: 'webp' })}`
        }
        return value
    } catch { return '' }
}
const sourceOptions = computed(() => [{ value: 'all', label: '全部启用的源' }, ...sources.value.map(item => ({ value: item.id, label: item.label }))])
const filteredEpisodes = computed(() => {
    const items = episodes.value.filter(item => item.title.toLowerCase().includes(episodeFilter.value.trim().toLowerCase()))
    return reverseEpisodes.value ? [...items].reverse() : items
})
const detailInfo = computed(() => {
    const normalize = value => String(value || '').replace(/[\s·：:！!。]/g, '').toLowerCase()
    const record = [...recommendations.value, ...calendar.value.flatMap(day => day.items)].find(item => item.id === selected.value?.id || normalize(item.title) === normalize(selected.value?.title))
    return { ...record, ...selected.value, tags: selected.value?.tags?.length ? selected.value.tags : record?.tags || [] }
})
const synopsis = computed(() => detail.value?.desc || (detailInfo.value.desc?.includes(' / ') ? '' : detailInfo.value.desc) || '')
const related = computed(() => recommendations.value.filter(item => item.id !== selected.value?.id && item.title !== selected.value?.title).map((item, index) => ({ item, index, shared: (item.tags || []).filter(tag => detailInfo.value.tags?.includes(tag)).length })).sort((a, b) => b.shared - a.shared || a.index - b.index).slice(0, 6).map(value => value.item))
const lastWatched = computed(() => detail.value && library.history.find(item => item.source === detail.value.source && item.id === detail.value.id))
const resumeEpisode = computed(() => episodes.value.find(item => item.title === lastWatched.value?.ep) || episodes.value[0])
const displayedMatches = computed(() => allMatches.value ? matches.value : matches.value.slice(0, 8))
function stopParsing() { clearInterval(parseClock); clearTimeout(parseTimeout); parseClock = null; parseTimeout = null }
function cancelPlayback() { playRevision++; stopParsing(); clearTimeout(iframeTimeout); playBusy.value = false; playUrl.value = ''; playError.value = ''; currentEpisode.value = null; iframeRequested.value = false; void animeRuleCancel().catch(() => {}) }
function recordPlaying() {
    if (!detail.value || !currentEpisode.value) return
    library.addHistory({ source: detail.value.source, id: detail.value.id, title: detail.value.title, cover: detail.value.cover }, currentEpisode.value)
}
function playerFailed(message) { playError.value = message || '播放失败，请重试或切换线路'; playUrl.value = '' }
function showWebPlayer() { iframeRequested.value = true; iframeLoaded.value = false; iframeTimedOut.value = false; clearTimeout(iframeTimeout); iframeTimeout = setTimeout(() => { iframeTimedOut.value = true; iframeRequested.value = false }, 15000) }
function webLoaded() { clearTimeout(iframeTimeout); iframeLoaded.value = true }
function switchRoute(index) { routeIndex.value = index; episodeFilter.value = ''; if (currentEpisode.value) cancelPlayback() }
async function tryOtherRoute() {
    if (!detail.value) return
    const title = currentEpisode.value?.title
    const next = (routeIndex.value + 1) % detail.value.routes.length
    switchRoute(next)
    await playEpisode(episodes.value.find(item => item.title === title) || episodes.value[0])
}
watch(() => routeIndex.value, () => { episodeFilter.value = '' })
const availableCount = computed(() => allRules.value.filter(rule => rule.health?.status === 'available').length)
const healthLabel = rule => checkingIds.value.has(rule.id) ? '检测中' : !rule.enabled ? '已停用' : rule.health?.status === 'available' ? `搜索可用 · ${rule.health.ms}ms` : rule.health?.status === 'empty' ? '已连接 · 暂无匹配' : rule.health?.status === 'unreachable' ? '暂不可达' : '未检测'
function unwrap(response) { if (!response?.success) throw Error(response?.message || '请求失败'); return response.data }
async function loadSources() {
    try { const response = await animeRuleSources(); unwrap(response); sources.value = response.data || []; allRules.value = response.all || []; if (source.value !== 'all' && !sources.value.some(item => item.id === source.value)) source.value = 'all' }
    catch (error) { pageError.value = error.message }
}
async function discover(append = false, force = false) {
    const revision = ++discoveryRevision; busy.value = true; pageError.value = ''
    try {
        const kind = tab.value === 'timeline' ? 'timeline' : 'popular'
        const offset = append ? recommendations.value.length : 0
        const response = await animeSourceDiscovery(kind, '', offset, force)
        const data = unwrap(response) || []
        if (disposed || revision !== discoveryRevision) return
        catalogMeta.value = response.meta || null
        if (kind === 'timeline') calendar.value = data
        else { const next = append ? [...recommendations.value, ...data] : data; recommendations.value = [...new Map(next.map(item => [item.id, item])).values()] }
        if (!force && !append && response.meta?.needsRefresh) {
            refreshing.value = true
            const fresh = await animeSourceDiscovery(kind, '', 0, true)
            if (disposed || revision !== discoveryRevision) return
            const items = unwrap(fresh) || []
            catalogMeta.value = fresh.meta || null
            if (kind === 'timeline') calendar.value = items
            else recommendations.value = items
        }
    } catch (error) { if (revision === discoveryRevision) pageError.value = `番剧目录暂时无法加载：${error.message}` }
    finally { if (revision === discoveryRevision) { busy.value = false; refreshing.value = false } }
}
function switchTab(value) {
    searchRevision++; searchBusy.value = false; discoveryRevision++; busy.value = false; refreshing.value = false
    closeDetail(); tab.value = value; pageError.value = ''
    if ((value === 'discover' && !recommendations.value.length) || (value === 'timeline' && !calendar.value.length)) void discover()
    if (value === 'rules' && !catalog.value.length) void loadCatalog()
}
async function searchSources(value, chosenSource, update, valid = () => !disposed) {
    const rank = item => item.health?.status === 'available' ? 0 : item.health?.status === 'unreachable' ? 2 : 1
    const selectedSources = sources.value.filter(item => chosenSource === 'all' || item.id === chosenSource).sort((a, b) => rank(a) - rank(b))
    if (!selectedSources.length) throw Error('请先到“规则”安装并启用一个动漫源')
    let cursor = 0, completed = 0; const errors = [], found = []
    searchProgress.value = { done: 0, total: selectedSources.length }
    await Promise.all(Array.from({ length: Math.min(5, selectedSources.length) }, async () => {
        while (cursor < selectedSources.length && valid()) {
            const current = selectedSources[cursor++]
            try { const data = unwrap(await animeRuleSearch(current.id, value)) || []; found.push(...data); update?.([...found], [...errors]) }
            catch (error) { errors.push({ id: current.id, name: current.label, message: error.message }); update?.([...found], [...errors]) }
            finally { completed++; if (valid()) searchProgress.value = { done: completed, total: selectedSources.length } }
        }
    }))
    return { found, errors }
}
async function search(value = keyword.value) {
    value = String(value || '').trim(); if (!value) return
    clearTimeout(searchBlurTimer); showSearchSuggest.value = false
    keyword.value = value; closeDetail(); tab.value = 'search'; searched.value = true; results.value = []; sourceErrors.value = []; pageError.value = ''
    if (!sources.value.length) { pageError.value = '还没有启用的动漫源。到“规则”页安装规则后即可搜索播放。'; return }
    searchHistory.addHistory('anime-source', value)
    const revision = ++searchRevision; searchBusy.value = true
    try { await searchSources(value, source.value, (items, errors) => { if (!disposed && revision === searchRevision) { results.value = items; sourceErrors.value = errors } }, () => !disposed && revision === searchRevision) }
    catch (error) { if (revision === searchRevision) pageError.value = error.message }
    finally { if (revision === searchRevision) searchBusy.value = false }
}
async function openItem(item) {
    closeDetail(); selected.value = { ...item }; detailError.value = ''; matches.value = []; fullSynopsis.value = false; allMatches.value = false; episodeFilter.value = ''
    if (item.source !== 'catalog') { await openSource(item); return }
    if (!sources.value.length) return
    const revision = detailRevision; matching.value = true
    try { await searchSources(item.title, source.value, items => { if (revision === detailRevision && !disposed) matches.value = items }, () => !disposed && revision === detailRevision) }
    catch (error) { if (revision === detailRevision) detailError.value = error.message }
    finally { if (revision === detailRevision) matching.value = false }
}
async function openSource(item) {
    const revision = ++detailRevision; lastSource.value = item; detailBusy.value = true; matching.value = false; detailError.value = ''; episodeFilter.value = ''; cancelPlayback(); detail.value = null
    playRevision++; playUrl.value = ''; currentEpisode.value = null; playError.value = ''; void animeRuleCancel().catch(() => {})
    try {
        const data = unwrap(await animeRuleDetail(item.source, item.id))
        if (disposed || revision !== detailRevision) return
        detail.value = { ...data, title: selected.value?.title || data.title, cover: selected.value?.cover || data.cover }
        routeIndex.value = 0
        if (selected.value?.source !== 'catalog') selected.value = { ...item, ...detail.value }
        if (item.ep) { const road = data.routes.findIndex(value => value.episodes.some(ep => ep.title === item.ep)); if (road >= 0) routeIndex.value = road }
        const previous = episodes.value.find(ep => ep.title === item.ep)
        if (previous) void playEpisode(previous)
    } catch (error) { if (revision === detailRevision) detailError.value = error.message }
    finally { if (revision === detailRevision) detailBusy.value = false }
}
async function playEpisode(episode) {
    if (!episode || !detail.value) return
    cancelPlayback()
    const revision = ++playRevision, selectedDetail = detail.value
    currentEpisode.value = episode; playUrl.value = ''; playError.value = ''; playBusy.value = true; parseElapsed.value = 0
    parseClock = setInterval(() => parseElapsed.value++, 1000)
    try {
        const response = await Promise.race([
            animeRulePlay(selectedDetail.source, episode.url),
            new Promise((_, reject) => { parseTimeout = setTimeout(() => { void animeRuleCancel().catch(() => {}); reject(Error('解析超时，此线路暂时无法提供视频，请重试或更换线路')) }, 28000) })
        ]); unwrap(response)
        if (disposed || revision !== playRevision || selectedDetail !== detail.value) return
        if (!response.url) throw Error('此线路没有返回播放地址，请切换其他线路')
        playUrl.value = response.url; playType.value = response.type || 'direct'
        await nextTick(); playerSection.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (error) { if (revision === playRevision) playError.value = error.message }
    finally { if (revision === playRevision) { stopParsing(); playBusy.value = false } }

}
function adjacent(direction) { const next = episodes.value[episodeIndex.value + direction]; if (next) void playEpisode(next) }
function closeDetail() {
    cancelPlayback(); detailRevision++; playRevision++; selected.value = null; detail.value = null; currentEpisode.value = null; playUrl.value = ''; playError.value = ''; matching.value = false; detailBusy.value = false; playBusy.value = false
    void animeRuleCancel().catch(() => {})
}
function favorite() { if (selected.value) library.toggleFavorite(selected.value) }
async function loadCatalog(refresh = false) {
    catalogBusy.value = true; catalogError.value = ''
    try { const response = await animeRuleCatalog(refresh); catalog.value = unwrap(response) || []; catalogError.value = response.meta?.warning || '' } catch (error) { catalogError.value = error.message } finally { catalogBusy.value = false }
}
async function restoreBuiltins() {
    try { unwrap(await animeRuleRestore()); await loadSources(); messages.success('内置播放源已恢复') } catch (error) { messages.error(error.message) }
}
async function checkSources() {
    if (checking.value) return
    checking.value = true
    const pending = sources.value.slice(); let cursor = 0
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (cursor < pending.length && !disposed) {
            const item = pending[cursor++]; checkingIds.value = new Set([...checkingIds.value, item.id])
            try { const health = unwrap(await animeRuleHealth(item.id)); for (const collection of [allRules.value, sources.value]) { const rule = collection.find(rule => rule.id === item.id); if (rule) rule.health = health } }
            catch (error) { messages.error(`${item.label}：${error.message}`) }
            finally { const next = new Set(checkingIds.value); next.delete(item.id); checkingIds.value = next }
        }
    }))
    checking.value = false
}
function chooseSource(id) { source.value = id; if (keyword.value.trim()) void search(); else switchTab('search') }
function refreshPage() { void loadSources(); if (tab.value === 'rules') void loadCatalog(true); else if (tab.value === 'discover' || tab.value === 'timeline') void discover(false, true); else if (tab.value === 'search' && keyword.value) void search() }
async function install(name) {
    if (installing.value) return
    installing.value = name
    try { unwrap(await animeRuleInstall(name)); await loadSources(); messages.success(`${name} 已安装并启用`) } catch (error) { messages.error(`安装失败：${error.message}`) } finally { installing.value = '' }
}
async function toggleRule(rule) {
    try { unwrap(await animeRuleSave({ ...rule, enabled: !rule.enabled })); await loadSources() } catch (error) { messages.error(error.message) }
}
async function removeRule(rule) {
    if (!await messages.confirm(`删除“${rule.name}”规则？追番与观看记录仍保留。`, '删除动漫源')) return
    try { unwrap(await animeRuleDelete(rule.id)); await loadSources() } catch (error) { messages.error(error.message) }
}
function editRule(rule) { ruleText.value = rule ? JSON.stringify(rule, null, 2) : ''; ruleError.value = ''; ruleEditor.value = true }
async function saveRule() {
    saving.value = true; ruleError.value = ''
    try { const response = await animeRuleImport(ruleText.value); unwrap(response); await loadSources(); ruleEditor.value = false; messages.success(`已导入 ${response.data.length} 个动漫源`) } catch (error) { ruleError.value = error.message } finally { saving.value = false }
}
async function readRuleFile(event) {
    const file = event.target.files?.[0]; if (!file) return
    if (file.size > 2 * 1024 * 1024) { messages.warning('规则文件请小于 2 MB'); return }
    ruleText.value = await file.text(); ruleError.value = ''; ruleEditor.value = true; event.target.value = ''
}
async function verify(id) { try { unwrap(await animeRuleVerify(id)); messages.info('在验证窗口完成站点验证后，返回这里重试') } catch (error) { messages.error(error.message) } }
function externalEpisode() { if (currentEpisode.value?.url) (window.bridge || window.__ELECTRON_BRIDGE__)?.invoke('open-external', currentEpisode.value.url).catch(() => messages.info('此源不支持外部打开，请更换线路')) }
function keydown(event) { if (event.defaultPrevented) return; if (event.key === 'Escape') { if (ruleEditor.value) ruleEditor.value = false; else closeDetail() } }
onMounted(async () => { document.addEventListener('keydown', keydown); await loadSources(); if (!disposed) void discover() })
onBeforeUnmount(() => { clearTimeout(searchBlurTimer); disposed = true; searchRevision++; discoveryRevision++; closeDetail(); document.removeEventListener('keydown', keydown) })
</script>

<template>
    <main class="anime-source-page">
        <header class="as-header">
            <div class="as-brand"><span class="as-logo"><Compass :size="23" /></span><div><h1>动漫源<span>.</span></h1><p>发现 · 追番 · 放送</p></div></div>
            <div class="as-header-actions"><button class="as-source-status" @click="switchTab('rules')"><i />{{ allRules.length }} 个播放源<span>{{ sources.length }} 已启用</span></button><button class="as-icon-button" title="刷新当前页面" aria-label="刷新动漫源" @click="refreshPage"><RefreshCw :size="17" :class="{ 'as-spin': refreshing }" /></button></div>
        </header>
        <nav class="as-tabs" aria-label="动漫源导航"><button v-for="item in navigation" :key="item.id" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="switchTab(item.id)"><component :is="item.icon" :size="17" />{{ item.label }}<small v-if="item.id === 'favorites' && favorites.length">{{ favorites.length }}</small></button></nav>
        <div class="as-page-body">
            <template v-if="!selected">
                <div v-if="tab !== 'discover'" class="as-page-heading"><div><span class="as-eyebrow">{{ tab === 'rules' ? '播放来源' : tab === 'timeline' ? '每周放送' : '为你发现' }}</span><h2>{{ headings[tab][0] }}</h2><p>{{ headings[tab][1] }}</p></div><div v-if="tab === 'rules'" class="as-heading-actions"><button class="as-button" @click="restoreBuiltins"><RefreshCw :size="15" />恢复内置</button><button class="as-button" @click="importFile.click()"><FileJson :size="16" />导入</button><button class="as-button primary" @click="editRule()"><Plus :size="16" />添加规则</button></div></div>
                <form v-if="tab !== 'rules'" class="as-search" @submit.prevent="search()">
                    <SearchInput ref="searchInput" v-model="keyword" placeholder="搜索" label="搜索动漫" clearable @submit="search()" @focus="searchFocus" @blur="searchBlur" @keydown="searchKeys">
                        <SearchSuggest module="anime-source" :query="keyword" :visible="showSearchSuggest" :live-search="suggestAnime" @select="search" @select-item="search($event.name)">
                            <template #cover="{ item }"><AnimeSourceCover :src="item.cover" :title="item.name" /></template>
                        </SearchSuggest>
                    </SearchInput>
                    <AnimeSourceSelect v-model="source" :options="sourceOptions" />
                    <span v-if="searchBusy" class="as-search-status" role="status"><Loader2 :size="14" class="as-spin" />{{ searchProgress.done }}/{{ searchProgress.total }}</span>
                </form>
                <div v-if="(tab === 'discover' || tab === 'search') && sources.length" class="as-quick-sources"><span>播放源</span><button :class="{ active: source === 'all' }" @click="chooseSource('all')">全部</button><button v-for="item in sources" :key="item.id" :class="{ active: source === item.id }" @click="chooseSource(item.id)">{{ item.label }}</button><button class="as-source-manage" @click="switchTab('rules')"><Blocks :size="13" />管理</button></div>
                <div v-if="catalogMeta?.warning && (tab === 'discover' || tab === 'timeline')" class="as-cache-note"><History :size="14" />{{ catalogMeta.warning }}<button @click="discover(false, true)">重新连接</button></div>
                <div v-if="pageError" class="as-notice" role="alert"><span>{{ pageError }}</span><button @click="sources.length ? discover() : switchTab('rules')">{{ sources.length ? '重试' : '管理规则' }}</button></div>
                <section v-if="tab === 'discover' && featured" class="as-featured" :style="{ '--as-feature-cover': `url(${JSON.stringify(coverUrl(featured.cover))})` }">
                    <div class="as-featured-art" aria-hidden="true" />
                    <div class="as-featured-copy"><span class="as-featured-label"><Compass :size="13" />本周热播</span><h2>{{ featured.title }}</h2><p>{{ featured.desc || featured.originalTitle }}</p><div class="as-featured-meta"><span v-if="featured.score">★ {{ Number(featured.score).toFixed(1) }}</span><span>{{ featured.year }}</span></div><button @click="openItem(featured)"><Play :size="15" fill="currentColor" />查看番剧<ArrowRight :size="15" /></button></div>
                    <AnimeSourceCover class="as-featured-poster" :src="featured.cover" :title="featured.title" :lazy="false" />
                    <div class="as-featured-aside"><strong>{{ recommendations.length }}</strong><span>热门番剧</span><small>多源搜索 · 自动记忆进度</small></div>
                </section>
                <div v-if="tab === 'timeline'" class="as-days"><button v-for="(label, index) in ['周一','周二','周三','周四','周五','周六','周日']" :key="label" :class="{ active: selectedDay === index + 1 }" @click="selectedDay = index + 1">{{ label }}<span v-if="index + 1 === (new Date().getDay() || 7)">今天</span></button></div>
                <template v-if="tab === 'rules'">
                    <div class="as-rule-summary"><div><strong>{{ allRules.length }}<small>个</small></strong><span>已安装播放源</span></div><div><strong>{{ sources.length }}<small>个</small></strong><span>已启用</span></div><div><strong>{{ availableCount }}<small>个</small></strong><span>已验证搜索可用</span></div><button class="as-button" :disabled="checking || !sources.length" @click="checkSources"><Loader2 v-if="checking" :size="15" class="as-spin" /><ShieldCheck v-else :size="15" />{{ checking ? '正在检测…' : '检测播放源' }}</button></div>
                    <section class="as-rule-section"><div class="as-section-title"><h3>我的播放源</h3><input v-model="ruleFilter" class="as-filter" aria-label="筛选已安装源" placeholder="查找播放源…" /></div><div v-if="!allRules.length" class="as-rule-empty"><Blocks :size="26" /><div><strong>已移除全部播放源</strong><p>点击“恢复内置”，即可恢复随程序提供的全部源。</p></div><button class="as-button" @click="restoreBuiltins">恢复内置</button></div><div class="as-installed-grid"><article v-for="rule in filteredRules" :key="rule.id" class="as-rule-card" :class="{ 'as-rule-disabled': !rule.enabled }"><div class="as-rule-top"><span class="as-rule-avatar">{{ rule.name.slice(0, 1) }}</span><div><h4>{{ rule.name }}</h4><small>{{ rule.builtin ? '内置' : '自定义' }} · v{{ rule.version || '本地' }}</small></div><button class="as-rule-switch" role="switch" :aria-checked="rule.enabled" :aria-label="`${rule.enabled ? '禁用' : '启用'} ${rule.name}`" :class="{ on: rule.enabled }" @click="toggleRule(rule)"><i /></button></div><p :title="rule.baseUrl">{{ rule.baseUrl }}</p><span class="as-health" :class="rule.health?.status" :title="rule.health?.message"><i />{{ healthLabel(rule) }}</span><footer><button @click="editRule(rule)">编辑规则</button><button @click="verify(rule.id)" :disabled="!rule.enabled"><ShieldCheck :size="13" />站点验证</button><button class="as-icon-button" :aria-label="`删除 ${rule.name}`" @click="removeRule(rule)"><Trash2 :size="14" /></button></footer></article></div></section>
                    <section class="as-rule-section"><div class="as-section-title"><div><h3>规则目录</h3><p>规则由社区维护，站点可用性以实际访问结果为准。</p></div><input v-model="catalogFilter" class="as-filter" aria-label="筛选规则" placeholder="筛选规则…" /><button class="as-icon-button" aria-label="刷新规则目录" @click="loadCatalog"><RefreshCw :size="15" /></button></div><div v-if="catalogError" class="as-notice">目录加载失败：{{ catalogError }}<button @click="loadCatalog">重试</button></div><div v-if="catalogBusy" class="as-loading"><Loader2 class="as-spin" :size="22" />正在读取规则目录…</div><div class="as-catalog-grid"><article v-for="item in filteredCatalog" :key="item.name" class="as-catalog-card"><span class="as-rule-avatar">{{ item.name.slice(0,1) }}</span><div><strong>{{ item.name }}</strong><small>v{{ item.version }}<template v-if="item.author"> · {{ item.author }}</template></small></div><button :disabled="!!installing" :class="{ installed: allRules.some(rule => rule.name === item.name) }" @click="install(item.name)"><Loader2 v-if="installing === item.name" class="as-spin" :size="15" /><Check v-else-if="allRules.some(rule => rule.name === item.name)" :size="15" /><Download v-else :size="15" />{{ allRules.some(rule => rule.name === item.name) ? '更新' : '安装' }}</button></article></div></section>
                </template>
                <template v-else>
                    <div class="as-section-title as-results-heading"><h3>{{ tab === 'discover' ? '热门推荐' : tab === 'timeline' ? '今日放送' : tab === 'favorites' ? '我的追番' : tab === 'history' ? '继续观看' : searched ? '搜索结果' : '从一个名字开始' }}</h3><span>{{ visibleCards.length }} {{ tab === 'search' ? '个结果' : '部动漫' }}<template v-if="searchBusy"> · {{ searchProgress.done }}/{{ searchProgress.total }} 个源<button class="as-text-button" @click="searchRevision++; searchBusy = false">停止搜索</button></template><template v-else-if="refreshing"> · 正在更新目录</template><template v-else-if="catalogMeta?.cached && (tab === 'discover' || tab === 'timeline')"> · 已保存目录</template></span></div>
                    <div v-if="busy && !visibleCards.length" class="as-skeleton-grid" aria-label="正在加载番剧"><div v-for="index in 12" :key="index"><i /><span /><small /></div></div>
                    <div v-else-if="!visibleCards.length && !searchBusy && !pageError" class="as-empty"><component :is="tab === 'favorites' ? Heart : tab === 'history' ? History : Search" :size="34" /><h3>{{ tab === 'favorites' ? '还没有追番' : tab === 'history' ? '还没有观看记录' : tab === 'timeline' ? '这一天暂无放送' : searched ? '没有匹配的结果' : '搜索你心里的那部动漫' }}</h3><p>{{ tab === 'favorites' ? '在番剧详情中点亮爱心，下次就能轻松找到。' : tab === 'history' ? '开始播放后，会自动记录剧集和进度。' : '可以换个关键词，或到规则页启用其他动漫源。' }}</p><button v-if="!sources.length" class="as-button primary" @click="switchTab('rules')">安装动漫源<ArrowRight :size="15" /></button></div>
                    <div class="as-poster-grid"><button v-for="item in visibleCards" :key="`${item.source}:${item.id}`" class="as-poster-card" @click="openItem(item)"><div class="as-poster"><AnimeSourceCover :src="item.cover" :title="item.title" /><span v-if="Number(item.score) > 0" class="as-score">{{ Number(item.score).toFixed(1) }}</span><span class="as-cover-play"><Play :size="23" fill="currentColor" /></span><span v-if="item.ep" class="as-cover-episode">{{ item.ep }}</span></div><strong :title="item.title">{{ item.title }}</strong><small>{{ item.sourceLabel || (item.source === 'catalog' ? item.originalTitle || item.year : sources.find(value => value.id === item.source)?.label) || '动漫源' }}</small></button></div>
                    <details v-if="sourceErrors.length && tab === 'search'" class="as-source-errors"><summary>{{ sourceErrors.length }} 个源暂不可达，其余搜索结果仍可使用</summary><div v-for="item in sourceErrors" :key="item.id"><strong>{{ item.name }}</strong><span>{{ item.message }}</span><button @click="verify(item.id)">站点验证</button></div></details>
                    <button v-if="tab === 'discover' && recommendations.length" class="as-button as-load-more" :disabled="busy" @click="discover(true)"><Loader2 v-if="busy" :size="16" class="as-spin" />加载更多<ArrowRight v-if="!busy" :size="15" /></button>
                </template>
            </template>
            <section v-else class="as-detail">
                <button class="as-back" @click="closeDetail"><ArrowLeft :size="16" />返回{{ navigation.find(item => item.id === tab)?.label }}</button>
                <div class="as-detail-hero" :style="{ '--as-detail-art': `url(${JSON.stringify(coverUrl(selected.cover))})` }">
                    <AnimeSourceCover class="as-detail-cover" :src="selected.cover" :title="selected.title" :lazy="false" />
                    <div class="as-detail-copy"><span class="as-eyebrow">番剧档案 / {{ selected.source === 'catalog' ? '多源观看' : selected.sourceLabel || activeSourceLabel }}</span><h2>{{ selected.title }}</h2><p v-if="detailInfo.originalTitle && detailInfo.originalTitle !== selected.title" class="as-original-title">{{ detailInfo.originalTitle }}</p><div class="as-detail-meta"><span v-if="detailInfo.year"><CalendarDays :size="13" />{{ detailInfo.year }}</span><span v-if="detailInfo.episodeCount">全 {{ detailInfo.episodeCount }} 集</span><span v-if="detail">{{ detail.routes.length }} 条播放线路</span><span v-else-if="matching">正在匹配播放源</span></div><div v-if="detailInfo.tags?.length" class="as-tags"><span v-for="tagName in detailInfo.tags.slice(0, 7)" :key="tagName">{{ tagName }}</span></div><div class="as-detail-actions"><button v-if="detail && resumeEpisode" class="as-button primary" @click="playEpisode(resumeEpisode)"><Play :size="15" fill="currentColor" />{{ lastWatched ? `继续看 · ${resumeEpisode.title}` : '开始观看' }}</button><button v-else class="as-button primary" :disabled="!matches.length || detailBusy" @click="openSource(matches[0])"><Play :size="15" />{{ matching && !matches.length ? '正在寻找播放源…' : '选择首个播放源' }}</button><button class="as-button" :class="{ following: isFavorite }" @click="favorite"><Heart :size="15" :fill="isFavorite ? 'currentColor' : 'none'" />{{ isFavorite ? '已追番' : '加入追番' }}</button></div></div>
                    <aside v-if="Number(detailInfo.score) > 0" class="as-rating"><span>番剧评分</span><strong>{{ Number(detailInfo.score).toFixed(1) }}<small>/ 10</small></strong><div>★★★★★</div><small v-if="detailInfo.ratingCount">{{ detailInfo.ratingCount.toLocaleString() }} 人评价</small><small v-if="detailInfo.rank">排名 #{{ detailInfo.rank.toLocaleString() }}</small></aside>
                </div>
                <div class="as-detail-information"><section class="as-panel as-synopsis"><div class="as-section-title"><h3>故事简介</h3><span>{{ selected.source === 'catalog' ? '番剧资料' : '站点资料' }}</span></div><p v-if="synopsis" :class="{ expanded: fullSynopsis }">{{ synopsis }}</p><p v-else class="as-muted">当前资料未提供故事简介。可以先选择播放源，读取站点的番剧介绍与剧集信息。</p><button v-if="synopsis.length > 150" class="as-text-button" @click="fullSynopsis = !fullSynopsis">{{ fullSynopsis ? '收起简介' : '展开完整简介' }}<ChevronDown :size="13" :class="{ 'as-rotated': fullSynopsis }" /></button></section><aside class="as-panel as-watch-info"><span class="as-eyebrow">我的观看</span><template v-if="lastWatched"><Clock3 :size="23" /><strong>上次看到 {{ lastWatched.ep }}</strong><p>{{ activeSourceLabel }} · 进度自动保存</p><button class="as-text-button" @click="playEpisode(resumeEpisode)">继续这个故事<ArrowRight :size="14" /></button></template><template v-else><Film :size="23" /><strong>{{ isFavorite ? '已收进我的追番' : '新的故事，等你开始' }}</strong><p>选择线路与剧集，播放后会记录观看进度。</p></template></aside></div>
                <section v-if="selected.source === 'catalog'" class="as-panel as-source-matches"><div class="as-section-title"><div><h3>播放来源 <small>{{ matches.length }}</small></h3><p>选择同名结果后查看剧集；不同来源的更新进度可能不同。</p></div><span v-if="matching"><Loader2 :size="14" class="as-spin" />{{ searchProgress.done }}/{{ searchProgress.total }} 个源</span><button v-else-if="sources.length" class="as-text-button" @click="openItem(selected)"><RefreshCw :size="13" />重新匹配</button><button v-if="!sources.length" class="as-button primary" @click="switchTab('rules')">管理播放源</button></div><div class="as-match-list"><button v-for="item in displayedMatches" :key="`${item.source}:${item.id}`" :class="{ active: detail?.id === item.id && detail?.source === item.source }" @click="openSource(item)"><span>{{ item.sourceLabel }}</span><strong :title="item.title">{{ item.title }}</strong><Check v-if="detail?.id === item.id && detail?.source === item.source" :size="14" /><ArrowRight v-else :size="14" /></button></div><button v-if="matches.length > 8" class="as-text-button" @click="allMatches = !allMatches">{{ allMatches ? '收起来源' : `查看全部 ${matches.length} 个匹配结果` }}<ChevronDown :size="13" /></button><p v-if="!matching && sources.length && !matches.length" class="as-muted">未找到同名番剧，可返回搜索其他名称或启用更多播放源。</p></section>
                <div v-if="detailBusy" class="as-loading"><Loader2 :size="23" class="as-spin" />正在读取播放线路…<button class="as-button" @click="detailRevision++; detailBusy = false">停止等待</button></div><div v-if="detailError" class="as-notice" role="alert">{{ detailError }}<button v-if="lastSource" @click="openSource(lastSource)">重试此源</button></div>
                <template v-if="detail"><section class="as-panel as-episodes-panel"><div class="as-section-title"><div><h3>剧集列表 <small>{{ episodes.length }} 集</small></h3><p>{{ activeSourceLabel }}<template v-if="currentEpisode"> · 正在观看 {{ currentEpisode.title }}</template></p></div><button class="as-text-button" @click="verify(detail.source)"><ShieldCheck :size="14" />站点验证</button></div><div class="as-route-tabs"><button v-for="(road, index) in detail.routes" :key="`${index}:${road.name}`" :class="{ active: routeIndex === index }" @click="switchRoute(index)">{{ road.name }}<small>{{ road.episodes.length }} 集</small></button></div><div class="as-episode-toolbar"><label class="as-field"><Search :size="14" /><input v-model="episodeFilter" aria-label="筛选剧集" placeholder="查找集数或标题…" /><button v-if="episodeFilter" class="as-icon-button" aria-label="清空剧集筛选" @click="episodeFilter = ''"><X :size="12" /></button></label><button class="as-button as-sort" :aria-pressed="reverseEpisodes" @click="reverseEpisodes = !reverseEpisodes"><ArrowDownUp :size="14" />{{ reverseEpisodes ? '倒序' : '正序' }}</button><div class="as-view-toggle" aria-label="剧集布局"><button :class="{ active: episodeLayout === 'grid' }" :aria-pressed="episodeLayout === 'grid'" aria-label="网格选集" @click="episodeLayout = 'grid'"><LayoutGrid :size="15" /></button><button :class="{ active: episodeLayout === 'list' }" :aria-pressed="episodeLayout === 'list'" aria-label="列表选集" @click="episodeLayout = 'list'"><List :size="15" /></button></div></div><div class="as-episode-grid" :class="{ 'as-episode-list': episodeLayout === 'list' }"><button v-for="episode in filteredEpisodes" :key="episode.id || episode.url" :class="{ active: currentEpisode?.url === episode.url, watched: lastWatched?.ep === episode.title }" :title="episode.title" @click="playEpisode(episode)"><Play v-if="currentEpisode?.url === episode.url" :size="12" fill="currentColor" /><span>{{ episode.title }}</span><small v-if="lastWatched?.ep === episode.title">上次</small></button></div><p v-if="!filteredEpisodes.length" class="as-muted as-no-episodes">{{ episodeFilter ? '没有匹配的剧集，请换个关键词。' : '这条线路暂无剧集，请选择其他线路。' }}</p></section>
                    <section v-if="currentEpisode" ref="playerSection" class="as-player"><header><div><strong>{{ detail.title }}</strong><span>{{ currentEpisode.title }} · {{ activeSourceLabel }}</span></div><button class="as-icon-button" aria-label="关闭当前播放" @click="cancelPlayback"><X :size="18" /></button></header><div v-if="playBusy" class="as-player-status"><Loader2 :size="28" class="as-spin" /><strong>正在解析播放地址 · {{ parseElapsed }} 秒</strong><span>最长等待 28 秒，超时后可换线路</span><button class="as-button" @click="cancelPlayback">取消解析</button></div><div v-else-if="playError" class="as-player-status" role="alert"><Film :size="27" /><strong>{{ playError }}</strong><span>播放源可能失效或暂时无法连接。</span><div class="as-recovery-actions"><button class="as-button" @click="playEpisode(currentEpisode)"><RefreshCw :size="14" />重试此集</button><button v-if="detail.routes.length > 1" class="as-button primary" @click="tryOtherRoute">换一条线路<ArrowRight :size="14" /></button><button class="as-button" @click="cancelPlayback">返回选集</button></div></div><ArtVideoPlayer v-else-if="playUrl && playType !== 'iframe'" ref="player" :src="playUrl" :play-type="playType" :load-timeout-ms="20000" :episodes="episodes" :current-episode="currentEpisode" :episode-title="detail.title" :episode-cover="detail.cover" :has-prev="episodeIndex > 0" :has-next="episodeIndex >= 0 && episodeIndex < episodes.length - 1" :resume-key="`anime-source:${detail.source}:${detail.id}:${currentEpisode.url}`" @prev="adjacent(-1)" @next="adjacent(1)" @ended="adjacent(1)" @retry="playEpisode(currentEpisode)" @select-episode="playEpisode" @error="playerFailed" @playing="recordPlaying" /><template v-else-if="playUrl"><div v-if="!iframeRequested" class="as-player-status"><Film :size="27" /><strong>{{ iframeTimedOut ? '站点网页加载超时' : '此源未能提取内置播放器地址' }}</strong><span>可以手动尝试站点网页播放器，或更换其他线路。</span><div class="as-recovery-actions"><button class="as-button" @click="showWebPlayer">尝试网页播放</button><button v-if="detail.routes.length > 1" class="as-button primary" @click="tryOtherRoute">换一条线路</button><button class="as-button" @click="cancelPlayback">返回选集</button></div></div><template v-else><div v-if="!iframeLoaded" class="as-web-loading"><Loader2 :size="15" class="as-spin" />正在载入网页播放器，最多等待 15 秒<button @click="iframeRequested = false; iframeTimedOut = true">停止等待</button></div><iframe :src="playUrl" title="动漫源网页播放器" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer-when-downgrade" @load="webLoaded" /><p class="as-iframe-note">网页已载入不代表视频可用；若无画面，请更换线路。<button @click="cancelPlayback">返回选集</button></p></template></template></section>
                </template>
                <section v-if="related.length" class="as-related"><div class="as-section-title"><div><span class="as-eyebrow">接着发现</span><h3>还有这些故事</h3></div><button class="as-text-button" @click="switchTab('discover')">全部推荐<ArrowRight :size="14" /></button></div><div class="as-poster-grid"><button v-for="item in related" :key="item.id" class="as-poster-card" @click="openItem(item)"><div class="as-poster"><AnimeSourceCover :src="item.cover" :title="item.title" /><span v-if="item.score" class="as-score">{{ Number(item.score).toFixed(1) }}</span><span class="as-cover-play"><Play :size="22" fill="currentColor" /></span></div><strong>{{ item.title }}</strong><small>{{ item.tags?.slice(0, 2).join(' · ') || item.originalTitle }}</small></button></div></section>
            </section>
        </div>
        <input ref="importFile" type="file" accept=".json,.txt,application/json" hidden @change="readRuleFile" />
        <div v-if="ruleEditor" class="as-modal-backdrop" @click.self="ruleEditor = false"><section class="as-editor" role="dialog" aria-modal="true" aria-label="动漫源规则编辑"><header><div><span class="as-eyebrow">规则导入与编辑</span><h2>添加你的动漫源</h2></div><button class="as-icon-button" aria-label="关闭规则编辑" @click="ruleEditor = false"><X :size="20" /></button></header><p>粘贴单条或多条 JSON 规则、规则分享链接，或 JSON 文件地址。支持 XPath、CSS 和 API 规则。</p><textarea v-model="ruleText" aria-label="规则内容" spellcheck="false" placeholder="在这里粘贴规则内容…" /><p v-if="ruleError" class="as-editor-error" role="alert">{{ ruleError }}</p><footer><button class="as-button" @click="importFile.click()"><FileJson :size="15" />选择文件</button><span /><button class="as-button" @click="ruleEditor = false">取消</button><button class="as-button primary" :disabled="saving || !ruleText.trim()" @click="saveRule"><Loader2 v-if="saving" class="as-spin" :size="15" />保存规则</button></footer></section></div>
    </main>
</template>

<style scoped src="./anime-source.css"></style>
