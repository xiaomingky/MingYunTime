export function canManageQishuiPlaylist(playlist, account) {
    if (!playlist?.id || !account?.isLoggedIn || !account.profile?.userId) return false
    // Native Playlist: 1 = favourites, 2 = PGC, 3 = user-created, 4 = Douyin.
    // Never infer ownership from the displayed name.
    const libraryEntry = (account.playlists || []).find(item => String(item.id) === String(playlist.id))
    const kind = Number(playlist.type)
    if (kind !== 3 && kind !== 2) return false
    const userId = String(account.profile.userId)
    if (playlist.ownerId) return String(playlist.ownerId) === userId
    // Details may omit the owner; only trust a matching owned library entry.
    return !!libraryEntry && [2, 3].includes(Number(libraryEntry.type)) && String(libraryEntry.ownerId || '') === userId
}
