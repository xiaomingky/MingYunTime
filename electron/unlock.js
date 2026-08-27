// electron/unlock.js
// 音乐格式解锁（还原）：网易云 .ncm / QQ音乐 .qmc* .mflac .mgg .mgg2 / 酷狗 .kgm .kgma .vpr
// 纯本地字节还原，不转码（无损还原原生 FLAC/MP3/OGG 等），零外部依赖（Node 内置 crypto）
// 算法移植自 unlock-music（MIT License, github.com/unlock-music）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

// electron 仅在主进程可用；纯 Node 环境（如单元测试）加载时跳过 IPC 注册
const req = createRequire(import.meta.url)
let ipcMain = null
let dialog = null
try {
    const electron = req('electron')
    ipcMain = electron?.ipcMain
    dialog = electron?.dialog
} catch { ipcMain = null }

// ============ 通用：嗅探输出格式 ============
const FLAC_HEADER = [0x66, 0x4c, 0x61, 0x43]
const MP3_HEADER = [0x49, 0x44, 0x33]
const OGG_HEADER = [0x4f, 0x67, 0x67, 0x53]
const M4A_HEADER = [0x66, 0x74, 0x79, 0x70]
const WAV_HEADER = [0x52, 0x49, 0x46, 0x46]
const WMA_HEADER = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]
const AAC_HEADER = [0xff, 0xf1]
const DFF_HEADER = [0x46, 0x52, 0x4d, 0x38]

function sniffAudioExt(data, fallback_ext = 'mp3') {
    const has = (prefix) => prefix.every((v, idx) => v === data[idx])
    if (has(MP3_HEADER)) return 'mp3'
    if (has(FLAC_HEADER)) return 'flac'
    if (has(OGG_HEADER)) return 'ogg'
    if (data.length >= 4 + M4A_HEADER.length && has(M4A_HEADER)) return 'm4a'
    if (has(WAV_HEADER)) return 'wav'
    if (has(WMA_HEADER)) return 'wma'
    if (has(AAC_HEADER)) return 'aac'
    if (has(DFF_HEADER)) return 'dff'
    return fallback_ext
}

// ============ 网易云 NCM ============
const CORE_KEY = Buffer.from('687a4852416d736f356b496e62617857', 'hex')
const META_KEY = Buffer.from('2331346C6A6B5F215C5D2630553C2728', 'hex')
const NCM_MAGIC = [0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]

function aesEcbDecrypt(cipher, key) {
    const d = crypto.createDecipheriv('aes-128-ecb', key, null)
    d.setAutoPadding(true)
    return Buffer.concat([d.update(cipher), d.final()])
}

function decryptNcm(buf) {
    if (!NCM_MAGIC.every((v, i) => v === buf[i])) throw new Error('无效的 NCM 文件（头损坏）')
    let offset = 10

    // ---- 核心 key ----
    const keyLen = buf.readUInt32LE(offset); offset += 4
    const cipherText = Buffer.alloc(keyLen)
    for (let i = 0; i < keyLen; i++) cipherText[i] = buf[offset + i] ^ 0x64
    offset += keyLen
    const plainText = aesEcbDecrypt(cipherText, CORE_KEY)
    const keyData = plainText.subarray(17)

    // RC4 keyBox（255 字节）
    const box = new Uint8Array(256)
    for (let i = 0; i < 256; i++) box[i] = i
    let j = 0
    for (let i = 0; i < 256; i++) {
        j = (box[i] + j + keyData[i % keyData.length]) & 0xff
        const t = box[i]; box[i] = box[j]; box[j] = t
    }
    const keyBox = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
        const si2 = box[(i + 1) & 0xff]
        const sj = box[(i + 1 + si2) & 0xff]
        keyBox[i] = box[(si2 + sj) & 0xff]
    }

    // ---- 元数据（取内部格式，可选）----
    let oriMeta = {}
    if (offset + 4 <= buf.length) {
        const metaDataLen = buf.readUInt32LE(offset); offset += 4
        if (metaDataLen > 0 && offset + metaDataLen <= buf.length) {
            const metaCipher = Buffer.alloc(metaDataLen)
            for (let i = 0; i < metaDataLen; i++) metaCipher[i] = buf[offset + i] ^ 0x63
            offset += metaDataLen
            try {
                const metaPlain = aesEcbDecrypt(Buffer.from(metaCipher.subarray(22).toString('base64'), 'base64'), META_KEY).toString('utf8')
                const labelIndex = metaPlain.indexOf(':')
                const parsed = labelIndex >= 0 ? JSON.parse(metaPlain.slice(labelIndex + 1)) : {}
                if (metaPlain.slice(0, labelIndex) === 'dj' && parsed.mainMusic) oriMeta = parsed.mainMusic
                else oriMeta = parsed
            } catch (e) { /* 元数据解析失败不阻塞解密 */ }
        }
    }

    // ---- 音频主体（跳过 CRC32(4) + 未知区(5) + 封面图(4+len)）----
    if (offset + 13 > buf.length) throw new Error('NCM 文件不完整')
    const coverSize = buf.readUInt32LE(offset + 9)
    let cover = null
    if (coverSize > 0 && offset + 13 + coverSize <= buf.length) {
        cover = Buffer.from(buf.subarray(offset + 13, offset + 13 + coverSize))
    }
    offset += coverSize + 13
    if (offset > buf.length) throw new Error('NCM 文件不完整')
    const audio = new Uint8Array(buf.buffer, buf.byteOffset + offset, buf.length - offset)
    const len = audio.length
    for (let cur = 0; cur < len; cur++) audio[cur] ^= keyBox[cur & 0xff]

    const out = Buffer.from(audio.buffer, audio.byteOffset, audio.length)
    const format = oriMeta.format || sniffAudioExt(out)
    return { data: out, format, meta: oriMeta, cover }
}

