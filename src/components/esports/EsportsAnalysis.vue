<script setup>
import { computed, ref, watch } from 'vue'
import { Crosshair, Map as MapIcon, Swords, Activity, Users } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'
import EsportsMatches from './EsportsMatches.vue'
import EsportsStats from './EsportsStats.vue'
import { teamName, matchState, score } from '../../utils/esports'
const props = defineProps({ result: {type:Object,default:()=>({})}, info: {type:Object,default:()=>({})}, game:String, loading:Boolean, error:String })
const selected = ref([0,0]), mode = ref('radar'), mapMode = ref('rate'), recentSide = ref('t1')
const comparison = computed(() => props.result.comparison || {})
const players = computed(() => [comparison.value.t1_player_stats || [],comparison.value.t2_player_stats || []])
watch(players, () => { selected.value = [0,0] })
const pair = computed(() => players.value.map((rows,i) => rows[selected.value[i]] || {}))
// Only actual per-player numbers are plotted. No fixed maxima or invented
// radar shapes: each pair is compared against the other player's real value.
const number = value => {
    const parsed = parseFloat(String(value ?? '').replace('%', '').replace('+', ''))
    return Number.isFinite(parsed) ? parsed : null
}
const duelMetrics = computed(() => {
    const specs = props.game === 'val'
        ? [['rating','Rating'],['acs','ACS'],['adr','ADR'],['kd','K/D'],['avg_first_kill','首杀']]
        : [['Rating','Rating'],['adr','ADR'],['kd','K/D'],['kast','KAST'],['kpr','KPR'],['swing','Swing']]
    return specs.map(([key,label]) => {
        const a = number(pair.value[0]?.[key]), b = number(pair.value[1]?.[key])
        if (a === null && b === null) return null
        const left = a === null && b === null ? 50 : (Math.abs(a || 0) + Math.abs(b || 0)) ? Math.abs(a || 0) / (Math.abs(a || 0) + Math.abs(b || 0)) * 100 : 50
        return { key, label, a: pair.value[0]?.[key] ?? '--', b: pair.value[1]?.[key] ?? '--', left }
    }).filter(Boolean)
})
const maps = computed(()=>comparison.value.team_map_stats || [])
const numeric = value => Math.min(100,Math.max(0,parseFloat(value)||0))
const display = value => value==null || value==='' || value==='--' ? '--' : `${value}%`
// 5EPlay's map table marks this match's veto on the owning team's cell:
// PICK is green, BAN is red. Counts/percentages remain the last three months.
const mapBadge = (map, side) => {
    const type = String(map?.bp_type || '')
    if (!type.startsWith(`${side}_`)) return ''
    if (type.endsWith('_pick')) return 'PICK'
    if (type.endsWith('_ban')) return 'BAN'
    return type.slice(type.indexOf('_') + 1).toUpperCase()
}
const mapModeValue = (map, side) => {
    const prefix = `${side}_`
    if (mapMode.value === 'rate') return { value: display(map[`${prefix}rate`]), meta: `${map[`${prefix}win_num`] || 0} 胜` }
    if (mapMode.value === 'pick') return { value: `${map[`${prefix}pick_count`] ?? 0} 次`, meta: `${display(map[`${prefix}pick_rate`])} PICK` }
    return { value: `${map[`${prefix}ban_count`] ?? 0} 次`, meta: `${display(map[`${prefix}ban_rate`])} BAN` }
}
const mapModeRate = (map, side) => numeric(map[`${side}_${mapMode.value === 'rate' ? 'rate' : `${mapMode.value}_rate`}`])
function recentMatches(value) {
    const found = new Map()
    function walk(node, tournament) {
        if (!node || typeof node !== 'object') return
        tournament = node.tt_info || tournament
        if (node.mc_info?.id) { found.set(node.mc_info.id,node); return }
        if (node.home_info && node.opponent_info && node.id) {
            found.set(node.id,{mc_info:{id:node.id,format:node.format,plan_ts:node.ts,t1_info:node.home_info,t2_info:node.opponent_info},state:{status:node.status,t1_score:node.home_score,t2_score:node.opponent_score},tt_info:tournament});return
        }
        if (node.match?.id && node.match.t1_score!==undefined) {
            found.set(node.match.id,{mc_info:{...node.match,plan_ts:node.match.ts,t1_info:props.info.t1_info,t2_info:props.info.t2_info},state:{status:'2',t1_score:node.match.t1_score,t2_score:node.match.t2_score},tt_info:tournament});return
        }
        for (const child of Object.values(node)) if(child && typeof child==='object') walk(child,tournament)
    }
    walk(value)
    return [...found.values()].slice(0,10)
}
const recent = computed(()=>recentMatches(props.result[`${recentSide.value}_rec_matches`]))
const headToHead = computed(()=>recentMatches(props.result.rec_vs_matches))
const form = computed(()=>recent.value.slice(0,5).map(row=>{const s=matchState(row); const ourFirst=row.mc_info.t1_info?.id===props.info[`${recentSide.value}_info`]?.id;const a=Number(ourFirst?s.t1_score:s.t2_score),b=Number(ourFirst?s.t2_score:s.t1_score);return {text:score(a)+':'+score(b),won:a>b,draw:a===b}}))
const metrics = computed(()=>{
    const labels={win_rate:'胜率（小局）',rating:'Rating',acs:'ACS',adr:'ADR',kd:'K/D',f_rate:props.game==='val'?'进攻胜率':'上半场手枪局',s_rate:props.game==='val'?'防守胜率':'下半场手枪局'}
    const a=comparison.value.t1_stats || {},b=comparison.value.t2_stats || {}
    return Object.entries(labels).filter(([key])=>a[key]!==undefined || b[key]!==undefined).map(([key,label])=>{const na=numeric(a[key]),nb=numeric(b[key]);return {key,label,a:a[key]??'--',b:b[key]??'--',left:na+nb>0?na/(na+nb)*100:50}})
})
</script>
<template>
    <div v-if="loading" class="es-state"><Activity :size="24" />加载比赛分析</div>
    <div v-else-if="error" class="es-state">{{ error }}</div>
    <div v-else class="es-analysis-layout">
        <section class="es-analysis-card es-player-analysis"><header class="es-section-title"><h3><Crosshair :size="18" />选手分析</h3><span>最近三个月</span></header>
            <div class="es-analysis-subtabs"><button :class="{active:mode==='radar'}" @click="mode='radar'">真实数据对比</button><button :class="{active:mode==='data'}" @click="mode='data'">数据对比</button></div>
            <template v-if="players.some(rows=>rows.length)">
                <div class="es-player-strip"><button v-for="(p,i) in players[0]" :key="p.id || p.name" :class="{active:selected[0]===i}" @click="selected[0]=i"><span class="es-player-portrait"><EsportsImage :src="p.half_logo || p.logo || p.portrait" :alt="p.name" /><img v-if="p.country_logo" :src="p.country_logo" alt="" loading="lazy" referrerpolicy="no-referrer" /></span><span>{{ p.name }}</span></button></div>
                <div v-if="mode==='radar'" class="es-player-duel"><div v-for="(p,i) in pair" :key="i" class="es-duel-player" :class="{right:i===1}"><EsportsImage class="es-duel-team-watermark" :src="info[`t${i+1}_info`]?.logo" /><EsportsImage :src="p.half_logo || p.logo || p.portrait" :alt="p.name" /><b>{{ p.name || '待定' }}</b></div>
                    <div v-if="duelMetrics.length" class="es-duel-metrics"><div v-for="m in duelMetrics" :key="m.key" class="es-duel-metric"><div class="es-duel-metric-head"><b>{{ m.a }}</b><span>{{ m.label }}</span><b>{{ m.b }}</b></div><div class="es-duel-metric-track"><i class="left" :style="{width:`${m.left}%`}"></i><i class="right" :style="{width:`${100-m.left}%`}"></i></div></div></div><p v-else class="es-empty-small">暂无可对比的选手数据</p>
                </div>
                <div v-else class="es-player-data"><EsportsStats :rows="pair" :game="game" :expanded="true" /></div>
                <div class="es-player-strip is-right"><button v-for="(p,i) in players[1]" :key="p.id || p.name" :class="{active:selected[1]===i}" @click="selected[1]=i"><span class="es-player-portrait"><EsportsImage :src="p.half_logo || p.logo || p.portrait" :alt="p.name" /><img v-if="p.country_logo" :src="p.country_logo" alt="" loading="lazy" referrerpolicy="no-referrer" /></span><span>{{ p.name }}</span></button></div>
                <p class="es-analysis-note">对比条按两名选手的真实数值等比缩放，不使用虚构雷达范围。</p>
            </template><p v-else class="es-empty-small">暂无选手分析数据</p>
        </section>
        <section class="es-analysis-card es-map-analysis"><header class="es-section-title"><h3><MapIcon :size="18" />地图分析</h3><span>最近三个月</span></header><div class="es-analysis-subtabs"><button :class="{active:mapMode==='rate'}" @click="mapMode='rate'">胜率</button><button :class="{active:mapMode==='pick'}" @click="mapMode='pick'">PICK</button><button :class="{active:mapMode==='ban'}" @click="mapMode='ban'">BAN</button></div><div class="es-map-table"><div class="es-map-table-head"><span>地图</span><span class="es-map-table-team"><EsportsImage :src="info.t1_info?.logo" />{{ teamName(info.t1_info) }}</span><span class="es-map-table-team"><EsportsImage :src="info.t2_info?.logo" />{{ teamName(info.t2_info) }}</span></div><div v-for="map in maps" :key="map.name" class="es-map-table-row"><div class="es-map-table-name" :style="{ backgroundImage: `url(${map.bgm || map.icon})` }"><b>{{ map.name_zh || map.name }}</b><small>{{ map.name }}</small></div><div v-for="side in ['t1','t2']" :key="side" class="es-map-table-cell"><span v-if="mapBadge(map, side)" class="es-map-badge" :class="mapBadge(map, side).toLowerCase()">{{ mapBadge(map, side) }}</span><div class="es-map-cell-value"><b>{{ mapModeValue(map, side).value }}</b><small>{{ mapModeValue(map, side).meta }}</small></div><div class="es-map-bar"><i :class="side" :style="{ width: `${mapModeRate(map, side)}%` }"></i></div></div></div><p v-if="!maps.length" class="es-empty-small">暂无地图分析数据</p></div></section>
        <section class="es-analysis-card"><header class="es-section-title"><h3><Activity :size="18" />近期战绩</h3><span>最近 10 场</span></header><div class="es-analysis-subtabs"><button v-for="side in ['t1','t2']" :key="side" :class="{active:recentSide===side}" @click="recentSide=side"><EsportsImage :src="info[`${side}_info`]?.logo" />{{ teamName(info[`${side}_info`]) }}</button></div><div v-if="form.length" class="es-recent-form"><span>近期走势</span><b v-for="(item,index) in form" :key="index" :class="{won:item.won,draw:item.draw}" :title="item.text">{{ item.draw?'D':item.won?'W':'L' }}</b></div><EsportsMatches :rows="recent" :game="game" /><p v-if="!recent.length" class="es-empty-small">暂无近期战绩</p></section>
        <section class="es-analysis-card"><header class="es-section-title"><h3><Swords :size="18" />交手战绩</h3><span>最近交手</span></header><EsportsMatches :rows="headToHead" :game="game" /><p v-if="!headToHead.length" class="es-empty-small">双方暂无交手记录</p><header class="es-section-title"><h3><Users :size="18" />战队分析</h3><span>最近三个月</span></header><div class="es-analysis-teamline"><span><EsportsImage :src="info.t1_info?.logo" />{{ teamName(info.t1_info) }}</span><i>VS</i><span>{{ teamName(info.t2_info) }}<EsportsImage :src="info.t2_info?.logo" /></span></div><div class="es-comparison-bars"><div v-for="m in metrics" :key="m.key"><div><b>{{ m.a }}{{ /rate$/.test(m.key) && m.a!=='--' ? '%' : '' }}</b><span>{{ m.label }}</span><b>{{ m.b }}{{ /rate$/.test(m.key) && m.b!=='--' ? '%' : '' }}</b></div><div class="es-comparison-track"><i :style="{width:`${m.left}%`}"></i><i :style="{width:`${100-m.left}%`}"></i></div></div></div><p v-if="!metrics.length" class="es-empty-small">暂无战队对比数据</p></section>
    </div>
</template>
