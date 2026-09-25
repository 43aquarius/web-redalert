#!/usr/bin/env python3
"""Parallel chunked download of an arbitrary URL with known/unknown size."""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
CHUNK = 4 * 1024 * 1024
WORKERS = 6


def head_size(url):
    r = subprocess.run(["curl", "-sI", "--max-time", "20", "-A", UA, url],
                       capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.lower().startswith("content-length:"):
            return int(line.split(":", 1)[1].strip())
    return None


def dl_range(url, start, end, dst, tries=10):
    for t in range(tries):
        r = subprocess.run(
            ["curl", "-sS", "-f", "--max-time", "240", "-A", UA,
             "-r", f"{start}-{end}", "-o", dst, url],
            capture_output=True)
        if r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) == end - start + 1:
            return True
    return False


def main():
    url = sys.argv[1]
    out = sys.argv[2]
    total = head_size(url)
    assert total, "no content-length"
    print(f"total: {total:,}")
    tmpdir = out + ".tmpdir"
    os.makedirs(tmpdir, exist_ok=True)
    chunks = []
    pos = 0
    while pos < total:
        end = min(pos + CHUNK, total) - 1
        chunks.append((len(chunks), pos, end))
        pos = end + 1
    jobs = [(url, s, e, os.path.join(tmpdir, f"{i:04d}")) for i, s, e in chunks]
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        results = list(ex.map(lambda j: dl_range(*j), jobs))
    if not all(results):
        print("FAILED chunks:", [c[0] for c, r in zip(chunks, results) if not r])
        sys.exit(1)
    with open(out, "wb") as w:
        for i, s, e in chunks:
            with open(os.path.join(tmpdir, f"{i:04d}"), "rb") as r:
                w.write(r.read())
    subprocess.run(["rm", "-rf", tmpdir])
    print(f"OK {os.path.getsize(out):,} bytes -> {out}")


if __name__ == "__main__":
    main()
