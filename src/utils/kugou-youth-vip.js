// A data object alone is not proof that the platform granted a reward.
export function youthVipResult(response, type) {
    const ok = Number(response?.status) === 1 && Number(response?.error_code || response?.errcode || 0) === 0
    const detail = response?.errmsg || response?.error_msg || response?.message || response?.tip || response?.msg || ''
    const action = type === 'upgrade' ? '升级' : '领取'
    return { ok, msg: ok ? (detail || action + '成功') : action + '失败' + (detail ? '：' + detail : '') }
}
