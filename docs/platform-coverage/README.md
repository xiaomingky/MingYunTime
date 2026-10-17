# 四平台 API 覆盖账本

生成命令：`node scripts/build-platform-coverage.mjs`。每条原始 APK 记录保留原 ID、方法、路径、分类和首个源码证据。完整参数及其他证据按 `source` 回查原 JSON；未识别方法的字符串不会被猜成 GET。

**connected 表示已连接具体实现，不等于全部验收。** `verification` 单独标注游客实测、自动测试待账号、界面待连接等状态。PC 与 Android 的等价业务会记录方法差异。QQ 仅将已实测的同名 RPC 计入此 APK 账本；其他已独立实现的公开 Web/Lite 业务另见验收记录，不将不同契约强行算成原始 API 已完成。网易云条目标为“官方 Web 等价业务”，不代表 APK 原始请求方法或参数完全对应。酷狗只映射有直接证据的歌手/歌词记录，独立 Web 搜索、详情、授权和扫码等另见验收记录。四平台尚未替换的旧通道仍保留。

只有明确的广告、埋点、崩溃上报、推送 SDK 和图片资源被排除。笼统“配置、统计与其他”分类，以及未知 SDK 字符串都保留待审；AI 创作、分享、会员、账号设置也保留。排除项仍可通过原 ID 追溯。

| 平台 | APK 记录 | 明确排除 | 已连接实现 | HTTP/RPC 待研究 | 字符串候选待审 |
| --- | ---: | ---: | ---: | ---: | ---: |
| qishui | 2323 | 194 | 39 | 237 | 1853 |
| qq | 3140 | 326 | 6 | 442 | 2366 |
| netease | 3084 | 544 | 4 | 0 | 2536 |
| kugou | 2710 | 322 | 4 | 32 | 2352 |

## HTTP/RPC 逐项状态

