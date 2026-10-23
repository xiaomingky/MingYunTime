// Real Chromium/WebGPU integration, synthetic local video; no external requests.
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-enhance-'))
app.setPath('userData', path.join(temp, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
protocol.registerSchemesAsPrivileged([{ scheme: 'local-file', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])
let win, checks = 0
const errors = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = code => win.webContents.executeJavaScript(code, true)
async function until(code, label) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) { if (await js(code)) return; await delay(100) }
    throw Error('Timed out: ' + label + ' ' + JSON.stringify(await js('({failure:window.failure,status:window.lastStatus})')))
}
app.whenReady().then(async () => {
    // Generate a moving-square source in Chromium, without FFmpeg encoders.
    const generate = async function (width=128,height=72,contrast=false,fps=12) {
        const source = document.createElement('canvas'); source.width = width; source.height = height
        const ctx = source.getContext('2d'), stream = source.captureStream(fps), parts = []
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
        recorder.ondataavailable = event => parts.push(event.data)
        let x = 0
        const paint = () => {
            if(contrast==='noise') {
                const image=ctx.createImageData(width,height);let seed=++x;
                for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=124+(seed>>>28&7);image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255}
                ctx.putImageData(image,0,0);return
            }
            ctx.fillStyle = contrast ? (x++%2?'#fff':'#000') : '#112233'; ctx.fillRect(0,0,width,height); if(!contrast){ctx.fillStyle = '#fff'; ctx.fillRect(x++ % 100,20,16,16)}
        }
        paint(); const timer = setInterval(paint, 1000 / fps)
        const ended = new Promise(resolve => { recorder.onstop = resolve }); recorder.start()
        await new Promise(resolve => setTimeout(resolve, 2200)); recorder.stop(); await ended
        clearInterval(timer); stream.getTracks().forEach(track => track.stop())
        v.src = URL.createObjectURL(new Blob(parts, {type:'video/webm'})); v.loop = true; await v.play()
    }
    const entry = [
        "import {createVideoEnhancement,outputDimensions} from " + JSON.stringify(path.join(root,'src/utils/video-enhancement.js').replaceAll('\\','/')) + ';',
        `window.allocations=[];const createTexture=GPUDevice.prototype.createTexture;GPUDevice.prototype.createTexture=function(spec){const size=spec.size;window.allocations.push({label:spec.label,width:size.width??size[0],height:size.height??size[1]});return createTexture.call(this,spec)};`,
        'window.errors=[];window.dimensions=outputDimensions;const v=document.querySelector("video");window.generate=' + generate.toString() + ';window.generate();',
        'window.start=async function(mode,interpolate){window.handle&&window.handle.stop();window.allocations=[];window.failure="";window.lastStatus=null;window.handle=await createVideoEnhancement({video:v,container:document.querySelector("#player"),mode,interpolate,onError:function(e){window.failure=e;window.errors.push(e)},onStatus:function(s){window.lastStatus=s}})}'
    ].join(String.fromCharCode(10))
    const html = path.join(temp, 'fixture.html'), output = path.join(temp, 'site')
    fs.writeFileSync(html, '<!doctype html><style>#player{position:relative;width:800px;height:450px}video{width:100%;height:100%}</style><div id="player"><video muted></video></div><script type="module" src="/__enhancement.js"></script>')
    const build = "const {build}=await import('vite');await build({configFile:false,root:" + JSON.stringify(temp) + ",base:'./',logLevel:'warn',plugins:[{name:'fixture',resolveId(id){if(id==='/__enhancement.js')return '\\0entry'},load(id){if(id==='\\0entry')return " + JSON.stringify(entry) + "}}],build:{outDir:" + JSON.stringify(output) + ',emptyOutDir:false,minify:false,rollupOptions:{input:' + JSON.stringify(html) + '}}})'
    execFileSync('node', ['--input-type=module','-e',build], {cwd:root,stdio:'inherit',timeout:60000,windowsHide:true})
    win = new BrowserWindow({show:false,width:900,height:600,webPreferences:{backgroundThrottling:false}})
    win.showInactive()
    win.webContents.on('console-message', event => { if (/validation|WGSL|GPUError|uncaptured/i.test(event.message)) errors.push(event.message) })
    await win.loadFile(html.replace('fixture.html', 'site/fixture.html'))
    await until('window.start && document.querySelector("video").readyState>=2', 'video decode')
    const adapter = await js('(async function(){const a=await navigator.gpu?.requestAdapter();return a?{info:a.info,features:[...a.features]}:null})()')
    console.log('WebGPU adapter:', JSON.stringify(adapter))
    if (!adapter) throw new Error('This machine has no WebGPU adapter; real GPU checks cannot run')
    assert.deepEqual(await js('dimensions(1920,1080,true)'), {width:3840,height:2160}); checks++
    for (const [mode, interpolate] of [['off',true],['efficiency',false],['quality',false],['efficiency',true]]) {
        console.log('Testing', mode, 'interpolation:', interpolate)
        await js('window.start(' + JSON.stringify(mode) + ',' + interpolate + ')')
        await until('(window.lastStatus?.sourceFps>0 && window.lastStatus?.displayFps>0) || window.failure', 'GPU enhancement output after shader warmup')
        assert.equal(await js('window.failure'), ''); checks++
        const outputState = await js('({status:window.lastStatus,width:handle.canvas.width,height:handle.canvas.height})')
        assert.ok(outputState.status.displayFps > 0 && await js('document.querySelector("canvas").style.display!=="none" && document.querySelector("video").style.visibility!=="hidden"')); checks++
        await js('handle.setComparison(35)')
        assert.ok(await js('handle.canvas.style.clipPath.includes("35%") && document.querySelector("video").style.visibility!=="hidden"'), 'comparison reveals the original video beside the enhanced canvas'); checks++
        await js('handle.setComparison(null)')
        assert.equal(await js('handle.canvas.style.clipPath'), '', 'comparison can return to the full enhanced frame'); checks++
        console.log(JSON.stringify(outputState))
        if (mode === 'off' && interpolate) {
            const samples = await js(`(async function(){
                document.querySelector('video').pause();await new Promise(r=>setTimeout(r,80));
                const a=await handle.readPixels(0),mid=await handle.readPixels(.5),b=await handle.readPixels(1);
                let fromA=0,fromB=0,lit=0;for(let i=0;i<mid.data.length;i+=4){fromA+=Math.abs(mid.data[i]-a.data[i]);fromB+=Math.abs(mid.data[i]-b.data[i]);lit+=mid.data[i]}
                await document.querySelector('video').play();return {fromA,fromB,lit,pair:mid.pair}
            })()` )
            console.log('GPU pixel evidence:', JSON.stringify(samples))
            assert.ok(samples.pair && samples.fromA>0 && samples.fromB>0 && samples.lit>0, 'interpolated GPU pixels differ from both decoded endpoints');checks++
        }
        await js('document.querySelector("video").currentTime=.5')
        await until('!document.querySelector("video").seeking && handle.canvas.style.display!=="none"', 'recovery after seek'); checks++
        await js('handle.stop()')
        assert.ok(await js('!document.querySelector("canvas") && document.querySelector("video").style.visibility!=="hidden"')); checks++
    }
    // A large brightness change intentionally defeats motion matching. Both
    // decoded endpoints must remain accessible; the old fallback returned B
    // at every interpolation phase, causing visible forward/backward jumps.
    await js('window.generate(128,72,true)')
    await until('document.querySelector("video").readyState>=2','contrast source decoded')
    await js('window.start("off",true)')
    await until('window.lastStatus?.sourceFps>0 || window.failure','contrast interpolation')
    const endpoints = await js(`(async()=>{
        const video=document.querySelector('video');video.pause();await new Promise(r=>setTimeout(r,80));
        const a=await handle.readPixels(0),m=await handle.readPixels(.5),b=await handle.readPixels(1);
        let delta=0,midA=0,midB=0;
        for(let i=0;i<a.data.length;i+=4){delta+=Math.abs(a.data[i]-b.data[i]);midA+=Math.abs(a.data[i]-m.data[i]);midB+=Math.abs(b.data[i]-m.data[i])}
        return {pair:m.pair,delta,midA,midB};
    })()`)
    assert.ok(endpoints.pair && endpoints.delta>1000000 && endpoints.midA>0 && endpoints.midB>0,'uncertain motion preserves endpoint order and a real intermediate picture: '+JSON.stringify(endpoints)); checks++
    console.log('Uncertain-motion GPU endpoint evidence:',JSON.stringify(endpoints))
    await js('handle.stop()')
    await js('window.generate(128,72,"noise",30)')
    await js('window.start("off",true)')
    await until('window.lastStatus?.sourceFps>0 || window.failure','stationary grain interpolation')
    const grain = await js(`(async()=>{
        document.querySelector('video').pause();await new Promise(r=>setTimeout(r,80));
        const a=await handle.readPixels(0),m=await handle.readPixels(.5),b=await handle.readPixels(1);
        let maxError=0,unstablePixels=0;
        for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){
            const i=y*m.bytesPerRow+x*4;const error=Math.abs(m.data[i]-(a.data[i]+b.data[i])/2);
            maxError=Math.max(maxError,error);if(error>2)unstablePixels++;
        }
        return {pair:m.pair,maxError,unstablePixels};
    })()`)
    assert.ok(grain.pair && grain.unstablePixels===0,'static grain never creates displaced bright/dark specks: '+JSON.stringify(grain));checks++
    console.log('Static grain GPU evidence:',JSON.stringify(grain))
    await until('window.lastStatus?.sourceFps===0 && window.lastStatus?.displayFps===0','paused picture stops submitting duplicate GPU draws');checks++
    await js('handle.stop()')
    // Repeated lifecycle changes must release the device, remove old overlays,
    // and resume rendering after seeks and playback-rate changes.
    await js('window.generate(128,72,false,30)')
    for (let cycle=0;cycle<3;cycle++) {
        await js('window.start("off",true)')
        await until('window.lastStatus?.displayFps>0','repeated enhancement startup')
        await js('document.querySelector("video").playbackRate='+[.5,2,1][cycle])
        await until('handle.canvas.style.display!=="none"','rate change rebuilds frame history')
        await js('document.querySelector("video").currentTime=.25')
        await until('!document.querySelector("video").seeking && handle.canvas.style.display!=="none"','repeated seek rebuilds frame history')
        const released=await js('(async()=>{handle.stop();handle.stop();const lost=await handle.device.lost;return {reason:lost.reason,canvases:document.querySelectorAll("canvas").length}})()')
        assert.equal(released.reason,'destroyed');assert.equal(released.canvases,0);checks+=2
    }
    if(process.argv.includes('--4k')) {
        await js('window.generate(1920,1080)');await until('document.querySelector("video").videoWidth===1920','1080p source')
        for (const interpolate of [false,true]) {
            await js('window.start("efficiency",'+interpolate+')');await until('window.lastStatus || window.failure','actual 4K GPU rendering')
            assert.equal(await js('window.failure'),'');
            assert.deepEqual(await js('({width:handle.canvas.width,height:handle.canvas.height})'),{width:3840,height:2160});checks+=2
            if(!interpolate) {
                const fullSize=await js('window.allocations.filter(size=>size.label==="avp-enhancement-frame"&&size.width===3840&&size.height===2160).length')
                assert.equal(fullSize,1,'upscale-only 4K presentation owns one full-size frame, without unused temporal history');checks++
            }
            console.log('Actual 4K GPU output:',JSON.stringify(await js('window.lastStatus')))
            await js('handle.stop()')
        }
    }
    if (process.argv.includes('--stress')) {
        await js('window.generate(1920,1080,false,30)')
        for (const interpolate of [false,true]) {
            await js('window.start("quality",'+interpolate+')')
            await until('window.lastStatus || window.failure','1080p30 quality processing')
            await delay(2500)
            console.log('1080p30 quality stress:',JSON.stringify(await js('window.lastStatus')))
            assert.equal(await js('window.failure'),'');checks++
            await js('handle.stop()')
        }
    }
    assert.deepEqual(await js('window.errors'), []); assert.deepEqual(errors, []); checks += 2
    console.log('Video enhancement: ' + checks + ' real GPU assertions passed; synthetic video, no network.')
}).catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => { win?.destroy(); app.exit(process.exitCode || 0) })
