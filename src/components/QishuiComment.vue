<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { qishuiInvoke } from '../api/qishui'
import { useQishuiUserStore } from '../store/qishui-user'
import QishuiCover from './QishuiCover.vue'
const props = defineProps({ id: { type: [String, Number], required: true }, groupType: { type: Number, default: 0 } })
const user = useQishuiUserStore(), router = useRouter()
const comments = ref([]), total = ref(0), cursor = ref(''), hasMore = ref(false), loading = ref(false), error = ref(''), sort = ref('hot')
const text = ref(''), target = ref(null), busy = ref(false), replies = ref({}), replyCursors = ref({}), replyMore = ref({}), replyBusy = ref(''), deleting = ref('')
let generation = 0
async function load(append = false) {
    if (append && loading.value) return
    const current = ++generation
    loading.value = true; error.value = ''
    if (!append) { comments.value = []; cursor.value = ''; replies.value = {}; replyCursors.value = {}; replyMore.value = {} }
    try {
        const p = await qishuiInvoke('comments', { id: String(props.id), cursor: append ? cursor.value : '', sort: sort.value, groupType: props.groupType })
        if (generation !== current) return
        comments.value = [...new Map([...(append ? comments.value : []), ...p.comments].map(c => [c.commentId, c])).values()]
        total.value = p.total; hasMore.value = p.hasMore && !!p.cursor && p.cursor !== cursor.value; cursor.value = p.cursor
    } catch (e) { if (generation === current) error.value = e.message }
    finally { if (generation === current) loading.value = false }
}
async function act(name, params, after) {
    if (busy.value) return
    const current = generation, account = user.revision
    busy.value = true; error.value = ''
    try {
        await qishuiInvoke(name, params)
        if (current === generation && account === user.revision) await after?.()
    } catch (e) { if (current === generation) error.value = e.message }
    finally { busy.value = false }
}
const send = () => act('comment-create', { id: String(props.id), text: text.value, groupType: props.groupType, replyId: target.value?.commentId || '' }, async () => { text.value = ''; target.value = null; await load() })
const like = c => act('comment-like', { id: c.commentId, groupId: String(props.id), liked: !c.liked }, () => { c.liked = !c.liked; c.likedCount = Math.max(0, c.likedCount + (c.liked ? 1 : -1)) })
const remove = c => act('comment-delete', { id: c.commentId }, async () => { deleting.value = ''; await load() })
async function showReplies(c, append = false) {
    if (replyBusy.value) return
    const current = generation; replyBusy.value = c.commentId; error.value = ''
    try {
        const p = await qishuiInvoke('replies', { id: c.commentId, groupId: String(props.id), groupType: props.groupType, cursor: append ? replyCursors.value[c.commentId] || '' : '' })
        if (current !== generation) return
        replies.value[c.commentId] = [...new Map([...(append ? replies.value[c.commentId] || [] : []), ...p.comments].map(c => [c.commentId, c])).values()]
        replyMore.value[c.commentId] = p.hasMore && !!p.cursor && p.cursor !== replyCursors.value[c.commentId]
        replyCursors.value[c.commentId] = p.cursor
    } catch (e) { if (current === generation) error.value = e.message }
    finally { replyBusy.value = '' }
}
function openUser(id) { if (id) router.push(`/qishui/user/${id}`) }
watch(() => [props.id, props.groupType, sort.value, user.revision], () => { target.value = null; text.value = ''; load() }, { immediate: true })
onBeforeUnmount(() => generation++)
</script>
<template>
    <section class="soda-comments">
        <header><h3>评论 <small>{{ total || '' }}</small></h3><div><button :aria-pressed="sort === 'hot'" @click="sort = 'hot'">热门</button><button :aria-pressed="sort === 'time'" @click="sort = 'time'">最新</button></div></header>
        <form v-if="user.isLoggedIn" @submit.prevent="send"><p v-if="target">回复 {{ target.user.nickname }} <button type="button" @click="target = null">取消</button></p><textarea v-model="text" maxlength="2000" placeholder="聊聊这首音乐…" aria-label="汽水评论内容" /><button :disabled="busy || !text.trim()">{{ busy ? '正在提交…' : '发布评论' }}</button></form>
        <p v-else class="soda-comment-hint">登录后可以评论和点赞。</p>
        <p v-if="error" role="alert">{{ error }} <button @click="load()">重试</button></p>
        <article v-for="c in comments" :key="c.commentId"><QishuiCover class="soda-comment-avatar" :src="c.user.avatarUrl" /><div class="soda-comment-body"><button class="soda-comment-author" @click="openUser(c.user.userId)">{{ c.user.nickname }}</button><p>{{ c.content }}</p><footer><time>{{ c.time ? new Date(c.time).toLocaleString('zh-CN') : '' }}</time><button :disabled="busy || !user.isLoggedIn" :aria-pressed="c.liked" @click="like(c)">{{ c.liked ? '已赞' : '赞' }} {{ c.likedCount || '' }}</button><button v-if="user.isLoggedIn" @click="target = c">回复</button><button v-if="c.replyCount" :disabled="!!replyBusy" @click="showReplies(c)">{{ c.replyCount }} 条回复</button><button v-if="c.user.userId === user.profile?.userId" @click="deleting = c.commentId">删除</button></footer>
            <p v-if="deleting === c.commentId">确定删除这条评论？<button :disabled="busy" @click="remove(c)">删除</button><button @click="deleting = ''">取消</button></p>
            <div v-if="replies[c.commentId]" class="soda-comment-replies"><p v-for="r in replies[c.commentId]" :key="r.commentId"><strong>{{ r.user.nickname }}：</strong>{{ r.content }}</p><button v-if="replyMore[c.commentId]" :disabled="!!replyBusy" @click="showReplies(c, true)">更多回复</button></div>
        </div></article>
        <p v-if="loading">正在加载评论…</p><p v-else-if="!comments.length && !error">还没有评论。</p><button v-if="hasMore" :disabled="loading" @click="load(true)">加载更多评论</button>
    </section>
