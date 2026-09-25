#!/usr/bin/env python3
"""Brute-force name lookups for gamefiles RA2.MIX / MULTI.MIX / LANGUAGE.MIX entries."""
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2, mix_hash

GAME = '/home/z/my-project/assets_raw2/gamefiles'

CANDIDATES = []
# ini files
for n in ('speech.ini', 'sound.ini', 'rules.ini', 'ai.ini', 'art.ini', 'theme.ini',
          'tutorial.ini', 'missions.ini', 'missions.pkt', 'maps.ini', 'face.ini',
          'firestrm.ini', 'aftermath.ini', 'ehidden.ini', 'etscore.ini', 'sysmgmt.ini',
          'multiplayer.ini', 'general.csf', 'ra2.csf', 'language.csf', 'tutorial.csf',
          'conquer.mix', 'gmicmd.dat', 'randommap.dat', 'randmap.dat', 'isogen.dat',
          'local mix database.dat', 'keyboard.ini', 'ra2.ini', 'wolinfo.ini',
          'md5.bin', 'blowfish.dll', 'patchmd5.bin'):
    CANDIDATES.append(n)
    CANDIDATES.append(n.upper())
# generic: numbers with common prefixes and extensions
for p in ('e', 'ev', 'eva', 's', 't', 'm', 'ui', 'shell'):
    for i in range(1, 200):
        for ext in ('', '.wav', '.shp', '.pcx', '.ini', '.csf', '.pal', '.vqa', '.bik', '.mix'):
            CANDIDATES.append(f'{p}{i}{ext}')
# themes
for t in ('grinder', 'power', 'fortific', 'indeep', 'tension', 'eaglehun', 'industro',
          'jank', 'blowitup', 'destroy', 'burn', 'motorize', 'hm2', 'ra2-sco', 'ra2-opt',
          '200meter', 'intro', 'score', 'loading', 'credits', 'ra2options', 'motorized',
          'industrofunk', 'eaglehunter', 'blowitup', 'valves', 'c&cinthehouse', 'readarmy',
          'probing', 'readythearmy'):
    for ext in ('.wav', '.aud', '', '.mp3'):
        CANDIDATES.append(t + ext)
        CANDIDATES.append(t.upper() + ext)
        CANDIDATES.append(t[:8] + ext)


def probe(mix_path):
    m = Mix2(mix_path)
    found = {}
    for c in CANDIDATES:
        h = mix_hash(c)
        if h in m.entries:
            found[c] = m.entries[h]
    print(f'== {mix_path}: {len(m.entries)} entries, matched {len(found)}')
    for c, (off, ln) in sorted(found.items(), key=lambda kv: kv[1][0]):
        print(f'   {c:24} off={off:>10,} len={ln:>11,}')
    return m, found


if __name__ == '__main__':
    for name in sys.argv[1:] or ('RA2.MIX', 'MULTI.MIX', 'LANGUAGE.MIX'):
        probe(f'{GAME}/{name}')
