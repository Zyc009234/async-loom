#!/usr/bin/env python3
"""Post-process a wixl MSI: set database codepage 936 and replace ASCII placeholders with Chinese.
wixl 0.106 silently drops non-ASCII strings in tables, so the .wxs uses ALCN* placeholders.
Usage: msi_fix_cn.py <file.msi>"""
import subprocess, sys, os, tempfile
msi = sys.argv[1]
REPL = {"ALCNDOWNGRADE": "已经安装了更新版本的异步录屏。", "ALCNNAME": "异步录屏"}
def sh(*a): return subprocess.run(a, check=True, capture_output=True, text=True).stdout
with tempfile.TemporaryDirectory() as d:
    idt = os.path.join(d, "_ForceCodepage.idt")
    open(idt, "wb").write(b"\r\n\r\n936\t_ForceCodepage\r\n")
    sh("msibuild", msi, "-i", idt)
tables = [l.strip() for l in sh("msiinfo", "tables", msi).splitlines() if l.strip()]
n = 0
for t in tables:
    if t.startswith("_"): continue
    try: out = sh("msiinfo", "export", msi, t)
    except subprocess.CalledProcessError: continue
    if "ALCN" not in out: continue
    lines = [l.rstrip("\r") for l in out.split("\n")]
    cols = lines[0].split("\t"); keys = lines[2].split("\t")[1:]
    for row in lines[3:]:
        if "ALCN" not in row: continue
        vals = dict(zip(cols, row.split("\t")))
        sets = []
        for c, v in vals.items():
            if "ALCN" in v:
                nv = v
                for k, r in REPL.items(): nv = nv.replace(k, r)
                assert "ALCN" not in nv, (t, c, v)
                sets.append(f"`{c}`='{nv}'")
        where = " AND ".join(f"`{k}`='{vals[k]}'" for k in keys)
        assert not any("ALCN" in vals[k] for k in keys), (t, keys)
        sh("msibuild", msi, "-q", f"UPDATE `{t}` SET {', '.join(sets)} WHERE {where}")
        n += 1
print("updated rows:", n)
left = [t for t in tables if not t.startswith("_") and "ALCN" in subprocess.run(["msiinfo", "export", msi, t], capture_output=True, text=True).stdout]
assert not left, left
# Summary info: wixl copies the (placeholder) manufacturer into Author and uses template x64;1033.
import re
rev = re.search(r"\{[0-9A-Fa-f-]+\}", sh("msiinfo", "suminfo", msi)).group(0)
sh("msibuild", msi, "-s", "异步录屏 0.8.5", "异步录屏", "x64;2052", rev)
si = sh("msiinfo", "suminfo", msi)
assert "ALCN" not in si and "x64;2052" in si, si
print("summary ok")
