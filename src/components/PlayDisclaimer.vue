<script setup>
// 播放前免责声明弹窗（动漫/影视共用）
import { Play, X, TriangleAlert } from 'lucide-vue-next'

defineProps({
    title: { type: String, default: '' },
    cover: { type: String, default: '' },
    type: { type: String, default: '影视' } // 影视 | 动漫
})
const emit = defineEmits(['start', 'close'])
</script>

<template>
    <div class="disclaimer-overlay">
        <!-- 极简白色卡片 (自适应防溢出) -->
        <div class="disclaimer-card">
            <!-- 关闭按钮 -->
            <button class="disclaimer-close" @click="emit('close')" title="返回">
                <X :size="20" />
            </button>

            <div class="disclaimer-content">
                <!-- 红色三角感叹号 -->
                <div class="disclaimer-icon-wrapper">
                    <TriangleAlert :size="64" class="disclaimer-main-icon" />
                </div>

                <!-- 标题 -->
                <div class="disclaimer-title-box">
                    <h2>观看提示</h2>
                    <p v-if="title" class="disclaimer-subtitle">{{ type }} · {{ title }}</p>
                </div>

                <!-- 核心文字提示（单行展示，自适应换行） -->
                <div class="disclaimer-text">
                    <p>资源来源于第三方网站，播放过程中可能包含违规广告</p>
                    <p class="highlight">请勿相信，请勿点击，请勿参与！</p>
                    <p>切勿扫描二维码、下载陌生APP或进行转账，谨防诈骗</p>
                </div>

                <!-- 底部按钮 -->
                <div class="disclaimer-footer">
                    <button class="disclaimer-start-btn" @click="emit('start')">
                        <Play :size="16" fill="currentColor" />
                        我已了解，开始播放
                    </button>
                </div>
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
}

/* 铺满整个播放器 */
.disclaimer-card {
    position: relative;
    z-index: 2;
    background: #ffffff;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: disclaimer-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 完全自适应内部撑开，不滚动 */
.disclaimer-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px;
    min-height: 0; /* 允许 flex 子项收缩防溢出 */
}

@keyframes disclaimer-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

/* 关闭按钮 */
.disclaimer-close {
    position: absolute;
    top: 16px; 
    right: 16px;
    width: 36px; 
    height: 36px;
    border: none;
    border-radius: 50%;
    background: #f5f5f5;
    color: #999;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 10;
}

.disclaimer-close:hover {
    background: #fee;
    color: #e53935;
    transform: rotate(90deg);
}

/* 大图标（红色） */
.disclaimer-icon-wrapper {
    margin-bottom: min(20px, 4%);
    flex-shrink: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.disclaimer-main-icon {
    color: #e53935;
    width: auto;
    height: auto;
    max-height: 60px; /* 防止过大 */
}

/* 标题 */
.disclaimer-title-box {
    margin-bottom: min(24px, 5%);
    flex-shrink: 1;
}
.disclaimer-title-box h2 {
    margin: 0 0 4px;
    font-size: clamp(18px, 4vw, 22px);
    color: #333;
    font-weight: bold;
}
.disclaimer-subtitle {
    margin: 0;
    font-size: clamp(12px, 2.5vw, 13px);
    color: #888;
}

/* 核心文字 */
.disclaimer-text {
    font-size: clamp(12px, 2.5vw, 14px);
    color: #555;
    line-height: 1.5;
    margin-bottom: min(32px, 6%);
    width: 100%;
    flex-shrink: 1;
}
.disclaimer-text p {
    margin: 0 0 6px;
}
.disclaimer-text p:last-child {
    margin-bottom: 0;
}
.disclaimer-text .highlight {
    color: #e53935;
    font-weight: bold;
    font-size: clamp(13px, 2.8vw, 15px);
    background: rgba(229, 57, 53, 0.08);
    display: inline-block;
    padding: 4px 12px;
    border-radius: 6px;
    margin: 4px 0;
}

/* 开始按钮 */
.disclaimer-footer {
    flex-shrink: 0;
    width: 100%;
    max-width: 280px;
}
.disclaimer-start-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 0;
    border: none;
    border-radius: 24px;
    background: linear-gradient(135deg, #ff9800, #ff5722);
    color: #fff;
    font-size: clamp(14px, 3vw, 15px);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 6px 16px rgba(255, 87, 34, 0.3);
}

.disclaimer-start-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(255, 87, 34, 0.4);
}
.disclaimer-start-btn:active {
    transform: translateY(0);
}
</style>
