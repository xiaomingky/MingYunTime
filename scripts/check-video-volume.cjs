// Run with: electron scripts/check-video-volume.cjs
// Isolated player and profile; never touches the running app or account data.
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-video-volume-'))
app.setPath('userData', path.join(testRoot, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
protocol.registerSchemesAsPrivileged([{ scheme: 'local-file', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let window
const errors = [], results = []
const js = expression => window.webContents.executeJavaScript(expression, true)

function writeTone(file) {
    const rate = 48000, frames = rate * 30
    const wav = Buffer.alloc(44 + frames * 2)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
    for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 1600), 44 + i * 2)
    fs.writeFileSync(file, wav)
}

async function waitFor(expression, description) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
        if (await js(expression)) return
        await delay(80)
    }
    throw new Error('Timed out: ' + description)
}

async function measure(label, expectedGain) {
    await waitFor('harness.art && harness.art.video.currentTime > .15 && !harness.art.video.paused && __gainNodes.length > 0', label + ' playback')
    await delay(220)
    const result = await js('(' + (() => {
        const entry = __gainNodes.at(-1), pcm = new Float32Array(entry.analyser.fftSize)
        entry.analyser.getFloatTimeDomainData(pcm)
        return { gain: entry.node.gain.value, state: entry.node.context.state, rms: Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length), crossOrigin: harness.art.video.crossOrigin, sources: __mediaSources.length, time: harness.art.currentTime }
    }).toString() + ')()')
    assert.equal(result.gain, expectedGain, label + ' applies the actual GainNode value')
    assert.equal(result.state, 'running', label + ' resumes AudioContext')
    assert.equal(result.crossOrigin, 'anonymous', label + ' sets CORS before loading media')
    assert.ok(result.rms > .003, label + ' outputs non-zero decoded PCM')
    results.push({ label, ...result })
    return result.rms
}

async function selectGain(gain) {
    await openSetting('gainBoostSettings')
    const selectorName = `gain-${gain}`
    await waitFor(`document.querySelector('[data-name="${selectorName}"]')`, `${gain * 100}% native setting selector`)
    await js(`document.querySelector('[data-name="${selectorName}"]').click()`)
    await waitFor("localStorage.getItem('art_gain_boost') === '" + gain + "'", 'persisted gain')
}

async function openSetting(name) {
    await js('harness.art.controls.setting.click()')
    await waitFor(`document.querySelector('[data-name="${name}"]')`, name + ' settings item')
    await js(`document.querySelector('[data-name="${name}"]').click()`)
}

