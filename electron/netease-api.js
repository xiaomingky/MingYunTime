// 通过 spawn 启动 NeteaseCloudMusicApiEnhanced 子进程(监听 3100 端口)
// 源码来源: resources/netease-api-src/ (由 git clone 下载)
// 官方仓库: https://github.com/neteasecloudmusicapienhanced/api-enhanced
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { httpProbe, waitForPort, pipeChildLogs, broadcastServicesReady, serviceLog } from './local-service.js'
import { createServiceLifecycle } from './service-lifecycle.js'
import { apiRuntimePath } from './local-service.js'

const NETEASE_API_PORT = 3100
const NETEASE_API_BASE = `http://localhost:${NETEASE_API_PORT}`

// 获取 api-enhanced 入口路径(兼容开发态和打包态)
function resolveNeteaseAppPath() {
    const candidates = [
        // 打包态:extraResources 复制到 resources/netease-api/app.js
        path.join(process.resourcesPath || '', 'netease-api', 'app.js'),
        // 开发态优先:源码目录(有独立 node_modules)
        path.join(process.cwd(), 'resources', 'netease-api-src', 'app.js'),
        // 开发态备选:打包副本
        path.join(process.cwd(), 'resources', 'netease-api', 'app.js')
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch (e) { /* ignore */ }
    }
    return candidates[0]
}

// 打包态:libs 目录路径(绕过 electron-builder 对 node_modules 的过滤)
function resolveLibsPath() {
    const candidates = [
        path.join(process.resourcesPath || '', 'netease-api', 'libs'),
        path.join(process.cwd(), 'resources', 'netease-api', 'libs')
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch (e) { /* ignore */ }
    }
    return candidates[0]
}

const service = createServiceLifecycle({
    probe: async () => {
        const status = await httpProbe(`${NETEASE_API_BASE}/`, 1000)
        return status !== null && status < 500
    },
    launch: () => {
        const appPath = resolveNeteaseAppPath()
        if (!fs.existsSync(appPath)) throw new Error('Missing netease API entry')
        const child = spawn(process.execPath, [`--require=${apiRuntimePath()}`, appPath], {
            env: { ...process.env, PORT: String(NETEASE_API_PORT), ELECTRON_RUN_AS_NODE: '1', NODE_PATH: resolveLibsPath(), MINGYUN_API_ROOT: path.dirname(appPath), MINGYUN_API_LIBS: resolveLibsPath() },
            stdio: 'pipe', windowsHide: true, cwd: path.dirname(appPath)
        })
        pipeChildLogs(child, 'netease')
        return child
    },
    wait: signal => waitForPort(NETEASE_API_BASE, '/', { signal }),
    ready: () => broadcastServicesReady({ netease: true }),
    log: message => serviceLog('netease', message)
})

export const startNeteaseAPI = () => service.ensure()
export const stopNeteaseAPI = () => service.stop()
export const getNeteaseLocalBase = () => NETEASE_API_BASE
export const checkNeteaseLocalHealth = async () => {
    const status = await httpProbe(`${NETEASE_API_BASE}/`, 1000)
    return status !== null && status < 500
}
export const isNeteaseLocalHealthy = () => service.isHealthy()
