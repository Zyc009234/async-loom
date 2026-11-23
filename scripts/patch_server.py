#!/usr/bin/env python3
"""0.8.4 -> 0.8.5 server.mjs: bundled Windows client download (GET/HEAD, Range, SHA256) + home page button."""
import sys, pathlib
src = pathlib.Path(sys.argv[1]); dst = pathlib.Path(sys.argv[2])
s = src.read_text()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count: raise SystemExit(f"anchor count {n} != {count}: {old[:100]!r}")
    s = s.replace(old, new)

rep('export const SERVICE_VERSION = "0.8.4";', 'export const SERVICE_VERSION = "0.8.5";')

# helpers (module level, before createAsyncLoomServer)
rep('export async function createAsyncLoomServer(options = {}) {', r'''const WINDOWS_SETUP_FILE = /^async-loom-setup(?:-(\d+\.\d+\.\d+))?\.exe$/i;

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((part) => Number(part) || 0);
  const pb = String(b || "0").split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest("hex");
}

export async function createAsyncLoomServer(options = {}) {''')

rep('''  const windowsSetupPath = path.join(packageRoot, "ui", "download", "async-loom-setup.exe");''', '''  // Windows client bundled inside the fpk. 0.8.4 only looked at ui/download/async-loom-setup.exe;
  // 0.8.5 ships it as windows/async-loom-setup-<version>.exe plus windows-client.json and searches
  // several locations so the download keeps working however fnOS lays out the app directory.
  const windowsClientDirs = [
    ...new Set(
      [
        options.windowsClientDir,
        process.env.ASYNC_LOOM_WINDOWS_DIR,
        path.join(packageRoot, "windows"),
        path.join(packageRoot, "ui", "download"),
        process.env.TRIM_APPDEST && path.join(process.env.TRIM_APPDEST, "windows"),
        process.env.TRIM_APPDEST && path.join(process.env.TRIM_APPDEST, "ui", "download"),
      ]
        .filter(Boolean)
        .map((dir) => path.resolve(dir)),
    ),
  ];
  const windowsClientHashes = new Map();

  async function findWindowsClient() {
    const found = [];
    for (const dir of windowsClientDirs) {
      const names = await fs.readdir(dir).catch(() => []);
      let sidecar = null;
      if (names.includes("windows-client.json")) {
        sidecar = await fs
          .readFile(path.join(dir, "windows-client.json"), "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => null);
      }
      for (const name of names) {
        const match = WINDOWS_SETUP_FILE.exec(name);
        if (!match) continue;
        const filePath = path.join(dir, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile() || stat.size === 0) continue;
        const meta = sidecar && sidecar.fileName === name ? sidecar : null;
        found.push({
          filePath,
          fileName: name,
          version: match[1] || meta?.version || null,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sidecarSha256:
            meta && Number(meta.size) === stat.size && /^[0-9a-f]{64}$/i.test(meta.sha256 || "")
              ? meta.sha256.toLowerCase()
              : null,
          signed: meta?.signed ?? null,
          certificateSha1: meta?.certificateSha1 ?? null,
        });
      }
      if (found.length) break;
    }
    if (!found.length) return null;
    found.sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs);
    return found[0];
  }

  async function windowsClientInfo() {
    const client = await findWindowsClient();
    if (!client) return null;
    const key = `${client.filePath}:${client.size}:${client.mtimeMs}`;
    let sha256 = windowsClientHashes.get(key);
    if (!sha256) {
      sha256 = await sha256File(client.filePath).catch(() => client.sidecarSha256);
      if (sha256) windowsClientHashes.set(key, sha256);
    }
    const downloadName = client.version ? `async-loom-setup-${client.version}.exe` : "async-loom-setup.exe";
    return {
      ...client,
      sha256: sha256 || null,
      downloadName,
      url: `/download/${downloadName}`,
    };
  }

  async function serveWindowsClient(request, response, requestedVersion) {
    const client = await windowsClientInfo();
    if (!client || (requestedVersion && requestedVersion !== client.version)) {
      console.warn(
        `Windows client not found (requested ${requestedVersion || "latest"}); searched: ${windowsClientDirs.join(", ")}`,
      );
      sendText(response, 404, client ? `没有 ${requestedVersion} 版本的 Windows 客户端，当前为 ${client.version}` : "当前安装包没有附带 Windows 客户端");
      return;
    }
    const range = parseRange(request.headers.range, client.size);
    if (range === undefined) {
      response.writeHead(416, { "Content-Range": `bytes */${client.size}` });
      response.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? client.size - 1;
    const headers = {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `attachment; filename="${client.downloadName}"`,
      "Cache-Control": "public, max-age=300",
      "Last-Modified": new Date(client.mtimeMs).toUTCString(),
      ...(client.sha256 ? { ETag: `"${client.sha256}"`, "X-Checksum-SHA256": client.sha256 } : {}),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${client.size}` } : {}),
    };
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    await pipeline(createReadStream(client.filePath, { start, end }), response);
  }''')

