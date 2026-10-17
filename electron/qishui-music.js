import { ipcMain, app, safeStorage, protocol } from 'electron'
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { QishuiClient } from './qishui-client.js'
import { createQishuiRuntime } from './qishui-runtime.js'
import { QishuiPassport } from './qishui-passport.js'
import { createQishuiAudio } from './qishui-audio.js'
import { QishuiBusiness } from './qishui-business.js'
import { QishuiAccount } from './qishui-account.js'
import { transferQishuiMedia } from './qishui-transfer.js'
import { prepareQishuiDownload } from './qishui-download.js'
import { registerMusicDownloadProvider, startProviderMusicDownload } from './download-manager.js'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

let client, registered = false
export function registerQishuiMusicIPC() {
    if (registered) return
    const file = path.join(app.getPath('userData'), 'qishui-session.enc')
    const save = value => {
        if (!value) { if (fs.existsSync(file)) fs.unlinkSync(file); return }
        if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(file, safeStorage.encryptString(value))
    }
    const load = () => {
        try { return safeStorage.isEncryptionAvailable() && fs.existsSync(file) ? safeStorage.decryptString(fs.readFileSync(file)) : '' }
        catch { return '' }
    }
    const root = process.env.APP_ROOT || app.getAppPath(), request = config => axios(config)
    const runtime = createQishuiRuntime({ root, userData: app.getPath('userData'), request })
    const passport = new QishuiPassport({ request })
    const audio = createQishuiAudio({ request, runtime, ffmpeg: app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : path.join(root, 'resources', 'ffmpeg.exe') })
    client = new QishuiClient({ request, pcRequest: spec => runtime.pcRequest(spec),
        passportRequest: (id, spec) => passport.request(id, spec), passportClose: id => passport.close(id), load, save })
    registerMusicDownloadProvider('qishui', async (source, controls) => {
        const taskAudio=createQishuiAudio({ request, runtime, maxEntries:1, transfer:transferQishuiMedia })
        try { return await prepareQishuiDownload({ client, audio:taskAudio, ...controls }, source) }
        finally { taskAudio.clear() }
    }, () => createHash('sha256').update(client.cookie || '').digest('hex'))
    protocol.handle('qishui-audio', request => audio.handle(request))
    app.once('before-quit', () => { runtime.close(); audio.clear(); passport.closeAll() })
    const business = new QishuiBusiness(client)
    const account = new QishuiAccount(client)
    const handlers = {
        discover: p => client.discover(p.cursor), playlist: p => client.playlist(p.id, p.cursor),
        detail: async p => { const { url, playAuth, backupUrls, ...playback } = await client.playback(p.id); return playback },
        playback: async p => {
            const revision = client.revision, result = await audio.prepare(await client.playback(p.id, p.quality))
            if (revision !== client.revision) { audio.clear(); throw new Error('账号已切换，请重新播放') }
            return result
        }, search: p => business.search(p),
        album: p => business.album(p), artist: p => business.artist(p),
        'artist-tracks': p => business.artistTracks(p), 'artist-albums': p => business.artistAlbums(p),
        comments: p => business.comments(p), replies: p => business.replies(p),
        'comment-create': p => business.createComment(p), 'comment-delete': p => business.deleteComment(p), 'comment-like': p => business.likeComment(p),
        collections: p => business.collections(p), collect: p => business.collect(p),
        'playlist-create': p => business.createPlaylist(p), 'playlist-update': p => business.updatePlaylist(p),
        'playlist-delete': p => business.deletePlaylists(p), 'playlist-tracks': p => business.playlistTracks(p),
        user: p => business.user(p), follow: p => business.follow(p),
        recent: p => business.recent(p), 'recent-delete': p => business.deleteRecent(p),
        'vip-claim': () => business.claimFreeVip(),
        download: p => startProviderMusicDownload('qishui', { id:String(p.id), name:p.name, quality:p.quality || 'auto' }),
        'playlist-search': p => business.playlistSearch(p), share: p => business.share(p),
        'login-status': () => client.status(), 'login-cookie': async p => { const result = await client.importCookie(p.cookie); audio.clear(); return result },
        'session-info': () => ({ cookie: client.cookie || '', revision: client.revision }),
        'qr-create': () => client.qrCreate(), 'qr-check': p => client.qrCheck(p.loginId),
        'qr-cancel': p => client.qrCancel(p.loginId), logout: () => { audio.clear(); return client.logout() }, library: p => client.library(p.cursor),
        'phone-create': () => account.create(), 'phone-send-code': p => account.sendCode(p),
        'phone-login': async p => { const result = await account.login(p); if (result.status === 'confirmed') audio.clear(); return result },
        'login-cancel': p => client.qrCancel(p.loginId)
    }
    const trustedSender = event => {
        try {
            const url = new URL(event.senderFrame?.url || '')
            if (event.senderFrame !== event.sender.mainFrame) return false
            if (url.protocol === 'file:') {
                const file = path.resolve(fileURLToPath(url)).toLowerCase()
                const root = path.resolve(process.env.APP_ROOT || app.getAppPath()).toLowerCase()
                return file === path.join(root, 'dist', 'index.html')
            }
            const dev = process.env.VITE_DEV_SERVER_URL && new URL(process.env.VITE_DEV_SERVER_URL)
            return !app.isPackaged && !!dev && url.origin === dev.origin
        } catch { return false }
    }
    for (const [name, handler] of Object.entries(handlers)) ipcMain.handle('qishui:' + name, async (event, params = {}) => {
        if (!trustedSender(event)) return { code: -1, errorCode: 'untrusted_sender', message: '仅允许应用窗口访问汽水音乐' }
        try { return { code: 0, data: await handler(params) } }
        catch (e) { return { code: -1, errorCode: e.code || 'upstream_error', message: e.message || '汽水音乐请求失败', ...(Number.isFinite(e.retryAt) ? { retryAt: e.retryAt } : {}) } }
    })
    registered = true
}
