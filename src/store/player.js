import { defineStore } from 'pinia'
import request, { getSongUrl, getLyric, getNewLyric, cloudSearch } from '../api'
import { useMessageStore } from './message'

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
        ctx: null,
        analyser: null,
        source: null,
        dataArray: null,
        isLiked: false,
        showMvPlayer: false,
        currentMvId: null,
        currentMvUrl: '',
        showDesktopLyrics: localStorage.getItem('show_desktop_lyrics') === 'true',
        desktopLyricFont: '',
        desktopLyricColor: '#00E5FF',
        bgMode: localStorage.getItem('player_bg_mode') || 'cover', // 'cover' | 'classic'
        audioDevices: [],
        currentDeviceId: localStorage.getItem('audio_device_id') || '',
        recentSongs: JSON.parse(localStorage.getItem('recent_songs') || '[]'),
        localSongs: JSON.parse(localStorage.getItem('local_songs') || '[]'),
        quality: localStorage.getItem('music_quality') || 'standard',
        playbackRate: parseFloat(localStorage.getItem('playback_rate') || '1'),
        autoFetchLyric: localStorage.getItem('auto_fetch_lyric') !== 'false',
        eqEnabled: false,
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
            }

            this.audio = new Audio()
            this.audio.crossOrigin = "anonymous";
            this.audio.ontimeupdate = () => {
                this.currentTime = this.audio.currentTime
                if (this.showDesktopLyrics) {
                    this.updateDesktopLyricsState()
                }
            }
            this.audio.onended = () => {
                this.next()
            }
            this.audio.onerror = (e) => {
                console.error('Audio error:', e)
                this.isPlaying = false
            }
            this.audio.onloadedmetadata = () => {
                if (!this.currentSong.duration || this.currentSong.duration === 0) {
                    this.currentSong.duration = this.audio.duration
                }
            }
            this.audio.volume = this.volume / 100
        },
        async rebuildAudioGraph() {
            if (this.source) { try { this.source.disconnect() } catch (e) {}; this.source = null }
            this.eqFilters.forEach(f => { try { f.disconnect() } catch (e) {} })
            this.eqFilters = []
            if (this.analyser) { try { this.analyser.disconnect() } catch (e) {}; this.analyser = null }
            if (this.ctx) { try { this.ctx.close() } catch (e) {}; this.ctx = null }

            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext
                this.ctx = new AudioCtx()
                this.analyser = this.ctx.createAnalyser()
                this.analyser.fftSize = 256
                this.analyser.smoothingTimeConstant = 0.8
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)

                this.source = this.ctx.createMediaElementSource(this.audio)

                if (this.eqEnabled) {
                    this.createEqFilters()
                    this.source.connect(this.eqFilters[0])
                    for (let i = 0; i < this.eqFilters.length - 1; i++) {
                        this.eqFilters[i].connect(this.eqFilters[i + 1])
                    }
                    this.eqFilters[this.eqFilters.length - 1].connect(this.analyser)
                } else {
                    this.source.connect(this.analyser)
                }
                this.analyser.connect(this.ctx.destination)
            } catch (e) {
                console.error('rebuildAudioGraph error:', e)
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
            }

            this.audio = new Audio()
            this.audio.crossOrigin = "anonymous";
            this.audio.ontimeupdate = () => {
                this.currentTime = this.audio.currentTime
                if (this.showDesktopLyrics) {
                    this.updateDesktopLyricsState()
                }
            }
            this.audio.onended = () => { this.next() }
            this.audio.onerror = (e) => {
                console.error('Audio error:', e)
                this.isPlaying = false
            }
            this.audio.onloadedmetadata = () => {
                if (!this.currentSong.duration || this.currentSong.duration === 0) {
                    this.currentSong.duration = this.audio.duration
                }
            }
            this.audio.volume = savedVolume / 100

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
        async playSong(song, list = []) {
            this.initAudio()
            if (!song || !song.id) return

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

                if (!url && !isLocal) {
                    const res = await getSongUrl(song.id, this.quality)
                    const songData = res.data?.[0] || res?.[0]
                    url = songData?.url
                }

                if (!url && !isLocal) {
                    useMessageStore().warning(`无法播放 [${song.name}]：由于版权或VIP限制，资源不可用。`)
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
                    duration: (isLocal ? (song.duration || song.dt / 1000 || 0) : ((song.dt || (song.song?.duration || 0)) / 1000)),
                    url: url,
                    path: song.path
                }

                if (!normalized.al.picUrl) {
                    normalized.al.picUrl = song.picUrl || (song.song?.album?.picUrl || 'https://p2.music.126.net/6y-U6QnSjd_5419m1B0R_g==/109951165034938831.jpg?param=300y300')
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

                this.audio.play().then(() => {
                    this.isPlaying = true
                }).catch(error => {
                    console.error('Playback fail:', error)
                    if (isLocal) {
                        useMessageStore().error('本地文件加载失败，请确定文件路径正确且协议已注册。')
                    }
                })

                // 获取歌词逻辑：本地检查 → 有则直接用 → 无则在线搜索
                if (isLocal && song.path && this.autoFetchLyric) {
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
                                hasLocalLyric = true
                            } else {
                                // 普通歌词，直接用
                                this.parseLyrics(content)
                                hasLocalLyric = true
                                useMessageStore().info(`使用本地歌词:《${normalized.name}》`)
                            }
                        }
                    }

                    // 2. 本地有普通歌词但没有YRC → 在线搜索YRC
                    if (hasLocalLyric && !hasLocalYrc) {
                        try {
                            const cleanArtist = String(normalized.artist).replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
                            const searchQuery = cleanArtist ? `${normalized.name} ${cleanArtist}` : normalized.name
                            let sRes = await cloudSearch(searchQuery)
                            let match = sRes.result?.songs?.[0]
                            if (!match) {
                                const strippedName = normalized.name.replace(/\(.*\)|\[.*\]|（.*）|【.*】/g, '').trim()
                                if (strippedName && strippedName !== normalized.name) {
                                    sRes = await cloudSearch(strippedName)
                                    match = sRes.result?.songs?.[0]
                                }
                            }
                            if (match) {
                                const lResOnline = await getNewLyric(match.id)
                                const yrcRaw = lResOnline.yrc?.lyric || ''
                                if (yrcRaw) {
                                    const ytlrcRaw = lResOnline.ytlrc?.lyric || ''
                                    this.parseYrcLyrics(yrcRaw, ytlrcRaw)
                                    // 保存YRC到本地
                                    const lResReload = await bridge.loadLocalLyric(song.path)
                                    let existingLrc = ''
                                    if (lResReload.success) {
                                        const c = lResReload.lyric || ''
                                        existingLrc = c.includes('---yrc---') ? c.split('---yrc---')[0].trim() : c
                                    }
                                    let saveContent = existingLrc || ''
                                    saveContent += `\n---yrc---\n${yrcRaw}`
                                    if (ytlrcRaw) saveContent += `\n---ytlrc---\n${ytlrcRaw}`
                                    bridge.saveLyric({ songPath: song.path, lyricContent: saveContent })
                                    useMessageStore().success(`已自动匹配逐词歌词:《${normalized.name}》`)
                                }
                            }
                        } catch (e) { /* 获取YRC失败不影响播放 */ }
                    }

                    // 3. 本地完全没有歌词 → 在线搜索
                    if (!hasLocalLyric) {
                        try {
                            const cleanArtist = String(normalized.artist).replace(/本地音乐|未知歌手|Unknown Artist/g, '').trim()
                            const searchQuery = cleanArtist ? `${normalized.name} ${cleanArtist}` : normalized.name
                            let sRes = await cloudSearch(searchQuery)
                            let match = sRes.result?.songs?.[0]
                            if (!match) {
                                const strippedName = normalized.name.replace(/\(.*\)|\[.*\]|（.*）|【.*】/g, '').trim()
                                if (strippedName && strippedName !== normalized.name) {
                                    sRes = await cloudSearch(strippedName)
                                    match = sRes.result?.songs?.[0]
                                }
                            }
                            if (match) {
                                const lResOnline = await getNewLyric(match.id)
                                const yrcRaw = lResOnline.yrc?.lyric || ''
                                const ytlrcRaw = lResOnline.ytlrc?.lyric || ''
                                const lrc = lResOnline.lrc?.lyric || ''
                                const tlrc = lResOnline.tlyric?.lyric || ''

                                if (yrcRaw) {
                                    this.parseYrcLyrics(yrcRaw, ytlrcRaw)
                                    if (lrc) this.parseLyrics(lrc, tlrc)
                                } else {
                                    this.yrcLyrics = null
                                    this.parseLyrics(lrc, tlrc)
                                }

                                if (bridge && bridge.saveLyric && (lrc || yrcRaw)) {
                                    let saveContent = tlrc ? `${lrc}\n---trans---\n${tlrc}` : lrc
                                    if (yrcRaw) {
                                        saveContent += `\n---yrc---\n${yrcRaw}`
                                        if (ytlrcRaw) saveContent += `\n---ytlrc---\n${ytlrcRaw}`
                                    }
                                    bridge.saveLyric({ songPath: song.path, lyricContent: saveContent })
                                    useMessageStore().success(`已自动匹配${yrcRaw ? '逐词' : '普通'}歌词:《${normalized.name}》`)
                                }
                            } else {
                                this.lyrics = []
                                useMessageStore().info(`未找到在线歌词:《${normalized.name}》`)
                            }
                        } catch (e) {
                            console.error('Auto lyric search failed:', e)
                            this.lyrics = []
                        }
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
                    
                    // 请求最新歌词（优先使用 /lyric/new 获取逐词歌词）
                    getNewLyric(song.id).then(lRes => {
                        const yrcRaw = lRes.yrc?.lyric || ''
                        const ytlrcRaw = lRes.ytlrc?.lyric || ''
                        const lrc = lRes.lrc?.lyric || ''
                        const tlrc = lRes.tlyric?.lyric || ''
                        
                        if (yrcRaw) {
                            // 有逐词歌词，解析 yrc
                            this.parseYrcLyrics(yrcRaw, ytlrcRaw)
                            // 同时也解析普通歌词作为 fallback
                            if (lrc) this.parseLyrics(lrc, tlrc)
                        } else if (lrc) {
                            this.yrcLyrics = null
                            this.parseLyrics(lrc, tlrc)
                        }
                        
                        // 保存到 localStorage 缓存
                        if (lrc || yrcRaw) {
                            try {
                                const lyricData = { lrc, tlrc, yrc: yrcRaw, ytlrc: ytlrcRaw, savedAt: Date.now(), songName: normalized.name }
                                localStorage.setItem(cacheKey, JSON.stringify(lyricData))
                            } catch (e) { /* ignore */ }
                            
                            // 保存到 Electron 本地文件（支持离线使用）
                            if (bridge && bridge.saveOnlineLyric) {
                                // 保存时也带上 yrc 数据
                                let saveLrc = lrc
                                let saveTlrc = tlrc
                                if (yrcRaw) {
                                    saveLrc = (tlrc ? `${lrc}\n---trans---\n${tlrc}` : lrc) + `\n---yrc---\n${yrcRaw}`
                                    if (ytlrcRaw) saveLrc += `\n---ytlrc---\n${ytlrcRaw}`
                                    saveTlrc = '' // 已经合并到 saveLrc 中
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
                    }).catch(err => {
                        console.error('Lyrics error:', err)
                        if (!this.lyrics.length) this.lyrics = []
                    })
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
            const { useUserStore } = await import('./user')
            const user = useUserStore()
            if (user.isLoggedIn) {
                this.isLiked = user.isSongLiked(id)
            }
        },
        async toggleLike() {
            if (!this.currentSong.id) return
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
            this.volume = vol
            if (this.audio) this.audio.volume = vol / 100
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
                        if (textContent) {
                            // 优化：处理单行内合并的双语歌词 (例如 "Original / Translation")
                            let tContent = ''
                            // 如果一行中包含 " / " 且此时并没有单独的翻译轨道，尝试拆分
                            if (textContent.includes(' / ') && !tlrc) {
                                const parts = textContent.split(' / ')
                                textContent = parts[0].trim()
                                tContent = parts[1].trim()
                            } else if (textContent.includes('/') && !tlrc && !textContent.startsWith('/')) {
                                // 兼容没有空格的 /
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
                const wordPattern = /\((\d+),(\d+),(\d+)\)([^(]*)/g
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
        async playMv(id) {
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
                    this.showMvPlayer = true
                } else {
                    useMessageStore().warning('未获取到视频地址，由于版权或区域限制，该内容暂无法播放。')
                }
            } catch (err) {
                console.error('Play MV error:', err)
                useMessageStore().error('播放视频失败')
            }
        },
        async playLocalMv() {
            if (!this.currentSong.name) return

            // 暂停音乐
            if (this.isPlaying) {
                this.audio.pause()
                this.isPlaying = false
            }

            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler

            // 尝试查找本地 MV 文件
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
                        this.showMvPlayer = true
                        return
                    }
                } catch (e) {
                    console.error('findLocalMv error:', e)
                }
            }

            // 回退：在线歌曲尝试 API 获取 MV
            const isLocal = String(this.currentSong.id).startsWith('local-') || !!this.currentSong.path
            if (!isLocal && this.currentSong.id) {
                // 尝试用歌曲 ID 获取 MV
                try {
                    const { getMvUrl: fetchMvUrl } = await import('../api')
                    const res = await fetchMvUrl(this.currentSong.id)
                    let url = res.data?.url
                    if (!url && res.data?.urls) {
                        const keys = Object.keys(res.data.urls)
                        if (keys.length > 0) url = res.data.urls[keys[0]]
                    }
                    if (url) {
                        this.currentMvUrl = url
                        this.currentMvId = this.currentSong.id
                        this.showMvPlayer = true
                        return
                    }
                } catch (e) {
                    console.error('Online MV fallback error:', e)
                }
            }

            useMessageStore().info('未找到匹配的MV视频文件。提示：将视频文件放在歌曲同目录下，或在歌曲目录下创建 mv 文件夹，视频文件名需与歌曲名一致')
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
        setQuality(q) {
            this.quality = q
            localStorage.setItem('music_quality', q)
            if (this.currentSong && this.currentSong.id && !String(this.currentSong.id).startsWith('local-') && this.isPlaying) {
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
        toggleDesktopLyrics() {
            this.showDesktopLyrics = !this.showDesktopLyrics
            localStorage.setItem('show_desktop_lyrics', this.showDesktopLyrics)
            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (bridge && bridge.send) {
                bridge.send('toggle-desktop-lyrics', this.showDesktopLyrics)
            }
            if (this.showDesktopLyrics) {
                this.updateDesktopLyricsState()
            }
        },
        updateDesktopLyricsState() {
            if (!this.showDesktopLyrics) return
            const bridge = window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler
            if (!bridge || !bridge.send) return

            const isYrcSong = !!(this.yrcLyrics && this.yrcLyrics.length > 0)
            if (isYrcSong) {
                bridge.send('update-lyric-state', {
                    lyric: '当前为逐词歌曲',
                    tlyric: '桌面歌词暂不支持逐词展示',
                    prevLyric: '', nextLyric: '', nextTlyric: '',
                    isPlaying: this.isPlaying,
                    songName: this.currentSong.name || '',
                    artist: this.currentSong.artist || '',
                    picUrl: this.currentSong.al?.picUrl || '',
                    font: this.desktopLyricFont,
                    color: this.desktopLyricColor,
                    words: null,
                    currentMs: this.currentTime * 1000
                })
                return
            }
            const useLyrics = this.lyrics
            if (!useLyrics || useLyrics.length === 0) {
                bridge.send('update-lyric-state', {
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
                    words: null,
                    currentMs: this.currentTime * 1000
                })
                return
            }

            // 完美对齐 SongDetail 相同的歌词定位算法
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

            // 如果处于前奏间奏（idx 为 -1），当前歌词显示为空（或前奏提示），下一句展示第一句歌词
            const currentLine = idx >= 0 ? useLyrics[idx] : null
            const nextLine = idx >= 0 ? (useLyrics[idx + 1] || null) : (useLyrics[0] || null)
            const prevLine = idx > 0 ? useLyrics[idx - 1] : null

            bridge.send('update-lyric-state', {
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
                // 逐词精准字段与毫秒基准
                words: currentLine?.words || null,
                currentMs: this.currentTime * 1000
            })
        },
        setFont(font) {
            this.desktopLyricFont = font
            this.updateDesktopLyricsState()
        },
        setColor(color) {
            this.desktopLyricColor = color
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
            if (!this.eqEnabled) return
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
            if (!this.audio || !this.audio.src || !this.source || !this.ctx || !this.analyser) return

            // 断开 source → 下游
            try { this.source.disconnect() } catch (e) {}
            // 拆掉旧 EQ 链
            this.eqFilters.forEach(f => { try { f.disconnect() } catch (e) {} })
            this.eqFilters = []

            if (this.eqEnabled) {
                this.createEqFilters()
                this.source.connect(this.eqFilters[0])
                for (let i = 0; i < this.eqFilters.length - 1; i++) {
                    this.eqFilters[i].connect(this.eqFilters[i + 1])
                }
                this.eqFilters[this.eqFilters.length - 1].connect(this.analyser)
            } else {
                this.source.connect(this.analyser)
            }
            // analyser → destination 不动
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
                if (this.eqEnabled) {
                    if (this.eqFilters[index]) {
                        this.eqFilters[index].gain.value = gain
                    }
                }
            }
        }
    }
})
