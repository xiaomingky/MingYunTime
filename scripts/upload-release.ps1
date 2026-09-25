# scripts/upload-release.ps1
# 上传发布资产到 GitHub Releases（无需 gh CLI，用 git remote 中的 PAT 走 REST API）
# 用法: .\scripts\upload-release.ps1 -Tag v3.5.1 [-Version 3.5.1]
# -Version 缺省时自动从 -Tag 去掉 v 前缀
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$Version
)

$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = $Tag -replace '^v', '' }
$repo = "xiaomingky/MingYunTime"
$root = Split-Path -Parent $PSScriptRoot

# 1) 从 git remote URL 提取 PAT（避免明文硬编码）
$remote = git -C $root remote get-url origin
$m = [regex]::Match($remote, "https://(github_pat_[A-Za-z0-9_]+)@")
if (-not $m.Success) { Write-Error "未能在 remote URL 中找到 PAT"; exit 1 }
$token = $m.Groups[1].Value

$api = "https://api.github.com/repos/$repo"
$headers = @{ Authorization = "Bearer $token"; "User-Agent" = "MingYunUpload/1.0"; Accept = "application/vnd.github+json" }
$uploads = "https://uploads.github.com/repos/$repo"

# 2) 解析 release
$release = Invoke-RestMethod -Uri "$api/releases/tags/$Tag" -Headers $headers -Method Get
$rid = $release.id
Write-Host "Release: $($release.tag_name) id=$rid ($($release.assets.Count) assets)"

# 3) 资产清单: 显示名 --> 本地路径
$assets = [ordered]@{
    "Setup.$Version.exe"                = Join-Path $root "release\茗韵时光 Setup $Version.exe"
    "MingYunTime-$Version-win.7z"       = Join-Path $root "release\茗韵时光 Setup $Version.7z"
    "Installer.$Version.exe"            = Join-Path $root "installer\bin\Release\MingYunInstaller.exe"
}

foreach ($name in $assets.Keys) {
    $path = $assets[$name]
    if (-not (Test-Path $path)) { Write-Warning "跳过缺失文件: $name ($path)"; continue }

    # 删除同名旧资产
    $existing = $release.assets | Where-Object { $_.name -eq $name }
    if ($existing) {
        foreach ($e in $existing) {
            Write-Host "删除旧资产: $name ($($e.id))"
            Invoke-RestMethod -Uri "$api/releases/assets/$($e.id)" -Headers $headers -Method Delete | Out-Null
        }
    }

    Write-Host "上传 $name  $( [math]::Round((Get-Item $path).Length / 1MB, 1) ) MB ..."
    $uri = "$uploads/releases/$rid/assets?name=$([uri]::EscapeDataString($name))"
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Post -ContentType "application/octet-stream" -InFile $path
    Write-Host "  -> $($resp.name)  [$([math]::Round($resp.size / 1MB, 1)) MB] url=$($resp.browser_download_url)"
}

Write-Host "`n上传完成: https://github.com/$repo/releases/tag/$Tag"