app.whenReady().then(async () => {
    console.log('Video volume check: loading isolated renderer')
    const { localFileResponse } = await import('../electron/local-protocol.js')
    protocol.handle('local-file', localFileResponse)
    const tone = path.join(testRoot, '本地 视频音轨测试.wav')
    writeTone(tone)
    const url = 'local-file://localhost/' + encodeURIComponent(tone.split(path.sep).join('/'))
    const setup = (url) => {
        window.__gainNodes = []; window.__mediaSources = []
        const createGain = AudioContext.prototype.createGain, createSource = AudioContext.prototype.createMediaElementSource
        AudioContext.prototype.createGain = function() {
            const node = createGain.call(this), analyser = this.createAnalyser(), connect = node.connect.bind(node)
            node.connect = target => { connect(analyser); analyser.connect(target); return target }
            __gainNodes.push({node, analyser}); return node
        }
        AudioContext.prototype.createMediaElementSource = function(element) {
            const node = createSource.call(this, element); __mediaSources.push({element, node}); return node
        }
        localStorage.setItem('art_gain_boost', '3')
        const state = reactive({src:url,audioUrl:'',playType:'direct',autoplay:true,danmaku:[{time:1,text:'测试弹幕',mode:0,fontSize:22,color:'#ffffff'}],qualities:[{qn:80,label:'1080P 高清',videoUrl:url},{qn:64,label:'720P 流畅',videoUrl:url}],episodes:Array.from({length:40},(_,i)=>({title:'第'+(i+1)+'集 测试很长的剧集名称'}))}), player = ref(null)
        createApp({setup:()=>()=>h(ArtVideoPlayer,{...state,ref:player})}).mount('#app')
        window.harness = {state, get art(){return player.value?.art}, async reopen(){const current=state.src; state.src=''; await nextTick(); await new Promise(r=>setTimeout(r,30)); state.src=current}}
    }
    const entry = "import { createApp, h, reactive, ref, nextTick } from 'vue'; import " + JSON.stringify(path.join(root, 'src/style.css').replaceAll('\\', '/')) + '; import ' + JSON.stringify(path.join(root, 'src/styles/unified-controls.css').replaceAll('\\', '/')) + '; import ArtVideoPlayer from ' + JSON.stringify(path.join(root, 'src/components/ArtVideoPlayer.vue').replaceAll('\\', '/')) + '; (' + setup.toString() + ')(' + JSON.stringify(url) + ')'
    const html = path.join(testRoot, 'fixture.html'), output = path.join(testRoot, 'site')
    fs.writeFileSync(html, '<!doctype html><div id="app" style="width:800px;height:450px"></div><script type="module" src="/__video-volume-test-entry.js"></script>')
    const buildSource = [
        "const {build}=await import('vite');const {default:vue}=await import('@vitejs/plugin-vue');",
        'const fixtureEntry=' + JSON.stringify(entry) + ';',
        'await build({configFile:false,root:' + JSON.stringify(testRoot) + ",base:'./',logLevel:'warn',resolve:{alias:{vue:" + JSON.stringify(require.resolve('vue/dist/vue.runtime.esm-bundler.js')) + "}},plugins:[vue(),{name:'video-volume-fixture',resolveId(id){if(id==='/__video-volume-test-entry.js')return '\\0video-volume-test-entry'},load(id){if(id==='\\0video-volume-test-entry')return fixtureEntry}}],build:{outDir:" + JSON.stringify(output) + ',emptyOutDir:false,minify:false,rollupOptions:{input:' + JSON.stringify(html) + '}}});'
    ].join('\n')
    execFileSync('node', ['--input-type=module', '-e', buildSource], { cwd: root, stdio: 'inherit', timeout: 60000, windowsHide: true })
    console.log('Video volume check: fixture built')
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, webSecurity: true } })
    window.webContents.setAudioMuted(true)
    window.webContents.on('console-message', event => { if (/initAudioGraph error|CORS|MediaElementAudioSource/i.test(event.message)) errors.push(event.message) })
    await window.loadFile(path.join(output, 'fixture.html'))
    console.log('Video volume check: renderer loaded')
    await waitFor('window.harness?.art?.video?.readyState >= 2', 'player loaded')
    assert.ok(await js("!harness.art.controls.gainBoost && !harness.art.controls.videoEnhance"), 'secondary enhancement actions do not crowd the control row')
    assert.ok(await js("!!harness.art.setting.find('gainBoostSettings') && !!harness.art.setting.find('videoEnhancementSettings')"), 'volume and picture enhancement are available from the settings menu')
    const progressMetrics = await js(`(() => {
        const track = document.querySelector('.art-progress .art-control-progress');
        const inner = track.querySelector('.art-control-progress-inner');
        return { track: track.getBoundingClientRect().height, inner: inner.getBoundingClientRect().height };
    })()`);
    assert.equal(progressMetrics.track, 6, 'button sizing must not stretch the native 6px progress track');
    assert.ok(progressMetrics.inner >= 3 && progressMetrics.inner <= 6, 'native progress stays a thin 3px line, up to 6px on hover');
    console.log('Native progress geometry passed:', progressMetrics);
    await js("harness.art.controls.episodes.click()")
    await waitFor("document.querySelector('.ved-panel')", 'shared episode drawer opens from ArtPlayer')
    assert.equal(await js("document.querySelectorAll('.ved-item').length"), 40)
    await js("document.querySelector('.ved-close').click()")
    const restored = await measure('saved 300% after opening local video', 3)
    await selectGain(1)
    const normal = await measure('return to 100%', 1)
    assert.ok(restored / normal > 2.85 && restored / normal < 3.15, '300% amplifies decoded signal by three')
    await selectGain(5)
    const boosted = await measure('select 500%', 5)
    assert.ok(boosted / normal > 4.75 && boosted / normal < 5.25, '500% amplifies decoded signal by five')
    await js('harness.art.pause(); harness.art.play()')
    await measure('pause and resume at 500%', 5)
    await js('__gainNodes.at(-1).node.context.suspend(); harness.art.pause(); harness.art.play()')
    await measure('resume suspended AudioContext at 500%', 5)
    await js('harness.reopen()')
    await measure('switch local source at 500%', 5)
    await js('harness.art.currentTime = 8')
    await measure('seek local source at 500%', 5)
    await js('harness.state.audioUrl = ' + JSON.stringify(url))
    await waitFor('__mediaSources.some(item => item.element.tagName === "AUDIO")', 'DASH audio source wired')
    assert.ok(await js('__mediaSources.find(item => item.element.tagName === "AUDIO").element.crossOrigin === "anonymous"'), 'DASH audio sets CORS before loading')
    await waitFor('__mediaSources.at(-1).element.currentTime > .15 && !__mediaSources.at(-1).element.paused', 'separate audio playing')
    // Remove the native track from the graph so PCM proves the separate audio is amplified.
    await js('__mediaSources.filter(item => item.element.tagName === "VIDEO").forEach(item => item.node.disconnect())')
    await measure('separate DASH audio alone at 500%', 5)
    await js('harness.state.audioUrl = ""')
    await js('harness.reopen()')
    await measure('remove separate audio and restore native video track', 5)
    const video = process.argv.find(value => /\.(mp4|webm|mkv)$/i.test(value))
    if (video) {
        const videoUrl = 'local-file://localhost/' + encodeURIComponent(path.resolve(video).split(path.sep).join('/'))
        await js('harness.state.src = ' + JSON.stringify(videoUrl))
        await js('harness.state.qualities = [{qn:80,label:"1080P 高清",videoUrl:'+JSON.stringify(videoUrl)+'},{qn:64,label:"720P 流畅",videoUrl:'+JSON.stringify(videoUrl+'?param=quality64')+'}]')
        await waitFor('harness.art?.video.videoWidth > 0 && harness.art?.video.readyState >= 2', 'real local video decoded')
        await measure('real local video with picture and boosted audio', 5)
        await js('harness.art.currentTime = 2')
        await measure('real local video seek keeps boosted output', 5)
        // Hover decodes a real independent frame and leaves main playback untouched.
        await js('harness.art.pause();harness.art.controls.show=true;harness.art.currentTime=1')
        await waitFor('!harness.art.video.seeking', 'main seek before hover')
        await js("(()=>{const p=document.querySelector('.art-progress'),r=p.getBoundingClientRect();p.dispatchEvent(new PointerEvent('pointerenter',{clientX:r.left+r.width*.5,clientY:r.top+2}))})()")
        await waitFor("!document.querySelector('.avp-seek-preview').hidden && !document.querySelector('.avp-seek-preview canvas').hidden", 'real thumbnail decoded on hover')
        assert.ok(await js("harness.art.video.paused && Math.abs(harness.art.currentTime-1)<.15"), 'hover never seeks or plays main video')
        const firstPreview = await js("document.querySelector('.avp-seek-preview canvas').toDataURL()")
        const expectedTime = ratio => js(`(()=>{const s=Math.floor(harness.art.duration*${ratio});return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')})()`)
        const hoverTime = await expectedTime(.5)
        await waitFor(`document.querySelector('.avp-seek-preview').textContent.includes(${JSON.stringify(hoverTime)}) && !document.querySelector('.avp-seek-preview canvas').hidden`, 'hover displays timestamp for the real preview frame')
        await js("(()=>{const p=document.querySelector('.art-progress'),r=p.getBoundingClientRect();p.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width*.8,clientY:r.top+2}))})()")
        const movedHoverTime = await expectedTime(.8)
        await waitFor(`document.querySelector('.avp-seek-preview').textContent.includes(${JSON.stringify(movedHoverTime)}) && !document.querySelector('.avp-seek-preview canvas').hidden`, 'hover thumbnail updates at a new timestamp')
        assert.notEqual(await js("document.querySelector('.avp-seek-preview canvas').toDataURL()"), firstPreview, 'different timestamp decodes a different picture')
        const bar = await js("(()=>{const r=document.querySelector('.art-progress').getBoundingClientRect();return {x:Math.round(r.left+r.width*.3),end:Math.round(r.left+r.width*.7),y:Math.round(r.top+r.height/2)}})()")
        window.webContents.sendInputEvent({type:'mouseMove',x:bar.x,y:bar.y})
        window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:bar.x,y:bar.y})
        window.webContents.sendInputEvent({type:'mouseMove',x:bar.end,y:bar.y})
        const dragTime = await expectedTime(.7)
        await waitFor(`!document.querySelector('.avp-seek-preview').hidden && !document.querySelector('.avp-seek-preview canvas').hidden && document.querySelector('.avp-seek-preview').textContent.includes(${JSON.stringify(dragTime)})`, 'preview follows the pointer while holding and dragging')
        assert.ok(await js(`document.querySelector('.avp-seek-preview').textContent.includes(${JSON.stringify(dragTime)})`), 'drag preview follows pointer timestamp')
        window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:bar.end,y:bar.y})
        await js("document.querySelector('.art-progress').dispatchEvent(new PointerEvent('pointerleave'))")
        await waitFor("document.querySelector('.avp-seek-preview').hidden", 'preview hides after pointer leaves')
        await js('harness.art.play()')
        console.log('Seek preview: real decoded hover frames, independent main playback, native held drag and leave cleanup passed')
        if (process.argv.includes('--enhancement')) {
            window.showInactive()
            await openSetting('videoEnhancementSettings')
            await waitFor("document.querySelector('.avp-enhancement-panel')", 'enhancement panel')
            assert.equal(await js("getComputedStyle(document.querySelector('.avp-enhancement-panel')).width"), '320px', 'enhancement panel retains usable width')
            await js("[...document.querySelectorAll('.avp-enhancement-panel .avp-ep-item')].find(el => el.textContent.includes('效率')).click()")
            await waitFor("document.querySelector('.avp-enhancement-canvas')?.style.display === ''", 'Anime4K visible in actual player')
            await waitFor("document.querySelector('.avp-enhancement-panel').textContent.includes('输出')", 'live enhancement status')
            const dimensions = await js("({width:document.querySelector('.avp-enhancement-canvas').width,height:document.querySelector('.avp-enhancement-canvas').height})")
            assert.ok(dimensions.width >= await js('harness.art.video.videoWidth') && dimensions.width <= 3840 && dimensions.height <= 2160, 'actual player enhancement dimensions stay within 4K')
            assert.ok(await js("Number(getComputedStyle(document.querySelector('.avp-enhancement-canvas')).zIndex)>Number(getComputedStyle(harness.art.video).zIndex)"), 'GPU output is composited above the actual ArtPlayer video')
            await js("document.querySelectorAll('.avp-info-toggle')[1].click()")
            await waitFor("document.querySelector('.avp-compare-overlay')", 'original/enhanced comparison overlay')
            await js("const slider=document.querySelector('.avp-compare-slider');slider.value='37';slider.dispatchEvent(new Event('input',{bubbles:true}))")
            await waitFor("document.querySelector('.avp-enhancement-canvas').style.clipPath.includes('37%')", 'comparison divider updates the enhanced canvas')
            assert.ok(await js("document.querySelector('.avp-compare-labels').textContent.includes('原画')&&document.querySelector('.avp-compare-labels').textContent.includes('增强')"), 'comparison labels identify both real video sides')
            const comparison = await js(`(()=>{
                const line=document.querySelector('.avp-compare-divider').getBoundingClientRect();
                const slider=document.querySelector('.avp-compare-slider');
                const rect=slider.getBoundingClientRect();
                const hit=document.elementFromPoint(rect.left+rect.width*.37,rect.top+rect.height/2);
                return {width:line.width,height:line.height,draggable:hit===slider,hit:hit?.className};
            })()`)
            assert.ok(comparison.width===2 && comparison.height>200 && comparison.draggable, 'comparison divider has visible dimensions and accepts real pointer input: '+JSON.stringify(comparison))
            await js("document.querySelector('.avp-enhancement-panel .avp-ep-close').click()")
            fs.writeFileSync(path.join(root,'dev/player-original-comparison.png'),(await window.webContents.capturePage()).toPNG())
            await openSetting('videoEnhancementSettings')
            await js("document.querySelectorAll('.avp-info-toggle')[1].click()")
            await waitFor("!document.querySelector('.avp-compare-overlay')", 'comparison overlay closes')
            assert.equal(await js("document.querySelector('.avp-enhancement-canvas').style.clipPath"), '', 'closing comparison restores full enhanced picture')
            await js("[...document.querySelectorAll('.avp-enhancement-panel .avp-ep-item')].find(el => el.textContent.includes('运动补偿')).click()")
            await waitFor("document.querySelector('.avp-enhancement-panel .avp-ep-item:last-child')?.textContent.includes('开启')", 'interpolation enabled through UI')
            await js("document.querySelector('.avp-info-toggle').click()")
            await waitFor("document.querySelector('.avp-enhancement-info')?.textContent.includes('输出')", 'stats toggle shows real overlay')
            await js("document.querySelector('.avp-enhancement-panel .avp-ep-close').click(); window.__oldCanvas=document.querySelector('.avp-enhancement-canvas')")
            assert.ok(await js("!!document.querySelector('.avp-enhancement-info')"), 'stats remain visible with panel closed')
            await js('harness.reopen()')
            await waitFor('harness.art?.video.readyState >= 2', 'player reopened after GPU processing')
            await waitFor("document.querySelector('.avp-enhancement-canvas')?.style.display === ''", 'reopening restores saved enhancement')
            assert.ok(await js("!__oldCanvas.isConnected && document.querySelector('.avp-enhancement-canvas')!==__oldCanvas"), 'reopening releases old GPU overlay and creates a new one')
            assert.ok(await js("JSON.parse(localStorage.art_enhancement).interpolate && JSON.parse(localStorage.art_enhancement).mode==='efficiency'"), 'enhancement preferences persist')
            await js('harness.art.pause();harness.art.currentTime=1;harness.art.controls.biliQuality.click()')
            await waitFor("document.querySelector('.avp-quality-panel')", 'quality panel')
            await js("[...document.querySelectorAll('.avp-quality-panel .avp-ep-item')].find(el=>el.textContent.includes('720P')).click()")
            await waitFor("harness.art.video.src.includes('quality64') && harness.art.video.readyState>=2", 'quality source changes')
            await waitFor("document.querySelector('.avp-enhancement-canvas')?.style.display === ''", 'quality change restores enhancement')
            assert.ok(await js('harness.art.video.paused'), 'quality switch preserves pause')
            await js('harness.art.currentTime=2')
            await waitFor('!harness.art.video.seeking', 'seek completes while enhanced and paused')
            assert.ok(await js("!!document.querySelector('.avp-enhancement-canvas') && harness.art.video.paused"), 'paused seek retains enhancement')
            await js('harness.art.play()')
            for (const width of [1280,900,800,640,420]) {
                window.setContentSize(Math.max(width+16,800),760)
                await js("document.querySelector('#app').style.width='"+width+"px';harness.art.controls.show=true")
                await delay(180)
                assert.equal(await js("document.querySelector('.art-progress .art-control-progress').getBoundingClientRect().height"), 6, 'native progress remains 6px at '+width+'px player width')
                const layout=await js(`(()=>{
                    const root=harness.art.template.$player.getBoundingClientRect();
                    const controls=[...document.querySelectorAll('.art-controls-left > .art-control,.art-controls-right > .art-control')].filter(el=>el.getBoundingClientRect().width);
                    return controls.map(el=>({name:el.className,left:el.getBoundingClientRect().left-root.left,right:el.getBoundingClientRect().right-root.left,top:el.getBoundingClientRect().top-root.top,bottom:el.getBoundingClientRect().bottom-root.top,height:root.height,width:root.width}));
                })()`)
                assert.ok(layout.every(b=>b.left>=-1 && b.right<=b.width+1 && b.top>=0 && b.bottom<=b.height+1), 'all controls stay inside player at '+width+'px: '+JSON.stringify(layout))
                if (width >= 800) {
                    assert.ok(Math.abs(layout[0].top-layout.at(-1).top)<4, 'normal-width playback and actions share one row at '+width)
                    const row = await js(`(()=>{
                        const player=harness.art.template.$player.getBoundingClientRect();
                        const controls=document.querySelector('.art-controls');
                        const danmaku=document.querySelector('.art-controls-center .apd-config');
                        const centerY=el=>{const rect=el.getBoundingClientRect();return rect.top+rect.height/2};
                        return {controlsBottom:controls.getBoundingClientRect().bottom,playerBottom:player.bottom,danmakuCenter:danmaku?centerY(danmaku):undefined,leftCenter:centerY(document.querySelector('.art-controls-left .art-control')),rightCenter:centerY(document.querySelector('.art-controls-right .art-control'))};
                    })()`)
                    assert.ok(row.danmakuCenter !== undefined && Math.abs(row.danmakuCenter-row.leftCenter)<4 && Math.abs(row.danmakuCenter-row.rightCenter)<4, 'danmaku controls share the primary control row at '+width+': '+JSON.stringify(row))
                    assert.ok(row.playerBottom-row.controlsBottom<=14, 'control row stays against the video bottom at '+width+': '+JSON.stringify(row))
                }
                if(width===900) {
                    await js("harness.art.controls.show=true;(()=>{const p=document.querySelector('.art-progress'),r=p.getBoundingClientRect();p.dispatchEvent(new PointerEvent('pointerenter',{clientX:r.left+r.width*.6,clientY:r.top+2}))})()")
                    await waitFor("!document.querySelector('.avp-seek-preview canvas').hidden", 'preview for normal layout screenshot')
                    fs.writeFileSync(path.join(root,'dev/player-controls-preview.png'),(await window.webContents.capturePage()).toPNG())
                    await js("document.querySelector('.art-progress').dispatchEvent(new PointerEvent('pointerleave'))")
                }
                await openSetting('videoEnhancementSettings')
                await waitFor("document.querySelector('.avp-enhancement-panel')", 'panel visible at '+width)
                assert.ok(await js("(()=>{const p=document.querySelector('.avp-enhancement-panel').getBoundingClientRect(),r=harness.art.template.$player.getBoundingClientRect();return p.top>=r.top && p.right<=r.right && p.bottom<=r.bottom})()"), 'panel fits player at '+width)
                await js("document.querySelector('.avp-enhancement-body').scrollTop=10000")
                if(width===800) {
                    await js("harness.art.controls.show=true")
                    await delay(350)
                    fs.writeFileSync(path.join(root,'dev/player-controls-glass.png'),(await window.webContents.capturePage()).toPNG())
                }
                await js("document.querySelector('.avp-enhancement-panel .avp-ep-close').click()")
                for (const [control,selector] of [['episodes','.ved-panel'],['biliQuality','.avp-quality-panel']]) {
                    await js('harness.art.controls['+JSON.stringify(control)+'].click()')
                    await waitFor('document.querySelector('+JSON.stringify(selector)+')', control+' panel at '+width)
                    assert.ok(await js("(()=>{const p=document.querySelector("+JSON.stringify(selector)+").getBoundingClientRect(),r=harness.art.template.$player.getBoundingClientRect();return p.left>=r.left && p.top>=r.top && p.right<=r.right+1 && p.bottom<=r.bottom+1})()"), control+' panel fits player at '+width)
                    await js("document.querySelector("+JSON.stringify(selector)+").querySelector('.ved-close, .avp-ep-close').click()")
                }
            }
            await openSetting('videoEnhancementSettings')
            await js('document.querySelector(".avp-info-toggle").click()')
            await waitFor("!document.querySelector('.avp-enhancement-info')", 'stats toggle hides overlay without disabling enhancement')
            assert.ok(await js("!!document.querySelector('.avp-enhancement-canvas')"), 'hiding stats keeps enhancement active')
            await js("[...document.querySelectorAll('.avp-enhancement-panel .avp-ep-item')].find(el=>el.textContent.includes('运动补偿')).click()")
            await waitFor("!document.querySelector('.avp-enhancement-panel .avp-ep-item:last-child').disabled", 'interpolation disabled')
            await js("document.querySelector('.avp-enhancement-panel .avp-ep-item').click()")
            await waitFor("!document.querySelector('.avp-enhancement-canvas')", 'native picture restored')
            await js('harness.reopen()')
            await waitFor('harness.art?.video.readyState>=2', 'reopened with enhancement disabled')
            assert.ok(await js("!document.querySelector('.avp-enhancement-canvas') && JSON.parse(localStorage.art_enhancement).mode==='off' && !JSON.parse(localStorage.art_enhancement).interpolate"), 'disabled enhancement stays disabled after reopen')
            for (const withDanmaku of [true,false]) {
                if (!withDanmaku) { await js('harness.state.danmaku=[];harness.reopen()'); await waitFor('harness.art?.video.readyState>=2','plain video without danmaku') }
                for (const width of [660,600,420]) {
                    await js("document.querySelector('#app').style.width='"+width+"px';harness.art.controls.show=true")
                    await delay(350)
                    const row=await js(`(()=>{const root=harness.art.template.$player.getBoundingClientRect(),controls=document.querySelector('.art-controls').getBoundingClientRect(),button=document.querySelector('.art-controls-left .art-control').getBoundingClientRect(),center=document.querySelector('.art-controls-center');return {height:controls.height,gap:root.bottom-button.bottom,hasSecond:getComputedStyle(center).display!=='none'&&!!center.children.length}})()`)
                    assert.equal(row.height,row.hasSecond?72:36,'compact controls reserve only populated rows at '+width+'px: '+JSON.stringify(row))
                    assert.ok(row.gap <= (row.hasSecond?50:14), 'compact controls stay at video bottom at '+width+'px: '+JSON.stringify(row))
                    if(width===600&&!withDanmaku) fs.writeFileSync(path.join(root,'dev/player-small-controls.png'),(await window.webContents.capturePage()).toPNG())
                }
            }
            console.log('ArtPlayer UI: responsive controls, real overlay toggle, persistent enhancement, GPU cleanup passed', dimensions)
        }
    }
    assert.deepEqual(errors, [], 'no Web Audio or media security failures')
    console.log(JSON.stringify({ success: true, checks: results }, null, 2))
}).catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(async () => {
    if (window && !window.isDestroyed()) window.destroy()
    // Chromium can retain profile locks briefly; leave test artifacts in OS temp.
    app.exit(process.exitCode || 0)
})
