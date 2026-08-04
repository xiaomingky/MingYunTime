import axios from 'axios'

// ========== 酷狗概念版 API ==========
// 优先使用本地部署的 KuGouMusicApi(localhost:3300,platform=lite),彻底杜绝 502
// 本地服务不可用时回退到在线线路
// 接口路径严格对照官方文档 https://kugoumusicapi-docs.4everland.app/
// 注意：baseURL 末尾不带 /，避免与接口路径开头的 / 拼成双斜杠导致反代 502

// 本地 API 基地址(Electron 主进程启动的 KuGouMusicApi 子进程)
const KUGOU_LOCAL_BASE = 'http://localhost:3300'
// 在线备用线路(本地服务不可用时回退)
const KUGOU_ONLINE_BASE = 'https://kgapi.xiaomingky.cn'

// 当前使用的 baseURL:优先本地,不可用时切在线
let KUGOU_BASE_URL = KUGOU_LOCAL_BASE
// 本地服务健康状态(启动时假设可用,首次请求失败后标记为不可用)
let _localAvailable = true

// 检测本地服务是否可用(启动时调用一次)
async function detectLocalAvailability() {
    try {
        const res = await fetch(`${KUGOU_LOCAL_BASE}/search/hot`, {
            signal: AbortSignal.timeout(3000)
        })
        _localAvailable = res.ok
        if (_localAvailable) {
            KUGOU_BASE_URL = KUGOU_LOCAL_BASE
            console.log('[Kugou API] 使用本地服务:', KUGOU_BASE_URL)
        } else {
            throw new Error('local not ok')
        }
    } catch (e) {
        _localAvailable = false
        KUGOU_BASE_URL = KUGOU_ONLINE_BASE
        console.warn('[Kugou API] 本地服务不可用,回退到在线线路:', KUGOU_BASE_URL)
    }
}
// 异步检测,不阻塞模块加载
detectLocalAvailability()

// localStorage key
const KUGOU_COOKIE_KEY = 'kugou_cookie'
const KUGOU_PROFILE_KEY = 'kugou_profile'
const KUGOU_DFID_KEY = 'kugou_dfid'

// ========== Cookie / Profile / dfid 读写 ==========
export function getKugouCookie() {
    return localStorage.getItem(KUGOU_COOKIE_KEY) || ''
}
export function setKugouCookie(token) {
    if (token) localStorage.setItem(KUGOU_COOKIE_KEY, token)
    else localStorage.removeItem(KUGOU_COOKIE_KEY)
}
export function clearKugouCookie() {
    localStorage.removeItem(KUGOU_COOKIE_KEY)
}
export function getKugouProfile() {
    const s = localStorage.getItem(KUGOU_PROFILE_KEY)
    try { return s ? JSON.parse(s) : null } catch { return null }
}
export function setKugouProfile(p) {
    if (p) localStorage.setItem(KUGOU_PROFILE_KEY, JSON.stringify(p))
    else localStorage.removeItem(KUGOU_PROFILE_KEY)
}
export function clearKugouProfile() {
    localStorage.removeItem(KUGOU_PROFILE_KEY)
}
export function getKugouUserid() {
    return getKugouProfile()?.userid || ''
}
function getKugouDfid() {
    return localStorage.getItem(KUGOU_DFID_KEY) || ''
}

// dfid 获取锁：避免并发请求时重复获取（不是递归锁，递归由下方独立实例规避）
let _dfidPromise = null

// ========== axios 实例 ==========
// baseURL 初始为本地线路,detectLocalAvailability() 完成后会动态更新
const kugouRequest = axios.create({
    baseURL: KUGOU_LOCAL_BASE,
    timeout: 30000,
    withCredentials: true
})

// dfid 专用实例：不带请求拦截器，避免 ensureDfid → 拦截器 → ensureDfid 无限递归导致 OOM
const _dfidRequest = axios.create({
    baseURL: KUGOU_LOCAL_BASE,
    timeout: 10000,
    withCredentials: true
})

// 动态更新 baseURL(本地服务不可用时切换到在线线路)
// 在请求拦截器里读取最新的 KUGOU_BASE_URL,确保切换生效
function updateBaseURLs() {
    kugouRequest.defaults.baseURL = KUGOU_BASE_URL
    _dfidRequest.defaults.baseURL = KUGOU_BASE_URL
}

async function ensureDfid() {
    let dfid = getKugouDfid()
    if (dfid) return dfid
    // 并发去重：多个请求同时进入拦截器时只发一次 /register/dev
    if (_dfidPromise) return _dfidPromise
    _dfidPromise = (async () => {
        try {
            // ⚠️ 实测：传 platform=lite 时 /register/dev 返回 data:[]（空数组，无 dfid）
            // 必须不传 platform 才能拿到 dfid，所以这里用裸 URL + 时间戳
            const ts = Date.now()
            const res = await _dfidRequest.get(`/register/dev?timestamp=${ts}`)
            // _dfidRequest 无响应拦截器，res 是 axios 原始响应
            // 实测响应：{ data: { dfid: "xxxx" }, status: 1, error_code: 0 }（res.data 是 body）
            // 但 _dfidRequest 的 res.data 可能是 { data: { dfid } } 或 { dfid }
            const body = res?.data || {}
            dfid = body?.data?.dfid || body?.dfid || ''
            if (dfid) {
                localStorage.setItem(KUGOU_DFID_KEY, dfid)
                console.log('[Kugou] ensureDfid 成功:', dfid)
            } else {
                console.warn('[Kugou] ensureDfid 响应无 dfid 字段:', body)
            }
        } catch (e) {
            console.warn('[Kugou] ensureDfid failed:', e.message)
        } finally {
            _dfidPromise = null
        }
        return dfid
    })()
    return _dfidPromise
}

// 请求拦截器：自动附加 token / userid / dfid / platform / cookie
// 文档明确要求：调用例子 /search?keywords=周杰伦&cookie=token=xxxx;userid=xxxx;dfid=xxxx
// 实测多个接口（/search、/user/playlist、/playlist/track/all 等）在未带认证信息时返回 502 或 error_code:152
// 统一策略：只要存在 token/dfid，就把 cookie 参数附加到所有请求上
kugouRequest.interceptors.request.use(async config => {
    // 每次请求前更新 baseURL(确保本地→在线切换生效)
    updateBaseURLs()
    config.baseURL = KUGOU_BASE_URL
    const token = getKugouCookie()
    const userid = getKugouUserid()
    let dfid = getKugouDfid()
    if (!dfid) {
        // 同步等待 dfid 获取完成（避免 cookie 缺 dfid 导致 502）
        dfid = await ensureDfid()
    }
    config.params = config.params || {}
    // 概念版固定标记
    config.params.platform = 'lite'
    // 时间戳防缓存
    if (!config.params.timestamp) config.params.timestamp = Date.now()
    // 统一附加 cookie 参数（token=xxx;userid=xxx;dfid=xxx）
    if (token || dfid) {
        const parts = []
        if (token) parts.push(`token=${token}`)
        if (userid) parts.push(`userid=${userid}`)
        if (dfid) parts.push(`dfid=${dfid}`)
        config.params.cookie = parts.join(';')
    }
    return config
})

