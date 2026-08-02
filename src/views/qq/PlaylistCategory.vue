<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { qqPlaylistCategories, qqPlaylistList, qqBatchPlaylists, normalizeQQPlaylist } from '../../api/qq'

const router = useRouter()

const loading = ref(false)
const categories = ref([])
const currentCat = ref(null)
const playlists = ref([])
const page = ref(1)
const hasMore = ref(true)
const batchPlaylists = ref([]) // 批量精选歌单

const fetchCategories = async () => {
    try {
        const res = await qqPlaylistCategories()
        // 解包 response 后：{ code, data: { categories: [{ categoryGroupName, items: [{ categoryId, categoryName }] }] } }
        const cats = res?.data?.categories || res?.categories || []
        // 展平所有分组下的 items 作为分类列表
        const allCats = []
        cats.forEach(group => {
            if (group.items && Array.isArray(group.items)) {
                group.items.forEach(item => {
                    allCats.push({
                        id: item.categoryId || item.id,
                        name: item.categoryName || item.name || '',
                        group: group.categoryGroupName || ''
                    })
                })
            }
        })
        categories.value = allCats.filter(c => c.id)
        if (categories.value.length && !currentCat.value) {
            currentCat.value = categories.value[0].id
            fetchPlaylists(true)
        }
    } catch (e) {
        console.error('[QQ PlaylistCategory] fetchCategories error:', e)
        // 降级：用默认分类
        categories.value = [
            { id: 10000000, name: '全部', group: '热门' },
            { id: 165, name: '国语', group: '语种' },
            { id: 166, name: '粤语', group: '语种' },
            { id: 167, name: '英语', group: '语种' },
            { id: 168, name: '韩语', group: '语种' },
            { id: 169, name: '日语', group: '语种' },
            { id: 6, name: '流行', group: '风格' },
            { id: 7, name: '摇滚', group: '风格' }
        ]
        currentCat.value = categories.value[0].id
        fetchPlaylists(true)
    }
}

const fetchPlaylists = async (reset = false) => {
    if (!currentCat.value) return
    if (reset) {
        page.value = 1
        playlists.value = []
        hasMore.value = true
    }
    if (!hasMore.value) return
    loading.value = true
    try {
        const res = await qqPlaylistList({ categoryId: currentCat.value, sortId: 5, limit: 30, page: page.value })
        const data = res?.data || res
        const list = data?.list || data?.songListList || data?.playlists || []
        const mapped = list.map(normalizeQQPlaylist).filter(p => p.id)
        if (reset) {
            playlists.value = mapped
        } else {
            playlists.value.push(...mapped)
        }
        hasMore.value = mapped.length >= 30
        if (mapped.length) page.value++
    } catch (e) {
        console.error('[QQ PlaylistCategory] fetchPlaylists error:', e)
    } finally {
        loading.value = false
    }
}

// 批量获取多个分类的歌单（首页展示用）
const fetchBatchPlaylists = async () => {
    try {
        const res = await qqBatchPlaylists({ categoryIds: [10000000, 1, 2], page: 0, limit: 6 })
        const data = res?.data || res
        // 返回的可能是按分类分组的歌单数组
        const list = data?.list || data?.data || data?.playlists || []
        batchPlaylists.value = (Array.isArray(list) ? list : [])
            .map(normalizeQQPlaylist)
            .filter(p => p.id)
            .slice(0, 10)
    } catch (e) {
        console.error('[QQ PlaylistCategory] fetchBatchPlaylists error:', e)
        batchPlaylists.value = []
    }
}

const selectCategory = (catId) => {
    if (currentCat.value === catId) return
    currentCat.value = catId
    fetchPlaylists(true)
}

const goToDetail = (id) => id && router.push(`/qq/playlist/${id}`)
const loadMore = () => fetchPlaylists(false)

onMounted(() => {
    fetchBatchPlaylists()
    fetchCategories()
})
</script>

<template>
    <div class="qq-cat-page" v-loading="loading">
        <h2 class="qq-page-title">歌单分类</h2>

        <!-- 精选推荐（批量歌单） -->
        <section class="qq-section" v-if="batchPlaylists.length">
            <h3 class="qq-section-sub-title">精选推荐</h3>
            <div class="qq-batch-grid">
                <div v-for="p in batchPlaylists" :key="'batch-' + p.id" class="qq-card" @click="goToDetail(p.id)">
                    <img :src="p.coverImgUrl" :alt="p.name" class="qq-card-img" loading="lazy" />
                    <div class="qq-card-name">{{ p.name }}</div>
                </div>
            </div>
        </section>

        <!-- 分类标签 -->
        <div class="qq-cat-tabs">
            <span
                v-for="c in categories"
                :key="c.id"
                class="qq-cat-tag"
                :class="{ active: currentCat === c.id }"
                @click="selectCategory(c.id)"
            >{{ c.name }}</span>
        </div>

        <!-- 歌单网格 -->
        <div class="qq-card-grid">
            <div v-for="p in playlists" :key="p.id" class="qq-card" @click="goToDetail(p.id)">
                <img :src="p.coverImgUrl" :alt="p.name" class="qq-card-img" loading="lazy" />
                <div class="qq-card-name">{{ p.name }}</div>
                <div class="qq-card-meta" v-if="p.creator?.name || p.creator">{{ p.creator?.name || p.creator }}</div>
            </div>
        </div>

        <div v-if="hasMore && playlists.length" class="qq-load-more">
            <button class="qq-load-btn" @click="loadMore" :disabled="loading">加载更多</button>
        </div>
        <div v-if="!loading && !playlists.length" class="qq-empty">暂无歌单</div>
    </div>
</template>

<style scoped>
.qq-cat-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-page-title {
    font-size: 20px; font-weight: 600; margin-bottom: 18px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
.qq-section { margin-bottom: 28px; }
.qq-section-sub-title {
    font-size: 16px; font-weight: 600; margin-bottom: 14px; color: var(--text-main);
}
.qq-batch-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px;
}
.qq-cat-tabs {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;
}
.qq-cat-tag {
    padding: 5px 16px; font-size: 13px; color: var(--text-secondary);
    cursor: pointer; border-radius: 16px; transition: all 0.15s;
    background: var(--bg-sidebar);
}
.qq-cat-tag:hover { color: var(--primary-color); }
.qq-cat-tag.active {
    background: var(--primary-color); color: white; font-weight: 600;
}
.qq-card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 18px;
}
.qq-card { cursor: pointer; transition: transform 0.18s; }
.qq-card:hover { transform: translateY(-3px); }
.qq-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.qq-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-card-meta {
    font-size: 12px; color: var(--text-light); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qq-load-more { text-align: center; margin-top: 24px; }
.qq-load-btn {
    background: var(--hover-bg); border: 1px solid var(--border-color);
    padding: 8px 32px; border-radius: 16px; cursor: pointer; color: var(--text-main);
}
.qq-load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qq-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
</style>
