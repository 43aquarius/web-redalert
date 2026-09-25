#!/usr/bin/env python3
"""RA terrain template (.tem TMP-RA format) decoder."""
import struct


def parse_tmp_ra(data: bytes):
    """Returns dict: {w, h, imgStart, index, tiles: {num: bytes}}"""
    w, h = struct.unpack_from('<HH', data, 0)
    img_start, = struct.unpack_from('<I', data, 16)
    index_end, = struct.unpack_from('<i', data, 28)
    index_start, = struct.unpack_from('<i', data, 36)
    index = data[index_start:index_end]
    tiles = {}
    for b in set(index):
        if b != 255:
            off = img_start + b * w * h
            tiles[b] = data[off:off + w * h]
    return {'w': w, 'h': h, 'imgStart': img_start, 'index': index, 'tiles': tiles}


if __name__ == '__main__':
    import sys
    sys.path.insert(0, '/home/z/my-project/scripts')
    from mixlib import MixArchive
    from collections import Counter

    temperat = MixArchive('/home/z/my-project/assets_raw/extracted/temperat.mix')
    for name in ['clear1.tem', 'd01.tem', 'd02.tem', 'd05.tem', 's01.tem', 'sh01.tem', 'rv01.tem', 'p01.tem', 'w2.tem', 'f01.tem', 'b1.tem']:
        data = temperat.try_read(name)
        if not data:
            print(name, 'MISSING'); continue
        try:
            t = parse_tmp_ra(data)
            hist = Counter()
            for b, td in t['tiles'].items():
                hist.update(td)
            top = hist.most_common(10)
            print(f'{name}: {t["w"]}x{t["h"]} cells={len(t["index"])} tiles={len(t["tiles"])} '
                  f'idx={list(t["index"])[:8]} top_pal={[i for i, _ in top]}')
        except Exception as e:
            print(name, 'ERROR:', e)
