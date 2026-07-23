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
})
