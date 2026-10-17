import http from 'node:http'
import https from 'node:https'
import { qishuiMediaURL } from './qishui-audio.js'
const httpAgent = new http.Agent({ keepAlive:true, maxSockets:128, maxFreeSockets:32 })
const httpsAgent = new https.Agent({ keepAlive:true, maxSockets:128, maxFreeSockets:32 })
const redirects = [301,302,303,307,308]

// Download transport: standard playback cache and decoder are kept intact.
export async function transferQishuiMedia({request,url,signal,progress,maxBytes,threads=32}) {
    const started=Date.now(),controller=new AbortController()
    const cancel=()=>controller.abort()
    if(signal?.aborted)throw Error('下载已取消')
    signal?.addEventListener('abort',cancel,{once:true})
    const emit=(received,total,connections)=>progress?.({received,total,connections,ranged:connections>1,transferMs:Date.now()-started})
    async function get(candidate,range,limit,onDownloadProgress,validator) {
        let target=qishuiMediaURL(candidate)
        for(let hop=0;hop<=3;hop++) {
            const response=await request({url:target,method:'GET',responseType:'arraybuffer',signal:controller.signal,
                timeout:25000,httpAgent,httpsAgent,maxContentLength:limit,maxRedirects:0,onDownloadProgress,
                headers:{'User-Agent':'LunaPC/3.7.0(452316191)','Accept-Encoding':'identity',Range:range,...(validator?{'If-Range':validator}:{})},
                validateStatus:s=>s===200||s===206||redirects.includes(s)})
            if(!redirects.includes(response.status))return {response,url:target}
            if(hop===3||!response.headers?.location)throw Error('汽水音频跳转异常，请重试')
            target=qishuiMediaURL(new URL(response.headers.location,target).href)
        }
    }
    try {
        const probe=await get(url,'bytes=0-0',maxBytes,e=>{if(e.loaded>1)emit(e.loaded,e.total||0,1)})
        const r=probe.response
        if(r.status===200) {
            const data=Buffer.from(r.data),expected=Number(r.headers?.['content-length'])||0
            if(!data.length||data.length>maxBytes)throw Error('汽水音频超过缓存大小限制')
            if(expected&&data.length!==expected)throw Error('汽水音频下载不完整')
            emit(data.length,data.length,1);return {data,status:200}
        }
        const range=String(r.headers?.['content-range']||'').match(/^bytes 0-0\/(\d+)$/i),total=Number(range?.[1])
        if(!Number.isSafeInteger(total)||total<1||total>maxBytes||Buffer.byteLength(r.data)!==1)throw Error('汽水音频分片大小无效')
        const count=Math.min(total,128,Math.max(32,Math.trunc(Number(threads))||32))
        const data=Buffer.allocUnsafe(total),received=Array(count).fill(0)
        const validator=r.headers?.etag?.startsWith('"')?r.headers.etag:r.headers?.['last-modified']
        let firstError
        emit(0,total,count)
        await Promise.all(Array.from({length:count},async(_,index)=>{
            const start=Math.floor(index*total/count),end=Math.floor((index+1)*total/count)-1
            try {
                const part=await get(probe.url,`bytes=${start}-${end}`,end-start+1,e=>{
                    received[index]=Math.min(end-start+1,e.loaded||0)
                    emit(received.reduce((sum,v)=>sum+v,0),total,count)
                },validator)
                const chunk=Buffer.from(part.response.data)
                if(part.response.status!==206||String(part.response.headers?.['content-range'])!==`bytes ${start}-${end}/${total}`||chunk.length!==end-start+1)throw Error('汽水音频分片范围不匹配，请重试')
                if(r.headers?.etag&&part.response.headers?.etag&&r.headers.etag!==part.response.headers.etag)throw Error('汽水音源已变化，请重新下载')
                chunk.copy(data,start);received[index]=chunk.length
            }catch(e){if(!firstError)firstError=e;controller.abort()}
        }))
        if(signal?.aborted)throw Error('下载已取消')
        if(firstError)throw firstError
        emit(total,total,count);return {data,status:200}
    }finally{signal?.removeEventListener('abort',cancel)}
}
