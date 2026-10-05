import axios from 'axios'
import { parseVrsStandings, vrsTeamKey } from '../src/utils/esports-vrs.js'

const APP = 'https://app.5eplay.com'
const DATA = 'https://esports-data.5eplaycdn.com'
const cache = new Map()
const pending = new Map()
const games = { csgo: 1, val: 5 }
let vrsSnapshot
const vrsPending = new Map()
async function vrsRanking(region = '') {
    const area = ['europe','americas','asia'].includes(region) ? region : 'global'
    if (vrsPending.has(area)) return vrsPending.get(area)
    const request = loadVrsRanking(region).finally(() => vrsPending.delete(area))
    vrsPending.set(area,request)
    return request
}
async function loadVrsRanking(region = '') {
    const area = { europe: 'europe', americas: 'americas', asia: 'asia' }[region] || 'global'
    const now = Date.now()
    if (vrsSnapshot?.[area]?.until > now) return vrsSnapshot[area].data
    try {
        const fivePlay = await loadFivePlayVrsRanking(area)
        if (fivePlay.items.length) {
            vrsSnapshot ||= {}
            vrsSnapshot[area] = { data: fivePlay, until: now + 15 * 60 * 1000 }
            return fivePlay
        }
    } catch (error) {
        // Keep the public Valve standings available when the app endpoint is unavailable.
        console.warn('[esports] 5EPlay VRS unavailable, using Valve fallback:', error.message)
    }
    return loadValveVrsRanking(area, now)
}

function vrsRows(value) {
    const preferred = []
    const visit = node => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
            const teamRows = node.filter(row => row && typeof row === 'object' && !Array.isArray(row) && (
                row.team || row.team_info || row.team_name || row.teamName || row.name || row.disp_name || row.points != null || row.score != null
            ))
            if (teamRows.length) preferred.push(teamRows)
            else node.forEach(visit)
            return
        }
        for (const [key, child] of Object.entries(node)) {
            if (['items','list','rows','ranking','rankings','teams','data','result'].includes(key)) visit(child)
        }
    }
    visit(value)
    return preferred.sort((a, b) => b.length - a.length)[0] || []
}

function normalizeFivePlayVrs(value, area) {
    const rows = vrsRows(value)
    const labels = { europe: '欧洲', americas: '美洲', asia: '亚洲', global: '' }
    return rows.map((raw, index) => {
        const team = raw.team || raw.team_info || raw.teamInfo || raw
        const players = raw.players || raw.roster || raw.player_list || raw.lineup || team.players || []
        const rank = Number(raw.rank ?? raw.ranking ?? raw.position ?? team.rank ?? index + 1)
        const points = Number(raw.score ?? raw.points ?? raw.point ?? raw.vrs_score ?? raw.value ?? team.score ?? team.points)
        const name = raw.team_name || raw.teamName || raw.name || raw.disp_name || team.team_name || team.name || team.disp_name
        if (!name || !Number.isFinite(points)) return null
        return {
            ...raw,
            id: raw.id || team.id || `5eplay-vrs-${rank || index + 1}`,
            rank: Number.isInteger(rank) && rank > 0 ? rank : index + 1,
            score: points,
            name: String(name),
            logo: raw.logo || raw.team_logo || team.logo || team.logo_url || '',
            region_name: raw.region_name || raw.region || labels[area] || '',
            players: (Array.isArray(players) ? players : []).map(player => ({
                ...player,
                name: player.name || player.nick || player.nickname || player.player_name || player.username || ''
            })).filter(player => player.name)
        }
    }).filter(Boolean).sort((a, b) => a.rank - b.rank)
}

