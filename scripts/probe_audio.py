#!/usr/bin/env python3
"""Probe sounds.mix / eva mixes / THEME.MIX for audio entries by hash."""
import sys, json, os
sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2, mix_hash

CDN = '/home/z/my-project/assets_raw2/cdn'
GAME = '/home/z/my-project/assets_raw2/gamefiles'

names = json.load(open('/home/z/my-project/assets_raw2/extracted/sound_names.json'))

def probe(mix_path, cands):
    m = Mix2(mix_path)
    found = {}
    for c in cands:
        h = mix_hash(c)
        if h in m.entries:
            found[c] = m.entries[h]
    print(f'== {os.path.basename(mix_path)}: entries={len(m.entries)} matched={len(found)}')
    return m, found

# build candidates: raw, with .aud, with .wav, with $ stripped
cands = set()
for n in names:
    for base in (n, n.lstrip('$')):
        cands.add(base)
        cands.add(base + '.aud')
        cands.add(base + '.wav')

# themes
themes = ['intro', 'grinder', 'power', 'fortification', 'indeep', 'tension', 'eaglehunter',
          'industrofunk', 'jank', '200meters', 'blowitup', 'destroy', 'burn', 'score',
          'loading', 'credits', 'ra2options', 'motorized', 'hm2', 'readyarmy', 'c&cinthehouse']
theme_cands = set()
for t in themes:
    for ext in ('.aud', '.wav', ''):
        theme_cands.add(t + ext)
        theme_cands.add(t[:8] + ext)

results = {}
for fn in ('sounds.mix', 'eva-ally.mix', 'eva-sov.mix'):
    m, found = probe(os.path.join(CDN, fn), cands)
    for c, (o, l) in found.items():
        results.setdefault(fn, {})[c] = [o, l]

m, found = probe(os.path.join(GAME, 'THEME.MIX'), theme_cands)
for c, (o, l) in found.items():
    results.setdefault('THEME.MIX', {})[c] = [o, l]

json.dump(results, open('/home/z/my-project/assets_raw2/extracted/audio_probe.json', 'w'), indent=1)
print('saved audio_probe.json')
