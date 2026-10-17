import { defineStore } from 'pinia'
import { useMessageStore } from './message'
import { resolveKugouPlaylistFileIds } from '../utils/kugou-playlists'
import {
    kugouLoginCellphone, kugouLoginUsername, kugouLoginOpenplat,
    kugouCaptchaSent, kugouQrKey, kugouQrCreate, kugouQrCheck, kugouQrCancel,
    kugouWxCreate, kugouWxCheck,
    kugouLoginToken, kugouUserDetail, kugouUserVip, kugouUserPlaylist,
    getKugouCookie, setKugouCookie, clearKugouCookie,
    getKugouProfile, setKugouProfile, clearKugouProfile, getKugouUserid,
    normalizeKugouPlaylist, normalizeKugouSong, kugouLikeSong, kugouUnlikeSong,
    kugouPlaylistAdd, kugouPlaylistDel, kugouPlaylistTracksAdd, kugouPlaylistTracksDel,
    kugouPlaylistSongsNew
} from '../api/kugou'

export const useKugouUserStore = defineStore('kugouUser', {
    state: () => ({ sessionCheckedAt: 0,
        isLoggedIn: false,
        revision: 0,
        profile: getKugouProfile(),
        cookie: getKugouCookie(),
        userid: getKugouUserid(),
        playlists: [],
        playlistsLoading: false,
        playlistsError: '',
        playlistsRequest: 0,
        likedPlaylistId: '',
        likedSongsHashes: [],  // 已喜欢歌曲的 hash 集合(用于快速判断 isLiked)
        vipInfo: null,
        vipLoading: false,
        vipError: '',
        vipCheckedAt: 0,
        vipRequest: 0,
        logining: false,
        loginMessage: ''
    }),
    actions: {
        async _acceptKugouCredentials(data, revision, stillActive = () => true) {
            if (revision !== this.revision || !stillActive()) return false
            const token = data?.token, userid = data?.userid
            if (!token || !userid) throw new Error('登录响应缺少完整凭据')
            const result = await kugouLoginToken(token, userid)
            if (revision !== this.revision || !stillActive()) return false
            if (result?.status !== 1 || result.error_code || String(result.data?.userid) !== String(userid)) throw new Error('酷狗未确认有效登录')
            this._applyKugouLogin(result.data.token || token, userid, { ...data, ...result.data })
            return true
        },
        async restoreSession() {
            if (!this.cookie || !this.userid) return false
            const revision = this.revision
            try {
                const result = await kugouLoginToken(this.cookie, this.userid)
                if (revision !== this.revision) return false
                if (result?.status !== 1 || result.error_code || String(result.data?.userid) !== String(this.userid)) return false
                this._applyKugouLogin(result.data.token || this.cookie, this.userid, result.data)
                return true
            } catch { return false }
        },
        // 手机号 + 验证码登录
        // 实测 /login/cellphone 在验证码错误/过期时返回 HTTP 502 + body "error code: 502"（非 JSON）
        // 拦截器会把 502 body 原样返回（字符串），需在此检测
        // error_code 34175: 用户存在多个账户，body.data.info_list 包含账户列表
        //   - 不自动重试，返回 { multiAccounts: [...] } 让调用方弹窗选择
        //   - 调用方选择后用 phoneLoginWithUserid(mobile, code, userid) 完成登录
        async phoneLogin(mobile, code) {
            const revision = this.revision
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginCellphone(mobile, code)
                if (revision !== this.revision) return false
                // 502 字符串响应（验证码错误/过期）
                if (typeof res === 'string') {
                    if (res.includes('502')) {
                        throw new Error('验证码错误或已过期，请重新获取')
                    }
                    throw new Error('登录失败：' + res)
                }
                // error_code 34175: 多账户场景，返回账户列表让用户选择
                const errCode = res?.error_code || res?.data?.error_code || 0
                if (errCode === 34175) {
                    const infoList = res?.data?.info_list || res?.info_list || []
                    // 标准化账户列表，供 UI 显示
                    const accounts = (Array.isArray(infoList) ? infoList : []).map(u => ({
                        userid: String(u?.userid || u?.user_id || u?.id || ''),
                        username: u?.username || u?.nickname || u?.name || '',
                        mobile: u?.mobile || u?.phone || '',
                        pic: u?.pic || u?.avatar || u?.headpic || ''
                    })).filter(u => u.userid)
                    if (accounts.length > 0) {
                        // 返回多账户列表，让调用方弹窗选择
                        return { multiAccounts: accounts }
                    }
                }
                // 酷狗返回 { status, token, userid, ... } 或 { data: { token, userid } }
                const data = res?.data || res
                const token = data?.token || res?.token
                const userid = data?.userid || res?.userid
                if (!token || !userid) {
                    const finalErrCode = res?.error_code || data?.error_code || 0
                    let errMsg = ''
                    if (finalErrCode === 34175) errMsg = '该手机号关联多个账户，但未能解析账户列表'
                    else if (finalErrCode) errMsg = `登录失败（错误码 ${finalErrCode}）`
                    else errMsg = data?.error_msg || data?.msg || '验证码错误或已过期'
                    throw new Error(errMsg)
                }
                return await this._acceptKugouCredentials({ ...data, token, userid }, revision)
            } catch (e) {
                this.loginMessage = e.message || '登录失败'
                useMessageStore().error(this.loginMessage)
                return false
            } finally {
                this.logining = false
            }
        },

        // 多账户场景：用指定 userid 完成登录
        async phoneLoginWithUserid(mobile, code, userid) {
            const revision = this.revision
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginCellphone(mobile, code, userid)
                if (revision !== this.revision) return false
                if (typeof res === 'string') {
                    if (res.includes('502')) {
                        throw new Error('验证码错误或已过期，请重新获取')
                    }
                    throw new Error('登录失败：' + res)
                }
                const data = res?.data || res
                const token = data?.token || res?.token
                const finalUserid = data?.userid || res?.userid
                if (!token || !finalUserid) {
                    const finalErrCode = res?.error_code || data?.error_code || 0
                    let errMsg = '登录失败'
                    if (finalErrCode) errMsg = `登录失败（错误码 ${finalErrCode}）`
                    else errMsg = data?.error_msg || data?.msg || errMsg
                    throw new Error(errMsg)
                }
                return await this._acceptKugouCredentials({ ...data, token, userid: finalUserid }, revision)
            } catch (e) {
                this.loginMessage = e.message || '登录失败'
                useMessageStore().error(this.loginMessage)
                return false
            } finally {
                this.logining = false
            }
        },

        // 内部：应用登录态（phoneLogin 和 phoneLoginWithUserid 共用）
        _applyKugouLogin(token, userid, data) {
            this.sessionCheckedAt = Date.now()
            this.revision++
            setKugouCookie(token)
            const previous = String(this.profile?.userid) === String(userid) ? this.profile : {}
            const profile = { ...previous, ...data, ...(data.user || data.userInfo || {}), userid, nickname:data.nickname || data.username || data.user?.nickname || previous.nickname || '', avatarUrl:data.pic || data.user?.pic || previous.avatarUrl || '' }
            delete profile.token
            this.playlists = []; this.likedSongsHashes = []; this.likedPlaylistId = ''; this.vipInfo = null
            this.vipError = ''; this.vipLoading = false; this.vipCheckedAt = 0; this.vipRequest++
            this.playlistsError = ''; this.playlistsLoading = false; this.playlistsRequest++
            setKugouProfile(profile)
            this.cookie = token
            this.userid = userid
            this.profile = profile
            this.isLoggedIn = true
            // 异步拉取详细信息
            this.fetchRealProfile()
            this.fetchVipInfo()
            this.fetchUserPlaylists()
            useMessageStore().success('酷狗登录成功')
        },

        // 候选凭据必须经过官方 token 验证，失败时保留当前有效会话。
        async cookieLogin(rawCookie) {
            const revision = this.revision
            this.logining = true
            this.loginMessage = ''
            try {
                let token = '', userid = ''
                const trimmed = (rawCookie || '').trim()
                // 兼容多种格式："token=xxx;userid=xxx" / "token=xxx; userid=xxx" / 纯 token
                const tokenMatch = trimmed.match(/token=([^;\s]+)/i)
                const useridMatch = trimmed.match(/userid=([^;\s]+)/i)
                if (tokenMatch) {
                    token = tokenMatch[1].trim()
                    userid = useridMatch ? useridMatch[1].trim() : ''
                } else {
                    // 纯 token 格式（无 token= 前缀）
                    token = trimmed
                }
                if (!token) throw new Error('未识别到 token')
                if (!userid) {
                    throw new Error('缺少 userid，请复制完整的 "token=xxx;userid=xxx" 格式（在设置中可一键复制）')
                }

                const result = await kugouLoginToken(token, userid)
                if (revision !== this.revision) return false
                if (result?.status !== 1 || result.error_code || String(result.data?.userid) !== String(userid)) throw new Error('酷狗未确认有效登录，请检查 Cookie')
                this._applyKugouLogin(result.data.token || token, userid, result.data)
                return true
            } catch (e) {
                this.loginMessage = e.message || 'Cookie 登录失败'
                useMessageStore().error(this.loginMessage)
                return false
            } finally {
                this.logining = false
            }
        },

        // 酷狗二维码登录：key → create → 轮询 check
        // 实测 /login/qr/key 响应：{ data: { qrcode: "key_string", qrcode_img: "data:image/png;base64,..." } }
        // 实测 /login/qr/create 响应：{ data: { base64: "...", url: "..." } }
        // 文档状态码：0=过期 1=等待扫码 2=待确认 4=成功(返回 token)
        async qrLogin(qrImgRef, statusRef, messageRef, stillActive = () => true) {
            const revision = this.revision
            let key = '', timer = null, stopped = false
            const active = () => !stopped && revision === this.revision && stillActive()
            const stop = () => { stopped = true; clearTimeout(timer); if (key) kugouQrCancel(key).catch(() => {}) }
            try {
                const keyRes = await kugouQrKey()
                key = keyRes?.data?.qrcode || keyRes?.data?.qrkey || keyRes?.data?.key || keyRes?.qrcode
                if (!key) throw new Error('获取二维码失败，请重试')
                if (!active()) { stop(); return stop }
                let image = keyRes?.data?.qrcode_img
                if (!image) {
                    const result = await kugouQrCreate(key)
                    image = result?.data?.base64 || result?.data?.qrimg
                }
                if (!active()) { stop(); return stop }
                if (!image) throw new Error('二维码图片加载失败，请重试')
                qrImgRef.value = image; statusRef.value = 1
                if (messageRef) messageRef.value = '请使用酷狗概念版 App 扫码，并在手机上确认'
                const poll = async () => {
                    if (!active()) { stop(); return }
                    try {
                        const result = await kugouQrCheck(key)
                        if (!active()) { stop(); return }
                        const data = result?.data, state = data?.status
                        if (![0,1,2,4].includes(state)) throw new Error('扫码状态异常，请刷新重试')
                        if (state === 4) {
                            if (!data.token || !data.userid) throw new Error('登录响应缺少凭据，请重新扫码')
                            const accepted = await kugouLoginToken(data.token, data.userid)
                            if (!active()) { stop(); return }
                            if (accepted?.status !== 1 || accepted.error_code || String(accepted.data?.userid) !== String(data.userid)) throw new Error('酷狗未确认有效登录')
                            stop(); this._applyKugouLogin(accepted.data.token || data.token, data.userid, accepted.data)
                            statusRef.value = 4
                            return
                        }
                        statusRef.value = state
                        if (messageRef) messageRef.value = state === 2 ? '已扫描，请在手机上确认' : state === 0 ? '二维码已过期，请刷新' : '等待扫码'
                        if (state === 0) { stop(); return }
                        timer = setTimeout(poll, 2500)
                    } catch (e) { if (active() && messageRef) messageRef.value = e.message; stop() }
                }
                timer = setTimeout(poll, 1000)
                return stop
            } catch (e) {
                if (active() && messageRef) messageRef.value = e.message || '二维码登录失败'
                stop(); return stop
            }
        },

        // 微信扫码登录：wxCreate 拿 uuid + 二维码 → 轮询 wxCheck
        // 实测 /login/wx/create 响应（扁平结构，无 data 包裹）：
        //   { appname, errcode:0, uuid:"xxx", qrcode: { qrcodebase64:"/9j/...", qrcodelength:62980, qrcodeurl:"https://..." } }
        //   注意：qrcode 是对象不是字符串，qrcodebase64 是裸 base64（无 data:image 前缀，是 JPEG 格式）
        // 文档状态码：408=等待扫描 404=已扫描 403=拒绝 405=成功(返 wx_code) 402=已过期
        // 成功后需调 /login/openplat 用 wx_code 换 token
        async wxQrLogin(qrImgRef, statusRef, messageRef, stillActive = () => true) {
            const revision = this.revision
            let stopped = false, busy = false, timer = null
            const active = () => !stopped && revision === this.revision && stillActive()
            const stopFn = () => { stopped = true; clearInterval(timer) }
            this.loginMessage = ''
            try {
                const createRes = await kugouWxCreate()
                if (!active()) return stopFn
                // wx/create 响应是扁平结构，没有 data 包裹
                const data = createRes?.data || createRes
                const uuid = data?.uuid || createRes?.uuid || ''
                // qrcode 是对象 { qrcodebase64, qrcodelength, qrcodeurl }
                const qrObj = data?.qrcode || {}
                let qrBase64 = ''
                if (typeof qrObj === 'string') {
                    qrBase64 = qrObj
                } else {
                    qrBase64 = qrObj?.qrcodebase64 || qrObj?.qrcodeurl || ''
                }
                // 兼容 data.qrimg / data.image 等其他可能字段
                if (!qrBase64) qrBase64 = data?.qrimg || data?.image || createRes?.qrimg || ''
                // 裸 base64 需要补 data:image/jpeg;base64, 前缀才能在 <img src> 中显示
                if (qrBase64 && !qrBase64.startsWith('data:') && !qrBase64.startsWith('http')) {
                    qrBase64 = 'data:image/jpeg;base64,' + qrBase64
                }
                if (!uuid) throw new Error('获取微信二维码失败')
                qrImgRef.value = qrBase64
                if (messageRef) messageRef.value = '请使用微信扫码'
                statusRef.value = 408

                // 返回停止函数给调用方，轮询在后台进行（不阻塞 logining）
                timer = setInterval(async () => {
                    if (!active()) { stopFn(); return }
                    if (busy) return
                    busy = true
                    try {
                        const r = await kugouWxCheck(uuid)
                        if (!active()) return
                        // 处理字符串响应（502 等错误被拦截器转为字符串）
                        if (typeof r === 'string') {
                            console.warn('[Kugou WX] check 返回字符串:', r.slice(0, 200))
                            // 字符串响应说明请求异常，不计入连续失败计数
                            return
                        }
                        // wx/check 响应可能有两种结构：
                        //   扁平：{ status:408, wx_code:"" }  ← 扫码状态在顶层
                        //   包裹：{ status:1, data:{ status:408, wx_code:"" } }  ← 顶层 status 是请求状态,扫码状态在 data
                        // ⚠️ 必须优先取 data.status,否则会取到酷狗请求状态码 1 而非扫码状态码
                        // 状态码字段也可能是 errcode/code（不同 API 版本）
                        const st = r?.data?.status ?? r?.data?.errcode ?? r?.status ?? r?.errcode ?? r?.code ?? 0
                        // 过滤掉酷狗请求状态码 1（成功），只认扫码状态码（408/404/403/405/402）
                        const scanSt = (st === 1) ? 0 : st
                        if (scanSt !== 405) statusRef.value = scanSt
                        if (scanSt === 405) {
                            // 登录成功，拿到 wx_code 换 token
                            clearInterval(timer)
                            timer = null
                            const wxCode = r?.data?.wx_code || r?.wx_code || r?.data?.code || ''
                            if (!wxCode) {
                                useMessageStore().error('微信登录返回缺少 wx_code')
                                return
                            }
                            try {
                                const accepted = await this._loginWithWxCode(wxCode, active)
                                if (!accepted) return
                                statusRef.value = 405
                                if (messageRef) messageRef.value = '微信登录成功'
                            } catch (e) {
                                useMessageStore().error(e.message || '微信登录换 token 失败')
                            }
                        } else if (scanSt === 408) {
                            if (messageRef) messageRef.value = '请使用微信扫码'
                        } else if (scanSt === 404) {
                            if (messageRef) messageRef.value = '已扫描，请在手机上确认'
                        } else if (scanSt === 403) {
                            clearInterval(timer)
                            timer = null
                            if (messageRef) messageRef.value = '已拒绝登录'
                        } else if (scanSt === 402) {
                            clearInterval(timer)
                            timer = null
                            if (messageRef) messageRef.value = '二维码已过期'
                        } else if (scanSt && scanSt !== 1) {
                            // 未知状态码（非 0/1/408/404/403/405/402），提示用户
                            if (messageRef) messageRef.value = `扫码状态：${scanSt}，请稍候...`
                        }
                    } catch (e) {
                        // wx/check 在 uuid 无效时返回 502 字符串，静默重试
                        console.warn('[Kugou WX] check 异常:', e?.message || e)
                    } finally { busy = false }
                }, 2500)
                return stopFn
            } catch (e) {
                stopFn()
                this.loginMessage = e.message || '微信扫码登录失败'
                useMessageStore().error(this.loginMessage)
                return null
            }
        },

        // 微信 wx_code 换 token 完成登录
        async _loginWithWxCode(wxCode, stillActive = () => true) {
            const revision = this.revision
            const res = await kugouLoginOpenplat(wxCode)
            if (revision !== this.revision || !stillActive()) return false
            const data = res?.data || res
            const token = data?.token || res?.token
            const userid = data?.userid || res?.userid
            if (!token || !userid) {
                throw new Error(data?.error_msg || data?.msg || '微信登录换 token 失败')
            }
            return this._acceptKugouCredentials({ ...data, token, userid }, revision, stillActive)
        },

        // 用户名 + 密码登录（文档标注可能需要验证，不推荐）
        async usernameLogin(username, password) {
            const revision = this.revision
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginUsername(username, password)
                if (revision !== this.revision) return false
                const data = res?.data || res
                const token = data?.token || res?.token
                const userid = data?.userid || res?.userid
                if (!token || !userid) {
                    throw new Error(data?.error_msg || data?.msg || '用户名或密码错误')
                }
                return await this._acceptKugouCredentials({ ...data, token, userid }, revision)
            } catch (e) {
                this.loginMessage = e.message || '登录失败'
                useMessageStore().error(this.loginMessage)
                return false
            } finally {
                this.logining = false
            }
        },

        async fetchRealProfile() {
            if (!this.userid) return
            const revision = this.revision
            try {
                const res = await kugouUserDetail()
                if (revision !== this.revision || !this.isLoggedIn || res?.status !== 1 || res.error_code) return
                // /user/detail 响应（实测）：
                // { "data": { "nickname":"小茗", "pic":"http://...", "k_pic":"...", "fx_pic":"...", "gender":1, "svip_level":5 }, "error_code":0, "status":1 }
                const data = res?.data || res
                console.log('[Kugou] /user/detail data:', { nickname: data?.nickname, pic: data?.pic, k_pic: data?.k_pic })
                // 酷狗头像字段：pic / k_pic / fx_pic / sizable_avatar
                let avatarUrl = data?.pic || data?.pic_url || data?.picUrl || data?.avatarUrl ||
                    data?.k_pic || data?.fx_pic || data?.head_pic || data?.headpic ||
                    data?.avatar || data?.logo || data?.user_pic || ''
                if (!avatarUrl && data?.sizable_avatar) {
                    avatarUrl = String(data.sizable_avatar).replace('{size}', '150')
                }
                // 协议补全（相对协议 //xxx）
                if (avatarUrl && avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl
                if (!avatarUrl) avatarUrl = this.profile?.avatarUrl || ''
                const nickname = data?.nickname || data?.nick_name || data?.username ||
                    data?.user_name || this.profile?.nickname || ''
                console.log('[Kugou] fetchRealProfile 提取结果:', { nickname, avatarUrl })
                const profile = {
                    ...this.profile,
                    ...data,
                    avatarUrl,
                    nickname
                }
                setKugouProfile(profile)
                this.profile = profile
            } catch (e) {
                console.warn('[Kugou] fetchRealProfile error:', e.message)
            }
        },

        async fetchVipInfo() {
            if (!this.userid || !this.isLoggedIn) return false
            const revision = this.revision
            const request = ++this.vipRequest
            const active = () => revision === this.revision && request === this.vipRequest && this.isLoggedIn
            this.vipLoading = true; this.vipError = ''
            try {
                const res = await kugouUserVip()
                if (!active()) return false
                if (res?.status !== 1 || res.error_code) throw new Error(`酷狗会员查询失败（${res?.error_code || '响应异常'}）`)
                // 响应结构（实测）：
                // {
                //   "data": {
                //     "is_vip": 0,  // ⚠️ 顶层 is_vip 不可靠（用户有 VIP 但显示 0）
                //     "vip_type": 0,
                //     "svip_level": 5,
                //     "busi_vip": [  // ✅ 真正的 VIP 信息在这里
                //       { "is_vip": 1, "product_type": "svip", "busi_type": "concept", "vip_end_time": "2026-11-04" },
                //       { "is_vip": 1, "product_type": "tvip", "busi_type": "concept" }
                //     ]
                //   }
                // }
                const data = res?.data || res
                if (!Array.isArray(data.busi_vip)) throw new Error('酷狗会员响应不完整，请重试')
                this.vipInfo = data
                // VIP 判定：只有 busi_vip 数组中有 is_vip:1 才判定为 VIP
                // 顶层 is_vip 不可靠(用户有 VIP 但显示 0)
                // svip_level > 0 也不可靠(可能导致非 VIP 用户误判),去掉此兜底
                const busiVipList = Array.isArray(data?.busi_vip) ? data.busi_vip : []
                const conceptVip = busiVipList.find(v => v?.busi_type === 'concept' && [1,'1',true].includes(v?.is_vip))
                const anyVip = busiVipList.find(v => [1,'1',true].includes(v?.is_vip))
                const isVip = !!(conceptVip || anyVip) || [1,'1',true].includes(data.is_vip)
                if (this.profile) {
                    const profile = { ...this.profile, isVip, vipInfo: data }
                    setKugouProfile(profile)
                    this.profile = profile
                }
                this.vipCheckedAt = Date.now()
                return true
            } catch (e) {
                if (active()) this.vipError = e.message || '会员查询失败，请重试'
                return false
            } finally { if (active()) this.vipLoading = false }
        },

        async fetchUserPlaylists() {
            if (!this.isLoggedIn) return false
            const revision = this.revision
            const request = ++this.playlistsRequest
            const active = () => revision === this.revision && this.isLoggedIn && request === this.playlistsRequest
            this.playlistsLoading = true
            this.playlistsError = ''
            try {
                const all = []
                let page = 1, res
                do {
                    res = await kugouUserPlaylist(page, 100)
                    if (!active()) return false
                    if (res?.status !== 1 || res.error_code) break
                    if (!Array.isArray(res.data?.info)) throw new Error('酷狗歌单响应不完整，请重试')
                    all.push(...res.data.info)
                    if (res.data.info.length < 100) break
                    if (++page > 100) throw new Error('酷狗歌单分页未完成，请稍后重试')
                } while (true)
                if (!active()) return false
                if (res?.status !== 1 || res.error_code) {
                    const code = Number(res?.error_code || 0)
                    throw new Error(code === 20017
                        ? '酷狗歌单服务未接受当前登录凭据，请重试或重新登录（20017）'
                        : `酷狗歌单加载失败${code ? `（${code}）` : '，请稍后重试'}`)
                }
                // 响应结构（实测）：
                // { "data": { "info": [ { "listid":1, "name":"默认收藏", "pic":"...", "global_collection_id":"...", "count":8 } ] } }
                // ⚠️ 字段是 data.info，不是 data.list！
                const list = res?.data?.info ?? res?.data?.list ?? res?.data?.special_list ??
                    (Array.isArray(res?.data) ? res.data : undefined) ??
                    res?.list ?? res?.info ?? res?.special_list
                if (!Array.isArray(list)) throw new Error('酷狗歌单响应不完整，请重试')
                this.playlists = [...new Map(all.map(p => normalizeKugouPlaylist(p, this.userid)).filter(p => p.id).map(p=>[p.id,p])).values()]
                // 识别"我喜欢"歌单（名称包含"喜欢"或"favorite"）
                const liked = this.playlists.find(p =>
                    /我喜欢|我喜歡|favorite|喜歡的歌/i.test(p.name)
                )
                this.likedPlaylistId = liked?.id || ''
                // 拉取"我喜欢"歌单的歌曲 hash 列表,用于播放时判断 isLiked
                if (this.likedPlaylistId) {
                    this.fetchLikedSongs()
                }
                return true
            } catch (e) {
                if (active()) this.playlistsError = e.message || '酷狗歌单加载失败，请重试'
                return false
            } finally {
                if (active()) this.playlistsLoading = false
            }
        },

        logout() {
            this.revision++
            clearKugouCookie()
            clearKugouProfile()
            this.isLoggedIn = false
            this.profile = null
            this.cookie = ''
            this.userid = ''
            this.playlists = []
            this.playlistsRequest++
            this.playlistsLoading = false
            this.playlistsError = ''
            this.likedPlaylistId = ''
            this.likedSongsHashes = []
            this.vipInfo = null
            this.vipRequest++; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = 0
            useMessageStore().success('已退出酷狗登录')
        },

        // 喜欢/取消喜欢歌曲（基于"我喜欢"歌单操作）
        // song: 标准化后的歌曲对象（含 hash/album_audio_id/album_id/name）
        async toggleLikeSong(song) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!this.likedPlaylistId) {
                useMessageStore().warning('未找到"我喜欢"歌单，无法操作')
                return false
            }
            if (!song?.hash) {
                useMessageStore().warning('该歌曲信息不完整,无法收藏')
                return false
            }
            try {
                // 用 isSongLiked(hash) 判断当前喜欢状态,而不是依赖外部传入的 isLiked 字段
                const isLiked = this.isSongLiked(song.hash)
                if (isLiked) {
                    // 取消喜欢：复用 removeSongFromPlaylist 逻辑（与删除歌单歌曲一致）
                    const ok = await this.removeSongFromPlaylist(this.likedPlaylistId, song)
                    if (!ok || revision !== this.revision) return false
                    // 从 likedSongsHashes 中移除
                    this.likedSongsHashes = this.likedSongsHashes.filter(h => h !== song.hash)
                    useMessageStore().success('已取消喜欢')
                } else {
                    // 添加喜欢
                    const result = await kugouLikeSong(
                        this.likedPlaylistId,
                        song.name || song.songname || '',
                        song.hash,
                        song.album_id || '',
                        song.mixsongid || song.album_audio_id || ''
                    )
                    if (revision !== this.revision) return false
                    if (!this._isKugouSuccess(result)) {
                        useMessageStore().error(this._getKugouError(result) || '添加喜欢失败')
                        return false
                    }
                    // 添加到 likedSongsHashes
                    if (!this.likedSongsHashes.includes(song.hash)) {
                        this.likedSongsHashes.push(song.hash)
                    }
                    useMessageStore().success('已添加到喜欢')
                }
                return true
            } catch (e) {
                console.error('[Kugou] toggleLikeSong error:', e)
                useMessageStore().error('操作失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 检查歌曲是否已喜欢(通过 hash 匹配 likedSongsHashes)
        isSongLiked(hash) {
            if (!hash) return false
            return this.likedSongsHashes.includes(hash)
        },

        // 拉取"我喜欢"歌单的歌曲列表,更新 likedSongsHashes
        // 用于播放时判断 isLiked 状态
        // 分页获取全部喜欢歌曲,避免超过100首的歌曲遗漏爱心状态
        async fetchLikedSongs() {
            if (!this.likedPlaylistId) return
            const revision = this.revision
            try {
                const { kugouPlaylistSongsNew, normalizeKugouSong } = await import('../api/kugou')
                const PAGE_SIZE = 300
                let page = 1
                const allHashes = []
                // 循环加载直到没有更多
                while (true) {
                    const res = await kugouPlaylistSongsNew(this.likedPlaylistId, page, PAGE_SIZE)
                    if (revision !== this.revision || !this.isLoggedIn) return
                    const data = res?.data || res
                    const list = data?.info || data?.lists || data?.songs || data?.list || []
                    const arr = Array.isArray(list) ? list : []
                    const hashes = arr.map(s => normalizeKugouSong(s)?.hash).filter(Boolean)
                    allHashes.push(...hashes)
                    // 不足一页或没有更多,停止加载
                    if (arr.length < PAGE_SIZE) break
                    page++
                    // 安全限制:最多10页(10000首)
                    if (page > 10) break
                }
                this.likedSongsHashes = allHashes
                console.log(`[Kugou] 已拉取喜欢歌曲 ${this.likedSongsHashes.length} 首`)
            } catch (e) {
                console.warn('[Kugou] fetchLikedSongs failed:', e.message)
            }
        },

        // ========== 歌单管理：创建/收藏/删除/添加歌曲/删除歌曲 ==========

        // 酷狗 API 成功判定辅助函数
        // interceptor 返回 response.data，即 res 已是响应体
        // 响应体可能是 { status:1, data:{...} } 或 { errcode:0, ... } 或 { data:{ status:1 } }
        // 需要检查所有可能的 status/errcode 位置
        _isKugouSuccess(res) {
            const error = res?.error_code ?? res?.errcode ?? res?.data?.error_code ?? res?.data?.errcode
            const status = res?.status ?? res?.data?.status
            const ok = (status === 1 || (status === undefined && error === 0)) && (!error || error === 0)
            return ok
        },

        _getKugouError(res) {
            return res?.error_msg || res?.error || res?.msg || res?.data?.error_msg || res?.data?.error || res?.data?.msg || ''
        },

        // 新建歌单 (type=0) / 收藏歌单 (type=1)
        async createPlaylist(name, is_pri = 0) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!name?.trim()) {
                useMessageStore().warning('歌单名称不能为空')
                return false
            }
            try {
                const res = await kugouPlaylistAdd(name.trim(), '', '', 0, is_pri)
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success('歌单创建成功')
                    await this.fetchUserPlaylists()
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '创建失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] createPlaylist error:', e)
                useMessageStore().error('创建歌单失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 收藏歌单(把别人的歌单收藏到自己账号)
        async collectPlaylist(playlist) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!playlist?.id) {
                useMessageStore().warning('歌单信息不完整')
                return false
            }
            try {
                const res = await kugouPlaylistAdd(
                    playlist.name || '',
                    playlist.creatorId || '',
                    playlist.listid || playlist.id || '',
                    1
                )
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success('歌单收藏成功')
                    await this.fetchUserPlaylists()
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '收藏失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] collectPlaylist error:', e)
                useMessageStore().error('收藏歌单失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 删除歌单 / 取消收藏歌单
        async deletePlaylist(listid) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid) {
                useMessageStore().warning('歌单 ID 不能为空')
                return false
            }
            try {
                const res = await kugouPlaylistDel(listid)
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success('歌单已删除')
                    await this.fetchUserPlaylists()
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '删除失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] deletePlaylist error:', e)
                useMessageStore().error('删除歌单失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 添加歌曲到指定歌单
        async addSongToPlaylist(listid, song) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid || !song?.hash) {
                useMessageStore().warning('参数不完整')
                return false
            }
            try {
                const data = { name: song.name || song.songname || '', hash: song.hash,
                    album_id: song.album_id || '', mixsongid: song.mixsongid || song.album_audio_id || '' }
                const res = await kugouPlaylistTracksAdd(listid, data)
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success('已添加到歌单')
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '添加失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] addSongToPlaylist error:', e)
                useMessageStore().error('添加到歌单失败：' + (e.message || '未知错误'))
                return false
            }
        },

        _playlistFileIds(listid, songs, revision) {
            return resolveKugouPlaylistFileIds(listid, songs, kugouPlaylistSongsNew,
                () => revision === this.revision && this.isLoggedIn)
        },

        // 从指定歌单删除歌曲(单首)
        async removeSongFromPlaylist(listid, song) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            // 按 hash 从目标歌单读取真实条目 fileid，禁止使用曲库 ID
            if (!listid || !song?.hash) {
                useMessageStore().warning('参数不完整')
                return false
            }
            try {
                const fileids = await this._playlistFileIds(listid, [song], revision)
                if (revision !== this.revision || !this.isLoggedIn) return false
                const res = await kugouPlaylistTracksDel(listid, fileids)
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success('已从歌单移除')
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '移除失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] removeSongFromPlaylist error:', e)
                useMessageStore().error('从歌单移除失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 批量从歌单删除歌曲
        // songs: 标准化后的歌曲对象数组(需含 hash 字段)
        async batchRemoveFromPlaylist(listid, songs) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid || !songs?.length) {
                useMessageStore().warning('参数不完整')
                return false
            }
            // 按 hash 从目标歌单读取真实条目 fileid，禁止使用曲库 ID
            try {
                const fileids = await this._playlistFileIds(listid, songs, revision)
                if (revision !== this.revision || !this.isLoggedIn) return false
                const res = await kugouPlaylistTracksDel(listid, fileids)
                if (revision !== this.revision || !this.isLoggedIn) return false
                if (this._isKugouSuccess(res)) {
                    useMessageStore().success(`已移除 ${fileids.length} 首歌曲`)
                    return true
                } else {
                    useMessageStore().error(this._getKugouError(res) || '批量移除失败')
                    return false
                }
            } catch (e) {
                console.error('[Kugou] batchRemoveFromPlaylist error:', e)
                useMessageStore().error('批量移除失败：' + (e.message || '未知错误'))
                return false
            }
        },

        // 批量取消喜欢歌曲
        // songs: 标准化后的歌曲对象数组(需含 hash 字段)
        async batchUnlikeSongs(songs) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!songs?.length) return false
            let successCount = 0
            for (const song of songs) {
                if (revision !== this.revision || !this.isLoggedIn) return false
                try {
                    const ok = await this.toggleLikeSong(song)
                    if (revision !== this.revision || !this.isLoggedIn) return false
                    if (ok) successCount++
                } catch (e) {
                    console.warn('[Kugou] batchUnlikeSongs 单首失败:', song?.name, e.message)
                }
            }
            if (successCount > 0) {
                useMessageStore().success(`已取消喜欢 ${successCount} 首歌曲`)
                return true
            } else {
                useMessageStore().error('批量取消喜欢失败')
                return false
            }
        },

        // 批量取消收藏歌单/删除歌单
        // listids: 歌单 id 数组
        async batchDeletePlaylists(listids) {
            const revision = this.revision
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listids?.length) return false
            let successCount = 0
            for (const listid of listids) {
                if (revision !== this.revision || !this.isLoggedIn) return false
                try {
                    const res = await kugouPlaylistDel(listid)
                    if (revision !== this.revision || !this.isLoggedIn) return false
                    if (this._isKugouSuccess(res)) successCount++
                } catch (e) {
                    console.warn('[Kugou] batchDeletePlaylists 单个失败:', listid, e.message)
                }
            }
            if (successCount > 0) {
                useMessageStore().success(`已删除 ${successCount} 个歌单`)
                await this.fetchUserPlaylists()
                return true
            } else {
                useMessageStore().error('批量删除失败')
                return false
            }
        }
    }
})
