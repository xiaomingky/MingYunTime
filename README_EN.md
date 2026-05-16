# 🎵 茗韵时光 (MingYun Time) — Music Player

> **This project is entirely created by AI (Claude Code)** | [中文版](README.md)

A beautiful, feature-rich desktop music player built with **Vue 3** + **Electron**, powered by the Netease Cloud Music API.

---

## ✨ Features

### 🏠 Discovery

![主页](showimage/主页.png)

- Personalized recommendations, banners, playlists, new songs, rankings, and top artists

### 🔍 Search

![搜索](showimage/搜索.png)

- Search songs, artists, albums, videos, and playlists

### 🎧 Song Detail

![歌曲详情页](showimage/歌曲详情页.png)

- Full-screen overlay with synchronized lyrics, cover art, and visualizer
- Like, add to playlist, download, share, comment

### 📋 Playlists

![歌单](showimage/歌单.png)

- Create, delete, edit, and subscribe to playlists
- Add/remove tracks, upload custom cover images

### 💻 Local Music

![本地歌曲](showimage/本地歌曲.png)

- Import individual files or entire folders (MP3, FLAC, WAV, OGG, M4A)
- **Auto-fetch cover art** from online matching, saved alongside the song
- **Auto-fetch lyrics** (.lrc) from online matching, saved alongside the song
- Metadata editing (title, artist, album, year, genre, cover)
- GIF/static cover toggle

### 🔄 Recent Play

![最近播放](showimage/最近播放.png)

- Track listening history with quick play support

### 🎤 Desktop Lyrics

- Floating transparent lyrics window, always on top
- **Lock mode**: click-through to apps underneath + independent unlock button
- Customizable font, color, and size

### 🎚️ Equalizer

- 8 built-in presets: Default, Pop, Classical, Rock, Electronic, Vocal, Jazz, Bass
- 10-band graphic EQ with adjustable gain (-12dB ~ +12dB)

### 📝 English Lyrics Analysis

- AI-powered grammar analysis using DeepSeek API
- Word-by-word parsing, tense, voice, sentence structure, vocabulary with word forms
- Results cached locally for offline use

### 🎬 Video & MV

![MV](showimage/MV.png)

- Online video browsing, local video management
- MV player with local MV matching

### 🔐 Login

![登录](showimage/登录.png)

- Phone, email, and QR code login
- User profile and playlists sync

### 🖥️ System Tray

- Minimize to tray, tray controls (prev/play/next), quick exit

### 🎨 UI

- Clean modern design, responsive sidebar, smooth transitions
- Custom scrollbar, glassmorphism effects

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **npm** ≥ 9

### Install
```bash
npm install
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```
The built installer will be in the `release/` folder.

---

## ⚙️ Configuration

### 1. Netease Cloud Music API

This project requires a **Netease Cloud Music API** service. Deploy your own instance.

**Recommended:** [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)

After deploying, change the `baseURL` in `src/api/index.js`:

```js
const request = axios.create({
    baseURL: 'https://your-netease-api-server.com',  // ← Your API server URL
    ...
})
```

### 2. DeepSeek API Key

The English lyrics analysis feature requires a **DeepSeek API Key**.

Get one at: https://platform.deepseek.com

Two options:
- Enter it in the app UI (saved automatically to localStorage)
- Or set a default in `src/components/EnglishAnalysis.vue`

---

## 🏗️ Tech Stack

| Layer | Technology |
|------|-----------|
| Frontend | Vue 3 (Composition API), Pinia, Vue Router 5 |
| Desktop | Electron 22 |
| Build | Vite 5, vite-plugin-electron, electron-builder |
| Icons | Lucide Vue Next |
| Audio | Web Audio API (EQ), HTML5 Audio |
| Metadata | music-metadata, node-id3 |

---

## 📁 Project Structure

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
├── showimage/           # Screenshots
├── font/                # Custom fonts for desktop lyrics
├── build/               # Build resources (icons)
├── package.json
└── README.md
```

---

## 📦 Download

Go to the [Releases](https://github.com/xiaomingky/XiaoMingKY163_Player/releases) page to download the latest installer.

---

## 📄 License

MIT

---

## 👤 Contact

- Website: [xiaomingky.cn](https://xiaomingky.cn)
- Issues: [GitHub Issues](https://github.com/xiaomingky/XiaoMingKY163_Player/issues)
