// Node.js 新 API polyfill for Electron 22 内置 Node 16
// @sansenjian/qq-music-api 使用了多个 Node 18+/20.11+/22.13+ 才有的 API,
// Electron 22 内置 Node 16 缺失这些 API 会导致子进程崩溃或接口 500。
// 本文件通过 NODE_OPTIONS=--require 预加载,给以下 API 打 polyfill:
//   - util.styleText (Node 22.13+)  日志着色,不影响功能
//   - Array.prototype.toReversed     (Node 20.11+) koa 路由层用到,缺失会 500
//   - Array.prototype.toSorted       (Node 20.11+) 同上,预防性补全
//   - Array.prototype.toSpliced      (Node 20.11+) 同上,预防性补全
//   - Array.prototype.with           (Node 20.11+) 同上,预防性补全
// 用法:spawn(node, [app.cjs], { env: { NODE_OPTIONS: '--require=<本文件路径>' } })
(function () {
    try {
        // 1. util.styleText:忽略颜色,直接返回文本
        const util = require('node:util')
        if (typeof util.styleText !== 'function') {
            util.styleText = function (color, text) { return String(text) }
        }
    } catch (e) { /* ignore */ }

    try {
        // 2. Array.prototype.toReversed:返回反转后的新数组(不修改原数组)
        if (typeof Array.prototype.toReversed !== 'function') {
            Array.prototype.toReversed = function () {
                return this.slice().reverse()
            }
        }
        // 3. Array.prototype.toSorted:返回排序后的新数组(不修改原数组)
        if (typeof Array.prototype.toSorted !== 'function') {
            Array.prototype.toSorted = function (compareFn) {
                return this.slice().sort(compareFn)
            }
        }
        // 4. Array.prototype.toSpliced:返回删除/插入后的新数组(不修改原数组)
        if (typeof Array.prototype.toSpliced !== 'function') {
            Array.prototype.toSpliced = function (start, deleteCount, ...items) {
                const arr = this.slice()
                arr.splice(start, deleteCount, ...items)
                return arr
            }
        }
        // 5. Array.prototype.with:返回替换指定索引后的新数组(不修改原数组)
        if (typeof Array.prototype.with !== 'function') {
            Array.prototype.with = function (index, value) {
                const arr = this.slice()
                arr[index] = value
                return arr
            }
        }
    } catch (e) { /* ignore */ }
})()
