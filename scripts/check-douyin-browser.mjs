import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { extractDouyinId, extractDouyinMedia, extractDouyinPage } from '../electron/douyin-media.js'

// Exercise the actual Electron fallback with the real debugger event signature.
const source = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')
const start = source.indexOf('async function parseViaCDP(')
const end = source.indexOf('// ===== 基于 BrowserWindow', start)
const id = '7674192044255989034'
let browser, rendererReady = false, destroyed = false, networkEnabled = false, muted = false
const timers = new Set()
const payloads = {
    unrelated: { aweme_detail: { aweme_id: '1234567890123456789', video: { play_addr: { url_list: ['https://cdn.example.com/ad'] } } } },
    gallery: { aweme_detail: { aweme_id: id, desc: '目标图集', aweme_type: '68', images: [{ url_list: ['https://p.douyinpic.com/target.webp'] }] } }
}
class FakeBrowser {
    constructor() {
        browser = this
        const wc = this.webContents = new EventEmitter()
        const dbg = wc.debugger = new EventEmitter()
        let attached = false, currentURL = ''
        dbg.attach = () => { attached = true }
        dbg.detach = () => { attached = false }
        dbg.isAttached = () => attached
        dbg.sendCommand = async (method, params) => {
            if (method === 'Network.enable') {
                assert.equal(rendererReady, true, 'Electron 22 renderer must be initialized before Network.enable')
                networkEnabled = true
                return {}
            }
            assert.equal(method, 'Network.getResponseBody')
            return { body: Buffer.from(JSON.stringify(payloads[params.requestId])).toString('base64'), base64Encoded: true }
        }
        wc.setAudioMuted = value => { muted = value }
        wc.getURL = () => currentURL
        wc.executeJavaScript = async () => ({ data: '[]', html: '<html></html>' })
        wc.loadURL = async url => {
            currentURL = url
            rendererReady = true
            if (url === 'about:blank') return
            assert.equal(networkEnabled, true)
            // A newer response must not replace the earlier pending request ID.
            for (const requestId of ['gallery', 'unrelated']) dbg.emit('message', {}, 'Network.responseReceived', {
                requestId, response: { url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/' }
            })
            dbg.emit('message', {}, 'Network.loadingFinished', { requestId: 'unrelated' })
            dbg.emit('message', {}, 'Network.loadingFinished', { requestId: 'gallery' })
        }
    }
    isDestroyed() { return destroyed }
    destroy() { destroyed = true }
}
const sandbox = {
    BrowserWindow: FakeBrowser, Buffer, extractDouyinId, extractDouyinMedia, extractDouyinPage,
    DOUYIN_UA: 'test', PARSE_UA: 'test',
    setTimeout: fn => { const token = { fn }; timers.add(token); return token },
    setInterval: fn => { const token = { fn }; timers.add(token); return token },
    clearTimeout: token => timers.delete(token), clearInterval: token => timers.delete(token)
}
vm.createContext(sandbox)
vm.runInContext(source.slice(start, end), sandbox)
const result = await sandbox.parseViaCDP(`https://www.douyin.com/video/${id}`, 'douyin')
assert.equal(result.title, '目标图集')
assert.equal(result.streams[0].isImage, true)
assert.equal(result.streams[0].imageList[0], 'https://p.douyinpic.com/target.webp')
assert.equal(muted, true)
assert.equal(destroyed, true)
assert.equal(browser.webContents.debugger.isAttached(), false)
assert.equal(timers.size, 0, 'all parser timers must be released')
console.log('Electron browser initialization, debugger events, concurrent requests, target filtering and cleanup passed.')
