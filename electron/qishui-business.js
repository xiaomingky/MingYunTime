import { QishuiError, qishuiPayload, qishuiTrack, qishuiPlaylist, qishuiImage, qishuiList } from './qishui-client.js'

const id = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new QishuiError('invalid_id', '资源 ID 精度无效')
    if (!/^\d{1,22}$/.test(String(value || ''))) throw new QishuiError('invalid_id', '资源 ID 无效')
    return String(value)
}
const count = value => Math.max(1, Math.min(100, Number(value) || 30))
const page = p => ({ hasMore: !!p.has_more, cursor: String(p.next_cursor ?? p.cursor ?? '') })
const rows = value => Array.isArray(value) ? value : []
const unique = values => [...new Map(values.filter(Boolean).map(value => [value.id, value])).values()]

export function qishuiArtist(raw) {
    const a = raw?.entity?.artist || raw?.artist || raw
    if (!a?.id || (typeof a.id === 'number' && !Number.isSafeInteger(a.id))) return null
    return { id: String(a.id), name: a.name || '', coverImgUrl: qishuiImage(a.url_avatar),
        description: a.artist_profile?.intro || a.description || a.desc || '', songCount: Number(a.count_tracks || 0),
        albumCount: Number(a.count_albums || 0), collected: !!a.state?.is_collected, userId: String(a.user?.id || a.user_info?.id || '') }
}
export function qishuiAlbum(raw) {
    const a = raw?.entity?.album || raw?.album || raw
    if (!a?.id || (typeof a.id === 'number' && !Number.isSafeInteger(a.id))) return null
    return { id: String(a.id), name: a.name || '', coverImgUrl: qishuiImage(a.url_cover),
        description: a.description || a.desc || '', creator: rows(a.artists).map(a => a.name).join(' / '),
        artists: rows(a.artists).map(qishuiArtist).filter(Boolean), songCount: Number(a.count_tracks || 0),
        releaseDate: Number(a.release_date || 0), collected: !!a.state?.is_collected }
}
export function qishuiComment(c) {
    if (!c?.id || (typeof c.id === 'number' && !Number.isSafeInteger(c.id))) return null
    return { commentId: String(c.id), content: c.content || '', time: Number(c.time_created || 0) * 1000,
        likedCount: Number(c.count_digged || 0), liked: !!(c.is_digged || c.state?.is_digged), replyCount: Number(c.count_reply || 0),
        user: { userId: String(c.user?.id || ''), nickname: c.user?.nickname || '汽水用户', avatarUrl: qishuiImage(c.user?.thumb_avatar_url || c.user?.medium_avatar_url) },
        replies: rows(c.replies).map(qishuiComment).filter(Boolean) }
}
export function qishuiUser(raw) {
    const u = raw?.entity?.user || raw?.user || raw
    if (!u?.id || (typeof u.id === 'number' && !Number.isSafeInteger(u.id))) return null
    return { id: String(u.id), name: u.nickname || u.public_name || '',
        coverImgUrl: qishuiImage(u.medium_avatar_url || u.larger_avatar_url || u.thumb_avatar_url),
        description: u.signature || '', artistId: u.artist_id ? String(u.artist_id) : '', secret: !!u.secret }
}

