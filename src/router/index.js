import { createRouter, createWebHashHistory } from 'vue-router'
import { useUserStore } from '../store/user'
import Discovery from '../views/Discovery.vue'
import PlaylistDetail from '../views/PlaylistDetail.vue'
import Video from '../views/Video.vue'
import Search from '../views/Search.vue'
import LocalMusic from '../views/LocalMusic.vue'
import RecentPlay from '../views/RecentPlay.vue'
import LocalVideo from '../views/LocalVideo.vue'
import AlbumDetail from '../views/AlbumDetail.vue'
import Downloads from '../views/Downloads.vue'
import NetEaseCloud from '../views/NetEaseCloud.vue'
import Settings from '../views/Settings.vue'

// QQ 音乐模块（懒加载，与网易云路由隔离）
const QQDiscovery = () => import('../views/qq/Discovery.vue')
const QQSearch = () => import('../views/qq/Search.vue')
const QQPlaylistDetail = () => import('../views/qq/PlaylistDetail.vue')
const QQSingerDetail = () => import('../views/qq/SingerDetail.vue')
const QQAlbumDetail = () => import('../views/qq/AlbumDetail.vue')
const QQLiked = () => import('../views/qq/Liked.vue')
const QQSingerList = () => import('../views/qq/SingerList.vue')
const QQPlaylistCategory = () => import('../views/qq/PlaylistCategory.vue')

// 酷狗概念版模块（懒加载，与网易云/QQ 路由隔离）
const KugouDiscovery = () => import('../views/kugou/Discovery.vue')
const KugouSearch = () => import('../views/kugou/Search.vue')
const KugouPlaylistDetail = () => import('../views/kugou/PlaylistDetail.vue')
const KugouSingerDetail = () => import('../views/kugou/SingerDetail.vue')
const KugouAlbumDetail = () => import('../views/kugou/AlbumDetail.vue')
const KugouLiked = () => import('../views/kugou/Liked.vue')
const KugouSingerList = () => import('../views/kugou/SingerList.vue')
const KugouPlaylistCategory = () => import('../views/kugou/PlaylistCategory.vue')

// 动漫模块（懒加载，减小首屏 bundle）
const Anime = () => import('../views/Anime.vue')
const AnimeDetail = () => import('../views/AnimeDetail.vue')

// 电影模块（懒加载）
const Movie = () => import('../views/Movie.vue')
const MovieDetail = () => import('../views/MovieDetail.vue')

// B站视频专区（懒加载，独立于影视区）
const BilibiliVideo = () => import('../views/BilibiliVideo.vue')
const BilibiliVideoDetail = () => import('../views/BilibiliVideoDetail.vue')
const BiliUserSpace = () => import('../views/BiliUserSpace.vue')

