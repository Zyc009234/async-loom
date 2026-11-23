#!/usr/bin/env bash
# Build + sign the 0.8.5 MSI with wixl (msitools). Uses work/bin/async-loom-desktop.exe (unsigned, UNK marker).
# Honors SIGN_PFX / SIGN_PFX_PASS_FILE (see sign.sh).
set -euo pipefail
R=/workspace/async-loom-0.8.5
A=/workspace/async-loom-0.8.4-analysis
M=$R/work/msi
PY=/workspace/al-venv/bin/python
rm -rf "$M"; mkdir -p "$M/files"; cd "$M"
"$PY" "$R/scripts/set_marker.py" "$R/work/bin/async-loom-desktop.exe" files/async-loom-desktop.exe MSI
cp "$A/exe-unpacked/ffmpeg.exe" "$A/exe-unpacked/FFMPEG-LICENSE.txt" "$A/exe-unpacked/FFMPEG-README.txt" files/
cp "$R/work/icon.ico" files/icon.ico
"$R/scripts/sign.sh" files/async-loom-desktop.exe
"$R/scripts/sign.sh" files/ffmpeg.exe
cp "$R/scripts/async-loom.wxs" async-loom.wxs
wixl -a x64 -o async-loom-0.8.5-x64-zh-CN.msi async-loom.wxs
/workspace/al-venv/bin/python "$R/scripts/msi_fix_cn.py" async-loom-0.8.5-x64-zh-CN.msi
rm -f .gsf-save-*
"$R/scripts/sign.sh" async-loom-0.8.5-x64-zh-CN.msi
ls -la "$M/async-loom-0.8.5-x64-zh-CN.msi"
