// Valve publishes standings as Markdown tables. Keep the official points and
// roster intact; third-party metadata only supplies images, never rank values.
export function parseVrsStandings(markdown) {
    return String(markdown).split(/\r?\n/).flatMap(line => {
        const cells = line.split('|').map(value => value.trim())
        if (!/^\d+$/.test(cells[1] || '') || !/^\d+$/.test(cells[2] || '') || !cells[3]) return []
        return [{ id: `vrs-${cells[1]}`, rank: Number(cells[1]), score: Number(cells[2]), name: cells[3], players: (cells[4] || '').split(',').map(name => ({ name: name.trim() })).filter(p => p.name) }]
    })
}

export function vrsTeamKey(name) {
    const key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return ({ navi: 'natusvincere', nip: 'ninjasinpyjamas', fazeclan: 'faze', betboomteam: 'betboom', mouzsports: 'mouz' })[key] || key
}

export function predictionPercent(value) {
    if (value == null || String(value).trim() === '') return null
    const numeric = Number(String(value).replace('%', ''))
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

export function vrsRank(value) {
    const rank = Number(value && typeof value === 'object' ? value.rank : value)
    return Number.isInteger(rank) && rank > 0 ? rank : '--'
}
