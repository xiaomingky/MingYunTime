// QQ 音乐 API 子进程管理 + IPC 桥接
// 通过 spawn 启动 @sansenjian/qq-music-api 子进程(监听 3200 端口)
// 渲染进程通过 window.bridge.invoke('qq:xxx', params) 调用本文件的 IPC 通道
// 本文件内部用 axios 调用 http://localhost:3200/*,规避 CORS
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import axios from 'axios'
import { ipcMain, BrowserWindow, session } from 'electron'

let qqProcess = null
let registered = false
const QQ_API_BASE = 'http://localhost:3200'

// ===== QQ 音乐官网登录(BrowserWindow 扫码) =====
// 为何要走官网:
//   API 二维码登录(qq:qr-create/qr-check)只返回 QQ 网站基础 cookie,
//   缺失 qqmusic_key / qm_keyst 两个 QQ 音乐专用鉴权 token,
//   导致 /getMusicPlay 接口虽返回 200 但 purl 为空 → 提示"暂无播放链接/版权限制"
// 官网登录流程会完整写入 y.qq.com 域下的所有 cookie,包含上述鉴权 token
// 用独立 session 分区隔离官网 cookie,避免污染主窗口
const QQ_LOGIN_PARTITION = 'qq-login'
let loginWin = null

// 从 cookie 数组构造 "k1=v1; k2=v2" 字符串
function buildCookieString(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

// 从 cookie 数组提取 uin(数字 QQ 号 / QQ 音乐用户 ID)
// QQ 音乐 cookie 命名变化:
//   - QQ 登录: uin (明文,形如 "o0123456789")
//   - 微信登录: wxuin (明文数字 ID) / qqmusic_uin
//   - 加密版: euin (base64 编码 + 异或加密)
// 优先取明文 uin;其次 wxuin;最后解码 euin
function extractUin(cookies) {
    // 1. 明文 uin(QQ 登录,优先)
    const uinCookie = cookies.find(c => c.name === 'uin' || c.name === 'qqmusic_uin')
    if (uinCookie?.value) {
        const uin = String(uinCookie.value).replace(/^[oO]/, '').replace(/^0+/, '')
        if (uin && /^\d+$/.test(uin)) return uin
    }
    // 2. wxuin(微信登录,明文数字 ID)
    const wxuinCookie = cookies.find(c => c.name === 'wxuin')
    if (wxuinCookie?.value) {
        const wxuin = String(wxuinCookie.value).replace(/^[oO]/, '').replace(/^0+/, '')
        if (wxuin && /^\d+$/.test(wxuin)) return wxuin
    }
    // 3. 解码 euin(加密 uin)
    const euinCookie = cookies.find(c => c.name === 'euin')
    if (euinCookie?.value) {
        const decoded = decodeEuin(euinCookie.value)
        if (decoded) return decoded
    }
    return ''
}

// 解码 euin(QQ 音乐加密 uin)为明文 QQ 号
// euin 是 base64 编码 + 简单异或加密,解码后能得到明文 QQ 号
// 格式: base64 解码后,第一个字节是版本号,后面 4 字节是大端 QQ 号
// 此处不实现解码(qm_keyst 已足够鉴权),仅在日志中记录
function decodeEuin(euin) {
    try {
        if (!euin) return ''
        const buf = Buffer.from(euin, 'base64')
        if (buf.length < 5) return ''
        // 跳过版本字节(第 0 字节),读取后 4 字节作为 QQ 号(大端)
        const uin = buf.readUInt32BE(1)
        return uin ? String(uin) : ''
    } catch (e) {
        return ''
    }
}

// ===== QQ 音乐接口工具函数 =====
// QQ 音乐 g_tk 算法(hash33,基于 qrsig)
// 绝大多数写操作接口(收藏/创建歌单等)的签名必填
function hash33(s) {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
        hash += (hash << 5) + s.charCodeAt(i)
    }
    return hash & 2147483647
}

// 从 cookie 字符串提取 qrsig 并计算 g_tk
function calcG_tk(cookie) {
    const m = cookie?.match(/qrsig\s*=\s*([^;]+)/)
    return m ? hash33(m[1]) : 0
}

