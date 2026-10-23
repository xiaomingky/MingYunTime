// Anime4K CNN upscaling plus GPU bidirectional block-motion interpolation.
// All processing stays local. No restricted neural interpolation weights.
export const enhancementModes = [
    { value: 'off', label: '关闭' },
    { value: 'efficiency', label: 'Anime4K · 4K 效率' },
    { value: 'quality', label: 'Anime4K · 4K 质量' },
]
export function outputDimensions(width, height, enabled) {
    if (!width || !height) throw new Error('请等待视频画面加载后再开启')
    const factor = enabled ? Math.max(1, Math.min(3840 / width, 2160 / height, 4)) : 1
    return { width: Math.round(width * factor), height: Math.round(height * factor) }
}
// RVFC delivery can vary by several milliseconds. Advance one delayed media
// clock instead of restarting interpolation from zero on every callback.
export function interpolationSample(now, presentationTime, previousMedia, currentMedia, rate, lastPresentedMedia) {
    const duration = currentMedia - previousMedia
    const elapsed = Math.max(0, now - presentationTime) * Math.max(.01, rate) / 1000
    const mediaTime = Math.min(currentMedia, Math.max(previousMedia + elapsed, lastPresentedMedia))
    return { mediaTime, fraction: duration > 0 ? Math.max(0, Math.min(1, (mediaTime - previousMedia) / duration)) : 1 }
}
const quad = `
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vert(@builtin(vertex_index) i:u32)->V {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
 var o:V;o.pos=vec4f(p[i],0,1);o.uv=vec2f((p[i].x+1)*.5,(1-p[i].y)*.5);return o;
}`
const motion = `
@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var out:texture_storage_2d<rgba16float,write>;
fn lum(tex:texture_2d<f32>,p:vec2i,sz:vec2i)->f32 {
 let d=vec2i(textureDimensions(tex));let q=clamp(p*d/sz,vec2i(0),d-1);
 return dot(textureLoad(tex,q,0).rgb,vec3f(.299,.587,.114));
}
fn cost(p:vec2i,v:vec2i,sz:vec2i)->f32 {
 var s=0.;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let q=p+vec2i(x,y)*2;s+=abs(lum(a,q,sz)-lum(b,q+v,sz));}}return s/9.;
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 let sz=vec2i(textureDimensions(out));let p=vec2i(id.xy);if(any(p>=sz)){return;}
 var best=vec2i(0);let baseline=cost(p,best,sz);var score=baseline;
 // Sub-codec noise is not motion. Do not let grain pick a different search
 // minimum on every frame and turn into crawling dots in the interpolator.
 if(baseline<.012){textureStore(out,p,vec4f(0,0,baseline,0));return;}
 for(var y=-8;y<=8;y+=2){for(var x=-8;x<=8;x+=2){
 let v=vec2i(x,y);let c=cost(p,v,sz)+length(vec2f(v))*.0004;
 if(c<score){score=c;best=v;}}}
 let center=best;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let v=center+vec2i(x,y);let c=cost(p,v,sz)+length(vec2f(v))*.0004;
 if(c<score){score=c;best=v;}}}
 var low=1.;var high=0.;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let value=lum(a,p+vec2i(x,y)*2,sz);low=min(low,value);high=max(high,value);
 }}
 let confidence=smoothstep(.05,.18,high-low)*smoothstep(.15,.5,(baseline-score)/max(baseline,.012));
 textureStore(out,p,vec4f(vec2f(best)/vec2f(sz),score,confidence));
}`
const smoothMotion = `
@group(0) @binding(0) var input:texture_2d<f32>;
@group(0) @binding(1) var out:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 let sz=vec2i(textureDimensions(out));let p=vec2i(id.xy);if(any(p>=sz)){return;}
 var xs:array<f32,9>;var ys:array<f32,9>;var samples:array<vec4f,9>;var i=0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let value=textureLoad(input,clamp(p+vec2i(x,y),vec2i(0),sz-1),0);
 samples[i]=value;xs[i]=value.x;ys[i]=value.y;i++;
 }}
 for(var a=0;a<8;a++){for(var b=a+1;b<9;b++){
 let lowX=min(xs[a],xs[b]);let highX=max(xs[a],xs[b]);xs[a]=lowX;xs[b]=highX;
 let lowY=min(ys[a],ys[b]);let highY=max(ys[a],ys[b]);ys[a]=lowY;ys[b]=highY;
 }}
 let median=vec2f(xs[4],ys[4]);var confidence=0.;
 for(var n=0;n<9;n++){
 let agreement=1.-smoothstep(1.,2.5,length((samples[n].xy-median)*vec2f(sz)));
 confidence+=samples[n].w*agreement;
 }
 let center=textureLoad(input,p,0);
 textureStore(out,p,vec4f(median,center.z,confidence/9.));
}`
const present = quad + `
@group(0) @binding(0) var s:sampler;
@group(0) @binding(1) var a:texture_2d<f32>;
@group(0) @binding(2) var b:texture_2d<f32>;
@group(0) @binding(3) var ab:texture_2d<f32>;
@group(0) @binding(4) var ba:texture_2d<f32>;
@group(0) @binding(5) var<uniform> state:vec4f;
@fragment fn frag(v:V)->@location(0) vec4f {
 let uv=v.uv;let t=state.x;
 if(state.y<.5){return textureSampleLevel(b,s,uv,0);}
 let f=textureSampleLevel(ab,s,uv,0);let r=textureSampleLevel(ba,s,uv,0);
 // Always preserve both endpoints. Returning the newest frame on a failed
 // match used to jump forward, then jump back as motion matching recovered.
 let originalA=textureSampleLevel(a,s,uv,0);
 let originalB=textureSampleLevel(b,s,uv,0);
 if(t<=0.){return originalA;}if(t>=1.){return originalB;}
 let reverseF=textureSampleLevel(ba,s,clamp(uv+f.xy,vec2f(0),vec2f(1)),0);
 let reverseR=textureSampleLevel(ab,s,clamp(uv+r.xy,vec2f(0),vec2f(1)),0);
 let consistency=max(length(f.xy+reverseF.xy),length(r.xy+reverseR.xy));
 let confidence=min(f.w,r.w)*(1.-smoothstep(.025,.12,max(f.z,r.z)))*(1.-smoothstep(.004,.025,consistency));
 let x=textureSampleLevel(a,s,clamp(uv-f.xy*t,vec2f(0),vec2f(1)),0);
 let y=textureSampleLevel(b,s,clamp(uv-r.xy*(1.-t),vec2f(0),vec2f(1)),0);
 return mix(mix(originalA,originalB,t),mix(x,y,t),confidence);
}`

