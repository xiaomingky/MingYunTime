<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ListMusic, Heart, Plus, RefreshCw, Trash2, Search } from 'lucide-vue-next'
import { useUserStore } from '../store/user'
import { useQQUserStore } from '../store/qq-user'
import { useKugouUserStore } from '../store/kugou-user'
import { useMessageStore } from '../store/message'
import { playlistGroups } from '../utils/playlist-library'

const route = useRoute(), router = useRouter(), netease = useUserStore(), qq = useQQUserStore(), kugou = useKugouUserStore(), messages = useMessageStore()
const platform = computed(() => route.meta.libraryPlatform || 'netease')
const account = computed(() => ({ netease, qq, kugou })[platform.value])
const names = { netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐' }
const query = ref(''), tab = ref('all'), busy = ref(false), error = ref(''), createOpen = ref(false), name = ref(''), selected = ref([]), batch = ref(false)
let generation = 0
onBeforeUnmount(() => generation++)
const groups = computed(() => playlistGroups(platform.value, account.value))
const visibleGroups = computed(() => [{ id: 'created', title: '我创建的歌单', list: groups.value.created }, { id: 'collected', title: '我收藏的歌单', list: groups.value.collected }].filter(group => tab.value === 'all' || tab.value === group.id).map(group => ({ ...group, list: group.list.filter(item => item.name?.toLowerCase().includes(query.value.trim().toLowerCase())) })))
const loading = computed(() => busy.value || account.value.playlistsLoading)
const failure = computed(() => error.value || account.value.playlistsError)
async function refresh() {
  if (!account.value.isLoggedIn) return
  const current = ++generation, store = account.value
  busy.value = true; error.value = ''
  try {
    const result = await store.fetchUserPlaylists(platform.value === 'netease' ? store.profile?.userId : undefined)
    if (current === generation && result === false) error.value = store.playlistsError || '歌单同步失败，请重试'
  } catch (e) { if (current === generation) error.value = e.message || '歌单同步失败' }
  finally { if (current === generation) busy.value = false }
}
function open(item, liked = false) {
  if (platform.value === 'netease') return router.push(`/playlist/${item.id}`)
  router.push(liked ? `/${platform.value}/liked` : `/${platform.value}/playlist/${item.id}`)
}
async function create() {
  if (!name.value.trim() || busy.value) return
  const store = account.value, current = generation
  busy.value = true; error.value = ''
  try {
    if (!await store.createPlaylist(name.value.trim())) throw new Error('新建歌单失败，请稍后重试')
    if (current === generation) { createOpen.value = false; name.value = ''; messages.success('歌单已创建') }
  } catch (e) { if (current === generation) error.value = e.message }
  finally { if (current === generation) busy.value = false }
}
async function remove(item, collected) {
  const store = account.value, type = platform.value, current = generation
  if (!await messages.confirm(`${collected ? '取消收藏' : '删除'}「${item.name}」？`, collected ? '取消收藏' : '删除歌单')) return
  if (current !== generation || busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = type === 'netease' && collected ? await store.handleSubscribe(item.id, false) : await store.deletePlaylist(item.id)
    if (!result) throw new Error('操作未完成，请刷新后重试')
  } catch (e) { if (current === generation) error.value = e.message }
  finally { if (current === generation) busy.value = false }
}
async function removeSelected() {
  const current = generation, ids = selected.value.slice(), revision = kugou.revision
  if (!ids.length || !await messages.confirm(`取消收藏选中的 ${ids.length} 个歌单？`, '批量管理歌单')) return
  if (current !== generation || revision !== kugou.revision || busy.value) return
  busy.value = true
  try {
    if (!await kugou.batchDeletePlaylists(ids)) throw new Error('批量操作未完成，请刷新后重试')
    if (current === generation) selected.value = []
  } catch (e) { if (current === generation) error.value = e.message || '批量操作失败' }
  finally { if (current === generation) busy.value = false }
}
watch([platform, () => account.value.revision], () => { generation++; busy.value = false; error.value = ''; selected.value = []; batch.value = false; createOpen.value = false; query.value = ''; tab.value = 'all'; refresh() }, { immediate: true })
</script>

<template>
  <main class="playlist-library">
    <header class="library-heading"><div><p class="library-eyebrow">{{ names[platform] }} · 音乐资料库</p><h1>管理歌单<span>{{ groups.created.length + groups.collected.length }}</span></h1><p class="library-description">自己创建的、认真收藏的，都在这里。</p></div><div class="library-actions"><button :disabled="loading || !account.isLoggedIn" aria-label="刷新歌单" @click="refresh"><RefreshCw :size="17" :class="{ spinning: loading }" />刷新</button><button class="primary" :disabled="busy || !account.isLoggedIn" @click="createOpen = !createOpen"><Plus :size="18" />新建歌单</button></div></header>
    <p v-if="!account.isLoggedIn" class="library-notice">请先点击右上角头像登录 {{ names[platform] }}，同步你的歌单。</p>
    <form v-if="createOpen" class="library-create" @submit.prevent="create"><input v-model="name" maxlength="80" placeholder="给新歌单起个名字" aria-label="新歌单名称" :disabled="busy" autofocus /><button class="primary" :disabled="busy || !name.trim()" type="submit">创建</button><button type="button" :disabled="busy" @click="createOpen = false">取消</button></form>
    <div v-if="failure" class="library-notice error" role="alert">{{ failure }}<button :disabled="loading" @click="refresh">重试</button></div>
    <div class="library-toolbar"><nav aria-label="歌单分类"><button v-for="option in [{id:'all',name:'全部歌单'},{id:'created',name:'我创建的'},{id:'collected',name:'我收藏的'}]" :key="option.id" :aria-pressed="tab === option.id" @click="tab = option.id">{{ option.name }}</button></nav><label class="library-search"><Search :size="16" /><input v-model="query" placeholder="搜索我的歌单" aria-label="搜索我的歌单" /></label></div>
    <button v-if="account.isLoggedIn && !query && tab !== 'collected'" class="library-liked" :disabled="platform === 'netease' && !account.likedPlaylistId" @click="open({id:account.likedPlaylistId}, true)"><span><Heart :size="24" fill="currentColor" /></span><div><strong>我喜欢的音乐</strong><small>每一次心动，都有迹可循</small></div><span class="library-arrow">↗</span></button>
    <section v-for="group in visibleGroups" :key="group.id" :data-library-group="group.id" class="library-group"><div class="library-group-heading"><h2>{{ group.title }}<small>{{ group.list.length }}</small></h2><div v-if="platform === 'kugou' && group.id === 'collected' && group.list.length" class="library-actions"><button :disabled="busy" @click="batch = !batch; selected = []">{{ batch ? '完成管理' : '批量管理' }}</button><template v-if="batch"><button @click="selected = selected.length === group.list.length ? [] : group.list.map(item => item.id)">{{ selected.length === group.list.length ? '取消全选' : '全选' }}</button><button :disabled="busy || !selected.length" @click="removeSelected">取消收藏 ({{ selected.length }})</button></template></div></div>
      <p v-if="!group.list.length" class="library-empty" role="status">{{ loading ? '正在同步歌单…' : query ? '没有匹配的歌单' : group.id === 'created' ? '还没有自建歌单，创建一个记录此刻吧。' : '收藏的歌单会出现在这里。' }}</p>
      <div class="library-grid"><article v-for="item in group.list" :key="item.id" class="library-card"><button class="library-open" :aria-label="`打开歌单 ${item.name}`" @click="open(item)"><div class="library-artwork"><img v-if="item.coverImgUrl" :src="item.coverImgUrl" alt="" loading="lazy" @error="$event.target.style.visibility = 'hidden'" /><ListMusic v-else :size="36" /><span>打开歌单 ↗</span></div><strong :title="item.name">{{ item.name }}</strong><small>{{ item.trackCount ?? item.songCount ?? 0 }} 首歌曲</small></button><label v-if="batch && group.id === 'collected'" class="library-select"><input v-model="selected" type="checkbox" :value="item.id" :aria-label="`选择 ${item.name}`" /></label><button v-else-if="platform !== 'qq' || group.id === 'created'" class="library-remove" :disabled="busy" :aria-label="`${group.id === 'collected' ? '取消收藏' : '删除歌单'} ${item.name}`" @click="remove(item, group.id === 'collected')"><Trash2 :size="15" /></button></article></div>
    </section>
  </main>
</template>

<style scoped>
.playlist-library{width:100%;height:100%;min-width:0;min-height:0;overflow-y:auto;box-sizing:border-box;padding:34px 36px 80px;max-width:1500px;margin:0 auto;color:var(--text-main)}
button,input{font:inherit}button{cursor:pointer;color:inherit}button:disabled{cursor:default;opacity:.45}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color);outline-offset:4px}
.library-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:28px;border-bottom:1px solid var(--border-color,#8882)}.library-eyebrow{font-size:12px;color:var(--primary-color);letter-spacing:1px;margin:0 0 12px}h1{font-size:36px;letter-spacing:-1px;margin:0}h1 span{display:inline-block;vertical-align:middle;font-size:14px;letter-spacing:0;margin-left:16px;background:var(--bg-hover,#8881);padding:5px 10px;border-radius:20px;color:var(--text-secondary)}.library-description{font-size:13px;color:var(--text-secondary);margin-bottom:0}.library-actions{display:flex;gap:10px;align-items:center}.library-actions button,.library-create button,.library-notice button{display:inline-flex;align-items:center;gap:7px;padding:10px 15px;border-radius:10px;border:1px solid var(--border-color,#8883);background:var(--bg-hover,#8881);font-size:13px}.library-actions .primary,.library-create .primary{background:var(--primary-color);border-color:transparent;color:white}.library-toolbar{display:flex;justify-content:space-between;gap:20px;align-items:center;margin:26px 0}.library-toolbar nav{display:flex;gap:8px}.library-toolbar nav button{padding:9px 14px;border:0;border-radius:9px;background:transparent;color:var(--text-secondary);font-size:13px}.library-toolbar nav button[aria-pressed=true]{color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 12%,transparent)}.library-search{display:flex;align-items:center;gap:10px;color:var(--text-secondary);background:var(--bg-hover,#8881);border-radius:10px;padding:10px 13px}.library-search input{width:170px;border:0;outline:0;color:var(--text-main);background:transparent;font-size:12px}.library-liked{display:flex;align-items:center;width:100%;gap:18px;padding:22px 24px;text-align:left;border:1px solid color-mix(in srgb,var(--primary-color) 20%,transparent);border-radius:16px;background:linear-gradient(115deg,color-mix(in srgb,var(--primary-color) 13%,transparent),transparent)}.library-liked>span:first-child{width:52px;height:52px;border-radius:15px;background:color-mix(in srgb,var(--primary-color) 12%,transparent);display:grid;place-items:center;color:var(--primary-color)}.library-liked strong{font-size:17px}.library-liked small{display:block;color:var(--text-secondary);margin-top:6px;font-size:12px}.library-arrow{margin-left:auto;font-size:25px}.library-group{margin-top:32px}.library-group-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}h2{font-size:18px;margin:0}h2 small{font-weight:400;color:var(--text-secondary);font-size:12px;margin-left:10px}.library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:24px 20px}.library-card{position:relative;min-width:0}.library-open{display:block;text-align:left;width:100%;padding:0;background:transparent;border:0}.library-artwork{aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--bg-hover,#8882);display:grid;place-items:center;color:var(--text-secondary);position:relative}.library-artwork img{width:100%;height:100%;object-fit:cover;transition:transform .25s}.library-artwork>span{position:absolute;bottom:0;left:0;right:0;padding:20px 12px 12px;background:linear-gradient(transparent,#0009);color:white;font-size:12px;opacity:0;transition:opacity .2s}.library-open:hover img{transform:scale(1.035)}.library-open:hover .library-artwork>span,.library-open:focus-visible .library-artwork>span{opacity:1}.library-open>strong{display:block;margin-top:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550;padding-right:24px}.library-open>small{display:block;margin-top:6px;font-size:12px;color:var(--text-secondary)}.library-remove{position:absolute;right:0;bottom:19px;border:0;border-radius:7px;background:transparent;color:var(--text-secondary);padding:5px}.library-remove:hover{color:#ed526c;background:#ed526c14}.library-select{position:absolute;right:10px;top:10px}.library-select input{width:19px;height:19px;accent-color:var(--primary-color)}.library-empty{padding:24px;border:1px dashed var(--border-color,#8883);border-radius:12px;font-size:13px;color:var(--text-secondary)}.library-create{display:flex;gap:10px;align-items:center;padding:18px 0}.library-create input{min-width:0;flex:1;background:var(--bg-hover,#8881);color:var(--text-main);border:1px solid var(--border-color,#8883);padding:11px 14px;border-radius:10px}.library-notice{display:flex;align-items:center;gap:12px;font-size:13px;background:var(--bg-hover,#8881);border-radius:12px;padding:15px;margin:20px 0}.library-notice.error{color:#e75468}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:850px){.playlist-library{padding:24px 20px 60px}.library-heading{align-items:flex-start}h1{font-size:28px}.library-heading .library-actions{flex-direction:column}.library-toolbar{align-items:stretch;flex-direction:column}.library-grid{grid-template-columns:repeat(auto-fill,minmax(135px,1fr))}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
