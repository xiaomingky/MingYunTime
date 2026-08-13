const assert = require('assert')
const { default: axios } = require('axios')
const host = global.host || 'http://localhost:3000'
describe('测试搜索是否正常', () => {
  it('获取到的数据的 name 应该和搜索关键词一致', (done) => {
    const qs = {
      keywords: '拂晓 Proi Proi',
      type: 1,
      realIP: global.cnIp,
    }
    axios
      .get(`${host}/cloudsearch`, {
        params: qs,
      })
      .then(({ status, data }) => {
        if (status == 200) {
          assert(data.result.songs[0].name === '拂晓 Proi Proi')
        }
        done()
      })
      .catch((err) => {
        done(err)
      })
  })
})
