// 易盾反作弊 Token 注册端点
// 调用后获取实时 token 并存入共享存储，供后续带 checkToken 的请求使用
//
// GET  /register/checktoken        → 返回当前 token（尚无则自动获取）
// POST /register/checktoken        → 强制刷新 token
// GET  /register/checktoken?refresh=1 → 强制刷新
//
const { default: axios } = require('axios')
const { APP_CONF } = require('../util/config.json')

const URL = APP_CONF.dunDomainV3 + '/v3/b?pn=YD00000558929251'
let _token = ''

async function fetch() {
  const res = await axios.get(URL, { timeout: 10000 })
  const body = String(res.data)
  const m = body.match(/null\(\[(\d+),\d+,\"([^\"]+)\"\]\)/)
  if (m && m[1] === '200') return m[2]
  throw new Error('易盾返回异常: ' + body.substring(0, 100))
}

// 端点处理
module.exports = async (query) => {
  const refresh = query.refresh === '1' || query.refresh === 'true'
  let token = refresh ? null : _token
  if (!token) {
    token = await fetch()
    _token = token
  }
  return {
    status: 200,
    body: { code: 200, token, registered: !!token },
  }
}

// 给 request.js 读取用
module.exports.getToken = () => _token
