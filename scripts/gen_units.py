#!/usr/bin/env python3
"""Generate unit sprite atlases from RA2 VXL voxels.

Pipeline: render_idx_shade (z-buffer, splat=2, scale=2) once per facing
-> 2x box downsample (alpha-weighted) -> colorize per team palette -> atlas.

Outputs: /home/z/my-project/assets_ra2/units_<color>.png + units_manifest.json
"""
import sys
import os
import json

import numpy as np
from PIL import Image

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2
from ra2lib import Palette, VxlFile
from vxlrender import VxlRenderer

CDN = '/home/z/my-project/assets_raw2/cdn'
OUT = '/home/z/my-project/assets_ra2'
os.makedirs(OUT, exist_ok=True)

FACINGS = 32

UNITS = {
    # Allied
    'MTNK':  ('gtnk', 'gtnktur', 0),
    'MGTK':  ('rtnk', 'rtnktur', 0),
    'FV':    ('fv',   'fvtur',   0),
    'SREF':  ('sref', 'sreftur', 0),
    'TNKD':  ('tnkd', None,      0),
    'CMIN':  ('cmin', None,      0),
    'AMCV':  ('mcv',  None,      0),
    'SHAD':  ('shad', None,      50),
    # Soviet
    'HTNK':  ('htnk', 'htnktur', 0),
    'APOC':  ('mtnk', 'mtnktur', 0),
    'TTNK':  ('ttnk', 'ttnktur', 0),
    'V3':    ('v3',   None,      0),
    'HTK':   ('htk',  'htktur',  -80),
    'HARV':  ('harv', 'harvtur', 50),
    'SMCV':  ('smcv', None,      0),
    'DTRUCK':('trucka', None,    0),
    'ZEP':   ('zep',  None,      0),
}

TEAM_COLORS = {
    'blue':  (60, 90, 255),
    'red':   (255, 45, 35),
    'yellow': (250, 215, 40),
    'green': (60, 210, 90),
    'grey':  (150, 150, 155),
}


def build_palettes():
    ui = Mix2(f'{CDN}/ui.mix')
    pal = Palette(ui.get('unittem.pal'))
    out = {}
    for name, rgb in TEAM_COLORS.items():
        p = pal.remap_team(rgb)
        arr = np.zeros((256, 4), np.uint8)
        for i in range(256):
            arr[i] = p.rgba(i)
        out[name] = arr.astype(np.float32)
    return out


def render_raw(vxl_mix, image, facings=FACINGS):
    """Render (w,h,idx,shade) frames at 2x with splat coverage."""
    data = vxl_mix.get(image + '.vxl')
    if not data:
        return None
    vxl = VxlFile(data)
    if not vxl.sections:
        return None
    r = VxlRenderer(vxl.sections[0], scale=2.0)
    frames = []
    for f in range(facings):
        frames.append(r.render_idx_shade(f * 360.0 / facings, pad=4, splat=2))
    return frames


def downsample_frames(frames):
    """2x box downsample: returns per-frame (W,H, colorIdx float + coverage alpha
    + shade) packed as arrays: idx uint8 (H,W), alpha float (H,W), shade float (H,W)."""
    out = []
    for (w, h, idx, shade) in frames:
        w2, h2 = w - (w % 2), h - (h % 2)
        idx = idx[:h2, :w2]
        shade = shade[:h2, :w2]
        H, W = h2 // 2, w2 // 2
        # index: pick first nonzero idx in 2x2 cell
        idx4 = idx.reshape(H, W, 2, 2)  # (H, W, dy, dx)
        a4 = (idx4 != 0).astype(np.int32)
        pick = np.where(a4[..., 0, 0] > 0, idx4[..., 0, 0],
               np.where(a4[..., 0, 1] > 0, idx4[..., 0, 1],
               np.where(a4[..., 1, 0] > 0, idx4[..., 1, 0], idx4[..., 1, 1])))
        pick = pick.astype(np.uint8)
        # shade: average over opaque subpixels
        sh4 = (shade.reshape(H, W, 2, 2) * a4).sum(axis=(2, 3))
        cnt = a4.sum(axis=(2, 3))
        sh = np.where(cnt > 0, sh4 / np.maximum(cnt, 1), 0)
        alpha = a4.astype(np.float32).mean(axis=(2, 3))
        out.append((W, H, pick, sh, alpha))
    return out


