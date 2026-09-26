// Render RA2 voxel units (VXL) to PNG sprite sheets (32 directions, engine-style rotation)
import { openMix, parseVxl, Pal, encodePNG, loadNormals } from '/home/z/my-project/scripts/ra2lib.ts';

const A = '/home/z/my-project/ra2assets';
const OUT = A + '/out/vehicles';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const pal = new Pal(new Uint8Array(await Bun.file(A + '/pal/unittem.pal').arrayBuffer()));
const local = openMix(A + '/inner/local.mix');

// parse normals from ts-redalert2 source (Vector3 format)
const normalsSrc = await Bun.file('/home/z/my-project/ts-redalert2/src/data/vxl/normals.ts').text();
const normals: number[][] = [];
{
  const tableMatch = normalsSrc.match(/export const normals1[^=]*=\s*\[([\s\S]*?)\];/);
  if (tableMatch) {
    for (const m of tableMatch[1].matchAll(/new Vector3\(([^)]+)\)/g)) {
      normals.push(m[1].split(',').map(Number));
    }
  }
}
console.log('normals loaded:', normals.length);

interface Vox { x: number; y: number; z: number; color: number; normal: number }

function collectVoxels(vxl: ReturnType<typeof parseVxl>): Vox[] {
  const out: Vox[] = [];
  for (const s of vxl.sections) {
    for (const [, list] of s.spans) {
      for (const vx of list) {
        out.push({ x: vx.x, y: vx.y, z: vx.z, color: vx.color, normal: vx.normal });
      }
    }
  }
  return out;
}

// bake one direction: rotate around model center (cx, cy) by theta, project iso
function renderDir(voxels: Vox[], cx: number, cy: number, cz: number, theta: number, scale: number) {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const pts: { sx: number; sy: number; depth: number; color: number; normal: number }[] = [];
  for (const v of voxels) {
    const dx = v.x - cx, dy = v.y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    const sx = (rx - ry) * 0.7071;         // iso x
    const sy = (rx + ry) * 0.7071 * 0.5 - (v.z - cz); // iso y
    pts.push({ sx, sy, depth: rx + ry + v.z * 0.1, color: v.color, normal: v.normal });
  }
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
    if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
  }
  const pad = 1;
  const w = Math.ceil((maxX - minX + pad * 2) * scale) + 1;
  const h = Math.ceil((maxY - minY + pad * 2) * scale) + 1;
  const zbuf = new Float32Array(w * h).fill(-Infinity);
  const rgba = new Uint8Array(w * h * 4);
  pts.sort((a, b) => a.depth - b.depth);
  const light = [0.4, 0.25, 0.88]; // from upper-left, front
  for (const p of pts) {
    const px = Math.floor((p.sx - minX + pad) * scale);
    const py = Math.floor((p.sy - minY + pad) * scale);
    if (px < 0 || px >= w || py < 0 || py >= h) continue;
    const idx = py * w + px;
    if (p.depth <= zbuf[idx]) continue;
    zbuf[idx] = p.depth;
    const n = normals[p.normal] ?? [0, 0, 1];
    // normal also rotates with the model
    const nx = n[0] * cos - n[1] * sin;
    const ny = n[0] * sin + n[1] * cos;
    let diff = nx * light[0] + ny * light[1] + n[2] * light[2];
    if (diff < 0) diff = 0;
    const lum = 0.6 + 0.4 * diff;
    const [r, g, b] = pal.rgb(p.color);
    const o = idx * 4;
    rgba[o] = Math.min(255, Math.round(r * lum));
    rgba[o + 1] = Math.min(255, Math.round(g * lum));
    rgba[o + 2] = Math.min(255, Math.round(b * lum));
    rgba[o + 3] = 255;
  }
  return { rgba, w, h };
}

