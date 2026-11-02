<script setup>
import { computed } from 'vue'
import { Crown, Star, MessageSquare } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'

const props = defineProps({
    teams: { type: Array, default: () => [] },
    loading: Boolean,
    error: { type: String, default: '' }
})

const number = value => {
    const text = String(value ?? '').replace('%', '').trim()
    return Number.isFinite(Number(text)) ? Number(text) : null
}
const players = team => (team?.players || []).map(player => ({
    ...player,
    score: number(player.score?.avg_score),
    users: Number(player.score?.user_cnt) || 0,
    percents: Array.isArray(player.score?.star_num_user_pct)
        ? player.score.star_num_user_pct.map(value => Math.min(100, Math.max(0, number(value) || 0)))
        : [],
    counts: Array.isArray(player.score?.star_num_user_cnt) ? player.score.star_num_user_cnt : []
}))
const rows = team => players(team)
const best = computed(() => {
    let top = 0
    for (const team of props.teams) for (const player of rows(team)) if (player.score != null && player.score > top) top = player.score
    return top
})
const average = team => {
    const values = rows(team).map(player => player.score).filter(value => value != null)
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}
const tone = value => value == null ? 'none' : value >= 8 ? 'great' : value >= 6.5 ? 'good' : value >= 5 ? 'ok' : 'low'
const fmt = (value, digits = 1) => value == null ? '--' : Number(value).toFixed(digits)
const trophy = player => player.is_mvp_player || (player.score != null && player.score === best.value)
</script>

<template>
    <section class="es-ratings">
        <header class="es-ratings-head">
            <div>
                <span class="es-kicker">COMMUNITY PLAYER SCORE</span>
                <h3><Star :size="17" />选手评分</h3>
                <p>赛后玩家对选手的真实评分 · 10 分制，来自 5EPlay 社区</p>
            </div>
            <span class="es-ratings-note"><Crown :size="14" />用户评分</span>
        </header>
        <div v-if="loading" class="es-ratings-state">正在读取 5EPlay 用户评分…</div>
        <div v-else-if="error" class="es-ratings-state is-error">{{ error }}</div>
        <div v-else-if="!teams.length" class="es-ratings-state">该场比赛暂未开放选手评分</div>
        <div v-else class="es-ratings-grid">
            <article v-for="team in teams" :key="team.id" class="es-rating-team">
                <header>
                    <EsportsImage :src="team.logo" :alt="team.name" />
                    <div><h4>{{ team.name }}</h4><small>{{ rows(team).length }} 人 · 平均 {{ fmt(average(team)) }} 分</small></div>
                    <b :class="tone(average(team))">{{ fmt(average(team)) }}</b>
                </header>
                <div class="es-score-cards">
                    <article v-for="player in rows(team)" :key="player.id" class="es-score-card" :class="{ 'is-best': trophy(player) }">
                        <div class="es-score-card-head">
                            <span class="es-score-portrait"><EsportsImage :src="player.logo" :alt="player.name" /><Crown v-if="trophy(player)" :size="13" class="es-score-crown" /></span>
                            <div class="es-score-identity"><b>{{ player.name }}</b><small>{{ player.is_coach_player ? '教练' : ((player.positions || []).join(' / ') || '选手') }}</small></div>
                            <span class="es-score-value" :class="tone(player.score)">{{ fmt(player.score) }}</span>
                        </div>
                        <div class="es-score-stats"><span>Rating <b>{{ player.rating || '--' }}</b></span><span>K/D <b>{{ player.kill || '--' }}/{{ player.death || '--' }}</b></span><span>KAST <b>{{ player.kast || '--' }}</b></span><span>ADR <b>{{ player.adr || '--' }}</b></span></div>
                        <div class="es-score-stars" :title="player.users + ' 人评分'">
                            <i v-for="(percent, index) in player.percents" :key="index" :style="{ width: percent + '%' }" :class="`star-${index + 1}`"></i>
                        </div>
                        <div class="es-score-foot"><MessageSquare :size="12" /><span>{{ player.users }} 人评分</span><small v-if="player.comment?.content" :title="player.comment.content">“{{ player.comment.content }}”</small><small v-else>还没有热门点评</small></div>
                    </article>
                </div>
            </article>
        </div>
        <p class="es-ratings-legend">评分来自 5EPlay 赛后玩家投票，金色皇冠代表本场最受欢迎选手。</p>
    </section>
</template>
