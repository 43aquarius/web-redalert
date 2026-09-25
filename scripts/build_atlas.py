#!/usr/bin/env python3
"""Master asset pipeline: extract original RA1 sprites -> packed PNG atlases + JSON manifest.
Outputs to public/sprites/.
"""
import sys
import os
import json
import struct
sys.path.insert(0, '/home/z/my-project/scripts')
from mixlib import MixArchive, classic_hash
from shplib import ShpFile
from tmplib import parse_tmp_ra
from PIL import Image

OUT = '/home/z/my-project/public/sprites'
RAW = '/home/z/my-project/assets_raw/extracted'

conquer = MixArchive(f'{RAW}/conquer.mix')
temperat = MixArchive(f'{RAW}/temperat.mix')

# ---------------- palettes ----------------

def load6bit(col):
    v = list(col)
    return [(v[i*3]*4, v[i*3+1]*4, v[i*3+2]*4, 255) for i in range(256)]


BASE_PAL = load6bit(open('/home/z/my-project/assets_raw/temperat.pal', 'rb').read())


def variant(ramp):
    """Replace indices 80-95 with a team color ramp."""
    p = list(BASE_PAL)
    for i, c in enumerate(ramp):
        p[80 + i] = (c[0], c[1], c[2], 255)
    return p


# authentic-style ramps (light -> dark, 16 steps)
RED_RAMP = [(252 - i * 4, 8, 8) for i in range(16)]
BLUE_RAMP = [(20 + i * 2, 60 + i * 4, 252 - i * 4) for i in range(16)]
GOLD_RAMP = [(252 - i * 4, 208 - i * 8, 24) for i in range(16)]

PAL_SOVIET = variant(RED_RAMP)
PAL_ALLIED = variant(BLUE_RAMP)


