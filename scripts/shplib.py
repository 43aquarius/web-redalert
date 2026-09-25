#!/usr/bin/env python3
"""Westwood TD/RA1 SHP decoder (LCW + XOR delta). Pure Python."""


def decode_lcw(src, pos, dest):
    """LCW decompress from src[pos:] into dest bytearray. Returns bytes consumed."""
    di = 0
    n = len(src)
    while True:
        if pos >= n:
            return di
        i = src[pos]; pos += 1
        if (i & 0x80) == 0:
            # case 2: short back-reference
            second = src[pos]; pos += 1
            count = ((i & 0x70) >> 4) + 3
            rpos = ((i & 0x0F) << 8) + second
            sp = di - rpos
            if sp < 0:
                return di
            for k in range(count):
                if di >= len(dest):
                    return di
                dest[di] = dest[sp + k] if sp + k < di else dest[sp + (k % max(1, di - sp))] if di > sp else 0
                di += 1
        elif (i & 0x40) == 0:
            # case 1: literal run
            count = i & 0x3F
            if count == 0:
                return di
            for k in range(count):
                if di >= len(dest):
                    return di
                dest[di] = src[pos]; pos += 1
                di += 1
        else:
            count3 = i & 0x3F
            if count3 == 0x3E:
                # case 4: long RLE
                count = src[pos] | (src[pos + 1] << 8); pos += 2
                color = src[pos]; pos += 1
                for k in range(count):
                    if di >= len(dest):
                        return di
                    dest[di] = color
                    di += 1
            else:
                # case 3 / 5: back-reference
                count = count3 + 3
                if count3 == 0x3F:
                    count = src[pos] | (src[pos + 1] << 8); pos += 2
                src_index = src[pos] | (src[pos + 1] << 8); pos += 2
                if src_index >= di:
                    raise ValueError(f'lcw bad backref {src_index} >= {di}')
                for k in range(count):
                    if di >= len(dest):
                        return di
                    dest[di] = dest[src_index + k] if src_index + k < di else dest[src_index + (k % max(1, di - src_index))]
                    di += 1


def decode_xor_delta(src, pos, dest):
    """Apply XOR delta from src[pos:] onto dest in place."""
    di = 0
    n = len(src)
    while True:
        if pos >= n:
            return di
        i = src[pos]; pos += 1
        if (i & 0x80) == 0:
            count = i & 0x7F
            if count == 0:
                # case 6: xor fill
                count = src[pos]; pos += 1
                value = src[pos]; pos += 1
                for k in range(count):
                    if di + k >= len(dest):
                        return di
                    dest[di + k] ^= value
                di += count
            else:
                # case 5: xor literals
                for k in range(count):
                    if di >= len(dest):
                        return di
                    dest[di] ^= src[pos]; pos += 1
                    di += 1
        else:
            count = i & 0x7F
            if count == 0:
                count = src[pos] | (src[pos + 1] << 8); pos += 2
                if count == 0:
                    return di
                if (count & 0x8000) == 0:
                    # case 2: skip
                    di += count & 0x7FFF
                elif (count & 0x4000) == 0:
                    # case 3: long xor literals
                    cnt = count & 0x3FFF
                    for k in range(cnt):
                        if di >= len(dest):
                            return di
                        dest[di] ^= src[pos]; pos += 1
                        di += 1
                else:
                    # case 4: long xor fill
                    cnt = count & 0x3FFF
                    value = src[pos]; pos += 1
                    for k in range(cnt):
                        if di >= len(dest):
                            return di
                        dest[di + k] ^= value
                    di += cnt
            else:
                # case 1: skip
                di += count


class ShpFile:
    def __init__(self, data: bytes):
        self.data = data
        import struct
        self.image_count, = struct.unpack_from('<H', data, 0)
        self.width, = struct.unpack_from('<H', data, 6)
        self.height, = struct.unpack_from('<H', data, 8)
        self.data_start = 14 + 8 * (self.image_count + 2)
        self.headers = []
        for i in range(self.image_count):
            off = 14 + 8 * i
            d, = struct.unpack_from('<I', data, off)
            file_offset = d & 0xFFFFFF
            fmt = (d >> 24) & 0xFF
            ref_offset, = struct.unpack_from('<H', data, off + 4)
            ref_format, = struct.unpack_from('<H', data, off + 6)
            self.headers.append((file_offset, fmt, ref_offset, ref_format))
        # map offsets -> frame index for XORLCW refs
        by_off = {h[0]: idx for idx, h in enumerate(self.headers)}
        self.frames = [None] * self.image_count
        for i in range(self.image_count):
            self._decompress(i, by_off)

    def _decompress(self, i, by_off):
        if self.frames[i] is not None:
            return
        file_offset, fmt, ref_offset, ref_format = self.headers[i]
        size = self.width * self.height
        if size == 0:
            self.frames[i] = b''
            return
        if fmt == 0x80:  # LCW
            dest = bytearray(size)
            decode_lcw(self.data, file_offset, dest)
            self.frames[i] = bytes(dest)
        elif fmt == 0x20:  # XORPrev
            self._decompress(i - 1, by_off)
            dest = bytearray(self.frames[i - 1][:size])
            decode_xor_delta(self.data, file_offset, dest)
            self.frames[i] = bytes(dest)
        elif fmt == 0x40:  # XORLCW
            ref = by_off.get(ref_offset)
            if ref is None:
                raise ValueError(f'bad ref {ref_offset} frame {i}')
            self._decompress(ref, by_off)
            dest = bytearray(self.frames[ref][:size])
            decode_xor_delta(self.data, file_offset, dest)
            self.frames[i] = bytes(dest)
        elif fmt == 0x00:
            # empty frame (all zero)
            self.frames[i] = bytes(size)
        else:
            raise ValueError(f'unknown shp format 0x{fmt:02x} frame {i}')


def parse_shp(data: bytes) -> ShpFile:
    return ShpFile(data)


if __name__ == '__main__':
    import sys
    shp = ShpFile(open(sys.argv[1], 'rb').read())
    print(f'{sys.argv[1]}: {shp.width}x{shp.height}, {shp.image_count} frames')
