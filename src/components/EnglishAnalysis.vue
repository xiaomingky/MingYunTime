<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { Sparkles, Loader2, AlertCircle, Database, Wifi, BookOpen, CheckCircle, ChevronDown, ChevronUp } from 'lucide-vue-next'

const props = defineProps({
    lyrics: { type: Array, default: () => [] },
    songName: { type: String, default: '' },
    artist: { type: String, default: '' },
    songPath: { type: String, default: '' },
    songId: { type: [String, Number], default: null },
    currentLyricIndex: { type: Number, default: -1 }
})

const emit = defineEmits(['scrollToLine'])

const analyzing = ref(false)
const analysisResult = ref(null)
const errorMsg = ref('')
const panelRef = ref(null)
const isCached = ref(false)
const savedMsg = ref('')
const batchProgress = ref('')
const expandedLine = ref(-1)
const cacheFilePath = ref('')

const englishLines = computed(() => {
    return props.lyrics
        .map((line, idx) => ({ ...line, origIndex: idx }))
        .filter(line => {
            const text = (line.text || '').trim()
            if (!text) return false
            const latin = text.replace(/[^a-zA-Z]/g, '').length
            const total = text.replace(/\s/g, '').length
            return total > 0 && latin / total > 0.4
        })
})

const hasEnglish = computed(() => englishLines.value.length > 0)

const cacheKey = computed(() => {
    if (props.songPath) return `local:${props.songPath}`
    if (props.songId) return `online:${props.songId}`
    return `name:${props.songName}|${props.artist}`
})

const apiKey = ref(localStorage.getItem('deepseek_api_key') || 'sk-18ba53c063894740ab2e08ee32ec85c5')
const aiModel = ref(localStorage.getItem('ai_model') || 'deepseek')
const mimoKey = ref(localStorage.getItem('mimo_api_key') || 'sk-cdyoqg5qn3ezark6mq821i71bstsz8cfo1st4qu0p6nam9sa')

function saveApiKey(value) {
    localStorage.setItem('deepseek_api_key', value.trim())
    apiKey.value = value.trim()
}
function saveMimoKey(value) {
    localStorage.setItem('mimo_api_key', value.trim())
    mimoKey.value = value.trim()
}
function saveModel(value) {
    localStorage.setItem('ai_model', value)
    aiModel.value = value
}

function extractJson(text) {
    const t = text.trim()
    try { return JSON.parse(t) } catch (e) {}
    const noFence = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    try { return JSON.parse(noFence) } catch (e) {}
    const a = noFence.indexOf('{'), b = noFence.lastIndexOf('}')
    if (a !== -1 && b > a) {
        try { return JSON.parse(noFence.slice(a, b + 1)) } catch (e) {}
    }
    throw new Error('JSON解析失败')
}

