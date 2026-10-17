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

// Retire the removed account-lock service without sending music credentials.
localStorage.removeItem('music_cloud_token')

export const useUserStore = defineStore('user', {
    state: () => ({ sessionCheckedAt: 0,
        isLoggedIn: false,
        revision: 0,
        profile: JSON.parse(localStorage.getItem('user_profile') || 'null'),
        cookie: localStorage.getItem('music_cookie') || '',
        playlists: [], playlistsLoading: false, playlistsError: '', playlistsRequest: 0,
        likedPlaylistId: null,
        likedSongIds: new Set(),
        vipInfo: null,
        vipLoading: false,
        vipError: '',
        vipRequest: 0,
        vipCheckedAt: 0,
        playlistChanged: false
    }),
    actions: {
        async loginWithCookie(cookieString, stillActive = () => true) {
            if (!cookieString) return false
            const revision = this.revision

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

            const candidate = cleanCookie.trim()
            const status = await request.get('/login/status', { params: { cookie: candidate, timestamp: Date.now() } })
            if (revision !== this.revision || !stillActive()) return { success: false, message: '登录已取消' }
            if (status?.code !== 200 || !status.account?.id || !status.profile?.userId || String(status.account.id) !== String(status.profile.userId)) return { success: false, message: status?.message || '网易云未确认有效登录' }
            this.revision++
            this.sessionCheckedAt = Date.now(); this.cookie = candidate; this.profile = status.profile; this.isLoggedIn = true
            this.playlists = []; this.likedSongIds = new Set(); this.likedPlaylistId = null
            this.vipInfo = null
            this.vipRequest++; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = 0
            localStorage.setItem('music_cookie', candidate); localStorage.setItem('user_profile', JSON.stringify(this.profile))
            const acceptedRevision = this.revision
            await this.fetchStatus()
            if (acceptedRevision !== this.revision || !stillActive() || !this.isLoggedIn) return { success: false, message: '登录已取消或失效' }
            return { success: true, profile: this.profile }
        },
        async loginWithPhone(data) {
            const revision = this.revision
            try {
                const res = await loginCellphone(data)
                if (revision !== this.revision) return { success:false, message:'登录已取消' }
                if (res.code === 200) {
                    return await this.loginWithCookie(res.cookie)
                }
                return { success: false, message: res.msg || res.message || '登录失败' }
            } catch (err) {
                console.error('[DEBUG] loginWithPhone error:', err)
                const apiRes = err.response?.data || {}
                return { success: false, message: apiRes.msg || apiRes.message || '手机号或密码错误' }
            }
        },
        async loginWithEmail(data) {
            const revision = this.revision
            try {
                const res = await loginEmail(data)
                if (revision !== this.revision) return { success:false, message:'登录已取消' }
                if (res.code === 200) {
                    return await this.loginWithCookie(res.cookie)
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
        async checkQrCodeStatus(key, stillActive = () => true) {
            const revision = this.revision
            try {
                const res = await checkQrStatus(key)
                if (!stillActive() || revision !== this.revision) return { code: 800, message: '登录已取消' }
                if (res.code === 803) {
                    if (!res.cookie) return { code: -1, message: '网易云未返回完整登录凭据' }
                    const accepted = await this.loginWithCookie(res.cookie, stillActive)
                    if (!accepted?.success) return { code: -1, message: accepted?.message || '登录验证失败' }
                }
                return res
            } catch (err) {
                return { code: 500 }
            }
        },
        async fetchStatus() {
            if (!this.cookie) return false
            const revision = this.revision
            try {
                const t = Date.now()
                const res = await request.get('/login/status', { params: { timestamp: t } })
                const profile = res.profile || (res.data && res.data.profile)
                if (revision !== this.revision) return false

                const account = res.account || res.data?.account
                if (profile?.userId && account?.id && String(profile.userId) === String(account.id)) {
                    this.sessionCheckedAt = Date.now(); this.profile = profile
                    this.isLoggedIn = true
                    localStorage.setItem('user_profile', JSON.stringify(profile))
                    await Promise.allSettled([this.fetchUserDetail(profile.userId), this.fetchUserPlaylists(profile.userId)])
                    if (revision !== this.revision) return false
                    this.fetchVipInfo()
                    return true
                }

                const accountRes = await request.get('/user/account', { params: { timestamp: t } })
                if (revision !== this.revision) return false
                if (accountRes.profile?.userId && accountRes.account?.id && String(accountRes.profile.userId) === String(accountRes.account.id)) {
                    this.sessionCheckedAt = Date.now(); this.profile = accountRes.profile
                    this.isLoggedIn = true
                    await Promise.allSettled([this.fetchUserDetail(accountRes.profile.userId), this.fetchUserPlaylists(accountRes.profile.userId)])
                    if (revision !== this.revision) return false
                    this.fetchVipInfo()
                    return true
                }
                this.isLoggedIn = false
                return false
            } catch (err) {
                console.error('Fetch status error:', err)
                return false
            }
        },
        async fetchUserDetail(uid) {
            if (!uid || !this.isLoggedIn || String(uid) !== String(this.profile?.userId)) return
            const revision = this.revision
            try {
                const res = await request.get('/user/detail', { params: { uid, timestamp: Date.now() } })
                if (revision !== this.revision) return
                if (res.profile && String(res.profile.userId) === String(uid)) {
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
            if (!uid || !this.isLoggedIn || String(uid) !== String(this.profile?.userId)) return false
            const revision = this.revision, requestId = ++this.playlistsRequest
            const active = () => revision === this.revision && requestId === this.playlistsRequest
            this.playlistsLoading = true; this.playlistsError = ''
            try {
                const all = [], seen = new Set()
                let offset = 0
                for (let page = 0; page < 100; page++) {
                    const res = await request.get('/user/playlist', { params: { uid, limit: 100, offset, timestamp: Date.now() } })
                    if (!active()) return false
                    const body = res?.data?.playlist ? res.data : res?.body?.playlist ? res.body : res
                    const list = Array.isArray(body) ? body : body?.playlist
                    if ((body?.code != null && body.code !== 200) || !Array.isArray(list)) throw new Error(body?.message || '歌单响应不完整，请重试')
                    let added = 0
                    for (const item of list) if (item.id != null && !seen.has(String(item.id))) { seen.add(String(item.id)); all.push(item); added++ }
                    offset += list.length
                    if (!body?.more) break
                    if (!added || page === 99) throw new Error('歌单分页未完成，请重试')
                }
                this.playlists = all
                this.likedPlaylistId = all.find(item => Number(item.specialType) === 5)?.id || all[0]?.id || null
                if (this.likedPlaylistId) this.fetchLikeList(uid)
                return true
            } catch (error) {
                if (active()) this.playlistsError = error.message || '歌单同步失败，请重试'
                return false
            } finally { if (active()) this.playlistsLoading = false }
        },
        async fetchLikeList(uid) {
            const revision = this.revision
            try {
                const res = await request.get('/likelist', { params: { uid, timestamp: Date.now() } })
                if (revision !== this.revision) return
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
            if (!this.isLoggedIn) return false
            const revision = this.revision
            const requestId = ++this.vipRequest
            const active = () => revision === this.revision && requestId === this.vipRequest && this.isLoggedIn
            this.vipLoading = true; this.vipError = ''
            try {
                const res = await request.get('/vip/info', { params: { timestamp: Date.now() } })
                if (!active()) return false
                if (res?.code !== 200 || !res.data || !['associator','musicPackage','redplus'].some(key => res.data[key] && typeof res.data[key] === 'object')) throw new Error(res?.message || '网易云会员响应不完整，请重试')
                this.vipInfo = res.data
                this.vipCheckedAt = Date.now()
                return true
            } catch (e) { if (active()) this.vipError = e.message || '会员查询失败，请重试'; return false }
            finally { if (active()) this.vipLoading = false }
        },

        logout() {
            this.revision++
            this.playlistsRequest++; this.playlistsLoading = false; this.playlistsError = ''
            this.isLoggedIn = false
            this.profile = null
            this.cookie = ''
            this.playlists = []
            this.likedPlaylistId = null
            this.likedSongIds = new Set()
            this.vipInfo = null
            this.vipRequest++; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = 0
            localStorage.removeItem('music_cookie')
            localStorage.removeItem('user_profile')
            localStorage.removeItem('music_cloud_token')
        },
        async createPlaylist(name) {
            if (!this.isLoggedIn) return false
            const revision = this.revision
            try {
                console.log('--- [Playlist] Creating playlist:', name)
                const res = await playlistCreate(name)
                if (revision !== this.revision || !this.isLoggedIn) return false
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
            const revision = this.revision
            try {
                const res = await playlistSubscribe(id, sub ? 1 : 2)
                if (revision !== this.revision || !this.isLoggedIn) return false
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
            const revision = this.revision
            try {
                const cleanId = String(trackId).replace('local-', '')
                // 网易云 API 特例：添加到歌单有时需要 timestamp 避免缓存
                // 强制使用 POST 分离参数，某些网关对 GET /playlist/tracks 有体积限制
                const res = await request.post('/playlist/tracks', null, {
                    params: { op: 'add', pid, tracks: cleanId, timestamp: Date.now() }
                }) || {}

                // 兼容不同 API 网关返回的 code 字段位置
                if (revision !== this.revision || !this.isLoggedIn) return { success: false, message: '账号已切换' }
                const code = res.code || (res.body && res.body.code) || res.status

                if (code === 200 || code === '200' || res.status === 200) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return { success: true }
                }

                // 具体的失败提示
                const errorMsg = res.msg || res.message || (res.body && res.body.message)
                // 502/400 通常是网际转发或已经存在的报错
                if (errorMsg && /already exists|已存在|已经存在/i.test(errorMsg)) {
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

                if (revision === this.revision && this.isLoggedIn && msg && /already exists|已存在|已经存在/i.test(msg)) {
                    await this.fetchUserPlaylists(this.profile.userId)
                    this.playlistChanged = !this.playlistChanged
                    return { success: true, message: '歌曲已在歌单中' }
                }
                return { success: false, message: msg || '添加失败 (网络繁忙)' }
            }
        },
        async deletePlaylist(pid) {
            if (!this.isLoggedIn) return false
            const revision = this.revision
            try {
                const res = await playlistDelete(pid)
                if (revision !== this.revision || !this.isLoggedIn) return false
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
            if (!this.isLoggedIn) return false
            const revision = this.revision
            try {
                const res = await playlistUpdate({ id: pid, name, desc })
                if (revision !== this.revision || !this.isLoggedIn) return false
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
            if (!this.isLoggedIn) return false
            const revision = this.revision
            try {
                const res = await playlistCoverUpdate(pid, file)
                if (revision !== this.revision || !this.isLoggedIn) return false
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
