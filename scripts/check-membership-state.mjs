import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {build} from 'esbuild'
import {membership,vipFlag} from '../src/utils/membership.js'
import {playlistGroups} from '../src/utils/playlist-library.js'
const require=createRequire(import.meta.url),{createPinia,setActivePinia}=require('pinia')
let checks=0
const ok=(v,label)=>{assert.ok(v,label);checks++}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
ok(!vipFlag('0')&&!vipFlag(0)&&!vipFlag(false),'string zero never grants membership')
for(const p of ['kugou','netease','qq','qishui'])ok(membership(p,null,null).status==='unknown',p+' absent profile is unknown')
ok(membership('kugou',{svip_level:5,is_vip:0},null).status==='unknown','Kugou historic level does not masquerade as live membership')
const details={is_vip:0,busi_vip:[{is_vip:'1',busi_type:'concept',product_type:'svip',vip_end_time:'2027-01-01'},{is_vip:1,busi_type:'concept',product_type:'tvip',vip_end_time:'2027-02-01'}]}
const kg=membership('kugou',{},details)
ok(kg.status==='active'&&kg.expiresAt==='2027-01-01'&&kg.benefits.length===2,'concept rights override inactive standard subscription and preserve distinct expiries')
ok(membership('kugou',{svip_level:5},{busi_vip:[]}).status==='inactive','confirmed empty rights represent nonmember')
ok(membership('kugou',{}, {is_vip:1,vip_end_time:'2027-01-01',busi_vip:[]}).status==='active','explicit active standard Kugou VIP also recognized when concept rights are absent')
ok(membership('netease',{}, {redplus:{isSign:false},associator:{isSign:true,expireTime:2000}},1000).label==='黑胶 VIP','Netease active associator parsed independently of icon availability')
ok(membership('netease',{}, {associator:{isSign:true,expireTime:900}},1000).status==='inactive','expired Netease membership cannot stay active')
ok(membership('qq',{isVip:true,vipLevel:2}).label==='豪华绿钻','QQ membership tier preserved')
ok(membership('qishui',{isVip:'0'}).status==='inactive','Qishui false string is nonmember')
ok(membership('netease',{}, {associator:{isSign:true,expireTime:2000}},1000).icon.endsWith('netease-vip.png'),'Netease active VIP uses original APK artwork when API omits icon')
ok(membership('netease',{}, {redplus:{isSign:true},redVipLevelIcon:'official-level-icon'}).icon==='official-level-icon','API level-specific official artwork takes priority')
ok(membership('qishui',{isVip:true,vipStage:'svip'}).icon.endsWith('qishui-svip.png')&&membership('kugou',{},details).icon.endsWith('kugou-svip.webp'),'Qishui and Kugou actual tiers select their official APK badges')
const grouped=playlistGroups('netease',{profile:{userId:12},likedPlaylistId:1,playlists:[{id:'1'},{id:2,creator:{userId:12}},{id:3,creator:{userId:13}},{id:4,subscribed:true,creator:{userId:12}}]})
ok(grouped.created.length===1&&grouped.collected.length===2,'management excludes likes by normalized ID and separates other creators and subscriptions')
ok(playlistGroups('kugou',{likedPlaylistId:'1',playlists:[{id:1,isMine:true},{id:2,isMine:true},{id:3,isMine:false}]}).collected[0].id===3,'Kugou management preserves normalized own and collected groups')

