// 确保 QQ 音乐 API 的可执行文件在打包资源里就绪
// 问题:@sansenjian/qq-music-api 安装后 dist 目录可能缺失(缓存残缺/安装异常),
// 且 electron-builder 的 extraResources 指向 node_modules 路径会被跳过(与 asar 打包冲突)。
// 方案:把 dist + package.json + 运行时依赖同步到项目 resources/qq-music-api/ 下,
// 由 extraResources 的 "resources/**" 通配自动带入 win-unpacked/resources/,
// 绕开 node_modules 路径冲突。子进程按 resources/qq-music-api/dist/app.cjs 启动。
//
// 关键:打包后子进程在 resources/qq-music-api/ 下启动,Node 向上查找 node_modules,
// 必须把 @sansenjian/qq-music-api 的所有传递依赖也复制到 resources/qq-music-api/libs/,
// 否则 require('axios') / require('koa') 会 MODULE_NOT_FOUND 崩溃。
//
// 为何用 libs 而非 node_modules:
//   electron-builder 的 extraResources 会硬编码忽略 node_modules 目录(即使 resources/**
//   通配也不会复制)。改用 libs 目录绕过过滤,子进程启动时通过 NODE_PATH 环境变量
//   指向 libs,让 Node 的模块解析能找到依赖。dev 模式不受影响(项目根 node_modules 照常工作)。
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const os = require('node:os')

const PKG_VERSION = '2.4.0'
const projectRoot = path.join(__dirname, '..')
// 项目根 node_modules(扁平化依赖来源)
const rootModules = path.join(projectRoot, 'node_modules')
// 打包用的副本目录(被 resources/** 带入安装包)
const destDir = path.join(projectRoot, 'resources', 'qq-music-api')
const destMarker = path.join(destDir, 'dist', 'app.cjs')
// 依赖就绪标记:axios 作为顶层依赖存在,标志依赖已复制完成(放在 libs/ 而非 node_modules/)
const destDepsMarker = path.join(destDir, 'libs', 'axios', 'package.json')
// 源:npm 安装的包
const srcDir = path.join(projectRoot, 'node_modules', '@sansenjian', 'qq-music-api')
const srcMarker = path.join(srcDir, 'dist', 'app.cjs')

// 递归复制目录(跳过明显无用的文件以减小安装包体积)
function copyDirSync(from, to, opts = {}) {
    const { skipTests = true } = opts
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, entry.name)
        const d = path.join(to, entry.name)
        if (entry.isDirectory()) {
            // 跳过测试/文档/示例目录
            const lower = entry.name.toLowerCase()
            if (skipTests && (lower === 'test' || lower === 'tests' || lower === '__tests__' || lower === 'test-utils' || lower === 'docs' || lower === 'examples' || lower === 'example')) {
                continue
            }
            copyDirSync(s, d, opts)
        } else {
            // 跳过无用文件
            if (skipTests) {
                const lower = entry.name.toLowerCase()
                if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.ts.map') ||
                    lower.endsWith('.d.ts') || lower.endsWith('.d.cts') || lower.endsWith('.d.mts') ||
                    lower === 'license' || lower === 'changelog.md' || lower === 'readme.md' ||
                    lower === '.npmignore' || lower === '.eslintrc' || lower === '.editorconfig' ||
                    lower === '.travis.yml' || lower === '.jshintrc') {
                    continue
                }
            }
            fs.copyFileSync(s, d)
        }
    }
}

// 从 npm tarball 恢复 dist 到 srcDir
function restoreFromTarball() {
    console.log('[ensure-qq-music-dist] node_modules 下 dist 缺失,从 npm registry 恢复...')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-pkg-'))
    try {
        const url = execSync(`npm view @sansenjian/qq-music-api@${PKG_VERSION} dist.tarball`, { encoding: 'utf-8' }).trim()
        execSync(`npm pack "${url}" --pack-destination "${tmp}"`, { stdio: 'inherit' })
        const packed = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'))
        if (!packed) throw new Error('npm pack 未生成 tgz')
        const tgz = path.join(tmp, packed)
        execSync(`tar -xzf "${tgz}" -C "${srcDir}" --strip-components=1 "package/dist"`, { stdio: 'inherit' })
        if (!fs.existsSync(srcMarker)) throw new Error('解压后仍找不到 app.cjs')
        console.log('[ensure-qq-music-dist] node_modules/dist 已恢复')
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    }
}

