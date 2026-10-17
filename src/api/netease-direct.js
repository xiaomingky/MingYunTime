// Only these legacy UI routes have an independently implemented main-process
// contract. Unlisted routes retain their current implementation during rollout.
export const NETEASE_DIRECT_ROUTES = new Set([
    '/cloudsearch', '/search', '/song/detail', '/song/url/v1', '/lyric', '/lyric/new',
    '/album', '/playlist/detail', '/playlist/track/all', '/toplist', '/banner',
    '/personalized', '/personalized/newsong', '/top/playlist', '/top/artists', '/top/song',
    '/user/detail', '/user/playlist', '/login/status', '/user/account',
    '/login/qr/key', '/login/qr/create', '/login/qr/check', '/login/qr/cancel',
    '/comment/music', '/comment/playlist', '/comment/album', '/vip/info'
])
