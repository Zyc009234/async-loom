#!/usr/bin/env python3
"""Apply the 0.8.5 offline-first changes to the recovered 0.8.4 frontend (prettified)."""
import sys, pathlib
src = pathlib.Path(sys.argv[1]); dst = pathlib.Path(sys.argv[2])
s = src.read_text()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"anchor count {n} != {count}: {old[:120]!r}")
    s = s.replace(old, new)

# ---- versions
rep('`0.8.4`', '`0.8.5`', 4)

# ---- no hard-coded author LAN IP as default server
rep('x = `http://192.168.0.183:38471`.replace(/\\/$/, ``);', 'x = ``;')

# ---- health check needs a configured address
rep('''async function ne(e) {
  let t = await fetch(''', '''async function ne(e) {
  if (!ee()) throw Error(`尚未设置飞牛地址`);
  let t = await fetch(''')

# ---- module level helpers (after T())
rep('''function T() {
  return typeof window < `u` && `__TAURI_INTERNALS__` in window;
}
''', '''function T() {
  return typeof window < `u` && `__TAURI_INTERNALS__` in window;
}
var AL_META = `async-loom.local-recordings`,
  AL_GUIDE = `async-loom.first-run-dismissed`,
  AL_DIR_PATH = `async-loom.save-dir-path`,
  AL_DIR_NAME = `async-loom.save-dir-name`,
  AL_BASE_KEY = `async-loom.fnos-base`,
  AL_FOLDER = `异步录屏`,
  AL_CHUNK = 1024e3,
  alUnsavedTake = !1;
var alErrText = (e) => C(e);
async function alCore() {
  return g(async () => {
    let { invoke: e, convertFileSrc: t } = await import(`./core-CZS8Kqa-.js`);
    return { invoke: e, convertFileSrc: t };
  }, []);
}
function alLoadMeta() {
  try {
    let e = JSON.parse(localStorage.getItem(AL_META) ?? `[]`);
    return Array.isArray(e) ? e.filter((e) => e && e.id && e.fileName) : [];
  } catch {
    return [];
  }
}
function alStoreMeta(e) {
  try {
    localStorage.setItem(AL_META, JSON.stringify(e.slice(0, 500)));
  } catch {}
}
function alIdb() {
  return new Promise((e, t) => {
    let n = indexedDB.open(`async-loom`, 1);
    n.onupgradeneeded = () => n.result.createObjectStore(`kv`);
    n.onsuccess = () => e(n.result);
    n.onerror = () => t(n.error);
  });
}
async function alKv(key, value, del) {
  let d = await alIdb();
  return new Promise((res, rej) => {
    let tx = d.transaction(`kv`, value === void 0 && !del ? `readonly` : `readwrite`),
      st = tx.objectStore(`kv`),
      q = del ? st.delete(key) : value === void 0 ? st.get(key) : st.put(value, key);
    q.onsuccess = () => res(q.result ?? null);
    q.onerror = () => rej(q.error);
  });
}
function alHasFs() {
  return typeof window < `u` && typeof window.showDirectoryPicker == `function`;
}
async function alPerm(h, ask) {
  try {
    let o = { mode: `readwrite` };
    if ((await h.queryPermission(o)) === `granted`) return !0;
    return ask ? (await h.requestPermission(o)) === `granted` : !1;
  } catch {
    return !1;
  }
}
async function alVideoDir() {
  try {
    let { invoke: e } = await alCore();
    return await e(`plugin:path|resolve_directory`, { directory: 10 });
  } catch {
    return null;
  }
}
async function alPickDir() {
  let picked = await window.showDirectoryPicker({
      id: `async-loom-save`,
      mode: `readwrite`,
      startIn: `videos`,
    }),
    videos = await alVideoDir(),
    videosName = videos ? videos.replace(/[\\\\/]+$/, ``).split(/[\\\\/]/).pop() : null,
    guess = null,
    dir = picked;
  if (picked.name === AL_FOLDER) videos && (guess = `${videos.replace(/[\\\\/]+$/, ``)}\\\\${AL_FOLDER}`);
  else {
    dir = await picked.getDirectoryHandle(AL_FOLDER, { create: !0 });
    videos &&
      videosName &&
      picked.name.toLowerCase() === videosName.toLowerCase() &&
      (guess = `${videos.replace(/[\\\\/]+$/, ``)}\\\\${AL_FOLDER}`);
  }
  await alKv(`save-dir`, dir);
  guess ? localStorage.setItem(AL_DIR_PATH, guess) : localStorage.removeItem(AL_DIR_PATH);
  localStorage.setItem(
    AL_DIR_NAME,
    picked.name === AL_FOLDER ? AL_FOLDER : `${videosName && picked.name.toLowerCase() === videosName.toLowerCase() ? `视频` : picked.name}\\\\${AL_FOLDER}`,
  );
  return dir;
}
async function alDir(ask) {
  if (!alHasFs()) return null;
  let e = await alKv(`save-dir`).catch(() => null);
  if (e && (await alPerm(e, ask))) return e;
  return ask ? alPickDir() : null;
}
async function alCopy(src, fh, onProgress, expected) {
  let { convertFileSrc: c } = await alCore(),
    url = c(src),
    w = await fh.createWritable(),
    off = 0,
    total = expected ?? null;
  try {
    try {
      for (;;) {
        if (total != null && off >= total) break;
        let r = await fetch(url, {
          headers: { Range: `bytes=${off}-${off + AL_CHUNK - 1}` },
          cache: `no-store`,
        });
        if (!r.ok) throw Error(`读取本机录屏失败（${r.status}）`);
        let b = new Uint8Array(await r.arrayBuffer());
        if (r.status !== 206) {
          if (off > 0) throw Error(`读取本机录屏失败（分段读取被中断）`);
          (await w.write(b), (off = b.length));
          break;
        }
        await w.write(b);
        off += b.length;
        let m = /\\/(\\d+)\\s*$/.exec(r.headers.get(`content-range`) ?? ``);
        m && (total = Number(m[1]));
        onProgress?.(off, total);
        if (b.length === 0 || (total == null && b.length < AL_CHUNK)) break;
      }
    } catch (e) {
      if (off > 0) throw e;
      let r = await fetch(url, { cache: `no-store` });
      if (!r.ok) throw Error(`读取本机录屏失败（${r.status}）`);
      let b = new Uint8Array(await r.arrayBuffer());
      (await w.write(b), (off = b.length));
    }
    if (total != null && off !== total) throw Error(`复制不完整（${off}/${total} 字节）`);
    await w.close();
    return off;
  } catch (e) {
    try {
      await w.abort();
    } catch {}
    throw e;
  }
}
async function alDownloadFallback(src, name) {
  let { convertFileSrc: c } = await alCore(),
    r = await fetch(c(src));
  if (!r.ok) throw Error(`读取本机录屏失败（${r.status}）`);
  let u = URL.createObjectURL(await r.blob()),
    a = document.createElement(`a`);
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 12e4);
}
function alStamp(d) {
  let p = (n) => String(n).padStart(2, `0`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}
function alFileName(title, d) {
  let t = (title ?? ``)
    .replace(/[\\\\/:*?"<>|\\u0000-\\u001f]+/g, ` `)
    .replace(/\\s+/g, ` `)
    .trim()
    .replace(/[. ]+$/, ``)
    .slice(0, 60);
  return `${t || `异步录屏`} ${alStamp(d)}.mp4`;
}
function alSize(n) {
  return n >= 1073741824
    ? `${(n / 1073741824).toFixed(1)} GB`
    : n >= 1048576
      ? `${(n / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;
}
function alDate(iso) {
  let d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ``;
  let p = (n) => String(n).padStart(2, `0`);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function alNewId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
''')

