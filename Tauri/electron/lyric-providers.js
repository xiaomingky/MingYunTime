// 多平台歌词搜索模块（QQ 音乐 + 酷狗音乐）
// 参考 LDDC (https://github.com/chenmozhijin/LDDC) 的 API 调用和解密逻辑
// 支持逐字歌词（QRC/KRC 格式），转换为项目使用的 YRC 格式

import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'
import { tripledes_key_setup, tripledes_crypt, DECRYPT } from './tripledes.js'

const QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'utf-8')
const KRC_KEY = Buffer.from('@Gaw^2tGQ61-\xce\xd2ni', 'latin1')

// ===== HTTP 工具 =====

function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http
        const req = mod.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...options.headers
            },
            timeout: 8000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetch(res.headers.location, options).then(resolve).catch(reject)
            }
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    })
}

function postJson(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body)
        const urlObj = new URL(url)
        const mod = urlObj.protocol === 'https:' ? https : http
        const req = mod.request(url, {
            method: 'POST',
            headers: {
                'User-Agent': 'okhttp/3.14.9',
                'Content-Type': 'application/json',
                'Cookie': 'tmeLoginType=-1;',
                'Accept-Encoding': 'gzip',
                'Content-Length': Buffer.byteLength(data),
                ...headers
            }
        }, (res) => {
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => {
                const buf = Buffer.concat(chunks)
                if (res.headers['content-encoding'] === 'gzip') {
                    try { resolve(zlib.gunzipSync(buf).toString('utf-8')) } catch (e) { resolve(buf.toString('utf-8')) }
                } else {
                    resolve(buf.toString('utf-8'))
                }
            })
        })
        req.on('error', reject)
        req.write(data)
        req.end()
    })
}

// ===== 解密 =====

// QRC 解密: hex → TripleDES ECB → zlib inflate
function qrcDecrypt(encryptedHex) {
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const schedule = tripledes_key_setup(QRC_KEY, DECRYPT)
    const decrypted = Buffer.alloc(encrypted.length)
    for (let i = 0; i < encrypted.length; i += 8) {
        const block = tripledes_crypt(encrypted.slice(i), schedule)
        for (let j = 0; j < 8 && i + j < encrypted.length; j++) {
            decrypted[i + j] = block[j]
        }
    }
    return zlib.inflateSync(decrypted).toString('utf-8')
}

// KRC 解密: base64 → 跳过前4字节 → 异或 → zlib inflate
function krcDecrypt(base64Data) {
    const raw = Buffer.from(base64Data, 'base64')
    const encrypted = raw.slice(4)
    const decrypted = Buffer.alloc(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
        decrypted[i] = encrypted[i] ^ KRC_KEY[i % KRC_KEY.length]
    }
    return zlib.inflateSync(decrypted).toString('utf-8')
}

// ===== 格式转换 =====

// QRC → YRC
// QRC 格式: [lineStart,lineDur]text(start,duration)text(start,duration)...
//   即: 时间戳在它所修饰的文本「之后」(参考 LDDC qrc.py 的 _WORD_SPLIT_PATTERN)
// YRC 格式: [lineStart,lineDur](start,duration,0)text(start,duration,0)text...
//   即: 时间戳在文本「之前」(参考 LDDC yrc.py，及项目内 parseYrcLyrics 的正则)
// 因此需要逐行解析 QRC，把每个 (text)(start,dur) 重排为 (start,dur,0)(text)
function qrcToYrc(qrc) {
    // 提取 <Lyric_1 LyricType="1" LyricContent="..."/> 中的内容
    const match = qrc.match(/<Lyric_1 LyricType="1" LyricContent="([\s\S]*?)"\s*\/>/)
    const content = match ? match[1] : qrc

    // 匹配单个字: text(start,duration)
    // text 不能包含 (\d+,\d+) 模式（避免吞掉下一字的时间戳），\(\) 显式匹配括号
    // 参考 LDDC qrc.py 的 _WORD_SPLIT_PATTERN
    const wordPattern = /((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)/g

    const lines = content.split(/\r?\n/)
    const result = []
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // 行头: [lineStart,lineDuration]
        const lineMatch = trimmed.match(/^\[(\d+),(\d+)\](.*)$/)
        if (!lineMatch) {
            // 非歌词行（如 [ti:xxx] 元数据），原样保留
            result.push(trimmed)
            continue
        }

        const lineStart = lineMatch[1]
        const lineDur = lineMatch[2]
        const lineContent = lineMatch[3]

        wordPattern.lastIndex = 0
        let yrcLine = `[${lineStart},${lineDur}]`
        let hasWord = false
        let m
        while ((m = wordPattern.exec(lineContent)) !== null) {
            const text = m[1]
            const start = m[2]
            const duration = m[3]
            yrcLine += `(${start},${duration},0)${text}`
            hasWord = true
        }
        if (!hasWord) {
            // 没有逐字时间戳的行（纯音乐等），原样保留
            result.push(trimmed)
        } else {
            result.push(yrcLine)
        }
    }
    return result.join('\n')
}