async function callDeepSeekBatch(linesBatch, batchIdx, totalBatches) {
    const promptLines = linesBatch.map((l, i) => `[${i}] ${l.text}`).join('\n')

    const systemPrompt = `你是拥有20年教学经验的英语语法教师，请逐句深度解析英文歌词。

对每个句子返回：
1. **parsing**：逐词标注语法角色（主语/谓语/宾语/表语/定语/状语/补语/同位语/连词/介词/冠词/感叹词），每词附detail说明它的语法功能
2. **tense**：时态
3. **voice**：主动/被动语态
4. **structure**：句型结构（简单句/复合句/并列句+从句类型）
5. **vocabulary**：列出所有B1+难度词汇，每个含：
   - pos(词性)，meaning(中文释义)，level(CEFR等级)
   - forms: 动词给出{base,past,pastParticiple,presentParticiple}，名词给出{singular,plural}，形容词给出{comparative,superlative}，无变形则填null
6. **translation**：整句通顺中文翻译

返回严格JSON：
{"lines":[{"index":0,"original":"原句","parsing":[{"word":"I","role":"主语","detail":"第一人称代词"}],"tense":"一般现在时","voice":"主动语态","structure":"简单句","vocabulary":[{"word":"go","pos":"动词","meaning":"去","level":"A1","forms":{"base":"go","past":"went","pastParticiple":"gone","presentParticiple":"going"}}],"translation":"我去上学"}]}
规则：只返回JSON，parsing必须覆盖句子中每个单词`

    const userPrompt = `请解析这些英文歌词句子：\n\n${promptLines}`
    const estTokens = Math.min(16384, 2048 + linesBatch.length * 1536)

    const isMimo = aiModel.value === 'mimo'
    const apiUrl = isMimo ? 'https://api.xiaomimimo.com/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions'
    const model = isMimo ? 'mimo-v2.5-pro' : 'deepseek-chat'
    const key = isMimo ? mimoKey.value : apiKey.value

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: isMimo ? systemPrompt + '\nToday is 2026.' : systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: isMimo ? 1.0 : 0.3,
            max_tokens: estTokens
        })
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API错误 ${response.status}: ${errText.slice(0, 200)}`)
    }
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('API返回为空')
    return extractJson(content).lines || []
}

const getBridge = () => window.__ELECTRON_BRIDGE__ || window.bridge || window.ipcHandler

async function saveCache(result) {
    // 将 Vue 响应式对象转换为普通对象，避免 IPC 序列化错误
    const plainResult = JSON.parse(JSON.stringify(result))
    const cacheData = {
        songName: props.songName,
        artist: props.artist,
        lines: plainResult,
        savedAt: Date.now(),
        totalLines: plainResult.length
    }
    const bridge = getBridge()
    console.log('[EnglishAnalysis] saveCache called, bridge=', !!bridge, 'songPath=', props.songPath, 'songId=', props.songId)

    // 1. 优先保存到本地文件（支持离线使用）
    let fileSaved = false
    let saveError = ''
    if (bridge) {
        // 本地歌曲 → 保存到歌曲同目录
        if (props.songPath) {
            try {
                console.log('[EnglishAnalysis] Saving local analysis to:', props.songPath)
                const res = await bridge.invoke('save-english-analysis', { songPath: props.songPath, analysis: cacheData })
                console.log('[EnglishAnalysis] Save result:', res)
                if (res.success) {
                    fileSaved = true
                    cacheFilePath.value = res.path
                    const fileName = res.path.split('/').pop() || res.path.split('\\').pop()
                    savedMsg.value = `已保存到本地: ${fileName}`
                } else {
                    saveError = res.error || '未知错误'
                    console.error('[EnglishAnalysis] Local save failed:', saveError)
                }
            } catch (e) { 
                saveError = e.message || String(e)
                console.error('Local file save failed:', e) 
            }
        }
        
        // 在线歌曲 → 保存到 analysis_cache 目录
        if (!fileSaved && props.songId) {
            try {
                console.log('[EnglishAnalysis] Saving online analysis for songId:', props.songId)
                const res = await bridge.invoke('save-online-english-analysis', {
                    songId: String(props.songId),
                    songName: props.songName,
                    artist: props.artist,
                    analysis: cacheData
                })
                console.log('[EnglishAnalysis] Online save result:', res)
                if (res.success) {
                    fileSaved = true
                    cacheFilePath.value = res.path
                    const fileName = res.path.split('/').pop() || res.path.split('\\').pop()
                    savedMsg.value = `已保存到本地: ${fileName}`
                } else {
                    saveError = res.error || '未知错误'
                    console.error('[EnglishAnalysis] Online save failed:', saveError)
                }
            } catch (e) { 
                saveError = e.message || String(e)
                console.error('Online file save failed:', e) 
            }
        }
    } else {
        saveError = '未找到 Electron Bridge，无法保存到本地文件'
        console.error('[EnglishAnalysis]', saveError)
    }

    // 2. 同时保存到 localStorage 作为备用
    try {
        cacheData.cachePath = cacheFilePath.value || ''
        localStorage.setItem(`en_analysis_${cacheKey.value}`, JSON.stringify(cacheData))
        console.log('[EnglishAnalysis] Saved to localStorage')
    } catch (e) {
        console.error('[EnglishAnalysis] localStorage save failed:', e)
    }

    if (fileSaved) {
        console.log('[EnglishAnalysis] File saved successfully')
        // savedMsg stays visible permanently
    } else {
        console.error('[EnglishAnalysis] File save failed:', saveError)
        savedMsg.value = saveError ? `保存失败: ${saveError}` : '解析已缓存到内存'
        // savedMsg stays visible permanently
    }
}

async function openCacheFolder() {
    if (!cacheFilePath.value) return
    const bridge = getBridge()
    if (bridge?.invoke) {
        try {
            const res = await bridge.invoke('show-item-in-folder', cacheFilePath.value)
            console.log('[EnglishAnalysis] Open folder result:', res)
        } catch (e) {
            console.error('[EnglishAnalysis] Open folder failed:', e)
        }
    }
}

async function loadCache() {
    // ★ 1. localStorage 优先 — 最快最可靠，saveCache 必定写入
    try {
        const cached = localStorage.getItem(`en_analysis_${cacheKey.value}`)
        if (cached) {
            const data = JSON.parse(cached)
            if (data.lines?.length > 0) {
                console.log('[EnglishAnalysis] Loaded from localStorage')
                cacheFilePath.value = data.cachePath || ''
                return data.lines
            }
        }
    } catch (e) {}

    // 2. 本地文件（IPC）
    const bridge = getBridge()
    if (bridge?.invoke && props.songPath) {
        try {
            const res = await bridge.invoke('load-english-analysis', props.songPath)
            if (res.success && res.analysis?.lines?.length > 0) {
                cacheFilePath.value = res.path || ''
                // 同步回 localStorage
                try { localStorage.setItem(`en_analysis_${cacheKey.value}`, JSON.stringify(res.analysis)) } catch (e) {}
                return res.analysis.lines
            }
        } catch (e) {}
    }

    if (bridge?.invoke && props.songId && !props.songPath) {
        try {
            const res = await bridge.invoke('load-online-english-analysis', String(props.songId))
            if (res.success && res.analysis?.lines?.length > 0) {
                cacheFilePath.value = res.path || ''
                try { localStorage.setItem(`en_analysis_${cacheKey.value}`, JSON.stringify(res.analysis)) } catch (e) {}
                return res.analysis.lines
            }
        } catch (e) {}
    }

    return null
}

async function forceReAnalyze() {
    analysisResult.value = null
    errorMsg.value = ''; batchProgress.value = ''; savedMsg.value = ''
    await nextTick()
    analyzing.value = true
    try {
        await runAnalysis()
    } finally {
        analyzing.value = false; batchProgress.value = ''
    }
}

async function runAnalysis() {
    const lines = englishLines.value
    const BATCH_SIZE = 6
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE)
    let completed = 0
    batchProgress.value = `0/${totalBatches} 批`
    const tasks = []
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
        const batch = lines.slice(i, Math.min(i + BATCH_SIZE, lines.length))
        const startIdx = i
        tasks.push((async () => {
            for (let retry = 0; retry < 2; retry++) {
                try {
                    const r = await callDeepSeekBatch(batch, Math.floor(i / BATCH_SIZE), totalBatches)
                    r.forEach(x => { x._engIdx = startIdx + (x.index ?? 0) })
                    completed++
                    batchProgress.value = `${completed}/${totalBatches} 批`
                    return r
                } catch (err) {
                    if (retry >= 1) throw err
                    await new Promise(r => setTimeout(r, 1500))
                }
            }
        })())
    }
    const batchArrays = await Promise.all(tasks)
    const allResults = batchArrays.flat()
    if (allResults.length === 0) throw new Error('解析结果为空')
    analysisResult.value = allResults
    expandedLine.value = props.currentLyricIndex
    await saveCache(allResults)
    isCached.value = true
}

async function startAnalysis() {
    if (!hasEnglish.value) { errorMsg.value = '未检测到英文歌词'; return }

    errorMsg.value = ''; batchProgress.value = ''; savedMsg.value = ''

    // 先检查缓存
    const cached = await loadCache()
    if (cached?.length > 0) {
        analysisResult.value = cached
        isCached.value = true
        expandedLine.value = props.currentLyricIndex
        return
    }

    // 缓存未命中 → 开始 API 解析
    analyzing.value = true

    try {
        await runAnalysis()
    } catch (err) {
        console.error('Analysis error:', err)
        errorMsg.value = `解析失败: ${err.message}`
        analysisResult.value = null
    } finally {
        analyzing.value = false; batchProgress.value = ''
    }
}

const analyzedMap = computed(() => {
    if (!analysisResult.value) return {}
    const map = {}; const eng = englishLines.value
    analysisResult.value.forEach(item => {
        const el = eng[item._engIdx]; if (el) map[el.origIndex] = item
    })
    return map
})

// ★ 组件挂载时自动从本地文件加载缓存
onMounted(async () => {
    const cached = await loadCache()
    if (cached?.length > 0) {
        analysisResult.value = cached
        isCached.value = true
        expandedLine.value = props.currentLyricIndex
    }
})

// Scroll: follow current lyric — find nearest English line and expand it
watch(() => props.currentLyricIndex, (idx) => {
    if (idx < 0 || !analysisResult.value) return
    
    // 如果当前行有解析，直接展开
    if (analyzedMap.value[idx]) {
        expandedLine.value = idx
        nextTick(() => {
            const el = panelRef.value?.querySelector(`[data-line="${idx}"]`)
            if (el && panelRef.value) {
                panelRef.value.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' })
            }
        })
        return
    }
    
    // 如果当前行没有解析，找到最近的上一行有解析的英文行
    const engIndices = Object.keys(analyzedMap.value).map(Number).sort((a, b) => a - b)
    let nearestIdx = -1
    for (let i = engIndices.length - 1; i >= 0; i--) {
        if (engIndices[i] <= idx) {
            nearestIdx = engIndices[i]
            break
        }
    }
    
    if (nearestIdx >= 0 && nearestIdx !== expandedLine.value) {
        expandedLine.value = nearestIdx
        nextTick(() => {
            const el = panelRef.value?.querySelector(`[data-line="${nearestIdx}"]`)
            if (el && panelRef.value) {
                panelRef.value.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' })
            }
        })
    }
})

// 歌曲切换时重置状态并尝试加载缓存
watch(() => props.songName, async () => {
    analysisResult.value = null; errorMsg.value = ''; isCached.value = false
    savedMsg.value = ''; expandedLine.value = -1
    analyzing.value = false; batchProgress.value = ''
    await nextTick()
    const cached = await loadCache()
    if (cached?.length > 0) {
        analysisResult.value = cached
        isCached.value = true
        expandedLine.value = props.currentLyricIndex
    }
})

// ── Role colors ──
const roleColors = {
    '主语': { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' },
    '谓语': { bg: '#fce7f3', text: '#be185d', border: '#f9a8d4' },
    '宾语': { bg: '#d1fae5', text: '#047857', border: '#6ee7b7' },
    '表语': { bg: '#fef3c7', text: '#b45309', border: '#fcd34d' },
    '定语': { bg: '#e0e7ff', text: '#4338ca', border: '#a5b4fc' },
    '状语': { bg: '#f3e8ff', text: '#7c3aed', border: '#c4b5fd' },
    '补语': { bg: '#ccfbf1', text: '#0f766e', border: '#5eead4' },
    '同位语': { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
    '连词': { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
    '介词': { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
    '冠词': { bg: '#f8fafc', text: '#94a3b8', border: '#e2e8f0' },
}
function getRoleStyle(r) {
    for (const [k, v] of Object.entries(roleColors)) { if (r.includes(k)) return v }
    return { bg: '#f1f5f9', text: '#64748b', border: '#cbd5e1' }
}

const tenseColors = {
    '现在完成进行时': '#7c3aed','过去完成进行时': '#6d28d9','现在完成时': '#059669','过去完成时': '#047857',
    '将来完成时': '#0d9488','现在进行时': '#2563eb','过去进行时': '#1d4ed8','一般将来时': '#0891b2',
    '一般过去时': '#4f46e5','一般现在时': '#6366f1',
}
function getTenseColor(t) {
    for (const [k, v] of Object.entries(tenseColors)) { if (t.includes(k)) return v }
    return '#6366f1'
}
</script>

<template>
  <div class="en-panel" ref="panelRef">
    <!-- Toast -->
    <div v-if="savedMsg" class="toast"><CheckCircle :size="14" /> {{ savedMsg }}</div>

    <div v-if="!hasEnglish" class="state-ctr">
        <BookOpen :size="36" /><p>未检测到英文歌词</p><span>当前歌曲可能不含英文内容</span>
    </div>

    <template v-else>
        <!-- Idle -->
        <div v-if="!analysisResult && !analyzing && !errorMsg" class="state-ctr">
            <Sparkles :size="40" class="ic-indigo" />
            <p>AI 英文歌词解析</p>
            <span>选择模型深度解析语法·时态·生词·变形</span>
            <div class="model-select-box">
                <select v-model="aiModel" @change="saveModel($event.target.value)" class="model-select">
                    <option value="deepseek">DeepSeek</option>
                    <option value="mimo">MiMo v2.5-pro</option>
                </select>
            </div>
            <div v-if="aiModel === 'deepseek'" class="api-key-box">
                <input
                    type="password"
                    :value="apiKey"
                    placeholder="输入你的 DeepSeek API Key（可选）"
                    @input="saveApiKey($event.target.value)"
                    class="api-key-input"
                />
            </div>
            <div v-else class="api-key-box">
                <input
                    type="password"
                    :value="mimoKey"
                    placeholder="输入你的 MiMo API Key"
                    @input="saveMimoKey($event.target.value)"
                    class="api-key-input"
                />
            </div>
            <button class="btn-start" @click="startAnalysis"><Sparkles :size="16" /> 开始解析</button>
        </div>

        <!-- Analyzing -->
        <div v-if="analyzing" class="state-ctr">
            <Loader2 :size="32" class="spin" /><p>AI 正在解析歌词</p>
            <span v-if="batchProgress" class="prog">{{ batchProgress }}</span>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="state-ctr">
            <AlertCircle :size="20" /><p class="err">{{ errorMsg }}</p>
            <button class="btn-retry" @click="startAnalysis">重试</button>
        </div>

        <!-- Results: show ONLY analyzed English lines -->
        <div v-if="analysisResult && !analyzing" class="results">
            <div class="head">
                <span class="badge" :class="{ cached: isCached }">
                    <Database v-if="isCached" :size="13" /><Wifi v-else :size="13" />
                    {{ isCached ? '已缓存' : '在线' }}
                </span>
                <span class="cnt">{{ Object.keys(analyzedMap).length }}句已解析</span>
                <span v-if="cacheFilePath" class="cache-path" @click.stop="openCacheFolder" title="点击打开文件位置">
                    {{ cacheFilePath.split('/').pop() || cacheFilePath.split('\\').pop() }}
                </span>
                <button class="btn-re-analyze" @click="forceReAnalyze()">重新解析</button>
                <span class="name">{{ props.songName }}</span>
            </div>

            <div v-for="(line, origIdx) in props.lyrics" :key="origIdx"
                v-show="analyzedMap[origIdx]"
                class="line has"
                :class="{ cur: origIdx === props.currentLyricIndex }"
                :data-line="origIdx"
            >
                <!-- Lyric row -->
                <div class="lrow" @click="expandedLine = expandedLine === origIdx ? -1 : origIdx">
                    <span class="idx">{{ origIdx + 1 }}</span>
                    <span class="txt">{{ line.text }}</span>
                    <span v-if="line.ttext" class="sub">{{ line.ttext }}</span>
                    <span class="arr">{{ expandedLine === origIdx ? '▾' : '▸' }}</span>
                </div>

                <!-- Analysis (only if expanded) -->
                <div v-if="expandedLine === origIdx" class="detail" @click.stop>
                    <!-- Parsing -->
                    <div class="sec">
                        <div class="lbl">句子成分</div>
                        <div class="chips">
                            <span v-for="(p, pi) in analyzedMap[origIdx].parsing" :key="pi" class="chip"
                                :style="{ background: getRoleStyle(p.role).bg, color: getRoleStyle(p.role).text, borderColor: getRoleStyle(p.role).border }">
                                <b>{{ p.word }}</b>
                                <small>{{ p.role }}</small>
                                <i v-if="p.detail">{{ p.detail }}</i>
                            </span>
                        </div>
                    </div>

                    <!-- Meta: tense, voice, structure -->
                    <div class="meta">
                        <div class="meta-card tense-card" :style="{ borderLeftColor: getTenseColor(analyzedMap[origIdx].tense) }">
                            <span class="meta-icon">⏳</span>
                            <span class="meta-label">时态</span>
                            <span class="meta-val" :style="{ color: getTenseColor(analyzedMap[origIdx].tense) }">{{ analyzedMap[origIdx].tense }}</span>
                        </div>
                        <div class="meta-card voice-card">
                            <span class="meta-icon">{{ analyzedMap[origIdx].voice?.includes('被动') ? '🔽' : '🔼' }}</span>
                            <span class="meta-label">语态</span>
                            <span class="meta-val">{{ analyzedMap[origIdx].voice }}</span>
                        </div>
                        <div class="meta-card struct-card">
                            <span class="meta-icon">📐</span>
                            <span class="meta-label">句型</span>
                            <span class="meta-val">{{ analyzedMap[origIdx].structure }}</span>
                        </div>
                    </div>

                    <!-- Vocabulary with word forms -->
                    <div v-if="analyzedMap[origIdx].vocabulary?.length" class="sec">
                        <div class="lbl">词汇详解</div>
                        <div class="vlist">
                            <div v-for="(v, vi) in analyzedMap[origIdx].vocabulary" :key="vi" class="vcard">
                                <div class="vhead">
                                    <span class="vword">{{ v.word }}</span>
                                    <span class="vpos">{{ v.pos }}</span>
                                    <span class="vmeaning">— {{ v.meaning }}</span>
                                    <span class="vlvl" :class="'lv-' + (v.level || 'B1')">{{ v.level || 'B1' }}</span>
                                </div>
                                <!-- Word forms -->
                                <div v-if="v.forms" class="vforms">
                                    <template v-if="v.pos?.includes('动词') || v.pos === 'verb' || v.pos === 'v.'">
                                        <span v-if="v.forms.base" class="vf"><em>原形</em> {{ v.forms.base }}</span>
                                        <span v-if="v.forms.past" class="vf"><em>过去式</em> {{ v.forms.past }}</span>
                                        <span v-if="v.forms.pastParticiple" class="vf"><em>过去分词</em> {{ v.forms.pastParticiple }}</span>
                                        <span v-if="v.forms.presentParticiple" class="vf"><em>现在分词</em> {{ v.forms.presentParticiple }}</span>
                                    </template>
                                    <template v-else-if="v.pos?.includes('名词') || v.pos === 'noun' || v.pos === 'n.'">
                                        <span v-if="v.forms.singular" class="vf"><em>单数</em> {{ v.forms.singular }}</span>
                                        <span v-if="v.forms.plural" class="vf"><em>复数</em> {{ v.forms.plural }}</span>
                                    </template>
                                    <template v-else-if="v.pos?.includes('形容词') || v.pos === 'adj.' || v.pos === 'adjective'">
                                        <span v-if="v.forms.comparative" class="vf"><em>比较级</em> {{ v.forms.comparative }}</span>
                                        <span v-if="v.forms.superlative" class="vf"><em>最高级</em> {{ v.forms.superlative }}</span>
                                    </template>
                                    <template v-else>
                                        <span v-if="v.forms.base" class="vf"><em>原形</em> {{ v.forms.base }}</span>
                                        <span v-if="v.forms.past" class="vf"><em>过去式</em> {{ v.forms.past }}</span>
                                        <span v-if="v.forms.pastParticiple" class="vf"><em>过去分词</em> {{ v.forms.pastParticiple }}</span>
                                        <span v-if="v.forms.plural" class="vf"><em>复数</em> {{ v.forms.plural }}</span>
                                        <span v-if="v.forms.comparative" class="vf"><em>比较级</em> {{ v.forms.comparative }}</span>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Translation -->
                    <div v-if="analyzedMap[origIdx].translation" class="trans">
                        <div class="lbl">译文</div>
                        <div class="ttext">{{ analyzedMap[origIdx].translation }}</div>
                    </div>
                </div>
            </div>
        </div>
    </template>
  </div>
</template>

<style scoped>
.en-panel { 
    height:100%; 
    overflow-y:auto; 
    padding:12px 16px 40px; 
    position:relative;
    min-width: 280px;
    width: 100%;
    box-sizing: border-box;
}

/* Toast */
.toast {
    position:sticky; top:4px; z-index:20; display:flex; align-items:center; gap:6px;
    padding:7px 14px; background:#059669; color:#fff; border-radius:8px;
    font-size:12px; font-weight:500; margin-bottom:6px; animation:in 0.3s;
}
@keyframes in { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }

/* States */
.state-ctr {
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:100%; gap:8px; text-align:center;
}
.state-ctr p { font-size:16px; color:#666; margin:0; font-weight:500; }
.state-ctr span { font-size:13px; color:#aaa; }
.ic-indigo { color:#6366f1; opacity:.5; }
.prog { color:#6366f1 !important; font-weight:500; }
.err { color:#dc2626 !important; }

.model-select-box {
    margin-top: 12px;
    width: 100%;
    max-width: 320px;
}
.model-select {
    width: 100%;
    padding: 8px 14px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    font-size: 13px;
    outline: none;
    text-align: center;
    background: #fafafa;
    cursor: pointer;
}
.model-select:focus { border-color: #6366f1; background: #fff; }

.mimo-hint {
    font-size: 12px;
    color: #059669;
    background: #ecfdf5;
    padding: 8px 14px;
    border-radius: 8px;
    display: block;
    text-align: center;
}

.api-key-box {
    margin-top: 12px;
    width: 100%;
    max-width: 320px;
}
.api-key-input {
    width: 100%;
    padding: 8px 14px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    font-size: 12px;
    outline: none;
    text-align: center;
    transition: border-color 0.2s;
    background: #fafafa;
}
.api-key-input:focus {
    border-color: #6366f1;
    background: #fff;
}
.api-key-input::placeholder {
    color: #bbb;
}
.btn-start {
    display:flex; align-items:center; gap:6px; margin-top:16px; padding:10px 30px;
    background:#6366f1; color:#fff; border:none; border-radius:24px;
    font-size:15px; cursor:pointer; font-weight:600; transition:all .2s;
}
.btn-start:hover { background:#4f46e5; transform:translateY(-1px); box-shadow:0 4px 20px rgba(99,102,241,.3); }
.btn-re-analyze {
    margin-left: auto;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
    background: #f8f8f8;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    font-weight: 500;
}
.btn-re-analyze:hover {
    border-color: #6366f1;
    color: #6366f1;
    background: #eef2ff;
}

.btn-retry {
    margin-top:8px; padding:6px 20px; background:#fef2f2; color:#dc2626;
    border:1px solid #fecaca; border-radius:16px; cursor:pointer; font-size:13px; font-weight:500;
}

.spin { animation:spin 1s linear infinite; color:#6366f1; }
@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }

/* Results */
.results { display:flex; flex-direction:column; gap:2px; }

.head {
    display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:6px;
    position:sticky; top:0; background:rgba(255,255,255,.92); backdrop-filter:blur(8px);
    z-index:10; border-radius:8px; border:1px solid rgba(0,0,0,.04);
}
.badge { display:flex; align-items:center; gap:4px; font-size:11px; padding:3px 10px; border-radius:10px; background:#dbeafe; color:#2563eb; font-weight:500; }
.badge.cached { background:#d1fae5; color:#047857; }
.cnt { font-size:11px; color:#888; }
.cache-path { 
    font-size:11px; 
    color:#6366f1; 
    cursor:pointer; 
    text-decoration:underline;
    max-width:150px; 
    overflow:hidden; 
    text-overflow:ellipsis; 
    white-space:nowrap;
}
.cache-path:hover { color:#4f46e5; }
.name { margin-left:auto; font-size:11px; color:#bbb; font-weight:500; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* Line */
.line {
    border-radius:8px; margin-bottom:1px; transition:all .15s; border:1px solid transparent; cursor:pointer;
}
.line.cur { background:rgba(99,102,241,.04); border-color:rgba(99,102,241,.1); }
.line:hover { background:rgba(0,0,0,.015); }

.lrow { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; }
.idx { font-size:10px; color:#ccc; width:20px; text-align:right; flex-shrink:0; padding-top:2px; }
.txt { 
    font-size:14px; 
    color:#444; 
    line-height:1.6; 
    word-break: normal;
    overflow-wrap: break-word; 
    flex:1; 
    min-width: 0; 
    white-space: normal;
}
.txt.dim { color:#d0d0d0; }
.line.cur .txt { color:#4f46e5; font-weight:700; }
.sub { font-size:12px; color:#ccc; margin-left:4px; flex-shrink:0; }
.arr { font-size:12px; color:#aaa; flex-shrink:0; padding-top:2px; }

/* Detail */
.detail { padding:6px 10px 12px 30px; display:flex; flex-direction:column; gap:10px; }
.lbl { font-size:10px; color:#aaa; font-weight:600; letter-spacing:.5px; }

/* Chips */
.sec { display:flex; flex-direction:column; gap:4px; }
.chips { display:flex; flex-wrap:wrap; gap:4px; }
.chip {
    display:inline-flex; flex-direction:row; align-items:center; gap:4px; padding:4px 8px;
    border-radius:5px; border:1px solid; font-size:12px; line-height:1.35;
    white-space: nowrap; word-break: keep-all;
}
.chip b { font-size:13px; white-space: nowrap; word-break: keep-all; }
.chip small { font-size:10px; opacity:.7; white-space: nowrap; word-break: keep-all; }
.chip i { font-size:10px; opacity:.55; max-width:160px; margin-top:1px; white-space: normal; word-break: normal; }

/* Meta */
.meta { display:flex; align-items:stretch; gap:8px; flex-wrap:wrap; }
.meta-card {
    display:flex; align-items:center; gap:6px;
    padding:6px 12px; border-radius:8px; font-size:13px;
    border:1px solid #e5e7eb; background:#fafafa;
    border-left:3px solid #6366f1;
}
.meta-icon { font-size:14px; flex-shrink:0; }
.meta-label { font-size:10px; color:#999; font-weight:500; text-transform:uppercase; letter-spacing:.5px; }
.meta-val { font-size:13px; font-weight:700; color:#333; }
.voice-card { border-left-color:#64748b; }
.struct-card { border-left-color:#d4d4d8; }

/* Vocab */
.vlist { display:flex; flex-direction:column; gap:4px; }
.vcard {
    padding:6px 10px; background:#fffbeb; border:1px solid #fde68a; border-radius:10px;
    display:flex; flex-direction:column; gap:4px;
}
.vhead { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.vword { font-weight:700; color:#92400e; font-size:13px; }
.vpos { font-size:10px; color:#a16207; background:#fef3c7; padding:1px 5px; border-radius:4px; }
.vmeaning { color:#78350f; font-weight:500; font-size:12px; }
.vlvl { font-size:9px; padding:1px 5px; border-radius:6px; font-weight:700; }
.lv-A1,.lv-A2 { background:#d1fae5; color:#047857; }
.lv-B1,.lv-B2 { background:#fef3c7; color:#b45309; }
.lv-C1,.lv-C2 { background:#fee2e2; color:#dc2626; }

/* Word forms */
.vforms { display:flex; flex-wrap:wrap; gap:6px; padding-top:2px; }
.vf { font-size:11px; color:#78716c; background:#faf5ff; padding:2px 8px; border-radius:10px; border:1px solid #e9d5ff; }
.vf em { font-style:normal; color:#7c3aed; font-weight:500; margin-right:3px; }

/* Translation */
.trans { display:flex; flex-direction:column; gap:2px; }
.ttext {
    font-size:14px; color:#4f46e5; font-weight:600; line-height:1.6;
    background:rgba(99,102,241,.05); padding:8px 12px; border-radius:6px; border-left:3px solid #6366f1;
}

/* Scrollbar */
.en-panel::-webkit-scrollbar { width:3px; }
.en-panel::-webkit-scrollbar-thumb { background:rgba(0,0,0,.06); border-radius:2px; }
</style>
