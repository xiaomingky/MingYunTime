import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {QishuiClient,qishuiPlayback,qishuiTranslation} from '../electron/qishui-client.js'
import {QishuiBusiness} from '../electron/qishui-business.js'
import {qqMembershipFromIcons} from '../electron/qq-account.js'
const require=createRequire(import.meta.url),{createPinia,setActivePinia}=require('pinia')
let checks=0
const ok=(v,label)=>{assert.ok(v,label);checks++}
for(const name of ['svip_g','vip_g','d-svip1','d-sui1','notvip','svip_bad'])ok(!qqMembershipFromIcons([{iconurl:`https://y.gtimg.cn/music/icon/v1/pc/${name}.png`}]).isVip,`QQ inactive ${name}`)
for(const name of ['svip1','nsvip3','svip','sui1','nsui2','vip2'])ok(qqMembershipFromIcons([{iconurl:`http://y.gtimg.cn/music/icon/v1/pc/${name}.png`}]).vipIcon.startsWith('https:'),`QQ active ${name}`)
ok(qqMembershipFromIcons([{iconurl:'https://y.gtimg.cn/music/icon/v1/pc/svip_g.png'},{iconurl:'https://y.gtimg.cn/music/icon/v1/pc/sui3.png'}]).vipLevel===1,'grey icon cannot override real active lower tier')
const model={track:{id:'123',duration:20000},lyric:{content:'[1000,1500]<0,700,0>Hello <700,800,0>world',translations:{cn:'[00:01.00]你好，世界'}},track_player:{video_model:{video_duration:20,video_list:{aac:{main_url:'https://a.douyinvod.com/a',video_meta:{quality:'higher',codec_type:'aac',bitrate:128000}},flac:{main_url:'https://a.douyinvod.com/f',video_meta:{quality:'lossless',codec_type:'flac',bitrate:800000}},spatial:{main_url:'https://a.douyinvod.com/s',video_meta:{quality:'spatial',codec_type:'aac',bitrate:320000}}}}}}
const playback=qishuiPlayback(model,'lossless')
ok(playback.quality==='lossless'&&playback.codec==='flac'&&playback.availableQualities.length===3,'FLAC selected from actual streams')
ok(playback.tlrc==='[00:01.000]你好，世界'&&playback.yrc.includes('Hello'),'official translation retained beside original words')
ok(qishuiPlayback(model,'auto').quality==='lossless','automatic selection prioritizes lossless rather than spatial effect')
ok(qishuiPlayback(model,'spatial').quality==='spatial','spatial selection is explicit')
ok(qishuiPlayback(model,'hi_res').quality==='lossless','unavailable requested quality exposes actual fallback')
ok(qishuiTranslation('[00:01]过早\n[00:04.50]正文\n[00:07]超出',2000,4000)==='[00:02.500]正文','preview translation clips and shifts timestamps')
let reply={status_info:{},apply_status:0},calls=[]
const client=new QishuiClient({request:async()=>{},pcRequest:async spec=>{calls.push(spec);return {data:reply}}})
const business=new QishuiBusiness(client)
await assert.rejects(business.claimFreeVip(),/登录/);checks++
ok(calls.length===0,'claim never issued without authentication')
client.cookie='sessionid=synthetic'
for(const [code,status]of [[0,'received'],[1,'restricted'],[2,'device_limit'],[3,'already_received'],[13,'unavailable']]){
 reply={status_info:{},apply_status:code}
 ok((await business.claimFreeVip()).status===status,'claim business status '+status)
}
ok(calls.every(c=>c.path==='/luna/commerce/v2/apply_free_vip'&&!c.data),'claim contract uses declared no-argument POST')
reply={status_info:{}}
await assert.rejects(business.claimFreeVip(),/未确认/);checks++
reply={status_code:403,message:'denied'}
await assert.rejects(business.claimFreeVip(),/denied/);checks++
let resolve
client.pcRequest=()=>new Promise(r=>resolve=r)
const late=business.claimFreeVip();client.revision++;resolve({data:{status_info:{},apply_status:0}})
await assert.rejects(late,/账号已切换/);checks++

// Execute the production player with controlled transports. A queue made only
// of restricted songs must not call next(), even after quality fallbacks.
const services={messages:[],requests:0,cookie:'synthetic'}
const code=await build({entryPoints:['src/store/player.js'],bundle:true,platform:'node',format:'cjs',write:false,external:['pinia'],plugins:[{name:'player-fixtures',setup(b){
 b.onResolve({filter:/^(\.\.\/api(?:\/.*)?|\.\/(qq-user|qishui-user|kugou-user|user|message|settings))$/},a=>({path:a.path,namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:
 a.path==='./qq-user'?`export const useQQUserStore=()=>({cookie:__s.cookie})`:
 a.path==='./qishui-user'?`export const useQishuiUserStore=()=>({})`:
 a.path==='./kugou-user'?`export const useKugouUserStore=()=>({})`:
 a.path==='./user'?`export const useUserStore=()=>({})`:
 a.path==='./message'?`export const useMessageStore=()=>({error:m=>__s.messages.push(m),info(){},success(){}})`:
 a.path==='./settings'?`export const useSettingsStore=()=>({})`:
 a.path==='../api/qq'?`export const qqSongPlay=async()=>{__s.requests++;return {data:{playUrl:{restricted:{error:'VIP权限不足'}}}}};export const qqLyric=()=>{},qqDownload=()=>{},qqSongInfo=()=>{},qqBatchSongInfo=()=>{},normalizeQQSong=()=>{}`:
 a.path==='../api/qishui'?`export const qishuiInvoke=()=>{}`:
 a.path==='../api/kugou'?`export const kugouSongUrl=()=>{},kugouSongUrlNew=()=>{},kugouSongDetail=()=>{},normalizeKugouSong=()=>{},kugouVideoUrl=()=>{},kugouSongMv=()=>{},kugouVideoDetail=()=>{},kugouSearch=()=>{},kugouNativeBridge=()=>{},kugouDirect=()=>{}`:
 `export default {};export const getSongUrl=()=>{},getLyric=()=>{},getNewLyric=()=>{},cloudSearch=()=>{},getCurrentPlatform=()=> 'qq'`,loader:'js'}))
}}]})
const module={exports:{}}
new Function('require','module','exports','localStorage','__s',code.outputFiles[0].text)(require,module,module.exports,{getItem:()=>null,setItem(){},removeItem(){}},services)
setActivePinia(createPinia())
const player=module.exports.usePlayerStore()
player.audio={pause(){},paused:true};player.initAudio=()=>{};player.rebuildAudioGraph=async()=>{};player._resumeAudioContexts=async()=>{}
let next=0;player.next=()=>next++
for(const cookie of ['synthetic','']){
 services.cookie=cookie;services.messages=[];services.requests=0
 await player.playSong({id:'restricted',platform:'qq',name:'VIP歌曲'},[{id:'restricted',platform:'qq'},{id:'second',platform:'qq'}])
 ok(next===0&&services.messages.length===1&&!player.isPlaying&&!player.playbackLoading,'denied queue stops after one message '+(cookie?'authenticated':'guest'))
 ok(services.requests<=3,'quality attempts remain bounded')
}
player.parseLyrics(playback.lrc,playback.tlrc);player.parseYrcLyrics(playback.yrc,playback.tlrc)
ok(player.lyrics[0].ttext==='你好，世界'&&player.yrcLyrics[0].ttext==='你好，世界','production line and word renderers both receive translation')
console.log(`Platform fixes: ${checks} assertions passed (QQ membership/denied queue, Qishui bilingual/quality/claim contracts).`)
