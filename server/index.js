const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const sqlite3 = require('sqlite3').verbose()
const session = require('express-session')
const SQLiteStore = require('connect-sqlite3')(session)
const axios = require('axios')
const path = require('path')
const fs = require('fs')
const mm = require('music-metadata')

const app = express()

function env(key, defaultValue = '') {
    const v = process.env[key]
    if (!v) return defaultValue
    return v.trim().replace(/^[`'"]+|[`'"]+$/g, '')
}

const PORT = env('PORT', 7008)
const JWT_SECRET = env('JWT_SECRET', 'mingyunshi-guang-change-me-in-production')
const SESSION_SECRET = env('SESSION_SECRET', 'mingyunshi-guang-session-change-me')
const NCM_API_BASE = env('NCM_API_BASE', 'https://api.xiaomingky.cn')
const DATA_DIR = env('DATA_DIR', path.join(__dirname, 'data'))
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

app.set('trust proxy', 1)
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(session({
    store: new SQLiteStore({ dir: DATA_DIR, db: 'sessions.sqlite' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'mingyun.sid',
    cookie: {
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax'
    }
}))

// 静态资源：Web 管理后台
app.use(express.static(path.join(__dirname, 'public')))
app.use('/uploads', express.static(UPLOAD_DIR))

// SQLite
const DB_PATH = path.join(DATA_DIR, 'music.db')
const db = new sqlite3.Database(DB_PATH)
db.configure('busyTimeout', 5000)
db.run('PRAGMA journal_mode = WAL')
console.log('[server] DATA_DIR=', DATA_DIR)
console.log('[server] DB_PATH=', DB_PATH)
console.log('[server] UPLOAD_DIR=', UPLOAD_DIR)

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_locks (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS cloud_songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        duration INTEGER DEFAULT 0,
        file_path TEXT NOT NULL,
        cover_path TEXT,
        lyric_path TEXT,
        sort_order INTEGER DEFAULT 0,
        category TEXT DEFAULT '',
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )`)
})

// 迁移：为旧表补充 sort_order / category 字段
function addColumnIfNotExists(table, column, type, defaultValue) {
    db.all(`PRAGMA table_info(${table})`, (err, cols) => {
        if (err) return console.error('[migration] pragma error:', err)
        if (!cols || cols.find(c => c.name === column)) return
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type} DEFAULT ${defaultValue}`, (err2) => {
            if (err2) console.error(`[migration] add ${column} failed:`, err2)
            else console.log(`[migration] added ${column} to ${table}`)
        })
    })
}
addColumnIfNotExists('cloud_songs', 'sort_order', 'INTEGER', 0)
addColumnIfNotExists('cloud_songs', 'category', 'TEXT', "''")

// 网易云 API 代理：主站 + 可选备用
const NCM_BASES = [NCM_API_BASE, ...(env('NCM_API_FALLBACK', '') ? env('NCM_API_FALLBACK').split(',').map(s => s.trim()).filter(Boolean) : [])]

const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const ncmHeaders = {
    'User-Agent': chromeUA,
    'Referer': 'https://music.163.com/',
    'Origin': 'https://music.163.com',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'X-Real-IP': '117.147.192.0',
    'X-Forwarded-For': '117.147.192.0'
}