# ---- closing the window with an unsaved take asks first
rep('''async function ye() {
  await fe?.close();
}''', '''async function ye() {
  if (alUnsavedTake && !window.confirm(`这段录屏还没有保存到本机，也没有上传。确定关闭吗？`)) return;
  await fe?.close();
}''')

# ---- server form: placeholder, allow clearing
rep('''  let [t, n] = (0, l.useState)(ee()),
    [r, i] = (0, l.useState)(null),
    [a, o] = (0, l.useState)(!1);''', '''  let [t, n] = (0, l.useState)(ee()),
    [r, i] = (0, l.useState)(null),
    [a, o] = (0, l.useState)(!1),
    [alCleared, alSetCleared] = (0, l.useState)(!1);''')
rep('''    r.preventDefault();
    let a = S(t);
    if (!a) (o(!1), i(`请填写以 http:// 或 https:// 开头的地址`));''', '''    r.preventDefault();
    if (!t.trim()) {
      (localStorage.removeItem(_), n(``), o(!1), i(null), alSetCleared(!0), e());
      return;
    }
    alSetCleared(!1);
    let a = S(t);
    if (!a) (o(!1), i(`请填写以 http:// 或 https:// 开头的地址`));''')
rep('''            placeholder: `http://192.168.0.183:38471`,
            onChange: (e) => {
              (n(e.target.value), o(!1));''', '''            placeholder: `http://飞牛IP:38471`,
            onChange: (e) => {
              (n(e.target.value), o(!1), alSetCleared(!1));''')
rep('''        children: `局域网填飞牛的 IP:38471。如果飞牛已经配置域名或反向代理，也可以填那个 HTTPS 地址；分享链接会自动使用同一地址。`,
      }),
      r ? (0, E.jsx)(`p`, { className: `error`, children: r }) : null,''', '''        children: `局域网填飞牛的 IP:38471。如果飞牛已经配置域名或反向代理，也可以填那个 HTTPS 地址；分享链接会自动使用同一地址。不填也能录，录屏保存在本机；清空后保存即可断开飞牛。`,
      }),
      r ? (0, E.jsx)(`p`, { className: `error`, children: r }) : null,
      alCleared
        ? (0, E.jsx)(`p`, {
            className: `hint ok-text`,
            children: `已清除飞牛地址：录屏只保存在本机。`,
          })
        : null,''')

