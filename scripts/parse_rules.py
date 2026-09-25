#!/usr/bin/env python3
"""Parse RA2 rules.ini + art.ini -> structured JSON game data."""
import re
import json
import sys

EX = '/home/z/my-project/assets_raw2/extracted'


def parse_ini(path):
    txt = open(path, encoding='latin-1').read()
    # strip comments ( ; to eol ) but keep strings? RA2 ini has no quoted strings with ;
    lines = []
    for ln in txt.splitlines():
        # remove comments outside of values (RA2 comments start with ; possibly after space)
        i = ln.find(';')
        if i >= 0:
            ln = ln[:i]
        ln = ln.strip()
        if not ln:
            continue
        lines.append(ln)
    sections = {}
    cur = None
    for ln in lines:
        if ln.startswith('[') and ln.endswith(']'):
            cur = ln[1:-1]
            sections.setdefault(cur, {})
        elif cur is not None and '=' in ln:
            k, v = ln.split('=', 1)
            sections[cur][k.strip()] = v.strip()
    return sections


def typelist(sections, key):
    """[InfantryTypes] -> ordered list of (index, techno name)."""
    out = []
    if key in sections:
        for k, v in sorted(sections[key].items(), key=lambda kv: int(kv[0])):
            out.append(v)
    return out


def main():
    rules = parse_ini(f'{EX}/rules.ini')
    art = parse_ini(f'{EX}/art.ini')
    strings = json.load(open(f'{EX}/strings.json'))

    data = {}

    def name_of(techno):
        sec = rules.get(techno, {})
        ui = sec.get('UIName', '')
        return strings.get(ui, '') or ui

    for listkey, kind in (('InfantryTypes', 'infantry'), ('VehicleTypes', 'vehicle'),
                          ('AircraftTypes', 'aircraft'), ('BuildingTypes', 'building')):
        items = []
        for t in typelist(rules, listkey):
            sec = rules.get(t)
            if not sec:
                continue
            rec = {
                'id': t,
                'name': name_of(t),
                'image': sec.get('Image', t),
                'owner': [s.strip() for s in sec.get('Owner', '').split(',')],
                'cost': int(sec.get('Cost', 0) or 0),
                'strength': int(sec.get('Strength', 0) or 0),
                'prerequisite': [s.strip() for s in sec.get('Prerequisite', '').split(',') if s.strip()],
                'techLevel': int(sec.get('TechLevel', -1) or -1),
                'category': sec.get('Category', ''),
            }
            if kind in ('infantry', 'vehicle', 'aircraft'):
                rec['speed'] = int(sec.get('Speed', 0) or 0)
                rec['weapon'] = sec.get('Primary', '')
            if kind == 'infantry':
                pass
            if kind == 'building':
                rec['power'] = int(sec.get('Power', 0) or 0)
                rec['buildLimit'] = int(sec.get('BuildLimit', -1) or -1)
                rec['factory'] = sec.get('Factory', '')
                rec['superweapon'] = sec.get('SuperWeapon', '')
            if kind == 'vehicle':
                rec['weapon2'] = sec.get('Secondary', '')
            items.append(rec)
        data[kind] = items

    # weapons: no Types list in RA2 rules.ini; collect from all sections that look like weapons
    # (referenced by units or containing Damage=)
    wrefs = set()
    for kind in ('infantry', 'vehicle', 'aircraft'):
        for u in data[kind]:
            for wk in ('weapon', 'weapon2'):
                if u.get(wk):
                    wrefs.add(u[wk])
    weapons = {}
    for t, sec in rules.items():
        if not sec or 'Damage' not in sec:
            continue
        if not ('ROF' in sec or 'Range' in sec or 'Projectile' in sec):
            continue
        weapons[t] = {
            'damage': float(sec.get('Damage', 0) or 0),
            'rof': int(sec.get('ROF', 0) or 0),
            'range': float(sec.get('Range', 0) or 0),
            'projectile': sec.get('Projectile', ''),
            'speed': int(sec.get('Speed', 0) or 0),
            'warhead': sec.get('Warhead', ''),
            'report': sec.get('Report', ''),
            'burst': int(sec.get('Burst', 1) or 1),
        }
    data['weapons'] = weapons

    # warheads
    whs = {}
    for t in typelist(rules, 'Warheads'):
        sec = rules.get(t)
        if not sec:
            continue
        vs = {}
        for k in ('Verses',):
            if k in sec:
                vs = [float(x.strip().rstrip('%')) for x in sec[k].split(',')]
        whs[t] = {'verses': vs, 'cellspread': float(sec.get('CellSpread', 0) or 0)}
    data['warheads'] = whs

    # art mapping: image -> files
    artmap = {}
    for img, sec in art.items():
        rec = {}
        for k in ('Cameo', 'Voxel', 'SHP', 'Turret', 'TurretAnim', 'HVA', 'Remapable'):
            if k in sec:
                rec[k.lower()] = sec[k]
        if 'Sequence' in sec:
            rec['sequence'] = sec['Sequence']
        artmap[img.upper()] = rec
    data['art'] = artmap

    json.dump(data, open(f'{EX}/rules_data.json', 'w'), indent=1, ensure_ascii=False)
    print('infantry:', len(data['infantry']), 'vehicles:', len(data['vehicle']),
          'aircraft:', len(data['aircraft']), 'buildings:', len(data['building']),
          'weapons:', len(weapons), 'warheads:', len(whs), 'art:', len(artmap))
    # sample
    for u in data['vehicle'][:5]:
        print(' ', u['id'], u['name'], u['image'], u['cost'], u.get('weapon'))


if __name__ == '__main__':
    main()