// KRC → YRC: <offset,duration,flag>text → (lineStart+offset,duration,0)text
function krcToYrc(krc) {
    return krc.split('\n').map(line => {
        const lineMatch = line.match(/^\[(\d+),(\d+)\](.*)$/)
        if (!lineMatch) return line
        const lineStart = parseInt(lineMatch[1])
        const lineDur = lineMatch[2]
        let content = lineMatch[3]
        content = content.replace(/<(\d+),(\d+),(\d+)>([^<]*)/g, (m, offset, dur, flag, text) => {
            return `(${lineStart + parseInt(offset)},${dur},0)${text}`
        })
        return `[${lineStart},${lineDur}]${content}`
    }).join('\n')
}

// KRC → YRC + 翻译：同时提取逐字歌词和翻译（type==1），参考 LDDC krc.py 的 krc2mdata
// KRC 中的 [language:base64] tag 包含翻译和罗马音，type==1 为逐行翻译
function krcToYrcAndTrans(krc) {
    const yrcLines = []
    const lineStarts = [] // 每行歌词的起始时间（毫秒），用于翻译对齐
    let languageTag = null

    for (const rawLine of krc.split('\n')) {
        const line = rawLine.trim()
        if (!line.startsWith('[')) continue

        // 匹配 [language:xxx] tag（base64 编码的 JSON，包含翻译/罗马音）
        const langMatch = line.match(/^\[language:([^\]]*)\]$/)
        if (langMatch) {
            languageTag = langMatch[1].trim()
            continue
        }

        // 匹配歌词行 [lineStart,lineDur]content
        const lineMatch = line.match(/^\[(\d+),(\d+)\](.*)$/)
        if (!lineMatch) continue // 跳过 [ti:xxx] 等其他 tag

        const lineStart = parseInt(lineMatch[1])
        const lineDur = lineMatch[2]
        let content = lineMatch[3]
        content = content.replace(/<(\d+),(\d+),(\d+)>([^<]*)/g, (m, offset, dur, flag, text) => {
            return `(${lineStart + parseInt(offset)},${dur},0)${text}`
        })
        yrcLines.push(`[${lineStart},${lineDur}]${content}`)
        lineStarts.push(lineStart)
    }

    let trans = ''
    if (languageTag) {
        try {
            const langJson = JSON.parse(Buffer.from(languageTag, 'base64').toString('utf-8'))
            for (const lang of langJson.content || []) {
                if (lang.type === 1 && lang.lyricContent) { // 逐行翻译
                    const transLines = []
                    for (let i = 0; i < lineStarts.length; i++) {
                        const transText = lang.lyricContent[i]?.[0]
                        if (!transText) continue
                        const ms = lineStarts[i]
                        const min = Math.floor(ms / 60000)
                        const sec = Math.floor((ms % 60000) / 1000)
                        const msPart = ms % 1000
                        transLines.push(`[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(msPart).padStart(3, '0')}]${transText}`)
                    }
                    trans = transLines.join('\n')
                    break
                }
            }
        } catch (e) {
            console.error('KRC 翻译提取失败:', e.message)
        }
    }

    return { yrc: yrcLines.join('\n'), trans }
}

// ===== 匹配工具 =====

function matchName(query, target) {
    if (!query || !target) return false
    const q = query.toLowerCase().replace(/\s+/g, '').replace(/\(.*\)|\[.*\]|（.*）|【.*】|-.*$/g, '').trim()
    const t = target.toLowerCase().replace(/\s+/g, '').replace(/\(.*\)|\[.*\]|（.*）|【.*】|-.*$/g, '').trim()
    return q === t || q.includes(t) || t.includes(q)
}

