// 确保 NeteaseCloudMusicApiEnhanced 的源码和依赖在打包资源里就绪
// 源码来源: resources/netease-api-src/ (由 git clone 下载)
// 打包目标: resources/netease-api/ (被 extraResources 带入安装包)
// 模式与 ensure-kugou-music-api.cjs 一致:
//   - node_modules 复制为 libs(绕过 electron-builder 对 node_modules 目录名的过滤)
//   - 子进程启动时通过 NODE_PATH 环境变量指向 libs
// 注意: 源码目录用 pnpm 安装会生成 junction 符号链接,复制会断裂且打包后失效,
//       因此在打包副本内直接用 npm 重新安装平铺依赖。
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const projectRoot = path.join(__dirname, '..')
const srcDir = path.join(projectRoot, 'resources', 'netease-api-src')
const destDir = path.join(projectRoot, 'resources', 'netease-api')
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
                lower === '.git' || lower === '.github' || lower === 'node_modules' ||
                lower === '.codegraph' || lower === 'scripts' || lower === '.pnpm' ||
                lower === 'husky' || lower === '.husky')) {
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
                    lower === 'dockerfile' || lower === '.dockerignore' || lower === '.prettierrc' ||
                    lower === '.prettierrc.json' || lower === 'eslint.config.js' ||
                    lower === 'pnpm-lock.yaml' || lower === 'scf_bootstrap' ||
                    lower === 'vercel.json' || lower === 'interface.d.ts') {
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
        console.error('[ensure-netease-api] 源码不存在,请先运行:')
        console.error('  git clone --depth 1 https://github.com/neteasecloudmusicapienhanced/api-enhanced.git resources/netease-api-src')
        console.error('  cd resources/netease-api-src && pnpm install --prod --ignore-scripts')
        process.exit(1)
    }

    // 2. 若打包副本已就绪,跳过
    if (fs.existsSync(destMarker) && fs.existsSync(destDepsMarker)) {
        console.log('[ensure-netease-api] 源码 + 依赖均已就绪,跳过同步')
        process.exit(0)
    }

    // 3. 同步源码到打包目录
    console.log('[ensure-netease-api] 同步源码到打包目录:', destDir)
    try { fs.rmSync(destDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    fs.mkdirSync(destDir, { recursive: true })
    copyDirSync(srcDir, destDir)

    // 4. 在打包副本内用 npm 安装平铺依赖(源码 pnpm 的 junction 链接无法直接复制)
    console.log('[ensure-netease-api] 在打包副本内 npm install --omit=dev ...')
    try {
        execSync('npm install --omit=dev --no-audit --no-fund --no-save --ignore-scripts', {
            cwd: destDir,
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'production' }
        })
    } catch (e) {
        console.error('[ensure-netease-api] npm install 失败:', e.message)
        process.exit(1)
    }

    // 5. node_modules 重命名为 libs(绕过 electron-builder 对 node_modules 的过滤)
    const destModules = path.join(destDir, 'node_modules')
    const destLibs = path.join(destDir, 'libs')
    if (!fs.existsSync(destModules)) {
        console.error('[ensure-netease-api] npm install 后 node_modules 不存在')
        process.exit(1)
    }
    try { fs.rmSync(destLibs, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    fs.renameSync(destModules, destLibs)

    if (!fs.existsSync(destDepsMarker)) {
        console.error('[ensure-netease-api] 依赖重命名后仍找不到 express,子进程将崩溃')
        process.exit(1)
    }
    console.log('[ensure-netease-api] 就绪')
})()
