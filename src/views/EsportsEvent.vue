<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, RefreshCw, Trophy, MapPin, CalendarDays, Users, Map as MapIcon, BarChart3 } from 'lucide-vue-next'
import { esports } from '../api/esports'
import { itemsOf, stageBrackets, stageMatches, uniqueMatches, statusText } from '../utils/esports'
import EsportsImage from '../components/esports/EsportsImage.vue'
import EsportsStats from '../components/esports/EsportsStats.vue'
import EsportsMatches from '../components/esports/EsportsMatches.vue'
import EsportsBracket from '../components/esports/EsportsBracket.vue'
import EsportsPlacements from '../components/esports/EsportsPlacements.vue'
import CustomSelect from '../components/CustomSelect.vue'
import '../styles/esports.css'

const route = useRoute(), router = useRouter()
const game = computed(() => route.params.game === 'val' ? 'val' : 'csgo')
const id = computed(() => String(route.params.eventId || ''))
const event = ref(null), stages = ref([]), matches = ref([]), loading = ref(true), error = ref('')
const tab = ref('matches'), kind = ref('player'), rows = ref([]), statsError = ref(''), statsLoading = ref(false), expanded = ref(true), metric = ref('acs')
const stageIndex = ref('all'), bracketMode = ref(true)
let sequence = 0, statsSequence = 0, disposed = false
const basic = computed(() => event.value?.basic || {})
const groups = computed(() => stageMatches(stages.value))
const stageOptions = computed(() => [{ value:'all', label:'全部赛段' }, ...groups.value.map((g,i) => ({ value:String(i), label:g.name }))])
const displayedMatches = computed(() => stageIndex.value === 'all' ? uniqueMatches([...matches.value, ...groups.value.flatMap(g => g.matches)]) : groups.value[Number(stageIndex.value)]?.matches || [])
const brackets = computed(() => stageBrackets(stages.value))
const displayedBrackets = computed(() => stageIndex.value === 'all' ? brackets.value : brackets.value[Number(stageIndex.value)] ? [brackets.value[Number(stageIndex.value)]] : [])
const bracketRounds = computed(() => stageIndex.value === 'all' ? brackets.value.flatMap(bracket => bracket.rounds) : brackets.value[Number(stageIndex.value)]?.rounds || [])
const teams = computed(() => {
    const found = []
    for (const item of event.value?.team_list || event.value?.teams || []) found.push(item.team || item)
    if (!found.length) for (const item of event.value?.cur_team_rank || []) if (item.team?.id) found.push(item.team)
    return [...new Map(found.map(t => [t.id, t])).values()]
})
const metricOptions = [{value:'acs',label:'ACS'}, {value:'adr',label:'ADR'}, {value:'kd',label:'K/D'}]
async function loadStats() {
    const token = ++statsSequence
    statsLoading.value = true; statsError.value = ''; rows.value = []
    try {
        const response = await esports('event-stats', { game:game.value, id:id.value, kind:kind.value, metric:metric.value, limit:100 })
        if (token !== statsSequence || disposed) return
        rows.value = game.value === 'csgo' ? response?.[`${kind.value}_data`] || [] : itemsOf(response)
    } catch(e) { if (token === statsSequence && !disposed) statsError.value = e.message }
    finally { if (token === statsSequence && !disposed) statsLoading.value = false }
}
async function load() {
    const token = ++sequence; ++statsSequence
    loading.value = true; error.value = ''; event.value = null; stages.value = []; matches.value = []; stageIndex.value = 'all'; bracketMode.value = true; tab.value = 'matches'
    try {
        const response = await esports('event', { game:game.value, id:id.value })
        if (token !== sequence || disposed) return
        if (!response?.basic) throw new Error('该赛事暂未提供详情')
        event.value = response
        const [s,m] = await Promise.allSettled([esports('stages',{ game:game.value,id:id.value }),esports('event-matches',{ game:game.value,id:id.value,limit:100 })])
        if (token !== sequence || disposed) return
        if (s.status === 'fulfilled') {
            stages.value = itemsOf(s.value)
            if (brackets.value.length) stageIndex.value = '0'
        }
        if (m.status === 'fulfilled') matches.value = m.value?.matches || []
        await loadStats()
    } catch(e) { if (token === sequence && !disposed) error.value = e.message }
    finally { if (token === sequence && !disposed) loading.value = false }
}
watch(() => [game.value,id.value], load, { immediate:true })
watch([kind,metric], loadStats)
onBeforeUnmount(() => { disposed = true; sequence++; statsSequence++ })
</script>
<template>
    <div class="es-page es-event-page">
        <header class="es-topline"><button class="es-icon-btn" title="返回赛事中心" @click="router.push({path:'/entertainment',query:{game,tab:'event'}})"><ChevronLeft :size="20" /></button><span>{{ game === 'val' ? 'VALORANT' : 'COUNTER-STRIKE' }} / 赛事详情</span><button class="es-icon-btn" title="刷新赛事" @click="load"><RefreshCw :size="17" /></button></header>
        <div v-if="loading" class="es-state"><RefreshCw class="es-spin" :size="24" />加载赛事详情</div>
        <div v-else-if="error" class="es-state"><p>{{ error }}</p><button class="es-button" @click="load">重试</button></div>
        <template v-else-if="event">
            <section class="es-event-banner"><EsportsImage :src="basic.logo" /><div><span class="es-status" :class="{live:basic.status==='live'}">{{ statusText(basic.status) }}</span><h1>{{ basic.tt_name_show || basic.name_zh || basic.name_en }}</h1><p v-if="basic.name_en">{{ basic.name_en }}</p><div class="es-event-meta"><span><CalendarDays :size="14" />{{ basic.start_time?.slice(0,10) }} 至 {{ basic.end_time?.slice(0,10) }}</span><span><MapPin :size="14" />{{ basic.city_name || '--' }}</span><span><Trophy :size="14" />{{ basic.bonus || '--' }}</span></div></div></section>
            <div class="es-event-summary"><span><Users :size="18" /><b>{{ teams.length || '--' }}</b>参赛队伍</span><span><CalendarDays :size="18" /><b>{{ displayedMatches.length }}</b>场比赛</span><span><MapIcon :size="18" /><b>{{ event.maps?.length || '--' }}</b>比赛地图</span><span><Trophy :size="18" /><b>{{ basic.bonus || '--' }}</b>赛事奖金</span></div>
            <nav class="es-tabs es-detail-tabs"><button :class="{active:tab==='matches'}" @click="tab='matches'">赛程 / 对阵</button><button :class="{active:tab==='stats'}" @click="tab='stats'"><BarChart3 :size="15" />赛事统计</button><button :class="{active:tab==='teams'}" @click="tab='teams'">参赛队伍</button><button :class="{active:tab==='results'}" @click="tab='results'"><Trophy :size="15" />名次 / 奖金</button><button :class="{active:tab==='maps'}" @click="tab='maps'">比赛地图</button></nav>
            <section v-if="tab==='matches'" class="es-detail-content">
                <div class="es-toolbar"><div><h3>赛程 / 对阵图</h3><p class="es-bracket-caption">{{ displayedBrackets.length===1 ? displayedBrackets[0].description || '赛事阶段与晋级路线' : '赛事阶段与晋级路线' }}</p></div><div class="es-bracket-controls"><div v-if="brackets.length" class="es-segment"><button :class="{active:bracketMode}" @click="bracketMode=true">对阵图</button><button :class="{active:!bracketMode}" @click="bracketMode=false">列表</button></div><CustomSelect v-model="stageIndex" :options="stageOptions" /></div></div>
                <template v-if="bracketMode && brackets.length">
                    <nav class="es-stage-tabs" aria-label="选择赛事阶段"><button v-for="(bracket,index) in brackets" :key="bracket.key" :class="{active:stageIndex===String(index)}" @click="stageIndex=String(index)">{{ bracket.stageName }}<template v-if="brackets.filter(b=>b.stageId===bracket.stageId).length>1"> · {{ bracket.groupName }}</template></button></nav>
                    <div class="es-bracket-legend"><span><i />晋级</span><span><i class="eliminated" />淘汰</span><span><i class="live" />进行中</span><small>点击比赛查看详情 · 左右滑动查看完整对阵</small></div>
                    <div v-for="bracket in displayedBrackets" :key="bracket.key" class="es-bracket-stage"><template v-for="(section,index) in bracket.sections" :key="`${bracket.key}-${index}`"><p v-if="displayedBrackets.length>1 || bracket.sections.length>1" class="es-bracket-stage-title">{{ bracket.name }} · {{ section.name }}</p><EsportsBracket :section="section" :game="game" /></template></div>
                </template>
                <EsportsMatches v-else :rows="displayedMatches" :game="game" /><p v-if="!displayedMatches.length && !bracketRounds.length" class="es-state">暂无对阵数据</p>
            </section>
            <section v-else-if="tab==='stats'" class="es-detail-content"><div class="es-toolbar"><div class="es-segment"><button :class="{active:kind==='player'}" @click="kind='player'">选手</button><button :class="{active:kind==='team'}" @click="kind='team'">战队</button></div><CustomSelect v-if="game==='val'" v-model="metric" :options="metricOptions" /><label><input v-model="expanded" type="checkbox" />全部指标</label></div><p v-if="statsError" class="es-warning">{{ statsError }}</p><div v-if="statsLoading" class="es-state"><RefreshCw class="es-spin" :size="20" />加载统计</div><EsportsStats v-else :rows="rows" :game="game" :expanded="expanded" /></section>
            <section v-else-if="tab==='teams'" class="es-detail-content"><div class="es-event-grid"><div v-for="team in teams" :key="team.id" class="es-event-card"><EsportsImage :src="team.logo" /><strong>{{ team.name || team.disp_name || team.abbr }}</strong></div></div><p v-if="!teams.length" class="es-state">参赛队伍尚未公布</p></section>
            <section v-else-if="tab==='results'" class="es-detail-content"><div class="es-section-title"><h3><Trophy :size="18" />赛事排名</h3><span>名次 · 奖金 · 晋级</span></div><EsportsPlacements :rows="event.cur_team_rank || event.team_rank || []" /></section>
            <section v-else-if="tab==='maps'" class="es-detail-content"><div class="es-event-maps"><div v-for="map in event.maps || []" :key="map.name" class="es-event-map"><img v-if="map.url || map.logo" :src="map.url || map.logo" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>{{ map.name }}</span></div></div><p v-if="!event.maps?.length" class="es-state">暂无地图池信息</p></section>
        </template>
    </div>
</template>
