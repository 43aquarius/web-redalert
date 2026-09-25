#!/usr/bin/env python3
"""Parallel chunked downloader for wyhjres CDN (server cuts long connections)."""
import json
import os
import subprocess
import sys
import zlib
from concurrent.futures import ThreadPoolExecutor

BASE = "https://wyhjres.ra2web.cn/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
REFERER = "https://game.ra2web.com/"
OUT = "/home/z/my-project/assets_raw2/cdn"
CHUNK = 4 * 1024 * 1024
WORKERS = 6


def head_size(fn):
    r = subprocess.run(
        ["curl", "-sI", "--max-time", "15", "-A", UA, "-e", REFERER,
         BASE + fn], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.lower().startswith("content-length:"):
            return int(line.split(":", 1)[1].strip())
    return None


def dl_range(fn, start, end, dst, tries=8):
    for t in range(tries):
        r = subprocess.run(
            ["curl", "-sS", "-f", "--max-time", "180",
             "-A", UA, "-e", REFERER,
             "-r", f"{start}-{end}", "-o", dst, BASE + fn],
            capture_output=True)
        if r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) == end - start + 1:
            return True
    return False


def fetch_file(fn, total):
    out = os.path.join(OUT, fn)
    final_crc = None
    if os.path.exists(out + ".ok"):
        return True
    # chunk plan
    chunks = []
    pos = 0
    ci = 0
    while pos < total:
        end = min(pos + CHUNK, total) - 1
        chunks.append((ci, pos, end))
        pos = end + 1
        ci += 1
    tmpdir = os.path.join(OUT, ".tmp_" + fn)
    os.makedirs(tmpdir, exist_ok=True)
    jobs = [(fn, s, e, os.path.join(tmpdir, f"{i:04d}")) for i, s, e in chunks]

    def work(j):
        return dl_range(*j)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        results = list(ex.map(work, jobs))
    if not all(results):
        print(f"  {fn}: some chunks failed {[c[0] for c, r in zip(chunks, results) if not r]}")
        return False
    # concatenate
    with open(out, "wb") as w:
        for i, s, e in chunks:
            with open(os.path.join(tmpdir, f"{i:04d}"), "rb") as r:
                w.write(r.read())
    subprocess.run(["rm", "-rf", tmpdir])
    # verify
    with open(out, "rb") as f:
        data = f.read()
    if len(data) != total:
        print(f"  {fn}: size mismatch {len(data)} != {total}")
        return False
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    want = manifest["checksums"].get(fn)
    if want is not None and not fn.endswith(".png"):
        got = zlib.crc32(data) & 0xFFFFFFFF
        if got != (want & 0xFFFFFFFF):
            print(f"  {fn}: CRC mismatch got {got:08x} want {want & 0xFFFFFFFF:08x}")
            return False
    open(out + ".ok", "w").write("ok")
    print(f"  {fn}: {total:,} bytes OK")
    return True


def main():
    files = sys.argv[1:]
    for fn in files:
        total = head_size(fn)
        if total is None:
            print(f"  {fn}: HEAD failed")
            continue
        fetch_file(fn, total)
    print("BATCH DONE")


if __name__ == "__main__":
    main()
