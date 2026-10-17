import {createCipheriv,createDecipheriv,createHmac,createPublicKey,diffieHellman,generateKeyPairSync,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {gunzipSync} from 'node:zlib'

// Native playback transport. All encryption uses Node primitives; this module
// does not load an API server or another project's protocol implementation.
const STATIC_KEY=Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84','hex')
const RESPONSE_KEY=Buffer.from('e82ckenh8dichen8')
const SIGN_KEY='mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g=='
const SPKI=Buffer.from('302a300506032b656e032100','hex')
const ORIGIN='https://interface3.music.163.com'
const UA='NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14)'
const sign=(time,nonce)=>createHmac('sha256',SIGN_KEY).update(String(time)+nonce).digest('base64')
const ecb=(key,data,decrypt=false)=>{
    const cipher=(decrypt?createDecipheriv:createCipheriv)(`aes-${key.length*8}-ecb`,key,null)
    return Buffer.concat([cipher.update(data),cipher.final()])
}
export function encodeNeteasePlayback(data,state) {
    const key=randomBytes(16)
    const body=JSON.stringify({body:Buffer.from(new URLSearchParams(data).toString()).toString('base64'),queryString:'e_r=true'})
    const inner=ecb(STATIC_KEY,Buffer.from(body)),mask=randomBytes(16),xor=Buffer.from(inner.map((byte,index)=>byte^mask[index%16]))
    const base64=Buffer.from(xor.toString('base64')),rotate=(mask[0]&15)%base64.length
    const B=ecb(key,Buffer.concat([mask,base64.subarray(rotate),base64.subarray(0,rotate)]))
    const {publicKey,privateKey}=generateKeyPairSync('x25519'),ephemeral=publicKey.export({format:'der',type:'spki'}).subarray(-32)
    const peer=createPublicKey({key:Buffer.concat([SPKI,Buffer.from(state.publicKey,'base64')]),format:'der',type:'spki'})
    const secret=diffieHellman({privateKey,publicKey:peer})
    const prk=createHmac('sha256',Buffer.alloc(32)).update(secret).digest()
    const wrappingKey=createHmac('sha256',prk).update(Buffer.concat([ephemeral,Buffer.from([1])])).digest().subarray(0,16)
    const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',wrappingKey,iv)
    const wrapped=Buffer.concat([cipher.update(`${key.toString('base64')}|android|${state.sk}`),cipher.final()])
    const S=Buffer.concat([ephemeral,iv,wrapped,cipher.getAuthTag()])
    const R=ecb(STATIC_KEY,Buffer.from(`${state.version}|`))
    return {B:B.toString('base64'),S:S.toString('base64'),R:R.toString('base64')}
}
export function decodeNeteasePlayback(data) {
    if (data && !Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && typeof data==='object') return data
    let bytes=Buffer.from(data)
    if (bytes[0]!==123) bytes=ecb(RESPONSE_KEY,bytes,true)
    if (bytes[0]===31&&bytes[1]===139) bytes=gunzipSync(bytes,{maxOutputLength:4*1024*1024})
    return JSON.parse(bytes.toString('utf8'))
}

export class NeteasePlayback {
    constructor({request,now=Date.now}) {
        this.request=request;this.now=now;this.deviceId=randomUUID().replaceAll('-','');this.pendingKey=null;this.key=null;this.keyAt=0
    }
    async send(config) {
        try {return await this.request({timeout:15000,maxContentLength:4*1024*1024,maxRedirects:0,...config})}
        catch(e) {throw new Error(e.response?.status?`网易云播放服务暂不可用（HTTP ${e.response.status}）`:'网易云播放授权连接失败，请重试')}
    }
    async publicKey() {
        if (this.key&&this.now()-this.keyAt<20*60*1000) return this.key
        if (this.pendingKey) return this.pendingKey
        this.pendingKey=(async()=>{
            const timestamp=String(this.now()),nonce=String(BigInt('0x'+randomBytes(8).toString('hex'))%10000000000000000n).padStart(16,'0')
            const data={appVersion:'9.1.65',currentKeyVersion:'',deviceId:this.deviceId,nonce,os:'android',requestType:'active',signature:sign(timestamp,nonce),t1:'',t2:'',timestamp,uid:''}
            const response=await this.send({url:'https://interface.music.163.com/api/gorilla/anti/crawler/security/key/get',method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded',Cookie:`deviceId=${this.deviceId}`},data:new URLSearchParams(data).toString()})
            const result=response.data?.data
            if(response.data?.code!==200||!result?.encryptedData||typeof result.signature!=='string')throw new Error('网易云未返回有效播放协议公钥')
            const expected=Buffer.from(sign(result.timestamp,nonce)),actual=Buffer.from(result.signature)
            if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new Error('网易云播放协议签名校验失败')
            let key
            try{key=JSON.parse(ecb(STATIC_KEY,Buffer.from(result.encryptedData,'base64'),true).toString('utf8'))}catch{throw new Error('网易云播放协议公钥解码失败')}
            if(typeof key.publicKey!=='string'||Buffer.from(key.publicKey,'base64').length!==32||typeof key.sk!=='string'||!key.sk||!key.version)throw new Error('网易云播放协议公钥不完整')
            this.key=key;this.keyAt=this.now();return key
        })()
        try{return await this.pendingKey}finally{this.pendingKey=null}
    }
    async playback(params,cookie='') {
        if(/[\r\n]/.test(cookie))throw new Error('Cookie 格式无效')
        const state=await this.publicKey()
        const body=encodeNeteasePlayback(params,state)
        const cookies=String(cookie).split(';').map(s=>s.trim()).filter(Boolean)
        const musicU=cookies.find(s=>s.startsWith('MUSIC_U='))?.slice(8)||''
        const response=await this.send({url:ORIGIN+'/xeapi/song/enhance/player/url/v1',method:'POST',responseType:'arraybuffer',
            data:new URLSearchParams(body).toString(),headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded;charset=utf-8','X-Client-Enc-State':'ENCRYPTED','x-aeapi':'true',
                'x-deviceid':this.deviceId,'x-os':'android','x-osver':'16','x-appver':'9.1.65','x-sdeviceid':this.deviceId,'x-buildver':String(Math.floor(this.now()/1000)),
                ...(cookie?{Cookie:cookie}:{}),...(musicU?{'x-music-u':musicU}:{})}})
        let result
        try{result=decodeNeteasePlayback(response.data)}catch{throw new Error('网易云播放授权响应解码失败')}
        if(!result||typeof result!=='object'||!Number.isInteger(result.code))throw new Error('网易云播放授权响应不完整')
        if(result.code!==200)throw new Error(result.message||result.msg||`网易云播放授权被拒绝（${result.code}）`)
        return result
    }
}