def frame_image(shp, fi, pal):
    w, h = shp.width, shp.height
    data = shp.frames[fi] if fi < shp.image_count else b''
    if not data or len(data) < w * h:
        return Image.new('RGBA', (w, h), (0, 0, 0, 0))
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for i in range(w * h):
        idx = data[i]
        if idx == 0:
            continue
        if idx == 4:
            px[i % w, i // w] = (0, 0, 0, 100)
        else:
            px[i % w, i // w] = pal[idx]
    return img


def tile_image(td, w, h, pal):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for i in range(w * h):
        idx = td[i]
        if idx == 0:
            continue
        if idx == 4:
            px[i % w, i // w] = (0, 0, 0, 100)
        else:
            px[i % w, i // w] = pal[idx]
    return img


# ---------------- atlas packer ----------------

class Atlas:
    def __init__(self, name, max_w=2048, bg=(0, 0, 0, 0)):
        self.name = name
        self.max_w = max_w
        self.images = []
        self.x = 0
        self.y = 0
        self.row_h = 0
        self.max_x = 0
        self.h = 0
        self.bg = bg

    def add(self, img):
        self.images.append((img, self.x, self.y))
        self.max_x = max(self.max_x, self.x + img.width)
        self.x += img.width
        self.row_h = max(self.row_h, img.height)
        return (self.x - img.width, self.y)

    def newline(self):
        self.y += self.row_h + 1
        self.x = 0
        self.row_h = 0

    def finish(self):
        self.w = self.max_x
        self.h = self.y + self.row_h
        sheet = Image.new('RGBA', (self.w, self.h), self.bg)
        for img, x, y in self.images:
            sheet.paste(img, (x, y), img)
        path = f'{OUT}/{self.name}.png'
        sheet.save(path, optimize=True)
        print(f'saved {path} {sheet.size} {os.path.getsize(path)//1024}KB')
        return self.w, self.h


class Packer:
    """Shelf packer that flushes rows when exceeding max width."""

    def __init__(self, name, max_w=2048):
        self.atlas = Atlas(name, max_w)
        self.frames = []

    def add(self, img, tag):
        if self.atlas.x + img.width > self.atlas.max_w:
            self.atlas.newline()
        x, y = self.atlas.add(img)
        self.frames.append((tag, x, y, img.width, img.height))
        return len(self.frames) - 1

    def finish(self):
        w, h = self.atlas.finish()
        return {'w': w, 'h': h, 'frames': {t: [x, y, fw, fh] for (t, x, y, fw, fh) in self.frames}}


# ---------------- definitions ----------------

# unit id -> shp + layout
UNIT_DEFS = {
    # soviet vehicles
    'harvester': {'shp': 'harv.shp', 'layout': 'harv'},
    'heavy': {'shp': '3tnk.shp', 'layout': 'tank'},
    'mammoth': {'shp': '4tnk.shp', 'layout': 'tank'},
    'v2': {'shp': 'v2rl.shp', 'layout': 'tank'},   # body 0-31, turret 32-63
    'mcv': {'shp': 'mcv.shp', 'layout': 'plain'},
    'mnly': {'shp': 'mnly.shp', 'layout': 'plain'},
    # allied vehicles
    'light': {'shp': '1tnk.shp', 'layout': 'tank'},
    'medium': {'shp': '2tnk.shp', 'layout': 'tank'},
    'ranger': {'shp': 'jeep.shp', 'layout': 'plain'},
    'artillery': {'shp': 'arty.shp', 'layout': 'tank'},
    'truk': {'shp': 'truk.shp', 'layout': 'plain'},
    # aircraft
    'hind': {'shp': 'hind.shp', 'layout': 'heli'},
    'longbow': {'shp': 'heli.shp', 'layout': 'heli'},
    'mig': {'shp': 'mig.shp', 'layout': 'plane'},
    'yak': {'shp': 'yak.shp', 'layout': 'plane'},
    # infantry
    'dog': {'shp': 'dog.shp', 'layout': 'infantry'},
}

ROTOR_DEFS = {
    'hind': 'lrotorlg.shp',
    'longbow': 'lrotor.shp',
}

BUILDING_DEFS = {
    # id: shp, footprint w,h in cells, extra draw offset
    'conyard': {'shp': 'fact.shp', 'w': 3, 'h': 3, 'off': 0, 'anim': 'fact'},
    'power': {'shp': 'powr.shp', 'w': 2, 'h': 2, 'off': 0},
    'advpower': {'shp': 'apwr.shp', 'w': 2, 'h': 2, 'off': -10},
    'refinery': {'shp': 'proc.shp', 'w': 3, 'h': 2, 'off': 0},
    'barracks': {'shp': 'barr.shp', 'w': 2, 'h': 2, 'off': -6, 'anim': 'loop10'},
    'barracks_a': {'shp': 'tent.shp', 'w': 2, 'h': 2, 'off': 0, 'anim': 'loop10'},
    'warfactory': {'shp': 'weap.shp', 'w': 3, 'h': 2, 'off': 0, 'door': 'weap2.shp'},
    'radar': {'shp': 'dome.shp', 'w': 2, 'h': 2, 'off': -4},
    'tech_s': {'shp': 'stek.shp', 'w': 3, 'h': 2, 'off': 0},
    'tech_a': {'shp': 'atek.shp', 'w': 2, 'h': 2, 'off': 0},
    'silo': {'shp': 'silo.shp', 'w': 1, 'h': 1, 'off': -1, 'anim': 'stages'},
    'depot': {'shp': 'fix.shp', 'w': 3, 'h': 2, 'off': 1, 'anim': 'loop6'},
    'missile': {'shp': 'miss.shp', 'w': 3, 'h': 2, 'off': 0},
    'turret': {'shp': 'turr.shp', 'w': 1, 'h': 1, 'off': 0, 'anim': 'turret32'},
    'aagun': {'shp': 'agun.shp', 'w': 1, 'h': 1, 'off': -13, 'anim': 'agun'},
    'tesla': {'shp': 'tsla.shp', 'w': 1, 'h': 1, 'off': -13, 'anim': 'tsla'},
    'flame': {'shp': 'ftur.shp', 'w': 1, 'h': 1, 'off': -2},
    'pillbox': {'shp': 'pbox.shp', 'w': 1, 'h': 1, 'off': 0},
    'wall': {'shp': 'sbag.shp', 'w': 1, 'h': 1, 'off': 0, 'anim': 'wall'},
    'gap': {'shp': 'gap.shp', 'w': 1, 'h': 2, 'off': 0},
    'iron': {'shp': 'iron.shp', 'w': 2, 'h': 2, 'off': 0},
    'chron': {'shp': 'pdox.shp', 'w': 2, 'h': 2, 'off': 0},
    'hpad': {'shp': 'hpad.shp', 'w': 2, 'h': 2, 'off': 0, 'anim': 'loop6'},
    'afld': {'shp': 'afld.shp', 'w': 3, 'h': 2, 'off': -4, 'anim': 'loop8'},
}

FX_DEFS = {
    'fire1': 'fire1.shp', 'fire2': 'fire2.shp', 'fire3': 'fire3.shp', 'fire4': 'fire4.shp',
    'fball': 'fball1.shp', 'napalm1': 'napalm1.shp', 'napalm2': 'napalm2.shp',
    'napalm3': 'napalm3.shp', 'artexp': 'art-exp1.shp',
    'vehhit1': 'veh-hit1.shp', 'vehhit2': 'veh-hit2.shp', 'vehhit3': 'veh-hit3.shp',
    'h2oexp1': 'h2o_exp1.shp', 'h2oexp2': 'h2o_exp2.shp', 'h2oexp3': 'h2o_exp3.shp',
    'smoke': 'smoke_m.shp', 'smokey': 'smokey.shp',
    'burnl': 'burn-l.shp', 'burnm': 'burn-m.shp', 'burns': 'burn-s.shp',
    'atomsfx': 'atomsfx.shp', 'atomicdn': 'atomicdn.shp', 'atomicup': 'atomicup.shp',
    'gunfire': 'gunfire.shp', 'gunfire2': 'gunfire2.shp', 'm120': '120mm.shp',
    'minigun': 'minigun.shp', 'litning': 'litning.shp', 'dragon': 'dragon.shp',
    'missilefx': 'missile.shp', 'bomblets': 'bomblet.shp', 'bombfx': 'bomb.shp',
    'smokland': 'smokland.shp', 'wake': 'wake.shp',
    'twinkle': 'twinkle1.shp', 'electdog': 'electdog.shp',
    'parabomb': 'parabomb.shp', 'parach': 'parach.shp',
}

TERRAIN_TREE_DEFS = [f't{n:02d}' for n in [1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]] + \
                    [f'tc{n:02d}' for n in [1, 2, 3, 4, 5]]
TERRAIN_BUSH_DEFS = [f'v{n:02d}' for n in range(1, 19)]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {'cell': 24, 'facings': {'vehicle': 32, 'infantry': 8, 'heli': 32, 'plane': 16}}

    # ============ UNITS (per faction) ============
    for faction, pal in [('soviet', PAL_SOVIET), ('allied', PAL_ALLIED)]:
        packer = Packer(f'units_{faction}')
        units = {}
        for uid, defn in UNIT_DEFS.items():
            data = conquer.try_read(defn['shp'])
            if not data:
                print('MISSING shp', defn['shp'])
                continue
            shp = ShpFile(data)
            entry = {'w': shp.width, 'h': shp.height, 'layout': defn['layout'], 'frames': []}
            for fi in range(shp.image_count):
                img = frame_image(shp, fi, pal)
                idx = packer.add(img, f'{uid}#{fi}')
                entry['frames'].append(idx)
            units[uid] = entry
        # rotors
        rotors = {}
        for uid, shpname in ROTOR_DEFS.items():
            data = conquer.try_read(shpname)
            if not data:
                continue
            shp = ShpFile(data)
            entry = {'w': shp.width, 'h': shp.height, 'frames': []}
            for fi in range(shp.image_count):
                img = frame_image(shp, fi, pal)
                idx = packer.add(img, f'rotor_{uid}#{fi}')
                entry['frames'].append(idx)
            rotors[uid] = entry
        info = packer.finish()
        manifest[f'units_{faction}'] = {'atlas': info, 'defs': units, 'rotors': rotors}
        print(f'  {faction}: {len(units)} units, {len(info["frames"])} frames')

    # ============ BUILDINGS (per faction) ============
    for faction, pal in [('soviet', PAL_SOVIET), ('allied', PAL_ALLIED)]:
        packer = Packer(f'buildings_{faction}')
        builds = {}
        for bid, defn in BUILDING_DEFS.items():
            data = conquer.try_read(defn['shp'])
            if not data:
                print('MISSING building shp', defn['shp'])
                continue
            shp = ShpFile(data)
            entry = {'w': shp.width, 'h': shp.height, 'fw': defn['w'], 'fh': defn['h'],
                     'off': defn['off'], 'anim': defn.get('anim', 'static'), 'frames': []}
            for fi in range(shp.image_count):
                img = frame_image(shp, fi, pal)
                idx = packer.add(img, f'{bid}#{fi}')
                entry['frames'].append(idx)
            if 'door' in defn:
                dshp = ShpFile(conquer.try_read(defn['door']))
                dentry = {'w': dshp.width, 'h': dshp.height, 'frames': []}
                for fi in range(dshp.image_count):
                    img = frame_image(dshp, fi, pal)
                    idx = packer.add(img, f'{bid}_door#{fi}')
                    dentry['frames'].append(idx)
                entry['door'] = dentry
            builds[bid] = entry
        info = packer.finish()
        manifest[f'buildings_{faction}'] = {'atlas': info, 'defs': builds}

    # ============ FX ============
    packer = Packer('fx')
    fx = {}
    for fid, shpname in FX_DEFS.items():
        data = conquer.try_read(shpname)
        if not data:
            print('MISSING fx', shpname)
            continue
        shp = ShpFile(data)
        entry = {'w': shp.width, 'h': shp.height, 'frames': []}
        for fi in range(shp.image_count):
            img = frame_image(shp, fi, PAL_SOVIET)  # fx use base palette (team-neutral)
            idx = packer.add(img, f'{fid}#{fi}')
            entry['frames'].append(idx)
        fx[fid] = entry
    info = packer.finish()
    manifest['fx'] = {'atlas': info, 'defs': fx}

    # ============ TERRAIN (static: grass, ore, gems, scorch, craters) ============
    packer = Packer('terrain')
    terrain = {}

    def add_tile(td, w, h, pal, tag):
        img = tile_image(td, w, h, pal)
        return packer.add(img, tag)

    # grass variants
    t = parse_tmp_ra(temperat.try_read('clear1.tem'))
    grass = []
    for k in sorted(t['tiles'].keys()):
        grass.append(add_tile(t['tiles'][k], 24, 24, BASE_PAL, f'grass#{k}'))
    terrain['grass'] = grass

    # road tiles (d-family)
    roads = []
    for name in ['d01', 'd03', 'd04', 'd12', 'd28']:
        tm = parse_tmp_ra(temperat.try_read(f'{name}.tem'))
        for k in sorted(tm['tiles'].keys()):
            roads.append(add_tile(tm['tiles'][k], 24, 24, BASE_PAL, f'road_{name}#{k}'))
    terrain['road'] = roads

    # ore + gems (12 growth stages each, 4 shapes)
    ore = []
    for name in ['gold01', 'gold02', 'gold03', 'gold04']:
        shp = ShpFile(temperat.try_read(f'{name}.tem'))
        stages = []
        for fi in range(shp.image_count):
            img = frame_image(shp, fi, BASE_PAL)
            stages.append(packer.add(img, f'ore_{name}#{fi}'))
        ore.append(stages)
    terrain['ore'] = ore
    gems = []
    for name in ['gem01', 'gem02', 'gem03', 'gem04']:
        shp = ShpFile(temperat.try_read(f'{name}.tem'))
        stages = []
        for fi in range(shp.image_count):
            img = frame_image(shp, fi, BASE_PAL)
            stages.append(packer.add(img, f'gem_{name}#{fi}'))
        gems.append(stages)
    terrain['gem'] = gems

    # scorch + craters
    scorch = []
    for n in range(1, 7):
        shp = ShpFile(temperat.try_read(f'sc{n}.tem'))
        scorch.append(packer.add(frame_image(shp, 0, BASE_PAL), f'sc#{n}'))
    terrain['scorch'] = scorch
    craters = []
    for n in range(1, 7):
        shp = ShpFile(temperat.try_read(f'cr{n}.tem'))
        craters.append(packer.add(frame_image(shp, 0, BASE_PAL), f'cr#{n}'))
    terrain['crater'] = craters

    # move flash (RA's own move target flash)
    shp = ShpFile(temperat.try_read('moveflsh.tem'))
    mf = [packer.add(frame_image(shp, fi, BASE_PAL), f'moveflsh#{fi}') for fi in range(shp.image_count)]
    terrain['moveflsh'] = mf

    info = packer.finish()
    manifest['terrain'] = {'atlas': info, 'defs': terrain}

    # ============ WATER (animated: 4 palette-rotation variants) ============
    packer = Packer('water')
    water = {}
    # collect deep water + shore tiles from w/s/sh templates
    def rot_pal(base, rot):
        p = list(base)
        seg = p[62:73]
        for i in range(11):
            p[62 + i] = seg[(i + rot) % 11]
        return p

    w_templates = ['w1', 'w2']
    shore_templates = [f's{n:02d}' for n in range(1, 39)] + [f'sh{n:02d}' for n in range(1, 57)]

    def tile_water_frac(td):
        water_idx = set(range(62, 73))
        cnt = sum(1 for b in td if b in water_idx)
        return cnt / len(td)

    water_frames = []   # 4 variants of deep water
    w2 = parse_tmp_ra(temperat.try_read('w2.tem'))
    deep_tiles = [w2['tiles'][k] for k in sorted(w2['tiles'].keys())]
    w1 = parse_tmp_ra(temperat.try_read('w1.tem'))
    deep_tiles += [w1['tiles'][k] for k in sorted(w1['tiles'].keys())]
    for vi in range(4):
        pal = rot_pal(BASE_PAL, vi * 3)
        frames = []
        for k, td in enumerate(deep_tiles):
            img = tile_image(td, 24, 24, pal)
            frames.append(packer.add(img, f'deep#{vi}_{k}'))
        water_frames.append(frames)
    water['deep'] = water_frames

    # shore catalog: pattern -> frames (4 anim variants)
    shore_catalog = {}
    for name in shore_templates:
        try:
            tm = parse_tmp_ra(temperat.try_read(f'{name}.tem'))
        except Exception:
            continue
        for k, td in tm['tiles'].items():
            wf = tile_water_frac(td)
            if wf < 0.15 or wf > 0.85:
                continue  # pure land or pure water, skip
            # classify edges
            top = sum(1 for b in td[:24] if b in range(62, 73)) / 24
            bot = sum(1 for b in td[24*23:] if b in range(62, 73)) / 24
            left = sum(1 for i in range(24) if td[i*24] in range(62, 73)) / 24
            right = sum(1 for i in range(24) if td[i*24+23] in range(62, 73)) / 24
            key = (top > .5, right > .5, bot > .5, left > .5)
            frames = []
            for vi in range(4):
                pal = rot_pal(BASE_PAL, vi * 3)
                img = tile_image(td, 24, 24, pal)
                frames.append(packer.add(img, f'shore_{name}#{k}_{vi}'))
            shore_catalog.setdefault(key, []).append(frames)
    water['shore'] = {str(k): v for k, v in shore_catalog.items()}
    info = packer.finish()
    manifest['water'] = {'atlas': info, 'defs': water}
    print('shore patterns:', list(water['shore'].keys()))

    # ============ TREES (objects) ============
    packer = Packer('trees')
    trees = {}
    for name in TERRAIN_TREE_DEFS:
        data = temperat.try_read(f'{name}.tem')
        if not data:
            continue
        shp = ShpFile(data)
        entry = {'w': shp.width, 'h': shp.height, 'frames': []}
        for fi in range(shp.image_count):
            img = frame_image(shp, fi, BASE_PAL)
            idx = packer.add(img, f'tree_{name}#{fi}')
            entry['frames'].append(idx)
        trees[name] = entry
    bushes = {}
    for name in TERRAIN_BUSH_DEFS:
        data = temperat.try_read(f'{name}.tem')
        if not data:
            continue
        shp = ShpFile(data)
        entry = {'w': shp.width, 'h': shp.height, 'frames': []}
        for fi in range(shp.image_count):
            img = frame_image(shp, fi, BASE_PAL)
            idx = packer.add(img, f'bush_{name}#{fi}')
            entry['frames'].append(idx)
        bushes[name] = entry
    info = packer.finish()
    manifest['trees'] = {'atlas': info, 'defs': trees, 'bushes': bushes}

    with open(f'{OUT}/manifest.json', 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('manifest saved,', os.path.getsize(f'{OUT}/manifest.json') // 1024, 'KB')


if __name__ == '__main__':
    main()