const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 用采集到的 cookie + uin 直接调用上游 QQ API 获取真实昵称和头像
// 接口: https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg
// 关键: uin 必须字符串传递(wxuin 超过 2^53,parseInt 会丢精度导致 code=1000)
// 返回: { nickname, avatarUrl } 或 { nickname:'', avatarUrl:'' }
async function fetchQQUserInfo(cookie, uin) {
    try {
        if (!uin || !cookie) return { nickname: '', avatarUrl: '', isVip: false, vipLevel: 0 }
        const res = await axios.get('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
            params: {
                _: Date.now(),
                cv: 4747474,
                ct: 24,
                format: 'json',
                inCharset: 'utf-8',
                outCharset: 'utf-8',
                notice: 0,
                platform: 'yqq.json',
                needNewCode: 0,
                uin: String(uin),
                g_tk_new_20200303: 0,
                g_tk: 0,
                cid: 205360838,
                userid: String(uin),
                reqfrom: 1,
                reqtype: 0,
                hostUin: 0,
                loginUin: String(uin)
            },
            headers: {
                Referer: `https://y.qq.com/portal/profile.html?uin=${uin}`,
                Cookie: cookie,
                'User-Agent': QQ_UA
            },
            timeout: 8000
        })
        const p = res.data
        if (p?.code !== 0 || !p?.data) {
            console.error('[QQ Web Login] getUserDetail 上游返回非 0:', p?.code, p?.msg || '')
            return { nickname: '', avatarUrl: '', isVip: false, vipLevel: 0 }
        }
        const creator = p.data.creator || p.data.Creator || {}
        const nickname = creator.nick || creator.nickname || creator.Nick || ''
        const avatarUrl = creator.headpic || creator.avatar || creator.pic || creator.avatarUrl || creator.logo || ''
        // VIP 状态:从 lvinfo[] 数组提取(iconurl 含 svip=豪华绿钻 / sui=绿钻 / vip=普通VIP)
        // 微信登录的 creator 顶层没有 is_vip/vipLevel 字段,必须读 lvinfo
        const lvinfoArr = Array.isArray(creator.lvinfo) ? creator.lvinfo : []
        let isVip = false
        let vipLevel = 0
        let vipIcon = ''
        for (const lv of lvinfoArr) {
            const icon = lv?.iconurl || ''
            if (/svip/i.test(icon)) { isVip = true; vipLevel = 2; vipIcon = icon; break }
            if (/sui\d/i.test(icon) || /vip/i.test(icon)) { isVip = true; vipLevel = 1; vipIcon = icon; break }
        }
        console.log(`[QQ Web Login] getUserDetail 用户信息: nickname=${nickname || '(空)'}, avatar=${avatarUrl ? '已获取' : '未获取'}, vip=${isVip}(lv${vipLevel}), lvinfo=${lvinfoArr.length}项, uin=${uin}`)
        return { nickname, avatarUrl, isVip, vipLevel, vipIcon }
    } catch (e) {
        console.error('[QQ Web Login] fetchQQUserInfo error:', e.message)
        return { nickname: '', avatarUrl: '', isVip: false, vipLevel: 0 }
    }
}

// 歌曲详情接口(用于无封面兜底 + VIP 标识)
// 接口: https://c.y.qq.com/v8/fcg-bin/fcg_music_song_detail.fcg
// 传入: songmid(单个或逗号分隔多个)
// 返回上游数据(含 songname/singer/album/mid/albumname/pmid/price 等)
// 字段说明:
//   - data.track_info.mid: songmid
//   - data.track_info.album.mid: 专辑 mid(用于拼 T002 封面)
//   - data.track_info.pay.payplay / paytrackprice: 付费/VIP 标识(1=需 VIP)
// 获取歌曲详情(songmid → songid + albummid)
// 使用 u.y.qq.com/cgi-bin/musicu.fcg 统一网关(只读,低风险,无需 sign)
// 关键格式:用 req_0(不是 req),comm 用 platform:'yqq.json'(不是 ct/cv)
// 返回统一结构: { code:0, data: { track_info: { id, mid, album:{mid,name}, pay, singer } } }
async function fetchQQSongDetail(songmid, cookie) {
    if (!songmid) throw new Error('缺少 songmid 参数')
    const loginUin = (cookie?.match(/(?:^|;\s*)uin\s*=\s*[oO]?(\d+)/)?.[1] || '').replace(/^0+/, '') || 0
    const body = {
        req_0: {
            module: 'music.pf_song_detail_svr',
            method: 'get_song_detail',
            param: { song_mid: String(songmid) }
        },
        comm: { uin: loginUin, platform: 'yqq.json' }
    }
    const res = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', body, {
        headers: {
            'Content-Type': 'application/json',
            Referer: 'https://y.qq.com/',
            Cookie: cookie || '',
            'User-Agent': QQ_UA
        },
        timeout: 8000
    })
    const ti = res.data?.req_0?.data?.track_info
    if (!ti || !ti.id) {
        return { code: -1, message: '未找到歌曲', data: { track_info: null } }
    }
    // 归一化为统一结构
    return {
        code: 0,
        data: {
            track_info: {
                id: ti.id,                  // 数字 songid(评论 topid 用)
                mid: ti.mid || songmid,
                name: ti.name || '',
                singer: ti.singer || [],
                album: {
                    mid: ti.album?.mid || '',
                    name: ti.album?.name || ''
                },
                pay: ti.pay || {},
                interval: ti.interval || 0
            }
        }
    }
}

// 我喜欢歌单收藏/取消收藏(对应线上红心)
// 旧接口 fcg_music_custom_oper_song_of_mylike_songlist.fcg 已废弃(返回 501)
// 改用 u.y.qq.com/cgi-bin/musicu.fcg 统一接口
//   添加: module=music.musicPlaylist.PlaylistAddSong, method=AddSong
//   删除: module=music.musicPlaylist.PlaylistDelSong, method=DelSong
// 参数:
//   cmd: 1=添加(收藏红心), 2=删除(取消红心)
//   songmid: 歌曲 mid
//   songid: 数字歌曲 ID(PlaylistAddSong 需要)
//   cookie: 用户 cookie(含 qm_keyst 鉴权)
//   dissid: "我喜欢"歌单 ID(从 qqUserStore.likedPlaylistId 传入)
// 返回: { code:0 } 成功
async function operMyLikeSonglist(cmd, songmid, cookie, dissid = '', songid = 0) {
    if (!songmid) throw new Error('缺少 songmid')
    if (!cookie) throw new Error('未登录,缺少 cookie')
    if (!dissid) throw new Error('缺少"我喜欢"歌单 ID')
    const isAdd = Number(cmd) === 1
    const module = isAdd ? 'music.musicPlaylist.PlaylistAddSong' : 'music.musicPlaylist.PlaylistDelSong'
    const method = isAdd ? 'AddSong' : 'DelSong'
    // 从 cookie 提取 loginUin
    const loginUin = (cookie.match(/(?:^|;\s*)uin\s*=\s*[oO]?(\d+)/)?.[1] || '').replace(/^0+/, '') || '0'
    const data = {
        comm: { uin: loginUin, format: 'json', ct: 24, cv: 0 },
        req: {
            module,
            method,
            param: {
                disstid: Number(dissid) || dissid,
                song_mid: [String(songmid)],
                song_id: [Number(songid) || 0],
                song_type: [0],
                in_ftype: 0
            }
        }
    }
    const res = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', data, {
        headers: {
            'Content-Type': 'application/json',
            Referer: 'https://y.qq.com/',
            Origin: 'https://y.qq.com',
            Cookie: cookie,
            'User-Agent': QQ_UA
        },
        timeout: 8000
    })
    const ret = res.data?.req
    // 统一返回 { code: 0 } 成功
    if (ret?.code === 0 || ret?.data?.code === 0) {
        return { code: 0 }
    }
    return { code: ret?.code || -1, message: ret?.message || ret?.msg || '操作失败' }
}

