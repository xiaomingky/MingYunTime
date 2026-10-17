import assert from 'node:assert/strict'
import http from 'node:http'
import axios from 'axios'
import { resolveDownloadLink, responseDownloadName, parseCDName, safeDownloadName } from '../electron/download-resolver.js'

assert.equal(parseCDName("attachment; filename=backup.mp3; filename*=UTF-8'zh'%E6%AD%8C%E6%9B%B2.flac"), '歌曲.flac')
assert.equal(parseCDName("attachment; filename=backup.mp3; filename*=UTF-8''%ZZ%E6"), 'backup.mp3')
assert.equal(parseCDName('attachment; filename="semi;quote\\".mp3"'), 'semi;quote_.mp3')
assert.equal(safeDownloadName('../CON?.zip'), '.._CON_.zip')
assert.equal(safeDownloadName('CON.txt '), '_CON.txt')
assert.equal(responseDownloadName({headers:{'content-type':'audio/flac'}},'https://example.test/play'), 'play.flac')
assert.equal(responseDownloadName({headers:{}},'https://example.test/a.php?filename=real.m4a'),'real.m4a')
let peerOrigin, peerSeen
const peer = http.createServer((req,res) => { peerSeen = req.headers; res.writeHead(200,{'Content-Type':'audio/flac','Content-Disposition':'attachment; filename="cross.flac"'});res.end('fLaC') })
const server = http.createServer((req,res) => {
  if (req.url === '/redirect') {res.writeHead(302,{Location:'/wrapper'});res.end();return}
  if (req.url === '/wrapper') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<a download href="/protected">下载</a>');return}
  if (req.url === '/protected') {
    if (req.headers.cookie !== 'test=fixture' || req.headers.referer !== 'https://source.test/') {res.writeHead(403);res.end();return}
    res.writeHead(200,{'Content-Type':'audio/flac','Content-Disposition':"attachment; filename*=UTF-8''%E7%9C%9F%E5%AE%9E.flac"});res.end('fLaC');return
  }
  if (req.url === '/cross') {res.writeHead(302,{Location:peerOrigin+'/file'});res.end();return}
  if (req.url === '/cross-page') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<meta http-equiv="refresh" content="0;url='+peerOrigin+'/file">');return}
  if (req.url === '/loop') {res.writeHead(302,{Location:'/loop'});res.end();return}
  if (req.url === '/missing') {res.writeHead(404);res.end('not found');return}
  if (req.url === '/large') {res.writeHead(200,{'Content-Type':'text/html'});res.end('x'.repeat(262145));return}
  if (req.url === '/error-page') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Login required</h1>');return}
  if (req.url === '/ambiguous') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<a download href="/a">A</a><a download href="/b">B</a>');return}
  res.writeHead(200,{'Content-Type':'audio/mp4'});res.end('audio')
})
await new Promise(r=>peer.listen(0,'127.0.0.1',r))
await new Promise(r=>server.listen(0,'127.0.0.1',r))
peerOrigin = 'http://127.0.0.1:'+peer.address().port
const origin = 'http://127.0.0.1:'+server.address().port
try {
  const resolved = await resolveDownloadLink({url:origin+'/redirect',headers:'Cookie: test=fixture\r\nReferer: https://source.test/'},'resolver-test')
  assert.equal(resolved.name,'真实.flac');assert.equal(resolved.url,origin+'/protected');assert.equal(resolved.headers.Cookie,'test=fixture')
  for (const endpoint of ['/cross','/cross-page']) {
    const result=await resolveDownloadLink({url:origin+endpoint,headers:{Cookie:'private=fixture',Authorization:'Bearer fixture'}},'resolver-test')
    assert.equal(result.name,'cross.flac');assert.equal(peerSeen.cookie,undefined);assert.equal(peerSeen.authorization,undefined)
    assert.ok(!Object.keys(result.headers).some(k=>/cookie|authorization/i.test(k)))
    await axios.get(result.url,{headers:result.headers});assert.equal(peerSeen.cookie,undefined);assert.equal(peerSeen.authorization,undefined)
  }
  for (const [endpoint,pattern] of [['/loop',/循环/],['/missing',/HTTP 404/],['/large',/过大/],['/error-page',/未发现/],['/ambiguous',/未发现/]]) {
    await assert.rejects(resolveDownloadLink(origin+endpoint,'resolver-test'),pattern)
  }
  const mime=await resolveDownloadLink(origin+'/download','resolver-test');assert.equal(mime.name,'download.m4a')
  await assert.rejects(resolveDownloadLink('file:///private','test'),/HTTP/)
  console.log('Download resolver checks passed: response filename, RFC5987, malformed encoding, protected redirect/wrapper, MIME, cross-origin headers, errors and bounds.')
} finally {server.closeAllConnections();peer.closeAllConnections();server.close();peer.close()}
