// scripts/clean-dist.cjs
// 构建前清空 dist / dist-electron 历史残留：
// vite.config.mjs 因沙箱保护关闭了 emptyOutDir（大目录删除会被拦截导致构建失败），
// 导致每次构建只覆盖不清理，dist 里累计了大量旧 hash chunk（曾达到 200MB+，直接撑爆安装包体积）。
// 这里在 vite build 前显式清空一次，保证每次产物只有本地构建的最新文件。
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
for (const dir of ['dist', 'dist-electron']) {
  const target = path.join(root, dir)
  if (fs.existsSync(target)) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
      console.log('[clean-dist] removed', dir)
    } catch (e) {
      // 删除失败不阻断构建：残留旧文件不影响功能，只是体积变大
      console.warn('[clean-dist] FAILED to remove', dir, e.message)
    }
  }
}