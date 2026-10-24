import assert from 'node:assert/strict'
import { KugouClient } from '../electron/kugou-client.js'
import { isKugouDirectRoute } from '../src/api/kugou-direct.js'
import { createHash, createCipheriv } from 'node:crypto'
import { kugouValidatedCredentials } from '../electron/kugou-account.js'
let checks = 0, respond, requests = [], now = 1000
const ok = (value, message) => { assert.ok(value, message); checks++ }
const reject = async (promise, expression) => { await assert.rejects(promise, expression); checks++ }
const hash = 'A'.repeat(32), other = 'B'.repeat(32)
const client = new KugouClient({ request:async config => { requests.push(config); return { data:await respond(config) } }, now:() => now, qrImage:async url => 'qr:' + url })
respond = () => ({ status:1, error_code:0, data:{ lists:[{ FileHash:hash, SongName:'Song', trans_param:{union_cover:'http://imge.kugou.com/{size}/a.jpg'} }], total:1 } })
let result = await client.call('/search',{ keywords:'陈粒', type:'song', page:2 })
ok(result.data.lists[0].Image === 'https://imge.kugou.com/480/a.jpg' && requests.at(-1).params.page === 2, 'search transports exact page and actual cover')
ok(requests.at(-1).url==='https://gateway.kugou.com/v3/search/song' && !requests.at(-1).params.token, 'guest songs use official independent origin')
await client.call('/search',{keywords:'artist',type:'author'})
const signed = requests.at(-1).params, { signature, ...unsigned } = signed, salt = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
ok(signature === createHash('md5').update(salt+Object.keys(unsigned).sort().map(k=>k+'='+unsigned[k]).join('')+salt).digest('hex').toUpperCase(), 'artist uses official web signature with exact canonical parameters')
await reject(client.call('/search',{keywords:'',type:'song'}),/关键词/)
await reject(client.call('/search',{keywords:'x',page:0}),/分页/)
ok(isKugouDirectRoute('/search',{type:'mv'}), 'MV search is routed through the native client')
respond = () => ({status:1,error_code:152,data:{lists:[],total:0}})
await reject(client.call('/search',{keywords:'x'}),/152/)
respond = () => ({status:1,error_code:0,data:{lists:[],total:0}})
ok((await client.call('/search',{keywords:'none'})).data.lists.length===0,'valid zero results distinguished from platform rejection')
respond = () => ({status:1,data:{total:3,info:[{hash}]}})
ok((await client.call('/album/songs',{id:'123',page:2,pagesize:2})).data.list.length===1 && requests.at(-1).params.page===2, 'album exact page preserved')
ok(requests.at(-1).headers.Cookie===undefined && !('token' in requests.at(-1).params), 'public HTTP metadata never carries credentials')
await reject(client.send('http://mobilecdn.kugou.com/api/v3/album/info',{token:'secret'}),/HTTPS/)
await reject(client.send('https://attacker.test/',{}),/非官方/)
await reject(client.call('/album/detail',{id:9007199254740992}),/ID/)
respond = config => config.url.endsWith('special/info') ? {status:1,data:{specialid:123,specialname:'Playlist',imgurl:'http://imge.kugou.com/a.jpg'}} : {status:1,data:{info:[{hash}],total:1}}
result = await client.call('/playlist/track/all',{id:'special:123'})
ok(result.data.list_info._officialPublic && result.data.list_info.imgurl.startsWith('https:'),'public playlist has explicit identifier namespace and loadable metadata')
ok(client.supports('/playlist/track/all',{id:'123'}),'public global collection IDs have an official native route')
respond = () => ({status:1,data:{count:1,songs:[{hash}],list_info:{name:'Collected'}}})
result = await client.call('/playlist/track/all',{id:'collection_3_2132029040_287_0'})
ok(client.supports('/playlist/detail',{ids:'collection_3_2132029040_287_0'}) && requests.at(-1).params.global_collection_id==='collection_3_2132029040_287_0' && result.data.count===1,'collected playlist uses its creator global collection ID to read songs')
respond = () => ({status:1,hash:other,extra:{'320hash':hash,'128timelength':240000},url:'https://sharefs.kugou.com/a.mp3',timeLength:240,bitRate:128})
result = await client.call('/song/url',{hash,quality:'flac'})
ok(result.data.quality==='128' && result.data.fullDuration===240 && result.data.requestedHash===hash,'official lower quality reported honestly; hash variant must belong to the same song')
respond = () => ({status:1,hash:other,url:'https://sharefs.kugou.com/a.mp3'})
await reject(client.call('/song/url',{hash}),/不匹配/)
respond = () => ({status:1,hash,url:'https://attacker.test/audio.mp3'})
await reject(client.call('/song/url',{hash}),/非官方/)
respond = () => ({status:1,hash,url:'',timeLength:240,bitRate:128})
ok((await client.call('/song/url',{hash})).data.url==='','missing play authorization remains missing')
respond = config => config.url.endsWith('/v5/url') ? {status:0,error_code:20017} : config.url.includes('wwwapi.kugou.com') ? {status:1,err_code:0,data:{hash,play_url:'https://sharefs.kugou.com/account.flac',extname:'flac',bitrate:674,timelength:240000,is_free_part:0}} : {status:1,hash,url:'https://sharefs.kugou.com/guest.mp3',timeLength:240,bitRate:128}
result = await client.call('/song/url',{hash,token:'synthetic-account-token',userid:'123',album_id:'456'})
ok(result.data.accountAuthorized && result.data.quality==='flac' && !result.data.is_trial,'account playback uses actual official authorization and lossless container, not guessed bitrate')
ok(requests.at(-1).url==='https://wwwapi.kugou.com/play/songinfo' && requests.at(-1).params.userid==='123' && requests.at(-1).params.signature,'account token and identity stay on signed official HTTPS playback endpoint')
respond = config => config.url.endsWith('/v5/url') ? {status:0,error_code:20017} : config.url.includes('wwwapi.kugou.com') ? {status:0,err_code:30020} : {status:1,hash,url:'https://sharefs.kugou.com/guest.mp3',timeLength:240,bitRate:128}
result = await client.call('/song/url',{hash,token:'synthetic-account-token',userid:'123'})
ok(!result.data.accountAuthorized && result.data.accountNotice.includes('安全验证') && result.data.quality==='128','account challenge is reported; guest fallback cannot masquerade as membership playback')
respond = config => config.url.endsWith('/v5/url') ? {status:0,error_code:20017} : config.url.includes('wwwapi.kugou.com') ? {status:1,data:{hash:other,play_url:'https://sharefs.kugou.com/wrong.mp3'}} : {status:1,hash,url:'https://sharefs.kugou.com/guest.mp3',timeLength:240,bitRate:128}
result = await client.call('/song/url',{hash,token:'synthetic-account-token',userid:'123'})
ok(!result.data.accountAuthorized && result.data.accountNotice.includes('不匹配'),'mismatched account song rejected before exact-song guest fallback')
respond = () => ({status:0,error_code:20017,data:null})
await reject(client.call('/login/token',{token:'invalid-test-token',userid:'123'}),/无效/)
const tokenRequest=requests.at(-1)
ok(tokenRequest.url==='https://loginservice.kugou.com/v1/login_by_token_get' && !JSON.stringify(tokenRequest.params).includes('invalid-test-token') && tokenRequest.params.pk.length>=250,'token validation uses HTTPS official encrypted parameters')
respond = () => ({status:1,data:{userid:'999',token:'unexpected'}})
await reject(client.call('/login/token',{token:'valid-test-token',userid:'123'}),/匹配/)
respond = () => ({status:1,data:{userid:'123',nickname:'Test user'}})
ok((await client.call('/login/token',{token:'valid-test-token',userid:'123'})).data.token==='valid-test-token','validated account preserves credential only on matching user ID')
const exchangeKey='SYNTHETICKEY12345', aesKey=createHash('md5').update(exchangeKey).digest('hex')
const encryptedCredentials=value=>{const cipher=createCipheriv('aes-256-cbc',Buffer.from(aesKey),Buffer.from(aesKey.slice(-16)));return Buffer.concat([cipher.update(value),cipher.final()]).toString('hex')}
const refreshed=kugouValidatedCredentials({userid:'123',nickname:'Test',secu_params:encryptedCredentials(JSON.stringify({token:'rotated-test-token'}))},exchangeKey,'old-test-token','123')
ok(refreshed.token==='rotated-test-token' && !('secu_params' in refreshed),'official encrypted refreshed token replaces old token; encrypted secrets are not stored as profile')
ok(kugouValidatedCredentials({userid:'123',secu_params:encryptedCredentials('raw-refreshed-token')},exchangeKey,'old-test-token','123').token==='raw-refreshed-token','official plain token payload also supported')
assert.throws(()=>kugouValidatedCredentials({userid:'123',secu_params:encryptedCredentials(JSON.stringify({token:'rotated-test-token',userid:'999'}))},exchangeKey,'old-test-token','123'),/匹配/);checks++
assert.throws(()=>kugouValidatedCredentials({userid:'123',secu_params:encryptedCredentials('{}')},exchangeKey,'old-test-token','123'),/解密失败/);checks++
respond=()=>({status:1,data:{userid:'123',secu_params:'bad-ciphertext'}})
await reject(client.call('/login/token',{token:'valid-test-token',userid:'123'}),/解密失败/)
respond = () => ({status:1,error_code:0,data:{qrcode:'qrcode-valid-key-123'}})
const key=(await client.call('/login/qr/key')).data.qrcode
ok((await client.call('/login/qr/create',{key})).data.base64==='qr:https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=3116&qrcode=qrcode-valid-key-123' && requests.at(-1).params.appid === 1001,'QR encodes concept app context and requests official desktop scan credentials')
respond = () => ({status:1,error_code:0,data:{status:1}})
ok((await client.call('/login/qr/check',{key})).data.status===1,'unscanned QR stays waiting')
let settle
respond = () => new Promise(resolve => {settle=resolve})
const pending=client.call('/login/qr/check',{key}); await Promise.resolve()
await client.call('/login/qr/cancel',{key}); settle({status:1,error_code:0,data:{status:4,token:'late-test-token',userid:'123'}})
ok((await pending).data.status===0,'cancelled QR cannot revive a session via delayed response')
respond = () => ({status:1,error_code:0,data:{qrcode:'qrcode-valid-key-456'}})
const key2=(await client.call('/login/qr/key')).data.qrcode; now+=181000
ok((await client.call('/login/qr/check',{key:key2})).data.status===0,'QR expiry returns expired and releases context')
const catalogue=Array.from({length:65},(_,i)=>({specialid:i+1,specialname:'Playlist '+i}))
respond = config => ({plist:{list:{total:catalogue.length,info:catalogue.slice((config.params.page-1)*30,config.params.page*30)}}})
const p1=await client.call('/top/playlist',{page:1,pagesize:10}),p2=await client.call('/top/playlist',{page:2,pagesize:10})
ok(p1.data.special_list[9].specialid===10 && p2.data.special_list[0].specialid===11,'fixed upstream thirty-item pages translated without skipping entries for ten-item UI pages')
result=await client.call('/top/playlist',{page:2,pagesize:40})
ok(result.data.special_list.length===25 && result.data.special_list[0].specialid===41 && result.data.has_next===0,'large public pages continue across official batches and stop at exact total')
ok(client.supports('/top/playlist',{category_id:123}) && client.supports('/top/album',{type:2}) && client.supports('/artist/lists',{sextypes:2}),'category, language and gender filters are served by the official native client')
let homes=0
respond=async()=>{homes++;await Promise.resolve();return {data:[{hash}],banner:[{imgurl:'http://imge.kugou.com/banner.jpg',extra:{specialid:123},title:'Music'},{imgurl:'https://imge.kugou.com/ad.jpg',extra:{specialid:124},isAd:1}]}}
const [newSongs,banners]=await Promise.all([client.call('/top/song'),client.call('/pc/diantai')])
ok(homes===1 && newSongs.data[0].hash===hash,'homepage requests share one in-flight official request')
ok(banners.data.data.length===1 && banners.data.data[0].url==='/kugou/playlist/special:123' && banners.data.data[0].code.startsWith('https:'),'music banner uses namespaced internal detail and excludes explicit advertising')
await client.call('/top/song');ok(homes===1,'successful public homepage cached for thirty seconds')
respond=()=>({status:1,data:{info:[{albumid:1,albumname:'New',imgurl:'http://imge.kugou.com/{size}/album.jpg'}]}})
result=await client.call('/top/album',{page:2,pagesize:10})
ok(result.data[0].imgurl==='https://imge.kugou.com/480/album.jpg' && requests.at(-1).params.page===2,'independent new albums retain page and usable artwork')
respond=()=>({status:1,data:{info:[{singerid:1,singername:'Singer',imgurl:'http://singerimg.kugou.com/{size}/singer.jpg'}]}})
result=await client.call('/artist/lists',{hotsize:30})
ok(result.data.info[0].imgurl==='https://singerimg.kugou.com/480/singer.jpg','default official singer directory returns normalized artwork')
ok(requests.every(r=>/(^|\.)kugou\.com$/.test(new URL(r.url).hostname)),'all native requests use official origins and never localhost')
respond=()=>({status:1,data:{userid:'123',is_vip:0,svip_level:5,busi_vip:[{is_vip:1,busi_type:'concept',product_type:'svip',vip_end_time:'2027-01-01'}]}})
const concept=await client.call('/login/token',{token:'valid-concept-token',userid:'123'})
ok(concept.data.conceptAuthenticated && concept.data.token==='valid-concept-token','concept authentication keeps original business token without converting to a web token')
const vipRequest=requests.at(-1),{signature:vipSign,...vipParams}=vipRequest.params
ok(vipRequest.url==='https://kugouvip.kugou.com/v1/get_union_vip' && vipParams.appid===3116 && vipParams.busi_type==='concept','membership checks use concept app and official union API')
ok(vipSign===createHash('md5').update('LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'+Object.keys(vipParams).sort().map(k=>`${k}=${vipParams[k]}`).join('')+'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA').digest('hex'),'concept API canonical signature verified independently')
respond=()=>({status:1,data:{userid:'999',busi_vip:[]}})
await reject(client.call('/user/vip/detail',{token:'valid-concept-token',userid:'123'}),/不匹配/)
respond=()=>({status:1,data:{is_vip:0,svip_level:5}})
await reject(client.call('/user/vip/detail',{token:'valid-concept-token',userid:'123'}),/不完整/)
respond=()=>({status:1,data:{info:[{listid:1}],count:1}})
await client.call('/user/playlist',{token:'valid-concept-token',userid:'123',page:2,pagesize:100})
const playlistRequest=requests.at(-1),playlistBody=JSON.parse(playlistRequest.data)
ok(playlistBody.page===2 && playlistBody.pagesize===100 && playlistBody.token==='valid-concept-token' && playlistRequest.headers['x-router']==='cloudlist.service.kugou.com','personal playlists preserve account credentials, page and cloudlist router')
await client.call('/playlist/track/all/new',{token:'valid-concept-token',userid:'123',listid:'7',page:2,pagesize:300})
ok(JSON.parse(requests.at(-1).data).listid==='7' && JSON.parse(requests.at(-1).data).page===2,'personal track list uses listid and exact page')
respond=()=>({status:1,hash:other,std_hash:hash,url:['http://fs.youthandroid2.kugou.com/authorized.flac'],extName:'flac',timeLength:236,bitRate:674000})
result=await client.call('/song/url',{token:'valid-concept-token',userid:'123',hash,quality:'flac'})
ok(result.data.accountAuthorized && result.data.quality==='flac' && result.data.fullDuration===236,'concept lossless file variant accepted only through matching official standard hash')
ok(result.data.url==='http://fs.youthandroid2.kugou.com/authorized.flac','preserve official tracker media protocol; never force unsupported TLS on its legacy CDN')
ok(requests.at(-1).params.IsFreePart===0 && requests.at(-1).params.pid===411 && requests.at(-1).params.quality==='flac','concept entitlement playback explicitly requests full recording and selected quality')
respond=()=>({status:1,hash:other,std_hash:other,url:['http://fs.youthandroid2.kugou.com/wrong.flac'],extName:'flac'})
await reject(client.privateClient.playback({token:'valid-concept-token',userid:'123'},{hash,quality:'flac'}),/匹配/)
respond = spec => ({status:1,data:{lists:[{OriSongName:'恋人',SingerName:'李荣浩',FileHash:hash}],total:224}})
const nativeSearch=await client.call('/search',{keywords:'恋人 李荣浩',type:'song',page:2,pagesize:30,token:'fixture-token',userid:'123'})
const nativeSpec=requests.at(-1)
ok(nativeSpec.url==='https://gateway.kugou.com/v3/search/song' && nativeSpec.headers['x-router']==='complexsearch.kugou.com','logged search uses native App catalogue, independently signed')
ok(nativeSpec.params.platform==='AndroidFilter' && nativeSpec.params.keyword==='恋人 李荣浩' && nativeSpec.params.page===2 && nativeSpec.params.signature,'native search preserves exact keyword and pagination in signature')
ok(nativeSearch.data.lists[0].OriSongName==='恋人' && nativeSearch.data.total===224,'native original recording metadata is preserved')
const countBeforeChallenge=requests.length
respond=()=>({status:0,error_code:20028})
await reject(client.call('/song/url',{hash,token:'fixture-token',userid:'123',quality:'high'}),/安全验证/)
ok(requests.length===countBeforeChallenge+1,'native challenge never cascades into web/guest requests')
let retryCalls=0
respond=config=>{
    if(config.url.endsWith('/v5/url')) {
        retryCalls++
        if(retryCalls===1) return {status:0,error_code:20028}
        return {status:1,data:{hash,url:['http://fs.youthandroid2.kugou.com/playlist-fallback.mp3'],extName:'mp3',bitRate:128000,timeLength:236}}
    }
    return {status:0,error_code:20017}
}
result=await client.call('/song/url',{hash,token:'fixture-token',userid:'123',album_id:'9007199254740991',album_audio_id:'9007199254740992',quality:'128'})
ok(retryCalls===2&&result.data.url.endsWith('playlist-fallback.mp3'),'playlist validation retries account playback with hash-only identifiers')
ok(requests.at(-2).params.album_audio_id==='9007199254740992'&&requests.at(-1).params.album_audio_id==='0','large playlist identifiers stay exact, then hash-only retry clears stale catalogue IDs')
console.log(`Kugou independent client checks passed: ${checks} assertions.`)
