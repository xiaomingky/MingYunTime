import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
const { createPinia, setActivePinia } = createRequire(import.meta.url)('pinia')

// Bundle the production stores with API-only substitutes. Every account and
// write in this suite is synthetic; no request reaches a music service.
let checks = 0
let pending, work
const ok = (condition, label) => { assert.ok(condition, label); checks++ }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function harness(entry, apiPath) {
    const source = readFileSync(entry, 'utf8')
    const names = source.match(new RegExp(`(?:import (?:request, )?)?\\{([^}]*)\\} from '${apiPath.replaceAll('/', '\\/')}'`))[1]
        .split(',').map(s => s.trim()).filter(Boolean)
    const memory = new Map(), calls = [], handlers = {}, timers = new Map()
    const storage = { getItem:k => memory.get(k) ?? null, setItem:(k,v) => memory.set(k,String(v)), removeItem:k => memory.delete(k) }
    let timerId = 0
    const api = { call(name, args) { calls.push({name,args}); if (handlers[name]) return handlers[name](...args); if (/^getKugou/.test(name)) return name==='getKugouProfile'?null:''; return Promise.resolve({}) } }
    const output = await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['pinia'],plugins:[{
        name:'isolated-account-services',setup(b) {
            b.onResolve({filter:/^\.\.\/api(?:\/kugou)?$/},args => ({path:args.path,namespace:'api-test'}))
            b.onLoad({filter:/.*/,namespace:'api-test'},() => ({contents:`export default {get:(...a)=>__api.call('get',a),post:(...a)=>__api.call('post',a)};${names.map(n => `export const ${n}=(...a)=>__api.call('${n}',a);`).join('')}`,loader:'js'}))
            b.onResolve({filter:/^\.\/message$/},() => ({path:'message',namespace:'message-test'}))
            b.onLoad({filter:/.*/,namespace:'message-test'},() => ({contents:'export const useMessageStore=()=>({success(){},error(){},warning(){},info(){}})',loader:'js'}))
        }
    }]})
    const module = {exports:{}}
    const setTimer = fn => { const id=++timerId; timers.set(id,fn); return id }
    new Function('require','module','exports','localStorage','__api','setTimeout','clearTimeout','setInterval','clearInterval',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports,storage,api,setTimer,id=>timers.delete(id),setTimer,id=>timers.delete(id))
    setActivePinia(createPinia())
    const store = Object.values(module.exports).find(v => typeof v==='function')()
    return {store,handlers,memory,calls,async poll(){const [id,fn]=timers.entries().next().value || [];assert.ok(fn,'poll timer exists');timers.delete(id);await fn();await tick()}}
}

