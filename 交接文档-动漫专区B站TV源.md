# 交接文档：动漫专区接入 B站 TV 源（番剧/电影）

> 更新时间：2026-08-27 | 当前版本：3.2.4 | 项目：茗韵时光播放器（MingYunTime）

---

## 一、任务概述

### 1.1 需求原文（用户原话）
> 动漫专区能否增加一个B站的，用的是TV接口即可。也是搞个登录，点击先检测网址解析登录了没，登录了就提示是否用网址解析的账号，没有就扫码。记住要有用户信息。
>
> （追加）按这个文档形式。而且 B站的源增加一个按钮在番剧和电影之间切换，因为电影和番剧我都要。

### 1.2 需求拆解
1. **动漫专区新增「B站TV」数据源**（与现有櫻花动漫 4 线路并列）
2. **播放取流用 B站 TV 接口**（`api.snm0516.aisee.tv`，无水印片源）
3. **B站源增加「番剧 / 电影」切换按钮**（`pgc/season/index/result` 的 `st=1` 番剧 / `st=2` 电影，首页与搜索都按当前类型过滤）
4. **登录流程**：
   - 点击登录 → 先检测「网址解析」模块的 B站 TV 登录状态（access_key）
   - 已登录 → 弹出提示"是否使用网址解析的账号"（复用）
   - 未登录 → 检测网页登录 → 提示 TV 接口需独立 TV 账号 → 打开扫码（TV 端扫码登录）
   - 登录后展示**用户信息**（头像 + 昵称）
5. **附属任务（已完成）**：抖音/快手图文解析修复 —— 用户已确认"抖音快手正常了"

### 1.3 当前进度
| 阶段 | 状态 |
| --- | --- |
| 需求分析 / 架构梳理 | ✅ 完成 |
| 代码实现（6 个 todo a1–a6） | ✅ 完成（含番剧/电影切换） |
| 版本号更新 + 构建 | ✅ 完成（3.2.3 → 3.2.4） |

---

## 二、现状分析结论（已核实）

### 2.1 动漫专区现状
- **入口**：`src/views/Anime.vue` — 首页/搜索，`sources` 数组 5 条（`yhfs/yhf/xdm/yhdmfan/bilibili`），tab 切换
- **详情页**：`src/views/AnimeDetail.vue` — 选集+播放+下载
- **路由**：`/anime/:source/:id`，Anime.vue `openDetail()` 用 `item.source || currentSource` 传 source
- **数据源 IPC**：`electron/anime.js`
  - `anime:sources` / `anime:home` / `anime:search` / `anime:detail` / `anime:parse-playurl`
  - 樱花 4 线路是同构 maccms（`parseCard` 统一解析 `.module-poster-item` 卡片），故障转移顺序 `['yhfs','yhf','xdm','yhdmfan']`
  - **`source==='bilibili'` 在三个 IPC 内显式分流**到 B站 PGC 目录（不参与 maccms 解析）
- **播放器**：`src/components/ArtVideoPlayer.vue`（m3u8/direct/flv/live 四模式 + **DASH 音视频分离 `audioUrl` prop**）
- **详情页播放**：樱花源 `play-type="m3u8"`（配"播放方案"）；**B站源 `play-type="direct"` + `audioUrl`（隐藏播放方案）**

### 2.2 B站 TV 接口基础设施（main.js 已完整具备，直接复用）
- **常量**：`BILI_TV_APPKEY=4409e2ce8ffd12b8`、`BILI_TV_APPSEC=59b43e04ad6965f34319062b478f83dd`、`BILI_TV_UA='BilibiliTV/106500'`、`mobi_app='android_tv_yst'`
- **签名**：`appSignParams(appkey, appsec, params)`（MD5 sign）
- **登录**：IPC `bilibili:tv-login-qr` / `bilibili:tv-login-check` / `bilibili:tv-login-status` / `bilibili:tv-logout`
  - token 持久化：`userData/bilibili-tv-token.json`（`accessKey` + `savedAt`，30 天）
  - `bilibili:tv-login-status` 已返回 `userInfo { uname, face }`（`x/web-interface/card` 按 mid 拉取）