// 歌单创建/删除 + 添加歌曲到歌单
// 接口: https://c.y.qq.com/qzone/fcg-bin/fcg_music_custom_oper_songlist.fcg
// 参数:
//   cmd: 'add'=创建歌单, 'del'=删除歌单, 'addsong'=添加歌曲到歌单, 'delsong'=从歌单删除歌曲
//   dissid: 歌单 ID(create 时为 0,其他操作必填)
//   songmids: 添加/删除歌曲时必填
//   name: 创建歌单时必填(歌单名)
// 返回上游数据
async function operSonglist(cmd, params = {}, cookie) {
    if (!cookie) throw new Error('未登录,缺少 cookie')
    const { dissid = 0, songmids, name } = params
    const g_tk = calcG_tk(cookie)
    const body = { cmd }
    if (cmd === 'add') body.name = name || '新建歌单'
    if (cmd === 'del') body.dissid = dissid
    if (cmd === 'addsong' || cmd === 'delsong') {
        body.dissid = dissid
        body.song_mids = Array.isArray(songmids) ? songmids.join(',') : String(songmids || '')
    }
    const res = await axios.post(
        'https://c.y.qq.com/qzone/fcg-bin/fcg_music_custom_oper_songlist.fcg',
        body,
        {
            params: {
                _: Date.now(),
                format: 'json',
                inCharset: 'utf-8',
                outCharset: 'utf-8',
                notice: 0,
                platform: 'yqq.json',
                needNewCode: 0,
                g_tk,
                loginUin: 0,
                hostUin: 0
            },
            headers: {
                'Content-Type': 'application/json',
                Referer: 'https://y.qq.com/',
                Origin: 'https://y.qq.com',
                Cookie: cookie,
                'User-Agent': QQ_UA
            },
            timeout: 8000
        }
    )
    return res.data
}

