import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import vm from 'node:vm'
import {Transform} from 'node:stream'
import {pipeline,finished} from 'node:stream/promises'
import {once} from 'node:events'
import axios from 'axios'
import {resolveDownloadLink,responseDownloadName,safeDownloadName} from '../electron/download-resolver.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'mingyun-download-center-'))
const handlers=new Map(),events=[]
const payload=Buffer.alloc(1024*1024+77,27)
let ranges=0
const server=http.createServer((req,res)=>{
    if(req.url==='/wrapper'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<a download href="/file">下载文件</a>');return}
    if(req.headers.cookie!=='protected=fixture'){res.writeHead(403);res.end();return}
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''%E7%9C%9F%E5%AE%9E%E6%96%87%E4%BB%B6.flac")
    res.setHeader('Content-Type','audio/flac')
    res.setHeader('Content-Length',payload.length)
    if(req.url==='/file')res.setHeader('Accept-Ranges','bytes')
    if(req.method==='HEAD'){res.end();return}
    const range=req.url==='/file' && req.headers.range?.match(/bytes=(\d+)-(\d+)/)
    if(range){ranges++;const a=Number(range[1]),b=Number(range[2]);res.writeHead(206,{'Content-Length':b-a+1,'Content-Range':'bytes '+a+'-'+b+'/'+payload.length});res.end(payload.subarray(a,b+1))}
    else res.end(payload)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const source=fs.readFileSync(new URL('../electron/download-manager.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
const sandbox={fs,path,http,https,Buffer,URL,AbortController,Date,Math,setImmediate,setTimeout,console,axios,Transform,pipeline,finished,once,
    resolveDownloadLink,responseDownloadName,safeDownloadName,
    process:{resourcesPath:root,cwd:()=>root,env:{APP_ROOT:root}},
    app:{isPackaged:false,getPath:()=>root,whenReady:()=>Promise.resolve()},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},nativeImage:{},spawn(){throw Error('not expected')}
}
vm.createContext(sandbox)
vm.runInContext(source+'\nglobalThis.testApi={setDownloadManagerWindow,httpsAgent,httpAgent};',sandbox)
sandbox.testApi.setDownloadManagerWindow({webContents:{send:(channel,data)=>events.push({channel,data:{...data}})}})
const invoke=(name,params)=>handlers.get(name)(null,params)
async function settle(id){
    for(let i=0;i<500;i++){
        const task=(await invoke('download:list')).data.find(t=>t.id===id)
        if(['done','error','canceled'].includes(task?.status))return task
        await new Promise(r=>setTimeout(r,10))
    }
    throw Error('download timeout')
}
try{
    const url='http://127.0.0.1:'+server.address().port
    const headers={Cookie:'protected=fixture'}
    const probe=await invoke('download:probe-name',{url:url+'/wrapper',headers})
    assert.equal(probe.name,'真实文件.flac');assert.equal(probe.headers,undefined,'probe never returns private headers')
    for(const [endpoint,name,autoName,expected,threads] of [
        ['/wrapper','',true,'真实文件.flac',128],
        ['/wrapper','自定义名称',false,'自定义名称.flac',32],
        ['/wrapper','自定.flac',false,'自定.flac',64],
        ['/plain','',true,'真实文件 (1).flac',128]
    ]){
        ranges=0
        const started=await invoke('download:start',{url:url+endpoint,name,autoName,resolveLink:true,headers,threads})
        assert.ok(started.success)
        const task=await settle(started.downloadId)
        assert.equal(task.status,'done',task.error)
        assert.equal(path.basename(task.path),expected)
        assert.ok(fs.readFileSync(task.path).equals(payload),'actual file bytes are complete')
        assert.equal(ranges,endpoint==='/plain'?0:threads,'engine uses selected real connection count')
        assert.ok(events.some(e=>e.channel==='download:done'&&e.data.id===task.id&&e.data.path===task.path),'center sees final path')
        assert.ok(events.some(e=>e.channel==='video-download-done'&&e.data.downloadId===task.id),'toast sees completion')
    }
    const rejected=await invoke('download:start',{url:url+'/wrapper',resolveLink:true})
    assert.equal(rejected.success,false);assert.match(rejected.error,/403/)
    console.log('Download center integration passed: real HTTP wrapper, headers, final names/extensions, manual override, 32/64/128 ranges, non-Range fallback, file integrity, center/toast and refusal.')
}finally{
    sandbox.testApi.httpAgent.destroy();sandbox.testApi.httpsAgent.destroy()
    server.closeAllConnections();server.close()
    await fs.promises.rm(root,{recursive:true,force:true})
}
