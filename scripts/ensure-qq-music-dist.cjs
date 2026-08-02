// 确保 QQ 音乐 API 的可执行文件在打包资源里就绪
// 问题:@sansenjian/qq-music-api 安装后 dist 目录可能缺失(缓存残缺/安装异常),
// 且 electron-builder 的 extraResources 指向 node_modules 路径会被跳过(与 asar 打包冲突)。
// 方案:把 dist + package.json 同步到项目 resources/qq-music-api/ 下,
// 由 extraResources 的 "resources/**" 通配自动带入 win-unpacked/resources/,
// 绕开 node_modules 路径冲突。子进程按 resources/qq-music-api/dist/app.cjs 启动。
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const os = require('node:os')

const PKG_VERSION = '2.4.0'
const projectRoot = path.join(__dirname, '..')
// 打包用的副本目录(被 resources/** 带入安装包)
const destDir = path.join(projectRoot, 'resources', 'qq-music-api')
const destMarker = path.join(destDir, 'dist', 'app.cjs')
// 源:npm 安装的包
const srcDir = path.join(projectRoot, 'node_modules', '@sansenjian', 'qq-music-api')
const srcMarker = path.join(srcDir, 'dist', 'app.cjs')

// 递归复制目录
function copyDirSync(from, to) {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, entry.name)
        const d = path.join(to, entry.name)
        if (entry.isDirectory()) copyDirSync(s, d)
        else fs.copyFileSync(s, d)
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

// 主流程
;(function main() {
    // 1. 若打包副本已就绪,跳过(首次同步后后续 build 直接走这里,最快)
    if (fs.existsSync(destMarker)) {
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
    console.log('[ensure-qq-music-dist] 就绪')
})()