// ============ QQ音乐 QMC（纯 JS：static/map/RC4 + TEA 派生）============
//prettier-ignore
const QMC_STATIC_BOX = new Uint8Array([
    0x77, 0x48, 0x32, 0x73, 0xDE, 0xF2, 0xC0, 0xC8, 0x95, 0xEC, 0x30, 0xB2, 0x51, 0xC3, 0xE1, 0xA0,
    0x9E, 0xE6, 0x9D, 0xCF, 0xFA, 0x7F, 0x14, 0xD1, 0xCE, 0xB8, 0xDC, 0xC3, 0x4A, 0x67, 0x93, 0xD6,
    0x28, 0xC2, 0x91, 0x70, 0xCA, 0x8D, 0xA2, 0xA4, 0xF0, 0x08, 0x61, 0x90, 0x7E, 0x6F, 0xA2, 0xE0,
    0xEB, 0xAE, 0x3E, 0xB6, 0x67, 0xC7, 0x92, 0xF4, 0x91, 0xB5, 0xF6, 0x6C, 0x5E, 0x84, 0x40, 0xF7,
    0xF3, 0x1B, 0x02, 0x7F, 0xD5, 0xAB, 0x41, 0x89, 0x28, 0xF4, 0x25, 0xCC, 0x52, 0x11, 0xAD, 0x43,
    0x68, 0xA6, 0x41, 0x8B, 0x84, 0xB5, 0xFF, 0x2C, 0x92, 0x4A, 0x26, 0xD8, 0x47, 0x6A, 0x7C, 0x95,
    0x61, 0xCC, 0xE6, 0xCB, 0xBB, 0x3F, 0x47, 0x58, 0x89, 0x75, 0xC3, 0x75, 0xA1, 0xD9, 0xAF, 0xCC,
    0x08, 0x73, 0x17, 0xDC, 0xAA, 0x9A, 0xA2, 0x16, 0x41, 0xD8, 0xA2, 0x06, 0xC6, 0x8B, 0xFC, 0x66,
    0x34, 0x9F, 0xCF, 0x18, 0x23, 0xA0, 0x0A, 0x74, 0xE7, 0x2B, 0x27, 0x70, 0x92, 0xE9, 0xAF, 0x37,
    0xE6, 0x8C, 0xA7, 0xBC, 0x62, 0x65, 0x9C, 0xC2, 0x08, 0xC9, 0x88, 0xB3, 0xF3, 0x43, 0xAC, 0x74,
    0x2C, 0x0F, 0xD4, 0xAF, 0xA1, 0xC3, 0x01, 0x64, 0x95, 0x4E, 0x48, 0x9F, 0xF4, 0x35, 0x78, 0x95,
    0x7A, 0x39, 0xD6, 0x6A, 0xA0, 0x6D, 0x40, 0xE8, 0x4F, 0xA8, 0xEF, 0x11, 0x1D, 0xF3, 0x1B, 0x3F,
    0x3F, 0x07, 0xDD, 0x6F, 0x5B, 0x19, 0x30, 0x19, 0xFB, 0xEF, 0x0E, 0x37, 0xF0, 0x0E, 0xCD, 0x16,
    0x49, 0xFE, 0x53, 0x47, 0x13, 0x1A, 0xBD, 0xA4, 0xF1, 0x40, 0x19, 0x60, 0x0E, 0xED, 0x68, 0x09,
    0x06, 0x5F, 0x4D, 0xCF, 0x3D, 0x1A, 0xFE, 0x20, 0x77, 0xE4, 0xD9, 0xDA, 0xF9, 0xA4, 0x2B, 0x76,
    0x1C, 0x71, 0xDB, 0x00, 0xBC, 0xFD, 0x0C, 0x6C, 0xA5, 0x47, 0xF7, 0xF6, 0x00, 0x79, 0x4A, 0x11,
])

function qmcStaticGetMask(offset) {
    if (offset > 0x7fff) offset %= 0x7fff
    return QMC_STATIC_BOX[(offset * offset + 27) & 0xff]
}

// TEA（数据块 8B，key 16B）
class TeaCipher {
    constructor(key, rounds = 64) {
        const k = new DataView(key.buffer, key.byteOffset, key.byteLength)
        this.k0 = k.getUint32(0, false); this.k1 = k.getUint32(4, false)
        this.k2 = k.getUint32(8, false); this.k3 = k.getUint32(12, false)
        this.rounds = rounds
    }
    // 原地解密 8 字节块（Uint32Array [hi, lo]）
    decryptBlock(blk) {
        const delta = 0x9e3779b9
        let v0 = blk[0] >>> 0, v1 = blk[1] >>> 0
        let sum = (delta * this.rounds) / 2
        for (let i = 0; i < this.rounds / 2; i++) {
            v1 = ((v1 - ((((v0 << 4) + this.k2) ^ (v0 + sum) ^ ((v0 >>> 5) + this.k3)) >>> 0)) >>> 0)
            v0 = ((v0 - ((((v1 << 4) + this.k0) ^ (v1 + sum) ^ ((v1 >>> 5) + this.k1)) >>> 0)) >>> 0)
            sum = (sum - delta) >>> 0
        }
        blk[0] = v0; blk[1] = v1
    }
}

const QMC_SALT_LEN = 2
const QMC_ZERO_LEN = 7

