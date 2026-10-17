# 四平台 API 操作与登录方式审阅清单

范围以用户提供的 `反编译/api-analysis/全部API清单.md` 及其四平台原始 JSON 为准；更新时间：2026-10-16。清单已完成，现按用户授权逐平台实施；汽水短信及语音验证码为本批新增，完整进度见接入与验收记录。

用户要求：平台 API 中存在的登录方式及其他业务操作都纳入接入范围；广告、埋点、崩溃上报、推送 SDK、纯图片资源不做产品功能。其余未知项保留，不能因名称不熟悉而删除。这里区分“已确认声明”“字符串候选”“现有实现与验证”，不把提取到字符串说成已经可调用。

## 先看登录方式

下表列出可辨认的登录方向和代表接口。同一路径的多个版本、发码/验码/换票据/确认属于流程步骤，不重复算成一种登录方式。字符串候选的名称表示研究方向，不表示已确认该音乐业务启用。

| 平台 | 方式或流程 | APK 中的代表证据 | 当前项目与待补内容 |
| --- | --- | --- | --- |
| 汽水 | 抖音授权扫码 | `https://open.douyin.com/oauth/get_qrcode/`、`https://open.douyin.com/oauth/check_qrcode/` | APK 抖音 OAuth 为独立候选；当前实现采用官方 PC Passport + `scan_login`，使用汽水 App 搜索扫一扫，二维码生成/未扫码轮询已测，手机确认待用户测试 |
| 汽水 | 手机短信及语音验证码 | `/passport/mobile/send_code/`、`/passport/mobile/send_voice_code/`、`/passport/mobile/sms_login/` | 已按官方 PC `/passport/web/` 等价流程独立实现发码、验证码登录、多账号选择和音乐账号鉴权；54 项合约/状态断言及 Electron 表单回归通过，未实际发短信/语音，真人确认待测。单独 check_code 仍为候选 |
| 汽水 | 手机密码登录候选 | `/passport/mobile/login/`、`/passport/password/check/` | 官方 PC 登录面板只启用扫码/手机验证码；无凭据探测 `/passport/web/user/login/` 返回 error_code=16“该应用无权限”，未显示可用密码入口；APK 分支仍保留待研究 |
| 汽水 | 邮箱登录/快捷登录候选 | `/passport/email/login/`、`/passport/email/quick_login/`、`/passport/email/send_code/` | 通用 SDK 候选；尚未确认汽水服务端开放 |
| 汽水 | 运营商一键登录候选 | `/passport/mobile/mobile_card_login/`、`/passport/auth/one_login/` | 需要确认运营商取号票据与设备环境；不能用普通桌面请求假冒成功 |
| 汽水 | 设备、共享与票据登录候选 | `/passport/device/one_login/`、`/passport/share_login/`、`/passport/mobile/login_by_ticket/`、`/passport/user/login_by_verify_ticket/` | SDK 流程线索，需恢复票据来源、用户确认与账号归属 |
| 汽水 | 其他扫码/授权分支 | `/passport/mobile/get_qrcode/`、`/passport/mobile/check_qrconnect/`、`/passport/related_login/get_qrcode/`、`/passport/web/confirm_qrcode/` | 与现有汽水 PC Passport 扫码流程分别核对；QQ/微博 OAuth SDK 常量也有记录，但不据此认定汽水账号支持这些第三方登录 |
| 汽水 | Cookie 导入 | 项目补充；用 `/luna/me` 验证账号 | 已有入口和官方鉴权；用户授权的真实 Cookie 会话恢复、只读业务与整曲播放通过 |
| QQ | QQ 扫码、QQ 账号密码 | `https://y.qq.com/m/client/qr_code_login/index.html`、QQ OAuth SDK；`music.login.LoginServer::Login` | 项目通过官方登录窗口提供；与 APK 原生 RPC 的签名/票据契约分别核对 |
| QQ | 微信登录 | 当前官方 Web 登录窗口支持；APK 的 `Login`/`Authorize` 需继续恢复渠道参数 | 官方窗口微信二维码已生成和解码；真人确认待用户测试，不凭通用 RPC 名认定具体渠道参数 |
| QQ | 手机验证码登录 | `music.login.LoginServer::SendPhoneAuthCode`、`music.login.LoginServer::Login` | 已按 APK 参数独立接入发码、验证码提交和账号鉴权，使用 commct=11、cv/v=20090008；38 项合约/状态断言与生产表单模拟回归通过。未实际发送短信或完成真人验证；需绑定/安全验证时显示官方结果 |
| QQ | 运营商一键登录候选 | `music.login.LoginServer::GetPhoneNoWithMask`、`music.login.LoginServer::GetURLsOfCarriers` | 有明确 RPC 配对；需恢复取号和授权闭环，尚未成为独立登录入口 |
| QQ | 授权、设备登录与续期 | `music.login.LoginServer::Authorize`、`music.periphMgr.PeriphMgrSvr::EarphoneLogin`、`music.periphMgr.PeriphMgrSvr::RefreshToken` | Authorize 是登录辅助；耳机登录属于外设业务，不能误标为普通桌面账号登录 |
| QQ | Cookie 导入 | 项目已有凭据导入和官方鉴权 | 已有入口、加密持久化及重新鉴权；用户授权的真实会话恢复、只读业务与播放通过 |
| 网易云 | 网易云 App 扫码 | `api/login/qrcode/server/login`、`login/qrcode/server/login` | 项目独立 Web 扫码链路已连接；生成/取消已测，真人确认待测 |
| 网易云 | 手机号密码 | `/api/login/cellphone`、`/uns/sdk/login/mob/pwd/v1/login` | 现有 UI 有入口，尚未全部替换旧通道；APK 请求体与加密流程待逐项核对 |
| 网易云 | 手机短信验证码 | `/uns/sdk/login/mob/sms/v1/send`、`/uns/sdk/login/mob/sms/v1/check`、`/uns/sdk/login/mob/sms/v1/login` | 现有 UI 有验证码入口；URS SDK 与音乐业务账号交换关系待核 |
| 网易云 | 邮箱密码 | `/api/login`、`/uns/sdk/login/mail/pwd/v1/login` | 现有 UI 有入口，未全部独立替换；URS 邮箱校验分支一起保留 |
| 网易云 | 第三方 SNS/OAuth 登录候选 | `/api/middle/account/sns/login`、`/user/sns/bind-and-login`、`/uns/sdk/login/oauth/v1/login` | APK 有 QQ/微信/微博 SDK 线索；逐渠道确认音乐账号交换、回调与绑定，不把 SDK 地址当作已启用渠道 |
| 网易云 | 运营商一键登录候选 | `/uns/sdk/login/mob/oc/v1/pre`、`/uns/sdk/login/mob/oc/v1/oq`、`/uns/sdk/login/mob/oc/v1/login` | 需运营商票据；桌面适用性待核 |
| 网易云 | 快捷、切换账号与续期 | `/login/quicklogin`、`api/login/switchuser`、`/login/token/refresh`、`login/relogin` | 路径候选保留，需分别确认凭据类型与流程 |
| 网易云 | Cookie 导入 | 项目补充官方账号查询校验 | 已有入口和官方鉴权；用户授权的真实会话恢复、只读业务与播放通过 |
| 酷狗 | 酷狗 App 扫码 | 项目补充官方 Web `login-user.kugou.com/v2/qrcode`、`get_userinfo_qrcode` | 已有独立链路；未确认前不建立登录态，真人确认待用户测试；不冒充 APK 提取记录 |
| 酷狗 | 手机号登录与验证码 | `login.user.kugou.com/v4/login_by_mobile`、`/v7/login_by_verifycode`、`/v8/send_mobile_code` | UI 已有短信入口，部分仍走旧通道；原 APK 含 HTTP 常量，不能直接据此发送凭据，需确认现行 HTTPS 契约 |
| 酷狗 | 用户名/密码 | `login.user.kugou.com/v9/login_by_pwd` | UI 已有入口，待独立替换与真实账号验收 |
| 酷狗 | 第三方开放平台登录候选 | `login.user.kugou.com/v6/login_by_openplat`、`token.user.kugou.com/v1/get_third_token`、`/v2/get_third_token` | 旧代码存在微信交换流程，但当前登录弹窗未全部展示；QQ/微博 SDK 也有记录，需逐渠道恢复、测试 |
| 酷狗 | 运营商一键登录候选 | `/idap/v2/ssoLoginEn`、`/v3/sdk/ssoLoginGen`、`/token/codeAuthToken`、`/token/netInfoAuthToken` | SDK 线索，需核取号授权、票据来源和桌面适配 |
| 酷狗 | Token/Cookie 与恢复登录 | APK `/v5/login_by_token`；项目补充官方 Web 与概念版会员鉴权 | 对照正常旧版确认概念版凭据作用域，优先概念版鉴权并保留业务 Token；真实会员、9 个个人歌单、72 首喜欢歌曲、FLAC 播放恢复。Web 验证可用不等于概念版云歌单可用；手机新扫码确认仍待验收 |