// 响应拦截器：酷狗字段是 errcode/status/error_code（不是 code）
// 不能套用网易云 "data.code === undefined" 判断，否则会过度拆解 data.data
// 改为：原样返回 response.data，由调用方按需取 .data / .list / .rank_list 等字段
kugouRequest.interceptors.response.use(
    response => response.data,
    error => {
        // 本地服务连接失败(ECONNREFUSED/timeout)时,自动切换到在线线路并重试一次
        if (_localAvailable && error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
            console.warn('[Kugou API] 本地服务连接失败,切换到在线线路')
            _localAvailable = false
            KUGOU_BASE_URL = KUGOU_ONLINE_BASE
            updateBaseURLs()
            // 重试原请求
            const config = error.config
            if (config && !config._retried) {
                config._retried = true
                config.baseURL = KUGOU_BASE_URL
                return kugouRequest(config)
            }
        }
        if (error.response && error.response.data) return error.response.data
        console.error('[Kugou API] error:', error)
        return Promise.reject(error)
    }
)

// ========== 登录类 ==========
// 1. 手机登录：mobile + code（验证码由 /captcha/sent 获取）
//    多账户场景需传 userid 选择具体账户
export const kugouLoginCellphone = (mobile, code, userid = '') =>
    kugouRequest.get('/login/cellphone', { params: { mobile, code, userid } })
// 2. 用户名登录（文档标注不推荐：可能需要验证）
export const kugouLoginUsername = (username, password) =>
    kugouRequest.get('/login', { params: { username, password: encodeURIComponent(password) } })
// 3. 开放接口登录（微信扫码 wx_code 换 token）
export const kugouLoginOpenplat = (code) =>
    kugouRequest.get('/login/openplat', { params: { code } })
// 4. 酷狗二维码登录：key → create(qrimg) → 轮询 check
//    check 状态：0=过期 1=等待扫码 2=待确认 4=成功(返回 token)
export const kugouQrKey = () => kugouRequest.get('/login/qr/key')
export const kugouQrCreate = (key) =>
    kugouRequest.get('/login/qr/create', { params: { key, qrimg: true } })
export const kugouQrCheck = (key) => kugouRequest.get('/login/qr/check', { params: { key } })
// 5. 微信扫码登录：create 返回 uuid + 二维码 base64，check 状态码：
//    408=等待扫描 404=已扫描 403=拒绝 405=成功(返回 wx_code，需调 /login/openplat 换 token) 402=已过期
export const kugouWxCreate = () => kugouRequest.get('/login/wx/create')
export const kugouWxCheck = (uuid) =>
    kugouRequest.get('/login/wx/check', { params: { uuid } })
// 刷新登录态（延长 token 有效期）
export const kugouLoginToken = (token, userid) =>
    kugouRequest.get('/login/token', { params: { token, userid } })
// 发送验证码
export const kugouCaptchaSent = (mobile) =>
    kugouRequest.get('/captcha/sent', { params: { mobile } })

// ========== 用户类 ==========
// 文档：登陆后调用，不传 userid 自动从 cookie 识别
export const kugouUserDetail = () => kugouRequest.get('/user/detail')
export const kugouUserVip = () => kugouRequest.get('/user/vip/detail')
export const kugouUserPlaylist = (page = 1, pagesize = 30) =>
    kugouRequest.get('/user/playlist', { params: { page, pagesize } })
// 文档：登录后直接调用，无分页参数
export const kugouUserFollow = () => kugouRequest.get('/user/follow')
export const kugouUserFollowMessage = (id, pagesize = 30) =>
    kugouRequest.get('/user/follow/message', { params: { id, pagesize } })
export const kugouUserCloud = (page = 1, pagesize = 30) =>
    kugouRequest.get('/user/cloud', { params: { page, pagesize } })
export const kugouUserCloudUrl = (hash, album_id = '', name = '', album_audio_id = '') =>
    kugouRequest.get('/user/cloud/url', { params: { hash, album_id, name, album_audio_id } })
export const kugouUserCloudUpload = (formData) =>
    kugouRequest.post('/user/cloud/upload', formData, {
        headers: { 'Content-Type': 'application/octet-stream' }
    })
export const kugouUserVideoCollect = (page = 1, pagesize = 30) =>
    kugouRequest.get('/user/video/collect', { params: { page, pagesize } })
export const kugouUserVideoLove = (pagesize = 30) =>
    kugouRequest.get('/user/video/love', { params: { pagesize } })
export const kugouUserListen = (type = 0) =>
    kugouRequest.get('/user/listen', { params: { type } })
export const kugouUserHistory = (bp = '') =>
    kugouRequest.get('/user/history', { params: { bp } })
export const kugouLastestSongsListen = (pagesize = 30) =>
    kugouRequest.get('/lastest/songs/listen', { params: { pagesize } })
export const kugouUserPurchasedSongs = (page = 1, pagesize = 50) =>
    kugouRequest.get('/user/purchased/songs', { params: { page, pagesize } })
export const kugouUserPurchasedAlbums = (page = 1, pagesize = 15) =>
    kugouRequest.get('/user/purchased/albums', { params: { page, pagesize } })

// ========== 搜索类 ==========
// type: special(歌单) / lyric(歌词) / song(单曲) / album(专辑) / author(歌手) / mv
export const kugouSearch = (keywords, page = 1, pagesize = 30, type = '') =>
    kugouRequest.get('/search', { params: { keywords, page, pagesize, type } })
export const kugouComplexSearch = (keywords, page = 1, pagesize = 30) =>
    kugouRequest.get('/search/complex', { params: { keywords, page, pagesize } })
export const kugouSearchSuggest = (keywords, musicTipCount = 8, mvTipCount = 3, albumTipCount = 3) =>
    kugouRequest.get('/search/suggest', { params: { keywords, musicTipCount, mvTipCount, albumTipCount } })
export const kugouSearchHot = () => kugouRequest.get('/search/hot')
export const kugouSearchDefault = () => kugouRequest.get('/search/default')
export const kugouSearchLyric = (keywords, hash = '', album_audio_id = '', duration = 0, man = 'no') =>
    kugouRequest.get('/search/lyric', {
        params: { keywords, hash, album_audio_id, duration, man }
    })

// ========== 歌曲类 ==========
// 旧版：单音质请求（quality 参数）
// quality: piano/acappella/subwoofer/ancient/surnay/dj/128/320/flac/high/viper_atmos/viper_clear/viper_tape/super
export const kugouSongUrl = (hash, quality = '128', album_id = '', album_audio_id = '', free_part = '') =>
    kugouRequest.get('/song/url', { params: { hash, quality, album_id, album_audio_id, free_part } })
// 新版：一次拿全音质 URL（默认走这个，失败回退旧版）
// 注意：新版存在音频加密（目前无法解码），如失败请回退 /song/url
export const kugouSongUrlNew = (hash, album_audio_id = '', free_part = '') =>
    kugouRequest.get('/song/url/new', { params: { hash, album_audio_id, free_part } })
