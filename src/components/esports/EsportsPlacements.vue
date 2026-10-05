<script setup>
import { Trophy } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'
defineProps({ rows: { type: Array, default: () => [] } })
</script>
<template>
    <div class="es-placements"><div v-for="(item,index) in rows" :key="item.team?.id || index" class="es-placement" :class="`place-${item.rank}`"><span class="es-placement-rank"><Trophy v-if="['1','2','3'].includes(String(item.rank))" :size="22" /><span v-else>{{ item.rank || item.rank_desc || '--' }}</span></span><span class="es-placement-team"><EsportsImage :src="item.team?.logo" /><b>{{ item.team?.name || item.team?.abbr || 'TBD' }}</b></span><span class="es-placement-reward"><b>{{ item.bonus || item.promotion || '待公布' }}</b><small v-if="item.point">{{ item.point }} {{ item.point_type || '积分' }}</small><small v-if="item.bonus && item.promotion">{{ item.promotion }}</small></span></div></div>
    <p v-if="!rows.length" class="es-state">暂无名次数据</p>
</template>