**登录的配套操作也在范围内**：短信/语音/邮箱验证码发送和校验、图形/安全验证、登录状态、刷新与失效、退出、设备管理、绑定/解绑/换绑、账号列表/切换、密码设置/修改/找回、注册/注销的候选记录均保留。各平台有不同子集；具体以逐项表为准，不能假定四个平台都有相同能力。

完整的登录相关逐项表：[LOGIN-OPERATIONS.md](api-review/LOGIN-OPERATIONS.md)。原“登录与会话”分类存在误分，例如 AI 聊天 session 和歌手 author 搜索；这些记录保留，但不算登录方式。

## 除登录外，要审阅和接入哪些操作

以下是操作层面的范围，平台实际存在的子项以对应原 ID 为准。这里没有把“基础播放做完”当作“平台全部功能做完”。

| 功能范围 | 纳入审阅的操作 |
| --- | --- |
| 搜索 | 单曲、歌手、专辑、歌单、视频及其他内容搜索；搜索建议、默认关键词、热搜、分类、分页、歌单内搜索 |
| 歌曲与播放 | 曲目详情、音源授权、音质/权限、试听与整曲识别、相关歌曲、播放记录；下载权限和下载地址候选 |
| 歌词 | 普通/逐字歌词、翻译/注音/演唱注释、歌词字体/动画/特效、歌词海报、相关编辑候选 |
| 歌单与收藏 | 推荐/分类/标签/详情/分页；创建/删除/重命名/描述/封面/隐私；加歌/删歌/排序；收藏/取消；导入与任务状态；共享/协作歌单候选 |
| 歌手与专辑 | 歌手目录/分类/详情/歌曲/专辑；专辑列表/曲目/收藏；关注、动态、数字专辑及已购资产 |
| 推荐、电台、播客 | 发现页、个性推荐、每日推荐、私人电台、频道、播客/长音频、推荐反馈/不感兴趣、历史推荐 |
| 排行榜 | 榜单目录/详情/期次/歌曲分页；歌手、播客、视频和好友排行候选 |
| 评论与互动 | 评论/热评/回复/分页、发表/删除、点赞/取消；表情、语音评论及相关权限候选 |
| 账号与社交 | 自己/他人主页、昵称头像和资料、关注/粉丝、黑名单、听歌历史/统计、动态、分享、通知/私信等候选 |
| 云盘与上传 | 云盘文件/曲目匹配、上传/分片/完成/状态、添加/删除文件与云歌单同步；上传凭据只是相关步骤，不能单独当音乐功能 |
| 视频与 MV | 视频/MV 详情、列表/榜单、播放地址与权限、收藏、视频歌单及关联歌曲 |
| 会员与商业 | 会员状态/权益、音质与下载权限、数字专辑/已购内容、商品/订单/购买/礼物等候选；广告已排除 |
| 扩展业务 | AI 对话/创作/改词/作品进度与管理、音效/混音、一起听/房间、K 歌/直播、活动/签到/任务等 APK 中保留的线索；分别核音乐业务归属与桌面适用性 |
| 配置和其他 | 与功能有关的配置、开关、协议和能力查询；未能解释的路径/模块保留待核，不一概删除，也不直接认定为需要新增的页面 |