async function loadFivePlayVrsRanking(area) {
    const endpoint = `${DATA}/v1/api/csgo/new/rank/team_list`
    const regionLabels = { europe: '欧洲', americas: '美洲', asia: '亚洲' }
    const body = {
        sort_key: 'valve_point',
        sort_value: 'desc',
        ...(area !== 'global' ? { region: regionLabels[area] } : {})
    }
    const response = await axios.post(endpoint, body, {
        timeout: 12000,
        maxContentLength: 8 * 1024 * 1024
    })
    const responseBody = response.data
    if (responseBody?.success === false) throw new Error(responseBody.message || '5EPlay VRS 请求失败')
    const payload = responseBody?.data ?? responseBody?.result ?? responseBody
    const rawItems = Array.isArray(payload?.items) ? payload.items : []
    if (!rawItems.length) throw new Error('5EPlay VRS 返回格式无法识别')

    // The ranking endpoint supplies Valve rank/points in field_values. Team
    // metadata is optional and is only used for roster and presentation data.
    let metadata = []
    try {
        const teamData = await get(DATA, '/v1/api/csgo/teams', { page: 1, limit: 100 }, 60000)
        metadata = Array.isArray(teamData?.items) ? teamData.items : []
    } catch {
        metadata = []
    }
    const metadataById = new Map(metadata.map(team => [String(team.id || team.team_id || ''), team]))
    const metadataByName = new Map(metadata.map(team => [vrsTeamKey(team.name || team.team_name), team]))
    const items = rawItems.map((raw, index) => {
        const values = raw.field_values || {}
        const team = metadataById.get(String(raw.team_id || '')) || metadataByName.get(vrsTeamKey(raw.team_name)) || {}
        const rank = Number(values.valve_rank ?? values.global_rank ?? values.rank)
        const points = Number(values.valve_point)
        if (!raw.team_name || !Number.isFinite(rank) || !Number.isFinite(points)) return null
        return {
            id: String(raw.team_id || team.id || `5eplay-vrs-${rank || index + 1}`),
            team_id: String(raw.team_id || team.id || ''),
            name: String(raw.team_name),
            logo: raw.team_logo || team.logo || '',
            country_logo: raw.country_logo || team.country_logo || '',
            rank,
            score: points,
            region_name: values.region_name || regionLabels[area] || '',
            kd: values.kd || team.kd || '',
            kd_diff: values.kd_diff || team.kd_diff || '',
            map_count: values.map_num || team.map_count || '',
            rank_change: values.rank_change || values.rank_diff || '',
            players: Array.isArray(team.players) ? team.players : []
        }
    }).filter(Boolean).sort((a, b) => a.rank - b.rank)
    if (!items.length) throw new Error('5EPlay VRS 返回格式无法识别')
    return {
        items,
        published_at: responseBody?.published_at || responseBody?.date || payload?.date || '',
        source: '5EPlay VRS',
        source_url: endpoint,
        total_rows: Number(payload?.total_rows || responseBody?.total_rows || payload?.total || items.length),
        total_page: Number(payload?.total_page || responseBody?.total_page || 1)
    }
}

