#!/usr/bin/env python3
"""Extract nested mixes and then list/extract game assets."""
import sys
import json
import os
sys.path.insert(0, '/home/z/my-project/scripts')
from mixlib import MixArchive, classic_hash

MAIN = '/home/z/my-project/assets_raw/extracted/MAIN.MIX'
OUT = '/home/z/my-project/assets_raw/extracted'

main_mix = MixArchive(MAIN)
want = ['conquer.mix', 'temperat.mix', 'general.mix', 'interior.mix', 'snow.mix', 'sounds.mix', 'russian.mix', 'allies.mix']
for w in want:
    data = main_mix.try_read(w)
    if data is None:
        print('MISSING', w)
        continue
    p = os.path.join(OUT, w)
    open(p, 'wb').write(data)
    print('extracted', w, f'{len(data):,}')
    # parse it
    m = MixArchive(p)
    enc = m.__dict__.get('encrypted', False)
    resolved = m.resolve_names()
    # local db
    ldb = m.try_read('local mix database.dat')
    if ldb:
        names = []
        off = 4
        try:
            while off < len(ldb):
                e = ldb.index(b'\0', off); n = ldb[off:e].decode('ascii', 'ignore'); off = e + 1
                e2 = ldb.index(b'\0', off); off = e2 + 1
                names.append(n)
        except ValueError:
            pass
        r2 = m.resolve_names(names)
        for k, v in r2.items():
            resolved.setdefault(k, v)
    print(f'  files={m.num_files} resolved={len(resolved)} enc={enc}')
    with open(os.path.join(OUT, w + '.names.json'), 'w') as fj:
        json.dump({n: [o, l] for n, (o, l) in resolved.items()}, fj)
    if w in ('conquer.mix', 'temperat.mix', 'general.mix'):
        for n, (o, l) in sorted(resolved.items()):
            print(f'    {n:<26} {l:>10,}')
