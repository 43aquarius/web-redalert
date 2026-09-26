// Extract ALL game sprites from RA2 mixes → PNG files
// Usage: bun run extract_sprites.ts
import { openMix, shpToFrames, renderShpFrameRGBA, Pal, encodePNG } from '/home/z/my-project/scripts/ra2lib.ts';
import { parseTmp, renderTileRGBA } from '/home/z/my-project/scripts/tmplib.ts';
import { MixEntry } from '/home/z/my-project/ts-redalert2/src/data/MixEntry';

const A = '/home/z/my-project/ra2assets';
const OUT = A + '/out';
import { mkdirSync } from 'node:fs';
for (const d of ['buildings', 'buildings_mk', 'infantry', 'anims', 'ore', 'trees', 'cameos', 'sidebar', 'tiles', 'misc', 'walls']) mkdirSync(`${OUT}/${d}`, { recursive: true });

// palettes
const pal = {
  unit: new Pal(new Uint8Array(await Bun.file(A + '/pal/unittem.pal').arrayBuffer())),
  iso: new Pal(new Uint8Array(await Bun.file(A + '/pal/isotem.pal').arrayBuffer())),
  temperat: new Pal(new Uint8Array(await Bun.file(A + '/pal/temperat.pal').arrayBuffer())),
  lib: new Pal(new Uint8Array(await Bun.file(A + '/pal/libtem.pal').arrayBuffer())),
  anim: new Pal(new Uint8Array(await Bun.file(A + '/pal/anim.pal').arrayBuffer())),
  cameo: new Pal(new Uint8Array(await Bun.file(A + '/pal/cameo.pal').arrayBuffer())),
};

// mixes
const M = {
  generic: openMix(A + '/inner/generic.mix'),
  conquer: openMix(A + '/inner/conquer.mix'),
  local: openMix(A + '/inner/local.mix'),
  temperat: openMix(A + '/inner/temperat.mix'),
  isotemp: openMix(A + '/inner/isotemp.mix'),
  isogen: openMix(A + '/inner/isogen.mix'),
  cameo: openMix(A + '/inner/cameo.mix'),
  sidec01: openMix(A + '/inner/sidec01.mix'),
  sidec02: openMix(A + '/inner/sidec02.mix'),
  tem: openMix(A + '/inner/tem.mix'),
};
const contents = JSON.parse(await Bun.file(A + '/mix_contents.json').text());
const findFile = (name: string): { mix: any } | null => {
  for (const m of Object.values(M)) if (m.has(name)) return { mix: m };
  return null;
};

const manifest: Record<string, any> = {};
const firstNonEmptyFrame = (shp: any) => {
  for (let i = 0; i < shp.frames.length; i++) {
    const f = shp.frames[i];
    if (f && f.w > 0 && f.h > 0) return f;
  }
  return shp.frames[0];
};

// ============ BUILDINGS ============
// art name -> game id. File = theater variant: firstChar + 'g'/'t' + rest
const buildings: [string, string][] = [
  // [artName, gameId]
  ['GACNST', 'aconyard'], ['GAPOWR', 'apower'], ['GAREFN', 'arefinery'], ['GAWEAP', 'awarfactory'],
  ['GAPILE', 'abarracks'], ['GAAIRC', 'airforce'], ['GAPRIS', 'prismtower'], ['GAPILL', 'pillbox'],
  ['GATECH', 'abattlelab'], ['GADEPT', 'arepair'], ['GACSPH', 'chronosphere'], ['GAWETH', 'weather'],
  ['GAGAP', 'gapgen'], ['GAYARD', 'anavyard'],
  ['NACNST', 'sconyard'], ['NAPOWR', 'spower'], ['NAREFN', 'srefinery'], ['NAWEAP', 'swarfactory'],
  ['NAHAND', 'sbarracks'], ['NARADR', 'sradar'], ['NATSLA', 'teslacoil'], ['NATECH', 'sbattlelab'],
  ['NADEPT', 'srepair'], ['NAMISL', 'nuclearmissile'], ['NAFLAK', 'flakcannon'], ['NAYARD', 'snavyard'],
  ['NAIRON', 'ironcurtain'], 
];
const newTheaterName = (art: string, ch: string) => art[0].toLowerCase() + ch + art.slice(2).toLowerCase();

