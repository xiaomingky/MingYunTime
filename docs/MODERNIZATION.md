# Windows 10 / 11 现代化优化验证

版本：4.0.0-beta.2，开发分支 `codex/win10-modernization`。测试日期：2026-10-12。当前为本地测试包，未发布 GitHub Release。

## beta.2 播放与功能复查

- 修复本地音频送入 Web Audio 后被 Chromium CORS 保护置零的回退：本地文件同样使用 anonymous 跨域加载，协议响应允许 CORS。之前的静音 WAV 仅验证进度推进，未覆盖音频信号；已用 440 Hz 有声 WAV 重现修复前 RMS=0、修复后 RMS≈0.17–0.18。
- 音频输出设备在 AudioContext 上切换，失效设备回退默认输出。验证暂停/继续、音量放大、EQ 开关、音频重建、默认设备、失效设备、后台恢复、导入文件，以及 WAV/MP3/FLAC 非零音频信号。测试 WebContents 静音避免自动播放测试音打扰，不代表进行了人耳/扬声器回环验收。
- 恢复经典/Apple 详情页上滑展开、下滑收起。检查动画中间位置与结束状态，结束后 transform=none，尊重关闭动画设置。
- 新增 `npm run check:electron`：需先构建 dist；使用独立测试数据，检查 174 个原生请求通道、40 个业务路由、真实文件导入/时长、歌曲更多菜单入队、本地格式转换/歌词入口、桌面歌词窗口开关。移除无调用方且没有处理器的旧 B站总结 API 声明。
- QQ 原有桌面搜索上游 500 时，歌曲/专辑使用公开搜索备用接口；真实查询返回 3 条歌曲和 3 张专辑。歌手/歌单/MV 搜索保留原路径，不把其他类型当歌曲返回。
- 影视默认源返回空内容时尝试备用源并同步前端线路，避免空白首页；真实备用源返回 20 项。
- 联网只读验证：网易云 banner/search、QQ 推荐和热搜、酷狗热搜、B站首页、B站动漫、教材目录（3565 项）、CS 比赛列表返回数据。QQ 热搜上游有间歇性 500；酷狗游客搜索即使附加 dfid 仍返回参数错误/空结果，账号登录后的搜索、会员播放与写操作待真实账号验收。未自动收藏、投币、发表评论或修改账号内容。
- MP4/HLS/FLV 播放/关闭、HTTP 下载完整性、1 万首队列与原有逻辑回归复测通过。
- 斗鱼：针对 `Client network socket disconnected before secure TLS connection was established`，Node 请求采用 IPv4 / TLS 1.2 最低版本，连接中断时尝试 Electron Chromium 网络栈并有界重试；证书校验保持开启，解析总超时 60 秒。规范真实房间号和字符串开播状态；主 CDN 失败尝试其他线路，画质采用接口返回码率，并透传直播标识。
- 补齐斗鱼 `.cn` 和 `edgesrv.com` 的播放/下载来源头。真实房间 9999、6011317 分别解析出 8、4 条流；实际播放 `.douyucdn2.cn` 与 `.edgesrv.com` 线路，画面就绪、播放时间超过 3 秒，关闭后节点移除、暂停、src 释放。此为短时验证，不代表直播长期稳定性或用户特定网络已验收。模拟用户提供的 TLS 错误、证书错误、取消、三次重试上限、未开播/录像/版权错误也通过回归。

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

下列性能数字来自 beta.1 的首次现代化对比，beta.2 的播放修复后没有重新采样，不将这些数字当作 beta.2 的新测量结果。

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

4.0.0-beta.2 preserves the existing Vue/Electron application and targets Windows 10/11 x64. Regression checks cover backend lifecycle, streaming ranges, cover deduplication, long queues, lyrics, downloads and the prior Douyin/motion fixes. Isolated Electron tests exercise 40 routes, 174 native request handlers, non-zero WAV/MP3/FLAC audio signals, output-device recovery, classic/Apple panel transitions, hidden-window recovery, MP4/HLS/FLV playback and cleanup, and HTTP download integrity. Douyu parsing now retries transient TLS failures with a Chromium-network fallback, retains certificate verification, and handles current CDN domains and actual quality rates. Two public rooms were parsed and played briefly, including a .cn CDN and an edgesrv.com backup. QQ song/album searches have a public fallback; empty movie home sources switch to a usable source. QQ hotkeys remain intermittently unavailable, and Kugou guest searches still require investigation/account validation. Beta.1 initial settings JavaScript decreased by 73.4% and renderer JS heap by 26.1% in a controlled setup; these figures were not remeasured for beta.2. Full-process memory, CPU, integrated-GPU frame rate, Windows 10 hardware, logged-in provider actions and every external parser were not exhaustively measured. Startup timing showed no consistent win. Beta artifacts are local; no GitHub release was published.
