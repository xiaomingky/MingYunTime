<script setup>
defineProps({
    checked: Boolean,
    mixed: Boolean,
    size: { type: [Number, String], default: 16 }
})
</script>

<template>
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="check-icon" :class="{ active: checked, mixed: mixed && !checked }" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path v-if="checked" d="m7.5 12 3 3 6-6" />
        <path v-else-if="mixed" d="M8 12h8" />
    </svg>
</template>
