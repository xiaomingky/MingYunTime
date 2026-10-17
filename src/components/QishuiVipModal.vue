<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { X, Gift, CheckCircle2, RefreshCw } from 'lucide-vue-next'
import { useQishuiUserStore } from '../store/qishui-user'
const emit = defineEmits(['close'])
const user = useQishuiUserStore(), close = ref(null)
const escape = e => { if (e.key === 'Escape') { e.stopPropagation(); emit('close') } }
onMounted(() => { document.addEventListener('keydown', escape, true); close.value?.focus() })
onBeforeUnmount(() => document.removeEventListener('keydown', escape, true))
watch(() => user.revision, () => emit('close'))
</script>
<template>
  <Teleport to="body"><div class="soda-vip-overlay" @click.self="emit('close')">
    <section class="soda-vip-modal" role="dialog" aria-modal="true" aria-labelledby="soda-vip-title">
      <button ref="close" class="soda-vip-close" aria-label="关闭" @click="emit('close')"><X :size="20" /></button>
      <div class="soda-vip-symbol"><Gift :size="28" /></div>
      <p class="soda-vip-kicker">汽水音乐 · 会员福利</p>
      <h2 id="soda-vip-title">领取免费 VIP</h2>
      <p class="soda-vip-description">使用当前汽水账号领取官方免费会员。可领时长、活动次数与资格由汽水音乐决定。</p>
      <div class="soda-vip-account"><span>{{ user.profile?.nickname }}</span><span>{{ user.profile?.isVip ? '当前已开通会员' : '普通用户' }}</span></div>
      <p v-if="user.vipClaimError" role="alert" class="soda-vip-result error">{{ user.vipClaimError }}</p>
      <p v-else-if="user.vipClaimResult" role="status" class="soda-vip-result"><CheckCircle2 v-if="['received','already_received'].includes(user.vipClaimResult.status)" :size="19" />{{ user.vipClaimResult.message }}</p>
      <button class="soda-vip-claim" :disabled="!user.isLoggedIn || user.vipClaimLoading || ['received','already_received'].includes(user.vipClaimResult?.status)" @click="user.claimFreeVip()">
        <RefreshCw v-if="user.vipClaimLoading" :size="17" class="spinning" />{{ user.vipClaimLoading ? '正在领取…' : user.vipClaimResult?.status === 'received' ? '已领取' : user.vipClaimResult?.status === 'already_received' ? '本次活动已领取' : user.vipClaimError || user.vipClaimResult ? '重新检查领取资格' : '领取免费 VIP' }}
      </button>
      <p class="soda-vip-note">领取后自动刷新会员状态。若提示已领取或活动不可用，请以官方活动规则为准。</p>
    </section>
  </div></Teleport>
</template>
<style scoped>
.soda-vip-overlay{position:fixed;inset:0;z-index:11000;background:#10141888;backdrop-filter:blur(10px);display:grid;place-items:center;padding:24px}.soda-vip-modal{position:relative;width:min(420px,100%);box-sizing:border-box;padding:32px;border-radius:24px;background:var(--bg-color,#fff);color:var(--text-main,#222);box-shadow:0 30px 100px #0004;border:1px solid var(--border-color,#ddd)}.soda-vip-close{position:absolute;top:16px;right:16px;border:0;background:transparent;color:inherit;cursor:pointer;padding:7px}.soda-vip-symbol{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:#d9fd8c;color:#293b0a;margin-bottom:24px}.soda-vip-kicker{font-size:12px;letter-spacing:1px;color:var(--text-secondary,#666);margin:0 0 9px}h2{margin:0;font-size:28px}.soda-vip-description{font-size:14px;line-height:1.8;color:var(--text-secondary,#666);margin:15px 0 24px}.soda-vip-account{display:flex;justify-content:space-between;gap:12px;padding:15px 0;border-top:1px solid var(--border-color,#ddd);font-size:13px}.soda-vip-account span:last-child{color:var(--text-secondary,#666)}.soda-vip-claim{width:100%;min-height:46px;display:flex;justify-content:center;align-items:center;gap:9px;border:0;border-radius:12px;background:#d9fd8c;color:#243508;font-size:14px;font-weight:650;cursor:pointer;margin-top:15px}.soda-vip-claim:disabled{opacity:.6;cursor:default}.soda-vip-note{font-size:12px;line-height:1.7;color:var(--text-secondary,#666);margin:18px 0 0}.soda-vip-result{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.7}.soda-vip-result.error{color:#d95d63}button:focus-visible{outline:2px solid var(--text-main,#333);outline-offset:3px}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
</style>