// CBC 模式解密（移植自 qmc_key.ts 的 decryptTencentTea）
function teaDecryptCbc(inBuf, key) {
    if (inBuf.length % 8 !== 0) throw new Error('inBuf size not a multiple of the block size')
    if (inBuf.length < 16) throw new Error('inBuf size too small')
    const tea = new TeaCipher(key, 32)

    const u8 = inBuf instanceof Uint8Array ? inBuf : new Uint8Array(inBuf)
    const toU32 = (b, off) => new Uint32Array(u8.subarray(off, off + 8).buffer.slice().buffer)[0] !== undefined
        ? u8[off] + (u8[off + 1] << 8) + (u8[off + 2] << 16) + (u8[off + 3] << 24) >>> 0
        : 0
    // 使用显式字节读取，避免对齐问题
    const readU32 = (off) => (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0
    const writeU32 = (blk, off, v) => {
        blk[off] = (v >>> 24) & 0xff; blk[off + 1] = (v >>> 16) & 0xff; blk[off + 2] = (v >>> 8) & 0xff; blk[off + 3] = v & 0xff
    }

    // 解密首块
    const first = new Uint8Array(8)
    writeU32(first, 0, readU32(0)); writeU32(first, 4, readU32(4))
    const fBlk = new Uint32Array(2)
    fBlk[0] = readU32(0); fBlk[1] = readU32(4)
    tea.decryptBlock(fBlk)
    const nPadLen = fBlk[0] & 0x7
    const outLen = inBuf.length - 1 - nPadLen - QMC_SALT_LEN - QMC_ZERO_LEN
    if (outLen < 0) throw new Error('bad tea block')
    const outBuf = new Uint8Array(outLen)

    const tmpBuf = new Uint8Array(8)
    writeU32(tmpBuf, 0, fBlk[0]); writeU32(tmpBuf, 4, fBlk[1])
    let ivPrev = new Uint8Array(8)
    let ivCur = new Uint8Array(u8.subarray(0, 8))
    let inBufPos = 8
    let tmpIdx = 1 + nPadLen

    const cryptBlock = () => {
        ivPrev = ivCur
        ivCur = new Uint8Array(u8.subarray(inBufPos, inBufPos + 8))
        const tb = new Uint32Array(2)
        tb[0] = (readU32(0) === undefined ? 0 : ((tmpBuf[0] << 24 | tmpBuf[1] << 16 | tmpBuf[2] << 8 | tmpBuf[3]) ^ (ivCur[0] << 24 | ivCur[1] << 16 | ivCur[2] << 8 | ivCur[3]))) >>> 0
        tb[1] = ((tmpBuf[4] << 24 | tmpBuf[5] << 16 | tmpBuf[6] << 8 | tmpBuf[7]) ^ (ivCur[4] << 24 | ivCur[5] << 16 | ivCur[6] << 8 | ivCur[7])) >>> 0
        tea.decryptBlock(tb)
        writeU32(tmpBuf, 0, tb[0]); writeU32(tmpBuf, 4, tb[1])
        inBufPos += 8
        tmpIdx = 0
    }

    for (let i = 1; i <= QMC_SALT_LEN;) {
        if (tmpIdx < 8) { tmpIdx++; i++ } else cryptBlock()
    }
    let outBufPos = 0
    while (outBufPos < outLen) {
        if (tmpIdx < 8) { outBuf[outBufPos] = tmpBuf[tmpIdx] ^ ivPrev[tmpIdx]; outBufPos++; tmpIdx++ }
        else cryptBlock()
    }
    for (let i = 1; i <= QMC_ZERO_LEN; i++) {
        if (tmpBuf[tmpIdx] !== ivPrev[tmpIdx]) throw new Error('zero check failed')
    }
    return outBuf
}

function qmcSimpleMakeKey(salt, length) {
    const keyBuf = new Array(length)
    for (let i = 0; i < length; i++) keyBuf[i] = 0xff & (Math.abs(Math.tan(salt + i * 0.1)) * 100.0)
    return keyBuf
}

const QMC_MIX_KEY_1 = new Uint8Array([0x33, 0x38, 0x36, 0x5A, 0x4A, 0x59, 0x21, 0x40, 0x23, 0x2A, 0x24, 0x25, 0x5E, 0x26, 0x29, 0x28])
const QMC_MIX_KEY_2 = new Uint8Array([0x2A, 0x2A, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25, 0x26, 0x5E, 0x61, 0x31, 0x63, 0x5A, 0x2C, 0x54])

// 恢复 EncV2 key：QQMusic EncV2,Key: 开头的二次 TEA + base64
function decryptQmcRawKey(rawDec /* Buffer */) {
    if (rawDec.length < 18 || rawDec.subarray(0, 18).toString('latin1') !== 'QQMusic EncV2,Key:') return rawDec
    let out = teaDecryptCbc(rawDec.subarray(18), QMC_MIX_KEY_1)
    out = teaDecryptCbc(out, QMC_MIX_KEY_2)
    const keyDec = Buffer.from(out.toString('latin1'), 'base64')
    if (keyDec.length < 16) throw new Error('EncV2 key decode failed')
    return keyDec
}

function qmcDeriveKey(raw /* Buffer */) {
    let rawDec = Buffer.from(raw.toString('latin1'), 'base64')
    if (rawDec.length < 16) throw new Error('key length is too short')
    rawDec = decryptQmcRawKey(rawDec)
    const simpleKey = qmcSimpleMakeKey(106, 8)
    const teaKey = new Uint8Array(16)
    for (let i = 0; i < 8; i++) { teaKey[i << 1] = simpleKey[i]; teaKey[(i << 1) + 1] = rawDec[i] }
    const teaKeyBuf = Buffer.from(teaKey)
    const sub = teaDecryptCbc(rawDec.subarray(8), teaKeyBuf)
    const keyOut = new Uint8Array(8 + sub.length)
    keyOut.set(rawDec.subarray(0, 8), 0)
    keyOut.set(sub, 8)
    return keyOut
}

// Map 密码
function qmcMapRotate(value, bits) {
    const r = (bits + 4) % 8
    return (((value << r) | (value >> r)) & 0xff)
}
function qmcMapMask(key, n, offset) {
    if (offset > 0x7fff) offset %= 0x7fff
    const idx = (offset * offset + 71214) % n
    return qmcMapRotate(key[idx], idx & 0x7)
}

// RC4 密码
const QMC_FIRST_SEG = 0x80
const QMC_SEG_SIZE = 5120
class QmcRC4 {
    constructor(key) {
        this.key = key
        this.N = key.length
        this.S = new Uint8Array(this.N)
        for (let i = 0; i < this.N; ++i) this.S[i] = i & 0xff
        let j = 0
        for (let i = 0; i < this.N; ++i) {
            j = (this.S[i] + j + this.key[i % this.N]) % this.N
            const t = this.S[i]; this.S[i] = this.S[j]; this.S[j] = t
        }
        this.hash = 1
        for (let i = 0; i < this.N; i++) {
            const value = this.key[i]
            if (!value) continue
            const next_hash = (this.hash * value) >>> 0
            if (next_hash === 0 || next_hash <= this.hash) break
            this.hash = next_hash
        }
    }
    getSegmentKey(id) { return Math.floor((this.hash / ((id + 1) * this.key[id % this.N])) * 100.0) % this.N }
    decrypt(buf, offset) {
        let toProcess = buf.length
        let processed = 0
        const post = (len) => { toProcess -= len; processed += len; offset += len; return toProcess === 0 }
        if (offset < QMC_FIRST_SEG) {
            const len_seg = Math.min(buf.length, QMC_FIRST_SEG - offset)
            this.encFirstSegment(buf.subarray(0, len_seg), offset)
            if (post(len_seg)) return
        }
        if (offset % QMC_SEG_SIZE !== 0) {
            const len_seg = Math.min(QMC_SEG_SIZE - (offset % QMC_SEG_SIZE), toProcess)
            this.encASegment(buf.subarray(processed, processed + len_seg), offset)
            if (post(len_seg)) return
        }
        while (toProcess > QMC_SEG_SIZE) {
            this.encASegment(buf.subarray(processed, processed + QMC_SEG_SIZE), offset)
            post(QMC_SEG_SIZE)
        }
        if (toProcess > 0) this.encASegment(buf.subarray(processed), offset)
    }
    encFirstSegment(buf, offset) {
        for (let i = 0; i < buf.length; i++) buf[i] ^= this.key[this.getSegmentKey(offset + i)]
    }
    encASegment(buf, offset) {
        const S = Uint8Array.from(this.S)
        const skipLen = (offset % QMC_SEG_SIZE) + this.getSegmentKey(Math.floor(offset / QMC_SEG_SIZE))
        let j = 0, k = 0
        for (let i = -skipLen; i < buf.length; i++) {
            j = (j + 1) % this.N
            k = (S[j] + k) % this.N
            const t = S[k]; S[k] = S[j]; S[j] = t
            if (i >= 0) buf[i] ^= S[(S[j] + S[k]) % this.N]
        }
    }
}

function decryptQmc(buf /* Buffer */) {
    const size = buf.length
    const last4 = size >= 4 ? buf.subarray(size - 4).toString('latin1') : ''
    let audioSize, cipher = null
    if (last4 === 'STag') {
        // QQ音乐新版加密（Android v11.6+）：文件尾部通常只有
        // {songId},{版本},{资源ID} 元数据，不含解密密钥（密钥需线上 API 动态获取）。
        // 少数变体与 QTag 同布局（内嵌密钥），先按 QTag 布局尝试提取，失败则明确提示。
        if (size >= 8) {
            const ks = buf.readUInt32BE(size - 8)
            if (ks > 0 && ks < 0x400 && size - ks - 8 > 0) {
                const rawKey = buf.subarray(size - ks - 8, size - 8)
                const keyEnd = rawKey.indexOf(0x2c)
                if (keyEnd >= 4) {
                    audioSize = size - ks - 8
                    cipher = rawKey.subarray(0, keyEnd)
                }
            }
        }
        if (cipher === null) throw new Error('QQ音乐新版加密（STag）需在线获取密钥，暂不支持离线转换')
    } else if (last4 === 'QTag') {
        const keySize = buf.readUInt32BE(size - 8)
        audioSize = size - keySize - 8
        const rawKey = buf.subarray(audioSize, size - 8)
        const keyEnd = rawKey.indexOf(0x2c)
        if (keyEnd < 0) throw new Error('invalid key: search raw key failed')
        cipher = rawKey.subarray(0, keyEnd)
    } else {
        const keySize = size >= 4 ? buf.readUInt32LE(size - 4) : 0
        if (keySize < 0x400) {
            audioSize = size - keySize - 4
            cipher = buf.subarray(audioSize, size - 4)
        } else {
            audioSize = size
            cipher = null
        }
    }
    if (audioSize <= 0 || audioSize > size) throw new Error('invalid qmc audio size')
    // 使用底层 ArrayBuffer 视图就地异或（new Uint8Array(buf) 会拷贝，异或结果丢失）
    const u = new Uint8Array(buf.buffer, buf.byteOffset, audioSize)

    if (cipher === null) {
        for (let i = 0; i < audioSize; i++) u[i] ^= qmcStaticGetMask(i)
    } else {
        let keyDec
        try {
            keyDec = qmcDeriveKey(Buffer.from(cipher))
        } catch (e) {
            if (last4 === 'STag') throw new Error('QQ音乐新版加密（STag）需在线获取密钥，暂不支持离线转换')
            throw e
        }
        if (keyDec.length > 300) {
            const rc4 = new QmcRC4(keyDec)
            rc4.decrypt(u, 0)
        } else {
            const n = keyDec.length
            for (let i = 0; i < audioSize; i++) u[i] ^= qmcMapMask(keyDec, n, i)
        }
    }
    return Buffer.from(u.buffer, u.byteOffset, audioSize)
}

// ============ 酷狗 KGM / KGMA / VPR ============
const VPR_HEADER = [0x05, 0x28, 0xBC, 0x96, 0xE9, 0xE4, 0x5A, 0x43, 0x91, 0xAA, 0xBD, 0xD0, 0x7A, 0xF5, 0x36, 0x31]
const KGM_HEADER = [0x7C, 0xD5, 0x32, 0xEB, 0x86, 0x02, 0x7F, 0x4B, 0xA8, 0xAF, 0xA6, 0x8E, 0x0F, 0xFF, 0x99, 0x14]
const VPR_MASK_DIFF = [0x25, 0xDF, 0xE8, 0xA6, 0x75, 0x1E, 0x75, 0x0E, 0x2F, 0x80, 0xF3, 0x2D, 0xB8, 0xB6, 0xE3, 0x11, 0x00]

//prettier-ignore
const KGM_TABLE1 = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x21, 0x01, 0x61, 0x01, 0x21, 0x01, 0xe1, 0x01, 0x21, 0x01, 0x61, 0x01, 0x21, 0x01,
    0xd2, 0x23, 0x02, 0x02, 0x42, 0x42, 0x02, 0x02, 0xc2, 0xc2, 0x02, 0x02, 0x42, 0x42, 0x02, 0x02,
    0xd3, 0xd3, 0x02, 0x03, 0x63, 0x43, 0x63, 0x03, 0xe3, 0xc3, 0xe3, 0x03, 0x63, 0x43, 0x63, 0x03,
    0x94, 0xb4, 0x94, 0x65, 0x04, 0x04, 0x04, 0x04, 0x84, 0x84, 0x84, 0x84, 0x04, 0x04, 0x04, 0x04,
    0x95, 0x95, 0x95, 0x95, 0x04, 0x05, 0x25, 0x05, 0xe5, 0x85, 0xa5, 0x85, 0xe5, 0x05, 0x25, 0x05,
    0xd6, 0xb6, 0x96, 0xb6, 0xd6, 0x27, 0x06, 0x06, 0xc6, 0xc6, 0x86, 0x86, 0xc6, 0xc6, 0x06, 0x06,
    0xd7, 0xd7, 0x97, 0x97, 0xd7, 0xd7, 0x06, 0x07, 0xe7, 0xc7, 0xe7, 0x87, 0xe7, 0xc7, 0xe7, 0x07,
    0x18, 0x38, 0x18, 0x78, 0x18, 0x38, 0x18, 0xe9, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
    0x19, 0x19, 0x19, 0x19, 0x19, 0x19, 0x19, 0x19, 0x08, 0x09, 0x29, 0x09, 0x69, 0x09, 0x29, 0x09,
    0xda, 0x3a, 0x1a, 0x3a, 0x5a, 0x3a, 0x1a, 0x3a, 0xda, 0x2b, 0x0a, 0x0a, 0x4a, 0x4a, 0x0a, 0x0a,
    0xdb, 0xdb, 0x1b, 0x1b, 0x5b, 0x5b, 0x1b, 0x1b, 0xdb, 0xdb, 0x0a, 0x0b, 0x6b, 0x4b, 0x6b, 0x0b,
    0x9c, 0xbc, 0x9c, 0x7c, 0x1c, 0x3c, 0x1c, 0x7c, 0x9c, 0xbc, 0x9c, 0x6d, 0x0c, 0x0c, 0x0c, 0x0c,
    0x9d, 0x9d, 0x9d, 0x9d, 0x1d, 0x1d, 0x1d, 0x1d, 0x9d, 0x9d, 0x9d, 0x9d, 0x0c, 0x0d, 0x2d, 0x0d,
    0xde, 0xbe, 0x9e, 0xbe, 0xde, 0x3e, 0x1e, 0x3e, 0xde, 0xbe, 0x9e, 0xbe, 0xde, 0x2f, 0x0e, 0x0e,
    0xdf, 0xdf, 0x9f, 0x9f, 0xdf, 0xdf, 0x1f, 0x1f, 0xdf, 0xdf, 0x9f, 0x9f, 0xdf, 0xdf, 0x0e, 0x0f,
    0x00, 0x20, 0x00, 0x60, 0x00, 0x20, 0x00, 0xe0, 0x00, 0x20, 0x00, 0x60, 0x00, 0x20, 0x00, 0xf1,
]
//prettier-ignore
const KGM_TABLE2 = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x23, 0x01, 0x67, 0x01, 0x23, 0x01, 0xef, 0x01, 0x23, 0x01, 0x67, 0x01, 0x23, 0x01,
    0xdf, 0x21, 0x02, 0x02, 0x46, 0x46, 0x02, 0x02, 0xce, 0xce, 0x02, 0x02, 0x46, 0x46, 0x02, 0x02,
    0xde, 0xde, 0x02, 0x03, 0x65, 0x47, 0x65, 0x03, 0xed, 0xcf, 0xed, 0x03, 0x65, 0x47, 0x65, 0x03,
    0x9d, 0xbf, 0x9d, 0x63, 0x04, 0x04, 0x04, 0x04, 0x8c, 0x8c, 0x8c, 0x8c, 0x04, 0x04, 0x04, 0x04,
    0x9c, 0x9c, 0x9c, 0x9c, 0x04, 0x05, 0x27, 0x05, 0xeb, 0x8d, 0xaf, 0x8d, 0xeb, 0x05, 0x27, 0x05,
    0xdb, 0xbd, 0x9f, 0xbd, 0xdb, 0x25, 0x06, 0x06, 0xca, 0xca, 0x8e, 0x8e, 0xca, 0xca, 0x06, 0x06,
    0xda, 0xda, 0x9e, 0x9e, 0xda, 0xda, 0x06, 0x07, 0xe9, 0xcb, 0xe9, 0x8f, 0xe9, 0xcb, 0xe9, 0x07,
    0x19, 0x3b, 0x19, 0x7f, 0x19, 0x3b, 0x19, 0xe7, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
    0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x08, 0x09, 0x2b, 0x09, 0x6f, 0x09, 0x2b, 0x09,
    0xd7, 0x39, 0x1b, 0x39, 0x5f, 0x39, 0x1b, 0x39, 0xd7, 0x29, 0x0a, 0x0a, 0x4e, 0x4e, 0x0a, 0x0a,
    0xd6, 0xd6, 0x1a, 0x1a, 0x5e, 0x5e, 0x1a, 0x1a, 0xd6, 0xd6, 0x0a, 0x0b, 0x6d, 0x4f, 0x6d, 0x0b,
    0x95, 0xb7, 0x95, 0x7b, 0x1d, 0x3f, 0x1d, 0x7b, 0x95, 0xb7, 0x95, 0x6b, 0x0c, 0x0c, 0x0c, 0x0c,
    0x94, 0x94, 0x94, 0x94, 0x1c, 0x1c, 0x1c, 0x1c, 0x94, 0x94, 0x94, 0x94, 0x0c, 0x0d, 0x2f, 0x0d,
    0xd3, 0xb5, 0x97, 0xb5, 0xd3, 0x3d, 0x1f, 0x3d, 0xd3, 0xb5, 0x97, 0xb5, 0xd3, 0x2d, 0x0e, 0x0e,
    0xd2, 0xd2, 0x96, 0x96, 0xd2, 0xd2, 0x1e, 0x1e, 0xd2, 0xd2, 0x96, 0x96, 0xd2, 0xd2, 0x0e, 0x0f,
    0x00, 0x22, 0x00, 0x66, 0x00, 0x22, 0x00, 0xee, 0x00, 0x22, 0x00, 0x66, 0x00, 0x22, 0x00, 0xfe,
]
//prettier-ignore
const KGM_MASK_V2 = [
    0xB8, 0xD5, 0x3D, 0xB2, 0xE9, 0xAF, 0x78, 0x8C, 0x83, 0x33, 0x71, 0x51, 0x76, 0xA0, 0xCD, 0x37,
    0x2F, 0x3E, 0x35, 0x8D, 0xA9, 0xBE, 0x98, 0xB7, 0xE7, 0x8C, 0x22, 0xCE, 0x5A, 0x61, 0xDF, 0x68,
    0x69, 0x89, 0xFE, 0xA5, 0xB6, 0xDE, 0xA9, 0x77, 0xFC, 0xC8, 0xBD, 0xBD, 0xE5, 0x6D, 0x3E, 0x5A,
    0x36, 0xEF, 0x69, 0x4E, 0xBE, 0xE1, 0xE9, 0x66, 0x1C, 0xF3, 0xD9, 0x02, 0xB6, 0xF2, 0x12, 0x9B,
    0x44, 0xD0, 0x6F, 0xB9, 0x35, 0x89, 0xB6, 0x46, 0x6D, 0x73, 0x82, 0x06, 0x69, 0xC1, 0xED, 0xD7,
    0x85, 0xC2, 0x30, 0xDF, 0xA2, 0x62, 0xBE, 0x79, 0x2D, 0x62, 0x62, 0x3D, 0x0D, 0x7E, 0xBE, 0x48,
    0x89, 0x23, 0x02, 0xA0, 0xE4, 0xD5, 0x75, 0x51, 0x32, 0x02, 0x53, 0xFD, 0x16, 0x3A, 0x21, 0x3B,
    0x16, 0x0F, 0xC3, 0xB2, 0xBB, 0xB3, 0xE2, 0xBA, 0x3A, 0x3D, 0x13, 0xEC, 0xF6, 0x01, 0x45, 0x84,
    0xA5, 0x70, 0x0F, 0x93, 0x49, 0x0C, 0x64, 0xCD, 0x31, 0xD5, 0xCC, 0x4C, 0x07, 0x01, 0x9E, 0x00,
    0x1A, 0x23, 0x90, 0xBF, 0x88, 0x1E, 0x3B, 0xAB, 0xA6, 0x3E, 0xC4, 0x73, 0x47, 0x10, 0x7E, 0x3B,
    0x5E, 0xBC, 0xE3, 0x00, 0x84, 0xFF, 0x09, 0xD4, 0xE0, 0x89, 0x0F, 0x5B, 0x58, 0x70, 0x4F, 0xFB,
    0x65, 0xD8, 0x5C, 0x53, 0x1B, 0xD3, 0xC8, 0xC6, 0xBF, 0xEF, 0x98, 0xB0, 0x50, 0x4F, 0x0F, 0xEA,
    0xE5, 0x83, 0x58, 0x8C, 0x28, 0x2C, 0x84, 0x67, 0xCD, 0xD0, 0x9E, 0x47, 0xDB, 0x27, 0x50, 0xCA,
    0xF4, 0x63, 0x63, 0xE8, 0x97, 0x7F, 0x1B, 0x4B, 0x0C, 0xC2, 0xC1, 0x21, 0x4C, 0xCC, 0x58, 0xF5,
    0x94, 0x52, 0xA3, 0xF3, 0xD3, 0xE0, 0x68, 0xF4, 0x00, 0x23, 0xF3, 0x5E, 0x0A, 0x7B, 0x93, 0xDD,
    0xAB, 0x12, 0xB2, 0x13, 0xE8, 0x84, 0xD7, 0xA7, 0x9F, 0x0F, 0x32, 0x4C, 0x55, 0x1D, 0x04, 0x36,
    0x52, 0xDC, 0x03, 0xF3, 0xF9, 0x4E, 0x42, 0xE9, 0x3D, 0x61, 0xEF, 0x7C, 0xB6, 0xB3, 0x93, 0x50,
]

