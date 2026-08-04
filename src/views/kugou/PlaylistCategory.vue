<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { kugouPlaylistCategory, kugouPlaylist, normalizeKugouPlaylist, flattenKugouPlaylistTags } from '../../api/kugou'

const router = useRouter()

const loading = ref(false)
const categories = ref([])
const currentCat = ref('')
const playlists = ref([])
const page = ref(1)
const hasMore = ref(true)

const fetchCategories = async () => {
    try {
        const res = await kugouPlaylistCategory()
        // /playlist/tags 实测返回 { status:1, data: [ {tag_id, tag_name, parent_id, son:[...]}, ... ] }
        // 用 flattenKugouPlaylistTags 扁平化为 [{id, name, group}] 列表
        categories.value = flattenKugouPlaylistTags(res?.data)
        if (!categories.value.length) {
            categories.value = [{ id: '', name: '全部', group: '热门' }]
        }
        if (categories.value.length && !currentCat.value) {
            currentCat.value = categories.value[0].id
            fetchPlaylists(true)
        }
    } catch (e) {
        console.error('[Kugou PlaylistCategory] fetchCategories error:', e)
        categories.value = [{ id: '', name: '全部', group: '热门' }]
        currentCat.value = ''
        fetchPlaylists(true)
    }
}

const fetchPlaylists = async (reset = false) => {
    if (reset) {
        page.value = 1
        playlists.value = []
        hasMore.value = true
    }
    if (!hasMore.value) return
    loading.value = true
    try {
        // kugouPlaylist(category_id, withsong, withtag, page, pagesize)
        const res = await kugouPlaylist(currentCat.value || 0, 0, 0, page.value, 30)
        // /top/playlist 实测返回 { status:1, data: { special_list: [...], has_next, ... } }
        const list = res?.data?.special_list || res?.data?.list || []
        const mapped = (Array.isArray(list) ? list : []).map(normalizeKugouPlaylist).filter(p => p.id)
        if (reset) {
            playlists.value = mapped
        } else {
            playlists.value.push(...mapped)
        }
        // has_next=1 表示有下一页
        const hasNext = res?.data?.has_next
        hasMore.value = hasNext !== undefined ? (hasNext === 1) : (mapped.length >= 30)
        if (mapped.length) page.value++
    } catch (e) {
        console.error('[Kugou PlaylistCategory] fetchPlaylists error:', e)
    } finally {
        loading.value = false
    }
}

const selectCategory = (catId) => {
    if (currentCat.value === catId) return
    currentCat.value = catId
    fetchPlaylists(true)
}

const goToDetail = (id) => id && router.push(`/kugou/playlist/${id}`)
const loadMore = () => fetchPlaylists(false)

onMounted(fetchCategories)
</script>

<template>
    <div class="kugou-cat-page" v-loading="loading">
        <h2 class="kugou-page-title">歌单分类</h2>

        <!-- 分类标签 -->
        <div class="kugou-cat-tabs">
            <span
                v-for="c in categories"
                :key="c.id"
                class="kugou-cat-tag"
                :class="{ active: currentCat === c.id }"
                @click="selectCategory(c.id)"
            >{{ c.name }}</span>
        </div>

        <!-- 歌单网格 -->
        <div class="kugou-card-grid">
            <div v-for="p in playlists" :key="p.id" class="kugou-card" @click="goToDetail(p.id)">
                <img :src="p.coverImgUrl" :alt="p.name" class="kugou-card-img" loading="lazy" />
                <div class="kugou-card-name">{{ p.name }}</div>
                <div class="kugou-card-meta" v-if="p.creator">{{ p.creator }}</div>
            </div>
        </div>

        <div v-if="hasMore && playlists.length" class="kugou-load-more">
            <button class="kugou-load-btn" @click="loadMore" :disabled="loading">加载更多</button>
        </div>
        <div v-if="!loading && !playlists.length" class="kugou-empty">暂无歌单</div>
    </div>
</template>

<style scoped>
.kugou-cat-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.kugou-page-title {
    font-size: 20px; font-weight: 600; margin-bottom: 18px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
.kugou-cat-tabs {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;
}
.kugou-cat-tag {
    padding: 5px 16px; font-size: 13px; color: var(--text-secondary);
    cursor: pointer; border-radius: 16px; transition: all 0.15s;
    background: var(--bg-sidebar);
}
.kugou-cat-tag:hover { color: var(--primary-color); }
.kugou-cat-tag.active {
    background: var(--primary-color); color: white; font-weight: 600;
}
.kugou-card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 18px;
}
.kugou-card { cursor: pointer; transition: transform 0.18s; }
.kugou-card:hover { transform: translateY(-3px); }
.kugou-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; background: var(--hover-bg);
}
.kugou-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-card-meta {
    font-size: 12px; color: var(--text-light); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kugou-load-more { text-align: center; margin-top: 24px; }
.kugou-load-btn {
    background: var(--hover-bg); border: 1px solid var(--border-color);
    padding: 8px 32px; border-radius: 16px; cursor: pointer; color: var(--text-main);
}
.kugou-load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kugou-empty { text-align: center; color: var(--text-light); padding: 80px 0; font-size: 14px; }
</style>
