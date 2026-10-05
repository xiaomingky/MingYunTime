<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayerStore } from '../store/player'

const props = defineProps({ active: Boolean })

const player = usePlayerStore()
const canvas = ref(null)
let frame = null
let resizeObserver = null
let lastDraw = 0
let width = 1
let height = 1
const palette = { accent: '#ff7085', soft: '#ffffffb8' }

function resizeCanvas() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  width = rect.width
  height = rect.height
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.max(1, Math.round(rect.width * dpr))
  el.height = Math.max(1, Math.round(rect.height * dpr))
  const context = el.getContext('2d')
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function clear(context, width, height) {
  context.clearRect(0, 0, width, height)
}

function drawBars(context, data, width, height) {
  const count = Math.min(32, Math.max(12, Math.floor(width / 10)))
  const gap = Math.max(2, width / (count * 7))
  const barWidth = Math.max(2, (width - gap * (count - 1)) / count)
  const base = height - 2
  for (let i = 0; i < count; i += 1) {
    const sample = data[Math.floor((i / count) * data.length * 0.72)] || 0
    const barHeight = Math.max(3, (sample / 255) * height * 0.85)
    const x = i * (barWidth + gap)
    const gradient = context.createLinearGradient(0, base - barHeight, 0, base)
    gradient.addColorStop(0, palette.accent)
    gradient.addColorStop(1, palette.soft)
    context.fillStyle = gradient
    context.beginPath()
    context.fillRect(x, base - barHeight, barWidth, barHeight)
  }
}

function draw(time) {
  frame = null
  if (!props.active) return
  frame = requestAnimationFrame(draw)
  if (time - lastDraw + .5 < 1000 / 30) return
  lastDraw = time
  const el = canvas.value
  if (!el) return
  const context = el.getContext('2d')
  clear(context, width, height)
  const data = player.updateFrequencyData()
  if (!data) return
  drawBars(context, data, width, height)
}

function restart() {
  if (!props.active) {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  } else if (frame === null) { lastDraw = 0; frame = requestAnimationFrame(draw) }
}

onMounted(() => {
  resizeCanvas()
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (canvas.value) resizeObserver.observe(canvas.value)
  restart()
})
watch(() => props.active, restart)
onUnmounted(() => {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  resizeObserver?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="apple-audio-visualizer" aria-hidden="true"></canvas>
</template>

<style scoped>
.apple-audio-visualizer { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
