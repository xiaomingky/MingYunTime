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

const endedPlayer = store()
endedPlayer.playlist = endedPlayer._normalizeQueue(songs)
endedPlayer.currentIndex = 0
endedPlayer.audio = { ended: true, currentTime: 0 }
assert.equal(endedPlayer._handleAudioEnded(endedPlayer.audio), true, 'a current ended track advances the sequence')
assert.equal(endedPlayer.currentIndex, 1)
assert.equal(endedPlayer._handleAudioEnded(endedPlayer.audio), false, 'duplicate ended events cannot advance twice')
assert.deepEqual(endedPlayer.calls, [songs[1].id])
const staleAudio = { ended: true }
endedPlayer.audio = { ended: false }
assert.equal(endedPlayer._handleAudioEnded(staleAudio), false, 'an ended event from a replaced audio element is ignored')
endedPlayer.audio = staleAudio
endedPlayer.playbackLoading = true
assert.equal(endedPlayer._handleAudioEnded(staleAudio), false, 'an ended event cannot interrupt an active track load')

const replayEvents = {}
const replayAudio = { paused: false, ended: true, addEventListener(name, handler) { replayEvents[name] = handler } }
const replayPlayer = store()
replayPlayer.audio = replayAudio
replayPlayer._endingAudio = replayAudio
replayPlayer._bindPlaybackStateEvents(replayAudio)
replayEvents.play()
assert.equal(replayPlayer._endingAudio, null, 'starting playback re-arms ended handling for loop/replay')

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
const resumed=store()
resumed.playlist=[{id:'kg',platform:'kugou',duration:236000,queueItemId:'saved-kg'}]
resumed.currentIndex=0
resumed.currentSong={id:'kg',platform:'kugou',duration:236.69,streamQuality:'flac',queueItemId:'saved-kg'}
resumed.restorePlaybackState()
assert.equal(resumed.currentSong.duration,236.69,'restoring preserves actual audio seconds instead of raw queue milliseconds')
assert.equal(resumed.currentSong.streamQuality,'flac','confirmed stream quality survives restart')
resumed.currentSong={id:'other',platform:'netease',duration:500}
resumed.restorePlaybackState()
assert.equal(resumed.currentSong.duration,236,'queue fallback converts Kugou duration to seconds without borrowing other song metadata')
resumed.currentSong={id:'kg',platform:'kugou',duration:999,queueItemId:'another-copy'}
resumed.restorePlaybackState()
assert.equal(resumed.currentSong.duration,236,'different duplicate queue identities do not reuse saved active metadata')
console.log('Player queue checks passed: duplicate identity, reorder/current track, remove/next/clear, shuffle/history, single/double click.')
