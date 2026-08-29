import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

// Tab 指示条（滑动药丸/下划线）共享逻辑：
// 在 tab 容器内定位一个跟随 .active 项的元素，切换时平滑滑动过去。
// containerRef 对应元素需为 position:relative；itemSelector 传 tab 项类名（如 '.tab-btn'）。
// activeSource 传单个响应源或响应源数组（如 [currentCat, () => searchMode.value]）。
export function useTabIndicator(containerRef, activeSource, itemSelector) {
    const indicatorStyle = ref({ transform: 'translate(0px, 0px)', width: '0px', height: '0px' })
    const indicatorVisible = ref(false)
    // 首次定位前禁用过渡，避免挂载时指示条从 (0,0) 滑过来
    const indicatorReady = ref(false)

    const update = () => {
        const container = containerRef.value
        if (!container) return
        const el = container.querySelector(`${itemSelector}.active`)
        if (!el) {
            indicatorVisible.value = false
            return
        }
        // offsetLeft/offsetTop 相对定位祖先（容器）的 padding edge，
        // 与 absolute 指示条的定位基准一致，直接平移即可对齐
        indicatorStyle.value = {
            transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`,
            width: el.offsetWidth + 'px',
            height: el.offsetHeight + 'px'
        }
        indicatorVisible.value = true
        if (!indicatorReady.value) {
            requestAnimationFrame(() => requestAnimationFrame(() => { indicatorReady.value = true }))
        }
    }
    const schedule = () => {
        nextTick(update)
        setTimeout(update, 60) // 布局稳定后（字体/计数变化导致宽度变化）再校准
    }
    const sources = Array.isArray(activeSource) ? activeSource : [activeSource]
    sources.forEach(s => watch(s, schedule))
    onMounted(() => {
        schedule()
        window.addEventListener('resize', schedule)
    })
    onUnmounted(() => window.removeEventListener('resize', schedule))

    return { indicatorStyle, indicatorVisible, indicatorReady }
}
