import { ref, onScopeDispose, watch } from 'vue'
import { qqNativePhone } from '../api/qq'

export function useQQPhoneLogin({acceptSession,onSuccess,invoke:request=qqNativePhone}) {
    const phone=ref(''),code=ref(''),consent=ref(false),busy=ref(false),message=ref(''),securityURL=ref(''),seconds=ref(0)
    let generation=0,contextId='',contextPhone='',timer=null,resetting=false
    const countdown=retryAt=>{clearInterval(timer);const tick=()=>{seconds.value=Math.max(0,Math.ceil((Number(retryAt||0)-Date.now())/1000));if(!seconds.value)clearInterval(timer)};tick();if(seconds.value)timer=setInterval(tick,500)}
    async function send() {
        if(busy.value||seconds.value)return
        if(!consent.value){message.value='请先同意用户协议和隐私政策';return}
        if(!/^1[3-9]\d{9}$/.test(phone.value)){message.value='请输入有效的中国大陆手机号';return}
        const revision=generation,number=phone.value
        busy.value=true;message.value='正在向 QQ 音乐请求验证码…';securityURL.value=''
        try {
            const result=await request('send',{phone:number,consent:true})
            if(revision!==generation)return
            if(result?.code!==0){securityURL.value=result?.securityURL||'';countdown(result?.retryAt);throw Error(result?.message||'验证码请求失败')}
            if(!result.data?.contextId)throw Error('QQ 未确认验证码发送')
            contextId=result.data.contextId;contextPhone=number;code.value='';countdown(result.data.retryAt);message.value=result.data.message
        }catch(error){if(revision===generation)message.value=error.message}
        finally{if(revision===generation)busy.value=false}
    }
    async function login(){
        if(busy.value)return
        if(!consent.value){message.value='请先同意用户协议和隐私政策';return}
        if(!contextId||contextPhone!==phone.value){message.value='请先为当前手机号获取验证码';return}
        if(!/^\d{4,8}$/.test(code.value)){message.value='请输入短信验证码';return}
        const revision=generation;busy.value=true;message.value='正在验证账号…'
        try{
            const result=await request('login',{phone:phone.value,code:code.value,contextId,consent:true})
            if(revision!==generation)return
            if(result?.code!==0){securityURL.value=result?.securityURL||'';throw Error(result?.message||'登录失败')}
            if(!result.data?.cookie||!result.data?.uin)throw Error('QQ 未返回登录凭据')
            const accepted=await acceptSession(result.data.cookie,result.data.uin,()=>revision===generation,result.data.nativeGeneration)
            if(revision!==generation)return
            if(!accepted?.success)throw Error(accepted?.message||'账号验证未通过')
            code.value='';contextId='';message.value='登录成功';onSuccess()
        }catch(error){if(revision===generation)message.value=error.message}
        finally{if(revision===generation)busy.value=false}
    }
    async function verify(){
        const revision=generation
        try { const result=await request('verify');if(revision!==generation)return;if(result?.code!==0)throw Error(result?.message||'验证页面打开失败');message.value='请在 QQ 官方窗口完成验证，完成后点击“验证完成，继续发送”' }
        catch(error){if(revision===generation)message.value=error.message}
    }
    function cancel(clearPhone=true){generation++;clearInterval(timer);timer=null;contextId='';contextPhone='';code.value='';if(clearPhone){resetting=true;phone.value='';resetting=false}busy.value=false;seconds.value=0;message.value='';securityURL.value='';Promise.resolve(request('cancel')).catch(()=>{})}
    watch(phone,()=>{if(!resetting)cancel(false)},{flush:'sync'})
    onScopeDispose(cancel)
    return {phone,code,consent,busy,message,securityURL,seconds,send,login,verify,cancel}
}
