// Local backend readiness and bounded, asynchronous logging.
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

// Readiness probes stay local; never use upstream search to check process health.
// 返回 HTTP 状态码（200/404…），连不上/超时返回 null。
// 判定"服务活着"用 <500：4xx 说明 HTTP 层已响应（说明服务进程活着），只有连不上/超时才是真宕机。
export async function httpProbe(url, timeoutMs = 2500) {
  try {
    const res = await axios.get(url, { timeout: timeoutMs, validateStatus: () => true })
    return res.status
  } catch (e) {
    return null
  }
}

// —— 等待端口就绪（spawn 后轮询，直到能拿到 2xx/4xx 响应）——
// Await cold starts instead of racing the first renderer request.
// 主进程先把服务"等起来"再广播，渲染进程就不会再踩到未就绪窗口。
export async function waitForPort(base, probePath = '/', { timeoutMs = 25000, intervalMs = 250, signal } = {}) {
  const deadline = Date.now() + timeoutMs
  while (!signal?.aborted && Date.now() < deadline) {
    const status = await httpProbe(base + probePath, 1500)
    if (status !== null && status < 500) return true
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

const logQueues = new Map()
export function serviceLog(name, line) {
    let queue = logQueues.get(name)
    if (!queue) { queue = { data: '', pending: false }; logQueues.set(name, queue) }
    if (line) queue.data = (queue.data + `[${new Date().toISOString()}] ${String(line).trimEnd()}\n`).slice(-128 * 1024)
    if (queue.pending) return
    queue.pending = true
    setTimeout(async () => {
        const data = queue.data
        queue.data = ''
        const dir = path.join(app.getPath('userData'), 'logs')
        const file = path.join(dir, `local-api-${name}.log`)
        try {
            await fs.promises.mkdir(dir, { recursive: true })
            await fs.promises.appendFile(file, data)
            if ((await fs.promises.stat(file)).size > 1024 * 1024) {
                const contents = await fs.promises.readFile(file)
                await fs.promises.writeFile(file, contents.subarray(-512 * 1024))
            }
        } catch {}
        queue.pending = false
        if (queue.data) serviceLog(name, '')
    }, 250).unref()
}

// 把子进程 stdout/stderr 接到日志（不再丢弃）
export function pipeChildLogs(child, name) {
  child.stdout?.on('data', (d) => serviceLog(name, d.toString()))
  child.stderr?.on('data', (d) => serviceLog(name, d.toString()))
}

// Notify interested windows without overriding their selected online API line.
export function broadcastServicesReady(states) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('local-services-ready', states)
    }
  } catch (e) {}
}
export function apiRuntimePath() {
    const packed = path.join(process.resourcesPath, 'api-runtime.cjs')
    return fs.existsSync(packed) ? packed : path.join(process.env.APP_ROOT || process.cwd(), 'electron', 'api-runtime.cjs')
}
