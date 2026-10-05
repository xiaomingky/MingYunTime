<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Radio } from 'lucide-vue-next'
import EsportsImage from './EsportsImage.vue'
import { matchTime, score } from '../../utils/esports'

const props = defineProps({
    section: { type: Object, required: true },
    game: { type: String, default: 'csgo' }
})
const router = useRouter(), board = ref(null), paths = ref([]), size = ref({ width: 0, height: 0 })
const swiss = computed(() => props.section.type === 'swiss')
const columns = computed(() => props.section.columns || (props.section.rounds || []).map((round, index) => ({
    key: `round-${index}`, name: round.name,
    groups: [{ key: `round-${index}`, name: round.name, matches: round.matches, state: 'playing', teams: [] }]
})))
const height = computed(() => swiss.value ? undefined : `${Math.max(1, ...columns.value.map(column => column.groups[0].matches.length)) * 92 + 40}px`)
const matchKey = (match, group, index) => match.id ? `match-${match.id}` : `${group.key}-pending-${index}`
const pending = team => team.TBD || team.name === 'TBD'
const winner = (match, side) => match.status === 'past' && match.result === side
function time(match) {
    const value = matchTime(match.planTs, true)
    return value === '--' ? '对阵待定' : value.slice(5)
}
function open(match) {
    if (match.id) router.push(`/entertainment/${props.game}/match/${match.id}`)
}

let observer, frame = 0, disposed = false
function measure() {
    if (!board.value || disposed) return
    const root = board.value.getBoundingClientRect(), anchors = new Map()
    for (const element of board.value.querySelectorAll('[data-bracket-anchor]')) {
        const rect = element.getBoundingClientRect()
        anchors.set(element.dataset.bracketAnchor, { left: rect.left - root.left, right: rect.right - root.left, y: rect.top - root.top + rect.height / 2 })
    }
    const links = [...(props.section.links || [])]
    if (!swiss.value) {
        const aliases = new Map()
        for (const column of columns.value) for (const match of column.groups[0].matches) {
            if (match.id) aliases.set(match.id, `match-${match.id}`)
            if (match.graphId && match.id) aliases.set(String(match.graphId), `match-${match.id}`)
        }
        columns.value.forEach((column, index) => column.groups[0].matches.forEach((match, matchIndex) => {
            const feeds = [match.t1.fromMatchId, match.t2.fromMatchId].filter(id => aliases.has(String(id)))
            if (feeds.length) feeds.forEach(id => links.push({ from: aliases.get(String(id)), to: matchKey(match, column.groups[0], matchIndex) }))
            else if (index > 0) {
                const previous = columns.value[index - 1].groups[0]
                if (previous.matches.length === column.groups[0].matches.length * 2) {
                    for (const source of previous.matches.slice(matchIndex * 2, matchIndex * 2 + 2)) {
                        links.push({ from: matchKey(source, previous, previous.matches.indexOf(source)), to: matchKey(match, column.groups[0], matchIndex) })
                    }
                }
            }
        }))
    }
    paths.value = links.flatMap((link, index) => {
        const source = anchors.get(link.from), target = anchors.get(link.to)
        if (!source || !target || target.left <= source.right) return []
        const middle = (source.right + target.left) / 2
        return [{ key: index, state: link.state, d: `M ${source.right} ${source.y} H ${middle} V ${target.y} H ${target.left}` }]
    })
    size.value = { width: board.value.offsetWidth, height: board.value.offsetHeight }
}
function schedule() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
}
watch(() => props.section, async () => { await nextTick(); schedule() })
onMounted(() => {
    observer = new ResizeObserver(schedule)
    observer.observe(board.value)
    schedule()
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame) })
</script>

<template>
    <div class="es-bracket-shell" tabindex="0" :aria-label="`${section.name}对阵图，可横向滚动`">
        <div ref="board" class="es-bracket-board" :class="{ 'is-swiss': swiss }" :style="{ '--es-bracket-height': height }">
            <svg v-if="size.width" class="es-bracket-lines" :width="size.width" :height="size.height" aria-hidden="true"><path v-for="path in paths" :key="path.key" :d="path.d" :class="path.state" /></svg>
            <section v-for="column in columns" :key="column.key" class="es-bracket-column">
                <div v-if="swiss" class="es-bracket-column-label">{{ column.name }}</div>
                <div class="es-bracket-column-content">
                    <section v-for="group in column.groups" :key="group.key" class="es-bracket-group" :class="group.state" :data-bracket-anchor="swiss ? group.key : undefined">
                        <header><b>{{ group.name }}</b><span v-if="group.state==='advanced'">晋级</span><span v-else-if="group.state==='eliminated'">淘汰</span></header>
                        <div v-if="group.matches.length" class="es-bracket-group-matches">
                            <button v-for="(match, index) in group.matches" :key="matchKey(match, group, index)" class="es-bracket-match" :class="{ live: match.status==='live', past: match.status==='past', 'is-placeholder': !match.id }" :data-bracket-anchor="swiss ? undefined : matchKey(match, group, index)" :disabled="!match.id" :aria-label="`${match.t1.name} 对阵 ${match.t2.name}，${time(match)}`" @click="open(match)">
                                <span class="es-bracket-match-meta"><span v-if="match.status==='live'" class="live"><Radio :size="10" />LIVE</span><span v-else>{{ time(match) }}</span><small>{{ match.format ? `BO${match.format}` : '待定' }}</small></span>
                                <span class="es-bracket-versus">
                                    <span class="es-bracket-team" :class="{winner:winner(match,'t1'),pending:pending(match.t1)}"><EsportsImage :src="match.t1.logo" /><strong :title="match.t1.name">{{ match.t1.shortName }}</strong></span>
                                    <b class="es-bracket-score" :class="{ finished: match.status==='past' }"><template v-if="['live','past'].includes(match.status)"><i :class="{winner:winner(match,'t1')}">{{ score(match.t1Score) }}</i><span>−</span><i :class="{winner:winner(match,'t2')}">{{ score(match.t2Score) }}</i></template><span v-else>VS</span></b>
                                    <span class="es-bracket-team" :class="{winner:winner(match,'t2'),pending:pending(match.t2)}"><EsportsImage :src="match.t2.logo" /><strong :title="match.t2.name">{{ match.t2.shortName }}</strong></span>
                                </span>
                            </button>
                        </div>
                        <div v-else class="es-bracket-outcomes"><span v-for="(team, index) in group.teams" :key="`${team.id}-${index}`" class="es-bracket-team" :class="{pending:pending(team)}"><EsportsImage :src="team.logo" /><strong :title="team.name">{{ team.shortName }}</strong></span></div>
                    </section>
                </div>
            </section>
        </div>
    </div>
</template>
