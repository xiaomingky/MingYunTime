import { NETEASE_OPERATION_ROUTES } from './netease-operation-routes.js'
// Routes implemented by the built-in official main-process client.
// Unlisted routes are rejected without a third-party service fallback.
export const NETEASE_DIRECT_ROUTES = new Set([...NETEASE_OPERATION_ROUTES,
    '/cloudsearch', '/search', '/song/detail', '/song/url/v1', '/lyric', '/lyric/new',
    '/album', '/playlist/detail', '/playlist/track/all', '/toplist', '/banner',
    '/personalized', '/personalized/newsong', '/top/playlist', '/top/artists', '/top/song',
    '/user/detail', '/user/playlist', '/login/status', '/user/account',
    '/login/qr/key', '/login/qr/create', '/login/qr/check', '/login/qr/cancel',
    '/comment/music', '/comment/playlist', '/comment/album', '/vip/info'
])
