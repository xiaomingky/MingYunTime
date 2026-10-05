<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Star, Trophy, MapPin, ChevronRight, Clock3 } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'
import { statusText, teamName, matchInfo, matchTime } from '../../utils/esports'
const props = defineProps({ event: { type: Object, required: true }, game: String, saved: Boolean })
defineEmits(['favorite'])
const router = useRouter()
const basic = computed(() => props.event.basic_info || props.event)
const eventId = computed(() => basic.value.id || props.event.tt_id)
const teams = computed(() => (props.event.teams || []).map(t => t.team || t))
const recent = computed(() => props.event.recent_match ? matchInfo(props.event.recent_match) : null)
const recentId = computed(() => recent.value?.id || recent.value?.match_id)
const recentTime = computed(() => recent.value?.plan_time?.slice(5,16) || matchTime(recent.value?.plan_ts || recent.value?.ts))
const date = value => String(value || '').slice(5, 10).replace('-', '/') || '待定'
</script>
<template>
    <article class="es-tournament-card" :class="{ 'is-past': basic.status === 'past' }">
        <span class="es-event-status" :class="basic.status">{{ statusText(basic.status) }}</span>
        <button class="es-card-favorite es-icon-btn" :aria-label="saved ? '取消收藏赛事' : '收藏赛事'" :aria-pressed="saved" @click="$emit('favorite', eventId)"><Star :size="19" :fill="saved ? 'currentColor' : 'none'" :class="{saved}" /></button>
        <button class="es-tournament-main" @click="router.push(`/entertainment/${game}/event/${eventId}`)">
            <EsportsImage :src="basic.logo || basic.cover" :alt="basic.disp_name || basic.name" />
            <span class="es-tournament-info"><span class="es-tournament-title"><strong>{{ basic.disp_name || basic.name || basic.tt_name }}</strong><span v-if="basic.special_grade_label || basic.grade_label" class="es-grade">{{ basic.special_grade_label || basic.grade_label }}</span></span>
                <span class="es-tournament-meta"><span><Clock3 :size="12" />{{ date(basic.start_time) }} — {{ date(basic.end_time) }}</span><span><MapPin :size="12" />{{ basic.city_name || '地点待定' }}</span><b>{{ basic.bonus || '奖金待定' }}</b></span>
                <span class="es-participants"><small>参赛队伍</small><EsportsImage v-for="team in teams.slice(0,6)" :key="team.id || team.name" :src="team.logo" :alt="teamName(team)" /><small v-if="teams.length>6">+{{ teams.length-6 }}</small><small v-if="!teams.length">阵容待公布</small></span>
            </span><ChevronRight class="es-row-arrow" :size="16" />
        </button>
        <button v-if="recent || event.win_team" class="es-tournament-footer" @click="router.push(recentId ? `/entertainment/${game}/match/${recentId}` : `/entertainment/${game}/event/${eventId}`)">
            <template v-if="event.win_team"><Trophy :size="15" /><span>冠军</span><EsportsImage :src="event.win_team.logo || event.win_team.team?.logo" /><b>{{ teamName(event.win_team.team || event.win_team) }}</b></template>
            <template v-else><span>最近比赛</span><span class="es-recent-teams"><EsportsImage :src="recent.t1_info?.logo || recent.home_info?.logo" />{{ teamName(recent.t1_info || recent.home_info) }}<i>VS</i><EsportsImage :src="recent.t2_info?.logo || recent.opponent_info?.logo" />{{ teamName(recent.t2_info || recent.opponent_info) }}</span><small>{{ recentTime }}</small></template>
        </button>
    </article>
</template>
