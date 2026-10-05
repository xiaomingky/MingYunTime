import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { esportsRequest } from '../electron/esports-service.js'
import { parseLog, mergeLogs, playbackSources, stageBrackets, stageMatches } from '../src/utils/esports.js'
import { parseVrsStandings, vrsTeamKey, predictionPercent, vrsRank } from '../src/utils/esports-vrs.js'

const vrs = parseVrsStandings('| Standing | Points | Team Name | Roster | details |\n| --- | --- | --- | --- | --- |\n| 1 | 2031 | Spirit | donk, sh1ro, zont1x | [detail](a.md) |\n| 2 | 1943 | Vitality | ZywOo, ropz | [detail](b.md) |')
assert.deepEqual(vrs.map(r=>[r.rank,r.score,r.name]), [[1,2031,'Spirit'],[2,1943,'Vitality']])
assert.deepEqual(vrs[0].players.map(p=>p.name),['donk','sh1ro','zont1x'])
assert.equal(vrsTeamKey('NAVI'), vrsTeamKey('Natus Vincere'))
assert.equal(predictionPercent('36%'),36)
assert.equal(predictionPercent(0),0)
for(const value of ['',null,undefined,'--',-1,101,'bad'])assert.equal(predictionPercent(value),null)
for(const value of [17,'17',{rank:'17'}])assert.equal(vrsRank(value),17)
for(const value of ['',null,undefined,{},0,-1,'--',2.5])assert.equal(vrsRank(value),'--')

