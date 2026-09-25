#!/usr/bin/env python3
"""Parse Westwood MIX archives (TD/RA1), list/extract contents."""
import struct
import sys
import os
import json


def classic_hash(name: str) -> int:
    """Westwood classic MIX filename hash (as used by OpenRA for TD/RA)."""
    n = name.upper()
    pad = (4 - len(n) % 4) % 4
    n = n + '\0' * pad
    result = 0
    for i in range(0, len(n), 4):
        # little-endian pack of 4 chars (OpenRA MemoryMarshal.Cast on LE hw)
        t = (ord(n[i]) | (ord(n[i+1]) << 8) | (ord(n[i+2]) << 16) | (ord(n[i+3]) << 24))
        result = ((result << 1) | (result >> 31)) & 0xFFFFFFFF
        result = (result + t) & 0xFFFFFFFF
    return result


def classic_hash_be(name: str) -> int:
    """Big-endian variant for validation."""
    n = name.upper()
    pad = (4 - len(n) % 4) % 4
    n = n + '\0' * pad
    result = 0
    for i in range(0, len(n), 4):
        t = (ord(n[i]) << 24) | (ord(n[i+1]) << 16) | (ord(n[i+2]) << 8) | ord(n[i+3])
        result = ((result << 1) | (result >> 31)) & 0xFFFFFFFF
        result = (result + t) & 0xFFFFFFFF
    return result


class MixArchive:
    def __init__(self, path):
        self.path = path
        self.data = open(path, 'rb')
        d = self.data
        first, = struct.unpack('<H', d.read(2))
        if first != 0:
            # C&C style: first word IS the file count
            self.is_cnc = True
            d.seek(0)
            self.num_files, = struct.unpack('<H', d.read(2))
            self.body_size, = struct.unpack('<I', d.read(4))
            self.index_offset = 6
        else:
            self.is_cnc = False
            flags, = struct.unpack('<H', d.read(2))
            self.encrypted = bool(flags & 0x2)
            if self.encrypted:
                raise NotImplementedError('encrypted MIX not supported')
            self.num_files, = struct.unpack('<H', d.read(2))
            self.body_size, = struct.unpack('<I', d.read(4))
            self.index_offset = 6
        self.data_start = self.index_offset + 12 * self.num_files + (0 if self.is_cnc else 6)
        # hmm: for C&C format there is no eof/zero tail; for RA there are 2 extra entries
        self.entries = []
        d.seek(self.index_offset)
        for i in range(self.num_files):
            h, off, ln = struct.unpack('<III', d.read(12))
            self.entries.append((h, off, ln))
        self.by_hash = {h: (off, ln) for h, off, ln in self.entries}

    def read_file_by_hash(self, h):
        off, ln = self.by_hash[h]
        self.data.seek(self.data_start + off)
        return self.data.read(ln)

    def try_read(self, name):
        h = classic_hash(name)
        if h in self.by_hash:
            return self.read_file_by_hash(h)
        h2 = classic_hash_be(name)
        if h2 in self.by_hash:
            return self.read_file_by_hash(h2)
        return None


def main():
    path = sys.argv[1]
    mix = MixArchive(path)
    print(f'format: {"C&C" if mix.is_cnc else "RA"}, files: {mix.num_files}, body: {mix.body_size:,}, data_start: {mix.data_start}')
    # build name lookup from XCC db
    names = json.load(open('/home/z/my-project/assets_raw/mixdb_names.json'))
    name_by_le = {classic_hash(n): n for n in names}
    name_by_be = {classic_hash_be(n): n for n in names}
    matched = 0
    results = {}
    for h, off, ln in mix.entries:
        n = name_by_le.get(h) or name_by_be.get(h)
        if n:
            matched += 1
            results[n] = ln
        else:
            results[f'UNK_{h:08x}'] = ln
    print(f'matched {matched}/{mix.num_files} filenames')
    for n, ln in sorted(results.items()):
        print(f'{n:<24} {ln:>12,}')


if __name__ == '__main__':
    main()
