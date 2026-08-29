// v-reveal：元素进入视口时淡入上移（封面卡片滚动渐入）
// 用法：v-reveal 或 v-reveal="延迟毫秒"（同屏卡片传 index*35 做交错 stagger）
// 只触发一次（intersect 后停止观察），配合 keep-alive 页面返回时不会重播
const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            entry.target.classList.add('reveal-visible')
            observer.unobserve(entry.target)
        }
    }
}, { rootMargin: '60px 0px', threshold: 0.05 })

export default {
    mounted(el, binding) {
        el.classList.add('reveal')
        const delay = Number(binding.value) || 0
        if (delay > 0) el.style.transitionDelay = `${delay}ms`
        observer.observe(el)
    },
    unmounted(el) {
        observer.unobserve(el)
        el.classList.remove('reveal', 'reveal-visible')
        el.style.transitionDelay = ''
    }
}
