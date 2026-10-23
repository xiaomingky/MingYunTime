import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const archive = 'release/win-unpacked/resources/app.asar'
const entries = asar.listPackage(archive)
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'))
assert.equal(pkg.version, '4.0.3')
assert.equal(JSON.parse(fs.readFileSync('package-lock.json')).packages[''].version, pkg.version)
assert.deepEqual(entries.filter(n => /qq-music-api|kugou-music-api|netease-api|api-runtime|local-service|[\\/]dev[\\/]|Cookies|Login Data/.test(n)), [])
for (const file of ['dist-electron/main.js', 'dist-electron/preload.js']) {
  assert.ok(asar.extractFile(archive, file).equals(fs.readFileSync(file)), `Current bundle: ${file}`)
}
assert.ok(entries.some(n => /AnimeSource-.*\.js$/.test(n)))
for (const file of ['anime-source-rules.txt', 'Anime4K-WebGPU-LICENSE.txt']) {
  assert.ok(asar.extractFile(archive, path.join('public', 'licenses', file)).equals(fs.readFileSync('public/licenses/' + file)))
}
const resources = 'release/win-unpacked/resources'
for (const file of ['aria2c.exe', 'ffmpeg.exe', 'yt-dlp.exe']) {
  assert.ok(fs.readFileSync('resources/' + file).equals(fs.readFileSync(resources + '/' + file)))
}
const manifest = JSON.parse(fs.readFileSync(resources + '/qishui-runtime/origin.json'))
for (const file of ['bdms.node', 'device.node', 'metasecml.dll']) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(resources + '/qishui-runtime/' + file)).digest('hex'), manifest.files[file])
}
assert.ok(fs.readFileSync(resources + '/qishui-runtime-worker.cjs').equals(fs.readFileSync('electron/qishui-runtime-worker.cjs')))
for (const file of ['README.md', 'README_EN.md', 'dev/release-notes-403.md']) {
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(!/反编译|decompil|kazumi/i.test(text))
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!/^(?:https?:|#)/.test(m[1])) assert.ok(fs.existsSync(m[1].split('#')[0]), 'Documentation link: ' + m[1])
  }
}
const artifactNames = ['Setup.4.0.3.exe', 'MingYunTime-4.0.3-win.7z', 'Setup.4.0.3.exe.blockmap']
const artifacts = artifactNames.map(name => ({ name, size: fs.statSync('release/' + name).size, sha256: crypto.createHash('sha256').update(fs.readFileSync('release/' + name)).digest('hex') }))
const checksums = fs.readFileSync('release/SHA256SUMS-v4.0.3.txt', 'utf8')
for (const item of artifacts) assert.ok(checksums.includes(item.sha256 + '  ' + item.name))
const archiveCheck = execFileSync('7z.exe', ['t', 'release/MingYunTime-4.0.3-win.7z'], {encoding:'utf8', windowsHide:true})
assert.ok(archiveCheck.includes('Everything is Ok'))
console.log('Package content, version, resources, documentation, checksums and 7z integrity passed')

const profile = path.resolve('dev/release-403-smoke-profile')
fs.mkdirSync(profile, { recursive:true })
const processLog = fs.openSync('dev/release-403-smoke.log', 'a')
const child = spawn(path.resolve('release/win-unpacked/茗韵时光.exe'), ['--user-data-dir=' + profile, '--remote-debugging-port=9336', '--disable-backgrounding-occluded-windows'], {windowsHide:true, stdio:['ignore',processLog,processLog]})
fs.closeSync(processLog)
let socket
const delay = ms => new Promise(r => setTimeout(r, ms))
const errors = []
try {
  let target
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Packaged executable stays running')
    try { target = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find(t => t.type === 'page' && t.url.includes('/dist/index.html')) } catch {}
    if (target) break
    await delay(400)
  }
  assert.ok(target, 'Packaged application document exists')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject) => {socket.onopen=resolve;socket.onerror=reject})
  let sequence=0
  const pending=new Map()
  socket.onmessage=event => {
    const message=JSON.parse(event.data)
    if (message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (pending.has(message.id)) {const {resolve,reject,timer}=pending.get(message.id);pending.delete(message.id);clearTimeout(timer);message.error ? reject(Error(message.error.message)):resolve(message.result)}
  }
  const call=(method,params={}) => new Promise((resolve,reject) => {const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
  const js=async expression => {const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
  const wait=async expression => {const end=Date.now()+18000;while(Date.now()<end){if(await js(expression))return;await delay(200)}throw Error('Packaged UI wait failed')}
  await call('Runtime.enable')
  await wait(`!!document.querySelector('#app')?.__vue_app__`)
  assert.ok(target.url.includes('app.asar'))
  await js(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/anime-source')`)
  await wait(`document.querySelectorAll('.as-poster-card').length > 0`)
  const ui=await js(`({cards:document.querySelectorAll('.as-poster-card').length,tabs:document.querySelectorAll('.as-tabs button').length,search:!!document.querySelector('.as-search input'),title:document.title})`)
  assert.equal(ui.tabs,6)
  assert.ok(ui.cards>=24)
  assert.equal(ui.search,true)
  await js(`{const input=document.querySelector('.as-search input');input.focus();input.dispatchEvent(new FocusEvent('focus',{bubbles:true}))}`)
  await wait(`getComputedStyle(document.querySelector('.as-search')).borderColor === 'rgb(72, 123, 105)'`)
  const focus=await js(`({border:getComputedStyle(document.querySelector('.as-search')).borderColor,outline:getComputedStyle(document.querySelector('.as-search input')).outlineStyle})`)
  assert.equal(focus.outline,'none')
  assert.equal(focus.border,'rgb(72, 123, 105)')
  const screenshot=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('dev/release-403-packaged.png',Buffer.from(screenshot.data,'base64'))
  await js(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/local-video')`)
  await delay(1000)
  assert.equal(errors.length,0,'No renderer exceptions')
  const result={verified:true,version:pkg.version,packagedRuntime:true,archiveEntries:entries.length,artifacts,ui,focus,rendererExceptions:errors.length}
  fs.writeFileSync('dev/verify-release-403-result.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
} finally {
  socket?.close()
  if (child.pid && child.exitCode===null) {
    try {execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})} catch {}
  }
}
