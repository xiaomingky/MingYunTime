// 酷狗音乐 API 子进程管理
// 通过 spawn 启动 KuGouMusicApi 子进程(监听 3300 端口)
// 环境变量 platform=lite 在 .env 文件中配置,确保使用概念版平台
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { httpProbe, waitForPort, pipeChildLogs, broadcastServicesReady, serviceLog } from './local-service.js'
import { createServiceLifecycle } from './service-lifecycle.js'
import { apiRuntimePath } from './local-service.js'

const KUGOU_API_PORT = 3300
const KUGOU_API_BASE = `http://localhost:${KUGOU_API_PORT}`

// 获取 KuGouMusicApi 入口路径(兼容开发态和打包态)
function resolveKugouAppPath() {
    const candidates = [
        // 打包态:extraResources 复制到 resources/kugou-music-api/app.js
        path.join(process.resourcesPath || '', 'kugou-music-api', 'app.js'),
        // 开发态优先:源码目录(有独立 node_modules,依赖版本正确)
        // 必须排在 kugou-music-api 之前,否则会用到打包副本(其 libs 目录的依赖
        // 会被项目根 node_modules 的新版包覆盖,如 path-to-regexp 8.x 与 express 4.x 冲突)
        path.join(process.cwd(), 'resources', 'kugou-music-api-src', 'app.js'),
        // 开发态备选:打包副本(仅在 src 不存在时使用)
        path.join(process.cwd(), 'resources', 'kugou-music-api', 'app.js')
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch (e) { /* ignore */ }
    }
    return candidates[0]
}

// 获取 libs 目录路径(打包态用 NODE_PATH 指向它)
function resolveLibsPath() {
    const appPath = resolveKugouAppPath()
    const appDir = path.dirname(appPath)
    // 打包态:libs 目录(原 node_modules,重命名以绕过 electron-builder 过滤)
    const libsPath = path.join(appDir, 'libs')
    try {
        if (fs.existsSync(libsPath)) return libsPath
    } catch (e) { /* ignore */ }
    // 开发态:src 目录下的 node_modules(依赖版本正确)
    const nodeModulesPath = path.join(appDir, 'node_modules')
    try {
        if (fs.existsSync(nodeModulesPath)) return nodeModulesPath
    } catch (e) { /* ignore */ }
    return libsPath
}

const service = createServiceLifecycle({
    probe: async () => {
        const status = await httpProbe(`${KUGOU_API_BASE}/`, 1000)
        return status !== null && status < 500
    },
    launch: () => {
        const appPath = resolveKugouAppPath()
        if (!fs.existsSync(appPath)) throw new Error('Missing kugou API entry')
        const child = spawn(process.execPath, [`--require=${apiRuntimePath()}`, appPath], {
            env: { ...process.env, PORT: String(KUGOU_API_PORT), ELECTRON_RUN_AS_NODE: '1', NODE_PATH: resolveLibsPath(), MINGYUN_API_ROOT: path.dirname(appPath), MINGYUN_API_LIBS: resolveLibsPath() },
            stdio: 'pipe', windowsHide: true, cwd: path.dirname(appPath)
        })
        pipeChildLogs(child, 'kugou')
        return child
    },
    wait: signal => waitForPort(KUGOU_API_BASE, '/', { signal }),
    ready: () => broadcastServicesReady({ kugou: true }),
    log: message => serviceLog('kugou', message)
})

export const startKugouMusicAPI = () => service.ensure()
export const stopKugouMusicAPI = () => service.stop()
export const getKugouLocalBase = () => KUGOU_API_BASE
export const checkKugouLocalHealth = async () => {
    const status = await httpProbe(`${KUGOU_API_BASE}/`, 1000)
    return status !== null && status < 500
}
export const isKugouLocalHealthy = () => service.isHealthy()
