#!/usr/bin/env bash
# Authenticode-sign one Windows file (exe/dll/msi) in place with osslsigncode.
#   sign.sh <file>
# Certificate selection (first match wins):
#   SIGN_PFX=/path/real.pfx  SIGN_PFX_PASS_FILE=/path/pass.txt   (formal certificate, e.g. from a CA)
#   default: signing/async-loom-codesign.pfx (self-signed, CN=瓜娃子, O=异步录屏)
# Timestamp: RFC3161, tries several public TSAs; set SIGN_TS=none to skip.
# Already-signed files are re-signed (old signature removed first) unless SIGN_SKIP_SIGNED=1.
set -euo pipefail
f="$1"
here="$(cd "$(dirname "$0")/.." && pwd)"
pfx="${SIGN_PFX:-$here/signing/async-loom-codesign.pfx}"
passfile="${SIGN_PFX_PASS_FILE:-$here/signing/async-loom-codesign.pfx.pass}"
name="${SIGN_DESC:-异步录屏}"
url="${SIGN_URL:-https://www.zhaoyoucai.xyz/}"
tsas=(${SIGN_TS:-https://timestamp.sectigo.com http://timestamp.digicert.com https://rfc3161.ai.moda http://timestamp.globalsign.com/tsa/r6advanced1})
[ -f "$f" ] || { echo "sign.sh: no such file $f" >&2; exit 2; }
tmp="$(mktemp "${f}.XXXX.signing")"
trap 'rm -f "$tmp" "$tmp.unsigned"' EXIT
src="$f"
if osslsigncode verify -in "$f" >/dev/null 2>&1 || osslsigncode extract-signature -in "$f" -out /dev/null >/dev/null 2>&1; then
  if [ "${SIGN_SKIP_SIGNED:-0}" = 1 ]; then echo "already signed, skip: $f"; exit 0; fi
  osslsigncode remove-signature -in "$f" -out "$tmp.unsigned" >/dev/null
  src="$tmp.unsigned"
fi
common=(-pkcs12 "$pfx" -readpass "$passfile" -h sha256 -n "$name" -i "$url")
ok=0
if [ "${tsas[0]}" != none ]; then
  for ts in "${tsas[@]}"; do
    rm -f "$tmp"
    if osslsigncode sign "${common[@]}" -ts "$ts" -in "$src" -out "$tmp" >/dev/null 2>"$tmp.err"; then ok=1; echo "signed+timestamp($ts): $f"; break; fi
    echo "timestamp via $ts failed: $(tail -1 "$tmp.err")" >&2
  done
  rm -f "$tmp.err"
fi
if [ $ok = 0 ]; then
  rm -f "$tmp"
  osslsigncode sign "${common[@]}" -in "$src" -out "$tmp" >/dev/null
  echo "signed (NO timestamp): $f"
fi
chmod --reference="$f" "$tmp" 2>/dev/null || true
mv -f "$tmp" "$f"