function kgmGetMask(pos) {
    let offset = pos >> 4
    let value = 0
    while (offset >= 0x11) {
        value ^= KGM_TABLE1[offset % 272]
        offset >>= 4
        value ^= KGM_TABLE2[offset % 272]
        offset >>= 4
    }
    return KGM_MASK_V2[pos % 272] ^ value
}

function decryptKgm(buf, isVpr) {
    const check = isVpr ? VPR_HEADER : KGM_HEADER
    if (buf.length < 44 || !check.every((v, i) => v === buf[i])) throw new Error('无效的 KGM 文件（头损坏）')
    const headerLen = buf.readUInt32LE(0x10)
    if (headerLen < 0x30 || headerLen >= buf.length) throw new Error('无效的 KGM 文件（头长度异常）')
    const key = new Uint8Array(17)
    for (let i = 0; i < 16; i++) key[i] = buf[0x1c + i]
    key[16] = 0

    const body = new Uint8Array(buf.buffer, buf.byteOffset + headerLen, buf.length - headerLen)
    const len = body.length
    for (let i = 0; i < len; i++) {
        let med8 = key[i % 17] ^ body[i]
        med8 ^= (med8 & 0xf) << 4
        let msk8 = kgmGetMask(i)
        msk8 ^= (msk8 & 0xf) << 4
        let out = med8 ^ msk8
        if (isVpr) out ^= VPR_MASK_DIFF[i % 17]
        body[i] = out
    }
    const data = Buffer.from(body.buffer, body.byteOffset, body.length)
    const format = sniffAudioExt(data, 'ogg')
    return { data, format }
}

