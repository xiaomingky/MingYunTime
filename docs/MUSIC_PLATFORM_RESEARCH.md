# 茗韵时光：新增音乐平台接入调研

调研日期：2026-10-14（Asia/Shanghai）。对应源码：4.0.0-beta.2。

本次检查项目源码、平台官方文档、开源项目实际源码与 GitHub 维护状态，并对部分公开只读接口进行请求。结论用于选择接入方向；没有在客户端实现新增平台，也没有验证会员完整播放、账号写操作或长期稳定性。

用户补充的重点是汽水音乐，以及现有 QQ 音乐接入不完整、逻辑分散。因此实际建议调整为：**先修复 QQ 已确认的接口与页面衔接问题，再集中平台逻辑，并行验证汽水的搜索、登录和播放链路。** 咪咕等候选保留为后续扩展。本文件后半部分记录 QQ 源码核查和汽水专项方案。

## 结论与推荐顺序

如果只新增一个国内商业曲库，优先做**咪咕音乐**的受限试接。游客搜索和详情本次真实返回正常业务数据，近期维护的 API 包具备较完整的模块。会员歌曲仍需要用户有效授权；相关项目有未完成的签名适配和许可声明不一致，不能直接承诺完整平台功能。

如果希望增加稳定、功能可控的来源，优先做**OpenSubsonic / Navidrome**。这是个人服务器曲库，需要用户提供服务地址和账号；一套协议适配可以覆盖多个服务器，实现搜索、歌单、封面、播放、歌词和允许的下载。

如果希望用较小改动拓宽可听内容，**B站仅音频播放**值得先做。它是现有视频能力的扩展，不能算一个新接入的平台：项目已经返回 DASH 音轨地址，可以再适配为音乐队列条目。

| 候选 | 接入依据 | 播放方式及关键限制 | 建议 | 初步工作量判断 |
| --- | --- | --- | --- | --- |
| 咪咕音乐 | 近期民间 API 项目；游客搜索、详情已实时验证；另有官方商务合作入口 | 播放接口、音质、会员 Token 需另行验证 | 国内曲库第一候选 | 中；完整账号平台更高 |
| 酷我音乐 | 民间网页接口与旧 API 项目 | Cookie / Secret / 风控；裸搜索请求被拒 | 第二候选，先做接口验证 | 中到高 |
| 汽水音乐 | 2026 年维护的民间 API 项目 | 搜索签名、登录、媒体解密链路复杂 | 实验入口 | 高 |
| 千千音乐 | 官网仍在运营 | 本次未找到能推荐的近期维护 API 方案 | 暂缓 | 未确定 |
| OpenSubsonic / Navidrome | 官方开放协议及兼容文档 | 用户自有服务器，按权限播放与下载 | 高优先级 | 中 |
| Jellyfin | 官方 API、TypeScript SDK | 用户自有媒体服务器；直放或服务器转码 | 个人服务器第二候选 | 中 |
| B站仅音频 | 本项目已返回独立音轨 | 链接过期、分 P、登录权限、来源请求头 | 高优先级的小范围扩展 | 相对较低 |
| Audius | 官方 REST API / SDK；热门曲目元数据已实时验证 | 部分内容可能受访问限制；下载由曲目权限决定 | 独立音乐来源 | 低到中 |
| Jamendo | 官方 API 明确提供流地址 | 需 client_id；下载由 audiodownload_allowed 决定 | 独立音乐来源 | 低到中 |
| Apple Music | 官方 MusicKit Web 与 Apple Music API | 开发者 Token、用户订阅、SDK 播放；Electron 环境需验证 | 有订阅用户需求再做 | 高 |
| Spotify | 官方 Web API 与 Web Playback SDK | Premium、开发模式用户限制、扩展配额门槛、加密播放环境 | 不适合当前优先公开集成 | 高 |
| TIDAL | 官方 Web SDK 存在 auth / api / player 模块 | 订阅、应用凭据、播放环境和准入需独立验证 | 后续专项候选 | 高或未确定 |
| SoundCloud / Deezer | 潜在候选 | 本次关键官方页面访问不完整，准入与完整播放未核实 | 不列入短期承诺 | 未确定 |
| YouTube Music | 官方 YouTube API / 嵌入播放与民间音乐接口属于不同路线 | 不能把视频解析能力等同于官方音乐曲库、音频直放授权 | 后续单独评估 | 高或未确定 |
| Radio Browser | 电台目录官方 API；电台搜索已实时验证 | 直播流，无固定歌曲时长；通常不能 seek | 可选电台频道 | 低到中 |