- **取流**：`biliTvFetchPlayurl({ aid, cid, qn, fourk, bangumi, epId })` — 番剧/电影都走 `pgc/player/api/playurltv`（`bangumi=true` + `ep_id`）
- **多档尝试**：qn 列表 `[127,116,112,80,64,32,16]` 逐级下降，DASH 优先，`backup_url[0]` 优先
- **Web 登录**：IPC `bilibili:login-status`，Cookie 存 `userData/bili-cookie.json`

### 2.3 播放请求头注入（main.js webRequest，已全局生效）
- 请求含 `platform=android_tv_yst` → 自动换 `BilibiliTV/106500` UA 并 **删除 Referer/Origin**（TV 流去水印关键，实测：浏览器 UA 或 bili Referer → 403）
- `bilivideo.com/cn`、`hdslb.com`、`upos-sz-mirror*`、`mcdn` 等 → 自动注入 `Referer+PARSE_UA+Cookie`

### 2.4 下载 TV 流的防盗链修复（本次新增，重要！）
- `video-download` IPC 原逻辑对 `bilivideo` 一律注入 `Referer+PARSE_UA+Web Cookie`——**对 TV 流（platform=android_tv_yst）是错的**，会覆盖 download-manager 里 `BilibiliTV UA + 无 Referer` 的正确处理导致 403
- **本次修复**：`video-download` handler 先判断 `platform=android_tv_yst` → 改用 `BILI_TV_UA` 且删除 Referer/Origin；其余 bilivideo 才走原注入逻辑
- `download-manager.js` 第 224-226 行已有同款 TV 判断（`BilibiliTV/106500 UA + 无 Referer`），两者配合后 B站 TV 流下载正常

---

## 三、实现方案（5 个文件，均已落地）

### 3.1 `electron/anime.js` — B站番剧/电影目录 ⭐ a1 ✅
新增 B站 PGC 目录（数据源用 Web 公共 API，无需登录；登录/取流走 TV 接口）。`anime:home / anime:search / anime:detail` 处理器内按 `source==='bilibili'` 分流：

| 功能 | 接口（axios GET，浏览器 UA + Referer https://www.bilibili.com/） |
| --- | --- |
| 首页 | `https://api.bilibili.com/pgc/season/index/result?season_type={1|2}&order={3|2}&pagesize=30&page=1&type=1`（**参数是 season_type 不是 st**；番剧 order=3 追番热度、电影 order=2 播放热度，失败降级 order=0；再失败兜底 `pgc/season/rank/web/list?season_type={st}&day=3`） |
| 搜索 | `https://api.bilibili.com/x/web-interface/search/type?search_type={media_bangumi\|media_ft}&keyword={kw}` + **buvid3 Cookie**（`pgc/season/search/web` 被 WAF 拦返回 HTML，2026-08-27 实测必须换这个）；番剧 tab 用 `media_bangumi`，电影 tab 用 `media_ft` 且过滤 `season_type===2` |
| 详情 | `https://api.bilibili.com/pgc/view/web/season?season_id={id}` → **返回壳是 `result` 不是 `data`**（biliGet 统一兼容两种壳）；`result.episodes[]` |

**番剧/电影切换**：`BILI_CATS = { anime: { st:1, label:'番剧', orders:[3,0] }, movie: { st:2, label:'电影', orders:[2,0] } }`。首页用 `cat='all'` 走 `biliHomeAll()` **同时加载番剧+电影**（前端同屏展示，无需来回切换）；搜索用 `cat` 过滤类型。

卡片统一结构（`source:'bilibili'`，title 去 `<em>` 高亮标签、http 封面转 https）：
```js
{ id: String(season_id), title, cover, desc, source: 'bilibili' }
```
详情统一结构 + **B站特有字段**（供播放/下载）：
```js
{
  id, title, cover, desc: evaluate, source: 'bilibili',
  routes: [{ name: '正片', episodes: [{ title: `${i+1}`, longTitle, id: ep.id, aid: ep.aid, cid: ep.cid, source: 'bilibili' }] }]
}
```

