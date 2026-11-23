import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_PORT = 38471;
export const SERVICE_VERSION = "0.8.5";
const GITHUB_RELEASE_API =
  "https://api.github.com/repos/Zyc009234/async-loom/releases/latest";
const GITHUB_RELEASE_PREFIX =
  "https://github.com/Zyc009234/async-loom/releases/download/";

function versionParts(version) {
  return String(version ?? "")
    .replace(/^v/, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(current, latest) {
  const left = versionParts(current);
  const right = versionParts(latest);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return b > a;
  }
  return false;
}

const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
const VIDEO_ID = /^[a-zA-Z0-9_-]{8,40}$/;

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function cleanTitle(value) {
  const title = String(value ?? "").trim().slice(0, 200);
  return title || "未命名录屏";
}

function cleanDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function passwordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return true;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookieValue(request, name) {
  const cookies = firstHeader(request.headers.cookie)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const cookie of cookies) {
    const [key, ...value] = cookie.split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function isHttpsRequest(request) {
  return (
    firstHeader(request.headers["x-forwarded-proto"]).split(",")[0].trim() === "https" ||
    Boolean(request.socket.encrypted)
  );
}

function normalizeBaseUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return null;
  }
}

function normalizeLinkUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function newVideoId() {
  return randomBytes(9).toString("base64url");
}

function isPrivateIpv4(address) {
  return (
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function isPrivateAddress(address) {
  const value = String(address ?? "")
    .replace(/^::ffff:/i, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (!value) return false;
  if (value === "::1" || value === "localhost") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return net.isIP(value) === 4 && (isPrivateIpv4(value) || value.startsWith("127."));
}

function isTrustedConfigRequest(request) {
  if (firstHeader(request.headers["x-forwarded-host"]) || firstHeader(request.headers["x-forwarded-proto"])) {
    return false;
  }
  const remoteAddress = request.socket.remoteAddress;
  if (!isPrivateAddress(remoteAddress)) return false;

  const host = firstHeader(request.headers.host);
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname.endsWith(".local") || !hostname.includes(".")) {
    return true;
  }
  return isPrivateAddress(hostname);
}

export function findLanIpv4() {
  const candidates = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || address.address.startsWith("169.254.")) {
        continue;
      }
      candidates.push(address.address);
    }
  }
  return candidates.find(isPrivateIpv4) ?? candidates[0] ?? null;
}

function requestOrigin(request) {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]).split(",")[0].trim();
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]).split(",")[0].trim();
  const host = forwardedHost || firstHeader(request.headers.host) || `127.0.0.1:${DEFAULT_PORT}`;
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  return `${protocol}://${host}`;
}

function originPort(origin, fallback) {
  try {
    return new URL(origin).port || fallback;
  } catch {
    return fallback;
  }
}

function linksFor(request, id, port, publicBaseUrl = null) {
  const origin = requestOrigin(request);
  const lanIp = findLanIpv4();
  const lanOrigin = lanIp ? `http://${lanIp}:${originPort(origin, port)}` : null;
  let shareOrigin = origin;
  try {
    const hostname = new URL(origin).hostname;
    if ((hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") && lanOrigin) {
      shareOrigin = lanOrigin;
    }
  } catch {
    /* keep the original origin */
  }
  const publicUrl = publicBaseUrl ? `${publicBaseUrl}/v/${id}` : null;
  return {
    origin,
    playUrl: publicUrl || `${shareOrigin}/v/${id}`,
    publicUrl,
    lanUrl: lanOrigin ? `${lanOrigin}/v/${id}` : null,
  };
}

export function parseRange(header, size) {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;

  let start;
  let end;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start >= size || end < start) return undefined;
  return { start, end };
}

async function isMp4(pathname) {
  const handle = await fs.open(pathname, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 12) return false;
    const box = header.subarray(4, 8).toString("ascii");
    return box === "ftyp" || box === "styp";
  } finally {
    await handle.close();
  }
}

class ByteLimit extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.total = 0;
  }

  _transform(chunk, _encoding, callback) {
    this.total += chunk.length;
    if (this.total > this.limit) {
      const error = new Error("视频超过允许的最大大小");
      error.code = "UPLOAD_TOO_LARGE";
      callback(error);
      return;
    }
    callback(null, chunk);
  }
}

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(payload);
}

function sendText(response, status, message) {
  const payload = Buffer.from(message);
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(payload);
}

