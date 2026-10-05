import fs from 'node:fs/promises'

const base = 'https://esports-data.5eplaycdn.com'
const ya = 'https://ya-api-app.5eplay.com'
const app = 'https://app.5eplay.com'
let records = {}
try { records = JSON.parse(await fs.readFile('preview/esports/probe.json', 'utf8')) } catch {}
async function read(label, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { console.log(label, response.status, 'non-JSON', text.slice(0, 160)); return }
    records[label] = body
    console.log(label, response.status, body.success, body.message, JSON.stringify(body.data).slice(0, 2300))
    return body.data
  } catch (error) { console.log(label, error.message, error.cause?.code) }
}
if (process.argv.includes('--realtime')) {
  for (const game of ['csgo', 'val']) {
    const id = records[`${game}-results`]?.data?.matches?.[0]?.mc_info?.id
    const tt = records[`${game}-results`]?.data?.matches?.[0]?.tt_info?.id
    await read(`${game}-log`, `${base}/v1/api/${game}/match/${id}/event/log?limit=30&direction=before&update_version=&bout_id=`)
    for (const type of [1, 2]) await read(`${game}-event-data-${type}`, `${base}/v1/api/${game}/tournaments/${tt}/data?type=${type}&tt_id=${tt}`)
    await read(`${game}-active-events`, `${app}/api/${game === 'csgo' ? 'csgo/tournament/csgo_event_list' : 'valorant/tournament/event_list'}?page_size=20&is_follow=0&order_by=asc&status=1&page_token=`)
  }
  const id = records['csgo-results']?.data?.matches?.[0]?.mc_info?.id
  await read('csgo-text', `${base}/v1/esport/lbit_csgo_live/list?match_id=${id}&bout=0&page=1&sort=0&sort_by=desc`)
} else if (process.argv.includes('--datasets')) {
  for (const [game, type] of [['csgo', 1], ['val', 5]]) {
    const result = await read(`${game}-results`, `${app}/api/tournament/session_result_list?game_type=${type}&page_size=20&order_by=asc&page_token=2026-10-05%2023:59:59`)
    const match = result?.matches?.[0]
    if (match) {
      const tt = match.tt_info.id
      const id = match.mc_info.id
      await read(`${game}-detail`, `${app}/api/tournament/session_info?game_type=${type}&id=${id}`)
      await read(`${game}-analysis`, `${base}/v1/api/${game}/matches/${id}/analysis_v1`)
      await read(`${game}-introduction`, `${base}/v1/api/${game}/tournaments/${tt}/introduction`)
      await read(`${game}-stages`, `${base}/v1/api/${game}/tournaments/${tt}/stages`)
      for (const mode of ['player', 'team']) {
        await read(`${game}-event-${mode}`, `${base}/v1/api/${game}/tournaments/${tt}/${mode}_data?disp_field=${game === 'csgo' ? 'rating' : 'acs'}&page=1&limit=20`)
      }
      await read(`${game}-event-data`, `${base}/v1/api/${game}/tournaments/${tt}/data?type=player`)
    }
    await read(`${game}-teams`, `${base}/v1/api/${game}/teams?page=1&limit=20`)
    await read(`${game}-schedule`, `${app}/api/tournament/session_list?game_type=${type}&game_status=1&page=1&limit=20`)
    await read(`${game}-events`, `${app}/api/${game === 'csgo' ? 'csgo/tournament/csgo_event_list' : 'valorant/tournament/event_list'}?page_size=20&is_follow=0&order_by=asc&status=0&page_token=2026-10-05%2023:59:59`)
    const candidate = records[`${game}-schedule`]?.data?.matches?.find(m => String(m.state?.status) === '1') || records[`${game}-schedule`]?.data?.matches?.[0]
    if (candidate) await read(`${game}-live-detail`, `${app}/api/tournament/session_info?game_type=${type}&id=${candidate.mc_info.id}`)
    await read(`${game}-series`, `${base}/v1/api/${game}/league/list`)
  }
  await read('csgo-player-list', `${base}/v1/api/csgo/players?page=1&limit=20`)
} else if (process.argv.includes('--focus')) {
  for (const [game, type] of [['csgo', 1], ['val', 5]]) {
    const result = records[`${game}-results`]?.data
    const tt = result?.matches?.[0]?.tt_info?.id
    const id = result?.matches?.[0]?.mc_info?.id
    for (const path of ['players?page=1&limit=5', `tournaments/${tt}/player_data`, `tournaments/${tt}/team_data`, `tournaments/${tt}/data`, `tournaments?page_size=5&order_by=desc&page_token=2026-10-05&status=live`, 'league/list']) {
      await read(`${game}-${path}`, `${base}/v1/api/${game}/${path}`)
    }
    const team = records[`${game}-teams`]?.data?.items?.[0]?.id
    await read(`${game}-team-overview`, `${base}/v1/api/${game}/teams/${team}/overview`)
    const live = records[`${game}-live`]?.data?.matches?.find(m => String(m.state?.status) === '1') || records[`${game}-live`]?.data?.matches?.[0]
    if (live) await read(`${game}-live-detail`, `${app}/api/tournament/session_info?game_type=${type}&id=${live.mc_info.id}`)
    await read(`${game}-schedule-date`, `${app}/api/tournament/session_list?game_type=${type}&game_status=1&page=1&limit=5&game_date=2026-10-05`)
    if (id) await read(`${game}-log`, `${base}/v1/api/${game}/match/${id}/event/log?limit=5`)
  }
} else if (process.argv.includes('--hosts')) {
  for (const host of [base, app, ya]) {
    for (const path of ['/v1/api/csgo/new/rank/team_list', '/v1/api/csgo/tournaments/player_data', '/v1/api/val/tournaments/player_data', '/v1/api/val/tlib/tournaments/list']) {
      await read(`${host}${path}`, `${host}${path}?page=1&limit=3`)
    }
  }
} else for (const [game, type] of [['csgo', 1], ['val', 5]]) {
  const date = '2026-10-05 23:59:59'
  const result = await read(`${game}-results`, `${app}/api/tournament/session_result_list?game_type=${type}&page_size=3&order_by=asc&page_token=${encodeURIComponent(date)}`)
  const match = result?.matches?.[0]
  if (match) {
    const id = match.mc_info.id
    const tt = match.tt_info.id
    await read(`${game}-detail`, `${app}/api/tournament/session_info?game_type=${type}&id=${id}`)
    await read(`${game}-bouts`, `${base}/v1/api/${game}/matches/${id}/bouts`)
    await read(`${game}-analysis`, `${base}/v1/api/${game}/matches/${id}/analysis_v1`)
    await read(`${game}-data`, `${base}/v1/api/${game}/matches/${id}/data`)
    await read(`${game}-stages`, `${base}/v1/api/${game}/tournaments/${tt}/stages`)
    await read(`${game}-introduction`, `${base}/v1/api/${game}/tournaments/${tt}/introduction`)
    await read(`${game}-event-data`, `${base}/v1/api/${game}/tournaments/${tt}/data`)
  }
  await read(`${game}-teams`, `${base}/v1/api/${game}/teams?page=1&limit=5`)
  await read(`${game}-player-rank`, `${ya}/v1/api/${game}/tournaments/player_data?page=1&limit=5`)
  await read(`${game}-team-rank`, `${ya}/v1/api/${game}/tournaments/team_data?page=1&limit=5`)
  await read(`${game}-map-rank`, `${ya}/v1/api/${game}/tournaments/map_data?page=1&limit=5`)
  await read(`${game}-events`, `${base}/v1/api/${game}/tlib/tournaments/list?page=1&limit=5`)
  await read(`${game}-live`, `${app}/api/tournament/session_list?game_type=${type}&game_status=1&page=1&limit=5`)
}
await read('csgo-rank', `${ya}/v1/api/csgo/new/rank/team_list?page=1&limit=10`)
await read('csgo-players', `${ya}/v1/api/csgo/rank/player_list?page=1&limit=10`)
await fs.mkdir('preview/esports', { recursive: true })
await fs.writeFile('preview/esports/probe.json', JSON.stringify(records, null, 2))
