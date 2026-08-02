// util.styleText polyfill for Node.js < 22.13
// @sansenjian/qq-music-api 在 services.cjs / server-*.cjs 中调用 node_util.styleText,
// 该 API 仅 Node.js 22.13+ 支持。Electron 22 内置 Node 16 缺失此 API 会导致子进程崩溃。
// 本文件通过 NODE_OPTIONS=--require 预加载,给 util.styleText 打 polyfill。
// 用法:spawn(node, [app.cjs], { env: { NODE_OPTIONS: '--require=<本文件路径>' } })
(function () {
    try {
        const util = require('node:util')
        if (typeof util.styleText === 'function') return
        // 简化实现:忽略颜色,直接返回文本(子进程日志输出用,不影响功能)
        util.styleText = function (color, text) {
            return String(text)
        }
    } catch (e) {
        // ignore
    }
})()