</template>
<style scoped>
.soda-comments .soda-comment-author{padding:0;background:transparent;border:0;color:var(--primary-color);font-weight:600}.soda-comments{color:var(--text-main);padding:8px 0 20px}.soda-comments header,.soda-comments footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.soda-comments header{justify-content:space-between;margin-bottom:20px}.soda-comments h3{font-size:18px}.soda-comments small,.soda-comments time,.soda-comment-hint{font-size:12px;color:var(--text-secondary)}.soda-comments button{border:1px solid var(--border-color);border-radius:7px;padding:6px 11px;background:var(--hover-bg);color:inherit;cursor:pointer}.soda-comments button[aria-pressed=true]{color:var(--primary-color);border-color:var(--primary-color)}.soda-comments button:disabled{opacity:.45;cursor:default}.soda-comments form{margin-bottom:25px}.soda-comments textarea{box-sizing:border-box;width:100%;min-height:75px;resize:vertical;padding:12px;border-radius:9px;border:1px solid var(--border-color);background:var(--hover-bg);color:inherit;margin-bottom:10px;font:inherit}.soda-comments article{display:flex;gap:13px;padding:20px 0;border-top:1px solid var(--border-color)}.soda-comment-avatar{width:37px;height:37px;border-radius:50%;flex-shrink:0}.soda-comment-body{min-width:0;flex:1}.soda-comment-body>strong{font-size:13px;color:var(--primary-color)}.soda-comments p{font-size:13px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}.soda-comments footer{font-size:11px}.soda-comments footer button{font-size:11px;border:0;background:transparent;padding:3px}.soda-comment-replies{padding:7px 13px;border-left:2px solid var(--primary-color);margin-top:13px;background:var(--hover-bg)}
.soda-comments textarea::placeholder{color:var(--text-secondary);opacity:1}
</style>