// 维护与网易云 API 的 Cookie 会话，并把响应里的 set-cookie 合并回 session
async function proxyNcm(req, res, targetPath) {
    if (!req.session) {
        return res.status(500).json({ success: false, message: 'Session 未初始化' })
    }

    const isPost = req.method === 'POST' || req.method === 'post'
    // GET 参数放 query；POST 参数转成 form-urlencoded，同时把 session cookie 作为 query 参数带上
    const params = isPost ? {} : { ...req.query, ...req.body }
    if (!params.cookie && req.session.ncmCookie) params.cookie = req.session.ncmCookie
    let data = undefined
    if (isPost && req.body && Object.keys(req.body).length) {
        const sp = new URLSearchParams()
        for (const [k, v] of Object.entries(req.body)) {
            if (k === 'cookie') continue
            if (v !== undefined && v !== null) sp.append(k, String(v))
        }
        data = sp
    }

    const headers = { ...ncmHeaders, 'Content-Type': isPost ? 'application/x-www-form-urlencoded' : 'application/json' }
    if (req.session.ncmCookie) headers.Cookie = req.session.ncmCookie

    let lastError = null
    for (const baseURL of NCM_BASES) {
        try {
            const instance = axios.create({
                baseURL,
                timeout: 30000,
                withCredentials: true,
                validateStatus: () => true
            })
            const result = await instance({
                method: req.method,
                url: targetPath,
                params,
                data,
                headers
            })
            // 安全风控 / 被拦截时换下一个节点
            const isBlocked = result.status === 400 && result.data && (
                String(result.data.message || result.data.msg || '').includes('网络环境') ||
                String(result.data.message || result.data.msg || '').includes('安全')
            )
            if (isBlocked) {
                console.warn('NCM base blocked:', baseURL, targetPath, result.data)
                lastError = result.data
                continue
            }
            // 把网易云返回的 set-cookie 合并到 session
            const sc = result.headers['set-cookie']
            if (sc && sc.length) {
                const existing = req.session.ncmCookie || ''
                const parsed = sc.map(c => c.split(';')[0].trim()).filter(Boolean)
                const merged = Array.from(new Set([...existing.split(';').map(s => s.trim()).filter(Boolean), ...parsed])).join('; ')
                req.session.ncmCookie = merged
                res.set('set-cookie', sc)
            }
            return res.status(result.status).json(result.data)
        } catch (e) {
            console.error('NCM proxy error:', baseURL, targetPath, e.message)
            lastError = e
        }
    }

    res.status(502).json({
        success: false,
        message: '网易云 API 代理失败',
        detail: lastError?.message || lastError?.msg || lastError?.message || String(lastError),
        bases: NCM_BASES
    })
}

// 后端内部调用网易云 API（不需要 Express req/res）
async function proxyNcmInternal(targetPath, params = {}, cookie = '') {
    const query = new URLSearchParams()
    if (cookie) query.append('cookie', cookie)
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) query.append(k, String(v))
    }
    const qs = query.toString()
    const fullPath = targetPath + (qs ? (targetPath.includes('?') ? '&' : '?') + qs : '')
    const headers = { ...ncmHeaders, Cookie: cookie || '' }
    let lastError = null
    for (const baseURL of NCM_BASES) {
        try {
            const result = await axios.get(baseURL + fullPath, { headers, timeout: 15000, validateStatus: () => true })
            const isBlocked = result.status === 400 && result.data && (
                String(result.data.message || result.data.msg || '').includes('网络环境') ||
                String(result.data.message || result.data.msg || '').includes('安全')
            )
            if (isBlocked) {
                lastError = result.data
                continue
            }
            return result
        } catch (e) {
            console.error('NCM internal error:', baseURL, fullPath, e.message)
            lastError = e
        }
    }
    throw new Error(lastError?.message || lastError?.msg || '网易云 API 请求失败')
}

// 调试用：测试服务器到网易云 API 的连通性
app.get('/api/debug/ncm', async (req, res) => {
    try {
        const url = `${NCM_API_BASE}/login/qr/key?timestamp=${Date.now()}`
        const result = await axios.get(url, { timeout: 15000 })
        res.json({ success: true, baseURL: NCM_API_BASE, status: result.status, data: result.data })
    } catch (e) {
        res.status(502).json({
            success: false,
            baseURL: NCM_API_BASE,
            message: e.message,
            code: e.code || null,
            errno: e.errno || null
        })
    }
})

// Web 管理后台用到的网易云登录/用户信息代理
app.all('/ncm/*', (req, res) => {
    const target = req.path.replace(/^\/ncm/, '')
    proxyNcm(req, res, target)
})

