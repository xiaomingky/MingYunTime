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
// 展开方向（空间不足时向上弹），用于方向感知的展开动画
const dropUp = ref(false)

// 打开时计算浮层位置（基于触发器在视口中的位置）
const updateDropdownPosition = () => {
    if (!rootRef.value) return
    const rect = rootRef.value.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    // 向下展开空间不足且上方空间更大时，向上展开
    const showAbove = spaceBelow < 240 && rect.top > spaceBelow
    dropUp.value = showAbove
    dropdownStyle.value = {
        left: rect.left + 'px',
        minWidth: rect.width + 'px',
        [showAbove ? 'bottom' : 'top']: showAbove
            ? (window.innerHeight - rect.top + 4) + 'px'
            : (rect.bottom + 4) + 'px'
    }
}

// 归一化 options：支持普通项 { value, label }，也支持分组 { group: '组名', children: [...] }
const normalizedOptions = computed(() => {
    return props.options.map(opt => {
        if (typeof opt === 'object' && opt !== null && opt.children) {
            const children = (opt.children || []).map(c => {
                if (typeof c === 'object' && c !== null) return { value: c.value, label: c.label ?? String(c.value) }
                return { value: c, label: String(c) }
            })
            return { group: opt.group ?? opt.label ?? '分组', children }
        }
        if (typeof opt === 'object' && opt !== null) {
            return { value: opt.value, label: opt.label ?? String(opt.value) }
        }
        return { value: opt, label: String(opt) }
    })
})

// 命中项（无分组时定位选中项）
const selectedLabel = computed(() => {
    for (const o of normalizedOptions.value) {
        if (!o.children) continue
        if (o.children.find(c => c.value === props.modelValue)) return null
    }
    const found = flatOptions.value.find(o => o.value === props.modelValue)
    return found ? found.label : null
})

const flatOptions = computed(() => {
    const out = []
    for (const o of normalizedOptions.value) {
        if (o.children) out.push(...o.children)
        else if (o.value !== undefined) out.push(o)
    }
    return out
})

const currentLabel = computed(() => {
    if (selectedLabel.value) return selectedLabel.value
    const found = flatOptions.value.find(o => o.value === props.modelValue)
    return found ? found.label : props.placeholder
})

const toggleOpen = () => {
    if (props.disabled) return
    open.value = !open.value
    if (open.value) {
        // 浮层常驻（v-show），无需等 DOM 创建，直接同步定位，避免首次打开卡顿
        updateDropdownPosition()
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
            <!-- 常驻浮层容器：v-show 显隐，打开时同步定位不卡。
                 选项列表仅在 open 时渲染（v-if），关闭即销毁 —— 避免大选项列表永久挂在 DOM 里撑内存 -->
            <div v-show="open" class="cs-dropdown cs-dropdown-fixed" :class="{ compact, 'drop-up': dropUp }" ref="dropdownRef" :style="dropdownStyle" @click.stop>
                <template v-if="open">
                    <template v-for="(opt, gi) in normalizedOptions" :key="opt.group ? 'g' + gi : opt.value">
                        <!-- 分组 -->
                        <template v-if="opt.children">
                            <div class="cs-group-label">{{ opt.group }}</div>
                            <div
                                v-for="c in opt.children"
                                :key="c.value"
                                class="cs-option"
                                :class="{ active: c.value === modelValue }"
                                @click="selectOption(c)"
                            >
                                {{ c.label }}
                            </div>
                        </template>
                        <!-- 普通项 -->
                        <div
                            v-else-if="opt.value !== undefined"
                            :key="opt.value"
                            class="cs-option"
                            :class="{ active: opt.value === modelValue }"
                            @click="selectOption(opt)"
                        >
                            {{ opt.label }}
                        </div>
                    </template>
                </template>
            </div>
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

/* 下拉展开动画：浮层从 display:none 变为可见时 CSS 动画自动重放；
   按展开方向区分从上滑入/从下滑入。关闭保持瞬时（菜单收起要干脆） */
.cs-dropdown.cs-dropdown-fixed {
    animation: cs-drop-in-down 0.16s cubic-bezier(0.25, 0.8, 0.35, 1);
    transform-origin: top center;
}
.cs-dropdown.cs-dropdown-fixed.drop-up {
    animation-name: cs-drop-in-up;
    transform-origin: bottom center;
}
@keyframes cs-drop-in-down {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes cs-drop-in-up {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
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

.cs-dropdown.cs-dropdown-fixed .cs-group-label {
    padding: 6px 12px 2px;
    font-size: 11px;
    color: #999;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    user-select: none;
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
