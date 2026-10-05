<script setup>
import { Award, Users, ArrowUpDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import EsportsImage from './EsportsImage.vue'
const props = defineProps({ rows: { type: Array, default: () => [] }, source: String, sourceLabel: String, expanded: Boolean })
const byPoints = ref(false)
const sorted = computed(() => byPoints.value ? [...props.rows].sort((a,b) => Number(b.score) - Number(a.score)) : props.rows)
</script>
<template>
    <div v-if="!rows.length" class="es-state"><Users :size="28" />暂无符合条件的战队</div>
    <div v-else class="es-ranking-table-wrap es-table-scroll">
        <table class="es-table es-ranking-table"><thead><tr><th>排名</th><th>战队</th><th class="es-rank-roster">主力阵容</th><th>赛区</th><th><button @click="byPoints=!byPoints">积分<ArrowUpDown :size="12" /></button></th><th v-if="expanded">K/D</th><th v-if="expanded">地图数</th></tr></thead>
            <tbody><tr v-for="row in sorted" :key="row.id || row.name"><td><span class="es-rank-number" :class="`place-${row.rank}`"><Award v-if="Number(row.rank)<=3" :size="25" /><span v-else>{{ row.rank || '--' }}</span><b v-if="Number(row.rank)<=3">{{ row.rank }}</b></span></td><td><div class="es-table-identity"><EsportsImage :src="row.logo" :alt="row.name" /><span>{{ row.name }}<small>{{ sourceLabel || (source === 'vrs' ? 'VALVE REGIONAL STANDINGS' : source === 'hltv' ? 'HLTV WORLD RANKING' : 'VALORANT') }}</small></span></div></td><td class="es-rank-roster"><span class="es-roster-preview"><span v-for="p in (row.players || []).slice(0,5)" :key="p.name" :title="p.name"><EsportsImage :src="p.portrait" :alt="p.name" /><small>{{ p.name }}</small></span></span></td><td class="es-rank-region">{{ row.region_zh_name || row.region_name || '--' }}</td><td class="es-rank-points">{{ row.score ?? '--' }}</td><td v-if="expanded">{{ row.kd || '--' }}</td><td v-if="expanded">{{ row.map_count || row.map_nums || '--' }}</td></tr></tbody>
        </table>
    </div>
</template>
