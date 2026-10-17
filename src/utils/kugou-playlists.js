// A cloud playlist fileid identifies an entry, not a recording or album.
export async function resolveKugouPlaylistFileIds(listid, songs, fetchPage, isCurrent = () => true) {
    const wanted = new Set(songs.map(song => String(song?.hash || '').toUpperCase()))
    if (!wanted.size || wanted.has('')) throw new Error('缺少歌曲 hash，请刷新歌单后重试')
    const found = new Map(), seen = new Set()
    for (let page = 1; page <= 1000; page++) {
        const response = await fetchPage(listid, page, 300)
        if (!isCurrent()) throw new Error('账号已切换，操作已取消')
        const data = response?.data || response
        const items = data?.info || data?.lists || data?.songs || data?.list
        if (!Array.isArray(items)) throw new Error('歌单歌曲读取失败，未执行移除')
        let fresh = 0
        for (const item of items) {
            const hash = String(item.hash || item.FileHash || item.Hash || item.filehash || '').toUpperCase()
            const fileid = item.fileid || item.file_id || item.FileID
            if (fileid && !seen.has(String(fileid))) { seen.add(String(fileid)); fresh++ }
            if (wanted.has(hash) && /^[1-9]\d*$/.test(String(fileid || '')) && Number.isSafeInteger(Number(fileid))) found.set(hash, String(fileid))
        }
        if (found.size === wanted.size) return [...new Set([...wanted].map(hash => found.get(hash)))]
        if (items.length < 300 || !fresh) break
    }
    throw new Error('未找到匹配的歌单歌曲 ID，请刷新后重试；未执行移除')
}
