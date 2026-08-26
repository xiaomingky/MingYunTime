// a_bogus 签名算法 v2（2026-07 新版，移植自 https://github.com/DLWangSan/douyin_parse 的 abogus.py）
// 旧版(video-parser 2024) 的 a_bogus 已被抖音风控拦截（detail 接口返回空包）；
// 新版算法变化：ua_code 硬编码固定、browser 指纹用 MacIntel、_list_4 结构不同、不需要 ua 参与签名。
// 纯 JS 实现，无外部依赖，可在 Node / Electron 主进程直接运行。
// 对外导出 generateABogusV2(paramsStr, startTime, endTime) —— paramsStr 为 urlencode 后的参数字符串，返回未 URL 编码的签名字符串。

// ---- SM3（国密哈希，独立实现，避免 Node crypto 依赖） ----
function le(e, r) {
  return (e << (r %= 32) | e >>> 32 - r) >>> 0
}
function de(e) {
  return 0 <= e && e < 16 ? 2043430169 : 16 <= e && e < 64 ? 2055708042 : void 0
}
function pe(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | r & n | t & n) >>> 0 : 0
}
function he(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | ~r & n) >>> 0 : 0
}
function reset() {
  this.reg[0] = 1937774191
  this.reg[1] = 1226093241
  this.reg[2] = 388252375
  this.reg[3] = 3666478592
  this.reg[4] = 2842636476
  this.reg[5] = 372324522
  this.reg[6] = 3817729613
  this.reg[7] = 2969243214
  this.chunk = []
  this.size = 0
}
function str2bytes(e) {
  var n = encodeURIComponent(e).replace(/%([0-9A-F]{2})/g, (function (e, r) {
    return String.fromCharCode('0x' + r)
  }))
  var a = new Array(n.length)
  Array.prototype.forEach.call(n, function (e, r) { a[r] = e.charCodeAt(0) })
  return a
}
function write(e) {
  var a = typeof e === 'string' ? str2bytes(e) : e
  this.size += a.length
  var f = 64 - this.chunk.length
  if (a.length < f) this.chunk = this.chunk.concat(a)
  else
    for (this.chunk = this.chunk.concat(a.slice(0, f)); this.chunk.length >= 64;) {
      this._compress(this.chunk)
      f < a.length ? this.chunk = a.slice(f, Math.min(f + 64, a.length)) : this.chunk = []
      f += 64
    }
}
function sum(e, t) {
  e && (this.reset(), this.write(e))
  this._fill()
  for (var f = 0; f < this.chunk.length; f += 64) this._compress(this.chunk.slice(f, f + 64))
  var i = null
  if (t === 'hex') {
    i = ''
    for (f = 0; f < 8; f++) i += se(this.reg[f].toString(16), 8, '0')
  } else {
    for (i = new Array(32), f = 0; f < 8; f++) {
      var c = this.reg[f]
      i[4 * f + 3] = (255 & c) >>> 0
      c >>>= 8
      i[4 * f + 2] = (255 & c) >>> 0
      c >>>= 8
      i[4 * f + 1] = (255 & c) >>> 0
      c >>>= 8
      i[4 * f] = (255 & c) >>> 0
    }
  }
  this.reset()
  return i
}
function _compress(t) {
  if (t < 64) return
  var f = (function (e) {
    var r = new Array(132), t = 0
    for (t = 0; t < 16; t++) {
      r[t] = e[4 * t] << 24
      r[t] |= e[4 * t + 1] << 16
      r[t] |= e[4 * t + 2] << 8
      r[t] |= e[4 * t + 3]
      r[t] >>>= 0
    }
    for (var n = 16; n < 68; n++) {
      var a = r[n - 16] ^ r[n - 9] ^ le(r[n - 3], 15)
      a = a ^ le(a, 15) ^ le(a, 23)
      r[n] = (a ^ le(r[n - 13], 7) ^ r[n - 6]) >>> 0
    }
    for (n = 0; n < 64; n++) r[n + 68] = (r[n] ^ r[n + 4]) >>> 0
    return r
  })(t)
  var i = this.reg.slice(0), c = 0
  for (c = 0; c < 64; c++) {
    var o = le(i[0], 12) + i[4] + le(de(c), c)
    var s = ((o = le(o = (4294967295 & o) >>> 0, 7)) ^ le(i[0], 12)) >>> 0
    var u = pe(c, i[0], i[1], i[2])
    u = (4294967295 & (u = u + i[3] + s + f[c + 68])) >>> 0
    var b = he(c, i[4], i[5], i[6])
    b = (4294967295 & (b = b + i[7] + o + f[c])) >>> 0
    i[3] = i[2]
    i[2] = le(i[1], 9)
    i[1] = i[0]
    i[0] = u
    i[7] = i[6]
    i[6] = le(i[5], 19)
    i[5] = i[4]
    i[4] = (b ^ le(b, 9) ^ le(b, 17)) >>> 0
  }
  for (var l = 0; l < 8; l++) this.reg[l] = (this.reg[l] ^ i[l]) >>> 0
}
function _fill() {
  var a = 8 * this.size
  var f = this.chunk.push(128) % 64
  for (64 - f < 8 && (f -= 64); f < 56; f++) this.chunk.push(0)
  var c = 0
  for (c = 0; c < 4; c++) {
    var i = Math.floor(a / 4294967296)
    this.chunk.push(i >>> 8 * (3 - c) & 255)
  }
  for (c = 0; c < 4; c++) this.chunk.push(a >>> 8 * (3 - c) & 255)
}
function se(e, r, t) {
  e = new Array(r - e.length + 1).join('0') + e
  return t ? e.slice(-r) : e.slice(-r)
}
function SM3() {
  this.reg = []
  this.chunk = []
  this.size = 0
  this.reset()
}
SM3.prototype.reset = reset
SM3.prototype.write = write
SM3.prototype.sum = sum
SM3.prototype._compress = _compress
SM3.prototype._fill = _fill

