// Keep the existing service as the primary path; use QQ's public search endpoint
// when its desktop endpoint is unavailable. Unsupported types retain the error.
export async function searchQQWithFallback({ primary, get, key, limit = 30, page = 1, catZhida = 0, cookie = '' }) {
    let originalError
    try {
        return await primary('/getSearchByKey', { key, limit, page, catZhida }, cookie)
    } catch (error) { originalError = error }
    const type = { 0: 0, 2: 8 }[catZhida]
    if (type === undefined) throw originalError
    const response = await get('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp', {
        params: { w: key, n: limit, p: page, t: type, format: 'json' },
        headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0', ...(cookie ? { Cookie: cookie } : {}) },
        timeout: 10000
    })
    const body = response.data
    const results = catZhida === 2 ? body?.data?.album : body?.data?.song
    if (body?.code !== 0 || body?.subcode !== 0 || !Array.isArray(results?.list)) throw originalError
    return body
}
