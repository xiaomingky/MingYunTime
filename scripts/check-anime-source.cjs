// Run with electron. The live option checks public sources with an isolated profile.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-anime-source-'))
app.setPath('userData', profile)
let server
const live = process.argv.includes('--live')
let assertionCount = 0
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertionCount++ }
app.whenReady().then(async () => {
  const engine = await import('../electron/anime-source-engine.js')
  const catalog = await import('../electron/anime-source-catalog.js')
  const initial = engine.animeSourceRules()
  equal(initial.data.length, 17, 'all currently maintained sources are bundled on a clean install')
  equal(initial.all.every(rule => rule.builtin), true)
  equal(new Set(initial.all.map(rule => rule.id)).size, 17)
  const started = Date.now(), popular = await catalog.discoverAnimeCatalog('popular')
  equal(popular.success, true); equal(popular.data.length, 24)
  equal(popular.data.every(item => item.title && item.cover), true)
  equal(popular.data[0].tags.length > 0, true, 'real catalogue tags survive normalization')
  equal(popular.data[0].ratingCount > 0, true, 'real rating totals are retained')
  equal(popular.data[0].episodeCount > 0, true, 'episode totals are parsed from catalogue metadata')
  assert.ok(Date.now() - started < 500, 'initial catalogue must not wait for the network'); assertionCount++
  const timeline = await catalog.discoverAnimeCatalog('timeline')
  equal(timeline.data.length, 7); equal(timeline.data.some(day => day.items.length > 0), true)
  equal(engine.jsonValues({ data: [{ title: 'A' }, { title: 'B' }] }, '$.data[*].title'), ['A', 'B'])
  equal(engine.jsonValues({ x: { a: { name: 'A' } }, name: 'B' }, '$..name'), ['B', 'A'])
  equal(engine.jsonValues({ data: [{ x: 4 }] }, '$.data[0].x'), [4])
  equal(engine.animeMediaType('https://site.example/player?url=https://cdn.example/file.m3u8'), '', 'HTML player URLs are not HLS streams')
  equal(engine.animeMediaType('https://cdn.example/protected-token', 'application/vnd.apple.mpegurl'), 'm3u8', 'extensionless HLS is recognized by its content type')
  equal(engine.animeMediaType('https://cdn.example/video.mp4?token=abc'), 'direct')
  equal(engine.animePageMedia('<script>const config="https://parser.example/player?ref=https://cdn.example/file.m3u8"</script>', 'https://site.example'), null, 'a media name in a web-player query is not a playable video')
  equal(engine.animePageMedia('<script>var player_aaaa={"url":"https://parser.example/player?url=https%3A%2F%2Fcdn.example%2Ffile.m3u8"};</script>', 'https://site.example'), { url: 'https://cdn.example/file.m3u8', type: 'm3u8' }, 'unwrap actual nested player media URLs')
  equal(engine.animePageMedia('<script>var player_aaaa=' + JSON.stringify({ url: Buffer.from('https://cdn.example/film.mp4').toString('base64'), encrypt: 2 }) + ';</script>', 'https://site.example'), { url: 'https://cdn.example/film.mp4', type: 'direct' }, 'decode declared player URL encoding')
  const { default: axios } = await import('axios')
  const previousAdapter = axios.defaults.adapter
  try {
    axios.defaults.adapter = async () => { throw Error('synthetic offline network') }
    const offline = await catalog.discoverAnimeCatalog('timeline', 0, true)
    equal(offline.success, true); equal(offline.meta.cached, true); equal(!!offline.meta.warning, true)
    equal(offline.data.length, 7, 'offline fallback retains the saved timetable')
    const noPage = await catalog.discoverAnimeCatalog('popular', 9999, true)
    equal(noPage.success, false); equal(noPage.message.includes('timeout of'), false)
  } finally { axios.defaults.adapter = previousAdapter }
  const requests = []
  server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const url = new URL(req.url, 'http://localhost'); requests.push({ url, body })
    res.setHeader('Content-Type', url.pathname.startsWith('/api') ? 'application/json' : 'text/html; charset=utf-8')
    if (url.pathname === '/search') return res.end('<div class="results"><article><a class="title" href="/detail/a">番剧 A</a><img src="/a.jpg"></article><article><a class="title" href="/detail/b">番剧 B</a><img src="/b.jpg"></article></div>')
    if (url.pathname.startsWith('/detail')) return res.end('<h1>番剧详情</h1><section class="road"><a href="/play/1">第一集</a><a href="/play/2">第二集</a></section><section class="road"><a href="/play/3">备用第一集</a></section>')
    if (url.pathname === '/api/search') return res.end(JSON.stringify({ data: [{ id: '42', name: 'API 番剧', cover: '/cover.jpg' }] }))
    if (url.pathname === '/api/detail/42') return res.end(JSON.stringify({ data: { slug: 'show-42', roads: [{ name: '主线路', episodes: [{ id: 'ep-9', title: '第九集' }] }] } }))
    if (url.pathname === '/slowplay') return setTimeout(() => res.end('<video src="/video.m3u8"></video>'), 100)
    if (url.pathname.startsWith('/play')) return res.end('<video src="/video.m3u8"></video>')
    res.writeHead(404); res.end('missing')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const fixtures = await engine.importAnimeRules([
    { name: 'fixture-xpath', baseUrl, searchURL: baseUrl + '/search?q=@keyword', searchList: '//article', searchName: '//a', searchResult: '//a', chapterRoads: '//section', chapterResult: '//a' },
    { name: 'fixture-css', baseUrl, search: { url: '/search?q={keyword}', item: 'article', title: 'a.title', id: 'a.title', cover: 'img' }, detail: { route: 'section.road', episode: 'a' } },
    { name: 'fixture-api', baseUrl, searchMode: 'api', chapterMode: 'api', searchApiConfig: { request: { url: baseUrl + '/api/search', query: { q: '@keyword' } }, listPath: '$.data[*]', namePath: '$.name', sourcePath: '$.id' }, chapterApiConfig: { request: { method: 'POST', url: baseUrl + '/api/detail/@source', bodyType: 'json', body: { id: '@source' } }, roadsPath: '$.data.roads[*]', episodeNamePath: '$.title', episodeUrlPath: '$.id', variables: { slug: '$.data.slug' }, episodePage: { url: baseUrl + '/watch/@slug/@source/@episodeUrl', query: { road: '@roadIndex', episode: '@episodeIndex' } } } }
  ])
  for (const rule of fixtures.slice(0, 2)) {
    const results = await engine.searchAnimeRule(rule.id, '测试 空格')
    equal(results.map(item => item.title), ['番剧 A', '番剧 B'], 'XPath must remain relative to each result node')
    equal(results.map(item => item.id), [baseUrl + '/detail/a', baseUrl + '/detail/b'])
    const detail = await engine.detailAnimeRule(rule.id, results[0].id)
    equal(detail.routes.map(road => road.episodes.length), [2, 1], 'roads must not repeat episodes from other roads')
    equal(detail.routes[1].episodes[0].title, '备用第一集')
    const play = await engine.playAnimeRule(rule.id, detail.routes[0].episodes[0].url)
    equal(play.url, baseUrl + '/video.m3u8'); equal(play.type, 'm3u8')
  }
  const api = fixtures[2], results = await engine.searchAnimeRule(api.id, '测试 空格')
  equal(results[0].id, '42', 'API IDs must not be converted to URLs')
  const detail = await engine.detailAnimeRule(api.id, results[0].id)
  equal(detail.routes[0].episodes[0].title, '第九集')
  equal(detail.routes[0].episodes[0].url, baseUrl + '/watch/show-42/42/ep-9?road=0&episode=0')
  equal(JSON.parse(requests.find(item => item.url.pathname === '/api/detail/42').body), { id: '42' })
  equal(requests.find(item => item.url.pathname === '/api/search').url.searchParams.get('q'), '测试 空格')
  const stale = engine.playAnimeRule(fixtures[0].id, baseUrl + '/slowplay', 'cancel-check').then(() => 'unexpected', error => error.message)
  await new Promise(resolve => setTimeout(resolve, 20))
  const latest = await engine.playAnimeRule(fixtures[0].id, baseUrl + '/latest.mp4', 'cancel-check')
  equal(latest.url, baseUrl + '/latest.mp4')
  equal(await stale, '播放解析已取消', 'old network parses must not spawn windows after switching episodes')
  console.log(`Anime source fixtures: ${assertionCount} assertions passed`)
  const report = { fixtures: assertionCount, live: [], discovery: [] }
  if (live) {
    for (const kind of ['popular', 'timeline']) {
      const start = Date.now(), response = await catalog.discoverAnimeCatalog(kind, 0, true)
      report.discovery.push({ kind, success: response.success, fresh: !response.meta?.cached, count: response.data?.length, ms: Date.now() - start, warning: response.meta?.warning })
      console.log(JSON.stringify(report.discovery.at(-1)))
    }
    let cursor = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < initial.data.length) {
        const source = initial.data[cursor++], health = await engine.checkAnimeRule(source.id)
        const entry = { name: source.label, ...health }
        if (health.status === 'available') {
          try {
            const items = await engine.searchAnimeRule(source.id, '海贼王')
            const data = await engine.detailAnimeRule(source.id, items[0].id)
            entry.routes = data.routes.length; entry.episodes = data.routes.reduce((sum, road) => sum + road.episodes.length, 0)
            if (process.argv.includes('--play') && entry.episodes) { const play = await engine.playAnimeRule(source.id, data.routes[0].episodes[0].url, source.id); entry.play = { success: play.success, type: play.type, host: new URL(play.url).host } }
          } catch (error) { entry.detailError = error.message }
        }
        report.live.push(entry); console.log(JSON.stringify(entry))
      }
    }))
  }
  fs.writeFileSync(path.resolve(live ? 'dev/anime-source-live-validation.json' : 'dev/anime-source-validation.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ success: true, fixtures: assertionCount, sourcesWithSearch: report.live.filter(item => item.status === 'available').length, sourcesWithEpisodes: report.live.filter(item => item.episodes).length }))
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { server?.close(); for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(process.exitCode || 0) })
setTimeout(() => { console.error('Anime source check timed out'); app.exit(1) }, 180000).unref()