// 调试用：查看当前 session/cookie 状态
app.get('/api/debug/session', (req, res) => {
    res.json({
        sessionId: req.sessionID,
        hasUserId: !!req.webUserId,
        userId: req.webUserId || null,
        cookies: req.headers.cookie || null,
        protocol: req.protocol,
        secure: req.secure
    })
})

// 文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, unique + path.extname(file.originalname))
    }
})
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } })

// Web 后台登录校验中间件：优先使用 session cookie，否则使用 JWT 令牌
function webAuth(req, res, next) {
    let userId = null
    let nickname = ''
    let avatarUrl = ''
    if (req.session && (req.webUserId || req.session.userId)) {
        userId = req.webUserId || req.session.userId
        nickname = req.session.nickname || ''
        avatarUrl = req.session.avatarUrl || ''
    } else {
        const auth = req.headers.authorization
        if (auth && auth.startsWith('Bearer ')) {
            try {
                const decoded = jwt.verify(auth.slice(7), JWT_SECRET)
                userId = decoded.userId
                nickname = decoded.nickname || ''
                avatarUrl = decoded.avatarUrl || ''
            } catch (e) {}
        }
    }
    if (!userId) {
        return res.status(401).json({ success: false, message: '未登录后台' })
    }
    req.webUserId = userId
    req.webNickname = nickname
    req.webAvatarUrl = avatarUrl
    next()
}

// 桌面程序 JWT 校验中间件
function tokenAuth(req, res, next) {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: '缺少令牌' })
    }
    try {
        req.user = jwt.verify(auth.slice(7), JWT_SECRET)
        next()
    } catch (e) {
        return res.status(401).json({ success: false, message: '令牌无效' })
    }
}

// ========== Web 管理后台 API ==========

// Web 端：保存网易云登录态（允许任意网易云账号登录，数据按 userId 隔离）
app.post('/web/login', (req, res) => {
    const { userId, nickname, avatarUrl, cookie } = req.body
    console.log('/web/login called, sessionId=', req.sessionID, 'userId=', userId)
    if (!userId) return res.status(400).json({ success: false, message: '缺少 userId' })

    req.webUserId = String(userId)
    req.session.userId = String(userId)
    req.session.nickname = nickname || ''
    req.session.avatarUrl = avatarUrl || ''
    req.session.ncmCookie = cookie || ''
    req.session.save(err => {
        if (err) {
            console.error('session save error:', err)
            return res.status(500).json({ success: false, message: '登录状态保存失败' })
        }
        console.log('/web/login saved, sessionId=', req.sessionID, 'userId=', req.webUserId)
        // 同时签发一个 JWT 令牌，供手机等保存不住 Cookie 的环境使用
        const token = jwt.sign(
            { userId: req.webUserId, nickname: req.session.nickname, avatarUrl: req.session.avatarUrl },
            JWT_SECRET,
            { expiresIn: '7d' }
        )
        res.json({ success: true, token })
    })
})

// Web 端：当前登录用户信息
app.get('/web/me', webAuth, (req, res) => {
    res.json({
        success: true,
        userId: req.webUserId,
        nickname: req.webNickname,
        avatarUrl: req.webAvatarUrl
    })
})

// Web 端：调试用，确认当前会话、数据目录和该用户的设置记录
app.get('/web/debug/state', webAuth, async (req, res) => {
    const userId = req.webUserId
    const lockRow = await new Promise((resolve, reject) => {
        db.get('SELECT user_id, updated_at FROM user_locks WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err)
            resolve(row || null)
        })
    })
    const songCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as c FROM cloud_songs WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err)
            resolve(row ? row.c : 0)
        })
    })
    let dbStat = null
    try {
        const s = fs.statSync(DB_PATH)
        dbStat = { size: s.size, mtime: s.mtime }
    } catch (e) { dbStat = { error: e.message } }
    res.json({ success: true, userId, dataDir: DATA_DIR, dbPath: DB_PATH, dbStat, lockRow, songCount })
})

