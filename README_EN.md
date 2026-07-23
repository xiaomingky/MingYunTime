# 🎵 茗韵时光 (MingYun Time) — Music Player

> **This project is entirely created by AI (Claude Code)** | [中文版](README.md)

A beautiful, feature-rich desktop music player built with **Vue 3** + **Electron**, integrated with Netease Cloud Music API for online music playback, search, and playlist management, with built-in **Anime**, **Movie/TV**, **Unified Download Center**, and **Bilibili Video Parsing** modules (HLS playback + Bangumi metadata aggregation + DASH high-quality merging).

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
![歌曲详情页](showimage/歌曲详情页.png)

- Like, add to playlist, download, share, comment
- Built-in font switching, customizable lyric font/color/size

![Font Switch](showimage/歌曲详情页内置字体切换展示.png)

### 📋 Playlists

![歌单](showimage/歌单.png)

- Create, delete, edit, and subscribe to playlists
- Add/remove tracks, upload custom cover images

### 💻 Local Music

![本地歌曲](showimage/本地歌曲.png)

- Import individual files or entire folders (MP3, FLAC, WAV, OGG, M4A)
- **Auto-fetch cover art** → auto-downloaded as `song.jpg` to the song's directory
- **Auto-fetch lyrics** → auto-saved as `song.lrc` to the song's directory
- Metadata editing (title, artist, album, year, genre, cover)
- GIF/static cover toggle
- **Download songs with auto-embedded cover art**

![Download with Cover](showimage/下载歌曲带封面.png)

- MV playback: **local-first + online auto-match**. The MV button on the song detail page prefers local MV files; when none is found, it automatically calls the Netease MV API to match an online MV by song name

![Local MV](showimage/本地MV展示.png)

### 🔄 Recent Play

![最近播放](showimage/最近播放.png)

- Track listening history with quick play support

### 🎤 Desktop Lyrics

![Desktop Lyrics](showimage/桌面歌词展示.png)

- Floating transparent lyrics window, always on top
- **Lock mode**: click-through to apps underneath + independent unlock button
- Customizable font, color, and size

### 🎚️ Equalizer

![Equalizer](showimage/均衡器展示.png)

- 8 built-in presets: Default, Pop, Classical, Rock, Electronic, Vocal, Jazz, Bass
- 10-band graphic EQ with adjustable gain (-12dB ~ +12dB)

### 📝 English Lyrics Analysis

![English Analysis](showimage/英文解析展示.png)

- AI-powered grammar analysis using DeepSeek API
- Word-by-word parsing · tense · voice · sentence structure · vocabulary with word forms
- Results auto-saved as `song.analysis.json` to the song's directory (offline capable)

### 🎬 Video & MV

![MV](showimage/MV.png)

- Online video browsing, local video management
- MV player with local MV matching; the MV button on the song detail page supports **local-first + online auto-match** (calls Netease MV API by song name when no local MV is found)
- **Bilibili video parsing**: paste a `bilibili.com/video/BVxxx` URL or `b23.tv` short link, automatically calls Bilibili API (view + playurl) to extract direct streams
- **QR-code login for higher quality**: after Bilibili QR-code login, requests DASH format (fnval=16) to unlock 4K / 1080P+ / HDR / Dolby Vision; cookies persist for 30 days, and the login status bar shows avatar / nickname / VIP status
- **DASH auto-merge**: when downloading audio-video separated streams, ffmpeg stream-copy merges them into a single mp4 with audio (very fast)
- **webRequest Referer injection**: automatically injects Referer for Bilibili CDN (bilivideo.com) and image CDN (hdslb.com) to bypass 403/hotlink protection

### 📺 Local Video

The local video page is split into three tabs:

- **Local Video**: import files/folders, auto-scan metadata (duration, format, size)
- **Stream/Live**: add MP4/WebM direct links, HLS (m3u8), FLV streams; live streams are auto-tagged LIVE
- **URL Parse**: paste any video page URL (including Bilibili URLs) to auto-extract video streams from the page; supports 21 video format extensions (mp4/webm/avi/mkv/mov, etc.); results are listed for the user to play or download

### 📦 Unified Download Center

All download tasks (music / movie / anime / MV / video) are unified into a single "Downloads" section:

- **128-thread concurrent, uncapped speed**: custom HTTP Agent (maxSockets: Infinity) + aria2c multi-threading for full-bandwidth downloads
- **aria2c + ffmpeg bundled** (resources/), no external dependencies
- **Real-time progress**: speed / progress / details / link copy, with cancel / retry / remove / status filters
- **Persistent history**: download records saved to disk, survive restarts
- **Custom download URL**: paste a URL and the filename is auto-fetched
- m3u8 streams use parallel shard download + ffmpeg concat merge; Bilibili DASH streams auto-merge audio and video

