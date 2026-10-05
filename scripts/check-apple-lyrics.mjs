import assert from 'node:assert/strict'
import { toAppleLyrics } from '../src/utils/apple-lyrics.js'

const lyrics = [{ time: 1.25, text: 'Hello world', ttext: 'Translation' }, { time: 4, text: 'Next line' }]
const yrcLyrics = [{ time: 1.25, duration: 1500, text: 'Hello world', ttext: 'Translation', words: [
  { startTime: 1250, duration: 650, text: 'Hello ' }, { startTime: 1900, duration: 850, text: 'world' }
] }]
const original = JSON.stringify({ lyrics, yrcLyrics })
const word = toAppleLyrics({ lyrics, yrcLyrics, duration: 10 })
assert.equal(word[0].startTime, 1250)
assert.equal(word[0].endTime, 2750)
assert.deepEqual(word[0].words[1], { word: 'world', startTime: 1900, endTime: 2750 })
assert.equal(word[0].translatedLyric, 'Translation')

const line = toAppleLyrics({ lyrics, yrcLyrics, mode: 'line', translation: false, duration: 10 })
assert.equal(line.length, 2)
assert.equal(line[0].words.length, 1)
assert.equal(line[0].endTime, 4000)
assert.equal(line[1].endTime, 10000)
assert.equal(line[0].translatedLyric, '')
assert.equal(JSON.stringify({ lyrics, yrcLyrics }), original, 'Apple conversion must not mutate classic lyrics')

const yrcFallback = toAppleLyrics({ yrcLyrics, mode: 'line' })
assert.equal(yrcFallback[0].words[0].word, 'Hello world')
assert.equal(yrcFallback[0].endTime, 2750)
const lrcFallback = toAppleLyrics({ lyrics, yrcLyrics: null })
assert.equal(lrcFallback.length, 2)
assert.equal(lrcFallback[0].words[0].word, 'Hello world')
assert.deepEqual(toAppleLyrics({ yrcLyrics: null }), [])
const sameTime = toAppleLyrics({ lyrics: [{ time: 0, text: 'A' }, { time: 0, text: 'B' }] })
assert.ok(sameTime[0].endTime > sameTime[0].startTime)
assert.ok(Number.isInteger(word[0].words[0].startTime))
const overlap = toAppleLyrics({ yrcLyrics: [
  { time: 0, duration: 20000, words: [{ text: 'Long line', startTime: 0, duration: 20000 }] },
  { time: 5, duration: 2000, words: [{ text: 'Next', startTime: 5000, duration: 2000 }] }
] })
assert.equal(overlap[0].endTime, 5000, 'A stale long word must not keep the preceding line active')
assert.equal(overlap[0].words[0].endTime, 5000)
console.log('PASS: YRC timing, line mode, translation, source immutability, YRC/LRC/empty fallbacks and positive durations')