// Web 端：退出登录
app.post('/web/logout', webAuth, (req, res) => {
    req.session.destroy()
    res.json({ success: true })
})

// Web 端：查询锁状态
app.post('/web/lock/status', webAuth, (req, res) => {
    const userId = req.webUserId
    db.get('SELECT 1 FROM user_locks WHERE user_id = ?', [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        res.json({ success: true, locked: !!row })
    })
})

// Web 端：设置/修改密码锁
app.post('/web/lock/set', webAuth, async (req, res) => {
    const { password, oldPassword } = req.body
    const userId = req.webUserId
    if (!password || password.length < 4) return res.status(400).json({ success: false, message: '密码至少 4 位' })

    db.get('SELECT password_hash FROM user_locks WHERE user_id = ?', [userId], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        if (row) {
            if (!oldPassword) return res.status(403).json({ success: false, message: '修改密码需要原密码' })
            const ok = await bcrypt.compare(oldPassword, row.password_hash)
            if (!ok) return res.status(403).json({ success: false, message: '原密码错误' })
        }
        const hash = await bcrypt.hash(password, 10)
        const now = Math.floor(Date.now() / 1000)
        db.run(
            `INSERT INTO user_locks (user_id, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
            [userId, hash, now, now],
            function (err) {
                if (err) return res.status(500).json({ success: false, message: err.message })
                res.json({ success: true })
            }
        )
    })
})

// Web 端：移除密码锁
app.post('/web/lock/remove', webAuth, async (req, res) => {
    const { password } = req.body
    const userId = req.webUserId
    if (!password) return res.status(400).json({ success: false, message: '缺少密码' })

    db.get('SELECT password_hash FROM user_locks WHERE user_id = ?', [userId], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        if (!row) return res.status(404).json({ success: false, message: '未设置密码锁' })
        const ok = await bcrypt.compare(password, row.password_hash)
        if (!ok) return res.status(403).json({ success: false, message: '密码错误' })
        db.run('DELETE FROM user_locks WHERE user_id = ?', [userId], function (err) {
            if (err) return res.status(500).json({ success: false, message: err.message })
            res.json({ success: true })
        })
    })
})

// Web 端：上传云音乐（支持批量上传）
app.post('/web/cloud/upload', webAuth, (req, res, next) => {
    upload.fields([
        { name: 'audio', maxCount: 50 },
        { name: 'cover', maxCount: 50 },
        { name: 'lyric', maxCount: 50 }
    ])(req, res, (err) => {
        if (err) {
            console.error('[upload] multer error:', err.message, err.code)
            let message = `上传文件处理失败：${err.message}`
            if (err.code === 'LIMIT_FILE_SIZE') message = '单个文件超过 200MB 限制'
            if (err.code === 'LIMIT_FILE_COUNT') message = '单次上传文件数量超过限制'
            if (err.code === 'LIMIT_UNEXPECTED_FILE') message = '字段名错误，只允许 audio/cover/lyric'
            return res.status(400).json({ success: false, message })
        }
        next()
    })
}, async (req, res) => {
    const userId = req.webUserId
    const audios = req.files?.audio || []
    if (!audios.length) return res.status(400).json({ success: false, message: '缺少音频文件' })

    let metadata = {}
    try { metadata = JSON.parse(req.body.metadata || '{}') } catch (e) { metadata = {} }
    const covers = req.files?.cover || []
    const lyrics = req.files?.lyric || []

    // 为新歌曲分配递增排序
    let nextSort = 0
    try {
        const maxRow = await new Promise((resolve, reject) => {
            db.get('SELECT COALESCE(MAX(sort_order), 0) as m FROM cloud_songs WHERE user_id = ?', [userId], (err, row) => {
                if (err) return reject(err)
                resolve(row)
            })
        })
        nextSort = maxRow?.m || 0
    } catch (e) { console.error('[upload] max sort_order error:', e) }

    // 按文件名（去掉扩展名）匹配封面和歌词
    const getBaseName = (filename) => filename.replace(/\.[^/.]+$/, '').toLowerCase()
    const coverMap = {}
    covers.forEach(c => { coverMap[getBaseName(c.originalname)] = c })
    const lyricMap = {}
    lyrics.forEach(l => { lyricMap[getBaseName(l.originalname)] = l })

    const results = []
    const errors = []

    for (let i = 0; i < audios.length; i++) {
        const audio = audios[i]
        const baseName = getBaseName(audio.originalname)
        const cover = coverMap[baseName] || null
        const lyric = lyricMap[baseName] || null
        // 批量上传时支持 metadata 为数组，按索引匹配单首歌曲
        const meta = Array.isArray(metadata) ? (metadata[i] || {}) : metadata

        try {
            // 优先使用前端传来的时长，否则解析音频文件
            let duration = Number(meta.duration) || 0
            if (!duration && audio.path) {
                try {
                    const audioMeta = await mm.parseFile(audio.path)
                    duration = Math.floor(audioMeta.format.duration || 0)
                    console.log('[upload] parsed duration:', audio.originalname, duration, 's')
                } catch (e) {
                    console.error('[upload] parse audio duration failed:', audio.originalname, e.message)
                }
            }

            const name = (meta.name || audio.originalname).replace(/\.[^/.]+$/, '')
            const songId = await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO cloud_songs (user_id, name, artist, album, duration, file_path, cover_path, lyric_path, sort_order, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        name,
                        meta.artist || '',
                        meta.album || '',
                        duration,
                        audio.filename,
                        cover ? cover.filename : null,
                        lyric ? lyric.filename : null,
                        ++nextSort,
                        meta.category || ''
                    ],
                    function (err) {
                        if (err) return reject(err)
                        resolve(this.lastID)
                    }
                )
            })
            results.push({ index: i, songId, name })
        } catch (err) {
            console.error('[upload] insert failed:', audio.originalname, err.message)
            errors.push({ index: i, name: audio.originalname, message: err.message })
        }
    }

    res.json({
        success: errors.length === 0,
        uploaded: results.length,
        failed: errors.length,
        results,
        errors
    })
})

// Web 端：云音乐列表
app.get('/web/cloud/list', webAuth, (req, res) => {
    const userId = req.webUserId
    db.all('SELECT * FROM cloud_songs WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        const host = `${req.protocol}://${req.get('host')}`
        const songs = rows.map(r => ({
            id: r.id,
            name: r.name,
            artist: r.artist,
            album: r.album,
            duration: r.duration,
            sortOrder: r.sort_order,
            category: r.category,
            url: `${host}/uploads/${r.file_path}`,
            coverUrl: r.cover_path ? `${host}/uploads/${r.cover_path}` : '',
            lyricUrl: r.lyric_path ? `${host}/uploads/${r.lyric_path}` : ''
        }))
        res.json({ success: true, songs })
    })
})

