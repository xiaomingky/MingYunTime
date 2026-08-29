<script setup>
// B站 Cookie/Token 登录（嵌入各扫码登录弹窗）：粘贴登录，与扫码同源
import { ref } from 'vue'
import { KeyRound, LogIn } from 'lucide-vue-next'
import { biliSetWebCookie, biliSetTvToken } from '../api'
import { useMessageStore } from '../store/message'

const props = defineProps({ mode: { type: String, default: 'web' } }) // web | tv
const emit = defineEmits(['success'])
const messageStore = useMessageStore()
const open = ref(false)
const text = ref('')
const loading = ref(false)

const doLogin = async () => {
    const v = text.value.trim()
    if (!v) return messageStore.warning(props.mode === 'tv' ? '请先粘贴 TV Token' : '请先粘贴 Cookie')
    loading.value = true
    try {
        const res = props.mode === 'tv' ? await biliSetTvToken(v) : await biliSetWebCookie(v)
        if (res?.success) {
            messageStore.success(props.mode === 'tv' ? 'TV Token 登录成功' : 'Cookie 登录成功')
            text.value = ''
            open.value = false
            emit('success')
        } else {
            messageStore.error(res?.message || '登录失败')
        }
    } catch (e) {
        messageStore.error('登录失败：' + (e.message || '未知错误'))
    } finally {
        loading.value = false
    }
}
</script>

<template>
  <div class="bcl-wrap">
    <button class="bcl-toggle" @click="open = !open">
        <KeyRound :size="12" /> {{ open ? '收起 Cookie 登录' : 'Cookie 登录' }}
    </button>
    <div v-if="open" class="bcl-panel">
        <textarea
            v-model="text"
            class="bcl-textarea"
            :placeholder="mode === 'tv'
                ? '粘贴 TV Token JSON（含 accessKey），或直接粘贴 accessKey 字符串'
                : '粘贴 Cookie：SESSDATA=xxx; bili_jct=xxx; ...（也支持 JSON 格式）'"
        ></textarea>
        <button class="bcl-btn" :disabled="loading" @click="doLogin">
            <LogIn :size="13" /> {{ loading ? '登录中...' : '登录' }}
        </button>
    </div>
  </div>
</template>

<style scoped>
.bcl-wrap { margin-top: 8px; }
.bcl-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    background: #fff;
    color: #777;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}
.bcl-toggle:hover { border-color: #fb7299; color: #fb7299; }
.bcl-panel { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.bcl-textarea {
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    font-size: 12px;
    font-family: Consolas, monospace;
    resize: vertical;
    box-sizing: border-box;
    word-break: break-all;
    outline: none;
}
.bcl-textarea:focus { border-color: #fb7299; }
.bcl-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: none;
    border-radius: 8px;
    background: #fb7299;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
}
.bcl-btn:disabled { opacity: 0.6; }
</style>
