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
import {spawn as realSpawn,spawnSync} from 'node:child_process'
import {resolveDownloadLink,responseDownloadName,safeDownloadName} from '../electron/download-resolver.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'mingyun-download-center-'))
const handlers=new Map(),events=[]
const tool=path.resolve('resources/ffmpeg.exe')
const run=args=>{const r=spawnSync(tool,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr)}
run(['-y','-i',path.resolve('video/samples/原创演示视频.mp4'),'-map','0:v:0','-an','-c','copy',path.join(root,'v.mp4')])
run(['-y','-i',path.resolve('video/samples/轻轻靠近.mp3'),'-t','1','-vn','-c:a','aac',path.join(root,'a.mp4')])
const video=fs.readFileSync(path.join(root,'v.mp4')),audio=fs.readFileSync(path.join(root,'a.mp4'))
let merges=0,failMerge=false
let ranges=0
const server=http.createServer((req,res)=>{
    const payload=req.url==='/video'?video:audio
    if(req.url==='/wrapper'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<a download href="/file">下载文件</a>');return}
    if(req.headers.cookie!=='protected=fixture'){res.writeHead(403);res.end();return}
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''%E7%9C%9F%E5%AE%9E%E6%96%87%E4%BB%B6.flac")
    res.setHeader('Content-Type','audio/flac')
    res.setHeader('Content-Length',payload.length)
    if(req.url!=='/plain')res.setHeader('Accept-Ranges','bytes')
    if(req.method==='HEAD'){res.end();return}
    const range=req.url!=='/plain' && req.headers.range?.match(/bytes=(\d+)-(\d+)/)
    if(range){ranges++;const a=Number(range[1]),b=Number(range[2]);res.writeHead(206,{'Content-Length':b-a+1,'Content-Range':'bytes '+a+'-'+b+'/'+payload.length});res.end(payload.subarray(a,b+1))}
    else res.end(payload)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const source=fs.readFileSync(new URL('../electron/download-manager.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
const sandbox={fs,path,http,https,Buffer,URL,AbortController,Date,Math,setImmediate,setTimeout,console,axios,Transform,pipeline,finished,once,
    resolveDownloadLink,responseDownloadName,safeDownloadName,
    process:{resourcesPath:root,cwd:()=>root,env:{APP_ROOT:process.cwd()}},
    app:{isPackaged:false,getPath:()=>root,whenReady:()=>Promise.resolve()},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},nativeImage:{},spawn(command,args,options){
        const inputs=args.flatMap((v,i)=>v==='-i'?[args[i+1]]:[])
        assert.equal(inputs.length,2);assert.notEqual(inputs[0],inputs[1])
        assert.ok(fs.readFileSync(inputs[0]).equals(video));assert.ok(fs.readFileSync(inputs[1]).equals(audio));merges++
        return realSpawn(command,failMerge?['-invalid-option']:args,options)
    }
}
vm.createContext(sandbox)
vm.runInContext(source+'\nglobalThis.testApi={setDownloadManagerWindow,httpsAgent,httpAgent};',sandbox)
sandbox.testApi.setDownloadManagerWindow({webContents:{send:(channel,data)=>events.push({channel,data:{...data}})}})
const invoke=(name,params)=>handlers.get(name)(null,params)
async function settle(id){
    for(let i=0;i<3000;i++){
        const task=(await invoke('download:list')).data.find(t=>t.id===id)
        if(['done','error','canceled'].includes(task?.status))return task
        await new Promise(r=>setTimeout(r,10))
    }
    throw Error('download timeout')
}
try{
    const url='http://127.0.0.1:'+server.address().port
    const headers={Cookie:'protected=fixture'}
    const output=path.join(root,'中文 空格视频.mp4')
    const params={url:url+'/video',audioUrl:url+'/audio',name:'中文 空格视频',savePath:output,headers}
    const starts=await Promise.all([invoke('download:start',params),invoke('download:start',params)])
    const tasks=await Promise.all(starts.map(t=>settle(t.downloadId)))
    tasks.forEach(t=>assert.equal(t.status,'done',t.error));assert.notEqual(tasks[0].path,tasks[1].path)
    for(const task of tasks){
        run(['-i',task.path,'-map','0:v:0','-map','0:a:0','-c','copy','-f','null','-'])
        const file=fs.readFileSync(task.path),boxes=[]
        for(let offset=0;offset+8<=file.length;){const size=file.readUInt32BE(offset);if(size<8)break;boxes.push(file.toString('ascii',offset+4,offset+8));offset+=size}
        assert.ok(boxes.includes('moov')&&boxes.indexOf('moov')<boxes.indexOf('mdat'),'MP4 initialization index precedes media for local playback')
    }
    const original=fs.readFileSync(output)
    failMerge=true
    const failed=await settle((await invoke('download:start',params)).downloadId)
    assert.equal(failed.status,'error');assert.ok(fs.readFileSync(output).equals(original))
    failMerge=false
    const retry=await invoke('download:retry',{downloadId:failed.id})
    assert.equal(retry.success,true,retry.error)
    const retried=await settle(retry.downloadId)
    assert.equal(retried.status,'done',retried.error);assert.equal(merges,4)
    assert.equal(fs.readdirSync(root).filter(n=>n.endsWith('.tmpdir')).length,0)
    console.log('DASH integration passed: actual HTTP split streams and ffmpeg merge, Chinese path, concurrent duplicate names, failed merge preserves original, retry keeps audio and headers, temporary directory cleanup.')
}finally{
    sandbox.testApi.httpAgent.destroy();sandbox.testApi.httpsAgent.destroy()
    server.closeAllConnections();server.close()
    await fs.promises.rm(root,{recursive:true,force:true})
}
