# 更新日志

## [v3.1.2] - 2026-08-04

### Bug 修复
- 修复桌面歌词锁定时拖动主窗口桌面歌词闪烁不停的问题（hover IPC 添加状态缓存，仅状态变化时才发送，避免每帧调用 setIgnoreMouseEvents 导致窗口重绘）
- 修复歌曲详情页逐词歌词模式下歌词颜色偶尔变浅灰的问题（父级 .main-text 和子级 .yrc-word 同时使用 background-clip:text 导致层叠冲突，禁用 yrc-text 父级背景由子元素自行控制渐变）

## [v3.1.1] - 2026-08-04

### 新增功能
- 酷狗概念版新增「领取 VIP」入口：用户菜单可打开弹窗，支持领取今天一天 VIP、领取 3 小时时长（每天最多 8 次）、升级畅听 VIP，并展示当前 VIP 状态与当月已领取天数
- 酷狗歌手主页歌曲列表新增封面显示

### 交互优化
- 酷狗 / QQ 音乐所有歌曲列表改为**双击播放**（搜索、歌单、专辑、歌手、我喜欢页面；批量管理模式保持单击勾选）
- 主页 Banner 翻页按钮改为漂浮圆形样式，鼠标移入时才显现
- 平台切换下拉框选项字体缩小，顺序调整为：网易云 → 酷狗概念版 → QQ 音乐
- 歌曲详情页移除「歌词变色」开关及跟随逻辑，歌词高亮恢复为固定黑色
- 「我的音乐」中的官方云盘仅网易云平台显示，酷狗 / QQ 平台隐藏

### 按平台区分
- 最近播放列表按当前平台展示，切换平台即时过滤（本地歌曲所有平台可见）
- 搜索历史按平台独立记录（网易云 / 酷狗 / QQ 互不干扰），联想词与热门词跟随当前平台

### 界面修复
- 歌曲行 VIP 标识移到歌名右侧（修复原被挤压到专辑列旁的问题），涉及搜索 / 发现 / 歌单 / 歌手 / 专辑 / 我喜欢页面
- 酷狗用户 VIP 标识更换为内置 SVG 官方风格图标（原官方图片域名失效导致图标无法加载）

### 性能与安全
- 关闭 F12 / Ctrl+Shift+I 打开开发者控制台快捷键
- 移除后台终端大量日志输出（网易云 / 酷狗 / QQ 三个 API 子进程的 stdout/stderr 转发全部静默；主进程模块加载、缓存保存、封面写入、云盘上传、下载分片、动漫解析等常规日志全部清理），仅保留低频错误日志用于崩溃排查

## [v3.0.3] - 2026-08-04

### 网易云 API 本地化重构
- 网易云 API 主线路从在线服务（api.xiaomingky.cn）切换为**本地自部署 NeteaseCloudMusicApiEnhanced**（Electron 主进程启动子进程监听 3100 端口），在线 API 降级为推荐/备用线路
- 启动时自动检测本地服务可用性，不可用时自动回退到在线备用线路
- 新增 `electron/netease-api.js` 子进程管理（健康检查 + 异常自动重启 + 端口复用）
- 新增 `scripts/ensure-netease-api.cjs` 构建脚本，API 源码与依赖打包进安装包（extraResources）

### 安装包体积优化
- ffmpeg 从 101MB 精简至 6.9MB（瘦身 93%），安装包大幅减小

### 组件与发布
- ConfirmModal 重构：由全局 messageStore 命令式弹窗改为 props 声明式组件（visible/title/message/confirmText/danger + confirm/cancel 事件）
- 新增 `scripts/upload-release.ps1` 发布脚本

## [v3.0.2] - 2026-08-03

### 新增酷狗概念版平台（第三平台）
- 完整接入酷狗概念版：在网易云 / QQ 之后新增第三个平台，API 走自建固定线路（platform=lite 标记）
- 新增 `src/api/kugou.js` 封装（token + userid + dfid 设备指纹自动鉴权）
- 新增酷狗用户 Store：支持手机号验证码 / 二维码 / Cookie(Token) 三种登录方式
- 新增 8 个视图页面：发现音乐 / 搜索 / 歌单详情 / 歌单分类 / 歌手列表 / 歌手详情 / 专辑详情 / 我喜欢
- 新增酷狗歌曲评论组件（KugouComment）
- 7 档真实音质：标准 / 高品 / 无损 / Hi-Res / 蝰蛇全景声 / 蝰蛇清澈 / 超品，音质独立存储（kugou_music_quality）
- 酷狗蓝白主题（#2CA2F5）、`/kugou` 路由前缀隔离、三平台路由互斥守卫
- 歌词走酷狗 IPC 源（按 hash 直接获取），静默加载不弹窗
- 新增 `electron/kugou-music.js` 子进程（3300 端口，健康检查 + 自动重启 + 端口复用防冲突）
- 新增 `scripts/ensure-kugou-music-api.cjs` 构建脚本，API 打包进安装包（extraResources）

## [v3.0.1] - 2026-08-02

### 音质体系重构
- 网易云：移除 jymaster / sky / dolby（实测均映射成 jyeffect），保留 6 档真实音质
- QQ 音乐：新增独立音质菜单（128 / 320 / m4a / flac），移除不可用的 ape / master / atmos
- 两平台音质独立 localStorage 存储，互不干扰
- 移除沉浸环绕声子菜单及 immerseType 配置
- playSong / preload / downloadQQSong 改用用户所选音质 + 回退链

## [v3.0.0]

- 新增网易云官方云盘
- 新增 QQ 音乐平台支持
- 官网更新：新增 QQ 音乐、官方云盘、音量增益内容
- 修复打包后 QQ 音乐 API 服务不启动的问题（额外资源 + styleText polyfill + ELECTRON_RUN_AS_NODE 纯 Node 模式）
- 修复 QQ 音乐 API 接口 500 错误（Array.toReversed 等 polyfill 补全）
- 移除仓库内 server / 源码
