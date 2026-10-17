import assert from 'node:assert/strict'
import { QQClient } from '../electron/qq-client.js'
import { KugouClient } from '../electron/kugou-client.js'
import { resolveKugouPlaylistFileIds } from '../src/utils/kugou-playlists.js'
let requests = [], response
const request = async config => { requests.push(config); return {data:response} }
const qq = new QQClient({request})
response = {code:0,req:{code:0,data:{result:{tid:'1234',dirId:7}}}}
await qq.createPlaylist('  测试歌单  ', 'uin=123; qm_keyst=synthetic')
assert.deepEqual(requests.at(-1).data.req, {module:'music.musicasset.PlaylistBaseWrite',method:'AddPlaylist',param:{dirName:'测试歌单',dirDesc:'',dirPicUrl:'',taglist:[]}})
assert.equal(requests.at(-1).data.comm.uin,'123')
await qq.deletePlaylist('7','uin=123; qm_keyst=synthetic')
assert.equal(requests.at(-1).data.req.param.dirId,7)
response = {code:0,req:{code:1000}}
await assert.rejects(qq.createPlaylist('test','x'),/1000/)
await assert.rejects(qq.createPlaylist(' ','x'),/不能为空/)
const kg = new KugouClient({request}), auth={token:'synthetic-token',userid:'123',listid:'9'}
const hash='A'.repeat(32)
response = {status:1,error_code:0}
await kg.call('/playlist/tracks/add',{...auth,songs:[{name:'逗号,和|符号',hash,album_id:'',mixsongid:'456'}]})
let sent=JSON.parse(requests.at(-1).data)
assert.equal(sent.data[0].name,'逗号,和|符号')
assert.equal(sent.data[0].album_id,0)
assert.equal(sent.data[0].mixsongid,456)
assert.equal(sent.data[0].hash,hash)
assert.equal(requests.at(-1).url,'https://gateway.kugou.com/cloudlist.service/v6/add_song')
await kg.call('/playlist/tracks/del',{...auth,fileids:['987']})
assert.deepEqual(JSON.parse(requests.at(-1).data).data,[{fileid:987}])
assert.equal(requests.at(-1).headers['x-router'],'cloudlist.service.kugou.com')
await assert.rejects(kg.call('/playlist/tracks/del',{...auth,fileids:hash}),/ID/)
response={status:0,error_code:20028}
await assert.rejects(kg.call('/playlist/tracks/add',{...auth,songs:[{name:'x',hash}]}),/安全验证/)
const pages=[]
const ids=await resolveKugouPlaylistFileIds('9',[{hash,album_audio_id:'456',fileid:'456'}],async(_,page)=>{pages.push(page);return {data:{info:page===1?Array.from({length:300},(_,i)=>({hash:'B'.repeat(32),fileid:i+1})):[{hash:hash.toLowerCase(),fileid:987,album_audio_id:456}]}}})
assert.deepEqual(ids,['987']);assert.deepEqual(pages,[1,2])
await assert.rejects(resolveKugouPlaylistFileIds('9',[{hash}],async()=>({data:{info:[{hash,album_audio_id:456}]}})),/未执行移除/)
await assert.rejects(resolveKugouPlaylistFileIds('9',[{hash}],async()=>({data:{info:[]}}),()=>false),/账号已切换/)
console.log('Playlist mutation regression passed: QQ official create/delete contracts, rejection; Kugou structured song identity, separators, missing album, entry IDs, pagination and account changes.')
