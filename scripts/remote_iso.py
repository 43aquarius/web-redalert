#!/usr/bin/env python3
"""Browse/extract files from remote raw CD bin images via HTTP Range requests."""
import struct
import urllib.request

SEC = 2352


class RemoteBin:
    def __init__(self, base_url, mode2=True):
        self.base = base_url
        self.mode2 = mode2

    def _fetch_range(self, start, length):
        req = urllib.request.Request(self.base, headers={
            'Range': f'bytes={start}-{start + length - 1}',
            'User-Agent': 'Mozilla/5.0',
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()

    def user_data(self, lba, count=1):
        raw = self._fetch_range(lba * SEC, count * SEC)
        out = bytearray()
        for i in range(count):
            sec = raw[i * SEC:(i + 1) * SEC]
            mode = sec[15]
            if mode == 1:
                out += sec[16:16 + 2048]
            elif mode == 2:
                out += sec[24:24 + 2048]
            else:
                raise ValueError(f'bad mode {mode} at sector {lba + i}')
        return bytes(out)


def parse_dir(img, lba, size):
    raw = img.user_data(lba, (size + 2047) // 2048)[:size]
    ents = {}
    i = 0
    while i < len(raw):
        ln = raw[i]
        if ln == 0:
            i = ((i // 2048) + 1) * 2048
            if i >= len(raw):
                break
            continue
        ent_lba, = struct.unpack_from('<I', raw, i + 2)
        ent_size, = struct.unpack_from('<I', raw, i + 10)
        flags = raw[i + 25]
        name_len = raw[i + 32]
        name = raw[i + 33:i + 33 + name_len].decode('ascii', 'ignore').split(';')[0]
        if name not in ('\x00', '\x01'):
            ents[name] = (ent_lba, ent_size, bool(flags & 2))
        i += ln
    return ents


def walk(img, lba, size, prefix=''):
    out = {}
    for name, (elba, esize, isdir) in parse_dir(img, lba, size).items():
        p = prefix + name
        if isdir and esize >= 2048:
            out.update(walk(img, elba, esize, p + '/'))
        else:
            out[p] = (elba, esize)
    return out


def extract_file(img, lba, size, out_path):
    import os
    n = (size + 2047) // 2048
    got = 0
    with open(out_path, 'wb') as out:
        CH = 256  # sectors per chunk (~600KB)
        for i in range(0, n, CH):
            cnt = min(CH, n - i)
            data = img.user_data(lba + i, cnt)
            take = min(len(data), size - got)
            out.write(data[:take])
            got += take
            print(f'\r  {got:,}/{size:,}', end='', flush=True)
    print()
    return got


def main():
    import sys
    url = sys.argv[1]
    img = RemoteBin(url)
    pvd = img.user_data(16, 1)
    assert pvd[1:6] == b'CD001', 'not ISO'
    root_lba, = struct.unpack_from('<I', pvd, 156 + 2)
    print('root LBA:', root_lba)
    files = walk(img, root_lba, 2048)
    print('total files:', len(files))
    for p, (lba, sz) in sorted(files.items()):
        print(f'{p:<44} {sz:>12,}  LBA {lba}')
    # extract args
    if len(sys.argv) > 2:
        import os
        os.makedirs('/home/z/my-project/assets_raw/extracted', exist_ok=True)
        for pat in sys.argv[2:]:
            for p, (lba, sz) in files.items():
                if p.upper().endswith(pat.upper()):
                    out = '/home/z/my-project/assets_raw/extracted/' + p.replace('/', '_')
                    print('extracting', p, '->', out)
                    extract_file(img, lba, sz, out)
                    break


if __name__ == '__main__':
    main()