### 3.2 `electron/main.js` — `bilibili:anime-playurl` IPC ⭐ a2 ✅
紧挨 `bilibili:tv-logout` 之后新增（`BILI_QUALITY_LABEL` 画质映射表同区定义）：
```js
ipcMain.handle('bilibili:anime-playurl', async (_, { epId, aid, cid }) => {
  // qn 从高到低尝试 biliTvFetchPlayurl({ aid, cid, bangumi: true, epId, qn, fourk: 1 })
  // DASH：最高画质 video + 最好音频 → { success, type:'dash', videoUrl, audioUrl, quality, qualityLabel }
  // durl：取第一段 → { success, type:'durl', url, quality }
  // 全失败 → { success:false, message:'取流失败，请检查网络或 TV 登录状态' }
})
```
- URL 选取遵循既有规则：**优先 `backup_url[0]`**（upos-sz-mirror 域名），其次 `base_url`
- 画质 id → 标签：127=8K / 126=杜比 / 125=HDR / 120=4K / 116=1080P60 / 112=1080P+ / 80=1080P / 74=720P60 / 64=720P / 32=480P / 16=360P
- **取流响应结构（2026-08-27 实测，重要）**：番剧 `pgc/player/api/playurltv` 返回**平铺 JSON**（`dash`/`durl` 在顶层，**无 `data` 壳**）；`biliTvFetchPlayurl` 已改为 `r.data.data ?? r.data` 兼容两种结构（此前 `!r.data.data` 判断导致番剧取流恒返回 null → "取流失败"，已修复）

### 3.3 `electron/preload.cjs` + `src/api/index.js` — 暴露接口 ⭐ a3 ✅
- preload.cjs：`biliAnimePlayurl: (params) => ipcRenderer.invoke('bilibili:anime-playurl', params)`
- src/api/index.js：`export const biliAnimePlayurl = (params) => animeBridge().biliAnimePlayurl(params)`；`animeHome/animeSearch` 增加 `opts` 透传（`{ cat }`），旧调用不受影响

### 3.4 `src/views/Anime.vue` — 源入口 + 番剧/电影同屏 + TV登录UI ⭐ a4 ✅
1. `sources` 数组新增：`{ id: 'bilibili', label: 'B站TV', desc: '无水印片源·需TV登录' }`
2. **B站源首页同时展示「番剧 + 电影」**：`biliHomeAll()` 一次加载两类数据，模板新增「电影·最新更新」「电影·热门推荐」区块（番剧/电影同屏，**无需来回切换**）
3. **「番剧/电影」切换按钮**（`bili-cat-tabs`，蓝色主题）保留：首页已同屏，按钮仅控制**搜索过滤范围**（搜索时按当前类型过滤结果）
4. 顶部新增 **TV 登录胶囊**（蓝色，参考 LocalVideo.vue `login-capsule bili-tv`）：
   - 未登录：`<MonitorPlay/> TV登录`
   - 已登录：头像缩略图 + 昵称，点击确认退出
5. `switchSource`/`onMounted` 进入 bilibili 源时 `loadBiliTvStatus()` 拉状态
6. **登录点击流程**（见第四节时序）
7. 扫码弹窗：`bili-qr-modal` 结构（扫码图 + "请使用B站手机App扫码完成TV端登录，登录后解锁1080P+/大会员档" 提示 + 过期刷新），样式独立实现（`.anime-overlay`/`.bili-qr-modal`，未依赖 LocalVideo 局部样式）

### 3.5 `src/views/AnimeDetail.vue` — B站播放/下载适配 ⭐ a5 ✅
- `playEpisode(ep)` 开头分流：`source === 'bilibili'` 时：
  1. `videoState = 'loading'`，调 `biliAnimePlayurl({ epId: ep.id, aid: ep.aid, cid: ep.cid })`
  2. dash → `playType='direct'` + `dashAudioUrl`（传给 ArtVideoPlayer `:audio-url`）；durl → `playType='direct'`（自带音轨）
  3. 未 TV 登录 → toast 提示"当前画质 X（未 TV 登录封顶），登录解锁 1080P+"（不阻断播放）
  4. 失败 → 提示检查网络/TV 登录
- ArtVideoPlayer 显示条件扩展：`playType === 'm3u8' || playType === 'direct'`；`:play-type` 改为动态绑定
- `handleDownloadEpisode` 分流：bilibili 时取流 → `downloadVideo({ url: videoUrl||url, type:'mp4', category:'anime', audioUrl })`（download-manager 已支持 ffmpeg 音视频合并；TV 流下载头由 2.4 修复保证）
- 详情页在 bilibili 源时**隐藏"播放方案"切换**（樱花的 iframe 解析方案对 B站无效）
- 选集标题：`${index+1} · ${longTitle}`（B站源）；播放器 badge 同款

