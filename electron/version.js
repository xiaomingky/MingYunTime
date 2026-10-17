function parse(version) {
    const match = String(version || '').trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
    if (!match) return null
    const pre = match[4]?.split('.') || []
    if (pre.some(part => /^0\d+$/.test(part))) return null
    return { core:match.slice(1,4).map(BigInt), pre }
}

export function isNewerVersion(candidate, current) {
    const next = parse(candidate), installed = parse(current)
    if (!next || !installed) return false
    for (let i = 0; i < 3; i++) {
        if (next.core[i] !== installed.core[i]) return next.core[i] > installed.core[i]
    }
    if (!next.pre.length || !installed.pre.length) return !next.pre.length && !!installed.pre.length
    for (let i = 0; i < Math.max(next.pre.length,installed.pre.length); i++) {
        const a = next.pre[i], b = installed.pre[i]
        if (a === b) continue
        if (a === undefined || b === undefined) return b === undefined
        const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b)
        if (numericA && numericB) return BigInt(a) > BigInt(b)
        if (numericA !== numericB) return numericB
        return a > b
    }
    return false
}
