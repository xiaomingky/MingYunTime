const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve('dev/qishui-electron')
fs.mkdirSync(root, { recursive: true })
app.setPath('userData', path.join(root, 'profile'))
const report = { errors: [], checks: [], signals: [] }
let main, finished = false
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function finish(error) {
    if (finished) return
    finished = true
    if (error) report.errors.push(error.message)
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.exit(error || report.errors.length ? 1 : 0)
}
const js = source => main.webContents.executeJavaScript(source, true)
async function snapshot(label) {
    const value = await js(`(() => {
        const data = new Float32Array(player.analyser.fftSize)
        player.analyser.getFloatTimeDomainData(data)
        return { time: player.audio.currentTime, duration: player.audio.duration,
            paused: player.audio.paused, context: player.ctx.state,
            host: player.audio.src ? new URL(player.audio.src).hostname : '',
            rms: Math.sqrt(data.reduce((a,b) => a+b*b,0)/data.length) }
    })()`)
    report.signals.push({ label, ...value })
    return value
}
async function run() {
    await delay(700)
    await js(`window.pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        window.router=document.querySelector('#app').__vue_app__.config.globalProperties.$router;
        window.player=pinia._s.get('player'); player.autoFetchLyric=false;
        localStorage.setItem('current_platform','qishui'); pinia._s.get('platform').syncFromStorage();
        router.push('/qishui');`)
    for(let i=0;i<40;i++) {
        await delay(200)
        if(await js("[...document.querySelectorAll('.soda-cover img')].some(img=>img.naturalWidth>0)"))break
    }
    assert.ok(await js("[...document.querySelectorAll('.soda-cover img')].some(img=>img.naturalWidth>0)"),'real discovery artwork loads in renderer')
    await js("document.querySelector('.update-dialog .btn-skip')?.click()")
    await delay(350)
    fs.writeFileSync(path.join(root,'discovery-artwork.png'),(await main.webContents.capturePage()).toPNG())
    report.checks.push('real discovery artwork decodes with Qishui platform theme')
    await js(`(async()=>{const result=await bridge.invoke('qishui:detail',{id:'7079108541549643812'});
        if(result.code!==0)throw new Error(result.message);
        await player.playNow(result.data.track,[result.data.track]);})()`)
    let signal
    for (let i=0;i<30;i++) {
        await delay(250)
        signal = await snapshot('preview decoding ' + i)
        if (signal.rms > .001 && signal.time > .3) break
    }
    assert.ok(signal.rms > .001 && signal.context === 'running', 'real preview has decoded audio signal: ' + await js('document.body.innerText.slice(-1800)'))
    const state = await js(`({preview:player.currentSong.isPreview,full:player.currentSong.fullDuration,
        duration:player.currentSong.duration,lyrics:player.lyrics.length,words:player.yrcLyrics.length,
        download:player.currentSong.downloadAllowed,platform:player.currentSong.platform})`)
    assert.equal(state.platform, 'qishui'); assert.equal(state.preview, true)
    assert.equal(state.download, false); assert.ok(state.full > 200 && state.duration < 60)
    assert.ok(state.lyrics > 0 && state.words > 0)
    report.checks.push({ label: 'real preview permissions, duration and lyrics', ...state })
    await js('player.togglePlay()')
    const paused = await snapshot('paused'); await delay(400)
    assert.equal((await snapshot('pause remains')).time, paused.time)
    await js('player.audio.currentTime=10;player.togglePlay()'); await delay(550)
    const resumed = await snapshot('seek/resume')
    assert.ok(resumed.time >= 10 && resumed.rms > .001)
    for (const style of ['classic','apple']) {
        await js(`pinia._s.get('song-detail').style=${JSON.stringify(style)}; player.showSongDetail=true`)
        await delay(600)
        assert.ok(await js("document.querySelector('.song-panel-shell').textContent.includes('试听')"))
        assert.ok(await js("![...document.querySelectorAll('.song-panel-shell button')].some(b=>b.title==='下载'||b.getAttribute('aria-label')==='下载')"))
        await js('player.showSongDetail=false'); await delay(500)
        report.checks.push(style + ' preview detail and download restriction')
    }
    await js('player.audio.pause()')
    await js("router.push('/qishui/playlist/7096700219496368135')")
    for(let i=0;i<40;i++) {
        await delay(200)
        if(await js("[...document.querySelectorAll('.soda-track-artwork img')].some(img=>img.naturalWidth>0)"))break
    }
    assert.ok(await js("[...document.querySelectorAll('.soda-track-artwork img')].some(img=>img.naturalWidth>0)"),'real playlist track artwork decodes')
    await js("document.querySelector('.update-dialog .btn-skip')?.click()")
    await delay(350)
    fs.writeFileSync(path.join(root,'playlist-artwork.png'),(await main.webContents.capturePage()).toPNG())
    await js("router.push('/qishui/search?keywords=7years')")
    for(let i=0;i<85;i++) {
        await delay(200)
        if(await js("document.querySelectorAll('.soda-track').length>0 || !!document.querySelector('.soda-error')"))break
    }
    assert.ok(await js("!document.querySelector('.soda-search-scope') && document.querySelectorAll('.soda-track').length===20"),'real full catalog search returns 20 tracks')
    assert.ok(await js("document.querySelector('.soda-tracklist').textContent.toLowerCase().includes('7 years')"))
    fs.writeFileSync(path.join(root,'full-search.png'),(await main.webContents.capturePage()).toPNG())
    await js("document.querySelector('.soda-more').click()")
    for(let i=0;i<65;i++){await delay(200);if(await js("document.querySelectorAll('.soda-track').length>20"))break}
    assert.ok(await js("document.querySelectorAll('.soda-track').length>20"),'full search pagination loads distinct real songs')
    report.checks.push('real playlist artwork, 7years full catalog search and pagination')
    await delay(800)
    const persisted = await js("JSON.parse(localStorage.getItem('current_song'))")
    assert.ok(persisted?.qishuiId && !persisted.url, 'signed playback URL is not persisted')
    report.checks.push('signed URL excluded from persisted playback state')
    assert.equal(await js("player.audio.src.startsWith('qishui-audio:')"),true,'native signed encrypted media plays from in-memory protocol')
    for (const type of ['artist','album','playlist']) {
        await js(`router.push('/qishui/search?keywords='+encodeURIComponent('陈粒')+'&type=${type}')`)
        for(let i=0;i<80;i++){await delay(150);if(await js("document.querySelectorAll('.soda-card').length>0 || !!document.querySelector('.soda-error')"))break}
        assert.ok(await js("document.querySelectorAll('.soda-card').length>0"),type+' search has real domain cards')
        if(type==='artist'||type==='album') {
            await js("document.querySelector('.soda-card').click()")
            for(let i=0;i<80;i++){await delay(150);if(await js("document.querySelectorAll('.soda-track').length>0 || !!document.querySelector('.soda-error')"))break}
            assert.ok(await js("document.querySelectorAll('.soda-track').length>0"),type+' detail connects real tracks')
            fs.writeFileSync(path.join(root,type+'-detail.png'),(await main.webContents.capturePage()).toPNG())
        }
        report.checks.push('real '+type+' search and resource navigation')
    }
    await js("router.push('/qishui/playlist/7096700219496368135')")
    for(let i=0;i<80;i++){await delay(150);if(await js("document.querySelectorAll('.soda-comments article').length>0"))break}
    assert.ok(await js("document.querySelectorAll('.soda-comments article').length>0"),'playlist comments render actual platform comments')
    report.checks.push('real playlist comments')
    await js("(()=>{const el=document.querySelector('[aria-label=\"歌单内搜索\"]');el.value='Hora';el.dispatchEvent(new Event('input',{bubbles:true}));el.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()")
    for(let i=0;i<60;i++){await delay(150);if(await js("document.querySelectorAll('.soda-track').length===1 && !document.querySelector('.soda-error')"))break}
    assert.ok(await js("document.querySelectorAll('.soda-track').length===1 && document.querySelector('.soda-track').textContent.toLowerCase().includes('hora')"),'playlist search uses real platform subset')
    const shared=await js("bridge.invoke('qishui:share',{type:'track',id:'7079108541549643812'})")
    assert.equal(shared.code,0);assert.ok(shared.data.url.startsWith('https://music.douyin.com/'))
    report.checks.push('real playlist subset search and platform-issued sharing URL')
    await js("router.push('/qishui/user/97557223451')")
    for(let i=0;i<60;i++){await delay(150);if(await js("!!document.querySelector('.soda-user-stats') || !!document.querySelector('.soda-error')"))break}
    if (await js("!!document.querySelector('.soda-error')")) {
        report.checks.push({ label:'public profile transient upstream error; explicit retry', message:await js("document.querySelector('.soda-error').textContent") })
        await delay(1000); await js("document.querySelector('.soda-error button').click()")
        for(let i=0;i<60;i++){await delay(150);if(await js("!!document.querySelector('.soda-user-stats')"))break}
    }
    assert.ok(await js("!!document.querySelector('.soda-user-stats')"),'real artist public account profile renders: '+await js("document.querySelector('.qishui-page').textContent"))
    report.checks.push('real public user profile and artist navigation entry')

    await js("player.showSongDetail=false;document.querySelector('.user-info.clickable').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    await delay(250)
    await js("document.querySelector('#soda-qr-tab').click()")
    for(let i=0;i<100;i++){await delay(200);if(await js("document.querySelector('.qr-container img')?.naturalWidth>0"))break}
    assert.ok(await js("document.querySelector('.qr-container img')?.naturalWidth>0"),'real signed QR decodes in login UI')
    for(let i=0;i<60;i++){await delay(200);if(await js("document.querySelector('.soda-login-modal').textContent.includes('请使用汽水音乐 App 扫码')"))break}
    assert.ok(await js("document.querySelector('.soda-login-modal').textContent.includes('请使用汽水音乐 App 扫码')"),'real unscanned QR is waiting')
    fs.writeFileSync(path.join(root,'real-qr-login.png'),(await main.webContents.capturePage()).toPNG())
    await js("document.querySelector('.login-modal .close-btn').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    report.checks.push('real official browser-signed QR generation, rendered PNG, waiting poll and cancellation')
    assert.deepEqual(report.errors, [], 'no renderer exceptions')
}
app.on('browser-window-created', (_event, window) => {
    if (main) return
    main=window; window.setFocusable(false); window.setIgnoreMouseEvents(true)
    window.webContents.setAudioMuted(true)
    window.webContents.debugger.attach('1.3')
    window.webContents.debugger.sendCommand('Runtime.enable')
    window.webContents.debugger.on('message', (_event, method, params) => {
        if (method==='Runtime.exceptionThrown') report.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'renderer runtime exception')
    })
    window.webContents.once('did-finish-load', () => run().then(()=>finish(),finish))
})
setTimeout(()=>finish(new Error('real Qishui playback test timeout')),90000).unref()
require('../dist-electron/main.js')
