<script setup>
/**
 * 通用自定义下拉选择组件
 * - 用 div 渲染下拉浮层，完全可美化（替代原生 <select> 的系统样式下拉）
 * - v-model 双向绑定 value
 * - options: [{ value, label }] 或 [string]
 * - 支持 placeholder、disabled、紧凑模式、透明模式（贴合胶囊容器）
 * - 自动处理外部点击关闭、键盘 Esc 关闭
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

import { ChevronDown } from 'lucide-vue-next'

const props = defineProps({
    modelValue: {
        type: [String, Number],
        default: ''
    },
    options: {
        type: Array,
        default: () => []
    },
    placeholder: {
        type: String,
        default: '请选择'
    },
    disabled: {
        type: Boolean,
        default: false
    },
    compact: {
        type: Boolean,
        default: false
    },
    transparent: {
        type: Boolean,
        default: false
    },
    width: {
        type: [String, Number],
        default: ''
    }
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const rootRef = ref(null)
// 下拉浮层用 fixed 定位，脱离父容器 overflow 限制
const dropdownStyle = ref({})
const dropdownRef = ref(null)

// 打开时计算浮层位置（基于触发器在视口中的位置）
const updateDropdownPosition = () => {
    if (!rootRef.value) return
    const rect = rootRef.value.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    // 向下展开空间不足且上方空间更大时，向上展开
    const showAbove = spaceBelow < 240 && rect.top > spaceBelow
    dropdownStyle.value = {
        left: rect.left + 'px',
        minWidth: rect.width + 'px',
        [showAbove ? 'bottom' : 'top']: showAbove
            ? (window.innerHeight - rect.top + 4) + 'px'
            : (rect.bottom + 4) + 'px'
    }
}

// 归一化 options 为 { value, label } 数组
const normalizedOptions = computed(() => {
    return props.options.map(opt => {
        if (typeof opt === 'object' && opt !== null) {
            return { value: opt.value, label: opt.label ?? String(opt.value) }
        }
        return { value: opt, label: String(opt) }
    })
})

const currentLabel = computed(() => {
    const found = normalizedOptions.value.find(o => o.value === props.modelValue)
    return found ? found.label : props.placeholder
})

const toggleOpen = () => {
    if (props.disabled) return
    open.value = !open.value
    if (open.value) {
        // 下一帧计算位置（等待 DOM 渲染）
        nextTick(updateDropdownPosition)
    }
}

const selectOption = (opt) => {
    emit('update:modelValue', opt.value)
    emit('change', opt.value)
    open.value = false
}

const onDocClick = (e) => {
    if (!rootRef.value) return
    // 允许点击浮层自身（浮层用 fixed 渲染在 body 层，不在 rootRef 内）
    if (dropdownRef.value && dropdownRef.value.contains(e.target)) return
    if (!rootRef.value.contains(e.target)) {
        open.value = false
    }
}

const onKeydown = (e) => {
    if (e.key === 'Escape') open.value = false
}

// 滚动/缩放时更新浮层位置（仅打开时）
const onScrollOrResize = () => {
    if (open.value) updateDropdownPosition()
}

watch(open, (val) => {
    if (val) {
        window.addEventListener('scroll', onScrollOrResize, true)
        window.addEventListener('resize', onScrollOrResize)
    } else {
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
    }
})

onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
})
</script>

<template>
    <div
        class="custom-select"
        :class="{ compact, transparent, disabled, open }"
        ref="rootRef"
        :style="width ? { width: typeof width === 'number' ? width + 'px' : width } : null"
    >
        <div class="cs-trigger" @click="toggleOpen">
            <span class="cs-prefix"><slot name="trigger-prefix" /></span>
            <span class="cs-label" :class="{ placeholder: !normalizedOptions.find(o => o.value === modelValue) }">
                {{ currentLabel }}
            </span>
            <ChevronDown :size="compact ? 12 : 14" class="cs-arrow" :class="{ rotated: open }" />
        </div>

        <Teleport to="body">
            <Transition name="cs-dropdown">
                <div v-if="open" class="cs-dropdown cs-dropdown-fixed" :class="{ compact }" ref="dropdownRef" :style="dropdownStyle" @click.stop>
                    <div
                        v-for="opt in normalizedOptions"
                        :key="opt.value"
                        class="cs-option"
                        :class="{ active: opt.value === modelValue }"
                        @click="selectOption(opt)"
                    >
                        {{ opt.label }}
                    </div>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped>
.custom-select {
    position: relative;
    display: inline-block;
    width: 100%;
    font-size: 13px;
    font-family: inherit;
}

.cs-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 8px 12px;
    background-color: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    cursor: pointer;
    color: #333;
    transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
    user-select: none;
}

.custom-select:hover .cs-trigger {
    border-color: var(--primary-color, #EC4141);
    background-color: #fffafa;
}

.custom-select.open .cs-trigger {
    border-color: var(--primary-color, #EC4141);
    box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

.cs-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cs-prefix {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
}

.cs-label.placeholder {
    color: #aaa;
}

.cs-arrow {
    color: var(--primary-color, #EC4141);
    flex-shrink: 0;
    transition: transform 0.2s;
}

.cs-arrow.rotated {
    transform: rotate(180deg);
}

/* 下拉浮层（原 absolute 模式，保留兼容） */
.cs-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 9999;
    min-width: 100%;
    background: #fff;
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    padding: 4px;
    max-height: 240px;
    overflow-y: auto;
}

