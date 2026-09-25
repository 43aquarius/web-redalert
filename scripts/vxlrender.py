#!/usr/bin/env python3
"""VXL voxel renderer -> 2D sprites (32 facings), RA2-exact projection.

RA2 camera: alpha=30deg pitch, beta=45deg yaw (orthographic).
Screen: tile = 60x30 px. 1 voxel unit ~= 1 px at scale=1 (calibrated).
"""
import math
import numpy as np

from ra2lib import load_normals

NORMAL_TABLES = load_normals()

# RA2 camera constants
COS_B = math.cos(math.pi / 4)      # 0.7071
SIN_A = math.sin(math.pi / 6)      # 0.5
COS_A = math.cos(math.pi / 6)      # 0.8660
# projection coefficients
PX = COS_B                        # sx = (rx - ry) * PX
PY = COS_B * SIN_A                # sy = (rx + ry) * PY - rz * COS_A
DZ = COS_B * COS_A                # depth = (rx + ry) * DZ + rz * SIN_A


def _get_normals_table(mode):
    key = {1: 'normals1', 2: 'normals2', 3: 'normals3', 4: 'normals4'}.get(mode, 'normals1')
    return np.array(NORMAL_TABLES[key], dtype=np.float32)


class HvaFile:
    def __init__(self, data: bytes):
        import struct
        self.frames = 0
        self.sections = []
        if len(data) < 24:
            return
        self.frames, nsec = struct.unpack_from('<ii', data, 16)
        pos = 24
        names = []
        for i in range(nsec):
            names.append(data[pos:pos + 16].split(b'\x00')[0].decode('ascii', 'ignore'))
            pos += 16
        mats = []
        for f in range(self.frames):
            for s in range(nsec):
                m = struct.unpack_from('<12f', data, pos)
                # row-major 3x4; transpose to 4x4 column-major like three.js
                mat = np.array([
                    [m[0], m[4], m[8], 0],
                    [m[1], m[5], m[9], 0],
                    [m[2], m[6], m[10], 0],
                    [m[3], m[7], m[11], 1],
                ], dtype=np.float32)
                mats.append(mat)
                pos += 48
        # sections[s].mats[f]
        for s, n in enumerate(names):
            self.sections.append({'name': n, 'mats': [mats[f * nsec + s] for f in range(self.frames)]})

    def matrix(self, sec_idx, frame=0):
        if sec_idx < len(self.sections):
            return self.sections[sec_idx]['mats'][frame]
        return np.eye(4, dtype=np.float32)


