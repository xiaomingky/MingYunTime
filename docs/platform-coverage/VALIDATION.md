# 最新验证：2026-10-17 下载、扫码与歌单体验六项修复

本批代码与范围见接入记录末尾「六项体验修复」。新增本地真实 HTTP 测试验证直链 32/64/128 实际分片数量、默认/最低路数、逐字节一致、非Range回退、错误范围拒绝、暂停续传；深层文件名测试覆盖最终响应/中文RFC5987/重定向/HTML中转/请求头/异常，统一任务集成测试核对真实磁盘文件、手动命名与后缀、重复文件保护和center/toast事件。

QQ/微信内嵌扫码52项自动断言、官方歌曲图片38项、汽水歌单归属12项已加入全量检查。QQ和微信官方二维码真实生成及首次waiting通过；手机扫码确认尚未验收。汽水编辑/删除只在模拟账号执行，未改动用户真实歌单。网易已删除的旧权限服务完全退役，不再保留阻塞检查；历史锁测试记录仅供追溯。

本批日志：dev/six-fixes-check.log、dev/six-fixes-build.log、dev/six-fixes-electron.log；Electron综合报告dev/electron-functional/result.json。安装版未改动，未发布或制作安装包。CodeRabbit CLI本机不可用，使用本地代码复核、生产模块测试与Electron实际运行检查。

以下为历史批次，描述按当时状态保留；旧“授权窗口”已由内嵌二维码替代，旧权限锁已删除。

# 历史验证：2026-10-17 歌单管理与汽水下载封面

本批 `npm run check`、`npx vite build`、`npm run check:electron`、`npm run check:qq:login` 通过。整体检查包含会员/歌单 49 项、下载 provider 21 项、QQ 原生短信 38 项、账号隔离 36 项、音质 50 项与既有回归；Electron 实际打开 52 路由、注册 214 请求通道、12 组真实本地音频信号，报告 errors=[]。构建和回归日志分别为 `dev/library-check.log`、`dev/library-build.log`、`dev/library-electron.log`、`dev/library-qq-login.log`。

新增界面验证涵盖默认苹果风格和偏好保留、真实桌面歌词窗口/模式/颜色/透明度及持久化、管理页自建收藏分组/搜索/新建删除确认/窄屏和宽度/滚动、酷狗批量管理、网易云歌单权限检查与取消；账号写操作使用模拟传输，不改变真实歌单。QQ/微信官方授权真实窗口 9 项检查通过，包括二维码可解码、直接进入微信/密码模式、窗口隔离、取消和未确认不保存账号；真人扫码确认及接收短信仍待用户验收。

汽水真实已登录生产页面下载通过：右下角即时显示任务并完成，配置下载目录内保存 22,457,996 字节音频及 169,844 字节同名 JPG（核对 JPEG 内容）；下载文件实际解码、非零 RMS=0.129726、35 秒拖动、235.961451 秒完整时长通过。报告 `dev/library-qishui-download-live.json`，截图 `dev/library-qishui-download-live.png`。

官方 VIP 图片的 APK/接口出处见 `public/membership/SOURCES.md`。不将普通账号返回的灰色 QQ svip 图当会员。近期真实酷狗《恋人》原版 FLAC 275.913 秒、《勇气》FLAC 239.002 秒及 QQ 40 首喜欢/1 个69首收藏歌单记录保留于 `dev/qq-kugou-final-live.json`。最终独立预览版 QQ 会话缺失，原因未确定，需重新登录；不能以此前成功报告声称当前四平台仍全部在线。用户安装版未修改。

以下为历史批次记录；“本轮”“最新”仅指各记录撰写时的范围。

# 本轮验证记录

## 2026-10-17 QQ 领取会员入口

QQ 账号菜单增加「领取会员」，接入 APK 中的 `GetAdVipPointInfo`、`SendLaunchGift` 和 `UseAdFreeCard`。资格查询与账号校验在主进程执行；手动领取允许向官方提交启动赠礼请求，未确认资格时按钮显示「尝试领取会员」。已有免广告卡单独显示消耗 1 张的按钮，不自动使用。领取后查询权益，只有激活秒数或权益增加才确认到账；请求成功而权益未变时显示「已提交，待核实」。没有接入伪造广告 token/完成报告。