## 各平台的具体操作例子

这些名称是按声明、RPC 名或路径作的用途摘要。对字符串记录只是解释线索，不能替代参数/权限与真实调用验收。完整列表远多于下表；按平台分文件列出，不在此隐藏未认识的项。

| 平台 | 操作 | 原始路径或 RPC |
| --- | --- | --- |
| 汽水 | 多类型搜索、搜索分类、联想词 | `/luna/search/{search_type}`、`/luna/search-categories`、`/luna/suggest-words/:{suggest_type}` |
| 汽水 | 发现歌单、榜单 | `/luna/discover/mix`、`/luna/charts/{chart_id}` |
| 汽水 | 歌单详情、歌单内搜索、导入进度 | `/luna/playlist/detail`、`/luna/playlist/search`、`/luna/me/playlist/import_task_info` |
| 汽水 | 创建/编辑/删除歌单 | `/luna/me/playlist`、`/luna/me/playlist/update`、`/luna/me/playlist/delete` |
| 汽水 | 加歌、删歌、排序 | `/luna/me/playlist/media/append`、`/luna/me/playlist/media/delete`、`/luna/me/playlist/media/sort` |
| 汽水 | 收藏和取消收藏 | `/luna/me/collection/media`、`/luna/me/collection/media/delete`；album/artist/playlist 分支 |
| 汽水 | 歌手作品与专辑曲目 | `/luna/artists/{artist_id}/tracks`、`/luna/artists/{artist_id}/albums`、`/luna/albums/{album_id}` |
| 汽水 | 评论、回复、发布、删除、点赞操作 | `/luna/comments`、`/luna/comments/{comment_id}/replies`、`/luna/comments/create`、`/luna/comments/delete`、`/luna/comments/action` |
| 汽水 | 关注、粉丝、最近播放 | `/luna/me/follow`、`/luna/me/unfollow`、`/luna/users/{user_id}/follower`、`/luna/me/recently-played-media` |
| 汽水 | 下载权限、已购专辑、购买 | `/luna/commerce/v2/check_download`、`/luna/me/assets/albums`、`/luna/commerce/v2/purchase` |
| 汽水 | AI 作品编辑准备、生成进度、下架 | `/luna/ai/creation/song/prepare_edit`、`/luna/ai/creation/song/progress`、`/luna/ai/creation/track/take_down` |
| 汽水 | AI 会话列表与歌词编辑 | `/music-agent/chat/session/list`、`/music-agent/chat/message/edit-lyrics` |
| QQ | 移动端搜索、热搜 | `music.search.SearchCgiService::DoSearchForQQMusicMobile`、`music.musicsearch.HotkeyService::GetHotkeyAllBusinessForQQMusicMobile` |
| QQ | 榜单目录与详情 | `music.musicToplist.Toplist::GetAll`、`music.musicToplist.Toplist::GetDetail` |
| QQ | 歌单读取、创建、删除 | `music.musicasset.PlaylistBaseRead::CgiGetPlaylistByUin`、`music.musicasset.PlaylistBaseWrite::AddPlaylist`、`music.musicasset.PlaylistBaseWrite::DelPlaylist` |
| QQ | 歌单分类、互动歌单 | `music.playlist.PlaylistSquare::GetAllTag`、`music.interactiveplaylist.InteractivePlWrapper::AddPlaylistV3` |
| QQ | 专辑曲目、歌手歌曲与歌手目录 | `music.musichallAlbum.AlbumSongList::GetAlbumSongList`、`music.musichallSong.SongListInter::GetSingerSongList`、`music.musicSinger.MusicSingerTabSrv::GetSingerList` |
| QQ | 歌词、演唱注释、歌词动画 | `music.musichallSong.PlayLyricInfo::GetPlayLyricInfo`、`music.musichallSong.PlayLyricInfo::GetSingingAnnotationsInfo`、`music.playerStyle.LyricAnimationSvr::GetAnimation` |
| QQ | 微云歌曲匹配、上传、删除 | `music.WeiyunMusic.WeiyunMusicRead::GetMatchAudio`、`music.WeiyunMusic.WeiyunMusicWrite::UploadAudio`、`music.WeiyunMusic.WeiyunMusicWrite::DeleteAudio` |
| QQ | 不感兴趣、撤销与列表 | `music.feedback.FeedbackBlack::AddDislike`、`music.feedback.FeedbackBlack::CancelDislike`、`music.feedback.FeedbackBlack::GetDislikeList` |
| QQ | 用户资料与主页背景设置 | `music.UserInfo.userInfoServer::AlterUserInfo`、`music.UnifiedHomepage.HomepageBgPicSrv::SetBackgroundPic` |
| QQ | AI 根据内容建歌单、会话历史 | `music.aiAssistant.AiAssistantCtrlCenter::CreatePlaylistByMusicContent`、`music.aiAssistant.AiAssistantCtrlCenter::GetSessionHistory` |
| QQ | 混音配置增添、读取、设置 | `music.superSound.SongMixerSvr::Add`、`music.superSound.SongMixerSvr::GetList`、`music.superSound.SongMixerSvr::SetList` |
| QQ | 下载券与 MV 授权 | `music.musicmallcgi.SongDownloadTicketCgi::GetTicketCount`、`music.musicmallcgi.SongDownloadTicketCgi::WriteOffTicket`、`music.stream.MvUrlProxy::GetMvUrls` |
| 网易云 | 搜索默认词、联想、歌曲列表 | `/api/search/defaultkeyword/get`、`/api/search/suggest/keyword/get`、`/api/search/song/list/page` |
| 网易云 | 歌曲详情、播放授权、歌词 | `/api/v3/song/detail`、`/api/song/enhance/player/url/v1`、`/api/song/lyric` |
| 网易云 | 歌单详情、创建、删除 | `/api/v6/playlist/detail`、`playlist/create`、`playlist/delete/` |
| 网易云 | 歌单曲目增删排序、封面与隐私 | `playlist/track/add`、`playlist/track/delete`、`playlist/track/reorder`、`playlist/cover/update`、`playlist/update/privacy` |
| 网易云 | 精品歌单、标签、收藏 | `/api/playlist/highquality/list`、`/api/playlist/highquality/tags`、`playlist/subscribe`、`playlist/unsubscribe/` |
| 网易云 | 共享歌单邀请、退出、关闭 | `playlist/shared/invite`、`playlist/shared/quit`、`playlist/shared/close` |
| 网易云 | 歌单导入检查与任务进度 | `playlist/import/url/check`、`playlist/import/task/status/v2` |
| 网易云 | 专辑详情、收藏和取消 | `album/v4/detail`、`album/sub`、`album/unsub` |
| 网易云 | 云盘上传信息、状态、文件播放地址 | `upload/cloud/info/v2`、`v1/cloud/music/status`、`/api/cloud/mobile/drive/file/playUrl` |
| 网易云 | 电台详情与播放记录 | `/api/djradio/v3/get`、`/api/dj/playrecord/radio/get` |
| 网易云 | 一起听歌单同步、下载地址候选 | `listen/together/sync/playlist/get`、`song/enhance/download/url/v1` |
| 酷狗 | 云歌单列表、新建、删除 | `gateway.kugou.com/cloudlist.service/v8/get_all_list`、`/cloudlist.service/v4/add_list`、`/cloudlist.service/v3/delete_list` |
| 酷狗 | 歌单加歌、删歌、曲目排序 | `gateway.kugou.com/cloudlist.service/v4/add_song`、`/cloudlist.service/v4/delete_songs`、`/cloudlist.service/v2/modify_song_sort` |
| 酷狗 | 云盘增加文件 | `musiccloud.kugou.com/api/cloud/add_files`、`gateway.kugou.com/mcloudservice/v3/add_files` |
| 酷狗 | 歌手详情、目录、专辑 | `mobilecdn.kugou.com/api/v3/singer/info`、`gateway.kugou.com/ocean/v6/singer/list`、`/ocean/v6/singer/album` |
| 酷狗 | 专辑曲目、数字专辑资产 | `openapi.kugou.com/kmr/v1/album_songlist`、`gateway.kugou.com/zhuanjidata/v3/asset/album_sale_info` |
| 酷狗 | 歌词搜索与下载 | `lyrics.kugou.com/v1/search`、`http://lyrics.kugou.com/download` |
| 酷狗 | AI 歌曲收藏、列表、取消收藏、歌词 | `gateway.kugou.com/youth/v1/ai/ai_song_collect`、`/youth/v1/ai/ai_song_collect_list`、`/youth/v1/ai/del_ai_song_collect`、`/youth/v1/ai/ai_song_lyric` |
| 酷狗 | 频道歌曲收藏/取消 | `youth.kugou.com/api/channel/v1/add_collect_song`、`/api/channel/v1/del_collect_song` |
| 酷狗 | 评论主题搜索与分类 | `m.comment.service.kugou.com/subject/search`、`m.comment.service.kugou.com/v1/cmt_classify_list` |
| 酷狗 | 下载地址、上传分片与完成 | `bsstrackercdngz.kugou.com/v2/query/download/url`、`/v3/upload/bss/part`、`/v3/multipart/complete` |

