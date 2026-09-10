// electron/local-service.js
// 本地 API 子进程通用工具（Node 16 兼容）
// Electron 22 内置 Node 16.17：没有全局 fetch（Node 18+ 才有）、没有 AbortSignal.timeout（Node 17.3+ 才有）。
// kugou/netease 旧实现每次探测都抛 ReferenceError/TypeError → 健康状态被吞错判死、服务永远显示"宕机"。
// 这里统一用 axios（项目已依赖，timeout 参数 Node 12+ 即支持），并补齐：等待端口就绪、子进程日志落盘、就绪广播。
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

// —— 端口探测（Node16 兼容版 fetch）——
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
// 解决启动竞态：Win7 老机器冷启动子进程可能 3~10 秒，渲染进程 3 秒一次性探测必然判死。
// 主进程先把服务"等起来"再广播，渲染进程就不会再踩到未就绪窗口。
export async function waitForPort(base, probePath = '/search/hot', { timeoutMs = 25000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await httpProbe(base + probePath, 1500)
    if (status !== null && status < 500) return true
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

// —— 子进程日志落盘（userData/logs/local-api-<name>.log，超过 1MB 截断保留尾部 512KB）——
// 此前子进程 stdout/stderr 全部丢弃，崩溃原因不可见；落盘后 Win7 上宕机的真因可从日志直接定位。
function logFilePath(name) {
  const dir = path.join(app.getPath('userData'), 'logs')
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
  return path.join(dir, `local-api-${name}.log`)
}
export function serviceLog(name, line) {
  try {
    const file = logFilePath(name)
    if (!line) return
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${String(line).trimEnd()}\n`)
    const st = fs.statSync(file)
    if (st.size > 1024 * 1024) {
      const data = fs.readFileSync(file)
      fs.writeFileSync(file, data.slice(Math.max(0, data.length - 512 * 1024)))
    }
  } catch (e) {}
}

// 把子进程 stdout/stderr 接到日志（不再丢弃）
export function pipeChildLogs(child, name) {
  child.stdout?.on('data', (d) => serviceLog(name, d.toString()))
  child.stderr?.on('data', (d) => serviceLog(name, d.toString()))
}

// —— 服务就绪广播（渲染进程收到后把线路切回本地）——
export function broadcastServicesReady(states) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('local-services-ready', states)
    }
  } catch (e) {}
}