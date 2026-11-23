#!/usr/bin/env bash
# Package the patched async-loom-desktop.exe into the Tauri NSIS installer (Linux makensis),
# signing main exe, ffmpeg, uninstaller and setup via scripts/sign.sh (Tauri signCommand).
set -euo pipefail
R=/workspace/async-loom-0.8.5
A=/workspace/async-loom-0.8.4-analysis
P=$R/work/bundle-proj
rm -rf "$P"; mkdir -p "$P/src-tauri/icons" "$P/src-tauri/binaries" "$P/src-tauri/src" "$P/dist"
cd "$P"
cp "$R/work/icon.ico" src-tauri/icons/icon.ico
echo '<!doctype html>' > dist/index.html
cp "$A/exe-unpacked/ffmpeg.exe" src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
cp "$A/exe-unpacked/FFMPEG-LICENSE.txt" "$A/exe-unpacked/FFMPEG-README.txt" src-tauri/binaries/
cat > src-tauri/Cargo.toml <<'EOF'
[package]
name = "async-loom-desktop"
version = "0.8.5"
description = "异步录屏 desktop shell"
edition = "2021"
publish = false

[workspace]

[[bin]]
name = "async-loom-desktop"
path = "src/main.rs"

[dependencies]
EOF
echo 'fn main() {}' > src-tauri/src/main.rs
cat > src-tauri/tauri.conf.json <<EOF
{
  "\$schema": "https://schema.tauri.app/config/2",
  "productName": "异步录屏",
  "mainBinaryName": "async-loom-desktop",
  "version": "0.8.5",
  "identifier": "dev.asyncloom.desktop",
  "build": { "frontendDist": "../dist" },
  "app": { "windows": [], "security": { "csp": null } },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "publisher": "异步录屏",
    "copyright": "Copyright © 2026 异步录屏",
    "category": "Video",
    "shortDescription": "录一段屏幕，留下链接，对方有空再看。",
    "longDescription": "异步录屏在 Windows 上录主显示器、麦克风和摄像头气泡；不连飞牛也能录并保存在本机，连上飞牛后一键上传分享。安装包带有 ffmpeg。",
    "icon": ["icons/icon.ico"],
    "externalBin": ["binaries/ffmpeg"],
    "resources": { "binaries/FFMPEG-LICENSE.txt": "FFMPEG-LICENSE.txt", "binaries/FFMPEG-README.txt": "FFMPEG-README.txt" },
    "windows": {
      "signCommand": { "cmd": "$R/scripts/sign.sh", "args": ["%1"] },
      "webviewInstallMode": { "type": "downloadBootstrapper", "silent": true },
      "nsis": {
        "installMode": "currentUser",
        "languages": ["SimpChinese"],
        "displayLanguageSelector": false,
        "installerIcon": "icons/icon.ico"
      }
    }
  }
}
EOF
mkdir -p src-tauri/target/x86_64-pc-windows-msvc/release
cp "$R/work/bin/async-loom-desktop.exe" src-tauri/target/x86_64-pc-windows-msvc/release/
echo '{"name":"bp","version":"0.8.5","private":true}' > package.json
"$R/work/node_modules/.bin/tauri" bundle --bundles nsis --target x86_64-pc-windows-msvc --ci -v