console.log('== buildings ==');
for (const [art, id] of buildings) {
  const base = art.toLowerCase();
  // try generic 'g' first, then temperate 't', then plain
  const tryNames = [newTheaterName(art, 'g') + '.shp', newTheaterName(art, 't') + '.shp', base + '.shp'];
  let found: { mix: any; name: string } | null = null;
  for (const n of tryNames) {
    const f = findFile(n);
    if (f) { found = { mix: f.mix, name: n }; break; }
  }
  if (!found) { console.log(`MISS: ${art} (${id})`); continue; }
  const bytes = found.mix.get(found.name)!;
  const shp = shpToFrames(bytes);
  // frame 0 = complete undamaged. Some buildings have anim frames after.
  const f0 = firstNonEmptyFrame(shp);
  if (!f0 || f0.w === 0) { console.log(`EMPTY: ${art}`); continue; }
  const rgba = renderShpFrameRGBA(f0, pal.unit, 2); // 2x scale for crispness
  await Bun.write(`${OUT}/buildings/${id}.png`, encodePNG(rgba, f0.w * 2, f0.h * 2));
  manifest[id] = { w: f0.w * 2, h: f0.h * 2, frames: shp.frames.length, file: found.name };
  console.log(`${id}: ${found.name} ${shp.width}x${shp.height} ${shp.frames.length} frames`);
}

// buildup animations (mk files)
const mkArts: [string, string][] = [
  ['GAPOWRMK', 'apower'], ['GAREFMK', 'arefinery'], ['GAWEAPMK', 'awarfactory'], ['GACNSTMK', 'aconyard'],
  ['GAPILMK', 'abarracks'], ['GAAIRCMK', 'airforce'], ['GAPRISMK', 'prismtower'],
  ['NAPOWRMK', 'spower'], ['NAREFMK', 'srefinery'], ['NAWEAPMK', 'swarfactory'], ['NACNSTMK', 'sconyard'],
  ['NAHANDMK', 'sbarracks'], ['NARADRMK', 'sradar'], ['NATSLAMK', 'teslacoil'], ['NAMISLMK', 'nuclearmissile'], ['NAFLAKMK', 'flakcannon'], ['GATECHMK', 'abattlelab'], ['NADEPTMK', 'srepair'], ['GAREFNMK' as any, 'arefinery'], ['NAREFNMK' as any, 'srefinery'], ['GAWETHMK' as any, 'weather'], ['GACSPHMK' as any, 'chronosphere'],
];
console.log('== buildup anims ==');
for (const [art, id] of mkArts) {
  for (const ch of ['g', 't']) {
    const n = newTheaterName(art, ch) + '.shp';
    const f = findFile(n);
    if (f) {
      const bytes = f.mix.get(n)!;
      const shp = shpToFrames(bytes);
      // render subsampled frames (max 20), scaled 1x (drawn 2x in-game), packed into sheet
      const scale = 1;
      const step = Math.max(1, Math.ceil(shp.frames.length / 20));
      const frameIdxs: number[] = [];
      for (let i = 0; i < shp.frames.length; i += step) frameIdxs.push(i);
      if (frameIdxs[frameIdxs.length - 1] !== shp.frames.length - 1) frameIdxs.push(shp.frames.length - 1);
      const fw = shp.width * scale, fh = shp.height * scale;
      const cols = 5;
      const rows = Math.ceil(frameIdxs.length / cols);
      const sheet = new Uint8Array(fw * cols * rows * fh * 4);
      for (let si = 0; si < frameIdxs.length; si++) {
        const i = frameIdxs[si];
        const fr = shp.frames[i];
        if (!fr || fr.w === 0) continue;
        const rgba = renderShpFrameRGBA(fr, pal.unit, scale);
        const cx = (si % cols) * fw, cy = Math.floor(si / cols) * fh;
        for (let y = 0; y < Math.min(fr.h * scale, fh); y++) {
          for (let x = 0; x < Math.min(fr.w * scale, fw); x++) {
            const s = (y * fr.w * scale + x) * 4;
            const d = ((cy + y) * fw * cols + cx + x) * 4;
            sheet[d] = rgba[s]; sheet[d + 1] = rgba[s + 1]; sheet[d + 2] = rgba[s + 2]; sheet[d + 3] = rgba[s + 3];
          }
        }
      }
      await Bun.write(`${OUT}/buildings_mk/${id}_mk.png`, encodePNG(sheet, fw * cols, rows * fh));
      manifest[id + '_mk'] = { frames: frameIdxs.length, totalFrames: shp.frames.length, fw, fh, cols };
      console.log(`${id}_mk: ${n} ${frameIdxs.length}/${shp.frames.length} frames`);
      break;
    }
  }
}