真实独立测试账号已恢复登录。官方查询结果：活动入口不可用、直接赠礼资格 false、免广告卡 0 张、累计激活 0 天。按用户要求实际调用一次 `SendLaunchGift`，接口请求成功，但再次查询未检测到新增时长，不能宣称获得会员。摘要保存在 `dev/qq-benefits-live-result.json`，不含凭据；页面截图 `dev/qq-benefits-live.png`。测试版已打开 QQ 领取弹窗。

`npm run check`（含新增福利 34 项断言）、`npm run check:qq:client`、`npx vite build`、`npm run check:electron`、差异空白检查通过。Electron 报告 errors=[]、49 个路由、12 组音频信号、212 个原生请求通道；新增福利菜单、资格显示、卡片消耗说明、重复点击、未确认结果、错误重试和账号切换关闭测试。日志 `dev/qq-benefits-check.log`、`dev/qq-benefits-build.log`、`dev/qq-benefits-electron.log`。CodeRabbit CLI 本机不可用，本轮采用本地审查与自动测试；未制作安装包或发布。

日期：2026-10-17。工作区：`F:/xiangmu/music`。版本：4.0.0-beta.2。本记录只描述已运行的检查，不代表全部 APK API 已完成。QQ/网易云/酷狗游客报告沿用此前批次；本轮重跑整体检查、Electron、汽水游客，以及四账号真实鉴权、播放和只读页面检查。

**网易云追加会员曲测试已通过。** 旧协议下官方确有 FLAC 的曲目返回 CDN 403；正式播放现用项目独立 XEAPI 实现，同一账号《海阔天空》标准/较高/极高/无损/Hi-Res 请求/超清母带六档全部实际解码、非零音频信号、35 秒 seek 成功，326 秒整曲。Hi-Res 请求实际普通 FLAC 如实显示。`dev/netease-lossless-quality-result.json` 8 项全通过；`dev/netease-lossless-probe-result.json` 保留旧协议 403 与独立 XEAPI 206/fLaC 对照，不抹除原问题。

最新音质修复验证：`dev/real-stream-quality-final-result.json` 25 项通过，其中四会话与酷狗喜欢歌单检查 2 项、实际授权音频解码/非零信号/35 秒 seek 19 项、官方权限拒绝结果 4 项。汽水六档 AAC/FLAC 均解码成功；网易 128/192/320 kbps MP3 成功，高档请求实际退到 320；酷狗 MP3/FLAC 成功，high 实际 FLAC、super 实际 128、两个蝰蛇请求被拒；QQ 标准 MP3/AAC 成功，320/FLAC 被当前账号权限拒绝。拒绝结果正确处理不等于播放成功，音源详情见 [接入记录](../MUSIC_PLATFORM_INTEGRATION.md)。

最新自动检查为 `dev/current-fixes-check.log`（新增音质 44、双语/会员/领取/拒绝队列 35、CENC/备用地址及瞬时网络重试、独立 XEAPI 12、凭据有效期/直接下载 20 项），`dev/current-fixes-electron.log`（211 通道/49 路由/12 组音频信号，renderer errors 为空）与 `dev/current-fixes-build.log`。本次同时修复音质切换复用旧 URL、请求档位伪装实际档位、失败伪成功、暂停/进度与迟到切换隔离。早期失败报告保留，不覆盖为成功；最终真实测试使用独立静音音频元素，不改用户当前播放状态。

2026-10-17 新增界面真实检查 `dev/session-search-playlist-result.json` 8 项通过：四平台 Cookie 正确标题、显示/隐藏和有效期说明；酷狗“恋人”“不遗憾”“恋人 李荣浩”首条均为李荣浩；网易云个人歌单首屏约 49 ms、首批 100 首约 0.4 秒，继续加载共 189 首。汽水 `sid_guard` 确有明确到期时间；其余三平台如实显示平台未提供固定期限，支持官方实时验证。

汽水直接下载根据用户明确要求，重新获取账号实际返回的播放 URL，处理 302/备用地址并保存原音频，不加下载额度硬门槛。真实 AAC 2,010,928 字节、无损 22,457,996 字节，均约 236 秒；下载后的本地文件实际解码、非零 PCM 和 35 秒 seek 均通过。下载业务写文件使用测试目录，没有执行免费 VIP 领取/评论/歌单修改等真实账号写操作。报告 `dev/qishui-direct-download-result.json`、`dev/qishui-downloaded-audio-decode-result.json`。两种详情设置液态玻璃 47 px 实际 backdropFilter 与持久化已经 Electron 断言，截图为 `dev/electron-functional/classic-liquid-settings.png`、`apple-liquid-settings.png`。

