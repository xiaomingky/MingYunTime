import { defineStore } from 'pinia'
import { qishuiInvoke } from '../api/qishui'
import { usePlayerStore } from './player'
export const useQishuiUserStore = defineStore('qishui-user', {
    state: () => ({ sessionCheckedAt: 0, isLoggedIn: false, profile: null, playlists: [], error: '', loading: false, revision: 0, likedIds: [], likedLoaded: false, likeBusy: false, vipLoading: false, vipError: '', vipCheckedAt: 0, vipRequest: 0, vipClaimLoading: false, vipClaimResult: null, vipClaimError: '' }),
    actions: {
        async claimFreeVip() {
            if (!this.isLoggedIn || this.vipClaimLoading) return
            const revision = this.revision
            this.vipClaimLoading = true; this.vipClaimError = ''; this.vipClaimResult = null
            try {
                const result = await qishuiInvoke('vip-claim')
                if (revision !== this.revision) return
                this.vipClaimResult = result
                if (['received','already_received'].includes(result.status)) await this.fetchVipInfo()
            } catch(e) { if (revision === this.revision) this.vipClaimError = e.message || '领取失败，请重试' }
            finally { if (revision === this.revision) this.vipClaimLoading = false }
        },
        clearAccountLikes() {
            this.likedIds = []; this.likedLoaded = false
            const player = usePlayerStore()
            if (player.currentSong?.platform === 'qishui') { player.isLiked = false; player.currentSong.collected = false }
            for (const song of player.playlist) if (song.platform === 'qishui') song.collected = false
        },
        async refresh() {
            const revision = this.revision
            try {
                const data = await qishuiInvoke('login-status')
                if (revision !== this.revision) return
                const changedAccount = this.profile?.userId !== data.profile?.userId
                this.sessionCheckedAt = data.isLoggedIn ? Date.now() : 0; this.isLoggedIn = data.isLoggedIn; this.profile = data.profile; this.error = data.message || ''
                this.vipError = ''; this.vipCheckedAt = data.isLoggedIn ? Date.now() : 0
                if (changedAccount || !data.isLoggedIn) {
                    this.revision++; this.clearAccountLikes()
                    this.vipClaimLoading = false; this.vipClaimResult = null; this.vipClaimError = ''
                }
                if (data.isLoggedIn) await this.fetchPlaylists()
                else this.playlists = []
            } catch (e) { if (revision === this.revision) this.error = e.message }
        },
        async fetchVipInfo() {
            if (!this.isLoggedIn) return false
            const revision = this.revision, request = ++this.vipRequest
            const active = () => revision === this.revision && request === this.vipRequest && this.isLoggedIn
            this.vipLoading = true; this.vipError = ''
            try {
                const data = await qishuiInvoke('login-status')
                if (!active()) return false
                if (!data.isLoggedIn || data.profile?.userId !== this.profile?.userId || typeof data.profile?.isVip !== 'boolean') throw new Error(data.message || '汽水会员身份未确认，请重试')
                this.profile = data.profile; this.sessionCheckedAt = Date.now(); this.vipCheckedAt = Date.now()
                return true
            } catch(e) { if (active()) this.vipError = e.message || '会员查询失败，请重试'; return false }
            finally { if (active()) this.vipLoading = false }
        },
        async fetchPlaylists() {
            const revision = this.revision
            try {
                let cursor = ''; const seen = new Set(), playlists = []
                do {
                    const data = await qishuiInvoke('library', { cursor })
                    if (revision !== this.revision) return
                    playlists.push(...data.playlists)
                    if (!data.hasMore || !data.cursor || seen.has(data.cursor)) break
                    seen.add(data.cursor); cursor = data.cursor
                } while (true)
                if (revision === this.revision) { this.playlists = [...new Map(playlists.map(p => [p.id,p])).values()]; this.error = '' }
            }
            catch (e) { if (revision === this.revision) this.error = e.message }
        },
        acceptProfile(profile) { this.sessionCheckedAt = Date.now(); this.revision++; this.profile = profile; this.isLoggedIn = true; this.error = ''; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = Date.now(); this.vipClaimLoading = false; this.vipClaimResult = null; this.vipClaimError = ''; this.clearAccountLikes(); this.fetchPlaylists() },
        async fetchLiked() {
            if (!this.isLoggedIn) return
            const revision = this.revision, seen = new Set(), ids = []
            let cursor = ''
            do {
                const data = await qishuiInvoke('collections', { type: 'track', cursor })
                if (revision !== this.revision) return
                ids.push(...data.items.map(s => s.id))
                if (!data.hasMore || !data.cursor || seen.has(data.cursor)) break
                seen.add(data.cursor); cursor = data.cursor
            } while (true)
            if (revision === this.revision) { this.likedIds = [...new Set(ids)]; this.likedLoaded = true }
        },
        async toggleLike(song, currentLiked = false) {
            if (!this.isLoggedIn) throw new Error('请先登录汽水音乐')
            if (this.likeBusy) throw new Error('正在同步收藏，请稍候')
            const revision = this.revision, id = String(song.qishuiId || song.id), liked = !currentLiked
            this.likeBusy = true
            try {
                await qishuiInvoke('collect', { type: 'track', ids: [id], collected: liked })
                if (revision !== this.revision) throw new Error('账号已切换')
                this.likedIds = liked ? [...new Set([...this.likedIds, id])] : this.likedIds.filter(x => x !== id)
                return liked
            } finally { this.likeBusy = false }
        },
        async addToPlaylist(playlistId, songId) {
            const revision = this.revision
            await qishuiInvoke('playlist-tracks', { id: String(playlistId), ids: [String(songId)], action: 'append' })
            if (revision !== this.revision) throw new Error('账号已切换')
            await this.fetchPlaylists()
        },
        async cookieLogin(cookie) {
            const revision = this.revision
            const data = await qishuiInvoke('login-cookie', { cookie })
            if (revision !== this.revision) throw new Error('账号已切换，登录已取消')
            this.acceptProfile(data.profile)
        },
        async logout() {
            this.vipClaimLoading = false; this.vipClaimResult = null; this.vipClaimError = ''
            this.vipRequest++; this.vipLoading = false; this.vipError = ''; this.vipCheckedAt = 0
            this.revision++; this.isLoggedIn = false; this.profile = null; this.playlists = []; this.error = ''; this.clearAccountLikes()
            try { await qishuiInvoke('logout') } catch (e) { this.error = e.message }
        }
    }
})
