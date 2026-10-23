// Offline production IPC/session check; never sends a real SMS.
const {app,BrowserWindow,ipcMain,session}=require('electron')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'mingyun-qq-security-'))
process.env.APP_ROOT=root
app.setPath('userData',path.join(temp,'profile'))
app.on('window-all-closed',()=>{})
let main,checks=0,requests=0,phoneSession,verification
const ok=(value,message)=>{assert.ok(value,message);checks++}
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})
app.whenReady().then(async()=>{
    const original=session.fromPartition.bind(session)
    session.fromPartition=function(name,...args){
        const partition=original(name,...args)
        if(name.startsWith('qq-phone-login-')&&!phoneSession){
            phoneSession=partition
            partition.protocol.handle('https',async request=>{
                const url=new URL(request.url)
                if(url.hostname==='ssl.captcha.qq.com')return new Response('<!doctype html><script>document.cookie="verification_fixture=completed; Secure; Path=/"</script>verified',{headers:{'Content-Type':'text/html'}})
                if(url.hostname==='u.y.qq.com'){
                    requests++
                    const body=await request.json()
                    assert.equal(body.req.method,'SendPhoneAuthCode')
                    if(requests===1)return json({code:0,req:{code:0,data:{securityURL:'https://ssl.captcha.qq.com/check'}}})
                    const cookies=await partition.cookies.get({url:'https://ssl.captcha.qq.com/'})
                    ok(cookies.some(c=>c.name==='verification_fixture'&&c.value==='completed'),'verification cookie remains in the SMS transport session')
                    return json({code:0,req:{code:0,data:{}}})
                }
                throw Error('Unexpected offline fixture URL')
            })
        }
        return partition
    }
    const {registerQQMusicIPC}=await import('../electron/qq-music.js')
    registerQQMusicIPC()
    main=new BrowserWindow({show:false,webPreferences:{sandbox:true}})
    app.on('browser-window-created',(_event,win)=>{verification=win})
    main.webContents.session.protocol.handle('file',()=>new Response('<!doctype html><title>offline fixture</title>',{headers:{'Content-Type':'text/html'}}))
    await main.loadFile(path.join(root,'dist/index.html'))
    const invoke=params=>ipcMain._invokeHandlers.get('qq:native-phone')({sender:main.webContents,senderFrame:main.webContents.mainFrame},params)
    const first=await invoke({action:'send',phone:'13800000000',consent:true})
    ok(first.code!==0&&!!first.securityURL,'challenge cannot pretend SMS delivery: '+JSON.stringify(first))
    const opened=await invoke({action:'verify'})
    ok(opened.code===0&&verification&&!verification.isDestroyed(),'production IPC opens the verification window')
    ok(verification.webContents.session===phoneSession,'verification and SMS fetch use the same Electron session')
    const continued=await invoke({action:'send',phone:'13800000000',consent:true})
    ok(continued.code===0&&!!continued.data.contextId&&requests===2,'continuation really issues SendPhoneAuthCode again')
    ok(verification.isDestroyed(),'confirmed send closes verification')
    await invoke({action:'cancel'})
    ok((await invoke({action:'verify'})).code!==0,'cancel discards the verification URL')
    console.log('QQ phone security: '+checks+' real Electron IPC/session assertions passed; all HTTPS served offline.')
}).catch(error=>{console.error(error.stack||error);process.exitCode=1}).finally(()=>{for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(process.exitCode||0)})
