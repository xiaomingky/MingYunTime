// 酷狗音乐 API 子进程管理
// 通过 spawn 启动 KuGouMusicApi 子进程(监听 3300 端口)
// KuGouMusicApi 兼容 Node 12+,Electron 22 内置 Node 16 完全兼容,无需 polyfill
// 环境变量 platform=lite 在 .env 文件中配置,确保使用概念版平台
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
// Node16 兼容探测/就绪等待/日志/广播（Electron 22 内置 Node 无 fetch/AbortSignal.timeout）
import { httpProbe, waitForPort, pipeChildLogs, broadcastServicesReady, serviceLog } from './local-service.js'

let kugouProcess = null
let healthCheckTimer = null
let isHealthy = false

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

// 启动酷狗音乐 API 子进程
// 异步启动：先探测端口（已运行则直接复用），否则 spawn 并等待端口就绪后广播 ready。
// 等待就绪解决启动竞态：渲染进程 3 秒判死切在线的老逻辑，在服务就绪后即失效。
export function startKugouMusicAPI() {
    if (kugouProcess) return
    bootKugou()
}

async function bootKugou() {
    try {
        const status = await httpProbe(`${KUGOU_API_BASE}/search/hot`, 2000)
        if (status !== null && status < 500) {
            // 端口 3300 已有服务在跑(应用重复启动/上次残留进程),直接复用,不启动子进程
            isHealthy = true
            startHealthCheck()
            serviceLog('kugou', '端口 3300 已有服务在跑,直接复用')
            broadcastServicesReady({ kugou: true })
            return
        }
    } catch (e) {
        // 端口未占用,正常启动子进程
    }
    _spawnKugouProcess()
}

// 健康检查:每 15 秒检测一次服务是否可用（Node16 兼容探测）
function startHealthCheck() {
    if (healthCheckTimer) clearInterval(healthCheckTimer)
    healthCheckTimer = setInterval(async () => {
        try {
            const status = await httpProbe(`${KUGOU_API_BASE}/search/hot`, 3000)
            isHealthy = status !== null && status < 500
        } catch (e) {
            isHealthy = false
        }
    }, 15000)
}

// 实际启动酷狗 API 子进程
function _spawnKugouProcess() {
    if (kugouProcess) return
    const appPath = resolveKugouAppPath()
    try {
        if (!fs.existsSync(appPath)) {
            serviceLog('kugou', '入口不存在: ' + appPath)
            return
        }
    } catch (e) {
        return
    }

    // 用 Electron 内置 Node(process.execPath)+ ELECTRON_RUN_AS_NODE 启动子进程
    // KuGouMusicApi 兼容 Node 12+,Electron 22 内置 Node 16 完全兼容
    const nodeBin = process.execPath
    const env = {
        ...process.env,
        PORT: String(KUGOU_API_PORT),
        ELECTRON_RUN_AS_NODE: '1'
    }

    // 打包态:设置 NODE_PATH 指向 libs 目录(绕过 electron-builder 对 node_modules 的过滤)
    const libsPath = resolveLibsPath()
    try {
        if (fs.existsSync(libsPath)) {
            env.NODE_PATH = libsPath
        }
    } catch (e) { /* ignore */ }

    serviceLog('kugou', `启动子进程: ${appPath}`)
    kugouProcess = spawn(nodeBin, [appPath], {
        env,
        stdio: 'pipe',
        windowsHide: true,
        cwd: path.dirname(appPath)  // 确保能读到 .env 文件
    })

    // 子进程输出落盘到 userData/logs/local-api-kugou.log（崩溃根因可查）
    pipeChildLogs(kugouProcess, 'kugou')

    kugouProcess.on('exit', (code) => {
        serviceLog('kugou', `子进程退出 code=${code}`)
        kugouProcess = null
        isHealthy = false
        // 异常退出自动重启(10 秒后,比 QQ 的 5 秒慢,避免端口冲突)
        if (code !== 0 && code !== null) {
            setTimeout(() => startKugouMusicAPI(), 10000)
        }
    })
    kugouProcess.on('error', (err) => {
        serviceLog('kugou', 'spawn error: ' + (err?.message || err))
        kugouProcess = null
        isHealthy = false
    })

    // 等待端口就绪：就绪后广播给渲染进程（切回本地线路）
    waitForPort(KUGOU_API_BASE, '/search/hot', { timeoutMs: 25000 }).then((ok) => {
        isHealthy = ok
        serviceLog('kugou', ok ? '服务已就绪 localhost:3300' : '25s 内未就绪,子进程可能启动失败(查看上方日志)')
        if (ok) broadcastServicesReady({ kugou: true })
    }).catch(() => {})
    startHealthCheck()
}

// 停止子进程
export function stopKugouMusicAPI() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer)
        healthCheckTimer = null
    }
    if (kugouProcess) {
        try { kugouProcess.kill() } catch (e) { /* ignore */ }
        kugouProcess = null
    }
    isHealthy = false
}

// 获取本地 API 基地址(供前端使用)
export function getKugouLocalBase() {
    return KUGOU_API_BASE
}

// 检查本地服务是否健康
export async function checkKugouLocalHealth() {
    const status = await httpProbe(`${KUGOU_API_BASE}/search/hot`, 3000)
    isHealthy = status !== null && status < 500
    return isHealthy
}

// 同步获取健康状态(基于上次检查结果)
export function isKugouLocalHealthy() {
    return isHealthy
}
