// Read-only public probes. No account cookies, QR tokens or signed media URLs are logged.
import assert from 'node:assert/strict'
import axios from 'axios'
import { writeFileSync, mkdirSync } from 'node:fs'
import { QishuiClient } from '../electron/qishui-client.js'
import { createQishuiRuntime } from '../electron/qishui-runtime.js'
import path from 'node:path'

const requests = []
const request = async config => {
    const response = await axios(config)
    const url = new URL(config.url)
    requests.push({ origin: url.origin, path: url.pathname, status: response.status,
        emptyResponse: response.data === '', ...(url.pathname.includes('get_qrcode') ? {} : {
            businessCode: response.data?.status_code ?? response.data?.status_info?.status_code ?? null }) })
    return response
}
const runtime = createQishuiRuntime({ root: process.cwd(), userData: path.resolve('dev/qishui-search-probe-profile'), request })
const client = new QishuiClient({ request, pcRequest: runtime.pcRequest })
let result, second
try {
    result = await client.search('周杰伦')
    assert.ok(result.scope === 'platform' && result.songs.length > 0, 'fresh process full catalog search must work without opening playlists')
    assert.ok(result.hasMore && result.cursor, 'real server offers next page')
    second = await client.search('周杰伦', result.cursor)
    assert.ok(second.songs.length > 0 && second.songs.some(song => !result.songs.some(first => first.id === song.id)), 'real second page must provide additional songs')
} finally { runtime.close() }
const report = { timestamp: new Date().toISOString(), source: 'public unauthenticated official endpoints',
    search: { query: '周杰伦', scope: result.scope, resultCount: result.songs.length, cursor: result.cursor,
        secondPageCount: second.songs.length, firstTrack: { id: result.songs[0].id, name: result.songs[0].name, artist: result.songs[0].artist },
        firstTrackCoverPresent: !!result.songs[0].picUrl, signatureProvider: 'official native bdms.node' }, requests }
mkdirSync('dev', { recursive: true })
writeFileSync('dev/qishui-search-login-live.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
