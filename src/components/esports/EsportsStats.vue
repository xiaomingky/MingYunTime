<script setup>
import { computed, ref, watch } from 'vue'
import EsportsImage from './EsportsImage.vue'
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
const props = defineProps({ rows: { type: Array, default: () => [] }, game: { type: String, default: 'csgo' }, expanded: Boolean })
const labels = {
    rank: '排名', score: '积分 / 战力', rating: 'Rating', Rating: 'Rating', acs: 'ACS', adr: 'ADR', kast: 'KAST', kd: 'K/D', kd_rate: 'K/D',
    kill: '击杀', death: '死亡', assist: '助攻', kd_diff: 'KD 差', map_count: '地图数', map_nums: '地图数', game_played: '场次', disp_value: '统计值',
    head_shot_rate: '爆头率', headshot: '爆头', first_blood_num: '首杀', first_death_num: '首死', fk: '首杀', fd: '首死', fkdiff: '首杀差',
    kpr: '每回合击杀', dpr: '每回合死亡', impact: 'Impact', swing: 'Swing', mk_rating: '多杀评分', more_kill: '多杀',
    cl_win_num: '残局获胜', final_victory_num: '残局获胜', v1: '1v1', v2: '1v2', v3: '1v3', v4: '1v4', v5: '1v5',
    k2: '双杀', k3: '三杀', k4: '四杀', k5: '五杀', flash_assist: '闪光助攻', traded_death: '被补枪', round_mvp: '回合 MVP',
    gold_rate: 'KAST', alive: '存活', first_blood_rate: '首杀率', subpackage_num: '下包', unpack_num: '拆包', hs:'爆头率', repeatedly_death_num:'被补枪', kdratio:'K/D'
}
const basic = computed(() => props.game === 'val' ? ['rank', 'score', 'acs', 'rating', 'kill', 'death', 'assist', 'adr', 'kast', 'kd', 'kd_rate', 'disp_value', 'map_nums'] : ['rank', 'score', 'rating', 'kill', 'death', 'assist', 'adr', 'kast', 'kd', 'kd_rate', 'kd_diff', 'map_count'])
const sortKey = ref(''), ascending = ref(false)
const columns = computed(() => (props.expanded ? Object.keys(labels) : basic.value).filter(key => props.rows.some(r => r[key] !== undefined && r[key] !== '')))
const sorted = computed(() => {
    if (!sortKey.value) return props.rows
    return [...props.rows].sort((a,b) => ((parseFloat(a[sortKey.value]) || 0) - (parseFloat(b[sortKey.value]) || 0)) * (ascending.value ? 1 : -1))
})
const positiveKeys = new Set(['rating','Rating','acs','adr','kast','kd','kd_rate','kdratio','kill','assist','first_blood_num','fk','impact','swing','round_mvp','gold_rate','head_shot_rate','headshot','hs','kpr','mk_rating','more_kill','cl_win_num','final_victory_num','v1','v2','v3','v4','v5','k2','k3','k4','k5','flash_assist','alive','first_blood_rate'])
const negativeKeys = new Set(['death','first_death_num','fd','dpr'])
function numberValue(value) {
    const text = String(value ?? '').trim().replace(/,/g, '').replace(/%$/, '')
    return text && Number.isFinite(Number(text)) ? Number(text) : NaN
}
const averages = computed(() => Object.fromEntries(columns.value.map(key => {
    const values = props.rows.map(item => numberValue(item[key])).filter(Number.isFinite)
    return [key, { mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN, spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0 }]
})))
function toneFor(row, key) {
    const value = numberValue(row[key])
    if (!Number.isFinite(value)) return ''
    if (key === 'kd_diff' || key === 'fkdiff' || key === 'swing') return value > 0 ? 'good' : value < 0 ? 'bad' : 'even'
    const direction = positiveKeys.has(key) ? 1 : negativeKeys.has(key) ? -1 : 0
    if (!direction) return ''
    const { mean, spread } = averages.value[key]
    if (!spread || Math.abs(value - mean) < spread * 0.05) return 'even'
    return (value - mean) * direction > 0 ? 'good' : 'bad'
}
function sort(key) { if (sortKey.value === key) ascending.value = !ascending.value; else { sortKey.value = key; ascending.value = key === 'rank' } }
watch(() => props.rows, () => { if (!columns.value.includes(sortKey.value)) sortKey.value = '' })
</script>
<template>
    <div v-if="!rows.length" class="es-empty">暂无统计数据</div>
    <div v-else class="es-table-scroll">
        <table class="es-table"><thead><tr><th class="es-sticky-cell">选手 / 战队</th><th v-for="key in columns" :key="key"><button @click="sort(key)">{{ labels[key] }}<component v-if="sortKey === key" :is="ascending ? ArrowUp : ArrowDown" :size="12" /></button></th></tr></thead>
        <tbody><tr v-for="(row, index) in sorted" :key="row.id || row.name || index"><td class="es-sticky-cell"><div class="es-table-identity"><EsportsImage :src="row.portrait || row.Portrait || row.logo" /><span>{{ row.name || row.disp_name || '--' }}<small v-if="row.region_zh_name">{{ row.region_zh_name }}</small></span></div></td><td v-for="key in columns" :key="key"><span class="es-stat-value" :class="toneFor(row, key)">{{ row[key] === '' || row[key] == null ? '--' : row[key] }}</span></td></tr></tbody></table>
    </div>
</template>
