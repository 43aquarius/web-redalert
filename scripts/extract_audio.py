#!/usr/bin/env python3
"""Extract all RA2 audio: audio.bag sounds, EVA voices, THEME music -> wav (then mp3 via ffmpeg)."""
import sys
import os
import json
import struct
import subprocess

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2

CDN = '/home/z/my-project/assets_raw2/cdn'
GAME = '/home/z/my-project/assets_raw2/gamefiles'
OUT = '/home/z/my-project/assets_raw2/audio'
os.makedirs(OUT, exist_ok=True)
for sub in ('sfx', 'eva', 'music'):
    os.makedirs(f'{OUT}/{sub}', exist_ok=True)


def parse_idx(data):
    assert data[:4] == b'GABA', 'bad idx magic'
    ver, n = struct.unpack_from('<II', data, 4)
    entries = {}
    pos = 12
    for i in range(n):
        raw = data[pos:pos + 16]
        pos += 16
        name = raw.split(b'\x00')[0].decode('ascii', 'ignore')
        off, ln, rate, flags, chunk = struct.unpack_from('<IIIII', data, pos)
        pos += 20
        entries[name + '.wav'] = (off, ln, rate, flags)
    return entries


def main():
    # 1. audio.bag + audio.idx from sounds.mix
    sm = Mix2(f'{CDN}/sounds.mix')
    idx = parse_idx(sm.get('audio.idx'))
    bag = sm.get('audio.bag')
    print('audio.idx entries:', len(idx))
    json.dump({k: [v[0], v[1], v[2], v[3]] for k, v in idx.items()},
              open(f'{OUT}/audio_idx.json', 'w'))
    for name, (off, ln, rate, flags) in idx.items():
        raw = bag[off:off + ln]
        with open(f'{OUT}/sfx/{name}', 'wb') as f:
            f.write(raw)
    print('sfx extracted:', len(idx))

    # 2. EVA voices
    eva_map = {}
    for fn, side in (('eva-ally.mix', 'ally'), ('eva-sov.mix', 'sov')):
        m = Mix2(f'{CDN}/{fn}')
        for h, (o, l) in m.entries.items():
            raw = m.data[m.body + o:m.body + o + l]
            with open(f'{OUT}/eva/{side}_{h:08x}.wav', 'wb') as f:
                f.write(raw)
            eva_map[side + '_' + f'{h:08x}'] = l
    print('eva extracted (hash names, resolve via eva.ini map)')

    # 3. THEME.MIX music
    tm = Mix2(f'{GAME}/THEME.MIX')
    probe = json.load(open('/home/z/my-project/assets_raw2/extracted/audio_probe.json'))
    for name, (o, l) in probe.get('THEME.MIX', {}).items():
        raw = tm.data[tm.body + o:tm.body + o + l]
        out = f"{OUT}/music/{name}"
        with open(out, 'wb') as f:
            f.write(raw)
        print('music:', name, l)
    # name all eva files via eva.ini probe results
    for fn in ('eva-ally.mix', 'eva-sov.mix'):
        m = Mix2(f'{CDN}/{fn}')
        for n, (o, l) in m.names.items():
            h = None
        # names already known
    # rename eva hash files to real names
    for fn, side in (('eva-ally.mix', 'ally'), ('eva-sov.mix', 'sov')):
        m = Mix2(f'{CDN}/{fn}')
        for n, (o, l) in m.list():
            raw = m.data[m.body + o:m.body + o + l]
            with open(f'{OUT}/eva/{side}_{n}', 'wb') as f:
                f.write(raw)
    print('eva renamed')


if __name__ == '__main__':
    main()
