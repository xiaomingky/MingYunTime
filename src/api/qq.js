// QQ 音乐 API 前端封装
// 通过 Electron IPC 调用主进程 electron/qq-music.js 注册的通道
// 所有函数自动透传 localStorage 里的 qq_cookie
const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler || window.ipcRenderer

export const getQQCookie = () => localStorage.getItem('qq_cookie') || ''
export const setQQCookie = (cookie) => localStorage.setItem('qq_cookie', cookie)
export const clearQQCookie = () => localStorage.removeItem('qq_cookie')

export const getQQProfile = () => {
    try { return JSON.parse(localStorage.getItem('qq_profile') || 'null') } catch { return null }
}
export const setQQProfile = (profile) => localStorage.setItem('qq_profile', JSON.stringify(profile))
export const clearQQProfile = () => localStorage.removeItem('qq_profile')

// 统一调用封装:自动附加 cookie
async function invoke(channel, params = {}) {
    const bridge = getBridge()
    if (!bridge?.invoke) throw new Error('Bridge 未就绪')
    return bridge.invoke(channel, { ...params, cookie: getQQCookie() })
}

// ========== 搜索类(3) ==========
export const qqSearch = (key, limit = 30, page = 1, catZhida = 1) => invoke('qq:search', { key, limit, page, catZhida })
export const qqSmartbox = (key) => invoke('qq:smartbox', { key })
export const qqHotkey = () => invoke('qq:hotkey')

// ========== 音乐类(5) ==========
export const qqSongInfo = (songmid) => invoke('qq:song-info', { songmid })
export const qqSongPlay = (songmid, quality = '128', cookie = '') => invoke('qq:song-play', { songmid, quality, cookie })
export const qqLyric = (songmid, isFormat = 1, cookie = '') => invoke('qq:lyric', { songmid, isFormat, cookie })
export const qqAlbumInfo = (albummid, cookie = '') => invoke('qq:album-info', { albummid, cookie })
export const qqBatchSongInfo = (songs, cookie = '') => invoke('qq:batch-song-info', { songs, cookie })

// ========== 歌手类(7) ==========
export const qqSingerList = (params = {}) => invoke('qq:singer-list', params)
export const qqSingerDesc = (singermid) => invoke('qq:singer-desc', { singermid })
export const qqSingerHotsong = (singermid, limit = 20, page = 1) => invoke('qq:singer-hotsong', { singermid, limit, page })
export const qqSingerAlbum = (singermid, limit = 20, page = 1) => invoke('qq:singer-album', { singermid, limit, page })
export const qqSingerMv = (singermid, limit = 20, order = 'time') => invoke('qq:singer-mv', { singermid, limit, order })
export const qqSimilarSinger = (singermid) => invoke('qq:similar-singer', { singermid })
export const qqSingerStarNum = (singermid) => invoke('qq:singer-star-num', { singermid })

// ========== 歌单类(5) ==========
export const qqPlaylistCategories = () => invoke('qq:playlist-categories')
export const qqPlaylistList = (params = {}) => invoke('qq:playlist-list', params)
export const qqPlaylistDetail = (disstid) => invoke('qq:playlist-detail', { disstid })
export const qqBatchPlaylists = (params = {}) => invoke('qq:batch-playlists', params)
export const qqNewDisks = (limit = 20, page = 1) => invoke('qq:new-disks', { limit, page })

// ========== 排行榜类(2) ==========
export const qqRanks = (params = {}) => invoke('qq:ranks', params)
export const qqTopLists = () => invoke('qq:top-lists')

// ========== 评论类(1) ==========
// QQ 音乐评论接口(直接调用 fcg_global_comment_h5.fcg):
//   - songmid: 歌曲 mid(必传,songid 缺失时主进程自动调 song-detail 补全)
//   - songid: 数字歌曲 ID(可选,有则直接用,无则主进程自动补全)
//   - cmd: 6=热评, 8=最新评论
//   - pagenum: 从 0 开始
//   - pagesize: 单页条数
//   - lasthotcommentid: 分页游标
// 返回归一化结构(与网易云兼容): { code:0, data: { comments, total, hasMore, lasthotcommentid } }
export const qqComments = (songmid, songid, cmd = 8, pagenum = 0, pagesize = 20, lasthotcommentid = '', cookie = '') =>
    invoke('qq:comments', { songmid, songid, cmd, pagenum, pagesize, lasthotcommentid, cookie })