## 完整逐项表与数量

| 平台 | 原始提取记录 | HTTP 声明/RPC 配对 | 已有账本明确排除 | 保留审阅 | 逐项表 |
| --- | ---: | ---: | ---: | ---: | --- |
| 汽水 | 2,323 | 293 | 194 | 2,129 | [汽水完整清单](api-review/qishui.md) |
| QQ | 3,140 | 448 | 326 | 2,814 | [QQ 完整清单](api-review/qq.md) |
| 网易云 | 3,084 | 0 | 544 | 2,540 | [网易云完整清单](api-review/netease.md) |
| 酷狗概念版 | 2,710 | 34 | 322 | 2,388 | [酷狗完整清单](api-review/kugou.md) |
| 合计 | 11,257 | 775 | 1,386 | 9,871 | [数量校验结果](api-review/summary.json) |

网易云的 0 表示旧提取器未识别到 HTTP 注解/RPC 配对，路径与 URL 记录仍存在，不能解释成没有接口。酷狗来源 APK 为酷狗概念版，不承诺已覆盖普通酷狗客户端所有操作。

9,871 是尚未被现有保守规则排除的记录，仍包含同一路径不同证据、网页、目录、SDK 和误分项，不是 9,871 个已确定要新增的功能。原始账本对部分广告/资源只做了保守识别，候选里残留的同类项继续核用途后排除。排除项可在 [EXCLUDED-RECORDS.md](api-review/EXCLUDED-RECORDS.md) 查原 ID，未丢弃原始证据。

