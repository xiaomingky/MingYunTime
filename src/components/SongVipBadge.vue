<script setup>
import { computed } from 'vue'
import { songVip } from '../utils/song-vip'
const props = defineProps({ song: Object, platform: { type: String, default: '' } })
const badge = computed(() => songVip(props.song, props.platform))
</script>

<template>
  <img v-if="badge" class="song-vip-artwork" :class="`song-vip-${badge.platform}`" :src="badge.icon" :alt="badge.label" :title="badge.title" draggable="false" />
</template>

<style scoped>
.song-vip-artwork{display:inline-block;flex:none;width:auto;height:15px;max-width:42px;object-fit:contain;vertical-align:middle;margin-left:7px}
.song-vip-netease{height:17px;max-width:39px}
.song-vip-qishui{height:15px}
</style>
