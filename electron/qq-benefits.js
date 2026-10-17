// QQ APK contracts: AdVipPointCgi GetAdVipPointInfo/SendLaunchGift and
// AdVipReportCgi UseAdFreeCard. No ad-completion Report operation is exposed.
const POINT = 'music.advipcgi.AdVipPointCgi'
const REPORT = 'music.advipcgi.AdVipReportCgi'
const flag = value => value === true || value === 1 || value === '1'
const count = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null
class BenefitsError extends Error {}
export function qqBenefitsErrorMessage(error) {
    if (error instanceof BenefitsError) return error.message
    const message = typeof error?.message === 'string' ? error.message : ''
    const code = message.match(/(?:失败|被拒绝)（(-?\d{1,12})）/)?.[1]
    if (code) return `QQ 会员福利请求被拒绝（${code}），请检查登录和活动资格`
    if (message.includes('连接失败') || message.includes('HTTP')) return 'QQ 会员福利连接失败，请稍后重试'
    return 'QQ 会员福利请求失败，请确认登录与活动资格后重试'
}
function expiry(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(value)) { const ms=Date.parse(value); return Number.isFinite(ms) ? ms : null }
    if (!/^\d{10}(\d{3})?$/.test(String(value))) return null
    const number=Number(value); return String(value).length===10 ? number*1000 : number
}
function accepted(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BenefitsError('QQ 会员福利响应不完整，请重试')
    for (const key of ['code','retcode','subcode','ret']) if (data[key] !== undefined && Number(data[key]) !== 0) {
        const code = /^-?\d{1,12}$/.test(String(data[key])) ? String(data[key]) : '异常响应'
        throw new BenefitsError(`QQ 会员福利请求被拒绝（${code}）`)
    }
    return data
}
export function normalizeQQFreeListen(data, now = Date.now()) {
    accepted(data)
    if (!['endTs', 'expire', 'remainingTimes', 'autoOpenSwitch'].some(key => Object.hasOwn(data, key))) throw new BenefitsError('QQ 未返回免费听状态')
    const rawEnd = count(data.endTs)
    const endAt = rawEnd === 0 ? 0 : expiry(rawEnd)
    return { endAt, remainingSeconds: endAt === null ? null : Math.max(0, Math.floor((endAt - now) / 1000)),
        autoOpen: [0, 1, '0', '1'].includes(data.autoOpenSwitch) ? flag(data.autoOpenSwitch) : null, remainingTimes: count(data.remainingTimes) }
}
export function normalizeQQFreeTasks(data) {
    accepted(data)
    if (data.rsp && typeof data.rsp === 'object') data = accepted(data.rsp)
    if (!data.taskInfos || typeof data.taskInfos !== 'object' || Array.isArray(data.taskInfos)) throw new BenefitsError('QQ 未返回免费听任务')
    return Object.entries(data.taskInfos).filter(([type, task]) => ['29','30','31'].includes(type) && task && typeof task === 'object').map(([type, task]) => ({
        type: Number(type), currentStage: count(task.currentStage), totalStage: count(task.totalStage)
    }))
}
export function normalizeQQBenefits(data, now=Date.now()) {
    accepted(data)
    if (!['isShow','schedule','adFreeCardSpec','tieredIncentiveSpec','extra'].some(key=>Object.hasOwn(data,key))) throw new BenefitsError('QQ 未返回可识别的会员福利信息')
    const schedule=data.schedule || {}, endsAt=expiry(data.userVipInfo?.AdActiveEnd ?? data.extra?.AdActiveEnd)
    return {
        available:flag(data.isShow), freeCards:count(data.adFreeCardSpec?.freeCardBalance),
        canReceiveGift:flag(data.tieredIncentiveSpec?.needSendLaunchGift),
        activeDays:count(schedule.activeDays), activeDaysToday:count(schedule.activeDaysToday),
        watchedToday:count(schedule.watchedAdNumsToday), dailyLimit:count(schedule.watchedAdNumsLimit),
        watchedToNextDay:count(schedule.watchedAdNumsToNextDay), coinsToday:count(schedule.coinNumsToday), coinsTotal:count(schedule.coinNumsSum),
        limited:flag(schedule.isLimit), activeUntil:endsAt, adVipActive:endsAt===null ? null : endsAt>now,
        // Text only; never pass server HTML, ad tokens or arbitrary navigation URLs.
        description:typeof data.text==='string' ? data.text.slice(0,500) : '', checkedAt:now
    }
}
export class QQBenefits {
    constructor({rpc,session,isCurrent,now=()=>Date.now()}) { Object.assign(this,{rpc,session,isCurrent,now}); this.mutations=new Set() }
    assertCurrent(session) { if(!this.isCurrent(session))throw new BenefitsError('QQ 账号已切换，请重新打开会员福利') }
    async statusFor(session) {
        this.assertCurrent(session)
        const raw=await this.rpc(POINT,'GetAdVipPointInfo',{source:'advip',adVipPoint:13,platform:1,needCalendar:true},session.cookie)
        this.assertCurrent(session)
        return normalizeQQBenefits(raw,this.now())
    }
    async activityFor(session) {
        const phoneInfo = { appid: '1511779011913623029', osType: 2 }
        const results = await Promise.allSettled([
            this.statusFor(session),
            this.rpc('music.stream.TaskFreeListen', 'GetFreeModeInfo', {}, session.cookie).then(raw => normalizeQQFreeListen(raw, this.now())),
            this.rpc('music.stream.AdsFreeListen', 'GetFreeModeInitInfo', { uin: String(session.profile.userId), freeModeTaskTypes: [29,30,31], phoneInfo }, session.cookie).then(normalizeQQFreeTasks)
        ])
        this.assertCurrent(session)
        return { info: results[0].status === 'fulfilled' ? results[0].value : null,
            listening: results[1].status === 'fulfilled' ? results[1].value : null,
            tasks: results[2].status === 'fulfilled' ? results[2].value : [],
            issues: results.map((result, index) => result.status === 'rejected' ? `${['绿钻活动','免费听时长','免费听任务'][index]}：${qqBenefitsErrorMessage(result.reason)}` : '').filter(Boolean) }
    }
    async run(action, expectedUin) {
        if(!['status','activity','launch-gift','use-card'].includes(action))throw new BenefitsError('不支持的 QQ 会员福利操作')
        const session=await this.session()
        if(!session?.cookie || !session.profile?.userId)throw new BenefitsError('请先登录 QQ 音乐')
        if(String(expectedUin || '')!==String(session.profile.userId))throw new BenefitsError('QQ 账号已切换，请重新打开会员福利')
        this.assertCurrent(session)
        if(action==='status')return {info:await this.statusFor(session)}
        if(action==='activity')return this.activityFor(session)
        const key=String(session.profile.userId)
        if(this.mutations.has(key))throw new BenefitsError('正在处理会员福利，请勿重复领取')
        this.mutations.add(key)
        try {
            const before=await this.statusFor(session)
            // A manual gift request may still ask the server for its final decision;
            // the displayed eligibility is advisory and never changes the payload.
            if(action==='use-card' && !(before.freeCards>0))throw new BenefitsError(before.freeCards===null ? 'QQ 未确认免广告卡余额，暂不能使用' : '当前账号没有可用的免广告卡')
            this.assertCurrent(session)
            let response
            try {
                response=await this.rpc(action==='launch-gift' ? POINT : REPORT,action==='launch-gift' ? 'SendLaunchGift' : 'UseAdFreeCard',action==='launch-gift' ? {source:'advip_home'} : {source:'advip_home',num:1},session.cookie)
            } catch(error) {
                this.assertCurrent(session)
                if (/连接失败|HTTP/.test(String(error?.message))) return {status:'submitted',message:'领取请求发出后连接中断，结果尚未确认，请稍后刷新核对，勿重复操作',activateSeconds:null,info:null}
                throw error
            }
            const raw=accepted(response)
            this.assertCurrent(session)
            const seconds=count(raw.activateSeconds)
            let after
            try { after=await this.statusFor(session) } catch {
                this.assertCurrent(session)
                return {status:'submitted',message:seconds>0 ? `QQ 已确认激活 ${seconds} 秒，权益刷新失败，请稍后刷新核对` : '请求已提交，权益暂未核实，请刷新核对后再操作',activateSeconds:seconds,info:null}
            }
            const increased=(after.activeUntil!==null && after.activeUntil>(before.activeUntil || 0)) || (after.activeDays!==null && before.activeDays!==null && after.activeDays>before.activeDays)
            const confirmed=seconds>0 || increased
            return {status:confirmed ? 'activated' : 'submitted',activateSeconds:seconds,info:after,message:confirmed ? `QQ 已确认${action==='use-card' ? '免广告卡激活' : '赠礼到账'}${seconds>0 ? `，时长 ${seconds} 秒` : ''}` : '请求已提交，暂未检测到新增时长，请以 QQ 官方权益为准，勿重复操作'}
        } finally { this.mutations.delete(key) }
    }
}