// 音乐详情：/privilege/lite 返回的是权限信息(无 mixsongid)
// /audio 返回歌曲完整信息(含 mixsongid/songid/album_audio_id 等)，评论接口需要 mixsongid
export const kugouSongDetail = (hash) =>
    kugouRequest.get('/audio', { params: { hash } })
// 音乐相关信息：/audio
export const kugouSongInfo = (hash) =>
    kugouRequest.get('/audio', { params: { hash } })
// 歌曲高潮部分
export const kugouSongClimax = (hash) =>
    kugouRequest.get('/song/climax', { params: { hash } })
// 歌曲推荐：card_id 1-6 普通版（文档：仅有 card_id）
export const kugouSongRecommend = (card_id = 1) =>
    kugouRequest.get('/top/card', { params: { card_id } })
// 概念版歌曲推荐：card_id 3001-3104，支持 pagesize
export const kugouSongRecommendYouth = (card_id = 3001, pagesize = 30) =>
    kugouRequest.get('/top/card/youth', { params: { card_id, pagesize } })
// 更多音乐版本
export const kugouAudioRelated = (album_audio_id, page = 1, pagesize = 30, show_detail = 1, sort = 'all') =>
    kugouRequest.get('/audio/related', { params: { album_audio_id, page, pagesize, show_detail, sort } })
// 音乐专辑/歌手信息
export const kugouKrmAudio = (album_audio_id, fields = '') =>
    kugouRequest.get('/krm/audio', { params: { album_audio_id, fields } })
// 歌曲成绩单
export const kugouSongRanking = (album_audio_id) =>
    kugouRequest.get('/song/ranking', { params: { album_audio_id } })
export const kugouSongRankingFilter = (album_audio_id, page = 1, pagesize = 30) =>
    kugouRequest.get('/song/ranking/filter', { params: { album_audio_id, page, pagesize } })
// 歌词
export const kugouLyric = (id, accesskey, fmt = 'lrc', decode = '') =>
    kugouRequest.get('/lyric', { params: { id, accesskey, fmt, decode } })
// 收藏数 / 评论数
export const kugouFavoriteCount = (mixsongids) =>
    kugouRequest.get('/favorite/count', { params: { mixsongids } })
export const kugouCommentCount = (hash = '', special_id = '') =>
    kugouRequest.get('/comment/count', { params: { hash, special_id } })
// 获取歌手和专辑图片 / 歌手图片
export const kugouImages = (hash, album_id = '', album_audio_id = '', count = 5) =>
    kugouRequest.get('/images', { params: { hash, album_id, album_audio_id, count } })
export const kugouImagesAudio = (hash, audio_id = '', album_audio_id = '', filename = '', count = 5) =>
    kugouRequest.get('/images/audio', { params: { hash, audio_id, album_audio_id, filename, count } })
// 听歌识曲（POST + PCM 二进制）
export const kugouAudioMatch = (pcmArrayBuffer) =>
    kugouRequest.post('/audio/match', pcmArrayBuffer, {
        headers: { 'Content-Type': 'application/octet-stream' }
    })

// ========== 专辑类 ==========
// /album 是专辑信息，/album/detail 是专辑详情，/album/songs 是专辑音乐列表
export const kugouAlbumInfo = (album_id, fields = '') =>
    kugouRequest.get('/album', { params: { album_id, fields } })
export const kugouAlbumDetail = (id) =>
    kugouRequest.get('/album/detail', { params: { id } })
export const kugouAlbumSongs = (id, page = 1, pagesize = 30) =>
    kugouRequest.get('/album/songs', { params: { id, page, pagesize } })
// 新碟上架：type 1华语 2欧美 3日本 4韩国，空为推荐
export const kugouAlbumNew = (page = 1, pagesize = 30, type = '') =>
    kugouRequest.get('/top/album', { params: { page, pagesize, type } })

// ========== 歌单类 ==========
// 歌单分类
export const kugouPlaylistCategory = () => kugouRequest.get('/playlist/tags')
// 歌单列表：category_id=0 推荐
export const kugouPlaylist = (category_id = 0, withsong = 0, withtag = 0, page = 1, pagesize = 30) =>
    kugouRequest.get('/top/playlist', { params: { category_id, withsong, withtag, page, pagesize } })
// 主题歌单
export const kugouPlaylistTheme = () => kugouRequest.get('/theme/playlist')
// 音效歌单
export const kugouPlaylistEffect = (page = 1, pagesize = 30) =>
    kugouRequest.get('/playlist/effect', { params: { page, pagesize } })
// 歌单详情：ids 是 global_collection_id（可多个，逗号分隔）
// 文档：仅有 ids 参数
export const kugouPlaylistDetail = (ids) =>
    kugouRequest.get('/playlist/detail', { params: { ids } })
// 歌单所有歌曲（旧版）
export const kugouPlaylistSongs = (id, page = 1, pagesize = 30) =>
    kugouRequest.get('/playlist/track/all', { params: { id, page, pagesize } })
// 歌单所有歌曲（新版，仅支持用户创建/收藏的歌单，参数是 listid）
export const kugouPlaylistSongsNew = (listid, page = 1, pagesize = 30) =>
    kugouRequest.get('/playlist/track/all/new', { params: { listid, page, pagesize } })
// 相似歌单
export const kugouPlaylistSimilar = (ids) =>
    kugouRequest.get('/playlist/similar', { params: { ids } })
// 主题歌单所有歌曲
export const kugouThemePlaylistTrack = (theme_id) =>
    kugouRequest.get('/theme/playlist/track', { params: { theme_id } })

// 歌单管理：收藏/新建/删除/添加歌曲/删除歌曲
// 收藏歌单(type=1) / 新建歌单(type=0)，需登录
// name + list_create_userid + list_create_listid + type + is_pri + list_create_gid + source
export const kugouPlaylistAdd = (name, list_create_userid = '', list_create_listid = '', type = 0, is_pri = 0, list_create_gid = '', source = 1) =>
    kugouRequest.get('/playlist/add', {
        params: { name, list_create_userid, list_create_listid, type, is_pri, list_create_gid, source }
    })
// 删除歌单/取消收藏歌单
export const kugouPlaylistDel = (listid) =>
    kugouRequest.get('/playlist/del', { params: { listid } })
// 添加歌曲到歌单：data 格式 "歌曲名|hash|专辑id|album_audio_id"，多个用逗号分隔
export const kugouPlaylistTracksAdd = (listid, data) =>
    kugouRequest.get('/playlist/tracks/add', { params: { listid, data } })
// 删除歌曲从歌单：fileids 可多个,用逗号隔开
export const kugouPlaylistTracksDel = (listid, fileids) =>
    kugouRequest.get('/playlist/tracks/del', { params: { listid, fileids } })