# ---- Ce: extra state + functions
rep('''    Tt = (0, l.useRef)(!1),
    Et = (0, l.useRef)(!1);
''', '''    Tt = (0, l.useRef)(!1),
    Et = (0, l.useRef)(!1);
  let [alItems, alSetItems] = (0, l.useState)(alLoadMeta),
    [alSaved, alSetSaved] = (0, l.useState)(null),
    [alBusy, alSetBusy] = (0, l.useState)(null),
    [alNote, alSetNote] = (0, l.useState)(null),
    [alErr, alSetErr] = (0, l.useState)(null),
    [alPreview, alSetPreview] = (0, l.useState)(null),
    [alThumbs, alSetThumbs] = (0, l.useState)({}),
    [alUp, alSetUp] = (0, l.useState)(null),
    [alCopied, alSetCopied] = (0, l.useState)(null),
    [alDirName, alSetDirName] = (0, l.useState)(() => localStorage.getItem(AL_DIR_NAME)),
    [alGuide, alSetGuide] = (0, l.useState)(
      () => !localStorage.getItem(AL_BASE_KEY) && !localStorage.getItem(AL_GUIDE),
    ),
    alTrimCache = (0, l.useRef)(null),
    alThumbRef = (0, l.useRef)(null),
    alBusyRef = (0, l.useRef)(!1),
    alSavedRef = (0, l.useRef)(null),
    alItemsRef = (0, l.useRef)(alItems);
  alItemsRef.current = alItems;
  alSavedRef.current = alSaved;
  alUnsavedTake = T() && e === `editing` && !!Fe && !alSaved;
  function alMsg(err) {
    return err instanceof Error ? err.message : String(err);
  }
  function alPut(item) {
    let list = [item, ...alItemsRef.current.filter((it) => it.id !== item.id)];
    ((alItemsRef.current = list), alStoreMeta(list), alSetItems(list));
  }
  function alPatch(id, patch) {
    let list = alItemsRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it));
    ((alItemsRef.current = list), alStoreMeta(list), alSetItems(list));
  }
  function alDismissGuide() {
    (localStorage.setItem(AL_GUIDE, `1`), alSetGuide(!1));
  }
  function alOnStart() {
    (alSetSaved(null),
      (alSavedRef.current = null),
      (alTrimCache.current = null),
      (alThumbRef.current = null),
      alSetErr(null),
      alSetNote(null));
    ht !== `online` && A(`未连接飞牛，录完先存本机。`);
    Dt().then((ok) => {
      ok || A(`未连接飞牛，录完先存本机。`);
    });
  }
  function alResetTake() {
    (alSetSaved(null),
      (alSavedRef.current = null),
      (alTrimCache.current = null),
      (alThumbRef.current = null),
      alSetErr(null),
      alSetNote(null));
  }
  function alConfirmDiscard() {
    return T() && e === `editing` && Fe && !alSavedRef.current
      ? window.confirm(`这段录屏还没有保存到本机，也没有上传。确定放弃吗？`)
      : !0;
  }
  async function alTrimmed(path, startMs, endMs) {
    let key = `${path}|${startMs}|${endMs}`;
    if (alTrimCache.current?.key === key) return alTrimCache.current.path;
    let { invoke: iv } = await alCore(),
      out = await iv(`recorder_trim`, { path, startMs, endMs });
    alTrimCache.current = { key, path: out };
    return out;
  }
  async function alOutput(take) {
    let total = take?.durationMs ?? n,
      endMs = total - Ne * 1e3;
    if (endMs <= je * 1e3 + 199) throw Error(`裁剪后的视频太短，请调整起点和终点。`);
    return je > 0.05 || Ne > 0.05
      ? {
          path: await alTrimmed(take.path, Math.round(je * 1e3), Math.round(endMs)),
          durationMs: Math.round(endMs - je * 1e3),
          trimmed: !0,
          byteSize: null,
        }
      : { path: take.path, durationMs: total, trimmed: !1, byteSize: take.byteSize ?? null };
  }
  async function alSaveThumb(id, thumbPath) {
    try {
      let { convertFileSrc: c } = await alCore(),
        r = await fetch(`${c(thumbPath)}`, { cache: `no-store` });
      r.ok && (await alKv(`thumb:${id}`, await r.blob()));
    } catch {}
  }
  async function alFallbackSave(take) {
    if (alBusyRef.current) return null;
    ((alBusyRef.current = !0), alSetBusy(`正在导出…`), alSetErr(null));
    try {
      let out = await alOutput(take),
        name = alFileName(i, new Date()),
        id = alNewId();
      await alDownloadFallback(out.path, name);
      (alPut({
        id,
        fileName: name,
        title: i.trim() || `未命名录屏`,
        durationMs: out.durationMs,
        byteSize: out.byteSize,
        createdAt: new Date().toISOString(),
        fallback: !0,
      }),
        alSetSaved(id),
        (alSavedRef.current = id),
        alSetNote(`当前环境不能直接选择文件夹，已改为下载：${name}（在「下载」文件夹里）。`));
      return id;
    } catch (err) {
      (alSetErr(`保存到本机失败：${alMsg(err)}`), A(`保存到本机失败：${alMsg(err)}`));
      return null;
    } finally {
      ((alBusyRef.current = !1), alSetBusy(null));
    }
  }
  async function alSaveTake(opts = {}) {
    let take = opts.take ?? Fe;
    if (!T() || !take || alBusyRef.current) return null;
    alSetErr(null);
    let dir = opts.dir ?? null;
    if (!dir)
      try {
        dir = await alDir(!opts.auto);
      } catch (err) {
        if (err?.name === `AbortError`) return null;
        if (opts.auto) return null;
        return alFallbackSave(take);
      }
    if (!dir) return opts.auto ? null : alFallbackSave(take);
    alSetDirName(localStorage.getItem(AL_DIR_NAME));
    ((alBusyRef.current = !0), alSetBusy(opts.auto ? `正在自动保存到本机…` : `正在保存到本机…`));
    try {
      let out = await alOutput(take),
        existing = alSavedRef.current
          ? alItemsRef.current.find((it) => it.id === alSavedRef.current && !it.fallback)
          : null,
        id = existing?.id ?? alNewId(),
        fileName = existing?.fileName ?? alFileName(i, new Date()),
        fh = await dir.getFileHandle(fileName, { create: !0 }),
        size = await alCopy(
          out.path,
          fh,
          (done, total) =>
            total && alSetBusy(`正在保存到本机… ${Math.floor((done / total) * 100)}%`),
          out.byteSize ?? void 0,
        );
      (await alKv(`item-dir:${id}`, dir).catch(() => null),
        alThumbRef.current && (await alSaveThumb(id, alThumbRef.current)));
      let up = existing?.upload ?? null;
      (!up && d?.videoId && (up = {
        videoId: d.videoId,
        playUrl: d.playUrl,
        publicUrl: d.publicUrl ?? null,
        lanUrl: d.lanUrl ?? null,
        server: ee(),
        at: new Date().toISOString(),
      }),
        alPut({
          id,
          fileName,
          title: i.trim() || existing?.title || `未命名录屏`,
          durationMs: out.durationMs,
          byteSize: size,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          savedAt: new Date().toISOString(),
          trimmed: out.trimmed,
          upload: up,
        }),
        alSetSaved(id),
        (alSavedRef.current = id));
      let where = `${localStorage.getItem(AL_DIR_NAME) ?? AL_FOLDER}\\\\${fileName}`;
      (alSetNote(`已保存到本机：${where}${out.trimmed ? `（已裁剪）` : ``}`), A(`已保存到本机：${where}`));
      return id;
    } catch (err) {
      (alSetErr(`保存到本机失败：${alMsg(err)}`), A(`保存到本机失败：${alMsg(err)}`));
      return null;
    } finally {
      ((alBusyRef.current = !1), alSetBusy(null));
    }
  }
  async function alAutoSave(take, thumbP) {
    if (!T()) return;
    let dir = alHasFs() ? await alDir(!1).catch(() => null) : null;
    if (!dir) {
      alSetNote(
        localStorage.getItem(AL_DIR_NAME)
          ? `点「保存到本机」把这段录屏存进「${localStorage.getItem(AL_DIR_NAME)}」。`
          : `点「保存到本机」选择保存位置（建议选「视频」，会自动新建「异步录屏」文件夹）。`,
      );
      return;
    }
    try {
      await thumbP;
    } catch {}
    await alSaveTake({ auto: !0, take, dir });
  }
  function alMarkUploaded(res) {
    alSavedRef.current &&
      alPatch(alSavedRef.current, {
        upload: {
          videoId: res.videoId,
          playUrl: res.playUrl,
          publicUrl: res.publicUrl ?? null,
          lanUrl: res.lanUrl ?? null,
          server: ee(),
          at: new Date().toISOString(),
        },
      });
  }
  async function alEnsureOnline() {
    if (!ee()) {
      y(`还没有填写飞牛地址。可以先「保存到本机」；需要分享时点「飞牛」填写地址。`);
      return !1;
    }
    let ok = await Dt();
    ok || y(`连不上飞牛 ${ee()}。可以先「保存到本机」，连上后在「本机」列表里点「上传分享」。`);
    return !!ok;
  }
  async function alItemFile(item) {
    let dir = (await alKv(`item-dir:${item.id}`).catch(() => null)) ?? (await alKv(`save-dir`).catch(() => null));
    if (!dir) throw Error(`找不到保存这段录屏的文件夹，请在「本机」里重新选择保存位置。`);
    if (!(await alPerm(dir, !0))) throw Error(`没有获得文件夹的访问权限。`);
    let fh = await dir.getFileHandle(item.fileName).catch(() => null);
    if (!fh) throw Error(`找不到 ${item.fileName}，可能已被移动或删除。`);
    return fh.getFile();
  }
  async function alReveal(item) {
    let base = localStorage.getItem(AL_DIR_PATH),
      where = `「${localStorage.getItem(AL_DIR_NAME) ?? AL_FOLDER}」`;
    if (!item || item.fallback) {
      alSetNote(`文件在「下载」文件夹里${item?.fileName ? `：${item.fileName}` : ``}。`);
      return;
    }
    if (!base) {
      alSetNote(`文件在你选择的 ${where} 文件夹里：${item.fileName}`);
      return;
    }
    try {
      let { invoke: iv } = await alCore();
      await iv(`plugin:opener|reveal_item_in_dir`, { paths: [`${base}\\\\${item.fileName}`] });
    } catch {
      alSetNote(`没能自动打开文件夹。文件在 ${where} 里：${item.fileName}`);
    }
  }
  async function alSaveAs(source) {
    if (alBusyRef.current) return;
    alSetErr(null);
    let fileName = source.item?.fileName ?? alFileName(i, new Date());
    try {
      if (typeof window.showSaveFilePicker != `function`) {
        if (source.item) throw Error(`当前环境不支持另存为`);
        let out = await alOutput(source.take);
        (await alDownloadFallback(out.path, fileName),
          alSetNote(`已下载：${fileName}（在「下载」文件夹里）。`));
        return;
      }
      let fh = await window.showSaveFilePicker({
        id: `async-loom-saveas`,
        suggestedName: fileName,
        startIn: `videos`,
        types: [{ description: `MP4 视频`, accept: { "video/mp4": [`.mp4`] } }],
      });
      ((alBusyRef.current = !0), alSetBusy(`正在另存为…`));
      if (source.item) {
        let file = await alItemFile(source.item),
          wr = await fh.createWritable();
        await file.stream().pipeTo(wr);
      } else {
        let out = await alOutput(source.take);
        await alCopy(
          out.path,
          fh,
          (done, total) => total && alSetBusy(`正在另存为… ${Math.floor((done / total) * 100)}%`),
          out.byteSize ?? void 0,
        );
      }
      alSetNote(`已另存为：${fh.name}`);
    } catch (err) {
      err?.name === `AbortError` || alSetErr(`另存为失败：${alMsg(err)}`);
    } finally {
      ((alBusyRef.current = !1), alSetBusy(null));
    }
  }
  async function alChangeDir() {
    alSetErr(null);
    try {
      (await alPickDir(), alSetDirName(localStorage.getItem(AL_DIR_NAME)));
      alSetNote(`之后的录屏会保存到「${localStorage.getItem(AL_DIR_NAME)}」。`);
      await alRefresh();
    } catch (err) {
      err?.name === `AbortError` || alSetErr(`选择文件夹失败：${alMsg(err)}`);
    }
  }
  async function alRefresh() {
    let map = {};
    for (let it of alItemsRef.current.slice(0, 80)) {
      let b = await alKv(`thumb:${it.id}`).catch(() => null);
      b && (map[it.id] = URL.createObjectURL(b));
    }
    alSetThumbs((old) => (Object.values(old).forEach((u) => URL.revokeObjectURL(u)), map));
    try {
      let dir = await alDir(!1);
      if (!dir) return;
      let known = new Set(alItemsRef.current.filter((it) => !it.fallback).map((it) => it.fileName)),
        added = [];
      for await (let [name, h] of dir.entries()) {
        if (h.kind !== `file` || !/\\.mp4$/i.test(name) || known.has(name)) continue;
        let f = await h.getFile();
        added.push({
          id: alNewId(),
          fileName: name,
          title: name.replace(/\\.mp4$/i, ``),
          durationMs: null,
          byteSize: f.size,
          createdAt: new Date(f.lastModified).toISOString(),
          found: !0,
        });
      }
      if (added.length) {
        for (let a of added) await alKv(`item-dir:${a.id}`, dir).catch(() => null);
        let list = [...alItemsRef.current, ...added].sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)),
        );
        ((alItemsRef.current = list), alStoreMeta(list), alSetItems(list));
      }
    } catch {}
  }
  async function alPlay(item) {
    if (alPreview?.id === item.id) {
      (URL.revokeObjectURL(alPreview.url), alSetPreview(null));
      return;
    }
    alSetErr(null);
    try {
      let f = await alItemFile(item);
      (alPreview && URL.revokeObjectURL(alPreview.url),
        alSetPreview({ id: item.id, url: URL.createObjectURL(f) }));
    } catch (err) {
      alSetErr(alMsg(err));
    }
  }
  async function alUploadItem(item) {
    if (alUp) return;
    if ((alSetErr(null), alSetNote(null), !ee())) {
      alSetErr(`还没有填写飞牛地址。点下方「飞牛」填写后再上传。`);
      return;
    }
    alSetUp(item.id);
    try {
      if (!(await Dt())) throw Error(`连不上飞牛 ${ee()}，请检查地址和 38471 端口。`);
      let file = await alItemFile(item),
        res = await w({ file, title: item.title, durationMs: item.durationMs ?? void 0, onLog: A }),
        tb = await alKv(`thumb:${item.id}`).catch(() => null);
      if (tb)
        try {
          let r = await fetch(`${ee()}/api/videos/${encodeURIComponent(res.videoId)}/thumbnail`, {
            method: `POST`,
            headers: { "content-type": `image/jpeg` },
            body: tb,
          });
          if (!r.ok) throw Error(await alErrText(r));
        } catch (err) {
          A(`封面上传失败：${alMsg(err)}`);
        }
      (alPatch(item.id, {
        upload: {
          videoId: res.videoId,
          playUrl: res.playUrl,
          publicUrl: res.publicUrl ?? null,
          lanUrl: res.lanUrl ?? null,
          server: ee(),
          at: new Date().toISOString(),
        },
      }),
        alSetNote(`已上传：${res.publicUrl ?? res.playUrl}`));
    } catch (err) {
      alSetErr(`上传失败：${alMsg(err)}`);
    } finally {
      alSetUp(null);
    }
  }
  async function alCopyLink(item) {
    let url = item.upload?.publicUrl ?? item.upload?.playUrl;
    if (url)
      try {
        (await navigator.clipboard.writeText(url), alSetCopied(item.id));
      } catch {
        alSetErr(`复制失败：${url}`);
      }
  }
  function alRemove(item) {
    if (!window.confirm(`只从列表移除「${item.title || item.fileName}」，不会删除本机文件。确定吗？`)) return;
    let list = alItemsRef.current.filter((it) => it.id !== item.id);
    ((alItemsRef.current = list), alStoreMeta(list), alSetItems(list));
    (alKv(`thumb:${item.id}`, void 0, !0).catch(() => null),
      alKv(`item-dir:${item.id}`, void 0, !0).catch(() => null));
    alPreview?.id === item.id && (URL.revokeObjectURL(alPreview.url), alSetPreview(null));
  }
  function alEditorLocal() {
    if (!T() || !Fe) return null;
    let item = alSaved ? alItems.find((it) => it.id === alSaved) : null,
      text =
        alBusy ??
        alErr ??
        alNote ??
        (item
          ? `已保存到本机：${item.fileName}`
          : ht === `online`
            ? `可以保存到本机，或直接上传到飞牛。`
            : `未连接飞牛，录完先存本机。`);
    return (0, E.jsxs)(`div`, {
      className: `local-status`,
      children: [
        (0, E.jsx)(`p`, {
          className: alBusy ? `hint` : alErr ? `error` : item ? `hint ok-text` : `hint`,
          children: text,
        }),
        (0, E.jsxs)(`div`, {
          className: `local-links`,
          children: [
            (0, E.jsx)(`button`, {
              className: `text-btn compact`,
              type: `button`,
              disabled: !!alBusy,
              onClick: () => void alSaveAs({ take: Fe }),
              children: `另存为…`,
            }),
            item
              ? (0, E.jsx)(`button`, {
                  className: `text-btn compact`,
                  type: `button`,
                  onClick: () => void alReveal(item),
                  children: `打开文件夹`,
                })
              : null,
            (0, E.jsx)(`button`, {
              className: `text-btn compact`,
              type: `button`,
              onClick: () => (x(`local`), void alRefresh()),
              children: `本机录屏`,
            }),
          ],
        }),
      ],
    });
  }
  function alRow(it) {
    let link = it.upload ? (it.upload.publicUrl ?? it.upload.playUrl) : null,
      meta = [
        alDate(it.createdAt),
        it.durationMs != null ? Se(it.durationMs) : null,
        it.byteSize ? alSize(it.byteSize) : null,
      ]
        .filter(Boolean)
        .join(` · `),
      btn = (label, onClick, extra = {}) =>
        (0, E.jsx)(`button`, { className: `text-btn compact`, type: `button`, onClick, ...extra, children: label });
    return (0, E.jsxs)(
      `li`,
      {
        className: `local-item`,
        children: [
          (0, E.jsxs)(`div`, {
            className: `local-row`,
            children: [
              (0, E.jsx)(`div`, {
                className: `local-thumb`,
                children: alThumbs[it.id]
                  ? (0, E.jsx)(`img`, { src: alThumbs[it.id], alt: `` })
                  : (0, E.jsx)(`span`, { children: `▶` }),
              }),
              (0, E.jsxs)(`div`, {
                className: `local-meta`,
                children: [
                  (0, E.jsx)(`b`, { title: it.fileName, children: it.title || it.fileName }),
                  (0, E.jsx)(`small`, { children: meta }),
                  (0, E.jsx)(`span`, {
                    className: link ? `local-pill done` : `local-pill`,
                    children: it.fallback ? `已下载` : link ? `已上传飞牛` : `仅在本机`,
                  }),
                ],
              }),
            ],
          }),
          alPreview?.id === it.id
            ? (0, E.jsx)(`video`, {
                className: `local-player`,
                src: alPreview.url,
                controls: !0,
                autoPlay: !0,
                playsInline: !0,
              })
            : null,
          (0, E.jsxs)(`div`, {
            className: `local-actions`,
            children: it.fallback
              ? [btn(`移除`, () => alRemove(it))]
              : [
                  btn(alPreview?.id === it.id ? `收起` : `播放`, () => void alPlay(it)),
                  link
                    ? btn(alCopied === it.id ? `已复制` : `复制链接`, () => void alCopyLink(it))
                    : btn(alUp === it.id ? `上传中…` : `上传分享`, () => void alUploadItem(it), {
                        disabled: !!alUp,
                        className: `text-btn compact primary`,
                      }),
                  btn(`打开文件夹`, () => void alReveal(it)),
                  btn(`另存为`, () => void alSaveAs({ item: it }), { disabled: !!alBusy }),
                  btn(`移除`, () => alRemove(it)),
                ],
          }),
        ],
      },
      it.id,
    );
  }
  function alLocalSheet() {
    let online = ht === `online`;
    return (0, E.jsxs)(`div`, {
      className: `sheet local-sheet`,
      children: [
        (0, E.jsxs)(`div`, {
          className: `sheet-heading`,
          children: [
            (0, E.jsxs)(`div`, {
              children: [
                (0, E.jsx)(`p`, { className: `kicker`, children: `不连飞牛也能用` }),
                (0, E.jsx)(`h2`, { children: `本机录屏` }),
              ],
            }),
            (0, E.jsx)(`button`, {
              className: `sheet-close`,
              type: `button`,
              onClick: () => x(null),
              children: `完成`,
            }),
          ],
        }),
        (0, E.jsxs)(`div`, {
          className: `local-folder`,
          children: [
            (0, E.jsxs)(`span`, {
              children: [
                (0, E.jsx)(`b`, { children: `保存位置` }),
                (0, E.jsx)(`small`, {
                  children: alHasFs()
                    ? (alDirName ?? `还没选择（第一次保存时选择，建议选「视频」）`)
                    : `当前环境不能选择文件夹，保存时会改为下载到「下载」文件夹`,
                }),
              ],
            }),
            alHasFs()
              ? (0, E.jsx)(`button`, {
                  className: `text-btn compact`,
                  type: `button`,
                  disabled: !!alBusy,
                  onClick: () => void alChangeDir(),
                  children: alDirName ? `更改` : `选择`,
                })
              : null,
          ],
        }),
        alBusy ? (0, E.jsx)(`p`, { className: `hint`, children: alBusy }) : null,
        alErr ? (0, E.jsx)(`p`, { className: `error`, children: alErr }) : null,
        alNote ? (0, E.jsx)(`p`, { className: `hint ok-text`, children: alNote }) : null,
        alItems.length === 0
          ? (0, E.jsx)(`p`, {
              className: `hint`,
              children: `还没有本机录屏。录完点「保存到本机」就会出现在这里；连上飞牛后可以随时上传分享。`,
            })
          : (0, E.jsx)(`ul`, { className: `local-list`, children: alItems.map((it) => alRow(it)) }),
        (0, E.jsx)(`p`, {
          className: `hint`,
          children: online
            ? `飞牛已连接：对「仅在本机」的录屏点「上传分享」即可生成链接。`
            : `飞牛未连接：录屏都保存在本机，连上飞牛后再上传分享。`,
        }),
      ],
    });
  }
''')

