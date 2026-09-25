#!/usr/bin/env python3
"""TS/RA2 MIX archive parser (CRC32 name hashing, encrypted header support)."""
import struct
import zlib

MIX_FLAG_CHECKSUM = 0x00010000
MIX_FLAG_ENCRYPTED = 0x00020000

try:
    from Crypto.Cipher import Blowfish
    from mixlib import decrypt_keyblock as _rsa_decrypt_keyblock
except ImportError:
    Blowfish = None
    _rsa_decrypt_keyblock = None


def _bf_blocks(cipher, data: bytes) -> bytes:
    out = []
    for i in range(0, len(data), 8):
        out.append(cipher.decrypt(data[i:i + 8]))
    return b''.join(out)


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def mix_hash(name: str) -> int:
    """Westwood TS/RA2 mix filename hash (CRC32 of padded uppercase name)."""
    s = name.upper()
    n = len(s)
    r = n >> 2
    if n & 3:
        s += chr(n - (r << 2))
        pad_n = 3 - (n & 3)
        idx = r << 2
        ch = s[idx] if idx < len(s) else s[0]
        s += ch * pad_n
    return crc32(bytes(ord(c) & 0xFF for c in s))


def parse_db(data: bytes):
    """Parse 'local mix database.dat' -> list of names."""
    names = []
    off = 4
    try:
        while off < len(data):
            e = data.index(b'\0', off)
            n = data[off:e].decode('ascii', 'ignore')
            off = e + 1
            e2 = data.index(b'\0', off)
            off = e2 + 1
            if n:
                names.append(n)
    except ValueError:
        pass
    return names


class Mix2:
    def __init__(self, path_or_data, name=''):
        if isinstance(path_or_data, (bytes, bytearray)):
            self.data = bytes(path_or_data)
        else:
            self.data = open(path_or_data, 'rb').read()
        self.name = name
        self.entries = {}  # hash -> (offset, size)
        self._parse()

    def _parse(self):
        d = self.data
        flags, = struct.unpack_from('<I', d, 0)
        if (flags & ~(MIX_FLAG_CHECKSUM | MIX_FLAG_ENCRYPTED)) == 0:
            if flags & MIX_FLAG_ENCRYPTED:
                return self._parse_encrypted(flags)
            pos = 4
        else:
            flags = 0
            pos = 0
        count, = struct.unpack_from('<H', d, pos)
        datasize, = struct.unpack_from('<I', d, pos + 2)
        pos += 6
        for i in range(count):
            h, off, ln = struct.unpack_from('<III', d, pos + i * 12)
            self.entries[h] = (off, ln)
        pos += count * 12
        # NOTE: checksum flag (0x10000) does NOT add a CRC array here
        # (matches working engine parser; repacked mixes omit CRCs)
        self.body = pos
        self.datasize = datasize
        self._resolve_local_db()

    def _parse_encrypted(self, flags):
        d = self.data
        keyblock = d[4:84]
        bfkey = _rsa_decrypt_keyblock(keyblock)
        cipher = Blowfish.new(bfkey, Blowfish.MODE_ECB)
        first8 = _bf_blocks(cipher, d[84:92])
        count, = struct.unpack_from('<H', first8, 0)
        index_len = 6 + count * 12
        region_len = (index_len + 7) & ~7
        region = _bf_blocks(cipher, d[84:84 + region_len])
        datasize, = struct.unpack_from('<I', region, 2)
        for i in range(count):
            h, off, ln = struct.unpack_from('<III', region, 6 + i * 12)
            self.entries[h] = (off, ln)
        self.body = 84 + region_len
        self.datasize = datasize
        self._resolve_local_db()

    def _resolve_local_db(self):
        d = self.data
        self.names = {}
        dbh = mix_hash('local mix database.dat')
        if dbh in self.entries:
            off, ln = self.entries[dbh]
            db = d[self.body + off:self.body + off + ln]
            for n in parse_db(db):
                h = mix_hash(n)
                if h in self.entries:
                    self.names[n] = self.entries[h]

    def get(self, name: str):
        h = mix_hash(name)
        if h not in self.entries:
            return None
        off, ln = self.entries[h]
        return self.data[self.body + off:self.body + off + ln]

    def get_hash(self, h):
        if h not in self.entries:
            return None
        off, ln = self.entries[h]
        return self.data[self.body + off:self.body + off + ln]

    def list(self):
        return sorted(self.names.items())


def main():
    import sys
    for path in sys.argv[1:]:
        try:
            m = Mix2(path)
        except NotImplementedError as e:
            print(f'{path}: {e}')
            continue
        named = len(m.names)
        print(f'== {path}: entries={len(m.entries)} named={named} datasize={m.datasize:,}')
        for n, (off, ln) in m.list():
            print(f'   {n:36} {ln:>10,}')


if __name__ == '__main__':
    main()
