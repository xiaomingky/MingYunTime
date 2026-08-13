$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = (Get-Content "f:\xiangmu\music\token" -Raw).Trim()
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }
$owner = "xiaomingky"
$repo = "MingYunTime"

$releaseId = 367692724
$releaseNotes = Get-Content "f:\xiangmu\music\BLOG-v3.1.6.md" -Raw -Encoding UTF8

$bodyObj = @{ body = $releaseNotes }
$bodyJsonString = $bodyObj | ConvertTo-Json -Depth 5 -Compress
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJsonString)

$url = "https://api.github.com/repos/$owner/$repo/releases/$releaseId"

Write-Host "Updating release $releaseId..."
Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
Write-Host "Done!"
