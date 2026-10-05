// The player stores line times in seconds and YRC word times in milliseconds.
export function toAppleLyrics({ lyrics = [], yrcLyrics = [], mode = 'word', translation = true, duration = 0 }) {
  const hasWords = Array.isArray(yrcLyrics) && yrcLyrics.length > 0
  const useWords = hasWords && mode === 'word'
  const lines = useWords ? yrcLyrics : lyrics.length ? lyrics : hasWords ? yrcLyrics : []
  return lines.map((line, index) => {
    const startTime = Math.max(0, Math.round(Number(line.time) * 1000) || 0)
    const nextTime = lines[index + 1]?.time
    const nextStart = nextTime != null ? Math.round(Number(nextTime) * 1000) : 0
    const limit = nextStart > startTime ? nextStart : Infinity
    const words = useWords && line.words?.length ? line.words.map(word => {
      const start = Math.max(0, Math.round(Number(word.startTime)) || 0)
      return { word: String(word.text ?? ''), startTime: start, endTime: Math.max(start + 1, Math.min(limit, start + Math.max(1, Math.round(Number(word.duration)) || 1))) }
    }) : null
    const timedEnd = Number(line.duration) > 0 ? startTime + Number(line.duration) : 0
    // These sources have one main vocal line; an overlong word must not pin the preceding line.
    const endTime = Math.max(startTime + 1, Math.min(limit, words?.at(-1)?.endTime || timedEnd ||
      (nextTime != null ? nextStart : Math.max(duration * 1000, startTime + 5000))))
    return {
      startTime, endTime,
      words: words || [{ word: String(line.text ?? ''), startTime, endTime }],
      translatedLyric: translation ? String(line.ttext ?? '') : '',
      romanLyric: '', isBG: false, isDuet: false
    }
  })
}