工作量是基于现有源码的相对判断，不是排期承诺。接口目录存在、最近 push、HTTP 200 都不能独立证明完整播放正常。

## 国内平台证据

### 咪咕音乐

[Domdkw/miguMusic-api-enhanced](https://github.com/Domdkw/miguMusic-api-enhanced) 在 GitHub API 中的最后 push 为 2026-10-06，未归档。源码使用 Hono / TypeScript，提供搜索、详情、歌词、歌单、登录和播放地址模块，可作为接口参考或待评估依赖。

本次无需账号、Cookie、签名或部署服务的上游只读请求：

| 请求 | 结果 | 可以证明的能力 |
| --- | --- | --- |
| GET app.c.nf.migu.cn/bmw/search/song/v1.0?pageNo=1&text=晴天 | HTTP 200，业务 code=000000；返回周杰伦《晴天》，contentId=600902000006889366 | 本次网络环境中的游客搜索可用 |
| GET app.c.nf.migu.cn/resource/song/by-contentids/v2.0?contentId=600929000001520013 | HTTP 200，业务 code=000000；返回《APT.》及歌手、专辑、时长、歌词 URL 等 | 本次歌曲详情接口可用 |

源码与文档：[search.ts](https://github.com/Domdkw/miguMusic-api-enhanced/blob/main/src/modules/search.ts)、[song_info.ts](https://github.com/Domdkw/miguMusic-api-enhanced/blob/main/src/modules/song_info.ts)、[播放接口文档](https://github.com/Domdkw/miguMusic-api-enhanced/blob/main/docs/api/url.md)、[url_v2.ts](https://github.com/Domdkw/miguMusic-api-enhanced/blob/main/src/modules/url_v2.ts)、[登录文档](https://github.com/Domdkw/miguMusic-api-enhanced/blob/main/docs/api/passport.md)。

播放源码透传 pacmtoken，文档明确 VIP 歌曲依赖 VIP 用户 Token。README 待办仍有 ce 请求头、V005 签名等；登录验证码风控也有未完成处理。本次没有获取播放媒体，不能证明完整播放、会员音质、登录稳定性或歌词内容完整。

根目录 LICENSE 为 MIT，但 README 又限定学习研究、不得商业用途，src/utils/quality.ts 还标注 cc-nc-4.0。复用源码前需要理清这些声明及第三方代码出处；代码许可证不代表获得歌曲内容授权。

[咪咕音乐官方开放合作](https://open.migu.cn/) 是另一条路线。[新手引导](https://open.migu.cn/order/miguBlack/nguide/)描述企业资料、综合评估、保密协议、商务价格、合同、开发测试等步骤。这是正式商务接入，不是注册即得到免费公开播放接口。

建议第一阶段只承诺搜索、详情、封面和按可用数据展示歌词；播放、歌单及账号能力分别验收后再启用。

### 酷我音乐

[qyhqiu/kuwoMusicApi](https://github.com/qyhqiu/kuwoMusicApi) 最后 push 为 2023-07-25，README 仍采用 Node 8 / 旧 Egg 技术栈。其 [BaseService](https://github.com/qyhqiu/kuwoMusicApi/blob/master/app/service/BaseService.ts)有 Cookie / Secret 和网页请求头逻辑，[playUrl 模块](https://github.com/qyhqiu/kuwoMusicApi/blob/master/app/service/playUrl.ts)包装网页播放接口，属于民间接口封装。

[GSQZ/KuwoMusicApi](https://github.com/GSQZ/KuwoMusicApi) 最后 push 虽为 2026-08-11，但已归档，当前只保留 README，说明源码与构建产物已移除。不能把最近修改日期当作仍在维护的证据。

本次裸请求 www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=晴天&pn=1&rn=1&httpsStatus=1 返回 HTTP 200，但业务为 success=false、message="The request is illegal!"。正确 Cookie / Secret 下是否可用仍需研究；这个结果也不能证明平台完全不可接。

建议先独立验证搜索、详情、正常权限下播放地址、歌词和地址续期，再决定是否建设完整平台页面。新出现的聚合包装不能替代上游接口实测。

### 汽水音乐

[guowenye/qishui-api](https://github.com/guowenye/qishui-api) 最后 push 为 2026-07-26，未归档。README 和 [qishuiClient.js](https://github.com/guowenye/qishui-api/blob/main/src/qishuiClient.js)区分已实现、已验证和登录 / 签名限制，适合做实验参考。

PC 搜索和详情可能需要 Cookie 或 X-Helios / X-Medusa 头；可配置注入这些头不代表项目完整实现了签名生成。media/player 默认脱敏，不直接输出 url_player_info、video_model、play_auth、spade_a 等值。分享页音频解析与加密处理也不能等同于普通 MP3 地址获取。

本次只核查文档与源码，没有部署并运行真实上游 smoke 测试。建议先做分享链接、歌单信息等实验能力，完整搜索与播放单独验证。

### 千千音乐

[千千音乐官网](https://music.taihe.com/)本次可访问，首页具有歌单、歌手、VIP、推荐歌曲和 MV，SSR 数据包含 2026-10-13 的近期内容。平台仍在运营。

本次未找到足以推荐的近期维护 API 项目或公开开发文档。不能将历史百度音乐接口、旧 Meting 的 baidu 源自动视为当前千千能力；也不能把“本次没找到方案”写成“平台没有 API”。

## 开放协议与其他可用来源

### OpenSubsonic / Navidrome

[OpenSubsonic 官方文档](https://opensubsonic.netlify.app/docs/)定义 REST / JSON 接口及可选扩展，一套客户端可以连接多个兼容服务器。

[Navidrome 官方兼容表](https://www.navidrome.org/docs/developers/subsonic-api/)确认支持 search2 / search3、getSong、getAlbum、getArtists、getPlaylists、getPlaylist、stream、download、getCoverArt、getLyrics、star / unstar、scrobble 等。歌词来自嵌入标签或外部文件，下载依赖服务器和用户权限。

接入需要服务地址及认证配置。ID 保持字符串，不应转为整数。不要假定所有兼容服务器都支持所有扩展；启动时探测能力，基础 getLyrics 与扩展 getLyricsBySongId 分开处理。OpenSubsonic 新歌词扩展可表达更丰富的同步内容，但不代表目标 Navidrome 版本已经实现。

直接播放与转码播放分别测试 Range、seek、时长和音频信号；认证和 CORS 由主进程请求层 / 本地协议统一处理。连接服务器无需把 Navidrome 服务端本身打包进客户端。

### Jellyfin

[官方 API](https://api.jellyfin.org/)及 [官方 TypeScript SDK](https://github.com/jellyfin/jellyfin-sdk-typescript)适合作为个人媒体服务器来源。SDK 本次核查未归档且近期仍更新。

用户提供服务器地址并登录，获取音频条目、专辑、封面和播放信息，使用直放或服务器转码。[官方编解码器说明](https://jellyfin.org/docs/general/clients/codec-support/)表明格式、设备及容器不兼容会影响直放，需要服务器转换。

本次没有用户服务器用于登录和播放验收。建议在 OpenSubsonic 之后单独接入；它不是新增公共唱片曲库。

### B站仅音频播放

本项目 electron/bilibili-video.js 已在 DASH 分支提取 dash.audio，返回 audioUrl，且有搜索、详情、收藏和登录相关 IPC。electron/main.js 与下载模块也有 B站 CDN 来源请求头处理。

建议以 bvid + cid 标识音乐队列条目，将标题、UP 主、封面、时长映射为统一曲目，按用户选择播放某一分 P 的音轨。收藏夹 / 合集可以逐步适配为播放列表。

需要处理链接续期、登录与内容权限、分 P、仅 progressive 视频流没有独立音轨的情况，以及不同接口对应的来源头。没有同步歌词时隐藏相关功能或让用户手动匹配，并标明外部歌词来源。

这条路线复用现有视频能力；平台接口与内容许可仍需遵守，不能把“有 audioUrl”当成所有视频都可无条件导出音频。

### Audius、Jamendo、电台

[Audius 官方文档](https://docs.audius.org/)提供曲目、用户、歌单搜索与流播放。公开 GET api.audius.co/v1/tracks/trending?app_name=MingYunTimeResearch&limit=2 本次 HTTP 200，返回两首曲目，is_streamable=true、is_stream_gated=false、is_downloadable=false。

这个结果证明公开目录可用，也直观说明可播放与可下载是不同权限。本次没有进行音轨播放；实际接入时按最新凭据要求及流接口文档实现，并检查曲目访问限制。

[Jamendo tracks 官方文档](https://developer.jamendo.com/v3.0/tracks)要求 client_id，返回 audio / audiodownload，并明确以 audiodownload_allowed 控制是否能在应用提供下载。可包含歌词与许可证信息，但并不保证同步歌词。适合增加独立音乐，不能作为主流中文商业曲库替代。

[Radio Browser 官方 API](https://docs.radio-browser.info/)提供电台名称、国家、标签、codec、hls、url_resolved、lastcheckok 等。爵士电台搜索本次 HTTP 200，返回 MP3 与 AAC+ 地址。lastcheckok 来自目录服务端探测，不代表已在此客户端播放成功。

电台需要独立的直播播放状态：通常无固定时长、不能 seek，不能套用单曲完成后下一首的判断；HLS 电台需接入相应播放引擎。

## 官方订阅音乐平台的边界

### Apple Music

[MusicKit 官方说明](https://developer.apple.com/musickit/)允许网站用 MusicKit Web Components 或自定义 JavaScript 播放界面，并检查用户订阅。

[Developer Token 文档](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)要求 Apple Developer Program 开发者身份，以及签名的 ES256 JWT。[Media ID / 私钥设置](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/)解释如何建立签名凭据。签名私钥应由服务端持有，客户端获取开发者 Token；用户权限使用独立认证流程。

“可自定义播放器界面”不代表获得原始 MP3 / FLAC 地址、可导出文件或可接入当前 Web Audio 音频图。需要独立 MusicKit 播放适配器，把进度和状态映射到 UI，并实测当前 Electron 44 的授权、origin 和受保护播放。项目现有 Apple Music 风格歌词只是一种 UI，不代表已接入 Apple Music。

### Spotify

[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)要求有效 Premium 订阅，使用 SDK 建立 Spotify Connect 播放设备。支持常见浏览器不等于官方明确支持本项目 Electron 环境。

[官方配额模式](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)当前规定开发模式最多 5 个授权用户，应用所有者需要 Premium；扩展配额申请面向组织，并列出已上线服务、至少 250k MAU 等条件。个人项目公开分发存在显著门槛，不能承诺所有用户直接登录使用。

[2026 年 2 月迁移说明](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)还列出开发模式接口变动，例如搜索 limit 最大 10，以及歌单条目访问规则变化。需以目标应用当前模式核对接口权限。

曲库 API 元数据、SDK 播放、官方客户端控制属于不同能力。SDK 完整播放需要独立实现并验证加密媒体环境；现有直接音频下载、均衡器与频谱不能自动复用。

### TIDAL、SoundCloud、Deezer、YouTube Music

[TIDAL 官方 Web SDK](https://github.com/tidal-music/tidal-sdk-web)确实有认证、API 与播放器模块，不能声称没有官方方案。本次只确认 SDK 存在，未验证应用准入、会员播放和 Electron 环境，适合后续专项评估。

SoundCloud 与 Deezer 的关键官方文档本次访问不完整，不能据网络超时推断停服、关闭 API 或不接受开发者；本报告不据此推荐为立即可用平台。

YouTube Music 的民间接口、yt-dlp 解析和 YouTube 官方 API / 嵌入播放器不是同一接入路线。项目已有 YouTube 视频解析不代表已有官方音乐目录、歌单账户与音频直放能力，需单独核实接口、条款和地区网络条件。

## 与项目源码对应的接入工作

项目有统一的部分曲目显示结构，但尚未形成完整的可扩展平台适配器。以下模块包含平台专属逻辑：

| 当前文件 | 当前职责 | 新平台需要处理的内容 |
| --- | --- | --- |
| src/api/index.js | PLATFORMS 注册，网易云 API | 平台注册、请求与能力入口 |
| src/store/platform.js | 三平台状态与刷新切换 | 平台配置、能力表、账号隔离 |
| src/router/index.js | QQ / 酷狗独立路径与守卫 | 新平台首页、搜索、详情路径 |
| src/App.vue | 导航、用户信息、搜索与音质分支 | 按能力生成菜单与选项 |
| src/components/LoginModal.vue | 平台登录分支 | 新平台认证方式 |
| src/views/Settings.vue | 平台账号和会员设置 | 服务器 / Token / 订阅状态配置 |
| src/store/player.js | 播放、预加载、歌词、喜欢、下载分支 | 解析播放源、规范曲目、平台识别及播放引擎 |
| electron/preload.cjs / electron/main.js | IPC 桥接、请求头、协议和下载 | 注册新请求通道、鉴权与媒体请求 |
| electron/lyric-providers.js | 多源歌词候选 | 可选新增歌词来源与匹配规则 |
| electron/service-lifecycle.js / 打包脚本 | 内置 API 进程生命周期 | 如果增加本地服务，补齐按需启动、退出及打包资源 |

现有 player.js 中既有 QQ 的 songmid、酷狗 hash 等平台判断，也有直接 audio.src=url 与 Web Audio 图。因此仅修改 PLATFORMS 无法完成接入。

建议在接入第四个曲库时先抽出最小适配层：

```js
// 建议接口轮廓，不是已经实现的代码。
const provider = {
  id: 'migu',
  capabilities: {
    search: true,
    lyrics: true,
    playlistWrite: false,
    download: false,
    playback: 'direct', // direct / sdk / live
  },
  search(query, options) {},
  getTrack(id) {},
  resolvePlayback(track, options) {},
  getLyrics(track) {},
  getPlaylist(id, options) {},
}
```

直链播放统一返回地址、过期时间、格式、时长、试看状态与主进程需要的请求头；SDK 播放通过 play / pause / seek / state 等方法接 UI。平台能力与单首歌曲权限都需要判断，例如平台支持下载但某首曲目不允许下载。

统一曲目至少包含 providerId、字符串 trackId、title、artists、album、artwork、durationMs、平台原始引用与权限状态。歌曲身份使用 providerId + trackId，队列中的重复条目继续保留独立 queueItemId。服务凭据与鉴权媒体地址不要写入可分享日志或普通曲目缓存。

播放器遇到未知平台应明确报错，避免继续落入网易云默认分支。歌词匹配应结合名称、歌手、版本和时长；无逐词数据时不能伪造逐词精度。

## 可独立增加的歌词与元数据来源

[LRCLIB](https://github.com/tranxuanthang/lrclib)提供同步与纯文本歌词。本次 GET lrclib.net/api/search?track_name=Yellow&artist_name=Coldplay 返回多条版本，具有 plainLyrics 与 syncedLyrics。适合作为现有歌词候选的补充；它不提供歌曲音频，本次返回的同步 LRC 也不等于逐词歌词。

[MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)可补充歌手、唱片、录音与发行元数据，适合本地音乐标签和封面匹配，不是播放源。官方要求有意义的 User-Agent、每个客户端不超过每秒一个请求；非商用免费，商用有单独方案。

[MusicFreePlugins 当前 README](https://github.com/maotoumao/MusicFreePlugins)明确已移除国内音乐厂商源，仓库为 GPL-3.0。可以参考其协议与适配器设计，但不能假定“下载插件集合就能获得稳定国内全平台播放”，也不能直接复制代码而忽略许可证。

## 建议实施与验收顺序

1. 以咪咕做国内曲库试接：搜索、详情、歌词、歌单分别检查业务码与字段，再验证用户正常权限下的播放。先解决新平台识别和最小适配层。
2. 复用 B站音轨做仅音频播放入口；另一路增加 OpenSubsonic / Navidrome 服务器连接。
3. 按用户需求添加 Jellyfin、Audius、Jamendo 或电台。
4. 酷我、汽水继续独立验证上游接口；Apple Music / Spotify / TIDAL 先验证开发者准入与 SDK 播放，再建设页面。

每个平台的最小验收应覆盖业务成功码、空结果、错误返回、分页、歌曲 ID 和时长单位；播放覆盖完整 / 试看标识、音频非零信号、暂停恢复、seek、地址过期重取、切歌与关闭释放。歌词检查版本、时间单位与缺失回退；下载和写操作只按真实权限开放。文档验证、目录请求和客户端实际播放的结果分别记录。

当前真实验证范围：咪咕游客搜索与详情、Audius 热门曲目目录、Radio Browser 电台目录、LRCLIB 歌词搜索；酷我裸搜索返回业务拒绝。其余结论来自源码和官方文档。未进行会员媒体播放、授权账号登录与写操作、长时间电台收听或平台全曲库覆盖验证。

## QQ 音乐现状审计：接口很多，但功能边界没有收拢

QQ 音乐已经有一套较大的 IPC 接口集合，前端只使用了其中一部分，且部分入口主动禁用了已存在的写操作。通过统计 `ipcMain.handle()`，当前 `electron/qq-music.js` 实际注册 **42 个 QQ 通道**，文件中的“35 个”注释已过时。通道涵盖搜索、歌曲信息、播放、歌词、专辑、歌手、歌单、排行榜、评论、用户歌单、我喜欢、歌单操作、MV、下载、推荐和登录；`src/api/qq.js` 将它们封装为函数。不能把接口数量当作用户功能完整度。

本次源码核对出的具体情况：

| 能力 | 当前代码状态 | 影响 |
| --- | --- | --- |
| 搜索 | `src/views/qq/Search.vue`支持歌曲、歌手、专辑、歌单、MV；`electron/qq-search.js` 的公开回退只覆盖歌曲与专辑 | 上游桌面搜索失败时，不同搜索类型的可靠性不一致 |
| 播放 | `src/store/player.js` 按 `songmid` 调 `qqSongPlay`，依赖 QQ Cookie；无 URL 时提示版权 / VIP 限制 | 这是受平台授权约束的直链播放，不能当成稳定公共音源 |
| 下载 | `downloadQQSong`按用户音质回退链取地址后交给 `download-song` | 下载链路存在，但有已确认的错误变量作用域问题，详见下表 |
| 登录 | 实际主路径是 Electron 打开 `y.qq.com` 收集完整 Cookie；API 二维码函数仍保留 | 两套登录路径并存，维护和排障成本高 |
| 用户歌单 | `qq-user.js` 能拉取歌单并识别 `likedPlaylistId`；`qq/Liked.vue` 能读取我喜欢 | 读取能力存在，和通用平台侧栏 / 歌单编辑没有完全统一 |
| 红心 | `electron/qq-music.js` 已实现 `qq:oper-mylike`；但 `player.js` 的 `toggleLike()` 对 QQ 直接提示“请前往官方 App”，不调用它 | 用户看到的是明确的未完成能力 |
| 歌单写操作 | `qq:oper-songlist` 已实现 add / del / addsong / delsong；`SongDetail.vue` 对 QQ 隐藏“收藏到歌单”入口 | 已有 IPC 没有形成可见功能 |
| 评论 | `SongDetail.vue`有新版歌曲评论调用；歌单使用的`QQComment.vue`仍按旧参数和旧返回字段调用 | 歌曲详情和歌单页行为不一致，歌单评论无法按预期读取 |
| 专辑 / 歌手 / 歌单详情 | 有独立 QQ 路由和页面 | 页面多，但规范化和能力判断仍散落在各组件 |
| 时长、封面、VIP | `normalizeQQSong`兼容多种字段并补全详情；播放时又特殊处理 QQ 时长 | 字段兼容逻辑较多，应集中到 provider 适配器 |

以下属于可直接从源码确认的具体缺口，应排在泛化重构之前修复：

| 缺口 | 源码证据 | 实际影响 |
| --- | --- | --- |
| 排行榜进入错误的详情路径 | `qq/Discovery.vue:128`把`topId`传给`goToPlaylist()`；该方法跳转`/qq/playlist/:id`，详情调用普通歌单 API。`qqRanks`仅声明，没有页面调用方 | 榜单 ID 被当作普通歌单 ID，榜单歌曲详情链路未完成 |
| 评论组件协议未迁移 | `QQComment.vue:51`将`biztype`放在新版`qqComments()`的`songid`位置，并传`cmd=2`；最新评论用`cmd=1`。新版要求歌曲 ID、`cmd=6/8`，响应为`data.comments`，组件仍读`commentlist` | 歌单 ID 被错传、热评 / 最新参数错误、即使响应有数据也不按新结构显示；主进程还固定`biztype=1`，无法正确支持歌单评论 |
| QQ 失败下载抛额外异常 | `player.js:2782`在`if (!url)`块内声明`let lastError`，`player.js:2805`在该块之外引用 | 已登录但所有音质均无下载地址时触发`ReferenceError`，无法显示预期的失败原因 |
| 喜欢与歌单分页没有形成完整链路 | `fetchLikedSongsDirect`和`fetchUserPlaylistsDirect`收了`offset/limit`但没有使用；喜欢列表固定`hasMore:false`，前端一次读取 | 上游若截断歌曲 / 歌单，客户端不能继续取余下内容；本次没有真实大歌单验证，因此不能指定实际截断数量 |
| 曲目转换丢弃 QQ 信息 | `normalizeQQSong`带`songid/albummid/isVip`，但`toQQTrack`没有保留这些字段；播放器再生成当前曲目时也没有`songid` | 评论和账号操作需要补查数字 ID，VIP 与专辑信息可能在转换后丢失 |

现用 API 包是 `@sansenjian/qq-music-api` 2.4.0。其[上游仓库](https://github.com/sansenjian/qq-music-api)本次 GitHub API 显示最后 push 为 2026-09-29、未归档。因此不能简单归因于“QQ 依赖已停维护”；本项目自己的协议对接、入口和数据转换也需要修补。

因此 QQ 的首要工作不是继续增加 IPC 数量，而是做一次**能力收敛**：

1. 保留一条登录主路径（建议官网登录收集完整 Cookie），把 API 二维码路径标记为实验或移除未使用入口。
2. 建立 QQ provider，把搜索、详情、播放、歌词、评论、用户歌单、红心、歌单写操作和下载列成显式 capabilities；页面按能力显示入口。
3. 决定红心 / 歌单操作的交付边界。若 `oper-mylike` 和 `oper-songlist` 没有稳定验收，就继续只读并明确能力状态；若要开放，就补齐成功码、失败码、登录过期、签名和刷新后的状态同步。先通过测试证明上游可用，不能只去掉禁用逻辑。
4. 把 `normalizeQQSong`、`toQQTrack`、封面补全、时长单位转换和 VIP 判断移动到 provider 内，`player.js` 只接收统一曲目与 `resolvePlayback()` 结果。
5. 把 QQ 的下载、播放和歌词错误归一为 `unauthorized`、`vip_required`、`expired_url`、`copyright_unavailable`、`upstream_error`，由 UI 统一提示；不要在播放器、详情页和 IPC 各自拼接文案。
6. 为搜索回退加能力表：歌曲 / 专辑目前有公开回退证据，歌手 / 歌单 / MV 只能在主 API 成功时显示，不要把回退失败误报为无结果。

## 汽水音乐的接入建议：先做信息源，不要直接复制 QQ 页面

汽水和 QQ 的产品能力、授权方式和媒体接口不同，不适合复制现有 QQ 的“搜索 + Cookie + songmid + 直链下载”模型。[guowenye/qishui-api](https://github.com/guowenye/qishui-api)虽在 2026-07-26 仍有更新，但其 README 和 [qishuiClient.js](https://github.com/guowenye/qishui-api/blob/main/src/qishuiClient.js)明确记录了 PC 搜索 / 详情的 Cookie、`X-Helios` / `X-Medusa` 头要求，以及 `media/player` 的脱敏字段。

适合分三层推进：

| 阶段 | 功能 | UI 表现 |
| --- | --- | --- |
| A：目录试接 | 逐项验证搜索、推荐、歌单、歌曲详情、封面、时长、作者页；搜索 / 详情仍可能需要登录和签名 | 仅对已验证的目录能力提供入口，播放按钮按单曲能力控制 |
| B：已验证播放 | 在合法登录态下获取可播放响应，处理短期 URL、鉴权头、试看 / VIP 标记 | 只有单曲确认 `playable` 才显示播放按钮；不显示统一下载按钮 |
| C：账号能力 | 登录、个人歌单、收藏、历史、同步 | 逐项按接口成功码开放；失败时保留只读目录 |

汽水 provider 不应复用 QQ 的 `songmid` 字段，应使用汽水自己的字符串 ID、分享链接或媒体引用；播放结果应包含 URL 有效期、请求头、登录要求、是否试看和是否允许下载。由于本次没有运行汽水真实上游 smoke test，短期不建议将其加入全局默认平台切换，也不建议复制 QQ 的完整歌单 / 账号页面后再逐个删功能。

## “集成不完整、很杂”的根因与最小整理方案

当前平台逻辑主要由 `src/api/*`、`src/store/player.js`、各平台页面、`electron/*` IPC 和登录 Store 共同决定。三平台差异通过 `if (platform === ...)` 分散在播放器、详情、设置、导航、下载和歌词中；增加汽水会继续放大这种分支数量。

建议先做不改变用户界面的内部整理，再新增汽水：

- `src/providers/`：每个平台一个 provider，集中 ID 规范化、能力、搜索、详情、播放、歌词和账号操作。
- `src/providers/capabilities.js`：统一定义 `search / playlistRead / playlistWrite / like / lyrics / comments / playback / download / login`，支持 `readonly / unavailable / direct / sdk / live` 等状态。
- `src/store/player.js`：只根据 `track.providerId` 找 provider；移除 QQ、酷狗、网易云专属字段判断和重复 URL 回退。
- `src/components/SongActionsMenu.vue`、`SongDetail.vue`、`Settings.vue`：按能力渲染操作；例如 QQ 当前 `like` 与 `playlistWrite` 应明确为 `unavailable`，而不是显示一个点击后提示去官方 App 的假入口。
- `electron`：保留主进程处理 Cookie、签名、请求头和下载；渲染进程不保存短期播放 URL 的长期副本。
- 每个平台写一张验收表：目录、播放、歌词、收藏、歌单写入、下载分别记录 `verified / partial / unavailable`，不要用一个“已接入”布尔值概括。

QQ 的近期交付应先覆盖正确榜单详情、评论协议、下载错误处理、曲目字段和列表完整性，然后收拢现有能力入口。汽水优先完成接口验证，再逐步开放目录与播放。

本轮 QQ 结论来自人工源码调用链核查。CodeRabbit CLI 本机未安装，未进行 CodeRabbit 自动审查；没有运行账号写操作、真实会员播放或业务代码修复。
