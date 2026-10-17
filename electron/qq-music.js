// QQ 音乐 API 子进程管理 + IPC 桥接
// 通过 spawn 启动 @sansenjian/qq-music-api 子进程(监听 3200 端口)
// 渲染进程通过 window.bridge.invoke('qq:xxx', params) 调用本文件的 IPC 通道
// 本文件内部用 axios 调用 http://localhost:3200/*,规避 CORS
import { spawn } from 'node:child_process'
import { createServiceLifecycle } from './service-lifecycle.js'
import { QQClient } from './qq-client.js'
import { QQSession } from './qq-session.js'
import { QQNativeLogin } from './qq-native-login.js'
import { QQInlineQR } from './qq-inline-qr.js'
import { QQBenefits, qqBenefitsErrorMessage } from './qq-benefits.js'
import { getQQLyric } from './lyric-providers.js'
import { qqAccountId, qqCookieValue, qqGtk, qqPage, qqMembershipFromIcons } from './qq-account.js'
import { apiRuntimePath } from './local-service.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import axios from 'axios'
import { ipcMain, BrowserWindow, session, app, safeStorage, shell } from 'electron'
// Node16 兼容探测/就绪等待/日志/广播
import { httpProbe, waitForPort, pipeChildLogs, broadcastServicesReady, serviceLog } from './local-service.js'

let registered = false
const QQ_API_BASE = 'http://localhost:3200'
const qqClient = new QQClient({ wordLyrics: track => getQQLyric(track.id, track.name,
    (track.singer || []).map(singer => singer.name).join('、'), track.album?.name || '', track.interval) })

// ===== QQ 音乐官网登录(BrowserWindow 扫码) =====
// 为何要走官网:
//   API 二维码登录(qq:qr-create/qr-check)只返回 QQ 网站基础 cookie,
//   缺失 qqmusic_key / qm_keyst 两个 QQ 音乐专用鉴权 token,
//   导致 /getMusicPlay 接口虽返回 200 但 purl 为空 → 提示"暂无播放链接/版权限制"
// 官网登录流程会完整写入 y.qq.com 域下的所有 cookie,包含上述鉴权 token
// 用独立 session 分区隔离官网 cookie,避免污染主窗口
const QQ_LOGIN_PARTITION = 'qq-login'
let loginWin = null
let loginOpening = false
let benefitsWin = null, benefitsOpening = false
let accountSession
const nativeLogin = new QQNativeLogin({client:qqClient})
const inlineQR = new QQInlineQR()
function trustedAppSender(event) {
    try {
        const frame = event.senderFrame || event.sender?.mainFrame
        if (!frame || frame !== event.sender.mainFrame) return false
        const url = new URL(frame.url)
        if (url.protocol === 'file:') return path.resolve(fileURLToPath(url)).toLowerCase() === path.join(process.env.APP_ROOT || app.getAppPath(), 'dist', 'index.html').toLowerCase()
        const dev = process.env.VITE_DEV_SERVER_URL && new URL(process.env.VITE_DEV_SERVER_URL)
        return !app.isPackaged && !!dev && url.origin === dev.origin
    } catch { return false }
}

