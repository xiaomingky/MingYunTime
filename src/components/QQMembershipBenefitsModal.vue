<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, Gift, RefreshCw, CheckCircle2, Clock3, ArrowUpRight, MonitorPlay } from 'lucide-vue-next'
import { qqMembershipBenefits, qqOpenBenefits } from '../api/qq'
import { useQQUserStore } from '../store/qq-user'
const emit = defineEmits(['close'])
const user = useQQUserStore()
const panel = ref(null), closeButton = ref(null), info = ref(null), loading = ref(false), claiming = ref(false)
const error = ref(''), result = ref(null), membershipWarning = ref('')
const listening = ref(null), tasks = ref([]), issues = ref([]), opening = ref(false), activityMessage = ref(''), now = ref(Date.now())
const busy = computed(() => loading.value || claiming.value || opening.value)
const countdown = computed(() => {
  if (listening.value?.endAt === null || !listening.value || !Number.isFinite(listening.value.endAt)) return '— : — : —'
  const seconds = Math.max(0,Math.floor((listening.value.endAt - now.value)/1000))
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':')
})
let clock
const giftSubmitted = computed(() => !!result.value)
const expiryLabel = computed(() => info.value?.activeUntil ? new Date(info.value.activeUntil).toLocaleString('zh-CN', { hour12: false }) : '')
let alive = true
const previousFocus = document.activeElement
async function request(action) {
  const response = await qqMembershipBenefits(action, user.uin)
  if (response?.code !== 0 || !response.data) throw new Error(response?.message || 'QQ 会员福利响应不完整，请重试')
  return response.data
}
async function refresh() {
  if (busy.value) return
  loading.value = true; error.value = ''
  try { const data = await request('activity'); if (alive) { info.value = data.info; listening.value = data.listening || null; tasks.value = data.tasks || []; issues.value = data.issues || []; now.value = Date.now() } }
  catch (e) { if (alive) { info.value = null; listening.value = null; tasks.value = []; error.value = e.message || '状态查询失败，请重试' } }
  finally { if (alive) loading.value = false }
}
async function openActivity(target) {
  if (busy.value) return
  opening.value = true; activityMessage.value = ''
  try { const response = await qqOpenBenefits(target, user.uin); if (!alive) return; if (response?.code !== 0) throw new Error(response?.message || '打开失败，请重试'); activityMessage.value = response.message }
  catch (e) { if (alive) activityMessage.value = e.message || '打开失败，请重试' }
  finally { if (alive) opening.value = false }
}
async function claim(action) {
  if (busy.value || giftSubmitted.value) return
  claiming.value = true; error.value = ''; membershipWarning.value = ''
  try {
    const data = await request(action)
    if (!alive) return
    result.value = data; info.value = data.info
    const refreshed = await user.fetchVipInfo()
    if (alive && !refreshed) membershipWarning.value = '会员身份刷新失败，可稍后点击账号菜单中的会员状态重试。'
  } catch (e) { if (alive) error.value = e.message || '领取失败，请重试' }
  finally { if (alive) claiming.value = false }
}
function keyboard(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (event.key !== 'Tab') return
  const buttons = [...(panel.value?.querySelectorAll('button:not(:disabled)') || [])]
  const first = buttons[0], last = buttons.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(() => user.revision, () => emit('close'))
onMounted(() => { closeButton.value?.focus(); refresh(); clock = setInterval(()=>{ now.value = Date.now() },1000) })
onBeforeUnmount(() => { alive = false; clearInterval(clock); if (previousFocus?.isConnected) nextTick(() => previousFocus.focus()) })
</script>
<template>
  <Teleport to="body">
    <div class="qq-benefits-overlay" @click.self="emit('close')" @keydown="keyboard">
      <section ref="panel" class="qq-benefits-modal" role="dialog" aria-modal="true" aria-labelledby="qq-benefits-title" :aria-busy="busy">
        <button ref="closeButton" class="qq-benefits-close" aria-label="关闭" @click="emit('close')"><X :size="20" /></button>
        <p class="qq-benefits-kicker">QQ MUSIC / 免费听与会员福利</p>
        <div class="qq-free-listen-time" role="timer" aria-label="剩余免费听时长">{{ countdown }}</div>
        <div class="qq-free-listen-heading"><h2 id="qq-benefits-title">看广告 <em>免费听</em></h2><button :disabled="busy" class="qq-activity-add" @click="openActivity('client')"><Clock3 :size="15" />加时长</button></div>
        <p class="qq-free-switch">听歌前自动开启<span>{{ listening?.autoOpen === true ? '官方已开启' : listening?.autoOpen === false ? '官方未开启' : '状态未返回' }}</span></p>
        <p v-if="listening?.remainingTimes !== null && listening?.remainingTimes !== undefined" class="qq-benefits-note">官方返回剩余次数 {{ listening.remainingTimes }}，具体可领取次数以官方任务页面为准。</p>
        <section class="qq-reward-task"><span class="qq-task-icon"><Gift :size="24" /></span><div><h3>看广告领绿钻</h3><p>完成广告任务，领取免费听时长与会员奖励</p><p>实际任务次数和奖励以当前账号的官方活动为准。</p></div></section>
        <div class="qq-task-progress" v-if="tasks.length"><div v-for="(task,index) in tasks" :key="task.type"><span>免费听任务 {{ index + 1 }}</span><strong>当前阶段 {{ task.currentStage ?? '—' }} / {{ task.totalStage ?? '—' }}</strong><progress v-if="task.totalStage > 0 && task.currentStage !== null" :value="task.currentStage" :max="task.totalStage"></progress></div></div>
        <p v-else-if="!loading" class="qq-benefits-note">当前账号暂未返回可展示的免费听任务进度。</p>
        <div class="qq-official-activity-buttons"><button class="qq-activity-client" :disabled="busy" @click="openActivity('client')"><MonitorPlay :size="17" />前往官方客户端完成任务<ArrowUpRight :size="17" /></button><button :disabled="busy" @click="openActivity('web')">查看官方绿钻活动页面<ArrowUpRight :size="14" /></button></div>
        <p v-if="activityMessage" role="status" class="qq-benefits-note">{{ activityMessage }}</p>
        <p class="qq-benefits-note">此活动的广告播放与奖励确认需要官方客户端组件。这里可查询权益与任务；仅打开页面不会完成广告或领取成功，完成后请刷新核对。</p>
        <div class="qq-benefits-account"><span>{{ user.profile?.nickname || 'QQ 音乐用户' }}</span><span>{{ user.profile?.isVip ? '会员账号' : '普通账号' }}</span></div>
        <div class="qq-benefits-status" aria-live="polite">
          <p v-if="loading" class="qq-benefits-loading"><RefreshCw :size="16" class="spinning" />正在查询领取资格…</p>
          <template v-else-if="info">
            <div><span>直接赠礼</span><strong>{{ info.canReceiveGift ? '可领取' : '当前暂无可领取赠礼' }}</strong></div>
            <div><span>免广告卡</span><strong>{{ info.freeCards === null ? '官方未返回余额' : `${info.freeCards} 张` }}</strong></div>
            <div v-if="info.activeDays !== null"><span>累计激活</span><strong>{{ info.activeDays }} 天</strong></div>
            <div v-if="info.watchedToday !== null && info.watchedToday !== undefined"><span>活动今日已看广告</span><strong>{{ info.watchedToday }}{{ info.dailyLimit > 0 ? ' / ' + info.dailyLimit : '' }} 条</strong></div>
            <div v-if="info.coinsTotal !== null && info.coinsTotal !== undefined"><span>绿钻活动累计金币</span><strong>{{ info.coinsTotal }}</strong></div>
            <div v-if="expiryLabel"><span>{{ info.adVipActive ? '活动权益到期' : '上次活动权益到期' }}</span><strong>{{ expiryLabel }}</strong></div>
          </template>
        </div>
        <p v-if="error" role="alert" class="qq-benefits-result error">{{ error }}</p>
        <p v-for="issue in issues" :key="issue" class="qq-benefits-result error" role="alert">{{ issue }}</p>
        <p v-if="result" role="status" class="qq-benefits-result"><CheckCircle2 v-if="result.status === 'activated'" :size="18" />{{ result.message }}</p>
        <p v-if="membershipWarning" class="qq-benefits-note">{{ membershipWarning }}</p>
        <button class="qq-benefits-claim" :disabled="busy || !info || giftSubmitted" @click="claim('launch-gift')">
          <RefreshCw v-if="claiming" :size="17" class="spinning" />{{ claiming ? '正在领取并核对权益…' : result?.status === 'activated' ? '已确认到账' : result ? '已提交，待核实' : info?.canReceiveGift ? '领取可用启动赠礼' : '尝试领取启动赠礼' }}
        </button>
        <button v-if="info?.freeCards > 0" class="qq-benefits-card" :disabled="busy || giftSubmitted" @click="claim('use-card')">使用 1 张免广告卡（消耗已有卡片）</button>
        <button class="qq-benefits-refresh" :disabled="busy" @click="refresh"><RefreshCw :size="14" />刷新领取资格</button>
        <p class="qq-benefits-note">未开放赠礼时会如实显示。免广告卡仅在你点击使用后消耗；活动权益与付费会员可能不同。</p>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.qq-benefits-overlay{position:fixed;inset:0;z-index:11000;background:#10141888;backdrop-filter:blur(10px);display:grid;place-items:center;padding:24px}.qq-benefits-modal{position:relative;width:min(430px,100%);max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;padding:32px;border-radius:24px;background:var(--bg-color,#fff);color:var(--text-main,#222);box-shadow:0 30px 100px #0004;border:1px solid var(--border-color,#ddd)}button{font:inherit;color:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--text-main,#333);outline-offset:3px}.qq-benefits-close{position:absolute;top:16px;right:16px;border:0;background:transparent;padding:7px}.qq-benefits-symbol{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:#c4f7de;color:#124e37;margin-bottom:24px}.qq-benefits-kicker{font-size:12px;letter-spacing:1px;color:var(--text-secondary,#666);margin:0 0 9px}h2{margin:0;font-size:28px}.qq-benefits-description{font-size:14px;line-height:1.8;color:var(--text-secondary,#666);margin:15px 0 20px}.qq-benefits-account{display:flex;justify-content:space-between;gap:12px;padding:15px 0;border-top:1px solid var(--border-color,#ddd);font-size:13px}.qq-benefits-account span:last-child{color:var(--text-secondary,#666)}.qq-benefits-status{background:var(--bg-secondary,#8881);border-radius:12px;padding:12px;font-size:12px}.qq-benefits-status>div{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:5px 0}.qq-benefits-status span{color:var(--text-secondary,#666)}.qq-benefits-status strong{font-weight:550;text-align:right}.qq-benefits-loading,.qq-benefits-result{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.7}.qq-benefits-loading{margin:0}.qq-benefits-result.error{color:var(--error-color,#d95d63)}.qq-benefits-claim{width:100%;min-height:46px;display:flex;justify-content:center;align-items:center;gap:9px;border:0;border-radius:12px;background:#c4f7de;color:#124e37;font-size:14px;font-weight:650;margin-top:18px}.qq-benefits-card{width:100%;min-height:40px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:transparent;font-size:12px;margin-top:10px}.qq-benefits-refresh{display:flex;align-items:center;gap:7px;margin:14px auto 0;border:0;background:transparent;font-size:12px}.qq-benefits-note{font-size:12px;line-height:1.7;color:var(--text-secondary,#666);margin:18px 0 0}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:420px){.qq-benefits-modal{padding:24px}.qq-benefits-status>div{gap:8px}}
</style>
<style scoped>
.qq-benefits-modal{width:min(540px,100%);background:linear-gradient(150deg,color-mix(in srgb,#00d7a0 10%,var(--bg-main,#fff)),var(--bg-main,#fff) 65%)}.qq-benefits-kicker{padding-right:20px;margin-bottom:22px}.qq-free-listen-time{font-size:clamp(34px,6vw,53px);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-2px;line-height:1.15}.qq-free-listen-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:15px 0}.qq-free-listen-heading h2{font-size:25px;letter-spacing:-.8px}.qq-free-listen-heading em{font-style:normal;color:#00b987}.qq-activity-add{display:flex;align-items:center;gap:7px;background:#00e3a6;border:0;border-radius:99px;padding:10px 14px;font-size:12px;font-weight:650;color:#073d2f}.qq-free-switch{display:flex;justify-content:space-between;gap:12px;margin:0 0 20px;font-size:12px;color:var(--text-secondary)}.qq-free-switch span{font-size:11px}.qq-reward-task{padding:18px 16px;background:var(--bg-main,#fff);border:1px solid var(--border-color);border-radius:16px;display:flex;align-items:center;gap:15px}.qq-task-icon{display:grid;place-items:center;width:48px;height:48px;flex-shrink:0;border-radius:14px;background:#c2fbe0;color:#164e36}.qq-reward-task h3{font-size:18px;margin:0 0 7px}.qq-reward-task p{font-size:11px;color:var(--text-secondary);line-height:1.7;margin:0}.qq-official-activity-buttons{display:grid;gap:10px;margin-top:16px}.qq-official-activity-buttons button{display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--border-color);background:transparent;padding:12px;border-radius:12px;font-size:12px}.qq-official-activity-buttons .qq-activity-client{background:#00e3a6;border-color:transparent;color:#073d2f;font-size:13px;font-weight:650}.qq-task-progress{display:grid;gap:12px;padding:15px 0 0}.qq-task-progress>div{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:12px}.qq-task-progress strong{font-weight:500}.qq-task-progress progress{grid-column:1/-1;width:100%;height:5px;accent-color:#00ba86}.qq-benefits-status{margin-top:0}.qq-benefits-account{margin-top:20px}.qq-benefits-description{margin-bottom:12px}
</style>