// ========== 用户类(4) ==========
// 注意:QQ 用户类接口需要 cookie 鉴权,cookie 从 qqUserStore 取
export const qqUserPlaylists = (uin, cookie = '', offset = 0, limit = 30) => invoke('qq:user-playlists', { uin, offset, limit, cookie })
export const qqUserLikedSongs = (uin, cookie = '', offset = 0, limit = 100) => invoke('qq:user-liked-songs', { uin, offset, limit, cookie })
export const qqUserDetail = (uin, cookie = '') => invoke('qq:user-detail', { uin, cookie })
// 歌曲详情(含 VIP 标识/封面兜底)
export const qqSongDetail = (songmid, cookie = '') => invoke('qq:song-detail', { songmid, cookie })
// 我喜欢红心操作(cmd: 1=收藏, 2=取消)
// 需要 dissid(我喜欢歌单 ID),由调用方从 qqUserStore.likedPlaylistId 传入
// 需要 songid(数字歌曲 ID),从歌曲对象 songid 字段传入
export const qqOperMyLike = (cmd, songmid, cookie = '', dissid = '', songid = 0) => invoke('qq:oper-mylike', { cmd, songmid, cookie, dissid, songid })
// 歌单操作(cmd: 'add'/'del'/'addsong'/'delsong')
export const qqOperSonglist = (cmd, params = {}, cookie = '') => invoke('qq:oper-songlist', { cmd, ...params, cookie })
export const qqUserAvatar = (uin, size = 140) => invoke('qq:user-avatar', { uin, size })
export const qqQrCreate = () => invoke('qq:qr-create')
export const qqQrCheck = (qrsig, ptqrtoken) => invoke('qq:qr-check', { qrsig, ptqrtoken })

// 官网登录:打开 y.qq.com 扫码登录窗口,扫码成功后采集完整 cookie(含 qqmusic_key/qm_keyst)
// 替代 API 二维码登录(API 登录缺失 qqmusic_key 导致播放链接被限制)
// 注意:此通道不需要自动附加 cookie,直接调用 ipcRenderer
export const qqWebLogin = () => {
    const bridge = getBridge()
    if (!bridge?.invoke) throw new Error('Bridge 未就绪')
    return bridge.invoke('qq:web-login')
}

// ========== 其他类(8) ==========
export const qqMvList = (params = {}) => invoke('qq:mv-list', params)
export const qqMvPlay = (vid, cookie = '') => invoke('qq:mv-play', { vid, cookie })
export const qqMvByTag = (tag, limit = 20, page = 1) => invoke('qq:mv-by-tag', { tag, limit, page })
export const qqImageUrl = (id, size = '300x300') => invoke('qq:image-url', { id, size })
export const qqDigitalAlbums = (limit = 20, page = 1) => invoke('qq:digital-albums', { limit, page })
export const qqDownload = (songmid, quality = '128', cookie = '') => invoke('qq:download', { songmid, quality, cookie })
export const qqRadioLists = () => invoke('qq:radio-lists')
export const qqRecommend = () => invoke('qq:recommend')
export const qqTicketInfo = () => invoke('qq:ticket-info')

// ========== 工具函数 ==========

