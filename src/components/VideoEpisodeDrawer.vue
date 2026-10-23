<script setup>
import { computed, ref } from 'vue'
import { Film, X } from 'lucide-vue-next'

const props = defineProps({
    open: Boolean,
    episodes: { type: Array, default: () => [] },
    currentEpisode: { type: Object, default: null },
    title: { type: String, default: '' },
    cover: { type: String, default: '' },
    localMode: Boolean
})
const emit = defineEmits(['close', 'select'])
let savedColumns = 1
try { savedColumns = Number(localStorage.getItem('video_episode_columns')) || 1 } catch {}
const columns = ref([1, 2, 3].includes(savedColumns) ? savedColumns : 1)
function setColumns(value) {
    columns.value = value
    try { localStorage.setItem('video_episode_columns', String(value)) } catch {}
}
const label = ep => ep?.longTitle ? `${ep.title || ''} ${ep.longTitle}`.trim() : (ep?.title || ep?.name || ep?.part || '未命名视频')
const image = ep => ep?.thumbnail || ep?.cover || ep?.pic || ep?.picUrl || props.cover
const heading = computed(() => props.title || (props.currentEpisode ? label(props.currentEpisode) : '视频选集'))
function isCurrent(ep) {
    const current = props.currentEpisode
    if (!current) return false
    if (current === ep) return true
    for (const key of ['path', 'epId', 'cid', 'vid', 'id', 'url', 'page']) {
        if (ep[key] != null && current[key] != null) return String(ep[key]) === String(current[key])
    }
    return label(ep) === label(current)
}
function select(ep) {
    emit('select', ep)
    emit('close')
}
</script>

<template>
    <Transition name="episode-drawer">
        <div v-if="open" class="ved-layer" @click.stop @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
            <button class="ved-backdrop" aria-label="关闭选集" @click="emit('close')" />
            <section class="ved-panel" role="dialog" aria-label="视频选集" :style="{ '--episode-columns': columns }">
                <header class="ved-header">
                    <div class="ved-cover ved-heading-cover"><img v-if="cover || image(currentEpisode)" :src="cover || image(currentEpisode)" alt="" /><Film v-else :size="20" /></div>
                    <div class="ved-heading"><strong :title="heading">{{ heading }}</strong><span>{{ localMode ? '本地视频' : '视频选集' }} · {{ episodes.length }} 个</span></div>
                    <button class="ved-close" aria-label="关闭选集" @click="emit('close')"><X :size="18" /></button>
                </header>
                <div class="ved-toolbar"><span>排列方式</span><div class="ved-columns" role="group" aria-label="选集列数"><button v-for="count in [1, 2, 3]" :key="count" :aria-pressed="columns === count" @click="setColumns(count)">{{ count }} 列</button></div></div>
                <div v-if="episodes.length" class="ved-list" :class="{ 'ved-multiple': columns > 1 }">
                    <button v-for="(ep, index) in episodes" :key="ep.path || ep.epId || ep.cid || ep.id || ep.url || index" class="ved-item" :class="{ active: isCurrent(ep) }" :aria-current="isCurrent(ep) ? 'true' : undefined" :title="label(ep)" @click="select(ep)">
                        <div class="ved-cover"><img v-if="image(ep)" :src="image(ep)" alt="" loading="lazy" /><Film v-else :size="20" /><span v-if="isCurrent(ep)" class="ved-playing">播放中</span></div>
                        <div class="ved-copy"><strong>{{ label(ep) }}</strong><small>{{ isCurrent(ep) ? '正在播放' : `第 ${index + 1} 项` }}<template v-if="localMode && ep.format"> · {{ ep.format }}</template></small></div>
                    </button>
                </div>
                <div v-else class="ved-empty"><Film :size="28" /><span>当前视频暂无选集</span></div>
            </section>
        </div>
    </Transition>
</template>

