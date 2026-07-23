# 🎵 茗韵时光 (MingYun Time) — Music Player

> **本项目完全由 AI (Claude Code) 创作** | [English Version](README_EN.md)

一款精美的桌面音乐播放器，基于 **Vue 3** + **Electron** 构建，集成网易云音乐 API，支持在线音乐播放/搜索/歌单管理，并内置**动漫观看**、**影视播放**、**统一下载中心**与 **B站视频解析**模块（HLS 流播放 + Bangumi 元信息聚合 + DASH 高画质合并）。

---

## 🆕 v1.9.0 更新亮点

- **📦 统一下载中心**：新增「下载」专区，统一管理音乐/影视/动漫/MV/视频下载，128 路并发不限速，aria2c + ffmpeg 打包进程序
- **🎬 B站视频解析 + 登录提升画质**：扫码登录解锁 4K/1080P+，DASH 音视频分离流下载时自动用 ffmpeg 合并
- **🎵 MV/影视/动漫专区下载**：三大专区均接入下载中心，歌曲详情页 MV 按钮支持本地/线上自动匹配
- **🌐 本地视频三 Tab**：本地视频 / 链接直播流 / 网址解析（支持 21 种视频格式 + B站 URL）
- **🔒 安全修复**：清除硬编码 API key，改为用户自行输入

---

## ✨ 功能

### 🏠 发现音乐

![主页](showimage/主页.png)

- 个性推荐、轮播图、歌单、最新音乐、排行榜、热门歌手

### 🔍 搜索

![搜索](showimage/搜索.png)

- 搜索歌曲、歌手、专辑、视频、歌单

### 🎧 歌曲详情

![歌曲详情页](showimage/歌曲详情页.png)

- 全屏歌词覆盖层，封面展示、频谱可视化
- 收藏、添加到歌单、下载、分享、评论
- 内置多字体切换，桌面歌词字体/颜色/字号自定义
- 歌词位置上下微调（-200px ~ +200px）

![字体切换](showimage/歌曲详情页内置字体切换展示.png)

### 📋 歌单管理

![歌单](showimage/歌单.png)

- 创建、删除、编辑、收藏歌单
- 添加/移除歌曲，上传自定义封面

### 💻 本地音乐

![本地歌曲](showimage/本地歌曲.png)

- 导入文件/文件夹（MP3、FLAC、WAV、OGG、M4A）
- **自动匹配在线封面** → 自动下载保存为 `歌曲名.jpg` 到歌曲同目录
- **自动匹配在线歌词** → 自动保存为 `歌曲名.lrc` 到歌曲同目录
- 元数据编辑（标题、歌手、专辑、年份、风格、封面）
- GIF/静态封面切换
- **下载歌曲自动带封面**，保存到本地目录

![下载带封面](showimage/下载歌曲带封面.png)

- 本地 MV 匹配播放

![本地MV](showimage/本地MV展示.png)

### 🔄 最近播放

![最近播放](showimage/最近播放.png)

- 播放历史记录，支持快速播放

### 🎤 桌面歌词

![桌面歌词](showimage/桌面歌词展示.png)

- 悬浮透明歌词窗口，始终置顶
- **锁定模式**：鼠标穿透到下层应用 + 独立解锁按钮
- 字体、颜色、字号可自定义

### 🎚️ 均衡器

![均衡器](showimage/均衡器展示.png)

- 8 种预设：默认、流行、古典、摇滚、电子、人声、爵士、低音
- 10 段图示均衡器，增益范围 -12dB ~ +12dB

### 📝 英文歌词解析

![英文解析](showimage/英文解析展示.png)

- 基于 DeepSeek API 的 AI 语法解析
- 逐词成分标注 · 时态语态 · 句型结构 · 词汇变形详解
- 解析结果自动保存为 `歌曲名.analysis.json` 到歌曲同目录（离线可用）

### 🎬 视频 & MV

![MV](showimage/MV.png)

- 在线视频浏览、本地视频管理
- MV 播放器，自动匹配本地 MV 文件
- 歌曲详情页 MV 按钮支持**本地/线上自动切换**：本地无 MV 时自动用网易云 MV API 按歌名匹配

### 📦 统一下载中心（v1.9.0 新增）

- **一站式下载管理**：音乐 / 影视 / 动漫 / MV / 视频 全部归口到「下载」专区
- **128 路并发不限速**：自定义 HTTP Agent（maxSockets: Infinity）+ aria2c 多线程，满带宽下载
- **aria2c + ffmpeg 打包进程序**（resources/），无需外部依赖
- **实时进度**：速度 / 进度 / 详情 / 链接复制，支持取消 / 重试 / 移除 / 状态筛选
- **历史持久化**：下载记录保存到磁盘，重启不丢失
- **自定义下载链接**：粘贴 URL 自动获取文件名

