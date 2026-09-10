// scripts/afterPack.cjs
// electron-builder 打包完成后回调：裁剪 app 目录里对运行无用的文件以缩小安装包体积。
// 1) locales：只保留中文(zh-CN)与英文(en-US)，其余 ~25MB 语言包全部删除
const fs = require('fs')
const path = require('path')

const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak'])

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  try {
    const localesDir = path.join(appOutDir, 'locales')
    if (fs.existsSync(localesDir)) {
      for (const f of fs.readdirSync(localesDir)) {
        if (!KEEP_LOCALES.has(f)) {
          fs.rmSync(path.join(localesDir, f), { force: true })
        }
      }
      console.log('[afterPack] locales trimmed to zh-CN + en-US')
    }
  } catch (e) {
    console.warn('[afterPack] locale trim skipped:', e.message)
  }
}