# ---- start no longer requires the health check
rep('''        (Ct.current = null),
        (wt.current = 0),
        !(await Dt()))
      )
        (x(`server`),
          y(`连不上飞牛 ${ee()}，请先检查地址和 38471 端口。`),
          t(`idle`),
          (Et.current = !1));
      else if''', '''        (Ct.current = null),
        (wt.current = 0),
        alOnStart(),
        !1)
      )
        void 0;
      else if''')

# ---- stop: message + auto-save when a folder is already granted
rep('''          Je(Math.min(o.durationMs / 1e3, 0.5)),
          t(`editing`),
          jt(o.path, Math.min(o.durationMs / 1e3, 0.5)),
          A(`录屏已保存到本机，先预览、裁剪并选择封面，再上传到飞牛。`));
        return;''', '''          Je(Math.min(o.durationMs / 1e3, 0.5)),
          t(`editing`));
        let alThumbP = jt(o.path, Math.min(o.durationMs / 1e3, 0.5));
        (A(`录屏已就绪：可以预览、裁剪、选封面，保存到本机或上传到飞牛。`),
          alAutoSave(o, alThumbP));
        return;''')
rep('''        (He(a),
          We(`${r(a)}?v=${Date.now()}`),''', '''        ((alThumbRef.current = a),
          He(a),
          We(`${r(a)}?v=${Date.now()}`),''')