// Web 端：编辑云音乐元数据（支持替换封面/歌词文件）
app.put('/web/cloud/song/:id', webAuth, (req, res, next) => {
    upload.fields([
        { name: 'cover', maxCount: 1 },
        { name: 'lyric', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) {
            console.error('[edit] multer error:', err.message, err.code)
            let message = `文件处理失败：${err.message}`
            if (err.code === 'LIMIT_FILE_SIZE') message = '单个文件超过 200MB 限制'
            if (err.code === 'LIMIT_UNEXPECTED_FILE') message = '字段名错误，只允许 cover/lyric'
            return res.status(400).json({ success: false, message })
        }
        next()
    })
}, async (req, res) => {
    const userId = req.webUserId
    const id = req.params.id
    const { name, artist, album, category, clearCover, clearLyric } = req.body
    const coverFile = req.files?.cover?.[0]
    const lyricFile = req.files?.lyric?.[0]

    try {
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM cloud_songs WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
                if (err) return reject(err)
                resolve(row)
            })
        })
        if (!row) return res.status(404).json({ success: false, message: '歌曲不存在或无权修改' })

        let coverPath = row.cover_path
        let lyricPath = row.lyric_path
        let oldCoverPath = null
        let oldLyricPath = null

        if (coverFile) {
            oldCoverPath = row.cover_path
            coverPath = coverFile.filename
        } else if (clearCover === 'true' || clearCover === true || clearCover === '1') {
            oldCoverPath = row.cover_path
            coverPath = null
        }

        if (lyricFile) {
            oldLyricPath = row.lyric_path
            lyricPath = lyricFile.filename
        } else if (clearLyric === 'true' || clearLyric === true || clearLyric === '1') {
            oldLyricPath = row.lyric_path
            lyricPath = null
        }

        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE cloud_songs SET name = ?, artist = ?, album = ?, category = ?, cover_path = ?, lyric_path = ? WHERE id = ? AND user_id = ?',
                [
                    name !== undefined ? name : row.name,
                    artist !== undefined ? artist : row.artist,
                    album !== undefined ? album : row.album,
                    category !== undefined ? category : row.category,
                    coverPath,
                    lyricPath,
                    id,
                    userId
                ],
                function (err) {
                    if (err) return reject(err)
                    resolve(this.changes)
                }
            )
        })

        // 数据库更新成功后删除旧文件（忽略删除失败）
        if (oldCoverPath) {
            try { fs.unlinkSync(path.join(UPLOAD_DIR, oldCoverPath)) } catch (e) { console.error('[edit] delete old cover failed:', e.message) }
        }
        if (oldLyricPath) {
            try { fs.unlinkSync(path.join(UPLOAD_DIR, oldLyricPath)) } catch (e) { console.error('[edit] delete old lyric failed:', e.message) }
        }

        res.json({ success: true })
    } catch (err) {
        // 数据库更新失败时删除本次上传的新文件，避免垃圾
        if (coverFile) {
            try { fs.unlinkSync(coverFile.path) } catch (e) {}
        }
        if (lyricFile) {
            try { fs.unlinkSync(lyricFile.path) } catch (e) {}
        }
        console.error('[edit] error:', err.message)
        res.status(500).json({ success: false, message: err.message })
}
})

