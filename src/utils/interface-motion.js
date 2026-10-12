import { ref, computed, watch } from 'vue'

export function shouldReduceMotion(mode, systemReduced) {
    return mode === 'off' || (mode === 'system' && systemReduced)
}

const systemReduced = ref(false)
export function useInterfaceMotion(settings) {
    return computed(() => shouldReduceMotion(settings.interfaceMotion, systemReduced.value))
}

// Apply one preference to CSS and the imperative lyric engine alike.
export function installInterfaceMotion(settings) {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncSystem = () => { systemReduced.value = media.matches }
    syncSystem()
    if (media.addEventListener) media.addEventListener('change', syncSystem)
    else media.addListener(syncSystem)
    const stop = watch([() => settings.interfaceMotion, () => settings.lightVisuals, systemReduced], () => {
        document.documentElement.classList.toggle('reduce-motion', shouldReduceMotion(settings.interfaceMotion, systemReduced.value))
        document.documentElement.classList.toggle('light-visuals', settings.lightVisuals)
    }, { immediate: true, flush: 'sync' })
    return () => {
        stop()
        if (media.removeEventListener) media.removeEventListener('change', syncSystem)
        else media.removeListener(syncSystem)
    }
}
