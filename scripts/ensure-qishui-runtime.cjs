const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

// Extract three native helpers from the pinned, signed official Windows package.
// The installer is never run, and no account data is imported.
const root = path.resolve(__dirname, '..')
const target = path.join(root, 'resources', 'qishui-runtime')
const files = ['bdms.node', 'device.node', 'metasecml.dll']
const installerHash = 'e58578aec410e2c9c24835e92a1dc74d0fda982be1cf1003034538255baab0e4'
const officialURL = 'https://lf-luna-release.qishui.com/obj/luna-release/3.7.0/452316191/SodaMusic-v3.7.0-official-win32_x64.exe'
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
async function main() {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('汽水本机播放组件目前支持 Windows x64')
    let manifest
    try { manifest = JSON.parse(fs.readFileSync(path.join(target, 'origin.json'), 'utf8')) } catch {}
    if (manifest?.installerHash === installerHash && files.every(file => fs.existsSync(path.join(target, file)) && hash(path.join(target, file)) === manifest.files[file])) {
        console.log('Qishui runtime verified (official 3.7.0)'); return
    }
    const sevenZip = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe')
    if (!fs.existsSync(sevenZip)) throw new Error('缺少本地 7z 解包工具，请先安装项目依赖')
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-qishui-'))
    try {
        let installer = process.env.QISHUI_INSTALLER_FILE || path.join(root, 'dev', 'qishui-official-3.7.0.exe')
        if (!fs.existsSync(installer)) {
            installer = path.join(temp, 'official.exe')
            const response = await fetch(officialURL, { signal: AbortSignal.timeout(180000) })
            if (!response.ok) throw new Error('汽水官方组件下载失败：' + response.status)
            await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(installer))
        }
        if (hash(installer) !== installerHash) throw new Error('汽水官方安装包 SHA256 校验不通过')
        const signature = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Import-Module (Join-Path $PSHOME "Modules/Microsoft.PowerShell.Security"); $s=Get-AuthenticodeSignature -LiteralPath $env:QISHUI_INSTALLER_FILE; if($s.Status -ne "Valid" -or $s.SignerCertificate.Subject -notmatch "Douyin Vision") { exit 1 }; Write-Output "verified"'], { env: { ...process.env, QISHUI_INSTALLER_FILE: path.resolve(installer) }, windowsHide: true, encoding: 'utf8' })
        if (!signature.includes('verified')) throw new Error('汽水官方安装包签名校验不通过')
        execFileSync(sevenZip, ['x', installer, '-o' + temp, '-y', '-i!$_31_\\$_31_\\app.7z'], { windowsHide: true, stdio: 'ignore' })
        const archive = path.join(temp, '$_31_', '$_31_', 'app.7z'), extracted = path.join(temp, 'native')
        execFileSync(sevenZip, ['x', archive, '-o' + extracted, '-y', ...files.map(file => '-i!resources\\app.asar.unpacked\\' + file)], { windowsHide: true, stdio: 'ignore' })
        const source = path.join(extracted, 'resources', 'app.asar.unpacked')
        if (!files.every(file => fs.existsSync(path.join(source, file)))) throw new Error('汽水安装包组件目录不匹配')
        fs.mkdirSync(target, { recursive: true })
        const fingerprints = {}
        for (const file of files) { fs.copyFileSync(path.join(source, file), path.join(target, file)); fingerprints[file] = hash(path.join(target, file)) }
        fs.writeFileSync(path.join(target, 'origin.json'), JSON.stringify({ version: '3.7.0', officialURL, installerHash, signer: 'Douyin Vision Co., Ltd.', files: fingerprints }, null, 2))
        console.log('Qishui runtime prepared and verified (official 3.7.0)')
    } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
