import axios from 'axios'

// ========== 平台配置 ==========
// 平台切换：网易云（默认）/ QQ 音乐
// 切换后写入 localStorage: 'current_platform'
// 网易云走 axios 直连 NCM API；QQ 音乐走 Electron IPC（见 src/api/qq.js）
export const PLATFORMS = {
    netease: {
        key: 'netease',
        label: '网易云音乐',
        themeColor: '#EC4141',
        icon: 'cloud'
    },
    qq: {
        key: 'qq',
        label: 'QQ 音乐',
        themeColor: '#31C27C',
        icon: 'qq'
    },
    kugou: {
        key: 'kugou',
        label: '酷狗概念版',
        themeColor: '#2CA2F5',
        icon: 'kugou'
    }
}

export const getCurrentPlatform = () => localStorage.getItem('current_platform') || 'netease'
export const setCurrentPlatform = (key) => localStorage.setItem('current_platform', key)
export const isQQPlatform = () => getCurrentPlatform() === 'qq'
export const isNeteasePlatform = () => getCurrentPlatform() === 'netease'
export const isKugouPlatform = () => getCurrentPlatform() === 'kugou'

// API 线路配置：用户可在关闭选项下拉框中切换
// 主线路：本地自部署的 NeteaseCloudMusicApiEnhanced（http://localhost:3100，由 Electron 主进程启动）
// 推荐线路：在线备用 https://api.xiaomingky.cn/
// 备用线路：https://api2.xiaomingky.cn/
// 切换后写入 localStorage: 'api_line'，优先级高于环境变量
// 主线路为本地服务，启动时若不可用会自动回退到在线线路
const NETEASE_LOCAL_BASE = 'http://localhost:3100'
export const API_LINES = [
    { key: 'main', label: '主线路', url: NETEASE_LOCAL_BASE },
    { key: 'recommended', label: '推荐线路', url: 'https://api2.xiaomingky.cn/' },
    { key: 'backup', label: '备用线路', url: 'https://api3.xiaomingky.cn/' }
]

// 本地服务可用性标记（启动时假设可用，首次连接失败后标记为不可用）
let _neteaseLocalAvailable = true

function getCurrentApiBaseUrl() {
    const savedKey = localStorage.getItem('api_line')
    if (savedKey) {
        const found = API_LINES.find(l => l.key === savedKey)
        if (found) return found.url
    }
    return API_LINES[0].url
}

const request = axios.create({
    baseURL: getCurrentApiBaseUrl(),
    timeout: 30000,
    withCredentials: true
})

// 启动时异步检测本地服务可用性
;(async () => {
    try {
        const res = await fetch(`${NETEASE_LOCAL_BASE}/search/hot`, {
            signal: AbortSignal.timeout(3000)
        })
        if (res.ok) {
            _neteaseLocalAvailable = true
            console.log('[NetEase API] 使用本地自部署服务:', NETEASE_LOCAL_BASE)
        } else {
            throw new Error('local not ok')
        }
    } catch (e) {
        _neteaseLocalAvailable = false
        const onlineUrl = API_LINES.find(l => l.key === 'recommended')?.url || API_LINES[1].url
        request.defaults.baseURL = onlineUrl
        console.warn('[NetEase API] 本地服务不可用,回退到在线线路:', onlineUrl)
    }
})()

// 运行时切换 API 线路（无需刷新页面，立即生效）
export function switchApiLine(lineKey) {
    const line = API_LINES.find(l => l.key === lineKey)
    if (!line) return false
    localStorage.setItem('api_line', lineKey)
    request.defaults.baseURL = line.url
    // 切换到主线路时重置本地可用性标记，允许再次检测
    if (lineKey === 'main') _neteaseLocalAvailable = true
    return true
}

// 用户自建后端（账号锁 + 云音乐）地址
export const CLOUD_BASE_URL = import.meta.env.VITE_CLOUD_BASE_URL || ''

const cloudRequest = axios.create({
    baseURL: CLOUD_BASE_URL,
    timeout: 60000
})

