const rank = quality => ({unknown:0,'128':1,'320':2,flac:3,high:4,super:4,viper_atmos:4,viper_clear:4}[quality] || 0)
export async function resolveKugouPlayback(request,qualities,isCurrent=()=>true) {
    let best,lastError
    for(const quality of qualities) {
        if(!isCurrent())return null
        try {
            const candidate=await request(quality)
            if(!isCurrent())return null
            if(candidate?.data?.url&&(!best||rank(candidate.data.quality)>rank(best.data.quality)))best=candidate
        } catch(error) {
            if(!isCurrent())return null
            if(error.requiresVerification||/安全验证|需要验证/.test(error.message))throw error
            lastError=error
        }
        if(best&&rank(best.data.quality)>=rank(quality))return best
    }
    if(best)return best
    throw lastError || Error('酷狗未授予播放权限，请在官方客户端查看账号或版权要求')
}
