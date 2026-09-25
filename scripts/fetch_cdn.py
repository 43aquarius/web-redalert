#!/usr/bin/env python3
"""Download all engine resources from ra2web CDN with CRC verification."""
import json
import os
import subprocess
import sys
import zlib

BASE = "https://wyhjres.ra2web.cn/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
REFERER = "https://game.ra2web.com/"
OUT = "/home/z/my-project/assets_raw2/cdn"


def curl(url, dst, timeout=300):
    r = subprocess.run(
        ["curl", "-sS", "-f", "--max-time", str(timeout),
         "-A", UA, "-e", REFERER, "-o", dst, url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return r.returncode == 0


def crc(path):
    with open(path, "rb") as f:
        return zlib.crc32(f.read()) & 0xFFFFFFFF


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    checks = manifest["checksums"]
    todo = []
    for fn, want in checks.items():
        dst = os.path.join(OUT, fn)
        if fn.endswith(".png"):
            ok = os.path.exists(dst) and open(dst, "rb").read(8) == b"\x89PNG\r\n\x1a\n"
        else:
            ok = os.path.exists(dst) and os.path.getsize(dst) > 0 and crc(dst) == (want & 0xFFFFFFFF)
        if not ok:
            todo.append(fn)
    print(f"need {len(todo)}/{len(checks)} files")
    failed = []
    for i, fn in enumerate(sorted(todo), 1):
        dst = os.path.join(OUT, fn)
        url = BASE + ("ls/" + fn if fn.startswith("ls800") else fn)
        want = checks[fn]
        ok = False
        for attempt in range(3):
            if curl(url, dst) and os.path.exists(dst) and os.path.getsize(dst) > 0:
                if fn.endswith(".png"):
                    ok = open(dst, "rb").read(8) == b"\x89PNG\r\n\x1a\n"
                else:
                    ok = crc(dst) == (want & 0xFFFFFFFF)
            if ok:
                break
        size = os.path.getsize(dst) if os.path.exists(dst) else 0
        status = "OK" if ok else "FAIL"
        print(f"[{i}/{len(todo)}] {fn:25} {size:>12,} {status}")
        if not ok:
            failed.append(fn)
    if failed:
        print("FAILED:", failed)
        sys.exit(1)
    print("ALL OK")


if __name__ == "__main__":
    main()
