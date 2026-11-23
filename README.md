# 异步录屏

Windows 录屏后直接上传到自己的飞牛 NAS，自动生成局域网或公网分享链接。视频保存在
飞牛本地，不依赖 Docker、Postgres、MinIO 或第三方视频云。

## 下载

- [GitHub Release v0.8.4](https://github.com/Zyc009234/async-loom/releases/tag/v0.8.4)
- [Windows 安装版](https://www.zhaoyoucai.xyz/downloads/async-loom/0.8.4/async-loom-setup-0.8.4.exe)
- [Windows MSI](https://www.zhaoyoucai.xyz/downloads/async-loom/0.8.4/async-loom-0.8.4-x64-zh-CN.msi)
- [产品介绍与使用教程](https://www.zhaoyoucai.xyz/async/)

飞牛安装包见 [GitHub Release v0.8.5](https://github.com/Zyc009234/async-loom/releases/download/v0.8.5/async-loom-0.8.5.fpk)（仅 .fpk，未标为 latest，以免 Windows 客户端检查更新失败）。Windows 客户端请在飞牛应用内下载。

## 当前能力

- Windows Graphics Capture 录制主显示器和默认麦克风
- Windows 标题栏直接显示当前版本号
- 可选摄像头圆形气泡，支持设备选择、四角位置和小/中/大尺寸
- 摄像头气泡可在录制准备界面任意拖动
- Windows 原生流式直传，不经过前端内存；失败自动重试
- 开始录制具备防重复保护，并自动回收窗口重开后的残留会话
- 录制中支持暂停和继续，暂停时间不写入视频，恢复后视频和音频时间线正确接续
- 停止后先预览，再拖动时间轴裁剪视频头尾
- 可选择任意当前画面作为分享封面
- 设置页从 GitHub Releases 后台静默检查更新，只允许下载本项目 Release，并校验 GitHub 提供的 SHA256
- Windows 和飞牛均可直接提交用户反馈，反馈保存在官网而不写入飞牛数据库
- 官网反馈页展示作者回复、安装人数和近期活跃安装
- 飞牛首页可以从 GitHub 检查并下载新版 FPK
- ffmpeg 编码 MP4，停止后直接上传到飞牛
- 飞牛本地 SQLite 保存视频元数据
- HTTP Range 播放，支持浏览器拖动进度
- 局域网分享链接
- 公网链接和局域网链接同时返回
- 安装后可在飞牛应用首页修改公网地址
- 视频库支持改标题、删除、复制分享链接
- 分享密码、有效期和下载权限
- 观看次数与最近观看时间
- 独立访客数与行动按钮点击统计
- 视频说明、行动按钮、默认播放速度和静音自动播放
- 视频库标题/说明搜索
- iframe 嵌入代码、近 7 天观看数据和评论管理
- 时间点评论和表情反馈
- 飞牛首页、分享页和密码页直接显示服务版本

公网分享需要飞牛已经有可访问的域名、公网 IP、DDNS 或反向代理，并正确指向
`38471` 端口。

## 版本

当前版本：`0.8.4`

飞牛应用依赖飞牛应用中心的 Node.js v22，不使用 Docker。

## 源码说明

本仓库包含飞牛端源码，以及从 Windows 安装包中还原的前端。没有 Rust / Tauri 桌面端源码。0.8.5 的 Windows 客户端是在 0.8.4 的 Tauri 2.12.5 二进制上修补前端后重新打包的，并不能从本仓库独立编译出 exe。

目录结构：

- `server/`：飞牛原生应用（Node.js，监听 38471）。`server/server.mjs` 为 0.8.5 服务端；另有应用配置、图标，以及 fpk 打包用的 `server/fpk/`（manifest、安装脚本、向导等）。不包含 Windows 安装包二进制。
- `desktop-frontend/`：从 0.8.4 Windows 安装包中还原的前端（压缩后的资源，以及美化后的 `index.pretty.js`）。这不是完整的桌面端源码，也没有对应的 Rust 源码。
- `scripts/`：把 0.8.4 补丁为 0.8.5 的脚本（前端、服务端、exe 嵌入、NSIS/MSI/fpk 打包与签名调用）。这些脚本里的路径是当初的构建目录，签名私钥和证书不在本仓库。

当前版本：飞牛端 `0.8.5`；仓库里还原的 Windows 前端对应 `0.8.4`，0.8.5 的前端改动见 `scripts/patch_frontend.py`。
