#!/usr/bin/env python3
"""RA2 asset decoding library: SHP (TS), VXL voxel, HVA, TMP (TS iso), PAL, CSF.

All decoders verified against the working engine source (ts-redalert2 repo).
"""
import struct
import zlib

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

class Palette:
    def __init__(self, data768):
        assert len(data768) == 768, 'palette must be 768 bytes'
        self.colors = []
        for i in range(256):
            r, g, b = data768[3 * i], data768[3 * i + 1], data768[3 * i + 2]
            self.colors.append((r * 4, g * 4, b * 4))

    def rgba(self, idx):
        if idx == 0:
            return (0, 0, 0, 0)
        r, g, b = self.colors[idx]
        return (r, g, b, 255)

    def remap_team(self, rgb255):
        """Return new palette with team-color ramp written into indices 16..31."""
        import copy
        p = copy.deepcopy(self)
        factors = [63, 59, 55, 52, 48, 44, 41, 37, 33, 30, 26, 22, 19, 15, 11, 8]
        r, g, b = rgb255
        for i, f in enumerate(factors):
            p.colors[16 + i] = (r * f // 63, g * f // 63, b * f // 63)
        return p


# ---------------------------------------------------------------------------
# SHP (TS/RA2 format)
# ---------------------------------------------------------------------------

class ShpFrame:
    __slots__ = ('x', 'y', 'w', 'h', 'data')

    def __init__(self, x, y, w, h, data):
        self.x, self.y, self.w, self.h, self.data = x, y, w, h, data


class ShpFile:
    def __init__(self, data: bytes):
        self.frames = []
        self.width = 0
        self.height = 0
        self._parse(data)

    def _parse(self, d):
        reserved, w, h, n = struct.unpack_from('<hhhh', d, 0)
        if reserved != 0:
            # non-standard; try as count-first
            n = w
            w = h = 0
        self.num = n
        if n <= 0 or n > 4096:
            return
        headers = []
        base = 8
        for i in range(n):
            x, y, fw, fh = struct.unpack_from('<hhhh', d, base + i * 24)
            comp = d[base + i * 24 + 8]
            off, = struct.unpack_from('<i', d, base + i * 24 + 20)
            headers.append((x, y, fw, fh, comp, off))
        for i, (x, y, fw, fh, comp, off) in enumerate(headers):
            if fw == 0 or fh == 0:
                self.frames.append(ShpFrame(x, y, fw, fh, b''))
                continue
            next_off = headers[i + 1][5] if i + 1 < n else len(d)
            if next_off < off or off <= 0:
                next_off = len(d)
            end = min(next_off, len(d))
            length = max(0, end - off)
            raw = d[off:off + length]
            data = self._decode_frame(raw, fw, fh, comp)
            self.frames.append(ShpFrame(x, y, fw, fh, data))
            self.width = max(self.width, x + fw)
            self.height = max(self.height, y + fh)

    @staticmethod
    def _decode_frame(raw, w, h, comp):
        out = bytearray(w * h)
        if comp <= 1:
            n = min(len(raw), w * h)
            out[:n] = raw[:n]
        elif comp == 2:
            pos = 0
            di = 0
            for _ in range(h):
                if pos + 2 > len(raw):
                    break
                ln = struct.unpack_from('<H', raw, pos)[0] - 2
                pos += 2
                if ln < 0 or pos + ln > len(raw):
                    break
                row = raw[pos:pos + ln]
                pos += ln
                take = min(len(row), w * h - di)
                out[di:di + take] = row[:take]
                di += take
                # pad row to width
                if di % w != 0:
                    di = ((di // w) + 1) * w
        elif comp == 3:
            pos = 0
            di = 0
            for _y in range(h):
                if pos + 2 > len(raw):
                    break
                line_len = struct.unpack_from('<H', raw, pos)[0] - 2
                pos += 2
                if line_len < 0:
                    break
                x = 0
                while line_len > 0 and pos < len(raw):
                    v = raw[pos]
                    pos += 1
                    line_len -= 1
                    if v != 0:
                        if x < w and di < len(out):
                            out[di] = v
                        di += 1
                        x += 1
                    else:
                        if pos >= len(raw):
                            break
                        run = raw[pos]
                        pos += 1
                        line_len -= 1
                        if x + run > w:
                            run = (w - x) & 255
                        for _ in range(run):
                            if x < w and di < len(out):
                                out[di] = 0
                            di += 1
                            x += 1
                di = (_y + 1) * w
        else:
            raise ValueError(f'unknown shp compression {comp}')
        return bytes(out)


# ---------------------------------------------------------------------------
# VXL voxel
# ---------------------------------------------------------------------------

VXL_NORMALS = None  # set by load_normals()


def load_normals():
    global VXL_NORMALS
    if VXL_NORMALS is not None:
        return VXL_NORMALS
    import json
    import os
    path = os.path.join(os.path.dirname(__file__), 'vxl_normals.json')
    if os.path.exists(path):
        VXL_NORMALS = json.load(open(path))
        return VXL_NORMALS
    raise FileNotFoundError('vxl_normals.json missing (generate from normals.ts)')


class VxlSection:
    def __init__(self):
        self.name = ''
        self.sizeX = 0
        self.sizeY = 0
        self.sizeZ = 0
        self.normalsMode = 1
        self.voxels = []  # (x, y, z, colorIdx, normalIdx)
        self.palette = None  # 768 bytes embedded
        self.remapStart = 16
        self.remapEnd = 31
        self.minBounds = None
        self.maxBounds = None


class VxlFile:
    def __init__(self, data: bytes):
        self.sections = []
        self._parse(data)

    def _parse(self, d):
        if len(d) < 800:
            return
        name = d[:16].split(b'\x00')[0].decode('ascii', 'ignore')
        pal_count, hdr_count, tail_count, body_size = struct.unpack_from('<IIII', d, 16)
        remap_start, remap_end = d[32], d[33]
        palette = d[34:34 + 768]
        if hdr_count == 0 or hdr_count != tail_count:
            return
        # section headers
        pos = 34 + 768
        section_names = []
        for i in range(hdr_count):
            sname = d[pos:pos + 16].split(b'\x00')[0].decode('ascii', 'ignore')
            section_names.append(sname)
            pos += 16 + 12
        body_start = pos
        # tailers
        pos = body_start + body_size
        tailers = []
        for i in range(tail_count):
            if pos + 48 > len(d):
                return
            start_off, end_off, data_off = struct.unpack_from('<III', d, pos)
            hva_mult, = struct.unpack_from('<f', d, pos + 12)
            m = struct.unpack_from('<12f', d, pos + 16)
            minb = struct.unpack_from('<3f', d, pos + 64)
            maxb = struct.unpack_from('<3f', d, pos + 76)
            sx, sy, sz = d[pos + 88], d[pos + 89], d[pos + 90]
            nm = d[pos + 91]
            tailers.append((start_off, end_off, data_off, sx, sy, sz, nm, m, minb, maxb))
            pos += 92
        # section bodies
        for i in range(hdr_count):
            start_off, end_off, data_off, sx, sy, sz, nm, m, minb, maxb = tailers[i]
            sec = VxlSection()
            sec.name = section_names[i] if i < len(section_names) else ''
            sec.sizeX, sec.sizeY, sec.sizeZ = sx, sy, sz
            sec.normalsMode = nm
            sec.minBounds = minb
            sec.maxBounds = maxb
            sec.palette = palette
            sec.remapStart = remap_start
            sec.remapEnd = remap_end
            table_pos = body_start + start_off
            data_pos = body_start + data_off
            if data_pos <= 0 or table_pos + 8 * sx * sy > len(d):
                continue
            starts = {}
            for yy in range(sy):
                for xx in range(sx):
                    o, = struct.unpack_from('<i', d, table_pos + 4 * (yy * sx + xx))
                    starts[(xx, yy)] = o
            for (xx, yy), so in starts.items():
                if so == -1:
                    continue
                p = data_pos + so
                if p >= len(d):
                    continue
                z = 0
                voxels = sec.voxels
                while z < sz and p + 2 <= len(d):
                    skip = d[p]
                    count = d[p + 1]
                    p += 2
                    z += skip
                    if count == 0:
                        p += 1  # trailing byte still present
                        continue
                    if p + 2 * count > len(d):
                        break
                    for k in range(count):
                        color = d[p + 2 * k]
                        normal = d[p + 2 * k + 1]
                        voxels.append((xx, yy, z, color, normal))
                        z += 1
                    p += 2 * count + 1  # + trailing byte (validated empirically)
            self.sections.append(sec)


# ---------------------------------------------------------------------------
# TMP (TS/RA2 iso terrain tile)
# ---------------------------------------------------------------------------

class TmpImage:
    __slots__ = ('x', 'y', 'flags', 'height', 'terrain_type', 'ramp_type',
                 'radar_left', 'radar_right', 'tile_data', 'z_data', 'extra')

    def __init__(self):
        self.tile_data = b''
        self.z_data = None
        self.extra = None
        self.flags = 0


class TmpFile:
    def __init__(self, data: bytes):
        self.images = []
        self._parse(data)

    def _parse(self, d):
        if len(d) < 24:
            return
        w, h, bw, bh = struct.unpack_from('<iiii', d, 0)
        n = w * h
        if n <= 0 or n > 4096:
            return
        offs = struct.unpack_from('<%di' % n, d, 16)
        for i in range(n):
            off = offs[i]
            if off < 0:
                self.images.append(None)
                continue
            if off + 48 > len(d):
                self.images.append(None)
                continue
            img = TmpImage()
            pos = off
            img.x, img.y = struct.unpack_from('<ii', d, pos)
            (block_size,) = struct.unpack_from('<i', d, pos + 16)
            ex, ey, ew, eh = struct.unpack_from('<iiii', d, pos + 20)
            img.flags, = struct.unpack_from('<I', d, pos + 36)
            img.height = d[pos + 40]
            img.terrain_type = d[pos + 41]
            img.ramp_type = d[pos + 42]
            img.radar_left = (d[pos + 43], d[pos + 44], d[pos + 45])
            img.radar_right = (d[pos + 46], d[pos + 47], d[pos + 48])
            pos += 52
            main_len = (bw * bh) // 2
            img.tile_data = d[pos:pos + main_len]
            pos += main_len
            if img.flags & 2:  # ZData
                img.z_data = d[pos:pos + main_len]
                pos += main_len
            if img.flags & 1:  # ExtraData
                if ew and eh:
                    elen = abs(ew * eh)
                    img.extra = d[pos:pos + elen]
            self.images.append(img)


def tmp_to_bitmap(img: TmpImage, width=60, height=30):
    """Expand tile data to a full width*height index bitmap (engine-exact layout).

    Row widths: 4,8,...,60 (top half), 56,52,...,4,0 (bottom half).
    Row y (top): x_start = width/2 - 2 - 2*y ; bottom rows shift right by 2 each.
    """
    out = bytearray(width * height)
    if not img.tile_data:
        return bytes(out), None
    data = img.tile_data
    ti = 0
    half = height // 2
    # top half
    x = width // 2 - 2
    y = 0
    row_width = 0
    for row in range(half):
        row_width += 4
        for i in range(row_width):
            if ti < len(data):
                out[y * width + x + i] = data[ti]
                ti += 1
        x -= 2
        y += 1
    # bottom half
    x = 4
    for row in range(half):
        row_width -= 4
        for i in range(max(0, row_width)):
            if ti < len(data):
                out[y * width + x + i] = data[ti]
                ti += 1
        x += 2
        y += 1
    # z data with same layout
    zout = bytearray(width * height)
    if img.z_data:
        zdata = img.z_data
        zout = bytearray(width * height)
        ti = 0
        x = width // 2 - 2
        y = 0
        row_width = 0
        for row in range(half):
            row_width += 4
            for i in range(row_width):
                if ti < len(zdata):
                    zout[y * width + x + i] = zdata[ti]
                    ti += 1
            x -= 2
            y += 1
        x = 4
        for row in range(half):
            row_width -= 4
            for i in range(max(0, row_width)):
                if ti < len(zdata):
                    zout[y * width + x + i] = zdata[ti]
                    ti += 1
            x += 2
            y += 1
    return bytes(out), bytes(zout) if zout is not None else bytes(width * height)


# ---------------------------------------------------------------------------
# CSF string table
# ---------------------------------------------------------------------------

def parse_csf(data: bytes):
    magic = data[:4]
    if magic != b' FSC':
        raise ValueError('not csf: ' + repr(magic[:4]))
    import struct as _s
    ver, num_labels, num_values, unused, lang = _s.unpack_from('<IIIII', data, 4)
    out = {}
    pos = 24
    n = 0
    while pos + 8 <= len(data) and n < num_labels:
        if data[pos:pos + 4] != b' LBL':
            # skip unexpected bytes to next label marker
            nxt = data.find(b' LBL', pos + 1)
            if nxt < 0:
                break
            pos = nxt
        pos += 4
        pairs, name_len = _s.unpack_from('<ii', data, pos)
        pos += 8
        label = data[pos:pos + name_len].decode('ascii', 'ignore')
        pos += name_len
        value = ''
        for _p in range(max(0, pairs)):
            if pos + 8 > len(data):
                break
            vmagic = data[pos:pos + 4]
            vlen, = _s.unpack_from('<i', data, pos + 4)  # char count, NOT bytes
            pos += 8
            nbytes = max(0, vlen) * 2
            if pos + nbytes > len(data):
                break
            if vmagic in (b' RTS', b'STRW', b'WRTS'):
                raw = data[pos:pos + nbytes]
                value += bytes((~b) & 0xFF for b in raw).decode('utf-16-le', 'ignore')
            pos += nbytes
        out[label] = value
        n += 1
    return out
