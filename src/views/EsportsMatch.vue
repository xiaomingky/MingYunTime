<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, RefreshCw, Radio, ExternalLink, Play, Pause, Swords, TrendingUp, BarChart3, Star, Crown, MessageSquare } from 'lucide-vue-next'
import { esports } from '../api/esports'
import { usePlayerStore } from '../store/player'
import { useEsportsRefresh } from '../composables/useEsportsRefresh'
import { matchTime, statusText, teamName, score, playbackSources, mergeLogs, itemsOf, matchScoreboard } from '../utils/esports'
import { vrsRank } from '../utils/esports-vrs'
import EsportsImage from '../components/esports/EsportsImage.vue'
import EsportsStats from '../components/esports/EsportsStats.vue'
import EsportsAnalysis from '../components/esports/EsportsAnalysis.vue'
import EsportsPrediction from '../components/esports/EsportsPrediction.vue'
import EsportsRatings from '../components/esports/EsportsRatings.vue'
import EsportsComments from '../components/esports/EsportsComments.vue'
import ArtVideoPlayer from '../components/ArtVideoPlayer.vue'
import CustomSelect from '../components/CustomSelect.vue'
import '../styles/esports.css'
import '../styles/esports-scoreboard.css'

const route = useRoute(), router = useRouter(), player = usePlayerStore()
const game = computed(() => route.params.game === 'val' ? 'val' : 'csgo')
const id = computed(() => String(route.params.matchId || ''))
const match = ref(null), analysis = ref(null), loading = ref(true), error = ref(''), updateError = ref('')
const tab = ref('analysis'), mapIndex = ref(-1), side = ref('all'), expanded = ref(false)
const analysisLoading = ref(false), analysisError = ref(''), savedMatches = ref([])
try { const stored=JSON.parse(localStorage.getItem('esports-favorite-matches') || '[]'); if(Array.isArray(stored))savedMatches.value=stored.filter(v=>typeof v==='string').slice(0,500) } catch {}
const saved = computed(()=>savedMatches.value.includes(id.value))
function toggleSaved(){savedMatches.value=saved.value?savedMatches.value.filter(v=>v!==id.value):[...savedMatches.value,id.value].slice(-500);try{localStorage.setItem('esports-favorite-matches',JSON.stringify(savedMatches.value))}catch{}}
const logs = ref([]), logError = ref(''), logLoading = ref(false), logOlder = ref(false), logMore = ref(true)
const logKind = ref('all'), updatedAt = ref(''), autoUpdate = ref(true)
const selectedSource = ref(''), playing = ref(false), playbackError = ref('')
let sequence = 0, disposed = false
const info = computed(() => match.value?.mc_info || {})
const state = computed(() => match.value?.global_state || {})
const bouts = computed(() => (match.value?.bouts_state || []).filter(b => String(b.display) !== '2' || b.map_name))
const currentBout = computed(() => mapIndex.value < 0 ? null : bouts.value[mapIndex.value])
const stats = computed(() => currentBout.value || state.value)
const sources = computed(() => playbackSources(info.value))
const source = computed(() => sources.value.find(s => s.url === selectedSource.value))
const sourceOptions = computed(() => sources.value.map(s => ({ value: s.url, label: `${s.kind === 'live' ? '直播' : '回放'} · ${s.name}` })))
const eventId = computed(() => match.value?.tt_info?.id || match.value?.tt_info?.tt_id)
const detailStatus = computed(() => String(state.value.status))
const scoreboard = computed(() => matchScoreboard(match.value))
const comments = ref([]), commentTotal = ref(0), commentError = ref(''), commentLoading = ref(false), commentMore = ref(false), commentPage = ref(0)
const scoreTeams = ref([]), scoreLoading = ref(false), scoreError = ref('')
let commentSequence = 0, scoreSequence = 0
const scoreUsers = computed(() => scoreTeams.value.reduce((total, team) => total + (team.players || []).reduce((sum, player) => sum + (Number(player.score?.user_cnt) || 0), 0), 0))
const mvpPlayer = computed(() => {
    let best = null
    for (const team of scoreTeams.value) {
        for (const player of team.players || []) {
            const value = Number(player.score?.avg_score)
            if (!Number.isFinite(value) || !player.name) continue
            if (!best || value > best.rating) best = { name: player.name, rating: value, team: team.name, logo: player.logo || '' }
        }
    }
    return best
})
const commentSource = computed(() => `https://event.5eplay.com/${game.value}/matches/${info.value.id || ''}`)
function openMap(bout) {
    const index = bouts.value.indexOf(bout)
    if (index < 0) return
    switchMap(index); tab.value = 'stats'
}
function mapImage(bout) {
    return [bout?.map_icon, bout?.map_logo, bout?.map_bgm, bout?.map_image]
        .find(value => /^https?:\/\//i.test(String(value || ''))) || ''
}
const veto = computed(() => Array.isArray(state.value.bp_map_item) ? state.value.bp_map_item : [])
const pickSide = bout => {
    const act = String(bout?.bp_act || '')
    return act.startsWith('t1') ? 't1' : act.startsWith('t2') ? 't2' : ''
}
const pickLabel = bout => {
    const side = pickSide(bout)
    return side ? `${teamName(info.value[`${side}_info`])} PICK` : ''
}
const bpTeamSide = item => {
    if (item?.team_side === 't1' || item?.team_side === 't2') return item.team_side
    const match = /^(t1|t2)_/.exec(String(item?.bp_type || ''))
    return match ? match[1] : ''
}
const bpAction = item => {
    const value = String(item?.bp_type || '')
    return value.includes('pick') ? 'pick' : value.includes('ban') ? 'ban' : value === 'left' ? 'left' : value
}
const bpTitle = item => bpAction(item) === 'pick' ? 'PICK' : bpAction(item) === 'ban' ? 'BAN' : '剩余'
const bpLabel = item => {
    if (bpAction(item) === 'left') return '剩余'
    const side = bpTeamSide(item)
    return `${side ? teamName(info.value[`${side}_info`]) : ''} ${bpTitle(item)}`.trim()
}
const halfText = bout => {
    const t1 = bout?.t1_stats, t2 = bout?.t2_stats
    if (!t1 || !t2) return ''
    let text = `上 ${score(t1.fh_score)}:${score(t2.fh_score)} · 下 ${score(t1.sh_score)}:${score(t2.sh_score)}`
    if (String(t1.ot_score ?? '').trim() || String(t2.ot_score ?? '').trim()) text += ` · 加时 ${score(t1.ot_score)}:${score(t2.ot_score)}`
    return text
}
const sideClass = role => {
    const value = String(role || '').toUpperCase()
    return value === 'CT' ? 'side-ct' : value === 'T' ? 'side-t' : value === 'ATK' ? 'side-atk' : value === 'DEF' ? 'side-def' : ''
}
const roleLabel = role => {
    const value = String(role || '').toUpperCase()
    if (game.value === 'val') return value === 'ATK' ? '进攻' : value === 'DEF' ? '防守' : value || '--'
    return value || '--'
}
const halfRows = computed(() => {
    const bout = currentBout.value
    if (!bout) return []
    const t1 = bout.t1_stats || {}, t2 = bout.t2_stats || {}
    const rows = [
        { key: 'fh', label: '上半场', t1: t1.fh_score, t2: t2.fh_score, t1Role: t1.fh_role, t2Role: t2.fh_role },
        { key: 'sh', label: '下半场', t1: t1.sh_score, t2: t2.sh_score, t1Role: t1.sh_role, t2Role: t2.sh_role }
    ]
    if (String(t1.ot_score ?? '').trim() || String(t2.ot_score ?? '').trim()) rows.push({ key: 'ot', label: '加时', t1: t1.ot_score, t2: t2.ot_score, t1Role: t1.ot_role, t2Role: t2.ot_role })
    return rows
})
const sideLabel = computed(() => side.value === 'ct' ? (game.value === 'val' ? '防守方数据' : 'CT 方数据') : side.value === 't' ? (game.value === 'val' ? '进攻方数据' : 'T 方数据') : '全场数据')
const filteredLogs = computed(() => logs.value.filter(r => (mapIndex.value < 0 || String(r.bout_num) === String(currentBout.value?.bout_num)) && (logKind.value === 'all' || (logKind.value === 'kill' ? r.type === '8' : ['1','2','6','9'].includes(r.type)))))
function teamStats(team) {
    const suffix = side.value === 'all' ? '' : `_${side.value}`
    const key = mapIndex.value < 0 ? `${team}_player_stats${suffix}` : `${team}_pr_stats${suffix}`
    return Array.isArray(stats.value[key]) ? stats.value[key] : []
}
async function loadLogs(older = false) {
    if (logLoading.value || logOlder.value || disposed) return
    const token = sequence, matchId = id.value, activeGame = game.value
    if (older) logOlder.value = true; else logLoading.value = true
    try {
        const version = logs.value.length ? (older ? logs.value[logs.value.length - 1].version : logs.value[0].version) : ''
        const response = await esports('logs', { game: activeGame, id: matchId, limit: 80, version, older })
        if (token !== sequence || disposed) return
        const incoming = itemsOf(response)
        logs.value = mergeLogs(logs.value, incoming)
        if (older) logMore.value = incoming.length > 0 && response?.not_more !== '1'
        logError.value = ''
    } catch (e) { if (token === sequence && !disposed) logError.value = e.message }
    finally { if (token === sequence) { logLoading.value = false; logOlder.value = false } }
}
async function loadComments(append = false) {
    if (commentLoading.value || !match.value) return
    const token = commentSequence, matchId = id.value
    if (!matchId) { commentError.value = '缺少当前比赛编号'; return }
    const page = append ? commentPage.value + 1 : 1
    commentLoading.value = true
    if (!append) { commentError.value = ''; comments.value = []; commentTotal.value = 0 }
    try {
        const data = await esports('comments', { game: game.value, matchId, page, limit: 20 })
        if (token !== commentSequence || disposed || matchId !== id.value) return
        comments.value = append ? [...comments.value, ...(data.list || [])] : (data.list || [])
        commentTotal.value = Number(data.total) || 0
        commentPage.value = page
        commentMore.value = !!data.has_more
        commentError.value = ''
    } catch (e) { if (token === commentSequence && !disposed && matchId === id.value) commentError.value = e.message }
    finally { if (token === commentSequence) commentLoading.value = false }
}
async function loadScores() {
    if (scoreLoading.value || !match.value) return
    const token = scoreSequence, matchId = id.value
    scoreLoading.value = true; scoreError.value = ''; scoreTeams.value = []
    try {
        const tabs = await esports('score-tabs', { game: game.value, matchId })
        if (token !== scoreSequence || disposed || matchId !== id.value) return
        const teams = (Array.isArray(tabs) ? tabs : []).filter(team => team.tab === 'match_player' && team.id)
        const lists = await Promise.all(teams.map(async team => {
            try { return { ...team, players: await esports('scores', { game: game.value, matchId, tab: team.tab, teamId: team.id }) || [] } }
            catch { return { ...team, players: [] } }
        }))
        if (token !== scoreSequence || disposed || matchId !== id.value) return
        scoreTeams.value = lists
    } catch (e) { if (token === scoreSequence && !disposed && matchId === id.value) scoreError.value = e.message }
    finally { if (token === scoreSequence) scoreLoading.value = false }
}
async function load() {
    const token = ++sequence
    loading.value = true; error.value = ''; match.value = null; analysis.value = null
    analysisLoading.value=false;analysisError.value='';tab.value='analysis'
    commentSequence++; comments.value = []; commentTotal.value = 0; commentError.value = ''; commentLoading.value = false; commentMore.value = false; commentPage.value = 0
    scoreSequence++; scoreTeams.value = []; scoreError.value = ''; scoreLoading.value = false
    logs.value = []; logError.value = ''; logLoading.value = false; logOlder.value = false; logMore.value = true
    selectedSource.value = ''; playing.value = false; mapIndex.value = -1; side.value = 'all'; playbackError.value = ''
    updateError.value = ''
    try {
        const response = await esports('detail', { game: game.value, id: id.value })
        if (token !== sequence || disposed) return
        if (!response?.match) throw new Error('该比赛暂未提供详情')
        match.value = response.match
        updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        const first = sources.value[0]
        if (first) selectedSource.value = first.url
        analysisLoading.value=true
        esports('analysis', { game: game.value, id: id.value }).then(data => { if (token === sequence && !disposed) analysis.value = data?.result || data }).catch(e => {if(token===sequence && !disposed)analysisError.value=e.message}).finally(()=>{if(token===sequence && !disposed)analysisLoading.value=false})
        await Promise.all([loadComments(), loadScores()])
        await loadLogs()
    } catch (e) { if (token === sequence && !disposed) error.value = e.message }
    finally { if (token === sequence && !disposed) loading.value = false }
}
async function refresh() {
    const token = sequence
    try {
        const response = await esports('detail', { game: game.value, id: id.value })
        if (token !== sequence || disposed) return
        if (response?.match) match.value = response.match
        updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false }); updateError.value = ''
    } catch (e) { if (token === sequence && !disposed) updateError.value = e.message }
    if (token === sequence && !disposed && (tab.value === 'logs' || detailStatus.value === '1')) await loadLogs()
}
function startPlayback() {
    if (!source.value) return
    if (player.isPlaying) player.togglePlay()
    playbackError.value = ''; playing.value = true
}
function openExternal() {
    const url = source.value?.external
    if (!url) return
    const bridge = window.__ELECTRON_BRIDGE__ || window.bridge
    if (bridge?.send) bridge.send('open-external', url)
    else window.open(url, '_blank', 'noopener,noreferrer')
}
function switchMap(index) { mapIndex.value = index; side.value = 'all' }
watch(selectedSource, () => { playing.value = false; playbackError.value = '' })
watch(() => [game.value, id.value], load, { immediate: true })
watch(tab, value => {
    if (value === 'logs' && !logs.value.length) loadLogs()
    if (value === 'comments' && !comments.value.length && !commentLoading.value) loadComments()
    if (value === 'ratings' && !scoreTeams.value.length && !scoreLoading.value) loadScores()
})
useEsportsRefresh(refresh, 5000, () => autoUpdate.value && !!match.value && (detailStatus.value === '1' || tab.value === 'logs'))
onBeforeUnmount(() => { disposed = true; sequence++; playing.value = false })
</script>
<template>
    <div class="es-page es-detail-page">
        <header class="es-topline"><button class="es-icon-btn" title="返回赛事中心" @click="router.push({ path:'/entertainment', query:{ game } })"><ChevronLeft :size="20" /></button><span>{{ game === 'val' ? 'VALORANT' : 'COUNTER-STRIKE' }} / 比赛详情</span><button class="es-icon-btn" title="刷新比赛" @click="refresh"><RefreshCw :size="17" /></button></header>
        <div v-if="loading" class="es-state"><RefreshCw class="es-spin" :size="24" />加载比赛详情</div>
        <div v-else-if="error" class="es-state"><p>{{ error }}</p><button class="es-button" @click="load">重试</button></div>
        <template v-else-if="match">
            <section class="es-match-banner">
                <button v-if="eventId" class="es-event-link" @click="router.push(`/entertainment/${game}/event/${eventId}`)"><EsportsImage :src="match.tt_info?.logo" />{{ match.tt_info?.disp_name || match.tt_info?.tt_name_show || match.tt_info?.name_zh || '赛事详情' }}</button>
                <p class="es-match-time">{{ matchTime(info.plan_ts, true) }} · BO{{ info.format || '?' }}</p>
                <div class="es-scoreboard"><div class="es-banner-team"><span class="es-team-ranking" v-if="game==='csgo'">VRS #{{ vrsRank(info.t1_info?.v_rank) }}<small>HLTV #{{ info.t1_info?.rank || '--' }}</small></span><EsportsImage :src="info.t1_info?.logo" /><h2>{{ teamName(info.t1_info) }}</h2><small v-if="game==='val' && info.t1_info?.rank">世界排名 #{{ info.t1_info.rank }}</small></div><div class="es-banner-center"><span class="es-status" :class="{ live: detailStatus === '1' }">{{ statusText(state.status) }}</span><span class="es-score-label">大局比分 · BO{{ info.format || '?' }}</span>
                    <strong v-if="detailStatus!=='0'" class="es-series-score">{{ scoreboard.series.t1 }} <span>:</span> {{ scoreboard.series.t2 }}</strong><strong v-else class="es-versus">VS</strong>
                    <div v-if="scoreboard.featured" class="es-current-map" :class="{ live: !!scoreboard.active }" aria-live="polite" aria-atomic="true">
                        <span class="es-score-label">{{ scoreboard.active ? '实时小局' : '最后一局' }} · {{ scoreboard.featured.name }}</span>
                        <strong class="es-round-score">{{ scoreboard.featured.t1 }}<span>:</span>{{ scoreboard.featured.t2 }}</strong>
                        <small v-if="scoreboard.active">{{ scoreboard.featured.stage }}<template v-if="scoreboard.featured.round !== '--'"> · 第 {{ scoreboard.featured.round }} 回合</template></small>
                    </div>
                    <small v-else class="es-map-waiting">{{ detailStatus === '0' ? '小局比分待开赛' : detailStatus === '1' ? '局间休息 / 等待小局数据' : '暂无小局比分' }}</small><span v-if="mvpPlayer" class="es-mvp-badge"><Crown :size="12" />{{ mvpPlayer.name }} · 用户评分 {{ mvpPlayer.rating.toFixed(1) }}</span><button class="es-follow-btn" :class="{saved}" :aria-pressed="saved" @click="toggleSaved"><Star :size="14" :fill="saved?'currentColor':'none'" />{{ saved?'已关注':'关注比赛' }}</button></div><div class="es-banner-team"><span class="es-team-ranking" v-if="game==='csgo'">VRS #{{ vrsRank(info.t2_info?.v_rank) }}<small>HLTV #{{ info.t2_info?.rank || '--' }}</small></span><EsportsImage :src="info.t2_info?.logo" /><h2>{{ teamName(info.t2_info) }}</h2><small v-if="game==='val' && info.t2_info?.rank">世界排名 #{{ info.t2_info.rank }}</small></div></div>
                <div v-if="scoreboard.maps.length" class="es-banner-maps" aria-label="各地图小局比分">
                    <button v-for="map in scoreboard.maps" :key="map.number" class="es-banner-map" :class="{ live: map === scoreboard.active, selected: currentBout === map.bout }" @click="openMap(map.bout)" :aria-label="`第 ${map.number} 局 ${map.name}，${map.t1} 比 ${map.t2}，查看比赛数据`">
                        <span class="es-banner-map-title">第 {{ map.number }} 局 · {{ map.name }}</span>
                        <span v-if="pickLabel(map.bout)" class="es-map-pick" :class="`is-${pickSide(map.bout)}`">{{ pickLabel(map.bout) }}</span>
                        <b>{{ map.t1 }}<span>:</span>{{ map.t2 }}</b>
                        <small>{{ map.status === '1' ? '进行中' : map.status === '2' ? '已结束' : '待开始' }}</small>
                        <small v-if="halfText(map.bout)" class="es-banner-map-halves">{{ halfText(map.bout) }}</small>
                    </button>
                </div>
                <section v-if="veto.length" class="es-veto-board" aria-label="地图 BP">
                    <header><h3>地图 BP</h3><span>PICK / BAN</span></header>
                    <ol class="es-veto-list">
                        <li v-for="(item, index) in veto" :key="`${index}-${item.map_name}`" class="es-veto-item" :class="`is-${bpAction(item)}`" :style="{ '--veto-bg': `url(${mapImage(item)})` }">
                            <span class="es-veto-order">{{ index + 1 }}</span>
                            <img class="es-veto-map" :src="mapImage(item)" alt="" loading="lazy" referrerpolicy="no-referrer" />
                            <div class="es-veto-name"><b>{{ item.map_name }}</b><small>{{ bpLabel(item) }}</small></div>
                            <img v-if="bpTeamSide(item) && bpAction(item) !== 'left'" class="es-veto-logo" :src="info[`${bpTeamSide(item)}_info`]?.logo" :alt="teamName(info[`${bpTeamSide(item)}_info`])" :title="teamName(info[`${bpTeamSide(item)}_info`])" loading="lazy" referrerpolicy="no-referrer" />
                        </li>
                    </ol>
                </section>
                <EsportsPrediction :info="info" :state="state" :game="game" compact />
                <p class="es-muted">{{ info.tt_stage_desc }}<template v-if="info.remark"> · {{ info.remark }}</template></p>
                <div class="es-match-shortcuts"><button v-if="eventId" @click="router.push(`/entertainment/${game}/event/${eventId}`)"><Swords :size="16" />赛程对阵</button><button @click="tab='video'"><Play :size="16" />{{ sources.some(s=>s.kind==='live')?'观看直播':'直播 / 回放' }}</button></div>
                <div class="es-update-status"><label><input v-model="autoUpdate" type="checkbox" />自动更新</label><span>更新于 {{ updatedAt }}</span><span v-if="updateError" class="es-warning">{{ updateError }}</span></div>
            </section>
            <nav class="es-tabs es-detail-tabs"><button :class="{active:tab==='analysis'}" @click="tab='analysis'"><Swords :size="15" />分析</button><button :class="{active:tab==='stats'}" @click="tab='stats'"><BarChart3 :size="15" />比赛数据</button><button :class="{active:tab==='ratings'}" @click="tab='ratings'"><Crown :size="15" />选手评分<span v-if="scoreUsers" class="es-badge">{{ scoreUsers }}</span></button><button :class="{active:tab==='prediction'}" @click="tab='prediction'"><TrendingUp :size="15" />{{ game==='csgo'?'VRS 预测':'赛前预测' }}</button><button :class="{active:tab==='comments'}" @click="tab='comments'"><MessageSquare :size="15" />评论区<span v-if="commentTotal" class="es-badge">{{ commentTotal }}</span></button><button :class="{active:tab==='logs'}" @click="tab='logs'"><Radio :size="15" />实时播报</button><button :class="{active:tab==='video'}" @click="tab='video'"><Play :size="15" />直播 / 回放<span v-if="sources.length" class="es-badge">{{ sources.length }}</span></button></nav>
            <div v-if="tab === 'stats' || tab === 'logs'" class="es-map-tabs"><button :class="{ active: mapIndex < 0 }" @click="switchMap(-1)"><span class="es-map-thumb is-all"><Swords :size="16" /></span><span>全场</span></button><button v-for="(bout,index) in bouts" :key="bout.bout_num" :class="{ active: mapIndex === index }" @click="switchMap(index)"><span class="es-map-thumb"><EsportsImage v-if="mapImage(bout)" :src="mapImage(bout)" :alt="bout.map_name" /><Swords v-else :size="16" /></span><span>{{ bout.map_name || `地图 ${bout.bout_num}` }}</span><small>{{ score(bout.t1_stats?.all_score) }} : {{ score(bout.t2_stats?.all_score) }}</small><em v-if="pickSide(bout)" class="es-map-tab-pick" :class="`is-${pickSide(bout)}`"><img :src="info[`${pickSide(bout)}_info`]?.logo" alt="" loading="lazy" referrerpolicy="no-referrer" />PICK</em></button></div>
            <section v-if="tab === 'stats'" class="es-detail-content">
                <section v-if="currentBout" class="es-map-summary" :class="{ 'is-live': currentBout.status === '1' }">
                    <div class="es-map-summary-hero">
                        <img v-if="mapImage(currentBout)" :src="mapImage(currentBout)" alt="" loading="lazy" referrerpolicy="no-referrer" />
                        <div class="es-map-summary-copy">
                            <span class="es-map-summary-kicker">第 {{ currentBout.bout_num }} 局 · {{ currentBout.map_name }}</span>
                            <strong>{{ score(currentBout.t1_stats?.all_score) }}<span>:</span>{{ score(currentBout.t2_stats?.all_score) }}</strong>
                            <small>{{ pickLabel(currentBout) || '地图比分' }} · {{ currentBout.status === '1' ? '进行中' : currentBout.status === '2' ? '已结束' : '待开始' }}</small>
                        </div>
                    </div>
                    <div class="es-half-board" aria-label="上下半场比分">
                        <div class="es-half-row is-head"><span>半场</span><b><EsportsImage :src="info.t1_info?.logo" />{{ teamName(info.t1_info) }}</b><i>CT / T</i><b>{{ teamName(info.t2_info) }}<EsportsImage :src="info.t2_info?.logo" /></b></div>
                        <div v-for="row in halfRows" :key="row.key" class="es-half-row">
                            <span>{{ row.label }}</span>
                            <b :class="sideClass(row.t1Role)">{{ score(row.t1) }}</b>
                            <i><em :class="sideClass(row.t1Role)">{{ roleLabel(row.t1Role) }}</em><span>:</span><em :class="sideClass(row.t2Role)">{{ roleLabel(row.t2Role) }}</em></i>
                            <b :class="sideClass(row.t2Role)">{{ score(row.t2) }}</b>
                        </div>
                    </div>
                </section>
                <div class="es-toolbar"><div class="es-segment" role="group" aria-label="CT / T 数据切换"><button :class="{active:side==='all'}" :aria-pressed="side==='all'" @click="side='all'">全部</button><button :class="{active:side==='ct'}" :aria-pressed="side==='ct'" @click="side='ct'">{{ game === 'val' ? '防守' : 'CT' }}</button><button :class="{active:side==='t'}" :aria-pressed="side==='t'" @click="side='t'">{{ game === 'val' ? '进攻' : 'T' }}</button></div><span class="es-side-label">{{ sideLabel }}</span><label><input v-model="expanded" type="checkbox" />全部指标</label></div>
                <div class="es-team-stats"><h3><EsportsImage :src="info.t1_info?.logo" />{{ teamName(info.t1_info) }}</h3><EsportsStats :rows="teamStats('t1')" :game="game" :expanded="expanded" /></div>
                <div class="es-team-stats"><h3><EsportsImage :src="info.t2_info?.logo" />{{ teamName(info.t2_info) }}</h3><EsportsStats :rows="teamStats('t2')" :game="game" :expanded="expanded" /></div>
                <section v-if="stats.pr_stats?.length" class="es-performance"><h3>关键表现</h3><div class="es-performance-grid"><div v-for="item in stats.pr_stats" :key="item.title" class="es-performance-item"><strong>{{ item.title }}</strong><div v-for="value in item.data || []" :key="value.title"><span>{{ value.title }}</span><b>{{ value.t1_data || '--' }} : {{ value.t2_data || '--' }}</b></div></div></div></section>
            </section>
            <section v-else-if="tab === 'logs'" class="es-detail-content"><div class="es-toolbar"><div class="es-segment"><button :class="{active:logKind==='all'}" @click="logKind='all'">全部事件</button><button :class="{active:logKind==='kill'}" @click="logKind='kill'">击杀</button><button :class="{active:logKind==='round'}" @click="logKind='round'">回合 / 下包</button></div><button class="es-icon-btn" title="更新播报" @click="loadLogs()"><RefreshCw :class="{'es-spin':logLoading}" :size="16" /></button></div><p v-if="logError" class="es-warning">{{ logError }}</p><div v-if="!filteredLogs.length" class="es-state"><Radio :size="24" />{{ logLoading ? '加载事件记录' : detailStatus === '0' ? '比赛暂未开始' : '该比赛暂未提供事件播报' }}</div><ol v-else class="es-log-list"><li v-for="row in filteredLogs" :key="row.key"><span class="es-log-type" :class="{'kill':row.type==='8'}">{{ row.type === '8' ? '击杀' : ['1','2'].includes(row.type) ? '回合' : '事件' }}</span><div><p>{{ row.text }}<img v-if="row.weaponLogo" :src="row.weaponLogo" alt="" referrerpolicy="no-referrer" /></p><small>{{ row.map_name || `地图 ${row.bout_num || '?'}` }} · {{ /^\d{13}$/.test(row.version) ? new Date(Number(row.version)).toLocaleTimeString('zh-CN',{hour12:false}) : row.version }}</small></div></li></ol><button v-if="logs.length && logMore" class="es-button es-load-more" :disabled="logOlder" @click="loadLogs(true)">{{ logOlder ? '加载中' : '加载更早事件' }}</button></section>
            <section v-else-if="tab === 'ratings'" class="es-detail-content es-ratings-content"><EsportsRatings :teams="scoreTeams" :loading="scoreLoading" :error="scoreError" /></section>
            <section v-else-if="tab === 'comments'" class="es-detail-content es-comments-content"><EsportsComments :items="comments" :total="commentTotal" :loading="commentLoading" :error="commentError" :has-more="commentMore" :source-url="commentSource" title="本场评论区" subtitle="汇总本场选手评分页下的 5EPlay 用户评论" count-unit="条评论" match-mode @more="loadComments(true)" /></section>
            <section v-else-if="tab === 'analysis'" class="es-detail-content"><EsportsAnalysis :result="analysis || {}" :info="info" :game="game" :loading="analysisLoading" :error="analysisError" /></section>
            <section v-else-if="tab === 'prediction'" class="es-detail-content"><EsportsPrediction :info="info" :state="state" :game="game" /></section>
            <section v-else-if="tab==='video'" class="es-detail-content"><div class="es-toolbar"><CustomSelect v-model="selectedSource" :options="sourceOptions" placeholder="选择直播来源" /><button v-if="source" class="es-button" @click="openExternal"><ExternalLink :size="15" />原站观看</button></div><div v-if="!source" class="es-state"><Radio :size="26" />暂无直播或回放</div><div v-else class="es-video"><template v-if="playing"><ArtVideoPlayer v-if="source.type!=='iframe'" :key="source.url" :src="source.url" :episode-title="source.name" :episodes="sources" :current-episode="source" @selectEpisode="selectedSource = $event.url" :play-type="source.type" :autoplay="true" @playing="player.isPlaying && player.togglePlay()" @error="playbackError='播放器暂时无法播放，请尝试其他来源或原站观看'" /><iframe v-else :key="source.url" :src="source.url" title="赛事直播播放器" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" /></template><button v-else class="es-video-start" @click="startPlayback"><Play :size="38" /><span>播放 {{ source.name }}</span></button></div><p v-if="playbackError" class="es-warning">{{ playbackError }}</p><div v-if="playing" class="es-toolbar"><span class="es-muted">{{ source.name }}</span><button class="es-button" @click="playing=false"><Pause :size="14" />停止播放</button></div></section>
        </template>
    </div>
</template>
