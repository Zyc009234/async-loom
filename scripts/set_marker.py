#!/usr/bin/env python3
"""Set the Tauri bundle-type marker (UNK/NSS/MSI) in an unsigned async-loom-desktop.exe.
Usage: set_marker.py <in.exe> <out.exe> <UNK|NSS|MSI>   (sign the output afterwards)"""
import sys, pefile
src, out, kind = sys.argv[1:4]
data = bytearray(open(src, "rb").read())
hits = [(data.find(b"__TAURI_BUNDLE_TYPE_VAR_" + t)) for t in (b"UNK", b"NSS", b"MSI")]
hits = [i for i in hits if i >= 0]
assert len(hits) == 1, hits
i = hits[0] + len(b"__TAURI_BUNDLE_TYPE_VAR_")
data[i:i + 3] = kind.encode()
pe = pefile.PE(data=bytes(data))
assert pe.OPTIONAL_HEADER.DATA_DIRECTORY[4].Size == 0, "input must be unsigned"
pe.OPTIONAL_HEADER.CheckSum = pe.generate_checksum()
open(out, "wb").write(pe.write())
print("marker", kind, out)