// ============ INFANTRY ============
// extract ready(0-7) + walk frames + die frames as sheets
const infantry: [string, string][] = [
  ['E1', 'gi'], ['GI', 'gi'], ['CONS', 'conscript'], ['SHK', 'teslatrooper'], ['ENGINEER', 'engineer'],
  ['IVAN', 'crazyivan'], ['DESO', 'desolator'], ['DOG', 'dog'], ['ADOG', 'dog'], ['SPY', 'spy'],
  ['CLEG', 'chronolegion'], ['TANY', 'tanya'], ['SNIPE', 'sniper'], ['FLAKT', 'flaktrooper'],
   ['PTROOP', 'paratrooper'], ['YURI', 'yuri'],
];
console.log('== infantry ==');
const infantryManifest: Record<string, any> = {};
for (const [art, id] of infantry) {
  const n = art.toLowerCase() + '.shp';
  const f = findFile(n);
  if (!f) { console.log(`MISS: ${art}`); continue; }
  const bytes = f.mix.get(n)!;
  const shp = shpToFrames(bytes);
  const scale = 2;
  // sheet: 8 dirs x [ready(1) + walk(6)] = 56 frames grid 8 cols
  const walkStart = 8, walkPer = 6;
  const cols = 8, cellW = shp.width * scale, cellH = shp.height * scale;
  const rows = 1 + walkPer; // row0 = ready per dir, rows 1-6 = walk anim frames
  const sheet = new Uint8Array(cols * cellW * rows * cellH * 4);
  for (let dir = 0; dir < 8; dir++) {
    // ready
    const fr = shp.frames[dir];
    if (fr) {
      const rgba = renderShpFrameRGBA(fr, pal.unit, scale);
      for (let y = 0; y < fr.h * scale; y++) for (let x = 0; x < fr.w * scale; x++) {
        const s = (y * fr.w * scale + x) * 4;
        const d = (y * cols * cellW + dir * cellW + x) * 4;
        sheet[d] = rgba[s]; sheet[d+1] = rgba[s+1]; sheet[d+2] = rgba[s+2]; sheet[d+3] = rgba[s+3];
      }
    }
    // walk frames
    for (let wf = 0; wf < walkPer; wf++) {
      const fr2 = shp.frames[walkStart + dir * walkPer + wf];
      if (!fr2) continue;
      const rgba = renderShpFrameRGBA(fr2, pal.unit, scale);
      for (let y = 0; y < fr2.h * scale; y++) for (let x = 0; x < fr2.w * scale; x++) {
        const s = (y * fr2.w * scale + x) * 4;
        const d = ((1 + wf) * cellH + y) * cols * cellW + (dir * cellW + x) * 4;
        sheet[d] = rgba[s]; sheet[d+1] = rgba[s+1]; sheet[d+2] = rgba[s+2]; sheet[d+3] = rgba[s+3];
      }
    }
  }
  await Bun.write(`${OUT}/infantry/${id}.png`, encodePNG(sheet, cols * cellW, rows * cellH));
  infantryManifest[id] = { cellW, cellH, cols, rows: 1 + walkPer, walkPer, total: shp.frames.length };
  console.log(`${id}: ${n} ${shp.frames.length} frames, cell ${cellW}x${cellH}`);
}

