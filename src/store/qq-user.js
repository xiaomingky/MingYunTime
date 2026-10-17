import { defineStore } from 'pinia'
import {
    qqWebLogin, qqValidateSession, qqRestoreSession, qqLogout, qqUserLikedSongs,
    qqOperMyLike, qqOperSonglist, qqSongDetail, toQQTrack, qqPlaylistGroup,
    getQQCookie, setQQCookie, clearQQCookie, getQQProfile, setQQProfile, clearQQProfile
} from '../api/qq'

export const useQQUserStore = defineStore('qq-user', {
    state: () => ({ sessionCheckedAt: 0,
        isLoggedIn: false, profile: getQQProfile(),
        cookie: getQQCookie(), uin: getQQProfile()?.userId || '', playlists: [], playlistsLoading:false, playlistsError:'', playlistsRequest:0, collectedPlaylists:[],
        likedPlaylistId: '', likedSongs: [], likedLoaded: false, likedIncomplete: false,
        logining: false, loginMessage: '', accountError: '', revision: 0, likeBusy: false,
        vipLoading: false, vipError: '', vipCheckedAt: 0, vipRequest: 0
    }),
    getters: {
        createdPlaylists: state => state.playlists.filter(p => String(p.id) !== String(state.likedPlaylistId))
    },
    actions: {
        async restoreSession() {
            if (this.logining || this.isLoggedIn) return
            const revision = this.revision
            this.logining = true
            try {
                const legacy = getQQCookie()
                if (legacy) {
                    const result = await this.acceptSession(legacy)
                    if (!result.success && revision === this.revision) this.accountError = result.message
                    return result
                }
                const result = await qqRestoreSession()
                if (revision !== this.revision) return
                if (result?.code !== 0) throw new Error(result?.message || 'QQ 登录恢复失败，请重试')
                if (!result.data?.cookie || !result.data?.profile) return
                this.revision++
                this.cookie = result.data.cookie; this.profile = result.data.profile
                this.uin = String(this.profile.userId); this.isLoggedIn = true
                setQQCookie(this.cookie); setQQProfile(this.profile)
                this.vipError = ''; this.vipCheckedAt = Date.now(); this.sessionCheckedAt = Date.now()
                await Promise.allSettled([this.fetchUserPlaylists(), this.fetchLikedSongs()])
                this.syncPlayerLikes()
            } catch (error) { if (revision === this.revision) this.accountError = error.message }
            finally { this.logining = false }
        },
        async acceptSession(cookie, suppliedUin = '', isCurrent = () => true, nativeGeneration, qrGeneration) {
            const revision = this.revision
            if (!isCurrent()) return { success: false, message: '登录已取消' }
            const res = await qqValidateSession(cookie, suppliedUin, true, nativeGeneration, qrGeneration)
            if (revision !== this.revision || !isCurrent()) return { success: false, message: '登录已取消' }
            if (res?.code !== 0 || !res?.data?.userId) return { success: false, message: res?.message || '登录凭据无效' }
            this.revision++
            this.cookie = cookie
            this.vipRequest++; this.vipLoading = false; this.vipError = ''
            this.uin = String(res.data.userId)
            this.profile = { ...res.data, nickname: res.data.nickname || 'QQ 音乐用户' }
            this.isLoggedIn = true
            this.playlists = []; this.collectedPlaylists = []; this.playlistsError = ''; this.likedSongs = []; this.likedLoaded = false; this.likedPlaylistId = ''
            this.accountError = ''; this.loginMessage = '登录成功'
            localStorage.removeItem('qq_liked_songs')
            setQQCookie(cookie); setQQProfile(this.profile)
            this.vipError = ''; this.vipCheckedAt = Date.now(); this.sessionCheckedAt = Date.now()
            const results = await Promise.allSettled([this.fetchUserPlaylists(), this.fetchLikedSongs()])
            if (revision + 1 !== this.revision) return { success: false, message: '账号已切换' }
            const failure = results.find(result => result.status === 'rejected')
            if (failure) this.accountError = failure.reason?.message || '部分账号数据未同步，请刷新后重试'
            this.syncPlayerLikes()
            return { success: true, profile: this.profile }
        },
        async webLogin(mode = 'qq') {
            if (this.logining) return { success: false, message: '正在登录中，请勿重复操作' }
            this.logining = true; this.loginMessage = '请在 QQ 音乐官网窗口完成登录'
            const revision = this.revision
            try {
                const res = await qqWebLogin(mode)
                if (revision !== this.revision) return { success: false, message: '登录已取消' }
                if (!res?.success || !res.cookie) return { success: false, message: res?.message || '未取得登录凭据' }
                return await this.acceptSession(res.cookie, res.uin)
            } catch (e) { return { success: false, message: e.message || '登录异常' } }
            finally { this.logining = false }
        },
        async cookieLogin(rawCookie) {
            if (!rawCookie?.trim() || this.logining) return { success: false, message: '请填写 Cookie，或等待当前登录完成' }
            this.logining = true
            try { return await this.acceptSession(rawCookie.trim()) }
            catch (e) { return { success: false, message: e.message || '验证失败' } }
            finally { this.logining = false }
        },
        async fetchRealProfile() {
            return this.fetchVipInfo()
        },
        async fetchVipInfo() {
            if (!this.isLoggedIn || !this.uin || !this.cookie) return false
            const revision = this.revision
            const request = ++this.vipRequest
            const active = () => revision === this.revision && request === this.vipRequest && this.isLoggedIn
            this.vipLoading = true; this.vipError = ''
            try {
                const res = await qqValidateSession(this.cookie, this.uin)
                if (!active()) return false
                if (res?.code !== 0 || String(res.data?.userId) !== String(this.uin) || typeof res.data?.isVip !== 'boolean') throw new Error(res?.message || '会员身份验证失败，请重试')
                this.profile = { ...this.profile, ...res.data }; setQQProfile(this.profile)
                this.accountError = ''
                this.vipCheckedAt = Date.now(); this.sessionCheckedAt = Date.now()
                return true
            } catch(e) { if (active()) { this.vipError = e.message || '会员查询失败，请重试'; this.accountError = this.vipError }; return false }
            finally { if (active()) this.vipLoading = false }
        },
        async fetchUserPlaylists() {
            if (!this.uin || !this.cookie) return
            const revision = this.revision, uin = this.uin
            const request = this.playlistsRequest = (this.playlistsRequest || 0) + 1
            const active = () => revision === this.revision && request === this.playlistsRequest
            this.playlistsLoading = true; this.playlistsError = ''
            try {
                const loadGroup = async kind => {
                    const all = []; let offset = 0
                    for (let page=0;page<100;page++) {
                        if(!active())return []
                        const res=await qqPlaylistGroup(uin,kind,offset,100)
                        if(!active())return []
                        if(res?.code!==0)throw Error(res?.message || 'QQ 歌单加载失败')
                        const list=res.data?.playlists
                        if(!Array.isArray(list))throw Error('QQ 歌单响应不完整')
                        all.push(...list);offset+=list.length
                        if(!res.data.hasMore)return all
                        if(!list.length || page===99)throw Error('QQ 歌单分页未完成')
                    }
                }
                const groups=await Promise.allSettled([loadGroup('created'),loadGroup('collected')])
                if(!active())return
                const normalize=p=>({id:String(p.dissid||p.tid||p.id||''),name:p.diss_name||p.title||p.name||'',coverImgUrl:p.picurl||p.logo||'',songCount:p.song_count??p.songnum??0,type:Number(p.type||0),creator:p.creator?.name||p.nickname||'',kind:p.kind})
                if(groups[0].status==='fulfilled'){this.playlists=groups[0].value.map(normalize).filter(p=>p.id);this.likedPlaylistId=this.playlists.find(p=>p.type===1)?.id || this.likedPlaylistId}
                if(groups[1].status==='fulfilled')this.collectedPlaylists=groups[1].value.map(normalize).filter(p=>p.id)
                this.playlistsError=groups.map((r,i)=>r.status==='rejected'?`${i?'收藏':'自建'}歌单：${r.reason?.message||'加载失败'}`:'').filter(Boolean).join('；')
            } catch (e) { if (active()) this.playlistsError = e.message }
            finally { if(active())this.playlistsLoading=false }
        },
        async fetchLikedSongs() {
            if (!this.isLoggedIn || !this.uin) return { songs: [] }
            const revision = this.revision, all = []
            let offset = 0, info = {}, incomplete = false
            for (let page = 0; page < 100; page++) {
                const res = await qqUserLikedSongs(this.uin, this.cookie, offset, 200)
                if (revision !== this.revision) return { songs: [] }
                if (res?.code !== 0) throw new Error(res?.message || '我喜欢的音乐加载失败')
                const list = res.data?.songs || []
                info = res.data?.info || info; incomplete ||= !!res.data?.incomplete
                all.push(...list); offset += list.length
                if (!res.data?.hasMore) break
                if (!list.length || page === 99) throw new Error('收藏歌曲分页未完成，请重试')
            }
            this.likedSongs = all.map(toQQTrack).filter(Boolean)
            this.likedPlaylistId = String(info.id || this.likedPlaylistId || '')
            this.likedLoaded = true; this.likedIncomplete = incomplete
            return { songs: this.likedSongs, info, incomplete }
        },
        isSongLiked(song) {
            const id = String(song?.songmid || song?.id || '')
            return this.likedSongs.some(s => String(s.songmid || s.id) === id)
        },
        syncPlayerLikes() {
            const revision = this.revision
            import('./player').then(({ usePlayerStore }) => {
                if (revision !== this.revision) return
                const player = usePlayerStore()
                if (player.currentSong?.platform === 'qq') player.isLiked = this.isLoggedIn && this.isSongLiked(player.currentSong)
            }).catch(() => {})
        },
        async toggleLikeSong(song) {
            if (!this.isLoggedIn) return { success: false, message: '请先登录 QQ 音乐' }
            if (this.likeBusy) return { success: false, message: '正在同步收藏，请稍候' }
            this.likeBusy = true
            const revision = this.revision
            try {
                if (!this.likedLoaded) await this.fetchLikedSongs()
                if (revision !== this.revision) return { success: false, message: '账号已切换' }
                const mid = song.songmid || song.id
                const songid = song.songid || (await qqSongDetail(mid)).data?.track_info?.id
                if (revision !== this.revision) return { success: false, message: '账号已切换' }
                if (!this.likedPlaylistId || !songid) throw new Error('无法取得收藏歌单或歌曲 ID，请刷新账号后重试')
                const liked = !this.isSongLiked(song)
                const res = await qqOperMyLike(liked ? 1 : 2, mid, this.cookie, this.likedPlaylistId, songid)
                if (revision !== this.revision) return { success: false, message: '账号已切换' }
                if (res?.code !== 0) throw new Error(res?.message || 'QQ 音乐未接受收藏操作，请重新登录或稍后重试')
                if (liked) this.likedSongs.push(toQQTrack({ ...song, songid }))
                else this.likedSongs = this.likedSongs.filter(s => String(s.songmid || s.id) !== String(mid))
                return { success: true, liked }
            } catch (e) { return { success: false, message: e.message } }
            finally { this.likeBusy = false }
        },
        async createPlaylist(name) {
            if (!this.isLoggedIn || !name?.trim()) return false
            const revision = this.revision
            const result = await qqOperSonglist('add', { name: name.trim() }, this.cookie)
            if (revision !== this.revision || result?.code !== 0) throw new Error(result?.message || 'QQ 音乐未接受新建歌单操作')
            await this.fetchUserPlaylists()
            return revision === this.revision
        },
        async deletePlaylist(id) {
            if (!this.isLoggedIn || !this.createdPlaylists.some(item => String(item.id) === String(id))) return false
            const revision = this.revision
            const result = await qqOperSonglist('del', { dissid: id }, this.cookie)
            if (revision !== this.revision || result?.code !== 0) throw new Error(result?.message || 'QQ 音乐未接受删除歌单操作')
            await this.fetchUserPlaylists()
            return revision === this.revision
        },
        async addSongToPlaylist(id, song) {
            if (!this.isLoggedIn) return { success: false, message: '请先登录 QQ 音乐' }
            const revision = this.revision
            try {
                const res = await qqOperSonglist('addsong', { dissid: id, songmid: [song.songmid || song.id] }, this.cookie)
                if (revision !== this.revision) return { success: false, message: '账号已切换' }
                if (res?.code !== 0) return { success: false, message: res?.message || 'QQ 音乐歌单添加失败' }
                await this.fetchUserPlaylists()
                return { success: true }
            } catch (e) { return { success: false, message: e.message } }
        },
        logout() {
            this.vipRequest++; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = 0
            this.revision++; this.isLoggedIn = false; this.profile = null; this.cookie = ''; this.uin = ''
            this.playlists = []; this.collectedPlaylists = []; this.playlistsError = ''; this.playlistsLoading=false; this.likedPlaylistId = ''; this.likedSongs = []; this.likedLoaded = false
            this.likedIncomplete = false; this.loginMessage = ''; this.accountError = ''
            this.syncPlayerLikes()
            clearQQCookie(); clearQQProfile(); localStorage.removeItem('qq_liked_songs')
            const revision = this.revision
            Promise.resolve(qqLogout()).then(result => {
                if (result?.code !== 0 && revision === this.revision) this.accountError = result?.message || 'QQ 登录清理失败，请重试退出'
            }).catch(() => { if (revision === this.revision) this.accountError = 'QQ 登录清理失败，请重试退出' })
        }
    }
})
