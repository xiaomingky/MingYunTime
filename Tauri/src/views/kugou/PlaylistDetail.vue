<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Heart, Plus, Trash2, X, Bookmark, CheckSquare, Square } from 'lucide-vue-next'
import { usePlayerStore } from '../../store/player'
import { useMessageStore } from '../../store/message'
import { useKugouUserStore } from '../../store/kugou-user'
import {
    kugouPlaylistDetail, kugouPlaylistSongs, kugouPlaylistSongsNew,
    parseKugouPlaylistFull, normalizeKugouPlaylist, toKugouTrack
} from '../../api/kugou'
import KugouComment from '../../components/KugouComment.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'

const route = useRoute()
const playerStore = usePlayerStore()
const messageStore = useMessageStore()
const kugouUserStore = useKugouUserStore()

const loading = ref(false)
const detail = ref(null)
const songs = ref([])

const fetchDetail = async () => {
    const idParam = route.params.id
    if (!idParam) return
    loading.value = true
    try {
        // 文档明确：
        //   /playlist/track/all 需要 global_collection_id（推荐歌单用）
        //   /playlist/track/all/new 需要 listid（用户创建/收藏歌单用）
        //   /playlist/detail 需要 global_collection_id（获取歌单元信息）
        // 判断 idParam 是 global_collection_id 还是 listid：
        //   - 从 kugouUserStore.playlists 查找匹配项
        // 若已登录但歌单列表为空（如刷新页面后），先拉取用户歌单再查找
        if (kugouUserStore.isLoggedIn && !kugouUserStore.playlists.length) {
            await kugouUserStore.fetchUserPlaylists()
        }
        const findUserPlaylist = () => kugouUserStore.playlists.find(p =>
            String(p.listid) === String(idParam) ||
            String(p.global_collection_id) === String(idParam) ||
            String(p.specialid) === String(idParam) ||
            String(p.id) === String(idParam)
        )
        let userPlaylist = findUserPlaylist()

        // listid 判定:优先从 userPlaylist 取,没有则判断 idParam 是否为纯数字(用户歌单 listid 是数字)
        // 推荐歌单的 global_collection_id 通常以 "collection_" 开头或为长字符串
        const listid = userPlaylist?.listid || (/^\d+$/.test(String(idParam)) ? idParam : '')
        const gcid = userPlaylist?.global_collection_id ||
            (String(idParam).startsWith('collection_') ? idParam : '') ||
            (!/^\d+$/.test(String(idParam)) ? idParam : '')

        // 分页加载:每页最多300首(1000首会触发 error_code 30228),超过继续加载下一页
        const PAGE_SIZE = 300
        const fetchAllSongs = async (useNew, id) => {
            const fetcher = useNew ? kugouPlaylistSongsNew : kugouPlaylistSongs
            let page = 1
            let allRes = null
            let totalCount = 0
            // 循环加载直到没有更多
            while (true) {
                const res = await fetcher(id, page, PAGE_SIZE)
                if (!allRes) {
                    allRes = res
                } else {
                    // 合并 info/lists 数组
                    const data = res?.data || res
                    const list = data?.info || data?.lists || data?.songs || data?.list || []
                    if (Array.isArray(list) && list.length) {
                        const prevData = allRes?.data || allRes
                        if (prevData.info) prevData.info.push(...list)
                        else if (prevData.lists) prevData.lists.push(...list)
                        else if (prevData.songs) prevData.songs.push(...list)
                        else if (prevData.list) prevData.list.push(...list)
                    }
                }
                const data = res?.data || res
                const list = data?.info || data?.lists || data?.songs || data?.list || []
                totalCount += Array.isArray(list) ? list.length : 0
                // 不足一页或没有更多,停止加载
                if (!Array.isArray(list) || list.length < PAGE_SIZE) break
                page++
                // 安全限制:最多加载10页(10000首)
                if (page > 10) break
            }
            console.log(`[Kugou Playlist] 共加载 ${totalCount} 首`)
            return allRes
        }

        let res
        // 检查返回结果是否为空
        const isEmpty = (r) => {
            const d = r?.data || r
            // 兼容多种字段名：info/lists/songs/list/varlist
            const l = d?.info || d?.lists || d?.songs || d?.list || d?.varlist || []
            return !Array.isArray(l) || l.length === 0
        }
        if (userPlaylist?.listid) {
            // 用户歌单：用新版接口
            console.log('[Kugou Playlist] 用 listid 调用 /playlist/track/all/new:', userPlaylist.listid, 'gcid:', userPlaylist.global_collection_id)
            try {
                res = await fetchAllSongs(true, userPlaylist.listid)
                console.log('[Kugou Playlist] 新版响应:', JSON.stringify(res).slice(0, 500))
                // 新版接口可能返回成功但歌曲列表为空（收藏的歌单尚未同步到新版）
                // 回退策略（按优先级）：
                //   1. list_create_gid（收藏歌单的创建者真实 gcid，实测最有效）
                //   2. global_collection_id
                //   3. listid
                //   4. specialid
                if (isEmpty(res)) {
                    const fallbackIds = [
                        userPlaylist.list_create_gid,
                        userPlaylist.global_collection_id,
                        userPlaylist.listid,
                        userPlaylist.specialid
                    ].filter(Boolean)
                    let lastOldRes = null
                    for (const fid of fallbackIds) {
                        console.log('[Kugou Playlist] 新版返回空,尝试旧版用 id:', fid)
                        try {
                            const oldRes = await fetchAllSongs(false, fid)
                            lastOldRes = oldRes
                            if (!isEmpty(oldRes)) {
                                res = oldRes
                                console.log('[Kugou Playlist] 旧版成功,用 id:', fid)
                                break
                            }
                        } catch (e2) {
                            console.warn('[Kugou Playlist] 旧版用 id 失败:', fid, e2.message)
                        }
                    }
                    // 所有 fallback 都返回空：尝试从 list_info.list_create_gid 获取原始歌单 gcid
                    if (isEmpty(res) && lastOldRes) {
                        const listInfo = lastOldRes?.data?.list_info || lastOldRes?.list_info || {}
                        const createGid = listInfo.list_create_gid || ''
                        if (createGid) {
                            console.log('[Kugou Playlist] 从 list_create_gid 获取原始 gcid:', createGid)
                            try {
                                const gidRes = await fetchAllSongs(false, createGid)
                                if (!isEmpty(gidRes)) {
                                    res = gidRes
                                    console.log('[Kugou Playlist] 用 list_create_gid 成功')
                                    // 用原始歌单的元信息补全
                                    if (!userPlaylist.global_collection_id) {
                                        userPlaylist.global_collection_id = createGid
                                    }
                                }
                            } catch (e3) {
                                console.warn('[Kugou Playlist] list_create_gid 失败:', e3.message)
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Kugou Playlist] 新版失败，回退旧版:', e.message)
                const fallbackId = userPlaylist.global_collection_id || userPlaylist.listid
                res = await fetchAllSongs(false, fallbackId)
            }
        } else {
            // 搜索/推荐/收藏歌单：没有 listid 或 userPlaylist 不存在
            // idParam 可能是 global_collection_id(如 collection_xxx) 或 specialid(如 65)
            // /playlist/track/all(旧版) 需要 global_collection_id,传 specialid 会报 20010
            // 策略:优先用 userPlaylist.global_collection_id,其次用 idParam
            const gcidToUse = userPlaylist?.list_create_gid || userPlaylist?.global_collection_id || ''
            const listidToUse = userPlaylist?.listid || ''
            // 候选 ID 列表(去重,按优先级排序)
            // list_create_gid 是收藏歌单创建者的真实 gcid,比 global_collection_id(收藏条目) 更有效
            const oldApiCandidates = [gcidToUse, idParam].filter(v => v && v !== '0')
            const newApiCandidates = [listidToUse, idParam].filter(v => v && v !== '0')
            // 去重
            const uniq = arr => [...new Set(arr.map(String))]
            const oldIds = uniq(oldApiCandidates)
            const newIds = uniq(newApiCandidates)

            console.log('[Kugou Playlist] else 分支, oldIds:', oldIds, 'newIds:', newIds)
            // 依次尝试旧版接口(global_collection_id)
            for (const oid of oldIds) {
                console.log('[Kugou Playlist] 尝试旧版 /playlist/track/all, id:', oid)
                try {
                    const oldRes = await fetchAllSongs(false, oid)
                    if (!isEmpty(oldRes)) { res = oldRes; break }
                } catch (e) {
                    console.warn('[Kugou Playlist] 旧版 id=', oid, '失败:', e.message)
                }
            }
            // 旧版全部失败,尝试新版接口(listid)
            if (isEmpty(res)) {
                for (const nid of newIds) {
                    console.log('[Kugou Playlist] 尝试新版 /playlist/track/all/new, listid:', nid)
                    try {
                        const newRes = await fetchAllSongs(true, nid)
                        if (!isEmpty(newRes)) { res = newRes; break }
                    } catch (e) {
                        console.warn('[Kugou Playlist] 新版 listid=', nid, '失败:', e.message)
                    }
                }
            }
            // 所有尝试均失败:调 /playlist/detail 用 idParam 解析出 global_collection_id 再重试
            if (isEmpty(res)) {
                console.log('[Kugou Playlist] 直接调用失败,尝试 /playlist/detail 解析 gcid, idParam:', idParam)
                try {
                    const detailRes = await kugouPlaylistDetail(idParam)
                    const detailData = detailRes?.data
                    const detailList = Array.isArray(detailData) ? detailData : (detailData?.list || detailData?.info || [])
                    const firstDetail = Array.isArray(detailList) ? detailList[0] : detailData
                    const resolvedGcid = firstDetail?.global_collection_id || firstDetail?.gid || ''
                    const resolvedListid = firstDetail?.listid || ''
                    console.log('[Kugou Playlist] /playlist/detail 解析到 gcid:', resolvedGcid, 'listid:', resolvedListid)
                    if (resolvedGcid) {
                        res = await fetchAllSongs(false, resolvedGcid)
                    }
                    if (isEmpty(res) && resolvedListid) {
                        res = await fetchAllSongs(true, resolvedListid)
                    }
                    // 同步更新 userPlaylist 缓存(避免下次再走解析流程)
                    if (firstDetail && !userPlaylist) {
                        const normalized = normalizeKugouPlaylist(firstDetail, kugouUserStore.userid)
                        if (normalized?.id) {
                            userPlaylist = normalized
                        }
                    }
                } catch (e) {
                    console.warn('[Kugou Playlist] /playlist/detail 解析失败:', e.message)
                }
            }
        }
        console.log('[Kugou Playlist] 最终响应:', JSON.stringify(res).slice(0, 500))
        const parsed = parseKugouPlaylistFull(res)

        // 歌单元信息兜底策略：
        // 1. /playlist/track/all/new 的 list_info 可能缺少封面/标题/作者
        // 2. 优先从 userPlaylist（用户歌单列表缓存）补全
        // 3. 再调 /playlist/detail 用 global_collection_id 获取完整元信息
        if (userPlaylist) {
            if (!parsed.detail.coverImgUrl) parsed.detail.coverImgUrl = userPlaylist.coverImgUrl || ''
            if (!parsed.detail.name || parsed.detail.name === '未知歌单') parsed.detail.name = userPlaylist.name || ''
            if (!parsed.detail.creator) parsed.detail.creator = userPlaylist.creator || ''
            if (!parsed.detail.creatorId) parsed.detail.creatorId = userPlaylist.creatorId || ''
            if (!parsed.detail.songCount) parsed.detail.songCount = userPlaylist.songCount || 0
            if (!parsed.detail.playCount) parsed.detail.playCount = userPlaylist.playCount || 0
            // 补全 global_collection_id/specialid/listid（评论接口需要 gcid）
            if (!parsed.detail.global_collection_id) parsed.detail.global_collection_id = userPlaylist.global_collection_id || ''
            if (!parsed.detail.specialid) parsed.detail.specialid = userPlaylist.specialid || ''
            if (!parsed.detail.listid) parsed.detail.listid = userPlaylist.listid || ''
        }
        // 如果 global_collection_id 存在且仍缺元信息，调 /playlist/detail 补全
        if (gcid && (!parsed.detail.coverImgUrl || !parsed.detail.creator || parsed.detail.name === '未知歌单')) {
            try {
                console.log('[Kugou Playlist] 调用 /playlist/detail 补全元信息, gcid:', gcid)
                const detailRes = await kugouPlaylistDetail(gcid)
                const detailData = detailRes?.data
                const detailList = Array.isArray(detailData) ? detailData : (detailData?.list || detailData?.info || [])
                const firstDetail = Array.isArray(detailList) ? detailList[0] : detailData
                if (firstDetail) {
                    const normalized = normalizeKugouPlaylist(firstDetail, kugouUserStore.userid)
                    if (normalized) {
                        if (!parsed.detail.coverImgUrl) parsed.detail.coverImgUrl = normalized.coverImgUrl || ''
                        if (!parsed.detail.name || parsed.detail.name === '未知歌单') parsed.detail.name = normalized.name || ''
                        if (!parsed.detail.creator) parsed.detail.creator = normalized.creator || ''
                        if (!parsed.detail.songCount) parsed.detail.songCount = normalized.songCount || 0
                        if (!parsed.detail.playCount) parsed.detail.playCount = normalized.playCount || 0
                    }
                }
            } catch (e) {
                console.warn('[Kugou Playlist] /playlist/detail 补全失败:', e.message)
            }
        }

        // 排序已在 parseKugouPlaylistFull 内完成（按播放量/添加时间从大到小）

        detail.value = parsed.detail
        songs.value = parsed.songs
        if (!parsed.songs.length && !parsed.detail.name) {
            messageStore.warning('歌单为空或加载失败')
        }
    } catch (e) {
        console.error('[Kugou Playlist] error:', e)
        messageStore.error('酷狗歌单加载失败')
    } finally {
        loading.value = false
    }
}

const playAll = () => {
    if (!songs.value.length) return
    const list = songs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(list[0], list)
}

// 视图切换：歌曲列表 / 评论
const viewTab = ref('songs')

const playSong = (song) => {
    const track = toKugouTrack(song)
    if (!track) return
    const list = songs.value.map(toKugouTrack).filter(Boolean)
    playerStore.playSong(track, list)
}

const toggleLike = async (song) => {
    // hash 校验在 toggleLikeSong 内部完成,不重复提示
    await kugouUserStore.toggleLikeSong(song)
}

const isLiked = (hash) => kugouUserStore.isSongLiked(hash)

// ========== 歌单管理功能 ==========
// 添加到歌单弹窗
const showAddToPlaylist = ref(false)
const addTargetSong = ref(null)
// 新建歌单弹窗
const showCreatePlaylist = ref(false)
const newPlaylistName = ref('')
const creating = ref(false)
// 批量选择
const batchMode = ref(false)
const selectedSongs = ref([])  // 选中的歌曲对象数组
const batchRemoving = ref(false)

const toggleBatchMode = () => {
    batchMode.value = !batchMode.value
    if (!batchMode.value) selectedSongs.value = []
}

const toggleSelect = (song) => {
    const idx = selectedSongs.value.findIndex(s => s.hash === song.hash)
    if (idx >= 0) selectedSongs.value.splice(idx, 1)
    else selectedSongs.value.push(song)
}

const isSelected = (hash) => selectedSongs.value.some(s => s.hash === hash)

const selectAll = () => {
    if (selectedSongs.value.length === songs.value.length) {
        selectedSongs.value = []
    } else {
        selectedSongs.value = songs.value.slice()
    }
}

const showBatchRemoveConfirm = ref(false)
const batchRemove = async () => {
    showBatchRemoveConfirm.value = false
    if (!selectedSongs.value.length) return
    batchRemoving.value = true
    const listid = detail.value?.listid || detail.value?.id
    const ok = await kugouUserStore.batchRemoveFromPlaylist(listid, selectedSongs.value)
    if (ok) {
        const removedHashes = new Set(selectedSongs.value.map(s => s.hash))
        songs.value = songs.value.filter(s => !removedHashes.has(s.hash))
        selectedSongs.value = []
        batchMode.value = false
    }
    batchRemoving.value = false
}

// 当前歌单是否是用户自己创建的(用于显示"收藏歌单"按钮)
const isMinePlaylist = computed(() => {
    if (!detail.value || !kugouUserStore.isLoggedIn) return false
    // 检查是否在用户创建的歌单列表中
    const found = kugouUserStore.playlists.find(p => String(p.id) === String(route.params.id))
    return found?.isMine ?? false
})

// 当前歌单是否已被用户收藏
const isCollected = computed(() => {
    if (!detail.value || !kugouUserStore.isLoggedIn) return false
    return kugouUserStore.playlists.some(p =>
        String(p.id) === String(route.params.id) && !p.isMine
    )
})

// 收藏当前歌单
const collectCurrentPlaylist = async () => {
    if (!detail.value) return
    await kugouUserStore.collectPlaylist(detail.value)
}

// 删除当前歌单(仅自己创建的可删除)
const showDeletePlaylistConfirm = ref(false)
const deleteCurrentPlaylist = async () => {
    showDeletePlaylistConfirm.value = false
    if (!detail.value?.listid && !detail.value?.id) return
    const listid = detail.value.listid || detail.value.id
    const ok = await kugouUserStore.deletePlaylist(listid)
    if (ok) {
        // 返回上一页
        history.back()
    }
}

// 打开"添加到歌单"弹窗
const openAddToPlaylist = (song, event) => {
    event?.stopPropagation()
    addTargetSong.value = song
    showAddToPlaylist.value = true
}

// 添加到指定歌单
const addToPlaylist = async (playlist) => {
    if (!addTargetSong.value || !playlist?.id) return
    const ok = await kugouUserStore.addSongToPlaylist(playlist.id, addTargetSong.value)
    if (ok) {
        showAddToPlaylist.value = false
        addTargetSong.value = null
    }
}

// 从当前歌单移除歌曲(仅自己创建的歌单可操作)
const showRemoveSongConfirm = ref(false)
const removeSongTarget = ref(null)
const removeFromCurrentPlaylist = async (song, event) => {
    event?.stopPropagation()
    if (!detail.value?.listid && !detail.value?.id) return
    removeSongTarget.value = song
    showRemoveSongConfirm.value = true
}
const confirmRemoveSong = async () => {
    showRemoveSongConfirm.value = false
    const song = removeSongTarget.value
    if (!song) return
    const listid = detail.value.listid || detail.value.id
    const ok = await kugouUserStore.removeSongFromPlaylist(listid, song)
    if (ok) {
        // 从列表中移除
        songs.value = songs.value.filter(s => s.hash !== song.hash)
    }
    removeSongTarget.value = null
}

// 新建歌单
const createPlaylist = async () => {
    const name = newPlaylistName.value.trim()
    if (!name) {
        messageStore.warning('请输入歌单名称')
        return
    }
    creating.value = true
    const ok = await kugouUserStore.createPlaylist(name)
    if (ok) {
        showCreatePlaylist.value = false
        newPlaylistName.value = ''
    }
    creating.value = false
}

// 可添加目标的歌单列表(排除当前歌单和"我喜欢"歌单)
const targetPlaylists = computed(() => {
    const currentId = route.params.id
    return kugouUserStore.playlists.filter(p =>
        String(p.id) !== String(currentId) && p.isMine
    )
})

watch(() => route.params.id, fetchDetail)
onMounted(fetchDetail)
</script>

<template>
    <div class="kugou-playlist-page">
        <div v-if="loading" class="kugou-loading">加载中...</div>
        <template v-else>
        <div class="kugou-playlist-header" v-if="detail">
            <div class="kugou-playlist-cover" v-if="String(detail.id) === String(kugouUserStore.likedPlaylistId)" style="background: linear-gradient(135deg, #2CA2F5, #4ad295); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(44, 162, 245, 0.3);">
                <Heart :size="100" fill="white" color="white" style="filter: drop-shadow(0 2px 8px rgba(0,0,0,0.2));" />
            </div>
            <img v-else :src="detail.coverImgUrl" class="kugou-playlist-cover" />
            <div class="kugou-playlist-info">
                <h1 class="kugou-playlist-name">{{ detail.name }}</h1>
                <div class="kugou-playlist-creator">创建者：{{ detail.creator }}</div>
                <div class="kugou-playlist-meta">
                    <span v-if="detail.songCount">歌曲数：{{ detail.songCount }}</span>
                    <span v-if="detail.playCount">播放：{{ detail.playCount }}</span>
                </div>
                <div class="kugou-playlist-desc" v-if="detail.description">{{ detail.description }}</div>
                <div class="kugou-playlist-actions">
                    <button class="kugou-play-btn" @click="playAll">播放全部</button>
                    <!-- 批量管理按钮: 仅自己创建的歌单显示(排除"我喜欢") -->
                    <button
                        v-if="isMinePlaylist && detail.id !== kugouUserStore.likedPlaylistId && songs.length"
                        :class="batchMode ? 'kugou-batch-btn-active' : 'kugou-collect-btn'"
                        @click="toggleBatchMode"
                    >
                        <Trash2 :size="14" />
                        <span>{{ batchMode ? '退出批量' : '批量管理' }}</span>
                    </button>
                    <!-- 收藏歌单按钮: 仅在登录且非自己创建的歌单显示 -->
                    <button
                        v-if="kugouUserStore.isLoggedIn && !isMinePlaylist && !isCollected"
                        class="kugou-collect-btn"
                        @click="collectCurrentPlaylist"
                    >
                        <Bookmark :size="14" />
                        <span>收藏歌单</span>
                    </button>
                    <!-- 已收藏标识 -->
                    <span v-else-if="kugouUserStore.isLoggedIn && !isMinePlaylist && isCollected" class="kugou-collected-tag">
                        <Bookmark :size="14" :fill="'currentColor'" />
                        <span>已收藏</span>
                    </span>
                    <!-- 删除歌单按钮: 仅自己创建的歌单显示(排除"我喜欢"歌单) -->
                    <button
                        v-if="isMinePlaylist && detail.id !== kugouUserStore.likedPlaylistId"
                        class="kugou-delete-btn"
                        @click="showDeletePlaylistConfirm = true"
                    >
                        <Trash2 :size="14" />
                        <span>删除歌单</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- 视图切换标签 -->
        <div class="kugou-view-tabs">
            <div class="kugou-view-tab" :class="{ active: viewTab === 'songs' }" @click="viewTab = 'songs'">歌曲列表</div>
            <div class="kugou-view-tab" :class="{ active: viewTab === 'comments' }" @click="viewTab = 'comments'">评论</div>
        </div>

        <div v-if="viewTab === 'songs'" class="kugou-song-list">
            <!-- 批量操作栏 -->
            <div v-if="batchMode" class="kugou-batch-bar">
                <div class="kugou-batch-select-all" @click="selectAll">
                    <CheckSquare v-if="selectedSongs.length === songs.length && songs.length > 0" :size="16" class="kugou-check-icon active" />
                    <Square v-else :size="16" class="kugou-check-icon" />
                    <span>全选</span>
                </div>
                <span class="kugou-batch-count">已选 {{ selectedSongs.length }} 首</span>
                <button class="kugou-batch-remove-btn" @click="showBatchRemoveConfirm = true" :disabled="!selectedSongs.length || batchRemoving">
                    {{ batchRemoving ? '移除中...' : '移除选中' }}
                </button>
            </div>
            <div v-for="(s, i) in songs" :key="s.id || i" class="kugou-song-item" @click="batchMode && toggleSelect(s)" @dblclick="!batchMode && playSong(s)">
                <div v-if="batchMode" class="kugou-col-check" @click.stop="toggleSelect(s)">
                    <CheckSquare v-if="isSelected(s.hash)" :size="16" class="kugou-check-icon active" />
                    <Square v-else :size="16" class="kugou-check-icon" />
                </div>
                <span class="kugou-song-index">{{ i + 1 }}</span>
                <img v-if="s.picUrl" :src="s.picUrl" class="kugou-song-cover" loading="lazy" />
                <div class="kugou-song-info">
                    <div class="kugou-song-name">
                        <span class="name-text">{{ s.name }}</span>
                        <span v-if="s.fee === 1 || s.isVip" class="kugou-vip-tag">VIP</span>
                    </div>
                    <div class="kugou-song-artist">{{ s.artist }}</div>
                </div>
                <div class="kugou-song-album">{{ s.album }}</div>
                <div v-if="!batchMode" class="kugou-song-actions">
                    <Plus :size="16" class="kugou-action-icon" title="添加到歌单" @click="openAddToPlaylist(s, $event)" />
                    <Heart
                        :size="16"
                        class="kugou-action-icon kugou-like-icon"
                        :fill="isLiked(s.hash) ? '#EC4141' : 'none'"
                        :color="isLiked(s.hash) ? '#EC4141' : 'currentColor'"
                        @click.stop="toggleLike(s)"
                    />
                    <Trash2
                        v-if="isMinePlaylist && detail.id !== kugouUserStore.likedPlaylistId"
                        :size="16"
                        class="kugou-action-icon kugou-remove-icon"
                        title="从歌单移除"
                        @click="removeFromCurrentPlaylist(s, $event)"
                    />
                </div>
                <div class="kugou-song-duration">{{ Math.floor(s.duration / 60000) }}:{{ String(Math.floor(s.duration / 1000 % 60)).padStart(2, '0') }}</div>
            </div>
        </div>

        <div v-if="!loading && !songs.length" class="kugou-empty">歌单为空或加载失败</div>
        </template>

        <!-- 评论区 (歌单评论,用 global_collection_id) -->
        <KugouComment
            v-if="viewTab === 'comments' && detail && (detail.global_collection_id || route.params.id)"
            :id="detail.global_collection_id || route.params.id"
            type="playlist"
        />

        <!-- 添加到歌单弹窗 -->
        <div v-if="showAddToPlaylist" class="kugou-modal-overlay" @click.self="showAddToPlaylist = false">
            <div class="kugou-modal">
                <div class="kugou-modal-header">
                    <span class="kugou-modal-title">添加到歌单</span>
                    <X :size="18" class="kugou-modal-close" @click="showAddToPlaylist = false" />
                </div>
                <div class="kugou-modal-body">
                    <div class="kugou-modal-add-new" @click="showCreatePlaylist = true; showAddToPlaylist = false">
                        <Plus :size="16" />
                        <span>新建歌单</span>
                    </div>
                    <div v-if="!targetPlaylists.length" class="kugou-modal-empty">暂无其他歌单</div>
                    <div
                        v-for="p in targetPlaylists"
                        :key="p.id"
                        class="kugou-modal-playlist-item"
                        @click="addToPlaylist(p)"
                    >
                        <Heart v-if="p.id === kugouUserStore.likedPlaylistId" :size="16" :fill="'#EC4141'" :color="'#EC4141'" />
                        <img v-else-if="p.coverImgUrl" :src="p.coverImgUrl" class="kugou-modal-cover" />
                        <div v-else class="kugou-modal-cover-placeholder"><Heart :size="14" /></div>
                        <span class="kugou-modal-playlist-name">{{ p.name }}</span>
                        <span class="kugou-modal-playlist-count">{{ p.songCount || 0 }}首</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 新建歌单弹窗 -->
        <div v-if="showCreatePlaylist" class="kugou-modal-overlay" @click.self="showCreatePlaylist = false">
            <div class="kugou-modal kugou-modal-sm">
                <div class="kugou-modal-header">
                    <span class="kugou-modal-title">新建歌单</span>
                    <X :size="18" class="kugou-modal-close" @click="showCreatePlaylist = false" />
                </div>
                <div class="kugou-modal-body">
                    <input
                        v-model="newPlaylistName"
                        class="kugou-modal-input"
                        placeholder="请输入歌单名称"
                        @keyup.enter="createPlaylist"
                        autofocus
                    />
                    <button class="kugou-modal-confirm-btn" @click="createPlaylist" :disabled="creating">
                        {{ creating ? '创建中...' : '创建' }}
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 批量移除歌曲确认弹窗 -->
    <ConfirmModal
        :visible="showBatchRemoveConfirm"
        title="移除歌曲"
        :message="`确定移除选中的 ${selectedSongs.length} 首歌曲吗？`"
        confirmText="移除"
        @confirm="batchRemove"
        @cancel="showBatchRemoveConfirm = false"
    />
    <!-- 删除歌单确认弹窗 -->
    <ConfirmModal
        :visible="showDeletePlaylistConfirm"
        title="删除歌单"
        :message="`确定删除歌单'${detail?.name}'吗？删除后不可恢复。`"
        confirmText="删除"
        @confirm="deleteCurrentPlaylist"
        @cancel="showDeletePlaylistConfirm = false"
    />
    <!-- 从歌单移除单首歌曲确认弹窗 -->
    <ConfirmModal
        :visible="showRemoveSongConfirm"
        title="移除歌曲"
        :message="`确定从歌单移除'${removeSongTarget?.name}'吗？`"
        confirmText="移除"
        @confirm="confirmRemoveSong"
        @cancel="showRemoveSongConfirm = false"
    />
</template>

<style scoped>
.kugou-playlist-page {
    padding: 20px 28px;
    height: 100%;
    overflow-y: auto;
}
.kugou-loading {
    text-align: center;
    color: var(--text-light);
    padding: 80px 0;
    font-size: 14px;
}
.kugou-playlist-header {
    display: flex;
    gap: 24px;
    margin-bottom: 28px;
}
.kugou-playlist-cover {
    width: 200px;
    height: 200px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
}
.kugou-playlist-info {
    flex: 1;
    display: flex;
    flex-direction: column;
}
.kugou-playlist-name {
    font-size: 24px;
    color: var(--text-main);
    margin-bottom: 12px;
}
.kugou-playlist-creator {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 8px;
}
.kugou-playlist-meta {
    color: var(--text-light);
    font-size: 13px;
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
}
.kugou-playlist-desc {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 16px;
    max-height: 80px;
    overflow-y: auto;
}
.kugou-playlist-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
}
/* 视图切换标签 */
.kugou-view-tabs {
    display: flex;
    gap: 4px;
    margin: 16px 0 12px;
    border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
}
.kugou-view-tab {
    padding: 8px 20px;
    font-size: 14px;
    color: var(--text-secondary, #666);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px;
}
.kugou-view-tab:hover { color: var(--primary-color, #2CA2F5); }
.kugou-view-tab.active {
    color: var(--primary-color, #2CA2F5);
    border-bottom-color: var(--primary-color, #2CA2F5);
    font-weight: 500;
}
.kugou-play-btn {
    align-self: flex-start;
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 28px;
    border-radius: 18px;
    cursor: pointer;
    font-size: 14px;
}
.kugou-play-btn:hover { opacity: 0.9; }
.kugou-collect-btn {
    display: flex; align-items: center; gap: 4px;
    background: transparent; color: var(--primary-color);
    border: 1px solid var(--primary-color);
    padding: 7px 16px; border-radius: 18px; cursor: pointer; font-size: 13px;
}
.kugou-collect-btn:hover { background: var(--primary-color); color: white; }
.kugou-collected-tag {
    display: flex; align-items: center; gap: 4px;
    color: var(--text-light); font-size: 13px; padding: 7px 16px;
}
.kugou-delete-btn {
    display: flex; align-items: center; gap: 4px;
    background: transparent; color: #ff6b6b;
    border: 1px solid #ff6b6b;
    padding: 7px 16px; border-radius: 18px; cursor: pointer; font-size: 13px;
}
.kugou-delete-btn:hover { background: #ff6b6b; color: white; }
.kugou-batch-btn-active {
    display: flex; align-items: center; gap: 4px;
    background: var(--primary-color); color: white;
    border: none; padding: 7px 16px; border-radius: 18px; cursor: pointer; font-size: 13px;
}
.kugou-batch-bar {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 12px; margin-bottom: 8px;
    background: var(--hover-bg); border-radius: 6px;
}
.kugou-batch-select-all {
    display: flex; align-items: center; gap: 6px;
    cursor: pointer; font-size: 13px; color: var(--text-main);
}
.kugou-batch-count { font-size: 13px; color: var(--text-light); }
.kugou-batch-remove-btn {
    margin-left: auto; padding: 6px 16px; border-radius: 14px;
    border: none; background: #ff6b6b; color: white; cursor: pointer; font-size: 13px;
    transition: opacity 0.15s;
}
.kugou-batch-remove-btn:hover:not(:disabled) { opacity: 0.85; }
.kugou-batch-remove-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.kugou-col-check {
    width: 20px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; cursor: pointer;
}
.kugou-check-icon {
    color: #ccc;
    transition: color 0.2s;
}
.kugou-check-icon.active {
    color: var(--primary-color);
}
.kugou-song-actions {
    display: flex; gap: 8px; flex-shrink: 0; align-items: center;
    opacity: 0; transition: opacity 0.15s;
}
.kugou-song-item:hover .kugou-song-actions { opacity: 1; }
.kugou-action-icon {
    cursor: pointer; color: var(--text-light);
    transition: color 0.15s, transform 0.15s;
}
.kugou-action-icon:hover { color: var(--primary-color); transform: scale(1.2); }
.kugou-like-icon:hover { color: #EC4141; }
.kugou-remove-icon:hover { color: #ff6b6b; }

/* 弹窗样式复用 App.vue 全局 .kugou-modal-* 类,此处不再重复定义 */

.kugou-song-list {
    display: flex;
    flex-direction: column;
}
.kugou-song-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    gap: 12px;
}
.kugou-song-item:hover { background: var(--hover-bg); }
.kugou-song-index {
    width: 28px;
    color: var(--text-light);
    font-size: 13px;
    text-align: center;
    flex-shrink: 0;
}
.kugou-song-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
}
.kugou-song-info { flex: 1; min-width: 0; }
.kugou-song-name {
    font-size: 14px;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 4px;
}
.kugou-song-name .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
}
.kugou-song-artist {
    font-size: 12px;
    color: var(--text-light);
    margin-top: 2px;
}
.kugou-song-album {
    font-size: 12px;
    color: var(--text-light);
    width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kugou-song-duration {
    font-size: 12px;
    color: var(--text-light);
    width: 50px;
    text-align: right;
}
.kugou-empty {
    text-align: center;
    color: var(--text-light);
    padding: 80px 0;
    font-size: 14px;
}
</style>
