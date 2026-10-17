import fs from 'node:fs'
import path from 'node:path'
import { fork } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'

function nativeDirectory(root) {
    const candidates = [
        process.env.QISHUI_NATIVE_DIR,
        process.resourcesPath && path.join(process.resourcesPath, 'qishui-runtime'),
        path.join(root, 'resources', 'qishui-runtime'),
        path.join(root, 'dev', 'qishui-official-inspect', 'extracted', 'resources', 'app.asar.unpacked')
    ].filter(Boolean)
    const installed = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Soda Music')
    if (installed && fs.existsSync(installed)) {
        const versions = fs.readdirSync(installed).filter(name => /^\d+\.\d+\.\d+/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))
        candidates.push(...versions.map(version=>path.join(installed,version,'resources','app.asar.unpacked')))
    }
    return candidates.find(dir=>fs.existsSync(path.join(dir,'bdms.node')) && fs.existsSync(path.join(dir,'device.node'))) || ''
}

export function createQishuiRuntime({root, userData, request}) {
    const directory = nativeDirectory(root)
    let fingerprint
    const file = path.join(userData,'qishui-device.json')
    try { fingerprint = JSON.parse(fs.readFileSync(file,'utf8')) } catch {}
    if (!/^\d{10,22}$/.test(fingerprint?.deviceId || '') || !/^\d{10,22}$/.test(fingerprint?.installId || '')) {
        fingerprint={deviceId:String(BigInt('0x'+randomBytes(8).toString('hex')) & ((1n<<63n)-1n)),installId:String(Date.now())}
        fs.mkdirSync(userData,{recursive:true});fs.writeFileSync(file,JSON.stringify(fingerprint))
    }
    let child, nextId=0
    const pending=new Map()
    function rejectPending() {
        for(const entry of pending.values()) {clearTimeout(entry.timeout);entry.reject(new Error('汽水安全组件已停止，请重试'))}
        pending.clear();child=undefined
    }
    function invoke(operation, params) {
        if (!directory) return Promise.reject(new Error('汽水完整播放所需的本机安全组件尚未准备好'))
        if (!child) {
            const worker=fs.existsSync(path.join(root,'electron','qishui-runtime-worker.cjs')) ? path.join(root,'electron','qishui-runtime-worker.cjs') : path.join(process.resourcesPath,'qishui-runtime-worker.cjs')
            child=fork(worker,[],{silent:true,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})
            child.on('message',message=>{const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timeout);message.error?entry.reject(new Error(message.error)):entry.resolve(message.result)})
            child.on('exit',rejectPending);child.on('error',rejectPending)
            child.stdout?.resume();child.stderr?.resume()
        }
        return new Promise((resolve,reject)=>{
            const id=++nextId,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('汽水安全组件响应超时'))},10000)
            pending.set(id,{resolve,reject,timeout})
            child.send({id,operation,directory,deviceId:fingerprint.deviceId,...params},error=>{if(error){pending.delete(id);clearTimeout(timeout);reject(new Error('汽水安全组件请求失败'))}})
        })
    }
    const common={aid:'386088',app_name:'luna_pc',region:'cn',geo_region:'cn',os_region:'cn',sim_region:'',device_id:fingerprint.deviceId,cdid:'',iid:fingerprint.installId,version_name:'3.7.0',version_code:'30070000',channel:'official',build_mode:'master',network_carrier:'',ac:'wifi',tz_name:'Asia/Shanghai',resolution:'',device_platform:'windows',device_type:'Windows',os_version:'Windows 11',fp:fingerprint.deviceId}
    return {
        available:!!directory,
        async pcRequest({path: endpoint, method='POST', data={}, params={}, cookie=''}) {
            if (!/^\/luna\//.test(endpoint)) throw new Error('汽水接口路径无效')
            // The official caller repeats array query keys; a JSON array here
            // silently changes collection filtering on the server.
            const query = new URLSearchParams()
            for (const [name, value] of Object.entries({...common,...params})) {
                for (const item of Array.isArray(value) ? value : [value]) query.append(name, String(item))
            }
            const url='https://api.qishui.com'+endpoint+'?'+query
            const body=method==='GET'?undefined:typeof data==='string'?data:JSON.stringify(data)
            const headers={'user-agent':'LunaPC/3.7.0(452316191)','accept':'*/*','accept-encoding':'gzip, deflate, br','content-type':'application/json; charset=utf-8','x-luna-background-type':'foreground','x-luna-is-background-req':'0','x-luna-is-local-user':cookie?'1':'0'}
            if(cookie)headers.cookie=cookie
            if(body!==undefined)headers['x-ss-stub']=createHash('md5').update(body).digest('hex').toUpperCase()
            const signed=await invoke('sign',{url,headers})
            return request({url,method,data:body,headers:{...headers,...signed},timeout:20000})
        },
        async decodeKey(value) {
            const result=await invoke('decode',{value})
            if(typeof result!=='string'||!/^[\da-f]{32}$/i.test(result))throw new Error('汽水音频密钥格式无效')
            return result
        },
        close(){if(child){child.removeAllListeners('exit');child.kill();rejectPending()}}
    }
}
