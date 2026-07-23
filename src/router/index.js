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
import CloudMusic from '../views/CloudMusic.vue'
import Downloads from '../views/Downloads.vue'

// 动漫模块（懒加载，减小首屏 bundle）
const Anime = () => import('../views/Anime.vue')
const AnimeDetail = () => import('../views/AnimeDetail.vue')

// 电影模块（懒加载）
const Movie = () => import('../views/Movie.vue')
const MovieDetail = () => import('../views/MovieDetail.vue')

const routes = [
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
        path: '/cloud',
        name: 'CloudMusic',
        component: CloudMusic
    },
    {
        path: '/downloads',
        name: 'Downloads',
        component: Downloads
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