/* fixed 定位模式：脱离父容器 overflow 限制 */
.cs-dropdown-fixed {
    position: fixed;
    top: auto;
    left: auto;
    right: auto;
}

/* 透明模式（贴合外层容器，如 API 线路胶囊） */
.custom-select.transparent .cs-trigger {
    border: none;
    background-color: transparent;
    padding: 0 14px 0 2px;
    height: 18px;
    line-height: 18px;
    font-size: 11px;
    color: #333;
    border-radius: 10px;
}

.custom-select.transparent:hover .cs-trigger {
    background-color: transparent;
    border-color: transparent;
    box-shadow: none;
}

.custom-select.transparent.open .cs-trigger {
    background-color: transparent;
    border-color: transparent;
    box-shadow: none;
}

.custom-select.transparent .cs-arrow {
    color: var(--primary-color, #EC4141);
}

.custom-select.transparent .cs-dropdown {
    top: calc(100% + 6px);
    min-width: 120px;
}

/* 禁用 */
.custom-select.disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.custom-select.disabled .cs-trigger {
    cursor: not-allowed;
    background-color: #f5f5f5;
}

/* 下拉动画 */
.cs-dropdown-enter-active,
.cs-dropdown-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.cs-dropdown-enter-from,
.cs-dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>

<!-- 非 scoped：Teleport 到 body 的下拉浮层样式（全局生效） -->
<style>
.cs-dropdown.cs-dropdown-fixed {
    z-index: 99999;
    background: #fff;
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    padding: 4px;
    max-height: 240px;
    overflow-y: auto;
}

.cs-dropdown.cs-dropdown-fixed .cs-option {
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    color: #333;
    transition: background-color 0.12s, color 0.12s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.cs-dropdown.cs-dropdown-fixed .cs-option:hover {
    background-color: rgba(236, 65, 65, 0.06);
}

.cs-dropdown.cs-dropdown-fixed .cs-option.active {
    background-color: rgba(236, 65, 65, 0.1);
    color: var(--primary-color, #EC4141);
    font-weight: 600;
}

/* 紧凑模式 */
.cs-dropdown.cs-dropdown-fixed.compact {
    max-height: 200px;
}
.cs-dropdown.cs-dropdown-fixed.compact .cs-option {
    padding: 6px 10px;
    font-size: 12px;
}
</style>
