import { createDecipheriv } from 'node:crypto'

// ISO BMFF Common Encryption, cenc (AES-CTR). Keep the original sample tables
// and media offsets: remuxing these files with the bundled FFmpeg corrupts AAC.
export function decryptQishuiCenc(input, key) {
    if (!/^[a-f\d]{32}$/i.test(key)) throw new Error('汽水音频密钥格式无效')
    const data = Buffer.from(input)
    const invalid = () => { throw new Error('汽水加密音频结构无效，请重新获取歌曲') }
    function boxes(start, end) {
        const list = []
        for (let p = start; p < end;) {
            if (p + 8 > end) invalid()
            let size = data.readUInt32BE(p), header = 8
            if (size === 1) {
                if (p + 16 > end) invalid()
                const large = data.readBigUInt64BE(p + 8)
                if (large > BigInt(Number.MAX_SAFE_INTEGER)) invalid()
                size = Number(large); header = 16
            } else if (size === 0) size = end - p
            if (size < header || p + size > end) invalid()
            list.push({ p, start: p + header, end: p + size, type: data.toString('ascii', p + 4, p + 8) })
            p += size
        }
        return list
    }
    const children = box => boxes(box.start, box.end)
    const find = (list, type) => list.find(b => b.type === type)
    const requireBox = (list, type) => find(list, type) || invalid()
    const need = (box, offset, size) => { if (offset < box.start || offset + size > box.end) invalid() }
    const root = boxes(0, data.length), moov = requireBox(root, 'moov'), mdats = root.filter(b => b.type === 'mdat')
    if (find(root, 'moof') || !mdats.length) invalid()
    const tracks = children(moov).filter(b => b.type === 'trak')
    // Playback selects one audio-only resource. Reject unsupported containers
    // instead of handing an encrypted or partially decrypted file to Chromium.
    if (tracks.length !== 1) invalid()
    const mdia = requireBox(children(tracks[0]), 'mdia'), minf = requireBox(children(mdia), 'minf')
    const table = children(requireBox(children(minf), 'stbl')), stsd = requireBox(table, 'stsd')
    need(stsd, stsd.start, 8)
    const entries = boxes(stsd.start + 8, stsd.end), entry = requireBox(entries, 'enca')
    if (entries.length !== 1 || data.readUInt32BE(stsd.start + 4) !== 1) invalid()
    need(entry, entry.start, 28)
    if (data.readUInt16BE(entry.start + 8) !== 0) invalid()
    const sinf = requireBox(boxes(entry.start + 28, entry.end), 'sinf'), encryption = children(sinf)
    const frma = requireBox(encryption, 'frma'), schm = requireBox(encryption, 'schm')
    need(frma, frma.start, 4); need(schm, schm.start, 8)
    const format = data.toString('ascii', frma.start, frma.start + 4)
    if (!['mp4a', 'fLaC'].includes(format) || data.toString('ascii', schm.start + 4, schm.start + 8) !== 'cenc') invalid()
    const tenc = requireBox(children(requireBox(encryption, 'schi')), 'tenc')
    need(tenc, tenc.start, 24)
    const ivSize = data[tenc.start + 7]
    if (data[tenc.start] !== 0 || data[tenc.start + 6] !== 1 || ![8, 16].includes(ivSize)) invalid()
    const stsz = requireBox(table, 'stsz'), stsc = requireBox(table, 'stsc'), offsets = find(table, 'stco') || requireBox(table, 'co64'), senc = requireBox(table, 'senc')
    need(stsz, stsz.start, 12); need(stsc, stsc.start, 8); need(offsets, offsets.start, 8); need(senc, senc.start, 8)
    const count = data.readUInt32BE(stsz.start + 8), fixed = data.readUInt32BE(stsz.start + 4)
    const chunkCount = data.readUInt32BE(offsets.start + 4), mapCount = data.readUInt32BE(stsc.start + 4)
    const flags = data.readUIntBE(senc.start + 1, 3)
    if (!count || count > 4 * 1024 * 1024 || chunkCount > count || !chunkCount || !mapCount || mapCount > chunkCount || (flags & ~2) || data[senc.start] !== 0 || data.readUInt32BE(senc.start + 4) !== count) invalid()
    if (!fixed) need(stsz, stsz.start + 12, count * 4)
    need(stsc, stsc.start + 8, mapCount * 12)
    const width = offsets.type === 'co64' ? 8 : 4
    need(offsets, offsets.start + 8, chunkCount * width)
    const mapping = []
    for (let i = 0; i < mapCount; i++) {
        const p = stsc.start + 8 + i * 12, first = data.readUInt32BE(p), samples = data.readUInt32BE(p + 4)
        if ((i === 0 && first !== 1) || (i && first <= mapping[i - 1].first) || first > chunkCount || !samples || samples > count || data.readUInt32BE(p + 8) !== 1) invalid()
        mapping.push({ first, samples })
    }
    const aesKey = Buffer.from(key, 'hex')
    let sample = 0, mapIndex = 0, aux = senc.start + 8
    for (let chunk = 1; chunk <= chunkCount; chunk++) {
        while (mapIndex + 1 < mapping.length && mapping[mapIndex + 1].first <= chunk) mapIndex++
        const p = offsets.start + 8 + (chunk - 1) * width
        const value = width === 8 ? data.readBigUInt64BE(p) : BigInt(data.readUInt32BE(p))
        if (value > BigInt(data.length)) invalid()
        let position = Number(value)
        for (let j = 0; j < mapping[mapIndex].samples; j++, sample++) {
            if (sample >= count) invalid()
            const size = fixed || data.readUInt32BE(stsz.start + 12 + sample * 4)
            if (!mdats.some(m => position >= m.start && position + size <= m.end)) invalid()
            need(senc, aux, ivSize)
            const iv = Buffer.alloc(16); data.copy(iv, 0, aux, aux + ivSize); aux += ivSize
            const cipher = createDecipheriv('aes-128-ctr', aesKey, iv)
            if (flags & 2) {
                need(senc, aux, 2)
                const subs = data.readUInt16BE(aux); aux += 2
                need(senc, aux, subs * 6)
                let cursor = position
                for (let k = 0; k < subs; k++) {
                    const clear = data.readUInt16BE(aux), encrypted = data.readUInt32BE(aux + 2); aux += 6
                    cursor += clear
                    if (cursor + encrypted > position + size) invalid()
                    cipher.update(data.subarray(cursor, cursor + encrypted)).copy(data, cursor)
                    cursor += encrypted
                }
            } else cipher.update(data.subarray(position, position + size)).copy(data, position)
            cipher.final()
            position += size
        }
    }
    if (sample !== count || aux !== senc.end) invalid()
    data.write(format, entry.p + 4, 4, 'ascii')
    // Padding keeps all chunk offsets valid and prevents double decryption.
    for (const box of [sinf, ...table.filter(b => ['senc', 'saiz', 'saio'].includes(b.type))]) data.write('free', box.p + 4, 4, 'ascii')
    return data
}
