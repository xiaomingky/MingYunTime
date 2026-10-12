const { app, BrowserWindow, session, dialog, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const testRoot = path.resolve('dev/electron-functional')
fs.mkdirSync(testRoot, { recursive: true })
app.setPath('userData', path.join(testRoot, 'profile'))
const report = { errors: [], signals: [], routes: [], interactions: [], transitions: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let main, finished = false
function finish(error) {
    if (finished) return
    finished = true
    if (error) report.errors.push(error.stack || String(error))
    fs.writeFileSync(path.join(testRoot, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.exit(error ? 1 : 0)
}
app.on('browser-window-created', (_event, window) => {
    if (main) return
    main = window
    window.setFocusable(false)
    window.setIgnoreMouseEvents(true)
    window.webContents.setAudioMuted(true)
    window.webContents.debugger.attach('1.3')
    window.webContents.debugger.sendCommand('Runtime.enable')
    window.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Runtime.exceptionThrown') report.errors.push(JSON.stringify(params.exceptionDetails))
    })
    window.webContents.on('console-message', details => {
        if (/CORS|MediaElementAudioSource|Audio error|rebuildAudioGraph|Playback fail/i.test(details.message)) report.errors.push(details.message)
    })
    window.webContents.once('did-finish-load', () => run().then(() => finish(), finish))
})
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true })))
const js = source => main.webContents.executeJavaScript(source, true)
async function signal(label) {
    await delay(400)
    const value = await js(`(() => { const data=new Float32Array(player.analyser.fftSize); player.analyser.getFloatTimeDomainData(data); return {time:player.audio.currentTime,paused:player.audio.paused,ctx:player.ctx.state,crossOrigin:player.audio.crossOrigin,gain:player.volumeGain.gain.value,rms:Math.sqrt(data.reduce((a,b)=>a+b*b,0)/data.length)} })()`)
    report.signals.push({ label, ...value })
    assert.ok(value.rms > .02, label + ' has a non-zero decoded signal')
    assert.ok(value.gain > 0 && value.ctx === 'running', label + ' has an active output')
}
async function run() {
    function sourceFiles(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : /\.(js|cjs|vue)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
    }
    const expectedChannels = new Set()
    for (const file of [...sourceFiles(path.resolve('src')), path.resolve('electron/preload.cjs')]) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/\binvoke\(['"]([^'"]+)['"]/g)) expectedChannels.add(match[1])
    }
    const missingChannels = [...expectedChannels].filter(channel => !ipcMain._invokeHandlers.has(channel))
    assert.deepEqual(missingChannels, [], 'all frontend native request channels are registered')
    report.interactions.push(expectedChannels.size + ' native request channels registered')
    const rate = 44100, seconds = 30
    const wav = Buffer.alloc(44 + rate * 2 * seconds)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40)
    for(let i=0;i<rate*seconds;i++) wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*8192),44+i*2)
    const file = path.join(testRoot, '本地 音频信号测试.wav'); fs.writeFileSync(file,wav)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    const url = 'local-file:///' + encodeURI(file.replaceAll('\\','/'))
    await delay(500)
    await js(`window.pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; window.router=document.querySelector('#app').__vue_app__.config.globalProperties.$router; window.player=pinia._s.get('player'); player.autoFetchLyric=false; player.playNow({id:'local-signal',name:'音频信号测试',artist:'测试',url:${JSON.stringify(url)},path:${JSON.stringify(file)},duration:30,al:{name:'测试',picUrl:''}})`)
    await signal('first local playback')
    await js('player.togglePlay()'); await delay(100); await js('player.togglePlay()'); await signal('pause/resume')
    await js('player.setVolume(150)'); await signal('volume boost')
    await js('player.toggleEq()'); await signal('EQ enabled')
    await js('player.toggleEq()'); await signal('EQ disabled')
    await js('player.resetAudioElement()'); await signal('audio reset')
    await js("player.setAudioDevice('')"); await signal('default audio device')
    await js("player.setAudioDevice('removed-device-for-regression')"); await signal('missing device fallback')
    assert.equal(await js('player.currentDeviceId'), '')
    main.hide(); await delay(2300); main.show(); await signal('hidden-window recovery')
    for (const style of ['classic', 'apple']) {
        await js(`pinia._s.get('song-detail').style=${JSON.stringify(style)}; pinia._s.get('settings').setInterfaceMotion('on'); player.showSongDetail=true`)
        await delay(90)
        const enter = await js(`(()=>{const el=document.querySelector('.song-panel-shell');return {top:el?.getBoundingClientRect().top,height:innerHeight,transform:el&&getComputedStyle(el).transform}})()`)
        assert.ok(enter.top > 0 && enter.top < enter.height, style + ' opening moves through the screen')
        await delay(500)
        assert.equal(await js("getComputedStyle(document.querySelector('.song-panel-shell')).transform"), 'none', 'settled panel preserves native window dragging')
        if (style === 'apple') assert.ok(await js("!!document.querySelector('.apple-detail')"))
        await js('player.showSongDetail=false'); await delay(90)
        const leave = await js("document.querySelector('.song-panel-shell')?.getBoundingClientRect().top")
        assert.ok(leave > 0, style + ' closing moves down')
        await delay(500)
        assert.ok(await js("!document.querySelector('.song-panel-shell')"), 'closed detail releases its DOM')
        report.transitions.push({ style, enter, leave })
    }
    await js("pinia._s.get('settings').setInterfaceMotion('off');player.showSongDetail=true")
    await delay(250)
    assert.equal(await js("getComputedStyle(document.querySelector('.song-panel-shell')).transform"), 'none')
    await js("player.showSongDetail=false;pinia._s.get('settings').setInterfaceMotion('on')")
    await delay(100)
    report.interactions.push('motion off/on and lyric detail enter/leave')
    const imported = await js('bridge.openFileDialog()')
    assert.equal(imported.length, 1)
    assert.ok(Math.abs(imported[0].duration-30)<.1)
    await js(`player.addLocalSongs(${JSON.stringify(imported)});router.push('/local')`)
    await delay(250)
    assert.ok(await js("!!document.querySelector('.local-music-view .song-actions-trigger')"))
    const originalLength = await js('player.playlist.length')
    await js("document.querySelector('.local-music-view .song-actions-trigger').click()")
    await delay(40)
    await js("[...document.querySelectorAll('.song-actions-popover button')].find(el=>el.textContent.includes('加入播放队列')).click()")
    assert.equal(await js('player.playlist.length'), originalLength + 1)
    for (const label of ['格式转换', '歌词获取', '本地音乐']) {
        await js(`[...document.querySelectorAll('.local-music-view .tab-btn')].find(el=>el.textContent.includes(${JSON.stringify(label)})).click()`)
        await delay(150)
        assert.ok(await js('!!document.querySelector(".local-music-view")'))
    }
    report.interactions.push('native file import, metadata duration, song menu enqueue, conversion/lyric tabs')
    await js(`player.playNow(${JSON.stringify(imported[0])})`); await signal('imported local song')
    for (const extension of ['mp3', 'flac']) {
        const sample = path.join(testRoot, 'local-signal.' + extension)
        if (!fs.existsSync(sample)) continue
        const mediaUrl = 'local-file:///' + encodeURI(sample.replaceAll('\\', '/'))
        await js(`player.playNow({id:${JSON.stringify('local-'+extension)},name:${JSON.stringify(extension+' playback')},url:${JSON.stringify(mediaUrl)},path:${JSON.stringify(sample)},duration:30,al:{name:'测试',picUrl:''}})`)
        await signal(extension + ' local playback')
    }
    await js("player.parseLyrics('[00:00.00]桌面歌词检查\\n[00:10.00]第二句');player.toggleDesktopLyrics()")
    await delay(700)
    const lyricWindow = BrowserWindow.getAllWindows().find(window => window !== main && window.webContents.getURL().includes('desktop-lyrics'))
    assert.ok(lyricWindow, 'desktop lyric window opens')
    assert.ok(await lyricWindow.webContents.executeJavaScript("!!document.querySelector('#app').__vue_app__"), 'desktop lyric renderer mounted')
    await js('player.toggleDesktopLyrics()')
    await delay(100)
    assert.ok(lyricWindow.isDestroyed() || !lyricWindow.isVisible(), 'desktop lyric window closes')
    report.interactions.push('desktop lyrics window open/close')
    await js("player.audio.pause();document.querySelector('.selector-header .close-btn')?.click()")
    const routes = await js('router.getRoutes().map(r=>r.path)')
    for (const route of routes) {
        if (route === '/desktop-lyrics') continue
        const destination = route.replace(/:game/g,'lol').replace(/:source/g,'bilibili').replace(/:[A-Za-z]+/g,'1')
        const platform = route.startsWith('/qq') ? 'qq' : route.startsWith('/kugou') ? 'kugou' : 'netease'
        await js(`localStorage.setItem('current_platform',${JSON.stringify(platform)});pinia._s.get('platform').syncFromStorage();router.push(${JSON.stringify(destination)})`)
        await delay(220)
        assert.equal(await js('router.currentRoute.value.path'), destination)
        report.routes.push(destination)
    }
    assert.equal(report.errors.length, 0, 'no runtime exceptions or muted audio source')
}
setTimeout(()=>finish(new Error('functional test timeout')),60000).unref()
require(process.env.MINGYUN_SMOKE_APP || '../dist-electron/main.js')
