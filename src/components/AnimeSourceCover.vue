<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Film, RefreshCw } from 'lucide-vue-next'
const props = defineProps({ src: { type: String, default: '' }, title: { type: String, default: '' }, lazy: { type: Boolean, default: true } })
const attempt = ref(0), loaded = ref(false), failed = ref(false), element = ref(null)
let timer, observer
function proxy(value) { try { const url = new URL(value); return `https://wsrv.nl/?${new URLSearchParams({ url: url.host + url.pathname + url.search, w: '400', output: 'webp' })}` } catch { return '' } }
const candidates = computed(() => {
    if (!/^https?:\/\//i.test(props.src)) return []
    const blocked = /^(?:https?:\/\/)(?:lain\.bgm\.tv|api\.bgm\.tv)\//i.test(props.src)
    return [...new Set(blocked ? [proxy(props.src), props.src] : [props.src, proxy(props.src)])].filter(Boolean)
})
const current = computed(() => candidates.value[attempt.value] || '')
function arm() { clearTimeout(timer); if (current.value && !loaded.value && !failed.value) timer = setTimeout(error, 9000) }
function success() { clearTimeout(timer); loaded.value = true; failed.value = false; observer?.disconnect() }
function error() {
    clearTimeout(timer)
    if (attempt.value + 1 < candidates.value.length) { attempt.value++; arm() }
    else { failed.value = true; observer?.disconnect() }
}
function retry() { attempt.value = 0; loaded.value = false; failed.value = false; arm() }
watch(() => props.src, () => { clearTimeout(timer); attempt.value = 0; loaded.value = false; failed.value = false; if (!props.lazy) arm() })
watch(element, el => {
    observer?.disconnect(); if (!el) return
    if (!props.lazy) { arm(); return }
    observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { arm(); observer.disconnect() } }, { rootMargin: '300px' })
    observer.observe(el)
})
onBeforeUnmount(() => { clearTimeout(timer); observer?.disconnect() })
</script>

<template>
    <div ref="element" class="as-cover-image" :class="{ loaded, failed }">
        <Film :size="27" class="as-cover-placeholder" />
        <img v-if="current && !failed" :key="`${src}:${attempt}`" :src="current" :alt="title" :loading="lazy ? 'lazy' : 'eager'" referrerpolicy="no-referrer" @load="success" @error="error" />
        <button v-if="failed" type="button" class="as-cover-retry" :aria-label="`重试加载 ${title} 的封面`" @click.stop="retry"><RefreshCw :size="12" />重试封面</button>
    </div>
</template>

<style scoped>
.as-cover-image { position:relative;isolation:isolate;overflow:hidden;background:linear-gradient(145deg,#e4ede5,#d3e0d8); }
.as-cover-placeholder { position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#97b1a1;z-index:-1; }
.as-cover-image img { display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .25s; }
.as-cover-image.loaded img { opacity:1; }
.as-cover-retry { position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;white-space:nowrap;padding:5px 7px;border:1px solid #bfd0c2;border-radius:7px;background:#f6faf6df;color:#487b69;font:inherit;font-size:9px;cursor:pointer; }
@media (prefers-reduced-motion:reduce) { img { transition:none!important; } }
</style>