const DIRS = 32;
function bakeUnit(vxlName: string, id: string, extraRotate = 0) {
  if (!local.has(vxlName)) { console.log(`MISS ${vxlName}`); return null; }
  const vxl = parseVxl(local.get(vxlName)!);
  const voxels = collectVoxels(vxl);
  if (!voxels.length) return null;
  // model bounds
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const v of voxels) {
    if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x;
    if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
    if (v.z < mnz) mnz = v.z; if (v.z > mxz) mxz = v.z;
  }
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = mnz;
  const scale = 2.0;
  const frames: { rgba: Uint8Array; w: number; h: number }[] = [];
  let maxW = 0, maxH = 0;
  for (let d = 0; d < DIRS; d++) {
    const theta = (d / DIRS) * Math.PI * 2 + extraRotate;
    const r = renderDir(voxels, cx, cy, cz, theta, scale)!;
    frames.push(r);
    maxW = Math.max(maxW, r.w); maxH = Math.max(maxH, r.h);
  }
  // fixed cell size for uniform grid
  const cellW = maxW + 4, cellH = maxH + 4;
  const cols = 8, rows = Math.ceil(DIRS / cols);
  const sheet = new Uint8Array(cellW * cols * cellH * rows * 4);
  const anchors: { x: number; y: number }[] = [];
  for (let d = 0; d < DIRS; d++) {
    const r = frames[d];
    const ax = Math.floor((cellW - r.w) / 2);
    const ay = Math.floor((cellH - r.h) / 2) + Math.floor((maxH - r.h) / 2); // bottom-align-ish
    anchors.push({ x: ax, y: ay });
    const bx = (d % cols) * cellW + ax, by = Math.floor(d / cols) * cellH + ay;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const s = (y * r.w + x) * 4;
      if (r.rgba[s + 3] === 0) continue;
      const dd = ((by + y) * cellW * cols + bx + x) * 4;
      sheet[dd] = r.rgba[s]; sheet[dd + 1] = r.rgba[s + 1]; sheet[dd + 2] = r.rgba[s + 2]; sheet[dd + 3] = 255;
    }
  }
  return { sheet, cellW, cellH, cols, rows, w: cellW * cols, h: cellH * rows, anchors, maxW, maxH, voxelCount: voxels.length };
}

const units: [string, string][] = [
  ['harv', 'harvester'], ['mcv', 'mcv'], ['smcv', 'smcv'],
  ['htnk', 'rhino'], ['mtnk', 'grizzly'], ['ttnk', 'teslatank'],
  ['sref', 'prismtank'], ['fv', 'ifv'], ['v3', 'v3launcher'],
  ['rtnk', 'robotank'], ['ltnk', 'ltnk'], ['htk', 'htk'],
  ['shad', 'harrier'], ['zep', 'kirov'],
];
const manifest: Record<string, any> = {};
for (const [base, id] of units) {
  const r = bakeUnit(base + '.vxl', id);
  if (!r) continue;
  await Bun.write(`${OUT}/${id}.png`, encodePNG(r.sheet, r.w, r.h));
  manifest[id] = { cellW: r.cellW, cellH: r.cellH, cols: r.cols, dirs: DIRS, w: r.w, h: r.h };
  console.log(`${id}: ${r.voxelCount} voxels, sprite ${r.maxW}x${r.maxH}, cell ${r.cellW}x${r.cellH}`);
}
// turrets
const turrets: [string, string][] = [
  ['harvtur', 'harvester_tur'], ['htnktur', 'rhino_tur'], ['mtnktur', 'grizzly_tur'],
  ['ttnktur', 'teslatank_tur'], ['sreftur', 'prismtank_tur'], ['fvtur', 'ifv_tur'],
  ['ltnktur', 'ltnk_tur'], ['rtnktur', 'robotank_tur'],
];
for (const [base, id] of turrets) {
  const r = bakeUnit(base + '.vxl', id);
  if (!r) continue;
  await Bun.write(`${OUT}/${id}.png`, encodePNG(r.sheet, r.w, r.h));
  manifest[id] = { cellW: r.cellW, cellH: r.cellH, cols: r.cols, dirs: DIRS, w: r.w, h: r.h };
  console.log(`${id}: sprite ${r.maxW}x${r.maxH}`);
}
await Bun.write(A + '/out/vehicles_manifest.json', JSON.stringify(manifest, null, 1));
console.log('DONE');
