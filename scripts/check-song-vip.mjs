import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { songVip } from '../src/utils/song-vip.js'
import { qishuiTrack } from '../electron/qishui-client.js'

const require = createRequire(import.meta.url)
const { createSSRApp } = require('vue')
const { renderToString } = require('@vue/server-renderer')
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }

for (const platform of ['netease', 'qq', 'qishui', 'kugou']) {
  check(!songVip({ platform, isVip: '0', fee: 0 }), `${platform}: free songs have no VIP marker`)
  check(!songVip({ platform, isPreview: true }), `${platform}: preview alone does not imply a VIP recording`)
}
check(!songVip({platform:'qishui',isVip:true,label_info:{only_vip_playable:false}}), 'explicit free playback overrides stale normalized badge')
check(!songVip({platform:'qq',isVip:true,pay:{payplay:0,paytrackprice:200}}), 'QQ free playback overrides price and stale badge')
check(!songVip(null), 'missing song has no marker')
check(!songVip({platform:'kugou',isVip:true,fee:1,vipPlayRequired:false}), 'Kugou explicit free playback overrides cached VIP')
check(!songVip({platform:'kugou',isVip:true,TransParam:{musicpack_advance:0}}), 'Kugou raw free rights override stale normalized state')
check(!songVip({platform:'kugou',isVip:true,trans_param:{free_limited:1}}), 'Kugou limited-free recording omits VIP playback marker')
check(songVip({platform:'kugou',TransParam:{musicpack_advance:1}})?.icon.endsWith('kugou-song-vip.webp'), 'Kugou raw VIP rights use official SONG icon')
check(!songVip({platform:'kugou',Privilege:0,SQPrivilege:10,PayType:3}), 'Kugou premium quality and download payment do not imply standard playback VIP')
check(songVip({ fee: '1' }).platform === 'netease', 'NetEase fee string follows official track rights')
check(songVip({ song: { fee: 1 } }).platform === 'netease', 'NetEase recommendation envelope retains song rights')
check(!songVip({ fee: 4 }), 'paid album is not relabeled as NetEase membership')
check(songVip({ songmid: 'mid', isVip: true }).icon.endsWith('qq-song-vip.png'), 'QQ uses official cell VIP artwork')
check(!songVip({ qishuiId: '42', vipDownloadOnly: true }), 'Qishui download-only rights never display a playback VIP badge')
check(!songVip({ platform: 'qq', isVip: true }, 'netease'), 'platform override cannot borrow another provider rights')

const raw = { id: '42', name: 'fixture', label_info: { only_vip_playable: '1', only_vip_download: true } }
const track = qishuiTrack(raw)
check(track.isVip && track.vipDownloadOnly && songVip(track)?.platform === 'qishui', 'official Qishui label_info reaches normalized song badge')
const download = qishuiTrack({ ...raw, label_info: { only_vip_playable: false, only_vip_download: 1 } })
check(!download.isVip && download.vipDownloadOnly, 'Qishui separates playback and download membership')
check(!qishuiTrack({ ...raw, label_info: { only_vip_playable: '0', only_vip_download: '0' } }).isVip, 'Qishui string zero cannot grant or suggest VIP rights')
check(!qishuiTrack({ ...raw, label_info: { quality_only_vip_can_play: ['lossless'] } }).isVip, 'Qishui premium quality alone does not label all playback VIP-only')
check(qishuiTrack({ ...raw, label_info: undefined, labelInfo: { onlyVipPlayable: true } }).isVip, 'Qishui native camelCase label response supported')

for (const [local, apk] of [
  ['qq-song-vip.png', 'QQ音乐/resources/res/drawable-xxhdpi/pay_icon_in_cell_new_as.png'],
  ['kugou-song-vip.webp', '酷狗概念版/resources/res/drawable-xxhdpi/img_tagofsong_vip.webp'],
  ['qishui-vip.png', '汽水音乐/resources/assets/offline/commercial_popups/static/image/vip-tag.c912234f.png']
]) {
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
  check(digest(`public/membership/${local}`) === digest(`反编译/out/${apk}`), `${local}: original APK pixels remain byte-identical`)
}

async function loadVue(file) {
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'vue-badge', setup(b) {
    b.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
      assert.deepEqual(errors, [])
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'js', resolveDir: path.dirname(args.path) }
    })
  } }] })
  const mod = { exports: {} }
  Function('require', 'module', 'exports', output.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports.default
}
const Badge = await loadVue('src/components/SongVipBadge.vue')
const render = song => renderToString(createSSRApp(Badge, { song }))
for (const song of [{ fee: 1 }, track, { platform: 'qq', isVip: true }, { platform: 'kugou', isVip: true }]) {
  const html = await render(song)
  check(html.includes('<img') && html.includes('membership/') && html.includes('alt='), `${song.platform || 'netease'}: actual Vue renderer emits accessible official image`)
}
check(!(await render({ platform: 'qq', isVip: false })).includes('<img'), 'actual Vue renderer omits non-VIP song badge')
const QQBadge = await loadVue('src/components/QQSongBadge.vue')
const qq = await renderToString(createSSRApp(QQBadge, { song: { isVip: true } }))
check(qq.includes('qq-song-vip') && qq.includes('qq-song-vip.png'), 'QQ wrapper retains selector and renders real image')

for (const file of ['src/App.vue', 'src/views/Search.vue', 'src/views/PlaylistDetail.vue', 'src/views/AlbumDetail.vue', 'src/views/Discovery.vue', 'src/views/RecentPlay.vue', 'src/views/SongDetail.vue', 'src/components/AppleMusicDetail.vue', 'src/views/qishui/Music.vue']) {
  const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true })
  check(compiled.content.includes('SongVipBadge'), `${file}: updated template compiles with official badge`)
}
console.log(`Official song VIP badges passed: ${checks} classification, APK integrity, Vue render and template checks.`)