// 喜欢/取消喜欢歌曲（基于"我喜欢"歌单操作）
// 文档无单独 like 接口，通过添加/删除到"我喜欢"歌单实现
// data 参数格式："歌曲名|hash|专辑id|album_audio_id"
export const kugouLikeSong = (likedListId, songName, hash, albumId = '', mixsongid = '') => {
    const data = [songName, hash, albumId, mixsongid].filter(Boolean).join('|')
    return kugouPlaylistTracksAdd(likedListId, data)
}
export const kugouUnlikeSong = (likedListId, fileid) =>
    kugouPlaylistTracksDel(likedListId, fileid)

// ========== 视频类（MV） ==========
// 获取视频 URL：传入视频 hash
export const kugouVideoUrl = (hash) =>
    kugouRequest.get('/video/url', { params: { hash } })
// 获取歌曲 MV：传入 album_audio_id/MixSongID（可多个，逗号分隔）
// fields 支持多个：mkv,tags,h264,h265,authors
export const kugouSongMv = (album_audio_id, fields = '') =>
    kugouRequest.get('/kmr/audio/mv', { params: { album_audio_id, fields } })
// 获取视频相关信息（hash，可多个）
export const kugouVideoInfo = (hash) =>
    kugouRequest.get('/video/privilege', { params: { hash } })
// 获取视频详情：传入视频 id
export const kugouVideoDetail = (id) =>
    kugouRequest.get('/video/detail', { params: { id } })

// ========== 歌手类 ==========
// 歌手列表：文档只有 sextypes/type/musician/hotsize
export const kugouSingerList = (sextypes = 0, type = 0, musician = 0, hotsize = 30) =>
    kugouRequest.get('/artist/lists', { params: { sextypes, type, musician, hotsize } })
export const kugouSingerDetail = (id) =>
    kugouRequest.get('/artist/detail', { params: { id } })
export const kugouSingerAlbum = (id, page = 1, pagesize = 30, sort = 'hot') =>
    kugouRequest.get('/artist/albums', { params: { id, page, pagesize, sort } })
export const kugouSingerSong = (id, page = 1, pagesize = 30, sort = 'hot') =>
    kugouRequest.get('/artist/audios', { params: { id, page, pagesize, sort } })
export const kugouSingerMv = (id, page = 1, pagesize = 30, tag = 'all') =>
    kugouRequest.get('/artist/videos', { params: { id, page, pagesize, tag } })
export const kugouSingerFollow = (id) =>
    kugouRequest.get('/artist/follow', { params: { id } })
export const kugouSingerUnfollow = (id) =>
    kugouRequest.get('/artist/unfollow', { params: { id } })
export const kugouSingerFollowNewsongs = (pagesize = 30, opt_sort = 1, last_album_id = '') =>
    kugouRequest.get('/artist/follow/newsongs', { params: { pagesize, opt_sort, last_album_id } })

// ========== 排行榜 ==========
export const kugouRankList = (withsong = 0) =>
    kugouRequest.get('/rank/list', { params: { withsong } })
export const kugouRankRecommend = () => kugouRequest.get('/rank/top')
export const kugouRankHistory = (rankid, rank_cid = '') =>
    kugouRequest.get('/rank/vol', { params: { rankid, rank_cid } })
export const kugouRankInfo = (rankid, rank_cid = '', album_img = 1, zone = '') =>
    kugouRequest.get('/rank/info', { params: { rankid, rank_cid, album_img, zone } })
export const kugouRankSongs = (rankid, page = 1, pagesize = 30, rank_cid = '') =>
    kugouRequest.get('/rank/audio', { params: { rankid, page, pagesize, rank_cid } })

// ========== 评论 ==========
// 歌曲评论：mixsongid（不是 hash）
export const kugouCommentSong = (mixsongid, page = 1, pagesize = 30, show_classify = 0, show_hotword_list = 0) =>
    kugouRequest.get('/comment/music', { params: { mixsongid, page, pagesize, show_classify, show_hotword_list } })
export const kugouCommentSongClassify = (mixsongid, type_id, page = 1, pagesize = 30, sort = 2) =>
    kugouRequest.get('/comment/music/classify', { params: { mixsongid, type_id, page, pagesize, sort } })
export const kugouCommentSongHotword = (mixsongid, hot_word, page = 1, pagesize = 30) =>
    kugouRequest.get('/comment/music/hotword', { params: { mixsongid, hot_word, page, pagesize } })
export const kugouCommentPlaylist = (id, page = 1, pagesize = 30, show_classify = 0, show_hotword_list = 0) =>
    kugouRequest.get('/comment/playlist', { params: { id, page, pagesize, show_classify, show_hotword_list } })
export const kugouCommentAlbum = (id, page = 1, pagesize = 30, show_classify = 0, show_hotword_list = 0) =>
    kugouRequest.get('/comment/album', { params: { id, page, pagesize, show_classify, show_hotword_list } })
export const kugouCommentFloor = (special_id, mixsongid, tid, page = 1, pagesize = 30) =>
    kugouRequest.get('/comment/floor', { params: { special_id, mixsongid, tid, page, pagesize } })

// ========== 主题音乐 ==========
export const kugouThemeMusic = () => kugouRequest.get('/theme/music')
export const kugouThemeMusicDetail = (id) =>
    kugouRequest.get('/theme/music/detail', { params: { id } })

// ========== 其他首页 / 推荐 ==========
// banner（文档接口是 /pc/diantai）
export const kugouBanner = () => kugouRequest.get('/pc/diantai')
// 乐库相关
export const kugouLibrary = () => kugouRequest.get('/yueku')
export const kugouLibraryBanner = () => kugouRequest.get('/yueku/banner')
export const kugouLibraryRadio = () => kugouRequest.get('/yueku/fm')
// 电台
export const kugouFmClass = () => kugouRequest.get('/fm/class')
export const kugouFmRecommend = () => kugouRequest.get('/fm/recommend')
export const kugouFmImage = (fmid) =>
    kugouRequest.get('/fm/image', { params: { fmid } })
export const kugouFmSongs = (fmid, fmtype = '', fmoffset = '', fmsize = '') =>
    kugouRequest.get('/fm/songs', { params: { fmid, fmtype, fmoffset, fmsize } })
// 编辑精选
export const kugouTopIp = () => kugouRequest.get('/top/ip')
export const kugouIp = (id, type = '', page = 1, pagesize = 30) =>
    kugouRequest.get('/ip', { params: { id, type, page, pagesize } })
export const kugouIpPlaylist = (id, page = 1, pagesize = 30) =>
    kugouRequest.get('/ip/playlist', { params: { id, page, pagesize } })
export const kugouIpZone = () => kugouRequest.get('/ip/zone')
export const kugouIpZoneHome = (id) =>
    kugouRequest.get('/ip/zone/home', { params: { id } })

// 新歌速递（文档接口是 /top/song）
export const kugouNewSong = () => kugouRequest.get('/top/song')
// 每日推荐 / 历史推荐 / 风格推荐
export const kugouDailyRecommend = (platform = 'ios') =>
    kugouRequest.get('/everyday/recommend', { params: { platform } })
export const kugouDailyHistory = (mode = 'list', history_name = '', date = '', platform = 'ios') =>
    kugouRequest.get('/everyday/history', { params: { mode, history_name, date, platform } })