function matchArtists(query, artists) {
    if (!query) return false
    const qArr = query.split(/[/、,，&]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    let targetArr = []
    if (Array.isArray(artists)) {
        targetArr = artists.map(a => (typeof a === 'string' ? a : a.name || '').trim().toLowerCase()).filter(Boolean)
    } else if (typeof artists === 'string') {
        targetArr = artists.split(/[/、,，&]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    }
    if (!targetArr.length) return false
    return qArr.some(q => targetArr.some(t => q.includes(t) || t.includes(q)))
}

// ===== QQ 音乐 =====

let _qqComm = null

async function qqInitSession() {
    if (_qqComm) return _qqComm
    const comm = {
        ct: 11, cv: '1003006', v: '1003006', os_ver: '15',
        phonetype: '24122RKC7C', tmeAppID: 'qqmusiclight',
        nettype: 'NETWORK_WIFI', udid: '0'
    }
    const body = {
        comm,
        request: { method: 'GetSession', module: 'music.getSession.session', param: { caller: 0, uid: '0', vkey: 0 } }
    }
    const res = JSON.parse(await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', body))
    if (res.code !== 0 || res.request?.code !== 0) throw new Error('QQ session 初始化失败')
    const sess = res.request.data.session
    _qqComm = { ...comm, uid: sess.uid, sid: sess.sid, userip: sess.userip }
    return _qqComm
}

async function searchQQSongs(keyword, limit = 10) {
    const comm = await qqInitSession()
    const body = {
        comm,
        request: {
            method: 'DoSearchForQQMusicLite',
            module: 'music.search.SearchCgiService',
            param: {
                query: keyword, search_type: 0, num_per_page: limit,
                page_num: 1, highlight: 0, nqc_flag: 0, page_id: 1, grp: 1,
                remoteplace: 'search.android.keyboard', search_id: String(Date.now())
            }
        }
    }
    const res = JSON.parse(await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', body))
    const list = res?.request?.data?.body?.item_song || []
    return list.map(s => ({
        id: s.id,
        songmid: s.mid,
        songname: s.title,
        singer: (s.singer || []).map(si => si.name),
        album: s.album?.name || '',
        interval: s.interval,
        source: 'qq'
    }))
}

async function getQQLyric(songId, songName, artist, album, interval) {
    const comm = await qqInitSession()
    const body = {
        comm,
        request: {
            method: 'GetPlayLyricInfo',
            module: 'music.musichallSong.PlayLyricInfo',
            param: {
                albumName: Buffer.from(album || '').toString('base64'),
                crypt: 1, ct: 19, cv: 2111,
                interval: interval || 0,
                lrc_t: 0, qrc: 1, qrc_t: 0, roma: 1, roma_t: 0,
                singerName: Buffer.from(artist || '').toString('base64'),
                songID: songId,
                songName: Buffer.from(songName || '').toString('base64'),
                trans: 1, trans_t: 0, type: 0
            }
        }
    }
    const res = JSON.parse(await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', body))
    const ld = res?.request?.data
    if (!ld) return { lrc: '', yrc: '', trans: '' }

    let yrc = '', lrc = '', trans = ''

    // 歌词（加密的 QRC）
    if (ld.lyric && ld.qrc_t !== 0) {
        try {
            const decrypted = qrcDecrypt(ld.lyric)
            yrc = qrcToYrc(decrypted)
        } catch (e) {
            console.error('QRC 解密失败:', e.message)
        }
    }

    // 翻译歌词（也可能加密）
    if (ld.trans && ld.trans_t !== 0) {
        try {
            trans = qrcDecrypt(ld.trans)
            // 翻译是普通 LRC 格式，不需要转 YRC
        } catch (e) {
            trans = ''
        }
    }

    return { lrc, yrc, trans }
}

// ===== 酷狗音乐 =====

async function searchKugouSongs(keyword, limit = 10) {
    const url = `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=${limit}&format=json`
    const buf = await fetch(url)
    const json = JSON.parse(buf.toString('utf-8'))
    const list = json?.data?.info || []
    return list.map(s => ({
        id: s.hash,
        hash: s.hash,
        songname: s.songname,
        singer: s.singername ? s.singername.split(/[、,&]/).map(x => x.trim()) : [],
        album: s.album_name || '',
        duration: s.duration,
        source: 'kugou'
    }))
}

async function getKugouLyric(hash) {
    // 搜索歌词候选
    const searchUrl = `http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&hash=${hash}&duration=&album_audio_id=`
    const searchBuf = await fetch(searchUrl)
    const searchJson = JSON.parse(searchBuf.toString('utf-8'))
    const candidates = searchJson?.candidates || []
    if (!candidates.length) return { lrc: '', yrc: '', trans: '' }

    const c = candidates[0]
    // 下载 KRC 格式歌词（逐字）
    const dlUrl = `http://lyrics.kugou.com/download?ver=1&client=mobi&id=${c.id}&accesskey=${c.accesskey}&fmt=krc&charset=utf8`
    const dlBuf = await fetch(dlUrl)
    const dlJson = JSON.parse(dlBuf.toString('utf-8'))

    if (!dlJson.content) return { lrc: '', yrc: '', trans: '' }

    // contenttype=2 表示纯文本歌词，否则是加密的 KRC
    if (dlJson.contenttype === 2) {
        const lrc = Buffer.from(dlJson.content, 'base64').toString('utf-8')
        return { lrc, yrc: '', trans: '' }
    }

    try {
        const decrypted = krcDecrypt(dlJson.content)
        const { yrc, trans } = krcToYrcAndTrans(decrypted)
        return { lrc: '', yrc, trans }
    } catch (e) {
        console.error('KRC 解密失败:', e.message)
        return { lrc: '', yrc: '', trans: '' }
    }
}

// ===== 对外接口 =====

// 多平台并行搜索（本地歌曲用）
// 作者对不上时用纯歌名模糊搜索，合并结果让用户选
async function searchMultiPlatform(songName, artist) {
    const fullKeyword = artist ? `${songName} ${artist}` : songName

    const [qqRes, kgRes] = await Promise.allSettled([
        searchQQSongs(fullKeyword, 30),
        searchKugouSongs(fullKeyword, 30)
    ])

    let qqList = qqRes.status === 'fulfilled' ? qqRes.value : []
    let kgList = kgRes.status === 'fulfilled' ? kgRes.value : []

    // 如果带作者搜索结果少于3条或作者不匹配，用纯歌名模糊搜索补充
    const qqArtistMatched = qqList.some(s => matchArtists(artist, s.singer))
    const kgArtistMatched = kgList.some(s => matchArtists(artist, s.singer))

    if (artist && (!qqArtistMatched || qqList.length < 3 || !kgArtistMatched || kgList.length < 3)) {
        const [qqRes2, kgRes2] = await Promise.allSettled([
            !qqArtistMatched || qqList.length < 3 ? searchQQSongs(songName, 30) : Promise.resolve([]),
            !kgArtistMatched || kgList.length < 3 ? searchKugouSongs(songName, 30) : Promise.resolve([])
        ])
        const qqList2 = qqRes2.status === 'fulfilled' ? qqRes2.value : []
        const kgList2 = kgRes2.status === 'fulfilled' ? kgRes2.value : []

        const qqIds = new Set(qqList.map(s => s.id))
        qqList = [...qqList, ...qqList2.filter(s => !qqIds.has(s.id))].slice(0, 30)
        const kgIds = new Set(kgList.map(s => s.id))
        kgList = [...kgList, ...kgList2.filter(s => !kgIds.has(s.id))].slice(0, 30)
    }

    return {
        qq: qqList,
        kugou: kgList,
        errors: {
            qq: qqRes.status === 'rejected' ? qqRes.reason?.message : null,
            kugou: kgRes.status === 'rejected' ? kgRes.reason?.message : null
        }
    }
}

// 按候选获取歌词（本地歌曲用户选中后调用）
async function fetchLyricByCandidate(candidate) {
    if (candidate.source === 'qq') {
        return await getQQLyric(candidate.id, candidate.songname, candidate.singer?.join('、'), candidate.album, candidate.interval)
    } else if (candidate.source === 'kugou') {
        return await getKugouLyric(candidate.hash || candidate.id)
    }
    return { lrc: '', yrc: '', trans: '' }
}

// 线上歌曲用：QQ 音乐歌词获取（匹配作者+歌名+时长，不一致返回 matched:false）
// 时长差 ≤2 秒视为匹配（QQ interval 单位为秒）
async function searchAndFetchQQ(songName, artist, duration) {
    const songs = await searchQQSongs(artist ? `${songName} ${artist}` : songName, 10)
    if (!songs.length) return { matched: false }

    // 1. 歌名+歌手+时长都匹配（最优先）
    let target = null
    if (duration && duration > 0) {
        target = songs.find(s =>
            matchName(songName, s.songname) &&
            matchArtists(artist, s.singer) &&
            Math.abs((s.interval || 0) - duration) <= 2
        )
    }

    // 2. 歌名+歌手匹配（无时长校验）
    if (!target) {
        target = songs.find(s =>
            matchName(songName, s.songname) && matchArtists(artist, s.singer)
        )
    }

    // 3. 歌名匹配+时长匹配
    if (!target && duration && duration > 0) {
        target = songs.find(s =>
            matchName(songName, s.songname) &&
            Math.abs((s.interval || 0) - duration) <= 2
        )
    }

    // 4. 仅歌名匹配（最后兜底）
    if (!target) {
        target = songs.find(s => matchName(songName, s.songname))
    }

    if (!target) return { matched: false }

    const lyric = await getQQLyric(target.id, target.songname, target.singer?.join('、'), target.album, target.interval)
    if (!lyric.lrc && !lyric.yrc) return { matched: false }

    return {
        matched: true,
        strictMatch: true,
        lrc: lyric.lrc,
        yrc: lyric.yrc,
        trans: lyric.trans
    }
}

export {
    searchMultiPlatform,
    fetchLyricByCandidate,
    searchAndFetchQQ,
    searchQQSongs,
    getQQLyric,
    searchKugouSongs,
    getKugouLyric
}
