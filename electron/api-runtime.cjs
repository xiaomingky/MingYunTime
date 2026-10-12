// Packaged backend dependencies live in libs, including nested versions.
// Prefer the backend's own dependencies over the desktop app's node_modules.
const Module = require('node:module')
const path = require('node:path')
const root = process.env.MINGYUN_API_ROOT && path.resolve(process.env.MINGYUN_API_ROOT)
const libs = process.env.MINGYUN_API_LIBS
if (root && libs) {
    const original = Module._nodeModulePaths
    const within = value => {
        const relative = path.relative(root, value)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    }
    Module._nodeModulePaths = function (from) {
        const paths = original.call(this, from)
        if (!within(from)) return paths
        const local = paths.filter(within).flatMap(value => [value, value.replace(/node_modules/g, 'libs')])
        return [...new Set([...local, libs, ...paths.filter(value => !within(value))])]
    }
}
