# 🎵 茗韵时光 — 全能桌面音乐播放器

> 版本：v3.1.5 | 技术栈：Vue 3 + Electron 22 + Vite 5
> 项目地址：[github.com/xiaomingky/MingYunTime](https://github.com/xiaomingky/MingYunTime)
> 下载：[Releases 页面](https://github.com/xiaomingky/MingYunTime/releases)

---

## 写在前面

「茗韵时光」(MingYun Time) 是一款桌面音乐播放器。它不只是一个能放歌的软件——它把**网易云音乐、酷狗概念版、QQ 音乐**三大平台聚合在一个壳子里，又顺手塞进了**动漫观看、影视播放、统一下载中心、B 站视频解析、桌面歌词**等模块，最终成为一台真正意义上的「多媒体娱乐终端」。

本文按功能模块逐一介绍，每个功能都讲清楚它做了什么、怎么实现的、解决什么痛点。

---

## 一、三平台音乐聚合（网易云 / 酷狗 / QQ）

这是整个项目的核心。三大平台 API 均在本地由 Electron 主进程以子进程方式启动：

| 平台 | 端口 | 开源依赖 |
|------|------|----------|
| 网易云音乐 | 3100 | NeteaseCloudMusicApiEnhanced |
| QQ 音乐 | 3200 | qq-music-api |
| 酷狗概念版 | 3300 | KuGouMusicApi |

三平台子进程均带**健康检查 + 异常自动重启 + 端口复用防冲突**，主线路失败时自动回退到在线备用线路，无需用户手动配置。

**平台切换**采用下拉式切换器，顺序为「网易云 → 酷狗概念版 → QQ 音乐」，每个平台都有自己独立的一整套视图（发现 / 搜索 / 歌单 / 歌手 / 专辑 / 我喜欢）、独立主题色（网易云红、酷狗蓝绿 `#2CA2F5`、QQ 绿）、独立用户 Store、独立音质体系与独立搜索历史。最近播放列表与搜索历史均按平台隔离，互不污染。

---

## 二、发现音乐

主页聚合了三大平台的核心入口内容：

- **个性推荐** + **轮播图**（Banner 翻页按钮改为漂浮圆形样式，鼠标移入时才显现，不遮挡内容）
- **推荐歌单**、**最新音乐**、**排行榜**、**热门歌手**

底部 Banner、歌单卡片、新歌速递、排行榜四大金刚按视觉层次铺排，响应式侧边栏可在窄屏下自动折叠。

---

## 三、搜索

支持**多类型搜索**：歌曲、歌手、专辑、视频、歌单五类一次性返回，结果分 Tab 展示。

- **搜索历史**按平台独立记录（网易云 / 酷狗 / QQ 互不干扰）
- **联想词**与**热门词**跟随当前平台动态拉取
- **搜索建议**组件 `SearchSuggest.vue` 根据当前平台调用对应 API（`cloudSearch` / `qqSearch` / `kugouSearch`），并配套各自的归一化函数

酷狗平台搜索还做了专项优化：使用 `/search?type=song|special|author|album` 专用接口，每种类型返回 **30 条**完整结果（不再像旧版那样只返回约 7 条摘要），并去除了 MV 类型。

---

## 四、歌曲详情页（全屏歌词覆盖层）

这是整个播放器视觉密度最高的页面，也是日常停留最久的页面。

### 1. 封面与频谱
- 全屏背景采用封面高斯模糊 + 颜色矩阵调色（PixiJS 滤镜），封面随播放进度微微缩放呼吸
- 实时音频频谱可视化（Web Audio API AnalyserNode）

### 2. 歌词系统
- **Apple 风格逐词歌词**（基于 `@applemusic-like-lyrics` 三件套），YRC 逐词高亮填充
- **逐词 / 逐行**两种模式一键切换
- 歌词切换动画放慢至 **1.2s** 并使用 `cubic-bezier` 自然缓动，营造真实翻页感
- 新增**「高亮行」开关**：可切换高亮行是否放大（等大 / 放大），设置自动保存到本地
- 歌词位置上下微调（**-200px ~ +200px**）

### 3. 多歌词源选择

本地歌曲和在线歌曲都支持**多平台歌词搜索**：从 QQ 音乐、酷狗、网易云三平台各拉取 **30 条**歌词结果并列展示，用户可手动选择最准确的一份。这对小众歌曲、现场版、翻唱版的歌词匹配特别实用。

### 4. 内置字体切换

播放器自带三套字体（云峰飞云体、玄宗体、龚帆免费体），可在歌曲详情页直接切换歌词字体。字体文件随安装包打包，无需联网下载。

### 5. 操作按钮
- 收藏（加入「我喜欢的音乐」）
- 添加到歌单
- 下载（带封面下载，详见下文）
- 分享
- 评论（QQ 音乐 / 酷狗均有独立评论组件）
- MV（本地优先匹配 + 线上自动匹配）

### 6. VIP 标识
VIP 标识统一移到**歌名右侧**，居中对齐。酷狗 VIP 采用蓝绿渐变文字标签（`#2CA2F5` → `#4ad295`），简洁不抢眼。

---

## 五、歌单管理

- **创建、删除、编辑、收藏**歌单
- **添加 / 移除歌曲**、**上传自定义封面**
- 歌单歌曲**双击播放**（批量管理模式下保持单击勾选）
- 酷狗 / QQ 音乐的「创建歌单 / 删除歌单 / 添加歌曲」相关 UI 已根据平台策略裁剪（例如 QQ 平台 `SongDetail.vue` 仅网易云显示「+」按钮）

### 酷狗歌单专项
酷狗歌单做了大量字段适配工作：

- 歌单分「创建」与「收藏」两类，自动折叠（「我喜欢」除外）
- 歌单按**播放量降序 → 添加时间降序**排序
- 歌单详情用 `listid` 调 `/playlist/track/all/new`，遇 `error_code 20010` 时回退到旧 API 用 `global_collection_id`
- 歌单封面 / 标题 / 作者走**三级回退**：本地缓存 → `/playlist/detail` API → 字段别名（`imgurl_min` / `pic_min` / `special_name` / `create_username`）
- 歌单歌曲序号**倒序显示**（从总数到 1）
- 支持**批量取消收藏歌单**（侧栏）与**批量取消喜欢歌曲**（我喜欢页）

---

## 六、本地音乐

支持导入文件 / 文件夹，格式覆盖 **MP3 / FLAC / WAV / OGG / M4A / APE / AAC / WMA / OPUS** 九种。

### 1. 自动匹配在线元数据
- **自动匹配在线封面** → 下载保存为 `歌曲名.jpg` 到歌曲同目录
- **自动匹配在线歌词** → 保存为 `歌曲名.lrc` 到歌曲同目录

这意味着导入一批裸 MP3 后，封面和歌词会自动出现，无需手动补全。

### 2. 元数据编辑
支持编辑标题、歌手、专辑、年份、风格、封面，GIF 与静态封面可切换。

### 3. 下载歌曲自动带封面

下载的每首歌曲都会自动嵌入封面图，保存到本地目录后封面在文件管理器里直接可见。

### 4. MV：本地优先 + 线上自动匹配

歌曲详情页 MV 按钮的匹配策略：
1. **优先匹配本地 MV 文件**（按歌名匹配本地视频库）
2. 本地无 MV 时**自动调用网易云 MV API 按歌名匹配线上 MV**

这样既不浪费本地资源，又能补齐线上 MV 库的丰富度。

---

## 七、最近播放

- 播放历史记录，支持快速播放
- **按当前平台展示**，切换平台即时过滤（本地歌曲所有平台可见）

---

## 八、桌面歌词

独立悬浮窗口，透明背景、始终置顶。

- **锁定模式**：鼠标穿透到下层应用 + 独立解锁按钮（避免锁定后无法解锁的尴尬）
- **字体、颜色、字号可自定义**
- 锁定状态下拖动主窗口时桌面歌词不再闪烁（hover IPC 加了状态缓存，仅在状态变化时才调用 `setIgnoreMouseEvents`，避免每帧重绘）
- 经典白红配色（致敬网易云）

---

## 九、均衡器

- **8 种预设**：默认、流行、古典、摇滚、电子、人声、爵士、低音
- **10 段图示均衡器**，增益范围 **-12dB ~ +12dB**
- 基于 Web Audio API 的 `BiquadFilterNode` 链式实现

---

## 十、视频 & MV

在线视频浏览 + 本地视频管理 + MV 播放三合一。所有视频统一走 **BiliPlayer** 播放器。

### B 站视频解析
- 粘贴 `bilibili.com/video/BVxxx` 或 `b23.tv` 短链，自动调用 B 站 API（view + playurl）解析直链
- **扫码登录提升画质**：B 站二维码扫码登录后请求 DASH 格式（`fnval=16`），可解锁 **4K / 1080P+ / HDR / 杜比视界**
- Cookie 持久化 **30 天**，登录状态栏显示头像 / 昵称 / 大会员
- **DASH 音视频自动合并**：音视频分离流下载时自动用 ffmpeg 流复制合并为有声 mp4（极快）
- **webRequest 注入 Referer**：自动为 B 站 CDN（`bilivideo.com`）和图片 CDN（`hdslb.com`）注入 Referer，解决 403 / 防盗链

---

## 十一、本地视频

本地视频页面分三个 Tab：

### 1. 本地视频
导入文件 / 文件夹，自动扫描元数据（时长、格式、大小）。

### 2. 链接 / 直播流
添加 MP4 / WebM 直链、HLS（m3u8）、FLV 流，直播流自动标记 LIVE。

### 3. 网址解析
粘贴任意影视 / 视频网页地址（含 B 站 URL），自动提取页面中的视频流；支持 mp4 / webm / avi / mkv / mov 等 **21 种**视频格式扩展名，解析结果统一列出供用户选择播放或下载。

---

## 十二、统一下载中心

所有下载任务（**音乐 / 影视 / 动漫 / MV / 视频**）统一归口到「下载」专区集中管理。

### 1. 128 路并发不限速
- 自定义 HTTP Agent（`maxSockets: Infinity`、`keepAlive: true`）+ aria2c 多线程
- `--max-download-limit=0`、`--max-overall-download-limit=0`，满带宽下载

### 2. 零外部依赖
aria2c.exe 与 ffmpeg.exe 打包进安装包（`resources/`），用户无需额外安装任何工具。

### 3. 实时进度
速度 / 进度 / 详情 / 链接复制一应俱全，支持**取消 / 重试 / 移除 / 状态筛选**。

### 4. 历史持久化
下载记录保存到磁盘，**重启不丢失**。

### 5. 自定义下载链接
粘贴 URL 自动获取文件名。

### 6. 流媒体处理
- m3u8 流采用**分片并行下载 + ffmpeg concat 合并**
- B 站 DASH 流**自动合并音视频**

---

## 十三、动漫（樱花动漫）

完整三页架构的动漫观看模块：

### 1. 主页
轮播图 + 分类导航 + 最新 / 热门 / 排行三大列表。

### 2. 推荐页
季度新番 / 评分榜 / 类型筛选 / 个人收藏。

### 3. 详情页
- **多源支持**：默认接入樱花动漫，HTML 卡片解析（`.module-poster-item`），封面优先 `data-original`
- **HLS 播放器**：从播放页 `player_aaaa` JSON 提取 m3u8，hls.js 加载，支持多码率分辨率切换
- **Bangumi 元信息聚合**：标题相似度匹配（Levenshtein 编辑距离，<0.5 自动丢弃），叠加评分 / 简介 / 标签 / 角色 / Staff / 相关推荐
- **播放体验**：60s 缓冲上限、错误自动恢复、多源兜底、下集预加载、播放进度记忆
- **收藏与历史**：本地收藏夹、观看集数记忆、最近观看列表
- **分页搜索**：24 项 / 页，页码居中导航，去重过滤无封面项
- **下载**：详情页提供下载入口，统一接入下载中心

---

## 十四、影视（电影 / 动漫 / 电视剧）

### 1. 主页
神马电影网（smdyu.com，标准 maccms 结构），轮播图 + 8 大分类（动作 / 喜剧 / 爱情 / 科幻 / 悬疑 / 惊悚 / 恐怖 / 剧情）。

### 2. 播放
从播放页 `player_aaaa` JSON 直接提取 m3u8，hls.js 播放。

### 3. 多线路解析
自动识别 `.play-list#playlist_1/2/3...` 多条播放线路，用户可手动切换。

### 4. 搜索
`/vod-search--------------.html?wd=关键词`，分页去重。

### 5. TLS 兼容
已淘汰 `appys.pro` / `czys.tv`（机房 TLS 握手失败），改用国内可达的神马电影网。

### 6. 下载
详情页提供下载入口，统一接入下载中心。

---

## 十五、登录

三大平台均支持多种登录方式：

- **网易云**：手机号、邮箱、二维码、Cookie
- **酷狗**：手机号验证码、二维码、Cookie(Token)
- **QQ 音乐**：uin 参数鉴权

登录后用户信息、歌单自动同步。设置按钮可显示并允许复制 COOKIE，便于调试或迁移。

---

## 十六、我的云音乐

- 后端 Web 管理页面上传本地歌曲，支持**批量上传 + 自动匹配封面 / 歌词**
- 桌面端**双击播放云音乐**，自动接入播放列表与下一首逻辑
- 云音乐**刷新按钮**实时同步后端歌曲

---

## 十七、账号密码锁

- 自建后端可为账号开启密码锁
- 开启后访问「我喜欢的音乐」和自定义歌单**需验证密码**
- 验证状态跨页面保持，退出登录后自动失效
- 用户数据（密码锁、云音乐）按网易云 userId 隔离

这一功能让多人共用电脑时也能保护个人音乐品味隐私。

---

## 十八、后端管理网页

独立部署的网站后台：

- 支持手机号 / 二维码 / 邮箱 / Cookie 登录
- 云音乐上传、密码锁管理、账号同步
- 后端 session 使用 **SQLite 持久化存储**（不再用内存存储）
- Cookie 配置 `secure: true`、`httpOnly: true`、`sameSite: 'lax'`（HTTPS 环境）
- 所有 HTTP 请求带 `credentials: same-origin` 维持会话

桌面端**不显示后端服务器设置**，提示用户通过后端网站操作。

---

## 十九、系统托盘

- 托盘最小化
- 托盘控制（上一曲 / 播放暂停 / 下一曲）
- 快速退出

---

## 二十、NCM API 代理规范

三大平台的 API 代理都遵循统一规范：

- POST 请求使用 **form-urlencoded** 格式传参
- 包含浏览器级 Headers：`User-Agent`、`Referer: https://music.163.com/`、`X-Real-IP`、`X-Forwarded-For`
- **原状态码透传**（4xx / 5xx 原样返回，不统一包装成 502）

---

## 二十一、酷狗专项适配

酷狗概念版是三个平台里适配工作量最大的，整理如下：

### 1. 鉴权
- API 请求通过 `cookie` query 参数携带鉴权信息（`token=xxx;userid=xxx;dfid=xxx`），不再拆成多个 query 参数
- `album_audio_id` 用于歌曲唯一标识（不用 `audio_id` 作回退，也不用 `songid` 作 `mixsongid` 回退）

### 2. 字段归一化
- 优先使用 PascalCase 字段：`SongName` / `SingerName` / `FileHash` / `Image` / `Duration` / `MixSongID`
- 歌名归一化时拆分「歌手 - 歌名」格式（无论原字段名是什么）
- hash 匹配用 `album_audio_id` 确保歌曲对应正确

### 3. VIP 判定
从 `busi_vip` 数组中找 `busi_type: "concept"` 且 `is_vip: 1` 的项判定 VIP（顶层 `is_vip: 0` 不可靠）。

### 4. 头像
使用 `pic` / `k_pic` / `fx_pic` 字段（用户中心响应）。

### 5. 歌单
- 用户歌单从 `data.info` 数组解析（不是 `data.list`）
- 歌单分类用 `type: "collect"`（不是 `"special"`）
- 「我喜欢」歌单用 `listid` 调 `/playlist/track/all/new`，推荐歌单用 `global_collection_id` 调 `/playlist/track/all`
- 歌单分页用 `pagesize=300`（API 最大值），自动多页加载
- 歌单元数据归一化为标准字段 `id` / `name` / `coverImgUrl` / `songCount`

### 6. 「我喜欢」
- 在线同步 hash 列表，用 hash 判定喜欢状态
- 取消收藏复用 `removeSongFromPlaylist`，从歌单拉取完整数据补全数字 ID
- 删除歌单歌曲时 `fileid` 优先用 `album_audio_id` 数字字段，回退到 hash

### 7. VIP 领取
新增「领取 VIP」入口：用户菜单可打开弹窗，支持
- 领取今天一天 VIP
- 领取 3 小时时长（每天最多 8 次）
- 升级畅听 VIP

并展示当前 VIP 状态与当月已领取天数。

### 8. 评论
酷狗评论整合了歌曲（`mixsongid`，从 `/audio` API 取，不从 `/privilege/lite` 取）、歌单（`global_collection_id`）、专辑（`album_id`）三类入口，使用 `KugouComment` 组件，支持头像、昵称、定位、回复引用、图片展示、点赞数、回复数与分页。

### 9. 音质
7 档真实音质：标准 / 高品 / 无损 / Hi-Res / 蝰蛇全景声 / 蝰蛇清澈 / 超品，音质独立存储（`kugou_music_quality`）。

### 10. 播放失败处理
歌曲播放失败时**停止播放**（不跳下一首），并详细记录 `/song/url` 请求参数（hash、quality、album_id、album_audio_id）与响应详情便于排查。若带 `album_audio_id` 失败，会自动重试不带该参数的请求。

### 11. 本地部署
酷狗 API 本地部署使用**独立 node_modules**，避免 `path-to-regexp` 版本冲突。

---

## 二十二、QQ 音乐专项适配

### 1. 音质
独立音质菜单（128 / 320 / m4a / flac），移除不可用的 ape / master / atmos。

### 2. 评论
QQ 音乐评论使用 `fcg_global_comment_h5.fcg` 接口，songid 由 songmid 通过 `music.pf_song_detail_svr.get_song_detail` 模块（在 `musicu.fcg` 中）转换得到。

### 3. 歌单管理
QQ 音乐的「创建歌单 / 删除歌单 / 添加歌曲」功能已**完全移除**，`SongDetail.vue` 中的「+」按钮仅对网易云平台显示。

### 4. 「我喜欢」
使用在线 API（`qqUserLikedSongs`），歌单显示在下方；在线「我喜欢」状态同步到本地缓存（`qq_liked_songs`）。

---

## 二十三、网易云专项适配

### 1. API 线路
v3.0.3 起，网易云 API 主线路从在线服务（`api.xiaomingky.cn`）切换为**本地自部署 NeteaseCloudMusicApiEnhanced**，在线 API 降级为备用线路。启动时自动检测本地服务可用性，不可用时回退到在线备用。

### 2. 音质
6 档真实音质（移除了实测均映射成 `jyeffect` 的 `jymaster` / `sky` / `dolby`），音质独立 localStorage 存储。

### 3. API 线路选择器
仅在网易云平台激活时显示（酷狗 / QQ 平台隐藏）。

### 4. 官方云盘
「我的音乐」中的官方云盘**仅网易云平台显示**，酷狗 / QQ 平台隐藏。

---

## 二十四、界面与交互

- **简洁现代设计**：响应式侧边栏、流畅动画、毛玻璃效果
- **背景随封面**：详情页背景跟随当前播放封面色调变化
- **纯白背景模式**：可切换为纯白背景以适应明亮环境
- **平台主题色**：网易云红、酷狗蓝绿、QQ 绿，三套 CSS 变量随平台切换
- **双击播放**：酷狗 / QQ 音乐所有歌曲列表改为双击播放（搜索、歌单、专辑、歌手、我喜欢页；批量管理模式保持单击勾选）
- **统一弹窗与复选框样式**：背景模糊、滑入动画、关闭按钮旋转、输入聚焦发光、按钮反馈、Lucide `CheckSquare` / `Square` 图标（与本地音乐界面一致）

---

## 二十五、性能与安全

- **关闭 F12 / Ctrl+Shift+I** 打开开发者控制台快捷键
- **静默日志**：网易云 / 酷狗 / QQ 三个 API 子进程的 stdout/stderr 转发全部静默；主进程模块加载、缓存保存、封面写入、云盘上传、下载分片、动漫解析等常规日志全部清理，仅保留低频错误日志用于崩溃排查
- **极致内存压缩**：`dev` 脚本限制 `--max-old-space-size=256`，`dev:light` 进一步降到 192MB，保证低配机也能流畅运行
- **IPC 通信安全**：所有 IPC 通信使用 `JSON.parse(JSON.stringify())` 克隆对象，确保 structured cloning 兼容
- **桌面歌词窗口**不会自动打开 DevTools

---

## 二十六、技术栈一览

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 (Composition API)、Pinia 3、Vue Router 5 |
| 桌面 | Electron 22 |
| 构建 | Vite 5、vite-plugin-electron、electron-builder |
| 图标 | Lucide Vue Next |
| 音频 | Web Audio API（均衡器、频谱）、HTML5 Audio |
| 歌词 | @applemusic-like-lyrics 三件套（core / lyric / vue） |
| 元数据 | music-metadata、node-id3、flac-metadata |
| 动漫 / 影视 | cheerio（HTML 解析）、hls.js（HLS 流播放）、flv.js、mpegts.js、Bangumi API（元信息聚合） |
| 下载引擎 | aria2c（多线程直链）、ffmpeg（m3u8 合并 / DASH 合并）、axios 自定义 Agent（128 路并发不限速） |
| B 站解析 | B 站 API（view / playurl）、二维码扫码登录、DASH 格式高画质、webRequest Referer 注入 |
| 图像处理 | PixiJS 7 + filter-blur + filter-bulge-pinch + filter-color-matrix |
| 后端 | 独立部署网站（详见上一节） |

---

## 二十七、构建与安装

### 环境要求
- Node.js ≥ 18
- npm ≥ 9

### 安装
```bash
npm install
```

### 开发预览
```bash
npm run dev          # 标准模式（256MB 内存上限）
npm run dev:light    # 轻量模式（192MB 内存上限，适合低配机）
```

### 构建发布
```bash
npm run build
```
构建后的安装包在 `release/` 目录下。

构建流程会自动执行三个资源准备脚本：
- `scripts/ensure-qq-music-dist.cjs`
- `scripts/ensure-kugou-music-api.cjs`
- `scripts/ensure-netease-api.cjs`

把 aria2c、ffmpeg、三平台 API 源码与依赖打包进安装包（extraResources）。

### 安装包特性
- NSIS 安装程序，支持自定义安装目录
- 桌面快捷方式 + 开始菜单快捷方式
- 自定义安装向导头图与侧边图
- 文件关联：9 种音频 + 9 种视频格式（共 18 种），双击即用本播放器打开

---

## 二十八、版本演进

| 版本 | 关键里程碑 |
|------|-----------|
| v3.0.0 | 新增网易云官方云盘、QQ 音乐平台支持 |
| v3.0.1 | 三平台音质体系重构（独立存储 + 回退链） |
| v3.0.2 | 新增酷狗概念版第三平台（完整视图 + 7 档音质 + 评论） |
| v3.0.3 | 网易云 API 本地化重构；ffmpeg 从 101MB 精简至 6.9MB |
| v3.1.1 | 酷狗「领取 VIP」入口；双击播放；日志静默；关闭 F12 |
| v3.1.2 | 修复桌面歌词锁定拖动闪烁；修复逐词歌词颜色层叠冲突 |
| v3.1.3 | 歌词切换动画放慢至 1.2s；移除 Apple/经典风格切换；修复酷狗取消喜欢失败 |
| v3.1.4 | 歌词「高亮行」开关；酷狗 VIP 标识改为渐变文字标签 |
| v3.1.5 | 修复全局确认弹窗未绑定导致所有删除操作无响应 |

---

## 二十九、配置说明

### 1. 三平台音乐 API
默认情况下无需任何配置——三平台 API 由 Electron 主进程在本地启动子进程，失败时自动重启或回退在线备用线路。

如需自建 API 服务，部署对应开源项目后修改：
- `src/api/index.js`（网易云）
- `src/api/kugou.js`（酷狗）

| 平台 | 开源项目 |
|------|---------|
| 网易云音乐 | [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) |
| 酷狗概念版 | [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) |
| QQ 音乐 | [qq-music-api](https://github.com/sansenjian/qq-music-api) |

---

## 三十、赞赏与联系

如果觉得好用，欢迎请开发者喝杯咖啡！

- 网站：[xiaomingky.cn](https://xiaomingky.cn)
- 问题反馈：[GitHub Issues](https://github.com/xiaomingky/MingYunTime/issues)
- 协议：MIT

---

## 写在最后

「茗韵时光」是一款**功能广度**与**细节深度**兼具的桌面播放器。它不只是「能放歌」——它把三大音乐平台、动漫、影视、下载、B 站解析、桌面歌词、密码锁、云音乐等十几个模块**有机地缝合**在一个 Electron 壳子里，并且每个模块都做到了「能用且好用」的水准。

如果你也想要一个「一台顶三台」的桌面多媒体娱乐终端，不妨下载试试。

[下载最新版](https://github.com/xiaomingky/MingYunTime/releases) · [查看源码](https://github.com/xiaomingky/MingYunTime) · [问题反馈](https://github.com/xiaomingky/MingYunTime/issues)

---

*本文由项目作者整理，版本对应 v3.1.5，发布于 2026-08-07。*