// 触发打开官网登录窗口
// 返回: { success, cookie, uin, nickname, avatarUrl } 或 { success:false, message }
async function openQQWebLogin(parentWin) {
    // 复用已打开的窗口
    if (loginWin && !loginWin.isDestroyed()) {
        loginWin.focus()
        return { success: false, message: '登录窗口已打开,请在新窗口完成扫码' }
    }

    // 清空旧 session,避免上次未登录态残留
    try {
        const ses = session.fromPartition(QQ_LOGIN_PARTITION)
        await ses.clearStorageData()
        await ses.clearCache()
    } catch (e) { /* ignore */ }

    return new Promise((resolve) => {
        try {
            loginWin = new BrowserWindow({
                width: 1100,
                height: 760,
                parent: parentWin || undefined,
                webPreferences: {
                    partition: QQ_LOGIN_PARTITION,
                    contextIsolation: true,
                    sandbox: false,
                    nodeIntegration: false,
                    preload: undefined
                },
                title: 'QQ 音乐官网登录 - 扫码后请勿关闭窗口'
            })

            let resolved = false
            let pollTimer = null
            let timeoutTimer = null
            const finish = (result) => {
                if (resolved) return
                resolved = true
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
                if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
                try { loginWin?.close() } catch (e) { /* ignore */ }
                loginWin = null
                resolve(result)
            }

            // 登录态检测:获取 session 全部 cookie,查找 QQ 音乐鉴权 token
            // 关键 cookie:
            //   - qm_keyst: QQ 音乐登录态主 token(核心,有它就足够鉴权)
            //   - qqmusic_key: QQ 音乐 API 鉴权 token(辅助)
            //   - uin / qqmusic_uin: 明文 QQ 号(旧版有,新版被 euin 替代)
            //   - euin: 加密 QQ 号(base64 + 异或,可解码得明文)
            //
            // 登录成功条件:仅检测 qm_keyst(新版 QQ 音乐不再写明文 uin,
            //   坚持要求 uin 会导致登录后窗口不关闭)
            // 注意:不能用 ses.cookies.get({ domain: 'y.qq.com' }),
            //   因为 qm_keyst/euin 写在 .qq.com 域,该过滤会漏掉
            // y.qq.com 扫码登录在弹层 iframe 内完成,主页面 URL 不变,
            //   did-navigate/did-navigate-in-page 不会触发,必须主动轮询
            const checkLoginAndCollect = async () => {
                try {
                    const ses = session.fromPartition(QQ_LOGIN_PARTITION)
                    // 拿全部 cookie,手动过滤(避免 domain 过滤漏掉 .qq.com 域 cookie)
                    const allCookies = await ses.cookies.get({})
                    const qqCookies = allCookies.filter(c =>
                        c.domain?.includes('qq.com')
                    )
                    const hasKeyst = qqCookies.some(c => c.name === 'qm_keyst')
                    // 调试日志:便于排查(隐藏敏感值)
                    const cookieNames = qqCookies.map(c => c.name).sort()
                    console.log(`[QQ Web Login] polling: ${qqCookies.length} cookies, hasKeyst=${hasKeyst}, names=${cookieNames.slice(0, 30).join(',')}${cookieNames.length > 30 ? '...' : ''}`)
                    if (hasKeyst) {
                        // 等待 1.5s 让所有 cookie 写入完成(避免漏掉后续写入的 cookie)
                        await new Promise(r => setTimeout(r, 1500))
                        // 重新拉取一遍,确保拿到完整 cookie
                        const finalCookies = await ses.cookies.get({})
                        const finalQqCookies = finalCookies.filter(c =>
                            c.domain?.includes('qq.com')
                        )
                        const cookieStr = buildCookieString(finalQqCookies)
                        // uin 提取:支持 QQ 登录(uin) / 微信登录(wxuin) / 加密(euin)
                        const uin = extractUin(finalQqCookies)

                        // 调用上游 API 获取真实昵称和头像
                        // 接口已验证可用:返回 creator.nick / creator.headpic
                        let { nickname, avatarUrl } = await fetchQQUserInfo(cookieStr, uin)
                        // 兜底:接口失败时显示"已登录",头像留空(前端显示默认占位)
                        if (!nickname) nickname = '已登录'
                        console.log(`[QQ Web Login] 登录成功, uin=${uin || '(空)'}, nickname=${nickname}, avatar=${avatarUrl ? '已获取' : '未获取'}, cookie 数量=${finalQqCookies.length}`)
                        finish({
                            success: true,
                            cookie: cookieStr,
                            uin,
                            nickname,
                            avatarUrl
                        })
                    }
                } catch (e) {
                    console.error('[QQ Web Login] checkLoginAndCollect error:', e)
                }
            }

            // 主动轮询(每 1.5s 检测一次,覆盖 SPA 弹层登录场景)
            pollTimer = setInterval(checkLoginAndCollect, 1500)

            // 5 分钟超时(避免用户离开导致永久挂起)
            timeoutTimer = setTimeout(() => {
                console.warn('[QQ Web Login] 5 分钟超时未登录,自动关闭')
                finish({ success: false, message: '登录超时(5 分钟未完成扫码)' })
            }, 5 * 60 * 1000)

            // 用户关闭窗口但未登录
            loginWin.on('closed', () => {
                loginWin = null
                finish({ success: false, message: '用户关闭了登录窗口' })
            })

            // 加载 QQ 音乐官网个人中心页(未登录会自动跳转/弹出登录框)
            loginWin.loadURL('https://y.qq.com/portal/profile.html').catch(err => {
                console.error('[QQ Web Login] loadURL error:', err.message)
            })
        } catch (e) {
            console.error('[QQ Web Login] openQQWebLogin error:', e)
            resolve({ success: false, message: e?.message || '打开登录窗口失败' })
        }
    })
}

// 获取 qq-music-api 包的入口路径(兼容开发态和打包态)
// 优先使用 .cjs(CommonJS) 版本：Electron 主进程默认按 CommonJS 加载，
// 直接 spawn .js(ESM) 会触发 ERR_REQUIRE_ESM
function resolveQQMusicAppPath() {
    const candidates = [
        // 开发态:项目根 node_modules - 优先 CommonJS 版本
        path.join(process.cwd(), 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.cwd(), 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.js'),
        // 打包态:app.asar 解包后的 node_modules
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.js'),
        // 打包态:直接在 resources 下
        path.join(process.resourcesPath || '', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.resourcesPath || '', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.js')
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch (e) { /* ignore */ }
    }
    return candidates[0]
}

// 启动 QQ 音乐 API 子进程
export function startQQMusicAPI() {
    if (qqProcess) return
    const appPath = resolveQQMusicAppPath()
    try {
        if (!fs.existsSync(appPath)) {
            console.error('[QQ API] app.js not found:', appPath)
            return
        }
    } catch (e) {
        console.error('[QQ API] check app.js error:', e.message)
        return
    }

    // 子进程运行时选择：
    // - 优先用系统 node（v24+ 支持 util.styleText）
    // - @sansenjian/qq-music-api 内部使用了 Node 22.13+ 的 util.styleText API
    // - Electron 22 内置 Node 16 不支持该 API，直接用 process.execPath 启动会报错
    // - 打包态系统 node 可能不存在，此时回退到 Electron execPath
    const systemNode = (() => {
        try {
            const nodePath = execSync('node -e "process.stdout.write(process.execPath)"', { shell: true, encoding: 'utf-8', timeout: 3000 }).trim()
            if (nodePath && fs.existsSync(nodePath)) return nodePath
        } catch (e) { /* ignore */ }
        return null
    })()

    qqProcess = spawn(systemNode || process.execPath, [appPath], {
        env: { ...process.env, PORT: '3200' },
        stdio: 'pipe',
        windowsHide: true
    })

    qqProcess.stdout?.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) console.log('[QQ API]', msg)
    })
    qqProcess.stderr?.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) console.error('[QQ API ERR]', msg)
    })
    qqProcess.on('exit', (code) => {
        console.warn('[QQ API] process exited, code:', code)
        qqProcess = null
        // 异常退出自动重启(5 秒后)
        if (code !== 0 && code !== null) {
            setTimeout(() => startQQMusicAPI(), 5000)
        }
    })
    qqProcess.on('error', (err) => {
        console.error('[QQ API] spawn error:', err.message)
        qqProcess = null
    })

    // 注册 IPC 通道(只注册一次)
    if (!registered) {
        registerQQIpcHandlers()
        registered = true
    }
}

