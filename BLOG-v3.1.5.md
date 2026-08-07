# 茗韵时光 v3.1.5 发布：修复所有删除操作无响应

> 版本：v3.1.5 | 发布日期：2026-08-07
> 项目地址：[github.com/xiaomingky/MingYunTime](https://github.com/xiaomingky/MingYunTime)

---

## 问题描述

v3.1.4 版本中，**所有删除相关操作**（包括但不限于以下场景）点击后无任何响应：

- 本地音乐：移除歌曲、批量移除
- 网易云云盘：删除歌曲、取消匹配
- 歌单管理：删除歌单、批量移除歌曲
- 歌曲详情：删除评论
- 最近播放：清空记录
- 本地视频：移除链接、移除视频
- B 站：退出登录

点击删除按钮后，既没有弹出确认弹窗，也没有执行删除操作，界面完全无反应。

---

## 根因分析

项目使用 `messageStore.confirm()` 实现全局确认弹窗机制。调用方执行 `await messageStore.confirm(message, title)` 后会挂起等待用户确认。

然而在 [App.vue](https://github.com/xiaomingky/MingYunTime/blob/main/src/App.vue) 中，全局 `<ConfirmModal />` 组件**没有绑定任何 props 和事件**：

```vue
<!-- 修复前：空组件，永远不会显示 -->
<ConfirmModal />
```

`messageStore.confirmState` 的 `show`、`title`、`message` 属性从未传递给组件，`confirm` / `cancel` 事件也从未绑定。导致：

1. `confirmState.show` 被设为 `true`，但组件的 `visible` prop 始终是默认值 `false`
2. 弹窗永远不显示
3. Promise 的 `resolve` 函数永远不被调用
4. `await` 永远挂起，后续删除逻辑不执行

---

## 修复方案

将全局 ConfirmModal 绑定到 `messageStore.confirmState`：

```vue
<!-- 修复后：正确绑定状态和事件 -->
<ConfirmModal
    :visible="messageStore.confirmState.show"
    :title="messageStore.confirmState.title"
    :message="messageStore.confirmState.message"
    @confirm="messageStore.closeConfirm(true)"
    @cancel="messageStore.closeConfirm(false)"
/>
```

**改动文件：** 仅 [src/App.vue](https://github.com/xiaomingky/MingYunTime/blob/main/src/App.vue) 一处

**影响范围：** 所有使用 `messageStore.confirm()` 的 12 处调用全部恢复正常

---

## 受影响功能清单

| 组件 | 功能 |
|------|------|
| LocalMusic.vue | 移除歌曲、批量移除 |
| NetEaseCloud.vue | 删除云盘歌曲、取消匹配 |
| PlaylistDetail.vue | 批量移除歌曲、删除歌单 |
| SongDetail.vue | 删除评论 |
| RecentPlay.vue | 清空播放记录 |
| LocalVideo.vue | 移除链接、移除视频、退出 B 站登录 |

---

## 版本变更

- `package.json`：3.1.4 → 3.1.5
- `CHANGELOG.md`：新增 v3.1.5 条目
- `BLOG.md`：版本号同步更新

---

## 下载

[下载茗韵时光 v3.1.5](https://github.com/xiaomingky/MingYunTime/releases/tag/v3.1.5)

---

*茗韵时光 — 三平台音乐聚合桌面播放器*
