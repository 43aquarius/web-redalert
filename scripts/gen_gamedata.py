#!/usr/bin/env python3
"""Generate game data JS module from extracted RA2 rules + asset manifests."""
import json
import os

EX = '/home/z/my-project/assets_raw2/extracted'
RA = '/home/z/my-project/assets_ra2'
OUT = '/home/z/my-project/ra2web'
os.makedirs(OUT, exist_ok=True)

rd = json.load(open(f'{EX}/rules_data.json'))
strings = json.load(open(f'{EX}/strings.json'))
inf_manifest = json.load(open(f'{RA}/inf_manifest.json'))
units_manifest = json.load(open(f'{RA}/units_manifest.json'))
bld_manifest = json.load(open(f'{RA}/bld_manifest.json'))
ovl_manifest = json.load(open(f'{RA}/ovl_manifest.json'))
audio_manifest = json.load(open(f'{RA}/audio_manifest.json'))
eva_ini_events = audio_manifest.get('eva', {})

units = {u['id']: u for u in rd['vehicle']}
infs = {u['id']: u for u in rd['infantry']}
blds = {u['id']: u for u in rd['building']}
weapons = rd['weapons']
art = rd.get('art', {})


def w(name):
    if name not in weapons:
        return None
    w = weapons[name]
    return {
        'damage': w['damage'], 'rof': w['rof'], 'range': max(1, int(w['range'])),
        'speed': w.get('speed', 0), 'burst': w.get('burst', 1),
        'warhead': w['warhead'],
    }


def tech(u, kind):
    return {
        'id': u['id'], 'name': u['name'], 'cost': u['cost'],
        'hp': u['strength'], 'speed': u.get('speed', 0),
        'weapon': w(u.get('weapon', '')) if u.get('weapon') else None,
        'weapon2': w(u.get('weapon2', '')) if u.get('weapon2') else None,
        'prereq': u['prerequisite'], 'techLevel': u['techLevel'],
    }


# ---- buildings ----
BUILDING_DEFS = {
    # Allied
    'GACNST': dict(size=(3, 3), power=0, sight=8, isBase=True),
    'GAPOWR': dict(size=(2, 2), power=200, sight=4),
    'GAREFN': dict(size=(3, 3), power=-50, sight=6, isRefinery=True, dock=True),
    'GAPILE': dict(size=(2, 2), power=-10, sight=5, factory='infantry'),
    'GAWEAP': dict(size=(3, 3), power=-25, sight=6, factory='vehicle'),
    'GAAIRC': dict(size=(2, 2), power=-50, sight=10, radar=True),
    'GATECH': dict(size=(3, 2), power=-100, sight=6),
    'GAPILL': dict(size=(1, 1), power=0, sight=7, defense=True, weapon=w('M60')),
    'NASAM': dict(size=(1, 1), power=-50, sight=10, defense=True, antiAir=True, weapon=w('RedEye2') or w('Patriot')),
    'ATESLA': dict(size=(1, 1), power=-75, sight=9, defense=True, weapon=w('TurretBolt') or w('TankBolt')),
    'GADEPT': dict(size=(2, 2), power=-25, sight=5, repair=True),
    'GAWALL': dict(size=(1, 1), power=0, sight=0, wall=True, hp=300),
    'GACSPH': dict(size=(2, 2), power=-200, sight=5, super='chronosphere'),
    # Soviet
    'NACNST': dict(size=(3, 3), power=0, sight=8, isBase=True),
    'NAPOWR': dict(size=(2, 2), power=200, sight=4),
    'NAREFN': dict(size=(3, 3), power=-50, sight=6, isRefinery=True, dock=True),
    'NAHAND': dict(size=(2, 2), power=-10, sight=5, factory='infantry'),
    'NAWEAP': dict(size=(3, 3), power=-25, sight=6, factory='vehicle'),
    'NARADR': dict(size=(2, 2), power=-50, sight=10, radar=True),
    'NALASR': dict(size=(1, 1), power=0, sight=7, defense=True, weapon=w('M60')),
    'TESLA': dict(size=(1, 1), power=-75, sight=9, defense=True, weapon=w('TeslaZap') or w('TankBolt')),
    'NADEPT': dict(size=(2, 2), power=-20, sight=5, repair=True),
    'NAIRON': dict(size=(2, 2), power=-200, sight=5, super='ironcurtain'),
    'NAMISL': dict(size=(2, 2), power=-200, sight=5, super='nuclear'),
}

buildings = {}
for bid, extra in BUILDING_DEFS.items():
    u = blds.get(bid)
    if not u:
        print('!! building rules missing:', bid)
        continue
    d = tech(u, 'building')
    d.update(extra)
    d['cost'] = u['cost'] if u['cost'] else d['cost']
    buildings[bid] = d

