// RA2 asset conversion library: PNG encoder + SHP/TMP/VXL/HVA parsers & renderers
// Runs under Bun. Reuses ts-redalert2's DataStream/MixFile/ShpFile/TmpFile parsers.
import { deflateSync } from 'node:zlib';
import { DataStream } from '/home/z/my-project/ts-redalert2/src/data/DataStream';
import { MixFile } from '/home/z/my-project/ts-redalert2/src/data/MixFile';
import { ShpFile } from '/home/z/my-project/ts-redalert2/src/data/ShpFile';
import { TmpFile } from '/home/z/my-project/ts-redalert2/src/data/TmpFile';
import { VirtualFile } from '/home/z/my-project/ts-redalert2/src/data/vfs/VirtualFile';

// ---------- PNG encoder ----------
export function crc32(buf: Uint8Array): number {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
// rgba: Uint8Array w*h*4
export function encodePNG(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw, { level: 6 });
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---------- Palette ----------
export class Pal {
  colors: [number, number, number][];
  constructor(data: Uint8Array) {
    this.colors = [];
    for (let i = 0; i < 256; i++) {
      // VGA 6-bit -> 8-bit
      this.colors.push([data[i * 3] * 4, data[i * 3 + 1] * 4, data[i * 3 + 2] * 4]);
    }
  }
  rgb(i: number): [number, number, number] { return this.colors[i] ?? [255, 0, 255]; }
}

// ---------- SHP rendering ----------
export function openMix(path: string): { mix: MixFile; get: (name: string) => Uint8Array | null; has: (name: string) => boolean; entries: { hash: number; offset: number; length: number }[]; dataStart: number; stream: DataStream } {
  const buf = Bun.file(path);
  // note: sync read needed; use readFileSync via Bun
  const data = new Uint8Array(require('node:fs').readFileSync(path));
  const stream = new DataStream(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const mix = new MixFile(stream);
  const index = (mix as any).index as Map<number, any>;
  const dataStart = (mix as any).dataStart as number;
  return {
    mix,
    has: (name: string) => mix.containsFile(name),
    get: (name: string) => {
      if (!mix.containsFile(name)) return null;
      const v = mix.openFile(name);
      const view = v.getBytes();
      // copy into own buffer to avoid DataView aliasing/_realloc bugs
      return new Uint8Array(view); // copies
    },
    entries: [...index.values()].map(e => ({ hash: e.hash, offset: e.offset, length: e.length })),
    dataStart,
    stream,
  };
}

export function shpToFrames(data: Uint8Array): { frames: { x: number; y: number; w: number; h: number; pixels: Uint8Array }[]; width: number; height: number } {
  const vf = VirtualFile.fromBytes(data, 'x.shp');
  const shp = new ShpFile(vf);
  return {
    frames: shp.images.map(img => {
      // some SHPs use 0x0 frames meaning "full canvas" (TS-style)
      let w = img.width, h = img.height;
      const pixels = img.imageData ?? new Uint8Array(0);
      if ((w === 0 || h === 0) && shp.width > 0 && shp.height > 0 && pixels.length >= shp.width * shp.height) {
        w = shp.width; h = shp.height;
      }
      return { x: img.x, y: img.y, w, h, pixels };
    }),
    width: shp.width,
    height: shp.height,
  };
}

export function renderShpFrameRGBA(frame: { x: number; y: number; w: number; h: number; pixels: Uint8Array }, pal: Pal, scale = 1): Uint8Array {
  const w = frame.w * scale, h = frame.h * scale;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const idx = frame.pixels[y * frame.w + x];
      const [r, g, b] = pal.rgb(idx);
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const dy = y * scale + sy, dx = x * scale + sx;
          const o = (dy * w + dx) * 4;
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = idx === 0 ? 0 : 255;
        }
      }
    }
  }
  return out;
}

// ---------- TMP (terrain tile) rendering ----------
export function tmpToImage(data: Uint8Array): { w: number; h: number; pixels: Uint8Array; height: number; terrainHeight: Uint8Array } | null {
  const vf = VirtualFile.fromBytes(data, 'x.tmp');
  const tmp = new TmpFile(vf);
  if (!tmp.images.length) return null;
  const img = tmp.images[0] as any;
  const pixels = img.tileData;
  if (!pixels || !img.x || !img.y) return null;
  return {
    w: img.x,
    h: img.y,
    pixels,
    height: img.height ?? 0,
    terrainHeight: img.zData ?? new Uint8Array(0),
  };
}

export function renderTmpRGBA(tile: { w: number; h: number; pixels: Uint8Array }, pal: Pal): Uint8Array {
  const out = new Uint8Array(tile.w * tile.h * 4);
  for (let i = 0; i < tile.w * tile.h; i++) {
    const idx = tile.pixels[i];
    const [r, g, b] = pal.rgb(idx);
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = idx === 0 ? 0 : 255;
  }
  return out;
}

