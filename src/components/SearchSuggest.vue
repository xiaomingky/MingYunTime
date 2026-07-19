<script setup>
// 搜索建议下拉组件（搜索历史 + 相似推荐 + 热门词）
// 供全局搜索栏和各页面搜索框共用
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Search, Clock, Trash2, Flame, X, ArrowUpRight } from 'lucide-vue-next'
import { useSearchHistoryStore } from '../store/searchHistory'

const props = defineProps({
    module: { type: String, required: true }, // music | anime | movie | video
    query: { type: String, default: '' },     // 当前输入
    visible: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'clear-history', 'remove-item'])

const historyStore = useSearchHistoryStore()

const history = computed(() => historyStore.getHistory(props.module))
const suggestions = computed(() => historyStore.getSuggestions(props.module, props.query))
const hotKeywords = computed(() => historyStore.getHotKeywords(props.module))

// 区分「有输入时显示相似推荐」和「无输入时显示历史+热门」
const showSuggestions = computed(() => props.query.trim().length > 0 && suggestions.value.length > 0)
const showHistory = computed(() => props.query.trim().length === 0 && history.value.length > 0)
const showHot = computed(() => props.query.trim().length === 0)

function selectKeyword(kw) {
    emit('select', kw)
}

function removeItem(kw, e) {
    e.stopPropagation()
    historyStore.removeHistory(props.module, kw)
}

function clearAll() {
    historyStore.clearHistory(props.module)
    emit('clear-history')
}
</script>

<template>
    <transition name="suggest-fade">
        <div v-if="visible" class="search-suggest">
            <!-- 相似推荐（有输入时） -->
            <div v-if="showSuggestions" class="suggest-section">
                <div class="section-title">
                    <Search :size="12" /> 相似推荐
                </div>
                <div class="suggest-list">
                    <div
                        v-for="kw in suggestions"
                        :key="'sug-' + kw"
                        class="suggest-item"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <ArrowUpRight :size="14" class="item-icon" />
                        <span class="item-text">{{ kw }}</span>
                    </div>
                </div>
            </div>

            <!-- 搜索历史（无输入时） -->
            <div v-if="showHistory" class="suggest-section">
                <div class="section-title">
                    <Clock :size="12" /> 搜索历史
                    <span class="clear-btn" @click="clearAll" title="清空历史">
                        <Trash2 :size="12" /> 清空
                    </span>
                </div>
                <div class="history-tags">
                    <div
                        v-for="kw in history"
                        :key="'his-' + kw"
                        class="history-tag"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <span class="tag-text">{{ kw }}</span>
                        <span class="tag-remove" @click="removeItem(kw, $event)" title="删除">
                            <X :size="10" />
                        </span>
                    </div>
                </div>
            </div>

            <!-- 热门搜索（无输入时） -->
            <div v-if="showHot" class="suggest-section">
                <div class="section-title">
                    <Flame :size="12" /> 热门搜索
                </div>
                <div class="hot-list">
                    <div
                        v-for="(kw, idx) in hotKeywords"
                        :key="'hot-' + kw"
                        class="hot-item"
                        @mousedown.prevent="selectKeyword(kw)"
                    >
                        <span class="hot-rank" :class="{ top: idx < 3 }">{{ idx + 1 }}</span>
                        <span class="hot-text">{{ kw }}</span>
                    </div>
                </div>
            </div>

            <!-- 空状态（有输入但无匹配） -->
            <div v-if="query.trim() && !showSuggestions" class="suggest-empty">
                暂无相关推荐，按回车搜索 "{{ query }}"
            </div>
        </div>
    </transition>
</template>

<style scoped>
.search-suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 6px;
    background: rgba(255, 255, 255, .98);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(0, 0, 0, .08);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, .15);
    z-index: 1000;
    min-width: 360px;
    max-height: 520px;
    overflow-y: auto;
    padding: 10px 0;
}

.suggest-section {
    padding: 6px 0;
    border-bottom: 1px solid rgba(0, 0, 0, .05);
}
.suggest-section:last-child { border-bottom: none; }

.section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    font-size: 11px;
    color: #999;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
}
.clear-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 3px;
    color: #999;
    cursor: pointer;
    font-size: 11px;
    font-weight: 400;
    transition: color .15s;
}
.clear-btn:hover { color: #c20c0c; }

/* 相似推荐列表 */
.suggest-list { padding: 2px 6px; }
.suggest-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 6px;
    transition: background .15s;
}
.suggest-item:hover { background: rgba(194, 12, 12, .08); }
.suggest-item .item-icon { color: #c20c0c; flex-shrink: 0; }
.suggest-item .item-text {
    color: #333;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 历史标签 */
.history-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 14px;
    max-height: 180px;
    overflow-y: auto;
}
.history-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px 5px 12px;
    background: rgba(0, 0, 0, .05);
    border-radius: 14px;
    cursor: pointer;
    transition: all .15s;
    max-width: 240px;
}
.history-tag:hover { background: rgba(194, 12, 12, .12); }
.tag-text {
    font-size: 12px;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tag-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    color: #999;
    transition: all .15s;
}
.tag-remove:hover {
    background: #c20c0c;
    color: #fff;
}

/* 热门列表 */
.hot-list {
    padding: 2px 6px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px 12px;
}
.hot-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 6px;
    transition: background .15s;
}
.hot-item:hover { background: rgba(194, 12, 12, .08); }
.hot-rank {
    width: 18px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    color: #999;
    font-style: italic;
}
.hot-rank.top { color: #c20c0c; }
.hot-text {
    font-size: 13px;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 空状态 */
.suggest-empty {
    padding: 16px;
    text-align: center;
    color: #999;
    font-size: 12px;
}

/* 滚动条 */
.search-suggest::-webkit-scrollbar { width: 6px; }
.search-suggest::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, .15);
    border-radius: 3px;
}
.search-suggest::-webkit-scrollbar-thumb:hover { background: rgba(194, 12, 12, .4); }

/* 过渡 */
.suggest-fade-enter-active, .suggest-fade-leave-active {
    transition: opacity .2s, transform .2s;
}
.suggest-fade-enter-from, .suggest-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}

/* 响应式 */
@media (max-width: 640px) {
    .hot-list { grid-template-columns: 1fr; }
}
</style>