function sm3ToArray(data) {
  const sm = new SM3()
  const b = typeof data === 'string' ? str2bytes(data) : data
  sm.write(b)
  return sm.sum()
}

// ---- RC4 ----
function rc4Encrypt(plaintext, key) {
  var s = []
  for (var i = 0; i < 256; i++) s[i] = i
  var j = 0
  for (i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256
    var tmp = s[i]
    s[i] = s[j]
    s[j] = tmp
  }
  i = 0
  j = 0
  var out = []
  for (var k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256
    j = (j + s[i]) % 256
    tmp = s[i]
    s[i] = s[j]
    s[j] = tmp
    var t = (s[i] + s[j]) % 256
    out.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)))
  }
  return out.join('')
}

// ---- 版本常量（与 douyin_parse/abogus.py 逐字一致，2026-07 新版） ----
const _END = 'cus'
const _BROWSER = '1536|742|1536|864|0|0|0|0|1536|864|1536|864|1536|742|24|24|MacIntel'
// UA 特征码（Chrome 130）：对应 douyin_parse 硬编码的 ua_code
const _UA_CODE = [
  76, 98, 15, 131, 97, 245, 224, 133, 122, 199,
  241, 166, 79, 34, 90, 191, 128, 126, 122, 98,
  66, 11, 14, 40, 49, 110, 110, 173, 67, 96, 138, 252
]
const _CHARSET_S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe'

function charCodeAt(s) {
  const arr = []
  for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i))
  return arr
}

function randomList(a, b, c, d, e, f, g) {
  const r = a != null ? a : Math.random() * 10000
  const v = [r, Math.floor(r) & 255, Math.floor(r) >> 8]
  return [
    (v[1] & b) | d,
    (v[1] & c) | e,
    (v[2] & b) | f,
    (v[2] & c) | g
  ]
}
function list1(r1) { return randomList(r1, 170, 85, 1, 2, 5, 40) }
function list2(r2) { return randomList(r2, 170, 85, 1, 0, 0, 0) }
function list3(r3) { return randomList(r3, 170, 85, 1, 0, 5, 0) }