const routes = [
    // ========== 网易云平台路由（默认） ==========
    {
        path: '/',
        name: 'Discovery',
        component: Discovery
    },
    {
        path: '/playlist/:id',
        name: 'PlaylistDetail',
        component: PlaylistDetail
    },
    {
        path: '/video',
        name: 'Video',
        component: Video
    },
    {
        path: '/search',
        name: 'Search',
        component: Search
    },
    {
        path: '/local',
        name: 'LocalMusic',
        component: LocalMusic
    },
    {
        path: '/recent',
        name: 'RecentPlay',
        component: RecentPlay
    },
    {
        path: '/local-video',
        name: 'LocalVideo',
        component: LocalVideo
    },
    {
        path: '/album/:id',
        name: 'AlbumDetail',
        component: AlbumDetail
    },
    {
        path: '/desktop-lyrics',
        name: 'DesktopLyrics',
        component: () => import('../views/DesktopLyrics.vue')
    },
    {
        path: '/netease-cloud',
        name: 'NetEaseCloud',
        component: NetEaseCloud
    },
    {
        path: '/downloads',
        name: 'Downloads',
        component: Downloads
    },
    {
        path: '/settings',
        name: 'Settings',
        component: Settings
    },
    // 动漫模块
    {
        path: '/anime',
        name: 'Anime',
        component: Anime
    },
    {
        path: '/anime/:source/:id',
        name: 'AnimeDetail',
        component: AnimeDetail
    },
    // 电影模块
    {
        path: '/movie',
        name: 'Movie',
        component: Movie
    },
    {
        path: '/movie/:source/:id',
        name: 'MovieDetail',
        component: MovieDetail
    },
    // B站视频专区（独立模块，仿B站官方）
    {
        path: '/bilibili',
        name: 'BilibiliVideo',
        component: BilibiliVideo
    },
    {
        path: '/bilibili/:bvid',
        name: 'BilibiliVideoDetail',
        component: BilibiliVideoDetail
    },
    {
        // PGC（番剧/电影）季详情：搜索结果点击番剧/电影卡片进入
        path: '/bilibili/season/:seasonId',
        name: 'BilibiliSeasonDetail',
        component: BilibiliVideoDetail
    },
    {
        // UP 主主页：点击作者/头像进入
        path: '/bilibili/user/:mid',
        name: 'BiliUserSpace',
        component: BiliUserSpace
    },

    // ========== QQ 音乐平台路由（独立路径前缀 /qq/） ==========
    {
        path: '/qq',
        name: 'QQDiscovery',
        component: QQDiscovery
    },
    {
        path: '/qq/search',
        name: 'QQSearch',
        component: QQSearch
    },
    {
        path: '/qq/playlist/:id',
        name: 'QQPlaylistDetail',
        component: QQPlaylistDetail
    },
    {
        path: '/qq/singer/:id',
        name: 'QQSingerDetail',
        component: QQSingerDetail
    },
    {
        path: '/qq/album/:id',
        name: 'QQAlbumDetail',
        component: QQAlbumDetail
    },
    {
        path: '/qq/liked',
        name: 'QQLiked',
        component: QQLiked
    },
    {
        path: '/qq/singers',
        name: 'QQSingerList',
        component: QQSingerList
    },
    {
        path: '/qq/categories',
        name: 'QQPlaylistCategory',
        component: QQPlaylistCategory
    },

    // ========== 酷狗概念版平台路由（独立路径前缀 /kugou/） ==========
    {
        path: '/kugou',
        name: 'KugouDiscovery',
        component: KugouDiscovery
    },
    {
        path: '/kugou/search',
        name: 'KugouSearch',
        component: KugouSearch
    },
    {
        path: '/kugou/playlist/:id',
        name: 'KugouPlaylistDetail',
        component: KugouPlaylistDetail
    },
    {
        path: '/kugou/singer/:id',
        name: 'KugouSingerDetail',
        component: KugouSingerDetail
    },
    {
        path: '/kugou/album/:id',
        name: 'KugouAlbumDetail',
        component: KugouAlbumDetail
    },
    {
        path: '/kugou/liked',
        name: 'KugouLiked',
        component: KugouLiked
    },
    {
        path: '/kugou/singers',
        name: 'KugouSingerList',
        component: KugouSingerList
    },
    {
        path: '/kugou/categories',
        name: 'KugouPlaylistCategory',
        component: KugouPlaylistCategory
    }
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

// 账号密码锁路由守护：访问“我喜欢的音乐”或自己创建的歌单时拦截
let pendingLockTarget = null

export function setPendingLockTarget(path) {
    pendingLockTarget = path
}

export function getPendingLockTarget() {
    const t = pendingLockTarget
    pendingLockTarget = null
    return t
}

router.beforeEach((to, from, next) => {
    // 平台路由守卫:根据当前平台重定向首页（三平台互斥）
    // QQ/酷狗 平台访问 / → 跳转到对应平台首页
    // 网易云平台访问 /qq 或 /kugou → 跳回 /
    // QQ 平台访问 /kugou → 跳 /qq;酷狗平台访问 /qq → 跳 /kugou
    const platform = localStorage.getItem('current_platform') || 'netease'
    if ((platform === 'qq' || platform === 'kugou') && to.path === '/') {
        return next(platform === 'qq' ? '/qq' : '/kugou')
    }
    if (platform === 'netease' && (to.path === '/qq' || to.path === '/kugou') &&
        !from.path.startsWith('/qq') && !from.path.startsWith('/kugou')) {
        return next('/')
    }
    if (platform === 'qq' && to.path === '/kugou') {
        return next('/qq')
    }
    if (platform === 'kugou' && to.path === '/qq') {
        return next('/kugou')
    }

    // 账号密码锁路由守护:访问"我喜欢的音乐"或自己创建的歌单时拦截
    const userStore = useUserStore()
    if (!userStore.isLoggedIn || !userStore.lockStatus.locked || userStore.lockStatus.unlocked) {
        return next()
    }
    const id = to.params.id
    if (!id) return next()

    const isOwn = String(id) === String(userStore.likedPlaylistId) ||
        userStore.playlists.some(p => String(p.id) === String(id))
    if (isOwn) {
        setPendingLockTarget(to.fullPath)
        return next(false)
    }
    next()
})

export default router