// QQ 歌曲对象标准化:统一为前端使用的格式
// 兼容多种字段命名：
//   - 旧格式(搜索/排行榜)：songmid/mid, songname/name, singer[](数组), albummid/albumMid
//   - 新格式(new_format=1, 歌单详情)：mid, name/title, singer[], album:{mid,name}
//   - 排行榜：songId(数字), title, singerName(字符串), singerMid(字符串), albumMid
// 幂等设计:传入已标准化的对象(含 platform:'qq' + artist + 无 singer/songname)时直接返回
//   避免二次 normalize 导致 duration 翻倍(×1000 两次)、artist 丢失等问题
export const normalizeQQSong = (song) => {
    if (!song) return null
    // 幂等保护:已标准化对象直接返回(判断依据:有 platform:'qq' + artist 字段,无 singer/songname 原始字段)
    if (song.platform === 'qq' && song.artist && !song.singer && !song.songname && song.songmid) {
        return song
    }
    // songmid 优先，没有 songmid 时用 songId 作为 fallback（排行榜场景）
    const songmid = song.songmid || song.mid || song.strSongMid || song.songMid || ''
    const songid = song.songid || song.songId || 0
    // 没有 songmid 但有 songid 时，用 songid 作为 id（排行榜歌曲）
    const id = songmid || (songid ? String(songid) : '')
    if (!id) return null

    // 歌手名：singer[] 优先，其次 singerName 字符串
    const singerName = Array.isArray(song.singer)
        ? song.singer.map(s => s.name || s.singername || '').filter(Boolean).join('/')
        : (song.singername || song.singerName || song.singer || '未知歌手')

    // 专辑 mid：兼容旧格式(albummid)和新格式(album.mid)
    const albummid = song.albummid || song.albumMid || song.strAlbumMid || song.album?.mid || song.album?.id || ''

    // 专辑名：兼容旧格式(albumname)和新格式(album.name)
    const albumName = song.albumname || song.albumName || song.album?.name || song.album?.title || song.album || ''

    return {
        id,
        songmid,  // 可能为空（排行榜场景）
        songid,   // 排行榜场景用 songid 播放
        name: song.songname || song.songName || song.name || song.title || '',
        artist: singerName,
        album: albumName,
        albummid,
        albumid: song.albumid || song.albumId || song.album?.id || 0,
        duration: (song.interval || song.duration || 0) * 1000,
        // VIP/付费标识:pay.payplay=1 或 pay.price.album>0 等,表示需 VIP
        // 多种字段兼容(接口版本不同字段名不同)
        isVip: (() => {
            const pay = song.pay || {}
            return !!(pay.payplay === 1 || pay.paytrackprice === 1 || pay.trackprice > 0 ||
                      song.payed === 1 || song.grant === 0 || song.action >= 30000)
        })(),
        // 封面优先级:
        //   1. albummid 构造的专辑封面(QQ 音乐标准封面 T002)
        //   2. 原始 pic/picUrl 字段(部分接口返回直链)
        //   3. singermid 构造的歌手头像(T001)兜底
        singermid: Array.isArray(song.singer) ? (song.singer[0]?.mid || song.singer[0]?.singerMID || '') : '',
        picUrl: (() => {
            if (albummid) return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`
            // 无专辑封面,尝试原始直链
            const directPic = song.pic || song.picUrl || song.imgurl || ''
            if (directPic) return directPic
            // 用歌手头像(T001)兜底
            const smid = Array.isArray(song.singer) ? (song.singer[0]?.mid || song.singer[0]?.singerMID || '') : ''
            if (smid) return `https://y.gtimg.cn/music/photo_new/T001R300x300M000${smid}.jpg`
            return ''
        })(),
        platform: 'qq',
        size128: song.size128,
        size320: song.size320,
        sizeflac: song.sizeflac,
        vid: song.vid || song.mvVid || ''
    }
}

// 异步补全歌曲信息(无专辑封面时调 song-detail 接口)
// 用途:无 albummid 的歌曲,通过 songmid 调上游接口拿真实封面 + VIP 标识
// 用法:enrichQQSongWithDetail(normalizedSong, cookie).then(updated => song.value = updated)
// 幂等:已有 picUrl 且来自专辑封面(T002)时不重复请求
// 封面策略:优先专辑封面(T002),拿不到 albummid 时用歌手头像(T001)兜底
export async function enrichQQSongWithDetail(song, cookie = '') {
    if (!song?.songmid) return song
    // 已有专辑封面,无需补全
    if (song.picUrl && song.picUrl.includes('T002R300x300M000')) return song
    try {
        const res = await qqSongDetail(song.songmid, cookie)
        const tracks = res?.data?.track_info || res?.data?.tracks || []
        const list = Array.isArray(tracks) ? tracks : [tracks]
        const t = list.find(x => x.mid === song.songmid) || list[0]
        if (!t) return song
        const albummid = t.album?.mid || t.albummid || ''
        // 歌手 mid:优先取 song-detail 返回的 singer[0].mid,其次用原 song 的 singermid
        const singerMid = (Array.isArray(t.singer) && t.singer[0]?.mid) || song.singermid || ''
        const pay = t.pay || {}
        return {
            ...song,
            albummid: song.albummid || albummid,
            album: song.album || t.album?.name || t.albumname || '',
            singermid: song.singermid || singerMid,
            // 封面优先级:专辑封面(T002) > 歌手头像(T001)兜底
            picUrl: albummid
                ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`
                : (singerMid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg` : ''),
            isVip: song.isVip || !!(pay.payplay === 1 || pay.paytrackprice === 1)
        }
    } catch (e) {
        console.warn('[QQ] enrichQQSongWithDetail 失败:', e?.message || e)
        return song
    }
}

