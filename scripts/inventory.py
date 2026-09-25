#!/usr/bin/env python3
"""Build full asset inventory: parse rules.ini/art.ini -> resolve filenames across all mixes."""
import json
import os
import re
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2, mix_hash

CDN = '/home/z/my-project/assets_raw2/cdn'
EXT = '/home/z/my-project/assets_raw2/extracted'


def parse_ini(path):
    """Minimal INI parser: {section: {key: value}}"""
    sections = {}
    cur = None
    for line in open(path, encoding='latin-1'):
        s = line.strip()
        if not s or s.startswith(';'):
            continue
        if s.startswith('[') and s.endswith(']'):
            cur = s[1:-1]
            sections[cur] = {}
        elif '=' in s and cur is not None:
            k, v = s.split('=', 1)
            sections[cur][k.strip().lower()] = v.strip()
    return sections


def collect_names():
    rules = parse_ini(os.path.join(EXT, 'rules.ini'))
    art = parse_ini(os.path.join(EXT, 'art.ini'))
    # unit/building ids by category
    cats = {}
    for sec in rules:
        if sec.lower() in ('general', 'ai', 'ruleevents', 'specialdates', 'colorschemes'):
            continue
        d = rules[sec]
        if 'image' not in d and 'cost' not in d and 'strength' not in d and 'speed' not in d:
            continue
        cats[sec] = d
    # image names: art.ini sections + rules Image=
    images = set()
    for sec, d in cats.items():
        img = d.get('image') or sec
        images.add(img)
    for sec in art:
        images.add(sec)
    return rules, art, cats, images


def main():
    mixes = {}
    for fn in sorted(os.listdir(CDN)):
        if fn.endswith('.mix'):
            try:
                mixes[fn] = Mix2(os.path.join(CDN, fn))
            except Exception as e:
                print(f'skip {fn}: {e}')
    print('mixes loaded:', list(mixes))

    rules, art, cats, images = collect_names()
    print(f'rules sections: {len(rules)}, art sections: {len(art)}, images: {len(images)}')

    # candidate filenames for each image
    found = {}   # image -> {ext: (mixname, size)}
    missing = []
    for img in sorted(images):
        entry = {}
        cands = [
            (img + '.shp', 'shp'), (img + '.vxl', 'vxl'), (img + '.hva', 'hva'),
            (img[:8] + '.shp', 'shp8'), (img[:8] + '.vxl', 'vxl8'), (img[:8] + '.hva', 'hva8'),
        ]
        for cand, ext in cands:
            h = mix_hash(cand)
            for mn, m in mixes.items():
                if h in m.entries:
                    entry[ext if not ext.endswith('8') else ext[:-1]] = (mn, m.entries[h][1])
                    break
        if entry:
            found[img] = entry
        else:
            missing.append(img)
    # cameos
    cameo_files = {}
    if 'cameo.mix' in mixes:
        cm = mixes['cameo.mix']
        for img in sorted(images):
            for pat in (img[:8] + 'icon.shp', img[:8] + 'uico.shp', img + 'icon.shp'):
                h = mix_hash(pat)
                if h in cm.entries:
                    cameo_files[img] = (pat, cm.entries[h][1])
                    break
    print(f'\nresolved art files for {len(found)}/{len(images)} images')
    print(f'cameos resolved: {len(cameo_files)}')
    print(f'\nmissing (no shp/vxl/hva): {len(missing)}')
    print(' ', ', '.join(missing[:60]))

    # per-mix stats
    print('\nper-mix entry counts:')
    for mn, m in mixes.items():
        print(f'  {mn:20} entries={len(m.entries):5} named={len(m.names):5} datasize={m.datasize:>12,}')

    # what's inside each mix by extension (via candidates from art + theme + sound)
    # save inventory
    inv = {'found': {k: {kk: list(vv) for kk, vv in v.items()} for k, v in found.items()},
           'missing': missing,
           'cameos': {k: list(v) for k, v in cameo_files.items()}}
    with open(os.path.join(EXT, 'inventory.json'), 'w') as f:
        json.dump(inv, f, indent=1)
    print('\nsaved inventory.json')

    # where are vehicles vs infantry vs buildings?
    print('\nsample resolutions:')
    for probe in ['MTNK', 'HTNK', 'HTK', 'SREF', 'AEGIS', 'HORV', 'CMON', 'GI', 'E1', 'IVAN', 'TESLA COIL', 'GAPILE', 'GAPOWR', 'NAPOWR', 'NAWEAP', 'GAWEAP', 'PPOWER', 'ATESLA', 'V3', 'DRONE', 'APOC', 'TANY', 'SENGINEER', 'ENGINEER', 'DOG']:
        if probe in found:
            print(f'  {probe:12} {found[probe]}')
        else:
            # try art.ini alt names
            print(f'  {probe:12} MISSING')


if __name__ == '__main__':
    main()
