import fs from 'node:fs'
import path from 'node:path'

const source = path.resolve('反编译/api-analysis')
const destination = path.resolve('docs/platform-coverage')
fs.mkdirSync(destination, { recursive: true })
const platforms = ['qishui', 'qq', 'netease', 'kugou']
const implemented = new Map()
const qishuiEquivalent = new Map()
const qqImplemented = new Map()
const neteaseEquivalent = new Map()
const kugouImplemented = new Map([
    ['http://mobilecdn.kugou.com/api/v3/singer/info', { name:'歌手详情', route:'/artist/detail', ipc:'kugou:request', implementation:'electron/kugou-client.js', contractMatch:'exact-public-url', verification:'guest-live-tested' }],
    ['/search', { name:'准确 hash 的歌词候选搜索', ipc:'get-kugou-lyric', implementation:'electron/lyric-providers.js', contractMatch:'lyric-search-get', verification:'guest-live-tested' }],
    ['/download', { name:'逐字歌词下载与解析', ipc:'get-kugou-lyric', implementation:'electron/lyric-providers.js', contractMatch:'lyric-download-get', verification:'guest-live-tested' }],
    ['http://lyrics.kugou.com/download', { name:'逐字歌词下载与解析', ipc:'get-kugou-lyric', implementation:'electron/lyric-providers.js', contractMatch:'exact-public-url', verification:'guest-live-tested' }]
])
function qqOperation(endpoint, name, ipc, verification) {
    qqImplemented.set(endpoint, { name, ipc: 'qq:' + ipc, verification, implementation: 'electron/qq-client.js', contractMatch: 'exact-rpc' })
}
function neteaseOperation(endpoint, name, route, verification = live) {
    neteaseEquivalent.set(endpoint, { name, ipc: 'netease:request', route, verification, implementation: 'electron/netease-client.js', contractMatch: 'official-web-business-equivalent' })
}
function operation(method, endpoints, name, ipc, verification, file = 'electron/qishui-business.js') {
    for (const endpoint of endpoints) implemented.set(`${method} ${endpoint}`, { name, ipc, verification, implementation: file })
}
const live = 'guest-live-tested', account = 'automated-tested-account-pending'
for (const [endpoint, name, ipc] of [
    ['/passport/mobile/send_code/', '短信验证码发送（官方 PC web/send_code 合约）', 'phone-send-code'],
    ['/passport/mobile/send_voice_code/', '语音验证码发送（官方 PC web/send_voice_code 合约）', 'phone-send-code'],
    ['/passport/mobile/sms_login/', '手机验证码登录及多账号选择（官方 PC web/sms_login 合约）', 'phone-login']
]) qishuiEquivalent.set(endpoint, { name, ipc, verification: account, implementation: 'electron/qishui-account.js', contractMatch: 'official-pc-passport-equivalent' })
neteaseOperation('/api/song/enhance/player/url/v1', '歌曲播放授权与权限拒绝', '/song/url/v1')
neteaseOperation('/api/v3/song/detail', '歌曲详情', '/song/detail')
neteaseOperation('/api/v6/playlist/detail', '歌单详情与曲目 ID', '/playlist/detail')
neteaseOperation('/api/song/lyric', '歌曲歌词', '/lyric/new')
operation('POST', ['/luna/discover/mix'], '发现歌单', 'discover', live, 'electron/qishui-client.js')
operation('POST', ['/luna/playlist/detail'], '歌单详情与分页', 'playlist', live, 'electron/qishui-client.js')
operation('POST', ['/luna/search/{search_type}'], '歌曲/歌手/专辑/歌单搜索（PC GET 合约）', 'search', live)
operation('GET', ['/luna/albums/{album_id}'], '专辑曲目', 'album', live)
operation('GET', ['/luna/artists/{artist_id}'], '歌手详情', 'artist', live)
operation('POST', ['/luna/artists/{artist_id}/tracks'], '歌手歌曲分页（PC GET 合约）', 'artist-tracks', live)
operation('GET', ['/luna/artists/{artist_id}/albums'], '歌手专辑分页', 'artist-albums', live)
operation('GET', ['/luna/comments'], '歌曲/歌单评论', 'comments', live)
operation('GET', ['/luna/comments/{comment_id}/replies'], '评论回复分页', 'replies', 'automated-tested-live-pending')
for (const [endpoint, ipc, name] of [
    ['/luna/comments/create','comment-create','发表评论/回复'], ['/luna/comments/delete','comment-delete','删除自己的评论'],
    ['/luna/comments/action','comment-like','评论点赞/取消'], ['/luna/me/playlist','playlist-create','新建歌单'],
    ['/luna/me/playlist/update','playlist-update','编辑歌单'], ['/luna/me/playlist/delete','playlist-delete','删除歌单'],
    ['/luna/me/playlist/media/append','playlist-tracks','添加歌曲到歌单'], ['/luna/me/playlist/media/delete','playlist-tracks','从歌单移除歌曲'],
    ['/luna/me/follow','follow','关注用户'], ['/luna/me/unfollow','follow','取消关注'],
    ['/luna/me/recently-played-media/delete','recent-delete','移除云端最近播放记录']
]) operation('POST', [endpoint], name, ipc, account)
operation('POST', ['/luna/me/playlist/media/sort'], '完整加载的自建歌单内歌曲排序', 'playlist-tracks', account)
for (const category of ['media','album','playlist','artist']) {
    operation('POST', [`/luna/me/collection/${category}`, `/luna/me/collection/${category}/delete`], '收藏/取消收藏 ' + category, 'collect', account)
}
operation('GET', ['/luna/me/collection/artist','/luna/me/collection/mixed'], '我的收藏分页', 'collections', account)
operation('GET', ['/luna/me'], '账号资料与 Cookie 会话验证', 'login-status', account, 'electron/qishui-client.js')
operation('GET', ['/luna/user/info'], '用户主页（PC users/{id} 合约）', 'user', live)
operation('GET', ['/luna/me/recently-played-media'], '云端最近播放', 'recent', account)
operation('POST', ['/luna/playlist/search'], '歌单内搜索', 'playlist-search', live)
operation('GET', ['/luna/share_info'], '复制官方分享链接', 'share', live)
qqOperation('music.musichallAlbum.AlbumSongList::GetAlbumSongList', '专辑歌曲与分页', 'album-tracks', live)
qqOperation('music.musichallSong.SongListInter::GetSingerSongList', '歌手歌曲与分页', 'singer-hotsong', live)
qqOperation('music.srfDissInfo.DissInfo::CgiGetDiss', '歌单与我喜欢的歌曲分页', 'playlist-detail', live)
qqOperation('music.musichallSong.PlayLyricInfo::GetPlayLyricInfo', '准确歌曲 ID 歌词与逐字补充', 'lyric', live)
qqOperation('music.getSession.session::GetSession', '官方 Lite 分类搜索会话', 'search', live)
qqOperation('music.stream.MvUrlProxy::GetMvUrls', 'MV 播放授权与视频解码', 'mv-play', live)

