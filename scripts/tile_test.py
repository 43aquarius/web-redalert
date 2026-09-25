#!/usr/bin/env python3
"""Test tile tessellation: render a 4x4 grid of clear tiles + single tiles."""
import os
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
import numpy as np
from PIL import Image

from mix2 import Mix2
from ra2lib import TmpFile, tmp_to_bitmap, Palette

CDN = '/home/z/my-project/assets_raw2/cdn'
OUT = '/home/z/my-project/assets_raw2/preview'
iso = Mix2(os.path.join(CDN, 'isotemp.mix'))
isotem = Palette(Mix2(os.path.join(CDN, 'ui.mix')).get('isotem.pal'))


def tile_img(name, scale=2):
    d = iso.get(name)
    tmp = TmpFile(d)
    img = tmp.images[0]
    idx, z = tmp_to_bitmap(img)
    arr = np.frombuffer(idx, np.uint8).reshape(30, 60)
    colors = np.array([isotem.rgba(i) for i in range(256)], np.uint8)
    rgba = colors[arr]
    im = Image.fromarray(rgba, 'RGBA')
    if scale != 1:
        im = im.resize((60 * scale, 30 * scale), Image.NEAREST)
    return im, img


# single tiles
for name in ['clear01.tem', 'water01.tem', 'shore01.tem']:
    im, img = tile_img(name)
    im.save(os.path.join(OUT, f'single_{name.replace(".", "_")}.png'))
    print(name, 'saved')

# 4x4 tessellated grid (2:1 iso offsets)
grid_w, grid_h = 4, 4
TW, TH = 60, 30
canvas = Image.new('RGBA', ((grid_w + grid_h) * TW // 2 + TW, grid_h * TH // 2 + TH + 10), (0, 0, 0, 0))
for j in range(grid_h):
    for i in range(grid_w):
        im, _ = tile_img('clear01.tem', 1)
        px = (i - j) * (TW // 2)
        py = (i + j) * (TH // 2)
        canvas.paste(im, (px + TW // 2, py), im)
canvas = canvas.resize((canvas.width * 2, canvas.height * 2), Image.NEAREST)
canvas.save(os.path.join(OUT, 'tessellation.png'))
print('tessellation saved')