---

## 四、登录流程时序（已实现，核心设计）

```
用户点击「TV登录」胶囊
        │
        ▼
┌─ biliTvLoginStatus()（TV token 检测）
│   │
│   ├─ 已登录（有 access_key）
│   │   ▼
│   │   弹确认："检测到网址解析已登录 B站TV 账号「{uname}」，是否使用该账号？"
│   │      ├─ [确定] → 直接用（加载 userInfo 头像昵称）✅
│   │      └─ [取消] → 打开 TV 扫码弹窗（新扫码会覆盖 token，即"换号"）
│   │
│   └─ 未登录
│       ▼
│   biliLoginStatus()（网址解析 Web 接口登录检测）
│       │
│       ├─ 网页已登录（SESSDATA 有效，有 uname）
│       │   ▼
│       │   弹确认："已检测到网址解析的 B站网页账号「{uname}」。TV 接口需 TV 端账号才能解锁高清，
│       │           是否现在打开 TV 扫码登录？"
│       │      ├─ [确定] → 打开 TV 扫码弹窗
│       │      └─ [取消] → 结束
│       │
│       └─ 都未登录 → 直接打开 TV 扫码弹窗（biliTvLoginQr 生成 → biliTvLoginCheck 轮询，2s）
```

**补充说明（为什么不做"网页账号复用"分支）**：
- TV 接口只认 `access_key`，**不能**直接用网页 Cookie —— 网页账号无法解锁 TV 取流的高画质
- 故网页已登录时给出的是"需 TV 端独立扫码"的提示而非"使用该账号"（避免误导：选了也用不上）
- 若后续确需"网页账号直接播放"，可做 `loginMode='web'`：详情页播放改走 `https://api.bilibili.com/pgc/player/web/playurl?ep_id={ep.id}&fnval=4048`（headers 带 biliCookie），列为遗留待办

---

## 五、已完成的旁项（不要回退）

**抖音/快手图文解析修复**（上一轮已完成，用户确认正常）：
1. **抖音图片带水印**：旧逻辑优先 `download_url_list`（带水印图）→ 改为优先 `url_list` 中不含 `~tplv-dy-water-v2` 的无水印图
2. **快手图集只出一张**：PC HTML 只渲染首图 → 新增 `extractKuaishouAtlas()`，从移动端 `window.INIT_STATE.atlas.list` 提取全量图片 + `atlas.cdn` 拼 URL
- 位置：`electron/main.js` 的 `douyinParse` / 快手解析 相关函数

---

## 六、技术约束（必须遵守，来自项目实测记忆）

1. **TV 接口流 URL**（`platform=android_tv_yst`）：必须 `BilibiliTV/106500` UA 且 **不带 Referer/Origin** —— 浏览器 UA 或 bili Referer → 403；仅 TV UA + 无 Referer → 200（webRequest 已处理，**不要在详情页给 video/audio 元素单独设置 Referer**）
2. **TV 接口字段**：`base_url`/`backup_url`（**下划线**）—— `base_url` 是 mcdn IP 直链（HTTP，webRequest 过滤不命中），应**优先 `backup_url[0]`**（upos-sz-mirror 域名，可注入）
3. **TV 接口未登录封顶 720P**（dash video id 64/32），1080P+ 需登录/大会员
4. **DASH 优先**（fnval=4048 多画质）；`durl` 模式可播放（整段有声）但画质单一 —— 取流按 DASH → durl 顺序回退
5. **番剧/电影 TV 取流必须带 `ep_id`**（`pgc/player/api/playurltv`），同时给 `cid`
6. **下载 TV 流**：`video-download` handler 与 `download-manager.js` 都要按 `platform=android_tv_yst` 走 `BilibiliTV UA + 无 Referer`（本次已修 video-download，**不要回退**）
7. **详情页必须隐藏樱花专用 UI**：bilibili 源时隐藏"播放方案" tab、不用 `anime:parse-playurl`（那是 maccms 线路的解析器）
8. **B站封面**（`i0.hdslb.com`）：webRequest 已注入 bili Referer，正常加载；onCoverError 兜底保留
9. **版本号规则**：**每次改动/构建都要递增版本**（当前 3.2.4），构建命令 `npm run build`，产物在 `release/`
10. 下载统一走主进程持久化下载目录（`download-dir.json`），**不要**在前端用 `savePath` 弹窗（除非 `askPath`）
11. **B站接口实测结论（2026-08-27 验证，长期有效）**：
    - ① 首页 `pgc/season/index/result` 参数是 **`season_type`**（不是 `st`），需带 `type=1`，返回 `data.list`
    - ② 详情 `pgc/view/web/season` 返回壳是 **`result`**（不是 `data`），biliGet 已统一兼容
    - ③ 搜索 `pgc/season/search/web` 被 WAF 拦截（返回 HTML），**必须**走 `x/web-interface/search/type` + buvid3 Cookie（`media_bangumi` 番剧 / `media_ft` 影视且过滤 `season_type===2`）
    - ④ 番剧 TV 取流 `pgc/player/api/playurltv` 返回**平铺 JSON**（`dash`/`durl` 在顶层、无 `data` 壳），`biliTvFetchPlayurl` 已兼容（未登录封顶 720P，dash.video 最高 id=80）