| 平台 / ID | 方法与路径 / RPC | 状态 | 实现与验证 |
| --- | --- | --- | --- |
| qishui-97882cd4ebc3 | GET /luna/albums/{album_id} | connected | 专辑曲目 guest-live-tested |
| qishui-969a7507096f | POST /luna/commerce/v2/album/set_default_cover | contract-research-pending |   |
| qishui-7b165424e113 | GET /luna/me/assets/albums | contract-research-pending |   |
| qishui-25ad42100dab | POST /luna/commerce/v2/check_download | contract-research-pending |   |
| qishui-42a28f7bb3a6 | GET /luna/commerce/ecommerce/order_list | contract-research-pending |   |
| qishui-ab60ce5930d9 | POST /luna/commerce/offers/purchase | contract-research-pending |   |
| qishui-47b6f45c372c | POST /luna/commerce/v2/gift/receive | contract-research-pending |   |
| qishui-c18835d16679 | POST /luna/commerce/v2/gift/send | contract-research-pending |   |
| qishui-fe11eed67e24 | POST /luna/commerce/v2/purchase | contract-research-pending |   |
| qishui-47d2c72f7061 | POST /luna/commerce/v2/purchase_product | contract-research-pending |   |
| qishui-4a72c5c1698f | POST /luna/treasure/task/browse_mall/do_action | contract-research-pending |   |
| qishui-c9e40e238bdb | POST /luna/assistant/ai_chat/feedback | contract-research-pending |   |
| qishui-1d415ef66e1f | POST /luna/discover | contract-research-pending |   |
| qishui-5993ed41953d | POST /luna/discover/mix | connected | 发现歌单 guest-live-tested |
| qishui-e15eadb43ff2 | POST /luna/feed/live-tab | contract-research-pending |   |
| qishui-72797ec48d54 | POST /luna/feed/mode | contract-research-pending |   |
| qishui-5e5d221b2801 | POST /luna/feed/mode/guidance | contract-research-pending |   |
| qishui-e16420ad8a83 | POST /luna/feed/mode/widget | contract-research-pending |   |
| qishui-ed984f43d584 | POST /luna/feed/report-info | excluded: telemetry |   |
| qishui-df7bbfac5ab2 | GET /luna/hashtag/recommend | contract-research-pending |   |
| qishui-190e4a8d80d7 | POST /luna/me/discover | contract-research-pending |   |
| qishui-9d8f412b571f | POST /music-agent/chat/feedback | contract-research-pending |   |
| qishui-36bdbfdbc822 | GET /music-agent/chat/recommend-prompts | contract-research-pending |   |
| qishui-7a749b940967 | GET luna/emoticons/recommend | contract-research-pending |   |
| qishui-07253cbb3ad9 | POST /luna/search-block | contract-research-pending |   |
| qishui-9f07b80af52d | POST /luna/search-categories | contract-research-pending |   |
| qishui-d3eea61a9520 | POST /luna/search/{search_type} | connected | 歌曲/歌手/专辑/歌单搜索（PC GET 合约） guest-live-tested |
| qishui-55d764164a3f | GET /luna/suggest-words/:{suggest_type} | contract-research-pending |   |
| qishui-fe586904e5e4 | POST /luna/ai/creation/song/prepare_edit | contract-research-pending |   |
| qishui-394e3ee1cbe7 | POST /luna/ai/creation/song/progress | contract-research-pending |   |
| qishui-650bb0285d5f | POST /luna/ai/creation/track/restore | contract-research-pending |   |
| qishui-d5b6bae507fb | POST /luna/ai/creation/track/take_down | contract-research-pending |   |
| qishui-0ac429d83c13 | POST /luna/commerce/me/entitlements/download | contract-research-pending |   |
| qishui-d90154f10f98 | POST /luna/feed/radio/tracks | contract-research-pending |   |
| qishui-c3f2eb2cdaff | POST /luna/feed/song-tab | contract-research-pending |   |
| qishui-77421ecdff53 | POST /luna/track_for_bell | contract-research-pending |   |
| qishui-4c54aa0745fc | GET /stream/atp/getAutoTrackConfig/ | contract-research-pending |   |
| qishui-da16ecb3097a | GET /luna/charts/{chart_id} | contract-research-pending |   |
| qishui-0bf416c5340b | POST /luna/me/friend_rankings | contract-research-pending |   |
| qishui-71686206cc4a | GET /luna/ent/card/collection_list | contract-research-pending |   |
| qishui-2ca55ca32deb | POST /luna/feed/playlist-media | contract-research-pending |   |
| qishui-f144d9c4ecbc | POST /luna/feed/video_playlist | contract-research-pending |   |
| qishui-9a11e3253e48 | POST /luna/me/collection/album | connected | 收藏/取消收藏 album automated-tested-account-pending |
| qishui-e5c425c0433a | POST /luna/me/collection/album/delete | connected | 收藏/取消收藏 album automated-tested-account-pending |
| qishui-15ab2a178973 | GET /luna/me/collection/artist | connected | 我的收藏分页 automated-tested-account-pending |
| qishui-b9074e433f3d | POST /luna/me/collection/artist | connected | 收藏/取消收藏 artist automated-tested-account-pending |
| qishui-f9ce3c88a5b9 | POST /luna/me/collection/artist/delete | connected | 收藏/取消收藏 artist automated-tested-account-pending |
| qishui-1e5074c11af8 | POST /luna/me/collection/media | connected | 收藏/取消收藏 media automated-tested-account-pending |
| qishui-60e45928ad90 | POST /luna/me/collection/media/delete | connected | 收藏/取消收藏 media automated-tested-account-pending |
| qishui-99482cfa6356 | GET /luna/me/collection/mixed | connected | 我的收藏分页 automated-tested-account-pending |
| qishui-bf792e60290b | POST /luna/me/collection/playlist | connected | 收藏/取消收藏 playlist automated-tested-account-pending |
| qishui-f4b69c119532 | POST /luna/me/collection/playlist/delete | connected | 收藏/取消收藏 playlist automated-tested-account-pending |
| qishui-bf26c0b79051 | POST /luna/me/playlist | connected | 新建歌单 automated-tested-account-pending |
| qishui-9affc26f6a40 | POST /luna/me/playlist/delete | connected | 删除歌单 automated-tested-account-pending |
| qishui-f28baa319324 | POST /luna/me/playlist/import_task_info | contract-research-pending |   |
| qishui-39cd04384fdf | POST /luna/me/playlist/media/append | connected | 添加歌曲到歌单 automated-tested-account-pending |
| qishui-1895dac97bf3 | POST /luna/me/playlist/media/delete | connected | 从歌单移除歌曲 automated-tested-account-pending |
| qishui-93a5b9a33398 | POST /luna/me/playlist/media/sort | connected | 完整加载的自建歌单内歌曲排序 automated-tested-account-pending |
| qishui-41fb4b77d7a2 | POST /luna/me/playlist/update | connected | 编辑歌单 automated-tested-account-pending |
| qishui-d702fbaa2709 | POST /luna/me/playlist/update_sort | contract-research-pending |   |
| qishui-4d867c23d505 | POST /luna/me/playlist/v2 | contract-research-pending |   |
| qishui-83cc38627fd4 | POST /luna/playlist/detail | connected | 歌单详情与分页 guest-live-tested |
| qishui-5249d7335c36 | POST /luna/playlist/related_media | contract-research-pending |   |
| qishui-0b7949e50b8f | POST /luna/playlist/search | connected | 歌单内搜索 guest-live-tested |
| qishui-0b05020a811a | GET /luna/user/collection/artist | contract-research-pending |   |
| qishui-f072a82e7823 | GET /luna/user/collection/mixed | contract-research-pending |   |
| qishui-0cc69d6ba50a | POST /luna/user/playlist | contract-research-pending |   |
| qishui-552a14d8a458 | GET /luna/video_playlist/detail | contract-research-pending |   |
| qishui-9f2ece609ce0 | POST  /luna/following/live | contract-research-pending |   |
| qishui-d425734823b4 | POST /luna/artist/light_up | contract-research-pending |   |
| qishui-f2ceb05ccfb0 | GET /luna/artist/profile | contract-research-pending |   |
| qishui-cc28ed50be36 | GET /luna/artists/{artist_id} | connected | 歌手详情 guest-live-tested |
| qishui-d7866cff844d | GET /luna/artists/{artist_id}/albums | connected | 歌手专辑分页 guest-live-tested |
| qishui-be3546ee4036 | POST /luna/artists/{artist_id}/tracks | connected | 歌手歌曲分页（PC GET 合约） guest-live-tested |
| qishui-a748a6e71aa9 | GET /luna/ent/product/artist_product_list | contract-research-pending |   |
| qishui-f2c7cd18b749 | POST /luna/me/follow | connected | 关注用户 automated-tested-account-pending |
| qishui-1d29edac8942 | POST /luna/me/unfollow | connected | 取消关注 automated-tested-account-pending |
| qishui-3f7a949be261 | GET /luna/users/{user_id}/follower | contract-research-pending |   |
| qishui-c50cac30626f | GET /luna/users/{user_id}/following | contract-research-pending |   |
| qishui-cf8e4d275bcc | POST /luna/lyric_poster/check | contract-research-pending |   |
| qishui-2303c5ccdd37 | POST /music-agent/chat/message/edit-lyrics | contract-research-pending |   |
| qishui-ee32320383fb | GET /studio_api/lyrics/detail | contract-research-pending |   |
| qishui-004a93d3297f | POST /studio_api/lyrics/update | contract-research-pending |   |
| qishui-661265271fda | GET /client_auth/js_sdk/config/v1/ | contract-research-pending |   |
| qishui-aa2d3b2545cb | POST /ky/compliance/v1/auth/ticket | contract-research-pending |   |
| qishui-641d29991606 | POST /ky/compliance/v1/verify_result/check | contract-research-pending |   |
| qishui-6fa7d7fb2e87 | GET /luna/device/recent-login | contract-research-pending |   |
| qishui-bcbd86512bdd | GET /music-agent/chat/session/assets | contract-research-pending |   |
| qishui-a08cc19473ff | POST /music-agent/chat/session/delete | contract-research-pending |   |
| qishui-22894c25a161 | GET /music-agent/chat/session/list | contract-research-pending |   |
| qishui-11cf4d94078c | GET /music-agent/chat/session/recovery | contract-research-pending |   |
| qishui-3f458c5f8f05 | POST /music-agent/chat/session/rename | contract-research-pending |   |
| qishui-1f01d06999a9 | POST /luna/ai/creation/mv/clip_fragments | contract-research-pending |   |
| qishui-ce4bf64a54bd | POST /luna/ai/creation/mv/create_order | contract-research-pending |   |
| qishui-81c9ff9490af | POST /luna/ai/creation/mv/estimate_credit | contract-research-pending |   |
| qishui-84fd8871498f | POST /luna/ai/creation/mv/publish_info | contract-research-pending |   |
| qishui-a651c78b1ebf | POST /luna/feed/listen-video | contract-research-pending |   |
| qishui-2fe101d6510d | GET /luna/locate_video | contract-research-pending |   |
| qishui-3fc872e22bc8 | GET /luna/me/video_list | contract-research-pending |   |
| qishui-8ae674fd02c7 | GET /luna/users/video_list | contract-research-pending |   |
| qishui-4ddedd228d15 | POST /luna/v2/feed/listen-video/inner-feed | contract-research-pending |   |
| qishui-ded993d1066d | GET /luna/v2/feed/listen-video/module | contract-research-pending |   |
| qishui-36fe166140b8 | POST /luna/v2/feed/listen-video/reminder | contract-research-pending |   |
| qishui-e972e115478d | POST /luna/v2/feed/listen-video/tab-feed | contract-research-pending |   |
| qishui-6a5460d43fe0 | GET /luna/video/uploader | contract-research-pending |   |
| qishui-253cd1b9bcdd | GET /luna/video_mix | contract-research-pending |   |
| qishui-df3cf631df62 | POST /studio_api/video/get-vid-play-info | contract-research-pending |   |
| qishui-bb52b350e629 | POST /studio_api/video/set-video-status | contract-research-pending |   |
| qishui-634cbea069dd | GET /luna/comment | contract-research-pending |   |
| qishui-e64c6e968aa2 | GET /luna/comment/audio_asr | contract-research-pending |   |
| qishui-9f900c505a13 | GET /luna/comments | connected | 歌曲/歌单评论 guest-live-tested |
| qishui-9a5ea61f6493 | POST /luna/comments/action | connected | 评论点赞/取消 automated-tested-account-pending |
| qishui-c52ad56cf366 | POST /luna/comments/create | connected | 发表评论/回复 automated-tested-account-pending |
| qishui-2a0d8c971505 | POST /luna/comments/delete | connected | 删除自己的评论 automated-tested-account-pending |
| qishui-35431e883bf2 | GET /luna/comments/{comment_id}/replies | connected | 评论回复分页 automated-tested-live-pending |
| qishui-4d0bb52b8e8b | POST /aweme/v1/aweme/stats/ | contract-research-pending |   |
| qishui-312408c3469e | POST /aweme/v1/upload/image/ | contract-research-pending |   |
| qishui-fdb844019389 | POST /aweme/v2/commerce/activity/list/impression | contract-research-pending |   |
| qishui-6a82e3ff9424 | GET /aweme/v3/user/profile/prompt/ | contract-research-pending |   |
| qishui-ab259bd40416 | POST /ky/compliance/v1/screen_time/record | contract-research-pending |   |
| qishui-bf5a792ed252 | POST /luna/commerce/v2/apply_free_vip | contract-research-pending |   |
| qishui-068e77e450f6 | DELETE /luna/me/block | contract-research-pending |   |
| qishui-fbf0f9d1908b | POST /luna/me/block | contract-research-pending |   |
| qishui-ace20d91a132 | GET /luna/me/block/list | contract-research-pending |   |
| qishui-8ace12d41390 | POST /luna/me/block_v2 | contract-research-pending |   |
| qishui-df8c62fa2eaf | POST /luna/me/block_v2/cancel | contract-research-pending |   |
| qishui-7bd3f1b206b7 | GET /luna/me/cancel | contract-research-pending |   |
| qishui-3db3806d584b | POST /luna/me/listen_stats | contract-research-pending |   |
| qishui-744862ca3bd3 | POST /luna/me/mark/media | contract-research-pending |   |
| qishui-2dd729dc7f3e | POST /luna/me/music_wall | contract-research-pending |   |
| qishui-4e5de0d98794 | GET /luna/me/privacy/setting | contract-research-pending |   |
| qishui-fd510f39683d | GET /luna/me/recently-played-media | connected | 云端最近播放 automated-tested-account-pending |
| qishui-3a343239f3dc | POST /luna/me/recently-played-media | contract-research-pending |   |
| qishui-fb046bae5861 | POST /luna/me/recently-played-media/delete | connected | 移除云端最近播放记录 automated-tested-account-pending |
| qishui-5c3681221702 | POST /luna/me/recently-played-media/v2 | contract-research-pending |   |
| qishui-9787db6ce9e3 | GET /luna/me/sharing_items | contract-research-pending |   |
| qishui-2f80b11036e1 | POST /luna/me/special_stats | contract-research-pending |   |
| qishui-1563ab99d767 | GET /luna/share/post_aweme/status | contract-research-pending |   |
| qishui-14c75f3a5a75 | POST /luna/share/user_list | contract-research-pending |   |
| qishui-5223b78b4bb4 | POST /luna/social/mate/room/user_recent | contract-research-pending |   |
| qishui-5e0809323f19 | GET /luna/user/info | connected | 用户主页（PC users/{id} 合约） guest-live-tested |
| qishui-16cfe7e10b18 | POST /luna/user/listen_duration/like | contract-research-pending |   |
| qishui-815080c1db5a | POST /luna/user/me/privacy/setting | contract-research-pending |   |
| qishui-c47a92c41b9f | GET /luna/user/mix_info | contract-research-pending |   |
| qishui-dee4fe2cd1b6 | POST /luna/user/music_wall | contract-research-pending |   |
| qishui-6a61f0dfe006 | GET /luna/user/resource | contract-research-pending |   |
| qishui-030d9d6ea97a | GET /luna/user/settings | contract-research-pending |   |
| qishui-ee9a52a2a01e | POST /luna/user/settings | contract-research-pending |   |
| qishui-0e9a69aec777 | GET /luna/users/live_room | contract-research-pending |   |
| qishui-9b2bafa086e4 | GET /webcast/fansclub/homepage/ | contract-research-pending |   |
| qishui-681dbb65e946 | GET / | contract-research-pending |   |
| qishui-999d032d120e | POST /api/ad/v1/dislike/ | excluded: advertising |   |
| qishui-ab24f48a809c | GET /api/timon_config_proxy/config/get | contract-research-pending |   |
| qishui-9d71d156acb4 | GET /common | contract-research-pending |   |
| qishui-76da782494e3 | GET /ky/compliance/teen_mode/phone_number | contract-research-pending |   |
| qishui-22e642c13754 | POST /ky/compliance/teen_mode/sms_code/check | contract-research-pending |   |
| qishui-7ec46f54c9d8 | POST /ky/compliance/teen_mode/sms_code/send | contract-research-pending |   |
| qishui-ccd6259fb7b7 | POST /ky/compliance/v1/addictions/update | contract-research-pending |   |
| qishui-b2dfe8a43496 | POST /ky/compliance/v1/password/change | contract-research-pending |   |
| qishui-97bcba569d74 | POST /ky/compliance/v1/password/check | contract-research-pending |   |
| qishui-c63b0153e6c6 | POST /ky/compliance/v1/password/update | contract-research-pending |   |
| qishui-308e420926ea | GET /ky/compliance/v1/settings | contract-research-pending |   |
| qishui-2a6788071f53 | POST /ky/compliance/v1/teen_mode/reset | contract-research-pending |   |
| qishui-505411a8f166 | POST /ky/compliance/v1/teen_mode/update | contract-research-pending |   |
| qishui-3d8761127714 | POST /luckycat/activity/i/api/v:version/resource/gcall/launch/ | contract-research-pending |   |
| qishui-3968621fe7a9 | POST /luckycat/activity/phone_score/ | contract-research-pending |   |
| qishui-50ee0a0a9839 | POST /luckycat/activity/settings/get_dynamic_settings/ | contract-research-pending |   |
| qishui-37ecfc8859db | POST /luckycat/activity/settings/get_polling_settings/ | contract-research-pending |   |
| qishui-f46f697f093f | POST /luckycat/activity/settings/get_static_settings/ | contract-research-pending |   |
| qishui-7a8e68bc6b9a | GET /luna/acquisition | contract-research-pending |   |
| qishui-53a99f32f933 | POST /luna/action | contract-research-pending |   |
| qishui-3a6c618964cb | GET /luna/activities | contract-research-pending |   |
| qishui-55698804c301 | POST /luna/activities/confirm | contract-research-pending |   |
| qishui-6322bc7b3b0f | POST /luna/ads/config | excluded: advertising |   |
| qishui-40ab58379cc1 | POST /luna/ads/dsp/retrieve | excluded: advertising |   |
| qishui-a2f7759179fa | POST /luna/ads/report | excluded: advertising |   |
| qishui-0e70d9eeff37 | POST /luna/ads/report/dsp/show | excluded: advertising |   |
| qishui-6cba6a637c1c | POST /luna/ads/retrieve | excluded: advertising |   |
| qishui-8944ad815118 | POST /luna/ads/select | excluded: advertising |   |
| qishui-44feb16c2fe6 | GET /luna/advert/fallback/done/info | excluded: advertising |   |
| qishui-b2b01e7ee124 | GET /luna/advert/incentive/config | excluded: advertising |   |
| qishui-771c5c0ea5e6 | POST /luna/advert/incentive/done | excluded: advertising |   |
| qishui-d29fc7dc9202 | GET /luna/advert/incentive/retrieve | excluded: advertising |   |
| qishui-83fedc999b13 | POST /luna/advert/splash/brand/report | excluded: advertising |   |
| qishui-cabd3496caa1 | GET /luna/advert/splash/brand/retrieve | excluded: advertising |   |
| qishui-1914a51f293e | GET /luna/ai/creation/by_spec | contract-research-pending |   |
| qishui-1ba028ce702a | POST /luna/ai/creation/center | contract-research-pending |   |
| qishui-26f372aab57c | POST /luna/ai/creation/check_perm | contract-research-pending |   |
| qishui-c653fbb5f7ff | GET /luna/ai/creation/config | contract-research-pending |   |
| qishui-809642b97b7e | POST /luna/ai/creation/delete | contract-research-pending |   |
| qishui-b60ced8c6c08 | POST /luna/ai/creation/dy_publish/sync | contract-research-pending |   |
| qishui-2d4745d48b3c | POST /luna/ai/creation/gen | contract-research-pending |   |
| qishui-1816a8978622 | POST /luna/ai/creation/get_spec | contract-research-pending |   |
| qishui-4e1f43315efc | POST /luna/ai/creation/list | contract-research-pending |   |
| qishui-73b27ae0bef9 | POST /luna/ai/creation/progress | contract-research-pending |   |
| qishui-f72760289053 | POST /luna/ai/creation/publish | contract-research-pending |   |
| qishui-3ce4707f50a6 | POST /luna/ai/creation/taken_down_list | contract-research-pending |   |
| qishui-3331888fb51f | POST /luna/ai/creation/update | contract-research-pending |   |
| qishui-bb58918ce4f1 | POST /luna/ai/creation/work/progress | contract-research-pending |   |
| qishui-6712200d98c6 | POST /luna/assistant/agent_proactive/action | contract-research-pending |   |
| qishui-cd0ab1db8b77 | POST /luna/assistant/agent_proactive/guide | contract-research-pending |   |
| qishui-534d8a210f9d | POST /luna/assistant/ai_chat/action_bar | contract-research-pending |   |
| qishui-05e16727dcc5 | POST /luna/assistant/ai_chat/adjust | contract-research-pending |   |
| qishui-df21ba532f89 | GET /luna/assistant/ai_chat/config | contract-research-pending |   |
| qishui-39bc5a371cc9 | POST /luna/assistant/ai_chat/config | contract-research-pending |   |
| qishui-878917923a10 | POST /luna/assistant/ai_chat/guide | contract-research-pending |   |
| qishui-4b2d1a5b1184 | POST /luna/assistant/ai_chat/hint | contract-research-pending |   |
| qishui-2ee57a104a27 | POST /luna/assistant/ai_chat/welcome | contract-research-pending |   |
| qishui-17c608af4332 | POST /luna/assistant/ai_proactive/action | contract-research-pending |   |
| qishui-1b1b7c45d165 | POST /luna/assistant/ai_proactive/question | contract-research-pending |   |
| qishui-723107ca108b | POST /luna/atlist | contract-research-pending |   |
| qishui-861410eeee8c | POST /luna/card | contract-research-pending |   |
| qishui-b8b934ba51d7 | POST /luna/check-update | contract-research-pending |   |
| qishui-a58547cab9c3 | POST /luna/commerce/action | contract-research-pending |   |
| qishui-f96388407dbc | POST /luna/commerce/code/check | contract-research-pending |   |
| qishui-a5709cc0ef7c | POST /luna/commerce/code/redeem | contract-research-pending |   |
| qishui-181a59463d94 | POST /luna/commerce/offers/validate | contract-research-pending |   |
| qishui-b68ecc809640 | POST /luna/commerce/v2/code/check | contract-research-pending |   |
| qishui-7130ea5854a3 | POST /luna/commerce/v2/code/redeem | contract-research-pending |   |
| qishui-a4fff4a80671 | POST /luna/commerce/v2/commerce_config | contract-research-pending |   |
| qishui-a2e429908a18 | POST /luna/commerce/v2/commerce_info | contract-research-pending |   |
| qishui-ff4eae7d8171 | POST /luna/commerce/v2/consume_benefit | contract-research-pending |   |
| qishui-bfca8f19fdf7 | POST /luna/commerce/v2/fans_nameplate_info | contract-research-pending |   |
| qishui-612b5188c6c4 | POST /luna/commerce/v2/get_room_commerce_info | contract-research-pending |   |
| qishui-b6ae1537341a | POST /luna/commerce/v2/report_action | contract-research-pending |   |
| qishui-3906189e39f3 | GET /luna/commerce/v2/upsell | contract-research-pending |   |
| qishui-49c0b804b63a | POST /luna/commerce/v2/upsell_sort_decision | contract-research-pending |   |
| qishui-22c2c4273408 | POST /luna/commerce/v2/validate | contract-research-pending |   |
| qishui-820f91587ade | POST /luna/count/shared | contract-research-pending |   |
| qishui-ddfb73645fe8 | POST /luna/device/volume | contract-research-pending |   |
| qishui-4b3aaad0ad66 | POST /luna/dislike | contract-research-pending |   |
| qishui-dd4d2e8e9e59 | POST /luna/ent/share_product_benefit | contract-research-pending |   |
| qishui-b35a66b7b87a | GET /luna/featured-content/detail | contract-research-pending |   |
| qishui-d0f4d30b61a6 | GET /luna/featured-content/list | contract-research-pending |   |
| qishui-3afda25d56eb | POST /luna/game_play/config | contract-research-pending |   |
| qishui-c0387b14c066 | POST /luna/game_play/submit | contract-research-pending |   |
| qishui-ed8f1c28b5be | POST /luna/growth/activity/finish | contract-research-pending |   |
| qishui-9c915cd3e245 | GET /luna/growth/activity_entrance | contract-research-pending |   |
| qishui-2fbb1ffe8293 | GET /luna/hashtag/detail | contract-research-pending |   |
| qishui-3901a8b9192f | POST /luna/im/send | contract-research-pending |   |
| qishui-64a3dec786da | POST /luna/item-action | contract-research-pending |   |
| qishui-dc900e3e407d | GET /luna/launch | contract-research-pending |   |
| qishui-52ab57bef02e | GET /luna/launch/device | contract-research-pending |   |
| qishui-702528011dd1 | POST /luna/live/guide-stream | contract-research-pending |   |
| qishui-3d928b0a5a30 | GET /luna/live/room | contract-research-pending |   |
| qishui-7f46c32f47a6 | POST /luna/log/event | excluded: telemetry |   |
| qishui-75baaf41aa7f | GET /luna/me | connected | 账号资料与 Cookie 会话验证 automated-tested-account-pending |
| qishui-791214fb838f | POST /luna/me | contract-research-pending |   |
| qishui-ee9c5163ac20 | POST /luna/media-stats | excluded: telemetry |   |
| qishui-2196a53125fd | POST /luna/media/assistant/related | contract-research-pending |   |
| qishui-16a5952eddaa | POST /luna/media/related | contract-research-pending |   |
| qishui-147a308a8961 | POST /luna/media_ads | excluded: advertising |   |
| qishui-028689b0b977 | POST /luna/media_v2 | contract-research-pending |   |
| qishui-14ab7ad5ed43 | POST /luna/mini_app/list | contract-research-pending |   |
| qishui-b21f14fd30ba | POST /luna/more-panel | contract-research-pending |   |
| qishui-708ca3f25bbe | POST /luna/more-panel/resource | contract-research-pending |   |
| qishui-c18e82a3e742 | GET /luna/notification/unread | contract-research-pending |   |
| qishui-8748508e1d05 | POST /luna/plug/action | contract-research-pending |   |
| qishui-dad988242e93 | POST /luna/plug/conn_plugs | contract-research-pending |   |
| qishui-596c0afd1ed5 | GET /luna/plug/visibility/detail | contract-research-pending |   |
| qishui-4bb0768c8a4e | POST /luna/plug/visibility/set | contract-research-pending |   |
| qishui-7d9fd3d8f49f | POST /luna/reco_sample | excluded: telemetry |   |
| qishui-b71b70ef4df8 | POST /luna/report | contract-research-pending |   |
| qishui-27aa2d0da259 | GET /luna/share/code/parse | contract-research-pending |   |
| qishui-9830cbad8ae7 | POST /luna/share/post_aweme | contract-research-pending |   |
| qishui-c710820e2ec9 | GET /luna/share_info | connected | 复制官方分享链接 guest-live-tested |
| qishui-5dbd4f39f0c8 | POST /luna/shark | contract-research-pending |   |
| qishui-bd0afae1124e | POST /luna/social/mate/guidance | contract-research-pending |   |
| qishui-9d83454c6a47 | POST /luna/social/mate/room/create | contract-research-pending |   |
| qishui-6cc1868c78ff | POST /luna/social/mate/room/info | contract-research-pending |   |
| qishui-750bb1f92a29 | POST /luna/social/mate/room/invite_push | contract-research-pending |   |
| qishui-c9313a36b588 | POST /luna/social/mate/room/reject_join | contract-research-pending |   |
| qishui-273c74dda557 | GET /luna/sug | contract-research-pending |   |
| qishui-3a8819cfe286 | POST /luna/treasure/business/ack_time | contract-research-pending |   |
| qishui-41126da25843 | GET /luna/treasure/entrance/config | contract-research-pending |   |
| qishui-6ba493163696 | POST /luna/treasure/task/fallback/do_action | contract-research-pending |   |
| qishui-8310f7fa1863 | POST /luna/treasure/task/flip_card/do_action | contract-research-pending |   |
| qishui-8f5938aa1d9b | POST /luna/treasure/task/guide/do_action | contract-research-pending |   |
| qishui-cd0648e97f40 | GET /luna/treasure/task/view | contract-research-pending |   |
| qishui-5cbbc5f157e9 | GET /luna/treasure/task/widget | contract-research-pending |   |
| qishui-0932218a0f6d | GET /model/api/arithmetics/ | contract-research-pending |   |
| qishui-a4a4667f434d | POST /monitor_web/settings/hybrid-settings | excluded: telemetry |   |
| qishui-718a73c23156 | GET /music-agent/chat/action_bar/list | contract-research-pending |   |
| qishui-e494054d57a7 | POST /music-agent/chat/message/edit-mv-creation | contract-research-pending |   |
| qishui-bdaf37604c7f | POST /music-agent/chat/message/update | contract-research-pending |   |
| qishui-51c19bf7b58f | POST /privacy/setting/change | contract-research-pending |   |
| qishui-9e639e9f50a1 | GET /privacy/setting/query | contract-research-pending |   |
| qishui-db6f5f2a5c88 | GET /service/settings/v3/ | contract-research-pending |   |
| qishui-eb5c632b8930 | POST /src/server/v2/package | contract-research-pending |   |
| qishui-97fda02514f3 | POST /studio_api/benefit/query-xing-guang-benefit | contract-research-pending |   |
| qishui-0d5800bf5b20 | POST /webcast/experience/feature/ | contract-research-pending |   |
| qishui-343ac1caa5a2 | POST /webcast/trace/report/ | excluded: telemetry |   |
| qishui-097e2026117c | POST luna/atlist | contract-research-pending |   |
| qq-a686c5c4176c | GetListenList music.longRadio.LongRadioAlbumSeriesServer::GetListenList | contract-research-pending |   |
| qq-0c28a31c2788 | GetNoCopyrightAlbumTips music.longRadio.LongRadioPageV2::GetNoCopyrightAlbumTips | contract-research-pending |   |
| qq-fe9d40538243 | CgiGetAlbumFavInfo music.musicasset.AlbumFavRead::CgiGetAlbumFavInfo | contract-research-pending |   |
| qq-c6a8ca7eeae4 | GetSongUptime music.musichallAlbum.AlbumInfoServer::GetSongUptime | contract-research-pending |   |
| qq-f703d058ba54 | LikeLetter music.musichallAlbum.AlbumInfoServer::LikeLetter | contract-research-pending |   |
| qq-3a9eaaacb9b6 | LikeVoice music.musichallAlbum.AlbumInfoServer::LikeVoice | contract-research-pending |   |
| qq-f44c80456d21 | GetAlbumSongList music.musichallAlbum.AlbumSongList::GetAlbumSongList | connected | 专辑歌曲与分页 guest-live-tested |
| qq-1199b5fcbc79 | GetAlbumColor music.playerStyle.PlayerStyleSetting::GetAlbumColor | contract-research-pending |   |
| qq-c0d34d8e831a | POST newService/fileUpload | contract-research-pending |   |
| qq-c479dd0b9800 | GetExchangeOrderList music.activeCenter.ActiveCenterExchangeSvr::GetExchangeOrderList | contract-research-pending |   |
| qq-62c06f6f2720 | GetPanelData music.musicmallcgi.BulletScreenCgi::GetPanelData | contract-research-pending |   |
| qq-4436d1efbf58 | getShareTargetOrder music.shareTarget.ShareTargetInfoSvr::getShareTargetOrder | contract-research-pending |   |
| qq-b9538e3529aa | GetMoreTranslate music.bubble.BubbleFeedbackSvr::GetMoreTranslate | contract-research-pending |   |
| qq-bb268181538a | AddDislike music.feedback.FeedbackBlack::AddDislike | contract-research-pending |   |
| qq-c23ff061f7a0 | CancelDislike music.feedback.FeedbackBlack::CancelDislike | contract-research-pending |   |
| qq-ceba71fb5ab9 | GetDislikeList music.feedback.FeedbackBlack::GetDislikeList | contract-research-pending |   |
| qq-2ecaa32326b0 | ReportFb music.feedback.FeedbackMsg::ReportFb | contract-research-pending |   |
| qq-f2238526e4da | Report music.feedback.PositiveFeedBack::Report | contract-research-pending |   |
| qq-cc3e760090d2 | GetRecommendConfigFeedBackItems music.feedback.RecommendFeedback::GetRecommendConfigFeedBackItems | contract-research-pending |   |
| qq-b5c1b31fba00 | ReportConfigFb music.feedback.RecommendFeedback::ReportConfigFb | contract-research-pending |   |
| qq-cd7ca40c83d5 | ReportRadioConfigFb music.feedback.RecommendFeedback::ReportRadioConfigFb | contract-research-pending |   |
| qq-2ff6e7afc212 | GetRecommend music.individuation.Recommend::GetRecommend | contract-research-pending |   |
| qq-7b3aaf22d700 | GetChannelPage music.longRadio.LongRadioContent::GetChannelPage | contract-research-pending |   |
| qq-ea6532e4cae0 | SetFreeMode music.longRadio.LongRadioFreeListenSvr::SetFreeMode | contract-research-pending |   |
| qq-808fe30a3aa0 | UpdateFreeModeSwitch music.longRadio.LongRadioFreeMode::UpdateFreeModeSwitch | contract-research-pending |   |
| qq-1fe7c112556b | MapLongRadioPlayMode music.longRadio.LongRadioPageV2::MapLongRadioPlayMode | contract-research-pending |   |
| qq-ecba2d90270e | GetEarHealthPopup music.longRadio.LongRadioPayPopUpSvr::GetEarHealthPopup | contract-research-pending |   |
| qq-c645d5301ff6 | queryTextByTaskId music.longRadio.asrForward::queryTextByTaskId | contract-research-pending |   |
| qq-dcb69da73f87 | speechrecongnizer music.longRadio.asrForward::speechrecongnizer | contract-research-pending |   |
| qq-3bf69b9c0515 | submitRecognizeTask music.longRadio.asrForward::submitRecognizeTask | contract-research-pending |   |
| qq-c6e9b57580fc | getFstClsInfo music.longRadio.categoryRelation::getFstClsInfo | contract-research-pending |   |
| qq-1eb4850104a1 | getSndClsInfo music.longRadio.categoryRelation::getSndClsInfo | contract-research-pending |   |
| qq-f1d64c413ebd | getPodcastIntro music.longRadio.podcastInfo::getPodcastIntro | contract-research-pending |   |
| qq-5d19c74559d6 | getChannelShelf music.longRadio.recommend::getChannelShelf | contract-research-pending |   |
| qq-fc28809687ed | getRadioList music.longRadio.recommend::getRadioList | contract-research-pending |   |
| qq-5fed8aaca330 | GetRecommend music.osu.OsuRecommendSvr::GetRecommend | contract-research-pending |   |
| qq-4f43725315ec | GetForyouConfigItems music.recommend.RecommendWidget::GetForyouConfigItems | contract-research-pending |   |
| qq-ca3b3e254fc7 | SaveForyouConfigItems music.recommend.RecommendWidget::SaveForyouConfigItems | contract-research-pending |   |
| qq-3333e71abedf | GetRadioEntranceScene music.startup.PRConfig::GetRadioEntranceScene | contract-research-pending |   |
| qq-c4ef981da20d | UpdateRadioSceneConfig music.startup.RadioConfig::UpdateRadioSceneConfig | contract-research-pending |   |
| qq-90f53381c51b | do_search_more music.adaptor.SearchAdaptorQMMobile::do_search_more | contract-research-pending |   |
| qq-589db6779cf4 | do_search_v2 music.adaptor.SearchAdaptorQMMobile::do_search_v2 | contract-research-pending |   |
| qq-dc81985be1b1 | do_search_v2_pre music.adaptor.SearchAdaptorQMMobile::do_search_v2_pre | contract-research-pending |   |
| qq-6bdd13dcfde1 | SearchArtist music.bubble.BubbleUserSvr::SearchArtist | contract-research-pending |   |
| qq-7dc538f73b99 | GetHotkeyAllBusinessForQQMusicMobile music.musicsearch.HotkeyService::GetHotkeyAllBusinessForQQMusicMobile | contract-research-pending |   |
| qq-b67f18588c6d | GetDirectJumpQuery music.musicsearch.QueryOperating::GetDirectJumpQuery | contract-research-pending |   |
| qq-30467d0271f6 | GetClassDetailSongList music.recommend.SearchClassHubSrv::GetClassDetailSongList | contract-research-pending |   |
| qq-5fde2b6b27a0 | DoSearchForPutong music.search.SearchCgiService::DoSearchForPutong | contract-research-pending |   |
| qq-33bf46002870 | DoSearchForQQMusicMobile music.search.SearchCgiService::DoSearchForQQMusicMobile | contract-research-pending |   |
| qq-4f2352549e07 | GetHotSearchWords music.superSound.AudioEffectConfig::GetHotSearchWords | contract-research-pending |   |
| qq-9e5046e069e8 | GetMatchAudio music.WeiyunMusic.WeiyunMusicRead::GetMatchAudio | contract-research-pending |   |
| qq-ed277ef02b54 | DeleteAudio music.WeiyunMusic.WeiyunMusicWrite::DeleteAudio | contract-research-pending |   |
| qq-bc3c19af9107 | UploadAudio music.WeiyunMusic.WeiyunMusicWrite::UploadAudio | contract-research-pending |   |
| qq-3ee4e7d6e771 | get_new_similar_song_blocks music.ai.CAiNewSimilarSongSvr::get_new_similar_song_blocks | contract-research-pending |   |
| qq-3236a6f8c47a | GetSongRecognitionGuide music.aiAssistant.AiAssistantCtrlCenter::GetSongRecognitionGuide | contract-research-pending |   |
| qq-2847492f4b2f | setUpdateFreq music.aiPlAssistant.aiAgentPlSongOp::setUpdateFreq | contract-research-pending |   |
| qq-c99d1aa05564 | GetCharacterList music.aiPlayerCompanion.AiPlayerCompanionListenSrv::GetCharacterList | contract-research-pending |   |
| qq-097a12a26927 | GetListenList music.aiPlayerCompanion.AiPlayerCompanionListenSrv::GetListenList | contract-research-pending |   |
| qq-92b580f59eb2 | GetShareInfo music.aiPlayerCompanion.AiPlayerCompanionScoreSrv::GetShareInfo | contract-research-pending |   |
| qq-d53aa33a19b2 | GetPlaypageCharacter music.aiPlayerCompanion.AiPlayerCompanionSongSrv::GetPlaypageCharacter | contract-research-pending |   |
| qq-5ba18fc8f354 | CompleteTask music.aiPlayerCompanion.AiPlayerCompanionTaskSrv::CompleteTask | contract-research-pending |   |
| qq-18c6f36a170a | CreatePayReport music.eventtracking.ReportCgi::CreatePayReport | contract-research-pending |   |
| qq-1fb00fe8d602 | get_long_audio_songinfo music.favorSystemRead.FavorSystem::get_long_audio_songinfo | contract-research-pending |   |
| qq-44aef8e660bc | fav_long_audio_songid music.favorSystemWrite.FavorSystem::fav_long_audio_songid | contract-research-pending |   |
| qq-44059ae6bf88 | sort_long_audio_songid music.favorSystemWrite.FavorSystem::sort_long_audio_songid | contract-research-pending |   |
| qq-accb25974354 | GetPlayerLightSignList music.lightSign.LightSignWearSrv::GetPlayerLightSignList | contract-research-pending |   |
| qq-832e2c700d50 | QueryPopup music.longAudio.longAudioNotification::QueryPopup | contract-research-pending |   |
| qq-ba0eef50836e | getMostRecentSong music.longRadio.recentUpdate::getMostRecentSong | contract-research-pending |   |
| qq-9e38ea376dcd | SongPlayCompletionReport music.medalHall.MedalPopUpsSrv::SongPlayCompletionReport | contract-research-pending |   |
| qq-df6bbfcc03bc | ShareToastForSongPlay music.medalHall.MedalToastSrv::ShareToastForSongPlay | contract-research-pending |   |
| qq-b029bd8d31fe | Query music.musicCouple.CouplePlayerInfoSvr::Query | contract-research-pending |   |
| qq-f476a6fba868 | ReportShare music.musicCouple.CouplePlayerInfoSvr::ReportShare | contract-research-pending |   |
| qq-d82a919f51de | get_new_song_info music.musicHall.NewSong::get_new_song_info | contract-research-pending |   |
| qq-12207994011a | GetPlayerInfo music.musicWorld.MusicWorldEntranceSrv::GetPlayerInfo | contract-research-pending |   |
| qq-05cdfb7dbf86 | GetPlayFinishedSongInfo music.musicasset.PlayFinishedRead::GetPlayFinishedSongInfo | contract-research-pending |   |
| qq-b6684676b90a | GetSongUserInfo music.musichallSong.SongDetailSvr::GetSongUserInfo | contract-research-pending |   |
| qq-fda9de79106b | GetSongMIRInfo music.musichallSong.SongInfoServer::GetSongMIRInfo | contract-research-pending |   |
| qq-6b161a7924e9 | GetPurchaseEntrance music.musicmallcgi.SongBatchBuyCgi::GetPurchaseEntrance | contract-research-pending |   |
| qq-2b7e11f3edd7 | BindTicket music.musicmallcgi.SongDownloadTicketCgi::BindTicket | contract-research-pending |   |
| qq-231c249a3a1e | GetTicketCount music.musicmallcgi.SongDownloadTicketCgi::GetTicketCount | contract-research-pending |   |
| qq-7f552c839a53 | ListBoundSongs music.musicmallcgi.SongDownloadTicketCgi::ListBoundSongs | contract-research-pending |   |
| qq-dc6050619ed3 | WriteOffTicket music.musicmallcgi.SongDownloadTicketCgi::WriteOffTicket | contract-research-pending |   |
| qq-d26597b81273 | GetBubble music.musicmallcgi.SongRewardAdsCgi::GetBubble | contract-research-pending |   |
| qq-ae8c4b4fdc14 | GetGiftWallDetail music.musicmallcgi.SongRewardCgi::GetGiftWallDetail | contract-research-pending |   |
| qq-8d44d47c2be3 | GetRewardGradeDetail music.musicmallcgi.SongRewardCgi::GetRewardGradeDetail | contract-research-pending |   |
| qq-fd3b9c1cefdf | GetRewardLayer music.musicmallcgi.SongRewardCgi::GetRewardLayer | contract-research-pending |   |
| qq-df0d879aa8be | GetRewardPanel music.musicmallcgi.SongRewardCgi::GetRewardPanel | contract-research-pending |   |
| qq-28b85d996478 | GetRewardProgressPage music.musicmallcgi.SongRewardCgi::GetRewardProgressPage | contract-research-pending |   |
| qq-619f45558483 | GetRewardShareCard music.musicmallcgi.SongRewardCgi::GetRewardShareCard | contract-research-pending |   |
| qq-99617f91dc7e | GetSendGiftOrder music.musicmallcgi.SongRewardCgi::GetSendGiftOrder | contract-research-pending |   |
| qq-90c5fd562292 | ListAdvert music.musicmallcgi.SongRewardCgi::ListAdvert | contract-research-pending |   |
| qq-423679549dae | ListBagGift music.musicmallcgi.SongRewardCgi::ListBagGift | contract-research-pending |   |
| qq-4b48ce068b8d | ListUserGeneratedAIGifts music.musicmallcgi.SongRewardCgi::ListUserGeneratedAIGifts | contract-research-pending |   |
| qq-765651b9005f | GetPlace music.musicmallcgi.SongRewardPlaceCgi::GetPlace | contract-research-pending |   |
| qq-3eda0af6581c | ListPlaceRecords music.musicmallcgi.SongRewardPlaceCgi::ListPlaceRecords | contract-research-pending |   |
| qq-cf014a229b65 | ISCallBack music.operateActivity.IdentSongCallBackSvr::ISCallBack | contract-research-pending |   |
| qq-7360323fdef9 | GetShortTracks music.osu.OsuTrackSvr::GetShortTracks | contract-research-pending |   |
| qq-bebf6debd50b | GetTracks music.osu.OsuTrackSvr::GetTracks | contract-research-pending |   |
| qq-134138aae6e6 | CheckSongInIotLibrary music.periphMgr.PeriphMgrSvr::CheckSongInIotLibrary | contract-research-pending |   |
| qq-55daa36fb256 | GetAutoSetPlayerStyle music.playerStyle.PlayerStyleAutoSetSvr::GetAutoSetPlayerStyle | contract-research-pending |   |
| qq-7a23d5ef77a4 | PlayerAutoSetFlagCtl music.playerStyle.PlayerStyleAutoSetSvr::PlayerAutoSetFlagCtl | contract-research-pending |   |
| qq-df42c6cb4b11 | FishFarm music.playerStyle.PlayerStyleInterActSvr::FishFarm | contract-research-pending |   |
| qq-3689150fe852 | FishPreview music.playerStyle.PlayerStyleInterActSvr::FishPreview | contract-research-pending |   |
| qq-1169dc12e002 | GameDetail music.playerStyle.PlayerStyleInterActSvr::GameDetail | contract-research-pending |   |
| qq-26d67ee653e3 | GameReport music.playerStyle.PlayerStyleInterActSvr::GameReport | contract-research-pending |   |
| qq-a67516aabd24 | GetAllMaterial music.playerStyle.PlayerStyleLive::GetAllMaterial | contract-research-pending |   |
| qq-16491de7f551 | GetLivePlayerMaterial music.playerStyle.PlayerStyleLive::GetLivePlayerMaterial | contract-research-pending |   |
| qq-8b802b46ac18 | BirthdayPlayer music.playerStyle.PlayerStyleSetting::BirthdayPlayer | contract-research-pending |   |
| qq-2b98f49c8d5d | GetAllSchoolPlayerOptions music.playerStyle.PlayerStyleSetting::GetAllSchoolPlayerOptions | contract-research-pending |   |
| qq-e87a2941283d | GetPlayerStyleDetail music.playerStyle.PlayerStyleSvr::GetPlayerStyleDetail | contract-research-pending |   |
| qq-796acd17279f | SetUserPlayerStyle music.playerStyle.PlayerStyleSvr::SetUserPlayerStyle | contract-research-pending |   |
| qq-c70b0fa81096 | GetAlertWindowInfo music.playerStyle.playMusicGuideSvr::GetAlertWindowInfo | contract-research-pending |   |
| qq-8ceacfb64bcc | SeekRecommendSong music.privateMsg.PrivateMsgChatgptSvr::SeekRecommendSong | contract-research-pending |   |
| qq-3a38dcc92cdd | QryPlayerInfo music.qqshow.playerGrowSvr::QryPlayerInfo | contract-research-pending |   |
| qq-b92de8989d88 | ReportUpShow music.qqshow.playerGrowSvr::ReportUpShow | contract-research-pending |   |
| qq-700d22c2d06f | GetQuickListenSong music.recommend.TrackRelationServer::GetQuickListenSong | contract-research-pending |   |
| qq-8e212c5dc20c | GetSimilarSongs music.recommend.TrackRelationServer::GetSimilarSongs | contract-research-pending |   |
| qq-8097d775e30b | SongProducer music.sociality.KolWorksTag::SongProducer | contract-research-pending |   |
| qq-33521efdf799 | ReportMeditation music.songPlayPage.MeditationSvr::ReportMeditation | contract-research-pending |   |
| qq-dbd9ad0eccb9 | GetLongAudioTempVKey music.stream.TaskFreeListen::GetLongAudioTempVKey | contract-research-pending |   |
| qq-6c98797e64a7 | GetEffectEntry music.superSound.AudioEffectConfig::GetEffectEntry | contract-research-pending |   |
| qq-fe84a063963b | GetSVIPTopTip music.superSound.AudioEffectQualityMinibarSvr::GetSVIPTopTip | contract-research-pending |   |
| qq-1cc61f9f2c96 | Add music.superSound.SongMixerSvr::Add | contract-research-pending |   |
| qq-4423997efbbf | GetList music.superSound.SongMixerSvr::GetList | contract-research-pending |   |
| qq-06e2c9681747 | SetList music.superSound.SongMixerSvr::SetList | contract-research-pending |   |
| qq-b6bb27e332e1 | GetToneColorInfo music.trackInfo.UniformConfig::GetToneColorInfo | contract-research-pending |   |
| qq-c1dac916aad7 | HandleGetAiSongCoversInfo music.venus.VenusMusicAiSongCoversApi::HandleGetAiSongCoversInfo | contract-research-pending |   |
| qq-13e5d3bf9b15 | CgiGetEDownUrl music.vkey.GetEVkey::CgiGetEDownUrl | contract-research-pending |   |
| qq-0b5f34754093 | CgiGetEVkey music.vkey.GetEVkey::CgiGetEVkey | contract-research-pending |   |
| qq-e5f28ee12860 | CgiGetTempVkey music.vkey.GetEVkey::CgiGetTempVkey | contract-research-pending |   |
| qq-cf91a3b039e8 | GetTempUrl music.vkey.GetEVkey::GetTempUrl | contract-research-pending |   |
| qq-d6f87446789f | UrlGetVkey music.vkey.GetEVkey::UrlGetVkey | contract-research-pending |   |
| qq-ce252588c561 | GetTopList music.audioFingerPrint.SongRecognitionRecommend::GetTopList | contract-research-pending |   |
| qq-79fc895d8687 | GetTotalHotRankHeader music.medalHall.MedalHallHotRankSrv::GetTotalHotRankHeader | contract-research-pending |   |
| qq-0d6f0efbac8f | GetTotalHotRankItemInfo music.medalHall.MedalHallHotRankSrv::GetTotalHotRankItemInfo | contract-research-pending |   |
| qq-0aa35385a1f9 | GetPodcastTop music.musicToplist.PodcastToplist::GetPodcastTop | contract-research-pending |   |
| qq-8048e19b038f | GetAll music.musicToplist.Toplist::GetAll | contract-research-pending |   |
| qq-9ebd3bcee17c | GetDetail music.musicToplist.Toplist::GetDetail | contract-research-pending |   |
| qq-17587867864e | GetRewardRankDetail music.musicmallcgi.SongRewardCgi::GetRewardRankDetail | contract-research-pending |   |
| qq-f67d7de9a1be | GetFriendRankingList music.osu.OsuRankingSvr::GetFriendRankingList | contract-research-pending |   |
| qq-05fb664f2eeb | GetFriendRankingListById music.osu.OsuRankingSvr::GetFriendRankingListById | contract-research-pending |   |
| qq-4d51354d0ef3 | GetHistoryHighestScore music.osu.OsuRankingSvr::GetHistoryHighestScore | contract-research-pending |   |
| qq-3398261da230 | GetRankingList music.osu.OsuRankingSvr::GetRankingList | contract-research-pending |   |
| qq-70790b1b622f | GetRankingListById music.osu.OsuRankingSvr::GetRankingListById | contract-research-pending |   |
| qq-d2f62b840b0b | CreatePlaylistByMusicContent music.aiAssistant.AiAssistantCtrlCenter::CreatePlaylistByMusicContent | contract-research-pending |   |
| qq-000ffb604dbb | FetchPlInfo music.crowdplaylist.crowdplaylistRead::FetchPlInfo | contract-research-pending |   |
| qq-f053f0fb6346 | AddPlaylist music.crowdplaylist.crowdplaylistWrite::AddPlaylist | contract-research-pending |   |
| qq-953b82e5bf8e | AddPlaylistV3 music.interactiveplaylist.InteractivePlWrapper::AddPlaylistV3 | contract-research-pending |   |
| qq-9ba525b4f7cc | Read music.interactiveplaylist.PlInteractiveConfigRead::Read | contract-research-pending |   |
| qq-5dd02594f37d | IndirectBatchSubmit music.interactiveplaylist.PlSongSubmit::IndirectBatchSubmit | contract-research-pending |   |
| qq-fb73db5568e1 | ObtainTopicPl music.interactiveplaylist.TopicRecommRead::ObtainTopicPl | contract-research-pending |   |
| qq-1fcad8126a7f | CgiSubmit music.interactiveplaylist.TopicSubmit::CgiSubmit | contract-research-pending |   |
| qq-e69295573025 | CollectLightUGCRoomSong music.lightUGCRoom.LightUGCRoomSongSvr::CollectLightUGCRoomSong | contract-research-pending |   |
| qq-7e4616fe965b | GetLiked music.mir.SheetMusicCollectSvr::GetLiked | contract-research-pending |   |
| qq-116ca43ffb0b | HasLike music.mir.SheetMusicCollectSvr::HasLike | contract-research-pending |   |
| qq-409e20da3efb | Unlike music.mir.SheetMusicCollectSvr::Unlike | contract-research-pending |   |
| qq-301cac63e6eb | UpdatePlaylist music.musicStation.MusicStationRequestSrv::UpdatePlaylist | contract-research-pending |   |
| qq-a2d783cad8e9 | CgiGetRecentSong music.musicasset.FavDissRecentUpdate::CgiGetRecentSong | contract-research-pending |   |
| qq-27f36978c14a | CgiGetPlaylistByUin music.musicasset.PlaylistBaseRead::CgiGetPlaylistByUin | contract-research-pending |   |
| qq-b9ac417609a4 | AddPlaylist music.musicasset.PlaylistBaseWrite::AddPlaylist | contract-research-pending |   |
| qq-163788639661 | DelPlaylist music.musicasset.PlaylistBaseWrite::DelPlaylist | contract-research-pending |   |
| qq-be0373f52e6c | CgiGetPlaylistFavInfo music.musicasset.PlaylistFavRead::CgiGetPlaylistFavInfo | contract-research-pending |   |
| qq-f21947dfd3c8 | get_meffect_plinfo music.playlist.MEffectPlInfoRead::get_meffect_plinfo | contract-research-pending |   |
| qq-c4b334b3b1e4 | get_playlist_info_auto music.playlist.PlayListRead::get_playlist_info_auto | contract-research-pending |   |
| qq-c71de7057bf5 | GetAllTag music.playlist.PlaylistSquare::GetAllTag | contract-research-pending |   |
| qq-bf88d6e13b83 | SubmitGuideBubbleStatus music.playlist.PlaylistSubmitGuide::SubmitGuideBubbleStatus | contract-research-pending |   |
| qq-d7d0161f0e6b | GetOtherPlatCurrentPlaylist music.richFlag.listening::GetOtherPlatCurrentPlaylist | contract-research-pending |   |
| qq-315b3ed07d03 | CgiGetDiss music.srfDissInfo.DissInfo::CgiGetDiss | connected | 歌单与我喜欢的歌曲分页 guest-live-tested |
| qq-d749282edc2b | mobileCgiGetDiss music.srfDissInfo.DissInfo::mobileCgiGetDiss | contract-research-pending |   |
| qq-cd572af333b4 | GetVideoInfoList music.video.VideoCollectionQuery::GetVideoInfoList | contract-research-pending |   |
| qq-b6eed0e21f78 | GetPlaylistVipRemind music.vip.PlaylistVipRemindSvr::GetPlaylistVipRemind | contract-research-pending |   |
| qq-6b65aa279987 | GetPlaylistVipRemindByPos music.vip.PlaylistVipRemindSvr::GetPlaylistVipRemindByPos | contract-research-pending |   |
| qq-3003ed34ad81 | GetVipRemindSongList music.vip.PlaylistVipRemindSvr::GetVipRemindSongList | contract-research-pending |   |
| qq-dfc40556112a | AckPopWindow music.vipMusic.FavoritePopWindowSvr::AckPopWindow | contract-research-pending |   |
| qq-2b3bc40ed6c8 | get_category_content playlist.PlayListCategoryServer::get_category_content | contract-research-pending |   |
| qq-f496a9cef88c | QueryArtistWorksDetail music.UnifiedHomepage.HomepageSecondarySrv::QueryArtistWorksDetail | contract-research-pending |   |
| qq-a4d95f02e285 | QueryConcernTask music.UnifiedHomepage.UnifiedHomepageSrv::QueryConcernTask | contract-research-pending |   |
| qq-e1547afcd8fb | GetArtistInfoByShowID music.bubble.ArtistChatLiveSvr::GetArtistInfoByShowID | contract-research-pending |   |
| qq-e8de1aedb746 | GetArtistChatEntrance music.bubble.BubbleUserSvr::GetArtistChatEntrance | contract-research-pending |   |
| qq-65fc4eb5d32c | GetDesktopWidgetArtistList music.bubble.BubbleUserSvr::GetDesktopWidgetArtistList | contract-research-pending |   |
| qq-f03d17cd9080 | GetPrivateMsgArtistTab music.bubble.BubbleUserSvr::GetPrivateMsgArtistTab | contract-research-pending |   |
| qq-a7e72996160f | GetGuideFollowInfo music.community.CommunityGuideFollowSvr::GetGuideFollowInfo | contract-research-pending |   |
| qq-09c01a006778 | QueryCommunitySinger music.community.CommunityHomepageSvr::QueryCommunitySinger | contract-research-pending |   |
| qq-4e30a1346ec6 | cgi_get_all_concern_list music.concern.ConcernSystem::cgi_get_all_concern_list | contract-research-pending |   |
| qq-a094abdcab3d | GetFansList music.concern.RelationList::GetFansList | contract-research-pending |   |
| qq-20a3369cc5e0 | GetFollowSingerList music.concern.RelationList::GetFollowSingerList | contract-research-pending |   |
| qq-cfe5da3c126f | GetFollowUserList music.concern.RelationList::GetFollowUserList | contract-research-pending |   |
| qq-553dbcc5a52f | ReportStatus music.followRoom.FollowRoomUserSvr::ReportStatus | contract-research-pending |   |
| qq-ab8bd10b33b2 | GetSingerBlackList music.kgsafety.SafeConfig::GetSingerBlackList | contract-research-pending |   |
| qq-d1a7bbeed032 | ConcernSingerMedalTip music.medalHall.MedalPopUpsSrv::ConcernSingerMedalTip | contract-research-pending |   |
| qq-0dfda14abe09 | GetFaceSingers music.musicNotify.UserFollowMusicFeed::GetFaceSingers | contract-research-pending |   |
| qq-0a1a7c01cb66 | get_music_feed music.musicNotify.UserFollowMusicFeed::get_music_feed | contract-research-pending |   |
| qq-b3835c9fe747 | GetSingerList music.musicSinger.MusicSingerTabSrv::GetSingerList | contract-research-pending |   |
| qq-30f9c7e69ac0 | QuerySingerTabPopUp music.musicSinger.MusicSingerTabSrv::QuerySingerTabPopUp | contract-research-pending |   |
| qq-221dea63bae7 | GetSingerSongList music.musichallSong.SongListInter::GetSingerSongList | connected | 歌手歌曲与分页 guest-live-tested |
| qq-fd7d8123348e | GetLyricSpecialEffects music.appconf.fontSvr::GetLyricSpecialEffects | contract-research-pending |   |
| qq-bab8217a7301 | QueryLyricFont music.appconf.fontSvr::QueryLyricFont | contract-research-pending |   |
| qq-21562bafbcbf | SaveLyricSpecialEffectCustomConfig music.appconf.fontSvr::SaveLyricSpecialEffectCustomConfig | contract-research-pending |   |
| qq-b8bac890a227 | get_adinfo music.lyricsPoster.VideoPoster::get_adinfo | contract-research-pending |   |
| qq-4099bd190114 | GetAIDictInfo music.musichallSong.PlayLyricInfo::GetAIDictInfo | contract-research-pending |   |
| qq-c30e5e31932e | GetPlayLyricInfo music.musichallSong.PlayLyricInfo::GetPlayLyricInfo | connected | 准确歌曲 ID 歌词与逐字补充 guest-live-tested |
| qq-595cbfa432cb | GetSingingAnnotationsInfo music.musichallSong.PlayLyricInfo::GetSingingAnnotationsInfo | contract-research-pending |   |
| qq-cf660e151d42 | IsAIDictExists music.musichallSong.PlayLyricInfo::IsAIDictExists | contract-research-pending |   |
| qq-e13643e8d5fb | GetAnimation music.playerStyle.LyricAnimationSvr::GetAnimation | contract-research-pending |   |
| qq-b02811ddb3aa | GET accessToken | contract-research-pending |   |
| qq-5b791d3a4634 | DeleteSession music.aiAssistant.AiAssistantCtrlCenter::DeleteSession | contract-research-pending |   |
| qq-66bdfcf47b08 | GetSessionHistory music.aiAssistant.AiAssistantCtrlCenter::GetSessionHistory | contract-research-pending |   |
| qq-db8e841e6bec | GetSessionList music.aiAssistant.AiAssistantCtrlCenter::GetSessionList | contract-research-pending |   |
| qq-b21f0045d9d1 | get_cert_info music.authority.Certification::get_cert_info | contract-research-pending |   |
| qq-fe17ced72b62 | AuthIcon music.cosmeticcgi.UserCosmeticAdapterCgi::AuthIcon | contract-research-pending |   |
| qq-63a7d6ead85e | AuthSound music.cosmeticcgi.UserCosmeticAdapterCgi::AuthSound | contract-research-pending |   |
| qq-fdbdb2ed6c66 | GetAuthenticationToken music.gameCenter.GameAuthenticationSvr::GetAuthenticationToken | contract-research-pending |   |
| qq-e985501f84c9 | GetSession music.getSession.session::GetSession | connected | 官方 Lite 分类搜索会话 guest-live-tested |
| qq-114efee6e181 | GetBizSeq music.identityVerify.IdentityVerifySvr::GetBizSeq | contract-research-pending |   |
| qq-af6c2b27cde5 | GetPhoneNo music.login.AccountServer::GetPhoneNo | contract-research-pending |   |
| qq-8d76ad916378 | RemindUserToBindPhone music.login.AccountServer::RemindUserToBindPhone | contract-research-pending |   |
| qq-6d98764bb82f | Authorize music.login.LoginServer::Authorize | contract-research-pending |   |
| qq-98e3e21e16c0 | GetPhoneNoWithMask music.login.LoginServer::GetPhoneNoWithMask | contract-research-pending |   |
| qq-1c3c2a500563 | GetURLsOfCarriers music.login.LoginServer::GetURLsOfCarriers | contract-research-pending |   |
| qq-785076996871 | GetVideoToken music.login.LoginServer::GetVideoToken | contract-research-pending |   |
| qq-89ffb7e1884c | GetVideoVipInfo music.login.LoginServer::GetVideoVipInfo | contract-research-pending |   |
| qq-909f0cd492e9 | Login music.login.LoginServer::Login | contract-research-pending |   |
| qq-f73c3be91c62 | SendPhoneAuthCode music.login.LoginServer::SendPhoneAuthCode | contract-research-pending |   |
| qq-d887e4011116 | EarphoneLogin music.periphMgr.PeriphMgrSvr::EarphoneLogin | contract-research-pending |   |
| qq-fce3f27f4587 | RefreshToken music.periphMgr.PeriphMgrSvr::RefreshToken | contract-research-pending |   |
| qq-d4a224067edc | OperRecordSession music.recordSession.SessionImpl::OperRecordSession | contract-research-pending |   |
| qq-3890ca9dc46e | OperRoomInfo music.recordSession.SessionImpl::OperRoomInfo | contract-research-pending |   |
| qq-fcdb54821932 | GetAllFreeNoLoginPullActiveInfo music.stream.TaskFreeListen::GetAllFreeNoLoginPullActiveInfo | contract-research-pending |   |
| qq-3283676d9da5 | QueryCheerConfigAuth music.togetherRoom.SongCheerConfig::QueryCheerConfigAuth | contract-research-pending |   |
| qq-2dc31cf8cce6 | get_video_info_batch music.video.VideoData::get_video_info_batch | contract-research-pending |   |
| qq-34e7dff8cf8e | GetFeeds music.video.VideoFeed::GetFeeds | contract-research-pending |   |
| qq-39108ab3a674 | GetFocusRadioFeeds music.video.VideoFeed::GetFocusRadioFeeds | contract-research-pending |   |
| qq-92ec388a6b4a | IsLiked music.video.VideoLiked::IsLiked | contract-research-pending |   |
| qq-e5ada4a34a10 | Like music.video.VideoLiked::Like | contract-research-pending |   |
| qq-696def257f48 | UnLike music.video.VideoLiked::UnLike | contract-research-pending |   |
| qq-32e1a5f2d273 | GetKTVVideoListBySongId music.video.VideoSong::GetKTVVideoListBySongId | contract-research-pending |   |
| qq-c556c77fce06 | GetTabMutation music.video.VideoTabMutation::GetTabMutation | contract-research-pending |   |
| qq-ac4e73b948fd | AchievementReport music.video.focusTogetherServer::AchievementReport | contract-research-pending |   |
| qq-06f5121b2999 | Focus music.video.focusTogetherServer::Focus | contract-research-pending |   |
| qq-f3ba809ff78e | GetAtCompleteList music.globalComment.CommentAsset::GetAtCompleteList | contract-research-pending |   |
| qq-6e3d19bc7bfe | GetEmoPkgList music.globalComment.CommentEmo::GetEmoPkgList | contract-research-pending |   |
| qq-b13b478a2d71 | GetRecOpenCmList music.globalComment.CommentOpen::GetRecOpenCmList | contract-research-pending |   |
| qq-dc4ba5b454fc | QueryTextToSpeechResult music.globalComment.CommentRead::QueryTextToSpeechResult | contract-research-pending |   |
| qq-c959a81ac7f7 | GetAirborneGuide music.globalComment.CommentReadServer::GetAirborneGuide | contract-research-pending |   |
| qq-cd1d64143524 | GetCmComponent music.globalComment.CommentRecommendSrv::GetCmComponent | contract-research-pending |   |
| qq-1994d6d9a85d | GetTextToSpeechOptions music.globalComment.CommentSettingSrv::GetTextToSpeechOptions | contract-research-pending |   |
| qq-6578ccb729f3 | CommitTextToSpeech music.globalComment.CommentWrite::CommitTextToSpeech | contract-research-pending |   |
| qq-8d2323db7ff5 | NotifyTextToSpeechResultReceived music.globalComment.CommentWrite::NotifyTextToSpeechResultReceived | contract-research-pending |   |
| qq-7ec4e24fafa4 | praiseSong music.musichallSong.SongPraiseSvr::praiseSong | contract-research-pending |   |
| qq-7db754c95a38 | queryPraise music.musichallSong.SongPraiseSvr::queryPraise | contract-research-pending |   |
| qq-d1be8b8824b1 | GetBulletCommentTemplate music.togetherRoom.TogetherRoomBulletComment::GetBulletCommentTemplate | contract-research-pending |   |
| qq-23cdc58e62a0 | GetBgPicList music.UnifiedHomepage.HomepageBgPicSrv::GetBgPicList | contract-research-pending |   |
| qq-ea5444e92d01 | SetBackgroundPic music.UnifiedHomepage.HomepageBgPicSrv::SetBackgroundPic | contract-research-pending |   |
| qq-84cfb9aeb374 | UploadUserPic music.UnifiedHomepage.HomepageBgPicSrv::UploadUserPic | contract-research-pending |   |
| qq-9c3a5f18ecab | GetPersonalSD music.UnifiedHomepage.HomepageLayoutSrv::GetPersonalSD | contract-research-pending |   |
| qq-f2cc9c092e2d | SetPersonalSD music.UnifiedHomepage.HomepageLayoutSrv::SetPersonalSD | contract-research-pending |   |
| qq-9997f42a1e51 | GetPopup music.UnifiedHomepage.HomepagePopup::GetPopup | contract-research-pending |   |
| qq-643553173241 | GetHomepageHeader music.UnifiedHomepage.UnifiedHomepageSrv::GetHomepageHeader | contract-research-pending |   |
| qq-465faf2676eb | GetHomepageTabDataCnt music.UnifiedHomepage.UnifiedHomepageSrv::GetHomepageTabDataCnt | contract-research-pending |   |
| qq-b29adcdc0bb0 | GetHomepageTabDetail music.UnifiedHomepage.UnifiedHomepageSrv::GetHomepageTabDetail | contract-research-pending |   |
| qq-10acd6757c98 | AddUrgeUpdate music.UnifiedHomepage.UrgeUpdateSrv::AddUrgeUpdate | contract-research-pending |   |
| qq-d36d3b832b16 | AlterUserInfo music.UserInfo.userInfoServer::AlterUserInfo | contract-research-pending |   |
| qq-d5ac44d8e3bf | GetUserInfo music.UserInfo.userInfoServer::GetUserInfo | contract-research-pending |   |
| qq-4ce9028d878f | MGetUserInfo music.UserInfo.userInfoServer::MGetUserInfo | contract-research-pending |   |
| qq-7614c66ce1ef | GetBannerList music.bubble.BubbleUserSvr::GetBannerList | contract-research-pending |   |
| qq-306ac965330d | GetChatDetail music.bubble.BubbleUserSvr::GetChatDetail | contract-research-pending |   |
| qq-02f122f1fa30 | GetCosmetic music.bubble.BubbleUserSvr::GetCosmetic | contract-research-pending |   |
| qq-6b885d3e81a9 | GetCosmeticRecords music.bubble.BubbleUserSvr::GetCosmeticRecords | contract-research-pending |   |
| qq-3b7ea18ba29e | GetNotificationRedDot music.bubble.BubbleUserSvr::GetNotificationRedDot | contract-research-pending |   |
| qq-2e3ad655bb20 | GetOfficialNotification music.bubble.BubbleUserSvr::GetOfficialNotification | contract-research-pending |   |
| qq-9b750a675034 | GetSettingPageInfo music.bubble.BubbleUserSvr::GetSettingPageInfo | contract-research-pending |   |
| qq-092d0ab7d7f4 | SetCosmetic music.bubble.BubbleUserSvr::SetCosmetic | contract-research-pending |   |
| qq-eace8f1f48ab | UpdateChatRoomConfig music.bubble.BubbleUserSvr::UpdateChatRoomConfig | contract-research-pending |   |
| qq-ef09c8e9f304 | UseCosmetic music.cosmeticcgi.UserCosmeticCgi::UseCosmetic | contract-research-pending |   |
| qq-3b8b3c5d3c34 | GetGroup music.groupvipcgi.GroupCgi::GetGroup | contract-research-pending |   |
| qq-be865faf7a3a | GetFriendList music.homepage.Friendship::GetFriendList | contract-research-pending |   |
| qq-3a84c51633ee | GetMusicBusinessCard music.homepage.HomepageShareSvr::GetMusicBusinessCard | contract-research-pending |   |
| qq-d126c4bf5267 | SayHi music.homepage.HomepageShareSvr::SayHi | contract-research-pending |   |
| qq-1c0fe807b2a8 | GetUserMusicProfileDetail music.individuation.UserMusicProfileSvr::GetUserMusicProfileDetail | contract-research-pending |   |
| qq-161f2bd35dbd | GetUserMusicProfileList music.individuation.UserMusicProfileSvr::GetUserMusicProfileList | contract-research-pending |   |
| qq-75a3ca3e052f | GetInvitedUserList music.lightUGCRoom.LightUGCRoomMatchSvr::GetInvitedUserList | contract-research-pending |   |
| qq-353e9e8374d2 | QueryUserSubscribe music.lvz.SuperSubscribeCgi::QueryUserSubscribe | contract-research-pending |   |
| qq-a709e8ca6207 | QueryUserSubscribeEntrance music.lvz.SuperSubscribeCgi::QueryUserSubscribeEntrance | contract-research-pending |   |
| qq-dbbcf9dbc3a6 | DelUserNotepadCard music.notepad.NotepadCard::DelUserNotepadCard | contract-research-pending |   |
| qq-0d5fd9306150 | GetUserNotepadCards music.notepad.NotepadCard::GetUserNotepadCards | contract-research-pending |   |
| qq-f618e828fc90 | Upload music.profile.Avatar::Upload | contract-research-pending |   |
| qq-bbc49d2be95f | ShareToUser music.share.ShareInfo::ShareToUser | contract-research-pending |   |
| qq-a1806f1c7925 | GetUserVocalByQMusicID music.venus_qmusic.venus_ai_demo_server::GetUserVocalByQMusicID | contract-research-pending |   |
| qq-10b74d80d28f | QueryAutomaticMonthlyMembershipItemList music.vip.CentralizedSvr::QueryAutomaticMonthlyMembershipItemList | contract-research-pending |   |
| qq-c447cf8894d7 | GetMessage music.vip.CoupleLoversTaskSvr::GetMessage | contract-research-pending |   |
| qq-6acb857d689a | GetPopupForTest music.vip.ExcSoundBenefitSvr::GetPopupForTest | contract-research-pending |   |
| qq-b97bc869e6cb | PlayPageFreeSoundPopup music.vip.ExcSoundBenefitSvr::PlayPageFreeSoundPopup | contract-research-pending |   |
| qq-171f5b2c309f | GetLowPriceConfig music.vip.FreeModeVipDispatchSvr::GetLowPriceConfig | contract-research-pending |   |
| qq-133ff630a2f0 | GetBlockingConfigV3 music.vip.MusicBlockingSvr::GetBlockingConfigV3 | contract-research-pending |   |
| qq-13d57512e945 | MusicIDBindPhone music.vip.StudentSvr::MusicIDBindPhone | contract-research-pending |   |
| qq-bf55b9305058 | Preview music.vipMusic.RemindViewSvr::Preview | contract-research-pending |   |
| qq-c88ba5180da0 | SoundGuidPopupCallBack music.vipMusic.SoundQualityPopupApi::SoundGuidPopupCallBack | contract-research-pending |   |
| qq-50059a300783 | GetVipCashier music.vipsalecgi.VipCashierCgi::GetVipCashier | contract-research-pending |   |
| qq-56b4acda520f | ListHomePageTabModules music.viptabv3.VipTabV3Cgi::ListHomePageTabModules | contract-research-pending |   |
| qq-9c0269610a30 | POST armobile/HandleTask | contract-research-pending |   |
| qq-882bfd74d2bf | POST cgi-bin/musicu.fcg | contract-research-pending |   |
| qq-b41dd54274f0 | POST newService/service | contract-research-pending |   |
| qq-6782e85f225b | GET room/getLiveRoomInfo | contract-research-pending |   |
| qq-9c80658bafbd | GET tmeLive/live{showId}.json | contract-research-pending |   |
| qq-80fc3e717a00 | GET tmeLive/tmeLive{showId}_{shardNumber}.json | contract-research-pending |   |
| qq-c505a3a8b50b | GET {path} | contract-research-pending |   |
| qq-ecce81c463ef | GetMyEntranceIconRes music.UniformResource.MusicUniformResourceSvr::GetMyEntranceIconRes | contract-research-pending |   |
| qq-b2fb9acce5fd | DoSignIn music.actCenter.ActCenterSignNewSvr::DoSignIn | contract-research-pending |   |
| qq-0bc50a91d92e | GetCardInfoForAtOnce music.actCenter.DaysignactSvr::GetCardInfoForAtOnce | contract-research-pending |   |
| qq-ce07f64a1d3d | SetStarSign music.actCenter.DaysignactSvr::SetStarSign | contract-research-pending |   |
| qq-9decadbcb6bc | getCardListV2 music.actCenter.DaysignactSvr::getCardListV2 | contract-research-pending |   |
| qq-5f2d30eccd99 | GetTaskDetail music.activeCenter.PlaypagetaskSvr::GetTaskDetail | contract-research-pending |   |
| qq-31dc7f82d2e2 | GetPriorities music.advert.AdvertPrioritySvr::GetPriorities | contract-research-pending |   |
| qq-fe2c5e6f0691 | AbortMessage music.aiAssistant.AiAssistantCtrlCenter::AbortMessage | contract-research-pending |   |
| qq-494c36bff5f8 | AckMsgSafetyHit music.aiAssistant.AiAssistantCtrlCenter::AckMsgSafetyHit | contract-research-pending |   |
| qq-313d4c591f6b | AddHint music.aiAssistant.AiAssistantCtrlCenter::AddHint | contract-research-pending |   |
| qq-7264e4102527 | AiAssist music.aiAssistant.AiAssistantCtrlCenter::AiAssist | contract-research-pending |   |
| qq-58b625118228 | ComplaintMessage music.aiAssistant.AiAssistantCtrlCenter::ComplaintMessage | contract-research-pending |   |
| qq-26cb09bbf6d1 | DeleteMessage music.aiAssistant.AiAssistantCtrlCenter::DeleteMessage | contract-research-pending |   |
| qq-544f9b51b808 | GetAiBotGuideInfo music.aiAssistant.AiAssistantCtrlCenter::GetAiBotGuideInfo | contract-research-pending |   |
| qq-6710317a2872 | GetAiBotInfo_V2 music.aiAssistant.AiAssistantCtrlCenter::GetAiBotInfo_V2 | contract-research-pending |   |
| qq-b289724dac36 | GetBubble music.aiAssistant.AiAssistantCtrlCenter::GetBubble | contract-research-pending |   |
| qq-bd4d7c444178 | GetHint music.aiAssistant.AiAssistantCtrlCenter::GetHint | contract-research-pending |   |
| qq-1c29587d424f | GetHintV2 music.aiAssistant.AiAssistantCtrlCenter::GetHintV2 | contract-research-pending |   |
| qq-711fd35fb086 | GetMsgSafetyHit music.aiAssistant.AiAssistantCtrlCenter::GetMsgSafetyHit | contract-research-pending |   |
| qq-e891158272ce | GetMultimodalBubble music.aiAssistant.AiAssistantCtrlCenter::GetMultimodalBubble | contract-research-pending |   |
| qq-dff3f8a0250a | Greeting music.aiAssistant.AiAssistantCtrlCenter::Greeting | contract-research-pending |   |
| qq-95699df5ed92 | PollMessageChunk music.aiAssistant.AiAssistantCtrlCenter::PollMessageChunk | contract-research-pending |   |
| qq-31aa15c9acc4 | VoteMessage music.aiAssistant.AiAssistantCtrlCenter::VoteMessage | contract-research-pending |   |
| qq-12b95b6dda5a | getAssistantInfo music.aiPlAssistant.aiPlAssistantRead::getAssistantInfo | contract-research-pending |   |
| qq-c63b6995fede | CreateRole music.aimv.AIMVRoleSvr::CreateRole | contract-research-pending |   |
| qq-c1255e609ce6 | DelRole music.aimv.AIMVRoleSvr::DelRole | contract-research-pending |   |
| qq-e5775a0cab4b | GetTpl music.aimv.AIMVRoleSvr::GetTpl | contract-research-pending |   |
| qq-c26ff7d1278b | QueryRole music.aimv.AIMVRoleSvr::QueryRole | contract-research-pending |   |
| qq-36f1c60c94f0 | CreateAiMv music.aimv.aiMvCreateSrv::CreateAiMv | contract-research-pending |   |
| qq-a3adf4adfd12 | GetCreativeText music.aimv.aiMvCreateSrv::GetCreativeText | contract-research-pending |   |
| qq-3ca6117c5b0f | QueryPayMethod music.aimv.aiMvCreateSrv::QueryPayMethod | contract-research-pending |   |
| qq-0dfed561f305 | QueryPushSwitch music.aimv.aiMvCreateSrv::QueryPushSwitch | contract-research-pending |   |
| qq-932172f44500 | QueryRedDot music.aimv.aiMvCreateSrv::QueryRedDot | contract-research-pending |   |
| qq-761c05795738 | QueryAiFontCount music.appconf.AiFontRead::QueryAiFontCount | contract-research-pending |   |
| qq-edeb69a166c8 | QueryFontIdentStat music.appconf.AiFontRead::QueryFontIdentStat | contract-research-pending |   |
| qq-1ee7b62983ac | BlackUin music.basicSvr.GlobalBlack::BlackUin | contract-research-pending |   |
| qq-57cfb8596c2f | QueryBlackStatus music.basicSvr.GlobalBlack::QueryBlackStatus | contract-research-pending |   |
| qq-2201d2f11c3f | UnBlackUin music.basicSvr.GlobalBlack::UnBlackUin | contract-research-pending |   |
| qq-053d6a2277e4 | GetData music.basicSvr.WebSource::GetData | contract-research-pending |   |
| qq-4cb19bb09f8c | GetMostSuitableX5Core music.basicSvr.X5CoreResourceManageSrv::GetMostSuitableX5Core | contract-research-pending |   |
| qq-bb2e903f753d | GetTranslateInfos music.bubble.BubbleIMSvr::GetTranslateInfos | contract-research-pending |   |
| qq-9b62fc3a61be | CgiReportCondition music.bubble.BubbleTreasureBoxSvr::CgiReportCondition | contract-research-pending |   |
| qq-b60a514d9833 | QueryDeeplink music.channelPromote.MusicCallBackSvr::QueryDeeplink | contract-research-pending |   |
| qq-3ad74d4bc5a2 | PictureMatch music.clientTool.pictureProcessSvr::PictureMatch | contract-research-pending |   |
| qq-ab10be1200f3 | QueryPictureMatchStatus music.clientTool.pictureProcessSvr::QueryPictureMatchStatus | contract-research-pending |   |
| qq-4d56fe509918 | QueryPlayPageBubble music.commonService.CommonBubbleSvr::QueryPlayPageBubble | contract-research-pending |   |
| qq-b73620b48faf | Get music.commonService.CommonConfSvr::Get | contract-research-pending |   |
| qq-b9c6cb4b044b | QueryFeatPopup music.commonService.FeatureWindowSvr::QueryFeatPopup | contract-research-pending |   |
| qq-d5258ae52b6b | GetPlayPageASGif music.commonService.PlayPageASConfSvr::GetPlayPageASGif | contract-research-pending |   |
| qq-185477a3b855 | CouldPopup music.commonService.PopupWindow::CouldPopup | contract-research-pending |   |
| qq-adf8154c3689 | ReportPopup music.commonService.PopupWindow::ReportPopup | contract-research-pending |   |
| qq-e8185b5f614f | GetConfig music.cosmeticact.CosmeticPlayPage::GetConfig | contract-research-pending |   |
| qq-dc70f903aa56 | GetDzList music.dazi.DzEntrySrv::GetDzList | contract-research-pending |   |
| qq-e719fe6f98b6 | GetShareDzList music.dazi.DzEntrySrv::GetShareDzList | contract-research-pending |   |
| qq-4506284f542c | Reserve music.debut.UniformDebut::Reserve | contract-research-pending |   |
| qq-423929e74868 | GetChaseDefaultKey music.defaultKey.DefaultKeyService::GetChaseDefaultKey | contract-research-pending |   |
| qq-be446dfbf8c6 | GetDefaultKeyForQQMusicMobile music.defaultKey.DefaultKeyService::GetDefaultKeyForQQMusicMobile | contract-research-pending |   |
| qq-07e75bab75b6 | GetRoles music.fansManagement.fansEntrance::GetRoles | contract-research-pending |   |
| qq-7d20cfe91f7d | get_favor_list music.favorSystemRead.FavorSystem::get_favor_list | contract-research-pending |   |
| qq-86d5fab5adea | do_favor music.favorSystemWrite.FavorSystem::do_favor | contract-research-pending |   |
| qq-7493e24cb0f7 | GetTime music.infras.NTPServer::GetTime | contract-research-pending |   |
| qq-e9f1e3c56c6b | QueryAllRoomIcon music.lightUGCRoom.LightUGCRoomAnimationSvr::QueryAllRoomIcon | contract-research-pending |   |
| qq-15c29b68d70e | GetChatMessageList music.lightUGCRoom.LightUGCRoomChatSvr::GetChatMessageList | contract-research-pending |   |
| qq-18acaba0c3b9 | DeleteLightUGCRoomHistory music.lightUGCRoom.LightUGCRoomDataRecordSvr::DeleteLightUGCRoomHistory | contract-research-pending |   |
| qq-41459f58ffad | GetLightUGCRoomHistory music.lightUGCRoom.LightUGCRoomDataRecordSvr::GetLightUGCRoomHistory | contract-research-pending |   |
| qq-0468f80b5601 | QueryLightUGCRoomState music.lightUGCRoom.LightUGCRoomSvr::QueryLightUGCRoomState | contract-research-pending |   |
| qq-ef24e46a6cd3 | QueryListeningEntrance music.listening.ListeningSvr::QueryListeningEntrance | contract-research-pending |   |
| qq-c9855e41e4af | GetBannerInfo music.liveShow.LiveShowEntriesSvr::GetBannerInfo | contract-research-pending |   |
| qq-5958ef8acc77 | GetStickersPrev music.loveletter.LoveLetterSvr::GetStickersPrev | contract-research-pending |   |
| qq-6d8878ae539f | ClickSubscribeEntrance music.lvz.SuperSubscribeCgi::ClickSubscribeEntrance | contract-research-pending |   |
| qq-e90770edba7e | GetMirInfo music.mir.MirInfoServer::GetMirInfo | contract-research-pending |   |
| qq-f9db25836c66 | Build music.mir.MixPlanSvr::Build | contract-research-pending |   |
| qq-63a5458d85c2 | BatchHasSheetMusic music.mir.SheetMusicSvr::BatchHasSheetMusic | contract-research-pending |   |
| qq-f982da81b5ad | DelRedDots music.msgcenter.RedDot::DelRedDots | contract-research-pending |   |
| qq-8495b9ff5a16 | GetRedDots music.msgcenter.RedDot::GetRedDots | contract-research-pending |   |
| qq-8b02ee1d90f2 | GetLoadingConfig music.musicGame.MusicGameConfigSrv::GetLoadingConfig | contract-research-pending |   |
| qq-9cf7ec5cb060 | GetPreLoadInfo music.musicGame.MusicGamePackageSrv::GetPreLoadInfo | contract-research-pending |   |
| qq-88957cce38cc | QryGamePkgUpdateInfo music.musicGame.MusicGamePackageSrv::QryGamePkgUpdateInfo | contract-research-pending |   |
| qq-b11abad1fc86 | GetRoomDetail music.musicStation.MusicStationRequestSrv::GetRoomDetail | contract-research-pending |   |
| qq-148f91130cfc | GetEntranceStatus music.musicWorld.MusicWorldEntranceSrv::GetEntranceStatus | contract-research-pending |   |
| qq-0063bf27ba32 | UpdateEntranceRedDot music.musicWorld.MusicWorldEntranceSrv::UpdateEntranceRedDot | contract-research-pending |   |
| qq-c1d12c37a2d4 | QryCocosDynamicLibs music.musicWorld.MusicWorldPackageSrv::QryCocosDynamicLibs | contract-research-pending |   |
| qq-68b869eae1f8 | QryPkgUpdateInfo music.musicWorld.MusicWorldPackageSrv::QryPkgUpdateInfo | contract-research-pending |   |
| qq-86b956e032e0 | getMyFavMV music.musicasset.MVFavRead::getMyFavMV | contract-research-pending |   |
| qq-36ccb52fc5e7 | AddDelFavMV music.musicasset.MVFavWrite::AddDelFavMV | contract-research-pending |   |
| qq-44aa9cb7fca8 | get_all_lock_status music.musicasset.PrivacyLock::get_all_lock_status | contract-research-pending |   |
| qq-d971c94b498c | set_lock_status music.musicasset.PrivacyLock::set_lock_status | contract-research-pending |   |
| qq-b3405ccaae63 | CheckExportNotify music.musicassetExport.ExportTask::CheckExportNotify | contract-research-pending |   |
| qq-d8197e4c2e73 | AcquireCard music.musicbz.BZCardAssetSvr::AcquireCard | contract-research-pending |   |
| qq-7ed515cfdc06 | CombineCard music.musicbz.BZCardAssetSvr::CombineCard | contract-research-pending |   |
| qq-9decf0e21ab7 | QueryAllCard music.musicbz.BZCardAssetSvr::QueryAllCard | contract-research-pending |   |
| qq-61b3cde3bc12 | NoticeOaidInfo music.noticeOaid.OaidInfo::NoticeOaidInfo | contract-research-pending |   |
| qq-fbb9e6cbce94 | GetMyTabEntranceInfos music.opsBase.EntranceSvr::GetMyTabEntranceInfos | contract-research-pending |   |
| qq-24c32999a880 | GetMyTabEntranceInfosV2 music.opsBase.EntranceSvr::GetMyTabEntranceInfosV2 | contract-research-pending |   |
| qq-fc500e889d4a | GetTango music.osu.OsuGarmentSvr::GetTango | contract-research-pending |   |
| qq-db11fb8fae10 | ReportGames music.osu.OsuReportSvr::ReportGames | contract-research-pending |   |
| qq-0e3db1d7f07c | BindDeviceInfo music.periphMgr.PeriphMgrSvr::BindDeviceInfo | contract-research-pending |   |
| qq-13ac347faedb | CheckPid music.periphMgr.PeriphMgrSvr::CheckPid | contract-research-pending |   |
| qq-1e8d7f7592dd | EarphoneActivation music.periphMgr.PeriphMgrSvr::EarphoneActivation | contract-research-pending |   |
| qq-742b94a72b44 | EarphoneConf music.periphMgr.PeriphMgrSvr::EarphoneConf | contract-research-pending |   |
| qq-bf2c834c8947 | EarphoneOTA music.periphMgr.PeriphMgrSvr::EarphoneOTA | contract-research-pending |   |
| qq-d5db91b41c9d | GetEncryptRandomInfo music.periphMgr.PeriphMgrSvr::GetEncryptRandomInfo | contract-research-pending |   |
| qq-23467b15ec0b | CanopyBubblePopUpCallBack music.personal.PersonalCanopyBubbleCgi::CanopyBubblePopUpCallBack | contract-research-pending |   |
| qq-c01f80cc422d | ApplyCanopy music.personal.PersonalRecrodSvr::ApplyCanopy | contract-research-pending |   |
| qq-c0ce35e86595 | CancelCanopy music.personal.PersonalRecrodSvr::CancelCanopy | contract-research-pending |   |
| qq-455579633aa1 | GetCanopy music.personal.PersonalSvr::GetCanopy | contract-research-pending |   |
| qq-aecd450d6697 | ListBubbles music.personal.WordBubbleSvr::ListBubbles | contract-research-pending |   |
| qq-93ea7124e8de | GetRecentPlayBanner music.personalCenter.BannerManageSvr::GetRecentPlayBanner | contract-research-pending |   |
| qq-af109c3acaeb | GetEntries music.privateMsg.PrivateMsgRead::GetEntries | contract-research-pending |   |
| qq-406832182833 | GetMsgDetails music.privateMsg.PrivateMsgRead::GetMsgDetails | contract-research-pending |   |
| qq-96b72550e64e | GetSafetyHint music.privateMsg.PrivateMsgRead::GetSafetyHint | contract-research-pending |   |
| qq-e369029d0079 | ActCardMsgCallBack music.privateMsg.PrivateMsgWrite::ActCardMsgCallBack | contract-research-pending |   |
| qq-318ae858e94b | ClearRedDot music.privateMsg.PrivateMsgWrite::ClearRedDot | contract-research-pending |   |
| qq-63e9dd6363b5 | EventReport music.privateMsg.PrivateMsgWrite::EventReport | contract-research-pending |   |
| qq-b2f00c13f154 | SetAllMsgMardRead music.privateMsg.PrivateMsgWrite::SetAllMsgMardRead | contract-research-pending |   |
| qq-aa48f9a9d636 | RecMatch music.push.MusicPushReport::RecMatch | contract-research-pending |   |
| qq-da17355a1cbb | GetConfig music.push.PushConfig::GetConfig | contract-research-pending |   |
| qq-68d9d6100bd4 | SetConfig music.push.PushConfig::SetConfig | contract-research-pending |   |
| qq-c8e0820fc644 | GetARCard music.putaocgi.ARCardCgi::GetARCard | contract-research-pending |   |
| qq-cc28ab5efef7 | GetStarLandReserveList music.reserve.ReserveDetail::GetStarLandReserveList | contract-research-pending |   |
| qq-c4823c987492 | Reserve music.reserve.ReserveDetail::Reserve | contract-research-pending |   |
| qq-eab8ccb4f8cf | ListeningMusicReport music.richFlag.listening::ListeningMusicReport | contract-research-pending |   |
| qq-937a1c312f6c | GetSubpageConfig music.ring.ringSetPage::GetSubpageConfig | contract-research-pending |   |
| qq-86d128d12ccf | GetCurrentRunnerCount music.runningMode.MusicRunnerCountSvr::GetCurrentRunnerCount | contract-research-pending |   |
| qq-0d724d1553e6 | getActionSheetConfig music.shareTarget.ShareTargetInfoSvr::getActionSheetConfig | contract-research-pending |   |
| qq-6b6e3b0fd669 | LongToShort music.shortUrl.sUrl::LongToShort | contract-research-pending |   |
| qq-cde7e9154547 | GetAutoPlayConf music.startup.AppStartupSetting::GetAutoPlayConf | contract-research-pending |   |
| qq-b41cc8642c13 | GetStartupConf music.startup.AppStartupSetting::GetStartupConf | contract-research-pending |   |
| qq-2a2e2ce30ea1 | GetOnlineWeather music.startup.PRConfig::GetOnlineWeather | contract-research-pending |   |
| qq-4fa489717f00 | GetIndiEntranceConfig music.startup.SourceConfig::GetIndiEntranceConfig | contract-research-pending |   |
| qq-5476fbcecb67 | GetMvUrls music.stream.MvUrlProxy::GetMvUrls | connected | MV 播放授权与视频解码 guest-live-tested |
| qq-ac7286a4baa2 | GetGuideTextConfig music.stream.TaskFreeListen::GetGuideTextConfig | contract-research-pending |   |
| qq-48cb7b77cffa | ReportAllFreeShareTask music.stream.TaskFreeListen::ReportAllFreeShareTask | contract-research-pending |   |
| qq-6ea6e03dc8ff | GetConfig music.superSound.Healing::GetConfig | contract-research-pending |   |
| qq-ebe5e5744922 | GetHearingConfig music.superSound.Hearing::GetHearingConfig | contract-research-pending |   |
| qq-0825629340e8 | ReportPopup music.unicom.DataflowAlert::ReportPopup | contract-research-pending |   |
| qq-623bc0de7b4b | InformPopupData music.unicom.FreeDataflowPopupCgi::InformPopupData | contract-research-pending |   |
| qq-5390f0c5ff30 | GetTrafficDetail music.unicom.WoMusicFreeTrafficSvr::GetTrafficDetail | contract-research-pending |   |
| qq-45ecdcad80d1 | query64url music.uniteUpgrade.upgradeSvr::query64url | contract-research-pending |   |
| qq-611ab390053e | BatchGetPresetTimbreWork music.venus.PresetTimbreWork::BatchGetPresetTimbreWork | contract-research-pending |   |
| qq-a64e1c4470e6 | Bind music.wxFriends.wxFriendsServer::Bind | contract-research-pending |   |
| qq-472e43f7773c | NotifyNotControlPopUp music.yiflow.Notify::NotifyNotControlPopUp | contract-research-pending |   |
| kugou-ac70ade66be2 | GET /download | connected | 逐字歌词下载与解析 guest-live-tested |
| kugou-ee081f9ca827 | POST /upload/exPartupload | contract-research-pending |   |
| kugou-069395798a80 | POST /v3/multipart/upload | contract-research-pending |   |
| kugou-4021618c54b1 | POST /v3/upload | contract-research-pending |   |
| kugou-a6c1bf313d77 | POST /v3/upload/bss/init | contract-research-pending |   |
| kugou-3bd6c46ff4f4 | POST /v3/upload/bss/part | contract-research-pending |   |
| kugou-35e77efc287c | POST /v3/upload/bss/status | contract-research-pending |   |
| kugou-3b781123484c | POST text_voice_order | contract-research-pending |   |
| kugou-a31bcca00ed2 | GET /mfx-shortvideo/audio/identity/search | contract-research-pending |   |
| kugou-110238aef808 | GET /search | connected | 准确 hash 的歌词候选搜索 guest-live-tested |
| kugou-882b1eb04e84 | GET /opern/v1/detail/song_info | contract-research-pending |   |
| kugou-998dd3c9e742 | GET /v1/upload/auth | contract-research-pending |   |
| kugou-e931eab7e59d | GET /v2/authorization | contract-research-pending |   |
| kugou-3065a41e3ae1 | GET /mfx-shortvideo/conf/filters/v3 | contract-research-pending |   |
| kugou-560682ea2c5e | GET /mfx-shortvideo/conf/video/decode-mode | contract-research-pending |   |
| kugou-9999ae2d40db | GET /mfx-shortvideo/conf/video/encode/blackList | contract-research-pending |   |
| kugou-bbebf41233bd | GET /mfx-shortvideo/kadian/recommend/audios | contract-research-pending |   |
| kugou-c18914f1e6b9 | GET /mfx-shortvideo/kadian/recommend/general | contract-research-pending |   |
| kugou-9694d6c6b2f9 | POST /mfx-shortvideo/video/digest | contract-research-pending |   |
| kugou-ba7c00c7b783 | POST /mfx-shortvideo/video/save/v2 | contract-research-pending |   |
| kugou-605f307ee528 | POST /v3/upload/video/init | contract-research-pending |   |
| kugou-1245f5dbe05a | POST /v3/upload/video/part | contract-research-pending |   |
| kugou-93270f7ec4d3 | POST /v3/upload/video/status | contract-research-pending |   |
| kugou-e214b0cd9668 | GET . | contract-research-pending |   |
| kugou-c8dfeb6a6993 | GET /i | contract-research-pending |   |
| kugou-a91e64e2fe65 | GET /i/v2 | contract-research-pending |   |
| kugou-0901a37d327f | GET /interface/index | contract-research-pending |   |
| kugou-3275e1c7475c | GET /multipart/query/partnumber | contract-research-pending |   |
| kugou-4e0caa9478a2 | POST /v3/multipart/complete | contract-research-pending |   |
| kugou-d0029be5929a | POST /v3/multipart/initiate | contract-research-pending |   |
| kugou-e12a1978c225 | POST asr | contract-research-pending |   |
| kugou-c8aaa0bfea5d | POST tts | contract-research-pending |   |
| kugou-c4a7a3b0f919 | POST v1/richanswer | contract-research-pending |   |
| kugou-d118661aaa2b | POST v1/richanswerV2 | contract-research-pending |   |
