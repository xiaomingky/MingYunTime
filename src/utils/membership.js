export const vipFlag = value => value === true || value === 1 || value === '1'
export function membership(platform, profile, details, now = Date.now()) {
    const result = { status:'unknown', label:'会员状态待查询', expiresAt:'', benefits:[] }
    if (!profile) return result
    const mark = (active, label = 'VIP会员', expiresAt = '') => ({ ...result, status:active ? 'active' : 'inactive', label:active ? label : '普通用户', expiresAt })
    if (platform === 'kugou') {
        if (!Array.isArray(details?.busi_vip)) return result
        const entries = details.busi_vip.filter(v => vipFlag(v?.is_vip))
        const primary = entries.find(v => v.busi_type === 'concept' && v.product_type === 'svip') || entries.find(v => v.busi_type === 'concept') || entries[0] ||
            (vipFlag(details.is_vip) ? {vip_end_time:details.vip_end_time} : null)
        return { ...mark(!!primary, primary?.busi_type === 'concept' ? `概念版 ${String(primary.product_type || 'VIP').toUpperCase()}` : '酷狗 VIP', primary?.vip_end_time || ''), icon: primary?.busi_type === 'concept' ? `./membership/kugou-${primary.product_type === 'svip' ? 'svip' : 'tvip'}.webp` : primary ? `./membership/kugou-standard-${primary.product_type === 'svip' ? 'svip' : 'vip'}.webp` : '', benefits:entries.map(v=>({label:`${v.busi_type === 'concept' ? '概念版 ' : ''}${String(v.product_type || 'VIP').toUpperCase()}`,expiresAt:v.vip_end_time || ''})) }
    }
    if (platform === 'netease') {
        if (!details) return result
        const entries = ['redplus','associator','musicPackage'].map(k=>({key:k,...details[k]})).filter(v=>vipFlag(v.isSign) && (!v.expireTime || Number(v.expireTime)>now))
        const primary = entries[0]
        return { ...mark(!!primary, primary?.key === 'redplus' ? '黑胶 SVIP' : primary?.key === 'associator' ? '黑胶 VIP' : '音乐包', primary?.expireTime ? new Date(Number(primary.expireTime)).toLocaleDateString('zh-CN') : ''), icon: details.redVipLevelIcon || (primary?.key === 'redplus' ? './membership/netease-svip.png' : primary?.key === 'associator' ? './membership/netease-vip.png' : '') }
    }
    if (profile.isVip === undefined) return result
    const svip = platform === 'qishui' && /^(?:paid_|free_)?svip$/.test(profile.vipStage || '')
    return { ...mark(vipFlag(profile.isVip),platform === 'qq' ? (profile.vipLevel >= 2 ? '豪华绿钻' : '绿钻') : svip ? '汽水 SVIP' : '汽水 VIP',profile.vipExpireAt || ''), icon: platform === 'qishui' ? `./membership/qishui-${svip ? 'svip' : 'vip'}.png` : '' }
}