### 🎬 B站视频解析 + 登录提升画质（v1.9.0 新增）

- **B站 URL 解析**：粘贴 `bilibili.com/video/BVxxx` 或 `b23.tv` 短链自动解析直链
- **二维码扫码登录**：Cookie 持久化 30 天，登录状态栏显示**头像 / 昵称 / 大会员**
- **登录解锁高画质**：请求 DASH 格式（fnval=16），可获取 4K / 1080P+ / HDR / 杜比视界
- **DASH 自动合并**：音视频分离流下载时自动用 ffmpeg 流复制合并为有声 mp4（极快）
- **webRequest 注入 Referer**：自动为 B站 CDN（bilivideo.com）和图片 CDN（hdslb.com）注入 Referer

### 🌐 本地视频三 Tab（v1.9.0 增强）

- **本地视频**：导入文件/文件夹，扫描元数据
- **链接/直播流**：添加 MP4/WebM 直链、HLS(m3u8)、FLV 流，直播流自动标记 LIVE
- **网址解析**：粘贴任意影视/视频网页地址，自动提取视频流（支持 21 种视频格式扩展名）

### 🌸 动漫（樱花动漫）

- **三页架构**：主页（轮播图 + 分类导航 + 最新/热门/排行）、推荐页（季度新番 / 评分榜 / 类型筛选 / 收藏）、详情页
- **多源支持**：默认接入樱花动漫，HTML 卡片解析（`.module-poster-item`），封面优先 `data-original`
- **HLS 播放器**：从播放页 `player_aaaa` JSON 提取 m3u8，hls.js 加载，支持多码率分辨率切换
- **Bangumi 元信息聚合**：标题相似度匹配（Levenshtein 编辑距离，<0.5 自动丢弃），叠加评分/简介/标签/角色/Staff/相关推荐
- **播放体验**：60s 缓冲上限、错误自动恢复、多源兜底、下集预加载、播放进度记忆
- **收藏与历史**：本地收藏夹、观看集数记忆、最近观看列表
- **分页搜索**：24 项/页，页码居中导航，去重过滤无封面项

### 🎞️ 影视（电影/动漫/电视剧）

- **主页**：神马电影网（smdyu.com，标准 maccms 结构），轮播图 + 8 大分类（动作/喜剧/爱情/科幻/悬疑/惊悚/恐怖/剧情）
- **播放**：从播放页 `player_aaaa` JSON 直接提取 m3u8，hls.js 播放
- **多线路解析**：自动识别 `.play-list#playlist_1/2/3...` 多条播放线路
- **搜索**：`/vod-search--------------.html?wd=关键词`，分页去重
- **TLS 兼容**：已淘汰 appys.pro / czys.tv（机房 TLS 握手失败），改用国内可达的神马电影网

### 🔐 登录

![登录](showimage/登录.png)

- 手机号、邮箱、二维码登录
- 用户信息同步、歌单同步

### ☁️ 我的云音乐

- 后端 Web 管理页面上传本地歌曲，支持批量上传 + 自动匹配封面/歌词
- 桌面端双击播放云音乐，自动接入播放列表与下一首逻辑
- 云音乐刷新按钮，实时同步后端歌曲

### 🔒 账号密码锁

- 自建后端可为账号开启密码锁
- 开启后访问「我喜欢的音乐」和自定义歌单需验证密码
- 验证状态跨页面保持，退出登录后自动失效

### 🌐 后端管理网页

- 独立部署的网站后台，支持手机号/二维码/邮箱/Cookie 登录
- 云音乐上传、密码锁管理、账号同步

### 🖥️ 系统托盘

- 托盘最小化、托盘控制（上下曲/播放暂停）、快速退出

### 🎨 界面

- 简洁现代设计、响应式侧边栏、流畅动画、毛玻璃效果

---

## 🚀 快速开始

### 环境要求
- **Node.js** ≥ 18
- **npm** ≥ 9

### 安装
```bash
npm install
```

### 开发预览
```bash
npm run dev
```

### 构建发布
```bash
npm run build
```
构建后的安装包在 `release/` 目录下。

---

## ⚙️ 配置说明

### 1. 网易云音乐 API

本项目集成网易云音乐 API，需配置 API 服务地址。你可以：
- **自己部署**：[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)，部署后获得你的 API 地址
- **或使用他人分享的成品 API 地址**（直接填入即可）

