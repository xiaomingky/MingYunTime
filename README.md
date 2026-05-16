# 🎵 茗韵时光 (MingYun Time) — Music Player

> **This project is entirely created by AI (Claude Code) / 本项目完全由 AI (Claude Code) 创作**

A beautiful, feature-rich desktop music player built with **Vue 3** + **Electron**, powered by the Netease Cloud Music API.

一款精美的桌面音乐播放器，基于 **Vue 3** + **Electron** 构建，使用网易云音乐 API。

---

## 📸 Screenshots / 截图

| | |
|:---:|:---:|
| ![主页](showimage/主页.png) | ![歌单](showimage/歌单.png) |
| **主页 / Home** | **歌单 / Playlist** |
| ![歌曲详情页](showimage/歌曲详情页.png) | ![本地歌曲](showimage/本地歌曲.png) |
| **歌曲详情 / Song Detail** | **本地歌曲 / Local Music** |
| ![搜索](showimage/搜索.png) | ![最近播放](showimage/最近播放.png) |
| **搜索 / Search** | **最近播放 / Recent Play** |
| ![登录](showimage/登录.png) | ![MV](showimage/MV.png) |
| **登录 / Login** | **MV 播放 / MV Player** |

---

## ✨ Features / 功能

### 🏠 Discovery / 发现音乐
- Personalized recommendations, banners, playlists, new songs, rankings, and top artists
- 个性推荐、轮播图、歌单、最新音乐、排行榜、热门歌手

### 🔍 Search / 搜索
- Search songs, artists, albums, videos, and playlists
- 搜索歌曲、歌手、专辑、视频、歌单

### 📋 Playlists / 歌单管理
- Create, delete, edit, and subscribe to playlists
- Add/remove tracks, upload custom cover images
- 创建、删除、编辑、收藏歌单，添加/移除歌曲，上传自定义封面

### 🎧 Player / 播放器
- Play, pause, prev/next, shuffle, repeat modes
- Progress bar with drag, volume control with drag
- Quality selection: Standard / Higher / Exhigh / Lossless
- Audio device selection
- 播放/暂停、上下曲、随机/循环模式、可拖拽进度条和音量、音质选择、音频设备切换

### 🎚️ Equalizer / 均衡器
- 8 built-in presets: Default, Pop, Classical, Rock, Electronic, Vocal, Jazz, Bass
- 10-band graphic EQ with adjustable gain (-12dB ~ +12dB)
- 8种预设：默认/流行/古典/摇滚/电子/人声/爵士/低音，10段可调

### 🎤 Desktop Lyrics / 桌面歌词
- Floating transparent lyrics window, always on top
- **Lock mode**: click-through to apps underneath + independent unlock button
- Customizable font, color, and size
- 悬浮透明歌词窗口，可锁定（鼠标穿透+独立解锁按钮），字体/颜色/字号可调

### 📝 English Lyrics Analysis / 英文歌词解析
- AI-powered grammar analysis using DeepSeek API
- Word-by-word parsing, tense, voice, sentence structure, vocabulary with word forms
- Results cached locally for offline use
- 基于 DeepSeek API 的 AI 语法解析，逐词成分标注、时态语态句型、词汇变形详解，支持本地缓存

### 💻 Local Music / 本地音乐
- Import individual files or entire folders (MP3, FLAC, WAV, OGG, M4A)
- **Auto-fetch cover art** from online matching
- **Auto-fetch lyrics** (.lrc) from online matching
- Metadata editing (title, artist, album, year, genre, cover)
- GIF/static cover toggle
- 导入文件/文件夹，自动匹配在线封面和歌词，元数据编辑，GIF/静态封面切换

### 🎬 Video & MV / 视频
- Online video browsing, local video management
- MV player with local MV matching
- 在线视频浏览、本地视频管理、MV 播放

### 🔐 Login / 登录
- Phone, email, and QR code login
- User profile, playlists sync
- 手机号、邮箱、二维码登录

### 🖥️ System Tray / 系统托盘
- Minimize to tray, tray controls (prev/play/next), quick exit
- 托盘最小化、托盘控制（上下曲/播放暂停）、快速退出

