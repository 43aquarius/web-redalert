#!/usr/bin/env python3
"""Test render: tank voxels (32 facings), building SHP, terrain tile -> contact sheets."""
import os
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
import numpy as np
from PIL import Image

from mix2 import Mix2
from ra2lib import ShpFile, TmpFile, tmp_to_bitmap, Palette, VxlFile
from vxlrender import VxlRenderer

CDN = '/home/z/my-project/assets_raw2/cdn'
GAME = '/home/z/my-project/assets_raw2/gamefiles'
OUT = '/home/z/my-project/assets_raw2/preview'
os.makedirs(OUT, exist_ok=True)

mixes = {}
for fn in ['vxl.mix', 'ui.mix', 'snow.mix', 'isotemp.mix', 'temperat.mix', 'cameo.mix', 'anims.mix']:
    mixes[fn] = Mix2(os.path.join(CDN, fn))

unittem = Palette(mixes['ui.mix'].get('unittem.pal'))
isotem = Palette(mixes['ui.mix'].get('isotem.pal'))


def pal_image(idx_arr, shade_arr, pal, team=None):
    h, w = idx_arr.shape
    p = pal.remap_team(team) if team else pal
    out = np.zeros((h, w, 4), np.uint8)
    colors = np.array([p.rgba(i) for i in range(256)], np.uint8)
    flat = idx_arr.flatten()
    sh = shade_arr.flatten() if shade_arr is not None else np.ones(len(flat))
    rgb = colors[flat, :3].astype(np.float32)
    rgb = (rgb * (sh[:, None] * 0.55 + 0.45)).clip(0, 255).astype(np.uint8)
    out[..., :3] = rgb.reshape(h, w, 3)
    out[..., 3] = (flat != 0).reshape(h, w) * 255
    return Image.fromarray(out, 'RGBA')


# ---- 1. tank voxels: mtnk (Apocalypse body) + turret + barrel ----
vxl_data = mixes['vxl.mix'].get('mtnk.vxl')
vxl = VxlFile(vxl_data)
print('mtnk.vxl sections:', [(s.name, s.sizeX, s.sizeY, s.sizeZ, len(s.voxels)) for s in vxl.sections])
tur_data = mixes['vxl.mix'].get('mtnktur.vxl')
tur = VxlFile(tur_data) if tur_data else None
if tur:
    print('mtnktur sections:', [(s.name, s.sizeX, s.sizeY, s.sizeZ, len(s.voxels)) for s in tur.sections])

body = vxl.sections[0]
r = VxlRenderer(body, scale=1.0)
# render facing 0 and a few others into a contact sheet
facings = 32
sheet_w = 8
frames = []
for f in range(8):  # first 8 facings
    w, h, idx, shade = r.render(f * 360.0 / facings)
    im = pal_image(idx, shade, unittem, team=(0, 0, 255))
    frames.append(im)
cw = max(f.width for f in frames) + 4
ch = max(f.height for f in frames) + 4
sheet = Image.new('RGBA', (cw * 8, ch), (40, 40, 40, 255))
for i, f in enumerate(frames):
    sheet.paste(f, (i * cw + (cw - f.width) // 2, (ch - f.height) // 2), f)
sheet.save(os.path.join(OUT, 'test_mtnk.png'))
print('mtnk frame size:', frames[0].size, '-> test_mtnk.png')

# turret at some facings
if tur:
    tsec = tur.sections[0]
    rt = VxlRenderer(tsec, scale=1.0)
    tframes = []
    for f in range(8):
        w, h, idx, shade = rt.render(f * 360.0 / facings)
        tframes.append(pal_image(idx, shade, unittem, team=(0, 0, 255)))
    tw = max(f.width for f in tframes) + 4
    th = max(f.height for f in tframes) + 4
    tsheet = Image.new('RGBA', (tw * 8, th), (40, 40, 40, 255))
    for i, f in enumerate(tframes):
        tsheet.paste(f, (i * tw + (tw - f.width) // 2, (th - f.height) // 2), f)
    tsheet.save(os.path.join(OUT, 'test_mtnktur.png'))
    print('mtnktur frame size:', tframes[0].size, '-> test_mtnktur.png')

# grizzly (gtnk) facing 0
gtnk = VxlFile(mixes['vxl.mix'].get('gtnk.vxl'))
print('gtnk sections:', [(s.name, s.sizeX, s.sizeY, s.sizeZ, len(s.voxels)) for s in gtnk.sections])
rg = VxlRenderer(gtnk.sections[0], scale=1.0)
w, h, idx, shade = rg.render(0)
pal_image(idx, shade, unittem, team=(255, 0, 0)).save(os.path.join(OUT, 'test_gtnk_f0.png'))
print('gtnk f0 size:', (w, h))

# ---- 2. building SHP: gapile with different palettes ----
shp = ShpFile(mixes['snow.mix'].get('gapile.shp'))
print('gapile.shp frames:', len(shp.frames), 'size:', shp.width, 'x', shp.height)
for pname, pal in [('unittem', unittem), ('isotem', isotem)]:
    frames = []
    for fr in shp.frames[:6]:
        if fr.w == 0:
            continue
        arr = np.frombuffer(fr.data, np.uint8).reshape(fr.h, fr.w).copy()
        # place at offset
        canvas = np.zeros((shp.height, shp.width), np.uint8)
        canvas[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w] = arr
        im = pal_image(canvas, None, pal)
        frames.append(im)
    if frames:
        cw = max(f.width for f in frames)
        chh = max(f.height for f in frames)
        sheet = Image.new('RGBA', (cw * len(frames), chh), (40, 40, 40, 255))
        for i, f in enumerate(frames):
            sheet.paste(f, (i * cw, 0), f)
        sheet.save(os.path.join(OUT, f'test_gapile_{pname}.png'))
        print(f'gapile {pname} -> {len(frames)} frames')

# ---- 3. terrain tile: clear01 + grass + water ----
for tile in ['clear01.tem', 'grass01.tem', 'water01.tem', 'water03.tem', 'shore01.tem', 'clif01.tem']:
    d = mixes['isotemp.mix'].get(tile)
    if not d:
        print('tile missing:', tile)
        continue
    tmp = TmpFile(d)
    img = tmp.images[0] if tmp.images else None
    if not img or not img.tile_data:
        print('tile no data:', tile)
        continue
    idx, z = tmp_to_bitmap(img)
    arr = np.frombuffer(idx, np.uint8).reshape(30, 60)
    im = pal_image(arr, None, isotem)
    im = im.resize((120, 60), Image.NEAREST)
    im.save(os.path.join(OUT, f'test_{tile.replace(".", "_")}.png'))
    print(f'{tile}: flags={img.flags:#x} height={img.height} terrain={img.terrain_type} radar={img.radar_left}')

print('DONE -> ', OUT)
