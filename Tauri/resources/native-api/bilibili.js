// native-api/bilibili.js
// B站模块 - 从 electron/main.js 提取（去除 ipcMain / electron 依赖）
// 包含：B站二维码登录、登录状态查询、退出登录、Cookie 持久化
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import axios from 'axios'

const PARSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 缓存目录（替代 electron app.getPath('userData'))
const CACHE_DIR = process.env.NATIVE_API_CACHE_DIR
  || path.join(os.homedir(), '.mingyuntime', 'native-api')

try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch (e) { /* 忽略 */ }

const BILI_COOKIE_FILE = path.join(CACHE_DIR, 'bilibili-cookie.json')

function loadBiliCookie() {
  try {
    const raw = fs.readFileSync(BILI_COOKIE_FILE, 'utf8')
    const data = JSON.parse(raw)
    // 检查过期（B站 SESSDATA 默认 180 天，这里保守按 30 天判断）
    if (data.savedAt && Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) return null
    return data.cookies || null
  } catch (e) { return null }
}

function saveBiliCookie(cookies) {
  try {
    fs.writeFileSync(BILI_COOKIE_FILE, JSON.stringify({ cookies, savedAt: Date.now() }), 'utf8')
  } catch (e) {}
}

function biliCookieString(cookies) {
  if (!cookies) return ''
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

// ===== 对外接口（原 IPC handler 提取为普通函数） =====

// bilibili:login-qr - 生成二维码登录
async function loginQr() {
  try {
    const r = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
      headers: { 'User-Agent': PARSE_UA },
      timeout: 10000
    })
    if (r.data?.code === 0 && r.data.data) {
      return { success: true, qrcodeUrl: r.data.data.url, qrcodeKey: r.data.data.qrcode_key }
    }
    return { success: false, message: r.data?.message || '获取二维码失败' }
  } catch (e) {
    return { success: false, message: e.message }
  }
}

// bilibili:login-check - 检查扫码状态
async function loginCheck(qrcodeKey) {
  try {
    const r = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', {
      params: { qrcode_key: qrcodeKey },
      headers: { 'User-Agent': PARSE_UA },
      timeout: 10000
    })
    const code = r.data?.data?.code
    // code: 0=成功, 86038=失效, 86090=已扫码未确认, 86101=未扫码
    if (code === 0) {
      // 登录成功，从返回的 url 中提取 Cookie
      const url = r.data.data.url || ''
      const cookies = {}
      // url 形如 https://passport.biligame.com/x/passport-login/web/crossDomain?DedeUserID=xxx&DedeUserID__ckMd5=xxx&Expires=xxx&SESSDATA=xxx&bili_jct=xxx&gourl=xxx
      const params = new URL(url).searchParams
      for (const key of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5']) {
        const val = params.get(key)
        if (val) cookies[key] = val
      }
      // 补充从 set-cookie 获取（如有）
      const setCookies = r.headers?.['set-cookie'] || []
      for (const sc of setCookies) {
        const m = sc.match(/^([^=]+)=([^;]*)/)
        if (m) cookies[m[1]] = m[2]
      }
      if (cookies.SESSDATA) {
        saveBiliCookie(cookies)
        // 立即获取完整用户信息（昵称、头像、大会员）
        let userInfo = { uid: cookies.DedeUserID }
        try {
          const nr = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: { 'User-Agent': PARSE_UA, 'Cookie': biliCookieString(cookies) },
            timeout: 10000
          })
          if (nr.data?.code === 0 && nr.data.data?.isLogin) {
            userInfo = {
              uid: nr.data.data.mid,
              uname: nr.data.data.uname,
              face: nr.data.data.face,
              vip: nr.data.data.vipStatus
            }
          }
        } catch (e) {}
        return { success: true, loggedIn: true, userInfo }
      }
      return { success: false, message: 'Cookie 解析失败' }
    }
    const msgMap = { 86038: 'expired', 86090: 'scanned', 86101: 'waiting' }
    return { success: true, loggedIn: false, status: msgMap[code] || 'unknown' }
  } catch (e) {
    return { success: false, message: e.message }
  }
}

// bilibili:login-status - 检查登录状态
async function loginStatus() {
  const cookies = loadBiliCookie()
  if (!cookies || !cookies.SESSDATA) return { success: true, loggedIn: false }
  try {
    const r = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': PARSE_UA, 'Cookie': biliCookieString(cookies) },
      timeout: 10000
    })
    if (r.data?.code === 0 && r.data.data?.isLogin) {
      return { success: true, loggedIn: true, userInfo: { uid: r.data.data.mid, uname: r.data.data.uname, face: r.data.data.face, vip: r.data.data.vipStatus } }
    }
    return { success: true, loggedIn: false }
  } catch (e) {
    return { success: true, loggedIn: false }
  }
}

// bilibili:logout - 退出登录
async function logout() {
  try { fs.unlinkSync(BILI_COOKIE_FILE) } catch (e) {}
  return { success: true }
}

export {
  PARSE_UA,
  loadBiliCookie,
  biliCookieString,
  loginQr,
  loginCheck,
  loginStatus,
  logout
}