// 停止子进程
export function stopQQMusicAPI() {
    if (qqProcess) {
        try { qqProcess.kill() } catch (e) { /* ignore */ }
        qqProcess = null
    }
}

// 统一请求封装
async function qqGet(endpoint, params = {}, cookie = '') {
    const headers = {}
    if (cookie) headers['X-Custom-Cookie'] = cookie
    const res = await axios.get(`${QQ_API_BASE}${endpoint}`, { params, headers, timeout: 10000 })
    // 统一解包 response 字段：QQ API 所有数据嵌套在 { response: { code, data, ... } } 下
    // 解包后返回 { code, data, ...其他顶层字段(singerList/new_album/category 等) }
    // 登录类 API(qr-create/qr-check)无 response 包裹，原样返回
    const body = res.data
    return body?.response ?? body
}

async function qqPost(endpoint, data = {}, cookie = '') {
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers['X-Custom-Cookie'] = cookie
    const res = await axios.post(`${QQ_API_BASE}${endpoint}`, data, { headers, timeout: 10000 })
    const body = res.data
    return body?.response ?? body
}

// 直接调用上游 QQ API 获取"我喜欢"歌曲
// 两步链路(已用真实 cookie 验证通过):
//   1. GET https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg
//      拿到 mymusic 数组,找 type===1 项(我喜欢),取其 id 作为 dissid
//      注意: uin 必须字符串传递(wxuin 超过 2^53,parseInt 会丢精度导致 code=1000)
//   2. GET https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg
//      传 disstid=上一步拿到的 dissid,返回 cdlist[0].songlist 为歌曲数组
//      歌曲字段: mid(songmid), name(歌名), id(数字ID), singer(歌手数组)
// 为何绕过子进程 /user/getUserLikedSongs:
//   子进程服务内部 getUserLikedSongs 直接读全局 cookie(getUserInfo().cookie),
//   完全忽略 X-Custom-Cookie header;且 /user/setCookie 接口实现有 bug(只读不写),
//   无法把用户 cookie 写入全局。直接复制子进程逻辑,用用户传入的 cookie 调用上游。
// 返回结构与子进程保持一致: { code, data: { songs, total, hasMore, info? } }
async function fetchLikedSongsDirect(uin, cookie, offset = 0, limit = 100) {
    if (!uin) throw new Error('缺少 uin 参数')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    const uinStr = String(uin)

    // 步骤 1: 拿 mymusic 列表,提取"我喜欢"歌单的 dissid
    const profileRes = await axios.get('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
        params: {
            _: Date.now(),
            cv: 4747474, ct: 24, format: 'json',
            inCharset: 'utf-8', outCharset: 'utf-8',
            notice: 0, platform: 'yqq.json', needNewCode: 0,
            uin: uinStr, g_tk_new_20200303: 0, g_tk: 0,
            cid: 205360838, userid: uinStr,
            reqfrom: 1, reqtype: 0, hostUin: 0, loginUin: uinStr
        },
        headers: {
            Referer: `https://y.qq.com/portal/profile.html?uin=${uinStr}`,
            Cookie: cookie || '',
            'User-Agent': UA
        },
        timeout: 10000
    })
    const profile = profileRes.data
    if (!profile || typeof profile !== 'object') {
        throw new Error('用户主页响应格式无效')
    }
    if (typeof profile.code === 'number' && profile.code !== 0) {
        throw new Error(profile.msg || profile.message || '获取用户主页失败')
    }
    const mymusic = profile?.data?.mymusic
    let likedInfo = null
    if (Array.isArray(mymusic)) {
        // type===1 表示"我喜欢"歌单
        likedInfo = mymusic.find(item => item?.type === 1 || (item?.title && item.title.includes('喜欢')))
    }
    if (!likedInfo || !likedInfo.id) {
        // 没有我喜欢歌单,返回空
        return { code: 0, data: { songs: [], total: 0, hasMore: false } }
    }
    const dissid = likedInfo.id

    // 步骤 2: 用 dissid 拿歌单详情(含歌曲列表)
    const cdRes = await axios.get('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
        params: {
            type: 1, json: 1, utf8: 1, onlysong: 0, new_format: 1,
            disstid: dissid,
            format: 'json', outCharset: 'utf-8',
            g_tk: 0, loginUin: uinStr, hostUin: 0,
            inCharset: 'utf-8', notice: 0,
            platform: 'yqq.json', needNewCode: 0
        },
        headers: {
            Referer: 'https://y.qq.com/portal/player.html',
            Cookie: cookie || '',
            'User-Agent': UA
        },
        timeout: 10000
    })
    const cdPayload = cdRes.data
    if (!cdPayload || typeof cdPayload !== 'object') {
        throw new Error('歌单详情响应格式无效')
    }
    if (typeof cdPayload.code === 'number' && cdPayload.code !== 0) {
        throw new Error(cdPayload.msg || cdPayload.message || '获取歌单详情失败')
    }
    const cd = cdPayload?.cdlist?.[0]
    const songs = cd?.songlist || []
    return {
        code: 0,
        data: {
            songs,
            total: cd?.total_song_num || songs.length,
            hasMore: false,
            info: {
                title: likedInfo.title,
                songCount: likedInfo.num0 || songs.length,
                id: dissid,
                cover: cd?.picurl || cd?.logo || ''
            }
        }
    }
}

