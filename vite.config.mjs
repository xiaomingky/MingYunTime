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
              // 为 Electron 22 强制输出 CJS 格式且不外置 music-metadata
              rollupOptions: {
                external: ['electron', 'node:fs', 'node:path', 'node:url', 'node:stream', 'node:crypto', 'cheerio'],
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