const n = await harness('src/store/user.js','../api'), ns = n.store
const identity = id => ({code:200,account:{id},profile:{userId:id,nickname:'Synthetic'}})
n.handlers.get = async route => route==='/login/status' ? identity(11) : {}
ns.fetchStatus = async () => true
ok((await ns.loginWithCookie('MUSIC_U=old')).success && n.memory.get('music_cookie').includes('old'),'Netease accepts only officially matched identity')
n.handlers.get=async (route,...args)=>{if(route==='/like'){n.lastLikeParams=args[0]?.params;return {code:200}}return identity(11)}
ok(await ns.setSongLiked(123,true) && ns.isSongLiked(123),'Netease like updates local state only after official success')
ok(n.lastLikeParams.like===true && String(n.lastLikeParams.uid)==='11','Netease song-like write includes the active account identity and desired state')
n.handlers.get=async route=>route==='/like'?{code:503,message:'write rejected'}:identity(11)
await assert.rejects(ns.setSongLiked(123,false),/write rejected/)
ok(ns.isSongLiked(123),'rejected Netease unlike preserves the current liked state')
pending=deferred();n.handlers.get=()=>pending.promise
const likeWork=ns.setSongLiked(124,true)
ok(!(await ns.setSongLiked(124,false)),'duplicate Netease like writes for one song are ignored while pending')
pending.resolve({code:200});await likeWork
pending=deferred();n.handlers.get=()=>pending.promise
work=ns.setSongLiked(125,true);ns.logout();pending.resolve({code:200});await work
ok(!ns.isLoggedIn && !ns.isSongLiked(125),'late Netease like result cannot repopulate a logged-out account')
n.handlers.get=async()=>identity(11);await ns.loginWithCookie('MUSIC_U=old')
n.handlers.get = async () => ({code:200,account:{id:11},profile:{userId:22}})
ok(!(await ns.loginWithCookie('MUSIC_U=wrong')).success && ns.cookie.includes('old'),'mismatched candidate does not replace valid Netease session')
pending=deferred();n.handlers.get=()=>pending.promise
work=ns.loginWithCookie('MUSIC_U=late');ns.logout();pending.resolve(identity(11));await work
ok(!ns.isLoggedIn && !n.memory.has('music_cookie'),'late Netease Cookie validation after logout cannot restore credentials')
pending=deferred();n.handlers.get=()=>pending.promise
let active=true;work=ns.loginWithCookie('MUSIC_U=closed',()=>active);active=false;pending.resolve(identity(11));await work
ok(!ns.isLoggedIn,'closing Netease login during identity validation cancels acceptance')
n.handlers.get=async()=>identity(11);await ns.loginWithCookie('MUSIC_U=good')
n.handlers.loginCellphone=async()=>({code:502,message:'rejected'})
ok(!(await ns.loginWithPhone({phone:'synthetic'})).success && n.memory.get('music_cookie').includes('good'),'failed phone login preserves stored working Cookie')
for(const [name,args,response,verify] of [
    ['fetchUserDetail',[11],{profile:{userId:11,nickname:'late'}},()=>ns.profile===null],
    ['fetchVipInfo',[],{code:200,data:{vip:true}},()=>ns.vipInfo===null],
    ['fetchUserPlaylists',[11],{playlist:[{id:1}]},()=>ns.playlists.length===0],
    ['fetchLikeList',[11],{ids:[123]},()=>ns.likedSongIds.size===0]
]) {
    n.handlers.get=async()=>identity(11);await ns.loginWithCookie('MUSIC_U=good')
    pending=deferred();n.handlers.get=()=>pending.promise;work=ns[name](...args)
    ns.logout();pending.resolve(response);await work
    ok(!ns.isLoggedIn && verify(),`late Netease ${name} cannot repopulate logged-out account`)
}
n.handlers.get=async()=>identity(11);await ns.loginWithCookie('MUSIC_U=good')
for(const code of [400,502]) {
    n.handlers.post=async()=>({code,message:'request rejected'})
    ok(!(await ns.addTrackToPlaylist(1,123)).success,`Netease ${code} cannot masquerade as duplicate success`)
}
n.handlers.post=async()=>({code:400,message:'歌曲已存在'})
ok((await ns.addTrackToPlaylist(1,123)).success,'explicit already-present result remains idempotent')
pending=deferred();n.handlers.post=()=>pending.promise;work=ns.addTrackToPlaylist(1,123);ns.logout();pending.resolve({code:200});await work
ok(!ns.isLoggedIn && ns.playlists.length===0,'late Netease write result cannot refresh account after logout')

