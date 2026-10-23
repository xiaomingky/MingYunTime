import { createCipheriv, createHash, randomBytes } from 'node:crypto'

// Keep the native QR protocol separate from the browser login endpoints.
export function createQrSession() {
    return { cookie: `os=pc; appver=3.1.17.204416; osver=Microsoft-Windows-10-Professional-build-19045-64bit; channel=netease; deviceId=${randomBytes(16).toString('hex')}` }
}

export async function neteaseQrRequest(client, path, data, session) {
    const header = Object.fromEntries(session.cookie.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)))
    Object.assign(header, { versioncode: '140', resolution: '1920x1080', __csrf: '', buildver: String(Math.floor(client.now() / 1000)), requestId: `${client.now()}_${randomBytes(2).readUInt16BE()}` })
    const text = JSON.stringify({ ...data, e_r: false, header })
    const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null)
    const params = Buffer.concat([cipher.update(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`), cipher.final()]).toString('hex').toUpperCase()
    let response
    try {
        response = await client.request({ url: 'https://interfacepc.music.163.com/eapi/' + path.slice(5), method: 'POST', timeout: 12000, maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 900,
            data: new URLSearchParams({ params }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.29.205117', Cookie: session.cookie } })
    } catch (error) { throw new Error(error.response?.status ? `网易云扫码服务暂不可用（HTTP ${error.response.status}）` : '网易云扫码连接失败，请重试') }
    const body = response?.data
    if (!body || typeof body !== 'object' || !Number.isInteger(body.code)) throw new Error('网易云扫码返回了无效响应')
    const cookies = response.headers?.['set-cookie'] || []
    const jar = new Map(session.cookie.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)))
    for (const cookie of cookies) {
        const pair = cookie.split(';')[0], index = pair.indexOf('=')
        if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1))
    }
    session.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
    return { body, cookies }
}
