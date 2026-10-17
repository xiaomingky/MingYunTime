<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowUpRight, Headphones, Disc3, ListMusic, Mic2, Heart, RefreshCw, ChevronRight } from 'lucide-vue-next'
import { useMessageStore } from '../../store/message'
import {
    qqNewDisks, qqPlaylistList,
    qqDigitalAlbums, qqTicketInfo, qqTopLists,
    normalizeQQAlbum, normalizeQQPlaylist
} from '../../api/qq'

const router = useRouter()
const messageStore = useMessageStore()

const loading = ref(false)
const newDisks = ref([])
const recommendPlaylists = ref([])
const topLists = ref([])
const digitalAlbums = ref([])
const ticketInfo = ref(null)
const errors = ref([])
const feature = computed(() => recommendPlaylists.value[0])
const creatorName = creator => typeof creator === 'string' ? creator : creator?.name || creator?.nickname || 'QQ 音乐精选'
const formatCount = value => value >= 100000000 ? `${(value / 100000000).toFixed(1)} 亿` : value >= 10000 ? `${(value / 10000).toFixed(1)} 万` : String(value)
let revision = 0

// 封面加载失败时隐藏 img,显示占位背景
const onImgError = (e) => {
    e.target.style.display = 'none'
    e.target.parentElement.classList.add('img-fallback')
}

const fetchAll = async () => {
    if (loading.value) return
    const requestId = ++revision
    loading.value = true
    errors.value = []
    try {
        const [disksRes, hotRes, digitalRes, ticketRes, topRes] = await Promise.allSettled([
            qqNewDisks(10, 1),
            qqPlaylistList({ categoryId: 10000000, limit: 10, page: 1 }),
            qqDigitalAlbums(10, 1),
            qqTicketInfo(),
            qqTopLists()
        ])
        if (requestId !== revision) return
        errors.value = [disksRes, hotRes, digitalRes, ticketRes, topRes].map((result, index) =>
            result.status === 'rejected' || result.value?.code !== 0 ? ['新碟', '推荐歌单', '数字专辑', '演出票务', '排行榜'][index] + '加载失败' : '').filter(Boolean)

        // 新碟上架
        if (disksRes.status === 'fulfilled' && disksRes.value?.code === 0) {
            const r = disksRes.value
            const albums = r?.new_album?.data?.albums || r?.data?.albums || r?.data?.newDisks || []
            newDisks.value = albums.slice(0, 10).map(normalizeQQAlbum).filter(a => a.id)
        }
        // 推荐歌单
        if (hotRes.status === 'fulfilled' && hotRes.value?.code === 0) {
            const r = hotRes.value
            const list = r?.data?.list || r?.list || []
            recommendPlaylists.value = list.slice(0, 10).map(normalizeQQPlaylist).filter(p => p.id)
        }
        // 排行榜
        if (topRes.status === 'fulfilled' && topRes.value?.code === 0) {
            const r = topRes.value
            const list = r?.data?.topList || r?.data?.list || r?.data || []
            topLists.value = (Array.isArray(list) ? list : []).slice(0, 10).map(t => ({
                id: t.topId || t.id || t.topid || '',
                name: t.topName || t.title || t.name || '',
                picUrl: t.frontPicUrl || t.picUrl || t.pic || '',
                description: t.description || t.intro || ''
            })).filter(t => t.id)
        }
        // 数字专辑
        if (digitalRes.status === 'fulfilled' && digitalRes.value?.code === 0) {
            const r = digitalRes.value
            const list = r?.data?.albumList || r?.data?.list || r?.data?.digitalAlbums || []
            digitalAlbums.value = list.slice(0, 10).map(a => {
                const mid = a.albumMID || a.albummid || a.mid || a.id
                return {
                    id: mid,
                    name: a.albumName || a.albumname || a.name || '',
                    picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : (a.picurl || a.imgurl || ''),
                    artist: a.singerName || a.singername || '',
                    price: a.price || a.albumPrice || ''
                }
            }).filter(a => a.id)
        }
        // 演出票务
        if (ticketRes.status === 'fulfilled' && ticketRes.value?.code === 0) {
            const r = ticketRes.value
            const t = r?.data?.ticketInfo || r?.data || r
            if (t && (t.title || t.name || (t.list && t.list.length))) {
                ticketInfo.value = {
                    title: t.title || t.name || '演出票务',
                    list: (t.list || t.shows || t.tickets || []).slice(0, 6).map(s => ({
                        id: s.id || s.showId,
                        name: s.name || s.title || s.showName,
                        time: s.showTime || s.time || s.date || '',
                        place: s.place || s.venue || s.city || ''
                    }))
                }
            }
        }
    } catch (e) {
        console.error('[QQ Discovery] fetch error:', e)
        messageStore.error('QQ 音乐数据加载失败')
    } finally {
        if (requestId === revision) loading.value = false
    }
}

