<script setup>
import { ref } from 'vue'
import { usePlayerStore } from '../store/player'
import { SlidersHorizontal } from 'lucide-vue-next'

const playerStore = usePlayerStore()

const presetLabels = {
    'default': '默认',
    'pop': '流行',
    'classical': '古典',
    'rock': '摇滚',
    'electronic': '电子',
    'vocal': '人声',
    'jazz': '爵士',
    'bass': '低音'
}

const presetColors = {
    'default': '#999',
    'pop': '#EC4141',
    'classical': '#C49B4A',
    'rock': '#E85D3A',
    'electronic': '#7C3AED',
    'vocal': '#EC4899',
    'jazz': '#3B82F6',
    'bass': '#F97316'
}

const bandLabels = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K']
const dbRange = [-12, -9, -6, -3, 0, 3, 6, 9, 12]

const showPanel = ref(false)

const togglePanel = () => {
    showPanel.value = !showPanel.value
    // 首次打开面板时自动启用 EQ；关闭面板不再关闭 EQ，避免“关了就没效果”
    if (showPanel.value && !playerStore.eqEnabled) {
        playerStore.toggleEq()
    }
}

const handlePresetClick = (key) => {
    playerStore.setEqPreset(key)
}

const handleBandChange = (index, value) => {
    playerStore.updateEqBand(index, parseFloat(value))
}

const getSliderPercent = (gain) => {
    return ((gain + 12) / 24) * 100
}

const getTrackColor = (gain) => {
    if (gain > 0) {
        const intensity = Math.min(1, gain / 12)
        return `rgba(236, 65, 65, ${0.4 + intensity * 0.6})`
    }
    const intensity = Math.min(1, Math.abs(gain) / 12)
    return `rgba(59, 130, 246, ${0.3 + intensity * 0.5})`
}

const isDragging = ref(false)
const hoveredBand = ref(-1)

const startDrag = (index, e) => {
    e.preventDefault()
    isDragging.value = true
    hoveredBand.value = index
    const container = document.querySelector('.eq-sliders-track')
    if (container) {
        const rect = container.getBoundingClientRect()
        const y = e.clientY - rect.top
        const percent = 1 - Math.max(0, Math.min(1, y / rect.height))
        const gain = Math.round((percent * 24 - 12) * 2) / 2
        playerStore.updateEqBand(index, Math.max(-12, Math.min(12, gain)))
    }
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', stopDrag)
}

const onDrag = (e) => {
    if (!isDragging.value) return
    e.preventDefault()
    const container = document.querySelector('.eq-sliders-track')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const y = e.clientY - rect.top
    const percent = 1 - Math.max(0, Math.min(1, y / rect.height))
    const gain = Math.round((percent * 24 - 12) * 2) / 2
    const index = hoveredBand.value
    if (index >= 0 && index < playerStore.eqBands.length) {
        playerStore.updateEqBand(index, Math.max(-12, Math.min(12, gain)))
    }
}

const stopDrag = () => {
    isDragging.value = false
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', stopDrag)
}

const onSliderHover = (index) => {
    hoveredBand.value = index
}

const onSliderLeave = () => {
    hoveredBand.value = -1
}
</script>

<template>
    <div class="eq-panel-container">
        <div
            class="eq-toggle-btn clickable"
            :class="{ active: playerStore.eqEnabled }"
            @click="togglePanel"
            title="均衡器"
        >
            <SlidersHorizontal :size="16" />
        </div>

        <Transition name="eq-fade">
            <div class="eq-panel" v-if="showPanel">
                <div class="eq-header">
                    <div class="eq-title-row">
                        <span class="eq-title">音频均衡器</span>
                        <span
                            class="eq-preset-dot"
                            :style="{ background: presetColors[playerStore.eqPreset] || '#999' }"
                        >
                        </span>
                        <span class="eq-preset-name">{{ presetLabels[playerStore.eqPreset] || '自定义' }}</span>
                        <div
                            class="eq-switch"
                            :class="{ active: playerStore.eqEnabled }"
                            @click="playerStore.toggleEq()"
                            title="启用/关闭均衡器"
                        >
                            <div class="eq-switch-thumb"></div>
                        </div>
                    </div>
                </div>

                <div class="eq-presets">
                    <button
                        v-for="(label, key) in presetLabels"
                        :key="key"
                        class="preset-btn"
                        :class="{ active: playerStore.eqPreset === key }"
                        :style="playerStore.eqPreset === key ? { background: presetColors[key], borderColor: presetColors[key] } : {}"
                        @click="handlePresetClick(key)"
                    >
                        {{ label }}
                    </button>
                </div>

                <div class="eq-body">
                    <div class="eq-db-scale">
                        <span v-for="db in dbRange" :key="db" class="db-mark">{{ db }}</span>
                    </div>

                    <div class="eq-sliders-track">
                        <div
                            v-for="(band, index) in playerStore.eqBands"
                            :key="band.freq"
                            class="eq-channel"
                            @mouseenter="onSliderHover(index)"
                            @mouseleave="onSliderLeave"
                        >
                            <div
                                class="eq-slider-wrapper"
                                @mousedown="startDrag(index, $event)"
                            >
                                <div class="eq-slider-bg">
                                    <div
                                        class="eq-slider-fill"
                                        :style="{
                                            height: getSliderPercent(band.gain) + '%',
                                            background: getTrackColor(band.gain)
                                        }"
                                    ></div>
                                    <div
                                        class="eq-slider-center"
                                        :style="{ bottom: '50%' }"
                                    ></div>
                                </div>
                                <div
                                    class="eq-slider-thumb"
                                    :style="{
                                        bottom: getSliderPercent(band.gain) + '%',
                                        borderColor: band.gain >= 0 ? 'var(--primary-color)' : '#3b82f6'
                                    }"
                                ></div>
                            </div>
                            <span class="eq-gain-value" :class="{ positive: band.gain > 0, negative: band.gain < 0 }">
                                {{ band.gain > 0 ? '+' + band.gain.toFixed(1) : band.gain.toFixed(1) }}
                            </span>
                            <span class="eq-freq-label">{{ bandLabels[index] }}</span>
                            <span class="eq-freq-unit" v-if="index >= 7">kHz</span>
                            <span class="eq-freq-unit" v-else-if="index >= 4">K</span>
                        </div>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.eq-panel-container {
    position: relative;
    display: flex;
    align-items: center;
}

