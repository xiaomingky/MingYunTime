import assert from 'node:assert/strict'
import { QQInlineQR } from '../electron/qq-inline-qr.js'
import { QQSession } from '../electron/qq-session.js'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
let checks=0
const ok=(value,message)=>{assert.ok(value,message);checks++}
const rejected=async(p,match)=>{await assert.rejects(p,match);checks++}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(128)])
const response=(data,headers={},status=200)=>({data,headers,status})
function fixture(mode='qq'){
    const calls=[];let now=1000,ptStatus='66',wxStatus='408',grantState='',hold,missingKey=false,malformed=false,unsafeRedirect=false,authorize302=false,badState=false
    const login=new QQInlineQR({now:()=>now,request:async config=>{
        calls.push(config);const u=new URL(config.url)
        if(hold)return hold(config)
        if(u.pathname.endsWith('/xlogin'))return response('ptui_version:encodeURIComponent("26100915")',{'set-cookie':['pt_login_sig=fixture-sig; Domain=ptlogin2.qq.com; Path=/; Secure']})
        if(u.pathname.endsWith('/ptqrshow'))return response(png,{'set-cookie':['qrsig=fixture-qr; Domain=ptlogin2.qq.com; Path=/; Secure']})
        if(u.pathname.endsWith('/ptqrlogin'))return response(malformed?'invalid':`ptuiCB('${ptStatus}','0','https://ssl.ptlogin2.qq.com/check_sig?fixture=1','0','status','name');`)
        if(u.pathname.endsWith('/check_sig'))return response('',{'set-cookie':['p_skey=fixture-pskey; Domain=qq.com; Path=/; Secure']})
        if(u.pathname.endsWith('/authorize')){
            const form=new URLSearchParams(config.data);grantState=form.get('state')
            const url=new URL(form.get('redirect_uri'));url.searchParams.set('code','fixture-code');url.searchParams.set('state',badState?'mismatched':grantState)
            if(unsafeRedirect)return response('',{location:'https://evil.test/steal'},302)
            return authorize302?response('',{location:url.href},302):response({ret:0,callback:url.href})
        }
        if(u.pathname==='/connect/qrconnect'){grantState=u.searchParams.get('state');return response('var G="fixture-wx";window.usenewdomain=true;')}
        if(u.pathname==='/connect/qrcode/fixture-wx')return response(png)
        if(u.pathname==='/connect/l/qrconnect')return response(`window.wx_errcode=${wxStatus};window.wx_code="fixture-wx-code";`)
        if(u.pathname==='/cgi-bin/musicu.fcg')return response({code:0,req:{code:0,data:missingKey?{}:{str_musicid:'1152921504606846977',musickey:'fixture-music-key'}}})
        throw Error('Unexpected fixture URL '+u.origin+u.pathname)
    }})
    return {login,calls,mode,set:values=>{if('ptStatus'in values)ptStatus=values.ptStatus;if('wxStatus'in values)wxStatus=values.wxStatus;if('now'in values)now=values.now;if('hold'in values)hold=values.hold;if('missingKey'in values)missingKey=values.missingKey;if('malformed'in values)malformed=values.malformed;if('unsafeRedirect'in values)unsafeRedirect=values.unsafeRedirect;if('authorize302'in values)authorize302=values.authorize302;if('badState'in values)badState=values.badState}}
}
for(const mode of ['qq','wechat']){
    const f=fixture(mode),created=await f.login.create(mode),id=created.data.loginId
    ok(created.code===0&&created.data.image.startsWith('data:image/png;base64,')&&created.data.mode===mode,mode+' inline QR image')
    ok((await f.login.check(id)).status==='waiting',mode+' waiting')
    f.set({ptStatus:'67',wxStatus:'404'});ok((await f.login.check(id)).status==='scanned',mode+' scanned')
    f.set({ptStatus:'0',wxStatus:'405'});const result=await f.login.check(id)
    ok(result.status==='confirmed'&&result.data.uin==='1152921504606846977',mode+' exact music identity')
    ok(result.data.cookie.includes('qqmusic_key=fixture-music-key')&&result.data.cookie.includes('login_type='+(mode==='qq'?1:2)),mode+' full music credentials')
    const exchange=f.calls.find(c=>new URL(c.url).pathname==='/cgi-bin/musicu.fcg'),spec=JSON.parse(exchange.data)
    ok(spec.req.module===(mode==='qq'?'QQConnectLogin.LoginServer':'music.login.LoginServer')&&spec.req.param.code.startsWith('fixture-'),mode+' official grant exchange')
    ok(!f.calls.some(c=>c.url.includes('localhost')),mode+' no third party module')
    ok(!f.calls.some(c=>new URL(c.url).hostname==='open.weixin.qq.com'&&c.headers.Cookie?.includes('pt_login_sig')),mode+' cookie domain isolation')
    ok(exchange.headers.Origin==='https://y.qq.com'&&exchange.headers.Referer.includes('wx_redirect.html'),mode+' gateway uses official redirect request context')
    if(mode==='qq')ok(exchange.headers.Cookie.includes('login_type=1'),'QQ music grant carries official login type cookie')
    const count=f.calls.length;await f.login.check(id);ok(f.calls.length===count,mode+' confirmed check does not repeat exchange')
    f.login.cancel(id);ok((await f.login.check(id)).status==='cancelled'&&!f.login.current(result.data.qrGeneration),mode+' cancelled grant invalidated')
}
for(const mode of ['qq','wechat']){
    const f=fixture(mode),id=(await f.login.create(mode)).data.loginId
    f.set({ptStatus:'65',wxStatus:'402'});ok((await f.login.check(id)).status==='expired',mode+' upstream expiry')
    ok((await f.login.check(id)).status==='cancelled',mode+' terminal QR is invalidated')
    await f.login.create(mode)
    const localId=f.login.context.id
    f.set({now:999999});ok((await f.login.check(localId)).status==='expired',mode+' local expiry')
}
let f=fixture(),id=(await f.login.create()).data.loginId
f.set({ptStatus:'0',missingKey:true});await rejected(f.login.check(id),/凭据/)
f=fixture();id=(await f.login.create()).data.loginId;f.set({malformed:true});await rejected(f.login.check(id),/格式/)
f=fixture();id=(await f.login.create()).data.loginId;f.set({ptStatus:'0',unsafeRedirect:true});await rejected(f.login.check(id),/重定向/)
f=fixture();id=(await f.login.create()).data.loginId;f.set({ptStatus:'0',badState:true});await rejected(f.login.check(id),/不匹配/)
f=fixture();id=(await f.login.create()).data.loginId;f.set({ptStatus:'0',authorize302:true});ok((await f.login.check(id)).status==='confirmed','302 callback captured before code is consumed')
f=fixture();id=(await f.login.create()).data.loginId;f.login.cancel('old-session-id');ok((await f.login.check(id)).status==='waiting','stale cancellation cannot cancel current QR')
const cookieContext=f.login.context
cookieContext.cookies.put('https://ssl.ptlogin2.qq.com/', ['injected=bad; Domain=evil.test; Path=/', 'hostonly=secret; Path=/', 'pathcookie=secret; Domain=qq.com; Path=/restricted', 'qrsig=; Domain=ptlogin2.qq.com; Path=/; Max-Age=0'])
ok(!cookieContext.cookies.for('https://u.y.qq.com/').includes('injected')&&!cookieContext.cookies.for('https://u.y.qq.com/').includes('hostonly')&&!cookieContext.cookies.for('https://u.y.qq.com/').includes('pathcookie'),'domain and path scoped cookies never leak')
ok(!cookieContext.cookies.get('qrsig','https://ssl.ptlogin2.qq.com/'),'official cookie deletion honored')
f=fixture();id=(await f.login.create()).data.loginId;let release;f.set({hold:()=>new Promise(r=>release=r)})
let pending=f.login.check(id);await Promise.resolve();ok((await f.login.check(id)).status==='waiting','overlapping poll does not send duplicate request');f.login.cancel();release(response("ptuiCB('66','0','','0','','');"));await rejected(pending,/取消/)
f=fixture();let resolveCreate;f.set({hold:()=>new Promise(r=>resolveCreate=r)});pending=f.login.create();await Promise.resolve();f.login.cancel();resolveCreate(response('ptui_version:encodeURIComponent("26100915")'));await rejected(pending,/取消/)
f=fixture();id=(await f.login.create()).data.loginId;f.set({ptStatus:'0'});const granted=(await f.login.check(id)).data
let resolveValidation,persisted=false
const session=new QQSession({validate:()=>new Promise(r=>resolveValidation=r),save:()=>persisted=true,load:()=>'',clear:()=>{}})
pending=session.accept(granted.cookie,granted.uin,()=>f.login.current(granted.qrGeneration));f.login.cancel();resolveValidation({userId:granted.uin});await rejected(pending,/取消/);ok(!persisted,'logout during validation cannot persist stale grant')

