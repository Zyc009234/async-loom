#!/usr/bin/env python3
"""Build async-loom-desktop.exe 0.8.5 from the 0.8.4 binary (no Rust source available).

What changes (nothing else is touched):
  1. Embedded frontend: /assets/index-DSkJe5Ao.js and /assets/index-D1D9UC6S.css are replaced.
     New brotli blobs go into a new read-only PE section ".alfe"; the (ptr,len) pair in Tauri's
     embedded-asset table is repointed. Those pointer slots carry DIR64 base relocations, so ASLR
     still works. Asset keys (phf map) are unchanged.
  2. Version: the three inline "0.8.4" string builds (mov dword "0.8." + mov byte '4') -> '5';
     VERSIONINFO strings and VS_FIXEDFILEINFO -> 0.8.5.0.
  3. Tauri bundle-type marker reset to __TAURI_BUNDLE_TYPE_VAR_UNK (the bundler sets NSS/MSI).
Usage: patch_exe.py <in.exe> <frontend-dir> <out.exe>
"""
import sys, struct, re, brotli, pefile, hashlib

src, fe_dir, out = sys.argv[1:4]
data = bytearray(open(src, "rb").read())
pe = pefile.PE(data=bytes(data), fast_load=False)
base = pe.OPTIONAL_HEADER.ImageBase

def off2va(o):
    for s in pe.sections:
        if s.PointerToRawData <= o < s.PointerToRawData + s.SizeOfRawData:
            return base + s.VirtualAddress + o - s.PointerToRawData

def find_entry(key):
    k = key.encode()
    hits = []
    o = data.find(k)
    while o != -1:
        va = off2va(o)
        if va:
            pat = struct.pack("<QQ", va, len(k))
            p = data.find(pat)
            while p != -1:
                hits.append(p)
                p = data.find(pat, p + 1)
        o = data.find(k, o + 1)
    if len(hits) != 1:
        raise SystemExit(f"asset entry for {key}: {len(hits)} hits")
    return hits[0]

reloc_rvas = {e.rva for b in pe.DIRECTORY_ENTRY_BASERELOC for e in b.entries if e.type == 10}
assets = {
    "/assets/index-DSkJe5Ao.js": f"{fe_dir}/assets/index-DSkJe5Ao.js",
    "/assets/index-D1D9UC6S.css": f"{fe_dir}/assets/index-D1D9UC6S.css",
}
blob = bytearray()
plan = []
for key, path in assets.items():
    entry = find_entry(key)
    ptr_rva = pe.get_rva_from_offset(entry + 16)
    if ptr_rva not in reloc_rvas:
        raise SystemExit(f"{key}: value pointer has no base relocation, refusing")
    raw = open(path, "rb").read()
    comp = brotli.compress(raw, quality=11, lgwin=22)
    assert brotli.decompress(comp) == raw
    while len(blob) % 16:
        blob.append(0)
    plan.append((key, entry, len(blob), len(comp), len(raw)))
    blob += comp

# --- new section
fa, sa = pe.OPTIONAL_HEADER.FileAlignment, pe.OPTIONAL_HEADER.SectionAlignment
align = lambda v, a: (v + a - 1) // a * a
last = pe.sections[-1]
new_rva = align(last.VirtualAddress + max(last.Misc_VirtualSize, last.SizeOfRawData), sa)
new_raw = align(len(data), fa)
if pe.get_overlay_data_start_offset() is not None:
    raise SystemExit("unexpected overlay")
raw_size = align(len(blob), fa)
hdr_off = last.get_file_offset() + 40
if hdr_off + 40 > pe.OPTIONAL_HEADER.SizeOfHeaders or any(data[hdr_off:hdr_off + 40]):
    raise SystemExit("no room for another section header")
data += b"\0" * (new_raw - len(data))
data += blob + b"\0" * (raw_size - len(blob))
sec = struct.pack("<8sIIIIIIHHI", b".alfe\0\0\0", len(blob), new_rva, raw_size, new_raw, 0, 0, 0, 0, 0x40000040)
data[hdr_off:hdr_off + 40] = sec
fh = pe.FILE_HEADER.get_file_offset()
struct.pack_into("<H", data, fh + 2, pe.FILE_HEADER.NumberOfSections + 1)
oh = pe.OPTIONAL_HEADER.get_file_offset()
struct.pack_into("<I", data, oh + 56, align(new_rva + len(blob), sa))  # SizeOfImage
for key, entry, off, clen, rlen in plan:
    struct.pack_into("<QQ", data, entry + 16, base + new_rva + off, clen)
    print(f"asset {key}: {rlen} B -> brotli {clen} B @ RVA {new_rva + off:#x}")

# --- version strings
sites = [m.start() for m in re.finditer(rb"\xc6\x40\x04\x34(?=(?:\x48\x89\x85....)?\xc7\x00\x30\x2e\x38\x2e)", bytes(data), re.S)]
sites += [m.start() for m in re.finditer(rb"(?<=\xc7\x00\x30\x2e\x38\x2e)\xc6\x40\x04\x34", bytes(data))]
sites = sorted(set(sites))
pat_all = [m.start() for m in re.finditer(rb"\xc6\x40\x04\x34", bytes(data))]
print("inline '0.8.4' builds:", [hex(s) for s in sites])
if len(sites) != 3:
    raise SystemExit(f"expected 3 inline version sites, got {len(sites)}")
for s in sites:
    data[s + 3] = 0x35
u16 = "0.8.4".encode("utf-16le")
rs = pe.sections[[s.Name.rstrip(b"\0") for s in pe.sections].index(b".rsrc")]
r0, r1 = rs.PointerToRawData, rs.PointerToRawData + rs.SizeOfRawData
n = 0
for m in list(re.finditer(re.escape(u16), bytes(data[r0:r1]))):
    data[r0 + m.start():r0 + m.start() + len(u16)] = "0.8.5".encode("utf-16le"); n += 1
assert n == 2, n
sig = bytes(data).find(struct.pack("<I", 0xFEEF04BD), r0, r1)
ffi = list(struct.unpack_from("<IIIIII", data, sig))
assert ffi[2] == 0x00000008 and ffi[3] == 0x00040000 and ffi[4] == 0x00000008 and ffi[5] == 0x00040000, ffi
struct.pack_into("<II", data, sig + 12, 0x00050000, 0x00000008)  # FileVersionLS, ProductVersionMS
struct.pack_into("<I", data, sig + 20, 0x00050000)  # ProductVersionLS
# --- bundle marker
for tag in (b"__TAURI_BUNDLE_TYPE_VAR_NSS", b"__TAURI_BUNDLE_TYPE_VAR_MSI"):
    i = data.find(tag)
    if i != -1:
        data[i:i + len(tag)] = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
assert data.count(b"__TAURI_BUNDLE_TYPE_VAR_UNK") == 1

# --- checksum + verify
pe2 = pefile.PE(data=bytes(data))
pe2.OPTIONAL_HEADER.CheckSum = pe2.generate_checksum()
final = pe2.write()
open(out, "wb").write(final)
chk = pefile.PE(out)
for key, entry, off, clen, rlen in plan:
    vp, vl = struct.unpack_from("<QQ", final, entry + 16)
    o = chk.get_offset_from_rva(vp - base)
    assert brotli.decompress(final[o:o + vl]) == open(assets[key], "rb").read()
print("ok", out, len(final), hashlib.sha256(final).hexdigest())
