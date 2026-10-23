import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const require=createRequire(import.meta.url),{effectScope}=require('vue')
const bundle=await build({entryPoints:['src/composables/useQQPhoneLogin.js'],bundle:true,platform:'node',format:'cjs',write:false,external:['vue']})
const module={exports:{}}
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports)
const scope=effectScope(),calls=[],responses=[],accepted=[]
const ui=scope.run(()=>module.exports.useQQPhoneLogin({invoke:async(action,args)=>{calls.push({action,args});return action==='cancel'?{code:0}:responses.shift()},acceptSession:async(...args)=>{accepted.push(args);return {success:true}},onSuccess:()=>{}}))
let checks=0
const ok=(value,message)=>{assert.ok(value,message);checks++}
try {
    ui.phone.value='13800000000';ui.consent.value=true
    responses.push({code:-1,securityURL:'https://ssl.captcha.qq.com/check',message:'完成验证'})
    await ui.send()
    ok(ui.securityURL.value&&ui.seconds.value===0,'challenge keeps continuation available without false SMS cooldown')
    responses.push({code:0});await ui.verify()
    ok(calls.at(-1).action==='verify'&&ui.message.value.includes('继续发送'),'verification opens the same-session official window')
    responses.push({code:0,data:{contextId:'sent-context',retryAt:Date.now()+60000,message:'验证码已发送'}});await ui.send()
    ok(calls.at(-1).action==='send'&&ui.seconds.value>0&&!ui.securityURL.value,'continuation actually sends and starts the confirmed cooldown')
    ui.code.value='123456';responses.push({code:0,data:{cookie:'synthetic-cookie',uin:'123',nativeGeneration:0}});await ui.login()
    ok(accepted.length===1&&!ui.code.value,'successful login validates returned credentials')
    ui.phone.value='13900000000'
    ok(calls.at(-1).action==='cancel'&&!ui.securityURL.value&&ui.seconds.value===0,'changing phone clears old grants and security state')
    let resolve;responses.push(new Promise(r=>{resolve=r}));const pending=ui.send();await Promise.resolve();ui.cancel();resolve({code:0,data:{contextId:'late',retryAt:Date.now()+60000}});await pending
    ok(!ui.busy.value&&!ui.phone.value&&!ui.seconds.value&&!ui.securityURL.value,'late SMS result after modal cancellation cannot restore form state')
    console.log('QQ phone UI: '+checks+' production-composable checks passed; mock SMS only.')
} finally {scope.stop()}
