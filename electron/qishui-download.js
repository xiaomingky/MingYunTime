// Save the audio actually returned for this account, using the same media
// pipeline as playback (redirects, same-quality backups and format decoding).
export async function prepareQishuiDownload({ client, audio, progress, signal, onResolved }, params) {
    const revision = client.revision
    if (!['auto','medium','higher','highest','hi_res','spatial','lossless'].includes(params.quality || 'auto')) throw new Error('汽水下载音质无效')
    const playback = await client.playback(params.id, params.quality || 'auto')
    if (revision !== client.revision) throw new Error('账号已切换，下载已取消')
    onResolved?.({ url: playback.url, preview: !!playback.preview, quality: playback.quality })
    const ready = await audio.prepare(playback, { progress, signal })
    const response = audio.handle(new Request(ready.url))
    if (!response.ok) throw new Error('汽水下载音频已失效，请重试')
    const data = Buffer.from(await response.arrayBuffer())
    const extension = data.subarray(0,4).toString() === 'fLaC' ? 'flac' : data.subarray(4,8).toString() === 'ftyp' ? 'm4a' : 'mp3'
    const title = String(params.name || playback.track?.name || '汽水歌曲').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,110) + (playback.preview ? '（试听片段）' : '')
    if (revision !== client.revision || signal?.aborted) throw new Error('下载已取消或账号已切换')
    return { data, title, trackName: playback.track?.name || params.name || '', artist: playback.track?.artist || '', coverUrl: playback.track?.picUrl || playback.track?.al?.picUrl || '', extension, quality:ready.quality, preview:!!playback.preview }
}

export async function downloadQishuiSong({ client, audio, choose, write }, params) {
    const revision = client.revision
    const { data, title, extension, quality, preview } = await prepareQishuiDownload({ client, audio }, params)
    const target = await choose({ title, extension })
    if (!target) return { canceled: true }
    if (revision !== client.revision) throw new Error('账号已切换，下载已取消')
    await write(target, data)
    return { success:true, path:target, bytes:data.length, quality, preview, extension }
}