// Web 端：调整云音乐排序
app.post('/web/cloud/reorder', webAuth, async (req, res) => {
    const userId = req.webUserId
    const { moves } = req.body
    if (!Array.isArray(moves) || !moves.length) {
        return res.status(400).json({ success: false, message: '缺少排序数据' })
    }
    try {
        await new Promise((resolve, reject) => db.run('BEGIN TRANSACTION', err => err ? reject(err) : resolve()))
        for (const m of moves) {
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE cloud_songs SET sort_order = ? WHERE id = ? AND user_id = ?',
                    [m.sortOrder, m.id, userId],
                    function (err) {
                        if (err) return reject(err)
                        resolve(this.changes)
                    }
                )
            })
        }
        await new Promise((resolve, reject) => db.run('COMMIT', err => err ? reject(err) : resolve()))
        res.json({ success: true })
    } catch (err) {
        db.run('ROLLBACK')
        console.error('[reorder] error:', err.message)
        res.status(500).json({ success: false, message: err.message })
    }
})

// Web 端：删除云音乐
app.delete('/web/cloud/song/:id', webAuth, (req, res) => {
    const userId = req.webUserId
    const id = req.params.id
    db.get('SELECT * FROM cloud_songs WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        if (!row) return res.status(404).json({ success: false, message: '歌曲不存在' })
        try {
            fs.unlinkSync(path.join(UPLOAD_DIR, row.file_path))
            if (row.cover_path) fs.unlinkSync(path.join(UPLOAD_DIR, row.cover_path))
            if (row.lyric_path) fs.unlinkSync(path.join(UPLOAD_DIR, row.lyric_path))
        } catch (e) { console.error('删除文件失败:', e) }
        db.run('DELETE FROM cloud_songs WHERE id = ?', [id], function (err) {
            if (err) return res.status(500).json({ success: false, message: err.message })
            res.json({ success: true })
        })
    })
})

