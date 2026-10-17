import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import vm from 'node:vm'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'mingyun-provider-test-'))
const handlers=new Map(),events=[]
const source=fs.readFileSync(new URL('../electron/download-manager.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
let coverFail=false,coverGate,coverCalls=0
const jpeg=Buffer.from([255,216,255,224,1,2,3,255,217])
const sandbox={fs,path,http,https,Buffer,URL,AbortController,Date,Math,setImmediate,setTimeout,console,
  process:{resourcesPath:root,cwd:()=>root,env:{APP_ROOT:root}},
  app:{isPackaged:false,getPath:()=>root,whenReady:()=>Promise.resolve()},
  ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},spawn(){throw Error('not expected')},
  axios:{async get(url,options){coverCalls++;assert.equal(options.responseType,'arraybuffer');if(coverGate)await coverGate;if(coverFail)throw Error('cover unavailable');return {data:jpeg}}},
  nativeImage:{createFromBuffer:data=>({isEmpty:()=>!data.equals(jpeg),toJPEG:()=>jpeg})},
  Transform:class{},pipeline(){},finished(){},once(){} }
vm.createContext(sandbox)
vm.runInContext(source+'\nglobalThis.testApi={registerMusicDownloadProvider,startProviderMusicDownload,setDownloadManagerWindow};',sandbox)
const api=sandbox.testApi
api.setDownloadManagerWindow({webContents:{send:(channel,data)=>events.push({channel,data:{...data}})}})
let scope='account-a',fail=false,gate,seen=[]
api.registerMusicDownloadProvider('qishui',async(params,{signal,progress,onResolved})=>{
  onResolved({url:'https://audio.qishui.com/fixture?signature=temporary-test',quality:'lossless',preview:false})
  seen.push(params); progress({received:4,total:12})
  if(gate)await gate
  if(signal.aborted)throw Error('canceled')
  if(fail)throw Error('fixture connection failure')
  return {data:Buffer.from('fLaCfixture-audio'),extension:'flac',quality:'lossless',preview:params.id==='trial',trackName:params.id==='named'?'歌名':undefined,artist:params.id==='named'?'歌手':undefined,coverUrl:'https://example.invalid/cover?token=fixture-only'}
},()=>scope)
const call=(name,params)=>handlers.get(name)(null,params)
async function settled(id) {
  for(let n=0;n<100;n++) {
    const item=(await call('download:list')).data.find(x=>x.id===id)
    if(['done','error','canceled'].includes(item?.status))return item
    await new Promise(r=>setTimeout(r,10))
  }
  throw Error('download did not finish')
}
let checks=0
const ok=(v,label)=>{assert.ok(v,label);checks++}
try {
  const a=api.startProviderMusicDownload('qishui',{id:'song',name:'歌曲',quality:'lossless'})
  ok(a.queued&&a.downloadId,'returns a queued task immediately')
  const first=await settled(a.downloadId)
  ok(first.status==='done'&&first.type==='music'&&first.path.startsWith(root),'task belongs to download center and configured directory')
  ok(fs.readFileSync(first.path).equals(Buffer.from('fLaCfixture-audio')),'saved bytes match authorized audio')
  ok(events.some(e=>e.channel==='download:progress'&&e.data.received===4),'network progress reaches existing task events')
  ok(events.some(e=>e.channel==='download:progress'&&e.data.url==='https://audio.qishui.com/fixture?signature=temporary-test'),'resolved CDN link reaches live download details')
  ok(events.some(e=>e.channel==='download:done'&&e.data.path===first.path),'completion reaches download center')
  ok(events.some(e=>e.channel==='video-download-started'&&e.data.downloadId===first.id)&&events.some(e=>e.channel==='video-download-progress'&&e.data.downloadId===first.id)&&events.some(e=>e.channel==='video-download-done'&&e.data.downloadId===first.id),'bottom-right toast receives matching started, progress and done events')
  ok(first.coverPath===first.path.replace(/\.flac$/,'.jpg')&&fs.readFileSync(first.coverPath).equals(jpeg),'same-basename JPEG artwork saved before completion')
  const second=await settled(api.startProviderMusicDownload('qishui',{id:'song',name:'歌曲'}).downloadId)
  ok(second.path!==first.path&&fs.existsSync(first.path),'duplicate download never overwrites original')
  ok(second.coverPath!==first.coverPath&&fs.existsSync(first.coverPath),'duplicate cover follows unique audio suffix without overwriting original')
  const named=await settled(api.startProviderMusicDownload('qishui',{id:'named',name:'旧名'}).downloadId)
  ok(path.basename(named.path)==='歌名 - 歌手.flac','default naming matches other platforms')
  fs.writeFileSync(path.join(root,'music-naming.json'),JSON.stringify({download:'artist-song'}))
  const reversed=await settled(api.startProviderMusicDownload('qishui',{id:'named',name:'旧名'}).downloadId)
  ok(path.basename(reversed.path)==='歌手 - 歌名.flac','artist-first setting applies to Qishui audio and artwork')
  coverFail=true
  const noCover=await settled(api.startProviderMusicDownload('qishui',{id:'song',name:'封面失败'}).downloadId)
  ok(noCover.status==='done'&&noCover.coverError&&!noCover.coverPath&&fs.existsSync(noCover.path),'cover failure preserves valid audio and reports separate warning')
  coverFail=false
  const trial=await settled(api.startProviderMusicDownload('qishui',{id:'trial',name:'试听歌曲'}).downloadId)
  ok(trial.preview&&trial.path.includes('试听片段'),'trial files are explicitly named')
  fail=true
  const failed=await settled(api.startProviderMusicDownload('qishui',{id:'song',name:'失败任务'}).downloadId)
  ok(failed.status==='error'&&failed.error.includes('connection'),'failed stream remains a failed task')
  ok(events.some(e=>e.channel==='video-download-error'&&e.data.downloadId===failed.id),'toast receives upstream failures')
  fail=false
  const retry=await call('download:retry',{downloadId:failed.id})
  ok((await settled(retry.downloadId)).status==='done'&&seen.length>=5,'retry obtains fresh authorized media')
  scope='account-b'
  ok(!(await call('download:retry',{downloadId:failed.id})).success,'another account cannot retry the original task')
  let release;gate=new Promise(r=>release=r)
  const canceled=api.startProviderMusicDownload('qishui',{id:'song',name:'取消任务'})
  await new Promise(r=>setImmediate(r))
  await call('download:cancel',{downloadId:canceled.downloadId});release()
  ok((await settled(canceled.downloadId)).status==='canceled','cancel aborts provider task')
  gate=null
  let coverRelease;coverGate=new Promise(r=>coverRelease=r)
  const beforeCover=coverCalls,coverCanceled=api.startProviderMusicDownload('qishui',{id:'song',name:'封面取消'})
  for(let i=0;i<100&&coverCalls===beforeCover;i++)await new Promise(r=>setTimeout(r,10))
  await call('download:cancel',{downloadId:coverCanceled.downloadId});coverRelease()
  ok((await settled(coverCanceled.downloadId)).status==='canceled'&&!fs.readdirSync(root).some(n=>n.startsWith('封面取消')),'cancel during artwork removes reserved audio and leaves no sidecar')
  coverGate=null
  const changed=api.startProviderMusicDownload('qishui',{id:'song',name:'换号任务'})
  scope='account-c'
  ok((await settled(changed.downloadId)).status==='error','account change before dispatch cancels export')
  const history=fs.readFileSync(path.join(root,'download-history.json'),'utf8')
  ok(!history.includes('https://')&&!history.includes('token=')&&!history.includes('sessionid='),'history retains no credential or signed media URL')
  console.log(`Provider download center: ${checks} checks passed (progress, history, retry, cancel, isolation, unique files).`)
} finally {fs.rmSync(root,{recursive:true,force:true})}
