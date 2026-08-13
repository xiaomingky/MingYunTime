<script setup>
import { ref, watch, onMounted } from 'vue'
import { qqComments } from '../api/qq'
import { useQQUserStore } from '../store/qq-user'

const props = defineProps({
    // id: 歌曲用 songmid(字符串),歌单用 disstid
    id: { type: [String, Number], required: true },
    biztype: { type: Number, default: 1 }, // 1=歌曲 2=专辑 3=歌单 4=排行榜 5=MV
})

const qqUserStore = useQQUserStore()
const loading = ref(false)
const hotComments = ref([])
const newComments = ref([])
const page = ref(0) // QQ API pagenum 从 0 开始
const total = ref(0)
const hasMore = ref(false)
const lasthotcommentid = ref('') // 翻页需要

// QQ 评论字段:
//   nick, avatarurl, rootcommentcontent(主评论)/middlecommentcontent(回复),
//   time(秒级时间戳), praisenum, commentid
const normalizeComment = (c) => ({
    id: c.commentid || c.rootcommentid || c.id || Math.random(),
    avatar: c.avatarurl || c.avatar || '',
    nickname: c.nick || c.nickname || '匿名用户',
    content: c.rootcommentcontent || c.middlecommentcontent || c.content || '',
    time: c.time || c.comment_time || 0,
    praiseNum: c.praisenum || 0,
    reply: c.reply ? {
        nickname: c.reply.nick || c.reply.nickname || '',
        content: c.reply.content || c.reply.rootcommentcontent || ''
    } : null
})

const fetchComments = async (reset = false) => {
    if (!props.id) return
    if (reset) {
        page.value = 0
        newComments.value = []
        hotComments.value = []
        lasthotcommentid.value = ''
    }
    loading.value = true
    try {
        const cookie = qqUserStore.cookie || ''
        // 热门评论(reqtype=2):仅在首页加载
        if (reset) {
            try {
                const hotRes = await qqComments(props.id, props.biztype, 2, 25, 0, '', cookie)
                // 解包:res = { code, comment: { commentlist, commenttotal, lasthotcommentid } }
                const hotData = hotRes?.comment || hotRes?.data?.comment || hotRes?.data || {}
                const hotList = hotData?.commentlist || []
                hotComments.value = hotList.map(normalizeComment).filter(c => c.content).slice(0, 15)
                // 记录 lasthotcommentid(翻页用)
                if (hotData?.lasthotcommentid) {
                    lasthotcommentid.value = hotData.lasthotcommentid
                } else if (hotList.length > 0) {
                    lasthotcommentid.value = hotList[hotList.length - 1].commentid || ''
                }
                if (typeof hotData?.commenttotal === 'number') {
                    total.value = hotData.commenttotal
                }
                console.log('[QQ Comment] 热评加载:', hotList.length, '条, lasthotcommentid:', lasthotcommentid.value)
            } catch (e) {
                console.error('[QQ Comment] hot error:', e)
            }
        }
        // 最新评论(reqtype=1):分页加载
        // 翻页时需要 rootcommentid(= lasthotcommentid)
        const rootId = page.value === 0 ? '' : lasthotcommentid.value
        const newRes = await qqComments(props.id, props.biztype, 1, 25, page.value, rootId, cookie)
        const newData = newRes?.comment || newRes?.data?.comment || newRes?.data || {}
        const newList = newData?.commentlist || []
        if (typeof newData?.commenttotal === 'number') {
            total.value = newData.commenttotal
        }
        hasMore.value = newList.length >= 25
        if (reset) {
            newComments.value = newList.map(normalizeComment).filter(c => c.content)
        } else {
            newComments.value.push(...newList.map(normalizeComment).filter(c => c.content))
        }
        console.log('[QQ Comment] 第', page.value, '页最新评论:', newList.length, '条')
    } catch (e) {
        console.error('[QQ Comment] error:', e)
    } finally {
        loading.value = false
    }
}

const loadMore = () => {
    page.value++
    fetchComments(false)
}

const formatTime = (ts) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const now = Date.now()
    const diff = (now - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
    if (diff < 2592000) return Math.floor(diff / 86400) + '天前'
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

watch(() => props.id, () => fetchComments(true))
onMounted(() => fetchComments(true))
</script>

<template>
    <section class="qq-comment-section" v-loading="loading">
        <h2 class="qq-comment-title">
            评论
            <span class="qq-comment-count" v-if="total">({{ total }})</span>
        </h2>

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

        <div v-if="!loading && !hotComments.length && !newComments.length" class="qq-comment-empty">
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
