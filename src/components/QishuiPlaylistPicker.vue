<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { X, Plus } from 'lucide-vue-next'
import { useQishuiUserStore } from '../store/qishui-user'
import { useMessageStore } from '../store/message'
import { qishuiInvoke } from '../api/qishui'
import { canManageQishuiPlaylist } from '../utils/qishui-playlists'
const props = defineProps({ show: Boolean, songId: [String, Number] })
const emit = defineEmits(['close', 'added'])
const user = useQishuiUserStore(), messages = useMessageStore()
const busy = ref(false), error = ref(''), name = ref('')
const dialog = ref(null)
let generation = 0, previousFocus
const owned = () => user.playlists.filter(p => canManageQishuiPlaylist(p, user))
watch(() => [props.show, props.songId, user.revision], async ([show]) => {
    ++generation
    busy.value = false
    if (!show) { previousFocus?.focus?.(); previousFocus = null; return }
    previousFocus ||= document.activeElement
    error.value = ''; name.value = ''
    await nextTick(); dialog.value?.querySelector('input,button')?.focus()
    if (user.isLoggedIn) await user.fetchPlaylists()
}, { immediate: true })
onBeforeUnmount(() => { ++generation; previousFocus?.focus?.() })
function trapFocus(event) {
    if (event.key !== 'Tab') return
    const elements = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
    const first = elements[0], last = elements.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
async function add(playlistId) {
    if (busy.value) return
    const current = generation
    busy.value = true; error.value = ''
    try {
        await user.addToPlaylist(playlistId, props.songId)
        if (current !== generation) return
        messages.success('已添加到汽水歌单'); emit('added'); emit('close')
    } catch (e) { if (current === generation) error.value = e.message }
    finally { if (current === generation) busy.value = false }
}
async function create() {
    if (busy.value || !name.value.trim()) return
    const current = generation
    busy.value = true; error.value = ''
    try {
        await qishuiInvoke('playlist-create', { name: name.value, trackIds: [String(props.songId)] })
        if (current !== generation) return
        await user.fetchPlaylists()
        if (current !== generation) return
        messages.success('已创建歌单并添加歌曲'); emit('added'); emit('close')
    } catch (e) { if (current === generation) error.value = e.message }
    finally { if (current === generation) busy.value = false }
}
</script>
<template>
    <Teleport to="body"><div v-if="show" class="soda-picker-overlay" @click.self="!busy && emit('close')" @keydown.esc="!busy && emit('close')">
        <section ref="dialog" class="soda-picker" role="dialog" aria-modal="true" aria-label="添加到汽水歌单" @keydown="trapFocus">
            <header><h3>添加到汽水歌单</h3><button :disabled="busy" aria-label="关闭" @click="emit('close')"><X :size="19" /></button></header>
            <p v-if="!user.isLoggedIn">请先登录汽水音乐，再选择你的歌单。</p>
            <template v-else>
                <form @submit.prevent="create"><input v-model="name" maxlength="100" placeholder="新建歌单名称" aria-label="新歌单名称" /><button :disabled="busy || !name.trim()"><Plus :size="16" />新建并添加</button></form>
                <p v-if="error || user.error" role="alert">{{ error || user.error }}</p>
                <div class="soda-picker-list"><button v-for="p in owned()" :key="p.id" :disabled="busy" @click="add(p.id)">{{ p.name }}<small>{{ p.songCount }} 首</small></button></div>
                <p v-if="!owned().length && !user.error">还没有自己创建的歌单，可以在上方新建。</p>
            </template>
        </section>
    </div></Teleport>
</template>
<style scoped>
.soda-picker-overlay{position:fixed;inset:0;z-index:3500;background:#0715118c;display:flex;align-items:center;justify-content:center;padding:20px}.soda-picker{width:430px;max-width:100%;max-height:80vh;overflow:auto;background:var(--bg-main,#fff);color:var(--text-main,#222);border:1px solid var(--border-color);border-radius:18px;padding:22px;box-shadow:0 20px 80px #0004}.soda-picker header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.soda-picker h3{font-size:18px;margin:0}.soda-picker button{border:0;border-radius:8px;padding:9px;background:var(--hover-bg,#edf5f1);color:inherit;cursor:pointer;display:flex;gap:7px;align-items:center}.soda-picker button:disabled{opacity:.5;cursor:default}.soda-picker form{display:flex;gap:9px}.soda-picker input{min-width:0;flex:1;border:1px solid var(--border-color,#ccc);padding:10px;border-radius:8px;background:transparent;color:inherit}.soda-picker p{font-size:13px;line-height:1.7;margin:18px 0;color:var(--text-secondary)}.soda-picker-list{margin-top:16px;display:grid;gap:7px}.soda-picker-list button{justify-content:space-between;text-align:left;line-height:1.6}.soda-picker-list small{color:var(--text-secondary);white-space:nowrap}
</style>
