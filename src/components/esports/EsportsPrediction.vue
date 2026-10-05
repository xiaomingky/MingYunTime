<script setup>
import { computed } from 'vue'
import { TrendingUp, BarChart3 } from 'lucide-vue-next'
import { teamName } from '../../utils/esports'
import { predictionPercent, vrsRank } from '../../utils/esports-vrs'
const props = defineProps({ info: { type:Object,default:()=>({}) }, state: { type:Object,default:()=>({}) }, game:String, compact:Boolean })
const left = computed(() => predictionPercent(props.state.t1_odds_percent))
const right = computed(() => predictionPercent(props.state.t2_odds_percent) ?? (left.value == null ? null : 100-left.value))
const total = computed(() => (left.value ?? 0)+(right.value ?? 0))
</script>
<template>
    <section class="es-prediction" :class="{'is-compact':compact}" :aria-label="game==='csgo' ? 'VRS 排名与赛前预测' : '赛前预测'">
        <header v-if="!compact"><h3><TrendingUp :size="18" />{{ game==='csgo' ? 'VRS 预测' : '赛前预测' }}</h3><span>5EPlay 赛前预测</span></header>
        <div v-if="!compact" class="es-prediction-ranks"><div v-for="side in ['t1','t2']" :key="side"><b>{{ teamName(info[`${side}_info`]) }}</b><span v-if="game==='csgo'">VRS <strong>#{{ vrsRank(info[`${side}_info`]?.v_rank) }}</strong></span><span>{{ game==='csgo' ? 'HLTV' : '世界排名' }} <strong>#{{ info[`${side}_info`]?.rank || '--' }}</strong></span></div></div>
        <template v-if="left!==null && right!==null && total>0"><div class="es-prediction-values"><b>{{ left }}%</b><span>VS</span><b>{{ right }}%</b></div><div class="es-prediction-track"><span :style="{width:`${left/total*100}%`}"></span><span :style="{width:`${right/total*100}%`}"></span></div></template>
        <p v-else class="es-prediction-empty"><BarChart3 :size="15" />暂无赛前预测比例</p>
        <p v-if="!compact" class="es-muted">VRS 排名来自比赛接口，胜率为 5EPlay 返回的赛前预测。赛后 VRS 积分变动暂未开放。</p>
    </section>
</template>
