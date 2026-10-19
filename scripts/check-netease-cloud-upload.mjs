import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createDecipheriv,createHash} from 'node:crypto'
import {uploadNeteaseCloud} from '../electron/netease-cloud-upload.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mingyun-cloud-'))
const filePath=path.join(root,'中文测试.mp3'), bytes=Buffer.from('synthetic-audio-upload-fixture')
fs.writeFileSync(filePath,bytes)
const input={filePath,filename:'中文测试.mp3',cookie:'MUSIC_U=fixture-session; __csrf=fixture-csrf',song:'自定义标题',artist:'歌手',album:'专辑'}
function decode(config) {
 const cipher=createDecipheriv('aes-128-ecb',Buffer.from('e82ckenh8dichen8'),null)
 const encrypted=Buffer.from(new URLSearchParams(config.data).get('params'),'hex')
 const [route,json,digest]=Buffer.concat([cipher.update(encrypted),cipher.final()]).toString().split('-36cd479b6b5-')
 assert.equal(digest,createHash('md5').update(`nobody${route}use${json}md5forencrypt`).digest('hex'))
 const body=JSON.parse(json);assert.equal(body.header.MUSIC_U,'fixture-session');assert.equal(body.header.__csrf,'fixture-csrf')
 return {route,body}
}
try {
 for(const needUpload of [true,false]) {
  const routes=[],progress=[];let uploads=0,lbs=0,info=0,pubs=0
  const client={request:async config=>{
   if(config.url.includes('/eapi/')) {
    const {route,body}=decode(config);routes.push(route)
    if(route.endsWith('/check')) {assert.equal(body.md5,createHash('md5').update(bytes).digest('hex'));return {data:{code:200,needUpload,songId:'100'}}}
    if(route.includes('/info/')) {info++;assert.equal(body.song,'自定义标题');assert.equal(body.songid,'100');return {data:{code:200,songId:'200'}}}
    pubs++;assert.equal(body.songid,'200');return {data:pubs===1?{code:500,msg:'处理中'}:{code:200}}
   }
   if(config.url.includes('/weapi/nos/token/alloc'))return {data:{code:200,result:{resourceId:'resource',token:'nos-fixture',objectKey:'a/b'}}}
   if(config.url.includes('/lbs')) {lbs++;return {data:{upload:['http://nosup-hz1.127.net']}}}
   uploads++;assert.ok(config.url.includes('/a%2Fb?'));assert.equal(config.headers.Cookie,undefined);const chunks=[];for await(const chunk of config.data)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return {status:200}
  }}
  const result=await uploadNeteaseCloud(client,input,(p)=>progress.push(p),async()=>{})
  assert.equal(result.songId,'200');assert.equal(result.needUpload,needUpload);assert.equal(uploads,needUpload?1:0);assert.equal(lbs,needUpload?1:0);assert.equal(info,1);assert.equal(pubs,2);assert.equal(progress.at(-1),100)
 }
 await assert.rejects(uploadNeteaseCloud({request:async()=>({data:{code:301,msg:'请登录'}})},input),/请登录/)
 await assert.rejects(uploadNeteaseCloud({}, {...input,cookie:''}),/重新登录/)
 fs.writeFileSync(filePath,'')
 await assert.rejects(uploadNeteaseCloud({},input),/非空/)
 console.log('NetEase cloud upload passed: native encryption, full stream, instant upload, final ID, publish retry, login and empty file errors. No real account writes.')
} finally {fs.rmSync(root,{recursive:true,force:true})}
