#!/usr/bin/env bash
# Build async-loom 0.8.5 .fpk (fnOS) bundling the signed Windows NSIS installer.
# Layout follows the 0.8.4 fpk (fnpack 1.2.3 format): gzip tar with manifest/app.tgz/cmd/config/wizard/icons;
# manifest.checksum = md5(app.tgz).
set -euo pipefail
R=/workspace/async-loom-0.8.5
A=/workspace/async-loom-0.8.4-analysis
VER=0.8.5
W=$R/work/fpk; rm -rf "$W"; mkdir -p "$W/pkg" "$W/app"
SETUP="$R/work/bundle-proj/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/异步录屏_${VER}_x64-setup.exe"
# Certificate shipped next to the installer (/download/async-loom-signing.cer): self-signed by default,
# or the leaf certificate of SIGN_PFX when re-signing with a real code-signing certificate.
CERT_DER="$W/signing.cer"
if [ -n "${SIGN_PFX:-}" ]; then
  openssl pkcs12 -in "$SIGN_PFX" -passin "file:$SIGN_PFX_PASS_FILE" -nokeys -clcerts 2>/dev/null | openssl x509 -outform DER -out "$CERT_DER"
  CERT_SUBJECT=$(openssl x509 -inform DER -in "$CERT_DER" -noout -subject -nameopt utf8,sep_comma_plus_space | sed 's/^subject=//')
  osslsigncode verify -in "$SETUP" >/dev/null 2>&1 || echo "WARN: osslsigncode cannot chain the setup signature to a system CA (check on Windows)" >&2
else
  cp "$R/signing/async-loom-signing.cer" "$CERT_DER"
  CERT_SUBJECT="CN=瓜娃子, O=异步录屏, C=CN (self-signed)"
  osslsigncode verify -in "$SETUP" -CAfile "$R/signing/async-loom-codesign.crt" >/dev/null 2>&1 || { echo "setup not signed/verifiable" >&2; exit 1; }
fi
# --- app (becomes app.tgz) ---
tar xzf "$A/fpk-unpacked/app.tgz" -C "$W/app"
cp "$R/fpk-src/server.mjs" "$W/app/server/server.mjs"
rm -f "$W/app/ui/download/async-loom-setup.exe"
cat > "$W/app/ui/download/README.txt" <<'TXT'
从 0.8.5 起，Windows 客户端安装包放在应用目录的 windows/ 下（async-loom-setup-<版本>.exe，附 windows-client.json 和签名证书）。
安装后在飞牛应用首页点击“下载 Windows 客户端”即可获取，对应地址是 /download/async-loom-setup.exe。
TXT
mkdir -p "$W/app/windows"
cp "$SETUP" "$W/app/windows/async-loom-setup-$VER.exe"
cp "$CERT_DER" "$W/app/windows/async-loom-signing.cer"
SIZE=$(stat -c %s "$W/app/windows/async-loom-setup-$VER.exe")
SHA=$(sha256sum "$W/app/windows/async-loom-setup-$VER.exe" | cut -d' ' -f1)
CERT_SHA1=$(openssl x509 -inform DER -in "$CERT_DER" -noout -fingerprint -sha1 | cut -d= -f2)
cat > "$W/app/windows/windows-client.json" <<JSON
{
  "fileName": "async-loom-setup-$VER.exe",
  "version": "$VER",
  "size": $SIZE,
  "sha256": "$SHA",
  "signed": true,
  "certificateSubject": "$CERT_SUBJECT",
  "certificateSha1": "$CERT_SHA1"
}
JSON
find "$W/app" -name .DS_Store -delete
TARFLAGS=(--owner=0 --group=0 --numeric-owner --mtime=@"$(date +%s)" --sort=name)
(cd "$W/app" && tar "${TARFLAGS[@]}" -czf "$W/pkg/app.tgz" server ui windows config)
# --- outer package ---
for x in ICON.PNG ICON_256.PNG; do cp "$A/fpk-unpacked/$x" "$W/pkg/"; done
cp -r "$A/fpk-unpacked/cmd" "$A/fpk-unpacked/config" "$A/fpk-unpacked/wizard" "$W/pkg/"
chmod 755 "$W/pkg/cmd/"*
MD5=$(md5sum "$W/pkg/app.tgz" | cut -d' ' -f1)
sed -e "s/^version .*/version               = $VER/" \
    -e "s/^desc .*/desc                  = Windows 录屏后直接上传到飞牛本地保存，自动生成局域网或外网分享链接；客户端不连飞牛也能录屏并保存在本机。首页可直接下载已签名的 Windows 客户端。/" \
    -e "s/^changelog .*/changelog             = 0.8.5：Windows 客户端支持离线录屏、保存到本机、本机录屏列表和稍后上传分享；飞牛首页内置 Windows 客户端下载（含版本与 SHA256），安装包已签名。/" \
    -e "s/^checksum .*/checksum              = $MD5/" "$A/fpk-unpacked/manifest" > "$W/pkg/manifest"
(cd "$W/pkg" && tar "${TARFLAGS[@]}" -czf "$W/async-loom-$VER.fpk" app.tgz cmd config ICON.PNG ICON_256.PNG manifest wizard)
cat "$W/pkg/manifest"
ls -la "$W/async-loom-$VER.fpk"