export const kugouDailyStyleRecommend = (tagids = '', platform = 'ios') =>
    kugouRequest.get('/everyday/style/recommend', { params: { tagids, platform } })
// 私人 FM
export const kugouPersonalFm = (params = {}) =>
    kugouRequest.get('/personal/fm', { params })

// 场景音乐
export const kugouSceneLists = () => kugouRequest.get('/scene/lists')
export const kugouSceneModule = (id) =>
    kugouRequest.get('/scene/module', { params: { id } })

// 刷刷 / AI 推荐
export const kugouBrush = () => kugouRequest.get('/brush')
export const kugouAiRecommend = (album_audio_id) =>
    kugouRequest.get('/ai/recommend', { params: { album_audio_id } })

// 提交听歌历史
export const kugouPlayhistoryUpload = (mxid, ot = '', pc = 0) =>
    kugouRequest.get('/playhistory/upload', { params: { mxid, ot, pc } })
// 服务器时间
export const kugouServerNow = () => kugouRequest.get('/server/now')

// ========== 概念版 VIP 领取（仅概念版可用） ==========
export const kugouYouthVip = () => kugouRequest.get('/youth/vip')
export const kugouYouthDayVip = (receive_day) =>
    kugouRequest.get('/youth/day/vip', { params: { receive_day } })
export const kugouYouthDayVipUpgrade = () => kugouRequest.get('/youth/day/vip/upgrade')
export const kugouYouthMonthVipRecord = () => kugouRequest.get('/youth/month/vip/record')
export const kugouYouthUnionVip = () => kugouRequest.get('/youth/union/vip')

// ========== 概念版频道 ==========
export const kugouChannelAll = (page = 1, pagesize = 30) =>
    kugouRequest.get('/youth/channel/all', { params: { page, pagesize } })
export const kugouChannelDetail = (global_collection_id) =>
    kugouRequest.get('/youth/channel/detail', { params: { global_collection_id } })
export const kugouChannelAmway = (global_collection_id) =>
    kugouRequest.get('/youth/channel/amway', { params: { global_collection_id } })
export const kugouChannelSimilar = (channel_id) =>
    kugouRequest.get('/youth/channel/similar', { params: { channel_id } })
export const kugouChannelSub = (global_collection_id, t = 1) =>
    kugouRequest.get('/youth/channel/sub', { params: { global_collection_id, t } })
export const kugouChannelSong = (global_collection_id, page = 1, pagesize = 30) =>
    kugouRequest.get('/youth/channel/song', { params: { global_collection_id, page, pagesize } })
export const kugouChannelSongDetail = (global_collection_id, fileid) =>
    kugouRequest.get('/youth/channel/song/detail', { params: { global_collection_id, fileid } })
export const kugouDynamicRecent = () => kugouRequest.get('/youth/dynamic/recent')
export const kugouYouthUserSong = (userid, page = 1, pagesize = 30) =>
    kugouRequest.get('/youth/user/song', { params: { userid, page, pagesize } })

// ========== 听书 ==========
export const kugouLongaudioDailyRecommend = (page = 1, pagesize = 30) =>
    kugouRequest.get('/longaudio/daily/recommend', { params: { page, pagesize } })
export const kugouLongaudioRankRecommend = () => kugouRequest.get('/longaudio/rank/recommend')
export const kugouLongaudioVipRecommend = () => kugouRequest.get('/longaudio/vip/recommend')
export const kugouLongaudioWeekRecommend = () => kugouRequest.get('/longaudio/week/recommend')
export const kugouLongaudioAlbumDetail = (album_id) =>
    kugouRequest.get('/longaudio/album/detail', { params: { album_id } })
export const kugouLongaudioAlbumAudios = (album_id) =>
    kugouRequest.get('/longaudio/album/audios', { params: { album_id } })

// ========== 验证码（错误码 20028 时使用） ==========
export const kugouGetVerifyInfo = (eventid) =>
    kugouRequest.get('/get/verify/info', { params: { eventid } })
export const kugouVerifyUserInfo = (eventid, v_type, verifycode, sid, edt) =>
    kugouRequest.get('/verify/user/info', { params: { eventid, v_type, verifycode, sid, edt } })

// ========== 曲谱 ==========
export const kugouSheetSong = (album_audio_id, instruments = 1, level = 0) =>
    kugouRequest.get('/sheet/song', { params: { album_audio_id, instruments, level } })
export const kugouSheetDetail = (opern_id) =>
    kugouRequest.get('/sheet/detail', { params: { id: opern_id } })
export const kugouSheetRank = (instruments = 1, level = 0, page = 1, pagesize = 30) =>
    kugouRequest.get('/sheet/rank', { params: { instruments, level, page, pagesize } })
export const kugouSheetExplore = (instruments = 1, level = 0, page = 1, pagesize = 30, tagid = '') =>
    kugouRequest.get('/sheet/explore', { params: { instruments, level, page, pagesize, tagid } })
export const kugouSheetTags = () => kugouRequest.get('/sheet/tags')

