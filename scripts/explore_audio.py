#!/usr/bin/env python3
"""Explore RA2 audio sources: sounds.mix (audio.bag/idx), eva mixes, THEME.MIX."""
import struct
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2, mix_hash

CDN = '/home/z/my-project/assets_raw2/cdn'
GAME = '/home/z/my-project/assets_raw2/gamefiles'


def hexdump(data, n=96):
    for i in range(0, min(n, len(data)), 16):
        chunk = data[i:i + 16]
        hexs = ' '.join(f'{b:02x}' for b in chunk)
        text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        print(f'  {i:04x}: {hexs:<48} {text}')


def main():
    print('== sounds.mix ==')
    sm = Mix2(f'{CDN}/sounds.mix')
    print('entries:', {k: v for k, v in sm.entries.items()})
    for name in ('audio.bag', 'audio.idx'):
        h = mix_hash(name)
        off, ln = sm.entries[h]
        print(f'{name}: hash=0x{h:08x} off={off} len={ln:,}')
        data = sm.get(name)
        open(f'/tmp/{name}', 'wb').write(data)
    print('saved /tmp/audio.bag /tmp/audio.idx')

    print('\n== audio.idx header ==')
    idx = open('/tmp/audio.idx', 'rb').read()
    print('total size:', len(idx))
    hexdump(idx, 48)
    count = (len(idx) - 12) // 36
    print(f'12-byte header + 36-byte entries => count = {count}')
    print('\nfirst 5 entries (36 bytes each):')
    for i in range(5):
        hexdump(idx[12 + i * 36:12 + (i + 1) * 36], 36)
    print('\nlast 2 entries:')
    for i in range(count - 2, count):
        hexdump(idx[12 + i * 36:12 + (i + 1) * 36], 36)

    print('\n== eva mixes ==')
    for name in ('eva-ally.mix', 'eva-sov.mix'):
        m = Mix2(f'{CDN}/{name}')
        print(f'{name}: entries={len(m.entries)} body={m.body} datasize={m.datasize:,}')
        print('  first entry data:', m.get_hash(list(m.entries)[0])[:32].hex())

    print('\n== THEME.MIX ==')
    tm = Mix2(f'{GAME}/THEME.MIX')
    print('entries:', len(tm.entries), 'body:', tm.body, 'datasize:', tm.datasize)
    for h, (off, ln) in sorted(tm.entries.items(), key=lambda kv: kv[1][0]):
        print(f'  0x{h:08x} off={off:>10,} len={ln:>11,}')


if __name__ == '__main__':
    main()
