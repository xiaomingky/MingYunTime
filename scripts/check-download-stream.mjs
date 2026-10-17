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
import {responseDownloadName} from '../electron/download-resolver.js'

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
    if (ranged && request.url !== '/hidden-range') response.setHeader('Accept-Ranges', 'bytes')
    if (request.method === 'HEAD') { response.end(); return }
    requests++
    const match = request.headers.range?.match(/bytes=(\d+)-(\d+)/)
    if (ranged && match) {
        const from = Number(match[1]), to = Number(match[2])
        const rangeStart = request.url === '/wrong-range' ? from + 1 : from
        response.writeHead(206, { 'Content-Length': to - from + 1, 'Content-Range': `bytes ${rangeStart}-${to}/${payload.length}` })
        if (request.url === '/slow') {
            response.write(payload.subarray(from, Math.min(to + 1, from + 4096)))
            setTimeout(() => response.end(payload.subarray(Math.min(to + 1, from + 4096), to + 1)), 80)
        } else response.end(payload.subarray(from, to + 1))
    } else response.end(payload)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const httpsAgent = new https.Agent({ keepAlive: true })
const httpAgent = new http.Agent({ keepAlive: true })
try {
    const context = vm.createContext({ axios, fs, path, Transform, pipeline, finished, once, httpsAgent, httpAgent, AbortController, Date, setTimeout, console, DEFAULT_UA: 'test', responseDownloadName })
    vm.runInContext(code + '\n globalThis.download = downloadFileMultithread', context)
    for (const [endpoint, customThreads, expected] of [['plain', 128, 1], ['hidden-range', 32, 33], ['range', 32, 32], ['range', 64, 64], ['range', 128, 128], ['range', 8, 32], ['range', 0, 32]]) {
        requests = 0
        const output = path.join(dir, endpoint)
        const result = await context.download(`http://127.0.0.1:${server.address().port}/${endpoint}`, output, '', () => {}, {customThreads})
        assert.ok((await fsp.readFile(result.path)).equals(payload), `${endpoint} download integrity`)
        assert.equal(requests, expected, `actual part requests match selected ${customThreads} connections`)
    }
    const resumedState={customThreads:32}, resumedPath=path.join(dir,'resumed')
    let paused=false
    const first=await context.download(`http://127.0.0.1:${server.address().port}/slow`,resumedPath,'',received=>{
        if(!paused && received>0){paused=true;resumedState.paused=true;resumedState.abortAll()}
    },resumedState)
    assert.equal(first.paused,true,'pause stops active requests and preserves parts')
    resumedState.paused=false
    const resumed=await context.download(`http://127.0.0.1:${server.address().port}/slow`,resumedPath,'',()=>{},resumedState)
    assert.ok((await fsp.readFile(resumed.path)).equals(payload),'resumed partial ranges merge without gaps or duplicates')
    await assert.rejects(context.download(`http://127.0.0.1:${server.address().port}/wrong-range`, path.join(dir, 'wrong-range'), '', () => {}, {}), /分片范围不匹配/)
    console.log('Download checks passed: actual 32/64/128 ranges, hidden Range support, default32/min32, byte integrity, pause/resume, single-response fallback, mismatched range rejection.')
} finally { server.close(); httpsAgent.destroy(); httpAgent.destroy(); await fsp.rm(dir, { recursive: true }) }
