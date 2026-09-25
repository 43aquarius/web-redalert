#!/usr/bin/env python3
"""Generate building sprites + terrain tiles from RA2 SHP/TMP files.

Buildings: idle frame (frame 0) + up to N anim frames from theater mix.
Terrain: iso tiles 60x30 from isotemp.mix -> tile atlas.
"""
import sys
import os
import json

import numpy as np
from PIL import Image

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2
from ra2lib import ShpFile, TmpFile, tmp_to_bitmap, Palette

CDN = '/home/z/my-project/assets_raw2/cdn'
OUT = '/home/z/my-project/assets_ra2'
os.makedirs(OUT, exist_ok=True)

BUILDINGS = {
    # Allied
    'GACNST': ('gacnst', 2),   # conyard (anim)
    'GAPOWR': ('gapowr', 4),   # power plant (rotor anim)
    'GAREFN': ('garefn', 1),
    'GAPILE': ('gapile', 1),
    'GAWEAP': ('gaweap', 1),
    'GAAIRC': ('gaairc', 2),   # airforce hq radar anim
    'GATECH': ('gatech', 1),
    'GAPILL': ('gapill', 1),   # pillbox
    'NASAM':  ('nasam', 1),    # patriot
    'ATESLA': ('gapris', 1),   # prism tower
    'GADEPT': ('gadept', 1),
    'GAWALL': ('gawall', 1),
    'GACSPH': ('gacsph', 2),   # chronosphere
        # Soviet
    'NACNST': ('nacnst', 2),
    'NAPOW':  ('napowr', 1),
    'NAREFN': ('narefn', 1),
    'NAHAND': ('nahand', 1),
    'NAWEAP': ('naweap', 1),
    'NARADR': ('naradr', 2),   # radar anim
    'NALASR': ('nalasr', 1),   # sentry gun
    'TESLA':  ('natsla', 2),   # tesla coil (anim frames)
    'NADEPT': ('nadept', 1),
    'NAIRON': ('nairon', 2),   # iron curtain
    'NAMISL': ('namisl', 2),   # nuclear silo
    }

TERRAIN_TILES = []
TERRAIN_TILES.append('clear01')
TERRAIN_TILES.append('ruff01')
TERRAIN_TILES.append('sandy01')
TERRAIN_TILES.append('green01')
TERRAIN_TILES.append('pvclr01')
for i in range(1, 15):
    TERRAIN_TILES.append(f'water{i:02d}')
for i in range(1, 43):
    TERRAIN_TILES.append(f'shore{i:02d}')
for i in range(1, 43):
    TERRAIN_TILES.append(f'cliff{i:02d}')
for i in range(1, 11):
    TERRAIN_TILES.append(f'ramp{i:02d}')
for i in range(1, 15):
    TERRAIN_TILES.append(f'pave{i:02d}')
for base in ('clat', 'dlat', 'glat', 'plat'):
    for i in range(1, 17):
        TERRAIN_TILES.append(f'{base}{i:02d}')


def shp_frames_pil(shp, pal_arr, indices):
    out = []
    for fi in indices:
        if fi >= len(shp.frames):
            continue
        fr = shp.frames[fi]
        if fr.w == 0 or fr.h == 0:
            continue
        W = max(shp.width, fr.x + fr.w)
        H = max(shp.height, fr.y + fr.h)
        canvas = np.zeros((H, W), np.uint8)
        arr = np.frombuffer(fr.data, np.uint8).reshape(fr.h, fr.w)
        canvas[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w] = arr
        rgba = pal_arr[canvas.reshape(-1)].reshape(H, W, 4)
        out.append(Image.fromarray(rgba.astype(np.uint8), 'RGBA'))
    return out


def main():
    buildings_mix = Mix2(f'{CDN}/snow.mix')  # building SHPs are theater-generic
    isotemp = Mix2(f'{CDN}/isotemp.mix')
    ui = Mix2(f'{CDN}/ui.mix')
    isopal = Palette(ui.get('isotem.pal'))
    iso_arr = np.zeros((256, 4), np.uint8)
    for i in range(256):
        iso_arr[i] = isopal.rgba(i)

    unitpal = Palette(ui.get('unittem.pal'))
    unit_arr = np.zeros((256, 4), np.uint8)
    for i in range(256):
        unit_arr[i] = unitpal.rgba(i)
    UNIT_PAL_BUILDINGS = {'TESLA', 'ATESLA', 'NASAM'}  # glowing defense structures

    manifest = {}
    for uid, (image, nframes) in BUILDINGS.items():
        data = buildings_mix.get(image + '.shp')
        if not data:
            print('missing building shp:', image)
            continue
        shp = ShpFile(data)
        idxs = list(range(min(nframes, len(shp.frames))))
        pal_arr = unit_arr if uid in UNIT_PAL_BUILDINGS else iso_arr
        imgs = shp_frames_pil(shp, pal_arr, idxs)
        if not imgs:
            continue
        W = imgs[0].width
        H = imgs[0].height
        sheet = Image.new('RGBA', (W * len(imgs), H), (0, 0, 0, 0))
        for i, im in enumerate(imgs):
            sheet.paste(im, (i * W, 0), im)
        sheet.save(f'{OUT}/bld_{uid}.png', optimize=True)
        manifest[uid] = {'w': W, 'h': H, 'frames': len(imgs)}
        print(f'{uid}: {image} {W}x{H} x{len(imgs)}')

    # ---- terrain tiles ----
    tile_imgs = {}
    for name in TERRAIN_TILES:
        data = isotemp.get(name + '.tem')
        if not data:
            continue
        tmp = TmpFile(data)
        for ti, img in enumerate(tmp.images):
            if img is None or not img.tile_data:
                continue
            idx, z = tmp_to_bitmap(img)
            if z is None:
                z = b'\x00' * len(idx)
            arr = np.frombuffer(idx, np.uint8).reshape(30, 60)
            rgba = iso_arr[arr.reshape(-1)].reshape(30, 60, 4)
            tile_imgs[f'{name}_{ti}'] = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
            break  # first variant only
    # pack tiles into grid 8 cols
    items = sorted(tile_imgs.items())
    ncols = 8
    nrows = (len(items) + ncols - 1) // ncols
    sheet = Image.new('RGBA', (ncols * 60, nrows * 30), (0, 0, 0, 0))
    tpos = {}
    for i, (name, im) in enumerate(items):
        r, c = divmod(i, ncols)
        sheet.paste(im, (c * 60, r * 30), im)
        tpos[name] = {'x': c * 60, 'y': r * 30}
    sheet.save(f'{OUT}/terrain.png', optimize=True)
    json.dump({'buildings': manifest, 'terrain': tpos},
              open(f'{OUT}/bld_manifest.json', 'w'))
    print(f'terrain: {len(items)} tiles -> terrain.png')


if __name__ == '__main__':
    main()