const samples = JSON.parse(await fs.readFile('preview/esports/probe.json','utf8'))
const eplStages = JSON.parse(await fs.readFile('preview/esports/epl-stages-api.json','utf8'))
const raw = samples['csgo-log'].data.list
const logs = mergeLogs([],raw)
assert.ok(logs.length > 0)
assert.equal(mergeLogs(logs,raw).length,logs.length)
assert.ok(logs.some(log => log.type === '8' && /击杀/.test(log.text)))
assert.equal(parseLog({log_info:'broken'}).text,'比赛事件')
assert.ok(stageMatches(samples['val-stages'].data).flatMap(s=>s.matches).length > 0)
const bracketFixture = stageBrackets(samples['val-stages'].data)
assert.ok(bracketFixture.length > 0)
assert.ok(bracketFixture.some(bracket => bracket.rounds.some(round => round.matches.some(match => match.t1 && match.t2 && match.id))))
const swissBrackets = stageBrackets(eplStages.data)
assert.ok(swissBrackets.some(bracket => bracket.sections.some(section => section.type === 'swiss' && section.columns.some(column => column.groups.some(group => ['0-0', '1-0', '0-1'].includes(group.name))))))
assert.ok(playbackSources(samples['csgo-live-detail'].data.match.mc_info).some(s=>s.type==='iframe'))
const fivePlayReplay = 'https://www.5eplay.com/video_app_common?video=PGlmcmFtZSB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiAgZnJhbWVib3JkZXI9IjAiIHNjcm9sbGluZz0ibm8iIHNyYz0iaHR0cHM6Ly9zMS1zdGF0aWMubXNzdGF0aWMuY29tL3ZvZC1wbGF5ZXItMzYwL2luZGV4Lmh0bWw%2FdmVyc2lvbj0xJmlkPTEwMDcyNjI1NTIiYWxsb3c9ImZ1bGxzY3JlZW4iPjwvaWZyYW1lPg%3D%3D&dispmod=1'
const fivePlaySource = playbackSources({ high_lights_cfg_list: [{ url: fivePlayReplay }] })[0]
assert.equal(fivePlaySource.type, 'iframe')
assert.match(fivePlaySource.url, /^https:\/\/s1-static\.msstatic\.com\/vod-player-360\//)
assert.equal(fivePlaySource.external, fivePlayReplay)
assert.equal(playbackSources({live_cfg_list:[{url:'javascript:alert(1)'}]}).length,0)
await assert.rejects(esportsRequest('detail',{game:'other',id:'x'}))
await assert.rejects(esportsRequest('detail',{game:'csgo',id:'../bad'}))
console.log('PASS: VRS Markdown/roster parsing, team aliases, prediction validation, logs, brackets, playback, input validation')
if (process.argv.includes('--live')) {
    const results = {}
    for (const game of ['csgo','val']) {
        for (const [operation,params] of [['matches',{limit:20}],['results',{date:'2026-10-05',limit:20}],['events',{limit:20}],['ranking',{kind:'team',limit:10}]]) {
            const data = await esportsRequest(operation,{game,...params})
            results[`${game}-${operation}`] = data
            assert.ok((data?.matches || data?.items || []).length > 0,`${game} ${operation} returned no rows`)
            console.log('PASS',game,operation,(data?.matches || data?.items || []).length)
        }
        const id = results[`${game}-results`].matches.find(m=>m.state?.bout_states?.length)?.mc_info.id
        const detail = await esportsRequest('detail',{game,id})
        results[`${game}-detail`] = detail
        assert.ok(detail.match?.mc_info?.id)
        assert.ok(detail.match.bouts_state?.length)
        const eventId = detail.match.tt_info.id
        for (const operation of ['analysis','logs']) {
            results[`${game}-${operation}`] = await esportsRequest(operation,{game,id,limit:80})
            console.log('PASS',game,operation)
        }
        for (const [operation,params] of [['event',{}],['stages',{}],['event-matches',{}],['event-stats',{kind:'player'}],['event-stats',{kind:'team'}]]) {
            results[`${game}-${operation}${params.kind ? '-'+params.kind : ''}`] = await esportsRequest(operation,{game,id:eventId,...params})
            console.log('PASS',game,operation,params.kind || '')
        }
        const logRows = results[`${game}-logs`]?.list || []
        if (logRows.length && game === 'csgo') {
            const ordered = mergeLogs([],logRows)
            for (const [older,version] of [[true,ordered[ordered.length-1].version],[false,ordered[0].version]]) {
                const next = await esportsRequest('logs',{game,id,older,version,limit:20})
                assert.ok(Array.isArray(next?.list))
                console.log('Log range',older,version,next.list.slice(0,2).map(row=>row.update_version),next.list.slice(-2).map(row=>row.update_version))
                console.log('PASS',game,older?'older logs':'new logs',next.list.length)
            }
        }
        const liveId = results[`${game}-matches`].matches[0].mc_info.id
        results[`${game}-live-detail`] = await esportsRequest('detail',{game,id:liveId})
        console.log('Playback sources',game,playbackSources(results[`${game}-live-detail`].match?.mc_info).length)
    }
    results['csgo-players'] = await esportsRequest('ranking',{game:'csgo',kind:'player',limit:10})
    results['csgo-series'] = await esportsRequest('series',{game:'csgo'})
    results['csgo-series-events'] = await esportsRequest('series-events',{game:'csgo',id:'1'})
    results['csgo-vrs-ranking'] = await esportsRequest('ranking',{game:'csgo',source:'vrs',kind:'team',limit:30})
    const official = results['csgo-vrs-ranking']
    assert.equal(official.source, '5EPlay VRS')
    assert.ok(official.items.length > 0 && official.total_rows >= official.items.length)
    assert.ok(official.items[0].rank > 0 && official.items[0].score > 0 && official.items[0].name)
    assert.ok(official.items.every((row, index, rows) => index === 0 || rows[index - 1].rank <= row.rank))
    const next = await esportsRequest('ranking',{game:'csgo',source:'vrs',page:2,limit:30})
    assert.equal(next.items.length, 0)
    const asia = await esportsRequest('ranking',{game:'csgo',source:'vrs',region:'asia',limit:5})
    assert.ok(asia.items.length>0 && asia.items.every(r=>r.region_name==='亚洲'))
    console.log('PASS: official VRS standings, publication date, pagination and Asian ranking')
    await fs.writeFile('preview/esports/live-check.json',JSON.stringify(results,null,2))
    console.log('PASS: live CS / VAL service operations')
}
