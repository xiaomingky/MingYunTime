<script setup>
import { ref, watch } from 'vue'
import { Music2 } from 'lucide-vue-next'
const props = defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' } })
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>
<template>
    <span class="qishui-artwork" :class="{ 'is-placeholder': !src || failed }">
        <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
        <Music2 v-else :size="28" aria-hidden="true" />
    </span>
</template>
<style scoped>
.qishui-artwork{display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;border-radius:inherit;width:100%;height:100%;background:var(--active-bg);color:var(--primary-color)}
.qishui-artwork img{display:block;width:100%;height:100%;object-fit:cover}
.is-placeholder{background:linear-gradient(135deg,var(--active-bg),var(--hover-bg))}
</style>
