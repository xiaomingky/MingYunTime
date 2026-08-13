import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './style.css'
import App from './App.vue'
// Tauri 桥接层（替代 electron/preload.cjs，必须在 App 之前导入）
import './lib/tauri-bridge.js'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')
