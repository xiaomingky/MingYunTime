import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { localFileResponse, createCoverHandler, parseByteRange } from '../electron/local-protocol.js'
import { queueEntries, queueWindow } from '../src/utils/queue-window.js'
import { lyricIndexAt, wordProgressAt } from '../src/utils/lyric-timing.js'
assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 })
assert.deepEqual(parseByteRange('bytes=2-99', 10), { start: 2, end: 9 })
for (const input of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-2,5-6', 'bytes=a-b']) assert.equal(parseByteRange(input, 10), false)
const dir = await fs.mkdtemp(path.resolve('dev', 'protocol-test-'))
try {
    const file = path.join(dir, '音乐 # 示例.wav')
    await fs.writeFile(file, Buffer.from('0123456789'))
    const url = `local-file:///${encodeURIComponent(file)}`
    const get = (range, method = 'GET') => localFileResponse(new Request(url, { method, headers: range ? { Range: range } : {} }))
    for (const [range, expected] of [[null, '0123456789'], ['bytes=2-4', '234'], ['bytes=7-', '789'], ['bytes=-3', '789'], ['bytes=0-99', '0123456789']]) {
        const response = await get(range)
        assert.equal(response.status, range ? 206 : 200)
        assert.equal(response.headers.get('content-length'), String(expected.length))
        assert.equal(await response.text(), expected)
    }
    const head = await get('bytes=2-4', 'HEAD')
    assert.equal(head.headers.get('content-length'), '3'); assert.equal(await head.text(), '')
    const invalid = await get('bytes=10-')
    assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */10')
    assert.equal((await localFileResponse(new Request('local-file:///%xx'))).status, 400)
    assert.equal((await localFileResponse(new Request(`local-file:///${encodeURIComponent(file + '.missing')}`))).status, 404)
    let parses = 0
    const covers = createCoverHandler({ metadata: async () => ({ parseFile: async () => { parses++; await new Promise(r => setImmediate(r)); return { common: { picture: [{ data: Buffer.from('cover'), format: 'image/png' }] } } } }), fallback: '' })
    const request = () => new Request(`song-cover:///${encodeURIComponent(file)}`)
    const results = await Promise.all(Array.from({ length: 20 }, () => covers.handle(request())))
    assert.equal(parses, 1, 'concurrent cover requests share metadata parsing')
    assert.equal(await results[0].text(), 'cover')
    await covers.handle(request()); assert.equal(parses, 1)
    covers.clear(); await covers.handle(request()); assert.equal(parses, 2)
} finally { await fs.rm(dir, { recursive: true }) }

const songs = Array.from({ length: 10000 }, (_, id) => ({ id, name: `Song ${id}`, queueItemId: `q${id}` }))
const layout = queueEntries(songs, 5000)
const window = queueWindow(layout.entries, 320000, 600)
assert.ok(window.length < 25, '10,000 tracks render only the visible rows plus overscan')
assert.ok(window.some(e => e.index === 5000))
assert.equal(new Set(layout.entries.map(e => e.key)).size, layout.entries.length)
const lines = [{ time: 0 }, { time: 1 }, { time: 1 }, { time: 5 }]
assert.equal(lyricIndexAt(lines, -1), -1)
assert.equal(lyricIndexAt(lines, 1), 2)
assert.equal(lyricIndexAt(lines, 99), 3)
assert.equal(lyricIndexAt([], 4), -1)
assert.equal(wordProgressAt(1000, 1000, 1800), .8)
assert.equal(wordProgressAt(1000, 1000, 1200), .2, 'seeking backwards restores partial word highlighting')
assert.equal(wordProgressAt(1000, 0, 1000), 1)
console.log('Modernization checks passed: streaming ranges/HEAD/404/416, cover dedup/cache, 10k queue, lyric timing and seek.')
