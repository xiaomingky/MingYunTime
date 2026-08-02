<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { qqSingerList, normalizeQQSinger } from '../../api/qq'

const router = useRouter()

const loading = ref(false)
const singers = ref([])
const page = ref(1)
const hasMore = ref(true)

// 筛选条件：area/sex/genre
// QQ API "全部"标签 id 为 -100（非 -1）
const filters = {
    area: [
        { value: -100, label: '全部' },
        { value: 200, label: '内地' },
        { value: 2, label: '港台' },
        { value: 5, label: '欧美' },
        { value: 4, label: '日本' },
        { value: 3, label: '韩国' },
        { value: 6, label: '其他' }
    ],
    sex: [
        { value: -100, label: '全部' },
        { value: 0, label: '男歌手' },
        { value: 1, label: '女歌手' },
        { value: 2, label: '组合' }
    ],
    genre: [
        { value: -100, label: '全部' },
        { value: 1, label: '流行' },
        { value: 2, label: 'R&B' },
        { value: 3, label: '摇滚' },
        { value: 4, label: '民谣' },
        { value: 5, label: '电子' },
        { value: 6, label: '嘻哈' }
    ]
}
const currentArea = ref(-100)
const currentSex = ref(-100)
const currentGenre = ref(-100)

const fetchSingers = async (reset = false) => {
    if (reset) {
        page.value = 1
        singers.value = []
        hasMore.value = true
    }
    if (!hasMore.value) return
    loading.value = true
    try {
        const res = await qqSingerList({ area: currentArea.value, sex: currentSex.value, genre: currentGenre.value, page: page.value, limit: 30 })
        // 解包 response 后结构：{ code, singerList: { data: { singerlist: [...] } } }
        const list = res?.singerList?.data?.singerlist || res?.data?.singerlist || res?.data?.list || []
        const mapped = list.map(normalizeQQSinger).filter(s => s.id)
        if (reset) {
            singers.value = mapped
        } else {
            singers.value.push(...mapped)
        }
        hasMore.value = mapped.length >= 30
        if (mapped.length) page.value++
    } catch (e) {
        console.error('[QQ SingerList] error:', e)
    } finally {
        loading.value = false
    }
}

const selectFilter = (type, value) => {
    if (type === 'area') currentArea.value = value
    else if (type === 'sex') currentSex.value = value
    else if (type === 'genre') currentGenre.value = value
    fetchSingers(true)
}

const goToDetail = (id) => id && router.push(`/qq/singer/${id}`)
const loadMore = () => fetchSingers(false)

onMounted(() => fetchSingers(true))
</script>

<template>
    <div class="qq-singerlist-page" v-loading="loading">
        <h2 class="qq-page-title">歌手分类</h2>

        <!-- 筛选区 -->
        <div class="qq-filter-area">
            <div class="qq-filter-row" v-for="(opts, key) in filters" :key="key">
                <span class="qq-filter-label">{{ key === 'area' ? '地区' : key === 'sex' ? '性别' : '流派' }}</span>
                <div class="qq-filter-options">
                    <span
                        v-for="o in opts"
                        :key="o.value"
                        class="qq-filter-tag"
                        :class="{
                            active: key === 'area' ? currentArea === o.value : key === 'sex' ? currentSex === o.value : currentGenre === o.value
                        }"
                        @click="selectFilter(key, o.value)"
                    >{{ o.label }}</span>
                </div>
            </div>
        </div>

        <!-- 歌手网格 -->
        <div class="qq-singer-grid">
            <div v-for="s in singers" :key="s.id" class="qq-singer-card" @click="goToDetail(s.id)">
                <img :src="s.picUrl" :alt="s.name" class="qq-singer-card-img" loading="lazy" />
                <div class="qq-singer-card-name">{{ s.name }}</div>
            </div>
        </div>

        <div v-if="hasMore && singers.length" class="qq-load-more">
            <button class="qq-load-btn" @click="loadMore" :disabled="loading">加载更多</button>
        </div>
        <div v-if="!loading && !singers.length" class="qq-empty">暂无歌手</div>
    </div>
</template>

<style scoped>
.qq-singerlist-page { padding: 20px 28px; height: 100%; overflow-y: auto; }
.qq-page-title {
    font-size: 20px; font-weight: 600; margin-bottom: 18px; color: var(--text-main);
    border-left: 3px solid var(--primary-color); padding-left: 10px;
}
.qq-filter-area {
    margin-bottom: 24px; padding: 16px; background: var(--bg-sidebar);
    border-radius: 8px;
}
.qq-filter-row {
    display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;
}
.qq-filter-row:last-child { margin-bottom: 0; }
.qq-filter-label {
    font-size: 13px; color: var(--text-light); width: 36px; flex-shrink: 0; padding-top: 4px;
}
.qq-filter-options { display: flex; flex-wrap: wrap; gap: 8px; }
.qq-filter-tag {
    padding: 3px 12px; font-size: 13px; color: var(--text-secondary);
    cursor: pointer; border-radius: 12px; transition: all 0.15s;
}
.qq-filter-tag:hover { color: var(--primary-color); background: var(--hover-bg); }
.qq-filter-tag.active {
    background: var(--primary-color); color: white; font-weight: 600;
}
.qq-singer-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 20px;
}
.qq-singer-card { cursor: pointer; transition: transform 0.18s; text-align: center; }
.qq-singer-card:hover { transform: translateY(-3px); }
.qq-singer-card-img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 50%; background: var(--hover-bg);
}
.qq-singer-card-name {
    font-size: 13px; margin-top: 8px; color: var(--text-main);
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