逐项表保留原 ID、分类、归属线索、证据类型、方法/路径/RPC、声明或方法名、参数类型、请求体模型/字段线索、现有实现映射、验证级别、源码与行号。表格展示首处证据，全部证据仍在每个平台的原始 JSON 中。空参数/响应模型不补造，真实错误码与权限需后续恢复及实测。

现有覆盖账本保守映射为汽水 39、QQ 6、网易云 4、酷狗 4 条；汽水新增 3 条明确标为官方 PC Passport 等价业务，未将 APK 的未知方法猜成 GET。这个数字不包括很多官方 Web 等价实现，因此不能作为项目功能完成率。最新已有能力与测试边界见 [接入与验收记录](MUSIC_PLATFORM_INTEGRATION.md)，其“未匹配”也不能直接解读为当前项目没有该功能。

## 本次核对

生成命令：`node scripts/build-api-review-inventory.mjs`。生成器核对原 ID 唯一性、原表与覆盖账本的记录/路径/类型一致、每个平台完整输出无漏项、保留与排除数量相加一致、全部证据源码文件存在及行号为正整数。本次核对 11,257 条原记录和 5,799 个源码文件通过。生成清单不会联网或修改平台账号；另外执行的业务测试及真实接口探测分别记录在 [接入与验收记录](MUSIC_PLATFORM_INTEGRATION.md)。

后续按汽水 → QQ → 网易云 → 酷狗逐项恢复“请求合约 → 项目独立客户端 → 页面入口 → 自动测试 → 真人账号验收”，并保留旧功能与尚未替换的通道。清单持续保留未完成项；当前已进入真实账号鉴权、只读页面和播放验收，仍不能宣称全部操作接入完成。
