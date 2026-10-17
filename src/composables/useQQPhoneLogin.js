import { ref, onUnmounted } from 'vue'
import { qqNativePhone } from '../api/qq'

export function useQQPhoneLogin({acceptSession,onSuccess}) {
    const phone=ref(''),code=ref(''),consent=ref(false),busy=ref(false),message=ref(''),securityURL=ref(''),seconds=ref(0)
    let generation=0,contextId='',contextPhone='',timer=null
    const countdown=retryAt=>{clearInterval(timer);const tick=()=>{seconds.value=Math.max(0,Math.ceil((Number(retryAt||0)-Date.now())/1000));if(!seconds.value)clearInterval(timer)};tick();if(seconds.value)timer=setInterval(tick,500)}
    async function send() {
        if(busy.value||seconds.value)return
        if(!consent.value){message.value='请先同意用户协议和隐私政策';return}
        if(!/^1[3-9]\d{9}$/.test(phone.value)){message.value='请输入有效的中国大陆手机号';return}
        const revision=generation,number=phone.value
        busy.value=true;message.value='正在向 QQ 音乐请求验证码…';securityURL.value=''
        try {
            const result=await qqNativePhone('send',{phone:number,consent:true})
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
            const result=await qqNativePhone('login',{phone:phone.value,code:code.value,contextId,consent:true})
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
    function cancel(){generation++;clearInterval(timer);timer=null;contextId='';contextPhone='';code.value='';phone.value='';busy.value=false;seconds.value=0;message.value='';securityURL.value='';Promise.resolve(qqNativePhone('cancel')).catch(()=>{})}
    onUnmounted(cancel)
    return {phone,code,consent,busy,message,securityURL,seconds,send,login,cancel}
}
