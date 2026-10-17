export function playlistGroups(platform, account) {
    const lists = (account.playlists || []).filter(item => String(item.id) !== String(account.likedPlaylistId))
    if (platform === 'qq') return { created: lists, collected: account.collectedPlaylists || [] }
    const mine = item => platform === 'kugou' ? !!item.isMine : !item.subscribed && String(item.creator?.userId || account.profile?.userId) === String(account.profile?.userId)
    return { created: lists.filter(mine), collected: lists.filter(item => !mine(item)) }
}
