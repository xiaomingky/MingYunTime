import assert from 'node:assert/strict'
import { matchScoreboard } from '../src/utils/esports.js'

const bout = (number, status, a, b, name = `地图 ${number}`) => ({
    bout_num: String(number), status: String(status), display: '1', map_name: name,
    t1_stats: { all_score: a }, t2_stats: { all_score: b }, curr_round_num: '23', curr_bout_stage: 'sh'
})
const match = (status, maps) => ({global_state:{status:String(status),t1_score:'2',t2_score:'1'},bouts_state:maps})
const live = matchScoreboard(match(1, [bout(3,1,'13','9','Mirage'), bout(1,2,'13','6'), bout(2,2,'8','13')]))
assert.deepEqual(live.series, {t1:'2',t2:'1'})
assert.deepEqual(live.maps.map(map=>map.number), ['1','2','3'])
assert.equal(live.active.t1, '13'); assert.equal(live.active.t2, '9'); assert.equal(live.active.name, 'Mirage')
assert.equal(live.active.stage, '下半场'); assert.equal(live.featured, live.active)
assert.equal(matchScoreboard(match(1, [bout(1,2,'13','9'),bout(2,0,'','')])).active, null, 'map break never relabels last result as live')
assert.equal(matchScoreboard(match(0, [bout(1,0,'','')])).featured, null)
assert.deepEqual(matchScoreboard(match(0, [])).series, {t1:'--',t2:'--'})
const finished = matchScoreboard(match(2, [bout(1,2,'13','9'),bout(2,2,'9','13'),bout(3,2,'16','14')]))
assert.equal(finished.featured.number, '3'); assert.equal(finished.active, null)
assert.equal(finished.featured.t1, '16', 'overtime round score remains a map score')
const missing = matchScoreboard(match(1, [bout(1,1,'',null)]))
assert.equal(missing.active.t1, '--'); assert.equal(missing.active.t2, '--', 'missing scores never fall back to series wins')
const zero = matchScoreboard(match(1, [bout(1,1,0,'0')]))
assert.equal(zero.active.t1, '0'); assert.equal(zero.active.t2, '0')
assert.equal(matchScoreboard(match(0, [{...bout(1,-1,'','', ''),display:'2'}])).maps.length, 0)
assert.equal(matchScoreboard(null).featured, null)
assert.equal(matchScoreboard({bouts_state:{}}).maps.length, 0)
console.log('Esports scoreboard checks passed: series/map separation, 13:9 live rounds, map breaks, upcoming/finished, overtime, missing/zero scores and hidden maps.')