打开 `src/api/index.js`，修改第 **4 行** 的 `baseURL`：

```js
// src/api/index.js  第 4 行
const request = axios.create({
    baseURL: 'https://your-netease-api-server.com',  // ← 改为你的 API 地址（自己部署的或他人成品）
    timeout: 30000,
    withCredentials: true
})
```

### 2. DeepSeek API Key（英文解析）

英文歌词解析功能需要 **DeepSeek API Key**。

获取地址：https://platform.deepseek.com

两种方式：
- 在应用界面的英文解析面板中输入（自动保存到本地）
- 或在 `src/components/EnglishAnalysis.vue` 中设置默认值

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 (Composition API)、Pinia、Vue Router 5 |
| 桌面 | Electron 22 |
| 构建 | Vite 5、vite-plugin-electron、electron-builder |
| 图标 | Lucide Vue Next |
| 音频 | Web Audio API（均衡器）、HTML5 Audio |
| 元数据 | music-metadata、node-id3 |
| 动漫/影视 | cheerio（HTML 解析）、hls.js（HLS 流播放）、Bangumi API（元信息聚合） |
| 下载引擎 | aria2c（多线程直链）、ffmpeg（m3u8 合并/DASH 合并）、axios 自定义 Agent（128 路并发不限速） |
| B站解析 | B站 API（view/playurl）、二维码扫码登录、DASH 格式高画质、webRequest Referer 注入 |

---

## 📁 项目结构

```
music/
├── electron/            # Electron 主进程
│   ├── main.js          # 窗口管理、IPC 处理、B站解析/登录、协议注册
│   ├── anime.js         # 动漫模块 IPC（樱花动漫解析）
│   ├── anime-meta.js    # Bangumi 元信息聚合 + 标题相似度匹配
│   ├── movie.js         # 影视模块 IPC（神马电影网解析）
│   └── download-manager.js  # 统一下载管理器（aria2c + ffmpeg + 128 并发）
├── resources/           # 打包的 aria2c.exe + ffmpeg.exe（下载引擎）
├── src/
│   ├── api/index.js     # API 客户端 (axios)
│   ├── store/           # Pinia 状态管理 (player、user、message)
│   ├── router/          # Vue Router 路由
│   ├── views/           # 页面组件
│   │   ├── Discovery.vue      # 发现音乐
│   │   ├── Search.vue         # 搜索
│   │   ├── SongDetail.vue     # 歌曲详情/全屏歌词
│   │   ├── PlaylistDetail.vue # 歌单详情管理
│   │   ├── AlbumDetail.vue    # 专辑详情
│   │   ├── LocalMusic.vue     # 本地音乐管理
│   │   ├── LocalVideo.vue     # 本地视频管理
│   │   ├── RecentPlay.vue     # 最近播放
│   │   ├── Video.vue          # 在线视频
│   │   ├── Anime.vue          # 动漫主页（樱花动漫）
│   │   ├── AnimeRecommend.vue # 动漫推荐页（季度新番/评分/分类/收藏）
│   │   ├── AnimeDetail.vue    # 动漫详情页（HLS 播放器 + Bangumi 元信息）
│   │   ├── Movie.vue          # 影视主页（神马电影网）
│   │   ├── MovieDetail.vue    # 影视详情页（多线路播放）
│   │   ├── Downloads.vue      # 统一下载中心（v1.9.0 新增）
│   │   └── DesktopLyrics.vue  # 桌面歌词窗口
│   ├── components/      # 共享组件
│   │   ├── EnglishAnalysis.vue  # AI 英文歌词解析
│   │   ├── EqPanel.vue          # 均衡器面板
│   │   ├── LoginModal.vue       # 登录弹窗
│   │   ├── MvPlayer.vue         # MV 播放器
│   │   └── Toast.vue            # 通知提示
│   ├── style.css        # 全局样式 + CSS 变量
│   ├── App.vue          # 根组件（布局外壳）
│   └── main.js          # 应用入口
├── showimage/           # README 截图
├── font/                # 桌面歌词自定义字体
├── build/               # 构建资源（图标）
├── package.json
└── README.md
```

---

## 📦 下载

前往 [Releases](https://github.com/xiaomingky/MingYunTime/releases) 页面下载最新安装包。

---

## ☕ 赞赏

如果觉得好用，欢迎请开发者喝杯咖啡！

![赞赏码](showimage/赞赏.png)

---

## 📄 协议

MIT

---

## 👤 联系

- 网站：[xiaomingky.cn](https://xiaomingky.cn)
- 问题反馈：[GitHub Issues](https://github.com/xiaomingky/MingYunTime/issues)