// 从 cookie 数组构造 "k1=v1; k2=v2" 字符串
function buildCookieString(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

function calcG_tk(cookie) { return qqGtk(cookie) }

const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Account profile pages can be public. Validate credentials against the current
// login endpoint before treating profile data as a signed-in session.
async function validateQQLogin(cookie, suppliedUin = '') {
    if (!qqCookieValue(cookie, 'qm_keyst') && !qqCookieValue(cookie, 'qqmusic_key')) throw new Error('Cookie 缺少 QQ 音乐登录凭据')
    const requested = qqAccountId(cookie) || (/^\d+$/.test(String(suppliedUin)) ? String(suppliedUin) : '')
    const res = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        comm: { uin: requested || '0', ct: 24, cv: 0 },
        req: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} }
    }, { headers: { Referer: 'https://y.qq.com/', Cookie: cookie, 'User-Agent': QQ_UA }, timeout: 8000 })
    if (res.data?.code !== 0 || res.data?.req?.code !== 0 || !res.data.req.data) throw new Error('QQ 音乐未确认有效登录，请重新扫码或更新完整 Cookie')
    const info = res.data.req.data.userInfo || res.data.req.data.userinfo || res.data.req.data
    const raw = info.uin ?? info.musicUin ?? info.music_uin ?? ''
    // Reject unsafe numeric identities rather than silently rounding WeChat IDs.
    const confirmed = typeof raw === 'number' && !Number.isSafeInteger(raw) ? '' : String(raw)
    const uin = /^\d+$/.test(confirmed) && confirmed !== '0' ? confirmed : requested
    if (!uin) throw new Error('官网未返回可识别的账号 ID，请使用 QQ 登录或包含 uin/wxuin 的完整 Cookie')
    if (requested && confirmed && /^\d+$/.test(confirmed) && requested !== confirmed) throw new Error('Cookie 的账号与登录身份不一致，请重新登录')
    const profile = await fetchQQUserInfo(cookie, uin, true)
    return { ...profile, userId: uin, uin }
}