async function loadValveVrsRanking(area, now) {
    const repo = 'https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents'
    const options = { timeout: 15000, maxContentLength: 4 * 1024 * 1024, headers: { Accept: 'application/vnd.github+json' } }
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '_')
    let latest
    for (const year of [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1]) {
        let directory
        try { directory = (await axios.get(`${repo}/live/${year}`, options)).data }
        catch (e) { if (e.response?.status === 404) continue; throw new Error('Valve VRS 榜单暂时无法连接，请稍后重试') }
        latest = (Array.isArray(directory) ? directory : []).filter(file => new RegExp(`^standings_${area}_\\d{4}_\\d{2}_\\d{2}\\.md$`).test(file.name) && file.name.slice(-13, -3) <= today).sort((a, b) => b.name.localeCompare(a.name))[0]
        if (latest) break
    }
    if (!latest) throw new Error('Valve 尚未发布该赛区的 VRS 榜单')
    // Build a fixed-host URL from a validated filename, not a URL in API data.
    const year = latest.name.slice(-13, -9)
    const rawUrl = `https://raw.githubusercontent.com/ValveSoftware/counter-strike_regional_standings/main/live/${year}/${latest.name}`
    const markdown = (await axios.get(rawUrl, options)).data
    const official = parseVrsStandings(markdown)
    if (!official.length) throw new Error('VRS 榜单格式暂时无法识别')
    const regions = new Map()
    if (area === 'global') {
        const regional = await Promise.allSettled(['europe','americas','asia'].map(async region => {
            const filename = latest.name.replace('standings_global_', `standings_${region}_`)
            const content = (await axios.get(`https://raw.githubusercontent.com/ValveSoftware/counter-strike_regional_standings/main/live/${year}/${filename}`, options)).data
            return { region, teams: parseVrsStandings(content) }
        }))
        const labels = { europe:'欧洲', americas:'美洲', asia:'亚洲' }
        for (const result of regional) if (result.status === 'fulfilled') {
            for (const team of result.value.teams) {
                const key = vrsTeamKey(team.name), membership = regions.get(key) || []
                if (!membership.includes(labels[result.value.region])) membership.push(labels[result.value.region])
                regions.set(key,membership)
            }
        }
    }
    const metadata = await get(DATA, '/v1/api/csgo/teams', { page: 1, limit: 100 }, 60000).catch(() => ({ items: [] }))
    const teams = new Map((metadata.items || []).map(row => [vrsTeamKey(row.name), row]))
    const data = { items: official.map(row => {
        const team = teams.get(vrsTeamKey(row.name))
        return { ...row, id: row.id, team_id: team?.id || '', logo: team?.logo || '', region_name: { europe: '欧洲', americas: '美洲', asia: '亚洲' }[area] || regions.get(vrsTeamKey(row.name))?.join(' / ') || '', players: row.players.map(p => ({ ...team?.players?.find(t => t.name.toLowerCase() === p.name.toLowerCase()), name: p.name })) }
    }), published_at: latest.name.slice(-13, -3).replace(/_/g, '-'), source: 'Valve Regional Standings', source_url: `https://github.com/ValveSoftware/counter-strike_regional_standings/blob/main/live/${year}/${latest.name}`, total_rows: official.length }
    vrsSnapshot ||= {}
    vrsSnapshot[area] = { data, until: now + 2 * 60 * 60 * 1000 }
    return data
}
const integer = (v, fallback, max = 100) => Math.min(max, Math.max(1, Number(v) || fallback))
function identifier(v) {
    const s = String(v || '')
    if (!/^[a-zA-Z0-9_-]{1,90}$/.test(s)) throw new Error('无效的赛事编号')
    return s
}
function date(v) {
    const s = String(v || '')
    if (s && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(s)) throw new Error('日期格式无效')
    return s
}
function cursor(v) {
    const s = String(v || '')
    if (s.length > 500 || !/^[a-zA-Z0-9_ ,:.-]*$/.test(s)) throw new Error('分页参数无效')
    return s
}
async function get(host, path, params = {}, ttl = 15000) {
    const key = JSON.stringify([host, path, params])
    const hit = cache.get(key)
    if (hit && hit.until > Date.now()) return hit.data
    if (pending.has(key)) return pending.get(key)
    const task = (async () => {
        const response = await axios.get(host + path, { params, timeout: 15000, maxContentLength: 8 * 1024 * 1024 })
        const body = response.data
        if (body?.success !== true) throw new Error(body?.message || '赛事数据暂时不可用')
        const data = body.data
        if (ttl) {
            if (cache.size >= 100) cache.delete(cache.keys().next().value)
            cache.set(key, { data, until: Date.now() + ttl })
        }
        return data
    })().finally(() => pending.delete(key))
    pending.set(key, task)
    return task
}

function eventRows(value) {
    return Array.isArray(value?.items) ? value.items : Array.isArray(value?.list) ? value.list : []
}

async function collectTournamentEvents(game, status, maxPages = 8) {
    const path = game === 'csgo'
        ? '/api/csgo/tournament/csgo_event_list'
        : '/api/valorant/tournament/event_list'
    const rows = [], seenIds = new Set(), seenTokens = new Set()
    let pageToken = ''
    for (let index = 0; index < maxPages; index += 1) {
        const response = await get(APP, path, {
            page_size: 100,
            is_follow: 0,
            status,
            order_by: 'desc',
            page_token: pageToken
        }, 60000)
        const pageRows = eventRows(response)
        for (const row of pageRows) {
            const id = String(row?.basic_info?.id || row?.id || '')
            if (id && !seenIds.has(id)) {
                seenIds.add(id)
                rows.push(row)
            }
        }
        const nextToken = String(pageRows.at(-1)?.page_token || response?.page_token || response?.next_page_token || '')
        if (!pageRows.length || !nextToken || nextToken === pageToken || seenTokens.has(nextToken)) break
        seenTokens.add(nextToken)
        pageToken = nextToken
    }
    return rows
}

function seriesEventMatches(row, leagueId, leagueName = '') {
    const text = String(row?.basic_info?.disp_name || row?.name || row?.disp_name || '').toLowerCase()
    const aliases = {
        '1': ['major'],
        '2': ['blast'],
        '3': ['esl'],
        '4': ['iem']
    }
    const terms = aliases[String(leagueId)] || String(leagueName).toLowerCase().split(/\s+/).filter(term => term.length > 1)
    return terms.some(term => text.includes(term))
}

