import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Use the production store actions without issuing provider requests.
const source = fs.readFileSync(new URL('../src/store/player.js', import.meta.url), 'utf8')
const actionsStart = source.indexOf('    actions: {') + '    actions: '.length
const actionsEnd = source.lastIndexOf('\n})')
const context = vm.createContext({
    useSettingsStore: () => ({ songClickMode: context.clickMode }),
    makeQueueItemId: (() => { let id = 0; return () => `q-${++id}` })(),
    Math, Date, console
})
context.clickMode = 'single'
vm.runInContext(`globalThis.actions = (${source.slice(actionsStart, actionsEnd).trim().replace(/,$/, '')})`, context)
function store() {
    return Object.assign({ playlist: [], currentIndex: -1, shuffleBag: [], shuffleHistory: [], playMode: 0, audio: { currentTime: 0 }, calls: [] }, context.actions, {
        playSong(song, list) { if (list?.length) this.playlist = this._normalizeQueue(list); this.currentIndex = this.playlist.findIndex(item => item.queueItemId === song.queueItemId || item.id === song.id); this.currentSong = this.playlist[this.currentIndex] || song; this.calls.push(song.id) }
    })
}
const player = store()
const songs = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `Track ${index}` }))
player.playNow(songs[3], songs)
const current = player.currentSong.queueItemId
player.enqueue(songs[3])
assert.notEqual(player.playlist[8].queueItemId, current, 'duplicates have separate queue identities')
player.movePlaylistItem(3, 6)
assert.equal(player.currentIndex, 6)
assert.equal(player.playlist[6].queueItemId, current)
player.movePlaylistItem(0, 8)
assert.equal(player.playlist[player.currentIndex].queueItemId, current, 'moving another track preserves the current song')
assert.equal(player.removeFromQueue(player.currentIndex), false)
player.removeFromQueue(0)
assert.equal(player.playlist[player.currentIndex].queueItemId, current)
player.playNext({ id: 99, name: 'Next' })
assert.equal(player.playlist[player.currentIndex + 1].id, 99)
player.clearUpcoming()
assert.equal(player.playlist.length, player.currentIndex + 1)

player.playlist = player._normalizeQueue(songs)
player.currentIndex = 0
player._resetShuffleState()
const visited = new Set()
for (let i = 0; i < songs.length - 1; i++) {
    const next = player._getRandomNextIndex()
    assert.notEqual(next, player.currentIndex)
    assert.ok(!visited.has(next), 'random bag visits each candidate once')
    visited.add(next)
    player.currentIndex = next
}
const historyLast = player.shuffleHistory.at(-1)
player.playMode = 2
player.prev()
assert.equal(player.currentIndex, historyLast, 'previous follows real shuffle history')

context.clickMode = 'double'
const before = player.calls.length
player.handleSongClick(songs[1], [], { detail: 1 })
assert.equal(player.calls.length, before)
player.handleSongClick(songs[1], [], { detail: 2 })
assert.equal(player.calls.length, before + 1)
context.clickMode = 'single'
player.handleSongClick(songs[2], [], { detail: 1 })
player.handleSongClick(songs[2], [], { detail: 2 })
assert.equal(player.calls.length, before + 2, 'single-click mode does not duplicate the double-click request')
console.log('Player queue checks passed: duplicate identity, reorder/current track, remove/next/clear, shuffle/history, single/double click.')