会员结论修正：QQ 官网给普通/过期用户也返回 `svip_g.png`，旧报告按 `/svip/` 误判豪华绿钻，现已排除灰图并实际确认当前普通用户。汽水双语歌词与官方会员图片已实测，免费 VIP 入口已连接官方无参数接口；用户实际点击结果为“今日已经领取过了～”（原业务码 2），不视为自动领取成功。苹果评论配色与占位文字可读性已修复。酷狗本次喜欢歌单官方返回 71 首，旧批次 72 首作为历史记录保留。

| 检查 | 结果与范围 | 证据 |
| --- | --- | --- |
| `npm run check` | 本轮通过；原回归保留；酷狗独立合约 56、账号隔离/分页 36、新增四平台会员状态 33、汽水手机登录 54、CENC 55、网易云 16、歌单评论 10 和更新版本 12 项；播放器恢复秒数/队列身份新增回归 | `dev/membership-regression.log` |
| `npm run check:electron` | 本轮通过；208 请求通道、49 路由、12 组本地音频信号、两种详情、模拟账号业务、娱乐区 CS/VAL 大局及小局比分；renderer errors 为空 | `dev/electron-functional/result.json`、`dev/membership-electron-regression.log` |
| 四账号鉴权与真实播放 | 17 项通过：四会话官方鉴权恢复；汽水两首整曲及其余三平台各一首整曲、暂停/45 秒及结尾前 15 秒 seek/歌词、搜索/专辑等；酷狗真实 FLAC 和 9 个个人歌单恢复 | `dev/authenticated-platform-result.json` |
| 四平台会员与菜单 | 酷狗概念版 SVIP/TVIP、汽水 VIP、网易黑胶 VIP 已确认；旧报告 QQ 豪华绿钻结论已作废：官方 `svip_g.png` 是灰色邀请图标，当前按普通用户显示 | `dev/authenticated-membership-result.json`（历史）、`dev/current-fixes-real-result.json`、`dev/qq-vip-probe-result.json`（修正） |
| 旧酷狗与独立实现对照 | 旧版有效概念凭据可查询会员、9 个个人歌单和 72 首喜欢歌曲；独立实现同样通过，FLAC CDN 实际返回 206 / fLaC | `dev/kugou-old-profile-check.json` |
| 酷狗 9 个个人歌单逐页打开 | 10 项通过：歌曲数 0/72/154/189/40/94/126/109/28 与账号列表一致；概念版 QR 300px 解码/等待/取消 | `dev/kugou-library-result.json` |
| 酷狗会员歌曲实际点击播放 | 2 项通过：生产页面 VIP 标记《演员》实际 FLAC 261.250 秒、非零音频、暂停/45 秒/尾段播放；重载后仍保留正确时长及确认音质 | `dev/kugou-vip-playback-result.json` |
| 已登录只读页面扩展 | 17 项：汽水实体搜索/详情/评论/歌单内搜索/最近/个人歌单，QQ公私歌单/分页/榜单/评论，网易个人歌单/评论，酷狗专辑/歌手分页/公开歌单/个人喜欢歌单 | `dev/authenticated-browse-result.json` |
| 汽水真实游客检查 | 13 组通过：搜索/分页、封面、实体、评论、分享、官方 QR 图片与等待/取消、授权音频及歌词/暂停/seek；手机未确认 | `dev/qishui-electron/result.json`、`dev/auth-qishui-electron.log` |
| QQ 真实游客检查 | 前批 14 组通过：五类搜索、MV、297 秒整曲、专辑/歌单/榜单、歌手目录与详情分页 | `dev/qq-electron/result.json` |
| QQ/微信登录窗口 | 前批 6 项官方二维码解码、切换、取消和窗口隔离通过；不等于手机确认完成 | `dev/platform-latest-qq-login.log` |
| 网易云真实游客检查 | 前批 7 组通过：搜索/分页、实体搜索、专辑、200 首榜单、267 秒整曲、歌词与权限拒绝、官方 QR | `dev/netease-electron/result.json` |
| 酷狗真实游客检查 | 前批 10 组通过：首页/默认歌手、四类搜索/分页、公开歌单、专辑/歌手、236 秒整曲、歌词、官方 QR、失效 Cookie 拒绝 | `dev/kugou-electron/result.json` |
| `npx vite build` | 本轮 renderer、main、preload 构建通过；既有 chunk 和动态导入提示仍存在 | `dev/membership-build.log` |
| 差异检查 | `git -c core.whitespace=cr-at-eol diff --check` 通过；保留原 CRLF 文件 | 本地 Git 检查 |