export async function createVideoEnhancement({ video, container, mode = 'off', interpolate = false, onStatus = () => {}, onError = () => {} }) {
    if (!navigator.gpu) throw new Error('当前设备未提供 WebGPU，无法启用视频增强')
    if (!video.videoWidth || video.readyState < 2) throw new Error('请等待视频画面加载后再开启')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('显卡不支持 WebGPU，请检查显卡驱动和硬件加速')
    const device = await adapter.requestDevice()
    const canvas = document.createElement('canvas')
    canvas.className = 'avp-enhancement-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    // ArtPlayer's video is at z-index 10; keep GPU output above it and below
    // danmaku (40), playback controls (60), and settings (90).
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', pointerEvents: 'none', zIndex: '20', display: 'none' })
    const setComparison = position => {
        canvas.style.clipPath = position == null ? '' : `inset(0 0 0 ${Math.max(0, Math.min(100, Number(position) || 0))}%)`
    }
    const sw = video.videoWidth, sh = video.videoHeight
    const target = outputDimensions(sw, sh, mode !== 'off')
    if (sw > 3840 || sh > 2160) { device.destroy(); throw new Error('超过 4K 的视频暂不支持实时增强') }
    const gpuContext = canvas.getContext('webgpu')
    if (!gpuContext) { device.destroy(); throw new Error('无法创建 WebGPU 画面') }
    const format = navigator.gpu.getPreferredCanvasFormat()
    canvas.width = target.width; canvas.height = target.height
    gpuContext.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    let stopped = false, vf = 0, raf = 0, haveFrame = false, pair = false
    let lastMedia = -1, previousMedia = -1, lastPresentedMedia = -1, lastWall = 0, interval = 1000 / 24, submitted = false
    let statusAt = performance.now(), displayed = 0, inputFrames = 0
    let pipelines = [], pending = 0, presenting = false, slowFrames = 0
    let processingTotal = 0, processingCount = 0, processingMax = 0, skippedFrames = 0
    let drawnMedia = -1, drawnFraction = -1, drawnPair = false
    let frameRevision = 0
    const textures = [], buffers = [], listeners = []
    const texture = (w, h, extra = 0) => {
        const t = device.createTexture({ label:'avp-enhancement-frame', size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | extra })
        textures.push(t);return t
    }
    const stop = () => {
        if (stopped) return
        stopped = true
        video.cancelVideoFrameCallback?.(vf); cancelAnimationFrame(raf)
        for (const [name, fn] of listeners) video.removeEventListener(name, fn)
        canvas.remove()
        gpuContext.unconfigure()
        for (const t of textures) t.destroy()
        for (const buffer of buffers) buffer.destroy()
        device.destroy()
    }
    const fail = error => { if (stopped) return; stop(); onError(error?.message || '显卡处理失败，已恢复原始视频') }
    try {
        const input = texture(sw, sh)
        let output = input
        if (mode !== 'off') {
            const module = await import('anime4k-webgpu')
            const api = module.default || module
            if (stopped) return { stop }
            const append = C => { const p = new C({ device, inputTexture: output });pipelines.push(p);output = p.getOutputTexture() }
            // Above 1080p, restore with the CNN before final scaling. Smaller
            // sources always pass through a trained 2x upscale CNN below.
            if (mode === 'quality' || sw > 1920 || sh > 1080) append(api.CNNM)
            // Limit intermediate allocations: 2x input stages, capped at 4K.
            if (target.width > sw * 1.15 && sw * 2 <= 4096 && sh * 2 <= 2304) append(mode === 'quality' ? api.CNNx2VL : api.CNNx2M)
            if (target.width > output.width * 1.15 && output.width * 2 <= 4096 && output.height * 2 <= 2304) append(api.CNNx2M)
            const resize = new api.Downscale({ device, inputTexture: output, targetDimensions: target })
            pipelines.push(resize);output = resize.getOutputTexture()
        }
        const ow = output.width, oh = output.height
        const current = texture(ow, oh)
        // A second 4K rgba16float frame costs about 63 MiB. Super-resolution
        // alone never reads a previous frame, so share its current texture.
        const previous = interpolate ? texture(ow, oh) : current
        const fw = Math.min(240, sw), fh = Math.max(8, Math.round(sh * fw / sw))
        // Estimate motion on filtered source frames. Searching sparse pixels
        // directly in a 4K CNN texture aliases fine detail and wastes bandwidth.
        const motionPrevious = interpolate ? texture(fw,fh) : null
        const motionCurrent = interpolate ? texture(fw,fh) : null
        const forward = texture(interpolate?fw:1, interpolate?fh:1, GPUTextureUsage.STORAGE_BINDING)
        const backward = interpolate ? texture(fw,fh,GPUTextureUsage.STORAGE_BINDING) : forward
        const rawForward = interpolate ? texture(fw,fh,GPUTextureUsage.STORAGE_BINDING) : null
        const rawBackward = interpolate ? texture(fw,fh,GPUTextureUsage.STORAGE_BINDING) : null
        const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        buffers.push(uniform)
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
        // Upstream CNN output textures are sampleable render targets, without
        // COPY_SRC usage. Transfer them with a render pass, never a texture copy.
        const copyShader = device.createShaderModule({ code: quad + `
            @group(0) @binding(0) var s:sampler;
            @group(0) @binding(1) var tex:texture_2d<f32>;
            @fragment fn copy(v:V)->@location(0) vec4f { return textureSample(tex,s,v.uv); }` })
        const copyPipeline = device.createRenderPipeline({ layout:'auto', vertex:{module:copyShader,entryPoint:'vert'}, fragment:{module:copyShader,entryPoint:'copy',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'} })
        const copyBind = device.createBindGroup({layout:copyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:output.createView()}]})
        const transfer = (encoder, target) => { const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(copyPipeline);pass.setBindGroup(0,copyBind);pass.draw(3);pass.end() }
        const shader = device.createShaderModule({ code: present })
        const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vert' }, fragment: { module: shader, entryPoint: 'frag', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
        const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: sampler }, ...[previous,current,forward,backward].map((t,i) => ({ binding: i+1, resource: t.createView() })), { binding: 5, resource: { buffer: uniform } },
        ] })
        const flowPipeline = interpolate ? device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: motion }), entryPoint: 'main' } }) : null
        const flowBind = (a,b,out) => device.createBindGroup({ layout: flowPipeline.getBindGroupLayout(0), entries: [a,b,out].map((t,binding) => ({ binding, resource: t.createView() })) })
        const flowAB = interpolate && flowBind(motionPrevious,motionCurrent,rawForward), flowBA = interpolate && flowBind(motionCurrent,motionPrevious,rawBackward)
        const smoothPipeline = interpolate && device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:smoothMotion}),entryPoint:'main'}})
        const smoothBind = (source,target) => device.createBindGroup({layout:smoothPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:target.createView()}]})
        const smoothGroups = interpolate ? [smoothBind(rawForward,forward),smoothBind(rawBackward,backward)] : []
        const motionShader = interpolate && device.createShaderModule({code:quad+`
            @group(0) @binding(0) var s:sampler;
            @group(0) @binding(1) var image:texture_2d<f32>;
            @fragment fn downsample(v:V)->@location(0) vec4f {
                var color=vec4f(0);let step=vec2f(${1/(fw*3)},${1/(fh*3)});
                for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
                    color+=textureSampleLevel(image,s,clamp(v.uv+vec2f(f32(x),f32(y))*step,vec2f(0),vec2f(1)),0);
                }}return color/9.;
            }`})
        const motionPipeline = interpolate && device.createRenderPipeline({layout:'auto',vertex:{module:motionShader,entryPoint:'vert'},fragment:{module:motionShader,entryPoint:'downsample',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}})
        const motionBind = interpolate && device.createBindGroup({layout:motionPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:input.createView()}]})
        device.addEventListener('uncapturederror', event => fail(event.error))
        device.lost.then(info => { if (!stopped) fail(new Error('显卡设备已重置：' + info.reason)) })
        const capture = (wall, metadata) => {
            if (stopped) return
            vf = video.requestVideoFrameCallback(capture)
            if (video.videoWidth !== sw || video.videoHeight !== sh) { fail(new Error('视频分辨率已变化，请重新开启增强'));return }
            if (pending > 0) { skippedFrames++; return }
            if (metadata.mediaTime === lastMedia) return
            try {
                const dt = metadata.mediaTime - lastMedia
                pair = interpolate && haveFrame && !video.seeking && dt > .005 && dt < .2
                previousMedia = lastMedia
                if (!pair) lastPresentedMedia = metadata.mediaTime
                interval = pair ? Math.min(200,Math.max(8,dt * 1000 / video.playbackRate)) : interval
                canvas.style.objectFit = getComputedStyle(video).objectFit || 'contain'
                canvas.style.objectPosition = getComputedStyle(video).objectPosition || '50% 50%'
                const encoder = device.createCommandEncoder()
                if (interpolate && haveFrame) encoder.copyTextureToTexture({ texture: current },{ texture: previous },[ow,oh])
                device.queue.copyExternalImageToTexture({ source: video },{ texture: input },[sw,sh])
                pipelines.forEach(p => p.pass(encoder))
                transfer(encoder,current)
                if (interpolate && !haveFrame) transfer(encoder,previous)
                if (interpolate) {
                    if (haveFrame) encoder.copyTextureToTexture({texture:motionCurrent},{texture:motionPrevious},[fw,fh])
                    const pass=encoder.beginRenderPass({colorAttachments:[{view:motionCurrent.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]})
                    pass.setPipeline(motionPipeline);pass.setBindGroup(0,motionBind);pass.draw(3);pass.end()
                    if (!haveFrame) encoder.copyTextureToTexture({texture:motionCurrent},{texture:motionPrevious},[fw,fh])
                }
                if (pair) for (const group of [flowAB,flowBA]) { const pass=encoder.beginComputePass();pass.setPipeline(flowPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(fw/8),Math.ceil(fh/8));pass.end() }
                if (pair) for (const group of smoothGroups) { const pass=encoder.beginComputePass();pass.setPipeline(smoothPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(fw/8),Math.ceil(fh/8));pass.end() }
                const started = performance.now()
                const revision = frameRevision
                device.queue.submit([encoder.finish()]);pending++
                device.queue.onSubmittedWorkDone().then(() => {
                    pending--
                    if (stopped || revision !== frameRevision) return
                    const processingMs = performance.now()-started
                    processingTotal += processingMs; processingCount++; processingMax = Math.max(processingMax,processingMs)
                    // Keep the real video composited behind the opaque canvas:
                    // visibility:hidden can throttle Chromium's decoded frames.
                    if (!submitted) { submitted=true;canvas.style.display='' }
                    slowFrames = processingMs > 200 ? slowFrames+1 : 0
                    if (slowFrames >= 8) fail(new Error('显卡处理持续超时，已关闭增强恢复原始视频；请降低档位'))
                }).catch(fail)
                haveFrame=true;lastMedia=metadata.mediaTime;lastWall=metadata.expectedDisplayTime ?? wall;inputFrames++
            } catch(error) { fail(error) }
        }
        const draw = now => {
            if (stopped) return
            raf=requestAnimationFrame(draw)
            if (now-statusAt>=1000) {
                onStatus({ sourceWidth:sw,sourceHeight:sh,width:target.width,height:target.height,sourceFps:Math.round(inputFrames*1000/(now-statusAt)),displayFps:Math.round(displayed*1000/(now-statusAt)),interpolate,algorithm:'双向运动估计',latencyMs:interpolate?Math.round(interval):0,processingMs:processingCount?processingTotal/processingCount:0,processingMaxMs:processingMax,skippedFrames })
                displayed=0;inputFrames=0;statusAt=now
                processingTotal=0;processingCount=0;processingMax=0;skippedFrames=0
            }
            if (!haveFrame || video.seeking || pending > 0 || presenting) return
            try {
                const sample = interpolationSample(now,lastWall,previousMedia,lastMedia,video.playbackRate,lastPresentedMedia)
                const t = video.paused || !pair ? 1 : sample.fraction
                lastPresentedMedia = t === 1 ? lastMedia : sample.mediaTime
                // One source frame needs one upscale presentation. A paused
                // picture or a finished interpolation must not redraw at 165Hz.
                if (drawnMedia === lastMedia && drawnPair === pair && Math.abs(drawnFraction-t)<.001) return
                device.queue.writeBuffer(uniform,0,new Float32Array([t,pair?1:0,0,0]))
                const encoder=device.createCommandEncoder(), pass=encoder.beginRenderPass({ colorAttachments:[{view:gpuContext.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}] })
                pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);displayed++
                drawnMedia=lastMedia;drawnFraction=t;drawnPair=pair
                presenting=true
                device.queue.onSubmittedWorkDone().then(()=>{presenting=false}).catch(fail)
            } catch(error) { fail(error) }
        }
        const reset = () => { frameRevision++;pair=false;haveFrame=false;lastMedia=-1;previousMedia=-1;lastPresentedMedia=-1;drawnMedia=-1;drawnFraction=-1;canvas.style.display='none';submitted=false }
        for (const name of ['seeking','emptied','loadedmetadata','enterpictureinpicture','ratechange','playing']) { video.addEventListener(name,reset);listeners.push([name,reset]) }
        container.appendChild(canvas)
        vf=video.requestVideoFrameCallback(capture);raf=requestAnimationFrame(draw)
        // Paused videos need one decoded frame even without another RVFC.
        if (video.paused) { video.cancelVideoFrameCallback(vf);capture(performance.now(),{mediaTime:video.currentTime}) }
        // Read the actual GPU output before presentation discards the swapchain
        // texture. Also useful for correct screenshots of the enhanced picture.
        const readPixels = async (fraction = 1) => {
            if (stopped || !haveFrame) throw new Error('增强画面尚未准备好')
            device.queue.writeBuffer(uniform,0,new Float32Array([Math.max(0,Math.min(1,fraction)),pair?1:0,0,0]))
            const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256
            const buffer = device.createBuffer({size:bytesPerRow*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})
            try {
                const encoder = device.createCommandEncoder(), frame = gpuContext.getCurrentTexture()
                const pass = encoder.beginRenderPass({colorAttachments:[{view:frame.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]})
                pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end()
                encoder.copyTextureToBuffer({texture:frame},{buffer,bytesPerRow},[canvas.width,canvas.height])
                device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ)
                const data = Array.from(new Uint8Array(buffer.getMappedRange()))
                return {data,bytesPerRow,width:canvas.width,height:canvas.height,format,pair}
            } finally { if (buffer.mapState === 'mapped') buffer.unmap();buffer.destroy() }
        }
        return { stop, canvas, device, readPixels, setComparison, sourceWidth: sw, sourceHeight: sh }
    } catch(error) { stop();throw error }
}
