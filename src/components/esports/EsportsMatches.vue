<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Radio, ChevronRight } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'
import { matchInfo, matchState, matchTime, teamName, statusText, score } from '../../utils/esports'
const props = defineProps({ rows: { type: Array, default: () => [] }, game: { type: String, default: 'csgo' } })
const router = useRouter()
const groups = computed(() => {
    const map = new Map()
    for (const row of props.rows) {
        const label = matchTime(matchInfo(row).plan_ts, true).split(' ')[0]
        if (!map.has(label)) map.set(label, [])
        map.get(label).push(row)
    }
    return [...map].map(([date, rows]) => ({ date, rows }))
})
</script>
<template>
    <section v-for="group in groups" :key="group.date" class="es-match-group">
        <h3 class="es-date-heading">{{ group.date }}</h3>
        <button v-for="row in group.rows" :key="matchInfo(row).id" class="es-match-row" @click="router.push(`/entertainment/${game}/match/${matchInfo(row).id}`)">
            <span class="es-match-meta"><span class="es-status" :class="{ live: ['1', 'live'].includes(String(matchState(row).status)) }"><Radio v-if="['1', 'live'].includes(String(matchState(row).status))" :size="12" />{{ statusText(matchState(row).status) }}</span><span>{{ matchTime(matchInfo(row).plan_ts) }}</span><small>BO{{ matchInfo(row).format || '?' }}</small></span>
            <span class="es-team es-team-left"><span>{{ teamName(matchInfo(row).t1_info) }}</span><EsportsImage :src="matchInfo(row).t1_info?.logo" /></span>
            <strong class="es-score">{{ score(matchState(row).t1_score) }} <span>:</span> {{ score(matchState(row).t2_score) }}</strong>
            <span class="es-team"><EsportsImage :src="matchInfo(row).t2_info?.logo" /><span>{{ teamName(matchInfo(row).t2_info) }}</span></span>
            <span class="es-match-event">{{ row.tt_info?.disp_name || matchInfo(row).tt_stage_desc || '比赛详情' }}<small>{{ matchInfo(row).tt_stage_desc }}</small></span>
            <ChevronRight class="es-row-arrow" :size="16" />
        </button>
    </section>
</template>