<style scoped>
.ved-layer { position: absolute; inset: 0; z-index: 1100; color: #fff; font-size: 13px; text-align: left; }
.ved-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(0,0,0,.22); cursor: default; }
.ved-panel { position: absolute; inset: 0 0 0 auto; width: min(460px, 72%); display: flex; flex-direction: column; background: rgba(24,26,32,.94); border-left: 1px solid rgba(255,255,255,.14); box-shadow: -16px 0 40px rgba(0,0,0,.32); backdrop-filter: blur(24px); overflow: hidden; }
.ved-header { display: flex; align-items: center; gap: 10px; padding: 18px 16px 12px; flex-shrink: 0; }
.ved-cover { position: relative; display: grid; place-items: center; width: 86px; aspect-ratio: 16/9; flex: 0 0 auto; overflow: hidden; border-radius: 7px; background: linear-gradient(135deg,#3b414f,#20232b); color: #a8adba; }
.ved-cover img { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
.ved-heading-cover { width: 62px; }
.ved-heading { min-width: 0; flex: 1; display: grid; gap: 5px; }
.ved-heading strong { font-size: 14px; line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.ved-heading span, .ved-copy small { color: rgba(255,255,255,.5); font-size: 11px; }
.ved-close { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: rgba(255,255,255,.08); color: white; cursor: pointer; }
.ved-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 0 16px 12px; color: rgba(255,255,255,.55); font-size: 11px; flex-shrink: 0; }
.ved-columns { display: flex; padding: 3px; border-radius: 8px; background: rgba(0,0,0,.24); }
.ved-columns button { border: 0; padding: 5px 10px; border-radius: 5px; color: #aaaeba; background: transparent; cursor: pointer; font: inherit; }
.ved-columns button[aria-pressed=true] { background: rgba(255,255,255,.16); color: #fff; box-shadow: 0 1px 4px #0003; }
.ved-list { min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(var(--episode-columns), minmax(0,1fr)); align-content: start; gap: 8px; padding: 0 12px 16px; overscroll-behavior: contain; }
.ved-list::-webkit-scrollbar { width: 5px; }
.ved-list::-webkit-scrollbar-track { background: transparent; }
.ved-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 6px; }
.ved-item { display: flex; align-items: center; min-width: 0; gap: 10px; padding: 8px; border: 1px solid transparent; border-radius: 9px; background: rgba(255,255,255,.035); color: inherit; text-align: left; cursor: pointer; font: inherit; }
.ved-item:hover { background: rgba(255,255,255,.09); }
.ved-item.active { border-color: rgba(255,123,146,.45); background: rgba(194,12,12,.14); }
.ved-copy { min-width: 0; display: grid; gap: 5px; flex: 1; }
.ved-copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; font-weight: 500; white-space: normal; }
.ved-item.active .ved-copy strong { color: #ffadb7; }
.ved-playing { position: absolute; bottom: 3px; right: 3px; padding: 2px 4px; border-radius: 3px; background: #0009; color: white; font-size: 9px; }
.ved-multiple .ved-item { flex-direction: column; align-items: stretch; gap: 6px; padding: 6px; }
.ved-multiple .ved-cover { width: 100%; }
.ved-empty { display: grid; justify-items: center; gap: 12px; margin: auto; padding: 20px; color: #9b9faa; }
.ved-layer button:focus-visible { outline: 2px solid #ffadb7; outline-offset: -2px; }
.episode-drawer-enter-active, .episode-drawer-leave-active { transition: opacity .2s; }
.episode-drawer-enter-active .ved-panel, .episode-drawer-leave-active .ved-panel { transition: transform .2s ease; }
.episode-drawer-enter-from, .episode-drawer-leave-to { opacity: 0; }
.episode-drawer-enter-from .ved-panel, .episode-drawer-leave-to .ved-panel { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) { .episode-drawer-enter-active, .episode-drawer-leave-active, .episode-drawer-enter-active .ved-panel, .episode-drawer-leave-active .ved-panel { transition: none; } }
</style>