// ============ 统一入口 ============
const LOCKED_EXTS = ['.ncm', '.qmc0', '.qmc1', '.qmc2', '.qmc3', '.qmc4', '.qmc5', '.qmc6', '.qmc8', '.qmcflac', '.qmcogg', '.mflac', '.mflac0', '.mgg', '.mgg0', '.mgg1', '.mggl', '.mgg2', '.kgm', '.kgma', '.vpr']
const EXT_LABEL = {
    '.ncm': '网易云', '.qmc0': 'QQ', '.qmc1': 'QQ', '.qmc2': 'QQ', '.qmc3': 'QQ', '.qmc4': 'QQ', '.qmc5': 'QQ', '.qmc6': 'QQ', '.qmc8': 'QQ',
    '.qmcflac': 'QQ', '.qmcogg': 'QQ', '.mflac': 'QQ', '.mflac0': 'QQ', '.mgg': 'QQ', '.mgg0': 'QQ', '.mgg1': 'QQ', '.mggl': 'QQ', '.mgg2': 'QQ',
    '.kgm': '酷狗', '.kgma': '酷狗', '.vpr': '酷狗',
}
// 加密标记（可能内嵌在文件名中，如 "xxx.kgm.flac" / "xxx [mqms2].mgg2.flac"）
const LOCKED_MARKER_RE = /\.(ncm|kgma|kgm|vpr|mggl|mgg2|mgg[01]?|mflac0?|qmc[0-9]|qmcflac|qmcogg)\b/i
// 已还原的明文音频扩展名（命中这些扩展名时需靠文件名内嵌标记判断是否为加密文件）
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.wma', '.ape', '.opus', '.aiff', '.wv'])