def colorize(frames, pal_arr):
    """frames: [(W,H,idx,shade,alpha)] -> PIL RGBA images."""
    imgs = []
    for (W, H, idx, sh, alpha) in frames:
        colors = pal_arr[idx.reshape(-1)]  # (N,4)
        shv = (sh.reshape(-1) * 0.62 + 0.38)[:, None]
        colors = colors.copy()
        colors[:, :3] = np.clip(colors[:, :3] * shv, 0, 255)
        rgba = np.zeros((H, W, 4), np.uint8)
        rgba[..., :3] = colors.reshape(H, W, 4)[..., :3]
        rgba[..., 3] = (alpha * 255).astype(np.uint8)
        imgs.append(Image.fromarray(rgba, 'RGBA'))
    return imgs


def pack_row(images):
    """Pack frames horizontally, cell = max size; returns sheet, positions, cw, ch."""
    cw = max(im.width for im in images)
    ch = max(im.height for im in images)
    sheet = Image.new('RGBA', (cw * len(images), ch), (0, 0, 0, 0))
    pos = []
    for i, im in enumerate(images):
        x = i * cw + (cw - im.width) // 2
        y = (ch - im.height) // 2
        sheet.paste(im, (x, y), im)
        pos.append({'x': x, 'y': y, 'w': im.width, 'h': im.height})
    return sheet, pos, cw, ch


def main():
    vxl_mix = Mix2(f'{CDN}/vxl.mix')
    pals = build_palettes()

    raw = {}
    for uid, (image, turret, toff) in UNITS.items():
        body = render_raw(vxl_mix, image)
        if body is None:
            print(f'!! missing vxl {uid} ({image})')
            continue
        entry = {'body': downsample_frames(body)}
        if turret:
            tdata = vxl_mix.get(turret + '.vxl')
            if tdata:
                entry['turret'] = downsample_frames(render_raw(vxl_mix, turret))
        raw[uid] = entry
        print(f'{uid}: {image} ok')

    manifest = {'facings': FACINGS, 'units': {}}
    for color, pal_arr in pals.items():
        rows = []
        y = 0
        sheet_w = 0
        for uid, entry in raw.items():
            bimgs = colorize(entry['body'], pal_arr)
            bs, bpos, bcw, bch = pack_row(bimgs)
            m = {'body': {'x': 0, 'y': y, 'cw': bcw, 'ch': bch, 'frames': bpos}}
            rows.append((bs, y))
            y += bch
            sheet_w = max(sheet_w, bs.width)
            if 'turret' in entry:
                timgs = colorize(entry['turret'], pal_arr)
                ts, tpos, tcw, tch = pack_row(timgs)
                m['turret'] = {'x': 0, 'y': y, 'cw': tcw, 'ch': tch, 'frames': tpos}
                rows.append((ts, y))
                y += tch
                sheet_w = max(sheet_w, ts.width)
            if color == 'blue':
                manifest['units'][uid] = m
        sheet = Image.new('RGBA', (sheet_w, y), (0, 0, 0, 0))
        for img, ry in rows:
            sheet.paste(img, (0, ry), img)
        out = f'{OUT}/units_{color}.png'
        sheet.save(out, optimize=True)
        print(f'atlas {color}: {sheet.width}x{sheet.height} -> {out}')

    for uid, (image, turret, toff) in UNITS.items():
        if uid in manifest['units'] and toff:
            manifest['units'][uid]['turretOffsetPx'] = round(toff * (60.0 / 256.0), 2)
    json.dump(manifest, open(f'{OUT}/units_manifest.json', 'w'))
    print('manifest saved')


if __name__ == '__main__':
    main()