// Execute the actual renderer lifecycle, using a deterministic clock/IPC boundary.
const bundle=await build({entryPoints:['src/composables/useQQQrLogin.js'],bundle:true,write:false,format:'esm',plugins:[{name:'test-api',setup(b){b.onResolve({filter:/\.\.\/api\/qq$/},()=>({path:'api',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const qqQrCreate=()=>{},qqQrCheck=()=>{},qqQrCancel=()=>{}',loader:'js'}))}}]})
const {useQQQrLogin}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
let nextPoll,transportStatus='waiting',accepted=0,success=0,cancels=[]
const ui=useQQQrLogin({api:{create:async mode=>({code:0,data:{loginId:mode,image:'data:image/png;base64,fixture',expiresAt:9999}}),check:async()=>({code:0,status:transportStatus,message:'fixture',data:{cookie:'fixture',uin:'123',qrGeneration:1}}),cancel:async id=>cancels.push(id)},acceptSession:async()=>{accepted++;return {success:true}},onSuccess:()=>success++,schedule:fn=>{nextPoll=fn;return 1},unschedule:()=>{nextPoll=null}})
await ui.start('qq');ok(ui.status.value==='waiting'&&ui.image.value,'actual composable displays QR');await nextPoll();ok(ui.status.value==='waiting','renderer schedules waiting');transportStatus='scanned';await nextPoll();ok(ui.status.value==='scanned','renderer scanned state');transportStatus='confirmed';await nextPoll();ok(accepted===1&&success===1&&ui.status.value==='confirmed','renderer validates before closing')
await ui.start('wechat');transportStatus='expired';await nextPoll();ok(ui.status.value==='expired','renderer expiry refresh state');ui.cancel();ok(!ui.image.value&&ui.status.value==='idle'&&cancels.includes('wechat'),'closing clears QR and cancels session')
let lateCreate;const stale=useQQQrLogin({api:{create:()=>new Promise(r=>lateCreate=r),cancel:async id=>cancels.push(id)},acceptSession:()=>{throw Error('must not accept')},onSuccess:()=>{throw Error('must not close')},schedule:()=>1,unschedule:()=>{}})
pending=stale.start();stale.cancel();lateCreate({code:0,data:{loginId:'late',image:'fixture'}});await pending;ok(stale.status.value==='idle'&&cancels.includes('late'),'late QR never replaces current view')
let latePoll;const cancelledPoll=useQQQrLogin({api:{create:async()=>({code:0,data:{loginId:'polling',image:'fixture'}}),check:()=>new Promise(r=>latePoll=r),cancel:async()=>{}},acceptSession:()=>{throw Error('cancelled check must not validate')},onSuccess:()=>{throw Error('cancelled check must not close')},schedule:fn=>{nextPoll=fn;return 1},unschedule:()=>{}})
await cancelledPoll.start();pending=nextPoll();cancelledPoll.cancel();latePoll({code:0,status:'confirmed',data:{cookie:'fixture',uin:'123',qrGeneration:1}});await pending;ok(cancelledPoll.status.value==='idle','late confirmed poll cannot accept account after modal close')
const rejectedSession=useQQQrLogin({api:{create:async()=>({code:0,data:{loginId:'failure',image:'fixture'}}),check:async()=>({code:0,status:'confirmed',data:{cookie:'fixture',uin:'123',qrGeneration:1}}),cancel:async()=>{}},acceptSession:async()=>({success:false,message:'account not valid'}),onSuccess:()=>{throw Error('failed verification cannot close')},schedule:fn=>{nextPoll=fn;return 1},unschedule:()=>{}})
await rejectedSession.start();await nextPoll();ok(rejectedSession.status.value==='error'&&rejectedSession.message.value==='account not valid','account verification failure remains visible with retry')
const {descriptor}=parse(readFileSync('src/components/LoginModal.vue','utf8')),script=compileScript(descriptor,{id:'qq-qr-test'}),template=compileTemplate({source:descriptor.template.content,filename:'LoginModal.vue',id:'qq-qr-test',compilerOptions:{bindingMetadata:script.bindings}})
ok(!template.errors.length,'production login modal compiles')
console.log(`QQ / WeChat inline QR: ${checks} assertions passed; synthetic scan and exchange only.`)

if(process.argv.includes('--live')){
    for(const mode of ['qq','wechat']){
        const live=new QQInlineQR()
        try{
            const qr=await live.create(mode);const status=await live.check(qr.data.loginId)
            assert.ok(qr.data.image.startsWith('data:image/'));assert.ok(['waiting','scanned'].includes(status.status))
            console.log(`Official ${mode}: real QR image generated; unconfirmed status=${status.status}; no account grant requested.`)
        }finally{live.cancel()}
    }
}
