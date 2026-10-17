import { ipcMain, app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NeteaseClient } from './netease-client.js'
let registered = false
export function registerNeteaseMusicIPC() {
    if (registered) return
    const client = new NeteaseClient()
    ipcMain.handle('netease:request', async (event, payload = {}) => {
        try {
            const frame = event.senderFrame || event.sender?.mainFrame
            if (frame !== event.sender.mainFrame) throw new Error('仅允许应用窗口访问网易云音乐')
            const url = new URL(frame.url), dev = process.env.VITE_DEV_SERVER_URL && new URL(process.env.VITE_DEV_SERVER_URL)
            const trusted = url.protocol === 'file:' ? path.resolve(fileURLToPath(url)).toLowerCase() === path.join(process.env.APP_ROOT || app.getAppPath(), 'dist', 'index.html').toLowerCase()
                : !app.isPackaged && dev && url.origin === dev.origin
            if (!trusted) throw new Error('仅允许应用窗口访问网易云音乐')
            if (!client.supports(payload.route)) throw new Error('该网易云操作尚未独立接入')
            return await client.call(payload.route, payload.params || {}, String(payload.cookie || ''))
        } catch (error) { return { code: -1, message: error.message || '网易云请求失败' } }
    })
    registered = true
}
