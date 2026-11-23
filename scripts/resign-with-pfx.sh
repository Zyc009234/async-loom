#!/usr/bin/env bash
# One command to rebuild + re-sign every 0.8.5 artifact with a real code-signing certificate.
#   scripts/resign-with-pfx.sh /path/to/real.pfx /path/to/pfx-password.txt
# Signs main exe, ffmpeg, NSIS plugins, uninstaller, setup.exe and the MSI (all via scripts/sign.sh),
# then rebuilds the fpk (bundling the new setup + the real certificate) and release/.
# The uninstaller is signed while makensis runs, so NSIS has to be rebuilt, not just re-signed.
# Without arguments it rebuilds with the self-signed certificate in signing/.
set -euo pipefail
R=/workspace/async-loom-0.8.5
if [ $# -ge 1 ]; then
  [ -f "$1" ] && [ -f "${2:-}" ] || { echo "usage: $0 real.pfx password-file" >&2; exit 2; }
  export SIGN_PFX="$(readlink -f "$1")" SIGN_PFX_PASS_FILE="$(readlink -f "$2")"
  openssl pkcs12 -in "$SIGN_PFX" -passin "file:$SIGN_PFX_PASS_FILE" -nokeys -clcerts >/dev/null 2>&1 || openssl pkcs12 -legacy -in "$SIGN_PFX" -passin "file:$SIGN_PFX_PASS_FILE" -nokeys -clcerts >/dev/null || { echo "cannot open pfx with that password" >&2; exit 2; }
fi
"$R/scripts/build_all.sh"
"$R/scripts/build_fpk.sh"
"$R/scripts/make_release.sh"
for f in "$R"/release/*.exe "$R"/release/*.msi; do
  echo "== $f"; osslsigncode verify -in "$f" ${SIGN_PFX:+} $( [ -z "${SIGN_PFX:-}" ] && echo -CAfile "$R/signing/async-loom-codesign.crt" ) 2>&1 | grep -E '^(Signature verification|Timestamp Server Signature verification)' || true
done
