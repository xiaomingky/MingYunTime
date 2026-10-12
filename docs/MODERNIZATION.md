# Windows 10 / 11 现代化优化验证

版本：4.0.0-beta.1，开发分支 `codex/win10-modernization`。测试日期：2026-10-12。当前为本地测试包，未发布 GitHub Release。

## 运行环境

- Electron 44.7.0 / Chromium 152.0.7977.130 / Node 24.21.0。
- electron-builder 26.15.3，原生 NSIS 向导和 x64 免安装包。
- 支持目标：Windows 10 / 11 x64，安装向导检查最低系统；放弃 Windows 7 / 8 / 8.1。
- 实际测试宿主：Windows 11（10.0.26100）。没有在真实 Windows 10 核显机器进行帧率、整进程内存或耗电测试，因此不保证所有显卡均达到固定 FPS。

## 实现与功能保留

- 保留 Vue / Pinia / Electron 架构、三平台账号隔离和所有原有路由入口；音乐、视频、赛事、教材等功能继续使用原有业务实现。
- 原有同步加载页面改为按需加载，歌词详情、登录和视频弹层异步加载；切页提供细进度反馈与错误提示。
- 队列只绘制可见行；保持重复歌曲的独立 ID、当前曲目和绝对排序索引。拖动、上下按钮、Alt + 上下键、边缘滚动和当前歌曲定位可以一起使用。
- 播放状态按改动字段保存；补齐原地入队/移除/排序持久化。播放位置变化不再重新序列化整个队列。
- 三个平台 API 首次实际请求启动，等待就绪、并发共用启动过程，退出取消挂起启动；只关闭自己创建的子进程。自有后端空闲三分钟释放，后续请求重新启动。
- 存活探测使用本地根路径，不再定期请求上游热搜。日志异步批量落盘，限制队列和文件大小。网易云已选在线线路不会被后台探测覆盖。
- 后端依赖优先从自身资源读取；嵌套依赖打包为 libs，避免 Express 等加载桌面项目不同版本依赖。
- 本地文件协议使用 protocol.handle、异步文件句柄和流读取；支持完整/开放/封闭/尾部 Range、HEAD、404、416、空文件及取消关闭句柄。
- 封面解析请求合并，真 LRU 缓存最多 8 项且最多 32 MiB，校验源文件修改时间；目录图、GIF 和内置图兜底保留。
- 经典歌词二分查找当前行，缓存逐字节点；向后 seek 时重算高亮。频谱按时间限制 30 FPS，改 scaleY 避免逐帧 height 布局，Apple 频谱复用渐变。
- 设置「显示与流畅度」增加轻盈流畅 / 完整视觉，轻量模式保留过渡与逐字歌词，减少模糊与高 DPI 频谱；Apple 歌词支持 30/45/60 FPS。
- 关闭视频释放 Artplayer、HLS/FLV、DASH 音频、同步定时器；切源使用版本保护。修复未定义 artVol、FLV 下载完成被当成播放结束。
- 下载自适应 1–16 路、HLS 分片最多 12 路、连接池有界。写盘遵守背压，取消可中止流；检查分片范围与长度，重试前等待写流关闭并校正断点，避免大文件占满内存或拼出损坏文件。

## 可重复检查

`npm run check` 执行：

1. 服务同时 30 次首请求只启动一次，崩溃后按请求恢复、退出不重启、复用进程不被误杀、空闲释放后能重新启动。
2. 本地协议完整/部分/尾部读取、HEAD、坏路径、404、416；20 个封面并发请求合并。
3. 当前队列排序身份、重复项、下一首、移除、随机池/上一首历史、单/双击；1 万首队列窗口数量、分区唯一键；歌词重复时间、空歌词、前后时间和零时长词。
4. 实际 HTTP 流和 Range 下载逐字节一致，5 MiB 文件两路下载；写盘背压；拒绝位置不匹配的 Content-Range，防止静默拼出损坏文件。
5. 原有 Apple 歌词、抖音视频/图集/分享文案/作品过滤、CDP 并发响应与清理、Windows 动画设置回归。

隔离 Electron 图形测试另外验证：12 个页面入口、设置方案、1 万首队列实际约 20 个 DOM 行、当前曲目排序身份、排序保存；本地 WAV 起播无需改音量；窗口隐藏后持续播放、返回恢复；经典/Apple 详情加载；MP4/HLS/FLV 播放进度推进、关闭后 video 暂停、节点移除、src 释放；实际 HTTP 下载并比对文件完整性。三平台资源后端在新的 Node 运行时与打包资源中启动通过。

在线账号写入、会员资源、直播长期运行、所有第三方解析站、全部设备驱动未进行穷举验证。UI 路由测试隔离联网，不能据此宣称所有上游接口均正常。抖音已运行结构化和浏览器备用解析回归；本轮没有重新验证所有真实分享链接。

## 启动对比

相同电脑、相同 1440×900 隐藏窗口、同一设置路由、独立用户数据、预加载桥接与模拟原生 IPC、本地 HTTP 静态资源、阻止外部网络、每版三次。比较 v3.6.3 Electron 22 与当前 Electron 44。没有把脚本堆内存等同于整个程序占用。

| 指标 | 旧版 | 当前 | 说明 |
| --- | ---: | ---: | --- |
| 设置首屏实际加载 JS | 1,720,513 字节 | 458,356 字节 | 减少 73.4% |
| 渲染 JS 堆中位数 | 12.24 MiB | 9.04 MiB | 减少 26.1%；不是整进程内存 |
| 页面可操作中位时间 | 368.4 ms | 379.3 ms | 本轮无稳定提升，受缓存和并行打包负载影响，不对启动秒数做承诺 |

Electron 新版运行时更大，所以安装包体积增加；界面首屏 JS 变小不代表安装包一定变小。下一步机器验收建议在 Win10 核显上比较切页、歌词、拖队列和同时下载的实际掉帧情况。

## 使用

解压本地 beta 的 `.7z` 到独立目录，再运行「茗韵时光.exe」。安装包仍保留原有应用 ID 和升级目录；正式升级前可先使用免安装包体验。版本为 beta，不替换已发布 v3.6.3 链接。

设置 → 显示与流畅度 → 轻盈流畅，适合核显；完整视觉保留装饰模糊。页面导航、设置卡片和播放队列已整理，其余业务页面保持原有功能入口。

## English validation note

4.0.0-beta.1 preserves the existing Vue/Electron application and targets Windows 10/11 x64. Regression checks cover backend lifecycle, streaming ranges, cover deduplication, long queues, lyrics, downloads and the prior Douyin/motion fixes. Isolated Electron tests exercise page mounting, real local audio, hidden-window recovery, MP4/HLS/FLV playback and cleanup, and HTTP download integrity. Initial settings JavaScript decreases by 73.4% and renderer JS heap by 26.1% in this controlled setup. Full-process memory, CPU, integrated-GPU frame rate, Windows 10 hardware, logged-in provider actions and every external parser were not exhaustively measured. Startup timing shows no consistent win in the last run. Beta artifacts are local; no GitHub release was published.