真实账号测试由用户明确授权，使用独立测试版 `dev/platform-user-profile` 的四个现有会话。为排查旧版正常而新版失败的问题，只读对照安装版酷狗会话；确认同账号、官方概念版鉴权成功后恢复到独立测试版。安装版未修改，也未退出或清空登录。临时读取副本已清理，真实 profile 已加入 Git 忽略。报告仅保存数量、会员权益、时长、音频信号和错误等摘要，不保存 Cookie、Token、密钥或完整签名音源地址，不对真实账号执行发布评论、修改/删除歌单等写操作。

汽水扫码已按官方 PC Renderer 将 Passport token 转成 `https://bff-pc.qishui.com/light/invoke/scan_login` 入口，使用汽水音乐 App → 搜索 → 搜索框右侧扫一扫。生成、解码和未扫码等待已验证；手机实际扫码与确认仍未验收。不能继续使用“抖音扫码”或直接编码原 qrcode_index_url 的错误说明。

汽水已登录发现页改为签名 PC discover/mix。完整 AAC 音频改为保持 MP4 原偏移的 CENC AES-CTR 解密；两首真实账号音频时长为 297.262 / 336.432 秒。网易播放授权 encodeType 改为官方桌面协商的 flac：同账号同曲先前 AAC 音源实际返回 403，修复后的 MP3 音源实际 206、音频解码通过。QQ、网易和酷狗本轮实测时长分别为 297.240、267.246、236.693 秒；均有非零 Web Audio 信号、暂停、跳转 45 秒、结尾前 15 秒继续播放和歌词，未逐首听至结尾，也不等于全部付费/会员权益验收。

网易歌单评论的真实扩展检查发现 hotComments=[] 遮住 comments 的错误，修复后显示 20 条普通评论；新增生产 loader 测试覆盖正常空数据、权限/异常响应、重试及歌单/账号切换的迟到响应。

酷狗此前 Web 范围凭据在旧模块也返回 20017；旧安装版概念凭据则成功。已修复二维码的概念版应用上下文、优先概念版业务鉴权与凭据保存、独立 union VIP / cloudlist 列表 / listid 曲目 / tracker 音频。概念版 SVIP 有效至 2026-11-22，TVIP 至 2026-12-02；9 个个人歌单和 72 首喜欢歌曲恢复。无损 tracker 返回扁平对象，std_hash 验证原曲与 FLAC 变体的关联。官方 HTTP 音频地址保持返回协议（强制 HTTPS 证书不匹配），账号请求仍走 HTTPS，没有关闭 TLS 校验。

模拟账号套件使用替换 transport 或 API 的生产模块。真实短信/语音发码、手机扫码确认、二次安全验证交互、真实账号写入，以及全部会员曲目仍未验收。CodeRabbit CLI 本机不可用，本轮执行本地代码审查、合约检查与真实运行检查。

独立测试启动器 `dev/launch-user-preview.cjs` 使用 `dev/platform-user-profile`，CDP 端口 9331；与 `D:/MingYunTime/茗韵时光.exe` 的日常配置分开。用户已在测试版登录四个平台；本轮最新构建已重启载入，并保留这些会话。

补测过程也保留失败证据：`dev/authenticated-platform-tail-first-attempt.json` 曾记录汽水第一首未起播超时（尚未稳定复现）；随后 `dev/qishui-playback-stability-result.json` 三次连续切歌与后段播放全部通过。`dev/authenticated-platform-hidden-window.json` 记录测试窗口隐藏时封面懒加载超时，CDP 确认 visibilityState=hidden；独立测试启动器已关闭后台节流，不改变生产界面。本批 17 项真实鉴权/播放全通过，五首音频均通过结尾前 15 秒继续播放；仍保留此前偶发记录，不能据此保证所有曲目永不失败。

## 2026-10-17 下载专区、歌单切换、音质、字体和 QQ 页面复验

