import { defineStore } from 'pinia'
import request, {
    getUserPlaylist,
    playlistCreate,
    playlistSubscribe,
    loginCellphone,
    loginEmail,
    getQrKey,
    createQrCode,
    checkQrStatus,
    sentCaptcha,
    verifyCaptcha,
    playlistDelete,
    playlistUpdate,
    playlistCoverUpdate
} from '../api'

export const useUserStore = defineStore('user', {
    state: () => ({
        isLoggedIn: !!localStorage.getItem('music_cookie') && !!localStorage.getItem('user_profile'),
        profile: JSON.parse(localStorage.getItem('user_profile') || 'null'),
        cookie: localStorage.getItem('music_cookie') || '',
        playlists: [],
        likedPlaylistId: null,
        likedSongIds: new Set(),
        vipInfo: null,
        playlistChanged: false
    }),
    actions: {
        async loginWithCookie(cookieString) {
            if (!cookieString) return false

            const ncmKeys = ['MUSIC_U', '__csrf', 'NID_GUID', 'MUSIC_A', 'MUSIC_R', 'MUSIC_S']
            let cleanCookie = ''

            cookieString.split(';').forEach(item => {
                const parts = item.trim().split('=')
                if (parts[0] && ncmKeys.some(key => parts[0].includes(key))) {
                    cleanCookie += item.trim() + '; '
                }
            })

            if (!cleanCookie.includes('MUSIC_U')) {
                const match = cookieString.match(/MUSIC_U=[^;]+/)
                if (match) cleanCookie = match[0] + ';'
                else cleanCookie = cookieString.trim()
            }

            this.cookie = cleanCookie.trim()
            localStorage.setItem('music_cookie', this.cookie)

            const success = await this.fetchStatus()
            if (!success) {
                localStorage.removeItem('music_cookie')
                this.cookie = ''
                return { success: false }
            }
            return { success: true, profile: this.profile }
        },
        async loginWithPhone(data) {
            try {
                localStorage.removeItem('music_cookie')
                const res = await loginCellphone(data)
                if (res.code === 200) {
                    this.cookie = res.cookie
                    localStorage.setItem('music_cookie', res.cookie)
                    await this.fetchStatus()
                    return { success: true, profile: this.profile }
                }
                return { success: false, message: res.msg || res.message || '登录失败' }
            } catch (err) {
                console.error('[DEBUG] loginWithPhone error:', err)
                const apiRes = err.response?.data || {}
                return { success: false, message: apiRes.msg || apiRes.message || '手机号或密码错误' }
            }
        },
        async loginWithEmail(data) {
            try {
                const res = await loginEmail(data)
                if (res.code === 200) {
                    this.cookie = res.cookie
                    localStorage.setItem('music_cookie', res.cookie)
                    await this.fetchStatus()
                    return { success: true, profile: this.profile }
                }
                return { success: false, message: res.msg || res.message || '登录失败' }
            } catch (err) {
                console.error('[DEBUG] loginWithEmail error:', err)
                return { success: false, message: err.response?.data?.msg || '网络错误' }
            }
        },
        async sendCaptcha(phone) {
            try {
                const res = await sentCaptcha(phone)
                console.log('[DEBUG] sendCaptcha response:', res)

                // 统一提取状态码
                const code = res.code || (res.data && res.data.code)

                // 1. 明确的成功标识
                const isExplicitSuccess = code === 200 || res.success === true || res.data === true || res === true || res.msg === 'ok'
                if (isExplicitSuccess) return { success: true }

                // 2. 文字匹配成功
                const msg = res.msg || res.message
                if (msg && (msg.includes('验证码已') || msg.includes('成功') || msg.includes('发送'))) {
                    return { success: true }
                }

                // 3. 特殊逻辑：如果 HTTP 200 了但没 code，或者 code 是 400 但内容是已经发送
                if (code === undefined && res !== null) return { success: true }

                return { success: false, message: msg || '发送失败' }
            } catch (err) {
                console.error('[DEBUG] sendCaptcha error stage:', err)
                const apiRes = err.response?.data || (typeof err === 'object' ? err : {})

                // 处理 400 提示“频繁”或“已经发送”的情况
                const isAlreadySent = apiRes.code === 400 && (apiRes.msg?.includes('已经') || apiRes.msg?.includes('频繁') || apiRes.message?.includes('频繁'))
                if (isAlreadySent) {
                    return { success: true, message: '请查看手机验证码' }
                }

                return { success: false, message: apiRes.msg || apiRes.message || '验证码发送频率过高，请查收手机' }
            }
        },
        async getQrCodeData() {
            try {
                const { data: { unikey } } = await getQrKey()
                const { data: { qrimg } } = await createQrCode(unikey)
                return { unikey, qrimg }
            } catch (err) {
                return null
            }
        },
        async checkQrCodeStatus(key) {
            try {
                const res = await checkQrStatus(key)
                if (res.code === 803) {
                    this.cookie = res.cookie
                    localStorage.setItem('music_cookie', res.cookie)
                    await this.fetchStatus()
                }
                return res
            } catch (err) {
                return { code: 500 }
            }
        },
        async fetchStatus() {
            if (!this.cookie) return false
            try {
                const t = Date.now()
                const res = await request.get('/login/status', { params: { timestamp: t } })
                const profile = res.profile || (res.data && res.data.profile)

                if (profile) {
                    this.profile = profile
                    this.isLoggedIn = true
                    localStorage.setItem('user_profile', JSON.stringify(profile))
                    await this.fetchUserDetail(profile.userId)
                    await this.fetchUserPlaylists(profile.userId)
                    this.fetchVipInfo()
                    return true
                }

                const accountRes = await request.get('/user/account', { params: { timestamp: t } })
                if (accountRes.profile) {
                    this.profile = accountRes.profile
                    this.isLoggedIn = true
                    await this.fetchUserDetail(accountRes.profile.userId)
                    await this.fetchUserPlaylists(accountRes.profile.userId)
                    this.fetchVipInfo()
                    return true
                }
                return false
            } catch (err) {
                console.error('Fetch status error:', err)
                return false
            }
        },
        async fetchUserDetail(uid) {
            if (!uid) return
            try {
                const res = await request.get('/user/detail', { params: { uid, timestamp: Date.now() } })
                if (res.profile) {
                    // 合并详情到 profile 中，确保动态、关注、粉丝、等级等信息存在
                    this.profile = { ...this.profile, ...res.profile, level: res.level, listenSongs: res.listenSongs }
                    this.isLoggedIn = true
                    localStorage.setItem('user_profile', JSON.stringify(this.profile))
                }
            } catch (err) {
                console.error('Fetch user detail error:', err)
            }
        },
        async fetchUserPlaylists(uid) {
            if (!uid) return
            try {
                // 加上时间戳避免浏览器/网关缓存
                const res = await request.get('/user/playlist', { params: { uid, timestamp: Date.now() } })
                console.log('[Playlist] fetchUserPlaylists raw res keys:', Object.keys(res || {}))
                // 兼容多种 API 返回格式：playlist 可能在顶层、data 内、body 内，或 res 本身就是数组
                let list = null
                if (Array.isArray(res)) {
                    list = res
                } else {
                    list = res.playlist || (res.data && res.data.playlist) || (res.body && res.body.playlist) || null
                }
                console.log('[Playlist] fetchUserPlaylists list found:', Array.isArray(list), list ? list.length : 0)
                if (Array.isArray(list)) {
                    this.$patch({ playlists: [...list] })
                    if (list.length > 0) {
                        this.likedPlaylistId = list[0].id
                        this.fetchLikeList(uid)
                    }
                } else {
                    console.warn('[Playlist] fetchUserPlaylists: playlist not found in response, res:', res)
                }
            } catch (err) {
                console.error('Fetch user playlists error:', err)
            }
        },
        async fetchLikeList(uid) {
            try {
                const res = await request.get('/likelist', { params: { uid, timestamp: Date.now() } })
                if (res.ids) {
                    this.likedSongIds = new Set(res.ids)
                }
            } catch (e) {
                console.error('Fetch like list failed:', e)
            }
        },
        isSongLiked(id) {
            if (!id) return false
            return this.likedSongIds.has(Number(id))
        },
        toggleLike(id, like) {
            const numId = Number(id)
            if (like) {
                this.likedSongIds.add(numId)
            } else {
                this.likedSongIds.delete(numId)
            }
        },
        async fetchVipInfo() {
            try {
                const res = await request.get('/vip/info', { params: { timestamp: Date.now() } })
                if (res && res.code === 200) {
                    this.vipInfo = res.data || res
                }
            } catch (e) {}
        },
        logout() {
            this.isLoggedIn = false
            this.profile = null
            this.cookie = ''
            this.playlists = []
            this.likedPlaylistId = null
            this.likedSongIds = new Set()
            this.vipInfo = null
            localStorage.removeItem('music_cookie')
            localStorage.removeItem('user_profile')
        },
        async createPlaylist(name) {
            if (!this.isLoggedIn) return false
            try {
                console.log('--- [Playlist] Creating playlist:', name)
                const res = await playlistCreate(name)
                console.log('--- [Playlist] Create response:', res)
                const code = res.code || (res.body && res.body.code)
                if (code === 200 || code === '200') {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return true
                }
                console.error('--- [Playlist] Create failed, code:', code, 'msg:', res.msg || res.message)
                return false
            } catch (err) {
                console.error('Create playlist error:', err)
                return false
            }
        },
        async handleSubscribe(id, sub = true) {
            if (!this.isLoggedIn) return false
            try {
                const res = await playlistSubscribe(id, sub ? 1 : 2)
                if (res.code === 200) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return true
                }
                return false
            } catch (err) {
                console.error('Subscribe playlist error:', err)
                return false
            }
        },
        async addTrackToPlaylist(pid, trackId) {
            if (!this.isLoggedIn) return { success: false, message: '请先登录' }
            try {
                const cleanId = String(trackId).replace('local-', '')
                // 网易云 API 特例：添加到歌单有时需要 timestamp 避免缓存
                // 强制使用 POST 分离参数，某些网关对 GET /playlist/tracks 有体积限制
                const res = await request.post('/playlist/tracks', null, {
                    params: { op: 'add', pid, tracks: cleanId, timestamp: Date.now() }
                }) || {}

                // 兼容不同 API 网关返回的 code 字段位置
                const code = res.code || (res.body && res.body.code) || res.status

                if (code === 200 || code === '200' || res.status === 200) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return { success: true }
                }

                // 具体的失败提示
                const errorMsg = res.msg || res.message || (res.body && res.body.message)
                // 502/400 通常是网际转发或已经存在的报错
                if (code === 502 || code === 400 || (errorMsg && (errorMsg.includes('already') || errorMsg.includes('存在')))) {
                    // 对于用户来说，已经存在即是成功的（已经进歌单了）
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return { success: true, message: '歌曲已在歌单中' }
                }

                return { success: false, message: errorMsg || '添加失败' }
            } catch (err) {
                console.error('[DEBUG] Add track to playlist error:', err)
                const apiRes = err.response?.data || {}
                const code = apiRes.code || apiRes.status
                const msg = apiRes.msg || apiRes.message

                if (code === 502 || code === 400 || (msg && (msg.includes('already') || msg.includes('存在')))) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return { success: true, message: '歌曲已在歌单中' }
                }
                return { success: false, message: msg || '添加失败 (网络繁忙)' }
            }
        },
        async deletePlaylist(pid) {
            try {
                const res = await playlistDelete(pid)
                const code = res.code || (res.body && res.body.code)
                if (code === 200 || code === '200') {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return true
                }
                return false
            } catch (e) {
                console.error('Delete playlist fail:', e)
                return false
            }
        },
        async updatePlaylistInfo(pid, name, desc) {
            try {
                const res = await playlistUpdate({ id: pid, name, desc })
                if (res.code === 200) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    return true
                }
                return false
            } catch (e) {
                console.error('Update playlist info fail:', e)
                return false
            }
        },
        async updatePlaylistCover(pid, file) {
            try {
                const res = await playlistCoverUpdate(pid, file)
                if (res.code === 200) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    return true
                }
                return false
            } catch (e) {
                console.error('Update playlist cover fail:', e)
                return false
            }
        }
    }
})
