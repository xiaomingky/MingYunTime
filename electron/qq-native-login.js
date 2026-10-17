import { randomUUID } from 'node:crypto'

// Recovered from PhoneLoginHelper.i/y and LoginResult (APK). Passwords and
// operator tokens stay with their official SDK; SMS is a direct native RPC.
// c0.a()/b() -> component.base.a -> CycloneHelper -> CommonParamPacker.
// APK 20.9.0.8 uses protocol version 20090008, not manifest versionCode 7458.
const COMM = {ct:11,cv:20090008,v:20090008,tmeAppID:'qqmusic',tmeLoginMethod:'3',tmeLoginType:'0'}
const phoneNumber = value => {const s=String(value||'').trim();if(!/^1[3-9]\d{9}$/.test(s))throw Error('请输入有效的中国大陆手机号');return s}
const safeURL = value => {try{const u=new URL(value);return u.protocol==='https:' && /(^|\.)(qq\.com|tencent\.com)$/.test(u.hostname)?u.href:''}catch{return ''}}
export function qqNativeCookie(data) {
    const uin=String(data?.str_musicid || (Number.isSafeInteger(data?.musicid)?data.musicid:''))
    const key=String(data?.musickey||'')
    if(!/^[1-9]\d{0,19}$/.test(uin)||!key||key.length>4096||/[;\s\x00-\x1f]/.test(key))throw Error('QQ 未返回完整的原生登录凭据')
    return {uin,cookie:`uin=${uin}; qqmusic_uin=${uin}; qqmusic_key=${key}; qm_keyst=${key}; login_type=3`}
}
export class QQNativeLogin {
    constructor({client,now=Date.now}){this.client=client;this.now=now;this.contexts=new Map();this.cooldowns=new Map();this.busy=false;this.generation=0;this.globalRetryAt=0}
    cancel(){this.generation++;this.contexts.clear()}
    async run(action,params={}) {
        if(action==='cancel'){this.cancel();return {code:0}}
        if(!['send','login'].includes(action))throw Error('不支持的 QQ 原生登录操作')
        if(params.consent!==true)throw Error('请先同意 QQ 音乐用户协议和隐私政策')
        if(this.busy)throw Error('正在处理登录，请稍候')
        const phone=phoneNumber(params.phone),generation=this.generation
        for(const [id,c]of this.contexts)if(c.expiresAt<=this.now())this.contexts.delete(id)
        for(const [number,retryAt]of this.cooldowns)if(retryAt<=this.now())this.cooldowns.delete(number)
        if(action==='send'&&Math.max(this.cooldowns.get(phone)||0,this.globalRetryAt)>this.now())throw Error('请稍后再获取验证码')
        const context=action==='login'?this.contexts.get(params.contextId):null
        if(action==='login'&&(!context||context.phone!==phone||context.expiresAt<=this.now()))throw Error('验证码已过期或手机号已更改，请重新获取')
        if(action==='login'&&!/^\d{4,8}$/.test(String(params.code||'')))throw Error('请输入短信验证码')
        if(context&&context.attempts>=5)throw Error('验证码尝试过多，请重新获取')
        this.busy=true
        try {
            if(context)context.attempts++
            if(action==='send'){this.globalRetryAt=this.now()+60000;this.cooldowns.set(phone,this.globalRetryAt)}
            const method=action==='send'?'SendPhoneAuthCode':'Login'
            const param=action==='send'?{tmeAppid:'qqmusic',phoneNo:phone,areaCode:'86'}:{code:String(params.code),phoneNo:phone,loginMode:1}
            const body=await this.client.send('https://u.y.qq.com/cgi-bin/musicu.fcg',{data:{comm:{...COMM,uin:'0',format:'json'},req:{module:'music.login.LoginServer',method,param}}})
            if(generation!==this.generation)throw Error('登录已取消')
            const payload=body?.req,data=payload?.data
            const codes=[body?.code,payload?.code,...(payload?.subcode===undefined?[]:[payload.subcode])]
            const valid=codes.every(value=>value===0)&&data&&typeof data==='object'&&!Array.isArray(data)
            const code=codes.find(value=>typeof value==='number'&&value!==0) || -1
            const securityURL=safeURL(data?.securityURL || data?.feedbackURL)
            if(!valid||securityURL||data.errMsg||data.errtip) return {code,message:securityURL?'QQ 要求完成官方安全验证，请打开验证页后重新获取验证码':`QQ ${action==='send'?'验证码请求':'登录'}未通过（${code===-1?'响应异常':code}）`,securityURL,retryAt:this.globalRetryAt}
            if(action==='send'){
                this.contexts.clear();const contextId=randomUUID();this.contexts.set(contextId,{phone,expiresAt:this.now()+300000,attempts:0})
                return {code:0,data:{contextId,retryAt:this.globalRetryAt,message:'验证码已发送，请查收短信'}}
            }
            const session=qqNativeCookie(data);this.contexts.delete(params.contextId)
            return {code:0,data:{...session,nativeGeneration:generation}}
        }finally{this.busy=false}
    }
}