- 汽水下载已改为主进程账号音源 provider 加入现有下载专区，使用统一设置的下载目录、进度、历史、失败重试、取消和打开位置。重试重新获取音源，历史不保存 Cookie 或签名播放地址，切换凭据后旧任务不能继续写入。`scripts/check-provider-download.mjs` 13 项断言通过，覆盖真实文件写入、唯一文件名、历史恢复、失败重试、取消与凭据隔离，已加入 `npm run check`。
- 真实账号下载在约 12 ms 内返回任务号；下载专区完成文件 `D:/下载/汽水下载专区验证 (1).m4a`，22,457,996 bytes、235.961 秒、非试听。文件是 MP4 容器内的无损 FLAC；独立静音 Audio/Web Audio 实测解码、非零信号及 35 秒 seek，通过后清理测试音频对象，没有接管主播放器。报告 `dev/five-fixes-ui-result.json`、`dev/five-fixes-audio-result.json`。
- 网易云点击延迟定位到侧栏入口重复等待云端账号同步和密码锁检查。已确认未锁/已解锁的会话直接切页；未知状态立即显示权限检查，确认前不加载受保护歌单。实测点击真正侧栏项目约 52 ms 切换、点击过程中云端账号请求 0 次，之后加载 100 首。此证据不同于此前直接 `router.push` 的测试，后者不能证明点击入口无等待。
- 酷狗搜索结果保留官方 `MixSongID` 作为 `album_audio_id`，音质菜单明确显示“高音质 · 320 kbps”和“无损 · FLAC”。原版李荣浩《恋人》实际获得 320000 bit/s MP3 与 FLAC，两者完整时长 275.913 秒，独立音频解码、非零信号、35 秒 seek 均通过。请求 Hi-Res 的该曲官方仅返回 FLAC，按实际 FLAC 显示，不能据此宣称已取得 Hi-Res。报告 `dev/kugou-original-quality-probe.json`、`dev/five-fixes-audio-result.json`。
- 苹果详情页提供系统/本机宋体/等宽，以及思源黑体、思源宋体、马善政楷书三种在线字体。在线字体按需加载，失败有重试与本地导入提示；支持 TTF/OTF/WOFF/WOFF2，字体文件用 IndexedDB 本机保存，选择持久化。三种在线字体均验证浏览器实际 loaded face 与歌词引擎 computed font-family；通过真实文件输入导入 Arial，再切换详情风格验证恢复成功。报告 `dev/five-fixes-ui-result.json`。
- QQ 当前账号的原生歌单目录、官网个人资料和官网创建歌单三处查询均返回“我喜欢 0 首”。真实空态不会作为“已有收藏账号读取成功”证据；页面显示账号昵称与尾号、刷新和切换登录入口。253 首模拟收藏通过完整 0/100/200 偏移分页、错误/重试及失败保留旧数据测试，模拟测试不代表真实账号非空数据。
- QQ 实际界面点击推荐歌单 → 66 首歌单，新碟 → 2 首专辑，数字专辑 → 3 首专辑，李荣浩歌手歌曲/专辑翻页及专辑卡片跳转均通过。分类从“全部”切换“国语”，30 → 60 个歌单，再点击进入详情通过。分类请求错误增加明确提示/重试，旧分类的迟到响应不能覆盖新分类；失败分页保留已加载列表。报告 `dev/qq-five-fixes-browse-result.json`；另有 10 项只读真实业务接口结果 `dev/qq-current-business-probe.json`。不等于 QQ APK 全部操作已完成。

本轮自动测试日志 `dev/revision-five-check.log`，构建日志 `dev/revision-five-build.log`，Electron 回归日志 `dev/revision-five-electron.log`；Electron 结果仍使用 `dev/electron-functional/result.json`。前批手机号登录、Cookie、搜索竞态、主播放队列、桌面歌词及 CS/VAL 大局/小局比分检查继续保留。未重新发送短信、执行真实账号收藏/歌单写入、制作安装包或发布。

最终全量 `npm run check`、`npx vite build`、`npm run check:electron` 和差异检查均通过。Electron 报告 errors=[]，49 个路由、12 组本地音频信号、211 个请求通道，另含新增的 QQ 分类乱序/失败分页/重试、网易权限检查与取消交互；QQ 收藏完整 253 首模拟分页继续通过。新增网易测试最初错误地只提供一个普通歌单，侧栏按原逻辑 `playlists.slice(1)` 不展示该项，修正为“喜欢歌单 + 普通歌单”的真实列表结构后通过，没有因此更改产品侧栏逻辑。

最终重启最新独立测试版，`dev/revision-five-ready.json` 确认四个平台登录态和凭据均保留，当前已打开下载专区。汽水凭据仍在主进程保存，检查仅记录是否存在，不输出 Cookie；没有将汽水 Cookie 添加到 Pinia/localStorage。
