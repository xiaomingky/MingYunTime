// 通过 spawn 启动 NeteaseCloudMusicApiEnhanced 子进程(监听 3100 端口)
// 源码来源: resources/netease-api-src/ (由 git clone 下载)
// 官方仓库: https://github.com/neteasecloudmusicapienhanced/api-enhanced
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
// Node16 兼容探测/就绪等待/日志/广播（Electron 22 内置 Node 无 fetch/AbortSignal.timeout）
import { httpProbe, waitForPort, pipeChildLogs, broadcastServicesReady, serviceLog } from './local-service.js'

let neteaseProcess = null
let healthCheckTimer = null
let isHealthy = false

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

export function startNeteaseAPI() {
    if (neteaseProcess) return
    bootNetease()
}

async function bootNetease() {
    try {
        const status = await httpProbe(`${NETEASE_API_BASE}/search/hot`, 2000)
        if (status !== null && status < 500) {
            // 端口 3100 已有服务在跑(应用重复启动/上次残留进程),直接复用,不启动子进程
            isHealthy = true
            startHealthCheck()
            serviceLog('netease', '端口 3100 已有服务在跑,直接复用')
            broadcastServicesReady({ netease: true })
            return
        }
    } catch (e) {
        // 端口未占用,正常启动子进程
    }
    _spawnNeteaseProcess()
}

// 健康检查:每 15 秒检测一次服务是否可用（Node16 兼容探测）
function startHealthCheck() {
    if (healthCheckTimer) clearInterval(healthCheckTimer)
    healthCheckTimer = setInterval(async () => {
        try {
            const status = await httpProbe(`${NETEASE_API_BASE}/search/hot`, 3000)
            isHealthy = status !== null && status < 500
        } catch (e) {
            isHealthy = false
        }
    }, 15000)
}

// 实际启动网易云 API 子进程
function _spawnNeteaseProcess() {
    if (neteaseProcess) return
    const appPath = resolveNeteaseAppPath()
    try {
        if (!fs.existsSync(appPath)) {
            serviceLog('netease', '入口不存在: ' + appPath)
            return
        }
    } catch (e) {
        return
    }

    // 用 Electron 内置 Node(process.execPath)+ ELECTRON_RUN_AS_NODE 启动子进程
    const nodeBin = process.execPath
    const env = {
        ...process.env,
        PORT: String(NETEASE_API_PORT),
        ELECTRON_RUN_AS_NODE: '1'
    }

    // 打包态:设置 NODE_PATH 指向 libs 目录
    const libsPath = resolveLibsPath()
    try {
        if (fs.existsSync(libsPath)) {
            env.NODE_PATH = libsPath
        }
    } catch (e) { /* ignore */ }

    serviceLog('netease', `启动子进程: ${appPath}`)
    neteaseProcess = spawn(nodeBin, [appPath], {
        env,
        stdio: 'pipe',
        windowsHide: true,
        cwd: path.dirname(appPath)
    })

    // 子进程输出落盘到 userData/logs/local-api-netease.log（崩溃根因可查）
    pipeChildLogs(neteaseProcess, 'netease')

    neteaseProcess.on('exit', (code) => {
        serviceLog('netease', `子进程退出 code=${code}`)
        neteaseProcess = null
        isHealthy = false
        // 异常退出自动重启(12 秒后,错开其他 API 重启时间避免端口冲突)
        if (code !== 0 && code !== null) {
            setTimeout(() => startNeteaseAPI(), 12000)
        }
    })
    neteaseProcess.on('error', (err) => {
        serviceLog('netease', 'spawn error: ' + (err?.message || err))
        neteaseProcess = null
        isHealthy = false
    })

    // 等待端口就绪：就绪后广播给渲染进程（切回本地线路）
    waitForPort(NETEASE_API_BASE, '/search/hot', { timeoutMs: 25000 }).then((ok) => {
        isHealthy = ok
        serviceLog('netease', ok ? '服务已就绪 localhost:3100' : '25s 内未就绪,子进程可能启动失败(查看上方日志)')
        if (ok) broadcastServicesReady({ netease: true })
    }).catch(() => {})
    startHealthCheck()
}

// 停止子进程
export function stopNeteaseAPI() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer)
        healthCheckTimer = null
    }
    if (neteaseProcess) {
        try { neteaseProcess.kill() } catch (e) { /* ignore */ }
        neteaseProcess = null
    }
    isHealthy = false
}

// 获取本地 API 基地址(供前端使用)
export function getNeteaseLocalBase() {
    return NETEASE_API_BASE
}

// 检查本地服务是否健康
export async function checkNeteaseLocalHealth() {
    const status = await httpProbe(`${NETEASE_API_BASE}/search/hot`, 3000)
    isHealthy = status !== null && status < 500
    return isHealthy
}

// 同步获取健康状态(基于上次检查结果)
export function isNeteaseLocalHealthy() {
    return isHealthy
}
