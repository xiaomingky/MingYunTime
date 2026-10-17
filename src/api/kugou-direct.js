// Roll out independent contracts only after verification. The public special ID
// namespace is intentionally distinct from an account's numeric list ID.
export const KUGOU_DIRECT_ROUTES = new Set([
    '/search', '/search/suggest', '/search/hot', '/album/detail', '/album/songs',
    '/artist/detail', '/artist/audios', '/artist/albums', '/rank/list', '/rank/audio',
    '/audio', '/song/url', '/login/qr/key', '/login/qr/create', '/login/qr/check',
    '/login/qr/cancel', '/login/token', '/top/song', '/pc/diantai',
    '/top/album', '/top/playlist', '/artist/lists', '/user/vip/detail', '/user/playlist', '/playlist/track/all/new',
    '/playlist/tracks/add', '/playlist/tracks/del'
])
export function isKugouDirectRoute(route, params = {}) {
    if (route === '/search' && params.type && !['song','author','album','special'].includes(params.type)) return false
    if (route === '/top/album' && params.type) return false
    if (route === '/top/playlist' && Number(params.category_id || 0)!==0) return false
    if (route === '/artist/lists' && [params.sextypes,params.type,params.musician].some(value=>Number(value || 0)!==0)) return false
    return KUGOU_DIRECT_ROUTES.has(route) || (['/playlist/detail', '/playlist/track/all'].includes(route) && /^special:[1-9]\d*$/.test(String(params.ids || params.id || '')))
}