// ============ ANIMATIONS ============
const anims: [string, string][] = [
  ['EXPLOLRG', 'explolrg'], ['EXPLOSML', 'explosml'], ['EXPLOMED', 'explomed'],
  ['S_BANG48', 's_bang48'], ['S_CLSN58', 's_clsn58'], ['S_TUMU60', 's_tumu60'],
  ['FIRE01', 'fire01'], ['FIRE02', 'fire02'], ['TWLT070', 'twlt070'], ['TWLT100', 'twlt100'],
  ['GUNFIRE', 'gunfire'], ['PIFF', 'piff'], ['PIFFPIFF', 'piffpiff'],
  ['NUKEANIM', 'nukeanim'], ['NUKEBALL', 'nukeball'], ['NUKEPUFF', 'nukepuff'],
  ['MININUKE', 'mininuke'], ['RING1', 'ring1'], ['SGRYSMK1', 'sgrysmk1'],
  ['H2O_EXP1', 'water_exp'], ['MLTIMISL', 'missiletrail'],
  ['ELECTRO', 'electro'], 
  ['DBRIS1LG', 'debris1lg'], ['DBRIS4LG', 'debris4lg'], ['DBRIS5SM', 'debris5sm'],
  
];
console.log('== anims ==');
for (const [art, id] of anims) {
  const n = art.toLowerCase() + '.shp';
  const f = findFile(n);
  if (!f) { console.log(`MISS: ${art}`); continue; }
  const bytes = f.mix.get(n)!;
  const shp = shpToFrames(bytes);
  const scale = 2;
  const fw = shp.width * scale, fh = shp.height * scale;
  const cols = 8;
  const rows = Math.ceil(shp.frames.length / cols);
  const sheet = new Uint8Array(fw * cols * rows * fh * 4);
  for (let i = 0; i < shp.frames.length; i++) {
    const fr = shp.frames[i];
    if (!fr || fr.w === 0) continue;
    const rgba = renderShpFrameRGBA(fr, pal.anim, scale);
    const cx = (si % cols) * fw, cy = Math.floor(si / cols) * fh;
    for (let y = 0; y < Math.min(fr.h * scale, fh); y++) for (let x = 0; x < Math.min(fr.w * scale, fw); x++) {
      const s = (y * fr.w * scale + x) * 4;
      const d = ((cy + y) * fw * cols + cx + x) * 4;
      sheet[d] = rgba[s]; sheet[d+1] = rgba[s+1]; sheet[d+2] = rgba[s+2]; sheet[d+3] = rgba[s+3];
    }
  }
  await Bun.write(`${OUT}/anims/${id}.png`, encodePNG(sheet, fw * cols, rows * fh));
  manifest['anim_' + id] = { frames: shp.frames.length, fw, fh, cols };
  console.log(`${id}: ${shp.frames.length} frames`);
}