// ========== 标准化函数 ==========
// 幂等保护：已标准化对象直接返回
// 真实响应字段（实测）：
//   /playlist/track/all songs[]: hash/name/album_id/audio_id/mixsongid/mvhash/timelen(毫秒)/cover/privilege/singerinfo[]/albuminfo/trans_param
//   /artist/audios data[]:       hash/audio_name/album_id/audio_id/album_audio_id/songid/author_name/timelength(毫秒)/extname/privilege/trans_param
//   注意：不是 songname/singer/img/duration，而是 name或audio_name/singerinfo或author_name/cover或trans_param.union_cover/timelen或timelength
export const normalizeKugouSong = (song) => {
    if (!song) return null
    // 幂等保护
    if (song.platform === 'kugou' && song.hash && song.name && Array.isArray(song.singer)) {
        return song
    }
    // 字段兼容：搜索响应是 PascalCase，其他接口是小写/snake_case
    // 搜索字段：SongName/SingerName/FileHash/AlbumID/AlbumName/Image/Duration(秒)/MixSongID/Audioid/MvHash/Privilege/PayType/FileName/Singers[]
    // 歌单字段：name/audio_name/hash/album_id/album_audio_id/songid/mvhash/timelen(毫秒)/cover/privilege/singerinfo[]/albuminfo/trans_param
    // 歌手作品：audio_name/album_id/audio_id/album_audio_id/songid/author_name/timelength(毫秒)/extname/privilege/trans_param
    // 专辑字段(/album/songs): 嵌套结构 base{audio_name,author_name,album_id,album_audio_id,audio_id}/audio_info{hash,duration(毫秒)}/album_info{album_name,cover}/authors[]{author_name}
    // 预处理:将专辑接口的嵌套字段展平,后续逻辑统一处理
    // ⚠️ audio_info.duration 单位是毫秒,必须映射到 timelength(毫秒)字段,不能映射到 duration(会被当秒处理导致放大1000倍)
    if (song.base || song.audio_info || song.album_info) {
        const b = song.base || {}
        const ai = song.audio_info || {}
        const al = song.album_info || {}
        const au = song.authors || []
        song = {
            ...song,
            audio_name: b.audio_name || song.audio_name || '',
            author_name: b.author_name || (au[0]?.author_name) || song.author_name || '',
            album_id: b.album_id || song.album_id || '',
            album_audio_id: b.album_audio_id || song.album_audio_id || '',
            audio_id: b.audio_id || song.audio_id || '',
            hash: ai.hash || song.hash || '',
            // audio_info.duration 是毫秒,映射到 timelength 避免被当秒处理
            timelength: ai.duration || song.timelength || song.timelen || 0,
            album_name: al.album_name || song.album_name || '',
            cover: al.cover || song.cover || '',
            authors: au.length ? au : song.authors
        }
    }
    let songName = song.songname || song.SongName || song.name || song.audio_name || song.FileName || song.filename || ''
    songName = String(songName || '').trim()
    // 去除文件扩展名（audio_name/FileName 常带 .mp3/.flac/.m4a 后缀）
    songName = songName.replace(/\.(mp3|flac|m4a|ape|ogg|wma|aac)$/i, '')
    // 歌手优先级（兼容搜索 PascalCase 和其他接口）：
    //   Singers[] > singers[] > singerinfo[] > singer[] > authors[]
    //   SingerName(字符串) > singername > author_name > singer_name
    const singers = song.Singers || song.singerinfo || song.singer || song.singers || song.authors || []
    let artistStr = ''
    if (Array.isArray(singers) && singers.length) {
        artistStr = singers.map(s => (typeof s === 'string' ? s : s.name || s.author_name || s.singername || '')).filter(Boolean).join('/')
    }
    if (!artistStr) artistStr = song.SingerName || song.singername || song.author_name || song.singer_name || ''
    // 歌曲名拆分：如果 songName 是 "歌手 - 歌名" 格式，总是拆分
    // 搜索/歌单返回的 SongName/audio_name 常带 "歌手 - 歌名" 格式
    // 即使 Singers 数组有数据也要拆分，因为 songName 本身就包含了歌手前缀
    if (songName && songName.indexOf(' - ') > 0) {
        const parts = songName.split(' - ')
        if (parts.length >= 2) {
            // 如果 artistStr 为空，用前面部分作为歌手
            if (!artistStr) artistStr = parts[0].trim()
            songName = parts.slice(1).join(' - ').trim()
        }
    }
    // 歌手里的中文顿号 、 转为 / 分隔（如 "King CAAN、ELYSA" → "King CAAN/ELYSA"）
    if (artistStr) artistStr = artistStr.replace(/、/g, '/')
    // 封面优先级（兼容搜索 Image 和其他接口 cover/img/pic）
    let picUrl = song.Image || song.cover || song.img || song.albumpic || song.pic || ''
    if (!picUrl) {
        const uc = song.trans_param?.union_cover || song.album_sizable_cover || ''
        if (uc) picUrl = String(uc).replace('{size}', '480')
    }
    if (picUrl && picUrl.indexOf('{size}') >= 0) picUrl = picUrl.replace('{size}', '480')
    // 协议补全
    if (picUrl && picUrl.startsWith('//')) picUrl = 'https:' + picUrl
    // 时长：搜索 Duration 是秒，其他接口 timelen/timelength 是毫秒
    const durationSec = song.Duration || song.duration || 0
    const durationMs = song.timelen || song.timelength || 0
    const duration = durationMs ? Math.floor(durationMs) : (durationSec ? Math.floor(durationSec * 1000) : 0)
    // hash：搜索用 FileHash，其他用 hash
    // ⚠️ hash 是歌曲文件的唯一标识,必须精确提取,不能用其他 ID 兜底
    // 兼容更多字段名:FileHash/hash/Hash/filehash/Filehash
    const hash = song.FileHash || song.hash || song.Hash || song.filehash || song.Filehash || ''
    // mixsongid：文档明确 mixsongid = album_audio_id(同一个东西)
    // 评论接口 /comment/music 用的是 mixsongid(即 album_audio_id),不是 songid!
    // 优先取 MixSongID/mixsongid,没有则用 album_audio_id/Audioid 兜底
    const album_audio_id = song.album_audio_id || song.Audioid || ''
    const mixsongid = song.MixSongID || song.mixsongid || album_audio_id || ''
    // VIP 判断（兼容搜索 PascalCase 和其他接口 snake_case）
    // 酷狗 Privilege 值：0=免费 1=VIP 4=付费 5=VIP+付费 8=仅试听 10=数字专辑/仅试听+下载
    // 搜索响应：顶层无 Privilege，VIP 信息在 AlbumPrivilege 和嵌套 HQ/SQ/Res.Privilege 里
    // 歌单/歌手响应：顶层有 privilege（小写）
    // PayType/pay_type: 数字 0=免费 1=VIP / 字符串 "vip"
    // trans_param: { pay_type, play_type, is_vip }（部分接口有）
    const _toNum = v => Number(v ?? 0)
    // 收集所有可能的 Privilege 值（顶层 + 嵌套 HQ/SQ/Res + media_privilege）
    // ⚠️ /playlist/track/all/new(新版,我喜欢/我创建的歌单) 返回的是 media_privilege,
    //    没有顶层 privilege!必须兼容 media_privilege/MediaPrivilege
    const _privValues = [
        _toNum(song.Privilege), _toNum(song.privilege),
        _toNum(song.AlbumPrivilege), _toNum(song.album_privilege),
        _toNum(song.HQ?.Privilege), _toNum(song.SQ?.Privilege), _toNum(song.Res?.Privilege),
        _toNum(song.hq?.privilege), _toNum(song.sq?.privilege), _toNum(song.res?.privilege),
        _toNum(song.media_privilege), _toNum(song.MediaPrivilege)
    ]
    // 任一 Privilege 值 > 0（非免费），判定为 VIP（2=仅下载权限也视为 VIP）
    const _hasVipPriv = _privValues.some(p => p > 0)
    const _payTypeNum = _toNum(song.PayType ?? song.pay_type)
    const _payTypeStr = String(song.PayType ?? song.pay_type ?? '').toLowerCase()
    const _transParam = song.trans_param || {}
    const _transPayType = _toNum(_transParam.pay_type)
    const _transPlayType = _toNum(_transParam.play_type)
    const isVip = !!(
        song.is_vip || song.IsVip || _transParam.is_vip ||
        _hasVipPriv ||
        _payTypeNum === 1 || _payTypeStr.includes('vip') ||
        _transPayType === 1 || _transPayType === 4 || _transPayType === 8 ||
        _transPlayType === 1 || _transPlayType === 4 || _transPlayType === 8 ||
        false
    )
    return {
        id: hash,
        hash,
        trackId: album_audio_id || mixsongid || '',
        album_audio_id,
        audio_id: song.audio_id || '',
        mixsongid,
        // fileid: 从歌单删除歌曲时需要的字段(酷狗文档 /playlist/tracks/del 需要 fileids)
        // 兼容多种字段名: fileid / file_id / songid / song_id / SongID
        fileid: song.fileid || song.file_id || song.FileID || song.songid || song.song_id || song.SongID || song.Audioid || hash,
        songname: songName,
        name: songName,
        singer: Array.isArray(singers) ? singers : [],
        artist: artistStr || '未知歌手',
        album_id: song.album_id || song.AlbumID || (song.albuminfo?.id) || '',
        albumName: song.albuminfo?.name || song.album_name || song.AlbumName || '',
        album: song.albuminfo?.name || song.album_name || song.AlbumName || '',
        duration,
        // fee: 模板用 s.fee === 1 判断 VIP，此处统一设置(isVip 时 fee=1)
        fee: isVip ? 1 : (song.fee || song.feetype || 0),
        isVip,
        mvHash: song.mvhash || song.MvHash || song.video_hash || '',
        picUrl,
        platform: 'kugou'
    }
}

