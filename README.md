# 异步录屏

Windows 录屏后直接上传到自己的飞牛 NAS，自动生成局域网或公网分享链接。视频保存在
飞牛本地，不依赖 Docker、Postgres、MinIO 或第三方视频云。

## 下载

- [GitHub Release v0.6.1](https://github.com/Zyc009234/async-loom/releases/tag/v0.6.1)
- [Windows 安装版](https://www.zhaoyoucai.xyz/downloads/async-loom/0.6.1/async-loom-setup-0.6.1.exe)
- [Windows MSI](https://www.zhaoyoucai.xyz/downloads/async-loom/0.6.1/async-loom-0.6.1-x64-zh-CN.msi)
- [产品介绍与使用教程](https://www.zhaoyoucai.xyz/async/)

飞牛原生安装包不在 GitHub Release 中。安装包存放于飞牛文件空间：

```text
/vol1/1000/loom/async-loom-0.6.1.fpk
```

## 当前能力

- Windows Graphics Capture 录制主显示器和默认麦克风
- Windows 标题栏直接显示当前版本号
- 可选摄像头圆形气泡，支持设备选择、四角位置和小/中/大尺寸
- 摄像头气泡可在录制准备界面任意拖动
- Windows 原生流式直传，不经过前端内存；失败自动重试
- 录制后首尾裁剪和自动生成分享封面
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

当前版本：`0.6.1`

飞牛应用依赖飞牛应用中心的 Node.js v22，不使用 Docker。