# ---- upload: needs connection (checked now), reuse trim result, remember upload on local copy
rep('''  async function Mt() {
    if (e !== `editing`) return;''', '''  async function Mt() {
    if (e !== `editing` || alBusyRef.current) return;
    if (!(await alEnsureOnline())) return;''')
rep('''            ((n = await e(`recorder_trim`, {
              path: n,
              startMs: Math.round(je * 1e3),
              endMs: Math.round(s),
            })),''', '''            ((n = await alTrimmed(n, Math.round(je * 1e3), Math.round(s))),''')
rep('''          (m(ze), r(o), f(l), t(`done`), A(l.playUrl));''', '''          (m(ze), r(o), f(l), t(`done`), alMarkUploaded(l), A(l.playUrl));''')

# ---- re-record / reset asks before dropping an unsaved take
rep('''  function It() {
    (Tt.current &&''', '''  function It() {
    if (!alConfirmDiscard()) return;
    alResetTake();
    (Tt.current &&''')

# ---- recording bar text
rep('''                    children: e === `paused` ? `已暂停` : `正在录制`,''', '''                    children:
                      e === `paused`
                        ? `已暂停`
                        : ht === `online`
                          ? `正在录制`
                          : `正在录制 · 存本机`,''')

# ---- editor texts and actions
rep('''children: `只上传高亮区间，暂停部分已自动排除`,''', '''children: `只保存/上传高亮区间，暂停部分已自动排除`,''')
rep('''                      (0, E.jsxs)(`div`, {
                        className: `editor-actions`,
                        children: [
                          (0, E.jsx)(`button`, {
                            className: `text-btn`,
                            type: `button`,
                            onClick: It,
                            children: `重新录制`,
                          }),
                          (0, E.jsx)(`button`, {
                            className: `publish`,
                            type: `button`,
                            onClick: () => void Mt(),
                            children: `上传到飞牛`,
                          }),
                        ],
                      }),''', '''                      alEditorLocal(),
                      (0, E.jsxs)(`div`, {
                        className: T() && Fe ? `editor-actions al3` : `editor-actions`,
                        children: [
                          (0, E.jsx)(`button`, {
                            className: `text-btn`,
                            type: `button`,
                            disabled: !!alBusy,
                            onClick: It,
                            children: `重新录制`,
                          }),
                          T() && Fe
                            ? (0, E.jsx)(`button`, {
                                className: `text-btn local-save`,
                                type: `button`,
                                disabled: !!alBusy,
                                onClick: () => void alSaveTake(),
                                children: alSaved ? `重新保存` : `保存到本机`,
                              })
                            : null,
                          (0, E.jsx)(`button`, {
                            className: ht === `online` ? `publish` : `publish offline`,
                            type: `button`,
                            disabled: !!alBusy,
                            title: ht === `online` ? `` : `未连接飞牛`,
                            onClick: () => void Mt(),
                            children: ht === `online` ? `上传到飞牛` : `上传到飞牛（未连接）`,
                          }),
                        ],
                      }),''')