// 直接调用上游 QQ API 获取用户歌单列表
// 绕过子进程 /user/getUserPlaylists(其内部用全局 cookie,忽略 X-Custom-Cookie)
// 复用 fetchLikedSongsDirect 第一步的 profile homepage 接口,提取 mymusic 数组
// 返回: { code:0, data: { playlists: [...] } }
async function fetchUserPlaylistsDirect(uin, cookie, offset = 0, limit = 30) {
    if (!uin) throw new Error('缺少 uin 参数')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    const uinStr = String(uin)
    const profileRes = await axios.get('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
        params: {
            _: Date.now(),
            cv: 4747474, ct: 24, format: 'json',
            inCharset: 'utf-8', outCharset: 'utf-8',
            notice: 0, platform: 'yqq.json', needNewCode: 0,
            uin: uinStr, g_tk_new_20200303: 0, g_tk: 0,
            cid: 205360838, userid: uinStr,
            reqfrom: 1, reqtype: 0, hostUin: 0, loginUin: uinStr
        },
        headers: {
            Referer: `https://y.qq.com/portal/profile.html?uin=${uinStr}`,
            Cookie: cookie || '',
            'User-Agent': UA
        },
        timeout: 10000
    })
    const profile = profileRes.data
    if (!profile || typeof profile !== 'object') throw new Error('用户主页响应格式无效')
    if (typeof profile.code === 'number' && profile.code !== 0) {
        throw new Error(profile.msg || profile.message || '获取用户主页失败')
    }
    const mymusic = profile?.data?.mymusic || []
    // mymusic 项字段: id(dissid), title, type(1=我喜欢), num0(歌曲数), picurl
    const playlists = mymusic.map(item => ({
        dissid: item.id || '',
        diss_name: item.title || item.name || '',
        picurl: item.picurl || item.pic || '',
        song_count: item.num0 || 0,
        type: item.type || 0,
        listennum: item.listennum || 0
    })).filter(p => p.dissid)
    return { code: 0, data: { playlists } }
}

// 直接调用上游 QQ API 获取歌曲评论
// 接口: https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg
// 关键: topid 必须是数字 songid(不是 songmid!)
//   songid 已在 normalizeQQSong 中从搜索/歌单/排行榜结果提取,直接使用,无需转换
// 参数:
//   songid: 数字歌曲 ID(从歌曲对象 songid 字段传入)
//   cmd: 6=热评, 8=最新评论
//   pagenum: 页码(从 0 开始)
//   pagesize: 单页条数
//   lasthotcommentid: 分页游标(上一页最后一条评论 ID)
//   cookie: 用户 cookie(带 cookie 才能读取 ispraise 状态)
// 返回归一化评论结构(与网易云评论格式兼容):
//   { code:0, data: { comments:[{commentId,user:{avatarUrl,nickname},content,time,likedCount,liked,beReplied}], total, hasMore } }
async function fetchQQCommentsDirect(songid, cmd = 8, pagenum = 0, pagesize = 20, lasthotcommentid = '', cookie = '') {
    if (!songid) throw new Error('缺少 songid(歌曲对象未包含 songid 字段,无法获取评论)')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537'

    const g_tk = calcG_tk(cookie)
    const loginUin = (cookie?.match(/(?:^|;\s*)uin\s*=\s*[oO]?(\d+)/)?.[1] || '').replace(/^0+/, '') || 0
    const res = await axios.get('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
        params: {
            _: Date.now(),
            biztype: 1,          // 1=歌曲
            topid: songid,       // 数字 songid(非 songmid!)
            cmd,                 // 6=热评, 8=最新
            pagenum,
            pagesize,
            lasthotcommentid: lasthotcommentid || '',
            format: 'json',
            inCharset: 'utf-8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 0,
            g_tk,
            loginUin,
            hostUin: 0
        },
        headers: {
            Referer: 'https://y.qq.com/',
            Cookie: cookie || '',
            'User-Agent': UA
        },
        timeout: 10000
    })
    const commentData = res.data?.comment || {}
    const rawList = commentData.commentlist || []
    // 归一化为网易云兼容格式
    const comments = rawList.map(c => {
        const reply = c.replyedcomment
        return {
            commentId: c.commentid || '',
            content: c.rootcommentcontent || c.middlecommentcontent || '',
            time: (c.time || 0) * 1000,  // QQ 时间戳是秒,转毫秒
            likedCount: c.praisenum || 0,
            liked: !!c.ispraise,
            user: {
                avatarUrl: c.avatarurl || '',
                nickname: c.nick || '匿名用户',
                userId: c.encrypt_uin || c.uin || ''
            },
            beReplied: reply && reply.nick ? [{
                user: {
                    avatarUrl: reply.avatarurl || '',
                    nickname: reply.nick || ''
                },
                content: reply.middlecommentcontent || reply.rootcommentcontent || ''
            }] : null
        }
    })
    return {
        code: 0,
        data: {
            comments,
            total: commentData.commenttotal || 0,
            hasMore: comments.length >= pagesize,
            lasthotcommentid: rawList.length ? (rawList[rawList.length - 1].commentid || '') : ''
        }
    }
}

