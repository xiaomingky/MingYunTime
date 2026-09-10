// scripts/build-installer.cjs
// 生成自定义安装器（发布三件套中的「安装程序」）：
//   1. 默认：不内嵌离线包 —— 本地模式下一步由用户自选 .7z/.zip/.exe，线上模式按版本列表下载
//   2. --embed：把 release 目录最新 .7z 内嵌为离线包（体积大，通常发布不采用）
// GitHub Releases 发布三件套：*.7z（压缩包）+ 官方 Setup.exe + 本安装程序（MingYunInstaller.exe）
// 用法：node scripts/build-installer.cjs [--embed]
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const installerDir = path.join(root, 'installer')
const embed = process.argv.includes('--embed')

const pkg7z = path.join(installerDir, 'AppPackage.7z')
const pkgBak = path.join(installerDir, 'AppPackage.7z.bak')

function list7z() {
  if (!fs.existsSync(releaseDir)) return []
  return fs.readdirSync(releaseDir)
    .filter((f) => f.endsWith('.7z'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(releaseDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}

function main() {
  if (embed) {
    if (fs.existsSync(pkgBak)) fs.unlinkSync(pkgBak)
    const pkgs = list7z()
    if (pkgs.length === 0) {
      console.warn('[installer] 未找到 release/*.7z，先执行 npm run build 生成')
    } else {
      fs.copyFileSync(path.join(releaseDir, pkgs[0].name), pkg7z)
      console.log(`[installer] --embed：内嵌离线包 ${pkgs[0].name} (${(fs.statSync(pkg7z).size / 1048576).toFixed(1)} MB)`)
    }
  } else {
    // 非混合模式：确保不内嵌旧离线包（移出，避免 csproj 的 Exists 条件误包含）
    if (fs.existsSync(pkg7z)) {
      try { fs.renameSync(pkg7z, pkgBak) } catch {
        fs.copyFileSync(pkg7z, pkgBak); fs.unlinkSync(pkg7z)
      }
      console.log('[installer] 非混合模式：已暂移 AppPackage.7z（内嵌离线包不再包含）')
    }
    if (fs.existsSync(pkgBak)) console.log('[installer] 提示：存在 AppPackage.7z.bak，使用 --embed 可改回离线版')
  }

  console.log('[installer] 编译 MingYunInstaller...')
  execSync('dotnet build Installer.csproj -c Release -v m', { cwd: installerDir, stdio: 'inherit' })

  const out = path.join(installerDir, 'bin', 'Release', 'MingYunInstaller.exe')
  if (fs.existsSync(out)) {
    const mb = (fs.statSync(out).size / 1048576).toFixed(2)
    console.log(`\n[installer] 完成 → ${out} (${mb} MB，${embed ? '离线混合版' : '线上/本地自选版'})`)
    console.log('[installer] GitHub 发布建议：连同 release/*.7z 与官方 Setup 一并上传')
  }
}

main()