// 从文件路径中取出加密标记（返回 { ext, markerExt, label }）
export function detectLocked(absPath) {
    const lower = path.basename(absPath).toLowerCase()
    const ext = path.extname(absPath).toLowerCase()
    const m = lower.match(LOCKED_MARKER_RE)
    const markerExt = m ? '.' + m[1].toLowerCase() : null
    if (AUDIO_EXTS.has(ext)) {
        if (!markerExt) return null
        // 明文扩展名 + 内嵌加密标记 → 按标记解密（如 "xxx.kgm.flac"）
        return { ext, markerExt, label: EXT_LABEL[markerExt] || '其他' }
    }
    if (LOCKED_EXTS.includes(ext)) return { ext: markerExt || ext, markerExt, label: EXT_LABEL[markerExt || ext] || '其他' }
    return null
}

export function isLockedFile(absPath) {
    return detectLocked(absPath) !== null
}

function decryptOne(absPath, meta = null) {
    const det = detectLocked(absPath)
    const markerExt = det?.markerExt
    const buf = fs.readFileSync(absPath)
    if (markerExt === '.ncm' || (!markerExt && path.extname(absPath).toLowerCase() === '.ncm')) return decryptNcm(buf)
    if (markerExt === '.kgm' || markerExt === '.kgma') return decryptKgm(buf, false)
    if (markerExt === '.vpr') return decryptKgm(buf, true)
    const data = decryptQmc(buf)
    return { data, format: sniffAudioExt(data) }
}