// ============ ORE & GEMS & WALLS & TREES (SHP format .tem overlays) ============
console.log('== ore/gems/trees ==');
const overlayManifest: Record<string, any> = {};
const renderOverlay = async (mixName: string, n: string, id: string, outDir: string, frameIdx = 0, scale = 1) => {
  const mix = (M as any)[mixName];
  if (!mix || !mix.has(n)) return false;
  const bytes = mix.get(n)!;
  const shp = shpToFrames(bytes);
  const fr = shp.frames[frameIdx];
  if (!fr || fr.w === 0) return false;
  const rgba = renderShpFrameRGBA(fr, pal.temperat, scale);
  await Bun.write(`${OUT}/${outDir}/${id}.png`, encodePNG(rgba, fr.w * scale, fr.h * scale));
  overlayManifest[id] = { w: fr.w * scale, h: fr.h * scale, frames: shp.frames.length };
  return true;
};
for (let i = 1; i <= 12; i++) {
  const pad = String(i).padStart(2, '0');
  await renderOverlay('temperat', `tib${pad}.tem`, `tib${pad}`, 'ore');
  await renderOverlay('temperat', `gem${pad}.tem`, `gem${pad}`, 'ore');
}
// extra ore stages from tib13-20
for (let i = 13; i <= 20; i++) {
  const pad = String(i).padStart(2, '0');
  await renderOverlay('temperat', `tib${pad}.tem`, `tib${pad}`, 'ore');
}
// walls
await renderOverlay('temperat', 'gtwall.shp', 'gawall', 'walls', 0, 2);
await renderOverlay('temperat', 'nawall.shp', 'nawall', 'walls', 0, 2);
// trees & rocks
const treeIds = ['tree01','tree02','tree03','tree04','tree05','tree06','tree07','tree08','tree09','tree10','tree11','tree12','tree13','tree14','tree15','tree16','trock01','trock02','trock03','trock04','trock05','srock01','srock02','srock03','srock04','srock05','bigblue','burnt01','burnt05'];
for (const t of treeIds) {
  await renderOverlay('temperat', t + '.tem', t, 'trees');
}
console.log('overlays:', Object.keys(overlayManifest).length);

// ============ CAMEOS ============
console.log('== cameos ==');
const cameoArts: [string, string][] = [
  ['POWRICON', 'apower'], ['FACTICON', 'aconyard'], ['REFICON', 'arefinery'], ['WEAPICON', 'awarfactory'],
  ['BRRKICON', 'abarracks'], ['AIRCICON' as any, 'airforce'], ['PRISICON', 'prismtower'], ['PILLICON' as any, 'pillbox'],
  ['TECHICON', 'abattlelab'], ['FIXICON', 'arepair'], ['CSPHICON', 'chronosphere'], ['WETHICON', 'weather'],
  ['GAPICON', 'gapgen'],
  ['NPWRICON', 'spower'], ['CCOMICON', 'sconyard'], ['NREFICON', 'srefinery'], ['NWEPICON', 'swarfactory'],
  ['HANDICON', 'sbarracks'], ['NRADICON', 'sradar'], ['TSLAICON', 'teslacoil'], ['NTCHICON', 'sbattlelab'],
  ['RFIXICON', 'srepair'], ['NUKEICON', 'nuclearmissile'], ['FLAKICON', 'flakcannon'], ['IRONICON', 'ironcurtain'],
  ['GIICON', 'gi'], ['E2ICON', 'conscript'], ['SHKICON', 'teslatrooper'], ['ENGNICON', 'engineer'],
  ['IVANICON', 'crazyivan'], ['DESOICON', 'desolator'], ['DOGICON', 'dog'], ['SPYICON', 'spy'],
  ['CLEGICON', 'chronolegion'], ['TANYICON', 'tanya'], ['SNIPEICON' as any, 'sniper'], ['FLKTICON', 'flaktrooper'],
  ['HARVICON', 'harvester'], ['MCVICON', 'mcv'], ['MTNKICON', 'grizzly'], ['SREFICON', 'prismtank'],
  ['FVICON', 'ifv'], ['HTNKICON', 'rhino'], ['APOCICON' as any, 'apocalypse'], ['TTNKICON', 'teslatank'],
  ['V3ICON', 'v3'], ['DRONICON', 'dron'], ['AMCVICON' as any, 'mcv'], ['SQUADICON' as any, 'squd'],
  ['WALLICON', 'wall'], ['GAPGEN' as any, 'skip'],
];
const cameosManifest: Record<string, any> = {};
for (const [art, id] of cameoArts) {
  if (id === 'skip') continue;
  const n = art.toLowerCase() + '.shp';
  const f = findFile(n);
  if (!f) { console.log(`MISS cameo: ${art}`); continue; }
  const bytes = f.mix.get(n)!;
  const shp = shpToFrames(bytes);
  const fr = firstNonEmptyFrame(shp);
  if (!fr || fr.w === 0) continue;
  const rgba = renderShpFrameRGBA(fr, pal.cameo, 2);
  await Bun.write(`${OUT}/cameos/${id}.png`, encodePNG(rgba, fr.w * 2, fr.h * 2));
  cameosManifest[id] = { w: fr.w * 2, h: fr.h * 2 };
}
console.log('cameos extracted:', Object.keys(cameosManifest).length);

