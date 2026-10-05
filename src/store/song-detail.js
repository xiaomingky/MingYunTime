import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSongDetailStore = defineStore('song-detail', () => {
  const style = ref(localStorage.getItem('song_detail_style') === 'apple' ? 'apple' : 'classic')
  const mode = ref(localStorage.getItem('apple_detail_mode') === 'line' ? 'line' : 'word')
  const savedSize = Number(localStorage.getItem('apple_detail_size'))
  const fontSize = ref(savedSize >= 24 && savedSize <= 64 ? savedSize : 42)
  const font = ref(localStorage.getItem('apple_detail_font') === 'serif' ? 'serif' : 'system')
  const translation = ref(localStorage.getItem('apple_detail_translation') !== 'false')
  const savedTranslationSize = Number(localStorage.getItem('apple_detail_translation_size'))
  const translationSize = ref(savedTranslationSize >= 12 && savedTranslationSize <= 30 ? savedTranslationSize : 16)
  const savedLineSpacing = Number(localStorage.getItem('apple_detail_line_spacing'))
  const lineSpacing = ref(savedLineSpacing >= 0 && savedLineSpacing <= 24 ? savedLineSpacing : 4)
  const blur = ref(localStorage.getItem('apple_detail_blur') !== 'false')
  const savedCover = localStorage.getItem('apple_detail_cover')
  const coverStyle = ref(['album', 'cd', 'vinyl', 'sleeve'].includes(savedCover) ? savedCover : 'album')
  const coverMotion = ref(localStorage.getItem('apple_detail_cover_motion') !== 'false')
  const performanceMode = ref(localStorage.getItem('apple_detail_performance') !== 'false')
  const savedFPS = Number(localStorage.getItem('apple_detail_fps'))
  const lyricFPS = ref([30, 45].includes(savedFPS) ? savedFPS : 45)
  const nearbyLyrics = ref(localStorage.getItem('apple_detail_nearby') !== 'false')
  const visualizer = ref(localStorage.getItem('apple_detail_visualizer') === 'true')

  for (const [key, preference] of Object.entries({
    song_detail_style: style, apple_detail_mode: mode, apple_detail_size: fontSize,
    apple_detail_font: font, apple_detail_translation: translation,
    apple_detail_translation_size: translationSize, apple_detail_line_spacing: lineSpacing,
    apple_detail_blur: blur,
    apple_detail_cover: coverStyle, apple_detail_cover_motion: coverMotion,
    apple_detail_performance: performanceMode, apple_detail_fps: lyricFPS,
    apple_detail_nearby: nearbyLyrics, apple_detail_visualizer: visualizer
  })) {
    watch(preference, value => localStorage.setItem(key, String(value)))
  }
  return { style, mode, fontSize, font, translation, translationSize, lineSpacing, blur, coverStyle, coverMotion,
    performanceMode, lyricFPS, nearbyLyrics, visualizer }
})
