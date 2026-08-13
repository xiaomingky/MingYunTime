import { defineConfig } from 'vite'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Tauri 前端 API 包需要被打包进 bundle，不能 external
  build: {
    target: 'esnext',
  },
  // 开发服务器配置
  // host 必须设为 127.0.0.1(不能用 localhost)
  // Windows 上 localhost 可能解析为 IPv6 ::1,Tauri WebView2 用 IPv4 连接会失败 → 白屏
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
})
