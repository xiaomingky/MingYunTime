import { defineStore } from 'pinia'
import {
    qqWebLogin,
    qqUserPlaylists,
    qqUserDetail,
    getQQCookie,
    setQQCookie,
    clearQQCookie,
    getQQProfile,
    setQQProfile,
    clearQQProfile
} from '../api/qq'

// QQ 音乐用户登录态 Store
// 与网易云 user.js 完全隔离:登录态存在 qq_cookie/qq_profile localStorage 键中
//
// 登录方式:
//   1. 官网扫码登录:打开 y.qq.com 登录页,扫码后采集完整 cookie
//   2. Cookie 登录:用户直接粘贴 cookie(需包含 qm_keyst)
//
// 用户信息策略(简化):
//   - 昵称统一显示"已登录"(不调用官方 API)
//   - 头像不显示(留空,前端显示默认占位符)
export const useQQUserStore = defineStore('qq-user', {
    state: () => ({
        isLoggedIn: !!getQQCookie() && !!getQQProfile(),
        profile: getQQProfile(),
        cookie: getQQCookie(),
        playlists: [],
        // "我喜欢"歌单的 dissid(用于红心收藏操作,替代 501 的 oper-mylike)
        likedPlaylistId: '',
        uin: getQQProfile()?.userId || '',
        // 登录中状态(用于 UI 显示加载态)
        logining: false,
        loginMessage: ''
    }),
    actions: {
        // 触发官网扫码登录
        // 调用后会打开 y.qq.com 登录窗口,用户扫码后自动采集 cookie
        // 登录成功后立即拉取用户歌单
        // 返回 { success, message?, profile? }
        async webLogin() {
            if (this.logining) return { success: false, message: '正在登录中,请勿重复操作' }
            this.logining = true
            this.loginMessage = '正在打开 QQ 音乐官网登录页...'
            try {
                const res = await qqWebLogin()
                if (!res?.success) {
                    this.loginMessage = res?.message || '登录失败'
                    return { success: false, message: this.loginMessage }
                }
                const { cookie, uin, nickname, avatarUrl } = res
                if (!cookie) {
                    this.loginMessage = '登录失败:未能采集到 cookie'
                    return { success: false, message: this.loginMessage }
                }
                this.cookie = cookie
                this.uin = uin || ''
                this.isLoggedIn = true
                this.profile = { userId: uin || '', uin: uin || '', nickname: nickname || '已登录', avatarUrl: avatarUrl || '' }
                setQQCookie(cookie)
                setQQProfile(this.profile)
                this.loginMessage = '登录成功'

                // 异步拉取用户歌单
                if (uin) {
                    this.fetchUserPlaylists()
                    // 兜底:如果官网登录未拿到真实昵称/头像,调上游 API 补全
                    if (!avatarUrl || nickname === '已登录' || !nickname) {
                        this.fetchRealProfile()
                    }
                }
                return { success: true, profile: this.profile }
            } catch (e) {
                console.error('[QQ Login] webLogin error:', e)
                this.loginMessage = e?.message || '登录异常'
                return { success: false, message: this.loginMessage }
            } finally {
                this.logining = false
            }
        },
        // Cookie 登录:用户直接粘贴 cookie(需包含 qm_keyst)
        // 从 cookie 中提取 uin,验证 cookie 有效性(可选)
        // 返回 { success, message?, profile? }
        async cookieLogin(rawCookie) {
            if (!rawCookie || typeof rawCookie !== 'string') {
                return { success: false, message: 'Cookie 不能为空' }
            }
            const cookie = rawCookie.trim()
            // 必须包含 qm_keyst(QQ 音乐核心鉴权 token)
            if (!/qm_keyst\s*=/.test(cookie)) {
                return { success: false, message: 'Cookie 缺少 qm_keyst 字段,请确保复制完整 cookie' }
            }
            // 从 cookie 中提取 uin
            let uin = ''
            // 明文 uin
            const uinMatch = cookie.match(/(?:^|;\s*)uin\s*=\s*[oO]?(\d+)/)
            if (uinMatch) {
                uin = uinMatch[1].replace(/^0+/, '')
            }
            // wxuin(微信登录)
            if (!uin) {
                const wxuinMatch = cookie.match(/(?:^|;\s*)wxuin\s*=\s*[oO]?(\d+)/)
                if (wxuinMatch) {
                    uin = wxuinMatch[1].replace(/^0+/, '')
                }
            }
            this.cookie = cookie
            this.uin = uin
            this.isLoggedIn = true
            // 先用默认值,登录后立即异步拉取真实昵称/头像
            this.profile = { userId: uin || '', uin: uin || '', nickname: '已登录', avatarUrl: '' }
            setQQCookie(cookie)
            setQQProfile(this.profile)
            this.loginMessage = 'Cookie 登录成功'

            // 异步拉取真实用户信息(昵称/头像)和歌单
            if (uin) {
                this.fetchRealProfile()
                this.fetchUserPlaylists()
            }
            return { success: true, profile: this.profile }
        },
        // 调用上游 API 获取真实昵称和头像
        // 适用于 Cookie 登录后补全用户信息
        async fetchRealProfile() {
            if (!this.uin || !this.cookie) return
            try {
                const res = await qqUserDetail(this.uin, this.cookie)
                // IPC 返回: { code:0, data: { nickname, avatarUrl, isVip, vipLevel, vipIcon, uin } }
                const data = res?.data || {}
                const nickname = data?.nickname || ''
                const avatarUrl = data?.avatarUrl || ''
                const isVip = !!data?.isVip
                const vipLevel = data?.vipLevel || 0
                const vipIcon = data?.vipIcon || ''
                // 任一字段有值就更新(避免 fetchRealProfile 返回空对象覆盖已有数据)
                if (nickname || avatarUrl || isVip) {
                    this.profile = {
                        ...this.profile,
                        nickname: nickname || this.profile.nickname,
                        avatarUrl: avatarUrl || this.profile.avatarUrl,
                        isVip,
                        vipLevel,
                        vipIcon
                    }
                    setQQProfile(this.profile)
                    console.log('[QQ] fetchRealProfile 成功:', nickname || '(昵称空)', avatarUrl ? '头像已获取' : '头像空', 'vip=', isVip, 'lv=', vipLevel)
                } else {
                    console.warn('[QQ] fetchRealProfile 返回空 data:', JSON.stringify(res).slice(0, 200))
                }
            } catch (e) {
                console.error('[QQ] fetchRealProfile error:', e)
            }
        },
        // 拉取用户歌单
        // QQ API 的 getUserPlaylists 需要 uin + cookie 鉴权
        // 库 normalize 后返回: { code:0, data: { playlists: [...] } }
        async fetchUserPlaylists() {
            if (!this.uin || !this.cookie) return
            try {
                const res = await qqUserPlaylists(this.uin, this.cookie, 0, 30)
                const data = res?.data || res?.response?.data || res || {}
                const creatorList = data?.playlists || data?.creatorDiss || data?.mydiss?.list || data?.mymusic || data?.playlist || data?.list || data?.disslist || []
                console.log('[QQ] fetchUserPlaylists 原始数据 keys:', Object.keys(data), '歌单数组长度:', Array.isArray(creatorList) ? creatorList.length : 0)
                this.playlists = (Array.isArray(creatorList) ? creatorList : []).map(p => ({
                    id: p.tid || p.dissid || p.id || p.diss_id || '',
                    name: p.diss_name || p.dissname || p.title || p.name || '',
                    coverImgUrl: p.diss_cover || p.picurl || p.logo || p.pic || p.picurl2 || '',
                    playCount: p.listennum || p.visitnum || 0,
                    songCount: p.songnum || p.song_count || 0,
                    creator: p.creator?.name || p.nickname || p.creator_name || '',
                    type: p.type || 0
                })).filter(p => p.id)
                // 提取"我喜欢"歌单的 dissid(type===1 或名称含"喜欢")
                // 用于红心收藏操作(替代 501 的 oper-mylike 接口)
                const liked = this.playlists.find(p => p.type === 1 || (p.name && p.name.includes('喜欢')))
                this.likedPlaylistId = liked?.id || ''
                console.log('[QQ] fetchUserPlaylists 成功:', this.playlists.length, '个歌单, 我喜欢歌单ID:', this.likedPlaylistId || '(未找到)')
            } catch (e) {
                console.error('[QQ] fetchUserPlaylists error:', e)
                this.playlists = []
            }
        },
        logout() {
            this.isLoggedIn = false
            this.profile = null
            this.cookie = ''
            this.uin = ''
            this.playlists = []
            this.loginMessage = ''
            clearQQCookie()
            clearQQProfile()
        }
    }
})