// 转换为播放器 track 格式
// 输入可以是:
//   1. QQ API 原始数据(含 songmid/singer[]/songname 等字段) → 先 normalize
//   2. normalizeQQSong 已标准化的对象(含 songmid/name/artist 等字段) → 直接用
// normalizeQQSong 已做幂等保护,此处直接调用即可
export const toQQTrack = (song) => {
    if (!song) return null
    const normalized = normalizeQQSong(song)
    if (!normalized) return null
    return {
        id: normalized.songmid || normalized.id,
        name: normalized.name,
        artist: normalized.artist || '未知歌手',
        al: { name: normalized.album || '未知专辑', picUrl: normalized.picUrl || '' },
        picUrl: normalized.picUrl || '',
        dt: normalized.duration || 0,
        duration: (normalized.duration || 0) / 1000,
        ar: [{ name: normalized.artist || '未知歌手' }],
        platform: 'qq',
        songmid: normalized.songmid,
        vid: normalized.vid || ''
    }
}

// QQ 歌手标准化
// 兼容字段：singer_mid/singerMid/singermid, singer_name/singerName/singername, singer_pic
export const normalizeQQSinger = (s) => {
    const mid = s.singer_mid || s.singerMid || s.singermid || s.mid || ''
    return {
        id: mid,
        singermid: mid,
        name: s.singer_name || s.singerName || s.singername || s.name || '',
        picUrl: s.singer_pic || s.singerPic || (mid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${mid}.jpg` : '')
    }
}

// QQ 歌单标准化
// 字段：dissid(歌单id), dissname, imgurl, listennum, creator.name
export const normalizeQQPlaylist = (p) => ({
    id: p.dissid || p.disstid || p.tid || '',
    disstid: p.dissid || p.disstid || p.tid || '',
    name: p.dissname || p.title || p.name || '',
    coverImgUrl: p.imgurl || p.picurl || p.picUrl || p.logo || '',
    creator: p.creator || { name: p.nickname || '' },
    playCount: p.listennum || p.listen_num || p.accessnum || 0,
    songCount: p.song_num || p.songnum || 0
})

// QQ 专辑标准化
// 兼容字段：mid/albumMID/albummid, name/albumName/albumname, singers[].name
export const normalizeQQAlbum = (a) => {
    const mid = a.mid || a.albumMID || a.albummid || a.albumMid || ''
    const singerName = Array.isArray(a.singers)
        ? a.singers.map(s => s.name || s.singername || '').filter(Boolean).join('/')
        : (a.singerName || a.singername || a.singer || '')
    return {
        id: mid,
        albummid: mid,
        name: a.name || a.albumName || a.albumname || '',
        picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : (a.pic || a.picurl || a.imgurl || ''),
        artist: singerName,
        publishTime: a.publicTime || a.pubTime || a.releaseTime || ''
    }
}

// QQ MV 标准化
export const normalizeQQMv = (m) => ({
    id: m.vid || m.mv_id,
    vid: m.vid || m.mv_id,
    name: m.mv_name || m.title || m.songname,
    artist: m.singer_name || m.singername || '',
    picUrl: m.mv_pic_url || m.pic || '',
    duration: (m.duration || 0) * 1000,
    playCount: m.play_count || 0,
    platform: 'qq'
})