### 🌸 Anime (Yhdm)

- **Three-page architecture**: Home (carousel + category nav + latest/hot/ranking), Recommend (seasonal new / rating chart / genre filter / favorites), Detail
- **Multi-source**: Defaults to Yhdm (Sakura Anime), HTML card parsing (`.module-poster-item`), prioritizes `data-original` for covers
- **HLS Player**: Extracts m3u8 from the play page's `player_aaaa` JSON, loaded by hls.js with multi-bitrate resolution switching
- **Bangumi Metadata Aggregation**: Title similarity matching (Levenshtein edit distance, auto-discards <0.5), overlays score/summary/tags/characters/staff/related recommendations
- **Playback Experience**: 60s buffer cap, auto error recovery, multi-source fallback, next-episode preload, playback progress memory
- **Favorites & History**: Local favorites, watched-episode memory, recent-watched list
- **Paginated Search**: 24 items per page, centered page navigation, dedup with no-cover filtering
- **Download**: detail page provides a download entry, unified into the Download Center

### 🎞️ Movies & TV (Smdyu)

- **Home**: Smdyu (smdyu.com, standard maccms structure), carousel + 8 categories (Action/Comedy/Romance/Sci-Fi/Mystery/Thriller/Horror/Drama)
- **Playback**: Extracts m3u8 directly from the play page's `player_aaaa` JSON, played by hls.js
- **Multi-route Parsing**: Auto-detects multiple play routes via `.play-list#playlist_1/2/3...`
- **Search**: `/vod-search--------------.html?wd=keyword`, paginated with dedup
- **TLS Compatibility**: Dropped appys.pro / czys.tv (machine-room TLS handshake failures), switched to the China-reachable Smdyu
- **Download**: detail page provides a download entry, unified into the Download Center

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

This project integrates the Netease Cloud Music API. You need to configure an API server URL. Either:
- **Self-host**: Deploy [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) and get your API URL
- **Or use a shared API URL** from someone else (just paste it in)

Open `src/api/index.js` and change the `baseURL` at **line 4**:

```js
// src/api/index.js  line 4
const request = axios.create({
    baseURL: 'https://your-netease-api-server.com',  // ← Your API URL (self-hosted or shared)
    timeout: 30000,
    withCredentials: true
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

| Layer | Tech |
|------|------|
| Frontend | Vue 3 (Composition API), Pinia, Vue Router 5 |
| Desktop | Electron 22 |
| Build | Vite 5, vite-plugin-electron, electron-builder |
| Icons | Lucide Vue Next |
| Audio | Web Audio API (Equalizer), HTML5 Audio |
| Metadata | music-metadata, node-id3 |
| Anime/Movie | cheerio (HTML parsing), hls.js (HLS streaming), Bangumi API (metadata aggregation) |
| Download Engine | aria2c (multi-thread direct links), ffmpeg (m3u8 merge / DASH merge), axios custom Agent (128-thread concurrent, uncapped) |
| Bilibili Parsing | Bilibili API (view/playurl), QR-code login, DASH high-quality format, webRequest Referer injection |

---

## 📁 Project Structure

```
music/
├── electron/            # Electron main process
│   ├── main.js          # Window management, IPC, Bilibili parsing/login, protocols
│   ├── anime.js         # Anime module IPC (Yhdm parsing)
│   ├── anime-meta.js    # Bangumi metadata aggregation + title similarity matching
│   ├── movie.js         # Movie module IPC (Smdyu parsing)
│   └── download-manager.js  # Unified download manager (aria2c + ffmpeg + 128 concurrent)
├── resources/           # Bundled aria2c.exe + ffmpeg.exe (download engine)
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
│   │   ├── LocalVideo.vue     # Local video / streams / URL parsing
│   │   ├── RecentPlay.vue     # Recent play history
│   │   ├── Video.vue          # Online videos
│   │   ├── Anime.vue          # Anime home (Yhdm)
│   │   ├── AnimeRecommend.vue # Anime recommend (seasonal/rating/genre/favorites)
│   │   ├── AnimeDetail.vue    # Anime detail (HLS player + Bangumi metadata)
│   │   ├── Movie.vue          # Movie home (Smdyu)
│   │   ├── MovieDetail.vue    # Movie detail (multi-route playback)
│   │   ├── Downloads.vue      # Unified download center
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

Go to the [Releases](https://github.com/xiaomingky/MingYunTime/releases) page to download the latest installer.

---

## ☕ Support

If you like this app, buy the developer a coffee!

![Donation QR](showimage/赞赏.png)

---

## 📄 License

MIT

---

## 👤 Contact

- Website: [xiaomingky.cn](https://xiaomingky.cn)
- Issues: [GitHub Issues](https://github.com/xiaomingky/MingYunTime/issues)
