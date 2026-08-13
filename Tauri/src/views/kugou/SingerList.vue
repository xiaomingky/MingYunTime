<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { kugouSingerList, normalizeKugouSinger, flattenKugouSingerList } from '../../api/kugou'

const router = useRouter()

const loading = ref(false)
const singers = ref([])
const page = ref(1)
const hasMore = ref(true)

// 酷狗歌手分类使用 sextypes 参数（0全部 1男 2女 3组合）
const filters = {
    class: [
        { value: 0, label: '全部' },
        { value: 1, label: '男歌手' },
        { value: 2, label: '女歌手' },
        { value: 3, label: '组合' }
    ]
}
const currentClass = ref(0)

const fetchSingers = async (reset = false) => {
    if (reset) {
        page.value = 1
        singers.value = []
        hasMore.value = true
    }
    if (!hasMore.value) return
    loading.value = true
    try {
        const res = await kugouSingerList(currentClass.value, 0, 0, 30)
        // /artist/lists 实测返回 { status:1, data: { info: [ {title, singer:[...]}, ... ], enu_list, timestamp } }
        // 用 flattenKugouSingerList 扁平化 info[].singer[] 为单一列表
        const data = res?.data || {}
        const list = flattenKugouSingerList(data)
        const mapped = list.map(normalizeKugouSinger).filter(s => s.id)
        if (reset) {
            singers.value = mapped
        } else {
            singers.value.push(...mapped)
        }
        // artist/lists 不支持分页，一次性返回全部
        hasMore.value = false
    } catch (e) {
        console.error('[Kugou SingerList] error:', e)
    } finally {
        loading.value = false
    }
}

const selectFilter = (value) => {
    if (currentClass.value === value) return
    currentClass.value = value
    fetchSingers(true)
}

const goToDetail = (id) => id && router.push(`/kugou/singer/${id}`)
const loadMore = () => fetchSingers(false)

onMounted(() => fetchSingers(true))
</script>

<template>
    <div class="kugou-singerlist-page" v-loading="loading">
        <h2 class="kugou-page-title">歌手分类</h2>

        <!-- 筛选区 -->
        <div class="kugou-filter-area">
            <div class="kugou-filter-row">
                <span class="kugou-filter-label">分类</span>
                <div class="kugou-filter-options">
                    <span
                        v-for="o in filters.class"
                        :key="o.value"
                        class="kugou-filter-tag"
                        :class="{ active: currentClass === o.value }"
                        @click="selectFilter(o.value)"
                    >{{ o.label }}</span>
                </div>
            </div>
        </div>

        <!-- 歌手网格 -->
        <div class="kugou-singer-grid">
            <div v-for="s in singers" :key="s.id" class="kugou-singer-card" @click="goToDetail(s.id)">
                <img :src="s.picUrl" :alt="s.name" class="kugou-singer-card-img" loading="lazy" />
                <div class="kugou-singer-card-name">{{ s.name }}</div>
            </div>
        </div>

        <div v-if="hasMore && singers.length" class="kugou-load-more">
            <button class="kugou-load-btn" @click="loadMore" :disabled="loading">加载更多</button>
        </div>
        <div v-if="!loading && !singers.length" class="kugou-empty">暂无歌手</div>
    </div>
</template>

<style scoped>
.kugou-singerlist-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.kugou-page-title {
    font-size: 20px; font-weight: 600; margin-bottom: 18px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
.kugou-filter-area {
    margin-bottom: 24px; padding: 16px; background: var(--bg-sidebar);
    border-radius: 8px;
}
.kugou-filter-row {
    display: flex; align-items: flex-start; gap: 12px;
}
.kugou-filter-label {
    font-size: 13px; color: var(--text-light); width: 36px; flex-shrink: 0; padding-top: 4px;
}
.kugou-filter-options { display: flex; flex-wrap: wrap; gap: 8px; }
.kugou-filter-tag {
    padding: 3px 12px; font-size: 13px; color: var(--text-secondary);
    cursor: pointer; border-radius: 12px; transition: all 0.15s;
}
.kugou-filter-tag:hover { color: var(--primary-color); background: var(--hover-bg); }
.kugou-filter-tag.active {
    background: var(--primary-color); color: white; font-weight: 600;
}
.kugou-singer-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 20px;
}
.kugou-singer-card { cursor: pointer; transition: transform 0.18s; text-align: center; }
.kugou-singer-card:hover { transform: translateY(-3px); }
.kugou-singer-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 50%; background: var(--hover-bg);
}
.kugou-singer-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
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
