import { defineStore } from 'pinia'
import request, { getSongUrl, getLyric, getNewLyric, cloudSearch } from '../api'
import { qqSongPlay, qqLyric, qqDownload, qqSongInfo, qqBatchSongInfo, normalizeQQSong } from '../api/qq'
import { useMessageStore } from './message'

// 音质 level -> 中文名 映射
const QUALITY_LABELS = {
    standard: '标准',
    higher: '较高',
    exhigh: '极高',
    lossless: '无损',
    hires: 'Hi-Res',
    jyeffect: '高清环绕声',
    jymaster: '超清母带',
    sky: '沉浸环绕声',
    dolby: '杜比全景声'
}
const qualityLabel = (lv) => QUALITY_LABELS[lv] || lv

export const usePlayerStore = defineStore('player', {
    state: () => ({
        currentSong: {
            id: null,
            name: '歌曲名',
            artist: '歌手',
            al: {
                name: '专辑',
                picUrl: 'https://p2.music.126.net/6y-U6QnSjd_5419m1B0R_g==/109951165034938831.jpg?param=64y64'
            },
            duration: 0,
        },
        isPlaying: false,
        currentTime: 0,
        volume: 50,
        playlist: [],
        currentIndex: -1,
        playMode: 0, // 0: sequence, 1: loop, 2: random
        audio: null,
        showSongDetail: false,
        showPlaylist: false,
        lyrics: [],
        yrcLyrics: null, // 逐词歌词数据: [{ time, duration, words: [{ startTime, duration, text }], ttext }]
        lyricSource: '', // 当前歌词来源：'qq' | 'kugou' | 'netease' | 'local' | ''
        lyricDisplayMode: localStorage.getItem('lyric_display_mode') || 'word', // 'word' 逐词 | 'line' 逐行
        ctx: null,
        analyser: null,
        source: null,
        dataArray: null,
        isLiked: false,
        showMvPlayer: false,
        currentMvId: null,
        currentMvUrl: '',
        currentMvTitle: '', // MV 实际标题（解决播放时显示歌曲名的问题）
        currentMvAudioUrl: '', // DASH 音视频分离时的音频地址（下载时合并用）
        currentMvPlayType: '', // 播放类型提示：m3u8/flv/live/direct，优先于 URL 后缀判断
        mvSearchCandidates: [], // 网易云 MV 搜索结果（供 UI 选择）
        showMvSearchPicker: false, // 是否显示 MV 选择弹层
        showDesktopLyrics: localStorage.getItem('show_desktop_lyrics') === 'true',
        desktopLyricFont: '',
        desktopLyricColor: '#00E5FF',
        // 桌面歌词模式：'complex' 复杂模式（封面+控制+歌词）/ 'simple' 简约模式（仅歌词）
        desktopLyricMode: localStorage.getItem('desktop_lyric_mode') || 'complex',
        // 桌面歌词背景透明度 0-100（百分比，100=不透明）
        desktopLyricOpacity: parseInt(localStorage.getItem('desktop_lyric_opacity') || '100', 10),
        bgMode: localStorage.getItem('player_bg_mode') || 'cover', // 'cover' | 'classic'
        audioDevices: [],
        currentDeviceId: localStorage.getItem('audio_device_id') || '',
        recentSongs: JSON.parse(localStorage.getItem('recent_songs') || '[]'),
        localSongs: JSON.parse(localStorage.getItem('local_songs') || '[]'),
        quality: localStorage.getItem('music_quality') || 'standard',
        // 沉浸环绕声(level=sky)的子类型：'c51'(5.1环绕,默认) / 'aac'
        immerseType: localStorage.getItem('music_immerse_type') || 'c51',
        playbackRate: parseFloat(localStorage.getItem('playback_rate') || '1'),
        autoFetchLyric: localStorage.getItem('auto_fetch_lyric') !== 'false',
        eqEnabled: localStorage.getItem('eq_enabled') === 'true',
        eqPreset: 'default',
        eqBands: [
            { freq: 32, gain: 0 },
            { freq: 64, gain: 0 },
            { freq: 125, gain: 0 },
            { freq: 250, gain: 0 },
            { freq: 500, gain: 0 },
            { freq: 1000, gain: 0 },
            { freq: 2000, gain: 0 },
            { freq: 4000, gain: 0 },
            { freq: 8000, gain: 0 },
            { freq: 16000, gain: 0 }
        ],
        eqFilters: [],
        eqDryGain: null,
        eqWetGain: null,
        eqPresets: {
            'default': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            'pop': [3, 2, 1, 0, -1, -1, 0, 1, 2, 3],
            'classical': [2, 1, 0, 0, 1, 2, 1, 0, -1, -2],
            'rock': [4, 3, 1, -1, -2, -1, 0, 1, 2, 2],
            'electronic': [5, 4, 2, 0, -2, -1, 0, 2, 4, 5],
            'vocal': [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1],
            'jazz': [2, 1, 0, 1, 2, 2, 1, 1, 0, -1],
            'bass': [6, 5, 3, 1, 0, 0, 0, 0, 0, 0]
        },
    }),
    actions: {
        initAudio() {
            this.yrcLyrics = null // 重置逐词歌词
            this.lyricSource = '' // 重置歌词来源
            if (this.audio) {
                try { this.audio.pause(); this.audio.src = ''; this.audio.load() } catch (e) {}
                this.audio = null
            }
            if (this.ctx) {
                try { this.ctx.close() } catch (e) {}
                this.ctx = null
                this.analyser = null
                this.source = null
                this.eqFilters = []
                this.eqDryGain = null
                this.eqWetGain = null
            }

            this.audio = new Audio()
            this.audio.crossOrigin = "anonymous";
            this.audio.ontimeupdate = () => {
                // 节流 currentTime 更新：ontimeupdate 每秒触发 4-15 次，
                // 但 currentTime 是响应式变量，每次更新会触发进度条、歌词高亮等多处 watch
                // 限制到每 200ms 更新一次（5fps），播放进度条和歌词高亮无感知差异
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
                if (this._lastTimeUpdate && now - this._lastTimeUpdate < 200) {
                    // 仍要检查无缝播放预加载（不依赖 UI 更新）
                    if (this.audio.duration && this.audio.currentTime > 0 && this.audio.duration - this.audio.currentTime < 1 && !this._nextPreloaded) {
                        this._nextPreloaded = true
                        this._preloadNextSong()
                    }
                    return
                }
                this._lastTimeUpdate = now
                this.currentTime = this.audio.currentTime
                // 无缝播放：在歌曲结束前1秒预加载下一首
                if (this.audio.duration && this.audio.currentTime > 0 && this.audio.duration - this.audio.currentTime < 1 && !this._nextPreloaded) {
                    this._nextPreloaded = true
                    this._preloadNextSong()
                }
                // 桌面歌词状态更新：直接调用（内部有 50ms 节流）
                // 不用 requestAnimationFrame，因为主窗口最小化后 RAF 会被暂停
                if (this.showDesktopLyrics) {
                    this.updateDesktopLyricsState()
                }
            }
            this.audio.onended = () => {
                this._nextPreloaded = false
                this.next()
            }
            this.audio.onerror = (e) => {
                console.error('Audio error:', e)
                this.isPlaying = false
            }
            this.audio.onloadedmetadata = () => {
                // QQ 歌曲: 始终用 audio.duration 覆盖(QQ API interval 字段单位不稳定,
                //   且流媒体实际时长才是播放器真正需要的)
                // 其他歌曲: 仅在 duration 为 0 时覆盖(避免覆盖已正确的元数据)
                if (this.currentSong?.platform === 'qq' || !this.currentSong.duration || this.currentSong.duration === 0) {
                    this.currentSong.duration = this.audio.duration
                }
            }
            this._applyVolume()
        },
        async rebuildAudioGraph() {
            if (this.source) { try { this.source.disconnect() } catch (e) {}; this.source = null }
            this.eqFilters.forEach(f => { try { f.disconnect() } catch (e) {} })
            this.eqFilters = []
            if (this.eqDryGain) { try { this.eqDryGain.disconnect() } catch (e) {}; this.eqDryGain = null }
            if (this.eqWetGain) { try { this.eqWetGain.disconnect() } catch (e) {}; this.eqWetGain = null }
            if (this.analyser) { try { this.analyser.disconnect() } catch (e) {}; this.analyser = null }
            if (this.volumeGain) { try { this.volumeGain.disconnect() } catch (e) {}; this.volumeGain = null }
            if (this.ctx) { try { this.ctx.close() } catch (e) {}; this.ctx = null }

            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext
                this.ctx = new AudioCtx()
                this.analyser = this.ctx.createAnalyser()
                this.analyser.fftSize = 256
                this.analyser.smoothingTimeConstant = 0.8
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)

                this.source = this.ctx.createMediaElementSource(this.audio)

                // 创建 EQ 滤波器链（始终创建，通过干湿声 Gain 切换开关）
                this.createEqFilters()

                // 并联结构：
                // source -> dryGain -> analyser （直通，EQ 关闭时使用）
                // source -> eqFilters -> wetGain -> analyser （EQ 开启时使用）
                this.eqDryGain = this.ctx.createGain()
                this.eqWetGain = this.ctx.createGain()

                this.source.connect(this.eqDryGain)
                this.eqDryGain.connect(this.analyser)

                if (this.eqFilters.length) {
                    this.source.connect(this.eqFilters[0])
                    for (let i = 0; i < this.eqFilters.length - 1; i++) {
                        this.eqFilters[i].connect(this.eqFilters[i + 1])
                    }
                    this.eqFilters[this.eqFilters.length - 1].connect(this.eqWetGain)
                    this.eqWetGain.connect(this.analyser)
                }

                // 根据 eqEnabled 切换干湿声比例，避免反复 disconnect/connect 导致节点失效
                const now = this.ctx.currentTime
                this.eqDryGain.gain.setValueAtTime(this.eqEnabled ? 0 : 1, now)
                this.eqWetGain.gain.setValueAtTime(this.eqEnabled ? 1 : 0, now)

                // 音量增益节点:插入 analyser 与 destination 之间,支持超过 100% 音量放大(最大 500%)
                // audio.volume 固定为 1.0,实际音量由 volumeGain.gain 控制(volume/100)
                this.volumeGain = this.ctx.createGain()
                this.analyser.connect(this.volumeGain)
                this.volumeGain.connect(this.ctx.destination)
                this._applyVolume()
            } catch (e) {
                console.error('rebuildAudioGraph error:', e)
            }
        },
        // 应用音量:有 volumeGain 时用 GainNode 控制(支持 >100%),否则降级用 audio.volume
        _applyVolume() {
            const gain = this.volume / 100
            if (this.volumeGain && this.ctx) {
                this.audio.volume = 1.0
                this.volumeGain.gain.setValueAtTime(gain, this.ctx.currentTime)
            } else if (this.audio) {
                // ctx 尚未建立时,用原生 audio.volume(上限 1.0)
                this.audio.volume = Math.min(1, gain)
            }
        },
        async resetAudioElement() {
            const savedSrc = this.audio?.src || ''
            const savedTime = this.currentTime
            const savedVolume = this.volume
            const wasPlaying = this.isPlaying

            if (this.audio) {
                try { this.audio.pause(); this.audio.src = ''; this.audio.load() } catch (e) {}
                this.audio = null
            }
            if (this.ctx) {
                try { this.ctx.close() } catch (e) {}
                this.ctx = null
                this.analyser = null
                this.source = null
                this.eqFilters = []
                this.eqDryGain = null
                this.eqWetGain = null
            }

            this.audio = new Audio()
            this.audio.crossOrigin = "anonymous";
            this.audio.ontimeupdate = () => {
                this.currentTime = this.audio.currentTime
                // 无缝播放：提前1秒预加载
                if (this.audio.duration && this.audio.currentTime > 0 && this.audio.duration - this.audio.currentTime < 1 && !this._nextPreloaded) {
                    this._nextPreloaded = true
                    this._preloadNextSong()
                }
                if (this.showDesktopLyrics) {
                    this.updateDesktopLyricsState()
                }
            }
            this.audio.onended = () => { this._nextPreloaded = false; this.next() }
            this.audio.onerror = (e) => {
                console.error('Audio error:', e)
                this.isPlaying = false
            }
            this.audio.onloadedmetadata = () => {
                // QQ 歌曲: 始终用 audio.duration 覆盖(QQ API interval 字段单位不稳定,
                //   且流媒体实际时长才是播放器真正需要的)
                // 其他歌曲: 仅在 duration 为 0 时覆盖(避免覆盖已正确的元数据)
                if (this.currentSong?.platform === 'qq' || !this.currentSong.duration || this.currentSong.duration === 0) {
                    this.currentSong.duration = this.audio.duration
                }
            }
            this.audio.volume = Math.min(1, savedVolume / 100)

            this.audio.src = savedSrc

            // 设置音频设备（在 src 之后，load 之前）
            if (this.currentDeviceId && this.audio.setSinkId) {
                try {
                    await this.audio.setSinkId(this.currentDeviceId)
                    console.log(`--- [Audio] 设备已切换到: ${this.currentDeviceId}`)
                } catch (e) {
                    console.error('setSinkId error:', e)
                }
            }

            this.audio.load()

            await this.rebuildAudioGraph()

            if (wasPlaying) {
                this.audio.currentTime = savedTime
                if (this.ctx) await this.ctx.resume()
                this.audio.play().then(() => { this.isPlaying = true }).catch(() => {})
            }
        },
        async setupEqChain() {
            if (!this.audio || !this.audio.src) return
            await this.resetAudioElement()
        },
        teardownEqChain() {
            return this.setupEqChain()
        },
        async playSong(song, list = [], options = {}) {
            this.initAudio()
            if (!song || !song.id) return

            // 同一首歌再次点击：直接从头播放，不重新设置 src（避免浏览器忽略重复 src 导致无反应）
            if (this.currentSong && this.currentSong.id === song.id && this.audio && this.audio.src) {
                if (list.length > 0) {
                    this.playlist = [...list]
                    this.currentIndex = this.playlist.findIndex(s => s.id === song.id)
                }
                try {
                    if (this.ctx) await this.ctx.resume()
                    this.audio.currentTime = 0
                    await this.audio.play()
                    this.isPlaying = true
                } catch (e) { console.error('Replay same song fail:', e) }
                return
            }

            // 清空旧歌曲的歌词缓存，防止切歌时闪烁上一首的歌词
            this.lyrics = []
            this.yrcLyrics = null

            // Update playlist if provided, otherwise ensure song is in current playlist
            if (list.length > 0) {
                this.playlist = [...list]
                this.currentIndex = this.playlist.findIndex(s => s.id === song.id)
            } else {
                const index = this.playlist.findIndex(s => s.id === song.id)
                if (index === -1) {
                    this.playlist.push(song)
                    this.currentIndex = this.playlist.length - 1
                } else {
                    this.currentIndex = index
                }
            }

            try {
                let url = song.url
                const isLocal = typeof song.id === 'string' && song.id.startsWith('local-')
                const isCloud = typeof song.id === 'string' && song.id.startsWith('cloud-')
                const isQQ = song.platform === 'qq' || (song.songmid && !isLocal && !isCloud)

                if (isQQ && !url) {
                    // QQ 音乐：通过 IPC 调用 qq:song-play 获取播放地址
                    // 必须传 cookie，否则 QQ 服务器返回空 URL + "暂无播放链接"
                    // 音质优先级：320 -> 128
                    const songmid = song.songmid || song.id
                    // 从 qqUserStore 获取 cookie（QQ 播放链接需要登录态）
                    const { useQQUserStore } = await import('./qq-user')
                    const qqUserStore = useQQUserStore()
                    const cookie = qqUserStore.cookie || ''
                    const tryQualities = ['320', '128']
                    let lastError = ''
                    for (const q of tryQualities) {
                        try {
                            const res = await qqSongPlay(songmid, q, cookie)
                            // 真实返回结构（无 response 包裹）：{ data: { playUrl: { [songmid]: { url, error } } } }
                            const data = res?.data || res
                            const playUrlEntry = data?.playUrl?.[songmid] || data?.playUrl?.[String(songmid)] || {}
                            const playUrl = playUrlEntry?.url || data?.url || data?.midurlinfo?.[0]?.purl
                            if (playUrl && typeof playUrl === 'string') {
                                url = playUrl.startsWith('http') ? playUrl : `https:${playUrl}`
                                useMessageStore().info(`当前播放音质：${q === '320' ? '高品 320' : '标准 128'}`)
                                break
                            }
                            // 记录错误信息（如"暂无播放链接"）
                            if (playUrlEntry?.error) lastError = playUrlEntry.error
                        } catch (e) {
                            console.error('[QQ] song-play error:', e)
                        }
                    }
                    if (!url) {
                        // 区分错误原因：未登录 vs 版权限制
                        if (!cookie) {
                            useMessageStore().error(`播放失败：[${song.name}] 请先登录 QQ 音乐账号`)
                        } else {
                            useMessageStore().error(`播放失败：[${song.name}] ${lastError || '由于版权或 VIP 限制，QQ 音乐资源不可用'}`)
                        }
                        this.next()
                        return
                    }
                } else if (!url && !isLocal && !isCloud) {
                    // 沉浸环绕声型等高阶音质多数歌曲无资源，逐级回退保证可播放
                    const surroundFallback = ['jyeffect', 'jymaster', 'sky', 'dolby', 'hires']
                    let tryLevels = [this.quality]
                    if (surroundFallback.includes(this.quality)) {
                        tryLevels = [this.quality, 'lossless', 'exhigh', 'standard']
                    }
                    for (const lv of tryLevels) {
                        const res = await getSongUrl(song.id, lv, this.immerseType)
                        const songData = res.data?.[0] || res?.[0]
                        if (songData?.url) {
                            url = songData.url
                            // 用请求参数 lv 作为音质提示依据（API 返回的 level 字段不可靠）
                            if (!options.suppressQualityPrompt) {
                                if (lv !== this.quality) {
                                    useMessageStore().info(`当前音质无资源，已回退到：${qualityLabel(lv)}`)
                                } else {
                                    useMessageStore().info(`当前播放音质：${qualityLabel(lv)}`)
                                }
                            }
                            break
                        }
                    }
                }

                if (!url && !isLocal) {
                    useMessageStore().error(`播放失败：[${song.name}] 由于版权或VIP限制，${qualityLabel(this.quality)} 音质资源不可用`)
                    this.next()
                    return
                }

                // Normalize for display
                const normalized = {
                    id: song.id,
                    name: song.name,
                    artist: song.ar ? song.ar.map(a => a.name).join('/') :
                        (song.artists ? song.artists.map(a => a.name).join('/') :
                            (song.song?.artists ? song.song.artists.map(a => a.name).join('/') : (song.artist || '未知歌手'))),
                    al: song.al || (song.album || (song.song?.album || { name: '未知专辑', picUrl: '' })),
                    // QQ 歌曲: duration 初始设为 0,强制由 onloadedmetadata 用 audio.duration 填充
                    // (QQ API interval 字段单位不稳定,有时秒有时毫秒,导致 4000+ 分钟错误)
                    // 其他歌曲: dt(毫秒)/1000 = 秒,本地歌曲直接用 duration(秒)
                    duration: isQQ ? 0 : (isLocal ? (song.duration || song.dt / 1000 || 0) : ((song.dt || (song.song?.duration || 0)) / 1000)),
                    url: url,
                    path: song.path,
                    // QQ 平台标识：用于切歌时识别 QQ 歌曲、获取歌词、预加载
                    platform: song.platform || (isQQ ? 'qq' : ''),
                    songmid: song.songmid,
                    // 保留 QQ 歌曲的封面/专辑 mid/vid 等字段(切歌/显示封面/播放 MV 用)
                    picUrl: song.picUrl || song.al?.picUrl || '',
                    albummid: song.albummid || '',
                    albumid: song.albumid || 0,
                    album: song.album || song.al?.name || '',
                    vid: song.vid || ''
                }

                if (!normalized.al.picUrl) {
                    normalized.al.picUrl = song.picUrl || (song.song?.album?.picUrl || 'https://p2.music.126.net/6y-U6QnSjd_5419m1B0R_g==/109951165034938831.jpg?param=300y300')
                }
                // QQ 歌曲:确保 al.picUrl 与顶层 picUrl 一致(底部播放条/歌曲详情用 al.picUrl)
                if (isQQ && normalized.picUrl && !normalized.al.picUrl) {
                    normalized.al.picUrl = normalized.picUrl
                }

                this.currentSong = normalized
                this.audio.crossOrigin = isLocal ? null : "anonymous"

                this.audio.src = url
                this.audio.playbackRate = this.playbackRate

                // 设置音频设备（在 src 之后，load 之前）
                if (this.currentDeviceId && this.audio.setSinkId) {
                    try {
                        await this.audio.setSinkId(this.currentDeviceId)
                        console.log(`--- [Audio] playSong 设备已切换到: ${this.currentDeviceId}`)
                    } catch (e) { console.error('setSinkId:', e) }
                }

                this.audio.load()

                // 重建 audio graph（统一使用 createMediaElementSource）
                await this.rebuildAudioGraph()

                if (this.ctx) {
                    await this.ctx.resume()
                }

                // 每次新播放/重新播放都强制回到歌曲开头
                this.audio.currentTime = 0

                this.audio.play().then(() => {
                    this.isPlaying = true
                }).catch(error => {
                    console.error('Playback fail:', error)
                    if (isLocal) {
                        useMessageStore().error('本地文件加载失败，请确定文件路径正确且协议已注册。')
                    }
                })

                // 获取歌词逻辑：
                // - 本地音乐：检查本地歌词文件 → 无YRC则弹窗选择歌词源
                // - 云音乐：从云端 lyricUrl 拉取歌词 → 无YRC则弹窗选择歌词源（和本地同规格）
                // - 线上歌曲：缓存 → QQ匹配 → 网易云回退
                // - QQ 歌曲：静默自动加载(和网易云同规格,不弹窗)
                //   流程:缓存 → QQ 歌词源自动匹配 → 网易云 API 回退 → 都失败显示"纯音乐"
                if (isQQ) {
                    ;(async () => {
                        try {
                            const songmid = song.songmid || song.id
                            const cacheKey = `lyric_cache_qq_${songmid}`
                            // 1. 先读 localStorage 缓存
                            const cachedLyric = localStorage.getItem(cacheKey)
                            if (cachedLyric) {
                                try {
                                    const cached = JSON.parse(cachedLyric)
                                    if (cached.yrc) this.parseYrcLyrics(cached.yrc, cached.ytlrc || '')
                                    if (cached.lrc) this.parseLyrics(cached.lrc, cached.tlrc || '')
                                    this.lyricSource = 'qq'
                                    console.log(`--- [Lyric] QQ 缓存命中: ${normalized.name}`)
                                    return
                                } catch (e) { /* ignore */ }
                            }
                            // 2. 无缓存：通过 IPC 静默匹配 QQ 歌词源(不弹窗)
                            //    searchAndFetchQQ 内部用歌名+歌手+时长匹配,命中后直接返回 lrc/yrc/trans
                            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
                            const cleanArtist = String(normalized.artist).replace(/未知歌手|Unknown Artist/g, '').trim()
                            if (bridge && bridge.getQQLyric) {
                                try {
                                    const res = await bridge.getQQLyric({
                                        songName: normalized.name,
                                        artist: cleanArtist,
                                        duration: normalized.duration
                                    })
                                    if (res && res.matched && (res.lrc || res.yrc)) {
                                        if (res.yrc) this.parseYrcLyrics(res.yrc, res.trans || '')
                                        if (res.lrc) this.parseLyrics(res.lrc, res.trans || '')
                                        this.lyricSource = 'qq'
                                        // 写入缓存
                                        try {
                                            localStorage.setItem(cacheKey, JSON.stringify({
                                                lrc: res.lrc || '',
                                                yrc: res.yrc || '',
                                                tlrc: res.trans || '',
                                                ytlrc: res.trans || ''
                                            }))
                                        } catch (e) { /* ignore */ }
                                        console.log(`--- [Lyric] QQ 自动匹配成功: ${normalized.name}`)
                                        return
                                    }
                                } catch (e) {
                                    console.warn('[Lyric] QQ 自动匹配异常:', e.message)
                                }
                            }
                            // 3. QQ 匹配失败：尝试网易云 API 回退(用歌名+歌手搜索,取第一条歌词)
                            try {
                                const searchRes = await cloudSearch({
                                    keywords: `${normalized.name} ${cleanArtist}`.trim(),
                                    limit: 5
                                })
                                const neteaseSong = searchRes?.body?.result?.songs?.[0]
                                if (neteaseSong && neteaseSong.id) {
                                    const lyricRes = await getNewLyric(neteaseSong.id)
                                    const lrc = lyricRes?.lrc?.lyric || ''
                                    const yrc = lyricRes?.yrc?.lyric || ''
                                    const tlc = lyricRes?.tlyric?.lyric || ''
                                    if (yrc) {
                                        this.parseYrcLyrics(yrc, tlc)
                                        this.lyricSource = 'netease'
                                    } else if (lrc) {
                                        this.parseLyrics(lrc, tlc)
                                        this.lyricSource = 'netease'
                                    }
                                    if (lrc || yrc) {
                                        // 写入缓存
                                        try {
                                            localStorage.setItem(cacheKey, JSON.stringify({
                                                lrc, yrc, tlrc: tlc, ytlrc: tlc
                                            }))
                                        } catch (e) { /* ignore */ }
                                        console.log(`--- [Lyric] QQ 歌曲走网易云回退成功: ${normalized.name}`)
                                        return
                                    }
                                }
                            } catch (e) {
                                console.warn('[Lyric] 网易云回退失败:', e.message)
                            }
                            // 4. 都失败：显示"纯音乐"(和网易云无歌词时的表现一致,不弹窗)
                            console.log(`--- [Lyric] QQ 歌曲无歌词,显示纯音乐: ${normalized.name}`)
                            this.lyrics = [{ time: 0, text: '纯音乐，请欣赏' }]
                            this.yrcLyrics = null
                            this.lyricSource = ''
                        } catch (err) {
                            console.error('[Lyric] QQ lyric error:', err)
                            if (!this.lyrics.length) this.lyrics = []
                        }
                    })()
                } else if (isLocal && song.path) {
                    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
                    let hasLocalLyric = false
                    let hasLocalYrc = false

                    // 1. 先检查本地是否有歌词文件
                    if (bridge && bridge.loadLocalLyric) {
                        const lRes = await bridge.loadLocalLyric(song.path)
                        if (lRes.success) {
                            const content = lRes.lyric || ''
                            if (content.includes('---yrc---')) {
                                // 有逐词数据
                                const parts = content.split('---yrc---')
                                const lrcPart = parts[0].trim()
                                let yrcPart = parts[1] || ''
                                let ytlrcPart = ''
                                if (yrcPart.includes('---ytlrc---')) {
                                    const yrcParts = yrcPart.split('---ytlrc---')
                                    yrcPart = yrcParts[0].trim()
                                    ytlrcPart = yrcParts[1] ? yrcParts[1].trim() : ''
                                } else { yrcPart = yrcPart.trim() }
                                if (yrcPart) { this.parseYrcLyrics(yrcPart, ytlrcPart); hasLocalYrc = true }
                                if (lrcPart) this.parseLyrics(lrcPart)
                                this.lyricSource = 'local'
                                hasLocalLyric = true
                            } else {
                                // 检测是否为本地逐字 LRC 格式
                                const wordByWord = this.parseWordByWordLyrics(content)
                                if (wordByWord) {
                                    this.yrcLyrics = wordByWord.yrc
                                    this.lyrics = wordByWord.lrc
                                    this.lyricSource = 'local'
                                    hasLocalLyric = true
                                    hasLocalYrc = true
                                    useMessageStore().info(`使用本地逐字歌词:《${normalized.name}》`)
                                } else {
                                    // 普通歌词，直接用
                                    this.parseLyrics(content)
                                    this.lyricSource = 'local'
                                    hasLocalLyric = true
                                    useMessageStore().info(`使用本地歌词:《${normalized.name}》`)
                                }
                            }
                        }
                    }

                    // 2. 本地无 YRC 逐词歌词（只有普通歌词或完全无歌词）→ 触发多平台歌词选择弹窗
                    // 本地歌曲都需要弹窗让用户选歌词（QQ + 酷狗 + 网易云兜底）
                    if (!hasLocalYrc) {
                        const cleanArtist = String(normalized.artist).replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
                        // 通过事件总线触发 LyricSelector 弹窗（QQ + 酷狗 + 网易云兜底）
                        window.dispatchEvent(new CustomEvent('show-lyric-selector', {
                            detail: {
                                songName: normalized.name,
                                artist: cleanArtist,
                                songPath: song.path,
                                duration: normalized.duration
                            }
                        }))
                    }
                } else if (isCloud) {
                    // 云音乐：和本地音乐同规格，只是歌词存储在云端（lyricUrl）
                    // 1. 从云端 lyricUrl 拉取歌词
                    let hasCloudYrc = false
                    if (song.lyricUrl) {
                        try {
                            const lyricRes = await fetch(song.lyricUrl)
                            const lyricText = await lyricRes.text()
                            if (lyricText) {
                                if (lyricText.includes('---yrc---')) {
                                    const parts = lyricText.split('---yrc---')
                                    const lrcPart = parts[0].trim()
                                    let yrcPart = parts[1] || ''
                                    let ytlrcPart = ''
                                    if (yrcPart.includes('---ytlrc---')) {
                                        const yrcParts = yrcPart.split('---ytlrc---')
                                        yrcPart = yrcParts[0].trim()
                                        ytlrcPart = yrcParts[1] ? yrcParts[1].trim() : ''
                                    } else { yrcPart = yrcPart.trim() }
                                    if (yrcPart) { this.parseYrcLyrics(yrcPart, ytlrcPart); hasCloudYrc = true }
                                    if (lrcPart) this.parseLyrics(lrcPart)
                                    this.lyricSource = 'cloud'
                                } else {
                                    const wordByWord = this.parseWordByWordLyrics(lyricText)
                                    if (wordByWord) {
                                        this.yrcLyrics = wordByWord.yrc
                                        this.lyrics = wordByWord.lrc
                                        hasCloudYrc = true
                                        this.lyricSource = 'cloud'
                                    } else {
                                        this.parseLyrics(lyricText)
                                        this.lyricSource = 'cloud'
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Cloud lyric load failed:', e)
                        }
                    }

                    // 2. 云端无 YRC 歌词 → 弹窗选择歌词源（和本地音乐一样的规格，不保存到云端）
                    if (!hasCloudYrc) {
                        const cleanArtist = String(normalized.artist).replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
                        window.dispatchEvent(new CustomEvent('show-lyric-selector', {
                            detail: {
                                songName: normalized.name,
                                artist: cleanArtist,
                                songPath: '',
                                duration: normalized.duration
                            }
                        }))
                    }
                } else if (song.id) {
                    // 检查 Electron 本地文件缓存（优先级最高，支持离线）
                    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
                    let fileCacheLoaded = false
                    
                    if (bridge && bridge.loadOnlineLyricCache) {
                        try {
                            const fileRes = await bridge.loadOnlineLyricCache(String(song.id))
                            if (fileRes.success && fileRes.lyric) {
                                console.log(`--- [Lyric] 从文件缓存加载: ${song.name}`)
                                
                                let cachedLrc = fileRes.lyric
                                let cachedTlrc = ''
                                let cachedYrc = ''
                                let cachedYtlrc = ''
                                
                                // 提取 yrc 逐词数据
                                if (cachedLrc.includes('---yrc---')) {
                                    const yrcParts = cachedLrc.split('---yrc---')
                                    cachedLrc = yrcParts[0]
                                    cachedYrc = yrcParts[1] || ''
                                    if (cachedYrc.includes('---ytlrc---')) {
                                        const ytParts = cachedYrc.split('---ytlrc---')
                                        cachedYrc = ytParts[0].trim()
                                        cachedYtlrc = ytParts[1] ? ytParts[1].trim() : ''
                                    } else {
                                        cachedYrc = cachedYrc.trim()
                                    }
                                }
                                
                                // 处理带 ---trans--- 标识的合并歌词
                                if (cachedLrc.includes('---trans---')) {
                                    const parts = cachedLrc.split('---trans---')
                                    cachedLrc = parts[0].trim()
                                    cachedTlrc = parts[1] ? parts[1].trim() : ''
                                }
                                
                                // 移除元数据头部（[ti:] [ar:] 等）
                                cachedLrc = cachedLrc.replace(/^\[ti:.*\]\n?/gm, '')
                                                   .replace(/^\[ar:.*\]\n?/gm, '')
                                                   .replace(/^\[id:.*\]\n?/gm, '')
                                                   .replace(/^\[saved:.*\]\n?/gm, '')
                                                   .trim()
                                
                                if (cachedYrc) {
                                    this.parseYrcLyrics(cachedYrc, cachedYtlrc)
                                }
                                if (cachedLrc) {
                                    this.parseLyrics(cachedLrc, cachedTlrc)
                                    fileCacheLoaded = true
                                }
                            }
                        } catch (e) {
                            console.error('File cache load error:', e)
                        }
                    }
                    
                    // 检查 localStorage 缓存（备用）
                    const cacheKey = `lyric_cache_${song.id}`
                    if (!fileCacheLoaded) {
                        const cachedLyric = localStorage.getItem(cacheKey)
                        if (cachedLyric) {
                            try {
                                const cached = JSON.parse(cachedLyric)
                                // 优先加载 yrc 逐词歌词
                                if (cached.yrc) {
                                    this.parseYrcLyrics(cached.yrc, cached.ytlrc || '')
                                }
                                if (cached.lrc) {
                                    this.parseLyrics(cached.lrc, cached.tlrc || '')
                                    console.log(`--- [Lyric] 使用localStorage缓存: ${cached.songName || song.name}`)
                                }
                            } catch (e) {
                                console.error('Lyric cache parse error:', e)
                            }
                        }
                    }
                    
                    // 线上歌曲：优先使用 QQ 歌词（匹配作者+歌名），不匹配则回退网易云
                    ;(async () => {
                        try {
                            let yrcRaw = '', ytlrcRaw = '', lrc = '', tlrc = ''
                            let usedQQ = false

                            // 1. 尝试 QQ 歌词（匹配作者+歌名+时长，不一致则跳过）
                            if (bridge && bridge.getQQLyric) {
                                try {
                                    const qqRes = await bridge.getQQLyric({
                                        songName: normalized.name,
                                        artist: normalized.artist,
                                        duration: normalized.duration // 秒
                                    })
                                    if (qqRes && qqRes.matched && (qqRes.lrc || qqRes.yrc)) {
                                        console.log(`--- [Lyric] 使用 QQ 音乐歌词: ${normalized.name}`)
                                        yrcRaw = qqRes.yrc || ''
                                        ytlrcRaw = qqRes.trans || ''
                                        lrc = qqRes.lrc || ''
                                        tlrc = qqRes.trans || ''
                                        usedQQ = true
                                        this.lyricSource = 'qq'
                                    }
                                } catch (e) {
                                    console.error('QQ lyric fetch failed:', e)
                                }
                            }

                            // 2. QQ 不匹配 → 回退网易云
                            if (!usedQQ) {
                                console.log(`--- [Lyric] QQ 未匹配，回退网易云: ${normalized.name}`)
                                const lRes = await getNewLyric(song.id)
                                yrcRaw = lRes.yrc?.lyric || ''
                                ytlrcRaw = lRes.ytlrc?.lyric || ''
                                lrc = lRes.lrc?.lyric || ''
                                tlrc = lRes.tlyric?.lyric || ''
                                this.lyricSource = 'netease'
                            }

                            // 3. 解析歌词
                            if (yrcRaw) {
                                this.parseYrcLyrics(yrcRaw, ytlrcRaw)
                                if (lrc) this.parseLyrics(lrc, tlrc)
                            } else if (lrc) {
                                this.yrcLyrics = null
                                this.parseLyrics(lrc, tlrc)
                            }

                            // 4. 保存到缓存（localStorage + Electron 本地文件）
                            if (lrc || yrcRaw) {
                                try {
                                    const lyricData = { lrc, tlrc, yrc: yrcRaw, ytlrc: ytlrcRaw, savedAt: Date.now(), songName: normalized.name }
                                    localStorage.setItem(cacheKey, JSON.stringify(lyricData))
                                } catch (e) { /* ignore */ }

                                if (bridge && bridge.saveOnlineLyric) {
                                    let saveLrc = lrc
                                    let saveTlrc = tlrc
                                    if (yrcRaw) {
                                        saveLrc = (tlrc ? `${lrc}\n---trans---\n${tlrc}` : lrc) + `\n---yrc---\n${yrcRaw}`
                                        if (ytlrcRaw) saveLrc += `\n---ytlrc---\n${ytlrcRaw}`
                                        saveTlrc = ''
                                    }
                                    bridge.saveOnlineLyric({
                                        songId: String(song.id),
                                        songName: normalized.name,
                                        artist: normalized.artist,
                                        lrc: saveLrc,
                                        tlrc: saveTlrc
                                    }).catch(e => console.error('File lyric save error:', e))
                                }
                            }
                        } catch (err) {
                            console.error('Lyrics error:', err)
                            if (!this.lyrics.length) this.lyrics = []
                        }
                    })()
                }

                this.checkIfLiked(song.id)
                this.addToRecent(normalized)

            } catch (err) {
                console.error('playSong error:', err)
            }
        },
        async checkIfLiked(id) {
            this.isLiked = false
            if (!id) return
            // QQ 平台：使用本地收藏列表（QQ API 无喜欢接口）
            if (this.currentSong?.platform === 'qq') {
                const liked = JSON.parse(localStorage.getItem('qq_liked_songs') || '[]')
                this.isLiked = liked.some(s => (s.songmid || s.id) === (this.currentSong.songmid || id))
                return
            }
            const { useUserStore } = await import('./user')
            const user = useUserStore()
            if (user.isLoggedIn) {
                this.isLiked = user.isSongLiked(id)
            }
        },
        async toggleLike() {
            if (!this.currentSong.id) return
            // QQ 平台:线上红心收藏需要前端动态 sign 参数(QQ 音乐反爬限制)
            // 桌面端无法实现 sign 计算,红心状态仅显示线上"我喜欢"歌单的同步结果
            // 点击红心时提示用户去官方 App 操作,不修改本地状态
            if (this.currentSong.platform === 'qq') {
                useMessageStore().info('QQ 音乐红心请前往 QQ 音乐官方 App 操作', 3000)
                return
            }
            const { useUserStore } = await import('./user')
            const user = useUserStore()
            if (!user.isLoggedIn) { useMessageStore().warning('请先登录后再进行收藏'); return }

            const newStatus = !this.isLiked
            try {
                const res = await request.get('/like', {
                    params: {
                        id: this.currentSong.id,
                        like: newStatus,
                        timestamp: Date.now()
                    }
                })
                if (res.code === 200) {
                    this.isLiked = newStatus
                    user.toggleLike(this.currentSong.id, newStatus)
                }
            } catch (e) {
                console.error('Like failed:', e)
            }
        },
        updateFrequencyData() {
            if (this.analyser && this.dataArray) {
                this.analyser.getByteFrequencyData(this.dataArray)
                return this.dataArray
            }
            return null
        },
        // 窗口隐藏时释放非必要资源（Audio 保留，用户可能在后台听歌）
        // 断开 analyser 节点释放频谱分析相关内存，下次 show 时由 rebuildAudioGraph 重建
        releaseVisualizerResources() {
            try {
                if (this.analyser) {
                    try { this.analyser.disconnect() } catch (e) {}
                    this.analyser = null
                    this.dataArray = null
                }
            } catch (e) { /* 静默 */ }
        },
        togglePlay() {
            if (!this.audio?.src) return
            if (this.isPlaying) {
                this.audio.pause()
                this.isPlaying = false
            } else {
                if (this.ctx) {
                    this.ctx.resume().then(() => {
                        this.audio.play().then(() => {
                            this.isPlaying = true
                        }).catch(e => console.error(e))
                    })
                } else {
                    this.initAudio()
                    this.audio.play().then(() => {
                        this.isPlaying = true
                    }).catch(e => console.error(e))
                }
            }
        },
        setProgress(percent) {
            if (!this.audio || !this.currentSong.duration) return
            this.audio.currentTime = this.currentSong.duration * percent
        },
        seek(time) {
            if (!this.audio) return
            this.audio.currentTime = time
        },
        setVolume(vol) {
            this.volume = Math.max(0, Math.min(500, vol))
            this._applyVolume()
        },
        _preloadNextSong() {
            if (this.playlist.length === 0) return
            let nextIndex = (this.currentIndex + 1) % this.playlist.length
            if (this.playMode === 2) nextIndex = Math.floor(Math.random() * this.playlist.length)
            if (this.playMode === 1) return // 单曲循环不需要预加载
            // 清理上一次的预加载 Audio 对象，避免内存泄漏
            if (this._preloadAudio) {
                try { this._preloadAudio.src = ''; this._preloadAudio.load() } catch (e) {}
                this._preloadAudio = null
            }
            const nextSong = this.playlist[nextIndex]
            if (!nextSong || !nextSong.id) return
            const isLocal = String(nextSong.id).startsWith('local-')
            if (isLocal) return // 本地歌曲不预加载（路径协议已注册，加载快）
            const isQQ = nextSong.platform === 'qq' || !!nextSong.songmid
            const preload = new Audio()
            preload.crossOrigin = 'anonymous'
            preload.preload = 'auto'
            this._preloadAudio = preload
            if (isQQ) {
                // QQ 歌曲：通过 IPC 获取播放地址（需传 cookie）
                Promise.all([
                    import('../api/qq'),
                    import('./qq-user')
                ]).then(([{ qqSongPlay }, { useQQUserStore }]) => {
                    const songmid = nextSong.songmid || nextSong.id
                    const cookie = useQQUserStore().cookie || ''
                    return qqSongPlay(songmid, '128', cookie)
                }).then(res => {
                    if (this._preloadAudio !== preload) return
                    const data = res?.data || res
                    const songmid = nextSong.songmid || nextSong.id
                    // 真实返回结构：{ data: { playUrl: { [songmid]: { url, error } } } }
                    const playUrlEntry = data?.playUrl?.[songmid] || data?.playUrl?.[String(songmid)] || {}
                    const url = playUrlEntry?.url || data?.url || data?.midurlinfo?.[0]?.purl
                    if (url && typeof url === 'string') {
                        preload.src = url.startsWith('http') ? url : `https:${url}`
                        preload.load()
                    }
                }).catch(e => console.error('[Preload] QQ song error:', e))
            } else {
                // 网易云歌曲
                import('../api').then(({ getSongUrl }) => {
                    getSongUrl(nextSong.id, this.quality, this.immerseType).then(res => {
                        // 切歌后可能已过期，检查引用是否仍然有效
                        if (this._preloadAudio === preload) {
                            const url = res.data?.[0]?.url
                            if (url) { preload.src = url; preload.load() }
                        }
                    })
                })
            }
        },
        next() {
            if (this.playlist.length === 0) return

            let nextIndex = this.currentIndex
            if (this.playMode === 2) { // Random
                nextIndex = Math.floor(Math.random() * this.playlist.length)
            } else if (this.playMode === 1) { // Loop single
                this.audio.currentTime = 0
                this.audio.play()
                return
            } else { // Sequence
                nextIndex = (this.currentIndex + 1) % this.playlist.length
            }

            this.playSong(this.playlist[nextIndex])
        },
        prev() {
            if (this.playlist.length === 0) return
            let prevIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length
            this.playSong(this.playlist[prevIndex])
        },
        togglePlayMode() {
            this.playMode = (this.playMode + 1) % 3
        },
        clearPlaylist() {
            this.playlist = []
            this.currentIndex = -1
            this.currentSong = {
                id: null,
                name: '歌曲名',
                artist: '歌手',
                al: { name: '专辑', picUrl: '' },
                duration: 0
            }
            if (this.audio) {
                this.audio.pause()
                this.audio.src = ''
            }
            this.isPlaying = false
        },
        movePlaylistItem(fromIndex, toIndex) {
            if (fromIndex < 0 || fromIndex >= this.playlist.length) return
            if (toIndex < 0 || toIndex >= this.playlist.length) return
            if (fromIndex === toIndex) return
            const item = this.playlist.splice(fromIndex, 1)[0]
            this.playlist.splice(toIndex, 0, item)
            if (this.currentIndex === fromIndex) {
                this.currentIndex = toIndex
            } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
                this.currentIndex--
            } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
                this.currentIndex++
            }
        },
        parseLyrics(lrc, tlrc) {
            if (!lrc) {
                this.lyrics = []
                return
            }

            // 处理本地合并保存的歌词 (带有 ---trans--- 标识)
            if (lrc.includes('---trans---')) {
                const parts = lrc.split('---trans---')
                lrc = parts[0].trim()
                tlrc = parts[1].trim()
            }

            const parse = (text) => {
                if (!text) return []
                const lines = text.split('\n')
                const result = []
                // 支持多时间标签并发、支持 [mm:ss] [mm:ss.ms] [mm:ss:ms] 
                const pattern = /\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

                lines.forEach(line => {
                    const matches = [...line.matchAll(pattern)]
                    if (matches.length > 0) {
                        let textContent = line.replace(pattern, '').trim()
                        // 跳过 QQ/酷狗翻译中的 "//" 空行占位符
                        if (textContent === '//') return
                        if (textContent) {
                            // 优化：处理单行内合并的双语歌词 (例如 "Original / Translation")
                            let tContent = ''
                            // 如果一行中包含 " / " 且此时并没有单独的翻译轨道，尝试拆分
                            if (textContent.includes(' / ') && !tlrc) {
                                const parts = textContent.split(' / ')
                                textContent = parts[0].trim()
                                tContent = parts[1].trim()
                            } else if (textContent.includes('/') && !tlrc && !textContent.startsWith('/') && !textContent.endsWith('//')) {
                                // 兼容没有空格的 /，但排除 "//" 占位符
                                const parts = textContent.split('/')
                                textContent = parts[0].trim()
                                tContent = parts[1].trim()
                            }

                            matches.forEach(m => {
                                const min = parseInt(m[1])
                                const sec = parseInt(m[2])
                                const msPart = m[3] || '0'
                                let ms = 0
                                if (msPart.length === 3) ms = parseInt(msPart) / 1000
                                else if (msPart.length === 2) ms = parseInt(msPart) / 100
                                else ms = parseInt(msPart) / 10

                                result.push({
                                    time: min * 60 + sec + ms,
                                    text: textContent,
                                    ttext: tContent // 保存内置翻译
                                })
                            })
                        }
                    }
                })
                return result.sort((a, b) => a.time - b.time)
            }

            const mainLrc = parse(lrc)
            const transLrc = parse(tlrc)

            this.lyrics = mainLrc.map(line => {
                // 如果 line 本身已经通过拆分获取了 ttext，优先使用
                if (line.ttext) return line

                // 模糊匹配翻译行 (允许 0.5 秒误差)
                const translation = transLrc.find(t => Math.abs(t.time - line.time) < 0.5)
                return {
                    ...line,
                    ttext: translation ? translation.text : ''
                }
            })
        },
        /**
         * 解析逐词歌词 (yrc 格式)
         * 格式: [lineStart,lineDuration](wordStart,wordDurationCentiseconds,0)text...
         * wordDuration 单位是厘秒 (0.01s) 根据文档
         * 但实际 API 返回的似乎是毫秒，这里按毫秒处理
         */
        parseYrcLyrics(yrcRaw, ytlrcRaw) {
            if (!yrcRaw) {
                this.yrcLyrics = null
                return
            }

            const lines = yrcRaw.split('\n')
            const result = []

            // 解析 ytlrc 翻译歌词（标准 LRC 时间戳格式）
            const transMap = new Map()
            if (ytlrcRaw) {
                const tLines = ytlrcRaw.split('\n')
                const tPattern = /\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/
                tLines.forEach(tl => {
                    const m = tl.match(tPattern)
                    if (m) {
                        const min = parseInt(m[1])
                        const sec = parseInt(m[2])
                        const msPart = m[3] || '0'
                        let ms = 0
                        if (msPart.length === 3) ms = parseInt(msPart) / 1000
                        else if (msPart.length === 2) ms = parseInt(msPart) / 100
                        else ms = parseInt(msPart) / 10
                        const timeMs = Math.round((min * 60 + sec + ms) * 1000)
                        const text = tl.replace(tPattern, '').trim()
                        if (text) transMap.set(timeMs, text)
                    }
                })
            }

            lines.forEach(line => {
                // 跳过 JSON 元数据行
                if (line.trim().startsWith('{')) return
                if (!line.trim()) return

                // 匹配行头: [lineStart,lineDuration]
                const lineHeaderMatch = line.match(/^\s*\[(\d+),(\d+)\]/)
                if (!lineHeaderMatch) return

                const lineStartMs = parseInt(lineHeaderMatch[1])
                const lineDurationMs = parseInt(lineHeaderMatch[2])

                // 提取所有逐字: (wordStart,wordDuration,flag)text
                // 参考 LDDC yrc.py 的 _WORD_SPLIT_PATTERN：用负向预查保证 text 可包含 '(' 等字符，
                // 只要不构成下一个时间戳 (\d+,\d+,\d+) 即可（如 "(Jay)" 的左括号）
                const wordPattern = /\((\d+),(\d+),(\d+)\)((?:(?!\(\d+,\d+,\d+\)).)*)/g
                const words = []
                let m
                while ((m = wordPattern.exec(line)) !== null) {
                    const wordStartMs = parseInt(m[1])
                    const wordDurationMs = parseInt(m[2]) // API 实际返回毫秒
                    const text = m[4]
                    if (text) {
                        words.push({
                            startTime: wordStartMs, // 毫秒
                            duration: wordDurationMs, // 毫秒
                            text: text
                        })
                    }
                }

                if (words.length > 0) {
                    // 查找翻译（允许 500ms 误差匹配）
                    let ttext = ''
                    for (const [tMs, tText] of transMap) {
                        if (Math.abs(tMs - lineStartMs) < 500) {
                            ttext = tText
                            break
                        }
                    }

                    result.push({
                        time: lineStartMs / 1000, // 转为秒，兼容现有的 currentLyricIndex
                        startTime: lineStartMs,
                        duration: lineDurationMs,
                        words: words,
                        text: words.map(w => w.text).join(''), // fallback 纯文本
                        ttext: ttext
                    })
                }
            })

            this.yrcLyrics = result.length > 0 ? result : null
        },
        /**
         * 解析本地逐字 LRC 格式
         * 格式: [mm:ss.xxx]字[mm:ss.xxx]字...
         * 返回 { yrc, lrc } 或 null（如果不是逐字格式）
         */
        parseWordByWordLyrics(rawText) {
            if (!rawText) return null

            const lines = rawText.split('\n')
            const yrcResult = []
            const lrcResult = []
            let wordLineCount = 0
            let validLineCount = 0

            const timePattern = /\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

            lines.forEach(line => {
                const matches = [...line.matchAll(timePattern)]
                if (matches.length === 0) return

                const fullText = line.replace(timePattern, '').trim()
                if (!fullText) return

                validLineCount++

                const parseTimeMs = (m) => {
                    const min = parseInt(m[1])
                    const sec = parseInt(m[2])
                    const msPart = m[3] || '0'
                    let ms = 0
                    if (msPart.length === 3) ms = parseInt(msPart) / 1000
                    else if (msPart.length === 2) ms = parseInt(msPart) / 100
                    else ms = parseInt(msPart) / 10
                    return Math.round((min * 60 + sec + ms) * 1000)
                }

                if (matches.length >= 2) {
                    wordLineCount++
                    const words = []

                    for (let i = 0; i < matches.length; i++) {
                        const m = matches[i]
                        const startTimeMs = parseTimeMs(m)
                        const startIndex = m.index + m[0].length
                        const endIndex = i < matches.length - 1 ? matches[i + 1].index : line.length
                        const text = line.slice(startIndex, endIndex).trim()

                        if (text) {
                            words.push({
                                startTime: startTimeMs,
                                duration: 0,
                                text
                            })
                        }
                    }

                    // 计算每个字的持续时长
                    for (let i = 0; i < words.length; i++) {
                        if (i < words.length - 1) {
                            words[i].duration = words[i + 1].startTime - words[i].startTime
                        } else {
                            // 最后一个字默认持续 500ms
                            words[i].duration = 500
                        }
                    }

                    if (words.length > 0) {
                        const lineStartMs = words[0].startTime
                        const lastWord = words[words.length - 1]
                        const lineDurationMs = lastWord.startTime + lastWord.duration - lineStartMs

                        yrcResult.push({
                            time: lineStartMs / 1000,
                            startTime: lineStartMs,
                            duration: lineDurationMs,
                            words,
                            text: fullText,
                            ttext: ''
                        })

                        lrcResult.push({
                            time: lineStartMs / 1000,
                            text: fullText,
                            ttext: ''
                        })
                    }
                } else {
                    const time = parseTimeMs(matches[0]) / 1000
                    lrcResult.push({
                        time,
                        text: fullText,
                        ttext: ''
                    })
                }
            })

            // 判定：逐字行数 >=3 且占比超过 30%
            if (wordLineCount >= 3 && wordLineCount / validLineCount > 0.3) {
                yrcResult.sort((a, b) => a.time - b.time)
                lrcResult.sort((a, b) => a.time - b.time)
                return { yrc: yrcResult, lrc: lrcResult }
            }

            return null
        },
        async playMv(id, title) {
            if (!id) return
            // Pause music if playing
            if (this.isPlaying) {
                this.audio.pause()
                this.isPlaying = false
            }

            try {
                const { getMvUrl: fetchMvUrl } = await import('../api')
                const res = await fetchMvUrl(id)
                // Handle both data.url and data.urls formats
                let url = res.data?.url
                if (!url && res.data?.urls) {
                    const keys = Object.keys(res.data.urls)
                    if (keys.length > 0) url = res.data.urls[keys[0]]
                }

                if (url) {
                    this.currentMvUrl = url
                    this.currentMvId = id
                    this.currentMvTitle = title || ''
                    this.showMvPlayer = true
                } else {
                    useMessageStore().warning('未获取到视频地址，由于版权或区域限制，该内容暂无法播放。')
                }
            } catch (err) {
                console.error('Play MV error:', err)
                useMessageStore().error('播放视频失败')
            }
        },
        // 直接播放指定的本地/在线视频文件（用于系统"打开方式"功能）
        playVideoFile(video) {
            if (!video || !video.url) return
            // 暂停音乐
            if (this.isPlaying && this.audio) {
                this.audio.pause()
                this.isPlaying = false
            }
            this.currentMvUrl = video.url
            this.currentMvId = null
            this.currentMvTitle = video.name || '本地视频'
            this.currentMvPlayType = 'direct'
            this.showMvPlayer = true
        },
        // 仅播放本地 MV（mode='local'）；找不到时返回 false，不自动回退到线上
        async playLocalMv() {
            if (!this.currentSong.name) return
            // 暂停音乐
            if (this.isPlaying) {
                this.audio.pause()
                this.isPlaying = false
            }

            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (bridge && bridge.findLocalMv) {
                try {
                    const mvDir = localStorage.getItem('mv_directory') || ''
                    const res = await bridge.findLocalMv({
                        songName: this.currentSong.name,
                        songPath: this.currentSong.path || '',
                        mvDir: mvDir
                    })
                    if (res && res.success) {
                        this.currentMvUrl = res.url
                        this.currentMvId = null
                        // 本地 MV 标题优先用文件名（去掉扩展名），否则用歌曲名
                        const fileName = res.name || res.path?.split(/[\\/]/).pop() || ''
                        this.currentMvTitle = fileName ? fileName.replace(/\.[^.]+$/, '') : this.currentSong.name
                        this.showMvPlayer = true
                        return true
                    }
                } catch (e) {
                    console.error('findLocalMv error:', e)
                }
            }
            useMessageStore().info('本地未找到匹配的MV。提示：将视频文件放在歌曲同目录下，或在歌曲目录下创建 mv 文件夹，视频文件名需与歌曲名一致；或点击"线上"用网易云 MV API 匹配')
            return false
        },
        // 线上：用网易云 MV 搜索 API 按歌名+作者匹配
        // 返回 true 表示已开始播放或弹出了选择面板
        async playOnlineMv() {
            if (!this.currentSong.name) return false
            if (this.isPlaying) {
                this.audio.pause()
                this.isPlaying = false
            }
            try {
                const { ncmMvSearch } = await import('../api')
                const res = await ncmMvSearch(this.currentSong.name)
                if (!res?.success || !res?.mvs?.length) {
                    useMessageStore().warning('网易云未搜索到该歌曲的 MV')
                    return false
                }
                // 按歌名+作者相似度排序，挑出最匹配的
                const songName = (this.currentSong.name || '').toLowerCase().trim()
                // 当前歌曲的作者可能用 / 连接多个歌手，拆分成数组用于匹配
                const artistRaw = this.currentSong.artist || this.currentSong.ar?.[0]?.name || ''
                const artistNames = artistRaw.split('/').map(s => s.toLowerCase().trim()).filter(Boolean)
                const scored = res.mvs.map(m => {
                    const n = (m.name || '').toLowerCase().trim()
                    const mvArtist = (m.artistName || '').toLowerCase().trim()
                    let score = 0
                    // 歌名匹配
                    if (n === songName) score += 3
                    else if (n.includes(songName) || songName.includes(n)) score += 2
                    else score += 1
                    // 作者匹配：检查 MV 作者是否包含当前歌曲的任意一个歌手
                    // （之前方向反了：用 m.artistName.includes(artistRaw) 导致多歌手永远匹配失败）
                    let artistMatched = false
                    if (artistNames.length && mvArtist) {
                        artistMatched = artistNames.some(a => mvArtist.includes(a) || a.includes(mvArtist))
                    }
                    if (artistMatched) score += 3  // 作者匹配权重与歌名相同，确保作者匹配的 MV 明显领先
                    if (m.playCount) score += Math.min(0.5, m.playCount / 1000000)
                    return { ...m, _score: score, _artistMatched: artistMatched }
                })
                scored.sort((a, b) => b._score - a._score)

                const best = scored[0]
                const second = scored[1]
                // 只有一个候选，或最高分作者匹配且明显领先：直接播放
                // 如果最高分作者不匹配，说明可能是同名不同人的歌，弹选择面板让用户确认
                if (scored.length === 1) {
                    await this.playMv(best.id, best.name)
                    useMessageStore().success(`正在播放线上 MV：${best.name}`, 2500)
                    return true
                }
                if (best._artistMatched && best._score > (second?._score || 0)) {
                    await this.playMv(best.id, best.name)
                    useMessageStore().success(`正在播放线上 MV：${best.name} - ${best.artistName}`, 2500)
                    return true
                }
                // 多个候选分接近 或 最高分作者不匹配：弹选择面板
                this.mvSearchCandidates = scored.slice(0, 6)
                this.showMvSearchPicker = true
                return true
            } catch (e) {
                console.error('playOnlineMv error:', e)
                useMessageStore().error('线上 MV 获取失败：' + (e.message || e))
                return false
            }
        },
        // 用户在 MV 选择面板中点击某个候选
        async playMvCandidate(mv) {
            this.showMvSearchPicker = false
            await this.playMv(mv.id, mv.name)
        },
        // 自动模式（旧调用入口）：先本地，找不到再线上
        async playMvAuto() {
            const ok = await this.playLocalMv()
            if (ok) return
            await this.playOnlineMv()
        },
        addToRecent(song) {
            const index = this.recentSongs.findIndex(s => s.id === song.id)
            if (index !== -1) {
                this.recentSongs.splice(index, 1)
            }
            this.recentSongs.unshift(song)
            if (this.recentSongs.length > 100) {
                this.recentSongs.pop()
            }
            localStorage.setItem('recent_songs', JSON.stringify(this.recentSongs))
        },
        addLocalSongs(songs) {
            // 更新并合并，相同路径的歌曲以新识别的元数据为准
            const currentSongs = [...this.localSongs]
            songs.forEach(ns => {
                const index = currentSongs.findIndex(ls => ls.path === ns.path)
                if (index !== -1) {
                    currentSongs[index] = ns
                } else {
                    currentSongs.push(ns)
                }
            })
            this.localSongs = currentSongs
            localStorage.setItem('local_songs', JSON.stringify(this.localSongs))
        },
        removeLocalSong(path) {
            this.localSongs = this.localSongs.filter(s => s.path !== path)
            localStorage.setItem('local_songs', JSON.stringify(this.localSongs))
        },
        removeLocalSongs(paths) {
            this.localSongs = this.localSongs.filter(s => !paths.includes(s.path))
            localStorage.setItem('local_songs', JSON.stringify(this.localSongs))
        },
        reorderLocalSongs(fromIndex, toIndex) {
            if (fromIndex === toIndex) return
            if (fromIndex < 0 || fromIndex >= this.localSongs.length) return
            if (toIndex < 0 || toIndex >= this.localSongs.length) return
            const list = [...this.localSongs]
            const [item] = list.splice(fromIndex, 1)
            list.splice(toIndex, 0, item)
            this.localSongs = list
            localStorage.setItem('local_songs', JSON.stringify(this.localSongs))
        },
        setQuality(q) {
            this.quality = q
            localStorage.setItem('music_quality', q)
            // QQ 平台音质独立处理：320/128 二选一，无沉浸声型
            if (this.currentSong?.platform === 'qq') {
                if (this.currentSong.id && this.isPlaying) {
                    const currentTime = this.currentTime
                    const songName = this.currentSong.name
                    this.playSong(this.currentSong, [], { suppressQualityPrompt: true }).then(() => {
                        this.seek(currentTime)
                        useMessageStore().success(`${songName} 已切换音质`)
                    }).catch(() => {
                        useMessageStore().error('切换音质失败，请稍后重试')
                    })
                } else {
                    useMessageStore().success('已设置默认音质')
                }
                return
            }
            if (this.currentSong && this.currentSong.id && !String(this.currentSong.id).startsWith('local-') && this.isPlaying) {
                const currentTime = this.currentTime
                const songName = this.currentSong.name
                this.playSong(this.currentSong, [], { suppressQualityPrompt: true }).then(() => {
                    this.seek(currentTime)
                    useMessageStore().success(`${songName} 已切换至 ${qualityLabel(q)} 音质`)
                }).catch(() => {
                    useMessageStore().error(`切换 ${qualityLabel(q)} 音质失败，请稍后重试`)
                })
            } else {
                useMessageStore().success(`已设置默认音质为 ${qualityLabel(q)}`)
            }
        },
        setImmerseType(t) {
            this.immerseType = t
            localStorage.setItem('music_immerse_type', t)
            // 仅在当前为沉浸环绕声时重新加载
            if (this.quality === 'sky' && this.currentSong && this.currentSong.id && !String(this.currentSong.id).startsWith('local-') && this.isPlaying) {
                const currentTime = this.currentTime
                this.playSong(this.currentSong).then(() => {
                    this.seek(currentTime)
                })
            }
        },
        setPlaybackRate(rate) {
            this.playbackRate = rate
            localStorage.setItem('playback_rate', rate)
            if (this.audio) this.audio.playbackRate = rate
        },
        toggleAutoFetchLyric() {
            this.autoFetchLyric = !this.autoFetchLyric
            localStorage.setItem('auto_fetch_lyric', this.autoFetchLyric)
        },
        toggleBgMode() {
            this.bgMode = this.bgMode === 'cover' ? 'classic' : 'cover'
            localStorage.setItem('player_bg_mode', this.bgMode)
        },
        toggleLyricDisplayMode() {
            this.lyricDisplayMode = this.lyricDisplayMode === 'word' ? 'line' : 'word'
            localStorage.setItem('lyric_display_mode', this.lyricDisplayMode)
        },
        toggleDesktopLyrics() {
            this.showDesktopLyrics = !this.showDesktopLyrics
            localStorage.setItem('show_desktop_lyrics', this.showDesktopLyrics)
            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (bridge && bridge.send) {
                bridge.send('toggle-desktop-lyrics', this.showDesktopLyrics)
            }
            if (this.showDesktopLyrics) {
                this.updateDesktopLyricsState()
                this._startDesktopLyricInterval()
            } else {
                this._stopDesktopLyricInterval()
            }
        },
        // 启动定时推送：主窗口最小化后 ontimeupdate + RAF 会被节流/暂停，
        // setInterval 虽也被降频但不会完全停止，
        // 配合桌面歌词窗口自身的 delta 累加可保持歌词持续滚动
        // 频率 1000ms：作为后台后备，主窗口可见时 ontimeupdate 已高频推送
        _startDesktopLyricInterval() {
            this._stopDesktopLyricInterval()
            this._desktopLyricTimer = setInterval(() => {
                if (this.showDesktopLyrics && this.isPlaying) {
                    this.updateDesktopLyricsState()
                }
            }, 1000)
        },
        _stopDesktopLyricInterval() {
            if (this._desktopLyricTimer) {
                clearInterval(this._desktopLyricTimer)
                this._desktopLyricTimer = null
            }
        },
        updateDesktopLyricsState() {
            if (!this.showDesktopLyrics) return
            // 节流：ontimeupdate 每秒触发 4-15 次，叠加其他调用方
            // 50ms 节流足够流畅（>20fps），同时避免高频 IPC 造成主线程/IPC 通道阻塞
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
            if (this._lastDLUpdate && now - this._lastDLUpdate < 50) {
                // 安排一次延迟刷新，确保最后一次状态不被丢失
                if (!this._dlPendingTimer) {
                    this._dlPendingTimer = setTimeout(() => {
                        this._dlPendingTimer = null
                        this._lastDLUpdate = 0
                        this.updateDesktopLyricsState()
                    }, 60)
                }
                return
            }
            this._lastDLUpdate = now
            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (!bridge || !bridge.send) return

            const useLyrics = this.yrcLyrics || this.lyrics

            if (!useLyrics || useLyrics.length === 0) {
                try {
                    bridge.send('update-lyric-state', JSON.parse(JSON.stringify({
                        lyric: '茗韵时光',
                        tlyric: '',
                        prevLyric: '',
                        nextLyric: '',
                        nextTlyric: '',
                        isPlaying: this.isPlaying,
                        songName: this.currentSong.name || '',
                        artist: this.currentSong.artist || '',
                        picUrl: this.currentSong.al?.picUrl || '',
                        font: this.desktopLyricFont,
                        color: this.desktopLyricColor,
                        mode: this.desktopLyricMode,
                        opacity: this.desktopLyricOpacity,
                        words: null,
                        currentMs: this.currentTime * 1000
                    })))
                } catch (e) { /* 静默：IPC 错误不影响播放 */ }
                return
            }

            let idx = -1
            const time = this.currentTime + 0.2
            for (let i = 0; i < useLyrics.length; i++) {
                if (time < useLyrics[i].time) {
                    idx = i - 1
                    break
                }
            }
            if (idx === -1 && time >= useLyrics[useLyrics.length - 1].time) {
                idx = useLyrics.length - 1
            }

            const currentLine = idx >= 0 ? useLyrics[idx] : null
            const nextLine = idx >= 0 ? (useLyrics[idx + 1] || null) : (useLyrics[0] || null)
            const prevLine = idx > 0 ? useLyrics[idx - 1] : null

            const payload = {
                lyric: currentLine ? currentLine.text : '',
                tlyric: currentLine ? currentLine.ttext || '' : '',
                prevLyric: prevLine ? prevLine.text : '',
                nextLyric: nextLine ? nextLine.text : '',
                nextTlyric: nextLine ? nextLine.ttext || '' : '',
                isPlaying: this.isPlaying,
                songName: this.currentSong.name || '',
                artist: this.currentSong.artist || '',
                picUrl: this.currentSong.al?.picUrl || '',
                font: this.desktopLyricFont,
                color: this.desktopLyricColor,
                mode: this.desktopLyricMode,
                opacity: this.desktopLyricOpacity,
                words: currentLine?.words || null,
                currentMs: this.currentTime * 1000
            }
            try {
                bridge.send('update-lyric-state', JSON.parse(JSON.stringify(payload)))
            } catch (e) { /* 静默 */ }
        },
        setFont(font) {
            this.desktopLyricFont = font
            this.updateDesktopLyricsState()
        },
        setColor(color) {
            this.desktopLyricColor = color
            this.updateDesktopLyricsState()
        },
        setDesktopLyricMode(mode) {
            this.desktopLyricMode = mode
            localStorage.setItem('desktop_lyric_mode', mode)
            this.updateDesktopLyricsState()
        },
        setDesktopLyricOpacity(opacity) {
            this.desktopLyricOpacity = Math.max(0, Math.min(100, parseInt(opacity, 10) || 0))
            localStorage.setItem('desktop_lyric_opacity', String(this.desktopLyricOpacity))
            this.updateDesktopLyricsState()
        },
        async fetchAudioDevices() {
            try {
                // 先请求麦克风权限以获取带标签的设备列表
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                    stream.getTracks().forEach(t => t.stop())
                } catch (e) {
                    // 权限被拒绝时继续，但设备标签可能为空
                }
                const devices = await navigator.mediaDevices.enumerateDevices()
                const outputDevices = devices.filter(d => d.kind === 'audiooutput' && d.deviceId)
                if (outputDevices.length > 0) {
                    this.audioDevices = outputDevices
                }
            } catch (e) {
                console.error('Enumerate devices error:', e)
            }
        },
        async setAudioDevice(deviceId) {
            console.log(`--- [Audio] 切换设备请求: ${deviceId}`)
            this.currentDeviceId = deviceId
            localStorage.setItem('audio_device_id', deviceId)
            
            // 检查是否可以立即切换
            if (!this.audio) {
                console.log('--- [Audio] 音频元素不存在，将在下次播放时应用')
                return
            }
            if (!this.audio.setSinkId) {
                console.warn('--- [Audio] 浏览器不支持 setSinkId')
                return
            }
            
            // 如果当前没有播放内容，只保存设置，等下次播放时应用
            if (!this.audio.src) {
                console.log('--- [Audio] 当前无播放内容，设备设置已保存')
                return
            }
            
            // 立即应用设备切换
            try {
                console.log(`--- [Audio] 正在重置音频元素以应用新设备...`)
                await this.resetAudioElement()
                console.log(`--- [Audio] 设备切换完成`)
            } catch (e) {
                console.error('--- [Audio] 设备切换失败:', e)
            }
        },
        createEqFilters() {
            if (!this.ctx) return
            this.eqFilters.forEach(f => { try { f.disconnect() } catch (e) {} })
            this.eqFilters = this.eqBands.map(band => {
                const filter = this.ctx.createBiquadFilter()
                filter.type = 'peaking'
                filter.frequency.value = band.freq
                filter.Q.value = 1.0
                filter.gain.value = band.gain
                return filter
            })
        },
        applyEq() {
            if (!this.eqFilters.length) {
                this.createEqFilters()
            }
            this.eqFilters.forEach((filter, i) => {
                if (this.eqBands[i]) {
                    filter.gain.value = this.eqBands[i].gain
                }
            })
        },
        toggleEq() {
            this.eqEnabled = !this.eqEnabled
            try { localStorage.setItem('eq_enabled', this.eqEnabled) } catch (e) {}
            if (!this.ctx || !this.eqDryGain || !this.eqWetGain) {
                // 音频图尚未初始化，状态已记录，重建时会自动应用
                return
            }

            // 通过并联的干湿声 Gain 节点切换 EQ，避免反复 disconnect/connect 导致链路失效
            const now = this.ctx.currentTime
            const ramp = 0.03
            if (this.eqEnabled) {
                this.eqDryGain.gain.setValueAtTime(this.eqDryGain.gain.value, now)
                this.eqDryGain.gain.linearRampToValueAtTime(0, now + ramp)
                this.eqWetGain.gain.setValueAtTime(this.eqWetGain.gain.value, now)
                this.eqWetGain.gain.linearRampToValueAtTime(1, now + ramp)
            } else {
                this.eqDryGain.gain.setValueAtTime(this.eqDryGain.gain.value, now)
                this.eqDryGain.gain.linearRampToValueAtTime(1, now + ramp)
                this.eqWetGain.gain.setValueAtTime(this.eqWetGain.gain.value, now)
                this.eqWetGain.gain.linearRampToValueAtTime(0, now + ramp)
            }
        },
        setEqPreset(preset) {
            this.eqPreset = preset
            const gains = this.eqPresets[preset]
            if (gains) {
                this.eqBands = this.eqBands.map((band, i) => ({
                    ...band,
                    gain: gains[i] || 0
                }))
            }
            if (this.eqEnabled) {
                this.applyEq()
            }
        },
        updateEqBand(index, gain) {
            if (index >= 0 && index < this.eqBands.length) {
                this.eqBands[index].gain = gain
                this.eqPreset = 'default'
                if (this.eqFilters[index]) {
                    this.eqFilters[index].gain.value = gain
                }
            }
        },

        // ========== QQ 平台扩展 actions ==========

        // QQ 单曲详情补全：用 qqSongInfo 拉取完整信息（picUrl、专辑、时长等）
        // 用于 SongDetail 等需要完整元数据的场景
        async fetchQQSongDetail(songmid) {
            if (!songmid) return null
            try {
                const res = await qqSongInfo(songmid)
                const data = res?.data || res
                const song = data?.songInfo || data?.info || data?.data || data
                if (song) {
                    return normalizeQQSong(song)
                }
                return null
            } catch (e) {
                console.error('[QQ] fetchQQSongDetail error:', e)
                return null
            }
        },

        // QQ 批量歌曲信息补全：用于歌单/专辑/排行榜批量获取真实播放信息
        // songs: [{ songmid }] 或 [songmid]；返回补全后的 song 对象数组
        async fetchQQBatchSongInfo(songs) {
            if (!Array.isArray(songs) || !songs.length) return []
            const mids = songs.map(s => (typeof s === 'string' ? s : (s.songmid || s.id))).filter(Boolean)
            if (!mids.length) return []
            try {
                const res = await qqBatchSongInfo(mids)
                const data = res?.data || res
                const list = data?.songList || data?.list || data?.songs || data?.info || []
                if (Array.isArray(list) && list.length) {
                    return list.map(normalizeQQSong).filter(Boolean)
                }
                return []
            } catch (e) {
                console.error('[QQ] fetchQQBatchSongInfo error:', e)
                return []
            }
        },

        // QQ 下载：通过 qqDownload 拉取高品质 URL，再调用主进程 download-song 落盘
        // 优先尝试 320 高品质，失败回退 128 标准
        // 必须传 cookie，否则 QQ 服务器返回空 URL
        async downloadQQSong(song) {
            if (!song || !(song.songmid || song.id)) {
                useMessageStore().error('无效的 QQ 歌曲，无法下载')
                return { success: false, error: 'invalid song' }
            }
            const songmid = song.songmid || song.id
            // 从 qqUserStore 获取 cookie
            const { useQQUserStore } = await import('./qq-user')
            const qqUserStore = useQQUserStore()
            const cookie = qqUserStore.cookie || ''
            // 本地收藏歌曲已有 url 时直接复用
            let url = song.url
            if (!url) {
                const tryQualities = ['320', '128']
                let lastError = ''
                for (const q of tryQualities) {
                    try {
                        const res = await qqDownload(songmid, q, cookie)
                        const data = res?.data || res
                        // 真实返回结构：{ data: { playUrl: { [songmid]: { url, error } } } }
                        const playUrlEntry = data?.playUrl?.[songmid] || data?.playUrl?.[String(songmid)] || {}
                        const playUrl = playUrlEntry?.url || data?.url || data?.midurlinfo?.[0]?.purl
                        if (playUrl && typeof playUrl === 'string') {
                            url = playUrl.startsWith('http') ? playUrl : `https:${playUrl}`
                            useMessageStore().info(`正在下载 QQ 音乐（${q === '320' ? '高品 320' : '标准 128'}）...`)
                            break
                        }
                        if (playUrlEntry?.error) lastError = playUrlEntry.error
                    } catch (e) {
                        console.error('[QQ] download quality', q, 'error:', e)
                    }
                }
            }
            if (!url) {
                if (!cookie) {
                    useMessageStore().error(`下载失败：[${song.name || songmid}] 请先登录 QQ 音乐账号`)
                } else {
                    useMessageStore().error(`下载失败：[${song.name || songmid}] ${lastError || '由于版权或 VIP 限制，QQ 音乐资源不可用'}`)
                }
                return { success: false, error: 'no url' }
            }
            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (!bridge || !bridge.invoke) {
                useMessageStore().error('下载失败：IPC 桥不可用')
                return { success: false, error: 'no bridge' }
            }
            try {
                const res = await bridge.invoke('download-song', {
                    url,
                    name: song.name || '未知歌曲',
                    artist: song.artist || (song.ar ? song.ar.map(a => a.name).join('/') : ''),
                    picUrl: song.picUrl || song.al?.picUrl || ''
                })
                if (res && res.success) {
                    useMessageStore().success('QQ 音乐下载并保存成功！')
                } else if (res && !res.canceled) {
                    useMessageStore().error(`下载失败：${res.error || '未知错误'}`)
                }
                return res || { success: false }
            } catch (err) {
                console.error('[QQ] download error:', err)
                useMessageStore().error('下载任务开启失败：' + (err.message || '网络或环境异常'))
                return { success: false, error: err.message }
            }
        }
    }
})