### 🎨 UI / 界面
- Clean modern design, responsive sidebar, smooth transitions
- Custom scrollbar, glassmorphism effects
- 简洁现代设计、响应式侧边栏、流畅动画、毛玻璃效果

---

## 🚀 Quick Start / 快速开始

### Prerequisites / 环境要求
- **Node.js** ≥ 18
- **npm** ≥ 9

### Install / 安装
```bash
npm install
```

### Development / 开发预览
```bash
npm run dev
```

### Build / 构建发布
```bash
npm run build
```
The built installer will be in the `release/` folder.
构建后的安装包在 `release/` 目录下。

---

## ⚙️ Configuration / 配置说明

### 1. Netease Cloud Music API / 网易云音乐 API

This project requires a **Netease Cloud Music API** service. You need to deploy your own instance.

本项目需要一个**网易云音乐 API 服务**，请自行部署或使用他人成品。

**Recommended / 推荐：** [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)

After deploying, change the `baseURL` in `src/api/index.js`:
部署后修改 `src/api/index.js` 中的 `baseURL`：

```js
const request = axios.create({
    baseURL: 'https://your-netease-api-server.com',  // ← 改为你的 API 地址
    ...
})
```

### 2. DeepSeek API Key / 英文解析

For the English lyrics analysis feature, you need a **DeepSeek API Key**.

英文歌词解析功能需要 **DeepSeek API Key**。

Get one at / 获取地址：https://platform.deepseek.com

You can either / 两种方式：
- Enter it in the app UI (saved automatically to localStorage)
  在应用界面的英文解析面板中输入（自动保存）
- Or set a default in `src/components/EnglishAnalysis.vue`
  或在 `src/components/EnglishAnalysis.vue` 中设置默认值

---

## 🏗️ Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 (Composition API), Pinia, Vue Router 5 |
| Desktop | Electron 22 |
| Build | Vite 5, vite-plugin-electron, electron-builder |
| UI Icons | Lucide Vue Next |
| Audio | Web Audio API (EQ), HTML5 Audio |
| Metadata | music-metadata, node-id3 |

---

## 📁 Project Structure / 项目结构

```
music/
├── electron/            # Electron main process
│   └── main.js          # Window management, IPC handlers, protocols
├── src/
│   ├── api/index.js     # API client (axios)
│   ├── store/           # Pinia stores (player, user, message)
│   ├── router/          # Vue Router
│   ├── views/           # Page components
│   │   ├── Discovery.vue      # Home / discovery
│   │   ├── Search.vue         # Search
│   │   ├── SongDetail.vue     # Full-screen lyrics overlay
│   │   ├── PlaylistDetail.vue # Playlist detail + management
│   │   ├── AlbumDetail.vue    # Album detail
│   │   ├── LocalMusic.vue     # Local music management
│   │   ├── LocalVideo.vue     # Local video management
│   │   ├── RecentPlay.vue     # Recent play history
│   │   ├── Video.vue          # Online videos
│   │   └── DesktopLyrics.vue  # Desktop lyrics window
│   ├── components/      # Shared components
│   │   ├── EnglishAnalysis.vue  # AI English lyrics analysis
│   │   ├── EqPanel.vue          # Equalizer panel
│   │   ├── LoginModal.vue       # Login modal
│   │   ├── MvPlayer.vue         # MV player
│   │   └── Toast.vue            # Toast notifications
│   ├── style.css        # Global styles + CSS variables
│   ├── App.vue          # Root component (layout shell)
│   └── main.js          # App entry
├── showimage/           # Screenshots for README
├── font/                # Custom fonts for desktop lyrics
├── build/               # Build resources (icons)
├── package.json
└── README.md
```

---

## 📦 Download / 下载

Go to the [Releases](https://github.com/xiaomingky/XiaoMingKY163_Player/releases) page to download the latest installer.

前往 [Releases](https://github.com/xiaomingky/XiaoMingKY163_Player/releases) 页面下载最新安装包。

---

## 📄 License

MIT

---

## 👤 Contact / 联系

- Website / 网站：[xiaomingky.cn](https://xiaomingky.cn)
- GitHub Issues: [Report a bug / 报告问题](https://github.com/xiaomingky/XiaoMingKY163_Player/issues)
