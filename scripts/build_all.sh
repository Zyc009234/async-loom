#!/usr/bin/env bash
# Full rebuild of 异步录屏 0.8.5 Windows artifacts from the 0.8.4 binary + patched frontend.
#   frontend (esbuild) -> re-embed into exe (patch_exe.py) -> NSIS setup (tauri bundle) -> MSI (wixl)
# Signing via scripts/sign.sh (self-signed by default; SIGN_PFX/SIGN_PFX_PASS_FILE for a real cert).
set -euo pipefail
R=/workspace/async-loom-0.8.5
A=/workspace/async-loom-0.8.4-analysis
PY=/workspace/al-venv/bin/python
cd "$R/work"
node build-frontend.mjs
mkdir -p bin
"$PY" "$R/scripts/patch_exe.py" "$A/exe-unpacked/async-loom-desktop.exe" "$R/frontend-0.8.5" bin/async-loom-desktop.exe
"$R/scripts/bundle_nsis.sh"
"$R/scripts/build_msi.sh"
