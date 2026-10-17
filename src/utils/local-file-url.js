// Chromium media seeking requires a standard URL with a host.
export function localFileUrl(file) {
    return 'local-file://localhost/' + encodeURIComponent(String(file).replaceAll('\\', '/'))
}

// Upgrade media URLs persisted by earlier versions.
export function normalizeLocalFileUrl(url) {
    if (!url?.startsWith('local-file://') || url.startsWith('local-file://localhost/')) return url
    let file = url.slice('local-file://'.length).split('?param=')[0]
    try { file = decodeURIComponent(file) } catch { return url }
    while (file.startsWith('/') && /^\/+[a-z]:/i.test(file)) file = file.slice(1)
    return localFileUrl(file)
}
