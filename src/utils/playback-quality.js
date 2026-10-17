// Quality names belong to each provider. Numeric QQ/Kugou values and Qishui's
// "platform" value must never be sent as a NetEase level in a mixed queue.
const neteaseLevels = new Set(['standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect'])
export function neteasePlaybackLevels(current, stored) {
    const selected = neteaseLevels.has(current) ? current : neteaseLevels.has(stored) ? stored : 'standard'
    return [...new Set(['jyeffect', 'hires', 'lossless'].includes(selected)
        ? [selected, 'lossless', 'exhigh', 'standard'] : [selected])]
}

// Describe the granted stream, never the quality that was merely requested.
export function neteaseStreamInfo(data = {}) {
    const codec = String(data.type || '').toLowerCase()
    const bitrate = Number(data.br) || 0
    const sampleRate = Number(data.sampleRate) || 0
    const lossless = ['flac', 'alac', 'ape'].includes(codec)
    const quality = lossless
        ? (sampleRate > 48000 || data.level === 'hires' ? 'hires' : data.level === 'jyeffect' ? 'jyeffect' : 'lossless')
        : bitrate > 0 ? (bitrate >= 256000 ? 'exhigh' : bitrate >= 160000 ? 'higher' : 'standard') : 'unknown'
    return { quality, codec, bitrate, sampleRate }
}

export function qqStreamInfo(purl = '') {
    const file = String(purl).split('?')[0].split('/').pop()
    const formats = { M500: ['128', 'mp3'], M800: ['320', 'mp3'], C400: ['m4a', 'aac'], F000: ['flac', 'flac'], A000: ['ape', 'ape'] }
    const match = /^(M500|M800|C400|F000|A000).+\.(mp3|m4a|flac|ape)$/i.exec(file)
    const info = match && formats[match[1].toUpperCase()]
    const expected = { mp3: 'mp3', aac: 'm4a', flac: 'flac', ape: 'ape' }
    return info && expected[info[1]] === match[2].toLowerCase()
        ? { quality: info[0], codec: info[1] } : { quality: 'unknown', codec: '' }
}

export function kugouStreamInfo(data = {}) {
    const codec = String(data.extName || data.extname || '').toLowerCase()
    const raw = Number(data.bitRate || data.bitrate) || 0
    const bitrate = raw > 10000 ? raw : raw * 1000
    const sampleRate = Number(data.sampleRate || data.sample_rate) || 0
    const quality = /^(flac|ape|alac)$/.test(codec) ? (sampleRate > 48000 ? 'high' : 'flac')
        : bitrate >= 256000 ? '320' : bitrate > 0 ? '128' : 'unknown'
    return { quality, codec, bitrate, sampleRate }
}