---

## 七、风险点与注意事项

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| 目录接口失效 | `index/result` 偶发风控/改版 | 首页多 order 降级 + `pgc/season/rank/web/list` 兜底，失效静默 |
| 电影/番剧 order 语义 | 电影用 order=2（播放热度）、番剧 order=3（追番热度），个别分类可能返回空 | 每个分类都带 order=0 综合兜底 |
| 搜索接口风控 | `season/search/web` 偶发 412 | headers 带完整浏览器 UA + Referer；失败提示重试 |
| 未登录 720P | 用户没扫码时画质被压 | 详情页播放后 toast 提示"登录解锁 1080P+" |
| DASH m4s 播放兼容 | ArtVideoPlayer `direct` + audioUrl 已成熟（LocalVideo 同款） | 照抄 LocalVideo 的 playParsedStream 赋值模式（playType/dashAudioUrl） |
| 网页账号复用 | TV 接口不吃网页 Cookie | 暂未实现 web 分支（见第四节备注），用户选择时才做 |
| 电影详情多 P | 系列电影/剧场版也可能有多集 | 选集逻辑与番剧完全一致（episodes 数组） |

---

## 八、测试清单

1. **目录**：切换 B站TV 源 → 首页/搜索/详情展示正常，封面加载，点击进入详情正确落位 `/anime/bilibili/{id}`
2. **番剧/电影切换**：B站源点「番剧/电影」→ 首页内容切换（st=1/st=2）；搜索时切类型按对应类型过滤（番剧含国创 type=4，电影只 type=2）
3. **登录**：
   - 网址解析已 TV 登录 → 动漫页提示"是否使用该账号" → 使用后展示头像昵称
   - 未登录 → 扫码 → 手机 App 扫码 → 轮询生效 → 胶囊变用户信息
   - 已登录胶囊点击 → 确认退出 → 回落未登录态
4. **播放**：TV 登录后点选集 → DASH 直链播放（画质 ≥1080P），音频同步正常，进度条可拖动；未登录播放 → 720P 封顶但可放
5. **下载**：B站番剧/电影下载 → ffmpeg 合并音频视频（TV 流下载不 403），命名含长标题
6. **切换**：B站源切回樱花 4 线路，播放方案切换恢复显示，樱花无回归
7. **回归**：网址解析页 Web/TV 登录胶囊互斥不受影响；抖音快手图文仍正常
8. **构建**：版本号 3.2.4，`npm run build` 出包正常

---

## 九、遗留 / 待办

- [x] 6 个 todo（a1–a6）全部落地（含番剧/电影切换）
- [ ] B站 目录接口真实可用性需一次真机联调（尤其首页 `index/result` 的 st=2 电影 order=2 是否稳定出数据）
- [ ] 未登录状态下的画质提示已做 toast，后续可考虑改为播放前弹窗（阻断式确认）
- [ ] 可选：「网页账号复用」分支（loginMode='web'，走 Web pgc 接口），用户明确要求时再做
