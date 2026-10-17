import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {neteaseStreamInfo,qqStreamInfo,kugouStreamInfo} from '../src/utils/playback-quality.js'
const require=createRequire(import.meta.url),{createPinia,setActivePinia}=require('pinia')
let checks=0
const ok=(value,label)=>{assert.ok(value,label);checks++}
ok(neteaseStreamInfo({level:'hires',type:'mp3',br:128000}).quality==='standard','requested/claimed hi-res cannot override an MP3 stream')
ok(neteaseStreamInfo({level:'lossless',type:'flac',br:850000}).quality==='lossless','variable FLAC bitrate does not make MP3 high quality')
ok(neteaseStreamInfo({type:'flac',sampleRate:96000}).quality==='hires','high sample rate is preserved')
ok(neteaseStreamInfo({}).quality==='unknown','missing stream evidence remains unknown')
ok(qqStreamInfo('path/M500abc.mp3?vkey=synthetic').quality==='128','QQ actual grant identifies standard file')
ok(qqStreamInfo('F000abc.flac').quality==='flac','QQ FLAC grant identifies lossless file')
ok(qqStreamInfo('F000abc.mp3').quality==='unknown','inconsistent QQ prefix and format cannot claim lossless')
ok(kugouStreamInfo({extName:'mp3',bitRate:320000}).bitrate===320000,'Kugou bit/s normalized once')
ok(kugouStreamInfo({extName:'mp3',bitRate:128}).bitrate===128000,'Kugou kbit/s normalized to bit/s')
ok(kugouStreamInfo({extName:'flac',bitRate:900,sampleRate:44100}).quality==='flac','Kugou FLAC does not claim hi-res without evidence')
ok(kugouStreamInfo({extName:'flac',sampleRate:96000}).quality==='high','Kugou verified high sample rate recognized')
const services={platform:'qq',requests:[],messages:[],reply:null}
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
const api=`export default {}; export const getCurrentPlatform=()=>__s.platform; export const getSongUrl=(id,q)=>{__s.requests.push({id,q,platform:'netease'});return __s.reply(id,q)}; export const getLyric=async()=>({}),getNewLyric=async()=>({}),cloudSearch=async()=>({})`
const code=await build({entryPoints:['src/store/player.js'],bundle:true,platform:'node',format:'cjs',write:false,external:['pinia'],plugins:[{name:'controlled-audio-transports',setup(b){
 b.onResolve({filter:/^(\.\.\/api(?:\/.*)?|\.\/(qq-user|qishui-user|kugou-user|user|message|settings))$/},a=>({path:a.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:
 a.path==='./message'?`export const useMessageStore=()=>Object.fromEntries(['error','info','success','warning'].map(type=>[type,text=>__s.messages.push({type,text})]))`:
 a.path==='./settings'?`export const useSettingsStore=()=>({})`:
 a.path==='./qq-user'?`export const useQQUserStore=()=>({cookie:'synthetic'})`:
 a.path==='./qishui-user'?`export const useQishuiUserStore=()=>({})`:
 a.path==='./kugou-user'?`export const useKugouUserStore=()=>({})`:
 a.path==='./user'?`export const useUserStore=()=>({})`:
 a.path==='../api/qq'?`export const qqSongPlay=(id,q)=>{__s.requests.push({id,q,platform:'qq'});return __s.reply(id,q)};export const qqLyric=async()=>({}),qqDownload=()=>{},qqSongInfo=()=>{},qqBatchSongInfo=()=>{},normalizeQQSong=()=>{}`:
 a.path==='../api/qishui'?`export const qishuiInvoke=(method,p)=>{__s.requests.push({id:p.id,q:p.quality,platform:'qishui'});return __s.reply(p.id,p.quality)}`:
 a.path==='../api/kugou'?`export const kugouNativeBridge=()=>({invoke:(method,p)=>{__s.downloads.push({method,...p});return Promise.resolve({success:true})}});export const kugouDirect=(route,p)=>{__s.requests.push({id:p.hash,q:p.quality,platform:'kugou'});return __s.reply(p.hash,p.quality)};export const kugouSongUrl=()=>{},kugouSongUrlNew=()=>{},kugouSongDetail=()=>{},normalizeKugouSong=()=>{},kugouVideoUrl=()=>{},kugouSongMv=()=>{},kugouVideoDetail=()=>{},kugouSearch=()=>{}`:api,loader:'js'}))
}}]})
const module={exports:{}}
new Function('require','module','exports','localStorage','window','__s',code.outputFiles[0].text)(require,module,module.exports,localStorage,{},services)
setActivePinia(createPinia())
const player=module.exports.usePlayerStore()
function prepare(platform){
 services.platform=platform;services.messages=[];services.requests=[]
 player.audio={src:'https://previous.test/old',pause(){this.paused=true},paused:false,readyState:1,duration:240,currentTime:46,load(){},playbackRate:1}
 player.initAudio=()=>{};player.rebuildAudioGraph=async()=>{};player._resumeAudioContexts=async()=>{}
 player._applyAudioDevice=async()=>{};player._updateMediaSessionMetadata=()=>{};player.checkIfLiked=()=>{};player.addToRecent=()=>{}
 player._startAudioPlayback=async function(audio){audio.paused=false;this.isPlaying=true;return true}
 player.currentSong={id:'same',platform,name:'A',url:'https://previous.test/old',duration:240,fullDuration:240,dt:240000,al:{name:'Album',picUrl:'cover'},streamQuality:'128'}
 player.currentTime=46;player.isPlaying=true;player.playlist=[];player.currentIndex=-1
}
function response(platform,quality,id='same'){
 const stream={url:`https://audio.test/${quality}`,quality,codec:quality==='flac'?'flac':'mp3',bitrate:quality==='flac'?850000:128000,fullDuration:240}
 if(platform==='qq')return {data:{playUrl:{[id]:stream}}}
 if(platform==='kugou')return {data:{...stream,is_trial:false}}
 if(platform==='netease')return {data:[{...stream,type:stream.codec,br:stream.bitrate,time:240000,level:'hires'}]}
 return {...stream,track:{},duration:240,requestedQuality:'lossless',preview:false,lrc:''}
}
for(const [platform,requested,actual]of [['qq','flac','128'],['kugou','high','flac'],['netease','hires','standard'],['qishui','lossless','hi_res']]){
 prepare(platform);services.reply=async()=>response(platform,actual)
 await player.setQuality(requested)
 ok(services.requests.length===(platform==='kugou'?2:1),`${platform} changing quality resolves fresh grants and continues after a silent downgrade`)
 ok(player.currentSong.streamQuality===actual,`${platform} displays actual quality after fallback`)
 ok(player.audio.src!=='https://previous.test/old'&&player.audio.currentTime===46,`${platform} reloads source and restores position`)
 ok(!services.messages.some(m=>m.type==='success'),`${platform} fallback does not claim requested quality succeeded`)
 ok(services.messages.filter(m=>m.type==='info').length===1,`${platform} fallback yields one result message`)
 prepare(platform);player.isPlaying=false;player.audio.paused=true
 services.reply=async()=>response(platform,actual)
 await player.setQuality(requested)
 ok(player.audio.paused&&!player.isPlaying&&player.audio.currentTime===46,`${platform} paused quality switch preserves pause and position`)
}
prepare('qq');services.reply=async()=>({data:{playUrl:{same:{error:'VIP权限不足'}}}})
await player.setQuality('flac')
ok(!player.isPlaying&&!player.playbackLoading&&!services.messages.some(m=>m.type==='success'),'failed quality grant does not produce a success toast')
ok(services.requests.length===3&&services.messages.length===1,'permission fallbacks remain bounded and produce one error')
prepare('kugou');services.reply=async(id,q)=>{if(q==='viper_atmos')throw Error('权限不足');return response('kugou','flac')}
await player.setQuality('viper_atmos')
ok(services.requests.length===2&&player.currentSong.streamQuality==='flac'&&player.isPlaying,'Kugou effect denial falls back to authorized lossless playback')
ok(services.messages.length===1&&services.messages[0].type==='info','Kugou denied effect reports actual fallback once')
prepare('kugou');services.reply=async(id,q)=>response('kugou',q==='high'?'128':'flac')
await player.setQuality('high')
ok(services.requests.map(r=>r.q).join(',')==='high,flac'&&player.currentSong.streamQuality==='flac','Kugou silent Hi-Res downgrade continues to authorized FLAC')
prepare('kugou');services.reply=async()=>{throw Error('酷狗要求安全验证')}
await player.setQuality('high')
ok(services.requests.length===1&&!player.isPlaying&&services.messages.length===1,'Kugou safety challenge stops after one request and one error')
prepare('qq');services.reply=async()=>response('qq','128')
player._startAudioPlayback=async()=>{throw Error('synthetic decoder rejection')}
await player.setQuality('128')
ok(!services.messages.some(m=>m.type==='success')&&!player.isPlaying&&!!player.currentSong.streamError,'decoder failure marks source unavailable and never produces quality-switch success')
prepare('qishui');services.reply=async()=>({...response('qishui','higher'),duration:20,preview:true})
player.audio.duration=20;await player.setQuality('higher')
ok(player.audio.currentTime===19.75,'switching to a short authorized preview clamps the previous position within its duration')
prepare('qq');let release
services.reply=()=>new Promise(r=>release=r)
const pending=player.setQuality('flac')
while(!release)await new Promise(r=>setImmediate(r))
player._playRequestId++;player.currentSong={id:'new-song',platform:'qq'};player.currentTime=7;player.audio.currentTime=7
release(response('qq','flac'))
await pending
ok(player.currentSong.id==='new-song'&&player.audio.currentTime===7&&services.messages.length===0,'stale quality response cannot replace or seek a newly selected song')
prepare('qq');player.currentSong.platform='kugou'
await player.setQuality('320')
ok(services.requests.length===0&&storage.get('qq_music_quality')==='320','changing another platform preference does not replay the current song')
prepare('kugou');player.currentSong.platform='qq';player.currentSong.url='';player.quality='high';storage.set('qq_music_quality','320')
services.reply=async(id)=>response('qq','320',id)
await player.playSong(player.currentSong,[],{suppressQualityPrompt:true})
ok(services.requests[0].q==='320','mixed queues use the playing song provider preference')
prepare('kugou');services.downloads=[];storage.set('kugou_music_quality','high')
services.reply=async(id,q)=>response('kugou',q==='high'?'128':'flac')
const downloaded=await player.downloadKugouSong({id:'same',hash:'same',name:'A'})
ok(downloaded.success&&services.requests.map(r=>r.q).join(',')==='high,flac','Kugou download resolves the selected quality and continues past a downgraded grant')
ok(services.downloads.length===1&&services.downloads[0].method==='download-song'&&services.downloads[0].url==='https://audio.test/flac','Kugou download passes only the fresh authorized FLAC URL to the native downloader')
prepare('kugou');services.downloads=[];services.reply=async()=>{throw Object.assign(Error('requires verification'),{requiresVerification:true})}
ok(!(await player.downloadKugouSong({id:'same',name:'A'})).success&&services.requests.length===1&&!services.downloads.length,'Kugou challenged download stops once without starting a file')
prepare('kugou');services.downloads=[];services.reply=async()=>({data:{...response('kugou','flac').data,is_trial:true}})
ok(!(await player.downloadKugouSong({id:'same',name:'A'})).success&&!services.downloads.length,'Kugou trial grant never starts a full-song download')
console.log(`Stream quality: ${checks} assertions passed (actual grants, fresh URLs, pause/position, denial, race isolation, mixed queues and downloads).`)