# ---- done view: save locally / open folder
rep('''                        (0, E.jsx)(`button`, {
                          className: `text-btn`,
                          type: `button`,
                          onClick: It,
                          children: `再录一段`,
                        }),
                      ],
                    }),''', '''                        (0, E.jsx)(`button`, {
                          className: `text-btn`,
                          type: `button`,
                          onClick: It,
                          children: `再录一段`,
                        }),
                        T() && Fe
                          ? alSaved
                            ? (0, E.jsx)(`button`, {
                                className: `text-btn`,
                                type: `button`,
                                onClick: () =>
                                  void alReveal(alItems.find((it) => it.id === alSaved)),
                                children: `打开文件夹`,
                              })
                            : (0, E.jsx)(`button`, {
                                className: `text-btn`,
                                type: `button`,
                                disabled: !!alBusy,
                                onClick: () => void alSaveTake(),
                                children: `保存到本机`,
                              })
                          : null,
                      ],
                    }),
                    T() && (alBusy || alErr || alNote)
                      ? (0, E.jsx)(`p`, {
                          className: alErr ? `error` : `hint ok-text`,
                          children: alBusy ?? alErr ?? alNote,
                        })
                      : null,''')

# ---- idle view: hero copy, first-run guide, offline hint, dock
rep('''                        (0, E.jsx)(D, { state: ht, health: _t }),
                        (0, E.jsxs)(`div`, {
                          className: `hero-copy`,''', '''                        (0, E.jsx)(D, { state: ht, health: _t }),
                        alGuide && T()
                          ? (0, E.jsxs)(`div`, {
                              className: `first-run`,
                              children: [
                                (0, E.jsx)(`b`, { children: `第一次使用` }),
                                (0, E.jsx)(`small`, {
                                  children: `不连飞牛也能录：录完可以预览、裁剪、选封面，并保存到本机（建议「视频\\\\异步录屏」）。需要分享链接时，再填写飞牛地址（如 http://飞牛IP:38471）。`,
                                }),
                                (0, E.jsxs)(`div`, {
                                  className: `first-run-actions`,
                                  children: [
                                    (0, E.jsx)(`button`, {
                                      className: `text-btn primary compact`,
                                      type: `button`,
                                      onClick: () => (alDismissGuide(), x(`server`)),
                                      children: `填写飞牛地址`,
                                    }),
                                    (0, E.jsx)(`button`, {
                                      className: `text-btn compact`,
                                      type: `button`,
                                      onClick: alDismissGuide,
                                      children: `先不用，直接录`,
                                    }),
                                  ],
                                }),
                              ],
                            })
                          : null,
                        (0, E.jsxs)(`div`, {
                          className: `hero-copy`,''')
