<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
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
const error = ref(''), categoryError = ref('')
let revision=0, disposed=false

const fetchCategories = async () => {
    try {
        const res = await qqPlaylistCategories()
        if(disposed)return
        if(res?.code!==0)throw new Error(res?.message || '分类加载失败')
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
        if(disposed)return
        categoryError.value='分类服务暂不可用，已显示常用分类'
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
    if(!reset && loading.value)return
    if (!currentCat.value) return
    if (reset) {
        page.value = 1
        playlists.value = []
        hasMore.value = true
    }
    if (!hasMore.value) return
    const requestId=++revision
    loading.value = true
    error.value=''
    try {
        const res = await qqPlaylistList({ categoryId: currentCat.value, sortId: 5, limit: 30, page: page.value })
        if(disposed || requestId!==revision)return
        if(res?.code!==0)throw new Error(res?.message || 'QQ 歌单加载失败')
        const data = res?.data || res
        const list = data?.list || data?.songListList || data?.playlists || []
        const mapped = list.map(normalizeQQPlaylist).filter(p => p.id)
        if (reset) {
            playlists.value = mapped
        } else {
            playlists.value=[...new Map([...playlists.value,...mapped].map(p=>[String(p.id),p])).values()]
        }
        hasMore.value = mapped.length >= 30
        if (mapped.length) page.value++
    } catch (e) {
        if(!disposed && requestId===revision)error.value=e.message || '歌单加载失败，请重试'
    } finally {
        if(!disposed && requestId===revision)loading.value = false
    }
}

// 批量获取多个分类的歌单（首页展示用）
const fetchBatchPlaylists = async () => {
    try {
        const res = await qqBatchPlaylists({ categoryIds: [10000000, 1, 2], page: 0, limit: 6 })
        if(disposed)return
        const data = res?.data || res
        // 返回的可能是按分类分组的歌单数组
        const list = data?.list || data?.data || data?.playlists || []
        batchPlaylists.value = (Array.isArray(list) ? list : [])
            .map(normalizeQQPlaylist)
            .filter(p => p.id)
            .slice(0, 10)
    } catch (e) {
        if(disposed)return
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
onBeforeUnmount(()=>{disposed=true;revision++})
</script>

<template>
    <div class="qq-cat-page" v-loading="loading">
        <h2 class="qq-page-title">歌单分类</h2>
        <p v-if="categoryError" class="qq-category-warning" role="status">{{ categoryError }}</p>
        <p v-if="error" class="qq-category-error" role="alert">{{ error }} <button :disabled="loading" @click="fetchPlaylists(!playlists.length)">重试</button></p>

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
        <div v-if="!loading && !error && !playlists.length" class="qq-empty">此分类暂无歌单</div>
    </div>
</template>

<style scoped>
.qq-cat-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-category-warning,.qq-category-error { color:var(--text-secondary); padding:12px; border:1px solid var(--border-color); border-radius:8px; font-size:13px; }
.qq-category-error button { color:var(--primary-color); background:transparent; border:0; cursor:pointer; }
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