// 从 fromDir 解析 pkgName 的实际根路径(兼容 scoped 包和嵌套安装)
function resolvePackageDir(pkgName, fromDir) {
    try {
        // require.resolve(package.json) 能正确处理 npm 扁平化 + 嵌套 node_modules
        const resolved = require.resolve(path.join(pkgName, 'package.json'), { paths: [fromDir] })
        return path.dirname(resolved)
    } catch (e) {
        return null
    }
}

// 递归收集一个包及其所有传递依赖的实际路径(去重)
// 返回 [{ name, path }] 数组,path 是包根目录的绝对路径
function collectDeps(pkgName, fromDir, seen) {
    if (seen.has(pkgName)) return []
    seen.add(pkgName)
    const pkgPath = resolvePackageDir(pkgName, fromDir)
    if (!pkgPath) {
        console.warn(`[ensure-qq-music-dist] 依赖缺失: ${pkgName} (from ${fromDir})`)
        return []
    }
    const result = [{ name: pkgName, path: pkgPath }]
    try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'))
        const deps = Object.keys(pkgJson.dependencies || {})
        // 从包自身目录解析(处理嵌套),再回退到顶层(扁平化兜底)
        for (const dep of deps) {
            result.push(...collectDeps(dep, pkgPath, seen))
        }
    } catch (e) { /* 忽略读取失败 */ }
    return result
}

// 复制所有传递依赖到 destDir/libs/(用 libs 而非 node_modules,绕过 electron-builder 过滤)
// 保持每个包相对于 projectRoot/node_modules 的相对路径,以正确处理嵌套安装
function copyAllDeps() {
    const rootPkgPath = path.join(srcDir, 'package.json')
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'))
    const rootDeps = Object.keys(rootPkg.dependencies || {})
    const seen = new Set()
    const allDeps = []
    for (const dep of rootDeps) {
        allDeps.push(...collectDeps(dep, srcDir, seen))
    }
    const destLibs = path.join(destDir, 'libs')
    // 清空旧的 libs 和遗留的 node_modules(避免残留过期包)
    try { fs.rmSync(destLibs, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    try { fs.rmSync(path.join(destDir, 'node_modules'), { recursive: true, force: true }) } catch (_) { /* ignore */ }
    fs.mkdirSync(destLibs, { recursive: true })
    let copied = 0
    for (const dep of allDeps) {
        // 计算包相对 projectRoot/node_modules 的相对路径,保持嵌套结构
        const rel = path.relative(rootModules, dep.path)
        if (!rel || rel.startsWith('..')) {
            // 不在根 node_modules 下(罕见),退化为包名扁平放置
            const flat = path.join(destLibs, dep.name)
            copyDirSync(dep.path, flat)
        } else {
            const dest = path.join(destLibs, rel)
            copyDirSync(dep.path, dest)
        }
        copied++
    }
    console.log(`[ensure-qq-music-dist] 已复制 ${copied} 个依赖到 ${destLibs}`)
}

// 主流程
;(function main() {
    // 1. 若打包副本(dist + 依赖)已就绪,跳过(首次同步后后续 build 直接走这里,最快)
    if (fs.existsSync(destMarker) && fs.existsSync(destDepsMarker)) {
        console.log('[ensure-qq-music-dist] dist + 依赖均已就绪,跳过同步')
        process.exit(0)
    }
    // 2. 确保源 dist 存在
    if (!fs.existsSync(srcMarker)) {
        restoreFromTarball()
    }
    // 3. 同步 dist + package.json 到 resources/qq-music-api/
    console.log('[ensure-qq-music-dist] 同步到打包资源目录:', destDir)
    fs.mkdirSync(destDir, { recursive: true })
    copyDirSync(path.join(srcDir, 'dist'), path.join(destDir, 'dist'))
    fs.copyFileSync(path.join(srcDir, 'package.json'), path.join(destDir, 'package.json'))
    if (!fs.existsSync(destMarker)) {
        console.error('[ensure-qq-music-dist] 同步后仍找不到 app.cjs,打包必然失败')
        process.exit(1)
    }
    // 4. 复制所有运行时依赖到 resources/qq-music-api/libs/
    console.log('[ensure-qq-music-dist] 收集并复制运行时依赖...')
    copyAllDeps()
    if (!fs.existsSync(destDepsMarker)) {
        console.error('[ensure-qq-music-dist] 依赖复制后仍找不到 axios,子进程将崩溃')
        process.exit(1)
    }
    console.log('[ensure-qq-music-dist] 就绪')
})()