async function harness(entry,apiPath){
 const source=readFileSync(entry,'utf8'),names=source.match(new RegExp(`import (?:request, )?\\{([^}]*)\\} from '${apiPath}'`))[1].split(',').map(s=>s.trim()).filter(Boolean)
 const handlers={},storage=new Map(),api={call(n,args){return handlers[n]?.(...args)}}
 const output=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['pinia'],plugins:[{name:'membership-services',setup(b){
  b.onResolve({filter:/^\.\.\/api(?:\/.*)?$/},()=>({path:'api',namespace:'mock'}))
  b.onResolve({filter:/^\.\/(player|message)$/},a=>({path:a.path.slice(2),namespace:'mock'}))
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path==='api'?`export default {get:(...a)=>__api.call('get',a)};${names.map(n=>`export const ${n}=(...a)=>__api.call('${n}',a);`).join('')}`:a.path==='player'?`export const usePlayerStore=()=>({currentSong:{},playlist:[]})`:`export const useMessageStore=()=>({success(){},error(){},warning(){}})`}))
 }}]})
 const module={exports:{}}
 new Function('require','module','exports','localStorage','__api',output.outputFiles[0].text)(require,module,module.exports,{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},api)
 setActivePinia(createPinia());return {store:Object.values(module.exports).find(v=>typeof v==='function')(),handlers}
}
for(const [platform,file,path,method,good,bad]of [
 ['kugou','kugou-user','../api/kugou','kugouUserVip',{status:1,data:details},{status:0,error_code:20017}],
 ['netease','user','../api','get',{code:200,data:{associator:{isSign:true,expireTime:Date.now()+100000}}},{code:403}],
 ['qq','qq-user','../api/qq','qqValidateSession',{code:0,data:{userId:'123',isVip:true,vipLevel:2}},{code:-1,message:'expired'}],
 ['qishui','qishui-user','../api/qishui','qishuiInvoke',{isLoggedIn:true,profile:{userId:'123',isVip:true}},{isLoggedIn:false,message:'expired'}]
]){
 const {store:s,handlers:h}=await harness(`src/store/${file}.js`,path)
 s.isLoggedIn=true;s.profile={userId:'123',userid:'123'};s.userid='123';s.uin='123';s.cookie='synthetic-token'
 h[method]=async()=>good
 ok(await s.fetchVipInfo()&&!s.vipError&&s.vipCheckedAt>0,platform+' live member query applied')
 const previous=s.vipInfo||s.profile
 h[method]=async()=>bad
 ok(!await s.fetchVipInfo()&&!!s.vipError&&(s.vipInfo||s.profile)===previous,platform+' query failure retains last confirmed rights and reports failure')
 h[method]=async()=>good;await s.fetchVipInfo()
 ok(!s.vipError&&!s.vipLoading,platform+' retry clears failure state')
 const late=deferred();h[method]=()=>late.promise
 const work=s.fetchVipInfo();s.revision++;s.isLoggedIn=false;s.profile=null;s.vipInfo=null
 late.resolve(good);await work
 ok(!s.profile&&!s.vipInfo,platform+' delayed query cannot populate logged-out account')
 s.isLoggedIn=true;s.profile={userId:'123',userid:'123'}
 const first=deferred(),second=deferred();let count=0;h[method]=()=>++count===1?first.promise:second.promise
 const a=s.fetchVipInfo(),b=s.fetchVipInfo();second.resolve(good);await b;first.resolve(bad);await a
 ok(!s.vipError&&!s.vipLoading,platform+' old failed refresh cannot override newer successful response')
}
{
 const {store:s,handlers:h}=await harness('src/store/qq-user.js','../api/qq')
 s.isLoggedIn=true;s.uin='123';s.cookie='synthetic-token'
 const group=(id,kind)=>({code:0,data:{playlists:[{id,name:id,kind,song_count:3}],hasMore:false}})
 const older={created:deferred(),collected:deferred()}
 h.qqPlaylistGroup=(_uin,kind)=>older[kind].promise
 const a=s.fetchUserPlaylists()
 h.qqPlaylistGroup=async(_uin,kind)=>group('new-'+kind,kind)
 await s.fetchUserPlaylists();older.created.resolve(group('old-created','created'));older.collected.resolve(group('old-collected','collected'));await a
 ok(s.createdPlaylists[0].id==='new-created'&&s.collectedPlaylists[0].id==='new-collected'&&!s.playlistsLoading,'QQ older playlist refresh cannot replace newer created or collected lists')
 h.qqPlaylistGroup=async(_uin,kind)=>kind==='created'?{code:-1,message:'denied'}:group('updated-collected',kind)
 await s.fetchUserPlaylists()
 ok(s.createdPlaylists[0].id==='new-created'&&s.collectedPlaylists[0].id==='updated-collected'&&s.playlistsError.includes('自建'),'QQ one failed group retains its cache while the other refreshes')
 const late={created:deferred(),collected:deferred()}
 h.qqPlaylistGroup=(_uin,kind)=>late[kind].promise
 const pending=s.fetchUserPlaylists();s.revision++;s.playlists=[];s.collectedPlaylists=[];s.playlistsLoading=false
 late.created.resolve(group('previous-created','created'));late.collected.resolve(group('previous-collected','collected'));await pending
 ok(!s.playlists.length&&!s.collectedPlaylists.length&&!s.playlistsLoading,'QQ late playlist groups cannot populate a different account')
}
{
 const {store:s,handlers:h}=await harness('src/store/user.js','../api')
 s.isLoggedIn=true;s.profile={userId:12}
 let offsets=[]
 h.get=async(route,{params})=>route==='/likelist'?{ids:[]}:(offsets.push(params.offset),params.offset===0?{code:200,playlist:[{id:1,specialType:5},{id:2}],more:true}:{code:200,playlist:[{id:3}],more:false})
 ok(await s.fetchUserPlaylists(12)&&s.playlists.length===3&&s.likedPlaylistId===1&&offsets.join(',')==='0,2','Netease management loads all pages using actual returned counts')
 h.get=async()=>({code:403,message:'failed'})
 ok(!await s.fetchUserPlaylists(12)&&s.playlists.length===3&&s.playlistsError==='failed','Netease playlist refresh failure preserves successful cache')
 const late=deferred();h.get=()=>late.promise
 const old=s.fetchUserPlaylists(12)
 h.get=async()=>({code:200,playlist:[{id:4}],more:false});await s.fetchUserPlaylists(12)
 late.resolve({code:200,playlist:[{id:99}],more:false});await old
 ok(s.playlists[0].id===4&&!s.playlistsLoading,'older Netease refresh cannot override newest management state')
 const changed=deferred();h.get=()=>changed.promise
 const pending=s.fetchUserPlaylists(12);s.logout();changed.resolve({code:200,playlist:[{id:22}]});await pending
 ok(!s.playlists.length&&!s.playlistsLoading,'logout blocks delayed personal playlists')
}
{
 const {store:s,handlers:h}=await harness('src/store/qq-user.js','../api/qq')
 s.isLoggedIn=true;s.uin='12';s.cookie='fixture';s.playlists=[{id:'2'},{id:'1'}];s.likedPlaylistId=1
 let calls=[]
 h.qqPlaylistGroup=async(_uin,kind)=>({code:0,data:{playlists:kind==='created'?[{id:'1',type:1},{id:'2'}]:[],hasMore:false}})
 h.qqOperSonglist=async(cmd,args)=>{calls.push({cmd,args});return {code:0}}
 ok(s.createdPlaylists.length===1&&await s.createPlaylist('  新建  ')&&calls[0].cmd==='add'&&calls[0].args.name==='新建','QQ create action trims name and refreshes groups')
 ok(!await s.deletePlaylist(1)&&calls.length===1,'QQ likes and unowned lists cannot be deleted by manager')
 ok(await s.deletePlaylist('2')&&calls[1].cmd==='del'&&calls[1].args.dissid==='2','QQ deletes only own playlist using verified operation contract')
 const late=deferred();h.qqOperSonglist=()=>late.promise
 const pending=s.createPlaylist('延迟');s.revision++;late.resolve({code:0})
 await assert.rejects(pending,/QQ 音乐未接受新建歌单操作/,'QQ rejects delayed create completion after account switch'); checks++
}
console.log(`Membership and playlist management checks passed: ${checks} assertions across all four production stores.`)
