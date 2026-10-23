import assert from 'node:assert/strict'
import { installMediaLoadWatchdog } from '../src/utils/media-load-watchdog.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 8))
let time = 0, errors = []
class Media extends EventTarget { readyState = 0; currentTime = 0; paused = false; ended = false; seeking = false }
function setup(video = new Media()) { time = 0; errors = []; return { video, stop: installMediaLoadWatchdog(video, message => errors.push(message), { timeoutMs: 100, intervalMs: 2, now: () => time }) } }
{
  const { stop } = setup(); time = 101; await tick(); assert.match(errors[0], /未能/); await tick(); assert.equal(errors.length, 1, 'timeouts are emitted once'); stop()
}
{
  const { video, stop } = setup(); video.readyState = 2; video.dispatchEvent(new Event('loadeddata')); video.paused = true; time = 500; await tick(); assert.equal(errors.length, 0, 'a loaded, deliberately paused video does not fail'); stop()
}
{
  const { video, stop } = setup(); video.dispatchEvent(new Event('playing')); time = 80; video.currentTime = 1; await tick(); time = 170; video.currentTime = 2; await tick(); assert.equal(errors.length, 0, 'actual playback progress keeps the watchdog alive'); time = 271; await tick(); assert.match(errors[0], /缓冲超时/); stop()
}
{
  const { video, stop } = setup(); video.dispatchEvent(new Event('playing')); time = 50; video.seeking = true; video.dispatchEvent(new Event('seeking')); time = 151; await tick(); assert.equal(errors.length, 1, 'stuck seeks also terminate'); stop()
}
{
  const { stop } = setup(); stop(); time = 1000; await tick(); assert.equal(errors.length, 0, 'destroyed players cannot surface stale timeout errors')
}
console.log('Media load watchdog: 7 assertions passed')
