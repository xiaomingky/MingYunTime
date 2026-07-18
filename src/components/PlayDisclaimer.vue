<script setup>
// 播放前免责声明弹窗（动漫/影视共用）
import { ShieldAlert, Play, X } from 'lucide-vue-next'

defineProps({
    title: { type: String, default: '' },
    cover: { type: String, default: '' },
    type: { type: String, default: '影视' } // 影视 | 动漫
})
const emit = defineEmits(['start', 'close'])

const tips = [
    {
        icon: '⚠️',
        title: '广告提示',
        content: '资源来源于第三方网站，播放过程中可能包含赌博、色情、博彩等违规广告，请勿相信，请勿点击，请勿参与。'
    },
    {
        icon: '🛡️',
        title: '安全提醒',
        content: '切勿扫描广告二维码、下载陌生 APP、填写个人信息或进行任何转账操作，谨防电信网络诈骗。'
    },
    {
        icon: '🎬',
        title: '播放建议',
        content: '如遇广告请耐心等待或切换播放线路；播放失败可尝试切换集数或刷新重试；画质模糊可手动切换分辨率。'
    },
    {
        icon: '📋',
        title: '版权声明',
        content: '本模块仅作技术学习与交流用途，所有影视内容版权归原权利人所有，请支持正版，勿用于商业用途。'
    },
    {
        icon: '🔞',
        title: '未成年人提示',
        content: '部分影视内容可能不适合未成年人观看，请家长陪同引导；如发现违法违规内容请立即停止观看。'
    }
]
</script>

<template>
    <div class="disclaimer-overlay">
        <!-- 背景海报模糊层 -->
        <div v-if="cover" class="disclaimer-bg" :style="{ backgroundImage: `url(${cover})` }"></div>
        <div class="disclaimer-bg-mask"></div>

        <!-- 关闭按钮 -->
        <button class="disclaimer-close" @click="emit('close')" title="返回">
            <X :size="20" />
        </button>

        <!-- 内容卡片 -->
        <div class="disclaimer-card">
            <!-- 头部 -->
            <div class="disclaimer-header">
                <div class="disclaimer-icon">
                    <ShieldAlert :size="28" />
                </div>
                <div class="disclaimer-title">
                    <h2>观看提示</h2>
                    <p v-if="title" class="disclaimer-subtitle">{{ type }} · {{ title }}</p>
                </div>
            </div>

            <!-- 提示列表 -->
            <div class="disclaimer-tips">
                <div v-for="(tip, idx) in tips" :key="idx" class="disclaimer-tip-item">
                    <span class="tip-icon">{{ tip.icon }}</span>
                    <div class="tip-body">
                        <div class="tip-title">{{ tip.title }}</div>
                        <div class="tip-content">{{ tip.content }}</div>
                    </div>
                </div>
            </div>

            <!-- 底部按钮 -->
            <div class="disclaimer-footer">
                <p class="disclaimer-confirm-text">点击下方按钮即表示您已阅读并知悉上述提示</p>
                <button class="disclaimer-start-btn" @click="emit('start')">
                    <Play :size="18" fill="currentColor" />
                    开始播放
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.disclaimer-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #000;
}

/* 背景海报模糊层 */
.disclaimer-bg {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    filter: blur(20px) brightness(.35);
    transform: scale(1.15);
}
.disclaimer-bg-mask {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(0, 0, 0, .75), rgba(40, 0, 0, .65));
}

/* 关闭按钮 */
.disclaimer-close {
    position: absolute;
    top: 14px; right: 14px;
    width: 36px; height: 36px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, .12);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all .2s;
    backdrop-filter: blur(8px);
    z-index: 2;
}
.disclaimer-close:hover {
    background: rgba(194, 12, 12, .9);
    transform: rotate(90deg);
}

/* 内容卡片 */
.disclaimer-card {
    position: relative;
    z-index: 2;
    width: min(680px, calc(100% - 48px));
    max-height: calc(100% - 48px);
    background: rgba(20, 20, 24, .82);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(255, 255, 255, .08);
    border-radius: 16px;
    padding: 28px 32px;
    color: #fff;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, .6);
    animation: disclaimer-in .4s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes disclaimer-in {
    from { opacity: 0; transform: translateY(20px) scale(.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* 头部 */
.disclaimer-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 18px;
    margin-bottom: 18px;
    border-bottom: 1px solid rgba(255, 255, 255, .08);
}
.disclaimer-icon {
    width: 52px; height: 52px;
    border-radius: 12px;
    background: linear-gradient(135deg, #c20c0c, #ff4d4d);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: 0 6px 20px rgba(194, 12, 12, .4);
    flex-shrink: 0;
}
.disclaimer-title h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 1px;
}
.disclaimer-subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: rgba(255, 255, 255, .6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 520px;
}

/* 提示列表 */
.disclaimer-tips {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 22px;
}
.disclaimer-tip-item {
    display: flex;
    gap: 12px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, .04);
    border-radius: 10px;
    border-left: 3px solid rgba(194, 12, 12, .5);
    transition: all .2s;
}
.disclaimer-tip-item:hover {
    background: rgba(255, 255, 255, .07);
    border-left-color: #c20c0c;
    transform: translateX(2px);
}
.tip-icon {
    font-size: 22px;
    line-height: 1.2;
    flex-shrink: 0;
}
.tip-body { flex: 1; min-width: 0; }
.tip-title {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 4px;
}
.tip-content {
    font-size: 12.5px;
    color: rgba(255, 255, 255, .72);
    line-height: 1.65;
}

/* 底部 */
.disclaimer-footer {
    text-align: center;
    padding-top: 18px;
    border-top: 1px solid rgba(255, 255, 255, .08);
}
.disclaimer-confirm-text {
    font-size: 12px;
    color: rgba(255, 255, 255, .5);
    margin: 0 0 14px;
}
.disclaimer-start-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 36px;
    border: none;
    border-radius: 24px;
    background: linear-gradient(135deg, #c20c0c, #ff4d4d);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all .25s;
    box-shadow: 0 6px 20px rgba(194, 12, 12, .4);
}
.disclaimer-start-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 28px rgba(194, 12, 12, .55);
}
.disclaimer-start-btn:active { transform: translateY(0); }
.disclaimer-start-btn svg { margin-left: 2px; }

/* 滚动条 */
.disclaimer-card::-webkit-scrollbar { width: 6px; }
.disclaimer-card::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, .2);
    border-radius: 3px;
}
.disclaimer-card::-webkit-scrollbar-thumb:hover { background: rgba(194, 12, 12, .6); }

/* 响应式 */
@media (max-width: 640px) {
    .disclaimer-card { padding: 20px; }
    .disclaimer-title h2 { font-size: 18px; }
    .tip-content { font-size: 12px; }
    .disclaimer-start-btn { padding: 10px 28px; font-size: 14px; }
}
</style>
