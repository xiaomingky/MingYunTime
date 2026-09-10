import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './style.css'
import App from './App.vue'
import reveal from './directives/reveal'

// Win7（Windows NT 6.1）性能优化标记：
// 老机器 + 老显卡驱动跑毛玻璃(backdrop-filter)合成特效很吃力，挂 html.win7 后在样式层整体禁用，
// 换半透明纯色背景，流畅度明显提升、GPU 合成压力大减。
try {
    if (/Windows NT 6\.1/.test(navigator.userAgent)) {
        document.documentElement.classList.add('win7')
    }
} catch (e) {}

const app = createApp(App)
const pinia = createPinia()

app.directive('reveal', reveal)
app.use(pinia)
app.use(router)
app.mount('#app')
