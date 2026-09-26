// Correct TMP(TS) tile parser + diamond renderer
// Layout per file: [u32 cellsX][u32 cellsY][u32 blockW][u32 blockH][u32 offsets...]
// Sub-image at each nonzero offset:
//   [i32 x][i32 y][u32 totalSize][u32 ?][i32 extraX][i32 extraY][i32 extraW][i32 extraH][u32 flags]
//   [u8 height][u8 terrainType][u8 rampType][i8 r,g,b radar L][i8 r,g,b radar R][3 pad]
//   [u8 tileData[900]]  (diamond scan, 60x30)
//   [u8 zData[900]]     (if room)
//   [u8 extraData[...]] (pixels above tile)
import { Pal } from './ra2lib';

export interface TileSubImage {
  tileData: Uint8Array;
  zData: Uint8Array | null;
  extraData: Uint8Array | null;
  extraX: number; extraY: number; extraW: number; extraH: number;
  tileHeight: number;
  radarL: [number, number, number];
  radarR: [number, number, number];
}

export function parseTmp(data: Uint8Array): { blockW: number; blockH: number; cells: (TileSubImage | null)[] } | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 16) return null;
  const cellsX = dv.getUint32(0, true), cellsY = dv.getUint32(4, true);
  const blockW = dv.getUint32(8, true), blockH = dv.getUint32(12, true);
  const n = cellsX * cellsY;
  if (n <= 0 || n > 64) return null;
  if (16 + n * 4 > data.byteLength) return null;
  const cells: (TileSubImage | null)[] = [];
  const diamondBytes = (blockW * blockH) / 2;
  for (let i = 0; i < n; i++) {
    const off = dv.getUint32(16 + i * 4, true);
    if (off === 0 || off < 0 || off + 52 > data.byteLength) { cells.push(null); continue; }
    const x = dv.getInt32(off, true), y = dv.getInt32(off + 4, true);
    const totalSize = dv.getUint32(off + 8, true);
    const extraX = dv.getInt32(off + 20, true), extraY = dv.getInt32(off + 24, true);
    const extraW = dv.getInt32(off + 28, true), extraH = dv.getInt32(off + 32, true);
    const flags = dv.getUint32(off + 36, true);
    const tileHeight = dv.getUint8(off + 40);
    const radarL: [number, number, number] = [dv.getUint8(off + 43) * 4, dv.getUint8(off + 44) * 4, dv.getUint8(off + 45) * 4];
    const radarR: [number, number, number] = [dv.getUint8(off + 46) * 4, dv.getUint8(off + 47) * 4, dv.getUint8(off + 48) * 4];
    // compute actual available data
    let end = off + 52 + diamondBytes;
    // zData present if flags bit 1 AND room
    let zData: Uint8Array | null = null;
    if ((flags & 2) && end + diamondBytes <= data.byteLength && (totalSize === 0 || off + totalSize >= end + diamondBytes)) {
      zData = data.subarray(end, end + diamondBytes);
      end += diamondBytes;
    } else if ((flags & 2) && end + diamondBytes <= data.byteLength && (extraW > 0 && extraW < 256 && extraH > 0 && extraH < 256 && extraW * extraH > diamondBytes)) {
      // no z data but extra declared larger
    }
    let extraData: Uint8Array | null = null;
    let eW = extraW, eH = extraH;
    if (eW > 0 && eW < 512 && eH > 0 && eH < 512) {
      const avail = data.byteLength - end;
      if (eW * eH <= avail) {
        extraData = data.subarray(end, end + eW * eH);
      } else if (avail > 0 && eW * eH < 512 * 512) {
        // truncated: use what's there
        extraData = data.subarray(end, data.byteLength);
        eH = Math.ceil(extraData.length / eW);
      }
    }
    cells.push({
      tileData: data.subarray(off + 52, Math.min(off + 52 + diamondBytes, data.byteLength)),
      zData, extraData, extraX, extraY, extraW: eW, extraH: eH, tileHeight, radarL, radarR,
    });
  }
  return { blockW, blockH, cells };
}

// Render one sub-image: 60x30 diamond + extra data above
// Returns RGBA with logical tile anchor: bottom 30px = the diamond
export function renderTileRGBA(img: TileSubImage, blockW: number, blockH: number, pal: Pal): { rgba: Uint8Array; w: number; h: number } {
  // compute canvas size: diamond area + extra above
  let topOff = 0, leftOff = 0, extraW = 0, extraH = 0;
  if (img.extraData && img.extraW > 0 && img.extraH > 0) {
    extraW = img.extraW; extraH = img.extraH;
    // extraX/extraY = offset of extra region relative to tile top-left (may be negative)
    // canvas must cover both diamond (0,0)-(60,30) and extra at (extraX, extraY)-(extraX+extraW, extraY+extraH)
    const minX = Math.min(0, img.extraX), maxX = Math.max(blockW, img.extraX + extraW);
    const minY = Math.min(0, img.extraY), maxY = Math.max(blockH, img.extraY + extraH);
    leftOff = -minX; topOff = -minY;
    const w = maxX - minX, h = maxY - minY;
    return renderComposite(img, blockW, blockH, pal, w, h, leftOff, topOff);
  }
  return renderComposite(img, blockW, blockH, pal, blockW, blockH, 0, 0);
}

function renderComposite(img: TileSubImage, blockW: number, blockH: number, pal: Pal, w: number, h: number, leftOff: number, topOff: number): { rgba: Uint8Array; w: number; h: number } {
  const rgba = new Uint8Array(w * h * 4);
  // diamond scan (Westwood order)
  const half = blockH / 2;
  let idx = 0;
  let pos = Math.floor(blockW / 2) - 2 + w * topOff + leftOff;
  let rowWidth = 0;
  const total = w * h;
  for (let row = 0; row < half; row++) {
    rowWidth += 4;
    for (let i = 0; i < rowWidth; i++) {
      const p = img.tileData[idx++];
      if (p !== 0 && pos >= 0 && pos < total) {
        const [r, g, b] = pal.rgb(p);
        rgba[pos * 4] = r; rgba[pos * 4 + 1] = g; rgba[pos * 4 + 2] = b; rgba[pos * 4 + 3] = 255;
      }
      pos++;
    }
    pos += w - (rowWidth + 2);
  }
  pos += 4;
  for (let row = half; row < blockH; row++) {
    rowWidth -= 4;
    for (let i = 0; i < rowWidth; i++) {
      const p = img.tileData[idx++];
      if (p !== 0 && pos >= 0 && pos < total) {
        const [r, g, b] = pal.rgb(p);
        rgba[pos * 4] = r; rgba[pos * 4 + 1] = g; rgba[pos * 4 + 2] = b; rgba[pos * 4 + 3] = 255;
      }
      pos++;
    }
    pos += w - (rowWidth - 2);
  }
  // extra data above
  if (img.extraData && img.extraW > 0) {
    const ex = leftOff + img.extraX, ey = topOff + img.extraY;
    for (let yy = 0; yy < img.extraH; yy++) {
      for (let xx = 0; xx < img.extraW; xx++) {
        const p = img.extraData[yy * img.extraW + xx];
        if (p === 0) continue;
        const px = ex + xx, py = ey + yy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const [r, g, b] = pal.rgb(p);
        const o = (py * w + px) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
    }
  }
  return { rgba, w, h };
}