// 注册全部 35 个 IPC 通道
function registerQQIpcHandlers() {
    // ========== 官网登录(替代 API 二维码登录) ==========
    // 打开 y.qq.com 官网登录页,扫码后采集完整 cookie(含 qqmusic_key/qm_keyst)
    ipcMain.handle('qq:web-login', async () => {
        try {
            // 获取当前主窗口作为父窗口(便于焦点管理与遮罩)
            const { BrowserWindow: BW } = require('electron')
            const parentWin = BW.getFocusedWindow() || (BW.getAllWindows()[0] || null)
            return await openQQWebLogin(parentWin)
        } catch (e) {
            console.error('[QQ Web Login] IPC error:', e)
            return { success: false, message: e?.message || 'QQ 官网登录异常' }
        }
    })

    // ========== 搜索类(3) ==========
    ipcMain.handle('qq:search', async (_, params) => {
        return qqGet('/getSearchByKey', { key: params.key, limit: params.limit || 30, page: params.page || 1, catZhida: params.catZhida ?? 1 }, params.cookie)
    })
    ipcMain.handle('qq:smartbox', async (_, params) => {
        return qqGet('/getSmartbox', { key: params.key }, params.cookie)
    })
    ipcMain.handle('qq:hotkey', async (_, params) => {
        return qqGet('/getHotkey', {}, params.cookie)
    })

    // ========== 音乐类(5) ==========
    ipcMain.handle('qq:song-info', async (_, params) => {
        return qqGet('/getSongInfo', { songmid: params.songmid }, params.cookie)
    })
    ipcMain.handle('qq:song-play', async (_, params) => {
        return qqGet('/getMusicPlay', { songmid: params.songmid, quality: params.quality || '128' }, params.cookie)
    })
    ipcMain.handle('qq:lyric', async (_, params) => {
        return qqGet('/getLyric', { songmid: params.songmid, isFormat: params.isFormat ?? 1 }, params.cookie)
    })
    ipcMain.handle('qq:album-info', async (_, params) => {
        return qqGet('/getAlbumInfo', { albummid: params.albummid }, params.cookie)
    })
    ipcMain.handle('qq:batch-song-info', async (_, params) => {
        return qqPost('/batchGetSongInfo', { songs: params.songs || [] }, params.cookie)
    })

    // ========== 歌手类(7) ==========
    ipcMain.handle('qq:singer-list', async (_, params) => {
        // QQ API "全部"标签 id 为 -100（非 -1），-1 会返回空列表
        return qqGet('/getSingerList', { area: params.area ?? -100, sex: params.sex ?? -100, genre: params.genre ?? -100, page: params.page || 1, limit: params.limit || 20 }, params.cookie)
    })
    ipcMain.handle('qq:singer-desc', async (_, params) => {
        return qqGet('/getSingerDesc', { singermid: params.singermid }, params.cookie)
    })
    ipcMain.handle('qq:singer-hotsong', async (_, params) => {
        return qqGet('/getSingerHotsong', { singermid: params.singermid, limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:singer-album', async (_, params) => {
        return qqGet('/getSingerAlbum', { singermid: params.singermid, limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:singer-mv', async (_, params) => {
        return qqGet('/getSingerMv', { singermid: params.singermid, limit: params.limit || 20, order: params.order || 'time' }, params.cookie)
    })
    ipcMain.handle('qq:similar-singer', async (_, params) => {
        return qqGet('/getSimilarSinger', { singermid: params.singermid }, params.cookie)
    })
    ipcMain.handle('qq:singer-star-num', async (_, params) => {
        return qqGet('/getSingerStarNum', { singermid: params.singermid }, params.cookie)
    })

    // ========== 歌单类(5) ==========
    ipcMain.handle('qq:playlist-categories', async (_, params) => {
        return qqGet('/getSongListCategories', {}, params.cookie)
    })
    ipcMain.handle('qq:playlist-list', async (_, params) => {
        return qqGet('/getSongLists', { categoryId: params.categoryId, sortId: params.sortId || 5, limit: params.limit || 19, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:playlist-detail', async (_, params) => {
        return qqGet('/getSongListDetail', { disstid: params.disstid }, params.cookie)
    })
    ipcMain.handle('qq:batch-playlists', async (_, params) => {
        return qqPost('/batchGetSongLists', { categoryIds: params.categoryIds || [10000000], page: params.page || 0, limit: params.limit || 19, sortId: params.sortId || 5 }, params.cookie)
    })
    ipcMain.handle('qq:new-disks', async (_, params) => {
        return qqGet('/getNewDisks', { limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })

    // ========== 排行榜类(2) ==========
    ipcMain.handle('qq:ranks', async (_, params) => {
        return qqGet('/getRanks', { topId: params.topId, limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:top-lists', async (_, params) => {
        return qqGet('/getTopLists', {}, params.cookie)
    })

    // ========== 评论类(1) ==========
    // QQ 评论接口需要 topid(数字 ID),cmd=8
    // QQ 评论接口
    // 直接调用上游 fcg_global_comment_h5.fcg
    // 参数: { songmid, songid(可选,缺失时自动调 song-detail 补全), cmd, pagenum, pagesize, lasthotcommentid, cookie }
    ipcMain.handle('qq:comments', async (_, params) => {
        try {
            let songid = params.songid
            // songid 缺失时,通过 songmid 调 song-detail 接口补全
            if (!songid && params.songmid) {
                const detail = await fetchQQSongDetail(params.songmid, params.cookie)
                songid = detail?.data?.track_info?.id || 0
            }
            return await fetchQQCommentsDirect(
                songid,
                params.cmd || 8,
                params.pagenum || 0,
                params.pagesize || 20,
                params.lasthotcommentid || '',
                params.cookie
            )
        } catch (e) {
            console.error('[QQ comments] failed:', e?.message || e)
            return { code: -1, message: e?.message || '获取评论失败' }
        }
    })

    // ========== 用户类(4) ==========
    ipcMain.handle('qq:user-playlists', async (_, params) => {
        // 绕过子进程 /user/getUserPlaylists(其内部用全局 cookie,忽略 X-Custom-Cookie)
        try {
            return await fetchUserPlaylistsDirect(params.uin, params.cookie, params.offset || 0, params.limit || 30)
        } catch (e) {
            console.error('[QQ user-playlists] direct fetch failed:', e?.message || e)
            return { code: -1, message: e?.message || '获取歌单列表失败' }
        }
    })
    ipcMain.handle('qq:user-liked-songs', async (_, params) => {
        // 绕过子进程 /user/getUserLikedSongs(其内部用全局 cookie,忽略 X-Custom-Cookie)
        // 直接调用上游 c6.y.qq.com,使用用户传入的 cookie
        try {
            return await fetchLikedSongsDirect(params.uin, params.cookie, params.offset || 0, params.limit || 100)
        } catch (e) {
            console.error('[QQ user-liked-songs] direct fetch failed:', e?.message || e)
            // 回退到子进程 API(可能仍会 502,但保留以兼容)
            return qqGet('/user/getUserLikedSongs', { uin: params.uin, offset: params.offset || 0, limit: params.limit || 100 }, params.cookie)
        }
    })
    ipcMain.handle('qq:user-detail', async (_, params) => {
        // 绕过子进程 /user/getUserDetail(其内部用全局 cookie,忽略 X-Custom-Cookie)
        // 直接调用上游 c6.y.qq.com,使用用户传入的 cookie
        try {
            const { nickname, avatarUrl, isVip, vipLevel, vipIcon } = await fetchQQUserInfo(params.cookie, params.uin)
            return { code: 0, data: { nickname, avatarUrl, isVip, vipLevel, vipIcon, uin: params.uin } }
        } catch (e) {
            console.error('[QQ user-detail] fetchQQUserInfo failed:', e?.message || e)
            return { code: -1, message: e?.message || '获取用户信息失败' }
        }
    })
    // 歌曲详情(用于无封面兜底 + VIP 标识)
    // 调用方:前端 normalizeQQSong 在 albummid 为空时调用
    ipcMain.handle('qq:song-detail', async (_, params) => {
        try {
            return await fetchQQSongDetail(params.songmid, params.cookie)
        } catch (e) {
            console.error('[QQ song-detail] failed:', e?.message || e)
            return { code: -1, message: e?.message || '获取歌曲详情失败' }
        }
    })
    // 我喜欢红心操作(cmd=1 收藏 / cmd=2 取消收藏)
    // 需要 dissid(我喜欢歌单 ID),由前端从 qqUserStore.likedPlaylistId 传入
    // 需要 songid(数字歌曲 ID),从歌曲对象 songid 字段传入
    ipcMain.handle('qq:oper-mylike', async (_, params) => {
        try {
            return await operMyLikeSonglist(params.cmd, params.songmid, params.cookie, params.dissid, params.songid)
        } catch (e) {
            console.error('[QQ oper-mylike] failed:', e?.message || e)
            return { code: -1, message: e?.message || '红心操作失败' }
        }
    })
    // 歌单操作(cmd=add 创建 / del 删除 / addsong 添加歌曲 / delsong 删除歌曲)
    ipcMain.handle('qq:oper-songlist', async (_, params) => {
        try {
            return await operSonglist(params.cmd, {
                dissid: params.dissid,
                songmids: params.songmid,
                name: params.name
            }, params.cookie)
        } catch (e) {
            console.error('[QQ oper-songlist] failed:', e?.message || e)
            return { code: -1, message: e?.message || '歌单操作失败' }
        }
    })
    ipcMain.handle('qq:user-avatar', async (_, params) => {
        return qqGet('/user/getUserAvatar', { uin: params.uin, size: params.size || 140 }, params.cookie)
    })
    ipcMain.handle('qq:qr-create', async (_, params) => {
        return qqGet('/user/getQQLoginQr', {}, params.cookie)
    })
    ipcMain.handle('qq:qr-check', async (_, params) => {
        return qqPost('/user/checkQQLoginQr', { qrsig: params.qrsig, ptqrtoken: params.ptqrtoken }, params.cookie)
    })

    // ========== 其他类(8) ==========
    ipcMain.handle('qq:mv-list', async (_, params) => {
        return qqGet('/getMv', { area_id: params.area_id ?? 15, version_id: params.version_id ?? 7, limit: params.limit || 20, page: params.page || 0 }, params.cookie)
    })
    ipcMain.handle('qq:mv-play', async (_, params) => {
        return qqGet('/getMvPlay', { vid: params.vid }, params.cookie)
    })
    ipcMain.handle('qq:mv-by-tag', async (_, params) => {
        return qqGet('/getMvByTag', { tag: params.tag, limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:image-url', async (_, params) => {
        return qqGet('/getImageUrl', { id: params.id, size: params.size || '300x300', maxAge: params.maxAge || 2592000 }, params.cookie)
    })
    ipcMain.handle('qq:digital-albums', async (_, params) => {
        return qqGet('/getDigitalAlbumLists', { limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })
    ipcMain.handle('qq:download', async (_, params) => {
        return qqGet('/downloadQQMusic', { songmid: params.songmid, quality: params.quality || '128' }, params.cookie)
    })
    ipcMain.handle('qq:radio-lists', async (_, params) => {
        return qqGet('/getRadioLists', {}, params.cookie)
    })
    ipcMain.handle('qq:recommend', async (_, params) => {
        return qqGet('/getRecommend', {}, params.cookie)
    })
    ipcMain.handle('qq:ticket-info', async (_, params) => {
        return qqGet('/getTicketInfo', {}, params.cookie)
    })
}
