# 若本机代理可用则走代理，否则直连（GitHub API 可直连时无需代理，避免因代理未启动而失败）
if (-not (Test-Path 'variable:global:__uploadNoProxy')) {
    try {
        $probe = New-Object System.Net.Sockets.TcpClient
        $probe.Connect('127.0.0.1', 7897)
        $probe.Close()
        $env:HTTPS_PROXY = "http://127.0.0.1:7897"
        $env:HTTP_PROXY = "http://127.0.0.1:7897"
        Write-Host "using local proxy 127.0.0.1:7897"
    } catch {
        Write-Host "no local proxy, using direct connection"
    }
    $global:__uploadNoProxy = $true
}

$tokenFile = "f:\xiangmu\music\token"
if (-not (Test-Path $tokenFile)) { Write-Host "ERROR: token file not found"; exit 1 }
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) { Write-Host "ERROR: token empty"; exit 1 }
Write-Host "token loaded (len=$($token.Length))"

$owner = "xiaomingky"
$repo = "MingYunTime"
$tag = "v3.2.0"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }

$releaseNotes = @"
茗韵时光 v3.2.0 更新说明

## 新增：设置专区
- 设置独立成页（侧边栏进入），含账号信息 / 核心播放快捷键 / 播放器设置
- 账号信息：QQ/酷狗 Cookie / Token 一键复制
- 酷狗 VIP 领取结果弹窗，账号区直显 SVIP/TVIP 到期与剩余天数

## 新增：全局音乐播放快捷键（可自定义）
- 空格播放暂停、Ctrl+←/→ 上一首下一首、Ctrl+↑/↓ 音量、Ctrl+F 收藏、Ctrl+T 切歌模式
- 设置页可录制改键并本地持久化

## 修复
- 动漫官方线路不再误跳其他线路（抓取超时延长至 1 分钟）
- 线路下拉美化
"@

Write-Host "=== 1. Check release ==="
$releaseId = $null
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Headers $headers -Method Get -TimeoutSec 30
    Write-Host "Found existing release id=$($existing.id)"
    $releaseId = $existing.id
} catch {
    Write-Host "Creating new release"
    $bodyObj = @{ tag_name = $tag; $name = "v3.2.0"; body = $releaseNotes; draft = $false; prerelease = $false }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
    $create = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Headers $headers -Method Post -Body $bodyJson -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    $releaseId = $create.id
    Write-Host "Created release id=$releaseId"
}

if (-not $releaseId) { Write-Host "ERROR: no releaseId"; exit 1 }

$exePath = (Get-ChildItem "f:\xiangmu\music\release\*3.2.0.exe")[0].FullName
if (-not (Test-Path $exePath)) { Write-Host "ERROR: exe not found"; exit 1 }
$fileSize = (Get-Item $exePath).Length
Write-Host "=== 2. Upload ($([math]::Round($fileSize/1MB,2)) MB) ==="

$fileName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.2.0.exe")
$uploadUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$fileName"
$uploadHeaders = @{ Authorization = "token $token"; Accept = "application/vnd.github+json"; "Content-Type" = "application/octet-stream" }

try {
    $result = Invoke-RestMethod -Uri $uploadUrl -Headers $uploadHeaders -Method Post -InFile $exePath -TimeoutSec 600
    Write-Host "Upload OK! $($result.browser_download_url)"
} catch {
    Write-Host "Upload failed: $($_.Exception.Message)"
    if ($_.Exception.Response) { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); Write-Host $sr.ReadToEnd() }
    exit 1
}

$bmapPath = (Get-ChildItem "f:\xiangmu\music\release\*3.2.0.exe.blockmap")[0].FullName
if (Test-Path $bmapPath) {
    Write-Host "=== 3. Upload blockmap ==="
    $bmapName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.2.0.exe.blockmap")
    $bmapUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$bmapName"
    try { Invoke-RestMethod -Uri $bmapUrl -Headers $uploadHeaders -Method Post -InFile $bmapPath -TimeoutSec 120; Write-Host "blockmap OK" } catch { Write-Host "blockmap failed" }
}

Write-Host "=== Done ==="
Write-Host "https://github.com/$owner/$repo/releases/tag/$tag"