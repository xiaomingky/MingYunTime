// These are server stream identifiers, not advertised subscription tiers.
// hi_res currently delivers AAC as well; never label it lossless/24-bit.
export const QISHUI_QUALITY_LABELS = {
    auto: '自动（优先无损）', medium: '流畅', higher: '标准',
    highest: '高品', hi_res: '高品质 AAC', lossless: '无损 FLAC', spatial: '空间音频'
}
export const qishuiQualityLabel = value => QISHUI_QUALITY_LABELS[value] || '平台音质'
