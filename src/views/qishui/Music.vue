<script setup>
import SongVipBadge from '../../components/SongVipBadge.vue'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Play, RefreshCw, ListPlus, ArrowUpRight, Heart, Plus } from 'lucide-vue-next'
import { qishuiInvoke, qishuiShareId, copyQishuiShare } from '../../api/qishui'
import { usePlayerStore } from '../../store/player'
import { useQishuiUserStore } from '../../store/qishui-user'
import { useMessageStore } from '../../store/message'
import SongActionsMenu from '../../components/SongActionsMenu.vue'
import QishuiCover from '../../components/QishuiCover.vue'
import QishuiComment from '../../components/QishuiComment.vue'
import QishuiPlaylistPicker from '../../components/QishuiPlaylistPicker.vue'
import { canManageQishuiPlaylist } from '../../utils/qishui-playlists'
const route = useRoute(), router = useRouter(), player = usePlayerStore(), user = useQishuiUserStore(), messages = useMessageStore()
const loading = ref(false), error = ref(''), playlists = ref([]), songs = ref([]), entities = ref([]), detail = ref(null)
const playlistQuery = ref('')
const playlistFilter = ref('')
const cursor = ref(''), hasMore = ref(false), query = ref(''), total = ref(0), busy = ref(false)
const form = ref(''), formName = ref(''), formDescription = ref(''), formPrivate = ref(false), pickerId = ref('')
const formTarget = ref(null)
const mode = computed(() => route.meta.qishuiMode || 'discover')
const searchType = computed(() => ['track','artist','album','playlist'].includes(route.query.type) ? route.query.type : 'track')
const libraryType = computed(() => ['track','artist','album','playlist'].includes(route.query.type) ? route.query.type : 'playlist')
const artistTab = computed(() => route.query.tab === 'albums' ? 'albums' : 'tracks')
const entityType = computed(() => mode.value === 'search' ? searchType.value : mode.value === 'library' ? libraryType.value : mode.value === 'artist' ? 'album' : 'playlist')
const owned = computed(() => mode.value === 'playlist' && canManageQishuiPlaylist(detail.value, user))
const canReorder = computed(() => owned.value && !playlistFilter.value && !hasMore.value && songs.value.length > 1 && songs.value.length <= 500 && songs.value.length === detail.value?.songCount)
const pageTitle = computed(() => mode.value === 'recent' ? '最近听过' : mode.value === 'library' ? '管理歌单' : mode.value === 'search' ? '寻找下一首喜欢的歌' : detail.value?.name || '音乐，随心而动')
let revision = 0
const merge = (old, values, append) => [...new Map([...(append ? old : []), ...values].map(p => [p.id,p])).values()]
const load = async (append = false) => {
    if (append && loading.value) return
    const requestId = ++revision
    loading.value = true; error.value = ''
    if (!append) { cursor.value = ''; playlists.value = []; songs.value = []; entities.value = []; detail.value = null; hasMore.value = false; form.value = '' }
    try {
        let data
        if (mode.value === 'playlist') {
            const id = String(route.params.id)
            if (playlistFilter.value) {
                const info = await qishuiInvoke('playlist', { id })
                if (requestId !== revision) return
                detail.value = info.playlist
                data = await qishuiInvoke('playlist-search', { id, query: playlistFilter.value })
            } else data = await qishuiInvoke('playlist', { id, cursor: append ? cursor.value : '' })
        }
        else if (mode.value === 'album') data = await qishuiInvoke('album', { id: String(route.params.id) })
        else if (mode.value === 'artist') {
            const id = String(route.params.id)
            if (!append) {
                const info = await qishuiInvoke('artist', { id })
                if (requestId !== revision) return
                detail.value = info.artist
            }
            data = await qishuiInvoke(artistTab.value === 'albums' ? 'artist-albums' : 'artist-tracks', { id, cursor: append ? cursor.value : '' })
        } else if (mode.value === 'user') {
            data = await qishuiInvoke('user', { id: String(route.params.id) })
        } else if (mode.value === 'recent') {
            data = await qishuiInvoke('recent', { cursor: append ? cursor.value : '' })
        } else if (mode.value === 'search') {
            const text = String(route.query.keywords || '').trim(), id = qishuiShareId(text)
            query.value = text
            if (!text) return
            if (id && searchType.value === 'track') { const result = await qishuiInvoke('detail', { id }); data = { songs: [result.track], hasMore: false } }
            else data = await qishuiInvoke('search', { query: text, type: searchType.value, cursor: append ? cursor.value : '' })
            if (data.items) data = searchType.value === 'playlist' ? { ...data, playlists: data.items } : { ...data, entities: data.items }
        } else if (mode.value === 'library') {
            if (!append) await user.refresh()
            if (!user.isLoggedIn) throw new Error(user.error || '请点击右上角头像，使用 Cookie、汽水 App 扫码或手机验证码登录')
            if (libraryType.value === 'playlist') {
                if (user.error) throw new Error(user.error)
                data = { playlists: user.playlists, total: user.playlists.length }
            } else {
                data = await qishuiInvoke('collections', { type: libraryType.value, cursor: append ? cursor.value : '' })
                data = libraryType.value === 'track' ? { ...data, songs: data.items } : { ...data, entities: data.items }
            }
        } else data = await qishuiInvoke('discover', { cursor: append ? cursor.value : '' })
        if (requestId !== revision) return
        if (data.playlist || data.album || data.user) detail.value = data.playlist || data.album || data.user
        if (data.playlists) playlists.value = merge(playlists.value, data.playlists, append)
        if (data.songs) songs.value = merge(songs.value, data.songs, append)
        if (data.entities || data.albums) entities.value = merge(entities.value, data.entities || data.albums, append)
        total.value = data.total || detail.value?.songCount || songs.value.length
        hasMore.value = !!data.hasMore && !!data.cursor && data.cursor !== cursor.value
        cursor.value = data.cursor || ''
    } catch (e) { if (requestId === revision) error.value = e.message }
    finally { if (requestId === revision) loading.value = false }
}
const search = () => router.push({ path: '/qishui/search', query: { keywords: query.value.trim(), type: searchType.value, t: Date.now() } })
const changeTab = (type, key = 'type') => router.replace({ path: route.path, query: { ...route.query, [key]: type } })
const openEntity = item => router.push(`/qishui/${entityType.value}/${item.id}`)
async function shareDetail() {
    try { await copyQishuiShare(mode.value, detail.value.id); messages.success('已复制汽水官方分享链接') }
    catch (e) { error.value = e.message }
}
function searchPlaylist() { playlistFilter.value = playlistQuery.value.trim(); load() }
const playAll = () => songs.value.length && player.playNow(songs.value[0], songs.value)
const formatDuration = milliseconds => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`
async function mutate(name, params, after) {
    if (busy.value) return
    const current = revision, account = user.revision
    busy.value = true; error.value = ''
    try {
        const data = await qishuiInvoke(name, params)
        if (current !== revision || account !== user.revision) return
        await after?.(data); messages.success('已同步到汽水音乐')
    } catch (e) { if (current === revision) error.value = e.message }
    finally { busy.value = false }
}
function createPlaylist() {
    formTarget.value = null; formName.value = ''; formDescription.value = ''; formPrivate.value = false; form.value = 'create'
}
function editPlaylist(target = detail.value) {
    if (!canManageQishuiPlaylist(target, user)) return
    formTarget.value = target; formName.value = target.name; formDescription.value = target.description || ''; formPrivate.value = target.isPrivate; form.value = 'edit'
}
function confirmDeletePlaylist(target = detail.value) {
    if (!canManageQishuiPlaylist(target, user)) return
    formTarget.value = target; form.value = 'delete'
}
const savePlaylist = () => {
    if (!user.isLoggedIn || !formName.value.trim() || (form.value !== 'create' && !canManageQishuiPlaylist(formTarget.value, user))) return
    return mutate(form.value === 'create' ? 'playlist-create' : 'playlist-update', { id: formTarget.value?.id, name: formName.value, description: formDescription.value, isPrivate: formPrivate.value }, async () => { form.value = ''; await user.fetchPlaylists(); await load() })
}
const deletePlaylist = () => {
    if (!canManageQishuiPlaylist(formTarget.value, user)) return
    return mutate('playlist-delete', { ids: [formTarget.value.id] }, async () => { form.value = ''; await user.fetchPlaylists(); if (mode.value === 'library') await load(); else await router.push('/qishui/library') })
}
const collectDetail = () => mutate('collect', { type: mode.value, ids: [detail.value.id], collected: !detail.value.collected }, () => { detail.value.collected = !detail.value.collected })
const like = async song => { try { song.collected = await user.toggleLike(song, song.collected); if (player.currentSong.platform === 'qishui' && player.currentSong.id === song.id) player.isLiked = song.collected } catch(e) { error.value = e.message } }
const removeTrack = song => mutate('playlist-tracks', { id: detail.value.id, ids: [song.id], action: 'delete' }, async () => { await load(); await user.fetchPlaylists() })
function moveTrack(index, direction) {
    const target = index + direction
    if (!canReorder.value || target < 0 || target >= songs.value.length) return
    const reordered = [...songs.value]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    return mutate('playlist-tracks', { id: detail.value.id, ids: reordered.map(song => song.id), action: 'sort' }, () => { songs.value = reordered })
}
const followUser = () => mutate('follow', { id: detail.value.id, following: ![1,2].includes(detail.value.followStatus) }, data => { detail.value.followStatus = data.followStatus })
async function removeRecent(song) {
    if (!await messages.confirm(`从汽水最近播放记录中移除「${song.name}」？`, '移除播放记录')) return
    return mutate('recent-delete', { ids: [song.id] }, () => load())
}
watch(() => route.fullPath, () => { playlistFilter.value = ''; playlistQuery.value = ''; load() }, { immediate: true })
watch(() => user.revision, () => load())
onBeforeUnmount(() => revision++)
</script>

<template>
    <div class="qishui-page">
        <header class="qishui-hero">
            <div><div class="qishui-eyebrow">汽水音乐 / SODA MUSIC</div><h1>{{ pageTitle }}</h1>
                <p v-if="mode === 'discover'">从一张歌单出发，找到此刻的心情。</p>
                <p v-else-if="mode === 'search'">歌曲、歌手、专辑和歌单，找到你想听的音乐。</p>
                <p v-else-if="detail">{{ detail.creator || detail.description }}<template v-if="total"> · {{ total }} 首歌曲</template></p>
                <p v-else>你的歌单、收藏和喜欢的音乐。</p>
            </div>
            <button class="soda-button secondary" :disabled="loading || busy" @click="load()"><RefreshCw :size="16" />刷新</button>
        </header>
        <form v-if="mode === 'discover' || mode === 'search'" class="soda-search" @submit.prevent="search">
            <input v-model="query" placeholder="歌曲、歌手、专辑、歌单或歌曲分享链接" aria-label="搜索汽水音乐" />
            <button class="soda-button" type="submit">查找<ArrowUpRight :size="16" /></button>
        </form>
        <nav v-if="mode === 'search'" class="soda-tabs" aria-label="搜索类型"><button v-for="t in [{id:'track',name:'歌曲'},{id:'artist',name:'歌手'},{id:'album',name:'专辑'},{id:'playlist',name:'歌单'}]" :key="t.id" :aria-pressed="searchType === t.id" @click="changeTab(t.id)">{{ t.name }}</button></nav>
        <nav v-if="mode === 'library'" class="soda-tabs" aria-label="我的音乐分类"><button v-for="t in [{id:'playlist',name:'我的歌单'},{id:'track',name:'喜欢的歌曲'},{id:'album',name:'收藏专辑'},{id:'artist',name:'收藏歌手'}]" :key="t.id" :aria-pressed="libraryType === t.id" @click="changeTab(t.id)">{{ t.name }}</button><button v-if="user.isLoggedIn && libraryType === 'playlist'" @click="createPlaylist"><Plus :size="14" />新建歌单</button></nav>
        <div class="soda-note">{{ user.isLoggedIn ? `已连接 ${user.profile?.nickname || '汽水账号'}，播放权限随账号同步。` : '登录汽水账号，使用你的歌曲播放权限。' }} 歌曲若仅提供试听，会在播放时显示实际片段时长。</div>
        <section v-if="detail" class="soda-playlist-header">
            <QishuiCover class="soda-playlist-artwork" :src="detail.coverImgUrl" :alt="detail.name" />
            <div><p>{{ detail.description }}<template v-if="detail.releaseDate"> · {{ new Date(detail.releaseDate * 1000).toLocaleDateString('zh-CN') }}</template></p><div class="soda-actions">
                <button v-if="mode !== 'user'" class="soda-button" :disabled="!songs.length" @click="playAll"><Play :size="15" />播放已加载歌曲</button>
                <button v-if="mode !== 'user'" class="soda-button secondary" :disabled="!songs.length" @click="player.enqueue(songs)"><ListPlus :size="15" />加入队列</button>
                <button v-if="['album','artist','playlist'].includes(mode)" class="soda-button secondary" :disabled="busy" @click="collectDetail"><Heart :size="15" :fill="detail.collected ? 'currentColor' : 'none'" />{{ detail.collected ? '已收藏' : '收藏' }}</button>
                <button v-if="mode === 'artist' && detail.userId" class="soda-button secondary" @click="router.push(`/qishui/user/${detail.userId}`)">音乐人主页</button>
                <template v-if="mode === 'user'"><span class="soda-user-stats">{{ detail.followers.toLocaleString() }} 粉丝 · {{ detail.following.toLocaleString() }} 关注</span><button v-if="user.profile?.userId !== detail.id" class="soda-button secondary" :disabled="busy" @click="followUser">{{ [1,2].includes(detail.followStatus) ? '取消关注' : '关注' }}</button><button v-if="detail.artistId" class="soda-button" @click="router.push(`/qishui/artist/${detail.artistId}`)">听 TA 的作品</button></template>
                <button v-if="['album','artist','playlist'].includes(mode)" class="soda-button secondary" @click="shareDetail">复制分享链接</button>
                <button v-if="owned" class="soda-button secondary" @click="editPlaylist()">编辑歌单</button><button v-if="owned" class="soda-button secondary" @click="confirmDeletePlaylist()">删除歌单</button>
            </div></div>
        </section>
        <form v-if="form === 'create' || form === 'edit'" class="soda-edit-form" @submit.prevent="savePlaylist"><h3>{{ form === 'create' ? '新建歌单' : '编辑歌单' }}</h3><input v-model="formName" maxlength="100" placeholder="歌单名称" aria-label="歌单名称" required /><textarea v-if="form === 'edit'" v-model="formDescription" maxlength="2000" placeholder="歌单简介" aria-label="歌单简介" /><label><input v-model="formPrivate" type="checkbox" />仅自己可见</label><div class="soda-actions"><button class="soda-button" :disabled="busy">保存</button><button type="button" class="soda-button secondary" :disabled="busy" @click="form = ''">取消</button></div></form>
        <div v-if="form === 'delete'" class="soda-error" role="alertdialog" aria-label="删除汽水歌单">确定删除「{{ formTarget?.name }}」？此操作会同步到汽水音乐。<button class="soda-button" :disabled="busy" @click="deletePlaylist">确认删除</button><button class="soda-button secondary" :disabled="busy" @click="form = ''">取消</button></div>
        <form v-if="mode === 'playlist' && detail" class="soda-search" @submit.prevent="searchPlaylist"><input v-model="playlistQuery" maxlength="200" placeholder="在这张歌单中搜索歌曲、歌手" aria-label="歌单内搜索" /><button class="soda-button" :disabled="loading">搜索歌单</button><button v-if="playlistFilter" class="soda-button secondary" type="button" @click="playlistQuery = ''; searchPlaylist()">显示全部</button></form>
        <nav v-if="mode === 'artist'" class="soda-tabs" aria-label="歌手作品"><button :aria-pressed="artistTab === 'tracks'" @click="changeTab('tracks','tab')">歌曲</button><button :aria-pressed="artistTab === 'albums'" @click="changeTab('albums','tab')">专辑</button></nav>
        <div v-if="error" class="soda-error" role="alert">{{ error }}<button class="soda-button secondary" :disabled="loading" @click="load()">重试</button></div>
        <div v-if="loading && !playlists.length && !songs.length && !entities.length" class="soda-empty">正在连接汽水音乐…</div>
        <div v-if="playlists.length || entities.length" class="soda-grid">
            <article v-for="p in playlists.length ? playlists : entities" :key="p.id" class="soda-card"><button class="soda-card-open" @click="playlists.length ? router.push(`/qishui/playlist/${p.id}`) : openEntity(p)">
                <div class="soda-cover" :class="{ 'soda-artist-cover': !playlists.length && ['artist','user'].includes(entityType) }"><QishuiCover :src="p.coverImgUrl" :alt="p.name" /><Play :size="25" class="soda-cover-play" /></div>
                <strong>{{ p.name }}</strong><span>{{ p.creator || (entityType === 'artist' ? '歌手' : entityType === 'user' ? '汽水用户' : '汽水音乐') }}<template v-if="p.songCount"> · {{ p.songCount }}首</template></span>
            </button>
                <div v-if="mode === 'library' && libraryType === 'playlist' && canManageQishuiPlaylist(p,user)" class="soda-card-tools"><button :disabled="busy" @click="editPlaylist(p)">编辑</button><button :disabled="busy" @click="confirmDeletePlaylist(p)">删除</button></div>
            </article>
        </div>
        <div v-if="songs.length" class="soda-tracklist">
            <div class="soda-track-head"><span>歌曲 / {{ songs.length }} 首已加载</span><span>完整时长</span></div>
            <div v-for="(song, index) in songs" :key="song.id" class="soda-track" @click="player.handleSongClick(song, songs, $event)">
                <span class="soda-index">{{ index + 1 }}</span><QishuiCover class="soda-track-artwork" :src="song.picUrl" />
                <div class="soda-track-name"><strong>{{ song.name }}<SongVipBadge :song="song" platform="qishui" /></strong><small><button v-if="song.ar?.[0]?.id" @click.stop="router.push(`/qishui/artist/${song.ar[0].id}`)">{{ song.artist }}</button><template v-else>{{ song.artist }}</template> · <button v-if="song.al?.id" @click.stop="router.push(`/qishui/album/${song.al.id}`)">{{ song.al.name }}</button></small></div>
                <span v-if="player.currentSong.platform === 'qishui' && player.currentSong.id === song.id && player.currentSong.isPreview" class="soda-preview">试听</span><span class="soda-duration">{{ formatDuration(song.dt) }}</span>
                <button class="soda-track-tool" :disabled="user.likeBusy" :aria-label="song.collected ? '取消喜欢' : '喜欢歌曲'" @click.stop="like(song)"><Heart :size="15" :fill="song.collected ? 'currentColor' : 'none'" /></button><button class="soda-track-tool" aria-label="添加到歌单" @click.stop="pickerId = song.id"><Plus :size="16" /></button><button v-if="owned" class="soda-track-tool" :disabled="busy" @click.stop="removeTrack(song)">移除</button>
                <template v-if="canReorder"><button class="soda-track-tool" :disabled="busy || loading || index === 0" aria-label="歌曲上移" @click.stop="moveTrack(index,-1)">↑</button><button class="soda-track-tool" :disabled="busy || loading || index === songs.length-1" aria-label="歌曲下移" @click.stop="moveTrack(index,1)">↓</button></template>
                <button v-if="mode === 'recent'" class="soda-track-tool" :disabled="busy" @click.stop="removeRecent(song)">移除记录</button>
                <SongActionsMenu :song="song" :list="songs" compact />
            </div>
        </div>
        <div v-if="!loading && !error && !songs.length && !playlists.length && !entities.length && mode !== 'user'" class="soda-empty">{{ mode === 'search' ? query ? '没有找到匹配内容，试试其他关键词。' : '输入关键词开始查找' : '暂无可显示的内容' }}</div>
        <button v-if="hasMore" class="soda-button secondary soda-more" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button>
        <QishuiComment v-if="mode === 'playlist' && detail" :id="detail.id" :group-type="4" />
        <QishuiPlaylistPicker :show="!!pickerId" :song-id="pickerId" @close="pickerId = ''" />
    </div>
</template>

<style scoped>
.soda-card-open{display:flex;flex-direction:column;gap:8px;width:100%;border:0;background:none;padding:0;color:inherit;text-align:left;cursor:pointer;font:inherit}.soda-card-open .soda-cover{width:100%}.soda-card-open strong{font-size:14px}.soda-card-open>span{font-size:12px;color:var(--text-secondary)}.soda-card-tools{display:flex;gap:8px;margin-top:12px}.soda-card-tools button{border:1px solid var(--border-color);border-radius:8px;padding:6px 12px;color:var(--text-main);background:var(--hover-bg);cursor:pointer}.soda-card-tools button:hover{color:var(--primary-color)}
.soda-user-stats{font-size:13px;color:var(--text-secondary);align-self:center}.soda-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 20px}.soda-tabs button,.soda-track-tool{border:0;border-radius:8px;background:var(--hover-bg);color:var(--text-secondary);padding:9px 15px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.soda-tabs button[aria-pressed=true]{background:var(--primary-color);color:white}.soda-track-tool{padding:6px;background:transparent;color:var(--primary-color);font-size:11px;white-space:nowrap}.soda-track-tool:disabled{opacity:.4;cursor:default}.soda-track-name small button{border:0;padding:0;background:transparent;color:inherit;cursor:pointer;font:inherit}.soda-track-name small button:hover{color:var(--primary-color);text-decoration:underline}.soda-artist-cover{border-radius:50%}.soda-edit-form{display:grid;gap:12px;max-width:580px;background:var(--hover-bg);padding:20px;border-radius:14px;margin:20px 0}.soda-edit-form input:not([type=checkbox]),.soda-edit-form textarea{padding:12px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font:inherit}.soda-edit-form label{font-size:13px}.soda-edit-form h3{font-size:17px;margin:0 0 3px}

.soda-search-scope{padding:12px 16px;margin-bottom:17px;border:1px solid var(--border-color);border-radius:12px;background:var(--hover-bg);font-size:12px;color:var(--text-secondary);line-height:1.7}.soda-search-scope strong{color:var(--primary-color);font-weight:600}.soda-search-scope p{margin-top:3px}
.qishui-page{height:100%;overflow:auto;padding:30px 36px 40px;color:var(--text-main)}
.qishui-hero{display:flex;align-items:center;justify-content:space-between;gap:22px;margin-bottom:22px;padding:27px;border-radius:18px;background:linear-gradient(120deg,var(--soda-hero-start,#153D37),var(--soda-hero-end,#28665A));color:#edf8f6}
.qishui-eyebrow{font-size:11px;letter-spacing:.17em;color:#9de9d4;margin-bottom:14px}.qishui-hero h1{font-size:29px;font-weight:600;margin:0 0 12px}.qishui-hero p{font-size:13px;opacity:.8;line-height:1.7;margin:0}
.soda-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;border:0;border-radius:22px;background:var(--primary-color);color:white;padding:10px 19px;font-size:13px;white-space:nowrap}.soda-button.secondary{background:var(--hover-bg,#eaf2ef);color:var(--text-main);border:1px solid var(--border-color,#dbe8e1)}.soda-button:disabled{opacity:.5;cursor:default}
.soda-search{display:flex;gap:10px;margin-bottom:17px}.soda-search input{flex:1;min-width:0;padding:12px 17px;border:1px solid var(--border-color,#dce4df);background:var(--bg-main);border-radius:22px;color:var(--text-main);outline:none}.soda-search input:focus{border-color:var(--primary-color)}
.soda-note{font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:22px}.soda-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:24px 19px}.soda-card{border:0;text-align:left;background:transparent;padding:0;color:inherit;cursor:pointer;min-width:0}.soda-cover{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:#24494c;margin-bottom:12px}.soda-cover :deep(img){width:100%;height:100%;object-fit:cover;transition:transform .3s}.soda-card:hover :deep(img){transform:scale(1.035)}.soda-cover-play{position:absolute;right:14px;bottom:14px;color:#fff;background:#122e3280;border-radius:50%;padding:10px;box-sizing:content-box}.soda-card strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:500;line-height:1.6}.soda-card>span{display:block;font-size:11px;color:var(--text-secondary);margin-top:6px}
.soda-playlist-header{display:flex;gap:25px;margin:18px 0 25px}.soda-playlist-artwork{width:130px;height:130px;border-radius:12px;object-fit:cover}.soda-playlist-header p{line-height:1.8;font-size:13px;max-height:80px;overflow:auto}.soda-actions{display:flex;gap:10px}.soda-track-head{display:flex;justify-content:space-between;padding:12px 54px 12px 12px;color:var(--text-secondary);font-size:12px;border-bottom:1px solid var(--border-color)}.soda-track{display:flex;align-items:center;gap:14px;padding:10px;border-radius:8px;cursor:pointer}.soda-track:hover{background:var(--hover-bg)}.soda-index{width:23px;font-size:12px;color:var(--text-secondary)}.soda-track-artwork{width:43px;height:43px;border-radius:6px;object-fit:cover}.soda-track-name{flex:1;min-width:0}.soda-track-name strong,.soda-track-name small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.soda-track-name strong{font-size:14px;font-weight:500}.soda-track-name small{font-size:12px;color:var(--text-secondary);margin-top:6px}.soda-preview{font-size:10px;border:1px solid color-mix(in srgb,var(--primary-color) 35%,transparent);color:var(--primary-color);border-radius:4px;padding:2px 5px}.soda-duration{font-size:12px;color:var(--text-secondary);width:44px}.soda-error{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:20px;border:1px solid #d6ab86;border-radius:12px;font-size:13px;line-height:1.7;margin-bottom:20px}.soda-empty{padding:45px 15px;color:var(--text-secondary);text-align:center;font-size:14px}.soda-more{display:flex;margin:28px auto 0}
@media(max-width:800px){.qishui-page{padding:20px}.qishui-hero{padding:20px}.qishui-hero h1{font-size:23px}.soda-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}.soda-actions{flex-wrap:wrap}.soda-preview{display:none}}
</style>