// ============ 元数据解析（封面/标题/歌手/专辑）============
let _mmPromise = null
function getMM() {
    if (!_mmPromise) _mmPromise = import('music-metadata')
    return _mmPromise
}

// NCM 元数据中的 artist 可能是数组；封面 Buffer 转 dataURL
function ncmMetaToInfo(meta, cover) {
    let title = meta?.musicName || ''
    let artist = ''
    if (Array.isArray(meta?.artist)) artist = meta.artist.map(a => a.name || String(a)).filter(Boolean).join(' / ')
    else if (typeof meta?.artist === 'string') artist = meta.artist
    const album = meta?.album || ''
    const coverUrl = cover2DataUrl(cover)
    return { title, artist, album, cover: coverUrl }
}

// 图片 Buffer -> dataURL（支持 jpg / png / gif）
function cover2DataUrl(buf) {
    if (!buf || buf.length < 4) return ''
    const mime = (buf[0] === 0xff && buf[1] === 0xd8) ? 'image/jpeg'
        : (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ? 'image/png'
        : (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ? 'image/gif'
        : null
    if (!mime) return ''
    return `data:${mime};base64,${buf.toString('base64')}`
}

// 用 music-metadata 解析解密后的音频数据，提取 标题/歌手/专辑/封面
async function parseAudioInfo(data, format, fallback) {
    try {
        const mm = await getMM()
        const mimeType = `audio/${format === 'm4a' ? 'mp4' : format === 'wma' ? 'x-ms-wma' : format}`
        const { common } = await mm.parseBuffer(data, { mimeType })
        const pic = Array.isArray(common.picture) && common.picture[0]
        let cover = ''
        if (pic?.data) {
            const picBuf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data)
            cover = cover2DataUrl(picBuf) || `data:${pic.format || 'image/jpeg'};base64,${picBuf.toString('base64')}`
        }
        return {
            title: common.title || fallback?.title || '',
            artist: common.artist || fallback?.artist || '',
            album: common.album || fallback?.album || '',
            cover: cover || fallback?.cover || '',
        }
    } catch (e) {
        return { title: fallback?.title || '', artist: fallback?.artist || '', album: fallback?.album || '', cover: fallback?.cover || '' }
    }
}

// 输出文件名：原目录 + 同名（冲突自动补序号）→ 不覆盖原文件
function resolveOutPath(dir, base, outExt) {
    const ext2 = '.' + outExt
    if (!fs.existsSync(path.join(dir, base + ext2))) return path.join(dir, base + ext2)
    for (let i = 1; i < 1000; i++) {
        const p = path.join(dir, base + ` (${i})` + ext2)
        if (!fs.existsSync(p)) return p
    }
    return path.join(dir, base + ` (${Date.now()})` + ext2)
}

// ---------- IPC ----------
// 输出文件名基础名：去掉最终扩展名 + 内嵌加密标记（如 "xxx.kgm.flac" → "xxx"）
function outputBaseName(filePath, markerExt) {
    let base = path.basename(filePath, path.extname(filePath))
    if (markerExt) base = base.replace(new RegExp('\\' + markerExt + '$', 'i'), '')
    return base
}

if (ipcMain) {
    // 扫描目录下所有加密文件（递归）
    ipcMain.handle('unlock:scan-dir', async (_, dir) => {
        const out = []
        const walk = (d) => {
            for (const name of fs.readdirSync(d)) {
                const p = path.join(d, name)
                let st
                try { st = fs.statSync(p) } catch { continue }
                if (st.isDirectory()) walk(p)
                else {
                    const det = detectLocked(p)
                    if (det) {
                        out.push({ path: p, name, ext: det.markerExt || det.ext, size: st.size, label: det.label })
                    }
                }
            }
        }
        try { walk(dir) } catch (e) { return { success: false, error: e.message, files: [] } }
        return { success: true, files: out }
    })

    // 转换单个文件（输出到同目录，不覆盖原文件）
    ipcMain.handle('unlock:convert-file', async (_, { path: filePath }) => {
        if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
        if (!detectLocked(filePath)) return { success: false, error: '不支持的文件格式' }
        try {
            const det = detectLocked(filePath)
            const { data, format, meta } = decryptOne(filePath)
            const outExt = format || 'mp3'
            const dir = path.dirname(filePath)
            const base = outputBaseName(filePath, det.markerExt)
            const outPath = resolveOutPath(dir, base, outExt)
            fs.writeFileSync(outPath, data)
            const title = meta?.musicName || base
            const artist = Array.isArray(meta?.artist) && meta.artist.length ? String(meta.artist[0]) : ''
            return { success: true, out: outPath, outExt, title, artist, size: data.length }
        } catch (e) {
            return { success: false, error: e.message || String(e) }
        }
    })

    // 打开文件多选对话框（加密音乐），返回选中文件路径数组
    ipcMain.handle('unlock:open-files-dialog', async () => {
        if (!dialog) return []
        const extList = [...new Set([...LOCKED_EXTS.map(ext => ext.slice(1)), ...AUDIO_EXTS])].filter(x => x !== '')
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: '选择加密音乐文件（可多选）',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: '加密音乐', extensions: extList },
                { name: '所有文件', extensions: ['*'] },
            ],
        })
        if (canceled) return []
        return filePaths
    })

    // 批量解析文件信息（封面/标题/歌手/专辑），仅读取解密，不写输出文件
    // 返回与入参顺序一致的结果数组，单个失败不影响其余文件
    ipcMain.handle('unlock:parse-info', async (_, { paths }) => {
        if (!Array.isArray(paths) || paths.length === 0) return { success: true, items: [] }
        const items = []
        for (const filePath of paths) {
            try {
                if (!filePath || !fs.existsSync(filePath)) { items.push({ path: filePath, success: false, error: '文件不存在' }); continue }
                const det = detectLocked(filePath)
                if (!det) { items.push({ path: filePath, success: false, error: '不支持的文件格式' }); continue }
                const { data, format, meta, cover } = decryptOne(filePath)
                const size = fs.statSync(filePath).size
                const fb = ncmMetaToInfo(meta, cover)
                const fallback = {
                    title: fb.title || outputBaseName(filePath, det.markerExt),
                    artist: fb.artist,
                    album: fb.album,
                    cover: fb.cover,
                }
                const { title, artist, album, cover: coverUrl } = await parseAudioInfo(data, format, fallback)
                items.push({ path: filePath, success: true, size, title, artist, album, cover: coverUrl, format })
            } catch (e) {
                items.push({ path: filePath, success: false, error: e.message || String(e) })
            }
        }
        return { success: true, items }
    })
}

export function decryptOneFile(absPath) {
    return decryptOne(absPath)
}