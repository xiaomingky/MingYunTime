import assert from 'node:assert/strict'
import { interpolationSample } from '../src/utils/video-enhancement.js'

let last = -1, checks = 0
// Alternate early/late delivery times as Chromium does under load. The
// displayed media time must never return to an already displayed instant.
for (let frame = 1; frame <= 120; frame++) {
    const previous = (frame - 1) / 30, current = frame / 30
    const presentation = frame * 1000 / 30 + (frame % 2 ? -8 : 8)
    for (const offset of [-4, 3, 10, 18, 27, 35]) {
        const sample = interpolationSample(presentation + offset,presentation,previous,current,1,last)
        assert.ok(sample.mediaTime >= last && sample.mediaTime <= current)
        assert.ok(sample.fraction >= 0 && sample.fraction <= 1)
        last = sample.mediaTime; checks += 2
    }
}
assert.equal(interpolationSample(1010,1000,0,.04,2,-1).fraction,.5); checks++
assert.equal(interpolationSample(1010,1000,0,.04,.5,-1).fraction,.125); checks++
assert.equal(interpolationSample(1003,1000,0,.04,1,.03).fraction,.75); checks++
assert.equal(interpolationSample(990,1000,0,.04,1,-1).fraction,0); checks++
console.log(`Interpolation timing: ${checks} assertions passed (callback jitter, monotonic time, 0.5x/2x speed).`)
