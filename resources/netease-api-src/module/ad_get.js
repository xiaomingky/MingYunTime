// 获取广告

const createOption = require('../util/option.js')

module.exports = async (query, request) => {
  const data = {
    type_ids: query.type_ids || '["400002_0"]',
  }

  const option = createOption(query, 'xeapi', 'v3')

  const res = await request(`/api/ad/get`, data, option)
  const raw = res.body

  // 提取广告中的 req_id
  let reqId = ''
  try {
    if (raw?.ads) {
      const ad = Object.values(raw.ads)[0]
      if (ad?.extJson) {
        const ext = JSON.parse(ad.extJson)
        reqId = ext?.contextInfo?.req_id || ''
      }
    }
  } catch (_) {}

  return {
    status: 200,
    body: {
      code: 200,
      ads: raw?.ads || null,
      message: raw?.message || null,
      extra: { reqId },
    },
  }
}
