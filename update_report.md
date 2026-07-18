# 茗韵时光音乐播放器 - 更新与优化报告

## 🎉 重大更新 v1.8.0 — 新增「动漫」与「影视」模块

本次版本为重大功能更新，在原有音乐播放器基础上新增了**完整的动漫观看**和**影视播放**能力，让茗韵时光从单一音乐播放器升级为多媒体娱乐中心。

### 🌸 新增模块一：动漫（樱花动漫源）

- **三页架构**：
  - 主页 `Anime.vue`：轮播图（pointer-events 修复点击穿透）+ 分类导航 + 最新/热门/排行三栏
  - 推荐页 `AnimeRecommend.vue`：季度新番 / 评分榜 / 类型筛选 / 个人收藏 四 Tab 切换
  - 详情页 `AnimeDetail.vue`：HLS 播放器 + Bangumi 元信息聚合
- **数据源**：樱花动漫（yhdmp），`.module-poster-item` 卡片解析（卡片本身为 `<a>` 标签的特殊情况已适配）
- **播放核心**：
  - 从播放页 `player_aaaa` JSON 提取 m3u8，使用 hls.js 加载
  - 多码率分辨率切换（基于 `MANIFEST_PARSED` 事件收集 levels）
  - 60s 缓冲上限、网络错误自动 `startLoad` 恢复、媒体错误自动 `recoverMediaError`
  - 多源兜底、下集预加载、播放进度记忆
- **Bangumi 元信息聚合** `anime-meta.js`：
  - 标题预处理：`normalizeStr` 去除空格/标点/「第X季」后缀
  - 双重相似度计算（`name_cn` + `name`），Levenshtein 编辑距离算法
  - **相似度 < 0.5 自动返回 null**，杜绝「午夜的倾心旋律 → 玩具店的午夜」错配问题
  - 叠加评分/简介/标签/角色/Staff/相关推荐，不覆盖源站标题和封面
- **交互**：本地收藏夹、观看集数记忆、24 项/页分页搜索、去重过滤无封面项

### 🎞️ 新增模块二：影视（神马电影网源）

- **主页** `Movie.vue`：标题「电影 / 动漫 / 电视剧」，轮播图 + 8 大分类（动作/喜剧/爱情/科幻/悬疑/惊悚/恐怖/剧情）
- **数据源**：神马电影网（smdyu.com，标准 maccms 结构）
  - 历史踩坑：appys.pro / czys.tv 在大陆机房 TLS 握手稳定失败，已弃用
  - 备选 ddys.tv 有密码门 + 点选验证码 + POW 验证，Electron 无法自动通过
  - 最终选用神马电影网：无验证码、国内可达、HTML 结构标准
- **解析逻辑** `movie.js`：
  - 卡片：`.cards.video-list .card`，`/vod-detail-id-XXX.html` 提取 id
  - 详情：`.play-list#playlist_1/2/3...` 多线路解析，提取 `id-src-N-num-M` 段
  - 播放：从 `player_aaaa` JSON 直接提取 m3u8，hls.js 播放
  - 搜索：`/vod-search--------------.html?wd=关键词`
  - 封面优先级 `data-original`，过滤 `load.gif` 占位图

### 🔧 配套基础设施

- **路由扩展** `router/index.js`：新增 `/anime`、`/anime/recommend`、`/anime/:source/:id`、`/movie`、`/movie/:source/:id`
- **侧边栏** `App.vue`：新增「动漫」（MonitorPlay 图标）和「影视」（Film 图标）入口
- **API 层** `api/index.js`：新增 `animeHome/animeSearch/animeDetail/animeParsePlayUrl/animeMetaSearch/animeMetaRelated` 和 `movieHome/movieSearch/movieDetail/movieParsePlayUrl/movieSources`
- **状态管理** `store/anime.js`：收藏夹、观看历史、播放进度、源切换持久化
- **共享样式** `anime-common.css` / `anime-detail.css`：网易云经典白红主题（#c20c0c）
- **Vite 配置** `vite.config.mjs`：external 数组新增 `cheerio`

### 📦 新增文件清单

```
electron/anime.js              # 动漫模块 IPC（樱花动漫解析）
electron/anime-meta.js         # Bangumi 元信息聚合 + 标题相似度匹配
electron/movie.js              # 影视模块 IPC（神马电影网解析）
src/views/Anime.vue            # 动漫主页
src/views/AnimeRecommend.vue   # 动漫推荐页
src/views/AnimeDetail.vue      # 动漫详情页（HLS + Bangumi）
src/views/Movie.vue            # 影视主页
src/views/MovieDetail.vue      # 影视详情页
src/views/anime-common.css     # 动漫共享样式
src/views/anime-detail.css     # 动漫详情页样式
src/store/anime.js             # 动漫状态管理
```

### 🐛 修复的 BUG

