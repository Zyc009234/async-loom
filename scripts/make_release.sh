#!/usr/bin/env bash
# Copy final artifacts into release/ (kept out of dist/build/out/target names) and write SHA256SUMS.
set -euo pipefail
R=/workspace/async-loom-0.8.5; V=0.8.5; O=$R/release
mkdir -p "$O"; rm -f "$O"/*
cp "$R/work/bundle-proj/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/异步录屏_${V}_x64-setup.exe" "$O/async-loom-setup-$V.exe"
cp "$R/work/msi/async-loom-$V-x64-zh-CN.msi" "$O/"
cp "$R/work/fpk/async-loom-$V.fpk" "$O/"
cp "$R/work/fpk/app/windows/async-loom-signing.cer" "$O/async-loom-signing.cer"
(cd "$O" && sha256sum async-loom-setup-$V.exe async-loom-$V-x64-zh-CN.msi async-loom-$V.fpk async-loom-signing.cer > SHA256SUMS)
ls -la "$O"; cat "$O/SHA256SUMS"
