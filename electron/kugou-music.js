// 酷狗概念版官方接口 IPC，所有请求由内置客户端直接签名发送。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain } from 'electron'
import { KugouClient } from './kugou-client.js'

let registered = false
export function registerKugouMusicIPC() {
    if (registered) return
    const client = new KugouClient()
    ipcMain.handle('kugou:request', async (event, payload = {}) => {
        try {
            const frame = event.senderFrame || event.sender.mainFrame
            if (frame !== event.sender.mainFrame) throw new Error('仅允许应用窗口访问酷狗音乐')
            const url = new URL(frame.url), dev = process.env.VITE_DEV_SERVER_URL && new URL(process.env.VITE_DEV_SERVER_URL)
            const trusted = url.protocol === 'file:' ? path.resolve(fileURLToPath(url)).toLowerCase() === path.join(process.env.APP_ROOT || app.getAppPath(), 'dist', 'index.html').toLowerCase()
                : !app.isPackaged && dev && url.origin === dev.origin
            if (!trusted) throw new Error('仅允许应用窗口访问酷狗音乐')
            return await client.call(payload.route, payload.params || {})
        } catch (error) { return { status:0, error_code:error.code || -1, requiresVerification:!!error.requiresVerification, error_msg:error.message || '酷狗请求失败' } }
    })
    registered = true
}
