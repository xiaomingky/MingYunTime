$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"

$tokenFile = "f:\xiangmu\music\token"
if (-not (Test-Path $tokenFile)) { Write-Host "ERROR: token file not found"; exit 1 }
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) { Write-Host "ERROR: token empty"; exit 1 }
Write-Host "token loaded (len=$($token.Length))"

$owner = "xiaomingky"
$repo = "MingYunTime"
$tag = "v3.1.8"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }

$releaseNotes = "新增樱花动漫官方直连线路，并全面重构了无感知的观看防诈骗提示弹窗，进一步提升影音安全体验。"

Write-Host "=== 1. Check release ==="
$releaseId = $null
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Headers $headers -Method Get -TimeoutSec 30
    Write-Host "Found existing release id=$($existing.id)"
    $releaseId = $existing.id
} catch {
    Write-Host "Creating new release"
    $bodyObj = @{ tag_name = $tag; name = "v3.1.8"; body = $releaseNotes; draft = $false; prerelease = $false }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
    $create = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Headers $headers -Method Post -Body $bodyJson -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    $releaseId = $create.id
    Write-Host "Created release id=$releaseId"
}

if (-not $releaseId) { Write-Host "ERROR: no releaseId"; exit 1 }

$exePath = (Get-ChildItem "f:\xiangmu\music\release\*3.1.8.exe")[0].FullName
if (-not (Test-Path $exePath)) { Write-Host "ERROR: exe not found"; exit 1 }
$fileSize = (Get-Item $exePath).Length
Write-Host "=== 2. Upload ($([math]::Round($fileSize/1MB,2)) MB) ==="

$fileName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.8.exe")
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

$bmapPath = (Get-ChildItem "f:\xiangmu\music\release\*3.1.8.exe.blockmap")[0].FullName
if (Test-Path $bmapPath) {
    Write-Host "=== 3. Upload blockmap ==="
    $bmapName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.8.exe.blockmap")
    $bmapUrl = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$bmapName"
    try { Invoke-RestMethod -Uri $bmapUrl -Headers $uploadHeaders -Method Post -InFile $bmapPath -TimeoutSec 120; Write-Host "blockmap OK" } catch { Write-Host "blockmap failed" }
}

Write-Host "=== Done ==="
Write-Host "https://github.com/$owner/$repo/releases/tag/$tag"