const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve('dev/netease-electron')
fs.mkdirSync(root, { recursive: true }); app.setPath('userData', path.join(root, 'profile'))
const report = { errors: [], checks: [], requests: [] }, delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let main, finished = false
const js = code => main.webContents.executeJavaScript(code, true)
function finish(error) {
    if (finished) return; finished = true
    if (error) report.errors.push(error.stack || String(error))
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
    for (const win of BrowserWindow.getAllWindows()) win.destroy()
    app.exit(report.errors.length ? 1 : 0)
}
async function until(expression, label, timeout = 20000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await js(expression)) return; await delay(150) }
    throw new Error(label + ': ' + await js("document.body.innerText.slice(-1200)"))
}
async function screenshot(name) { fs.writeFileSync(path.join(root, name + '.png'), (await main.webContents.capturePage()).toPNG()) }
async function run() {
    const native = ipcMain._invokeHandlers.get('netease:request'); assert.ok(native)
    ipcMain.removeHandler('netease:request')
    ipcMain.handle('netease:request', async (event, payload) => {
        const result = await native(event, payload)
        report.requests.push({ route: payload.route, code: result.code })
        return result
    })
    await js(`window.pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      window.router=document.querySelector('#app').__vue_app__.config.globalProperties.$router;window.player=pinia._s.get('player');player.autoFetchLyric=false;
      localStorage.setItem('current_platform','netease');localStorage.setItem('api_line','main');localStorage.removeItem('music_cookie');pinia._s.get('platform').syncFromStorage();router.push('/search?keywords=陈粒')`)
    await until("document.querySelectorAll('.search-view .track-row').length===30", 'real NetEase song search has thirty songs')
    const first = await js("document.querySelector('.search-view .title-cell').textContent")
    await js("[...document.querySelectorAll('.search-pagination button')].find(b=>b.textContent==='下一页').click()")
    await until("document.querySelector('.search-pagination')?.textContent.includes('第 2 页') && document.querySelectorAll('.search-view .track-row').length===30", 'search second page')
    assert.notEqual(await js("document.querySelector('.search-view .title-cell').textContent"), first)
    await screenshot('search-page-2'); report.checks.push('independent song search and distinct thirty-song second page')
    for (const [label, selector] of [['专辑','.playlist-card'],['歌手','.artist-card'],['歌单','.playlist-card']]) {
        await js(`[...document.querySelectorAll('.search-view .tab')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`)
        await until(`document.querySelectorAll('.search-view ${selector}').length>0 && !document.querySelector('.search-view [role=alert]')`, 'real search category ' + label)
        assert.ok(await js("document.querySelector('.search-view').textContent.includes('陈粒')"))
    }
    report.checks.push('real album, artist and playlist search categories')
    await js("router.push('/album/34780579')")
    await until("document.querySelectorAll('.album-detail-view .track-item').length===10", 'real ten-song album')
    await until("document.querySelector('.album-cover img')?.naturalWidth>0", 'real album cover decodes')
    await screenshot('album'); report.checks.push('real album metadata, ten normalized tracks and decoded cover')
    await js("router.push('/playlist/3778678')")
    await until("document.querySelectorAll('.track-list-container .track-row').length===100", 'playlist first hundred songs')
    await js("[...document.querySelectorAll('.playlist-load-status button')].find(e=>e.textContent.includes('更多')).click()")
    await until("document.querySelectorAll('.track-list-container .track-row').length===200", 'playlist all two hundred songs')
    assert.ok(await js("![...document.querySelectorAll('.playlist-load-status button')].some(e=>e.textContent.includes('更多'))"))
    await screenshot('playlist'); report.checks.push('all two hundred real rank playlist songs loaded with exact continuation and stopping')
    await js(`(async()=>{const result=await bridge.invoke('netease:request',{route:'/song/detail',params:{ids:'33894312'}});if(result.code!==200)throw new Error(result.message);await player.playNow(result.songs[0])})()`)
    await until("player.audio.currentTime>.3 && player.audio.readyState>=2", 'real authorized NetEase audio plays')
    const signal = await js(`(()=>{const d=new Float32Array(player.analyser.fftSize);player.analyser.getFloatTimeDomainData(d);return {duration:player.audio.duration,rms:Math.sqrt(d.reduce((a,b)=>a+b*b,0)/d.length),preview:player.currentSong.isPreview}})()`)
    assert.ok(signal.duration>260 && signal.rms>.001 && !signal.preview)
    await js('player.togglePlay()'); const paused = await js('player.audio.currentTime'); await delay(250); assert.equal(await js('player.audio.currentTime'), paused)
    await js('player.audio.currentTime=20;player.togglePlay()'); await until('player.audio.currentTime>20.2', 'audio seek'); await js('player.audio.pause()')
    report.checks.push({ label: 'real full authorized audio decode, pause and seek', ...signal })
    const lyric = await js("bridge.invoke('netease:request',{route:'/lyric/new',params:{id:'421423808'}})")
    assert.ok(lyric.lrc.lyric.includes('固执'))
    const denied = await js("bridge.invoke('netease:request',{route:'/song/url/v1',params:{id:'421423808',level:'standard'}})")
    assert.equal(denied.data[0].url, null)
    report.checks.push('exact-ID real lyrics and preserved guest rights denial')
    await js("document.querySelector('.user-info.clickable').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    await until("document.querySelector('.qr-login img')?.naturalWidth>0", 'NetEase generated QR image decodes')
    await screenshot('login')
    await js("document.querySelector('.login-modal .close-btn').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    await until("!document.querySelector('.login-modal')", 'NetEase login closes')
    assert.ok(await js("!pinia._s.get('user').isLoggedIn && !localStorage.getItem('music_cookie')"))
    assert.ok(report.requests.some(r=>r.route==='/login/qr/cancel'))
    report.checks.push('real generated QR decode and cancel without creating an authenticated account')
    assert.deepEqual(report.errors, [])
}
app.on('browser-window-created', (_event, win) => {
    if (main) return
    main = win; win.setFocusable(false); win.setIgnoreMouseEvents(true); win.webContents.setAudioMuted(true)
    win.webContents.debugger.attach('1.3'); win.webContents.debugger.sendCommand('Runtime.enable')
    win.webContents.debugger.on('message', (_event, method, params) => { if (method==='Runtime.exceptionThrown') report.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text) })
    win.webContents.once('did-finish-load', () => run().then(() => finish(), finish))
})
setTimeout(() => finish(new Error('NetEase real test timed out')),120000).unref()
require('../dist-electron/main.js')
