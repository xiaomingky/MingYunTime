<script setup>
import { ref, watch } from 'vue'
import { Shield } from 'lucide-vue-next'
const props = defineProps({ src: String, alt: { type: String, default: '' } })
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>
<template>
    <span class="es-image"><img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" /><Shield v-else :size="20" :aria-label="alt" /></span>
</template>
