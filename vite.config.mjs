import { defineConfig } from 'vite'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { transform } from 'esbuild'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    // Pixi's URL helper runs in the isolated renderer, where Node require is unavailable.
    alias: [{ find: /^url$/, replacement: require.resolve('url/') }]
  },
  plugins: [
    vue(),
    {
      name: 'apple-lyrics-css',
      enforce: 'pre',
      async transform(code, id) {
        // AMLL ships nested CSS; Keep vendor CSS consistent between development and production.
        if (id.replaceAll('\\', '/').includes('@applemusic-like-lyrics/core/dist/style.css')) {
          return (await transform(code, { loader: 'css', target: 'chrome152' })).code
        }
      }
    },
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'electron/main.js',
        vite: {
            build: {
              // 主进程输出 CJS 格式，iconv-lite/music-metadata 走 node_modules 运行时加载
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
    target: 'chrome152',
    cssTarget: 'chrome152',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.replaceAll('\\', '/').includes('/node_modules/anime4k-webgpu/')) return 'anime4k-webgpu'
        }
      }
    },
    // 沙箱/安全删除保护会拦截 vite 清空 dist 的大批量删除(≥50 文件导致构建失败)，
    // 关闭自动清空改为覆盖写入（旧 hash 文件残留不影响功能；如需彻底清理可手动清 dist 后构建）
    emptyOutDir: false
  },
})
