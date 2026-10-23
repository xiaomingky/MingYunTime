<script setup>
import { ref } from 'vue'
import { Search, X } from 'lucide-vue-next'

defineProps({
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '搜索' },
    label: { type: String, default: '搜索' },
    clearable: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'focus', 'blur', 'keydown', 'clear'])
const input = ref(null)
function keys(event) {
    if (event.isComposing || event.keyCode === 229) return
    emit('keydown', event)
    if (event.key === 'Enter' && !event.defaultPrevented) {
        event.preventDefault()
        emit('submit')
    }
}
function clear() {
    emit('update:modelValue', '')
    emit('clear')
    input.value?.focus()
    emit('focus')
}
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
    <div class="search-input shared-search-input">
        <button type="button" class="shared-search-action" :aria-label="label" @click="emit('submit')"><Search :size="14" /></button>
        <input ref="input" type="text" :value="modelValue" :placeholder="placeholder" :aria-label="label" autocomplete="off"
            @input="emit('update:modelValue', $event.target.value)" @keydown="keys"
            @focus="emit('focus', $event)" @blur="emit('blur', $event)" />
        <button v-if="clearable && modelValue" type="button" class="shared-search-action shared-search-clear" aria-label="清空搜索" @mousedown.prevent @click="clear"><X :size="12" /></button>
        <slot />
    </div>
</template>

<style scoped>
.shared-search-input { position: relative; color: var(--search-input-color, inherit); }
.shared-search-input input { min-width: 0; padding: 0; color: var(--search-input-color, white); font-family: inherit; font-size: 12px; }
.shared-search-input input::placeholder { color: var(--search-placeholder-color, rgba(255,255,255,.4)); }
.shared-search-action { display: grid; place-items: center; flex-shrink: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.shared-search-clear { opacity: .6; }
.shared-search-clear:hover { opacity: 1; }
.shared-search-input input:focus, .shared-search-input input:focus-visible { outline: none; outline-offset: 0; box-shadow: none; }
</style>
