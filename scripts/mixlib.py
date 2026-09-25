#!/usr/bin/env python3
"""Westwood RA MIX archive with encrypted header support.
RSA public-key -> blowfish key -> decrypt index. Pure Python.
"""
import struct
import base64
import json
from Crypto.Cipher import Blowfish

PUBKEY_B64 = "AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V"
E = 65537


def _parse_modulus():
    der = base64.b64decode(PUBKEY_B64 + "=" * (-len(PUBKEY_B64) % 4))
    assert der[0] == 0x02, 'not DER int'
    if der[1] & 0x80:
        nlen_bytes = der[1] & 0x7F
        nlen = int.from_bytes(der[2:2+nlen_bytes], 'big')
        payload = der[2+nlen_bytes:2+nlen_bytes+nlen]
    else:
        nlen = der[1]
        payload = der[2:2+nlen]
    return int.from_bytes(payload, 'big')


_MODULUS = _parse_modulus()
_BITLEN = _MODULUS.bit_length()
_A = (_BITLEN - 1 - 1) // 8


def decrypt_keyblock(keyblock: bytes) -> bytes:
    """RSA-process the 80-byte keyblock -> 56-byte blowfish key."""
    a = _A
    pre_len = (55 // a + 1) * (a + 1)
    src_off, dest = 0, b''
    while a + 1 <= pre_len and src_off + a + 1 <= len(keyblock):
        chunk = keyblock[src_off:src_off + a + 1]
        v = int.from_bytes(chunk, 'little')
        r = pow(v, E, _MODULUS)
        dest += r.to_bytes(80, 'little')[:a]
        pre_len -= a + 1
        src_off += a + 1
    return dest[:56]


def bf_decrypt_blocks(cipher, data: bytes) -> bytes:
    out = b''
    for i in range(0, len(data), 8):
        out += cipher.decrypt(data[i:i+8])
    return out


def classic_hash(name: str) -> int:
    n = name.upper()
    pad = (4 - len(n) % 4) % 4
    n = n + '\0' * pad
    result = 0
    for i in range(0, len(n), 4):
        t = ord(n[i]) | (ord(n[i+1]) << 8) | (ord(n[i+2]) << 16) | (ord(n[i+3]) << 24)
        result = ((result << 1) | (result >> 31)) & 0xFFFFFFFF
        result = (result + t) & 0xFFFFFFFF
    return result


class MixArchive:
    def __init__(self, path):
        self.f = open(path, 'rb')
        d = self.f
        first, = struct.unpack('<H', d.read(2))
        if first != 0:
            self.is_cnc = True
            d.seek(0)
            self.num_files, = struct.unpack('<H', d.read(2))
            self.body_size, = struct.unpack('<I', d.read(4))
            self.data_start = 6 + 12 * self.num_files
            self._read_index(d)
        else:
            self.is_cnc = False
            flags, = struct.unpack('<H', d.read(2))
            self.encrypted = bool(flags & 0x2)
            if self.encrypted:
                keyblock = d.read(80)
                bfkey = decrypt_keyblock(keyblock)
                cipher = Blowfish.new(bfkey, Blowfish.MODE_ECB)
                first_block = bf_decrypt_blocks(cipher, d.read(8))
                self.num_files, = struct.unpack('<H', first_block[:2])
                block_count = (13 + self.num_files * 12) // 8
                rest = bf_decrypt_blocks(cipher, d.read(block_count * 8 - 8))
                header = first_block + rest
                self.body_size, = struct.unpack('<I', header[2:6])
                self.header = header
                self.data_start = 4 + 80 + block_count * 8
                self._parse_index_from(header[6:6 + 12 * self.num_files])
            else:
                self.num_files, = struct.unpack('<H', d.read(2))
                self.body_size, = struct.unpack('<I', d.read(4))
                self.data_start = 4 + 6 + 12 * self.num_files
                self._read_index(d)
        self.by_hash = {h: (off, ln) for h, off, ln in self.entries}

    def _read_index(self, d):
        raw = d.read(12 * self.num_files)
        self._parse_index_from(raw)

    def _parse_index_from(self, raw):
        self.entries = []
        for i in range(self.num_files):
            h, off, ln = struct.unpack_from('<III', raw, i * 12)
            self.entries.append((h, off, ln))

    def read_file_by_hash(self, h):
        off, ln = self.by_hash[h]
        self.f.seek(self.data_start + off)
        return self.f.read(ln)

    def try_read(self, name):
        h = classic_hash(name)
        return self.read_file_by_hash(h) if h in self.by_hash else None

    def resolve_names(self, extra_names=()):
        names = json.load(open('/home/z/my-project/assets_raw/mixdb_names.json'))
        names = list(names) + list(extra_names)
        out = {}
        for n in names:
            h = classic_hash(n)
            if h in self.by_hash:
                out[n] = self.by_hash[h]
        return out


def main():
    import sys
    path = sys.argv[1]
    mix = MixArchive(path)
    enc = mix.__dict__.get('encrypted', False)
    print(f'format={"C&C" if mix.is_cnc else "RA"} encrypted={enc} files={mix.num_files} body={mix.body_size:,} data_start={mix.data_start}')
    resolved = mix.resolve_names()
    print(f'resolved {len(resolved)}/{mix.num_files} names')
    # also try "local mix database.dat" inside
    localdb = mix.try_read('local mix database.dat')
    if localdb:
        print('local mix database found!', len(localdb))
        # parse pairs
        names = []
        off = 4
        try:
            while off < len(localdb):
                e = localdb.index(b'\0', off); n = localdb[off:e].decode('ascii', 'ignore'); off = e + 1
                e2 = localdb.index(b'\0', off); off = e2 + 1
                names.append(n)
        except ValueError:
            pass
        resolved2 = mix.resolve_names(names)
        print('after local db: resolved', len(resolved2))
        resolved.update({k: v for k, v in resolved2.items() if k not in resolved})
    for n, (off, ln) in sorted(resolved.items()):
        print(f'{n:<26} {ln:>12,}')


if __name__ == '__main__':
    main()
