<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RefreshCw, Radio, Search, ChevronRight, CalendarDays, Trophy, Gamepad2, BarChart3, Layers, Flag, Users, Star } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { esports } from '../api/esports'
import { useEsportsRefresh } from '../composables/useEsportsRefresh'
import { itemsOf, localDate, matchInfo, gameName, uniqueMatches } from '../utils/esports'
import EsportsMatches from '../components/esports/EsportsMatches.vue'
import EsportsStats from '../components/esports/EsportsStats.vue'
import EsportsImage from '../components/esports/EsportsImage.vue'
import EsportsEventCard from '../components/esports/EsportsEventCard.vue'
import EsportsRanking from '../components/esports/EsportsRanking.vue'
import EsportsPlacements from '../components/esports/EsportsPlacements.vue'
import CustomSelect from '../components/CustomSelect.vue'
import '../styles/esports.css'

const route = useRoute(), router = useRouter()
const game = computed(() => route.query.game === 'val' ? 'val' : 'csgo')
const tab = computed(() => ['schedule','result','event','ranking','data','series'].includes(route.query.tab) ? route.query.tab : 'schedule')
const loading = ref(false), error = ref(''), updateError = ref(''), loadingMore = ref(false), hasMore = ref(true)
const rows = ref([]), matches = ref([]), events = ref([]), series = ref([])
const date = ref(localDate()), scheduleDate = ref(''), search = ref(''), status = ref('all'), eventStatus = ref('upcoming')
const kind = ref('team'), region = ref(''), selectedEvent = ref(''), metric = ref('acs'), expanded = ref(false), updatedAt = ref('')
const rankingSource = ref('vrs'), rankPublication = ref(''), rankSourceUrl = ref(''), rankSourceLabel = ref(''), eventFilter = ref('all')
const favorites = ref([])
try { const stored = JSON.parse(localStorage.getItem('esports-favorite-events') || '[]'); if (Array.isArray(stored)) favorites.value = stored.filter(v=>typeof v==='string').slice(0,500) } catch {}
function toggleFavorite(id) { if (!id) return; favorites.value = favorites.value.includes(id) ? favorites.value.filter(v=>v!==id) : [...favorites.value,id].slice(-500); try { localStorage.setItem('esports-favorite-events',JSON.stringify(favorites.value)) } catch {} }
const page = ref(1), nextCursor = ref('')
const seriesEventRows = ref([]), seriesRegion = ref(''), seriesLoading = ref(false)
const seriesLeague = ref(''), seriesEventId = ref(''), seriesTab = ref('results')
const seriesRegions = computed(() => {
    const seen = new Set()
    return series.value.filter(s=>!seriesLeague.value || String(s.league_id)===String(seriesLeague.value)).flatMap(s => (s.league_list || []).map(area => {
        const value = String(area.region_id || '')
        if (!value || seen.has(value)) return null
        seen.add(value)
        return { value, label: `${s.league_name} · ${area.region_name || '总赛区'}` }
    }).filter(Boolean))
})
const seriesOptions = computed(()=>seriesEventRows.value.map(e=>({value:e.tt_id || e.basic_info?.id || e.id,label:e.basic_info?.disp_name || e.name || e.disp_name || e.tt_name})).filter(e=>e.value))
const currentSeriesEvent = computed(()=>seriesEventRows.value.find(e=>(e.tt_id || e.basic_info?.id || e.id)===seriesEventId.value))
function switchLeague(value) { seriesLeague.value=value; seriesRegion.value=seriesRegions.value[0]?.value || ''; loadSeriesEvents() }
let sequence = 0, seriesSequence = 0, disposed = false, resetting = false
const tabs = computed(() => [{value:'schedule',label:'赛程',icon:CalendarDays}, {value:'result',label:'赛果',icon:Flag}, {value:'event',label:'赛事',icon:Trophy}, {value:'ranking',label:'排行榜',icon:BarChart3}, {value:'data',label:'数据',icon:Layers}, ...(game.value === 'csgo' ? [{value:'series',label:'系列赛',icon:Gamepad2}] : [])])
const needsEvent = computed(() => tab.value === 'data' || (tab.value === 'ranking' && game.value === 'val' && kind.value === 'player'))
const eventOptions = computed(() => events.value.map(e => ({value:e.basic_info?.id,label:e.basic_info?.disp_name || '赛事'})).filter(e=>e.value))
const regionOptions = [{value:'',label:'全部赛区'},{value:'amers',label:'美洲'},{value:'emea',label:'EMEA'},{value:'pacific',label:'太平洋'},{value:'cn',label:'中国'}]
const vrsRegionOptions = [{value:'',label:'全球排名'},{value:'europe',label:'欧洲排名'},{value:'americas',label:'美洲排名'},{value:'asia',label:'亚洲排名'}]
const statusOptions = [{value:'all',label:'全部状态'},{value:'1',label:'进行中'},{value:'0',label:'未开始'},{value:'2',label:'已结束'}]
const eventStatusOptions = [{value:'upcoming',label:'进行中 / 即将开始'},{value:'past',label:'已结束'}]
const metricOptions = [{value:'acs',label:'ACS'},{value:'adr',label:'ADR'},{value:'kd',label:'K/D'}]
const visibleMatches = computed(() => matches.value.filter(m => (status.value === 'all' || String(m.state?.status) === status.value) && (!search.value || `${matchInfo(m).t1_info?.disp_name} ${matchInfo(m).t2_info?.disp_name} ${m.tt_info?.disp_name}`.toLowerCase().includes(search.value.toLowerCase()))))
const visibleEvents = computed(() => events.value.filter(e => (!search.value || (e.basic_info?.disp_name || '').toLowerCase().includes(search.value.toLowerCase())) && (eventFilter.value!=='featured' || ['1','2','3'].includes(String(e.basic_info?.grade))) && (eventFilter.value!=='favorites' || favorites.value.includes(e.basic_info?.id))))
const eventGroups = computed(()=>{const groups=new Map();for(const event of visibleEvents.value){const month=String(event.basic_info?.start_time || '').slice(0,7);const label=month ? `${month.slice(0,4)}年${Number(month.slice(5))}月` : '日期待定';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(event)}return [...groups].map(([label,items])=>({label,items}))})
const matchCounts = computed(()=>({live:matches.value.filter(m=>String(m.state?.status)==='1').length,upcoming:matches.value.filter(m=>String(m.state?.status)==='0').length,events:new Set(matches.value.map(m=>m.tt_info?.id).filter(Boolean)).size}))
const visibleRanks = computed(() => rows.value.filter(r => (!region.value || !r.region_id || r.region_id === region.value) && (!search.value || `${r.name} ${(r.players||[]).map(p=>p.name).join(' ')}`.toLowerCase().includes(search.value.toLowerCase()))))
function navigate(next) { router.replace({path:'/entertainment',query:{game:next.game || game.value,tab:next.tab || tab.value}}) }
async function loadSeriesEvents() {
    const token = sequence, seriesToken = ++seriesSequence
    seriesLoading.value = false; seriesEventRows.value = []; seriesEventId.value = ''
    if (!seriesRegion.value) return
    seriesLoading.value = true
    try {
        const league = series.value.find(item => String(item.league_id) === String(seriesLeague.value))
        const data = await esports('series-events',{game:game.value,id:seriesRegion.value,leagueId:seriesLeague.value,leagueName:league?.league_name || league?.abbr || '',limit:100})
        if (token === sequence && seriesToken === seriesSequence && !disposed) { seriesEventRows.value = [...itemsOf(data?.tt_list || data)].sort((a,b)=>String(b.start_time || '').localeCompare(String(a.start_time || ''))); seriesEventId.value = seriesOptions.value[0]?.value || ''; updateError.value = '' }
    } catch(e) { if (token === sequence && seriesToken === seriesSequence && !disposed) updateError.value = e.message }
    finally { if (token === sequence && seriesToken === seriesSequence && !disposed) seriesLoading.value = false }
}
async function load(append = false, quiet = false) {
    if (append && loadingMore.value) return
    const token = ++sequence, g = game.value, t = tab.value
    if (append) loadingMore.value = true
    else {
        loadingMore.value = false; loading.value = !quiet; page.value = 1; nextCursor.value = ''; hasMore.value = true
        if (!quiet) { rows.value = []; matches.value = []; error.value = '' }
    }
    const requestPage = append ? page.value + 1 : 1
    try {
        let response
        if (t === 'schedule') response = await esports('matches', {game:g,date:scheduleDate.value,page:requestPage,limit:40})
        else if (t === 'result') response = await esports('results', {game:g,date:date.value,cursor:append ? nextCursor.value : '',limit:40})
        else if (t === 'event') response = await esports('events', {game:g,status:eventStatus.value,cursor:append ? nextCursor.value : '',limit:100})
        else if (needsEvent.value) {
            if (!events.value.length || !events.value.some(e=>e.basic_info?.id === selectedEvent.value)) {
                const list = await esports('events',{game:g,status:'upcoming',limit:50})
                if (token !== sequence || disposed) return
                events.value = itemsOf(list)
                const current = events.value.find(e => e.basic_info?.status === 'live') || events.value[0]
                selectedEvent.value = current?.basic_info?.id || ''
            }
            if (!selectedEvent.value) { rows.value = []; return }
            response = await esports('event-stats',{game:g,id:selectedEvent.value,kind:kind.value,metric:metric.value,page:requestPage,limit:100})
        } else if (t === 'ranking') response = await esports('ranking',{game:g,kind:kind.value,page:requestPage,limit:30,region:region.value,source:rankingSource.value})
        else if (t === 'series') response = await esports('series',{game:g})
        if (token !== sequence || disposed) return
        if (t === 'schedule' || t === 'result') {
            const received = response?.matches || []
            const prev = append ? matches.value : []
            matches.value = uniqueMatches([...prev,...received])
            hasMore.value = received.length === 40 && matches.value.length > prev.length
            const last = received[received.length - 1]
            if (last) {
                const stamp = new Date(Number(last.mc_info?.plan_ts) * 1000)
                const time = `${String(stamp.getHours()).padStart(2,'0')}:${String(stamp.getMinutes()).padStart(2,'0')}:${String(stamp.getSeconds()).padStart(2,'0')}`
                const ids = received.filter(r => r.mc_info?.plan_ts === last.mc_info?.plan_ts).map(r=>r.mc_info.id).join(',')
                nextCursor.value = `${localDate(stamp)} ${time},${ids}`
            }
        } else if (t === 'event') {
            const received = itemsOf(response), prev = append ? events.value : []
            events.value = [...new Map([...prev,...received].map(e=>[e.basic_info?.id,e])).values()]
            hasMore.value = response?.has_more === true || (response?.has_more == null && received.length === 100 && events.value.length > prev.length)
            nextCursor.value = String(response?.page_token || received[received.length-1]?.page_token || '')
            if (!nextCursor.value) hasMore.value = false
        } else if (t === 'series') { series.value = itemsOf(response); hasMore.value = false; seriesLeague.value=series.value[0]?.league_id || ''; seriesRegion.value = seriesRegions.value[0]?.value || ''; await loadSeriesEvents() }
        else {
            const received = needsEvent.value && g === 'csgo' ? response?.[`${kind.value}_data`] || [] : itemsOf(response)
            rows.value = append ? [...new Map([...rows.value,...received].map(r=>[r.id,r])).values()] : received
            hasMore.value = !needsEvent.value && received.length === 30 && (!response?.total_rows || requestPage*30<Number(response.total_rows))
            rankPublication.value=response?.published_at || '';rankSourceUrl.value=response?.source_url || '';rankSourceLabel.value=response?.source || ''
        }
        page.value = requestPage; error.value = ''; updateError.value = ''
        updatedAt.value = new Date().toLocaleTimeString('zh-CN',{hour12:false})
    } catch(e) { if (token === sequence && !disposed) { if (quiet || append) updateError.value = e.message; else error.value = e.message } }
    finally { if (token === sequence && !disposed) { loading.value = false; loadingMore.value = false } }
}
watch(() => [game.value,tab.value], async (values, old) => { resetting = true; sequence++; seriesSequence++; events.value = []; selectedEvent.value = ''; search.value = ''; if(old && values[0]!==old[0]) { region.value='';kind.value='team' } await nextTick();resetting=false;if(!disposed)load() }, {immediate:true})
watch([date,scheduleDate,eventStatus,kind,metric,region], () => {if(!resetting)load()})
watch(rankingSource,()=>{if(region.value)region.value='';else load()})
useEsportsRefresh(() => load(false,true),30000,() => tab.value === 'schedule' && !loading.value && !loadingMore.value && page.value === 1)
onBeforeUnmount(() => { disposed = true; sequence++; seriesSequence++ })
</script>
<template>
    <div class="es-page es-overview">
        <header class="es-overview-heading"><div><span class="es-kicker">ESPORTS CENTER</span><h1><Gamepad2 :size="27" />娱乐专区<span class="es-heading-label">赛事中心</span></h1></div><div class="es-overview-update"><span v-if="updatedAt">更新于 {{ updatedAt }}</span><button class="es-icon-btn" :disabled="loading" title="刷新赛事" @click="load()"><RefreshCw :class="{'es-spin':loading}" :size="18" /></button></div></header>
        <div class="es-navigation"><div class="es-game-switch"><button :class="{active:game==='csgo'}" @click="navigate({game:'csgo',tab:'schedule'})"><span class="es-game-mark cs">CS</span><b>CS</b><small>Counter-Strike</small></button><button :class="{active:game==='val'}" @click="navigate({game:'val',tab:'schedule'})"><span class="es-game-mark val">V</span><b>VAL</b><small>VALORANT</small></button></div>
            <nav class="es-tabs es-main-tabs"><button v-for="item in tabs" :key="item.value" :class="{active:tab===item.value}" @click="navigate({tab:item.value})"><component :is="item.icon" :size="17" />{{ item.label }}</button></nav>
        </div>
        <div v-if="tab==='schedule' && !loading && !error" class="es-summary-strip"><div><CalendarDays :size="20" /><span>当前赛程<b>{{ matches.length }} 场</b></span></div><div><Radio :size="20" /><span>正在进行<b class="es-green">{{ matchCounts.live }} 场</b></span></div><div><CalendarDays :size="20" /><span>即将开始<b>{{ matchCounts.upcoming }} 场</b></span></div><div><Trophy :size="20" /><span>覆盖赛事<b>{{ matchCounts.events }} 项</b></span></div></div>
        <div v-if="tab==='ranking' || tab==='data'" class="es-category-tabs"><button :class="{active:kind==='team'}" @click="kind='team'"><Users :size="16" />战队</button><button :class="{active:kind==='player'}" @click="kind='player'">选手</button></div>
        <div v-if="tab==='event'" class="es-category-tabs"><button :class="{active:eventFilter==='all'}" @click="eventFilter='all'">全部</button><button :class="{active:eventFilter==='featured'}" @click="eventFilter='featured'">重点赛事</button><button :class="{active:eventFilter==='favorites'}" @click="eventFilter='favorites'"><Star :size="15" />我的收藏</button></div>
        <div v-if="tab==='series'" class="es-league-tabs"><button v-for="league in series" :key="league.league_id" :class="{active:seriesLeague===league.league_id}" @click="switchLeague(league.league_id)"><EsportsImage :src="league.logo" />{{ league.abbr || league.league_name }}</button></div>
        <div class="es-toolbar"><div class="es-filters">
            <template v-if="tab==='schedule'"><label class="es-date-control"><CalendarDays :size="15" /><input v-model="scheduleDate" type="date" aria-label="赛程日期" /></label><button v-if="scheduleDate" class="es-button" @click="scheduleDate=''">全部日期</button><CustomSelect v-model="status" :options="statusOptions" /></template>
            <label v-if="tab==='result'" class="es-date-control"><CalendarDays :size="15" /><input v-model="date" type="date" aria-label="赛果日期" /></label>
            <CustomSelect v-if="tab==='event'" v-model="eventStatus" :options="eventStatusOptions" />
            <template v-if="tab==='ranking' && game==='csgo' && kind==='team'"><div class="es-ranking-sources"><button :class="{active:rankingSource==='vrs'}" @click="rankingSource='vrs'">VRS 排名</button><button :class="{active:rankingSource==='hltv'}" @click="rankingSource='hltv'">HLTV 排名</button></div><CustomSelect v-if="rankingSource==='vrs'" v-model="region" :options="vrsRegionOptions" /></template>
            <CustomSelect v-if="needsEvent" v-model="selectedEvent" :options="eventOptions" placeholder="选择赛事" @update:model-value="load()" />
            <CustomSelect v-if="game==='val' && tab==='ranking' && kind==='team'" v-model="region" :options="regionOptions" />
            <CustomSelect v-if="needsEvent && game==='val'" v-model="metric" :options="metricOptions" />
            <template v-if="tab==='series'"><CustomSelect v-model="seriesRegion" :options="seriesRegions" @update:model-value="loadSeriesEvents" /><CustomSelect v-model="seriesEventId" :options="seriesOptions" placeholder="选择届次" /></template>
        </div><label v-if="tab!=='series'" class="es-search"><Search :size="15" /><input v-model="search" :placeholder="tab==='event' ? '搜索赛事' : '搜索战队 / 选手'" aria-label="筛选列表" /></label></div>
        <p v-if="updateError" class="es-warning">{{ updateError }}</p>
        <div v-if="loading" class="es-state"><RefreshCw class="es-spin" :size="24" />加载赛事数据</div>
        <div v-else-if="error" class="es-state"><p>{{ error }}</p><button class="es-button" @click="load()">重试</button><button v-if="tab==='ranking' && rankingSource==='vrs'" class="es-button" @click="rankingSource='hltv'">查看 HLTV 排名</button></div>
        <section v-else-if="tab==='schedule' || tab==='result'" class="es-overview-content"><div class="es-list-heading"><h2>{{ tab==='schedule' ? '赛程' : '赛果' }}</h2><span>{{ visibleMatches.length }} 场比赛</span></div><EsportsMatches :rows="visibleMatches" :game="game" /><div v-if="!visibleMatches.length" class="es-state">暂无符合条件的比赛</div></section>
        <section v-else-if="tab==='event'" class="es-overview-content es-events-content"><section v-for="group in eventGroups" :key="group.label" class="es-month-group"><header class="es-list-heading"><h2>{{ group.label }}</h2><span>{{ group.items.length }} 项赛事</span></header><div class="es-tournaments-grid"><EsportsEventCard v-for="event in group.items" :key="event.basic_info?.id" :event="event" :game="game" :saved="favorites.includes(event.basic_info?.id)" @favorite="toggleFavorite" /></div></section><div v-if="!visibleEvents.length" class="es-state">{{ eventFilter==='favorites' ? '还没有收藏赛事，点击赛事卡右上角的星标即可收藏' : '暂无符合条件的赛事' }}</div></section>
        <section v-else-if="tab==='ranking' || tab==='data'" class="es-overview-content"><div class="es-list-heading"><h2>{{ needsEvent ? '赛事统计' : `${gameName(game)} ${kind==='team' ? '战队' : '选手'}排行榜` }}</h2><label><input v-model="expanded" type="checkbox" />全部指标</label></div><p v-if="tab==='ranking' && game==='csgo' && kind==='team' && rankingSource==='vrs' && (rankPublication || rankSourceLabel)" class="es-ranking-attribution">{{ rankSourceLabel || 'VRS 榜单' }}<template v-if="rankPublication"> · 发布于 {{ rankPublication }}</template><a v-if="rankSourceUrl" :href="rankSourceUrl" target="_blank" rel="noopener noreferrer">查看来源<ChevronRight :size="12" /></a></p><EsportsRanking v-if="tab==='ranking' && kind==='team'" :rows="visibleRanks" :source="game==='csgo'?rankingSource:'val'" :source-label="rankSourceLabel" :expanded="expanded" /><EsportsStats v-else :rows="visibleRanks" :game="game" :expanded="expanded" /></section>
        <section v-else class="es-overview-content"><div v-if="seriesLoading" class="es-state"><RefreshCw class="es-spin" :size="24" />加载系列赛</div><template v-else-if="currentSeriesEvent"><section class="es-series-hero"><EsportsImage :src="currentSeriesEvent.logo || currentSeriesEvent.basic_info?.logo" /><div><h2>{{ currentSeriesEvent.name || currentSeriesEvent.basic_info?.disp_name }}</h2><p>{{ currentSeriesEvent.start_time?.slice(0,10) }} — {{ currentSeriesEvent.end_time?.slice(0,10) }}</p></div><button class="es-button" @click="router.push(`/entertainment/${game}/event/${seriesEventId}`)">查看详情<ChevronRight :size="15" /></button></section><nav class="es-category-tabs"><button :class="{active:seriesTab==='results'}" @click="seriesTab='results'">最终排名</button><button :class="{active:seriesTab==='teams'}" @click="seriesTab='teams'">战队</button><button @click="router.push(`/entertainment/${game}/event/${seriesEventId}`)">阶段 / 数据<ChevronRight :size="14" /></button></nav><EsportsPlacements v-if="seriesTab==='results'" :rows="currentSeriesEvent.team_rank || []" /><div v-else class="es-event-grid"><div v-for="team in currentSeriesEvent.teams || []" :key="team.id" class="es-event-card"><EsportsImage :src="team.logo" /><span><strong>{{ team.name || team.abbr }}</strong><small>{{ team.region_name || '参赛队伍' }}</small></span></div></div></template><p v-else class="es-state">暂无该赛区赛事</p></section>
        <button v-if="!loading && !error && hasMore" class="es-button es-load-more" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '加载中' : '加载更多' }}</button>
    </div>
</template>
