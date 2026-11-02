<script setup>
import { computed } from 'vue'
import { MessageSquare, ThumbsUp, ThumbsDown, CornerDownRight, ExternalLink, Send } from 'lucide-vue-next'

const props = defineProps({
    items: { type: Array, default: () => [] },
    total: { type: Number, default: 0 },
    loading: Boolean,
    error: { type: String, default: '' },
    hasMore: Boolean,
    sourceUrl: { type: String, default: 'https://www.5eplay.com/' },
    title: { type: String, default: '本场评论区' },
    subtitle: { type: String, default: '汇总本场选手评分页下的 5EPlay 用户评论' },
    countUnit: { type: String, default: '条评论' },
    matchMode: Boolean
})
const emit = defineEmits(['more'])

const avatar = comment => {
    const value = String(comment?.user_data?.avatar_url || '')
    if (!value) return ''
    if (/^https:\/\//.test(value)) return value
    return 'https://oss-arena.5eplay.com/' + value.replace(/\\/g, '/').replace(/^\/+/, '')
}
const username = comment => comment?.user_data?.username || '5EPlay 用户'
const initial = comment => username(comment).slice(0, 1)
const comments = computed(() => props.items)
const totalLabel = computed(() => props.total ? `${props.total} ${props.countUnit}` : '暂无评论')
const subject = comment => comment?.subject || null
const floorLabel = comment => comment?.floor ? `#${comment.floor}` : ''
const replyCount = comment => Number(comment?.sub_count ?? comment?.replies) || 0
const imagesOf = comment => {
    let value = comment?.images
    if (typeof value === 'string') { try { value = JSON.parse(value) } catch { value = [] } }
    return Array.isArray(value) ? value.filter(url => typeof url === 'string' && /^https:\/\//.test(url)) : []
}
const childrenOf = comment => Array.isArray(comment?.children) ? comment.children.filter(row => row?.content || imagesOf(row).length) : []
</script>

<template>
    <section class="es-comments">
        <header class="es-comments-head">
            <div>
                <span class="es-kicker">5EPLAY COMMUNITY</span>
                <h3><MessageSquare :size="17" />{{ title }}</h3>
                <p>{{ subtitle }}</p>
            </div>
            <span class="es-comments-count">{{ totalLabel }}</span>
        </header>
        <div class="es-comment-editor">
            <div class="es-comment-editor-avatar"><Send :size="16" /></div>
            <div class="es-comment-editor-main">
                <p>{{ matchMode ? '登录 5EPlay 后即可参与本场讨论，发表你的看法。' : '登录 5EPlay 后即可参与赛事讨论、发表观点与回复玩家。' }}</p>
                <a :href="sourceUrl" target="_blank" rel="noopener noreferrer">前往 5EPlay 登录并评论<ExternalLink :size="13" /></a>
            </div>
        </div>
        <div v-if="loading && !comments.length" class="es-comments-state">正在加载 5EPlay 评论…</div>
        <div v-else-if="error" class="es-comments-state is-error">{{ error }}</div>
        <div v-else-if="!comments.length" class="es-comments-state"><MessageSquare :size="26" />{{ matchMode ? '本场暂无评论' : '本场赛事暂无可展示的 5EPlay 评论' }}</div>
        <ol v-else class="es-comment-list">
            <li v-for="comment in comments" :key="comment.comment_id" class="es-comment">
                <img v-if="avatar(comment)" :src="avatar(comment)" :alt="username(comment)" loading="lazy" referrerpolicy="no-referrer" />
                <span v-else class="es-comment-avatar">{{ initial(comment) }}</span>
                <div class="es-comment-body">
                    <header>
                        <b>{{ username(comment) }}</b>
                        <small v-if="comment.user_data?.domain">ID {{ comment.user_data.domain }}</small>
                        <span>{{ comment.time || '' }}</span>
                        <em v-if="floorLabel(comment)">{{ floorLabel(comment) }}</em>
                    </header>
                    <div v-if="subject(comment)" class="es-comment-subject">
                        <img v-if="subject(comment).playerLogo" :src="subject(comment).playerLogo" alt="" loading="lazy" referrerpolicy="no-referrer" />
                        <span>评价 <b>{{ subject(comment).playerName }}</b></span>
                        <span v-if="subject(comment).teamName">{{ subject(comment).teamName }}</span>
                    </div>
                    <p>{{ comment.content }}</p>
                    <div v-if="imagesOf(comment).length" class="es-comment-images"><a v-for="image in imagesOf(comment)" :key="image" :href="image" target="_blank" rel="noopener noreferrer"><img :src="image" alt="评论图片" loading="lazy" referrerpolicy="no-referrer" /></a></div>
                    <ol v-if="childrenOf(comment).length" class="es-comment-children"><li v-for="reply in childrenOf(comment)" :key="reply.comment_id"><b>{{ username(reply) }}</b><span>{{ reply.content }}</span><div v-if="imagesOf(reply).length" class="es-comment-images"><a v-for="image in imagesOf(reply)" :key="image" :href="image" target="_blank" rel="noopener noreferrer"><img :src="image" alt="回复图片" loading="lazy" referrerpolicy="no-referrer" /></a></div></li></ol>
                    <div class="es-comment-actions">
                        <span><ThumbsUp :size="13" />{{ comment.likes || 0 }}</span>
                        <span><ThumbsDown :size="13" />{{ comment.dislikes || 0 }}</span>
                        <span v-if="replyCount(comment)"><CornerDownRight :size="13" />{{ replyCount(comment) }} 条回复</span>
                        <span v-if="comment.ip">{{ comment.ip }}</span>
                    </div>
                </div>
            </li>
        </ol>
        <button v-if="hasMore" class="es-comments-more" :disabled="loading" @click="emit('more')">{{ loading ? '加载中…' : '加载更多评论' }}</button>
    </section>
</template>