export const toKugouTrack = (song) => {
    const s = normalizeKugouSong(song)
    if (!s || !s.hash) return null
    return {
        id: s.hash,
        hash: s.hash,
        songname: s.songname,
        name: s.name,
        singer: s.singer,
        artist: s.artist,
        album_id: s.album_id,
        album_audio_id: s.album_audio_id,
        mixsongid: s.mixsongid,
        album: s.albumName,
        al: { name: s.albumName, picUrl: s.picUrl },
        duration: s.duration,
        fee: s.fee,
        isVip: s.isVip,
        mvHash: s.mvHash,
        picUrl: s.picUrl,
        platform: 'kugou'
    }
}

export const normalizeKugouPlaylist = (p, currentUserId = '') => {
    if (!p) return null
    // 真实响应字段（实测）：
    //   /top/playlist → data.special_list[]: specialid/global_collection_id/specialname/imgurl/play_count/collectcount/intro/nickname/singername
    //   /user/playlist → data.info[]: listid/global_collection_id/name/pic/count/list_create_username/list_create_userid/type
    //   /search?type=special → info[]: specialid/global_collection_id/specialname/imgurl/imgurl_min/pic/pic_min/singername/play_count
    //   /playlist/detail → 返回歌单完整元信息
    let cover = p.imgurl || p.picurl || p.flexible_cover || p.sizable_cover ||
        p.pic || p.Pic || p.k_pic || p.imgurl_min || p.pic_min || p.img || p.cover || ''
    if (cover && cover.indexOf('{size}') >= 0) cover = cover.replace('{size}', '480')
    if (cover && cover.startsWith('//')) cover = 'https:' + cover
    // 某些搜索结果封面只有文件名,需要拼接前缀
    if (cover && !cover.startsWith('http') && !cover.startsWith('//') && cover.length < 100) {
        cover = 'https://imge.kugou.com/stdmusic/480/' + cover
    }
    // id 优先级：listid 优先（用户歌单场景，PlaylistDetail 会用 listid 调用新版接口）
    // 推荐歌单没有 listid，自动回退到 global_collection_id
    // 注意:搜索结果返回 gid 字段(即 global_collection_id),/playlist/track/all 需用它而非 specialid
    const gcid = p.global_collection_id || p.gid || ''
    const id = p.listid || gcid || p.specialid || p.id || ''
    // 区分创建/收藏：list_create_userid === 当前用户id 则为创建，否则为收藏
    // type 字段不可靠（实测自己创建的 type 也是 0）
    const creatorId = p.list_create_userid || p.create_userid || p.suid || ''
    const isMine = !!(currentUserId && creatorId && String(creatorId) === String(currentUserId))
    return {
        id,
        global_collection_id: gcid,
        // list_create_gid: 收藏歌单时保存的"创建者真实 gcid"(实测 /user/playlist 收藏歌单返回此字段)
        // /playlist/track/all(旧版) 用 global_collection_id(收藏条目) 会报 error_code 20010,
        // 必须用 list_create_gid 才能取到歌曲数据
        list_create_gid: p.list_create_gid || '',
        specialid: p.specialid || '',
        listid: p.listid || '',
        name: p.specialname || p.name || p.Name || p.special_name || p.specialname_min || '',
        coverImgUrl: cover,
        creator: p.list_create_username || p.create_username || p.nickname || (p.creator?.name || '') || (p.singername || ''),
        creatorId,
        isMine,
        playCount: p.play_count || p.playcount || p.collectcount || p.heat || 0,
        songCount: p.songcount || p.count || p.Count || p.song_count || 0
    }
}

export const normalizeKugouAlbum = (a) => {
    if (!a) return null
    // 真实响应字段（实测 /top/album、/album/detail → data[]）：
    //   album_id/album_name/sizable_cover/author_name/publish_date/intro/authors[]/language
    //   /search?type=album → 可能用不同字段名
    let cover = a.sizable_cover || a.imgurl || a.picurl || a.cover || a.pic || a.img || a.sizable_avatar || a.thumb || ''
    if (cover && cover.indexOf('{size}') >= 0) cover = cover.replace('{size}', '480')
    if (cover && cover.startsWith('//')) cover = 'https:' + cover
    // sizable_cover 是完整 URL，cover 仅是文件名（需拼接），优先用 sizable_cover
    if (!cover && a.cover) {
        cover = 'http://imge.kugou.com/stdmusic/480/' + a.cover
    }
    return {
        id: a.albumid || a.album_id || a.specialid || a.id || '',
        album_id: a.albumid || a.album_id || a.specialid || a.id || '',
        name: a.albumname || a.album_name || a.name || a.albumname_min || '',
        picUrl: cover,
        artist: a.singername || a.author_name || (a.authors?.[0]?.author_name) || a.singer || a.artist || '',
        publishTime: a.publishdate || a.publish_date || a.publishtime || '',
        intro: a.intro || a.description || ''
    }
}

export const normalizeKugouSinger = (s) => {
    if (!s) return null
    // 真实响应字段（实测）：
    //   /artist/lists → data.info[].singer[]: singerid/singername/imgurl/fanscount/songcount/albumcount/mvcount/dycover.first_frame_image
    //   /artist/detail → data: author_id/author_name/sizable_avatar/fansnums/song_count/album_count/mv_count/intro/long_intro/birthday/area_id
    //   /search?type=author → lists[]: AuthorId/AuthorName/Avatar/FansNum/AlbumCount/AudioCount/VideoCount/FirstFrameImage( PascalCase )
    let pic = s.imgurl || s.picurl || (s.dycover?.first_frame_image) || s.sizable_avatar ||
        s.Avatar || s.avatar || s.pic || s.img || s.headpic || s.FirstFrameImage || ''
    if (pic && pic.indexOf('{size}') >= 0) pic = pic.replace('{size}', '480')
    if (pic && pic.startsWith('//')) pic = 'https:' + pic
    return {
        id: s.singerid || s.author_id || s.singer_id || s.AuthorId || s.id || s.userid || '',
        singerid: s.singerid || s.author_id || s.singer_id || s.AuthorId || s.id || '',
        name: s.singername || s.author_name || s.singer_name || s.AuthorName || s.name || s.nickname || '',
        picUrl: pic,
        fansCount: s.fanscount || s.fansnums || s.fans_count || s.FansNum || 0,
        songCount: s.songcount || s.song_count || s.AudioCount || 0,
        albumCount: s.albumcount || s.album_count || s.AlbumCount || 0,
        mvCount: s.mvcount || s.mv_count || s.VideoCount || 0
    }
}

