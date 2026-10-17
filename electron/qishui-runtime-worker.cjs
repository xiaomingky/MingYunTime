// Runs official native helpers outside the application process. No credentials
// or signed URLs are written to stdout, stderr, or files.
const path = require('node:path')
let native, device, activeId
process.on('message', async message => {
    const { id, operation, directory, deviceId, url, headers, value } = message || {}
    try {
        let result
        if (operation === 'sign') {
            const target = new URL(url)
            if (target.protocol !== 'https:' || target.hostname !== 'api.qishui.com') throw new Error('invalid sign target')
            native ||= require(path.join(directory, 'bdms.node'))
            if (activeId !== deviceId) { native.init({deviceId}); activeId = deviceId }
            const lines = Object.entries(headers).flatMap(([name, value]) => [name, String(value)]).join('\r\n')
            const fields = native.generateHttpSignatureHeaders(url, lines).split('\r\n').filter(Boolean)
            result = {}
            for (let index = 0; index + 1 < fields.length; index += 2) result[fields[index]] = fields[index + 1]
            if (!result['X-Helios'] || !result['X-Medusa']) throw new Error('missing signature')
        } else if (operation === 'decode') {
            device ||= require(path.join(directory, 'device.node'))
            result = device.decodeSpade(value)
        } else throw new Error('invalid operation')
        process.send({id, result})
    } catch { process.send({id, error:'汽水本机安全组件调用失败'}) }
})
process.on('disconnect', () => process.exit(0))
