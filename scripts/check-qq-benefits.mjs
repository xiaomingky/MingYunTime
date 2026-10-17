import assert from 'node:assert/strict'
import { normalizeQQBenefits, normalizeQQFreeListen, normalizeQQFreeTasks, QQBenefits, qqBenefitsErrorMessage } from '../electron/qq-benefits.js'

let checks = 0
const check = (condition, label) => { assert.ok(condition, label); checks++ }
const rejects = async (promise, pattern) => { await assert.rejects(promise, pattern); checks++ }
const now = 1700000000000
const raw = (patch = {}) => ({ isShow: true, schedule: { activeDays: 2, watchedAdNumsToday: 0, watchedAdNumsLimit: 8 }, adFreeCardSpec: { freeCardBalance: 3 }, tieredIncentiveSpec: { needSendLaunchGift: true }, extra: { AdActiveEnd: '1790000000' }, ...patch })
const info = normalizeQQBenefits(raw(), now)
check(info.freeCards === 3 && info.activeDays === 2 && info.watchedToday === 0 && info.dailyLimit === 8, 'counter normalization')
check(info.canReceiveGift && info.adVipActive && info.activeUntil === 1790000000000, 'gift and seconds expiry')
check(normalizeQQBenefits(raw({extra:{AdActiveEnd:'1790000000000'}}),now).activeUntil === info.activeUntil, 'milliseconds expiry')
check(normalizeQQBenefits(raw({extra:{AdActiveEnd:'2026-10-17T00:00:00Z'}}),now).activeUntil === Date.parse('2026-10-17T00:00:00Z'), 'ISO expiry')
check(normalizeQQBenefits(raw({extra:{AdActiveEnd:'not a date'},adFreeCardSpec:{freeCardBalance:false}})).freeCards === null, 'unknown balance remains unknown')
assert.throws(()=>normalizeQQBenefits({code:0}),/可识别/); checks++
assert.throws(()=>normalizeQQBenefits({code:-1}),/被拒绝/); checks++
check(!JSON.stringify(normalizeQQBenefits(raw({adToken:'secret',cookie:'secret'}))).includes('secret'), 'only normalized fields cross IPC')
check(!qqBenefitsErrorMessage(new Error('secret Cookie=secret')).includes('secret'), 'unknown errors sanitized')
check(qqBenefitsErrorMessage(new Error('QQ GetAdVipPointInfo失败（20001）')).includes('20001'), 'upstream error code preserved')