class VxlRenderer:
    """Renders a VXL section at given yaw with RA2 isometric projection."""

    def __init__(self, section, scale=1.0, hva=None, hva_mult=0.5,
                 light=(-0.4, -0.6, 0.69), ambient=0.55):
        self.sec = section
        self.scale = scale
        self.light = np.array(light, dtype=np.float32)
        self.light /= np.linalg.norm(self.light)
        self.ambient = ambient
        vox = np.array(section.voxels, dtype=np.int32)  # N x 5
        if len(vox) == 0:
            self.empty = True
            return
        self.empty = False
        # apply HVA frame matrix if provided (translation * hva_mult)
        if hva is not None:
            m = hva
            t = m[:3, 3] * hva_mult
            r = m[:3, :3]
            # rotation applied to voxel offsets (from section center)
            cx, cy, cz = section.sizeX / 2.0, section.sizeY / 2.0, section.sizeZ / 2.0
            vxyz = vox[:, :3].astype(np.float32) - np.array([cx, cy, cz], np.float32)
            vxyz = vxyz @ r.T + t + np.array([cx, cy, cz], np.float32)
        else:
            vxyz = vox[:, :3].astype(np.float32)
        self.vx = vxyz[:, 0]
        self.vy = vxyz[:, 1]
        self.vz = vxyz[:, 2]
        self.vc = vox[:, 3].astype(np.int32)
        self.normals = _get_normals_table(section.normalsMode)
        self.vn = np.clip(vox[:, 4].astype(np.int32), 0, len(self.normals) - 1)
        self.cx = section.sizeX / 2.0
        self.cy = section.sizeY / 2.0

    def render(self, yaw_deg, out_w=None, out_h=None, pad=2):
        """Returns (w, h, index_array uint8, shade_array float 0..1)."""
        if self.empty:
            return 1, 1, np.zeros(1, np.uint8), np.ones(1, np.float32)
        s = self.scale
        th = math.radians(yaw_deg)
        c, si = math.cos(th), math.sin(th)
        # rotate in map plane (RA2 yaw: 0 = facing north/east-x?)
        rx = (self.vx - self.cx) * c + (self.vy - self.cy) * si
        ry = -(self.vx - self.cx) * si + (self.vy - self.cy) * c
        rz = self.vz
        # screen coords (RA2 alpha=30, beta=45)
        sx = (rx - ry) * PX * s
        sy = ((rx + ry) * PY - rz * COS_A) * s
        # light: rotate normals by same yaw
        nx = self.normals[self.vn, 0]
        ny = self.normals[self.vn, 1]
        nz = self.normals[self.vn, 2]
        rnx = nx * c + ny * si
        rny = -nx * si + ny * c
        dot = rnx * self.light[0] + rny * self.light[1] + nz * self.light[2]
        shade = self.ambient + (1 - self.ambient) * np.clip(dot, 0, 1)
        # painter depth: far -> near
        depth = (rx + ry) * DZ + rz * SIN_A
        order = np.argsort(depth)
        # target size
        if out_w is None:
            minx, maxx = sx.min(), sx.max()
            miny, maxy = sy.min(), sy.max()
            out_w = int(math.ceil(maxx - minx)) + 1 + pad * 2
            out_h = int(math.ceil(maxy - miny)) + 1 + pad * 2
            ox, oy = -minx + pad, -miny + pad
        else:
            ox = out_w / 2.0
            oy = out_h / 2.0
        idx_img = np.zeros((out_h, out_w), np.uint8)
        shade_img = np.zeros((out_h, out_w), np.float32)
        px = (sx + ox).astype(np.int32)
        py = (sy + oy).astype(np.int32)
        sel = (px >= 0) & (px < out_w) & (py >= 0) & (py < out_h)
        for k in order:
            if not sel[k]:
                continue
            x, y = px[k], py[k]
            idx_img[y, x] = self.vc[k]
            shade_img[y, x] = shade[k]
        return out_w, out_h, idx_img, shade_img

    def render_idx_shade(self, yaw_deg, pad=2, splat=2):
        """Vectorized z-buffer render returning (w, h, idx uint8, shade float32).
        scale from constructor. splat draws each voxel as splat x splat block."""
        if self.empty:
            return 1, 1, np.zeros(1, np.uint8), np.ones(1, np.float32)
        s = self.scale
        th = math.radians(yaw_deg)
        c, si = math.cos(th), math.sin(th)
        rx = (self.vx - self.cx) * c + (self.vy - self.cy) * si
        ry = -(self.vx - self.cx) * si + (self.vy - self.cy) * c
        rz = self.vz
        sx = (rx - ry) * PX * s
        sy = ((rx + ry) * PY - rz * COS_A) * s
        nx = self.normals[self.vn, 0]
        ny = self.normals[self.vn, 1]
        nz = self.normals[self.vn, 2]
        rnx = nx * c + ny * si
        rny = -nx * si + ny * c
        dot = rnx * self.light[0] + rny * self.light[1] + nz * self.light[2]
        shade = self.ambient + (1 - self.ambient) * np.clip(dot, 0, 1)
        depth = (rx + ry) * DZ + rz * SIN_A
        minx, maxx = sx.min(), sx.max()
        miny, maxy = sy.min(), sy.max()
        out_w = int(math.ceil(maxx - minx)) + 1 + pad * 2
        out_h = int(math.ceil(maxy - miny)) + 1 + pad * 2
        ox, oy = -minx + pad, -miny + pad
        H, W = out_h, out_w
        bx = (sx + ox).astype(np.int64)
        by = (sy + oy).astype(np.int64)
        # splat blocks
        offs = np.arange(splat)
        dx = np.repeat(offs, splat)
        dy = np.tile(offs, splat)
        px = (bx[:, None] + dx[None, :]).reshape(-1)
        py = (by[:, None] + dy[None, :]).reshape(-1)
        dep = np.repeat(depth, splat * splat)
        sh = np.repeat(shade, splat * splat)
        vc = np.repeat(self.vc, splat * splat)
        sel = (px >= 0) & (px < W) & (py >= 0) & (py < H)
        px, py, dep, sh, vc = px[sel], py[sel], dep[sel], sh[sel], vc[sel]
        flat = py * W + px
        zbuf = np.full(H * W, -np.inf, np.float32)
        if len(flat):
            np.maximum.at(zbuf, flat, dep.astype(np.float32))
            win = zbuf[flat] == dep
        else:
            win = np.zeros(0, bool)
        idx_img = np.zeros(H * W, np.uint8)
        shade_img = np.zeros(H * W, np.float32)
        idx_img[flat[win]] = vc[win]
        shade_img[flat[win]] = sh[win]
        return out_w, out_h, idx_img.reshape(H, W), shade_img.reshape(H, W)

    def render_rgb(self, yaw_deg, palette_rgb, out_w=None, out_h=None, pad=2, splat=1):
        """Fast path: returns RGBA uint8 image array using z-buffer.
        splat: draw each voxel as (splat x splat) block — use together with
        out_w/out_h downsampling for antialiased sprites."""
        if self.empty:
            return np.zeros((1, 1, 4), np.uint8)
        s = self.scale
        th = math.radians(yaw_deg)
        c, si = math.cos(th), math.sin(th)
        rx = (self.vx - self.cx) * c + (self.vy - self.cy) * si
        ry = -(self.vx - self.cx) * si + (self.vy - self.cy) * c
        rz = self.vz
        sx = (rx - ry) * PX * s
        sy = ((rx + ry) * PY - rz * COS_A) * s
        nx = self.normals[self.vn, 0]
        ny = self.normals[self.vn, 1]
        nz = self.normals[self.vn, 2]
        rnx = nx * c + ny * si
        rny = -nx * si + ny * c
        dot = rnx * self.light[0] + rny * self.light[1] + nz * self.light[2]
        shade = self.ambient + (1 - self.ambient) * np.clip(dot, 0, 1)
        depth = (rx + ry) * DZ + rz * SIN_A
        if out_w is None:
            minx, maxx = sx.min(), sx.max()
            miny, maxy = sy.min(), sy.max()
            out_w = int(math.ceil(maxx - minx)) + 1 + pad * 2
            out_h = int(math.ceil(maxy - miny)) + 1 + pad * 2
            ox, oy = -minx + pad, -miny + pad
        else:
            ox = out_w / 2.0
            oy = out_h / 2.0
        H, W = out_h, out_w
        # base pixel coords
        bx = (sx + ox).astype(np.int64)
        by = (sy + oy).astype(np.int64)
        if splat > 1:
            offs = np.arange(splat)
            dx = np.repeat(offs, splat)
            dy = np.tile(offs, splat)
            px = (bx[:, None] + dx[None, :]).reshape(-1)
            py = (by[:, None] + dy[None, :]).reshape(-1)
            dep = np.repeat(depth, splat * splat)
            sh = np.repeat(shade, splat * splat)
            vc = np.repeat(self.vc, splat * splat)
        else:
            px, py = bx, by
            dep, sh, vc = depth, shade, self.vc
        sel = (px >= 0) & (px < W) & (py >= 0) & (py < H)
        px, py, dep, sh, vc = px[sel], py[sel], dep[sel], sh[sel], vc[sel]
        flat = py * W + px
        zbuf = np.full(H * W, -np.inf, np.float32)
        if len(flat):
            np.maximum.at(zbuf, flat, dep.astype(np.float32))
            win = zbuf[flat] == dep
        else:
            win = np.zeros(0, bool)
        img = np.zeros((H * W, 4), np.uint8)
        colors = palette_rgb[vc].astype(np.float32)
        colors[:, :3] = np.clip(colors[:, :3] * (sh[:, None] * 0.62 + 0.38), 0, 255)
        img[flat[win]] = colors[win].astype(np.uint8)
        return img.reshape(H, W, 4)


def render_facing_sheet(section, facings=32, scale=1.0, **kw):
    r = VxlRenderer(section, scale=scale, **kw)
    out = []
    for f in range(facings):
        out.append(r.render(f * 360.0 / facings))
    return out
