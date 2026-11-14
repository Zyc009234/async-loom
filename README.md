# 异步录屏

Windows 录屏后直接上传到自己的飞牛 NAS，自动生成局域网或公网分享链接。视频保存在
飞牛本地，不依赖 Docker、Postgres、MinIO 或第三方视频云。

## 下载

- [GitHub Release v0.2.2](https://github.com/Zyc009234/async-loom/releases/tag/v0.2.2)
- [Windows 安装版](https://www.zhaoyoucai.xyz/downloads/async-loom/0.2.2/async-loom-setup-0.2.2.exe)
- [Windows MSI](https://www.zhaoyoucai.xyz/downloads/async-loom/0.2.2/async-loom-0.2.2-x64-zh-CN.msi)
- [产品介绍与使用教程](https://www.zhaoyoucai.xyz/async/)

飞牛原生安装包不在 GitHub Release 中。安装包存放于飞牛文件空间：

```text
/vol1/1000/loom/async-loom-0.2.2.fpk
```

## 当前能力

- Windows Graphics Capture 录制主显示器和默认麦克风
- ffmpeg 编码 MP4，停止后直接上传到飞牛
- 飞牛本地 SQLite 保存视频元数据
- HTTP Range 播放，支持浏览器拖动进度
- 局域网分享链接
- 公网链接和局域网链接同时返回
- 安装后可在飞牛应用首页修改公网地址

公网分享需要飞牛已经有可访问的域名、公网 IP、DDNS 或反向代理，并正确指向
`38471` 端口。

## 版本

当前版本：`0.2.2`

飞牛应用依赖飞牛应用中心的 Node.js v22，不使用 Docker。
