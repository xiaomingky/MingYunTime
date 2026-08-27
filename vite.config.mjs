import { defineConfig } from 'vite'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'electron/main.js',
        vite: {
            build: {
              // 为 Electron 22 强制输出 CJS 格式，iconv-lite/music-metadata 走 node_modules 运行时加载
              rollupOptions: {
                external: ['electron', 'node:fs', 'node:path', 'node:url', 'node:stream', 'node:crypto', 'cheerio', 'iconv-lite', 'music-metadata'],
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js',
                  inlineDynamicImports: true
                }
              }
            }
          }
      },
      {
        entry: 'electron/preload.cjs',
        onstart(options) {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
  build: {
    // 沙箱/安全删除保护会拦截 vite 清空 dist 的大批量删除(≥50 文件导致构建失败)，
    // 关闭自动清空改为覆盖写入（旧 hash 文件残留不影响功能；如需彻底清理可手动清 dist 后构建）
    emptyOutDir: false
  },
})