function fromCharCode(arr) {
  let s = ''
  for (const c of arr) s += String.fromCharCode(c)
  return s
}

function generateString1() {
  return fromCharCode(list1()) + fromCharCode(list2()) + fromCharCode(list3())
}

function generateParamsCode(params) {
  return sm3ToArray(sm3ToArray(params + _END))
}
function generateMethodCode(method) {
  return sm3ToArray(sm3ToArray(method + _END))
}
function endCheckNum(arr) {
  let r = 0
  for (const i of arr) r ^= i
  return r
}
function list4(a, b, c, d, e, f, g, h, i, j, k, m, n, o, p, q, r) {
  return [
    44, a, 0, 0, 0, 0, 24, b, n, 0, c, d, 0, 0, 0, 1, 0, 239,
    e, o, f, g, 0, 0, 0, 0, h, 0, 0, 14, i, j, 0, k, m, 3, p, 1,
    q, 1, r, 0, 0, 0
  ]
}
function list4List(urlParams, method, startTime, endTime) {
  const paramsArr = generateParamsCode(urlParams)
  const methodArr = generateMethodCode(method)
  const browserCode = charCodeAt(_BROWSER)
  return list4(
    (endTime >> 24) & 255, paramsArr[21], _UA_CODE[23],
    (endTime >> 16) & 255, paramsArr[22], _UA_CODE[24],
    (endTime >> 8) & 255, endTime & 255,
    (startTime >> 24) & 255, (startTime >> 16) & 255,
    (startTime >> 8) & 255, startTime & 255,
    methodArr[21], methodArr[22],
    Math.floor(endTime / 256 / 256 / 256 / 256) & 0xff,
    Math.floor(startTime / 256 / 256 / 256 / 256) & 0xff,
    browserCode.length
  )
}
function generateString2(urlParams, method, startTime, endTime) {
  const a = list4List(urlParams, method, startTime, endTime)
  const e = endCheckNum(a)
  a.push(...charCodeAt(_BROWSER))
  a.push(e)
  return rc4Encrypt(fromCharCode(a), 'y')
}

function generateResult(s) {
  const cs = _CHARSET_S4
  const result = []
  let i = 0
  for (i = 0; i < s.length; i += 3) {
    const remaining = s.length - i
    if (remaining >= 3) {
      const n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2)
      result.push(cs[(n >> 18) & 63])
      result.push(cs[(n >> 12) & 63])
      result.push(cs[(n >> 6) & 63])
      result.push(cs[n & 63])
    } else if (remaining === 2) {
      const n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8)
      result.push(cs[(n >> 18) & 63])
      result.push(cs[(n >> 12) & 63])
      result.push(cs[(n >> 6) & 63])
    } else {
      const n = s.charCodeAt(i) << 16
      result.push(cs[(n >> 18) & 63])
      result.push(cs[(n >> 12) & 63])
    }
  }
  const padding = (4 - result.length % 4) % 4
  result.push('='.repeat(padding))
  return result.join('')
}

/**
 * 生成新版 a_bogus 签名
 * @param {string} urlParams  urlencode 后的参数串（如 device_platform=webapp&aid=6383&...&aweme_id=xxx）
 * @param {string} method     'GET' 或 'POST'
 * @returns {string} 未编码的 a_bogus 签名（使用时需 encodeURIComponent）
 */
function generateABogusV2(urlParams, method = 'GET') {
  const startTime = Date.now()
  const endTime = startTime + 4 + Math.floor(Math.random() * 5)
  const s1 = generateString1()
  const s2 = generateString2(urlParams, method, startTime, endTime)
  return generateResult(s1 + s2)
}

export { generateABogusV2 }