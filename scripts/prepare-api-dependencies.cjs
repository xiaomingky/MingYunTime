// electron-builder excludes node_modules from extraResources. Keep nested
// dependency versions by naming their directories libs; api-runtime resolves them.
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const root = path.resolve(__dirname, '../resources')
function prepare(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        let child = path.join(dir, entry.name)
        if (entry.name === 'node_modules') {
            const destination = path.join(dir, 'libs')
            if (fs.existsSync(destination)) throw new Error(`Duplicate dependency directories: ${dir}`)
            const relative = path.relative(root, child)
            if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency path escaped resources')
            fs.renameSync(child, destination)
            child = destination
        }
        prepare(child)
    }
}
// Older copies omitted nested node_modules. Restore only those dependency
// directories from their independently installed source before normalizing.
function restoreNested(source, destination) {
    if (!fs.existsSync(source)) return
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const from = path.join(source, entry.name)
        const to = path.join(destination, entry.name === 'node_modules' ? 'libs' : entry.name)
        if (entry.name === 'node_modules') {
            if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true, dereference: true })
        } else if (fs.existsSync(to)) restoreNested(from, to)
    }
}
restoreNested(path.join(root, 'kugou-music-api-src', 'node_modules'), path.join(root, 'kugou-music-api', 'libs'))
const neteaseRoot = path.join(root, 'netease-api')
const neteaseLibs = path.join(neteaseRoot, 'libs')
const installedLock = path.join(neteaseLibs, '.package-lock.json')
if (fs.existsSync(installedLock)) {
    const installed = JSON.parse(fs.readFileSync(installedLock, 'utf8'))
    const incomplete = Object.keys(installed.packages || {}).some(name => {
        if (!name.startsWith('node_modules/') || name.split('node_modules').length < 3) return false
        const relative = name.slice('node_modules/'.length).replaceAll('node_modules', 'libs')
        return !fs.existsSync(path.join(neteaseLibs, relative, 'package.json'))
    })
    if (incomplete) {
        // Fresh clones omit ignored generated nested dependencies. Install a
        // separate staging tree and restore nested packages before packaging.
        const staging = path.join(root, '.netease-build-dependencies')
        fs.mkdirSync(staging, { recursive: true })
        fs.copyFileSync(path.join(neteaseRoot, 'package.json'), path.join(staging, 'package.json'))
        execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: staging, stdio: 'inherit' })
        restoreNested(path.join(staging, 'node_modules'), neteaseLibs)
    }
}
const neteaseModules = path.join(root, 'netease-api-src', 'node_modules')
if (fs.existsSync(neteaseModules) && !fs.existsSync(path.join(neteaseModules, '.pnpm'))) {
    restoreNested(neteaseModules, path.join(root, 'netease-api', 'libs'))
}

for (const name of ['netease-api', 'qq-music-api', 'kugou-music-api']) {
    const dir = path.join(root, name, 'libs')
    if (!fs.existsSync(dir)) throw new Error(`Backend dependencies missing: ${name}`)
    prepare(dir)
}
console.log('Backend dependency directories prepared')
