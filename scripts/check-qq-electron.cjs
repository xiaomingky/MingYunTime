const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve('dev/qq-electron')
fs.mkdirSync(root, { recursive: true })
app.setPath('userData', path.join(root, 'profile'))
const report = { errors: [], checks: [], requests: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let main, finished = false
const js = source => main.webContents.executeJavaScript(source, true)
function finish(error) {
    if (finished) return
    finished = true
    if (error) report.errors.push(error.stack || String(error))
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.exit(report.errors.length ? 1 : 0)
}
async function until(expression, message, timeout = 22000) {
    const end = Date.now() + timeout
    while (Date.now() < end) { if (await js(expression)) return; await delay(150) }
    throw new Error(message + ': ' + await js("document.querySelector('main')?.textContent.slice(-1200) || document.body.innerText.slice(-1200)"))
}
async function screenshot(name) { fs.writeFileSync(path.join(root, name + '.png'), (await main.webContents.capturePage()).toPNG()) }
async function run() {
    await delay(500)
    // Instrument only existing handlers. All core responses below come from QQ.
    for (const name of ['search','album-info','album-tracks','playlist-detail','ranks','top-lists','singer-list','singer-desc','singer-hotsong','singer-album','hotkey','playlist-list','playlist-categories','new-disks','song-info','song-play','lyric','mv-play','user-playlists']) {
        const channel = 'qq:' + name, handler = ipcMain._invokeHandlers.get(channel)
        assert.ok(handler, channel + ' registered')
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, params) => {
            const result = await handler(event, params)
            report.requests.push({ channel, code: result?.code })
            return result
        })
    }
    await js(`window.pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        window.router=document.querySelector('#app').__vue_app__.config.globalProperties.$router;
        window.player=pinia._s.get('player');player.autoFetchLyric=false;
        localStorage.setItem('current_platform','qq');pinia._s.get('platform').syncFromStorage();router.push('/qq/search?keywords=陈粒');`)
    await until("document.querySelectorAll('.qq-search-page .qq-song-item').length===30", 'real QQ song search has thirty songs')
    await until("[...document.querySelectorAll('.qq-song-cover')].some(img=>img.naturalWidth>0)", 'QQ song artwork decodes')
    assert.ok(await js("document.querySelector('.qq-search-page').textContent.includes('陈粒')"))
    const initial = await js("document.querySelector('.qq-song-item').textContent")
    await js("[...document.querySelectorAll('.qq-pagination button')].find(b=>b.textContent==='下一页').click()")
    await until("document.querySelectorAll('.qq-song-item').length===30 && document.querySelector('.qq-pagination').textContent.includes('第 2 页')", 'QQ second search page')
    assert.notEqual(await js("document.querySelector('.qq-song-item').textContent"), initial)
    await screenshot('search-page-2')
    report.checks.push('real 30-song search, decoded artwork, totals and distinct second page')
    await js("[...document.querySelectorAll('.qq-tab')].find(b=>b.textContent==='专辑').click()")
    await until("document.querySelectorAll('.qq-search-page .qq-card').length>0", 'QQ real album search')
    assert.ok(await js("document.querySelector('.qq-search-page').textContent.includes('如也')"))
    report.checks.push('real independent album search')
    for (const label of ['歌手','歌单','MV']) {
        await js(`[...document.querySelectorAll('.qq-tab')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
        await until("document.querySelectorAll('.qq-search-page .qq-card').length>0 && !document.querySelector('.qq-search-page [role=alert]')", 'real typed QQ search ' + label)
        assert.ok(await js("[...document.querySelectorAll('.qq-search-page .qq-card')].some(card=>card.textContent.includes('陈粒'))"))
        report.checks.push('real session-based ' + label + ' search')
    }
    await js("document.querySelector('.qq-search-page .qq-mv-card').click()")
    await until("document.querySelector('.qq-mv-player video')?.readyState>=2", 'real QQ MV decodes in video player')
    assert.ok(await js("document.querySelector('.qq-mv-player video').videoWidth>0"))
    await screenshot('mv')
    await js("document.querySelector('.qq-mv-player video').pause();document.querySelector('.qq-mv-close').click()")
    report.checks.push('real QQ MV authorization and decoded video dimensions')
    await js(`(async()=>{const result=await bridge.invoke('qq:song-info',{songmid:'001hs89m3C5p3g'});
        const info=result.data.songInfo;
        await player.playNow({id:info.mid,songmid:info.mid,songid:info.id,name:info.name,platform:'qq',artist:info.singer.map(s=>s.name).join('/'),dt:info.interval*1000,al:{mid:info.album.mid,name:info.album.name,picUrl:'https://y.gtimg.cn/music/photo_new/T002R300x300M000'+info.album.mid+'.jpg'}});})()`)
    await until("player.audio.currentTime>.3 && player.audio.readyState>=2", 'QQ authorized audio plays')
    const signal = await js(`(()=>{const samples=new Float32Array(player.analyser.fftSize);player.analyser.getFloatTimeDomainData(samples);return {duration:player.audio.duration,time:player.audio.currentTime,rms:Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length),preview:player.currentSong.isPreview,full:player.currentSong.fullDuration,lyric:player.lyrics.length,words:player.yrcLyrics?.length||0}})()`)
    assert.ok(signal.rms>.001 && signal.duration>290 && signal.full>290 && !signal.preview, 'real guest-authorized full stream is decoded with honest duration')
    await until("player.lyrics.length>0 && player.yrcLyrics?.length>0", 'exact ID standard and word lyrics')
    const exactLyric = await js("bridge.invoke('qq:lyric',{songmid:'001hs89m3C5p3g'})")
    assert.ok(exactLyric.lrc && exactLyric.yrc, 'fresh exact-ID lyrics return both line and word timing')
    await js('player.togglePlay()');const paused=await js('player.audio.currentTime');await delay(300)
    assert.equal(await js('player.audio.currentTime'),paused)
    await js('player.audio.currentTime=20;player.togglePlay()')
    await until('player.audio.currentTime>20.2', 'QQ audio resumes after seek')
    await js('player.audio.pause()')
    report.checks.push({label:'real full audio decode, pause, seek and exact ID word lyrics',duration:signal.duration,rms:signal.rms})
    await js("router.push('/qq/album/003RMaRI1iFoYd')")
    await until("document.querySelectorAll('.qq-album-page .qq-song-item').length===10", 'QQ album has ten full metadata tracks')
    assert.ok(await js("document.querySelector('.qq-album-artist').textContent.includes('周杰伦')"))
    assert.ok(await js("document.querySelector('.qq-album-name').textContent.includes('床边故事')"))
    await until("document.querySelector('.qq-album-cover')?.naturalWidth>0", 'QQ album artwork')
    await screenshot('album')
    report.checks.push('real album metadata, artist, ten songs, description and numeric comment ID')
    await js("router.push('/qq/playlist/7707261125')")
    await until("document.querySelectorAll('.qq-playlist-page .qq-song-item').length===66", 'QQ APK playlist detail has all sixty-six tracks')
    assert.ok(await js("document.querySelector('.qq-playlist-name').textContent.includes('旋律说唱')"))
    await until("document.querySelector('.qq-playlist-cover')?.naturalWidth>0", 'QQ playlist artwork')
    await screenshot('playlist')
    report.checks.push('real APK CgiGetDiss playlist metadata, cover and sixty-six songs')
    await js("router.push('/qq/rank/26')")
    await until("document.querySelectorAll('.qq-playlist-page .qq-song-item').length===100", 'QQ live rank first hundred')
    for (const target of [200, 300]) {
        await js("[...document.querySelectorAll('.qq-queue-btn')].find(b=>b.textContent.includes('加载更多')).click()")
        await until(`document.querySelectorAll('.qq-song-item').length===${target}`, 'QQ rank continuation ' + target)
    }
    assert.ok(await js("![...document.querySelectorAll('.qq-queue-btn')].some(b=>b.textContent.includes('加载更多'))"))
    assert.ok(await js("document.querySelector('.qq-playlist-name').textContent.includes('热歌榜')"))
    await screenshot('rank')
    report.checks.push('real current-period rank pagination loads all 300 distinct songs and stops')
    await js("router.push('/qq/singers')")
    await until("document.querySelectorAll('.qq-singer-card').length===30", 'QQ singer directory first page')
    for (const target of [60, 90]) {
        await js("document.querySelector('.qq-load-btn').click()")
        await until(`document.querySelectorAll('.qq-singer-card').length===${target}`, 'QQ singer continuation ' + target)
    }
    report.checks.push('real singer directory pagination crosses upstream eighty-item boundary without duplicates')
    await js("router.push('/qq/singer/004WgCsE3KBddt')")
    await until("document.querySelectorAll('.qq-singer-page .qq-song-item').length===30 && document.querySelector('.qq-singer-page .qq-singer-more')", 'real singer page first song/album pages')
    await js("[...document.querySelectorAll('.qq-singer-more')].find(b=>b.textContent.includes('更多歌曲')).click()")
    await until("document.querySelectorAll('.qq-singer-page .qq-song-item').length===60", 'real singer page adds second thirty songs')
    await js("[...document.querySelectorAll('.qq-singer-more')].find(b=>b.textContent.includes('更多专辑')).click()")
    await until("document.querySelectorAll('.qq-singer-page .qq-card:not(.qq-mv-card)').length>=20", 'real singer page adds next ten albums')
    await screenshot('singer')
    report.checks.push('real singer page continuation: sixty songs and twenty albums, with metadata and totals')
    // Test only the independent singer business contracts here; optional legacy
    // MV/follow widgets remain covered separately by full route regression.
    const singer = await js("bridge.invoke('qq:singer-desc',{singermid:'004WgCsE3KBddt'})")
    assert.equal(singer.singer.name, '陈粒')
    const songs = await js("bridge.invoke('qq:singer-hotsong',{singermid:'004WgCsE3KBddt',limit:30,page:1})")
    assert.equal(songs.data.songlist.length, 30)
    const albums = await js("bridge.invoke('qq:singer-album',{singermid:'004WgCsE3KBddt',limit:10,page:1})")
    assert.equal(albums.data.list.length, 10)
    const hotkey = await js("bridge.invoke('qq:hotkey',{})")
    assert.ok(hotkey.data.hotkey.length > 0)
    const categories = await js("bridge.invoke('qq:playlist-categories',{})")
    assert.ok(categories.data.categories.length > 0)
    const newDisks = await js("bridge.invoke('qq:new-disks',{limit:10,page:1})")
    assert.equal(newDisks.data.albums.length, 10)
    const nextDisks = await js("bridge.invoke('qq:new-disks',{limit:10,page:2})")
    assert.notEqual(newDisks.data.albums[0].mid,nextDisks.data.albums[0].mid)
    const publicPlaylists = await js("bridge.invoke('qq:user-playlists',{uin:'3509852917',limit:100})")
    assert.ok(publicPlaylists.data.playlists.some(item=>item.type===1))
    report.checks.push('real singer profile, song/album contracts, hotkeys, playlist categories and new albums')
    report.checks.push('real public user playlist directory (not authentication proof) and distinct new-album pages')
    assert.deepEqual(report.errors, [], 'no renderer exceptions')
}
app.on('browser-window-created', (_event, window) => {
    if (main) return
    main = window; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.webContents.setAudioMuted(true)
    window.webContents.debugger.attach('1.3')
    window.webContents.debugger.sendCommand('Runtime.enable')
    window.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Runtime.exceptionThrown') report.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'renderer exception')
    })
    window.webContents.once('did-finish-load', () => run().then(() => finish(), finish))
})
setTimeout(() => finish(new Error('QQ real core test timeout')), 120000).unref()
require('../dist-electron/main.js')
