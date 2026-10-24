// Roll out independent contracts only after verification. The public special ID
// namespace is intentionally distinct from an account's numeric list ID.
export const KUGOU_DIRECT_ROUTES = new Set([
    '/search', '/search/suggest', '/search/hot', '/album/detail', '/album/songs',
    '/artist/detail', '/artist/audios', '/artist/albums', '/rank/list', '/rank/audio',
    '/audio', '/song/url', '/login/qr/key', '/login/qr/create', '/login/qr/check',
    '/login/qr/cancel', '/login/token', '/top/song', '/pc/diantai',
    '/top/album', '/top/playlist', '/artist/lists', '/user/vip/detail', '/user/playlist', '/playlist/track/all/new',
    '/playlist/tracks/add', '/playlist/tracks/del',
    '/playlist/add', '/playlist/del', '/playlist/tags', '/user/detail',
    '/comment/music', '/comment/playlist', '/comment/album', '/video/url',
    '/video/detail', '/kmr/audio/mv', '/search/lyric', '/lyric', '/song/url/new',
    '/youth/vip', '/youth/day/vip', '/youth/day/vip/upgrade',
    '/youth/month/vip/record', '/youth/union/vip', '/login', '/login/cellphone',
    '/captcha/sent', '/login/wx/create', '/login/wx/check', '/login/openplat'
])
// 歌单 ID 既可能是纯数字（用户歌单），也可能是 collection_3_xxx_xxx_x
// （官方歌单/收藏歌单的 global_collection_id），多 ID 用逗号分隔。
const KUGOU_PLAYLIST_ID = /^(?:special:)?[1-9]\d*$|^collection_\d+_\d+_\d+_\d+$/
export function isKugouDirectRoute(route, params = {}) {
    if (route === '/search' && params.type && !['song','author','album','special','mv','lyric'].includes(params.type)) return false
    return KUGOU_DIRECT_ROUTES.has(route) || (['/playlist/detail', '/playlist/track/all'].includes(route)
        && String(params.ids || params.id || '').split(',').every(value => KUGOU_PLAYLIST_ID.test(value)))
}
