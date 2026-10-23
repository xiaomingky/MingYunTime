const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const configure = require('../dev/preview-window-visibility.cjs')
function simulate(url) {
    const actions = [], webContents = new EventEmitter()
    webContents.getURL = () => url
    webContents.setBackgroundThrottling = () => {}
    configure({ webContents, restore: () => actions.push('restore'), show: () => actions.push('show'), focus: () => actions.push('focus') })
    webContents.emit('did-finish-load')
    return actions
}
assert.deepEqual(simulate('file:///F:/music/dist/index.html#/anime-source'), ['restore', 'show', 'focus'])
for (const url of ['about:blank', 'https://source.example/search', 'https://source.example/player', 'https://source.example/dist/index.html', 'file:///F:/music/other.html', 'data:text/html,<p>parser</p>']) {
    assert.deepEqual(simulate(url), [], `background document stays hidden: ${url}`)
}
console.log('Preview window visibility: 7 assertions passed')