function normalizeSeriesEvent(row, leagueId, regionId) {
    const basic = row?.basic_info || row || {}
    const id = String(basic.id || row?.tt_id || row?.id || '')
    return {
        ...row,
        tt_id: row?.tt_id || id,
        id,
        league_id: row?.league_id || leagueId,
        region_id: row?.region_id || regionId,
        name: row?.name || basic.disp_name || row?.disp_name || '',
        disp_name: row?.disp_name || basic.disp_name || '',
        logo: row?.logo || basic.logo || '',
        start_time: row?.start_time || basic.start_time || '',
        end_time: row?.end_time || basic.end_time || '',
        status: row?.status || basic.status || ''
    }
}

export async function esportsRequest(operation, input = {}) {
    const p = input || {}
    const game = p.game || 'csgo'
    if (!games[game]) throw new Error('仅支持 CS 和 VAL')
    const root = `/v1/api/${game}`
    const page = integer(p.page, 1, 1000)
    const limit = integer(p.limit, 30)
    switch (operation) {
        case 'matches':
            return get(APP, '/api/tournament/session_list', {
                game_type: games[game], game_status: '1', page, limit,
                ...(p.date ? { game_date: date(p.date) } : {}),
                ...(p.eventId ? { tt_ids: identifier(p.eventId) } : {})
            }, 5000)
        case 'results':
            return get(APP, '/api/tournament/session_result_list', {
                game_type: games[game], page_size: limit, order_by: 'asc',
                page_token: cursor(p.cursor || `${date(p.date)} 23:59:59`)
            })
        case 'events': {
            const path = game === 'csgo'
                ? '/api/csgo/tournament/csgo_event_list'
                : '/api/valorant/tournament/event_list'
            const params = {
                page_size: limit,
                is_follow: 0,
                status: p.status === 'past' ? 0 : 1,
                order_by: 'desc'
            }
            const all = []
            const seenIds = new Set()
            const seenTokens = new Set()
            let pageToken = cursor(p.cursor)
            let first = null
            let hasMore = false

            // The endpoint may cap page_size below the requested value. Keep
            // following the item cursor so the events view does not silently
            // stop after the first page.
            for (let index = 0; index < 20; index += 1) {
                const response = await get(APP, path, {
                    ...params,
                    page_token: pageToken
                }, 60000)
                first ||= response
                const rows = Array.isArray(response?.items)
                    ? response.items
                    : Array.isArray(response?.list)
                        ? response.list
                        : []
                for (const row of rows) {
                    const id = String(row?.basic_info?.id || row?.id || JSON.stringify(row))
                    if (!seenIds.has(id)) {
                        seenIds.add(id)
                        all.push(row)
                    }
                }

                const nextToken = String(
                    rows.at(-1)?.page_token ||
                    response?.page_token ||
                    response?.next_page_token ||
                    ''
                )
                if (!rows.length || !nextToken || nextToken === pageToken || seenTokens.has(nextToken)) break
                seenTokens.add(nextToken)
                pageToken = nextToken
                if (index === 19) hasMore = true
            }

            return {
                ...(first || {}),
                items: all,
                list: all,
                page_token: hasMore ? pageToken : '',
                has_more: hasMore
            }
        }
        case 'ranking':
            if (game === 'csgo' && p.kind !== 'player' && p.source === 'vrs') {
                const data = await vrsRanking(p.region)
                // The upstream endpoint currently returns a stable first page
                // but does not reliably honor page/limit parameters. Never
                // manufacture a second page from duplicated rows.
                const items = page === 1 ? data.items.slice(0, limit) : []
                return { ...data, items, page, limit }
            }
            if (p.kind === 'player' && game === 'val') throw new Error('VAL 选手排名请在赛事统计中查看')
            return get(DATA, `${root}/${p.kind === 'player' ? 'players' : 'teams'}`, {
                page, limit,
                ...(p.region && ['amers', 'emea', 'pacific', 'cn'].includes(p.region) ? { region: p.region, region_id: p.region } : {})
            }, 60000)
        case 'detail':
            return get(APP, '/api/tournament/session_info', { game_type: games[game], id: identifier(p.id) }, 2500)
        case 'analysis':
            return get(DATA, `${root}/matches/${identifier(p.id)}/analysis_v1`, {}, 60000)
        case 'logs':
            return get(DATA, `${root}/match/${identifier(p.id)}/event/log`, {
                limit, update_version: cursor(p.version || '0'),
                ...(game === 'csgo' ? { bout_id: p.bout ? identifier(p.bout) : '', direction: p.version ? (p.older ? 'down' : 'up') : '' } : {})
            }, 0)
        case 'event':
            return get(DATA, `${root}/tournaments/${identifier(p.id)}/introduction`, {}, 60000)
        case 'stages':
            return get(DATA, `${root}/tournaments/${identifier(p.id)}/stages`, {}, 60000)
        case 'event-matches':
            return get(APP, '/api/tournament/event_session_list', { tt_id: identifier(p.id), game_type: games[game], page, limit })
        case 'event-stats':
            if (game === 'csgo') return get(DATA, `${root}/tournaments/${identifier(p.id)}/data`, {
                tt_id: identifier(p.id), type: p.kind === 'team' ? '2' : '1'
            }, 60000)
            return get(DATA, `${root}/tournaments/${identifier(p.id)}/${p.kind === 'team' ? 'team_data' : 'player_data'}`, {
                disp_field: ['acs', 'adr', 'kd', 'rating'].includes(p.metric) ? p.metric : 'acs', page, limit
            }, 60000)
        case 'series':
            return get(DATA, `${root}/league/list`, {}, 60000)
        case 'series-events':
            {
                const regionId = identifier(p.id)
                const leagueValue = p.leagueId || p.league_id
                const leagueId = leagueValue ? identifier(leagueValue) : ''
                const requestWithLeague = { region_id: regionId, page, limit, ...(leagueId ? { league_id: leagueId } : {}) }
                let request = requestWithLeague
                let first
                try {
                    first = await get(DATA, `${root}/league/tt/list`, requestWithLeague, 60000)
                } catch (error) {
                    // Older deployments reject the extra league_id query
                    // parameter even though region_id is accepted.
                    if (!leagueId) throw error
                    request = { region_id: regionId, page, limit }
                    first = await get(DATA, `${root}/league/tt/list`, request, 60000)
                }
                const firstRows = eventRows(first)
                const reportedPages = Math.min(20, Math.max(1, Number(first?.total_page) || 1))
                const rows = [...firstRows]
                const signatures = new Set([JSON.stringify(firstRows.map(row => row.tt_id || row.id || row.basic_info?.id || row.name))])
                // Some 5EPlay deployments report total_page=1 even when later
                // pages exist. Probe a bounded number of pages and stop when
                // the endpoint repeats a page or returns no rows.
                const probePages = Math.min(20, Math.max(reportedPages, page === 1 ? 8 : page))
                for (let nextPage = page + 1; nextPage <= probePages; nextPage += 1) {
                    const next = await get(DATA, `${root}/league/tt/list`, { ...request, page: nextPage }, 60000)
                    const nextRows = eventRows(next)
                    if (!nextRows.length) break
                    const signature = JSON.stringify(nextRows.map(row => row.tt_id || row.id || row.basic_info?.id || row.name))
                    if (signatures.has(signature)) break
                    signatures.add(signature)
                    rows.push(...nextRows)
                }

                // The league endpoint is an archive and can lag behind the
                // tournament list. Merge current and recent years from the
                // official 5EPlay event feed when their names identify this
                // league (Major, BLAST, ESL or IEM).
                try {
                    const [past, upcoming] = await Promise.all([
                        collectTournamentEvents(game, 0),
                        collectTournamentEvents(game, 1)
                    ])
                    rows.push(...past.filter(row => seriesEventMatches(row, leagueId, p.leagueName)).map(row => normalizeSeriesEvent(row, leagueId, regionId)))
                    rows.push(...upcoming.filter(row => seriesEventMatches(row, leagueId, p.leagueName)).map(row => normalizeSeriesEvent(row, leagueId, regionId)))
                } catch {
                    // The archive remains usable when the event feed is down.
                }
                const unique = [...new Map(rows.map(row => [String(row.tt_id || row.id || row.basic_info?.id || JSON.stringify(row)), row])).values()]
                    .sort((a, b) => String(b.start_time || b.basic_info?.start_time || '').localeCompare(String(a.start_time || a.basic_info?.start_time || '')))
                return { ...first, list: unique, items: unique, page, total_page: Math.max(reportedPages, Math.ceil(unique.length / Math.max(1, limit))) }
            }
        default: throw new Error('未知赛事操作')
    }
}
