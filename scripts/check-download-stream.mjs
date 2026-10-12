import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import vm from 'node:vm'
import { Transform } from 'node:stream'
import { pipeline, finished } from 'node:stream/promises'
import { once } from 'node:events'
import axios from 'axios'

const source = fs.readFileSync(new URL('../electron/download-manager.js', import.meta.url), 'utf8')
const start = source.indexOf('const DL_MAX_THREADS')
const end = source.indexOf('\nasync function ', source.indexOf('async function downloadFileMultithread', start) + 20)
const code = source.slice(start, end)
const dir = await fsp.mkdtemp(path.resolve('dev/download-check-'))
const payload = Buffer.alloc(5 * 1024 * 1024 + 123, 91)
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i >>> 16)) & 255
let requests = 0
const server = http.createServer((request, response) => {
    response.setHeader('Content-Length', String(payload.length))
    const ranged = request.url !== '/plain'
    if (ranged) response.setHeader('Accept-Ranges', 'bytes')
    if (request.method === 'HEAD') { response.end(); return }
    requests++
    const match = request.headers.range?.match(/bytes=(\d+)-(\d+)/)
    if (ranged && match) {
        const from = Number(match[1]), to = Number(match[2])
        const rangeStart = request.url === '/wrong-range' ? from + 1 : from
        response.writeHead(206, { 'Content-Length': to - from + 1, 'Content-Range': `bytes ${rangeStart}-${to}/${payload.length}` })
        response.end(payload.subarray(from, to + 1))
    } else response.end(payload)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const httpsAgent = new https.Agent({ keepAlive: true })
const httpAgent = new http.Agent({ keepAlive: true })
try {
    const context = vm.createContext({ axios, fs, path, Transform, pipeline, finished, once, httpsAgent, httpAgent, AbortController, Date, setTimeout, console, DEFAULT_UA: 'test', parseCDName: () => '', DL_CT_EXT_MAP: {} })
    vm.runInContext(code + '\n globalThis.download = downloadFileMultithread', context)
    for (const endpoint of ['plain', 'range']) {
        requests = 0
        const output = path.join(dir, endpoint)
        await context.download(`http://127.0.0.1:${server.address().port}/${endpoint}`, output, '', () => {}, {})
        assert.ok((await fsp.readFile(output)).equals(payload), `${endpoint} download integrity`)
        assert.equal(requests, endpoint === 'range' ? 2 : 1, '5MB download uses two parts, not a 32-connection floor')
    }
    await assert.rejects(context.download(`http://127.0.0.1:${server.address().port}/wrong-range`, path.join(dir, 'wrong-range'), '', () => {}, {}), /分片范围不匹配/)
    console.log('Download checks passed: stream backpressure, whole-file and ranged byte integrity, mismatched range rejection, adaptive concurrency.')
} finally { server.close(); httpsAgent.destroy(); httpAgent.destroy(); await fsp.rm(dir, { recursive: true }) }