function fixture() {
  const state={revision:1,savedRevision:1,cookie:'test-only',profile:{userId:'123'},data:raw(),calls:[],response:{code:0},hook:null}
  const service=new QQBenefits({now:()=>now,session:async()=>({cookie:state.cookie,profile:state.profile,revision:state.savedRevision}),isCurrent:s=>s.revision===state.revision,rpc:async(module,method,param,cookie)=>{
    state.calls.push({module,method,param,cookie})
    if(state.hook)return state.hook(method)
    return method==='GetAdVipPointInfo'?structuredClone(state.data):structuredClone(state.response)
  }})
  return {state,service}
}
let {state,service}=fixture()
check((await service.run('status','123')).info.freeCards===3,'status with authenticated session')
check(state.calls[0].method==='GetAdVipPointInfo' && state.calls[0].cookie==='test-only','uses official account RPC')
await rejects(service.run('status','999'),/账号已切换/)
await rejects(service.run('status',''),/账号已切换/)
await rejects(service.run('unknown','123'),/不支持/)
state.cookie=''; await rejects(service.run('status','123'),/先登录/)
state.cookie='test-only'; state.profile=null; await rejects(service.run('status','123'),/先登录/)
;({state,service}=fixture())
state.data=raw({tieredIncentiveSpec:{needSendLaunchGift:false},adFreeCardSpec:{freeCardBalance:0}})
await rejects(service.run('use-card','123'),/没有可用/)
check(state.calls.every(c=>c.method==='GetAdVipPointInfo'),'ineligible account makes no mutation requests')
check((await service.run('launch-gift','123')).status==='submitted','manual gift attempt asks official server without claiming success')
state.data=raw({adFreeCardSpec:{}});await rejects(service.run('use-card','123'),/未确认/)
;({state,service}=fixture())
state.response={code:0,activateSeconds:3600}
let result=await service.run('launch-gift','123')
check(result.status==='activated' && result.activateSeconds===3600,'explicit server activation')
check(state.calls[1].module==='music.advipcgi.AdVipPointCgi' && JSON.stringify(state.calls[1].param)==='{"source":"advip_home"}','official homepage gift contract')
result=await service.run('use-card','123')
check(state.calls[4].module==='music.advipcgi.AdVipReportCgi' && JSON.stringify(state.calls[4].param)==='{"source":"advip_home","num":1}','official homepage card contract and no ad report')
;({state,service}=fixture())
result=await service.run('launch-gift','123')
check(result.status==='submitted','successful request without evidence never claims activation')
let reads=0
state.hook=method=>method==='GetAdVipPointInfo'?raw({schedule:{activeDays:++reads>1?3:2}}):{code:0}
check((await service.run('launch-gift','123')).status==='activated','requeried entitlement increase confirms activation')
;({state,service}=fixture())
state.hook=method=>{if(method==='GetAdVipPointInfo'){state.revision++;return raw()}return {code:0}}
await rejects(service.run('status','123'),/账号已切换/)
check(state.calls.length===1,'stale response rejected')
;({state,service}=fixture())
let release, entered
const started=new Promise(resolve=>{entered=resolve})
state.hook=method=>{if(method==='GetAdVipPointInfo')return raw();entered();return new Promise(resolve=>{release=resolve})}
const pending=service.run('launch-gift','123');await started
await rejects(service.run('launch-gift','123'),/重复领取/)
release({code:0});await pending
check(service.mutations.size===0,'concurrency lock released')
;({state,service}=fixture())
reads=0;state.hook=method=>{if(method==='GetAdVipPointInfo'){if(++reads>1)throw Error('network');return raw()}return {code:0}}
check((await service.run('launch-gift','123')).status==='submitted','refresh failure leaves activation unconfirmed')
;({state,service}=fixture())
state.response={code:10001};await rejects(service.run('launch-gift','123'),/被拒绝/)
check(service.mutations.size===0,'failure releases mutation lock')
;({state,service}=fixture())
state.hook=method=>{if(method==='GetAdVipPointInfo')return raw();throw Error('QQ 音乐连接失败，请检查网络后重试')}
check((await service.run('launch-gift','123')).status==='submitted','uncertain mutation must not invite immediate retry')
check(normalizeQQFreeListen({endTs:0,remainingTimes:0,autoOpenSwitch:0},now).remainingSeconds===0,'official zero listening time')
check(normalizeQQFreeListen({endTs:1700000600,autoOpenSwitch:1},now).remainingSeconds===600,'listening expiry converted into seconds')
check(normalizeQQFreeListen({endTs:1700000000000},now).remainingSeconds===0,'expired listening time clamped to zero')
check(normalizeQQFreeListen({endTs:'bad'}).remainingSeconds===null,'unknown time never becomes fake zero')
check(normalizeQQFreeListen({endTs:0}).autoOpen===null,'missing switch remains unknown')
assert.throws(()=>normalizeQQFreeTasks({ret:-100001,rsp:{}}),/被拒绝（-100001）/);checks++
assert.throws(()=>normalizeQQFreeListen({}),/免费听状态/);checks++
const tasks=normalizeQQFreeTasks({taskInfos:{29:{currentStage:1,totalStage:4,adToken:'secret'},99:{currentStage:9}}})
check(tasks.length===1 && tasks[0].currentStage===1 && !JSON.stringify(tasks).includes('secret'),'only documented task counters exposed')
check(normalizeQQBenefits(raw({userVipInfo:{AdActiveEnd:'1790000000'},schedule:{coinNums:123,coinNumsSum:456,watchedAdNumsToNextDay:3}}),now).coinsTotal===456,'official activity coin counters')
;({state,service}=fixture())
state.hook=method=>method==='GetAdVipPointInfo'?raw():method==='GetFreeModeInfo'?{endTs:1700000600,autoOpenSwitch:0}:{taskInfos:{29:{currentStage:0,totalStage:4}}}
result=await service.run('activity','123')
check(result.info && result.listening.remainingSeconds===600 && result.tasks.length===1 && !result.issues.length,'activity loads three real read-only contracts')
check(state.calls.some(c=>c.param.adVipPoint===13 && c.param.source==='advip' && c.param.needCalendar),'uses activity homepage scene rather than startup dialog')
state.hook=method=>{if(method==='GetAdVipPointInfo')return raw();throw new Error('HTTP 403')}
result=await service.run('activity','123')
check(result.info && result.listening===null && result.issues.length===2,'partial activity errors preserve available entitlement')
check(state.calls.every(c=>/^Get/.test(c.method)),'activity never reports ad completion or changes reward state')
console.log(`QQ membership benefits passed: ${checks} assertions`)