rep('''children: `录制主显示器，停录后直接保存到自己的飞牛。`,''', '''children: `录制主显示器，停录后先存本机；连上飞牛即可一键上传分享。`,''')
rep('''                                        ? `正在检查飞牛并回收旧录制会话`''', '''                                        ? `正在回收旧录制会话`''')
rep('''                        v
                          ? (0, E.jsx)(`p`, { className: `error`, children: v })
                          : null,
                        (0, E.jsxs)(`div`, {
                          className: `dock`,
                          children: [''', '''                        v
                          ? (0, E.jsx)(`p`, { className: `error`, children: v })
                          : null,
                        T() && ht === `offline` && e === `idle`
                          ? (0, E.jsx)(`p`, {
                              className: `hint local-hint`,
                              children: ee()
                                ? `未连接飞牛，录完先存本机。`
                                : `未设置飞牛，录完先存本机。`,
                            })
                          : null,
                        (0, E.jsxs)(`div`, {
                          className: `dock al4`,
                          children: [''')
rep('''                            (0, E.jsxs)(`button`, {
                              type: `button`,
                              "aria-pressed": b === `server`,''', '''                            (0, E.jsxs)(`button`, {
                              type: `button`,
                              "aria-pressed": b === `local`,
                              onClick: () => {
                                (x(b === `local` ? null : `local`), alRefresh());
                              },
                              children: [
                                (0, E.jsx)(`span`, { children: `🗂` }),
                                alItems.length ? `本机 ${alItems.length}` : `本机`,
                              ],
                            }),
                            (0, E.jsxs)(`button`, {
                              type: `button`,
                              "aria-pressed": b === `server`,''')