// ============ SIDEBAR UI ============
console.log('== sidebar ==');
const sidebarFiles = ['side1.shp', 'side2.shp', 'side3.shp', 'side2b.shp', 'tabs.shp', 'tab00.shp', 'tab01.shp', 'tab02.shp', 'tab03.shp',
  'power.shp', 'powerp.shp', 'pwrlvl.shp', 'radar.shp', 'radar01.shp', 'radar02.shp', 'repair.shp', 'sell.shp',
  'button00.shp', 'button01.shp', 'button02.shp', 'button03.shp', 'button04.shp', 'button05.shp', 'button06.shp',
  'button07.shp', 'button08.shp', 'button09.shp', 'button10.shp', 'button11.shp', 'bttnbkgd.shp', 'sidebttn.shp',
  'bkgdsm.shp', 'bkgdmd.shp', 'bkgdlg.shp', 'top.shp', 'lspacer.shp', 'lendcap.shp', 'rspacer.shp', 'rendcap.shp',
  'gclock2.shp', 'pbeacon.shp', 'rdrbeacn.shp', 'wayp.shp', 'r-up.shp', 'r-dn.shp', 'credits.shp', 'optbtn.shp', 'diplobtn.shp'];
const sidebarPal = new Pal(new Uint8Array(await Bun.file(A + '/pal/unittem.pal').arrayBuffer()));
for (const side of ['sidec01', 'sidec02'] as const) {
  const sideId = side === 'sidec01' ? 'allied' : 'soviet';
  const sm: Record<string, any> = {};
  for (const fn of sidebarFiles) {
    if (!M[side].has(fn)) continue;
    const bytes = M[side].get(fn)!;
    const shp = shpToFrames(bytes);
    const fr = firstNonEmptyFrame(shp);
    if (!fr || fr.w === 0) continue;
    const scale = 2;
    const rgba = renderShpFrameRGBA(fr, pal.lib, scale);
    const base = fn.replace('.shp', '');
    await Bun.write(`${OUT}/sidebar/${sideId}_${base}.png`, encodePNG(rgba, fr.w * scale, fr.h * scale));
    sm[base] = { w: fr.w * scale, h: fr.h * scale, frames: shp.frames.length };
  }
  manifest['sidebar_' + sideId] = sm;
  console.log(`${sideId} sidebar files:`, Object.keys(sm).length);
}

