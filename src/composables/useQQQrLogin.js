import { ref, onUnmounted, getCurrentInstance } from 'vue'
import { qqQrCreate, qqQrCheck, qqQrCancel } from '../api/qq'

// A single pending request at a time; switching accounts or closing the modal
// invalidates both renderer work and the main-process grant before persistence.
export function useQQQrLogin({acceptSession,onSuccess,api={create:qqQrCreate,check:qqQrCheck,cancel:qqQrCancel},schedule=setTimeout,unschedule=clearTimeout}) {
    const image=ref(''),status=ref('idle'),message=ref(''),expiresAt=ref(0)
    let revision=0,loginId='',timer=null
    function cancel(){
        revision++;unschedule(timer);timer=null
        const previous=loginId;loginId='';image.value='';status.value='idle';message.value='';expiresAt.value=0
        Promise.resolve(api.cancel(previous)).catch(()=>{})
    }
    async function start(mode='qq'){
        cancel()
        const generation=revision,current=()=>generation===revision
        status.value='loading';message.value='正在加载官方二维码…'
        try{
            const result=await api.create(mode)
            if(!current()){if(result?.data?.loginId)Promise.resolve(api.cancel(result.data.loginId)).catch(()=>{});return}
            if(result?.code!==0||!result.data?.loginId||!result.data?.image)throw Error(result?.message||'官方二维码加载失败，请重试')
            loginId=result.data.loginId;image.value=result.data.image;expiresAt.value=result.data.expiresAt;status.value='waiting'
            message.value=mode==='wechat'?'请使用微信扫一扫':'请使用手机 QQ 扫码'
            const poll=async()=>{
                if(!current())return
                try{
                    const result=await api.check(loginId)
                    if(!current())return
                    if(result?.code!==0)throw Error(result?.message||'扫码状态获取失败，请刷新')
                    if(result.status==='confirmed'){
                        status.value='confirming';message.value='正在验证音乐账号并同步歌单…'
                        if(!result.data?.cookie||!result.data?.uin||result.data.qrGeneration===undefined)throw Error('扫码未返回完整音乐凭据，请刷新')
                        const accepted=await acceptSession(result.data.cookie,result.data.uin,current,undefined,result.data.qrGeneration)
                        if(!current())return
                        if(!accepted?.success)throw Error(accepted?.message||'账号验证未通过，请刷新')
                        status.value='confirmed';message.value='登录成功';onSuccess();return
                    }
                    if(!['waiting','scanned','expired','cancelled'].includes(result.status))throw Error('扫码状态异常，请刷新')
                    status.value=result.status;message.value=result.message
                    if(['expired','cancelled'].includes(result.status))return
                    timer=schedule(poll,mode==='wechat'?500:1800)
                }catch(error){if(current()){status.value='error';message.value=error.message||'扫码失败，请刷新'}}
            }
            timer=schedule(poll,1000)
        }catch(error){if(current()){status.value='error';message.value=error.message||'二维码加载失败，请刷新'}}
    }
    if(getCurrentInstance())onUnmounted(cancel)
    return {image,status,message,expiresAt,start,cancel}
}