.eq-toggle-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: #666;
    transition: all 0.2s;
}

.eq-toggle-btn:hover {
    color: var(--primary-color);
    background: rgba(236, 65, 65, 0.08);
}

.eq-toggle-btn.active {
    color: var(--primary-color);
    background: rgba(236, 65, 65, 0.12);
}

.eq-fade-enter-active,
.eq-fade-leave-active {
    transition: all 0.25s ease;
}

.eq-fade-enter-from,
.eq-fade-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(10px) scale(0.96);
}

.eq-panel {
    position: fixed;
    bottom: calc(var(--footer-height) + 12px);
    left: 50%;
    transform: translateX(-50%);
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
    padding: 20px 24px 16px;
    width: 480px;
    z-index: 10001;
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
}

.eq-panel::after {
    content: '';
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    border: 8px solid transparent;
    border-top-color: #fff;
}

.eq-header {
    margin-bottom: 14px;
}

.eq-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
}

.eq-switch {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: #e5e7eb;
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
    margin-left: auto;
    flex-shrink: 0;
}

.eq-switch.active {
    background: var(--primary-color);
}

.eq-switch-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

.eq-switch.active .eq-switch-thumb {
    transform: translateX(16px);
}

.eq-title {
    font-size: 15px;
    font-weight: 700;
    color: #1a1a2e;
    letter-spacing: 0.5px;
}

.eq-preset-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.eq-preset-name {
    font-size: 12px;
    color: #666;
    font-weight: 500;
}

.eq-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 18px;
    padding: 10px 14px;
    background: #f8f9fa;
    border-radius: 12px;
}

.preset-btn {
    font-size: 12px;
    padding: 5px 14px;
    border: 1.5px solid #e5e7eb;
    border-radius: 20px;
    background: #fff;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
}

.preset-btn:hover {
    border-color: #bbb;
    color: #333;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.preset-btn.active {
    color: #fff;
    font-weight: 600;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
}

.eq-body {
    display: flex;
    gap: 4px;
    position: relative;
}

.eq-db-scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 30px;
    padding-top: 2px;
    width: 24px;
    flex-shrink: 0;
}

.db-mark {
    font-size: 10px;
    color: #c0c0c0;
    font-weight: 400;
    line-height: 1;
    font-variant-numeric: tabular-nums;
}

.eq-sliders-track {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 2px;
    flex: 1;
    height: 160px;
    padding: 2px 0 30px;
    background: linear-gradient(
        180deg,
        rgba(248, 249, 250, 0.6) 0%,
        rgba(248, 249, 250, 0.6) 8.3%,
        transparent 8.3%,
        transparent 25%,
        rgba(248, 249, 250, 0.3) 25%,
        rgba(248, 249, 250, 0.3) 25.1%,
        transparent 25.1%,
        transparent 41.6%,
        rgba(248, 249, 250, 0.3) 41.6%,
        rgba(248, 249, 250, 0.3) 41.7%,
        transparent 41.7%,
        transparent 58.3%,
        rgba(248, 249, 250, 0.6) 58.3%,
        rgba(248, 249, 250, 0.6) 58.4%,
        transparent 58.4%,
        transparent 75%,
        rgba(248, 249, 250, 0.3) 75%,
        rgba(248, 249, 250, 0.3) 75.1%,
        transparent 75.1%,
        transparent 91.6%
    );
    border-radius: 8px;
    position: relative;
}

.eq-channel {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    height: 100%;
    justify-content: flex-end;
    position: relative;
}

.eq-slider-wrapper {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    cursor: pointer;
    position: relative;
    padding: 0 2px;
}

.eq-slider-bg {
    width: 30px;
    height: 100%;
    background: rgba(0, 0, 0, 0.04);
    border-radius: 15px;
    position: relative;
    overflow: hidden;
}

.eq-slider-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: 11px;
    transition: height 0.12s ease-out, background 0.2s;
    min-height: 2px;
}

.eq-slider-center {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.5px;
    background: rgba(0, 0, 0, 0.12);
}

.eq-slider-thumb {
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    border: 2.5px solid var(--primary-color);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(50%) translateX(-2px);
    transition: border-color 0.2s;
    pointer-events: none;
    z-index: 2;
}

.eq-channel:hover .eq-slider-thumb {
    box-shadow: 0 2px 10px rgba(236, 65, 65, 0.25);
}

.eq-gain-value {
    font-size: 10px;
    font-weight: 600;
    color: #aaa;
    margin-top: 6px;
    font-variant-numeric: tabular-nums;
    transition: color 0.2s;
}

.eq-gain-value.positive {
    color: #e44;
}

.eq-gain-value.negative {
    color: #3b82f6;
}

.eq-freq-label {
    font-size: 10px;
    color: #999;
    margin-top: 2px;
    font-weight: 500;
}

.eq-freq-unit {
    font-size: 8px;
    color: #bbb;
    line-height: 1;
}
</style>