// 用采集到的 cookie + uin 直接调用上游 QQ API 获取真实昵称和头像
// 接口: https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg
// 关键: uin 必须字符串传递(wxuin 超过 2^53,parseInt 会丢精度导致 code=1000)
// 返回: { nickname, avatarUrl } 或 { nickname:'', avatarUrl:'' }
async function fetchQQUserInfo(cookie, uin, strict = false) {
    try {
        if (!uin || !cookie) throw new Error('无法识别 QQ 音乐账号，请复制完整 Cookie 或重新登录')
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
                g_tk_new_20200303: calcG_tk(cookie),
                g_tk: calcG_tk(cookie),
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
            throw new Error(p?.msg || p?.message || 'QQ 音乐登录已失效，请重新登录')
        }
        const creator = p.data.creator || p.data.Creator || {}
        const nickname = creator.nick || creator.nickname || creator.Nick || ''
        const avatarUrl = creator.headpic || creator.avatar || creator.pic || creator.avatarUrl || creator.logo || ''
        // VIP 状态:从 lvinfo[] 数组提取(iconurl 含 svip=豪华绿钻 / sui=绿钻 / vip=普通VIP)
        // 微信登录的 creator 顶层没有 is_vip/vipLevel 字段,必须读 lvinfo
        const { isVip, vipLevel, vipIcon } = qqMembershipFromIcons(creator.lvinfo)
        return { nickname, avatarUrl, isVip, vipLevel, vipIcon }
    } catch (e) {
        if (strict) throw e
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
    const loginUin = qqAccountId(cookie) || '0'
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

// 官方 APK newfolderprotocol/r.java 与官网统一使用 PlaylistDetailWrite。
// 外部传入的是 disstid，写入前解析账号目录 dirId；歌曲 ID/类型由详情确认。
async function operMyLikeSonglist(cmd, songmid, cookie, dissid = '', songid = 0) {
    if (![1, 2].includes(Number(cmd))) throw new Error('无效的 QQ 收藏操作')
    if (!songmid && !songid) throw new Error('缺少 QQ 歌曲 ID')
    return qqClient.mutatePlaylistSongs(dissid, [songmid || songid], cookie, Number(cmd) === 2)
}

// 歌单创建/删除 + 添加歌曲到歌单
// 官方 PlaylistBaseWrite / PlaylistDetailWrite RPC
// 参数:
//   cmd: 'add'=创建歌单, 'del'=删除歌单, 'addsong'=添加歌曲到歌单, 'delsong'=从歌单删除歌曲
//   dissid: 歌单 ID(create 时为 0,其他操作必填)
//   songmids: 添加/删除歌曲时必填
//   name: 创建歌单时必填(歌单名)
// 返回上游数据
async function operSonglist(cmd, params = {}, cookie) {
    if (!cookie) throw new Error('未登录,缺少 cookie')
    const { dissid = 0, songmids, name } = params
    if (cmd === 'addsong' || cmd === 'delsong') {
        const mids = Array.isArray(songmids) ? songmids : String(songmids || '').split(',')
        if (!dissid || !mids.length || mids.some(mid => !mid)) throw new Error('缺少歌单或歌曲 ID')
        return qqClient.mutatePlaylistSongs(dissid, mids, cookie, cmd === 'delsong')
    }
    if (cmd === 'add') {
        const data = await qqClient.createPlaylist(name || '新建歌单', cookie)
        return { code: 0, data: data?.result ?? data }
    }
    if (cmd === 'del') {
        const lists = await qqClient.userPlaylists(qqAccountId(cookie), cookie, 'created')
        const playlist = lists.find(item => String(item.dissid) === String(dissid))
        if (!playlist?.directoryId || Number(playlist.directoryId) === 201) throw new Error('不能删除此歌单，请刷新后重试')
        const data = await qqClient.deletePlaylist(playlist.directoryId, cookie)
        return { code: 0, data: data?.result ?? data }
    }
    throw new Error('不支持的 QQ 歌单操作')
}

// 触发打开官网登录窗口
// 返回: { success, cookie, uin, nickname, avatarUrl } 或 { success:false, message }
async function openQQWebLogin(parentWin, mode = 'qq') {
    // 复用已打开的窗口
    if (loginWin && !loginWin.isDestroyed()) {
        loginWin.focus()
        return { success: false, message: '登录窗口已打开,请在新窗口完成扫码' }
    }
    if (loginOpening) return { success: false, message: '登录窗口正在打开，请稍候' }
    loginOpening = true

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
                    sandbox: true,
                    nodeIntegration: false,
                    preload: undefined
                },
                title: `QQ 音乐官方${mode === 'wechat' ? '微信' : mode === 'password' ? '密码' : 'QQ'}登录`
            })
            loginOpening = false

            let resolved = false
            let pollTimer = null
            let timeoutTimer = null
            let pageTimer = null
            let checking = false
            let identityAttempts = 0
            const finish = (result) => {
                if (resolved) return
                resolved = true
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
                if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
                if (pageTimer) { clearInterval(pageTimer); pageTimer = null }
                try { loginWin?.close() } catch (e) { /* ignore */ }
                loginWin = null
                resolve(result)
            }

            // 登录态检测:获取 session 全部 cookie,查找 QQ 音乐鉴权 token
            // 关键 cookie:
            //   - qm_keyst: QQ 音乐登录态主 token(核心,有它就足够鉴权)
            //   - qqmusic_key: QQ 音乐 API 鉴权 token(辅助)
            //   - uin / qqmusic_uin: 明文 QQ 号(旧版有,新版被 euin 替代)
            // euin 是不透明身份值，不从它猜测明文账号。
            // 检测到音乐凭据后，还必须识别账号并取得其资料。
            // 注意:不能用 ses.cookies.get({ domain: 'y.qq.com' }),
            //   因为 qm_keyst/euin 写在 .qq.com 域,该过滤会漏掉
            // y.qq.com 扫码登录在弹层 iframe 内完成,主页面 URL 不变,
            //   did-navigate/did-navigate-in-page 不会触发,必须主动轮询
            const checkLoginAndCollect = async () => {
                if (resolved || checking) return
                checking = true
                try {
                    const ses = session.fromPartition(QQ_LOGIN_PARTITION)
                    // 拿全部 cookie,手动过滤(避免 domain 过滤漏掉 .qq.com 域 cookie)
                    const allCookies = await ses.cookies.get({})
                    const qqCookies = allCookies.filter(c =>
                        c.domain === 'qq.com' || c.domain?.endsWith('.qq.com')
                    )
                    const hasKeyst = qqCookies.some(c => ['qm_keyst', 'qqmusic_key'].includes(c.name) && c.value)
                    if (hasKeyst) {
                        // 等待 1.5s 让所有 cookie 写入完成(避免漏掉后续写入的 cookie)
                        await new Promise(r => setTimeout(r, 1500))
                        // 重新拉取一遍,确保拿到完整 cookie
                        const finalCookies = await ses.cookies.get({})
                        const finalQqCookies = finalCookies.filter(c =>
                            c.domain === 'qq.com' || c.domain?.endsWith('.qq.com')
                        )
                        const cookieStr = buildCookieString(finalQqCookies)
                        // uin 提取:支持 QQ 登录(uin) / 微信登录(wxuin) / 加密(euin)
                        if (resolved) return
                        const { uin, avatarUrl, nickname: accountName } = await validateQQLogin(cookieStr)
                        let nickname = accountName
                        if (!nickname) nickname = '已登录'
                        finish({
                            success: true,
                            cookie: cookieStr,
                            uin,
                            nickname,
                            avatarUrl
                        })
                    }
                } catch (e) {
                    console.error('[QQ Web Login] checkLoginAndCollect error:', e.message)
                    if (++identityAttempts >= 5) finish({ success: false, message: e.message || 'QQ 音乐登录验证失败，请重试' })
                } finally { checking = false }
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

            // The current profile page redirects to /n/ryqq/profile but does
            // not open the login dialog automatically. Click its visible
            // official login control after the SPA has rendered. Never build
            // our own QQ QR URL: the official dialog owns QQ/WeChat switching.
            let pageAttempts = 0, openingDialog = false, dialogOpened = false
            pageTimer = setInterval(async () => {
                if (resolved || openingDialog || !loginWin || loginWin.isDestroyed()) return
                if (++pageAttempts > 45) { finish({ success: false, message: '官方登录方式未能加载，请检查网络后重试' }); return }
                openingDialog = true
                try {
                    const url = new URL(loginWin.webContents.getURL())
                    if (url.hostname !== 'y.qq.com') return
                    if (!dialogOpened) dialogOpened = await loginWin.webContents.executeJavaScript(`(() => {
                        const button = [...document.querySelectorAll('a,button')].find(element =>
                            /^(立即登录|登录)$/.test(element.textContent.trim()) && element.getClientRects().length)
                        if (!button) return false
                        button.click()
                        return true
                    })()`, true)
                    if (!dialogOpened) return
                    let ready = false
                    if (mode === 'wechat') {
                        ready = await loginWin.webContents.executeJavaScript(`(() => {
                            const tab = [...document.querySelectorAll('a,button')].find(e => e.textContent.trim() === '微信登录' && e.getClientRects().length)
                            if (!tab) return false
                            tab.click(); return true
                        })()`, true)
                    } else {
                        for (const frame of loginWin.webContents.mainFrame.framesInSubtree) {
                            if (!/^https:\/\/xui\.ptlogin2\.qq\.com\//.test(frame.url)) continue
                            ready = await frame.executeJavaScript(`(() => {
                                ${mode === 'password' ? "const control = [...document.querySelectorAll('a,button')].find(e => /^(密码登录|帐号密码登录|账号密码登录)$/.test(e.textContent.trim()) && e.getClientRects().length); if (control) { control.click(); return true }; return [...document.querySelectorAll('input[type=password]')].some(e => e.getClientRects().length)" : "return !!document.querySelector('#qrlogin_img')"}
                            })()`, true)
                            if (ready) break
                        }
                    }
                    if (ready && pageTimer) { clearInterval(pageTimer); pageTimer = null }
                } catch { /* The redirect or SPA can still be loading. */ }
                finally { openingDialog = false }
            }, 800)

            // Load the official profile page, then open its official dialog.
            loginWin.loadURL('https://y.qq.com/portal/profile.html').catch(err => {
                finish({ success: false, message: 'QQ 音乐登录页加载失败，请检查网络后重试' })
            })
        } catch (e) {
            loginOpening = false
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
        // 打包态(优先):extraResources 复制到 resources/qq-music-api/dist
        // 必须排在开发态之前,否则打包后在开发机上会误匹配 process.cwd()/node_modules
        path.join(process.resourcesPath || '', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.resourcesPath || '', 'qq-music-api', 'dist', 'app.js'),
        // 打包态(兼容旧配置):app.asar 解包后的 node_modules
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.js'),
        // 开发态:项目根 node_modules
        path.join(process.cwd(), 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.cjs'),
        path.join(process.cwd(), 'node_modules', '@sansenjian', 'qq-music-api', 'dist', 'app.js')
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch (e) { /* ignore */ }
    }
    return candidates[0]
}

const service = createServiceLifecycle({
    probe: async () => {
        const status = await httpProbe(`${QQ_API_BASE}/`, 1000)
        return status !== null && status < 500
    },
    launch: () => {
        const appPath = resolveQQMusicAppPath()
        if (!fs.existsSync(appPath)) throw new Error('Missing QQ API entry')
        const polyfillPath = (() => {
            // 打包态(优先):extraResources 复制到 resources/qq-styletext-polyfill.cjs
            const packedPath = path.join(process.resourcesPath || '', 'qq-styletext-polyfill.cjs')
            if (fs.existsSync(packedPath)) return packedPath
            // 开发态:与 qq-music.js 同目录(electron/)
            const devPath = path.join(process.cwd(), 'electron', 'qq-styletext-polyfill.cjs')
            if (fs.existsSync(devPath)) return devPath
            // 兜底:__dirname(打包后 main.js 在 app.asar 内)
            try {
                const dirPath = path.dirname(fileURLToPath(import.meta.url))
                const sameDir = path.join(dirPath, 'qq-styletext-polyfill.cjs')
                if (fs.existsSync(sameDir)) return sameDir
            } catch (e) { /* ignore */ }
            return packedPath
        })()
        // Launch with our bundled Node runtime; argument arrays preserve spaced paths.
        const env = { ...process.env, PORT: '3200', ELECTRON_RUN_AS_NODE: '1', MINGYUN_API_ROOT: path.dirname(path.dirname(appPath)), MINGYUN_API_LIBS: path.join(process.resourcesPath || '', 'qq-music-api', 'libs') }
        // 打包态:设置 NODE_PATH 指向 libs 目录
        const libsPath = path.join(process.resourcesPath || '', 'qq-music-api', 'libs')
        try {
            if (fs.existsSync(libsPath)) {
                env.NODE_PATH = libsPath
            }
        } catch (e) { /* ignore */ }

        const child = spawn(process.execPath, [`--require=${apiRuntimePath()}`, `--require=${polyfillPath}`, appPath], {
            env, stdio: 'pipe', windowsHide: true
        })
        pipeChildLogs(child, 'qq')
        return child
    },
    wait: signal => waitForPort(QQ_API_BASE, '/', { signal }),
    ready: () => broadcastServicesReady({ qq: true }),
    log: message => serviceLog('qq', message)
})

export const startQQMusicAPI = () => service.ensure()
export const stopQQMusicAPI = () => service.stop()
export function registerQQMusicIPC() {
    if (registered) return
    const file = path.join(app.getPath('userData'), 'qq-session.enc')
    accountSession = new QQSession({ validate: validateQQLogin,
        load: () => {
            if (!fs.existsSync(file)) return ''
            if (!safeStorage.isEncryptionAvailable()) throw new Error('系统暂时无法解密 QQ 登录，请稍后重试')
            return safeStorage.decryptString(fs.readFileSync(file))
        },
        save: value => {
            if (!safeStorage.isEncryptionAvailable()) throw new Error('系统无法安全保存 QQ 登录，请检查系统凭据服务后重试')
            const temporary = file + '.tmp'
            try { fs.writeFileSync(temporary, safeStorage.encryptString(value)); fs.renameSync(temporary, file) }
            finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
        },
        clear: () => { if (fs.existsSync(file)) fs.unlinkSync(file) }
    })
    registerQQIpcHandlers()
    registered = true
}

// 统一请求封装
async function qqGet(endpoint, params = {}, cookie = '') {
    if (qqClient.supports(endpoint, params)) return qqClient.call(endpoint, params, cookie)
    await service.ensure()
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
    if (qqClient.supports(endpoint, data)) return qqClient.call(endpoint, data, cookie)
    await service.ensure()
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers['X-Custom-Cookie'] = cookie
    const res = await axios.post(`${QQ_API_BASE}${endpoint}`, data, { headers, timeout: 10000 })
    const body = res.data
    return body?.response ?? body
}

// Resolve the real favorites directory, then page the APK playlist RPC. The
// homepage's mymusic cards and legacy getcdinfo endpoint do not contain a full
// account library and can return subcode 4000 even for a valid public playlist.
async function fetchLikedSongsDirect(uin, cookie, offset = 0, limit = 100) {
    const playlists = await fetchUserPlaylistsDirect(uin, cookie, 0, 1000)
    const liked = playlists.data.playlists.find(item => item.type === 1)
    if (!liked) return { code: 0, data: { songs: [], total: 0, hasMore: false } }
    const payload = await qqClient.call('/getSongListDetail', { disstid: liked.dissid, offset, limit: Math.min(100, Number(limit) || 100) }, cookie)
    const info = payload.cdlist[0]
    return { code: 0, data: { songs: info.songlist, total: payload.total, hasMore: payload.hasMore, incomplete: false,
        info: { title: liked.diss_name, songCount: payload.total, id: liked.dissid, cover: info.logo } } }
}

async function fetchUserPlaylistsDirect(uin, cookie, offset = 0, limit = 30) {
    return qqClient.call('/user/getUserPlaylists', { uin, offset, limit }, cookie)
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
async function fetchQQCommentsDirect(songid, cmd = 8, pagenum = 0, pagesize = 20, lasthotcommentid = '', cookie = '', biztype = 1) {
    if (!songid) throw new Error('缺少 songid(歌曲对象未包含 songid 字段,无法获取评论)')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537'

    const g_tk = calcG_tk(cookie)
    const loginUin = qqAccountId(cookie) || '0'
    const res = await axios.get('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
        params: {
            _: Date.now(),
            biztype,
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
    if (res.data?.code !== 0) throw new Error(res.data?.message || res.data?.msg || 'QQ 评论请求被拒绝')
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
    ipcMain.handle('qq:benefits-open', async (event, params = {}) => {
        if (!trustedAppSender(event)) return { code: -1, message: '仅允许应用窗口打开 QQ 官方活动' }
        if (!['client', 'web'].includes(params?.target)) return { code: -1, message: '不支持的活动入口' }
        if (benefitsOpening) return { code: -1, message: '活动窗口正在打开，请稍候' }
        benefitsOpening = true
        try {
            const revision = accountSession.revision, saved = await accountSession.restore()
            if (revision !== accountSession.revision || !saved?.cookie || !saved.profile?.userId || String(params.uin || '') !== String(saved.profile.userId)) return { code: -1, message: '请先登录当前 QQ 账号' }
            if (params.target === 'client') {
                const payload = encodeURIComponent('{"action"="open","sourceId"=15}')
                await shell.openExternal(`qqmusic://qq.com/other/allSongsFreeModeAction?p=${payload}`)
                return { code: 0, message: '已请求打开官方客户端，请在官方客户端确认账号并完成任务，回来后刷新核对；若未打开，请在手机 QQ 音乐中进入“看广告免费听”' }
            }
            if (benefitsWin && !benefitsWin.isDestroyed()) { benefitsWin.focus(); return { code: 0, message: '官方活动窗口已打开' } }
            const partition = session.fromPartition('qq-benefits')
            await partition.clearStorageData()
            for (const entry of saved.cookie.split(';')) {
                const eq = entry.indexOf('='); if (eq < 1) continue
                const name = entry.slice(0, eq).trim(), value = entry.slice(eq + 1).trim()
                if (!/^[a-zA-Z0-9_-]+$/.test(name) || /[\r\n]/.test(value)) continue
                await partition.cookies.set({ url: 'https://y.qq.com', domain: '.qq.com', path: '/', name, value, secure: true })
            }
            if (revision !== accountSession.revision) { await partition.clearStorageData(); return { code: -1, message: 'QQ 账号已切换，请重新打开活动' } }
            const win = new BrowserWindow({ width: 520, height: 850, parent: BrowserWindow.fromWebContents(event.sender), title: 'QQ 音乐官方绿钻活动', webPreferences: { partition: 'qq-benefits', sandbox: true, contextIsolation: true, nodeIntegration: false } })
            benefitsWin = win
            const official = value => { try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'qq.com' || u.hostname.endsWith('.qq.com')) } catch { return false } }
            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
            win.webContents.on('will-navigate', (e, url) => { if (!official(url)) e.preventDefault() })
            win.webContents.on('will-redirect', (e, url) => { if (!official(url)) e.preventDefault() })
            // This nonpersistent partition is cleared before each new activity.
            // Do not race a close-time clear against a newly opened window.
            win.on('closed', () => { if (benefitsWin === win) benefitsWin = null })
            try { await win.loadURL('https://y.qq.com/cm/vip/advip/home/index.html') } catch { win.close(); throw new Error('activity load') }
            return { code: 0, message: '官方绿钻活动已打开；免费听广告任务仍需 QQ 音乐官方客户端的广告组件' }
        } catch { return { code: -1, message: '官方活动打开失败，请检查网络或是否安装 QQ 音乐客户端' } }
        finally { benefitsOpening = false }
    })
    const benefits=new QQBenefits({
        rpc:(...args)=>qqClient.rpc(...args),
        session:async()=>{const revision=accountSession.revision;const saved=await accountSession.restore();if(revision!==accountSession.revision)throw new Error('QQ 账号已切换');return {...saved,revision}},
        isCurrent:s=>s.revision===accountSession.revision
    })
    ipcMain.handle('qq:membership-benefits',async(event,params={})=>{
        if(!trustedAppSender(event))return {code:-1,message:'仅允许应用窗口访问 QQ 会员福利'}
        try { return {code:0,data:await benefits.run(params.action,params.uin)} }
        catch(error) { return {code:-1,message:qqBenefitsErrorMessage(error)} }
    })
    ipcMain.handle('qq:native-phone', async (event, params = {}) => {
        if(!trustedAppSender(event))return {code:-1,message:'仅允许应用窗口访问 QQ 原生登录'}
        try {
            if(params.action!=='cancel')inlineQR.cancel()
            const result=await nativeLogin.run(params.action,params)
            return result
        }catch(error){return {code:-1,message:error.message || 'QQ 原生登录失败，请检查验证码或稍后重试'}}
    })
    ipcMain.handle('qq:validate-session', async (event, params = {}) => {
        if (!trustedAppSender(event)) return { code: -1, message: '仅允许应用窗口访问 QQ 登录' }
        try {
            const cookie = String(params.cookie || '').trim()
            const current = () => (params.nativeGeneration === undefined || params.nativeGeneration === nativeLogin.generation) && (params.qrGeneration === undefined || inlineQR.current(params.qrGeneration))
            if (!current()) throw new Error('登录已取消')
            const profile = params.persist ? (await accountSession.accept(cookie, params.uin, current)).profile : await validateQQLogin(cookie, params.uin)
            if (params.persist && benefitsWin && !benefitsWin.isDestroyed()) benefitsWin.close()
            if (params.persist) await session.fromPartition('qq-benefits').clearStorageData()
            return { code: 0, data: profile }
        } catch (error) { return { code: -1, message: error.message } }
    })
    ipcMain.handle('qq:restore-session', async event => {
        if (!trustedAppSender(event)) return { code: -1, message: '仅允许应用窗口恢复 QQ 登录' }
        try { return { code: 0, data: await accountSession.restore() } }
        catch (error) { return { code: -1, message: error.message || 'QQ 登录恢复失败，请重新登录' } }
    })
    ipcMain.handle('qq:logout', async event => {
        if (!trustedAppSender(event)) return { code: -1, message: '仅允许应用窗口退出 QQ 登录' }
        accountSession.logout()
        nativeLogin.cancel()
        inlineQR.cancel()
        if (benefitsWin && !benefitsWin.isDestroyed()) benefitsWin.close()
        await session.fromPartition('qq-benefits').clearStorageData()
        if (loginWin && !loginWin.isDestroyed()) loginWin.close()
        await session.fromPartition(QQ_LOGIN_PARTITION).clearStorageData()
        return { code: 0 }
    })
    // ========== 官网登录(替代 API 二维码登录) ==========
    // 打开 y.qq.com 官网登录页,扫码后采集完整 cookie(含 qqmusic_key/qm_keyst)
    ipcMain.handle('qq:web-login', async (event, params = {}) => {
        if (!trustedAppSender(event)) return { success: false, message: '仅允许应用窗口打开 QQ 登录' }
        const mode = params?.mode ?? 'qq'
        if (!['qq', 'wechat', 'password'].includes(mode)) return { success: false, message: '不支持的官方登录方式' }
        try {
            // 获取当前主窗口作为父窗口(便于焦点管理与遮罩)
            const { BrowserWindow: BW } = require('electron')
            const parentWin = BW.fromWebContents(event.sender)
            return await openQQWebLogin(parentWin, mode)
        } catch (e) {
            console.error('[QQ Web Login] IPC error:', e)
            return { success: false, message: e?.message || 'QQ 官网登录异常' }
        }
    })

    // ========== 搜索类(3) ==========
    ipcMain.handle('qq:search', async (_, params) => {
        return qqClient.call('/getSearchByKey', { key: params.key, limit: params.limit ?? 30, page: params.page ?? 1, catZhida: params.catZhida ?? 0 }, params.cookie)
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
    ipcMain.handle('qq:album-tracks', async (_, params) => {
        return qqClient.call('/getAlbumTracks', { albummid: params.albummid, offset: params.offset, limit: params.limit }, params.cookie)
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
        return qqGet('/getSongListDetail', { disstid: params.disstid, offset: params.offset, limit: params.limit ?? 100 }, params.cookie)
    })
    ipcMain.handle('qq:batch-playlists', async (_, params) => {
        return qqPost('/batchGetSongLists', { categoryIds: params.categoryIds || [10000000], page: params.page || 0, limit: params.limit || 19, sortId: params.sortId || 5 }, params.cookie)
    })
    ipcMain.handle('qq:new-disks', async (_, params) => {
        return qqGet('/getNewDisks', { limit: params.limit || 20, page: params.page || 1 }, params.cookie)
    })

    // ========== 排行榜类(2) ==========
    ipcMain.handle('qq:ranks', async (_, params) => {
        return qqGet('/getRanks', { topId: params.topId, limit: params.limit ?? 20, page: params.page ?? 0 }, params.cookie)
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
            const biztype = [1, 2, 3, 4, 5].includes(Number(params.biztype)) ? Number(params.biztype) : 1
            let songid = params.resourceId || params.songid
            // songid 缺失时,通过 songmid 调 song-detail 接口补全
            if (!songid && params.songmid && biztype === 1) {
                const detail = await fetchQQSongDetail(params.songmid, params.cookie)
                songid = detail?.data?.track_info?.id || 0
            }
            return await fetchQQCommentsDirect(
                songid,
                params.cmd || 8,
                params.pagenum || 0,
                params.pagesize || 20,
                params.lasthotcommentid || '',
                params.cookie,
                biztype
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
            return await qqClient.call('/user/getUserPlaylists', {uin:params.uin,kind:params.kind,offset:params.offset || 0,limit:params.limit || 30}, params.cookie)
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
            return { code: -1, message: e?.message || '收藏列表获取失败，请刷新后重试' }
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
    ipcMain.handle('qq:qr-create', async (event, params={}) => {
        if(!trustedAppSender(event))return {code:-1,message:'仅允许应用窗口访问 QQ 扫码登录'}
        try {nativeLogin.cancel();return await inlineQR.create(params.mode||'qq')}
        catch(error){return {code:-1,message:error.message||'官方二维码加载失败'}}
    })
    ipcMain.handle('qq:qr-check', async (event, params={}) => {
        if(!trustedAppSender(event))return {code:-1,message:'仅允许应用窗口访问 QQ 扫码登录'}
        try{return await inlineQR.check(params.loginId)}
        catch(error){return {code:-1,message:error.message||'官方扫码状态获取失败'}}
    })
    ipcMain.handle('qq:qr-cancel', async (event, params={}) => {
        if(!trustedAppSender(event))return {code:-1,message:'仅允许应用窗口取消 QQ 扫码登录'}
        inlineQR.cancel(params.loginId);return {code:0}
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
