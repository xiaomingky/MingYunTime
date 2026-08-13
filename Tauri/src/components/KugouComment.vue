<script setup>
import { ref, watch, onMounted } from 'vue'
import { Heart } from 'lucide-vue-next'
import { kugouCommentSong, kugouCommentPlaylist, kugouCommentAlbum } from '../api/kugou'

const props = defineProps({
    // song: mixsongid; playlist: global_collection_id; album: album_id
    id: { type: [String, Number], required: true },
    // 'song' | 'playlist' | 'album'
    type: { type: String, default: 'song' }
})

const loading = ref(false)
const comments = ref([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)

// 酷狗评论字段映射到统一格式
// 响应结构: { status, list:[{ id, content, addtime, user_name, user_pic, like:{likenum}, reply_num, puser_id, pcontent, images, location }], count }
const normalizeComment = (c) => ({
    id: c.id || Math.random(),
    avatar: c.user_pic || '',
    nickname: c.user_name || '匿名用户',
    content: c.content || '',
    time: c.addtime || '',
    praiseNum: c.like?.likenum || c.like?.count || 0,
    replyNum: c.reply_num || 0,
    reply: c.puser_id && c.pcontent ? {
        content: c.pcontent
    } : null,
    images: Array.isArray(c.images) ? c.images.map(i => i.url).filter(Boolean) : [],
    location: c.location || ''
})

const fetcher = () => {
    if (props.type === 'song') return kugouCommentSong
    if (props.type === 'playlist') return kugouCommentPlaylist
    return kugouCommentAlbum
}

const fetchComments = async (reset = false) => {
    if (!props.id) return
    if (reset) {
        page.value = 1
        comments.value = []
    }
    loading.value = true
    try {
        const api = fetcher()
        const res = await api(props.id, page.value, 30)
        const list = res?.list || res?.data?.list || []
        if (typeof res?.count === 'number') total.value = res.count
        hasMore.value = list.length >= 30
        const normalized = list.map(normalizeComment).filter(c => c.content)
        if (reset) {
            comments.value = normalized
        } else {
            comments.value.push(...normalized)
        }
        console.log(`[Kugou Comment] ${props.type} 第${page.value}页:`, normalized.length, '条')
    } catch (e) {
        console.error('[Kugou Comment] error:', e)
    } finally {
        loading.value = false
    }
}

const loadMore = () => {
    page.value++
    fetchComments(false)
}

const formatTime = (timeStr) => {
    if (!timeStr) return ''
    // 酷狗返回 "2023-12-28 02:43:51" 格式,直接截取日期部分
    return timeStr.length >= 10 ? timeStr.slice(0, 10) : timeStr
}

watch(() => props.id, () => fetchComments(true))
onMounted(() => fetchComments(true))
</script>

<template>
    <div class="kugou-comment-section">
        <div class="kugou-comment-header">
            <span>评论 ({{ total }})</span>
            <span class="kugou-comment-hint">酷狗概念版 · 只读</span>
        </div>

        <div v-if="loading && !comments.length" class="kugou-comment-loading">评论加载中...</div>

        <div v-if="!loading && !comments.length" class="kugou-comment-empty">暂无评论</div>

        <div class="kugou-comment-list">
            <div v-for="c in comments" :key="c.id" class="kugou-comment-item">
                <img v-if="c.avatar" :src="c.avatar" class="kugou-comment-avatar" loading="lazy" />
                <div v-else class="kugou-comment-avatar-placeholder">{{ c.nickname.charAt(0) }}</div>
                <div class="kugou-comment-body">
                    <div class="kugou-comment-meta">
                        <span class="kugou-comment-nickname">{{ c.nickname }}</span>
                        <span v-if="c.location" class="kugou-comment-location">{{ c.location }}</span>
                    </div>
                    <div v-if="c.reply" class="kugou-comment-reply">
                        回复: {{ c.reply.content }}
                    </div>
                    <div class="kugou-comment-content">{{ c.content }}</div>
                    <div v-if="c.images.length" class="kugou-comment-images">
                        <img
                            v-for="(img, idx) in c.images"
                            :key="idx"
                            :src="img"
                            class="kugou-comment-img"
                            loading="lazy"
                        />
                    </div>
                    <div class="kugou-comment-footer">
                        <span class="kugou-comment-time">{{ formatTime(c.time) }}</span>
                        <span class="kugou-comment-likes">
                            <Heart :size="12" />
                            {{ c.praiseNum }}
                        </span>
                        <span v-if="c.replyNum" class="kugou-comment-replies">{{ c.replyNum }}回复</span>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="hasMore && comments.length" class="kugou-comment-load-more">
            <button class="kugou-comment-load-btn" @click="loadMore" :disabled="loading">
                {{ loading ? '加载中...' : '加载更多' }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.kugou-comment-section {
    padding: 20px 0;
}
.kugou-comment-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-main, #333);
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
}
.kugou-comment-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-light, #999);
}
.kugou-comment-loading,
.kugou-comment-empty {
    text-align: center;
    color: var(--text-light, #999);
    padding: 40px 0;
    font-size: 13px;
}
.kugou-comment-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.kugou-comment-item {
    display: flex;
    gap: 10px;
}
.kugou-comment-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.kugou-comment-avatar-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--primary-color, #2CA2F5);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    flex-shrink: 0;
}
.kugou-comment-body {
    flex: 1;
    min-width: 0;
}
.kugou-comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}
.kugou-comment-nickname {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary, #666);
}
.kugou-comment-location {
    font-size: 11px;
    color: var(--text-light, #999);
}
.kugou-comment-reply {
    font-size: 12px;
    color: var(--text-light, #999);
    background: var(--hover-bg, rgba(0,0,0,0.03));
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kugou-comment-content {
    font-size: 14px;
    color: var(--text-main, #333);
    line-height: 1.6;
    word-break: break-word;
}
.kugou-comment-images {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
.kugou-comment-img {
    width: 80px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    cursor: pointer;
}
.kugou-comment-footer {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 6px;
}
.kugou-comment-time {
    font-size: 11px;
    color: var(--text-light, #bbb);
}
.kugou-comment-likes {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-light, #999);
}
.kugou-comment-replies {
    font-size: 11px;
    color: var(--text-light, #999);
}
.kugou-comment-load-more {
    text-align: center;
    margin-top: 20px;
}
.kugou-comment-load-btn {
    background: var(--hover-bg, rgba(0,0,0,0.04));
    border: 1px solid var(--border-color, rgba(0,0,0,0.08));
    padding: 8px 32px;
    border-radius: 16px;
    cursor: pointer;
    color: var(--text-secondary, #666);
    font-size: 13px;
    transition: all 0.15s;
}
.kugou-comment-load-btn:hover:not(:disabled) {
    background: var(--primary-color, #2CA2F5);
    color: white;
    border-color: var(--primary-color, #2CA2F5);
}
.kugou-comment-load-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