- **轮播图点击跳转 bug**：所有 `.carousel-slide` 用 `position: absolute` 叠加，inactive 的 `opacity: 0` 仍接收点击 → inactive 加 `pointer-events: none`，active 加 `pointer-events: auto`
- **樱花播放器黑屏**：樱花播放页没有 iframe，是 `player.js` 动态渲染，构造的 `dplayer.html?url=...` 路径不存在 → 回到 m3u8 + hls.js 方案
- **主页只有 3 个动漫且无封面**：`.module-poster-item` 卡片本身是 `<a>` 标签，`$el.find('a[href*="/v/"]')` 搜不到自身；封面 `src` 是占位 `load.gif` → 用 `$el.is('a')` 判断 + `data-original` 优先
- **详情页元信息错配**：Bangumi 搜索只取评分最高无相似度校验 → 新增 Levenshtein 相似度匹配，<0.5 丢弃

---

## BUG:桌面歌词在逐词歌曲中不显示歌词所以改成 
- **当前为逐词歌曲桌面歌词暂不支持逐词展示**

## 🚀 核心性能优化
  
### 1. 桌面歌词（DesktopLyrics）渲染重构
- **问题**：旧版本在部分老旧核显设备（如 Win7 系统）上运行时，由于依赖主进程通过 IPC 频道每秒发送数次歌词高亮进度，导致跨进程通信堵塞和严重的掉帧卡顿。
- **解决方案**：
  - 移除了 IPC 频繁发送 `wordProgress` 的逻辑，主界面仅下发“当前时间戳”。
  - 将计算负载转移到客户端，启用本地 `requestAnimationFrame` 进行高频插值动画计算。
  - 使用 CSS 变量 (`--wp`) 和 `linear-gradient` 进行渲染，并加入 `translateZ(0)` 与 `will-change: transform` 强制开启 GPU 硬件加速。
- **结果**：桌面歌词告别卡顿，实现 60FPS 丝滑的 Apple Music 级逐词高亮表现。

### 2. 详情页背景（SongDetail）性能卸载
- **问题**：原有的高斯模糊效果 (`blur(80px)`) 严重拖累了老旧核显的渲染性能。
- **解决方案**：将 `blur` 半径下调至 40px，并在 `.bg-blur` 层启用 `transform: scale(1.5) translateZ(0)` 硬件加速。
- **结果**：老设备内存及 GPU 占用大幅下降，UI 拖拽与切换动画恢复流畅。

---

## 🎨 UI 与视觉升级

### 1. 沉浸式与经典双模式无缝切换
- **模式选择**：在歌曲详情页的控制栏新增了“模式切换”按钮（右下角图片 Icon），提供两种背景风格：
  - **经典模式（纯白）**：清理了底层残留的背景遮罩图，实现了极致干净纯粹的纯白界面。
  - **沉浸模式（跟随封面）**：背景跟随当前专辑封面自动取色（饱和度提升+高斯模糊），并且通过 `opacity: 0.35` 使底层白色透出，保持整体明亮柔和。

### 2. 底部进度条全场景沉浸融合
- **问题**：过去展开歌曲详情页时，底部的控制栏（Footer）仍然保持白色底色，割裂感较强。
- **解决方案**：
  - 在沉浸模式展开详情页时，自动为 Footer 挂载 `.is-transparent` 类，使其背景完全透明化，并消除边框线。
  - 详情页的背景层高度设为 `100%` 直接穿透到底部，让播放进度和控制按钮悬浮在封面背景之上，达成全局沉浸效果。

### 3. 动态歌词对比度自适应
- **问题**：在沉浸模式下，部分封面背景颜色较深导致未播放的黑色歌词难以辨认。
- **解决方案**：为沉浸模式特制了高对比度 CSS：
  - 未播放的歌词字体透明度由 0.4 加深至 0.55。
  - YRC 逐词未经过部分的渐变底色（背景填充）由 0.25 加深至 0.4。
- **结果**：无论是花哨的封面还是浅色封面，黑色歌词均可清晰呈现。

---

## 💽 本地音乐与数据打通

### 1. 本地歌曲自动匹配并缓存 YRC
- **问题**：本地导入的歌曲默认没有歌词，或者只能获取到普通的 LRC 歌词。
- **解决方案**：
  - 接入最新的 `/lyric/new` API 接口。
  - **自动触发**：播放本地音乐时，若检测到本地缺失歌词，将在后台自动获取并下载，下载成功后通过 `MessageStore` 弹出成功提示：*“已自动为您匹配并下载逐词歌词”*。
  - **手动触发**：本地音乐列表的“搜索获取歌词”按钮，也已同步更新，直接抓取 YRC 并持久化。

### 2. 多重格式兼容性存取
- **方案优化**：在不破坏原有 `.lrc` 文件结构的前提下，创新性地使用 `---yrc---` 和 `---ytlrc---` 标识符进行追加存储。读取时系统能自动分割并分别反序列化，保证了断网状态下也能正常渲染逐词效果。