// Only explicit non-feature evidence is excluded. Unknown SDK strings, generic
// configuration categories, AI creation and account operations stay in the queue.
function excluded(record) {
    const endpoint = record.endpoint || ''
    if (/\/(?:ads?|advert|adlog)(?:\/|[?._-])|\/media_ads(?:\/|$)/i.test(endpoint)) return 'advertising'
    if (/\/(?:log\/event|media-stats|feed\/report-info|reco_sample|monitor_web|webcast\/trace\/report)(?:\/|$)/i.test(endpoint)) return 'telemetry'
    if (/\b(?:apmplus|bugly|crashlytics|crashreport|sentry\.io)\b/i.test(endpoint)) return 'crash-reporting'
    if (/\b(?:umengpush|getui|jpush)\b|\/push\/sdk\//i.test(endpoint)) return 'push-sdk'
    if (record.kind === 'url-literal' && /\.(?:png|jpe?g|webp|gif|svg|ico)(?:[?#].*)?$/i.test(endpoint)) return 'image-resource'
    return ''
}
const totals = [], all = []
for (const platform of platforms) {
    const original = JSON.parse(fs.readFileSync(path.join(source, platform + '-api.json'), 'utf8'))
    const records = original.records.map(record => {
        const exclusion = excluded(record)
        const implementation = platform === 'qishui' ? implemented.get(`${record.httpMethod || ''} ${record.endpoint}`) || qishuiEquivalent.get(record.endpoint)
            : platform === 'qq' ? qqImplemented.get(record.endpoint)
                : platform === 'netease' ? neteaseEquivalent.get(record.endpoint)
                    : platform === 'kugou' ? kugouImplemented.get(record.endpoint) : undefined
        const declared = ['http-declaration', 'rpc-pair'].includes(record.kind)
        return {
            id: record.id, platform, kind: record.kind, category: record.category, family: record.family,
            method: record.httpMethod === 'UNKNOWN' ? '' : record.httpMethod || '', rpcModule: record.rpcModule || record.evidence?.[0]?.module || '', rpcMethod: record.rpcMethod || record.evidence?.[0]?.rpcMethod || '', endpoint: record.endpoint,
            status: exclusion ? 'excluded' : implementation ? 'connected' : declared ? 'contract-research-pending' : 'candidate-review-pending',
            exclusion, ...(implementation || {}),
            source: `${platform}-api.json#${record.id}`, evidence: record.evidence?.[0] ? { file: record.evidence[0].file, line: record.evidence[0].line } : null
        }
    })
    if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate coverage IDs: ' + platform)
    const count = key => records.filter(r => r.status === key).length
    totals.push({ platform, total: records.length, excluded: count('excluded'), connected: count('connected'), research: count('contract-research-pending'), candidates: count('candidate-review-pending') })
    all.push(...records)
    fs.writeFileSync(path.join(destination, platform + '.json'), JSON.stringify({ platform, source: `反编译/api-analysis/${platform}-api.json`, records }, null, 2) + '\n')
}
const lines = [
    '# 四平台 API 覆盖账本', '',
    '生成命令：`node scripts/build-platform-coverage.mjs`。每条原始 APK 记录保留原 ID、方法、路径、分类和首个源码证据。完整参数及其他证据按 `source` 回查原 JSON；未识别方法的字符串不会被猜成 GET。', '',
    '**connected 表示已连接具体实现，不等于全部验收。** `verification` 单独标注游客实测、自动测试待账号、界面待连接等状态。PC 与 Android 的等价业务会记录方法差异。QQ 仅将已实测的同名 RPC 计入此 APK 账本；其他已独立实现的公开 Web/Lite 业务另见验收记录，不将不同契约强行算成原始 API 已完成。网易云条目标为“官方 Web 等价业务”，不代表 APK 原始请求方法或参数完全对应。酷狗只映射有直接证据的歌手/歌词记录，独立 Web 搜索、详情、授权和扫码等另见验收记录。四平台尚未替换的旧通道仍保留。', '',
    '只有明确的广告、埋点、崩溃上报、推送 SDK 和图片资源被排除。笼统“配置、统计与其他”分类，以及未知 SDK 字符串都保留待审；AI 创作、分享、会员、账号设置也保留。排除项仍可通过原 ID 追溯。', '',
    '| 平台 | APK 记录 | 明确排除 | 已连接实现 | HTTP/RPC 待研究 | 字符串候选待审 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...totals.map(t => `| ${t.platform} | ${t.total} | ${t.excluded} | ${t.connected} | ${t.research} | ${t.candidates} |`), '',
    '## HTTP/RPC 逐项状态', '', '| 平台 / ID | 方法与路径 / RPC | 状态 | 实现与验证 |', '| --- | --- | --- | --- |'
]
for (const r of all.filter(r => r.method || r.rpcMethod || r.kind === 'rpc-pair')) {
    const safe = value => String(value || '').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ')
    lines.push(`| ${r.id} | ${safe(r.method || r.rpcMethod)} ${safe(r.endpoint)} | ${r.status}${r.exclusion ? ': ' + r.exclusion : ''} | ${safe(r.name)} ${safe(r.verification)} |`)
}
fs.writeFileSync(path.join(destination, 'README.md'), lines.join('\n') + '\n')
console.log(JSON.stringify({ originalRecords: all.length, totals }, null, 2))