// ========== 歌手列表扁平化 ==========
// /artist/lists 实测响应结构：data: { info: [ { title: "热门", singer: [...] }, ... ] }
// 需要扁平化所有 info[].singer 数组为单一列表
export const flattenKugouSingerList = (data) => {
    if (!data) return []
    // 兼容多种结构：data.info[].singer[] / data.list[] / data.singer[] / data 是数组
    const infoArr = data.info || data.list || (Array.isArray(data) ? data : [])
    if (!Array.isArray(infoArr)) return []
    const result = []
    infoArr.forEach(group => {
        // 如果 group 本身就是歌手对象（含 singerid），直接推入
        if (group && (group.singerid || group.id)) {
            result.push(group)
            return
        }
        // 否则取 group.singer 数组
        const singers = group?.singer || group?.singers || []
        if (Array.isArray(singers)) {
            singers.forEach(s => s && result.push(s))
        }
    })
    return result
}

// ========== 歌单分类扁平化 ==========
// /playlist/tags 实测响应结构：data: [ { tag_id, tag_name, parent_id, son: [...] }, ... ]
// 需要扁平化为 [{id, name, group}] 列表
export const flattenKugouPlaylistTags = (data) => {
    if (!data) return []
    const arr = Array.isArray(data) ? data : (data.categories || data.list || [])
    const result = [{ id: '', name: '全部', group: '推荐' }]
    arr.forEach(parent => {
        if (!parent) return
        const groupName = parent.tag_name || parent.name || ''
        // 父分类
        if (parent.tag_id || parent.id) {
            result.push({
                id: parent.tag_id || parent.id,
                name: parent.tag_name || parent.name || '',
                group: groupName
            })
        }
        // 子分类
        const sons = parent.son || parent.items || parent.list || []
        if (Array.isArray(sons)) {
            sons.forEach(son => {
                if (!son) return
                result.push({
                    id: son.tag_id || son.id || son.categoryid || '',
                    name: son.tag_name || son.name || son.categoryname || '',
                    group: groupName
                })
            })
        }
    })
    return result.filter(t => t.id !== undefined && t.id !== null)
}

// ========== 歌单详情+歌曲列表合并解析 ==========
// /playlist/track/all 实测响应：data: { list_info: {...}, songs: [...], count }
// /playlist/track/all/new 实测响应：data: { list_info: {...}, info: [...], count }
// /playlist/detail 后端故障 502，统一用 /playlist/track/all 一个接口拿详情+歌曲
export const parseKugouPlaylistFull = (res) => {
    const data = res?.data || {}
    // list_info 是歌单元信息，info[] 才是歌曲列表
    const info = data.list_info || {}
    // 歌单详情信息也可能直接在 data 顶层（无 list_info 时）
    // /playlist/track/all/new 的 list_info 可能缺少封面，需从更多字段兜底
    let cover = info.pic || info.imgurl || info.coverImgUrl || info.flexible_cover || info.sizable_cover ||
                info.imgurl_min || info.pic_min ||
                data.pic || data.imgurl || data.coverImgUrl || data.flexible_cover || ''
    if (cover && cover.indexOf('{size}') >= 0) cover = cover.replace('{size}', '480')
    if (cover && cover.startsWith('//')) cover = 'https:' + cover
    const detail = {
        id: info.global_collection_id || info.parent_global_collection_id || info.specialid || data.global_collection_id || '',
        global_collection_id: info.global_collection_id || info.parent_global_collection_id || data.global_collection_id || '',
        specialid: info.specialid || '',
        listid: info.listid || data.listid || '',
        name: info.name || info.specialname || info.special_name || data.name || '未知歌单',
        coverImgUrl: cover,
        creator: info.list_create_username || info.nickname || info.create_username || data.list_create_username || '',
        creatorId: info.list_create_userid || info.create_userid || data.list_create_userid || '',
        description: info.intro || data.intro || '',
        playCount: info.heat || info.collect_total || info.play_count || data.heat || 0,
        songCount: data.count || info.count || info.song_count || data.total || 0,
        tags: info.tags || '',
        publishDate: info.publish_date || ''
    }
    // 歌曲列表：data.info[]（实际响应）, 兼容 data.songs / data.list
    const songList = data.info || data.songs || data.list || []
    const rawList = Array.isArray(songList) ? songList : []
    // 排序：酷狗接口返回的是按添加时间正序(最早添加的在前)
    // 用户要求最新添加的在前，所以反序
    const finalList = rawList.slice().reverse()
    const songs = finalList.map(normalizeKugouSong).filter(Boolean)
    return { detail, songs }
}

// MV 标准化：与网易云 MV 字段对齐，便于复用 MvPlayer 组件
export const normalizeKugouMv = (m) => {
    if (!m) return null
    // 酷狗 MV 字段：mvhash/mv_id, mvname, singers, duration, imgurl, sizethumb, playcount
    // 搜索 MV (/search?type=mv) 返回 PascalCase: MvID/MvName/SingerName/MvHash/Duration/Pic/Singers[]/ThumbGif
    // Pic 字段仅文件名(如 20200620174316264397.jpg),需拼接前缀
    const singers = m.singers || m.Singers || m.singer || m.singername || m.SingerName || m.artist || ''
    const artistStr = Array.isArray(singers)
        ? singers.map(s => (typeof s === 'string' ? s : s.name || s.singername || '')).filter(Boolean).join('/')
        : (typeof singers === 'string' ? singers : '未知歌手')
    let cover = m.imgurl || m.sizethumb || m.picurl || m.cover || m.thumb || m.thumbnail ||
        m.img || m.Pic || m.ThumbGif || m.ErectPic || ''
    if (cover) {
        cover = String(cover).replace('{size}', '480')
        if (cover.startsWith('//')) cover = 'https:' + cover
        // 搜索 MV 的 Pic 字段仅文件名,需拼接前缀
        if (cover && !cover.startsWith('http') && !cover.startsWith('//') && cover.length < 100) {
            cover = 'https://imge.kugou.com/stdmusic/480/' + cover
        }
    }
    return {
        id: m.mvhash || m.mv_id || m.mv_hash || m.MvHash || m.MvID || m.hash || m.id || '',
        mvHash: m.mvhash || m.mv_id || m.mv_hash || m.MvHash || m.MvID || m.hash || m.id || '',
        name: m.mvname || m.MvName || m.name || m.mv_name || m.title || m.specialname || '',
        artist: artistStr,
        cover,
        duration: m.duration ? Math.floor(m.duration) : (m.timelength ? Math.floor(m.timelength / 1000) : 0),
        playCount: m.playcount || m.play_count || m.MvHot || 0,
        publishTime: m.publishdate || m.publish_date || '',
        platform: 'kugou'
    }
}

export default kugouRequest