# ---- units ----
UNIT_DEFS = {
    # Allied vehicles
    'MTNK': dict(kind='vehicle', sprite='MTNK', turret=True),
    'MGTK': dict(kind='vehicle', sprite='MGTK', turret=True),
    'FV':   dict(kind='vehicle', sprite='FV', turret=True),
    'SREF': dict(kind='vehicle', sprite='SREF', turret=True),
    'TNKD': dict(kind='vehicle', sprite='TNKD'),
    'CMIN': dict(kind='vehicle', sprite='CMIN', harvester=True, ammoWeapon=None),
    'AMCV': dict(kind='vehicle', sprite='AMCV', mcv=True),
    'SHAD': dict(kind='vehicle', sprite='SHAD', flyer=True),
    # Soviet vehicles
    'HTNK': dict(kind='vehicle', sprite='HTNK', turret=True),
    'APOC': dict(kind='vehicle', sprite='APOC', turret=True),
    'TTNK': dict(kind='vehicle', sprite='TTNK', turret=True),
    'V3':   dict(kind='vehicle', sprite='V3', turret=False),
    'HTK':  dict(kind='vehicle', sprite='HTK', turret=True, antiAir=True),
    'HARV': dict(kind='vehicle', sprite='HARV', turret=True, harvester=True),
    'SMCV': dict(kind='vehicle', sprite='SMCV', mcv=True),
    'DTRUCK': dict(kind='vehicle', sprite='DTRUCK'),
    'ZEP':  dict(kind='vehicle', sprite='ZEP', flyer=True),
    # infantry (both sides)
    'GI':       dict(kind='infantry', sprite='GI', rulesId='E1'),
    'E2':       dict(kind='infantry', sprite='E2'),
    'ENGINEER': dict(kind='infantry', sprite='ENGINEER', engineer=True),
    'DOG':      dict(kind='infantry', sprite='DOG'),
    'TANY':     dict(kind='infantry', sprite='TANY'),
    'SHK':      dict(kind='infantry', sprite='SHK'),
    'IVAN':     dict(kind='infantry', sprite='IVAN'),
    'DESO':     dict(kind='infantry', sprite='DESO'),
    'YURI':     dict(kind='infantry', sprite='YURI'),
    'CLEG':     dict(kind='infantry', sprite='CLEG'),
    'SPY':      dict(kind='infantry', sprite='SPY'),
    'GHOST':    dict(kind='infantry', sprite='GHOST'),
    'DRON':     dict(kind='infantry', sprite='DRON'),
}

unit_tables = {**units, **infs}
unitdefs = {}
for uid, extra in UNIT_DEFS.items():
    u = unit_tables.get(extra.get('rulesId', uid))
    if not u:
        print('!! unit rules missing:', uid)
        continue
    d = tech(u, 'unit')
    d['id'] = uid
    d.update(extra)
    # harvester: strip weapon damage (mining unit)
    unitdefs[uid] = d

# ---- production trees (sidebar tabs) ----
PRODUCTION = {
    'allied': {
        'buildings': ['GAPOWR', 'GAREFN', 'GAPILE', 'GAWEAP', 'GAAIRC', 'GAPILL', 'NASAM', 'ATESLA', 'GADEPT', 'GAWALL', 'GATECH', 'GACSPH'],
        'infantry': ['GI', 'ENGINEER', 'DOG', 'SPY', 'GHOST', 'CLEG', 'TANY'],
        'vehicles': ['CMIN', 'MTNK', 'FV', 'TNKD', 'MGTK', 'SREF', 'AMCV', 'SHAD'],
    },
    'soviet': {
        'buildings': ['NAPOWR', 'NAREFN', 'NAHAND', 'NAWEAP', 'NARADR', 'NALASR', 'TESLA', 'NADEPT', 'GAWALL', 'NAIRON', 'NAMISL'],
        'infantry': ['E2', 'ENGINEER', 'DOG', 'SHK', 'IVAN', 'DESO', 'YURI', 'DRON'],
        'vehicles': ['HARV', 'HTNK', 'HTK', 'TTNK', 'V3', 'DTRUCK', 'APOC', 'SMCV', 'ZEP'],
    },
}

# ---- audio event map (game event -> ogg files) ----
# weapon report sounds
sound_events = json.load(open(f'{EX}/sound_names.json')) if os.path.exists(f'{EX}/sound_names.json') else []
# build weapon->sfx map from sound.ini via rules weapon Report= (approximate: weapon name -> similar sound names)
# Simplified mapping: explicit game events
SFX_MAP = {
    'cannon': '120mm', 'cannon2': '105mm', 'vulcan': 'vulcan2',
    'prism': 'prism', 'tesla': 'tesla', 'explosion': 'explode',
    'bigexplosion': 'bigexpl', 'naval': 'naval',
}

# EVA events we will use
EVA_EVENTS = {}
for ev, sides in eva_ini_events.items():
    EVA_EVENTS[ev] = sides

data = {
    'buildings': buildings,
    'units': unitdefs,
    'production': PRODUCTION,
    'eva': EVA_EVENTS,
    'infManifest': inf_manifest['infantry'],
    'cameos': inf_manifest['cameos'],
    'unitsManifest': {k: v for k, v in units_manifest['units'].items()},
    'buildingsManifest': bld_manifest['buildings'],
    'terrainManifest': bld_manifest['terrain'],
    'overlaysManifest': ovl_manifest['overlays'],
}

js = 'const GAMEDATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
open(f'{OUT}/data.js', 'w').write(js)
print('data.js written:', len(js) // 1024, 'KB')
print('buildings:', len(buildings), 'units:', len(unitdefs), 'eva events:', len(EVA_EVENTS))