cloudRequest.interceptors.request.use(config => {
    const token = localStorage.getItem('music_cloud_token')
    if (token) {
        config.headers = config.headers || {}
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

cloudRequest.interceptors.response.use(
    response => response.data,
    error => {
        if (error.response?.data) return error.response.data
        return Promise.reject(error)
    }
)

// Request interceptor to add cookie
request.interceptors.request.use(
    config => {
        const cookie = localStorage.getItem('music_cookie')
        if (cookie) {
            // If the URL already has a cookie param, don't add another one
            const urlHasCookie = config.url && config.url.includes('cookie=')
            const paramsHasCookie = config.params && config.params.cookie

            if (!urlHasCookie && !paramsHasCookie) {
                config.params = config.params || {}
                config.params.cookie = cookie
            }
        }
        return config
    },
    error => Promise.reject(error)
)

// Response interceptor
request.interceptors.response.use(
    response => {
        // 网易云 API 有时会双层嵌套 data，或者是直接在 root
        const data = response.data
        if (data && data.data && data.code === undefined) {
            return data.data
        }
        return data
    },
    error => {
        // 本地服务连接失败时自动切换到在线线路并重试一次
        const currentBase = request.defaults.baseURL || ''
        if (_neteaseLocalAvailable && currentBase.startsWith('http://localhost')) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED' ||
                (error.message && error.message.includes('Network Error'))) {
                console.warn('[NetEase API] 本地服务连接失败,切换到在线线路')
                _neteaseLocalAvailable = false
                const onlineUrl = API_LINES.find(l => l.key === 'recommended')?.url || API_LINES[1].url
                request.defaults.baseURL = onlineUrl
                const config = error.config
                if (config && !config._retried) {
                    config._retried = true
                    config.baseURL = onlineUrl
                    return request(config)
                }
            }
        }
        // 如果后端返回了错误但依然有 body (比如 400 提示验证码已发送)
        if (error.response && error.response.data) {
            return error.response.data
        }
        console.error('API Error:', error)
        return Promise.reject(error)
    }
)

// API Methods
export const getBanner = () => request.get('/banner?type=0')
export const getPersonalizedPlaylist = (limit = 10) => request.get(`/personalized?limit=${limit}`)
export const getNewSongs = (limit = 12) => request.get(`/personalized/newsong?limit=${limit}`)
export const getSongUrl = (id, level = 'standard', immerseType = '') => {
    let url = `/song/url/v1?id=${id}&level=${level}`
    // 沉浸环绕声(level=sky)需额外指定 immerseType：c51(默认) / aac
    if (level === 'sky' && immerseType) {
        url += `&immerseType=${immerseType}`
    }
    return request.get(url)
}
export const getSongDetail = (ids) => request.get(`/song/detail?ids=${ids}`)
export const getLyric = (id) => request.get(`/lyric?id=${id}`)
export const getNewLyric = (id) => request.get(`/lyric/new?id=${id}`)
export const getPlaylistDetail = (id) => request.get(`/playlist/detail?id=${id}`)
export const getMvAll = (area = '全部', limit = 10) => request.get(`/mv/all?area=${area}&limit=${limit}`)
export const cloudSearch = (keywords, type = 1) => request.get(`/cloudsearch?keywords=${keywords}&type=${type}`)
export const getUserPlaylist = (uid) => request.get(`/user/playlist?uid=${uid}`)
export const getTopPlaylist = (cat = '全部', limit = 10) => request.get(`/top/playlist?cat=${cat}&limit=${limit}`)
export const getToplist = () => request.get('/toplist')
export const getTopArtists = (limit = 30) => request.get(`/top/artists?limit=${limit}`)
export const getTopSongs = (type = 0) => request.get(`/top/song?type=${type}`)
export const getMvUrl = (id) => request.get(`/mv/url?id=${id}`)
export const getCommentMusic = (id, limit = 20, offset = 0) => request.get(`/comment/music?id=${id}&limit=${limit}&offset=${offset}`)
export const getUserDetail = (uid) => request.get(`/user/detail?uid=${uid}`)
export const getCommentPlaylist = (id, limit = 20, offset = 0) => request.get(`/comment/playlist?id=${id}&limit=${limit}&offset=${offset}`)
export const getAlbum = (id) => request.get(`/album?id=${id}`)

// 评论：新版评论接口（支持完整分页 / 排序 / 游标）
// type: 0歌曲 1mv 2歌单 3专辑 4电台节目 5视频 6动态 7电台
// sortType: 1推荐 2热度 3时间；sortType=3 且非首页时需传 cursor（上一条 time）
export const getCommentNew = (params) => {
    const { id, type = 0, pageNo = 1, pageSize = 20, sortType = 3, cursor = '' } = params
    let url = `/comment/new?id=${id}&type=${type}&pageNo=${pageNo}&pageSize=${pageSize}&sortType=${sortType}`
    if (cursor) url += `&cursor=${cursor}`
    return request.get(url)
}
// 评论点赞：t=1 点赞，t=0 取消
export const likeComment = (id, cid, t, type = 0) =>
    request.get(`/comment/like?id=${id}&cid=${cid}&t=${t}&type=${type}`)
// 发送/回复/删除评论：t=1 发送, t=2 回复, t=0 删除
export const sendComment = (params) => {
    const { t, type = 0, id, content, commentId, threadId } = params
    const query = { t, type, timestamp: Date.now() }
    if (threadId) query.threadId = threadId
    else query.id = id
    if (t === 2 || t === 0) query.commentId = commentId
    if (t === 1 || t === 2) query.content = content
    return request.get('/comment', { params: query })
}

// ---------- 网易云官方云盘 ----------
// 云盘列表（limit/offset 分页，返回数据无 url，需再调 /song/url/v1 获取）
// 注意：此接口返回 {code, count, data, hasMore}，不能被响应拦截器拆包，需原样返回
export const getUserCloud = (limit = 30, offset = 0) =>
    request.get(`/user/cloud?limit=${limit}&offset=${offset}&timestamp=${Date.now()}`)
// 云盘数据详情
export const getUserCloudDetail = (id) =>
    request.get(`/user/cloud/detail?id=${id}`)
// 云盘歌曲删除
export const deleteUserCloud = (id) =>
    request.get(`/user/cloud/del?id=${id}&timestamp=${Date.now()}`)
// 云盘歌曲信息匹配纠正（asid=0 取消匹配，保持文件原信息；asid=歌曲ID 匹配指定网易云歌曲）
export const matchCloud = (uid, sid, asid) =>
    request.get(`/cloud/match?uid=${uid}&sid=${sid}&asid=${asid}&timestamp=${Date.now()}`)
// 获取云盘歌词
export const getCloudLyric = (uid, sid) =>
    request.get(`/cloud/lyric/get?uid=${uid}&sid=${sid}`)

// Playlist operations
export const playlistUpdate = (data) => request.get(`/playlist/update?name=${data.name}&desc=${data.desc || ''}&id=${data.id || ''}`)
export const playlistSubscribe = (id, t = 1) => request.get(`/playlist/subscribe?t=${t}&id=${id}`) // t=1: sub, t=2: unsub
export const playlistTracks = (op, pid, tracks) => request.get('/playlist/tracks', { params: { op, pid, tracks, timestamp: Date.now() } }) // op=add/del
export const playlistCreate = (name) => request.post('/playlist/create', null, { params: { name, timestamp: Date.now() } })
export const playlistDelete = (id) => request.get(`/playlist/delete?id=${id}`)
export const playlistCoverUpdate = (id, imgFile) => {
    const formData = new FormData()
    formData.append('imgFile', imgFile)
    return request.post(`/playlist/cover/update?id=${id}&timestamp=${Date.now()}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    })
}

// Login methods
export const loginCellphone = (data) => request.get('/login/cellphone', { params: { ...data, timestamp: Date.now() } })
export const loginEmail = (data) => request.get('/login', { params: { ...data, timestamp: Date.now() } })
export const getQrKey = () => request.get(`/login/qr/key?timestamp=${Date.now()}`)
export const createQrCode = (key) => request.get(`/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`)
export const checkQrStatus = (key) => request.get(`/login/qr/check?key=${key}&timestamp=${Date.now()}`)
export const sentCaptcha = (phone) => request.get(`/captcha/sent?phone=${phone}`)
export const verifyCaptcha = (phone, captcha) => request.get(`/captcha/verify?phone=${phone}&captcha=${captcha}`)

// ---------- 自建后端：账号同步与锁（设置请去后端网站） ----------
export const syncDesktopAccount = (userId, cookie) => cloudRequest.post('/api/auth/desktop-login', { userId, cookie })
export const checkLockStatus = () => cloudRequest.get('/api/lock/status')
export const verifyLockPassword = (password) => cloudRequest.post('/api/lock/verify', { password })

// ---------- 自建后端：云音乐（仅列表/播放，上传请去后端网站） ----------
export const getCloudSongs = () => cloudRequest.get('/api/cloud/list')
export const reorderCloudSongs = (moves) => cloudRequest.post('/web/cloud/reorder', { moves })

// ---------- 动漫模块（通过 Electron IPC 调用主进程） ----------
const animeBridge = () => (window.bridge || window.__ELECTRON_BRIDGE__)
export const animeSources = () => animeBridge().invoke('anime:sources')
export const animeHome = (source) => animeBridge().invoke('anime:home', { source })
export const animeSearch = (source, keyword) => animeBridge().invoke('anime:search', { source, keyword })
export const animeDetail = (source, id) => animeBridge().invoke('anime:detail', { source, id })
export const animeParsePlayUrl = (source, episodeUrl, scheme = 1) => animeBridge().invoke('anime:parse-playurl', { source, episodeUrl, scheme })
export const animeMetaSearch = (title) => animeBridge().invoke('anime:meta:search', { title })
export const animeMetaRelated = (bgmId) => animeBridge().invoke('anime:meta:related', { bgmId })

// ---------- 电影模块（通过 Electron IPC 调用主进程） ----------
export const movieSources = () => animeBridge().invoke('movie:sources')
export const movieHome = (source) => animeBridge().invoke('movie:home', { source })
export const movieSearch = (source, keyword) => animeBridge().invoke('movie:search', { source, keyword })
export const movieDetail = (source, id) => animeBridge().invoke('movie:detail', { source, id })
export const movieParsePlayUrl = (source, episodeUrl) => animeBridge().invoke('movie:parse-playurl', { source, episodeUrl })

// ---------- 视频下载 / MV 搜索（通过 Electron IPC） ----------
export const downloadVideo = (params) => animeBridge().downloadVideo(params)
export const cancelVideoDownload = (downloadId) => animeBridge().cancelVideoDownload(downloadId)
export const parseVideoUrl = (url) => animeBridge().parseVideoUrl(url)
// B站登录（二维码扫码，获取 Cookie 提升画质）
export const biliLoginQr = () => animeBridge().biliLoginQr()
export const biliLoginCheck = (qrcodeKey) => animeBridge().biliLoginCheck(qrcodeKey)
export const biliLoginStatus = () => animeBridge().biliLoginStatus()
export const biliLogout = () => animeBridge().biliLogout()
// YouTube 登录（官方网页登录，捕获 Cookie 供 yt-dlp 使用）
export const youtubeLoginOpen = () => animeBridge().youtubeLoginOpen()
export const youtubeLoginClose = () => animeBridge().youtubeLoginClose()
export const youtubeLoginStatus = () => animeBridge().youtubeLoginStatus()
export const youtubeLogout = () => animeBridge().youtubeLogout()
export const onYoutubeLoginDone = (cb) => animeBridge().onYoutubeLoginDone(cb)
export const biliLiveRoom = () => animeBridge().biliLiveRoom()
export const biliLiveAreas = () => animeBridge().biliLiveAreas()
export const biliLiveStart = (params) => animeBridge().biliLiveStart(params)
export const biliLiveUpdate = (params) => animeBridge().biliLiveUpdate(params)
export const biliLiveStop = (params) => animeBridge().biliLiveStop(params)
// B站管理（收藏夹 / 空间 / 稿件）
export const biliFavList = () => animeBridge().biliFavList()
export const biliFavContent = (params) => animeBridge().biliFavContent(params)
export const biliFavSeason = (params) => animeBridge().biliFavSeason(params)
export const biliSpaceInfo = () => animeBridge().biliSpaceInfo()
export const biliArchives = (params) => animeBridge().biliArchives(params)
// 下载目录设置
export const downloadDefaultDir = () => animeBridge().downloadDefaultDir()
export const downloadCheckDir = (dir) => animeBridge().downloadCheckDir(dir)
export const downloadPickDir = () => animeBridge().downloadPickDir()
export const onVideoDownloadProgress = (cb) => animeBridge().onVideoDownloadProgress(cb)
export const onVideoDownloadStarted = (cb) => animeBridge().onVideoDownloadStarted(cb)
export const onVideoDownloadDone = (cb) => animeBridge().onVideoDownloadDone(cb)
export const onVideoDownloadError = (cb) => animeBridge().onVideoDownloadError(cb)

// ---------- 统一下载管理器（新） ----------
// category: 'music' | 'movie' | 'anime' | 'mv' | 'video'
export const downloadStart = (params) => animeBridge().downloadStart(params)
export const downloadCancel = (downloadId) => animeBridge().downloadCancel(downloadId)
export const downloadList = () => animeBridge().downloadList()
export const downloadRemove = (downloadId) => animeBridge().downloadRemove(downloadId)
export const downloadClear = (status) => animeBridge().downloadClear(status)
export const downloadRetry = (downloadId) => animeBridge().downloadRetry(downloadId)
export const onDownloadStarted = (cb) => animeBridge().onDownloadStarted(cb)
export const onDownloadProgress = (cb) => animeBridge().onDownloadProgress(cb)
export const onDownloadDone = (cb) => animeBridge().onDownloadDone(cb)
export const onDownloadError = (cb) => animeBridge().onDownloadError(cb)

// 网易云 MV 搜索（按歌名匹配，返回 [{id, name, artistName, duration, cover, playCount}]）
export const ncmMvSearch = (keyword) => animeBridge().ncmMvSearch(keyword)

export default request
