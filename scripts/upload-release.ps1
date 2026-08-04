$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"

# 从 token 文件读取 PAT（不打印）
$tokenFile = "f:\xiangmu\music\token"
if (-not (Test-Path $tokenFile)) { Write-Host "ERROR: token 文件不存在"; exit 1 }
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) { Write-Host "ERROR: token 为空"; exit 1 }
Write-Host "token 已加载 (长度=$($token.Length))"

$owner = "xiaomingky"
$repo = "MingYunTime"
$tag = "v3.1.2"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }

# Release notes：用 `n（反引号n）在双引号字符串中表示换行
$releaseNotes = "## v3.1.2`n`n### Bug Fix`n- Fix desktop lyrics flickering when dragging main window (IPC state cache)`n- Fix lyrics color turning light gray in word-by-word mode (parent/child background-clip conflict)"

# 1. 检查是否已有该 tag 的 release
Write-Host "=== 1. 检查现有 release ==="
$releaseId = $null
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Headers $headers -Method Get -TimeoutSec 30
    Write-Host "已存在 release id=$($existing.id), 将复用"
    $releaseId = $existing.id
} catch {
    Write-Host "未找到现有 release, 创建新 release"
    $bodyObj = @{
        tag_name = $tag
        name = "v3.1.2"
        body = $releaseNotes
        draft = $false
        prerelease = $false
    }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
    $create = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Headers $headers -Method Post -Body $bodyJson -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    $releaseId = $create.id
    Write-Host "创建成功 release id=$releaseId"
}

if (-not $releaseId) { Write-Host "ERROR: 无 releaseId"; exit 1 }

# 2. 上传安装包
$exePath = "f:\xiangmu\music\release\茗韵时光 Setup 3.1.2.exe"
if (-not (Test-Path $exePath)) { Write-Host "ERROR: 安装包不存在 $exePath"; exit 1 }
$fileSize = (Get-Item $exePath).Length
Write-Host "`n=== 2. 上传安装包 ($([math]::Round($fileSize/1MB,2)) MB) ==="

$fileName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.2.exe")
$uploadUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$fileName"
Write-Host "上传到: $uploadUrl"

$uploadHeaders = @{
    Authorization = "token $token"
    Accept = "application/vnd.github+json"
    "Content-Type" = "application/octet-stream"
}

try {
    $result = Invoke-RestMethod -Uri $uploadUrl -Headers $uploadHeaders -Method Post -InFile $exePath -TimeoutSec 600
    Write-Host "上传成功!"
    Write-Host "  asset id: $($result.id)"
    Write-Host "  name: $($result.name)"
    Write-Host "  size: $([math]::Round($result.size/1MB,2)) MB"
    Write-Host "  download: $($result.browser_download_url)"
} catch {
    Write-Host "上传失败: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "响应: $($sr.ReadToEnd())"
    }
    exit 1
}

# 3. 上传 blockmap（可选）
$bmapPath = "f:\xiangmu\music\release\茗韵时光 Setup 3.1.2.exe.blockmap"
if (Test-Path $bmapPath) {
    Write-Host "`n=== 3. 上传 blockmap ==="
    $bmapName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.2.exe.blockmap")
    $bmapUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$bmapName"
    try {
        $bmapResult = Invoke-RestMethod -Uri $bmapUrl -Headers $uploadHeaders -Method Post -InFile $bmapPath -TimeoutSec 120
        Write-Host "blockmap 上传成功: $($bmapResult.browser_download_url)"
    } catch {
        Write-Host "blockmap 上传失败: $($_.Exception.Message)"
    }
}

Write-Host "`n=== 完成 ==="
Write-Host "Release: https://github.com/$owner/$repo/releases/tag/$tag"
