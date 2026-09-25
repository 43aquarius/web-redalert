#!/usr/bin/env python3
"""Generate infantry sprite sheets + cameo icons from RA2 SHP files.

Infantry layout per unit: stand(8) walk(8xWF) fire(8) die(2)
Sequence offsets from art.ini [xxxSequence] sections.
"""
import sys
import os
import json

import numpy as np
from PIL import Image

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2
from ra2lib import ShpFile, Palette

CDN = '/home/z/my-project/assets_raw2/cdn'
OUT = '/home/z/my-project/assets_ra2'
os.makedirs(OUT, exist_ok=True)

# unit: (shp, sequence section)
INFANTRY = {
    'GI':       ('gi.shp', 'GISequence'),
    'E2':       ('cons.shp', 'ConSequence'),
    'ENGINEER': ('engineer.shp', 'EngineerSequence'),
    'DOG':      ('dog.shp', 'DogSequence'),
    'TANY':     ('tany.shp', 'TanyaSequence'),
    'SHK':      ('shk.shp', 'ConSequence'),
    'IVAN':     ('ivan.shp', 'IvanSequence'),
    'DESO':     ('deso.shp', 'DesoSequence'),
    'YURI':     ('yuri.shp', 'YuriSequence'),
    'CLEG':     ('cleg.shp', 'ClegSequence'),
    'SPY':      ('spy.shp', 'SpySequence'),
    'GHOST':    ('seal.shp', 'SealSequence'),
    'DRON':     ('dron.shp', None),
}

CAMEOS = {
    'GI': 'GIICON', 'E2': 'E2ICON', 'ENGINEER': 'ENGNICON', 'DOG': 'DOGICON',
    'TANY': 'TANYICON', 'SHK': 'SHKICON', 'IVAN': 'IVANICON', 'DESO': 'DESOICON',
    'YURI': 'YURIICON', 'CLEG': 'CLEGICON', 'SPY': 'SPYICON', 'GHOST': 'SEALICON',
    'DRON': 'DRONICON',
    # vehicles
    'MTNK': 'GTNKICON', 'MGTK': 'MIRAGEICON2?', 'FV': 'FVICON', 'SREF': 'SREFICON',
    'TNKD': 'TNKDICON', 'CMIN': 'AHRVICON', 'AMCV': 'MCVICON', 'SHAD': 'SHADICON',
    'HTNK': 'HTNKICON', 'APOC': 'MTNKICON', 'TTNK': 'TTNKICON', 'V3': 'V3ICON',
    'HTK': 'HTKICON', 'HARV': 'HARVICON', 'SMCV': 'SMCVICON', 'DTRUCK': 'DTRUCKICON',
    'ZEP': 'ZEPICON',
}


def parse_art_sequences():
    txt = open('/home/z/my-project/assets_raw2/extracted/art.ini', encoding='latin-1').read()
    secs = {}
    cur = None
    for ln in txt.splitlines():
        ln = ln.split(';')[0].strip()
        if ln.startswith('[') and ln.endswith(']'):
            cur = ln[1:-1]
            secs[cur] = {}
        elif cur and '=' in ln:
            k, v = ln.split('=', 1)
            secs[cur][k.strip()] = v.strip()
    return secs


def seq_parse(v):
    """'8,6,6' -> (start, framesPerFacing)"""
    parts = v.split(',')
    start = int(parts[0])
    per = int(parts[1]) if len(parts) > 1 else 1
    return start, per


def frame_to_pil(shp, frame_idx, pal_arr, team=None):
    """Render SHP frame onto canvas -> RGBA PIL."""
    if frame_idx >= len(shp.frames):
        return None
    fr = shp.frames[frame_idx]
    if fr.w == 0 or fr.h == 0:
        return None
    W = max(shp.width, fr.x + fr.w)
    H = max(shp.height, fr.y + fr.h)
    canvas = np.zeros((H, W), np.uint8)
    arr = np.frombuffer(fr.data, np.uint8).reshape(fr.h, fr.w)
    canvas[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w] = arr
    colors = pal_arr
    if team is not None:
        colors = colors.copy()
        colors[16:32] = team
    rgba = colors[canvas.reshape(-1)].reshape(H, W, 4)
    return Image.fromarray(rgba.astype(np.uint8), 'RGBA')


