import axios from 'axios'

const request = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    timeout: 30000,
    withCredentials: true
})

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
export const getSongUrl = (id, level = 'standard') => request.get(`/song/url/v1?id=${id}&level=${level}`)
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