const goToAlbum = (albummid) => albummid && router.push(`/qq/album/${albummid}`)
const goToPlaylist = (disstid) => disstid && router.push(`/qq/playlist/${disstid}`)

onMounted(fetchAll)
onBeforeUnmount(() => revision++)
</script>

<template>
  <div class="qq-page qq-discovery" :aria-busy="loading">
    <header class="qq-discovery-heading"><div><p class="eyebrow">QQ MUSIC / 音乐馆</p><h1>听见，新鲜感<span>。</span></h1></div><button class="qq-reload" :disabled="loading" @click="fetchAll"><RefreshCw :size="16" :class="{spinning:loading}" />{{ loading ? '更新中' : '刷新推荐' }}</button></header>
    <nav class="qq-quick-nav" aria-label="探索 QQ 音乐"><button @click="router.push('/qq/categories')"><ListMusic :size="17" />分类歌单<ArrowUpRight :size="14" /></button><button @click="router.push('/qq/singers')"><Mic2 :size="17" />歌手广场<ArrowUpRight :size="14" /></button><button @click="router.push('/qq/liked')"><Heart :size="17" />我的喜欢<ArrowUpRight :size="14" /></button></nav>
    <div v-if="errors.length" class="qq-section-error" role="alert">{{ errors.join('；') }}<button :disabled="loading" @click="fetchAll">重新加载</button></div>
    <div v-if="loading && !feature" class="qq-home-skeleton" role="status">正在寻找好音乐…<div></div><div></div></div>
    <section v-if="feature" class="qq-hero" aria-label="主推荐歌单">
      <img v-if="feature.coverImgUrl" class="qq-hero-atmosphere" :src="feature.coverImgUrl" alt="" @error="$event.target.style.display='none'" />
      <div class="qq-hero-copy"><span class="qq-hero-tag"><Headphones :size="14" />此刻，听点好的</span><h2>{{ feature.name }}</h2><p>{{ creatorName(feature.creator) }}<span v-if="feature.playCount"> · {{ formatCount(feature.playCount) }} 次播放</span></p><button class="qq-hero-open" @click="goToPlaylist(feature.id)">探索这张歌单<ArrowUpRight :size="18" /></button><span class="qq-hero-index">FEATURED / 01</span></div>
      <button class="qq-hero-art" :aria-label="'打开歌单：'+feature.name" @click="goToPlaylist(feature.id)"><span class="qq-record"></span><span class="qq-hero-cover"><img v-if="feature.coverImgUrl" :src="feature.coverImgUrl" alt="" @error="onImgError" /><Disc3 v-else :size="64" /></span></button>
    </section>
    <section v-if="recommendPlaylists.length > 1" class="qq-section"><header class="qq-section-heading"><div><span class="eyebrow">MADE FOR YOUR MOMENTS</span><h2>把喜欢，听成日常</h2></div><button @click="router.push('/qq/categories')">全部歌单<ChevronRight :size="15" /></button></header><div class="qq-playlist-shelf"><button v-for="p in recommendPlaylists.slice(1)" :key="p.id" class="qq-card" @click="goToPlaylist(p.id)"><span class="qq-card-img-wrap"><img v-if="p.coverImgUrl" :src="p.coverImgUrl" alt="" loading="lazy" @error="onImgError" /><span v-if="p.playCount" class="qq-cover-count"><Headphones :size="12" />{{ formatCount(p.playCount) }}</span><ArrowUpRight class="qq-cover-arrow" :size="20" /></span><span class="qq-card-name">{{ p.name }}</span><span class="qq-card-meta">{{ creatorName(p.creator) }}</span></button></div></section>
    <section v-if="topLists.length" class="qq-section qq-chart-section"><header class="qq-section-heading"><div><span class="eyebrow">ON THE CHARTS</span><h2>听见流行的方向</h2></div><span class="qq-section-caption">排行榜 · 热门趋势</span></header><div class="qq-chart-grid"><button v-for="(t,i) in topLists" :key="t.id" class="qq-chart-card" @click="router.push('/qq/rank/'+t.id)"><span class="qq-chart-number">{{ String(i+1).padStart(2,'0') }}</span><span class="qq-chart-image"><img v-if="t.picUrl" :src="t.picUrl" alt="" loading="lazy" @error="onImgError" /></span><span class="qq-chart-copy"><strong>{{ t.name }}</strong><span>{{ t.description || '打开榜单，发现热门好歌' }}</span></span><ArrowUpRight :size="17" /></button></div></section>
    <section v-if="newDisks.length" class="qq-section"><header class="qq-section-heading"><div><span class="eyebrow">FRESH ON REPEAT</span><h2>新碟，先听为快</h2></div><Disc3 :size="26" class="qq-section-disc" /></header><div class="qq-album-shelf"><button v-for="a in newDisks" :key="a.id" class="qq-card qq-album-card" @click="goToAlbum(a.id)"><span class="qq-card-img-wrap"><img v-if="a.picUrl" :src="a.picUrl" alt="" loading="lazy" @error="onImgError" /></span><span class="qq-card-name">{{ a.name }}</span><span class="qq-card-meta">{{ a.artist }}</span></button></div></section>
    <section v-if="digitalAlbums.length" class="qq-section qq-digital-section"><header class="qq-section-heading"><div><span class="eyebrow">THE COLLECTION</span><h2>数字专辑 · 珍藏每一首</h2></div></header><div class="qq-digital-grid"><button v-for="a in digitalAlbums" :key="a.id" class="qq-digital-card" @click="goToAlbum(a.id)"><span class="qq-digital-cover"><img v-if="a.picUrl" :src="a.picUrl" alt="" loading="lazy" @error="onImgError" /></span><span><strong>{{ a.name }}</strong><small>{{ a.artist }}<template v-if="a.price"> · ¥{{ a.price }}</template></small></span><ArrowUpRight :size="17" /></button></div></section>
    <section v-if="ticketInfo?.list?.length" class="qq-section"><header class="qq-section-heading"><div><span class="eyebrow">LIVE / 走进现场</span><h2>{{ ticketInfo.title }}</h2></div></header><div class="qq-ticket-list"><article v-for="t in ticketInfo.list" :key="t.id" class="qq-ticket-item"><strong>{{ t.name }}</strong><span>{{ [t.time,t.place].filter(Boolean).join(' · ') }}</span></article></div></section>
    <div v-if="!loading && !recommendPlaylists.length && !newDisks.length && !topLists.length && !digitalAlbums.length && !ticketInfo?.list?.length" class="qq-empty"><Disc3 :size="38" /><p>暂时没有加载到音乐</p><button @click="fetchAll">重新加载</button></div>
    <footer class="qq-home-footer">QQ MUSIC<span>让好音乐，成为生活的背景。</span></footer>
  </div>