def main():
    anims = Mix2(f'{CDN}/anims.mix')
    cameo_mix = Mix2(f'{CDN}/cameo.mix')
    ui = Mix2(f'{CDN}/ui.mix')
    pal = Palette(ui.get('unittem.pal'))
    pal_arr = np.zeros((256, 4), np.uint8)
    for i in range(256):
        pal_arr[i] = pal.rgba(i)

    art = parse_art_sequences()
    manifest = {}

    # ---- infantry sheets ----
    for uid, (shp_name, seq_name) in INFANTRY.items():
        data = anims.get(shp_name)
        if not data:
            print('missing', shp_name)
            continue
        shp = ShpFile(data)
        seq = art.get(seq_name, {}) if seq_name else {}
        # walk config
        if 'Walk' in seq:
            walk_start, walk_per = seq_parse(seq['Walk'])
        else:
            walk_start, walk_per = 8, 6  # default TS layout
        if 'Ready' in seq:
            ready_start, ready_per = seq_parse(seq['Ready'])
        else:
            ready_start, ready_per = 0, 1
        if 'FireUp' in seq:
            fire_start, fire_per = seq_parse(seq['FireUp'])
        else:
            fire_start, fire_per = walk_start + walk_per * 8, 1
        die_start = None
        if 'Die1' in seq:
            die_start, _ = seq_parse(seq['Die1'])

        CW, CH = shp.width, shp.height
        cols = 8
        rows_plan = []
        frames = []
        # stand: 8 facings
        for f in range(8):
            im = frame_to_pil(shp, ready_start + f * ready_per, pal_arr)
            if im:
                frames.append(im)
        stand_n = len(frames)
        # walk: 8 facings x walk_per
        for f in range(8):
            for k in range(walk_per):
                im = frame_to_pil(shp, walk_start + f * walk_per + k, pal_arr)
                if im:
                    frames.append(im)
        walk_n = len(frames) - stand_n
        # fire: 8 facings, frame 0
        for f in range(8):
            im = frame_to_pil(shp, fire_start + f * fire_per, pal_arr)
            if im:
                frames.append(im)
        fire_n = len(frames) - stand_n - walk_n
        # die: 2 frames (facing 0)
        if die_start is not None:
            for k in range(2):
                im = frame_to_pil(shp, die_start + k, pal_arr)
                if im:
                    frames.append(im)
        die_n = len(frames) - stand_n - walk_n - fire_n

        total = len(frames)
        ncols = 8
        nrows = (total + ncols - 1) // ncols
        sheet = Image.new('RGBA', (ncols * CW, nrows * CH), (0, 0, 0, 0))
        for i, im in enumerate(frames):
            r, c = divmod(i, ncols)
            sheet.paste(im, (c * CW, r * CH), im)
        sheet.save(f'{OUT}/inf_{uid}.png', optimize=True)
        manifest[uid] = {
            'cw': CW, 'ch': CH, 'cols': ncols,
            'stand': {'start': 0, 'count': stand_n},
            'walk': {'start': stand_n, 'count': walk_n, 'per': walk_per},
            'fire': {'start': stand_n + walk_n, 'count': fire_n},
            'die': {'start': stand_n + walk_n + fire_n, 'count': die_n},
        }
        print(f'{uid}: {shp_name} total {total}f (stand {stand_n} walk {walk_n} fire {fire_n} die {die_n})')

    # ---- cameos ----
    cameo_files = {}
    for uid, icon in CAMEOS.items():
        if icon.endswith('?'):
            continue
        name = icon.lower() + '.shp'
        d = cameo_mix.get(name)
        if d is None:
            # try sidec01/02
            print('cameo missing:', name)
            continue
        s = ShpFile(d)
        im = frame_to_pil(s, 0, pal_arr)
        if im:
            cameo_files[uid] = im
    # pack cameo atlas 8 per row
    cw = max(im.width for im in cameo_files.values())
    ch = max(im.height for im in cameo_files.values())
    ncols = 8
    items = sorted(cameo_files.items())
    nrows = (len(items) + ncols - 1) // ncols
    sheet = Image.new('RGBA', (ncols * cw, nrows * ch), (0, 0, 0, 0))
    cameo_pos = {}
    for i, (uid, im) in enumerate(items):
        r, c = divmod(i, ncols)
        sheet.paste(im, (c * cw + (cw - im.width) // 2, r * ch + (ch - im.height) // 2), im)
        cameo_pos[uid] = {'x': c * cw, 'y': r * ch, 'w': im.width, 'h': im.height}
    sheet.save(f'{OUT}/cameos.png', optimize=True)
    json.dump({'infantry': manifest, 'cameos': cameo_pos, 'cameoCell': {'cw': cw, 'ch': ch}},
              open(f'{OUT}/inf_manifest.json', 'w'))
    print(f'cameos: {len(cameo_files)} icons {cw}x{ch} -> cameos.png')


if __name__ == '__main__':
    main()
