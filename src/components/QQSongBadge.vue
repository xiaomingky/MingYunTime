<script setup>
import SongVipBadge from './SongVipBadge.vue'
defineProps({ song: { type: Object, required: true } })
</script>

<template>
  <SongVipBadge :song="song" platform="qq" class="qq-song-vip" />
</template>
