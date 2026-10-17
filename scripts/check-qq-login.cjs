// Official login UI only: isolated cookies, no mobile confirmation or credentials.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve('dev/qq-login')
fs.mkdirSync(root, { recursive: true })
app.setPath('userData', path.join(root, 'profile'))
const report = { errors: [], checks: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function captureLogin(file) {
    // QR image decoding precedes the window's first compositor frame on Windows.
    login.showInactive()
    await delay(350)
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const png = await login.webContents.capturePage(undefined, { stayAwake: true })
            assert.ok(!png.isEmpty(), 'official login capture contains rendered pixels')
            fs.writeFileSync(path.join(root, file), png.toPNG())
            return
        } catch (error) {
            if (!/UnknownVizError/.test(error.message) || attempt === 3) throw error
            await delay(500)
        }
    }
}
let main, login, done = false
function finish(error) {
    if (done) return
    done = true
    if (error) report.errors.push(error.stack || String(error))
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    for (const win of BrowserWindow.getAllWindows()) win.destroy()
    app.exit(report.errors.length ? 1 : 0)
}
async function inspect() {
    if (!login || login.isDestroyed()) return []
    try {
        const frames = [login.webContents.mainFrame, ...login.webContents.mainFrame.framesInSubtree]
        const results = []
        for (const frame of [...new Set(frames)]) {
            try { results.push(await frame.executeJavaScript(`(()=>({url:location.origin+location.pathname,text:document.body?.innerText.slice(0,900),images:[...document.images].filter(i=>i.naturalWidth>0&&i.getClientRects().length).map(i=>({id:i.id,cls:i.className,w:i.naturalWidth,h:i.naturalHeight})),canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,w:c.width,h:c.height}))}))()`, true)) } catch {}
        }
        return results
    } catch (error) { return [{ error: error.message, url: login.webContents.getURL() }] }
}
async function run() {
    const handler = ipcMain._invokeHandlers.get('qq:web-login')
    assert.ok(handler, 'QQ official login handler exists')
    const result = handler({ sender: main.webContents })
    const deadline = Date.now() + 35000
    let frames = []
    while (Date.now() < deadline) {
        login ||= BrowserWindow.getAllWindows().find(win => win !== main && !win.isDestroyed())
        if (login && !login.isDestroyed()) {
            frames = await inspect()
            if (frames.some(f => /ptlogin2|qq\.com/.test(f.url) && (f.images.some(i => /qr/i.test(i.id) && i.w >= 100) || f.canvases.some(c => /qr/i.test(c.id) && c.w >= 100)))) break
        }
        await delay(300)
    }
    report.frames = frames
    if (login && !login.isDestroyed()) await captureLogin('login.png')
    const qr = frames.some(f => /ptlogin2|qq\.com/.test(f.url) && (f.images.some(i => /qr/i.test(i.id) && i.w >= 100) || f.canvases.some(c => /qr/i.test(c.id) && c.w >= 100)))
    if (!qr) throw new Error('official QQ login QR image did not decode: ' + JSON.stringify(frames))
    report.checks.push('official QQ QR loaded and decoded in isolated sandboxed login window')
    await login.webContents.executeJavaScript(`(()=>{const control=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='微信登录'&&e.getClientRects().length);if(!control)throw new Error('missing official WeChat tab');control.click()})()`, true)
    let wechat = false
    const switchDeadline = Date.now() + 18000
    while (Date.now() < switchDeadline) {
        frames = await inspect()
        wechat = frames.some(f => /open.weixin.qq.com/.test(f.url) && f.images?.some(i => /qr/i.test(i.id+' '+i.cls) && i.w >= 100))
        if (wechat) break
        await delay(300)
    }
    assert.ok(wechat, 'official WeChat QR decodes after switching login mode')
    await captureLogin('wechat.png')
    report.checks.push('official QQ to WeChat mode switch loads a real decoded WeChat QR')
    const restore = ipcMain._invokeHandlers.get('qq:restore-session')
    assert.equal((await restore({ sender: login.webContents })).code, -1)
    const activity=ipcMain._invokeHandlers.get('qq:benefits-open')
    assert.equal((await activity({sender:login.webContents},{target:'web',uin:'123'})).code,-1)
    assert.equal((await activity({sender:main.webContents},{target:'arbitrary-url'})).code,-1)
    report.checks.push('remote official login window cannot read encrypted application credentials')
    const duplicate = await handler({ sender: main.webContents })
    assert.equal(duplicate.success, false)
    assert.match(duplicate.message, /已打开/)
    report.checks.push('repeated login reuses the existing window')
    login.close()
    const cancelled = await result
    assert.equal(cancelled.success, false)
    assert.match(cancelled.message, /关闭/)
    report.checks.push('closing official login settles IPC as cancellation, without accepting a guest account')
    assert.equal((await restore({ sender: main.webContents })).data.cookie, '')
    report.checks.push('an unconfirmed QR never creates a saved login session')
    assert.equal((await handler({sender:main.webContents},{mode:'unknown'})).success,false)
    report.checks.push('unknown official mode rejected before opening a window')
    for(const mode of ['wechat','password']) {
        login=null
        const pending=handler({sender:main.webContents},{mode})
        const end=Date.now()+25000
        let ready=false
        while(Date.now()<end) {
            login ||= BrowserWindow.getAllWindows().find(win=>win!==main&&!win.isDestroyed())
            if(login&&!login.isDestroyed()) {
                if(mode==='wechat') {
                    const seen=await inspect()
                    ready=seen.some(f=>/open.weixin.qq.com/.test(f.url)&&f.images?.some(i=>/qr/i.test(i.id+' '+i.cls)&&i.w>=100))
                } else {
                    for(const frame of login.webContents.mainFrame.framesInSubtree) {
                        if(!/^https:\/\/xui\.ptlogin2\.qq\.com\//.test(frame.url))continue
                        ready=await frame.executeJavaScript("[...document.querySelectorAll('input[type=password]')].some(e=>e.getClientRects().length)",true)
                        if(ready)break
                    }
                }
            }
            if(ready)break
            await delay(250)
        }
        assert.ok(ready,`official ${mode} opens directly in requested mode`)
        assert.equal((await handler({sender:login.webContents},{mode:'qq'})).success,false,'remote login page cannot open application login')
        await captureLogin(mode+'-direct.png')
        login.close();assert.equal((await pending).success,false)
        report.checks.push(`direct official ${mode} mode rendered, isolated, and cancelled without saving credentials`)
    }
}
app.on('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false)
    win.setFocusable(false); win.setIgnoreMouseEvents(true)
    const prefs = win.webContents.getLastWebPreferences()
    if (prefs.partition === 'qq-login') {
        login = win
        return
    }
    if (!main) {
        main = win
        win.webContents.once('did-finish-load', () => run().then(() => finish(), finish))
    }
})
setTimeout(() => finish(new Error('QQ login UI test timed out')), 120000).unref()
require('../dist-electron/main.js')
