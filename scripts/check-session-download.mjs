import assert from 'node:assert/strict'
import { cookieExpiresAt, sessionValidity } from '../src/utils/session-validity.js'
import { downloadQishuiSong } from '../electron/qishui-download.js'
let checks=0
const ok=(v,m)=>{assert.ok(v,m);checks++}
const reject=async(p,m)=>{await assert.rejects(p,m);checks++}
const start=1800000000, lifetime=86400, cookie=`sessionid=fixture; sid_guard=fixture%7C${start}%7C${lifetime}%7Cdate`
ok(cookieExpiresAt('qishui',cookie)===(start+lifetime)*1000,'sid_guard carries explicit seconds and TTL')
for(const platform of ['qq','netease','kugou'])ok(cookieExpiresAt(platform,'token=fixture')===0,platform+' unknown expiry is never invented')
for(const value of ['sid_guard=%E0%A4%A','sid_guard=x%7Cbad%7C20','sid_guard=x%7C1800000000%7C-1','sessionid=fixture'])ok(cookieExpiresAt('qishui',value)===0,'malformed/missing cookie expiry is unknown')
ok(sessionValidity({platform:'qishui',cookie,loggedIn:true,checkedAt:start*1000,now:(start+10)*1000}).state==='valid','validated nonexpired credential')
ok(sessionValidity({platform:'qishui',cookie,loggedIn:true,checkedAt:start*1000,now:(start+lifetime+1)*1000}).state==='expired','expired timestamp cannot show a green valid badge')
ok(sessionValidity({platform:'qq',cookie:'fixture',loggedIn:true,checkedAt:10,error:'network'}).state==='unconfirmed','connection error is not proof of expiry or validity')
ok(sessionValidity({platform:'qq',cookie:'fixture',loggedIn:true}).state==='unconfirmed','cached profile alone is not validation')
ok(sessionValidity({platform:'qq',cookie:'',loggedIn:false}).state==='empty','cleared session is logged out')
let playbackCalls=0,writes=[],chooseCalls=0,preview=false,cancel=false,changeAccount=false
const media=Buffer.from('fLaCfixture-audio')
const dependencies={client:{revision:0,playback:async()=>{playbackCalls++;return {preview,url:'qishui-audio://cache/fixture',quality:'lossless'}}},audio:{prepare:async p=>p,handle:()=>new Response(media)},choose:async info=>{chooseCalls++;assert.equal(info.extension,'flac');assert.ok(!info.title.includes('/'));if(changeAccount)dependencies.client.revision++;return cancel?'':'fixture.flac'},write:async(path,data)=>writes.push({path,data})}
await reject(downloadQishuiSong(dependencies,{id:'123',quality:'invalid'}),/音质/)
ok(playbackCalls===0&&chooseCalls===0&&writes.length===0,'invalid quality never reaches the network')
preview=true
const trial=await downloadQishuiSong(dependencies,{id:'123'})
ok(trial.success&&trial.preview&&writes.length===1,'returned trial URL can be saved and remains explicitly marked as a trial')
writes=[]
preview=false;cancel=true
ok((await downloadQishuiSong(dependencies,{id:'123',name:'test/song'})).canceled&&writes.length===0,'canceling the native save dialog does not write')
cancel=false;changeAccount=true
await reject(downloadQishuiSong(dependencies,{id:'123'}),/账号已切换/)
ok(writes.length===0,'switching accounts during save cancels the write')
changeAccount=false
const result=await downloadQishuiSong(dependencies,{id:'123'})
ok(result.success&&result.extension==='flac'&&writes[0].data.equals(media),'direct URL export writes the exact returned audio bytes')
console.log(`Session validity and Qishui downloads: ${checks} checks passed.`)