# routes: replace old single GET route
rep('''      if (request.method === "GET" && url.pathname === "/download/async-loom-setup.exe") {
        const stat = await fs.stat(windowsSetupPath).catch(() => null);
        if (!stat?.isFile()) {
          sendText(response, 404, "当前安装包没有附带 Windows 客户端");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/x-msdownload",
          "Content-Length": stat.size,
          "Content-Disposition": 'attachment; filename="async-loom-setup.exe"',
          "Cache-Control": "public, max-age=3600",
        });
        await pipeline(createReadStream(windowsSetupPath), response);
        return;
      }''', '''      const setupMatch = /^\\/download\\/async-loom-setup(?:-(\\d+\\.\\d+\\.\\d+))?\\.exe$/.exec(url.pathname);
      if ((request.method === "GET" || request.method === "HEAD") && setupMatch) {
        await serveWindowsClient(request, response, setupMatch[1] || null);
        return;
      }

      if (request.method === "GET" && url.pathname === "/download/async-loom-setup.exe.sha256") {
        const client = await windowsClientInfo();
        if (!client?.sha256) {
          sendText(response, 404, "当前安装包没有附带 Windows 客户端");
          return;
        }
        sendText(response, 200, `${client.sha256}  ${client.downloadName}\\n`);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/windows-client") {
        const client = await windowsClientInfo();
        sendJson(
          response,
          200,
          client
            ? {
                available: true,
                version: client.version,
                fileName: client.downloadName,
                size: client.size,
                sha256: client.sha256,
                url: client.url,
                signed: client.signed,
                certificateSha1: client.certificateSha1,
              }
            : { available: false },
        );
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/download/async-loom-signing.cer") {
        const certPath = windowsClientDirs
          .map((dir) => path.join(dir, "async-loom-signing.cer"))
          .find((candidate) => existsSyncSafe(candidate));
        if (!certPath) {
          sendText(response, 404, "没有附带签名证书");
          return;
        }
        const stat = await fs.stat(certPath);
        response.writeHead(200, {
          "Content-Type": "application/pkix-cert",
          "Content-Length": stat.size,
          "Content-Disposition": 'attachment; filename="async-loom-signing.cer"',
          "Cache-Control": "public, max-age=300",
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        await pipeline(createReadStream(certPath), response);
        return;
      }''')

rep('import { createReadStream, createWriteStream } from "node:fs";', 'import { createReadStream, createWriteStream, statSync } from "node:fs";')
rep('function compareVersions(a, b) {', '''function existsSyncSafe(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function compareVersions(a, b) {''')

# home page gets client info
rep('function homePage(videos, request, port, publicBaseUrl, canEdit) {', 'function homePage(videos, request, port, publicBaseUrl, canEdit, windowsClient = null) {')
rep('''  <p><a href="/download/async-loom-setup.exe">下载 Windows 客户端</a></p>''', '''  ${windowsClientCard(windowsClient)}''')
rep('''            isTrustedConfigRequest(request),
          ),
        );''', '''            isTrustedConfigRequest(request),
            await windowsClientInfo().catch(() => null),
          ),
        );''')
rep('function homePage(videos, request, port, publicBaseUrl, canEdit, windowsClient = null) {', '''function windowsClientCard(client) {
  if (!client) {
    return `<p class="muted">这个飞牛安装包没有附带 Windows 客户端。</p>`;
  }
  const meta = [client.version ? `v${escapeHtml(client.version)}` : "", formatBytes(client.size)]
    .filter(Boolean)
    .join(" · ");
  return `<div class="watch-actions" style="margin:12px 0 6px">
    <a class="btn" href="${escapeHtml(client.url)}" download>下载 Windows 客户端</a>
    <span class="muted">${meta}</span>
  </div>
  ${client.sha256 ? `<p class="muted" style="word-break:break-all;font-size:12px">SHA256：<code>${escapeHtml(client.sha256)}</code></p>` : ""}
  <p class="muted" style="font-size:12px">客户端不连飞牛也能录，录屏先存本机；填上本页地址后可一键上传分享。安装包使用自签名证书签名，Windows 可能仍提示“未知发布者”，可先<a href="/download/async-loom-signing.cer">下载签名证书</a>导入“受信任的发布者”。</p>`;
}

function homePage(videos, request, port, publicBaseUrl, canEdit, windowsClient = null) {''')

rep('''<li>在 Windows 客户端里填写飞牛局域网地址，例如 <code>http://${lanIp ?? "飞牛IP"}:${port}</code>，点击保存并测试。</li>''', '''<li>点上方“下载 Windows 客户端”安装。不填飞牛地址也能录，录屏先保存在本机。</li>
    <li>在 Windows 客户端里填写飞牛局域网地址，例如 <code>http://${lanIp ?? "飞牛IP"}:${port}</code>，点击保存并测试。</li>''')
dst.write_text(s)
print("server patched", len(s))
