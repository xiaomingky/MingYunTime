import assert from 'node:assert/strict'
import {QQNativeLogin,qqNativeCookie} from '../electron/qq-native-login.js'
let checks=0,now=1000,calls=[],reply
const ok=(v,m)=>{assert.ok(v,m);checks++}
const reject=async(p,m)=>{await assert.rejects(p,m);checks++}
const success=data=>({code:0,req:{code:0,data}})
const client={send:async(url,spec)=>{calls.push({url,...spec});return typeof reply==='function'?reply():reply}}
const fresh=()=>new QQNativeLogin({client,now:()=>now})
const phone='13800000000',args={phone,consent:true}
let login=fresh();reply=success({})
await reject(login.run('send',{phone}),/同意/)
await reject(login.run('send',{...args,phone:'invalid'}),/手机号/)
await reject(login.run('unknown',args),/不支持/)
ok(!calls.length,'invalid operations never send SMS')
const sent=await login.run('send',args),spec=calls.at(-1)
ok(sent.code===0&&!!sent.data.contextId,'explicit successful gateway response yields opaque context')
assert.deepEqual(spec.data.req,{module:'music.login.LoginServer',method:'SendPhoneAuthCode',param:{tmeAppid:'qqmusic',phoneNo:phone,areaCode:'86'}});checks++
ok(spec.url==='https://u.y.qq.com/cgi-bin/musicu.fcg'&&spec.data.comm.tmeLoginMethod==='3'&&spec.data.comm.tmeLoginType==='0'&&!spec.cookie,'APK phone identity and no existing account cookie')
ok(spec.data.comm.ct===11&&spec.data.comm.cv===20090008&&spec.data.comm.v===20090008,'phone login uses the recovered APK protocol version, not an unset or manifest version')
await reject(login.run('send',args),/稍后/)
await reject(login.run('login',{...args,contextId:sent.data.contextId,phone:'13900000000',code:'123456'}),/更改/)
await reject(login.run('login',{...args,contextId:sent.data.contextId,code:'abc'}),/短信验证码/)
reply=success({str_musicid:'1152921504606846977',musickey:'synthetic-key'})
const accepted=await login.run('login',{...args,contextId:sent.data.contextId,code:'123456'})
ok(accepted.data.uin==='1152921504606846977'&&accepted.data.cookie.includes('login_type=3'),'long native identity remains exact with returned credential')
assert.deepEqual(calls.at(-1).data.req.param,{code:'123456',phoneNo:phone,loginMode:1});checks++
await reject(login.run('login',{...args,contextId:sent.data.contextId,code:'123456'}),/过期/)
for(const malformed of [{},{req:{data:{}}},{code:0,req:{data:{}}},{code:0,req:{code:0}},{code:0,req:{code:0,data:[]}},{code:0,req:{code:0,subcode:1000,data:{}}},{code:1000,req:{code:0,data:{}}}]){
 login=fresh();reply=malformed;ok((await login.run('send',args)).code!==0&&login.contexts.size===0,'malformed/refused response cannot pretend SMS was sent')
}
login=fresh();reply=success({securityURL:'https://ssl.captcha.qq.com/check'})
let result=await login.run('send',args)
ok(result.code!==0&&result.securityURL.startsWith('https://ssl.captcha.qq.com/')&&!login.contexts.size,'official safety challenge surfaced before login')
ok(login.globalRetryAt===0&&!login.cooldowns.has(phone),'a challenge is not SMS delivery and cannot start a false cooldown')
reply=success({})
const resumed=await login.run('send',args)
ok(resumed.code===0&&resumed.data.contextId&&login.globalRetryAt===now+60000,'manual continuation after verification can immediately send and then starts the real cooldown')
login=fresh();reply=success({securityURL:'https://qq.com.attacker.test/check',errMsg:'SECRET_RESPONSE'})
result=await login.run('send',args)
ok(result.code!==0&&!result.securityURL&&!result.message.includes('SECRET_RESPONSE'),'unsafe redirect and upstream details never escape')
login=fresh();let release;reply=()=>new Promise(r=>release=r)
const pending=login.run('send',args);await Promise.resolve()
await reject(login.run('send',args),/正在处理/)
await login.run('cancel');release(success({}))
await reject(pending,/取消/);ok(!login.contexts.size&&!login.busy,'late cancelled send leaves no active context')
login=fresh();reply=success({});let context=(await login.run('send',args)).data.contextId
now+=300001
await reject(login.run('login',{...args,contextId:context,code:'123456'}),/过期/)
login=fresh();reply=success({});context=(await login.run('send',args)).data.contextId
reply={code:0,req:{code:1000,data:{}}}
for(let i=0;i<5;i++)ok((await login.run('login',{...args,contextId:context,code:'123456'})).code!==0,'failed code is not a session')
await reject(login.run('login',{...args,contextId:context,code:'123456'}),/尝试过多/)
for(const data of [{musicid:1152921504606846977,musickey:'x'},{str_musicid:'0',musickey:'x'},{str_musicid:'123',musickey:'x;injected=y'},{str_musicid:'123'},{str_musicid:'123',musickey:'x\ny'}]){assert.throws(()=>qqNativeCookie(data),/凭据/);checks++}
console.log(`QQ native phone login: ${checks} assertions passed; synthetic SMS only, no real phone contacted.`)
