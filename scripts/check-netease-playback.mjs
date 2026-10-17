import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { NeteasePlayback, decodeNeteasePlayback } from '../electron/netease-playback.js'
const key = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84','hex')
const signKey = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g=='
const peer = generateKeyPairSync('x25519'), spki=Buffer.from('302a300506032b656e032100','hex')
const ecb=(key,data,decode=false)=>{const c=(decode?createDecipheriv:createCipheriv)(`aes-${key.length*8}-ecb`,key,null);return Buffer.concat([c.update(data),c.final()])}
const signature=(time,nonce)=>createHmac('sha256',signKey).update(String(time)+nonce).digest('base64')
let count=0, clock=1800000000000, checks=0, requests=[], invalidSignature=false
const ok=(v,label)=>{assert.ok(v,label);checks++}
const request=async spec=>{
 requests.push(spec)
 assert.equal(spec.maxRedirects,0)
 if(spec.url.includes('/security/key/get')){
  count++;const fields=Object.fromEntries(new URLSearchParams(spec.data))
  assert.equal(fields.signature,signature(fields.timestamp,fields.nonce))
  assert.ok(!spec.headers.Cookie.includes('MUSIC_U'))
  return {data:{code:200,data:{timestamp:clock,signature:invalidSignature?'wrong':signature(clock,fields.nonce),encryptedData:ecb(key,Buffer.from(JSON.stringify({publicKey:peer.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64'),sk:'fixture-sk',version:'1'}))).toString('base64')}}}
 }
 assert.equal(spec.url,'https://interface3.music.163.com/xeapi/song/enhance/player/url/v1')
 const {B,S,R}=Object.fromEntries(new URLSearchParams(spec.data)),wrapped=Buffer.from(S,'base64')
 const ephemeral=wrapped.subarray(0,32),secret=diffieHellman({privateKey:peer.privateKey,publicKey:createPublicKey({key:Buffer.concat([spki,ephemeral]),type:'spki',format:'der'})})
 const prk=createHmac('sha256',Buffer.alloc(32)).update(secret).digest()
 const wrappingKey=createHmac('sha256',prk).update(Buffer.concat([ephemeral,Buffer.from([1])])).digest().subarray(0,16)
 const decipher=createDecipheriv('aes-128-gcm',wrappingKey,wrapped.subarray(32,44));decipher.setAuthTag(wrapped.subarray(-16))
 const [dynamic,os,sk]=Buffer.concat([decipher.update(wrapped.subarray(44,-16)),decipher.final()]).toString().split('|')
 assert.equal(os,'android');assert.equal(sk,'fixture-sk');assert.equal(ecb(key,Buffer.from(R,'base64'),true).toString(),'1|')
 const masked=ecb(Buffer.from(dynamic,'base64'),Buffer.from(B,'base64'),true),mask=masked.subarray(0,16),rotated=masked.subarray(16),shift=(mask[0]&15)%rotated.length
 const unrotated=Buffer.concat([rotated.subarray(rotated.length-shift),rotated.subarray(0,rotated.length-shift)])
 const xor=Buffer.from(unrotated.toString(),'base64'),inner=Buffer.from(xor.map((v,i)=>v^mask[i%16]))
 const body=JSON.parse(ecb(key,inner,true).toString());assert.equal(body.queryString,'e_r=true')
 const fields=Object.fromEntries(new URLSearchParams(Buffer.from(body.body,'base64').toString()))
 assert.equal(fields.ids,'["347230"]');assert.equal(fields.level,'lossless');assert.equal(fields.encodeType,'flac')
 assert.equal(spec.headers['x-music-u'],spec.headers.Cookie.split('=')[1])
 const response=Buffer.from(JSON.stringify({code:200,data:[{id:347230,type:'flac',level:'lossless'}]}))
 return {data:ecb(Buffer.from('e82ckenh8dichen8'),gzipSync(response))}
}
const playback=new NeteasePlayback({request,now:()=>clock}),params={ids:'["347230"]',level:'lossless',encodeType:'flac'}
const results=await Promise.all([playback.playback(params,'MUSIC_U=fixture-one'),playback.playback(params,'MUSIC_U=fixture-two')])
ok(count===1,'concurrent playback shares only the public handshake')
ok(results.every(r=>r.data[0].type==='flac'),'server decrypts native request and client decrypts gzip response')
const streams=requests.filter(r=>r.url.includes('/xeapi/'))
ok(streams[0].headers.Cookie!==streams[1].headers.Cookie,'each request preserves its own account')
ok(streams[0].data!==streams[1].data,'ephemeral encryption is unique')
await playback.playback(params,'MUSIC_U=fixture-one');ok(count===1,'public handshake cache reused')
clock+=21*60*1000;await playback.playback(params,'MUSIC_U=fixture-one');ok(count===2,'public handshake expires')
invalidSignature=true;clock+=21*60*1000
await assert.rejects(playback.playback(params,'MUSIC_U=fixture-one'),/签名校验/);checks++
invalidSignature=false;await playback.playback(params,'MUSIC_U=fixture-one');ok(count===4,'failed handshake is not cached')
await assert.rejects(playback.playback(params,'MUSIC_U=fixture\r\nX=bad'),/Cookie/);checks++
const failed=new NeteasePlayback({request:async()=>{throw {response:{status:403},config:{Cookie:'secret'}}}})
await assert.rejects(failed.publicKey(),e=>e.message.includes('403')&&!e.message.includes('secret'));checks++
ok(decodeNeteasePlayback(Buffer.from('{"code":200}')).code===200,'plaintext official error JSON is supported')
assert.throws(()=>decodeNeteasePlayback(Buffer.from('invalid')));checks++
console.log(`NetEase native encrypted playback: ${checks} checks passed (server decryption, gzip, account isolation, signature rejection and key renewal).`)