// ============ TERRAIN TILES ============
console.log('== terrain tiles ==');
const temperIni = await Bun.file(A + '/ini/temperat.ini').text();
const tileSets: { name: string; file: string; count: number }[] = [];
for (const m of temperIni.matchAll(/\[TileSet(\d+)\]\s*\n([^\[\]]*)/g)) {
  const body = m[2];
  const get = (k: string) => { const mm = body.match(new RegExp(k + '\\s*=\\s*(\\S+)', 'i')); return mm ? mm[1] : null; };
  tileSets.push({ name: get('SetName') ?? '?', file: (get('FileName') ?? '?').toLowerCase(), count: Number(get('TilesInSet') ?? 0) });
}
const wantedSets = new Set(['clear', 'clat', 'ruff', 'dlat', 'rough', 'pave', 'plat', 'proad', 'proadc', 'p_end', 'droads', 'droadc', 'droadj', 'water', 'shore', 'wcliff', 'cliff', 'mclif', 'slope', 'ramp', 'mslop', 'rmpfx', 'sandy', 'glat', 'green', 'blank', 'dcliff', 'drslpe', 'prslpe', 'pvclr', 'farm']);
const tilesManifest: Record<string, any> = {};
let tileCount = 0;
const extractTile = (n: string, id: string) => {
  if (!M.isotemp.has(n)) return false;
  const bytes = M.isotemp.get(n)!;
  const t = parseTmp(bytes);
  if (!t) return false;
  // gather ALL sub-cells (each is an iso tile variant)
  const cellIdxs: number[] = [];
  t.cells.forEach((c, i) => { if (c) cellIdxs.push(i); });
  if (!cellIdxs.length) return false;
  const cell = t.cells[cellIdxs[0]]!;
  const r = renderTileRGBA(cell, t.blockW, t.blockH, pal.iso);
  tilesManifest[id] = { w: r.w, h: r.h, set: id.replace(/[0-9].*/, ''), height: cell.tileHeight, cells: cellIdxs.length, baseName: id.replace(/[a-z]*$/, '') };
  tileCount++;
  return r;
};
for (const ts of tileSets) {
  if (ts.count === 0 || !wantedSets.has(ts.file)) continue;
  for (let i = 1; i <= ts.count; i++) {
    const pad2 = String(i).padStart(2, '0');
    const candidates = [ts.file + pad2 + '.tem'];
    for (let c = 97; c <= 122; c++) candidates.push(ts.file + pad2 + String.fromCharCode(c) + '.tem');
    for (const n of candidates) {
      if (!M.isotemp.has(n)) continue;
      const id = n.replace('.tem', '');
      const r = extractTile(n, id);
      if (r) {
        await Bun.write(`${OUT}/tiles/${id}.png`, encodePNG(r.rgba, r.w, r.h));
      }
      break; // only base variant per index for now (a-variants handled below)
    }
    // also extract letter variants as separate tiles
    for (let c = 97; c <= 122; c++) {
      const n = ts.file + pad2 + String.fromCharCode(c) + '.tem';
      if (!M.isotemp.has(n)) continue;
      const id = n.replace('.tem', '');
      const r = extractTile(n, id);
      if (r) await Bun.write(`${OUT}/tiles/${id}.png`, encodePNG(r.rgba, r.w, r.h));
    }
  }
}
console.log('tiles extracted:', tileCount, 'unique sets:', [...new Set(Object.values(tilesManifest).map((t: any) => t.set))].length);

// ============ MISC (cursor, pips) ============
console.log('== misc ==');
for (const [n, id] of [['mouse.shp', 'mouse'], ['pips.shp', 'pips'], ['progres.shp' as any, 'progres']]) {
  const f = findFile(n);
  if (!f) { console.log('MISS', n); continue; }
  const bytes = f.mix.get(n)!;
  const shp = shpToFrames(bytes);
  const cols = 16;
  const scale = 1;
  const fw = shp.width * scale, fh = shp.height * scale;
  const rows = Math.ceil(shp.frames.length / cols);
  const sheet = new Uint8Array(fw * cols * rows * fh * 4);
  for (let i = 0; i < shp.frames.length; i++) {
    const fr = shp.frames[i];
    if (!fr || fr.w === 0) continue;
    const rgba = renderShpFrameRGBA(fr, pal.unit, scale);
    const cx = (si % cols) * fw, cy = Math.floor(si / cols) * fh;
    for (let y = 0; y < Math.min(fr.h * scale, fh); y++) for (let x = 0; x < Math.min(fr.w * scale, fw); x++) {
      const s = (y * fr.w * scale + x) * 4;
      const d = ((cy + y) * fw * cols + cx + x) * 4;
      sheet[d] = rgba[s]; sheet[d+1] = rgba[s+1]; sheet[d+2] = rgba[s+2]; sheet[d+3] = rgba[s+3];
    }
  }
  await Bun.write(`${OUT}/misc/${id}.png`, encodePNG(sheet, fw * cols, rows * fh));
  manifest[id] = { frames: shp.frames.length, fw, fh, cols };
  console.log(`${id}: ${shp.frames.length} frames`);
}

await Bun.write(A + '/out/sprites_manifest.json', JSON.stringify({ manifest, infantry: infantryManifest, cameos: cameosManifest, tiles: tilesManifest }, null, 1));
console.log('\nDONE. Output in', OUT);