async function readJsonBody(request, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error("请求内容过大"), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON 格式不正确"), { status: 400 });
  }
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:dark;font-family:ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;background:#101014;color:#f5f2ed}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0,#3c1720 0,transparent 38%),#101014}
    main{width:min(960px,100%);margin:0 auto;padding:28px 18px 56px}a{color:#ff806d}
    .brand{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:.02em}.brand-icon{width:34px;height:34px;border-radius:9px}.version-badge{padding:3px 7px;border:1px solid #ffffff1c;border-radius:999px;background:#ffffff0a;color:#aaa6b0;font-size:11px;font-weight:650;letter-spacing:0}.dot{width:10px;height:10px;border-radius:50%;background:#ff4d2e;box-shadow:0 0 0 6px #ff4d2e22}
    h1{font-size:clamp(28px,7vw,52px);line-height:1.05;margin:28px 0 12px;letter-spacing:-.035em}.muted{color:#aaa6b0}
    video{display:block;width:100%;max-height:75vh;background:#000;border-radius:16px;margin-top:20px;box-shadow:0 24px 70px #0008}
    .card{border:1px solid #ffffff18;border-radius:18px;background:#ffffff09;padding:18px}.list{display:grid;gap:10px;margin-top:18px}
    .item{display:flex;gap:16px;justify-content:space-between;align-items:center}.item a{font-weight:650}.meta{font-size:13px;color:#aaa6b0}
    code{background:#ffffff10;padding:2px 6px;border-radius:6px}
    input{width:100%;padding:11px 12px;border:1px solid #ffffff22;border-radius:10px;background:#0b0b10;color:#f5f2ed;font:inherit}
    button{border:0;border-radius:10px;background:#2563eb;color:white;padding:11px 16px;font:inherit;font-weight:700;cursor:pointer}
    .form-row{display:flex;gap:10px;margin-top:12px}.form-row input{flex:1}.ok{color:#8ee7b8}
    .watch-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0}.btn,button{display:inline-block;border:0;border-radius:10px;background:#2563eb;color:white;padding:10px 14px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
    .video-description{white-space:pre-wrap;max-width:760px;color:#d4d0da;line-height:1.7}.speed-control{display:flex;align-items:center;gap:7px;color:#aaa6b0;font-size:13px}.speed-control select{padding:8px;border-radius:8px;background:#0b0b10;color:#f5f2ed;border:1px solid #ffffff22}
    .cta-button{display:inline-block;margin:4px 0 18px;padding:13px 20px;border-radius:12px;background:#ff6b57;color:white;text-decoration:none;font-weight:800;box-shadow:0 10px 28px #ff6b5740}
    .reactions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.reaction{background:#ffffff10;border:1px solid #ffffff18}.reaction span{margin-left:6px;color:#bbb6c6}
    .comments{margin-top:34px}.comment-list{display:grid;gap:10px}.comment{display:flex;gap:12px;padding:14px;border-radius:12px;background:#ffffff08}.comment p{margin:5px 0 0;color:#d4d0da}.comment-time{background:#ffffff10;color:#8de8ff;padding:5px 8px;align-self:flex-start;white-space:nowrap}
    .comment-form{margin-top:16px;display:grid;gap:10px}textarea{min-height:100px;padding:11px 12px;border:1px solid #ffffff22;border-radius:10px;background:#0b0b10;color:#f5f2ed;font:inherit;resize:vertical}
    .usage{margin-top:18px}.usage ol{margin:10px 0 0;padding-left:20px;line-height:1.8;color:#bbb6c6}
    .video-card{border:1px solid #ffffff18;border-radius:18px;background:#ffffff09;overflow:hidden}.video-card summary{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:17px 18px;cursor:pointer;list-style:none}.video-card summary::-webkit-details-marker{display:none}.video-card strong{display:block}.video-card small{display:block;color:#aaa6b0;margin-top:5px}
    .badges{display:flex;gap:6px;flex-wrap:wrap}.badges i{font-style:normal;font-size:12px;padding:4px 8px;border-radius:999px;background:#ffffff10;color:#c8c3cf}
    .video-body{padding:0 18px 18px;border-top:1px solid #ffffff10}.link-text{word-break:break-all;font-size:13px}.manage-form{display:grid;gap:10px}.manage-form label{font-size:13px;color:#aaa6b0;display:grid;gap:6px}.manage-form label.inline{display:flex;align-items:center;gap:8px}.manage-form input[type=checkbox]{width:auto;accent-color:#2563eb}.secondary{background:#ffffff12}.danger{background:#9f2c26}.manage-status{min-height:18px}
    .library-search{display:grid;gap:7px;margin:0 0 12px;color:#aaa6b0;font-size:13px}.manage-form textarea{min-height:82px}.manage-form select{padding:10px 12px;border:1px solid #ffffff22;border-radius:10px;background:#0b0b10;color:#f5f2ed;font:inherit}
    #feedback-form{display:grid;gap:12px}#feedback-form label{display:grid;gap:6px;color:#aaa6b0;font-size:13px}#feedback-form textarea{width:100%;min-height:120px}#feedback-form .watch-actions{margin-top:2px}
    .comment-admin{display:grid;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid #ffffff10}.comment-admin-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:#ffffff07;color:#c8c3cf;font-size:13px}.comment-admin-row button{padding:6px 9px;font-size:12px}
    @media(max-width:560px){.item{align-items:flex-start;flex-direction:column;gap:4px}}
    @media(max-width:560px){.form-row{flex-direction:column}}
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function accessCookieName(id) {
  return `loom_access_${id}`;
}

function isExpired(video, now = Date.now()) {
  return Boolean(video.expiresAt) && Date.parse(video.expiresAt) <= now;
}

function unlockPage(video) {
  return pageShell(
    `${cleanTitle(video.title)} · 需要密码`,
    `<div class="brand"><img class="brand-icon" src="/assets/icon.png" alt="">异步录屏<span class="version-badge">v${SERVICE_VERSION}</span></div>
<h1>${escapeHtml(cleanTitle(video.title))}</h1>
<p class="muted">这段录屏受密码保护，请输入分享密码后观看。</p>
<form id="unlock-form" class="card" style="max-width:460px;margin-top:22px">
  <input id="password" type="password" autocomplete="current-password" placeholder="分享密码" required>
  <button type="submit" style="margin-top:12px">打开录屏</button>
  <p id="unlock-status" class="muted"></p>
</form>
<script>
document.getElementById("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("unlock-status");
  status.textContent = "正在验证…";
  try {
    const response = await fetch("/api/videos/${encodeURIComponent(video.id)}/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "密码不正确");
    location.reload();
  } catch (error) {
    status.textContent = error.message || "密码不正确";
  }
});
</script>`,
  );
}

function watchPage(video, comments, reactions) {
  const title = cleanTitle(video.title);
  const commentRows = comments
    .map((comment) => {
      const seconds = Math.max(0, Math.floor(comment.timeMs / 1000));
      return `<article class="comment">
  <button type="button" class="comment-time" data-seek="${comment.timeMs}">${formatClock(comment.timeMs)}</button>
  <div><strong>${escapeHtml(comment.author)}</strong><p>${escapeHtml(comment.body)}</p></div>
</article>`;
    })
    .join("");
  const reactionButtons = ["👍", "❤️", "🎉", "👀", "💡"]
    .map((emoji) => {
      const record = reactions.find((item) => item.emoji === emoji);
      return `<button type="button" class="reaction" data-emoji="${emoji}">${emoji}<span>${record?.count ?? 0}</span></button>`;
    })
    .join("");
  return pageShell(
    title,
    `<div class="brand"><img class="brand-icon" src="/assets/icon.png" alt="">异步录屏<span class="version-badge">v${SERVICE_VERSION}</span></div>
<h1>${escapeHtml(title)}</h1>
<p class="muted">这段录屏保存在飞牛 NAS 上。持有链接的人可以在局域网或已配置的外网入口直接观看。</p>
${video.description ? `<p class="video-description">${escapeHtml(video.description)}</p>` : ""}
<video id="player" controls playsinline preload="metadata" ${video.thumbnailFile ? `poster="/thumbnail/${encodeURIComponent(video.id)}"` : ""} ${video.autoplayMuted ? "muted autoplay" : ""} src="/media/${encodeURIComponent(video.id)}"></video>
<div class="watch-actions">
  ${video.allowDownload ? `<a class="btn" href="/download/${encodeURIComponent(video.id)}">下载视频</a>` : ""}
  <label class="speed-control">速度<select id="speed"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
  <span class="muted">${video.viewCount} 次观看 · ${video.uniqueViewers ?? 0} 位访客 · 录制于 ${escapeHtml(video.createdAt)}</span>
</div>
${video.ctaUrl && video.ctaLabel ? `<a class="cta-button" href="/cta/${encodeURIComponent(video.id)}" target="_blank" rel="noopener">${escapeHtml(video.ctaLabel)}</a>` : ""}
<div class="reactions">${reactionButtons}</div>
<section class="comments">
  <h2>观看反馈</h2>
  <div class="comment-list">${commentRows || '<p class="muted">还没有评论。可以在视频的某个时间点留下反馈。</p>'}</div>
  <form id="comment-form" class="card comment-form">
    <input id="comment-author" maxlength="40" placeholder="你的名字" required>
    <textarea id="comment-body" maxlength="500" placeholder="写在这段视频的当前时间点…" required></textarea>
    <div class="watch-actions">
      <button type="submit">添加时间点评论</button>
      <span id="comment-status" class="muted">会记录当前播放时间</span>
    </div>
  </form>
</section>
<script>
const player = document.getElementById("player");
const speed = document.getElementById("speed");
const defaultSpeed = String(${Number(video.defaultSpeed) || 1});
speed.value = defaultSpeed;
player.playbackRate = Number(defaultSpeed);
speed.addEventListener("change", () => {
  player.playbackRate = Number(speed.value);
});
document.querySelectorAll("[data-seek]").forEach((button) => {
  button.addEventListener("click", () => {
    player.currentTime = Number(button.dataset.seek) / 1000;
    player.play().catch(() => {});
  });
});
document.querySelectorAll(".reaction").forEach((button) => {
  button.addEventListener("click", async () => {
    await fetch("/api/videos/${encodeURIComponent(video.id)}/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji: button.dataset.emoji, timeMs: Math.round(player.currentTime * 1000) })
    });
    location.reload();
  });
});
document.getElementById("comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("comment-status");
  status.textContent = "正在发送…";
  try {
    const response = await fetch("/api/videos/${encodeURIComponent(video.id)}/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: document.getElementById("comment-author").value,
        body: document.getElementById("comment-body").value,
        timeMs: Math.round(player.currentTime * 1000)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "发送失败");
    location.reload();
  } catch (error) {
    status.textContent = error.message || "发送失败";
  }
});
</script>`,
  );
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function windowsClientCard(client) {
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

function homePage(videos, request, port, publicBaseUrl, canEdit, windowsClient = null) {
  const videoCards = videos
    .map((video) => {
      const links = linksFor(request, video.id, port, publicBaseUrl);
      return `<details class="video-card">
  <summary>
    <span><strong>${escapeHtml(video.title)}</strong><small>${formatBytes(video.byteSize)} · ${video.viewCount} 次观看 · ${video.uniqueViewers ?? 0} 位访客 · 近 7 天 ${video.recentViews ?? 0} 次${video.ctaClicks ? ` · CTA ${video.ctaClicks} 次点击` : ""}${video.lastViewedAt ? ` · 最近 ${escapeHtml(video.lastViewedAt)}` : ""}</small></span>
    <span class="badges">${video.passwordHash ? "<i>密码</i>" : ""}${video.expiresAt ? "<i>限时</i>" : ""}${video.allowDownload ? "<i>可下载</i>" : "<i>禁下载</i>"}</span>
  </summary>
  <div class="video-body">
    <div class="watch-actions">
      <a class="btn" href="/v/${encodeURIComponent(video.id)}" target="_blank">打开分享页</a>
      <button type="button" class="copy-url" data-url="${escapeHtml(links.playUrl)}">复制当前链接</button>
      ${links.lanUrl ? `<button type="button" class="copy-url secondary" data-url="${escapeHtml(links.lanUrl)}">复制局域网链接</button>` : ""}
      <button type="button" class="copy-url secondary" data-url="${escapeHtml(`<iframe src="${links.playUrl}" width="100%" height="560" frameborder="0" allow="fullscreen" loading="lazy"></iframe>`)}">复制嵌入代码</button>
    </div>
    <p class="muted link-text">${escapeHtml(links.playUrl)}</p>
    <form class="manage-form" data-video-id="${escapeHtml(video.id)}">
      <label>标题<input name="title" value="${escapeHtml(video.title)}" maxlength="200" required></label>
      <label>视频说明<textarea name="description" maxlength="1000" placeholder="向观众说明这段视频的背景">${escapeHtml(video.description ?? "")}</textarea></label>
      <label>新分享密码<input name="password" type="password" maxlength="128" placeholder="留空则不修改"></label>
      <label class="inline"><input name="clearPassword" type="checkbox"> 清除密码</label>
      <label>到期时间<input name="expiresAt" type="datetime-local"></label>
      <label class="inline"><input name="allowDownload" type="checkbox" ${video.allowDownload ? "checked" : ""}> 允许下载</label>
      <label>行动按钮文字<input name="ctaLabel" maxlength="60" value="${escapeHtml(video.ctaLabel ?? "")}" placeholder="例如：预约演示"></label>
      <label>行动按钮网址<input name="ctaUrl" type="url" value="${escapeHtml(video.ctaUrl ?? "")}" placeholder="https://example.com"></label>
      <label>默认播放速度<select name="defaultSpeed"><option value="0.75" ${video.defaultSpeed === 0.75 ? "selected" : ""}>0.75×</option><option value="1" ${video.defaultSpeed === 1 ? "selected" : ""}>1×</option><option value="1.25" ${video.defaultSpeed === 1.25 ? "selected" : ""}>1.25×</option><option value="1.5" ${video.defaultSpeed === 1.5 ? "selected" : ""}>1.5×</option><option value="2" ${video.defaultSpeed === 2 ? "selected" : ""}>2×</option></select></label>
      <label class="inline"><input name="autoplayMuted" type="checkbox" ${video.autoplayMuted ? "checked" : ""}> 打开页面时静音自动播放</label>
      <div class="watch-actions"><button type="submit">保存设置</button><button type="button" class="delete-video danger" data-video-id="${escapeHtml(video.id)}">删除录屏</button></div>
      <p class="manage-status muted"></p>
    </form>
    <div class="comment-admin">
      <strong>评论管理</strong>
      ${(video.comments ?? []).map((comment) => `<div class="comment-admin-row"><span>${formatClock(comment.timeMs)} · ${escapeHtml(comment.author)}：${escapeHtml(comment.body)}</span><button type="button" class="delete-comment danger" data-comment-id="${escapeHtml(comment.id)}">删除</button></div>`).join("") || '<p class="muted">还没有评论。</p>'}
    </div>
  </div>
</details>`;
    })
    .join("");
  const lanIp = findLanIpv4();
  const publicSettings = canEdit
    ? `<form id="public-settings">
  <label class="muted" for="public-url">公网访问地址</label>
  <div class="form-row">
    <input id="public-url" type="url" value="${escapeHtml(publicBaseUrl ?? "")}" placeholder="https://video.example.com">
    <button type="submit">保存</button>
  </div>
  <p id="public-status" class="muted">填写域名或公网 IP，留空则只使用局域网链接。保存后立即生效。</p>
</form>`
    : `<p class="muted">公网地址设置只能通过飞牛局域网地址打开本页后修改。</p>`;
  return pageShell(
    "异步录屏 · 飞牛",
    `<div class="brand"><img class="brand-icon" src="/assets/icon.png" alt="">异步录屏<span class="version-badge">v${SERVICE_VERSION}</span></div>
<h1>录屏直接存进飞牛，保存、分享和评论都在这里。</h1>
<p class="muted">Windows 客户端停止录制后会直接上传到飞牛。视频保存在 NAS 本地，分享页支持观看、时间点评论、表情反馈、密码和有效期。</p>
<div class="card" style="margin-top:20px">
  <strong>飞牛访问地址</strong>
  <p class="muted">${lanIp ? `局域网：<code>http://${lanIp}:${port}</code>` : "未检测到局域网 IPv4 地址"}</p>
  <p class="muted">在飞牛上配置域名或反向代理后，用同一地址连接 Windows 客户端，生成的分享链接就会自动使用外网域名。</p>
  ${windowsClientCard(windowsClient)}
  <hr style="border:0;border-top:1px solid #ffffff14;margin:18px 0">
  ${publicSettings}
  <hr style="border:0;border-top:1px solid #ffffff14;margin:18px 0">
  <strong>在线更新</strong>
  <p id="update-status" class="muted">当前版本 v${SERVICE_VERSION}。从 GitHub Release 检查飞牛原生安装包。</p>
  <div class="watch-actions">
    <button type="button" id="check-update">检查更新</button>
    <button type="button" id="download-update" class="secondary" hidden>下载 FPK</button>
  </div>
</div>
<div class="card usage">
  <strong>怎么使用</strong>
  <ol>
    <li>点上方“下载 Windows 客户端”安装。不填飞牛地址也能录，录屏先保存在本机。</li>
    <li>在 Windows 客户端里填写飞牛局域网地址，例如 <code>http://${lanIp ?? "飞牛IP"}:${port}</code>，点击保存并测试。</li>
    <li>点击“录制并上传”，停止后 MP4 会直接写入飞牛，不需要 Docker、对象存储或第三方云盘。</li>
    <li>在飞牛首页展开录屏，可修改标题、密码、有效期和下载权限；观看次数会同步显示。</li>
    <li>有公网域名时，在上面填写公网地址；之后客户端会让您一键复制公网链接。观众无需登录即可观看和留言。</li>
  </ol>
</div>
<div class="card" id="feedback">
  <strong>问题反馈</strong>
  <form id="feedback-form">
    <label>昵称<input name="nick" maxlength="30" placeholder="可选"></label>
    <label>联系方式<input name="contact" maxlength="100" placeholder="邮箱、微信等，可选"></label>
    <label>反馈内容<textarea name="text" maxlength="2000" required placeholder="遇到什么问题，或者希望新增什么功能？"></textarea></label>
    <div class="watch-actions"><button type="submit">提交反馈</button></div>
    <p id="feedback-status" class="muted"></p>
  </form>
</div>
<h2 style="margin-top:32px">视频库</h2>
<label class="library-search">搜索标题或说明<input id="library-search" placeholder="输入关键词快速筛选"></label>
<div class="list" id="video-library">${videoCards || '<div class="card muted">还没有录屏。安装 Windows 客户端后开始第一段录制。</div>'}</div>
<script>
const publicForm = document.getElementById("public-settings");
if (publicForm) {
  publicForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("public-url");
    const status = document.getElementById("public-status");
    status.textContent = "正在保存…";
    status.className = "muted";
    try {
      const response = await fetch("/api/config/public-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: input.value.trim() })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      input.value = body.publicBaseUrl || "";
      status.textContent = body.publicBaseUrl ? "已保存，下一段录屏会生成公网链接。" : "已关闭公网链接，只使用局域网链接。";
      status.className = "ok";
    } catch (error) {
      status.textContent = error.message || "保存失败";
      status.className = "muted";
    }
  });
}
const updateButton = document.getElementById("check-update");
const downloadButton = document.getElementById("download-update");
const updateStatus = document.getElementById("update-status");
let availableUpdate = null;
updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  updateStatus.textContent = "正在从 GitHub 检查更新…";
  downloadButton.hidden = true;
  try {
    const response = await fetch("/api/update/check", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "检查更新失败");
    availableUpdate = body;
    if (!body.available) {
      updateStatus.textContent = "已经是最新版本 v" + body.latestVersion + "。";
    } else {
      updateStatus.textContent = "发现 v" + body.latestVersion + "：" + (body.notes || "有新版本可用");
      downloadButton.hidden = false;
    }
  } catch (error) {
    updateStatus.textContent = error.message || "检查更新失败";
  } finally {
    updateButton.disabled = false;
  }
});
downloadButton.addEventListener("click", async () => {
  if (!availableUpdate?.available) return;
  downloadButton.disabled = true;
  updateStatus.textContent = "正在下载并校验 FPK…";
  try {
    const response = await fetch("/api/update/download", { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "下载失败");
    location.href = "/download/update.fpk";
    updateStatus.textContent = "FPK 已校验并下载。请在飞牛应用中心选择“手动安装”，再选择刚下载的文件。";
  } catch (error) {
    updateStatus.textContent = error.message || "下载失败";
  } finally {
    downloadButton.disabled = false;
  }
});
const feedbackForm = document.getElementById("feedback-form");
feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("feedback-status");
  const data = new FormData(feedbackForm);
  status.textContent = "正在提交到网站…";
  status.className = "muted";
  let token = localStorage.getItem("async-loom.feedback-token");
  if (!token || !/^[0-9a-f]{32}$/.test(token)) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("async-loom.feedback-token", token);
  }
  try {
    const response = await fetch("https://www.zhaoyoucai.xyz/async-loom/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        v: "${SERVICE_VERSION}",
        plat: "fnos",
        nick: data.get("nick") || "",
        contact: data.get("contact") || "",
        text: data.get("text") || "",
        allowPublic: false
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "提交失败");
    status.textContent = "反馈已提交到网站，编号 #" + body.fid + "。";
    status.className = "ok";
    feedbackForm.querySelector("textarea").value = "";
  } catch (error) {
    status.textContent = error.message || "提交失败";
    status.className = "muted";
  }
});
document.querySelectorAll(".copy-url").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.url);
    const previous = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => button.textContent = previous, 1200);
  });
});
document.querySelectorAll(".manage-form").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".manage-status");
    const data = new FormData(form);
    const expiresLocal = String(data.get("expiresAt") || "");
    status.textContent = "正在保存…";
    const response = await fetch("/api/videos/" + encodeURIComponent(form.dataset.videoId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: String(data.get("title") || ""),
        password: String(data.get("password") || ""),
        clearPassword: data.has("clearPassword"),
        allowDownload: data.has("allowDownload"),
        expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null,
        description: String(data.get("description") || ""),
        ctaLabel: String(data.get("ctaLabel") || ""),
        ctaUrl: String(data.get("ctaUrl") || ""),
        autoplayMuted: data.has("autoplayMuted"),
        defaultSpeed: Number(data.get("defaultSpeed") || 1)
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = body.error || "保存失败";
      return;
    }
    status.textContent = "已保存";
    setTimeout(() => location.reload(), 450);
  });
});
document.querySelectorAll(".delete-video").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!confirm("删除后视频文件和分享链接都会失效，确定删除？")) return;
    const response = await fetch("/api/videos/" + encodeURIComponent(button.dataset.videoId), { method: "DELETE" });
    if (response.ok) location.reload();
    else alert("删除失败");
  });
});
document.querySelectorAll(".delete-comment").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!confirm("删除这条评论？")) return;
    const response = await fetch("/api/comments/" + encodeURIComponent(button.dataset.commentId), { method: "DELETE" });
    if (response.ok) location.reload();
    else alert("删除评论失败");
  });
});
const librarySearch = document.getElementById("library-search");
if (librarySearch) {
  librarySearch.addEventListener("input", () => {
    const keyword = librarySearch.value.trim().toLowerCase();
    document.querySelectorAll(".video-card").forEach((card) => {
      card.hidden = keyword && !card.textContent.toLowerCase().includes(keyword);
    });
  });
}
</script>`,
  );
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

const WINDOWS_SETUP_FILE = /^async-loom-setup(?:-(\d+\.\d+\.\d+))?\.exe$/i;

function existsSyncSafe(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

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

export async function createAsyncLoomServer(options = {}) {
  let publicBaseUrl = normalizeBaseUrl(
    options.publicBaseUrl || process.env.ASYNC_LOOM_PUBLIC_BASE_URL,
  );
  const packageRoot = path.resolve(
    options.packageRoot ||
      process.env.ASYNC_LOOM_PACKAGE_ROOT ||
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  // Windows client bundled inside the fpk. 0.8.4 only looked at ui/download/async-loom-setup.exe;
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
  }
  const brandIconCandidates = [
    path.join(packageRoot, "ui", "images", "icon_256.png"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../desktop/src-tauri/icons/128x128@2x.png"),
  ];
  const dataDir = path.resolve(
    options.dataDir || process.env.ASYNC_LOOM_DATA_DIR || path.join(process.cwd(), "data"),
  );
  const videosDir = path.join(dataDir, "videos");
  const thumbnailsDir = path.join(dataDir, "thumbnails");
  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(thumbnailsDir, { recursive: true });

  const maxUploadBytes =
    Number(options.maxUploadBytes || process.env.ASYNC_LOOM_MAX_UPLOAD_BYTES) ||
    DEFAULT_MAX_UPLOAD_BYTES;
  const db = new DatabaseSync(path.join(dataDir, "async-loom.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      password_salt TEXT,
      password_hash TEXT,
      expires_at TEXT,
      allow_download INTEGER NOT NULL DEFAULT 1,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT,
      thumbnail_file TEXT,
      description TEXT,
      cta_label TEXT,
      cta_url TEXT,
      cta_clicks INTEGER NOT NULL DEFAULT 0,
      autoplay_muted INTEGER NOT NULL DEFAULT 0,
      default_speed REAL NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS videos_created_at ON videos(created_at DESC);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_video ON comments(video_id, created_at);
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reactions_video ON reactions(video_id, created_at);
    CREATE TABLE IF NOT EXISTS access_tokens (
      token TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS view_events (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS view_events_video ON view_events(video_id, viewed_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = new Set(
    db
      .prepare("PRAGMA table_info(videos)")
      .all()
      .map((column) => column.name),
  );
  const additions = [
    ["password_salt", "TEXT"],
    ["password_hash", "TEXT"],
    ["expires_at", "TEXT"],
    ["allow_download", "INTEGER NOT NULL DEFAULT 1"],
    ["view_count", "INTEGER NOT NULL DEFAULT 0"],
    ["last_viewed_at", "TEXT"],
    ["thumbnail_file", "TEXT"],
    ["description", "TEXT"],
    ["cta_label", "TEXT"],
    ["cta_url", "TEXT"],
    ["cta_clicks", "INTEGER NOT NULL DEFAULT 0"],
    ["autoplay_muted", "INTEGER NOT NULL DEFAULT 0"],
    ["default_speed", "REAL NOT NULL DEFAULT 1"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${definition}`);
    }
  }

  const selectVideo = db.prepare(
    "SELECT id,title,file_name AS fileName,byte_size AS byteSize,duration_ms AS durationMs,created_at AS createdAt,password_salt AS passwordSalt,password_hash AS passwordHash,expires_at AS expiresAt,allow_download AS allowDownload,view_count AS viewCount,last_viewed_at AS lastViewedAt,thumbnail_file AS thumbnailFile,description,cta_label AS ctaLabel,cta_url AS ctaUrl,cta_clicks AS ctaClicks,autoplay_muted AS autoplayMuted,default_speed AS defaultSpeed,(SELECT COUNT(DISTINCT visitor_id) FROM view_events WHERE video_id = videos.id) AS uniqueViewers,(SELECT COUNT(*) FROM view_events WHERE video_id = videos.id AND julianday(viewed_at) >= julianday('now','-7 days')) AS recentViews FROM videos WHERE id = ?",
  );
  const listVideos = db.prepare(
    "SELECT id,title,file_name AS fileName,byte_size AS byteSize,duration_ms AS durationMs,created_at AS createdAt,password_salt AS passwordSalt,password_hash AS passwordHash,expires_at AS expiresAt,allow_download AS allowDownload,view_count AS viewCount,last_viewed_at AS lastViewedAt,thumbnail_file AS thumbnailFile,description,cta_label AS ctaLabel,cta_url AS ctaUrl,cta_clicks AS ctaClicks,autoplay_muted AS autoplayMuted,default_speed AS defaultSpeed,(SELECT COUNT(DISTINCT visitor_id) FROM view_events WHERE video_id = videos.id) AS uniqueViewers,(SELECT COUNT(*) FROM view_events WHERE video_id = videos.id AND julianday(viewed_at) >= julianday('now','-7 days')) AS recentViews FROM videos ORDER BY created_at DESC LIMIT 100",
  );
  const insertVideo = db.prepare(
    "INSERT INTO videos (id,title,file_name,byte_size,duration_ms,created_at) VALUES (?,?,?,?,?,?)",
  );
  const countVideos = db.prepare("SELECT COUNT(*) AS count FROM videos");
  const updateVideo = db.prepare(
    "UPDATE videos SET title = ?, password_salt = ?, password_hash = ?, expires_at = ?, allow_download = ?, description = ?, cta_label = ?, cta_url = ?, autoplay_muted = ?, default_speed = ? WHERE id = ?",
  );
  const updateThumbnail = db.prepare("UPDATE videos SET thumbnail_file = ? WHERE id = ?");
  const deleteVideo = db.prepare("DELETE FROM videos WHERE id = ?");
  const deleteComments = db.prepare("DELETE FROM comments WHERE video_id = ?");
  const deleteReactions = db.prepare("DELETE FROM reactions WHERE video_id = ?");
  const deleteAccessTokens = db.prepare("DELETE FROM access_tokens WHERE video_id = ?");
  const deleteViewEvents = db.prepare("DELETE FROM view_events WHERE video_id = ?");
  const recordView = db.prepare(
    "UPDATE videos SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?",
  );
  const insertViewEvent = db.prepare(
    "INSERT INTO view_events (id,video_id,visitor_id,viewed_at) VALUES (?,?,?,?)",
  );
  const incrementCta = db.prepare("UPDATE videos SET cta_clicks = cta_clicks + 1 WHERE id = ?");
  const insertComment = db.prepare(
    "INSERT INTO comments (id,video_id,author,body,time_ms,created_at) VALUES (?,?,?,?,?,?)",
  );
  const listComments = db.prepare(
    "SELECT id,author,body,time_ms AS timeMs,created_at AS createdAt FROM comments WHERE video_id = ? ORDER BY time_ms ASC, created_at ASC",
  );
  const deleteComment = db.prepare("DELETE FROM comments WHERE id = ?");
  const insertReaction = db.prepare(
    "INSERT INTO reactions (id,video_id,emoji,time_ms,created_at) VALUES (?,?,?,?,?)",
  );
  const listReactions = db.prepare(
    "SELECT emoji,COUNT(*) AS count,MAX(time_ms) AS latestMs FROM reactions WHERE video_id = ? GROUP BY emoji ORDER BY count DESC",
  );
  const insertAccessToken = db.prepare(
    "INSERT INTO access_tokens (token,video_id,expires_at) VALUES (?,?,?)",
  );
  const selectAccessToken = db.prepare(
    "SELECT video_id AS videoId,expires_at AS expiresAt FROM access_tokens WHERE token = ?",
  );
  const deleteExpiredTokens = db.prepare("DELETE FROM access_tokens WHERE expires_at <= ?");
  function videoAccessGranted(request, video) {
    if (!video.passwordHash) return true;
    const token = cookieValue(request, accessCookieName(video.id));
    if (!token) return false;
    const access = selectAccessToken.get(token);
    return access?.videoId === video.id && Date.parse(access.expiresAt) > Date.now();
  }
  const selectSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertSetting = db.prepare(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  async function pingCommunityInstallation() {
    const today = new Date().toISOString().slice(0, 10);
    let installationId = selectSetting.get("installation_id")?.value;
    if (!/^[0-9a-f]{32}$/.test(installationId ?? "")) {
      installationId = randomBytes(16).toString("hex");
      upsertSetting.run("installation_id", installationId);
    }
    if (selectSetting.get("installation_ping")?.value === today) return;
    try {
      const response = await fetch("https://www.zhaoyoucai.xyz/async-loom/api/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: installationId,
          v: SERVICE_VERSION,
          plat: "fnos",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) upsertSetting.run("installation_ping", today);
    } catch {
      // Statistics failures must never affect local recording or sharing.
    }
  }

  const updatesDir = path.join(dataDir, "updates");
  async function checkFnosUpdate() {
    const response = await fetch(GITHUB_RELEASE_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `async-loom-fnos/${SERVICE_VERSION}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub 更新检查失败：HTTP ${response.status}`);
    const release = await response.json();
    if (release.draft || release.prerelease) throw new Error("GitHub 最新发布不是正式版本");
    const asset = (release.assets ?? []).find(
      (item) => /^async-loom-\d+\.\d+\.\d+\.fpk$/.test(item.name ?? ""),
    );
    if (!asset) throw new Error("GitHub Release 中没有飞牛 FPK");
    const sha256 = String(asset.digest ?? "").replace(/^sha256:/, "");
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error("GitHub FPK 缺少 SHA256 摘要");
    }
    if (!String(asset.browser_download_url ?? "").startsWith(GITHUB_RELEASE_PREFIX)) {
      throw new Error("GitHub FPK 下载地址不可信");
    }
    const latestVersion = String(release.tag_name ?? "").replace(/^v/, "");
    return {
      currentVersion: SERVICE_VERSION,
      latestVersion,
      available: isNewerVersion(SERVICE_VERSION, latestVersion),
      notes: release.body ?? "",
      publishedAt: release.published_at ?? "",
      fileName: asset.name,
      sha256,
      downloadUrl: asset.browser_download_url,
    };
  }

  async function downloadFnosUpdate() {
    const update = await checkFnosUpdate();
    if (!update.available) return { ...update, downloaded: false };
    const response = await fetch(update.downloadUrl, {
      headers: { "user-agent": `async-loom-fnos/${SERVICE_VERSION}` },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`FPK 下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024 || bytes.length > 256 * 1024 * 1024) {
      throw new Error("FPK 文件大小异常");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== update.sha256.toLowerCase()) throw new Error("FPK 校验失败");
    await fs.mkdir(updatesDir, { recursive: true });
    const target = path.join(updatesDir, update.fileName);
    const partial = `${target}.part`;
    await fs.writeFile(partial, bytes);
    await fs.rename(partial, target);
    return { ...update, downloaded: true, localPath: target };
  }
  const savedPublicBaseUrl = selectSetting.get("public_base_url")?.value;
  if (savedPublicBaseUrl !== undefined) {
    publicBaseUrl = normalizeBaseUrl(savedPublicBaseUrl);
  } else if (publicBaseUrl) {
    upsertSetting.run("public_base_url", publicBaseUrl);
  }

  async function handleUpload(request, response, url, port) {
    if (!/^(video\/mp4|video\/\*|application\/octet-stream)/i.test(request.headers["content-type"] || "")) {
      sendJson(response, 415, { error: "只接受 MP4 视频" });
      return;
    }
    const declaredSize = Number(request.headers["content-length"] || 0);
    if (declaredSize > maxUploadBytes) {
      sendJson(response, 413, { error: `视频不能超过 ${formatBytes(maxUploadBytes)}` });
      return;
    }

    const id = newVideoId();
    const fileName = `${id}.mp4`;
    const finalPath = path.join(videosDir, fileName);
    const partialPath = path.join(videosDir, `.${fileName}.part`);
    const limiter = new ByteLimit(maxUploadBytes);

    try {
      await pipeline(request, limiter, createWriteStream(partialPath, { flags: "wx" }));
      const stat = await fs.stat(partialPath);
      if (stat.size === 0) throw Object.assign(new Error("没有收到视频内容"), { code: "EMPTY_UPLOAD" });
      if (!(await isMp4(partialPath))) {
        throw Object.assign(new Error("上传的文件不是有效的 MP4"), { code: "NOT_MP4" });
      }
      await fs.rename(partialPath, finalPath);
      const title = cleanTitle(url.searchParams.get("title"));
      const durationMs = cleanDuration(url.searchParams.get("durationMs"));
      const createdAt = new Date().toISOString();
      insertVideo.run(id, title, fileName, stat.size, durationMs, createdAt);
      const links = linksFor(request, id, port, publicBaseUrl);
      sendJson(response, 201, {
        videoId: id,
        status: "ready",
        title,
        byteSize: stat.size,
        durationMs,
        createdAt,
        playUrl: links.playUrl,
        publicUrl: links.publicUrl,
        lanUrl: links.lanUrl,
      });
    } catch (error) {
      await fs.rm(partialPath, { force: true }).catch(() => undefined);
      if (error?.code === "UPLOAD_TOO_LARGE") {
        sendJson(response, 413, { error: `视频不能超过 ${formatBytes(maxUploadBytes)}` });
      } else if (error?.code === "NOT_MP4") {
        sendJson(response, 415, { error: error.message });
      } else if (error?.code === "EMPTY_UPLOAD") {
        sendJson(response, 400, { error: error.message });
      } else if (!response.headersSent) {
        sendJson(response, 500, { error: `保存视频失败：${error?.message || error}` });
      }
    }
  }

  async function serveMedia(request, response, id) {
    const record = selectVideo.get(id);
    if (!record) {
      sendText(response, 404, "找不到这段录屏");
      return;
    }
    if (isExpired(record)) {
      sendText(response, 410, "这段录屏已经过期");
      return;
    }
    if (!videoAccessGranted(request, record)) {
      sendText(response, 401, "这段录屏需要密码");
      return;
    }
    const filePath = path.join(videosDir, record.fileName);
    const stat = await fs.stat(filePath);
    const range = parseRange(request.headers.range, stat.size);
    if (range === undefined) {
      response.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    const length = stat.size === 0 ? 0 : end - start + 1;
    response.writeHead(range ? 206 : 200, {
      "Content-Type": "video/mp4",
      "Content-Length": length,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    if (request.method === "HEAD" || length === 0) {
      response.end();
      return;
    }
    await pipeline(createReadStream(filePath, { start, end }), response);
  }

  async function serveDownload(request, response, id) {
    const record = selectVideo.get(id);
    if (!record) {
      sendText(response, 404, "找不到这段录屏");
      return;
    }
    if (isExpired(record)) {
      sendText(response, 410, "这段录屏已经过期");
      return;
    }
    if (!record.allowDownload) {
      sendText(response, 403, "分享者已关闭下载");
      return;
    }
    if (!videoAccessGranted(request, record)) {
      sendText(response, 401, "这段录屏需要密码");
      return;
    }
    const stat = await fs.stat(path.join(videosDir, record.fileName));
    response.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${id}.mp4"`,
      "Cache-Control": "private, no-store",
    });
    await pipeline(createReadStream(path.join(videosDir, record.fileName)), response);
  }

  async function serveThumbnail(request, response, id) {
    const video = selectVideo.get(id);
    if (!video?.thumbnailFile || isExpired(video) || !videoAccessGranted(request, video)) {
      sendText(response, 404, "找不到封面");
      return;
    }
    const filePath = path.join(thumbnailsDir, video.thumbnailFile);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      sendText(response, 404, "找不到封面");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=300",
    });
    await pipeline(createReadStream(filePath), response);
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "content-type,content-length,x-file-name,x-duration-ms",
    );

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const port = options.port || Number(process.env.PORT) || DEFAULT_PORT;
    const url = new URL(request.url || "/", requestOrigin(request));
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: "async-loom-fnos",
          version: SERVICE_VERSION,
          videos: countVideos.get().count,
          lanUrl: findLanIpv4() ? `http://${findLanIpv4()}:${port}` : null,
          publicBaseUrl,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/update/check") {
        try {
          sendJson(response, 200, await checkFnosUpdate());
        } catch (error) {
          sendJson(response, 502, { error: error?.message || "检查更新失败" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/update/download") {
        try {
          sendJson(response, 200, await downloadFnosUpdate());
        } catch (error) {
          sendJson(response, 502, { error: error?.message || "下载更新失败" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/download/update.fpk") {
        const names = await fs.readdir(updatesDir).catch(() => []);
        const fpk = names
          .filter((name) => /^async-loom-\d+\.\d+\.\d+\.fpk$/.test(name))
          .sort()
          .at(-1);
        if (!fpk) {
          sendText(response, 404, "还没有下载更新包");
          return;
        }
        const filePath = path.join(updatesDir, fpk);
        const stat = await fs.stat(filePath);
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="${fpk}"`,
          "Cache-Control": "no-store",
        });
        await pipeline(createReadStream(filePath), response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/videos") {
        const items = listVideos.all().map((video) => {
          return {
            id: video.id,
            title: video.title,
            createdAt: video.createdAt,
            byteSize: video.byteSize,
            durationMs: video.durationMs,
            viewCount: video.viewCount,
            lastViewedAt: video.lastViewedAt,
            description: video.description,
            ctaLabel: video.ctaLabel,
            ctaUrl: video.ctaUrl,
            ctaClicks: video.ctaClicks,
            autoplayMuted: Boolean(video.autoplayMuted),
            defaultSpeed: video.defaultSpeed,
            uniqueViewers: video.uniqueViewers,
            recentViews: video.recentViews,
            hasPassword: Boolean(video.passwordHash),
            expiresAt: video.expiresAt,
            allowDownload: Boolean(video.allowDownload),
            playUrl: linksFor(request, video.id, port, publicBaseUrl).playUrl,
          };
        });
        sendJson(response, 200, { items });
        return;
      }

      if (request.method === "GET" && url.pathname === "/assets/icon.png") {
        let iconPath = null;
        for (const candidate of brandIconCandidates) {
          if ((await fs.stat(candidate).catch(() => null))?.isFile()) {
            iconPath = candidate;
            break;
          }
        }
        if (!iconPath) {
          sendText(response, 404, "找不到应用图标");
          return;
        }
        const stat = await fs.stat(iconPath);
        response.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=86400",
        });
        await pipeline(createReadStream(iconPath), response);
        return;
      }

      const setupMatch = /^\/download\/async-loom-setup(?:-(\d+\.\d+\.\d+))?\.exe$/.exec(url.pathname);
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
        sendText(response, 200, `${client.sha256}  ${client.downloadName}\n`);
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
      }

      if (request.method === "POST" && url.pathname === "/api/config/public-url") {
        if (!isTrustedConfigRequest(request)) {
          sendJson(response, 403, { error: "请通过飞牛局域网地址修改公网设置" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const input = typeof body?.publicBaseUrl === "string" ? body.publicBaseUrl.trim() : "";
          const next = normalizeBaseUrl(input);
          if (input && !next) {
            sendJson(response, 400, {
              error: "公网地址必须是 http:// 或 https:// 开头的完整地址",
            });
            return;
          }
          publicBaseUrl = next;
          upsertSetting.run("public_base_url", publicBaseUrl ?? "");
          sendJson(response, 200, { ok: true, publicBaseUrl });
        } catch (error) {
          sendJson(response, error?.status || 400, { error: error?.message || "保存失败" });
        }
        return;
      }

      const unlockMatch = /^\/api\/videos\/([a-zA-Z0-9_-]+)\/unlock$/.exec(url.pathname);
      if (request.method === "POST" && unlockMatch && VIDEO_ID.test(unlockMatch[1])) {
        const video = selectVideo.get(unlockMatch[1]);
        if (!video) {
          sendJson(response, 404, { error: "找不到这段录屏" });
          return;
        }
        if (isExpired(video)) {
          sendJson(response, 410, { error: "这段录屏已经过期" });
          return;
        }
        const body = await readJsonBody(request);
        const password = typeof body?.password === "string" ? body.password : "";
        if (!verifyPassword(password, video.passwordSalt, video.passwordHash)) {
          sendJson(response, 403, { error: "密码不正确" });
          return;
        }
        const token = randomBytes(24).toString("base64url");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        deleteExpiredTokens.run(new Date().toISOString());
        insertAccessToken.run(token, video.id, expiresAt);
        response.setHeader(
          "Set-Cookie",
          `${accessCookieName(video.id)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isHttpsRequest(request) ? "; Secure" : ""}`,
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      const thumbnailMatch = /^\/api\/videos\/([a-zA-Z0-9_-]+)\/thumbnail$/.exec(url.pathname);
      if (request.method === "POST" && thumbnailMatch && VIDEO_ID.test(thumbnailMatch[1])) {
        const video = selectVideo.get(thumbnailMatch[1]);
        if (!video) {
          sendJson(response, 404, { error: "找不到录屏" });
          return;
        }
        const fileName = `${video.id}.jpg`;
        const finalPath = path.join(thumbnailsDir, fileName);
        const partialPath = path.join(thumbnailsDir, `.${fileName}.part`);
        try {
          await pipeline(request, new ByteLimit(5 * 1024 * 1024), createWriteStream(partialPath));
          const header = Buffer.alloc(3);
          const handle = await fs.open(partialPath, "r");
          try {
            await handle.read(header, 0, 3, 0);
          } finally {
            await handle.close();
          }
          if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
            throw Object.assign(new Error("封面不是 JPEG"), { code: "NOT_JPEG" });
          }
          await fs.rename(partialPath, finalPath);
          updateThumbnail.run(fileName, video.id);
          sendJson(response, 200, { ok: true, thumbnailUrl: `/thumbnail/${video.id}` });
        } catch (error) {
          await fs.rm(partialPath, { force: true }).catch(() => undefined);
          sendJson(response, 400, { error: error?.message || "封面保存失败" });
        }
        return;
      }

      const commentMatch = /^\/api\/videos\/([a-zA-Z0-9_-]+)\/comments$/.exec(url.pathname);
      if (request.method === "POST" && commentMatch && VIDEO_ID.test(commentMatch[1])) {
        const video = selectVideo.get(commentMatch[1]);
        if (!video || isExpired(video)) {
          sendJson(response, video ? 410 : 404, { error: video ? "这段录屏已经过期" : "找不到录屏" });
          return;
        }
        if (!videoAccessGranted(request, video)) {
          sendJson(response, 401, { error: "需要分享密码" });
          return;
        }
        const body = await readJsonBody(request);
        const author = String(body?.author ?? "").trim().slice(0, 40);
        const text = String(body?.body ?? "").trim().slice(0, 500);
        const timeMs = Math.max(0, Math.round(Number(body?.timeMs) || 0));
        if (!author || !text) {
          sendJson(response, 400, { error: "请填写名字和评论内容" });
          return;
        }
        const id = randomBytes(9).toString("base64url");
        insertComment.run(id, video.id, author, text, timeMs, new Date().toISOString());
        sendJson(response, 201, { id, author, body: text, timeMs });
        return;
      }

      const adminCommentMatch = /^\/api\/comments\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && adminCommentMatch && VIDEO_ID.test(adminCommentMatch[1])) {
        if (!isTrustedConfigRequest(request)) {
          sendJson(response, 403, { error: "请通过飞牛局域网地址管理评论" });
          return;
        }
        deleteComment.run(adminCommentMatch[1]);
        sendJson(response, 200, { ok: true });
        return;
      }

      const reactionMatch = /^\/api\/videos\/([a-zA-Z0-9_-]+)\/reactions$/.exec(url.pathname);
      if (request.method === "POST" && reactionMatch && VIDEO_ID.test(reactionMatch[1])) {
        const video = selectVideo.get(reactionMatch[1]);
        if (!video || isExpired(video)) {
          sendJson(response, video ? 410 : 404, { error: video ? "这段录屏已经过期" : "找不到录屏" });
          return;
        }
        if (!videoAccessGranted(request, video)) {
          sendJson(response, 401, { error: "需要分享密码" });
          return;
        }
        const body = await readJsonBody(request);
        const emoji = String(body?.emoji ?? "");
        if (!["👍", "❤️", "🎉", "👀", "💡"].includes(emoji)) {
          sendJson(response, 400, { error: "不支持的表情" });
          return;
        }
        const timeMs = Math.max(0, Math.round(Number(body?.timeMs) || 0));
        insertReaction.run(randomBytes(9).toString("base64url"), video.id, emoji, timeMs, new Date().toISOString());
        sendJson(response, 201, { ok: true });
        return;
      }

      const manageMatch = /^\/api\/videos\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if ((request.method === "PATCH" || request.method === "DELETE") && manageMatch && VIDEO_ID.test(manageMatch[1])) {
        if (!isTrustedConfigRequest(request)) {
          sendJson(response, 403, { error: "请通过飞牛局域网地址管理录屏" });
          return;
        }
        const video = selectVideo.get(manageMatch[1]);
        if (!video) {
          sendJson(response, 404, { error: "找不到录屏" });
          return;
        }
        if (request.method === "DELETE") {
          deleteComments.run(video.id);
          deleteReactions.run(video.id);
          deleteAccessTokens.run(video.id);
          deleteViewEvents.run(video.id);
          deleteVideo.run(video.id);
          await fs.rm(path.join(videosDir, video.fileName), { force: true });
          if (video.thumbnailFile) {
            await fs.rm(path.join(thumbnailsDir, video.thumbnailFile), { force: true });
          }
          sendJson(response, 200, { ok: true });
          return;
        }
        const body = await readJsonBody(request);
        const title = String(body?.title ?? "").trim().slice(0, 200);
        if (!title) {
          sendJson(response, 400, { error: "标题不能为空" });
          return;
        }
        let passwordSalt = video.passwordSalt;
        let passwordHash = video.passwordHash;
        if (body?.clearPassword) {
          passwordSalt = null;
          passwordHash = null;
        } else if (typeof body?.password === "string" && body.password.length > 0) {
          if (body.password.length > 128) {
            sendJson(response, 400, { error: "密码最长 128 个字符" });
            return;
          }
          ({ salt: passwordSalt, hash: passwordHash } = passwordRecord(body.password));
        }
        let expiresAt = null;
        if (body?.expiresAt) {
          const timestamp = Date.parse(body.expiresAt);
          if (!Number.isFinite(timestamp)) {
            sendJson(response, 400, { error: "到期时间格式不正确" });
            return;
          }
          expiresAt = new Date(timestamp).toISOString();
        }
        const allowDownload = body?.allowDownload !== false ? 1 : 0;
        const description = String(body?.description ?? "").trim().slice(0, 1000);
        const ctaLabel = String(body?.ctaLabel ?? "").trim().slice(0, 60);
        const ctaUrl = normalizeLinkUrl(body?.ctaUrl);
        if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
          sendJson(response, 400, { error: "行动按钮的文字和网址需要同时填写" });
          return;
        }
        const autoplayMuted = body?.autoplayMuted ? 1 : 0;
        const allowedSpeeds = [0.75, 1, 1.25, 1.5, 2];
        const requestedSpeed = Number(body?.defaultSpeed || 1);
        const defaultSpeed = allowedSpeeds.includes(requestedSpeed) ? requestedSpeed : 1;
        updateVideo.run(
          title,
          passwordSalt,
          passwordHash,
          expiresAt,
          allowDownload,
          description,
          ctaLabel || null,
          ctaUrl,
          autoplayMuted,
          defaultSpeed,
          video.id,
        );
        sendJson(response, 200, {
          ok: true,
          title,
          hasPassword: Boolean(passwordHash),
          expiresAt,
          allowDownload: Boolean(allowDownload),
          description,
          ctaLabel,
          ctaUrl,
          autoplayMuted: Boolean(autoplayMuted),
          defaultSpeed,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/videos/upload") {
        await handleUpload(request, response, url, port);
        return;
      }

      const downloadMatch = /^\/download\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && downloadMatch && VIDEO_ID.test(downloadMatch[1])) {
        await serveDownload(request, response, downloadMatch[1]);
        return;
      }

      const thumbnailView = /^\/thumbnail\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && thumbnailView && VIDEO_ID.test(thumbnailView[1])) {
        await serveThumbnail(request, response, thumbnailView[1]);
        return;
      }

      const ctaMatch = /^\/cta\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && ctaMatch && VIDEO_ID.test(ctaMatch[1])) {
        const video = selectVideo.get(ctaMatch[1]);
        if (!video || !video.ctaUrl || isExpired(video)) {
          sendText(response, 404, "行动按钮不可用");
          return;
        }
        if (!videoAccessGranted(request, video)) {
          sendText(response, 401, "需要分享密码");
          return;
        }
        incrementCta.run(video.id);
        response.writeHead(302, { Location: video.ctaUrl, "Cache-Control": "no-store" });
        response.end();
        return;
      }

      const media = /^\/media\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if ((request.method === "GET" || request.method === "HEAD") && media && VIDEO_ID.test(media[1])) {
        await serveMedia(request, response, media[1]);
        return;
      }

      const watch = /^\/v\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && watch && VIDEO_ID.test(watch[1])) {
        const record = selectVideo.get(watch[1]);
        if (!record) {
          response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          response.end(pageShell("找不到录屏", "<h1>找不到这段录屏</h1><p><a href=\"/\">返回首页</a></p>"));
          return;
        }
        if (isExpired(record)) {
          const body = Buffer.from(
            pageShell(
              "录屏已经过期",
              `<div class="brand"><img class="brand-icon" src="/assets/icon.png" alt="">异步录屏<span class="version-badge">v${SERVICE_VERSION}</span></div><h1>这段录屏已经过期</h1><p class="muted">分享者设置的有效期已经结束。</p>`,
            ),
          );
          response.writeHead(410, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": body.length,
            "Cache-Control": "no-store",
          });
          response.end(body);
          return;
        }
        if (!videoAccessGranted(request, record)) {
          const body = Buffer.from(unlockPage(record));
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": body.length,
            "Cache-Control": "no-store",
          });
          response.end(body);
          return;
        }
        let visitorId = cookieValue(request, "loom_viewer");
        const isNewVisitor = !visitorId || !VIDEO_ID.test(visitorId);
        if (isNewVisitor) {
          visitorId = randomBytes(18).toString("base64url");
          response.setHeader(
            "Set-Cookie",
            `loom_viewer=${encodeURIComponent(visitorId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isHttpsRequest(request) ? "; Secure" : ""}`,
          );
        }
        const viewedAt = new Date().toISOString();
        recordView.run(viewedAt, record.id);
        insertViewEvent.run(randomBytes(9).toString("base64url"), record.id, visitorId, viewedAt);
        record.viewCount = Number(record.viewCount || 0) + 1;
        record.uniqueViewers = Number(record.uniqueViewers || 0) + (isNewVisitor ? 1 : 0);
        record.lastViewedAt = viewedAt;
        const body = Buffer.from(
          watchPage(record, listComments.all(record.id), listReactions.all(record.id)),
        );
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": body.length,
          "Cache-Control": "no-store",
        });
        response.end(body);
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        const library = listVideos.all().map((video) => ({
          ...video,
          comments: listComments.all(video.id),
        }));
        const body = Buffer.from(
          homePage(
            library,
            request,
            port,
            publicBaseUrl,
            isTrustedConfigRequest(request),
            await windowsClientInfo().catch(() => null),
          ),
        );
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": body.length,
          "Cache-Control": "no-store",
        });
        response.end(body);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "接口不存在" });
      } else {
        sendText(response, 404, "没有这个地址");
      }
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error?.message || String(error) });
      } else {
        response.destroy(error);
      }
    }
  });

  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  return {
    server,
    db,
    dataDir,
    videosDir,
    pingCommunityInstallation,
    checkFnosUpdate,
    downloadFnosUpdate,
    async listen(port = options.port ?? DEFAULT_PORT, host = options.host ?? "0.0.0.0") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    result[name] = inlineValue ?? argv[index + 1];
    if (inlineValue == null) index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const service = await createAsyncLoomServer({
    dataDir: args.data,
    port: Number(args.port) || DEFAULT_PORT,
    host: args.host || "0.0.0.0",
  });
  await service.listen(Number(args.port) || DEFAULT_PORT, args.host || "0.0.0.0");
  void service.pingCommunityInstallation();
  const installationTimer = setInterval(
    () => void service.pingCommunityInstallation(),
    6 * 60 * 60 * 1000,
  );
  installationTimer.unref();
  const address = service.server.address();
  const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
  console.log(`[async-loom] listening on 0.0.0.0:${port}, data=${service.dataDir}`);
  const stop = async () => {
    await service.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[async-loom] ${error?.stack || error}`);
    process.exit(1);
  });
}
