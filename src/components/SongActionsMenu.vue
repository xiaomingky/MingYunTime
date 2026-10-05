<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { MoreHorizontal, Play, ListPlus, SkipForward } from 'lucide-vue-next'
import { usePlayerStore } from '../store/player'
import { useMessageStore } from '../store/message'

const props = defineProps({
  song: { type: Object, required: true },
  list: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false }
})

const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const open = ref(false)
const root = ref(null)

const playNow = () => {
  open.value = false
  playerStore.playNow(props.song, props.list)
}

const playNext = () => {
  open.value = false
  playerStore.playNext(props.song)
  messageStore.success('已安排为下一首')
}

const enqueue = () => {
  open.value = false
  playerStore.enqueue(props.song)
  messageStore.success('已加入播放队列')
}

const onDocumentClick = (event) => {
  if (root.value && !root.value.contains(event.target)) open.value = false
}

const onKeydown = (event) => {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="song-actions-menu" @click.stop>
    <button type="button" class="song-actions-trigger" :class="{ compact }" title="更多操作" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <MoreHorizontal :size="compact ? 16 : 18" />
    </button>
    <Transition name="menu-fade">
      <div v-if="open" class="song-actions-popover" role="menu">
        <button type="button" role="menuitem" @click="playNow"><Play :size="14" />立即播放</button>
        <button type="button" role="menuitem" @click="playNext"><SkipForward :size="14" />下一首播放</button>
        <button type="button" role="menuitem" @click="enqueue"><ListPlus :size="14" />加入播放队列</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.song-actions-menu { position: relative; display: inline-flex; flex-shrink: 0; }
.song-actions-trigger {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #888;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.song-actions-trigger.compact { width: 26px; height: 26px; }
.song-actions-trigger:hover,
.song-actions-trigger:focus-visible { color: var(--primary-color); background: rgba(236, 65, 65, 0.08); outline: none; }
.song-actions-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 5px);
  z-index: 20;
  min-width: 142px;
  padding: 5px;
  border: 1px solid #ededed;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(0,0,0,0.12);
}
.song-actions-popover button {
  width: 100%;
  border: 0;
  background: transparent;
  color: #444;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border-radius: 5px;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.song-actions-popover button:hover { color: var(--primary-color); background: rgba(236,65,65,0.07); }
</style>
