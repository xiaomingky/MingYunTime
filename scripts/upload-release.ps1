$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"

$tokenFile = "f:\xiangmu\music\token"
if (-not (Test-Path $tokenFile)) { Write-Host "ERROR: token file not found"; exit 1 }
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) { Write-Host "ERROR: token empty"; exit 1 }
Write-Host "token loaded (len=$($token.Length))"

$owner = "xiaomingky"
$repo = "MingYunTime"
$tag = "v3.1.9"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }

$releaseNotes = @"
茗韵时光 v3.1.9 更新说明

## 播放器
- 直播流未开播/地址失效时自动关闭全屏弹窗并提示，不再占满整屏退不出去
- 所有视频播放器统一为 ArtPlayer 引擎（含音量增强、选集、画质、倍速）

## 本地视频封面
- 新增本地视频封面识别：用系统媒体解码器自动截取视频画面作为封面

## 修复
- 直播流误判导致进度条消失的问题
- 网页全屏点击后黑屏无法退出的问题
- 动漫/影视线路切换后始终返回官方线路的问题
"@

Write-Host "=== 1. Check release ==="
$releaseId = $null
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Headers $headers -Method Get -TimeoutSec 30
    Write-Host "Found existing release id=$($existing.id)"
    $releaseId = $existing.id
} catch {
    Write-Host "Creating new release"
    $bodyObj = @{ tag_name = $tag; name = "v3.1.9"; body = $releaseNotes; draft = $false; prerelease = $false }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
    $create = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Headers $headers -Method Post -Body $bodyJson -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    $releaseId = $create.id
    Write-Host "Created release id=$releaseId"
}

if (-not $releaseId) { Write-Host "ERROR: no releaseId"; exit 1 }

$exePath = (Get-ChildItem "f:\xiangmu\music\release\*3.1.9.exe")[0].FullName
if (-not (Test-Path $exePath)) { Write-Host "ERROR: exe not found"; exit 1 }
$fileSize = (Get-Item $exePath).Length
Write-Host "=== 2. Upload ($([math]::Round($fileSize/1MB,2)) MB) ==="

$fileName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.9.exe")
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

$bmapPath = (Get-ChildItem "f:\xiangmu\music\release\*3.1.9.exe.blockmap")[0].FullName
if (Test-Path $bmapPath) {
    Write-Host "=== 3. Upload blockmap ==="
    $bmapName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.9.exe.blockmap")
    $bmapUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$bmapName"
    try { Invoke-RestMethod -Uri $bmapUrl -Headers $uploadHeaders -Method Post -InFile $bmapPath -TimeoutSec 120; Write-Host "blockmap OK" } catch { Write-Host "blockmap failed" }
}

Write-Host "=== Done ==="
Write-Host "https://github.com/$owner/$repo/releases/tag/$tag"