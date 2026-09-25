#!/usr/bin/env python3
"""Extract files from raw Mode2 CD bin image (ISO9660)."""
import struct
import sys
import os

SEC = 2352


class BinImage:
    def __init__(self, path):
        self.f = open(path, 'rb')

    def user_data(self, lba, count=1):
        """Read `count` sectors of user data starting at lba."""
        out = bytearray()
        for i in range(count):
            self.f.seek(lba * SEC + i * SEC)
            sec = self.f.read(SEC)
            if len(sec) < SEC:
                raise EOFError(f'sector {lba+i} out of range')
            mode = sec[15]
            if mode == 1:
                out += sec[16:16+2048]
            elif mode == 2:
                out += sec[24:24+2048]
            else:
                raise ValueError(f'unknown sector mode {mode} at {lba+i}')
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
        ent_lba, = struct.unpack_from('<I', raw, i+2)
        ent_size, = struct.unpack_from('<I', raw, i+10)
        flags = raw[i+25]
        name_len = raw[i+32]
        name = raw[i+33:i+33+name_len].decode('ascii', 'ignore').split(';')[0]
        if name not in ('\x00', '\x01'):
            ents[name] = (ent_lba, ent_size, bool(flags & 2))
        i += ln
    return ents


def extract_file(img, lba, size, out_path):
    n = (size + 2047) // 2048
    with open(out_path, 'wb') as out:
        got = 0
        for i in range(0, n, 64):
            chunk_sect = min(64, n - i)
            data = img.user_data(lba + i, chunk_sect)
            take = min(len(data), size - got)
            out.write(data[:take])
            got += take
    return got


def walk(img, lba, size, prefix=''):
    all_files = {}
    ents = parse_dir(img, lba, size)
    for name, (elba, esize, isdir) in ents.items():
        path = prefix + name
        if isdir:
            all_files.update(walk(img, elba, esize, path + '/'))
        else:
            all_files[path] = (elba, esize)
    return all_files


def main():
    bin_path = sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/assets_raw/cs_cd.bin'
    img = BinImage(bin_path)
    pvd = img.user_data(16, 1)
    assert pvd[1:6] == b'CD001', 'not ISO9660'
    root_lba, = struct.unpack_from('<I', pvd, 156+2)
    print('root LBA:', root_lba)
    files = walk(img, root_lba, 2048)
    print('total entries:', len(files))
    for p, (lba, sz) in sorted(files.items()):
        print(f'{p:<40} {sz:>12,}  LBA {lba}')

    # extract selected
    want = sys.argv[2:] if len(sys.argv) > 2 else ['MAIN.MIX']
    outdir = '/home/z/my-project/assets_raw/extracted'
    os.makedirs(outdir, exist_ok=True)
    for w in want:
        for p, (lba, sz) in files.items():
            if p.upper().endswith(w.upper()):
                out = os.path.join(outdir, os.path.basename(p))
                print('extracting', p, f'{sz:,} bytes ->', out)
                got = extract_file(img, lba, sz, out)
                print('  got', f'{got:,}')
                break


if __name__ == '__main__':
    main()
