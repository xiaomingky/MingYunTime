<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { GripVertical, ListPlus, X, ChevronUp, ChevronDown, LocateFixed } from 'lucide-vue-next'
import { queueEntries, queueWindow } from '../utils/queue-window'

const props = defineProps({ items: { type: Array, required: true }, currentIndex: Number, duration: Function, formatTime: Function })
const emit = defineEmits(['play', 'next', 'remove', 'move'])
const viewport = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(600)
const dragged = ref(-1)
const insertion = ref(-1)
const layout = computed(() => queueEntries(props.items, props.currentIndex))
const visible = computed(() => {
    const entries = queueWindow(layout.value.entries, scrollTop.value, viewportHeight.value)
    // Retain the native drag source while scrolling beyond the visible window.
    const source = dragged.value >= 0 ? layout.value.rows[dragged.value] : null
    if (source && !entries.includes(source)) entries.push(source)
    return entries
})
let observer, autoScroll = null, speed = 0, lastAutoScroll = 0
function syncScroll() { scrollTop.value = viewport.value?.scrollTop || 0 }
function locateCurrent() {
    const entry = layout.value.rows[props.currentIndex]
    if (entry && viewport.value) { viewport.value.scrollTop = Math.max(0, entry.top - viewportHeight.value / 3); syncScroll() }
}
function startDrag(index, event) {
    dragged.value = index
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
}
function stopDrag() {
    dragged.value = insertion.value = -1
    speed = 0
    lastAutoScroll = 0
    if (autoScroll !== null) cancelAnimationFrame(autoScroll)
    autoScroll = null
}
function scrollFrame(time) {
    autoScroll = null
    if (dragged.value < 0 || !speed || !viewport.value) return
    const delta = lastAutoScroll ? Math.min(50, time - lastAutoScroll) : 1000 / 60
    lastAutoScroll = time
    viewport.value.scrollTop += speed * delta / (1000 / 60)
    syncScroll()
    autoScroll = requestAnimationFrame(scrollFrame)
}
function edgeScroll(event) {
    if (dragged.value < 0) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = viewport.value.getBoundingClientRect()
    speed = event.clientY < rect.top + 56 ? -10 : event.clientY > rect.bottom - 56 ? 10 : 0
    if (speed && autoScroll === null) autoScroll = requestAnimationFrame(scrollFrame)
}
function insertionAt(index, event) {
    const rect = event.currentTarget.getBoundingClientRect()
    return index + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0)
}
function dragOver(index, event) { if (dragged.value >= 0) insertion.value = insertionAt(index, event) }
function drop(index, event) {
    event.preventDefault()
    const from = dragged.value
    const target = insertionAt(index, event)
    if (from >= 0) emit('move', from, target > from ? target - 1 : target)
    stopDrag()
}
function keyboardMove(index, event) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const target = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (target >= 0 && target < props.items.length) emit('move', index, target)
}
watch(() => props.currentIndex, () => { if (dragged.value < 0) nextTick(locateCurrent) })
onMounted(() => {
    observer = new ResizeObserver(([entry]) => { viewportHeight.value = entry.contentRect.height })
    observer.observe(viewport.value)
    viewportHeight.value = viewport.value.clientHeight
    locateCurrent()
    window.addEventListener('dragend', stopDrag)
})
onUnmounted(() => { observer?.disconnect(); stopDrag(); window.removeEventListener('dragend', stopDrag) })
</script>