// Business requests use the same account, device and native signature runtime
// as playback. Contracts were cross-checked with Android declarations and PC
// request schemas; no third-party music backend is loaded here.
export class QishuiBusiness {
    constructor(client) { this.client = client }
    async claimFreeVip() {
        // RedeemApi.applyFreeVip declares a POST without user-supplied fields.
        // apply_status is separate from the transport status_code.
        const p = await this.call('/luna/commerce/v2/apply_free_vip', {}, true)
        const statuses = {0:'received',1:'restricted',2:'device_limit',3:'already_received',13:'unavailable'}
        if (!Number.isInteger(p.apply_status) || !statuses[p.apply_status]) throw new QishuiError('invalid_response', '汽水未确认免费 VIP 领取结果，请稍后刷新查看')
        const messages = {0:'免费 VIP 领取成功',1:'当前账号暂不符合领取条件，请在汽水官方客户端查看',2:'当前设备已达到领取上限',3:'本次活动已领取过 VIP',13:'当前免费 VIP 活动不可领取'}
        return { status: statuses[p.apply_status], message: typeof p.toast === 'string' && p.toast.trim() ? p.toast : messages[p.apply_status] }
    }
    requireLogin() { if (!this.client.cookie) throw new QishuiError('login_required', '请先登录汽水音乐') }
    async call(path, options = {}, auth = false) {
        if (auth) this.requireLogin()
        const revision = this.client.revision
        const response = await this.client.pcCall(path, options)
        if (revision !== this.client.revision) throw new QishuiError('cancelled', '账号已切换，请重新操作')
        const p = qishuiPayload(response.data)
        if (options.method !== 'GET' && auth && !p.status_info && p.status_code === undefined) throw new QishuiError('invalid_response', '汽水未确认操作结果，请刷新查看')
        return p
    }
    async search({ query, cursor = '', type = 'track' }) {
        if (!['track', 'artist', 'album', 'playlist', 'video', 'user'].includes(type)) throw new QishuiError('invalid_type', '不支持的搜索类型')
        if (type === 'track') return this.client.search(query, cursor)
        const keyword = String(query || '').trim()
        if (!keyword || keyword.length > 200) throw new QishuiError('invalid_query', '请输入有效搜索关键词')
        const p = await this.call('/luna/pc/search/' + type, { method: 'GET', params: {
            q: keyword, cursor: String(cursor || '0'), search_id: '', search_method: 'input', search_scene: '', from_search_id: ''
        } })
        const groups = rows(p.result_groups), g = groups.find(g => g.id === type + 's') || groups[0]
        if (Array.isArray(p.result_groups) && !groups.length) return { type, items: [], hasMore: false, cursor: '', scope: 'platform' }
        if (!g) throw new QishuiError('invalid_response', '汽水搜索未返回有效结果')
        const mapper = { artist: qishuiArtist, album: qishuiAlbum, playlist: qishuiPlaylist, user: qishuiUser }[type]
        return { type, items: mapper ? unique(rows(g.data).map(mapper)) : rows(g.data),
            hasMore: !!g.has_more, cursor: String(g.next_cursor || ''), scope: 'platform' }
    }
    async album({ id: albumId }) {
        const p = await this.call('/luna/pc/albums/' + id(albumId), { method: 'GET' })
        const album = qishuiAlbum(p.album_info?.album || p.album_info || p.album)
        if (!album) throw new QishuiError('invalid_response', '专辑资料暂不可用')
        return { album, songs: unique(rows(p.tracks).map(qishuiTrack)), hasMore: false }
    }
    async artist({ id: artistId }) {
        const p = await this.call('/luna/pc/artists/' + id(artistId), { method: 'GET' })
        const artist = qishuiArtist(p.artist_info?.artist || p.artist_info || p.artist)
        if (!artist) throw new QishuiError('invalid_response', '歌手资料暂不可用')
        return { artist, songs: unique(rows(p.hot_tracks).map(qishuiTrack)), albums: unique(rows(p.hot_albums).map(qishuiAlbum)),
            hasMoreTracks: !!p.has_more_tracks, hasMoreAlbums: !!p.has_more_albums }
    }
    async artistTracks({ id: artistId, cursor = '', limit = 50, sort = 0 }) {
        const p = await this.call(`/luna/pc/artists/${id(artistId)}/tracks`, { method: 'GET', params: { cursor: String(cursor), count: count(limit), sort_type: Number(sort) || 0 } })
        return { songs: unique(rows(p.tracks).map(qishuiTrack)), ...page(p) }
    }
    async artistAlbums({ id: artistId, cursor = '', limit = 30 }) {
        const p = await this.call(`/luna/pc/artists/${id(artistId)}/albums`, { method: 'GET', params: { cursor: String(cursor), count: count(limit) } })
        return { albums: unique(rows(p.albums).map(qishuiAlbum)), ...page(p) }
    }
    async comments({ id: groupId, cursor = '', limit = 20, sort = 'hot', groupType = 0 }) {
        const p = await this.call('/luna/pc/comments', { method: 'GET', params: { group_id: id(groupId), cursor: String(cursor), count: count(limit), group_type: Number(groupType) || 0, image_strategy: 2, sort_type: sort === 'time' ? 'time' : 'hot' } })
        return { comments: qishuiList(p, 'comments').map(qishuiComment).filter(Boolean), total: Number(p.count || 0), ...page(p) }
    }
    async replies({ id: commentId, groupId, groupType = 0, cursor = '', limit = 20 }) {
        const p = await this.call(`/luna/pc/comments/${id(commentId)}/replies`, { method: 'GET', params: { group_id: id(groupId), group_type: Number(groupType) || 0, cursor: String(cursor), count: count(limit), image_strategy: 2 } })
        return { comments: rows(p.reply_infos || p.replies || p.comments).map(qishuiComment).filter(Boolean), ...page(p) }
    }
    async createComment({ id: groupId, text, replyId = '', replyToReplyId = '', replyToUserId = '', groupType = 0 }) {
        const content = String(text || '').trim()
        if (!content || content.length > 2000) throw new QishuiError('invalid_text', '评论请输入 1 至 2000 个字符')
        return this.call('/luna/pc/comments/create', { data: { group_id: id(groupId), text: content, comment_type: 0, group_type: Number(groupType) || 0,
            ...(replyId ? { reply_id: id(replyId) } : {}), ...(replyToReplyId ? { reply_to_reply_id: id(replyToReplyId) } : {}), ...(replyToUserId ? { reply_to_user_id: id(replyToUserId) } : {}) } }, true)
    }
    async deleteComment({ id: commentId, replyId = '' }) {
        return this.call('/luna/pc/comments/delete', { data: { comment_id: id(commentId), ...(replyId ? { reply_id: id(replyId) } : {}) } }, true)
    }
    async likeComment({ id: commentId, groupId, liked = true, replyId = '' }) {
        return this.call('/luna/pc/comments/action', { data: { comment_id: id(commentId), group_id: id(groupId), reply_id: replyId ? id(replyId) : '', type: liked ? 1 : 2, scene_name: 'playing' } }, true)
    }
    async collections({ type = 'track', cursor = '', limit = 50 }) {
        if (!['track', 'album', 'playlist', 'artist'].includes(type)) throw new QishuiError('invalid_type', '收藏类型无效')
        this.requireLogin()
        if (type === 'track') {
            let next = '', favorite, pages = new Set()
            do {
                const library = await this.client.library(next)
                favorite = library.playlists.find(p => p.type === 1)
                if (favorite || !library.hasMore || !library.cursor || pages.has(library.cursor)) break
                pages.add(library.cursor); next = library.cursor
            } while (true)
            if (!favorite) return { items: [], hasMore: false, cursor: '' }
            const result = await this.client.playlist(favorite.id, cursor)
            return { items: result.songs.map(song => ({ ...song, collected: true })), hasMore: result.hasMore, cursor: result.cursor }
        }
        if (type === 'artist') {
            const p = await this.call('/luna/me/collection/artist', { method: 'GET', params: { cursor: String(cursor), count: count(limit) } }, true)
            return { items: unique(qishuiList(p, 'artists').map(qishuiArtist)), ...page(p) }
        }
        const p = await this.call('/luna/pc/me/collection/mixed', { method: 'GET', params: { cursor: String(cursor), count: String(count(limit)), item_types: [type] } }, true)
        const resources = p.mixed_collections || p.resources || p.media_resources || p.items || p.collections
        const list = resources === undefined ? qishuiList(p, 'mixed_collections') : resources
        if (!Array.isArray(list)) throw new QishuiError('invalid_response', '汽水未返回收藏列表')
        const mapper = { track: qishuiTrack, album: qishuiAlbum, playlist: qishuiPlaylist, artist: qishuiArtist }[type]
        return { items: unique(list.map(mapper)), ...page(p) }
    }
    async collect({ type = 'track', ids, collected = true }) {
        if (!['track', 'album', 'playlist', 'artist'].includes(type) || !Array.isArray(ids) || !ids.length || ids.length > 100) throw new QishuiError('invalid_collection', '请选择 1 至 100 个有效资源')
        const values = [...new Set(ids.map(id))], category = type === 'track' ? 'media' : type
        const data = type === 'track' ? { media: values.map(id => ({ id, type: 'track' })), ...(collected ? { scene: 'playing', collect_action: 1 } : {}) } : { [type + '_ids']: values }
        return this.call('/luna/pc/me/collection/' + category + (collected ? '' : '/delete'), { data }, true)
    }
    async createPlaylist({ name, isPrivate = false, trackIds = [] }) {
        const title = String(name || '').trim()
        if (!title || title.length > 100) throw new QishuiError('invalid_name', '歌单名称请输入 1 至 100 个字符')
        if (!Array.isArray(trackIds) || trackIds.length > 500) throw new QishuiError('invalid_tracks', '一次最多添加 500 首歌曲')
        const p = await this.call('/luna/pc/me/playlist', { data: { name: title, is_private: !!isPrivate, track_ids: trackIds.map(id) } }, true)
        const playlist = qishuiPlaylist(p.playlist)
        if (!playlist) throw new QishuiError('invalid_response', '汽水未确认新歌单，请刷新歌单列表')
        return { playlist }
    }
    async updatePlaylist({ id: playlistId, name, description, isPrivate }) {
        const data = { playlist_id: id(playlistId) }
        if (name !== undefined) { data.name = String(name).trim(); if (!data.name || data.name.length > 100) throw new QishuiError('invalid_name', '歌单名称请输入 1 至 100 个字符') }
        if (description !== undefined) { data.description = String(description); if (data.description.length > 2000) throw new QishuiError('invalid_description', '歌单简介最多 2000 字') }
        if (isPrivate !== undefined) data.is_private = !!isPrivate
        return this.call('/luna/pc/me/playlist/update', { data }, true)
    }
    async deletePlaylists({ ids }) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new QishuiError('invalid_ids', '请选择有效歌单')
        return this.call('/luna/pc/me/playlist/delete', { data: { playlist_ids: ids.map(id) } }, true)
    }
    async playlistTracks({ id: playlistId, ids, action = 'append' }) {
        if (!['append', 'delete', 'sort'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 500) throw new QishuiError('invalid_tracks', '歌曲操作参数无效')
        return this.call('/luna/' + (action === 'sort' ? '' : 'pc/') + 'me/playlist/media/' + action, { data: { playlist_id: id(playlistId), media: ids.map(value => ({ id: id(value), type: 'track' })) } }, true)
    }
    async user({ id: userId }) {
        const p = await this.call('/luna/pc/users/' + id(userId), { method: 'GET', params: { user_id: id(userId), sec_uid: '' } })
        const user = qishuiUser(p.user)
        if (!user) throw new QishuiError('invalid_response', '用户资料暂不可用')
        return { user: { ...user, following: Number(p.user_stats?.count_following || 0),
            followers: Number(p.user_stats?.count_follower || 0), followStatus: Number(p.my_user_state?.follow_status || 0) } }
    }
    async follow({ id: userId, following = true }) {
        const p = await this.call('/luna/pc/me/' + (following ? 'follow' : 'unfollow'), { data: { user_id: id(userId) } }, true)
        if (p.follow_status === undefined) throw new QishuiError('invalid_response', '汽水未确认关注状态，请刷新查看')
        return { followStatus: Number(p.follow_status) }
    }
    async recent({ cursor = '', limit = 50 } = {}) {
        const p = await this.call('/luna/pc/me/recently-played-media', { method: 'GET', params: {
            cursor: String(cursor), count: String(count(limit)), media_type: 'track', scene: 'me_tab'
        } }, true)
        if (!p.status_info && p.status_code === undefined) throw new QishuiError('invalid_response', '汽水未返回最近播放记录')
        const media = rows(p.media), songs = unique(media.map(qishuiTrack))
        if (media.length && !songs.length) throw new QishuiError('invalid_response', '最近播放记录的歌曲格式暂不支持')
        return { songs, total: Number(p.total_num || 0), ...page(p) }
    }
    async deleteRecent({ ids }) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new QishuiError('invalid_ids', '请选择 1 至 100 首记录')
        return this.call('/luna/pc/me/recently-played-media/delete', { data: { media: ids.map(value => ({ id: id(value), type: 'track' })) } }, true)
    }
    async playlistSearch({ id: playlistId, query }) {
        const keyword = String(query || '').trim()
        if (!keyword || keyword.length > 200) throw new QishuiError('invalid_query', '请输入 1 至 200 字的搜索关键词')
        const p = await this.call('/luna/playlist/search', { data: { playlist_id: id(playlistId), query: keyword, session_id: '' } })
        return { songs: unique(qishuiList(p, 'media_resources').map(qishuiTrack)), hasMore: false }
    }
    async share({ type = 'track', id: itemId }) {
        if (!['track','album','artist','playlist','user'].includes(type)) throw new QishuiError('invalid_type', '分享类型无效')
        const p = await this.call('/luna/pc/share_info', { method: 'GET', params: { item_type: type, item_id: id(itemId), extra: '', scene: 0 } })
        let url
        try { url = new URL(p.share_info?.share_link || p.share_info?.share_url) } catch {}
        if (!url || url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(qishui\.com|douyin\.com)$/.test(url.hostname)) throw new QishuiError('invalid_response', '汽水未返回有效的官方分享链接')
        return { url: url.href }
    }
}
