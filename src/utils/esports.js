export const gameName = game => game === 'val' ? 'VAL' : 'CS'
export const localDate = (value = new Date()) => {
    const d = new Date(value)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const itemsOf = value => Array.isArray(value) ? value : value?.items || value?.list || []
export const matchInfo = item => item?.mc_info || item || {}
export const matchState = item => item?.global_state || item?.state || {}
export const teamName = team => team?.disp_name || team?.name || team?.abbr || 'TBD'
export const statusText = status => ({ '0': '未开始', '1': '进行中', '2': '已结束', '-1': '待定', live: '进行中', upcoming: '未开始', past: '已结束' }[String(status)] || '待定')
export function matchTime(value, full = false) {
    if (!value) return '--'
    const d = new Date(/^\d+$/.test(String(value)) ? Number(value) * 1000 : String(value).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return '--'
    return `${full ? `${localDate(d)} ` : ''}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const score = value => value === '' || value === undefined || value === null ? '-' : value
export function uniqueMatches(rows) {
    return [...new Map(rows.filter(row => matchInfo(row).id).map(row => [matchInfo(row).id, row])).values()]
}
export function parseLog(row) {
    let info = row.log_info
    if (typeof info === 'string') { try { info = JSON.parse(info) } catch { info = {} } }
    info ||= {}
    const type = String(info.type || '')
    const name = v => v?.player_nick || v?.player_name || '选手'
    let text = ''
    switch (type) {
        case '1': text = `第 ${info.round_start?.round_num || '?'} 回合开始`; break
        case '2': {
            const e = info.round_end || {}
            text = `${e.winner || '一方'} 赢得回合 · CT ${score(e.ct_score)} : ${score(e.t_score)} T`
            break
        }
        case '3': text = `${name(info.player_join)} 加入比赛`; break
        case '4': text = `${name(info.player_quit)} 离开比赛`; break
        case '5': text = '比赛开始'; break
        case '6': text = `${name(info.bomb_planted)} 在 ${info.bomb_planted?.bomb_site || '?'} 点安放${row.match_id?.startsWith('val') ? '爆能器' : '炸弹'}`; break
        case '7': text = `${info.assist?.assister_nick || info.assist?.assister_name || '选手'} 助攻击杀 ${info.assist?.victim_nick || info.assist?.victim_name || '对手'}`; break
        case '8': {
            const e = info.kill || {}
            text = `${e.killer_nick || e.killer_name || '选手'} ${e.head_shot ? '爆头击杀' : '击杀'} ${e.victim_nick || e.victim_name || '对手'}${e.weapon ? ` · ${e.weapon}` : ''}`
            break
        }
        case '9': text = `${name(info.bomb_defused)} 完成拆除`; break
        case '10': text = `${name(info.suicide)} 自杀`; break
        default: text = typeof info.other === 'string' ? info.other : row.text || '比赛事件'
    }
    const version = String(row.update_version || info.update_version || '0')
    return { ...row, info, type, text, version, key: `${row.bout_id || row.bout_num || ''}:${version}:${type}:${info.kill?.event_id || ''}`, weaponLogo: info.kill?.weapon_logo || '' }
}
export function mergeLogs(current, incoming, max = 600) {
    return [...new Map([...current, ...incoming.map(parseLog)].map(row => [row.key, row])).values()]
        .sort((a, b) => Number(b.version) - Number(a.version)).slice(0, max)
}

function decodeBase64(value) {
    let encoded = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
    encoded += '='.repeat((4 - encoded.length % 4) % 4)
    try {
        if (typeof atob === 'function') {
            const binary = atob(encoded)
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
            return typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : binary
        }
        if (typeof Buffer !== 'undefined') return Buffer.from(encoded, 'base64').toString('utf8')
    } catch {
        return ''
    }
    return ''
}

function embeddedPlaybackUrl(value) {
    let parsed
    try { parsed = new URL(value) } catch { return '' }
    if (!/\/video_app_common\/?$/i.test(parsed.pathname)) return ''
    const encoded = parsed.searchParams.get('video')
    if (!encoded) return ''
    const html = decodeBase64(encoded)
    const match = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
    if (!match) return ''
    try {
        const iframe = new URL(match[1].replace(/&amp;/g, '&'), parsed.origin).toString()
        return /^https:\/\//i.test(iframe) ? iframe : ''
    } catch {
        return ''
    }
}

export function playbackSources(info) {
    const sources = []
    for (const [kind, rows] of [['live', info?.live_cfg_list], ['replay', info?.high_lights_cfg_list]]) {
        for (const row of rows || []) {
            const url = row.url || row.origin_video
            if (!/^https?:\/\//i.test(url || '')) continue
            const clean = url.replace('{DispMod}', '1')
            const embedded = embeddedPlaybackUrl(clean)
            const playable = embedded || clean
            const type = /\.m3u8(?:[?#]|$)/i.test(playable) ? 'm3u8' : /\.flv(?:[?#]|$)/i.test(playable) ? 'flv' : /\.(mp4|webm)(?:[?#]|$)/i.test(playable) ? 'direct' : 'iframe'
            sources.push({ name: row.name || (kind === 'live' ? '直播' : '回放'), url: playable, external: /^https?:\/\//i.test(row.third_url || '') ? row.third_url : clean, kind, type })
        }
    }
    return sources
}

function parseGraph(value) {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return null }
}

function bracketTeam(team) {
    const row = team || {}
    return {
        ...row,
        id: row.absId || row.id || '',
        name: row.nameZh || row.nameEn || row.abbrZh || row.abbrEn || row.name || 'TBD',
        shortName: row.abbrZh || row.abbrEn || row.nameZh || row.nameEn || row.name || 'TBD',
        logo: row.logo || '',
        TBD: Boolean(row.TBD) || /^(tbd|待定)$/i.test(String(row.nameZh || row.nameEn || row.abbrEn || '')),
        fromMatchId: row.fromMatchId || ''
    }
}

function bracketMatch(value) {
    if (!value?.t1 || !value.t2) return null
    const t1 = bracketTeam(value.t1), t2 = bracketTeam(value.t2)
    return {
        id: String(value.absId || ''),
        status: value.status || 'upcoming',
        result: value.result || '',
        format: value.format || '',
        planTs: value.planTs || value.plan_ts || '',
        t1Score: value.t1Score ?? value.t1_score ?? '',
        t2Score: value.t2Score ?? value.t2_score ?? '',
        graphId: value.graphId || '',
        roundNum: value.roundNum,
        rect: value.rect || {},
        t1,
        t2,
        row: {
            mc_info: {
                id: String(value.absId || ''),
                format: value.format || '',
                plan_ts: value.planTs || value.plan_ts || '',
                round_name: value.roundName || '',
                t1_info: { ...t1, disp_name: t1.name },
                t2_info: { ...t2, disp_name: t2.name }
            },
            state: {
                status: value.status || 'upcoming',
                t1_score: value.t1Score ?? value.t1_score ?? '',
                t2_score: value.t2Score ?? value.t2_score ?? ''
            }
        }
    }
}

const swissRecords = {
    r1: { groupAll: [0, 0] },
    r2: { groupHigh: [1, 0], groupLow: [0, 1] },
    r3: { groupHigh: [2, 0], groupMid: [1, 1], groupLow: [0, 2] },
    r4: { groupHigh: [2, 1], groupLow: [1, 2] },
    r5: { groupAll: [2, 2] }
}

function parseSwiss(swiss) {
    const columns = [], rounds = [], links = []
    const outcome = (source, wins, losses, side) => {
        const state = wins === 3 ? 'advanced' : 'eliminated'
        const teams = source.matches.map(match => {
            if (match.status !== 'past' || !['t1', 't2'].includes(match.result)) return bracketTeam({ TBD: true })
            const winner = match.result
            return match[side === 'winner' ? winner : winner === 't1' ? 't2' : 't1']
        })
        return { key: `result-${wins}-${losses}`, name: `${wins}-${losses}`, record: [wins, losses], state, teams, matches: [] }
    }
    for (const [roundKey, node] of Object.entries(swiss).filter(([key]) => /^r\d+$/.test(key)).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))) {
        const groups = Object.entries(node).filter(([key, group]) => key.startsWith('group') && Array.isArray(group?.matches))
            .map(([key, group]) => {
                const record = swissRecords[roundKey]?.[key]
                const matches = group.matches.map(bracketMatch).filter(Boolean)
                const name = group.name || (record ? record.join('-') : key)
                return { key: `${roundKey}-${key}`, name, record, matches, teams: [], state: 'playing' }
            }).filter(group => group.matches.length).sort((a, b) => (b.record?.[0] || 0) - (a.record?.[0] || 0))
        if (!groups.length) continue
        rounds.push(...groups)
        const previous = columns.at(-1)?.groups || []
        for (const source of previous.filter(group => group.state === 'playing' && group.record)) {
            const [wins, losses] = source.record
            if (wins === 2) groups.unshift(outcome(source, 3, losses, 'winner'))
            if (losses === 2) groups.push(outcome(source, wins, 3, 'loser'))
        }
        columns.push({ key: roundKey, name: node.basic?.name || `第 ${Number(roundKey.slice(1))} 轮`, groups })
    }
    const last = columns.at(-1)
    if (last?.groups.some(group => group.state === 'playing' && group.record?.join('-') === '2-2')) {
        const source = last.groups.find(group => group.state === 'playing')
        columns.push({ key: 'results', name: '最终晋级 / 淘汰', groups: [outcome(source, 3, 2, 'winner'), outcome(source, 2, 3, 'loser')] })
    }
    for (let index = 0; index < columns.length - 1; index++) {
        for (const source of columns[index].groups.filter(group => group.state === 'playing' && group.record)) {
            const [wins, losses] = source.record
            for (const target of columns[index + 1].groups) {
                if (!target.record) continue
                if ((target.record[0] === wins + 1 && target.record[1] === losses) || (target.record[0] === wins && target.record[1] === losses + 1)) {
                    links.push({ from: source.key, to: target.key, state: target.state })
                }
            }
        }
    }
    return columns.length ? { name: '瑞士轮', type: 'swiss', columns, rounds, links } : null
}

function bracketLabel(key, node, fallback = '对阵') {
    const basic = node?.basic || node?.EB?.basic
    if (basic?.name) return basic.name
    return ({ mrb: '小组赛', sEB: '单败淘汰赛', dEB: '双败淘汰赛', upperEB: '胜者组', lowerEB: '败者组', EB: '淘汰赛' }[key] || fallback)
}

function graphSections(graph) {
    const sections = [], seen = new Set()
    const visit = (node, label = '对阵', key = '') => {
        if (!node || typeof node !== 'object') return
        if (node.swiss && !seen.has(node.swiss)) {
            seen.add(node.swiss)
            const section = parseSwiss(node.swiss)
            if (section) sections.push(section)
        }
        if (Array.isArray(node.rounds) && !seen.has(node.rounds)) {
            const rounds = node.rounds.map((round, index) => {
                const matches = (Array.isArray(round?.matches) ? round.matches : []).map(bracketMatch).filter(Boolean)
                return { name: round?.basic?.name || round?.name || `第 ${index + 1} 轮`, matches, rect: round?.rect || {} }
            }).filter(round => round.matches.length)
            if (rounds.length) {
                seen.add(node.rounds)
                sections.push({ name: label, type: 'elimination', rounds })
            }
        }
        for (const [childKey, child] of Object.entries(node)) {
            if (!child || typeof child !== 'object' || ['rounds', 'matches', 'swiss', 'curRankList', 'rect'].includes(childKey)) continue
            const childLabel = ['mrb', 'sEB', 'dEB', 'upperEB', 'lowerEB', 'EB'].includes(childKey)
                ? bracketLabel(childKey, child, label)
                : label
            visit(child, childLabel, childKey)
        }
    }
    visit(graph)
    return sections
}

export function stageBrackets(stages) {
    const brackets = []
    for (const stage of itemsOf(stages)) {
        for (const group of stage.groups || []) {
            const graph = parseGraph(group.graph)
            const sections = graphSections(graph)
            if (!sections.length) continue
            brackets.push({
                key: `${stage.stageInfo?.id || stage.id || ''}-${group.id || brackets.length}`,
                stageName: (stage.stageInfo?.name || stage.name || stage.stage_name || '赛段').trim(),
                description: stage.stageInfo?.desc || '',
                name: `${stage.stageInfo?.name || stage.name || stage.stage_name || '赛段'} · ${group.name || group.group_name || '对阵'}`,
                stageId: String(group.stageId || stage.stageInfo?.id || stage.id || ''),
                groupName: group.name || group.group_name || '对阵',
                sections,
                rounds: sections.flatMap(section => section.rounds.map(round => ({ ...round, name: sections.length > 1 ? `${section.name} · ${round.name}` : round.name })))
            })
        }
    }
    return brackets
}

export function stageMatches(stages) {
    return stageBrackets(stages).map(bracket => ({ name: bracket.name, matches: uniqueMatches(bracket.rounds.flatMap(round => round.matches.map(match => match.row))) }))
}
