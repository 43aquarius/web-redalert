#!/usr/bin/env python3
"""Extract ore/gem overlays + walls from temperat.mix (overlay palette)."""
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


def main():
    tem = Mix2(f'{CDN}/temperat.mix')
    ui = Mix2(f'{CDN}/ui.mix')
    pal = Palette(ui.get('temperat.pal'))
    arr = np.zeros((256, 4), np.uint8)
    for i in range(256):
        arr[i] = pal.rgba(i)

    def render(shp, fi):
        fr = shp.frames[fi]
        if fr.w == 0 or fr.h == 0:
            return None
        W = max(shp.width, fr.x + fr.w)
        H = max(shp.height, fr.y + fr.h)
        canvas = np.zeros((H, W), np.uint8)
        a = np.frombuffer(fr.data, np.uint8).reshape(fr.h, fr.w)
        canvas[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w] = a
        rgba = arr[canvas.reshape(-1)].reshape(H, W, 4)
        return Image.fromarray(rgba.astype(np.uint8), 'RGBA')

    manifest = {}
    imgs = {}
    # ore: density stages (tib01..tib12 = growth 1..12; 13-20 variants)
    for stage, name in enumerate(('tib01', 'tib02', 'tib03', 'tib04', 'tib05', 'tib06',
                                   'tib07', 'tib08', 'tib09', 'tib10', 'tib11', 'tib12'), 1):
        d = tem.get(name + '.tem')
        if not d:
            continue
        shp = ShpFile(d)
        im = render(shp, 0)
        if im:
            imgs[f'ore{stage}'] = im
    # gems
    for stage, name in enumerate(('gem01', 'gem02', 'gem03', 'gem04', 'gem05', 'gem06',
                                   'gem07', 'gem08', 'gem09', 'gem10', 'gem11', 'gem12'), 1):
        d = tem.get(name + '.tem')
        if not d:
            continue
        shp = ShpFile(d)
        im = render(shp, 0)
        if im:
            imgs[f'gem{stage}'] = im
    # walls
    snow = Mix2(f'{CDN}/snow.mix')
    for name in ('gasand', 'gawall', 'nawall'):
        d = snow.get(name + '.shp')
        if d:
            shp = ShpFile(d)
            im = render(shp, 0)
            if im:
                imgs[name] = im

    items = sorted(imgs.items())
    cw = max(im.width for im in imgs.values())
    ch = max(im.height for im in imgs.values())
    ncols = 8
    nrows = (len(items) + ncols - 1) // ncols
    sheet = Image.new('RGBA', (ncols * cw, nrows * ch), (0, 0, 0, 0))
    pos = {}
    for i, (name, im) in enumerate(items):
        r, c = divmod(i, ncols)
        sheet.paste(im, (c * cw + (cw - im.width) // 2, r * ch + (ch - im.height) // 2), im)
        pos[name] = {'x': c * cw, 'y': r * ch, 'w': im.width, 'h': im.height}
    sheet.save(f'{OUT}/overlays.png', optimize=True)
    json.dump({'overlays': pos, 'cell': {'cw': cw, 'ch': ch}},
              open(f'{OUT}/ovl_manifest.json', 'w'))
    print(f'overlays: {len(items)} ({cw}x{ch} cells)')


if __name__ == '__main__':
    main()
