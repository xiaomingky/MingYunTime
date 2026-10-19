import assert from 'node:assert/strict'
import { KugouClient } from '../electron/kugou-client.js'
import { youthVipResult } from '../src/utils/kugou-youth-vip.js'
import { createHash } from 'node:crypto'

const requests = []
const client = new KugouClient({
  now: () => 1_700_000_000_000,
  request: async config => { requests.push(config); return { data: { status: 1, error_code: 0, data: {} } } }
})
const auth = { token: 'valid-token-12345678', userid: '123456' }
await client.call('/youth/day/vip', { ...auth, receive_day: '2026-10-17' })
assert.equal(requests.at(-1).params.receive_day, '2026-10-17')
assert.equal(requests.at(-1).method, 'POST')
assert.ok(requests.at(-1).url.endsWith('/youth/v1/recharge/receive_vip_listen_song'))
assert.equal(requests.at(-1).params.source_id, 90139)
for (const receive_day of ['2026-02-30', '2026-2-01', '', undefined]) await assert.rejects(client.call('/youth/day/vip', { ...auth, receive_day }), /领取日期无效/)
await assert.rejects(client.call('/youth/day/vip', { ...auth, receive_day: '123456' }), /领取日期无效/)
await client.call('/youth/vip', auth)
const ad = requests.at(-1)
assert.equal(ad.url, 'https://gateway.kugou.com/youth/v1/ad/play_report')
assert.equal(ad.params.is_gradient, undefined)
assert.deepEqual(JSON.parse(ad.data), { ad_id: 12307537187, play_end: 1_700_000_000_000, play_start: 1_699_999_970_000 })
assert.equal(ad.headers['Content-Type'], 'application/json')
const {signature, ...unsigned} = ad.params
const salt = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
assert.equal(signature, createHash('md5').update(salt + Object.keys(unsigned).sort().map(k => `${k}=${unsigned[k]}`).join('') + ad.data + salt).digest('hex'))
assert.equal(ad.method, 'POST')
assert.equal(ad.params.userid, auth.userid)
assert.equal(ad.params.token, auth.token)
await assert.rejects(client.call('/youth/vip', {}), /登录/)
await client.call('/youth/day/vip/upgrade', auth)
assert.equal(requests.at(-1).params.ad_type, 1)
assert.equal(requests.at(-1).params.kugouid, auth.userid)
assert.equal(requests.at(-1).method, 'POST')
assert.ok(requests.at(-1).url.endsWith('/youth/v1/listen_song/upgrade_vip_reward'))
assert.equal(youthVipResult({status:0,data:{},msg:'资格不足'}, 'day').ok, false)
assert.equal(youthVipResult({status:1,error_code:7,data:{}}, 'day').ok, false)
assert.equal(youthVipResult({status:'1',error_code:0}, 'upgrade').msg, '升级成功')
const rejected = new KugouClient({request:async()=>({data:{status:0,error_code:7,error_msg:'今日已领取'}})})
await assert.rejects(rejected.call('/youth/day/vip', {...auth,receive_day:'2026-10-17'}), /今日已领取/)
const alreadyClaimed = new KugouClient({request:async()=>({data:{status:0,error_code:131001,error_msg:''}})})
await assert.rejects(alreadyClaimed.call('/youth/vip', auth), /您已经领取 VIP/)
console.log('Kugou youth VIP contract checks passed: date, legacy v1 report, signature, authentication, upgrade and platform rejection.')
