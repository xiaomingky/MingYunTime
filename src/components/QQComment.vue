<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { qqComments, qqResourceComments } from '../api/qq'
const props = defineProps({ id: { type: [String, Number], required: true }, biztype: { type: Number, default: 1 } })
const loading = ref(false), hotComments = ref([]), newComments = ref([]), page = ref(0)
const total = ref(0), hasMore = ref(false), error = ref('')
let requestId = 0
const normalizeComment = c => ({ id: c.commentId, avatar: c.user?.avatarUrl || '', nickname: c.user?.nickname || '匿名用户',
    content: c.content || '', time: c.time || 0, praiseNum: c.likedCount || 0,
    reply: c.beReplied?.[0] ? { nickname: c.beReplied[0].user?.nickname, content: c.beReplied[0].content } : null })
const request = (cmd, pagenum) => props.biztype === 1
    ? qqComments(String(props.id), /^\d+$/.test(String(props.id)) ? String(props.id) : undefined, cmd, pagenum, 25)
    : qqResourceComments(props.id, props.biztype, cmd, pagenum, 25)
const fetchComments = async (reset = false) => {
    if (!props.id || (!reset && loading.value)) return
    const id = ++requestId, nextPage = reset ? 0 : page.value + 1
    loading.value = true; error.value = ''
    if (reset) { hotComments.value = []; newComments.value = []; total.value = 0; hasMore.value = false }
    try {
        if (reset) {
            const hot = await request(6, 0)
            if (id !== requestId) return
            if (hot?.code === 0) hotComments.value = (hot.data?.comments || []).map(normalizeComment).filter(c => c.content)
        }
        const res = await request(8, nextPage)
        if (id !== requestId) return
        if (res?.code !== 0) throw new Error(res?.message || '评论加载失败')
        const list = (res.data?.comments || []).map(normalizeComment).filter(c => c.content)
        newComments.value = reset ? list : [...newComments.value, ...list].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
        total.value = res.data?.total || 0; hasMore.value = !!res.data?.hasMore; page.value = nextPage
    } catch (e) { if (id === requestId) error.value = e.message }
    finally { if (id === requestId) loading.value = false }
}
const loadMore = () => fetchComments(false)
const formatTime = ts => ts ? new Date(ts).toLocaleString('zh-CN') : ''
watch(() => [props.id, props.biztype], () => fetchComments(true), { immediate: true })
onBeforeUnmount(() => requestId++)
</script>

<template>
    <section class="qq-comment-section" v-loading="loading">
        <h2 class="qq-comment-title">
            评论
            <span class="qq-comment-count" v-if="total">({{ total }})</span>
        </h2>

        <div v-if="error" class="qq-comment-empty">{{ error }} <button @click="fetchComments(true)">重试</button></div>
        <!-- 热门评论 -->
        <div class="qq-comment-group" v-if="hotComments.length">
            <h3 class="qq-comment-group-title">精彩评论</h3>
            <div v-for="c in hotComments" :key="'hot-' + c.id" class="qq-comment-item">
                <img :src="c.avatar" class="qq-comment-avatar" v-if="c.avatar" loading="lazy" @error="$event.target.style.display='none'" />
                <div class="qq-comment-avatar qq-comment-avatar-placeholder" v-else>{{ (c.nickname || '?').charAt(0) }}</div>
                <div class="qq-comment-body">
                    <div class="qq-comment-user">{{ c.nickname }}</div>
                    <div class="qq-comment-text">{{ c.content }}</div>
                    <div v-if="c.reply" class="qq-comment-reply">
                        <span class="reply-user">@{{ c.reply.nickname }}:</span>
                        <span>{{ c.reply.content }}</span>
                    </div>
                    <div class="qq-comment-foot">
                        <span class="qq-comment-time">{{ formatTime(c.time) }}</span>
                        <span class="qq-comment-praise" v-if="c.praiseNum">👍 {{ c.praiseNum }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 最新评论 -->
        <div class="qq-comment-group" v-if="newComments.length">
            <h3 class="qq-comment-group-title">最新评论</h3>
            <div v-for="c in newComments" :key="'new-' + c.id" class="qq-comment-item">
                <img :src="c.avatar" class="qq-comment-avatar" v-if="c.avatar" loading="lazy" @error="$event.target.style.display='none'" />
                <div class="qq-comment-avatar qq-comment-avatar-placeholder" v-else>{{ (c.nickname || '?').charAt(0) }}</div>
                <div class="qq-comment-body">
                    <div class="qq-comment-user">{{ c.nickname }}</div>
                    <div class="qq-comment-text">{{ c.content }}</div>
                    <div v-if="c.reply" class="qq-comment-reply">
                        <span class="reply-user">@{{ c.reply.nickname }}:</span>
                        <span>{{ c.reply.content }}</span>
                    </div>
                    <div class="qq-comment-foot">
                        <span class="qq-comment-time">{{ formatTime(c.time) }}</span>
                        <span class="qq-comment-praise" v-if="c.praiseNum">👍 {{ c.praiseNum }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="!loading && !error && !hotComments.length && !newComments.length" class="qq-comment-empty">
            暂无评论
        </div>

        <div v-if="hasMore && newComments.length" class="qq-comment-more">
            <button class="qq-comment-more-btn" @click="loadMore" :disabled="loading">
                {{ loading ? '加载中...' : '加载更多' }}
            </button>
        </div>
    </section>
</template>

<style scoped>
.qq-comment-section {
    margin-top: 32px;
    margin-bottom: 20px;
}
.qq-comment-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-main);
    border-left: 3px solid var(--primary-color);
    padding-left: 10px;
}
.qq-comment-count {
    font-size: 14px;
    color: var(--text-light);
    font-weight: normal;
}
.qq-comment-group {
    margin-bottom: 24px;
}
.qq-comment-group-title {
    font-size: 15px;
    color: var(--text-main);
    margin-bottom: 12px;
    font-weight: 600;
}
.qq-comment-item {
    display: flex;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
}
.qq-comment-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.qq-comment-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--hover-bg);
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
}
.qq-comment-body {
    flex: 1;
    min-width: 0;
}
.qq-comment-user {
    font-size: 13px;
    color: var(--primary-color);
    margin-bottom: 4px;
}
.qq-comment-text {
    font-size: 14px;
    color: var(--text-main);
    line-height: 1.5;
    word-break: break-word;
}
.qq-comment-reply {
    font-size: 13px;
    color: var(--text-secondary);
    background: var(--hover-bg);
    padding: 6px 10px;
    border-radius: 6px;
    margin-top: 6px;
    line-height: 1.5;
}
.reply-user {
    color: var(--primary-color);
    margin-right: 4px;
}
.qq-comment-foot {
    display: flex;
    gap: 16px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-light);
}
.qq-comment-empty {
    text-align: center;
    color: var(--text-light);
    padding: 40px 0;
    font-size: 14px;
}
.qq-comment-more {
    text-align: center;
    margin-top: 16px;
}
.qq-comment-more-btn {
    background: var(--hover-bg);
    border: 1px solid var(--border-color);
    padding: 6px 28px;
    border-radius: 16px;
    cursor: pointer;
    color: var(--text-main);
    font-size: 13px;
}
.qq-comment-more-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