// ========== 桌面程序 API ==========

// 桌面程序账号同步：用网易云 cookie 校验 userId  ownership，通过后签发 JWT
app.post('/api/auth/desktop-login', async (req, res) => {
    const { userId, cookie } = req.body
    if (!userId || !cookie) return res.status(400).json({ success: false, message: '缺少 userId 或 cookie' })
    try {
        const result = await proxyNcmInternal('/user/account', { timestamp: Date.now() }, cookie)
        const profile = result.data && result.data.profile ? result.data.profile : result.profile
        const actualUserId = profile && (profile.userId || profile.userid)
        if (String(actualUserId) !== String(userId)) {
            return res.status(403).json({
                success: false,
                message: '账号不一致',
                detail: `cookie 对应的网易云 ID 为 ${actualUserId}，与提交的 ${userId} 不符`
            })
        }
        const token = jwt.sign({ userId: String(userId) }, JWT_SECRET, { expiresIn: '7d' })
        res.json({ success: true, token })
    } catch (e) {
        console.error('desktop-login error:', e.message)
        res.status(502).json({ success: false, message: '验证网易云账号失败', detail: e.message })
    }
})

// 查询锁状态（需要 JWT）
app.get('/api/lock/status', tokenAuth, (req, res) => {
    const userId = req.user.userId
    db.get('SELECT 1 FROM user_locks WHERE user_id = ?', [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        res.json({ success: true, locked: !!row })
    })
})

// 验证密码并返回 JWT（需要旧 JWT 保证账号一致）
app.post('/api/lock/verify', tokenAuth, async (req, res) => {
    const userId = req.user.userId
    const { password } = req.body
    if (!password) return res.status(400).json({ success: false, message: '缺少密码' })
    db.get('SELECT password_hash FROM user_locks WHERE user_id = ?', [userId], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        if (!row) return res.status(404).json({ success: false, message: '未设置密码锁' })
        const ok = await bcrypt.compare(password, row.password_hash)
        if (!ok) return res.status(403).json({ success: false, message: '密码错误' })
        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })
        res.json({ success: true, token })
    })
})

// 桌面程序获取云音乐列表（需要 JWT）
app.get('/api/cloud/list', tokenAuth, (req, res) => {
    const userId = req.user.userId
    db.all('SELECT * FROM cloud_songs WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message })
        const host = `${req.protocol}://${req.get('host')}`
        const songs = rows.map(r => ({
            id: r.id,
            name: r.name,
            artist: r.artist,
            album: r.album,
            duration: r.duration,
            sortOrder: r.sort_order,
            category: r.category,
            url: `${host}/uploads/${r.file_path}`,
            coverUrl: r.cover_path ? `${host}/uploads/${r.cover_path}` : '',
            lyricUrl: r.lyric_path ? `${host}/uploads/${r.lyric_path}` : ''
        }))
        res.json({ success: true, songs })
    })
})

// 兜底：未匹配路由返回 Web 后台首页
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// 全局错误处理：确保任何未捕获异常都返回 JSON，避免前端收到 HTML 后 JSON.parse 失败
app.use((err, req, res, next) => {
    console.error('[server error]', err)
    if (res.headersSent) return next(err)
    res.status(500).json({ success: false, message: '服务器内部错误', detail: err.message })
})

app.listen(PORT, () => {
    console.log(`Music cloud server running on port ${PORT}`)
    console.log(`Data directory: ${DATA_DIR}`)
    console.log(`NCM API base: ${NCM_API_BASE}`)
})
