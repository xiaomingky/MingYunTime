<script setup>
import { Music2 } from 'lucide-vue-next'

defineProps({ cover: String, title: String, variant: { type: String, default: 'album' }, playing: Boolean, animate: Boolean })
defineEmits(['error'])
</script>

<template>
  <div class="apple-cover-art" :class="[`cover-${variant}`, { 'is-spinning': playing && animate, 'is-paused': !playing }]">
    <div v-if="variant === 'sleeve'" class="sleeve-record" aria-hidden="true"><div class="record-label" :style="cover ? { backgroundImage: `url(${JSON.stringify(cover)})` } : {}"></div></div>
    <div class="cover-face">
      <img v-if="cover" :src="cover" :alt="title" draggable="false" @error="$emit('error')" />
      <Music2 v-else class="cover-placeholder" :size="52" aria-label="暂无封面" />
      <div v-if="variant === 'cd' || variant === 'vinyl'" class="disc-hub" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.apple-cover-art { position: relative; display: grid; place-items: center; isolation: isolate; }
.cover-face { position: relative; width: 100%; height: 100%; display: grid; place-items: center; background: #353b38; border-radius: 8px; overflow: hidden; box-shadow: 0 16px 38px #0004; }
.cover-face img { width: 100%; height: 100%; object-fit: cover; user-select: none; }
.cover-placeholder { color: #ffffff85; }
.cover-album .cover-face { transition: transform .6s ease; }
.cover-album.is-paused .cover-face { transform: scale(.97); }
.cover-cd .cover-face, .cover-vinyl .cover-face { border-radius: 50%; animation: disc-turn 24s linear infinite; animation-play-state: paused; }
.is-spinning.cover-cd .cover-face, .is-spinning.cover-vinyl .cover-face, .is-spinning .sleeve-record { animation-play-state: running; }
.cover-cd .cover-face { padding: 5%; background: conic-gradient(from 30deg, #b1c0c1, #f4f6f5 16%, #b6ced0 23%, #aea4cd 28%, #eaf2ed 35%, #919da1 48%, #eff3f2 61%, #b9d5d8 67%, #d1b5b9 74%, #f0f2f0 82%, #b1c0c1); -webkit-mask-image: radial-gradient(circle, transparent 0 5%, #000 5.3%); }
.cover-cd img { border-radius: 50%; }
.cover-cd .cover-face::after { content: ''; position: absolute; inset: 5%; border-radius: 50%; background: conic-gradient(from 30deg, #fff0 0 12%, #ffffff35 17%, #fff0 23% 62%, #ffffff26 70%, #fff0 76%); pointer-events: none; }
.disc-hub { position: absolute; width: 17%; aspect-ratio: 1; border-radius: 50%; border: 1px solid #ffffff70; background: #b9c1c0b3; box-shadow: 0 0 0 5px #ffffff1a; z-index: 1; }
.cover-vinyl .cover-face, .sleeve-record { background: repeating-radial-gradient(circle at center, #171918 0 2px, #292b2a 3px, #111312 4px); }
.cover-vinyl .cover-face::after, .sleeve-record::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 30deg, #fff0 0 10%, #ffffff12 16%, #fff0 24% 57%, #ffffff16 66%, #fff0 75%); pointer-events: none; }
.cover-vinyl img, .cover-vinyl .cover-placeholder { position: absolute; width: 46%; height: 46%; border-radius: 50%; }
.cover-vinyl .disc-hub { width: 5%; background: #171918; border-color: #ffffff40; box-shadow: none; }
.cover-sleeve .cover-face { width: 78%; height: 78%; justify-self: start; z-index: 1; box-shadow: 6px 12px 30px #0005; }
.cover-sleeve .cover-face::after { content: ''; position: absolute; inset: 0; border-left: 5px solid #ffffff17; border-right: 1px solid #ffffff30; border-radius: 8px; pointer-events: none; }
.sleeve-record { position: absolute; width: 77%; height: 77%; right: 0; top: 11.5%; border-radius: 50%; box-shadow: 0 12px 30px #0005; animation: disc-turn 24s linear infinite; animation-play-state: paused; }
.record-label { position: absolute; inset: 32%; border-radius: 50%; background: #97b7ae; background-size: cover; }
.record-label::after { content: ''; position: absolute; inset: 42%; background: #171918; border: 1px solid #ffffff40; border-radius: 50%; }
@keyframes disc-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cover-face, .sleeve-record { animation: none !important; transition: none !important; } }
</style>
