import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { neteasePlaybackLevels } from '../src/utils/playback-quality.js'

assert.deepEqual(neteasePlaybackLevels('128', null), ['standard'])
assert.deepEqual(neteasePlaybackLevels('platform', 'exhigh'), ['exhigh'])
assert.deepEqual(neteasePlaybackLevels('flac', 'hires'), ['hires', 'lossless', 'exhigh', 'standard'])
assert.deepEqual(neteasePlaybackLevels('lossless', 'standard'), ['lossless', 'exhigh', 'standard'])
assert.deepEqual(neteasePlaybackLevels('higher', 'hires'), ['higher'])
assert.deepEqual(neteasePlaybackLevels('320', '128'), ['standard'])

const source = fs.readFileSync(new URL('../src/store/player.js', import.meta.url), 'utf8')
const start = source.indexOf('    actions: {') + '    actions: '.length
let timer, cleared = 0
const ctx = vm.createContext({ setTimeout(fn) { timer = fn; return 1 }, clearTimeout() { cleared++ } })
vm.runInContext(`globalThis.actions = (${source.slice(start, source.lastIndexOf('\n})')).trim().replace(/,$/, '')})`, ctx)
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(play) {
    const listeners = new Map()
    const audio = { paused:true, play, pauses:0, pause() { this.paused=true; this.pauses++ },
        addEventListener(n, fn) { listeners.set(n, fn) }, removeEventListener(n) { listeners.delete(n) } }
    const store = { audio, _playRequestId:1, playbackRate:1, _applyVolume() {}, async _resumeAudioContexts() {} }
    return { audio, store, listeners, run:() => ctx.actions._startAudioPlayback.call(store,audio,1) }
}
let f = fixture(async function() { this.paused=false })
assert.equal(await f.run(), true)
assert.equal(f.store.isPlaying, true)
assert.equal(f.listeners.size, 0)
f = fixture(() => new Promise(() => {}))
let result = f.run(); await tick(); timer()
await assert.rejects(result, /超时/)
assert.equal(f.audio.pauses, 1)
assert.equal(f.listeners.size, 0)
f = fixture(() => new Promise(() => {}))
result = f.run(); await tick(); f.listeners.get('error')()
await assert.rejects(result, /解码/)
assert.equal(f.listeners.size, 0)
f = fixture(() => new Promise(() => {}))
result = f.run(); await tick(); f.store._playRequestId++; timer()
await assert.rejects(result, /超时/)
assert.equal(f.audio.pauses, 0, 'an old request must not pause the new song')
assert.equal(f.listeners.size, 0)
assert.equal(cleared, 4)
console.log('Playback startup checks passed: provider quality selection, timeout, decoder error and stale request cleanup.')