const k=await harness('src/store/kugou-user.js','../api/kugou'), ks=k.store
k.handlers.getKugouCookie=()=>'';k.handlers.getKugouUserid=()=>''
k.handlers.setKugouCookie=t=>k.memory.set('cookie',t)
k.handlers.setKugouProfile=p=>k.memory.set('profile',p)
k.handlers.clearKugouCookie=()=>k.memory.delete('cookie')
k.handlers.clearKugouProfile=()=>k.memory.delete('profile')
const kgIdentity=id=>({status:1,error_code:0,data:{userid:String(id),nickname:'Synthetic'}})
k.handlers.kugouLoginToken=async()=>kgIdentity(11)
ok(await ks.cookieLogin('token=synthetic-good-token;userid=11'),'Kugou matched candidate accepted after official verification')
ok(!k.memory.get('profile').token,'token is omitted from saved public profile')
k.handlers.kugouLoginToken=async()=>({status:0,error_code:20017})
ok(!await ks.cookieLogin('token=synthetic-bad-token;userid=11') && ks.cookie==='synthetic-good-token','rejected Kugou Cookie preserves working session')
k.handlers.kugouLoginToken=async()=>kgIdentity(22)
ok(!await ks.cookieLogin('token=synthetic-other-token;userid=11') && ks.userid==='11','mismatched Kugou account is rejected')
pending=deferred();k.handlers.kugouLoginToken=()=>pending.promise
work=ks.cookieLogin('token=synthetic-late-token;userid=11');ks.logout();pending.resolve(kgIdentity(11));await work
ok(!ks.isLoggedIn && !k.memory.has('cookie'),'late Kugou token validation cannot restore logged-out account')
for(const [name,response,verify] of [
    ['fetchRealProfile',{status:1,data:{nickname:'late'}},()=>ks.profile===null],
    ['fetchVipInfo',{status:1,data:{is_vip:1}},()=>ks.vipInfo===null],
    ['fetchUserPlaylists',{status:1,data:{info:[{id:1}]}},()=>ks.playlists.length===0]
]) {
    ks._applyKugouLogin('synthetic-good-token','11',kgIdentity(11).data);await tick()
    pending=deferred();const apiName={fetchRealProfile:'kugouUserDetail',fetchVipInfo:'kugouUserVip',fetchUserPlaylists:'kugouUserPlaylist'}[name]
    k.handlers[apiName]=()=>pending.promise;work=ks[name]();ks.logout();pending.resolve(response);await work
    delete k.handlers[apiName]
    ok(!ks.isLoggedIn && verify(),`late Kugou ${name} cannot repopulate logged-out account`)
}
ks._applyKugouLogin('synthetic-good-token','11',kgIdentity(11).data);await tick();ks.likedPlaylistId='liked'
const song={hash:'A'.repeat(32),name:'Synthetic',album_audio_id:123}
k.handlers.kugouLikeSong=async()=>({status:0,error_code:300})
ok(!await ks.toggleLikeSong(song) && !ks.isSongLiked(song.hash),'server-rejected like never lights the heart')
k.handlers.kugouLikeSong=async()=>({status:1,error_code:0})
ok(await ks.toggleLikeSong(song) && ks.isSongLiked(song.hash),'verified successful like updates heart')
k.handlers.kugouPlaylistTracksDel=async()=>({status:0,error_code:300})
ok(!await ks.toggleLikeSong(song) && ks.isSongLiked(song.hash),'server-rejected unlike preserves the heart')
ks.likedSongsHashes=[];pending=deferred();k.handlers.kugouLikeSong=()=>pending.promise
work=ks.toggleLikeSong(song);ks.logout();pending.resolve({status:1});await work
ok(!ks.isLoggedIn && !ks.isSongLiked(song.hash),'late like result cannot write to another account')
k.handlers.kugouQrKey=async()=>({status:1,data:{qrcode:'synthetic-qr',qrcode_img:'data:image/png;base64,test'}})
k.handlers.kugouQrCheck=async()=>({status:1,data:{status:4,token:'synthetic-qr-token',userid:'11'}})
pending=deferred();k.handlers.kugouLoginToken=()=>pending.promise
const image={value:''},status={value:0},message={value:''}
const stop=await ks.qrLogin(image,status,message)
work=k.poll();await tick();stop();pending.resolve(kgIdentity(11));await work
ok(!ks.isLoggedIn && status.value!==4,'closing Kugou QR during token verification prevents login')
for(const apiName of ['kugouLoginUsername','kugouLoginCellphone','kugouLoginOpenplat']) {
    pending=deferred();k.handlers[apiName]=()=>pending.promise
    work=apiName==='kugouLoginUsername'?ks.usernameLogin('synthetic','test'):apiName==='kugouLoginCellphone'?ks.phoneLogin('synthetic','test'):ks._loginWithWxCode('synthetic')
    ks.logout();pending.resolve({status:1,data:{userid:'11',token:'late-token'}});await work
    ok(!ks.isLoggedIn,`late ${apiName} cannot bypass official validation or logout`)
}
ok(!ks._isKugouSuccess({status:0,error_code:0}) && !ks._isKugouSuccess({status:1,error_code:1}),'explicit failure status/error overrides empty error or success flag')
ks._applyKugouLogin('synthetic-good-token','11',kgIdentity(11).data);await tick()
ks.playlists=[{id:'kept',name:'cached'}]
k.handlers.kugouUserPlaylist=async()=>({status:0,error_code:20017})
ok(!await ks.fetchUserPlaylists() && ks.playlistsError.includes('20017') && ks.playlists[0].id==='kept','rejected playlist auth is visible and preserves cached account playlists')
k.handlers.kugouUserPlaylist=async()=>({status:1,data:{}})
ok(!await ks.fetchUserPlaylists() && !!ks.playlistsError,'malformed successful response cannot masquerade as empty library')
k.handlers.kugouUserPlaylist=async()=>({status:1,data:{info:[]}})
ok(await ks.fetchUserPlaylists() && !ks.playlistsError && !ks.playlistsLoading && ks.playlists.length===0,'valid empty library clears errors after retry')
pending=deferred();k.handlers.kugouUserPlaylist=()=>pending.promise;work=ks.fetchUserPlaylists()
ks.logout();pending.resolve({status:0,error_code:20017});await work
ok(!ks.playlistsError && !ks.playlistsLoading,'late playlist failure cannot restore errors after logout')
ks._applyKugouLogin('synthetic-good-token','11',kgIdentity(11).data);await tick()
k.handlers.normalizeKugouPlaylist=p=>({...p,id:String(p.listid)})
k.handlers.kugouUserPlaylist=async page=>({status:1,data:{info:page===1?Array.from({length:100},(_,i)=>({listid:i+1,name:'List'})):[{listid:101,name:'Last'}]}})
ok(await ks.fetchUserPlaylists() && ks.playlists.length===101,'Kugou personal playlists continue beyond first hundred entries')
k.handlers.kugouUserPlaylist=async page=>page===1?{status:1,data:{info:Array.from({length:100},(_,i)=>({listid:i+1}))}}:{status:0,error_code:20017}
ok(!await ks.fetchUserPlaylists() && ks.playlists.length===101 && ks.playlistsError.includes('20017'),'later page failure preserves complete last library rather than replacing it with partial data')
console.log(`Account isolation checks passed: ${checks} assertions (synthetic APIs; no real writes).`)
