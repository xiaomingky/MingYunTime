<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown, Search } from 'lucide-vue-next'
const props = defineProps({ modelValue: { type: String, default: 'all' }, options: { type: Array, default: () => [] }, label: { type: String, default: '搜索范围' } })
const emit = defineEmits(['update:modelValue'])
const root = ref(null), trigger = ref(null), filterInput = ref(null), open = ref(false), filter = ref(''), focused = ref(0)
const choices = computed(() => props.options.filter(item => item.label.toLowerCase().includes(filter.value.toLowerCase())))
const current = computed(() => props.options.find(item => item.value === props.modelValue)?.label || '选择播放源')
async function toggle() { open.value = !open.value; filter.value = ''; focused.value = 0; if (open.value) { await nextTick(); filterInput.value?.focus() } }
function select(item) { if (!item) return; emit('update:modelValue', item.value); open.value = false; trigger.value?.focus() }
function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open.value = false; trigger.value?.focus() }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focused.value = (focused.value + (event.key === 'ArrowDown' ? 1 : -1) + choices.value.length) % (choices.value.length || 1); nextTick(() => root.value?.querySelector('.focused')?.scrollIntoView({ block: 'nearest' })) }
    else if (event.key === 'Enter' && open.value) { event.preventDefault(); select(choices.value[focused.value]) }
    else if (event.key === 'Tab') open.value = false
}
function outside(event) { if (!root.value?.contains(event.target)) open.value = false }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
    <div ref="root" class="as-select" @keydown="keys">
        <button ref="trigger" type="button" class="as-select-trigger" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" @click="toggle"><span>{{ current }}</span><ChevronDown :size="14" :class="{ rotated: open }" /></button>
        <div v-if="open" class="as-select-menu">
            <label class="as-select-filter"><Search :size="14" /><input ref="filterInput" v-model="filter" aria-label="筛选播放源" placeholder="查找播放源" @input="focused = 0" /></label>
            <div role="listbox" :aria-label="label" class="as-select-options">
                <button v-for="(item, index) in choices" :key="item.value" type="button" role="option" :aria-selected="item.value === modelValue" :class="{ chosen: item.value === modelValue, focused: focused === index }" @pointermove="focused = index" @click="select(item)"><span>{{ item.label }}</span><Check v-if="item.value === modelValue" :size="14" /></button>
                <p v-if="!choices.length">没有匹配的播放源</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.as-select { position: relative; flex-shrink: 0; min-width: 110px; max-width: 180px; color: var(--as-ink); }
.as-select-trigger { display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;height:34px;padding:0 10px;border:1px solid transparent;border-radius:9px;background:transparent;color:#62776b;font:inherit;font-size:11px;cursor:pointer;transition:background .15s; }
.as-select-trigger:hover, .as-select-trigger[aria-expanded="true"] { background:var(--as-bg); }
.as-select-trigger span { overflow:hidden;white-space:nowrap;text-overflow:ellipsis; }
svg { flex-shrink:0;transition:transform .18s; }.rotated { transform:rotate(180deg); }
.as-select-menu { position:absolute;right:0;top:calc(100% + 12px);z-index:50;width:240px;padding:7px;border:1px solid var(--as-line);border-radius:15px;background:var(--as-surface);box-shadow:0 15px 50px #203b3024,0 3px 10px #203b300a; }
.as-select-filter { display:flex;align-items:center;gap:8px;margin:2px 2px 6px;padding:9px;border-radius:9px;background:var(--as-bg);color:var(--as-muted); }
.as-select-filter input { width:100%;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:11px;color:var(--as-ink); }
.as-select-filter input:focus-visible { outline:none;box-shadow:none; }
.as-select-options { max-height:240px;overflow:auto;scrollbar-width:thin; }
.as-select-options button { display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:9px;background:transparent;color:var(--as-ink);font:inherit;font-size:11px;text-align:left;cursor:pointer; }
.as-select-options .focused { background:var(--as-bg); }.as-select-options .chosen { background:var(--as-soft);color:var(--as-accent);font-weight:600; }
.as-select-options p { margin:12px;color:var(--as-muted);font-size:11px; }
button:focus-visible { outline:2px solid var(--as-accent);outline-offset:2px; }
@media (prefers-reduced-motion:reduce) { svg { transition:none; } }
</style>
