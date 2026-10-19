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
    await js('harness.art.controls.gainBoost.click()')
    await waitFor("document.querySelector('.avp-gain-panel')", 'gain panel')
    await js("[...document.querySelectorAll('.avp-gain-panel .avp-ep-item')].find(el => el.textContent.trim() === " + JSON.stringify(gain * 100 + '%') + ').click()')
    await waitFor("localStorage.getItem('art_gain_boost') === '" + gain + "'", 'persisted gain')
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
        const state = reactive({src:url,audioUrl:'',playType:'direct',autoplay:true}), player = ref(null)
        createApp({setup:()=>()=>h(ArtVideoPlayer,{...state,ref:player})}).mount('#app')
        window.harness = {state, get art(){return player.value?.art}, async reopen(){state.src=''; await nextTick(); await new Promise(r=>setTimeout(r,30)); state.src=url}}
    }
    const entry = "import { createApp, h, reactive, ref, nextTick } from 'vue'; import ArtVideoPlayer from " + JSON.stringify(path.join(root, 'src/components/ArtVideoPlayer.vue').replaceAll('\\', '/')) + '; (' + setup.toString() + ')(' + JSON.stringify(url) + ')'
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
        await waitFor('harness.art?.video.videoWidth > 0 && harness.art?.video.readyState >= 2', 'real local video decoded')
        await measure('real local video with picture and boosted audio', 5)
        await js('harness.art.currentTime = 2')
        await measure('real local video seek keeps boosted output', 5)
    }
    assert.deepEqual(errors, [], 'no Web Audio or media security failures')
    console.log(JSON.stringify({ success: true, checks: results }, null, 2))
}).catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(async () => {
    if (window && !window.isDestroyed()) window.destroy()
    // Chromium can retain profile locks briefly; leave test artifacts in OS temp.
    app.exit(process.exitCode || 0)
})
