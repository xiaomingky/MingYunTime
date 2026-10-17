Official membership artwork, copied without redrawing from the APKs supplied in this workspace:

- `kugou-svip.webp`: 酷狗概念版 `ml.f.ic_free_mode_svip_highlight`, resource ID `0x7f080598`, `res/drawable-xxhdpi/aa8.webp`.
- `kugou-tvip.webp`: 酷狗概念版 `ml.f.ic_free_mode_tvip_highlight`, resource ID `0x7f08059b`, `res/drawable-xxhdpi/aaa.webp`.
- `qishui-vip.png`: 汽水音乐 `assets/offline/commercial_popups/static/image/vip-tag.c912234f.png`.
- `qishui-svip.png`: 汽水音乐 `assets/offline/commercial_popups/static/image/svip-tag.f94717bc.png`.

These assets identify the currently authenticated membership tier only. A logo does not itself establish a subscription or playback entitlement.

Song labels now use original platform artwork too. These labels describe the
recording's rights and are **not** evidence that the listener has membership:

- `qq-song-vip.png`: QQ APK `res/drawable-xxhdpi/pay_icon_in_cell_new_as.png`
  (66 × 42), the official green VIP cell label. Copied byte-for-byte, not redrawn.
  `pay_icon_in_cell_*` resources distinguish VIP, super VIP, and gift-only songs;
  the generic VIP label here follows the existing normalized `isVip` pay evidence.
- `kugou-song-vip.webp`: 酷狗概念版 APK
  `res/drawable-xxhdpi/img_tagofsong_vip.webp`, used by the common player so its
  existing Kugou marker is preserved when using the shared component.
- NetEase song rows and the player reuse the supplied APK's official
  `netease-vip.png` artwork (source above), only for the track's `fee === 1`.
  This is official VIP branding, not a fabricated replica of a native text tag.
- Qishui song rows and the player reuse `qishui-vip.png` (source above).
  Rights come from APK `NetTrackKt` → `NetLabelInfo.onlyVipPlayable` /
  `onlyVipDownload` (`label_info.only_vip_playable` /
  `only_vip_download` in API JSON). Download-only VIP has a distinct tooltip.
  Missing rights, preview length, and the account's VIP tier do not mark songs VIP.

- `kugou-standard-vip.webp`: official `VIPMusicImageView` → `com.kugou.common.R.drawable.kg_vip` (`0x7f080ee5`) → `res/drawable-xhdpi/c0j.webp`.
- `kugou-standard-svip.webp`: official `VIPMusicImageView` → `kg_svip` (`0x7f080e3e`) → `res/drawable-xxhdpi/bw1.webp`.

- `netease-vip.png`: 网易云 APK `resources/assets/vip_icon.json`, type 2, `vipIcon.normal.v0`; downloaded from its official `music.126.net` URL on 2026-10-17.
- `netease-svip.png`: same APK configuration, type 2, `svipIcon.normal.v0`. API-provided `redVipLevelIcon` takes precedence so a confirmed member level remains accurate.
