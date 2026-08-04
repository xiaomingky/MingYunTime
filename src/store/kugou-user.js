import { defineStore } from 'pinia'
import { useMessageStore } from './message'
import {
    kugouLoginCellphone, kugouLoginUsername, kugouLoginOpenplat,
    kugouCaptchaSent, kugouQrKey, kugouQrCreate, kugouQrCheck,
    kugouWxCreate, kugouWxCheck,
    kugouLoginToken, kugouUserDetail, kugouUserVip, kugouUserPlaylist,
    getKugouCookie, setKugouCookie, clearKugouCookie,
    getKugouProfile, setKugouProfile, clearKugouProfile, getKugouUserid,
    normalizeKugouPlaylist, kugouLikeSong, kugouUnlikeSong,
    kugouPlaylistAdd, kugouPlaylistDel, kugouPlaylistTracksAdd, kugouPlaylistTracksDel
} from '../api/kugou'

export const useKugouUserStore = defineStore('kugouUser', {
    state: () => ({
        isLoggedIn: !!getKugouCookie() && !!getKugouProfile(),
        profile: getKugouProfile(),
        cookie: getKugouCookie(),
        userid: getKugouUserid(),
        playlists: [],
        likedPlaylistId: '',
        likedSongsHashes: [],  // 已喜欢歌曲的 hash 集合(用于快速判断 isLiked)
        vipInfo: null,
        logining: false,
        loginMessage: ''
    }),
    actions: {
        // 手机号 + 验证码登录
        // 实测 /login/cellphone 在验证码错误/过期时返回 HTTP 502 + body "error code: 502"（非 JSON）
        // 拦截器会把 502 body 原样返回（字符串），需在此检测
        // error_code 34175: 用户存在多个账户，body.data.info_list 包含账户列表
        //   - 不自动重试，返回 { multiAccounts: [...] } 让调用方弹窗选择
        //   - 调用方选择后用 phoneLoginWithUserid(mobile, code, userid) 完成登录
        async phoneLogin(mobile, code) {
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginCellphone(mobile, code)
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
                    console.log('[Kugou] 多账户登录, info_list:', JSON.stringify(infoList).slice(0, 500))
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
                this._applyKugouLogin(token, userid, data)
                return true
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
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginCellphone(mobile, code, userid)
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
                this._applyKugouLogin(token, finalUserid, data)
                return true
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
            setKugouCookie(token)
            const profile = { userid, ...(data.user || data.userInfo || {}) }
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

        // Cookie/Token 粘贴登录：解析 "token=xxx;userid=xxx" 或纯 token
        // 实测 /login/token 返回 502 字符串（接口缓存问题），不能依赖它判断有效性
        // 策略：只要 token 格式合法 + 有 userid，直接设为登录态，再调 /user/detail 验证
        async cookieLogin(rawCookie) {
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

                // 直接设置登录态（token 由拦截器自动附加到所有请求）
                setKugouCookie(token)
                const profile = { userid }
                setKugouProfile(profile)
                this.cookie = token
                this.userid = userid
                this.profile = profile
                this.isLoggedIn = true

                // 调 /user/detail 验证 token 是否有效（异步，不阻塞登录成功提示）
                this.fetchRealProfile()
                this.fetchVipInfo()
                this.fetchUserPlaylists()
                useMessageStore().success('酷狗 Cookie 登录成功')
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
        async qrLogin(qrImgRef, statusRef, messageRef) {
            try {
                const keyRes = await kugouQrKey()
                // 实测 key 字段名是 qrcode（不是 qrkey）
                const key = keyRes?.data?.qrcode || keyRes?.data?.qrkey || keyRes?.data?.key || keyRes?.qrcode
                if (!key) throw new Error('获取二维码 key 失败')
                // key 接口已返回 qrcode_img，优先用它；否则调 /login/qr/create
                let qrImg = keyRes?.data?.qrcode_img || ''
                if (!qrImg) {
                    const qrcodeRes = await kugouQrCreate(key)
                    qrImg = qrcodeRes?.data?.base64 || qrcodeRes?.data?.qrcode || qrcodeRes?.data?.qrimg || ''
                }
                qrImgRef.value = qrImg
                if (messageRef) messageRef.value = '请使用酷狗概念版 APP 扫码'
                // 轮询 check
                const timer = setInterval(async () => {
                    try {
                        const r = await kugouQrCheck(key)
                        const st = r?.data?.status ?? 0
                        statusRef.value = st
                        // 0=过期 1=等待扫码 2=待确认 4=成功
                        if (st === 4) {
                            clearInterval(timer)
                            const token = r?.data?.token || r?.token
                            const userid = r?.data?.userid || r?.userid
                            if (token && userid) {
                                setKugouCookie(token)
                                const profile = { userid, ...(r?.data?.user || {}) }
                                setKugouProfile(profile)
                                this.cookie = token
                                this.userid = userid
                                this.profile = profile
                                this.isLoggedIn = true
                                this.fetchRealProfile()
                                this.fetchVipInfo()
                                this.fetchUserPlaylists()
                                useMessageStore().success('酷狗扫码登录成功')
                            }
                        } else if (st === 1 || st === 2) {
                            const tipMap = { 1: '等待扫码', 2: '已扫描，待确认' }
                            if (messageRef) messageRef.value = tipMap[st] || '处理中'
                        } else {
                            // st === 0 为过期
                            clearInterval(timer)
                            if (messageRef) messageRef.value = '二维码已过期'
                        }
                    } catch (e) {
                        // 静默重试
                    }
                }, 2000)
                return () => clearInterval(timer)
            } catch (e) {
                useMessageStore().error(e.message || '二维码登录失败')
                return null
            }
        },

        // 微信扫码登录：wxCreate 拿 uuid + 二维码 → 轮询 wxCheck
        // 实测 /login/wx/create 响应（扁平结构，无 data 包裹）：
        //   { appname, errcode:0, uuid:"xxx", qrcode: { qrcodebase64:"/9j/...", qrcodelength:62980, qrcodeurl:"https://..." } }
        //   注意：qrcode 是对象不是字符串，qrcodebase64 是裸 base64（无 data:image 前缀，是 JPEG 格式）
        // 文档状态码：408=等待扫描 404=已扫描 403=拒绝 405=成功(返 wx_code) 402=已过期
        // 成功后需调 /login/openplat 用 wx_code 换 token
        async wxQrLogin(qrImgRef, statusRef, messageRef) {
            this.loginMessage = ''
            try {
                const createRes = await kugouWxCreate()
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
                let timer = null
                const stopFn = () => { if (timer) clearInterval(timer) }
                timer = setInterval(async () => {
                    try {
                        const r = await kugouWxCheck(uuid)
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
                        console.log('[Kugou WX] check 响应:', JSON.stringify(r).slice(0, 300), '状态码:', scanSt)
                        statusRef.value = scanSt
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
                                await this._loginWithWxCode(wxCode)
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
                    }
                }, 2500)
                return stopFn
            } catch (e) {
                this.loginMessage = e.message || '微信扫码登录失败'
                useMessageStore().error(this.loginMessage)
                return null
            }
        },

        // 微信 wx_code 换 token 完成登录
        async _loginWithWxCode(wxCode) {
            const res = await kugouLoginOpenplat(wxCode)
            console.log('[Kugou] /login/openplat 原始响应:', res)
            const data = res?.data || res
            const token = data?.token || res?.token
            const userid = data?.userid || res?.userid
            if (!token || !userid) {
                throw new Error(data?.error_msg || data?.msg || '微信登录换 token 失败')
            }
            setKugouCookie(token)
            // openplat 响应中可能直接含用户信息，提取所有可能的字段
            const userInfo = data.user || data.userInfo || data.data || {}
            // 注意：先展开 userInfo，再设置 avatarUrl/nickname，避免被覆盖
            const profile = {
                ...this.profile,
                ...userInfo,
                userid,
                nickname: userInfo.nickname || userInfo.nick_name || data.nickname || '',
                avatarUrl: userInfo.avatarUrl || userInfo.pic_url || userInfo.pic ||
                    data.avatarUrl || data.pic || data.pic_url || ''
            }
            console.log('[Kugou] 登录后初始 profile:', { userid, nickname: profile.nickname, avatarUrl: profile.avatarUrl })
            setKugouProfile(profile)
            this.cookie = token
            this.userid = userid
            this.profile = profile
            this.isLoggedIn = true
            // 同步触发，await 确保完成后再返回（避免 UI 立即显示"未登录"）
            try {
                await this.fetchRealProfile()
                console.log('[Kugou] fetchRealProfile 完成，profile:', { nickname: this.profile?.nickname, avatarUrl: this.profile?.avatarUrl })
            } catch (e) { console.warn('[Kugou] fetchRealProfile after wx login:', e.message) }
            this.fetchVipInfo()
            this.fetchUserPlaylists()
            useMessageStore().success('酷狗微信登录成功')
            return true
        },

        // 用户名 + 密码登录（文档标注可能需要验证，不推荐）
        async usernameLogin(username, password) {
            this.logining = true
            this.loginMessage = ''
            try {
                const res = await kugouLoginUsername(username, password)
                const data = res?.data || res
                const token = data?.token || res?.token
                const userid = data?.userid || res?.userid
                if (!token || !userid) {
                    throw new Error(data?.error_msg || data?.msg || '用户名或密码错误')
                }
                setKugouCookie(token)
                const profile = { userid, ...(data.user || data.userInfo || {}) }
                setKugouProfile(profile)
                this.cookie = token
                this.userid = userid
                this.profile = profile
                this.isLoggedIn = true
                this.fetchRealProfile()
                this.fetchVipInfo()
                this.fetchUserPlaylists()
                useMessageStore().success('酷狗登录成功')
                return true
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
            try {
                const res = await kugouUserDetail()
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
            if (!this.userid) return
            try {
                const res = await kugouUserVip()
                console.log('[Kugou] /user/vip/detail 原始响应:', res)
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
                this.vipInfo = data
                // VIP 判定：只有 busi_vip 数组中有 is_vip:1 才判定为 VIP
                // 顶层 is_vip 不可靠(用户有 VIP 但显示 0)
                // svip_level > 0 也不可靠(可能导致非 VIP 用户误判),去掉此兜底
                const busiVipList = Array.isArray(data?.busi_vip) ? data.busi_vip : []
                const conceptVip = busiVipList.find(v => v?.busi_type === 'concept' && v?.is_vip === 1)
                const anyVip = busiVipList.find(v => v?.is_vip === 1)
                const isVip = !!(conceptVip || anyVip)
                console.log('[Kugou] VIP 判定结果:', isVip, 'busi_vip:', JSON.stringify(busiVipList.map(v => ({
                    is_vip: v?.is_vip, busi_type: v?.busi_type, product_type: v?.product_type,
                    vip_end_time: v?.vip_end_time
                }))))
                if (this.profile) {
                    const profile = { ...this.profile, isVip, vipInfo: data }
                    setKugouProfile(profile)
                    this.profile = profile
                }
            } catch (e) {
                console.warn('[Kugou] fetchVipInfo error:', e.message)
            }
        },

        async fetchUserPlaylists() {
            if (!this.isLoggedIn) return
            try {
                const res = await kugouUserPlaylist(1, 100)
                console.log('[Kugou] /user/playlist 原始响应:', res)
                // 响应结构（实测）：
                // { "data": { "info": [ { "listid":1, "name":"默认收藏", "pic":"...", "global_collection_id":"...", "count":8 } ] } }
                // ⚠️ 字段是 data.info，不是 data.list！
                const list = res?.data?.info || res?.data?.list || res?.data?.special_list ||
                    (Array.isArray(res?.data) ? res.data : []) ||
                    res?.list || res?.info || res?.special_list || []
                this.playlists = (Array.isArray(list) ? list : []).map(p => normalizeKugouPlaylist(p, this.userid)).filter(p => p.id)
                // 识别"我喜欢"歌单（名称包含"喜欢"或"favorite"）
                const liked = this.playlists.find(p =>
                    /我喜欢|我喜歡|favorite|喜歡的歌/i.test(p.name)
                )
                this.likedPlaylistId = liked?.id || ''
                console.log('[Kugou] 解析到歌单数:', this.playlists.length, this.playlists.slice(0, 3))
                // 拉取"我喜欢"歌单的歌曲 hash 列表,用于播放时判断 isLiked
                if (this.likedPlaylistId) {
                    this.fetchLikedSongs()
                }
            } catch (e) {
                console.warn('[Kugou] fetchUserPlaylists error:', e.message)
            }
        },

        logout() {
            clearKugouCookie()
            clearKugouProfile()
            this.isLoggedIn = false
            this.profile = null
            this.cookie = ''
            this.userid = ''
            this.playlists = []
            this.likedPlaylistId = ''
            this.likedSongsHashes = []
            this.vipInfo = null
            useMessageStore().success('已退出酷狗登录')
        },

        // 喜欢/取消喜欢歌曲（基于"我喜欢"歌单操作）
        // song: 标准化后的歌曲对象（含 hash/album_audio_id/album_id/name）
        async toggleLikeSong(song) {
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
                    // 取消喜欢
                    await kugouUnlikeSong(this.likedPlaylistId, song.hash)
                    // 从 likedSongsHashes 中移除
                    this.likedSongsHashes = this.likedSongsHashes.filter(h => h !== song.hash)
                    useMessageStore().success('已取消喜欢')
                } else {
                    // 添加喜欢
                    await kugouLikeSong(
                        this.likedPlaylistId,
                        song.name || song.songname || '',
                        song.hash,
                        song.album_id || '',
                        song.mixsongid || song.album_audio_id || ''
                    )
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
            try {
                const { kugouPlaylistSongsNew, normalizeKugouSong } = await import('../api/kugou')
                const PAGE_SIZE = 300
                let page = 1
                const allHashes = []
                // 循环加载直到没有更多
                while (true) {
                    const res = await kugouPlaylistSongsNew(this.likedPlaylistId, page, PAGE_SIZE)
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
            const status = res?.status ?? res?.errcode ?? res?.data?.status ?? res?.data?.errcode
            // 酷狗成功状态：status=1 或 errcode=0
            const ok = status === 1 || status === 0
            if (!ok) console.log('[Kugou] API 响应判定失败,完整响应:', JSON.stringify(res).slice(0, 500))
            return ok
        },

        _getKugouError(res) {
            return res?.error_msg || res?.error || res?.msg || res?.data?.error_msg || res?.data?.error || res?.data?.msg || ''
        },

        // 新建歌单 (type=0) / 收藏歌单 (type=1)
        async createPlaylist(name, is_pri = 0) {
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
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid || !song?.hash) {
                useMessageStore().warning('参数不完整')
                return false
            }
            try {
                const data = [
                    song.name || song.songname || '',
                    song.hash,
                    song.album_id || '',
                    song.album_audio_id || song.mixsongid || ''
                ].filter(Boolean).join('|')
                const res = await kugouPlaylistTracksAdd(listid, data)
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

        // 从指定歌单删除歌曲(单首)
        async removeSongFromPlaylist(listid, song) {
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid || !song?.fileid) {
                useMessageStore().warning('参数不完整')
                return false
            }
            try {
                const res = await kugouPlaylistTracksDel(listid, song.fileid)
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
        // songs: 标准化后的歌曲对象数组(需含 fileid 字段)
        async batchRemoveFromPlaylist(listid, songs) {
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listid || !songs?.length) {
                useMessageStore().warning('参数不完整')
                return false
            }
            const fileids = songs.map(s => s.fileid).filter(Boolean)
            if (!fileids.length) {
                useMessageStore().warning('未找到歌曲 fileid')
                return false
            }
            try {
                const res = await kugouPlaylistTracksDel(listid, fileids.join(','))
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
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!songs?.length) return false
            let successCount = 0
            for (const song of songs) {
                try {
                    const ok = await this.toggleLikeSong(song)
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
            if (!this.isLoggedIn) {
                useMessageStore().warning('请先登录酷狗')
                return false
            }
            if (!listids?.length) return false
            let successCount = 0
            for (const listid of listids) {
                try {
                    const res = await kugouPlaylistDel(listid)
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
