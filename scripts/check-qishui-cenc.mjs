import assert from 'node:assert/strict'
import {createCipheriv} from 'node:crypto'
import {decryptQishuiCenc} from '../electron/qishui-cenc.js'
import {createQishuiAudio} from '../electron/qishui-audio.js'
import {QishuiClient} from '../electron/qishui-client.js'
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b}
const box=(type,...parts)=>{const body=Buffer.concat(parts);return Buffer.concat([u32(body.length+8),Buffer.from(type),body])}
const full=Buffer.alloc(4),key='0123456789abcdef0123456789abcdef'
let checks=0
function fixture(ivSize,subsamples,co64=false){
 const samples=[Buffer.from('first AAC sample with arbitrary fixture bytes'),Buffer.from('second sample is a different length'),Buffer.from('third sample: keep all original chunk offsets')]
 const ivs=samples.map((_,i)=>Buffer.alloc(ivSize,i+2)),encrypted=samples.map((s,i)=>{const iv=Buffer.alloc(16);ivs[i].copy(iv);const c=createCipheriv('aes-128-ctr',Buffer.from(key,'hex'),iv);return subsamples?Buffer.concat([s.subarray(0,5),c.update(s.subarray(5))]):c.update(s)})
 const entry=box('enca',Buffer.alloc(28),box('esds',full),box('sinf',box('frma',Buffer.from('mp4a')),box('schm',full,Buffer.from('cenc'),u32(65536)),box('schi',box('tenc',full,Buffer.from([0,0,1,ivSize]),Buffer.alloc(16)))))
 const flags=Buffer.from([0,0,0,subsamples?2:0]),senc=box('senc',flags,u32(samples.length),...ivs.map((iv,i)=>Buffer.concat([iv,...(subsamples?[u16(1),u16(5),u32(samples[i].length-5)]:[])])))
 const offsetValue=n=>{if(!co64)return u32(n);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b}
 const moov=offsets=>box('moov',box('trak',box('mdia',box('minf',box('stbl',box('stsd',full,u32(1),entry),box('stsz',full,u32(0),u32(samples.length),...samples.map(s=>u32(s.length))),box('stsc',full,u32(2),u32(1),u32(2),u32(1),u32(2),u32(1),u32(1)),box(co64?'co64':'stco',full,u32(2),...offsets.map(offsetValue)),senc,box('saiz',full),box('saio',full))))))
 const ftyp=box('ftyp',Buffer.from('isom')),initial=moov([0,0]),start=ftyp.length+initial.length+8
 const offsets=[start+3,start+3+encrypted[0].length+encrypted[1].length+4]
 return {input:Buffer.concat([ftyp,moov(offsets),box('mdat',Buffer.alloc(3),encrypted[0],encrypted[1],Buffer.alloc(4),encrypted[2])]),samples,positions:[offsets[0],offsets[0]+samples[0].length,offsets[1]]}
}
for(const ivSize of [8,16])for(const subsamples of [false,true])for(const co64 of [false,true]){
 const f=fixture(ivSize,subsamples,co64),before=Buffer.from(f.input),out=decryptQishuiCenc(f.input,key)
 assert.equal(out.length,f.input.length);checks++
 assert.deepEqual(f.input,before);checks++
 f.samples.forEach((s,i)=>{assert.deepEqual(out.subarray(f.positions[i],f.positions[i]+s.length),s);checks++})
 assert.ok(out.includes(Buffer.from('mp4a'))&&!out.includes(Buffer.from('enca')));checks++
}
const f=fixture(8,false)
const flac=Buffer.from(f.input)
flac.write('fLaC',flac.indexOf(Buffer.from('frma'))+4)
const decodedFlac=decryptQishuiCenc(flac,key)
assert.ok(decodedFlac.includes(Buffer.from('fLaC'))&&!decodedFlac.includes(Buffer.from('enca')));checks++
f.samples.forEach((s,i)=>{assert.deepEqual(decodedFlac.subarray(f.positions[i],f.positions[i]+s.length),s);checks++})
for(const input of [f.input.subarray(0,-1),Buffer.alloc(3),Buffer.from(f.input)]){
 if(input.length===f.input.length)input.writeUInt32BE(0,input.indexOf(Buffer.from('stco'))+12)
 assert.throws(()=>decryptQishuiCenc(input,key),/结构无效/);checks++
}
for(const marker of ['senc','tenc','cenc']){const corrupt=Buffer.from(f.input);corrupt.write('xxxx',corrupt.indexOf(Buffer.from(marker)));assert.throws(()=>decryptQishuiCenc(corrupt,key),/结构无效/);checks++}
assert.throws(()=>decryptQishuiCenc(f.input,'wrong'),/密钥格式/);checks++
let requests=[]
const makeAudio=request=>createQishuiAudio({request,runtime:{decodeKey:async()=>key},remux:data=>data})
const grant={url:'https://a.douyinvod.com/quality',playAuth:'synthetic'}
let audio=makeAudio(async spec=>{requests.push(spec);return requests.length===1?{status:302,headers:{location:'https://b.byteicdn.com/media'}}:{status:200,data:Buffer.from('decoded')}})
assert.ok((await audio.prepare(grant)).url.startsWith('qishui-audio:'));checks++
assert.ok(requests.length===2&&requests.every(r=>r.maxRedirects===0&&!r.headers.Cookie));checks++
audio=makeAudio(async()=>({status:302,headers:{location:'https://evil.example/media'}}))
await assert.rejects(audio.prepare(grant),/地址无效/);checks++
requests=[]
audio=makeAudio(async spec=>{requests.push(spec);return requests.length===1?{status:302,headers:{location:'https://unverified-cdn.example/file'}}:{status:200,data:Buffer.from('decoded-backup')}})
const backup=await audio.prepare({...grant,backupUrls:['https://backup.douyinvod.com/same-quality']})
assert.ok(backup.url.startsWith('qishui-audio:')&&!backup.backupUrls);checks++
assert.ok(requests.length===2&&requests[1].url==='https://backup.douyinvod.com/same-quality','unverified redirect is skipped for official same-quality backup');checks++
audio=makeAudio(async()=>({status:302,headers:{location:'/loop'}}))
await assert.rejects(audio.prepare(grant),/跳转异常/);checks++
audio=makeAudio(async()=>({status:302,headers:{}}))
await assert.rejects(audio.prepare(grant),/跳转异常/);checks++
let release
audio=makeAudio(()=>new Promise(r=>release=r))
const pending=audio.prepare(grant)
while(!release)await new Promise(r=>setImmediate(r))
audio.clear();release({status:302,headers:{location:'/next'}})
await assert.rejects(pending,/账号已切换/);checks++
requests=[]
audio=createQishuiAudio({request:async spec=>{requests.push(spec);return requests.length===1?{status:302,headers:{location:'https://unverified.example/audio'}}:{status:200,data:Buffer.from('fLaCfixture')}},runtime:{decodeKey:()=>{throw Error('clear audio must not decode a key')}}})
const clearAudio=await audio.prepare({url:grant.url,backupUrls:['https://backup.douyinvod.com/audio'],playAuth:''})
assert.ok(clearAudio.url.startsWith('qishui-audio:')&&requests.length===2&&!clearAudio.backupUrls);checks++
assert.equal(audio.handle(new Request(clearAudio.url)).headers.get('content-type'),'audio/flac');checks++
let attempts=0
const retryClient=new QishuiClient({pcRequest:async()=>{attempts++;if(attempts===1)throw Object.assign(Error('transient TLS reset'),{code:'ECONNRESET'});return {data:{status_code:1000016,message:'expired'}}}})
await assert.rejects(retryClient.playback('123'),/expired/);checks++
assert.equal(attempts,2);checks++
console.log(`Qishui CENC: ${checks} assertions passed (8/16-byte IV, subsamples, stco/co64, multiple chunks with gaps, unchanged offsets, malformed input).`)
