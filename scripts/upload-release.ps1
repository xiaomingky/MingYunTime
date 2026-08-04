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
$tag = "v3.1.1"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }

# Release notes：用 `n（反引号n）在双引号字符串中表示换行
$releaseNotes = "## v3.1.1 更新内容`n`n### 新增功能`n- 酷狗概念版新增「领取 VIP」入口：领取当天 VIP、3 小时时长(每天最多 8 次)、升级畅听 VIP，并展示 VIP 状态与当月已领天数`n- 酷狗歌手主页歌曲列表新增封面显示`n`n### 交互优化`n- 酷狗 / QQ 音乐所有歌曲列表改为双击播放`n- 主页 Banner 翻页按钮改为漂浮圆形，鼠标移入时显现`n- 平台切换下拉框字体缩小，顺序：网易云 → 酷狗概念版 → QQ 音乐`n- 歌曲详情页移除歌词变色开关，歌词高亮恢复固定黑色`n- 官方云盘仅网易云平台显示`n`n### 按平台区分`n- 最近播放按当前平台展示`n- 搜索历史按平台独立记录(网易云/酷狗/QQ 互不干扰)`n`n### 界面修复`n- VIP 标识移到歌名右侧(搜索/发现/歌单/歌手/专辑/我喜欢)`n- 酷狗 VIP 标识更换为内置 SVG 官方风格图标(原域名失效)`n`n### 性能与安全`n- 关闭 F12 开发者控制台快捷键`n- 移除后台终端大量日志(API 子进程 stdout 静默，仅保留错误日志)"

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
        name = "v3.0.1"
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
$exePath = "f:\xiangmu\music\release\茗韵时光 Setup 3.1.1.exe"
if (-not (Test-Path $exePath)) { Write-Host "ERROR: 安装包不存在 $exePath"; exit 1 }
$fileSize = (Get-Item $exePath).Length
Write-Host "`n=== 2. 上传安装包 ($([math]::Round($fileSize/1MB,2)) MB) ==="

$fileName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.1.exe")
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
$bmapPath = "f:\xiangmu\music\release\茗韵时光 Setup 3.1.1.exe.blockmap"
if (Test-Path $bmapPath) {
    Write-Host "`n=== 3. 上传 blockmap ==="
    $bmapName = [System.Uri]::EscapeDataString("茗韵时光 Setup 3.1.1.exe.blockmap")
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
