// 看广告免费听歌 - 领取免费听权益
// 请求流程（基于逆向网易云音乐 v9.5.45 RN Hermes 源码）：
// 1. 从广告平台拉广告 → 用户看完/点击广告 → 获取 ad 对象的 extJson.contextInfo.req_id 作为 reqUid
// 2. 调用本接口传入 reqUid 及相关权益参数，领取免费听权益
// 3. 服务器返回 gainFlag 等标识，用于展示领取结果

const createOption = require('../util/option.js')
const adGet = require('./ad_get.js')

module.exports = async (query, request) => {
  const time = Date.now()

  // 如果未传入 reqUid，自动从 ad_get 获取最新广告的 req_id
  let reqUid = query.reqUid || ''
  if (!reqUid) {
    try {
      const adRes = await adGet(
        { ...query, type_ids: query.type_ids || '["400002_0"]' },
        request,
      )
      reqUid = adRes?.body?.extra?.reqId || ''
      console.log(`自动获取 reqUid: ${reqUid}`)
    } catch (e) {
      // 获取广告失败，后续请求会因缺少 reqUid 被拒绝
    }
  }

  const rightsParam = {
    // 必填: 广告请求 ID，自动从 ad_get 获取
    reqUid,

    // 广告创意类型 (默认 1)
    creativeType: parseInt(query.creativeType || 2),

    // 时间戳
    exposureTime: query.exposureTime || time,
    clickTime: query.clickTime || time,

    // 权益领取方式
    rightsGainMethod: parseInt(query.rightsGainMethod || 2),

    // 权益时长相关
    rightsGainDuration: query.rightsGainDuration
      ? parseInt(query.rightsGainDuration)
      : undefined,
    extraRightsGainMethod: query.extraRightsGainMethod
      ? parseInt(query.extraRightsGainMethod)
      : undefined,
    extraRightsGainDuration: query.extraRightsGainDuration
      ? parseInt(query.extraRightsGainDuration)
      : undefined,
    nextRightsGainDuration: query.nextRightsGainDuration
      ? parseInt(query.nextRightsGainDuration)
      : undefined,

    // 来源标识 | 权益扩展信息
    source: query.source || undefined,
    rightsExtJson: query.rightsExtJson || undefined,

    // 应用信息（下载类广告）
    appInfo: query.appInfo ? JSON.parse(query.appInfo) : undefined,
    installed: query.installed ? parseInt(query.installed) : undefined,
  }

  // 清理 undefined 字段
  Object.keys(rightsParam).forEach((key) => {
    if (rightsParam[key] === undefined) delete rightsParam[key]
  })

  // 将参数序列化为 reqParam 字符串 (与 RN 源码完全一致)
  const data = {
    reqParam: JSON.stringify(rightsParam),
  }

  const res = await request(
    `/api/ad/listening/rights/gain`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )

  return {
    status: 200,
    body: {
      code: 200,
      data: res.body,
    },
  }
}