<template>
  <div class="queue-toolbar">
    <span>拖动手柄排列 · Alt + ↑ / ↓ 移动</span>
    <button :disabled="currentIndex < 0" @click="locateCurrent"><LocateFixed :size="14" />当前歌曲</button>
  </div>
  <div ref="viewport" class="queue-viewport" @scroll.passive="syncScroll" @dragover="edgeScroll" @dragleave.self="speed = 0">
    <div class="queue-content" :style="{ height: `${layout.height}px` }">
      <template v-for="entry in visible" :key="entry.key">
        <div v-if="entry.label" class="queue-section" :style="{ top: `${entry.top}px` }">{{ entry.label }}</div>
        <div v-else class="queue-row" tabindex="0" :class="{ active: entry.index === currentIndex, dragging: dragged === entry.index, before: insertion === entry.index, after: insertion === entry.index + 1 }"
             :style="{ top: `${entry.top}px` }" @click="emit('play', entry.song, $event)" @keydown.enter.prevent="emit('play', entry.song)" @keydown.space.prevent="emit('play', entry.song)"
             @keydown="keyboardMove(entry.index, $event)" @dragover="dragOver(entry.index, $event)" @drop="drop(entry.index, $event)">
          <span class="queue-grip" draggable="true" title="拖动排列" @click.stop @dragstart.stop="startDrag(entry.index, $event)" @dragend="stopDrag"><GripVertical :size="16" /></span>
          <span class="queue-number">{{ entry.index === currentIndex ? '♫' : entry.index + 1 }}</span>
          <div class="queue-copy"><strong>{{ entry.song.name }}</strong><span>{{ entry.song.ar?.map(a => a.name).join('/') || entry.song.artists?.map(a => a.name).join('/') || entry.song.artist || '未知歌手' }}</span></div>
          <span class="queue-duration">{{ formatTime(duration(entry.song)) }}</span>
          <div class="queue-actions" @click.stop @keydown.stop>
            <button :disabled="entry.index === 0" title="上移（Alt + ↑）" @click="emit('move', entry.index, entry.index - 1)"><ChevronUp :size="14" /></button>
            <button :disabled="entry.index === items.length - 1" title="下移（Alt + ↓）" @click="emit('move', entry.index, entry.index + 1)"><ChevronDown :size="14" /></button>
            <button title="下一首播放" @click="emit('next', entry.song)"><ListPlus :size="15" /></button>
            <button :disabled="entry.index === currentIndex" class="remove" title="移出队列" @click="emit('remove', entry.index)"><X :size="15" /></button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.queue-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px 12px; gap: 8px; color: var(--text-light); font-size: 11px; border-bottom: 1px solid var(--border-color); }
.queue-toolbar button { display: flex; gap: 5px; align-items: center; background: transparent; border: 0; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.queue-viewport { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 8px; overscroll-behavior: contain; }
.queue-content { position: relative; }
.queue-section { position: absolute; height: 32px; display: flex; align-items: center; padding-left: 10px; font-size: 11px; font-weight: 600; color: var(--text-light); }
.queue-row { position: absolute; left: 0; right: 0; height: 64px; display: flex; align-items: center; gap: 7px; padding: 8px; border-radius: 8px; cursor: pointer; transition: background-color .16s ease; }
.queue-row:hover, .queue-row:focus-visible { background: var(--hover-bg); }
.queue-row:focus-visible, button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
.queue-row.active { background: color-mix(in srgb, var(--primary-color) 8%, var(--bg-main)); color: var(--primary-color); }
.queue-row.dragging { opacity: .4; }
.queue-row.before { box-shadow: inset 0 2px var(--primary-color); }
.queue-row.after { box-shadow: inset 0 -2px var(--primary-color); }
.queue-grip { cursor: grab; color: var(--text-light); flex-shrink: 0; display: flex; align-items: center; width: 20px; height: 36px; }
.queue-number { width: 25px; flex-shrink: 0; font-size: 11px; color: var(--text-light); text-align: center; }
.queue-copy { min-width: 0; flex: 1; }
.queue-copy strong, .queue-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-copy strong { font-size: 13px; font-weight: 500; }
.queue-copy span { font-size: 11px; color: var(--text-light); margin-top: 4px; }
.queue-duration { font-size: 11px; color: var(--text-light); font-variant-numeric: tabular-nums; }
.queue-actions { display: flex; align-items: center; gap: 1px; }
.queue-actions button { border: 0; background: transparent; color: var(--text-secondary); width: 25px; height: 30px; border-radius: 5px; display: flex; justify-content: center; align-items: center; cursor: pointer; }
.queue-actions button:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); color: var(--primary-color); }
.queue-actions button.remove:hover { color: #e44848; }
button:disabled { opacity: .25; cursor: default; }
</style>
