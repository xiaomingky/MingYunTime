// 确保酷狗音乐 API 的源码和依赖在打包资源里就绪
// 与 QQ 的 ensure-qq-music-dist.cjs 类似,但更简单(KuGouMusicApi 兼容 Node 12+,无需 polyfill)
//
// 为何用 libs 而非 node_modules:
//   electron-builder 的 extraResources 会硬编码忽略 node_modules 目录名,
//   改用 libs 目录绕过过滤,子进程启动时通过 NODE_PATH 环境变量指向 libs。
//
// 源码来源:resources/kugou-music-api-src/(由 git clone 下载)
// 打包目标:resources/kugou-music-api/(被 extraResources 带入安装包)
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '..')
const srcDir = path.join(projectRoot, 'resources', 'kugou-music-api-src')
const destDir = path.join(projectRoot, 'resources', 'kugou-music-api')
const destMarker = path.join(destDir, 'app.js')
const destDepsMarker = path.join(destDir, 'libs', 'express', 'package.json')

// 递归复制目录(跳过明显无用的文件以减小安装包体积)
function copyDirSync(from, to, opts = {}) {
    const { skipTests = true } = opts
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, entry.name)
        const d = path.join(to, entry.name)
        if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase()
            // 跳过测试/文档/示例/.git目录
            if (skipTests && (lower === 'test' || lower === 'tests' || lower === '__tests__' ||
                lower === 'docs' || lower === 'examples' || lower === 'example' ||
                lower === '.git' || lower === '.github' || lower === 'node_modules')) {
                continue
            }
            copyDirSync(s, d, opts)
        } else {
            if (skipTests) {
                const lower = entry.name.toLowerCase()
                if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.ts.map') ||
                    lower.endsWith('.d.ts') || lower.endsWith('.d.cts') || lower.endsWith('.d.mts') ||
                    lower === 'license' || lower === 'changelog.md' || lower === 'readme.md' ||
                    lower === '.npmignore' || lower === '.eslintrc' || lower === '.editorconfig' ||
                    lower === '.travis.yml' || lower === '.jshintrc' || lower === '.gitignore' ||
                    lower === 'tsconfig.json' || lower === 'tsdown.config.js' || lower === 'nodemon.json' ||
                    lower === 'dockerfile' || lower === '.dockerignore' || lower === '.prettierrc.json') {
                    continue
                }
            }
            fs.copyFileSync(s, d)
        }
    }
}

// 主流程
;(function main() {
    // 1. 检查源码是否存在
    if (!fs.existsSync(path.join(srcDir, 'app.js'))) {
        console.error('[ensure-kugou-music-api] 源码不存在,请先运行:')
        console.error('  git clone --depth 1 https://github.com/MakcRe/KuGouMusicApi.git resources/kugou-music-api-src')
        console.error('  cd resources/kugou-music-api-src && npm install --production')
        process.exit(1)
    }

    // 2. 若打包副本已就绪,跳过
    if (fs.existsSync(destMarker) && fs.existsSync(destDepsMarker)) {
        console.log('[ensure-kugou-music-api] 源码 + 依赖均已就绪,跳过同步')
        process.exit(0)
    }

    // 3. 同步源码到打包目录
    console.log('[ensure-kugou-music-api] 同步源码到打包目录:', destDir)
    try { fs.rmSync(destDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    fs.mkdirSync(destDir, { recursive: true })
    copyDirSync(srcDir, destDir)

    // 4. 确保 .env 文件存在(platform=lite)
    const envPath = path.join(destDir, '.env')
    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, 'platform=lite\nPORT=3300\n', 'utf-8')
        console.log('[ensure-kugou-music-api] 已创建 .env (platform=lite, PORT=3300)')
    }

    // 5. 复制 node_modules 到 libs/(绕过 electron-builder 对 node_modules 的过滤)
    const srcModules = path.join(srcDir, 'node_modules')
    const destLibs = path.join(destDir, 'libs')
    if (!fs.existsSync(srcModules)) {
        console.error('[ensure-kugou-music-api] node_modules 不存在,请先在 resources/kugou-music-api-src 运行 npm install --production')
        process.exit(1)
    }
    console.log('[ensure-kugou-music-api] 复制 node_modules 到 libs/ ...')
    copyDirSync(srcModules, destLibs)

    if (!fs.existsSync(destDepsMarker)) {
        console.error('[ensure-kugou-music-api] 依赖复制后仍找不到 express,子进程将崩溃')
        process.exit(1)
    }
    console.log('[ensure-kugou-music-api] 就绪')
})()