// ---------- VXL parser (own impl, no THREE) ----------
export interface VxlSection {
  name: string;
  spans: Map<number, { x: number; y: number; z: number; color: number; normal: number }[]>; // key = y*sizeX+x
  sizeX: number; sizeY: number; sizeZ: number;
  hvaMultiplier: number;
  transfMatrix: number[]; // 12 floats (3x4)
  minBounds: number[]; maxBounds: number[];
}
export function parseVxl(data: Uint8Array): { sections: VxlSection[]; voxelCount: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  const fileName = readCString(dv, p, 16); p += 16;
  const paletteCount = dv.getUint32(p, true); p += 4;
  const headerCount = dv.getUint32(p, true); p += 4;
  const tailerCount = dv.getUint32(p, true); p += 4;
  const bodySize = dv.getUint32(p, true); p += 4;
  p += 2; // remap start/end
  p += 768; // skip embedded palette
  const sections: VxlSection[] = [];
  for (let i = 0; i < headerCount; i++) {
    const name = readCString(dv, p, 16); p += 16;
    p += 12; // 3 uint32
    sections.push({ name, spans: new Map(), sizeX: 0, sizeY: 0, sizeZ: 0, hvaMultiplier: 1, transfMatrix: [], minBounds: [], maxBounds: [] });
  }
  const bodyStart = p;
  p = bodyStart + bodySize;
  const tailers: { start: number; end: number; dataSpan: number }[] = [];
  for (let i = 0; i < tailerCount; i++) {
    const start = dv.getUint32(p, true); p += 4;
    const end = dv.getUint32(p, true); p += 4;
    const dataSpan = dv.getUint32(p, true); p += 4;
    const s = sections[i];
    s.hvaMultiplier = dv.getFloat32(p, true); p += 4;
    const m: number[] = [];
    for (let k = 0; k < 12; k++) { m.push(dv.getFloat32(p, true)); p += 4; }
    s.transfMatrix = m;
    s.minBounds = [dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)]; p += 12;
    s.maxBounds = [dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)]; p += 12;
    s.sizeX = dv.getUint8(p); s.sizeY = dv.getUint8(p + 1); s.sizeZ = dv.getUint8(p + 2); p += 4;
    tailers.push({ start, end, dataSpan });
  }
  let voxelCount = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    let q = bodyStart + tailers[i].start;
    const { sizeX, sizeY, sizeZ } = s;
    const startOff: number[][] = [];
    for (let y = 0; y < sizeY; y++) { startOff[y] = []; for (let x = 0; x < sizeX; x++) { startOff[y][x] = dv.getInt32(q, true); q += 4; } }
    const endOff: number[][] = [];
    for (let y = 0; y < sizeY; y++) { endOff[y] = []; for (let x = 0; x < sizeX; x++) { endOff[y][x] = dv.getInt32(q, true); q += 4; } }
    // span data is stored contiguously; read sequentially in table order (reference impl semantics)
    let r = q;
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        if (startOff[y][x] === -1 || endOff[y][x] === -1) continue;
        const list: { x: number; y: number; z: number; color: number; normal: number }[] = [];
        for (let z = 0; z < sizeZ;) {
          z += dv.getUint8(r); r++;
          const cnt = dv.getUint8(r); r++;
          for (let k = 0; k < cnt; k++) {
            list.push({ x, y, z: z++, color: dv.getUint8(r), normal: dv.getUint8(r + 1) });
            r += 2;
          }
          r++; // skip tail byte
        }
        s.spans.set(y * sizeX + x, list);
        voxelCount += list.length;
      }
    }
  }
  return { sections, voxelCount };
}

export function readCString(dv: DataView, off: number, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const c = dv.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// ---------- HVA parser ----------
export function parseHva(data: Uint8Array, numSections: number): { numFrames: number; matrices: Float32Array[] }[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 16; // skip filename
  const numFrames = dv.getInt32(p, true); p += 4;
  const nSec = dv.getInt32(p, true); p += 4;
  const sections: { name: string; matrices: Float32Array[] }[] = [];
  for (let i = 0; i < nSec; i++) {
    const name = readCString(dv, p, 16); p += 16;
    sections.push({ name, matrices: [] });
  }
  for (let f = 0; f < numFrames; f++) {
    for (let i = 0; i < nSec; i++) {
      const m = new Float32Array(12);
      for (let k = 0; k < 12; k++) { m[k] = dv.getFloat32(p, true); p += 4; }
      sections[i].matrices.push(m);
    }
  }
  return sections as any;
}

// ---------- RA2 normal tables (from ts-redalert2 src/data/vxl/normals.ts) ----------
// We import them directly at runtime in the main script via require of the TS file is not possible;
// so we re-derive from the source file by parsing it.
export async function loadNormals(): Promise<number[][]> {
  const src = await Bun.file('/home/z/my-project/ts-redalert2/src/data/vxl/normals.ts').text();
  // extract the first table (normals1) which is the standard RA2 normal table
  const tables: number[][][] = [];
  const re = /export const normals(\d)\s*=\s*\[((?:\s*\[[^\]]*\],?)+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[2];
    const vecs: number[][] = [];
    const vre = /\[([^\]]+)\]/g;
    let v: RegExpExecArray | null;
    while ((v = vre.exec(body))) {
      const nums = v[1].split(',').map(Number);
      vecs.push(nums);
    }
    tables[Number(m[1])] = vecs;
  }
  return tables[1] ?? [];
}
