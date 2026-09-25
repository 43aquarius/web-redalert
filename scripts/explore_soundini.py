#!/usr/bin/env python3
"""Parse sound.ini, classify name origins ($ prefix rule), reverse-lookup eva mix entries."""
import re
import struct
import sys
from collections import Counter

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2, mix_hash

SOUND_INI = '/home/z/my-project/assets_raw2/extracted/sound.ini'


def parse_sound_ini(path):
    """Return {section: {'sounds': [names], 'raw': {key: value}}} for real event sections."""
    events = {}
    cur = None
    for line in open(path, encoding='latin-1'):
        line = line.strip()
        if not line or line.startswith(';'):
            continue
        m = re.match(r'^\[(.+)\]$', line)
        if m:
            cur = m.group(1).strip()
            events[cur] = {'sounds': [], 'raw': {}}
            continue
        if cur is None:
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if k.lower() == 'sounds':
                # strip inline comments, split tokens
                toks = [t for t in re.split(r'[,\s]+', v) if t and not t.startswith(';')]
                events[cur]['sounds'] = toks
            else:
                events[cur]['raw'][k.lower()] = v
    return events


def parse_idx(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'GABA'
    n, = struct.unpack_from('<I', d, 8)
    out = {}
    for i in range(n):
        e = d[12 + i * 36:12 + (i + 1) * 36]
        name = e[:16].split(b'\0')[0].decode('ascii', 'ignore')
        off, ln, rate, f12, f512 = struct.unpack_from('<IIIII', e, 16)
        out[name] = (off, ln, rate, f12, f512)
    return out


def main():
    eva_ally = Mix2('/home/z/my-project/assets_raw2/cdn/eva-ally.mix')
    eva_sov = Mix2('/home/z/my-project/assets_raw2/cdn/eva-sov.mix')
    idx = parse_idx('/tmp/audio.idx')
    print(f'audio.idx names: {len(idx)}')

    events = parse_sound_ini(SOUND_INI)
    ev_sections = {k: v for k, v in events.items()
                   if k not in ('Defaults', 'SoundList', 'SpeechList') and v['sounds']}
    print(f'sections with Sounds=: {len(ev_sections)}')

    # gather all names, remember $ prefix
    stats = Counter()
    loc_of = {}
    all_names = []
    for sec, ev in ev_sections.items():
        for tok in ev['sounds']:
            dollar = tok.startswith('$')
            name = tok.lstrip('$')
            all_names.append((sec, name, dollar))
            h = mix_hash(name)
            in_ally = h in eva_ally.entries
            in_sov = h in eva_sov.entries
            in_idx = name in idx
            if in_ally or in_sov:
                loc = 'eva'
            elif in_idx:
                loc = 'bag'
            else:
                loc = 'none'
            loc_of[name] = loc
            stats[(dollar, loc)] += 1

    print('\n($ prefix, location) -> count:')
    for k, v in sorted(stats.items()):
        print(f'  ${k[0]!s:5} {k[1]:4} -> {v}')

    # sections present?
    print('\nList-like sections found:',
          [k for k in events if k.lower().endswith('list') or k == 'Defaults'])

    # EVA name samples: names located in eva mixes
    eva_names = sorted({n for (s, n, d) in all_names if loc_of.get(n) == 'eva'})
    print(f'\nnames found in eva mixes: {len(eva_names)}')
    print('  sample:', eva_names[:25])

    bag_names = sorted({n for (s, n, d) in all_names if loc_of.get(n) == 'bag'})
    print(f'names found in bag: {len(bag_names)}  sample:', bag_names[:15])

    none_names = sorted({n for (s, n, d) in all_names if loc_of.get(n) == 'none'})
    print(f'names found nowhere: {len(none_names)}  sample:', none_names[:25])

    # how many of the 111 eva entries are covered by sound.ini names?
    covered_ally = {mix_hash(n) for n in eva_names} & set(eva_ally.entries)
    covered_sov = {mix_hash(n) for n in eva_names} & set(eva_sov.entries)
    print(f'\neva-ally entries covered by sound.ini names: {len(covered_ally)}/{len(eva_ally.entries)}')
    print(f'eva-sov entries covered by sound.ini names: {len(covered_sov)}/{len(eva_sov.entries)}')

    # bag: how many idx names are referenced by sound.ini?
    ref_bag = {n for (s, n, d) in all_names if n in idx}
    print(f'bag entries referenced by sound.ini: {len(ref_bag)}/{len(idx)}')

    # check bag first file bytes
    bag = open('/tmp/audio.bag', 'rb').read(64)
    print('\naudio.bag first 64 bytes:', bag[:64].hex())

    # which sections reference eva names?
    eva_secs = {}
    for sec, ev in ev_sections.items():
        for tok in ev['sounds']:
            n = tok.lstrip('$')
            if loc_of.get(n) == 'eva':
                eva_secs.setdefault(sec, []).append(n)
    print(f'\nsections referencing eva sounds: {len(eva_secs)}')
    for s in list(eva_secs)[:30]:
        print(f'  [{s}] -> {eva_secs[s][:4]}')


if __name__ == '__main__':
    main()
