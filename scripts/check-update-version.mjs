import assert from 'node:assert/strict'
import { isNewerVersion } from '../electron/version.js'
const cases = [
    ['v3.6.3','4.0.0-beta.2',false],
    ['4.0.0','4.0.0-beta.2',true],
    ['4.0.0-beta.10','4.0.0-beta.2',true],
    ['4.0.0-beta.2','4.0.0',false],
    ['4.0.1','4.0.0',true],
    ['4.0.0+next','4.0.0+local',false],
    ['4.0.0-alpha','4.0.0-1',true],
    ['4.0.0-alpha.1','4.0.0-alpha',true],
    ['4.0.0-alpha','4.0.0-alpha.1',false],
    ['v4.0.0','4.0.0',false],
    ['garbage','4.0.0',false],
    ['4.0.0-beta.01','4.0.0-beta.1',false]
]
for (const [candidate,current,expected] of cases) assert.equal(isNewerVersion(candidate,current),expected,`${candidate} vs ${current}`)
console.log(`Update version checks passed: ${cases.length} cases.`)