rep('''                    b === `server`
                      ? (0, E.jsxs)(`div`, {''', '''                    b === `local` ? alLocalSheet() : null,
                    b === `server`
                      ? (0, E.jsxs)(`div`, {''')
rep('''                                `停止后先进入裁剪和封面编辑，确认后再上传到 `,
                                ee(),
                                `。`,''', '''                                `停止后先进入裁剪和封面编辑，可以保存到本机`,
                                ee() ? `，或上传到 ${ee()}` : `；填写飞牛地址后可上传分享`,
                                `。`,''')

# ---- status pill
rep('''        ? `正在连接飞牛…`
        : `飞牛未连接`;''', '''        ? `正在连接飞牛…`
        : ee()
          ? `飞牛未连接 · 录屏先存本机`
          : `未设置飞牛 · 录屏先存本机`;''')

# ---- the local list sheet is reachable from the editor and done views too
rep('''                children: [
                  (0, E.jsx)(we, {}),
                  (0, E.jsxs)(`section`, {
                    className: `editor`,''', '''                children: [
                  (0, E.jsx)(we, {}),
                  b === `local` ? alLocalSheet() : null,
                  (0, E.jsxs)(`section`, {
                    className: `editor`,''')
rep('''            : e === `done` && d
              ? (0, E.jsxs)(E.Fragment, {
                  children: [
                    (0, E.jsx)(we, {}),''', '''            : e === `done` && d
              ? (0, E.jsxs)(E.Fragment, {
                  children: [
                    (0, E.jsx)(we, {}),
                    b === `local` ? alLocalSheet() : null,''')
rep('''      (alSetNote(`已保存到本机：${where}${out.trimmed ? `（已裁剪）` : ``}`), A(`已保存到本机：${where}`));''', '''      (alSetNote(`已保存到本机：${where}${out.trimmed ? `（已裁剪）` : ``}`), A(`已保存到本机：${where}`), y(null));''')

dst.write_text(s)
print("patched OK", len(s))
