import assert from 'node:assert/strict'
import { installInterfaceMotion, useInterfaceMotion, shouldReduceMotion } from '../src/utils/interface-motion.js'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../src/store/settings.js'

const saved = new Map([['app_settings', JSON.stringify({ songClickMode: 'double', shortcuts: { next: 'Ctrl+N' } })]])
globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) }
setActivePinia(createPinia())
const settings = useSettingsStore()
assert.equal(settings.interfaceMotion, 'on', 'existing users get visible animations after migration')
assert.equal(settings.songClickMode, 'double')
const classes = new Set()
let systemChanged
globalThis.document = { documentElement: { classList: { toggle: (c, on) => on ? classes.add(c) : classes.delete(c) } } }
const media = { matches: true, addEventListener: (_e, fn) => { systemChanged = fn }, removeEventListener: () => {} }
globalThis.window = { matchMedia: () => media }
const stop = installInterfaceMotion(settings)
const reduced = useInterfaceMotion(settings)
assert.equal(classes.has('reduce-motion'), false, 'Windows reduced-motion does not override explicit on')
assert.equal(reduced.value, false)
settings.setInterfaceMotion('system')
assert.equal(classes.has('reduce-motion'), true)
assert.equal(reduced.value, true)
media.matches = false; systemChanged()
assert.equal(reduced.value, false)
settings.setInterfaceMotion('off')
assert.equal(classes.has('reduce-motion'), true)
settings.setInterfaceMotion('on'); settings.setLightVisuals(true)
assert.equal(classes.has('reduce-motion'), false, 'light visuals preserve transitions')
assert.equal(classes.has('light-visuals'), true)
assert.equal(JSON.parse(saved.get('app_settings')).lightVisuals, true)
assert.equal(JSON.parse(saved.get('app_settings')).shortcuts.next, 'Ctrl+N')
stop()
assert.equal(shouldReduceMotion('system', false), false)
console.log('Motion preference, Windows system changes, persistence and light visuals passed.')
