// 通过 spawn 启动 NeteaseCloudMusicApiEnhanced 子进程(监听 3100 端口)
// 源码来源: resources/netease-api-src/ (由 git clone 下载)
// 官方仓库: https://github.com/neteasecloudmusicapienhanced/api-enhanced
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

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

    // 端口探测：若 3100 已有服务在跑(应用重复启动/上次残留进程),直接复用,不启动子进程
    const probeAndStart = async () => {
        try {
            const res = await fetch(`${NETEASE_API_BASE}/search/hot`, {
                signal: AbortSignal.timeout(2000)
            })
            if (res.ok) {
                isHealthy = true
                // 端口 3100 已有服务在跑,直接复用(跳过子进程启动)
                if (healthCheckTimer) clearInterval(healthCheckTimer)
                healthCheckTimer = setInterval(async () => {
                    try {
                        const r = await fetch(`${NETEASE_API_BASE}/search/hot`, {
                            signal: AbortSignal.timeout(3000)
                        })
                        isHealthy = r.ok
                    } catch (e) {
                        isHealthy = false
                    }
                }, 15000)
                return
            }
        } catch (e) {
            // 端口未占用,正常启动子进程
        }
        _spawnNeteaseProcess()
    }
    probeAndStart()
}

// 实际启动网易云 API 子进程
function _spawnNeteaseProcess() {
    if (neteaseProcess) return
    const appPath = resolveNeteaseAppPath()
    try {
        if (!fs.existsSync(appPath)) return
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

    neteaseProcess = spawn(nodeBin, [appPath], {
        env,
        stdio: 'pipe',
        windowsHide: true,
        cwd: path.dirname(appPath)
    })

    // 不再转发子进程 stdout/stderr 到终端(避免大量日志刷屏)
    // 子进程输出会被丢弃,仅保留退出码用于崩溃自动重启
    neteaseProcess.stdout?.on('data', () => {})
    neteaseProcess.stderr?.on('data', () => {})
    neteaseProcess.on('exit', (code) => {
        neteaseProcess = null
        isHealthy = false
        // 异常退出自动重启(12 秒后,错开其他 API 重启时间避免端口冲突)
        if (code !== 0 && code !== null) {
            setTimeout(() => startNeteaseAPI(), 12000)
        }
    })
    neteaseProcess.on('error', () => {
        neteaseProcess = null
        isHealthy = false
    })

    // 健康检查:每 15 秒检测一次服务是否可用
    if (healthCheckTimer) clearInterval(healthCheckTimer)
    healthCheckTimer = setInterval(async () => {
        try {
            const res = await fetch(`${NETEASE_API_BASE}/search/hot`, {
                signal: AbortSignal.timeout(3000)
            })
            isHealthy = res.ok
        } catch (e) {
            isHealthy = false
        }
    }, 15000)
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
    try {
        const res = await fetch(`${NETEASE_API_BASE}/search/hot`, {
            signal: AbortSignal.timeout(3000)
        })
        isHealthy = res.ok
        return isHealthy
    } catch (e) {
        isHealthy = false
        return false
    }
}

// 同步获取健康状态(基于上次检查结果)
export function isNeteaseLocalHealthy() {
    return isHealthy
}