</template>
<style scoped>
.qq-discovery{height:100%;overflow-y:auto;box-sizing:border-box;padding:28px 32px 40px;color:var(--text-main);container-type:inline-size}.qq-discovery button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;text-align:left}.qq-discovery button:focus-visible{outline:2px solid var(--primary-color);outline-offset:4px}.qq-discovery button:disabled{opacity:.5;cursor:wait}.eyebrow{font-size:10px;font-weight:650;letter-spacing:2px;color:var(--text-secondary);margin:0 0 10px;display:block}.qq-discovery-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.qq-discovery-heading h1{font-size:clamp(26px,3vw,39px);letter-spacing:-1.4px;margin:0;font-weight:750}.qq-discovery-heading h1 span{color:#15b983}.qq-discovery .qq-reload{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text-secondary)}.qq-quick-nav{display:flex;gap:10px;margin-bottom:26px;flex-wrap:wrap}.qq-quick-nav button{display:flex;gap:10px;align-items:center;font-size:12px;padding:11px 16px;border:1px solid var(--border-color);border-radius:99px;transition:background .2s}.qq-quick-nav button:hover{background:var(--hover-bg)}.qq-quick-nav svg:last-child{margin-left:14px;opacity:.5}.qq-hero{isolation:isolate;position:relative;overflow:hidden;border-radius:22px;display:grid;grid-template-columns:1.25fr 1fr;min-height:310px;margin-bottom:38px;background:#123d35;color:#f3fff9}.qq-hero-atmosphere{position:absolute;inset:-50%;width:200%;height:200%;object-fit:cover;filter:blur(70px);opacity:.15;z-index:-2;pointer-events:none}.qq-hero:after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,#092c2bd9,transparent);z-index:-1}.qq-hero-copy{padding:35px 0 28px 34px;display:flex;flex-direction:column;align-items:flex-start;z-index:1}.qq-hero-tag{font-size:11px;display:flex;gap:7px;align-items:center;letter-spacing:2px;color:#a5ead0}.qq-hero h2{font-size:clamp(23px,3.2vw,38px);line-height:1.35;letter-spacing:-.7px;max-width:560px;margin:21px 0 12px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.qq-hero-copy p{font-size:11px;color:#c3d9d3;margin:0 0 23px}.qq-discovery .qq-hero-open{display:flex;align-items:center;gap:20px;background:#c2fbe0;color:#123d35;border-radius:99px;padding:12px 20px;font-size:12px;font-weight:650}.qq-hero-index{font-size:9px;letter-spacing:2px;opacity:.4;margin-top:auto;padding-top:22px}.qq-discovery .qq-hero-art{position:relative;align-self:center;justify-self:center;width:69%;aspect-ratio:1;max-width:250px;transform:rotate(8deg);transition:transform .35s}.qq-discovery .qq-hero-art:hover{transform:rotate(2deg) scale(1.025)}.qq-hero-cover{position:absolute;inset:0;border-radius:9px;overflow:hidden;box-shadow:0 18px 35px #0005;background:#24634e;display:grid;place-items:center}.qq-hero-cover img{width:100%;height:100%;object-fit:cover}.qq-record{position:absolute;inset:4%;border-radius:50%;transform:translateX(29%);background:repeating-radial-gradient(#1a2320 0 2px,#101715 3px 4px);box-shadow:0 4px 18px #0004}.qq-record:after{content:'';position:absolute;inset:37%;border-radius:50%;background:#d1f0d2;border:10px solid #47765b}.qq-section{margin-bottom:36px}.qq-section-heading{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-bottom:19px}.qq-section-heading h2{margin:0;font-size:21px;letter-spacing:-.4px}.qq-section-heading .eyebrow{font-size:9px;margin-bottom:7px;letter-spacing:1.7px}.qq-section-heading>button{font-size:11px;display:flex;align-items:center;white-space:nowrap;color:var(--text-secondary)}.qq-section-caption{font-size:11px;color:var(--text-secondary)}.qq-playlist-shelf,.qq-album-shelf{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 72px)/5);gap:18px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:12px;scrollbar-width:thin}.qq-discovery .qq-card{min-width:0;display:flex;flex-direction:column;padding:0;scroll-snap-align:start}.qq-card-img-wrap{display:block;width:100%;aspect-ratio:1;position:relative;border-radius:12px;overflow:hidden;background:var(--hover-bg)}.qq-card-img-wrap:before,.qq-chart-image:before,.qq-digital-cover:before{content:'♪';position:absolute;inset:0;display:grid;place-items:center;font-size:28px;color:var(--text-secondary);opacity:.25}.qq-card-img-wrap img,.qq-chart-image img,.qq-digital-cover img{position:relative;width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}.qq-card:hover img{transform:scale(1.045)}.qq-card-name{font-size:13px;line-height:1.6;font-weight:600;margin-top:10px;width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.qq-card-meta{font-size:11px;color:var(--text-secondary);margin-top:4px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qq-cover-count{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:4px;font-size:10px;color:#fff;background:#0007;padding:4px 6px;border-radius:99px}.qq-cover-arrow{position:absolute;right:9px;bottom:9px;background:#c2fbe0;color:#123d35;border-radius:50%;padding:7px;opacity:0;transform:translateY(7px);transition:all .2s}.qq-card:hover .qq-cover-arrow,.qq-card:focus-visible .qq-cover-arrow{opacity:1;transform:translateY(0)}.qq-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px 22px}.qq-discovery .qq-chart-card{display:flex;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid var(--border-color);min-width:0}.qq-chart-card:hover .qq-chart-copy strong{color:var(--primary-color)}.qq-chart-number{font-size:20px;letter-spacing:-1px;font-variant-numeric:tabular-nums;width:27px;color:var(--text-secondary);opacity:.5}.qq-chart-image{position:relative;width:52px;height:52px;border-radius:9px;overflow:hidden;background:var(--hover-bg);flex-shrink:0}.qq-chart-copy{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}.qq-chart-copy strong{font-size:13px;font-weight:600}.qq-chart-copy>span{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary)}.qq-chart-card>svg{color:var(--text-secondary);flex-shrink:0}.qq-album-card .qq-card-img-wrap{border-radius:3px 10px 10px 3px;border-left:3px solid #8b8b8b55;box-sizing:border-box}.qq-section-disc{color:var(--text-secondary);opacity:.5}.qq-digital-section{padding:25px;border-radius:18px;background:var(--bg-sidebar);border:1px solid var(--border-color)}.qq-digital-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 24px}.qq-discovery .qq-digital-card{display:flex;align-items:center;gap:13px;padding:0;min-width:0}.qq-digital-cover{width:65px;height:65px;border-radius:6px;overflow:hidden;position:relative;flex-shrink:0;background:var(--hover-bg)}.qq-digital-card>span:nth-child(2){min-width:0;flex:1}.qq-digital-card strong,.qq-digital-card small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qq-digital-card strong{font-size:13px;font-weight:600}.qq-digital-card small{font-size:11px;color:var(--text-secondary);margin-top:7px}.qq-digital-card>svg{flex-shrink:0;color:var(--text-secondary)}.qq-ticket-list{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qq-ticket-item{padding:16px;border:1px solid var(--border-color);border-radius:12px;display:flex;flex-direction:column;gap:8px}.qq-ticket-item strong{font-size:13px}.qq-ticket-item span{font-size:11px;color:var(--text-secondary)}.qq-section-error{padding:13px;margin-bottom:18px;border:1px solid var(--border-color);border-radius:10px;font-size:12px;line-height:1.8;color:var(--text-secondary)}.qq-section-error button{color:var(--primary-color);margin-left:12px}.qq-empty{text-align:center;padding:60px;color:var(--text-secondary)}.qq-empty button{color:var(--primary-color);font-size:13px}.qq-home-footer{border-top:1px solid var(--border-color);padding-top:22px;display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:var(--text-secondary)}.qq-home-footer span{letter-spacing:1px;font-size:10px}.qq-home-skeleton{padding:15px 0;font-size:12px;color:var(--text-secondary)}.qq-home-skeleton div{height:100px;margin-top:15px;border-radius:16px;background:var(--hover-bg);animation:breathe 1.5s infinite}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@keyframes breathe{50%{opacity:.4}}@container(max-width:700px){.qq-hero{min-height:270px}.qq-hero-copy{padding:25px 0 22px 23px}.qq-hero h2{font-size:25px}.qq-playlist-shelf,.qq-album-shelf{grid-auto-columns:calc((100% - 36px)/3)}.qq-chart-grid{grid-template-columns:1fr 1fr;gap:0 12px}.qq-chart-number{display:none}.qq-digital-section{padding:18px}.qq-digital-cover{width:48px;height:48px}}@container(max-width:480px){.qq-discovery-heading h1{font-size:27px}.qq-hero{grid-template-columns:1fr .6fr}.qq-hero-copy{padding:23px 0 23px 20px}.qq-hero h2{font-size:22px}.qq-hero-art{width:75%}.qq-hero-copy p{line-height:1.7}.qq-chart-grid,.qq-digital-grid,.qq-ticket-list{grid-template-columns:1fr}.qq-home-footer span{display:none}.qq-section-heading h2{font-size:18px}.qq-section-caption{display:none}.qq-quick-nav button{padding:9px 12px}.qq-quick-nav svg:last-child{display:none}}@media(max-width:700px){.qq-discovery{padding:20px 18px}}@media(prefers-reduced-motion:reduce){.qq-discovery *{animation:none!important;transition:none!important}}
</style>
