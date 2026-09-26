// ============================================================
// Build script: compile game source + assets → single HTML
// ============================================================
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';

const A = '/home/z/my-project/ra2assets';
const OUT = '/home/z/my-project/download';
const SRC = '/home/z/my-project/scripts/game_src';
mkdirSync(OUT, { recursive: true });

// ---------- load source parts ----------
const parts = ['01_core.js', '02_map.js', '03_entities.js', '04_game.js', '05_ai.js', '06_render.js', '07_ui.js', '08_main.js']
  .map(f => readFileSync(`${SRC}/${f}`, 'utf8')).join('\n;\n');
const css = readFileSync(`${SRC}/style.css`, 'utf8');

// ---------- asset collection ----------
const files = {};  // id -> dataURL
const b64 = (path) => 'data:image/png;base64,' + readFileSync(path).toString('base64');
const b64audio = (path) => {
  const ext = path.endsWith('.mp3') ? 'mpeg' : 'wav';
  return `data:audio/${ext};base64,` + readFileSync(path).toString('base64');
};

// tiles
const TILE_WHITELIST = new Set();
for (const f of readdirSync(`${A}/out/tiles`)) TILE_WHITELIST.add(f.replace('.png', ''));
for (const f of readdirSync(`${A}/out/tiles`)) {
  const id = f.replace('.png', '');
  files['tile_' + id] = b64(`${A}/out/tiles/${f}`);
}
console.log('tiles:', Object.keys(files).length);

// buildings + buildups
for (const f of readdirSync(`${A}/out/buildings`)) {
  files['bld_' + f.replace('.png', '')] = b64(`${A}/out/buildings/${f}`);
}
const mkMeta = {};
for (const f of readdirSync(`${A}/out/buildings_mk`)) {
  const id = f.replace('.png', '').replace('_mk', '');
  files['mk_' + id] = b64(`${A}/out/buildings_mk/${f}`);
}
console.log('buildings:', readdirSync(`${A}/out/buildings`).length, 'mk:', readdirSync(`${A}/out/buildings_mk`).length);

// infantry
const INFANTRY_META = {};
for (const f of readdirSync(`${A}/out/infantry`)) {
  const id = f.replace('.png', '');
  files['inf_' + id] = b64(`${A}/out/infantry/${f}`);
}
// use manifest for meta
const spriteManifest = JSON.parse(readFileSync(`${A}/out/sprites_manifest.json`, 'utf8'));
for (const [id, m] of Object.entries(spriteManifest.infantry)) {
  INFANTRY_META[id] = { cellW: m.cellW, cellH: m.cellH, walkPer: m.walkPer };
}

// vehicles
const VEHICLE_META = {};
const vehManifest = JSON.parse(readFileSync(`${A}/out/vehicles_manifest.json`, 'utf8'));
for (const f of readdirSync(`${A}/out/vehicles`)) {
  const id = f.replace('.png', '');
  files['veh_' + id] = b64(`${A}/out/vehicles/${f}`);
}
for (const [id, m] of Object.entries(vehManifest)) {
  VEHICLE_META[id] = { cellW: m.cellW, cellH: m.cellH, cols: m.cols };
}

// anims
const ANIM_META = {};
for (const f of readdirSync(`${A}/out/anims`)) {
  const id = f.replace('.png', '');
  files['anim_' + id] = b64(`${A}/out/anims/${f}`);
}
const animList = JSON.parse(readFileSync(`${A}/out/sprites_manifest.json`, 'utf8')).manifest;
for (const [k, m] of Object.entries(animList)) {
  if (k.startsWith('anim_')) {
    ANIM_META[k.slice(5)] = { fw: m.fw, fh: m.fh, cols: m.cols, frames: m.frames };
  }
}
// fill missing anim metas from known frame counts
for (const [id, frames] of Object.entries({ explolrg: 21, explosml: 14, explomed: 15, s_bang48: 23, s_clsn58: 21, s_tumu60: 21, fire01: 30, fire02: 64, twlt070: 26, twlt100: 21, gunfire: 4, piff: 7, piffpiff: 12, nukeanim: 39, nukeball: 20, nukepuff: 20, mininuke: 39, ring1: 21, sgrysmk1: 20, water_exp: 16, missiletrail: 46, electro: 15, debris1lg: 15, debris4lg: 15, debris5sm: 15 })) {
  ANIM_META[id] ??= { fw: 120, fh: 110, cols: 8, frames };
}

// ore/gems
for (const f of readdirSync(`${A}/out/ore`)) {
  files['ore_' + f.replace('.png', '')] = b64(`${A}/out/ore/${f}`);
}
// trees
for (const f of readdirSync(`${A}/out/trees`)) {
  files['tree_' + f.replace('.png', '')] = b64(`${A}/out/trees/${f}`);
}
// cameos
for (const f of readdirSync(`${A}/out/cameos`)) {
  files['cam_' + f.replace('.png', '')] = b64(`${A}/out/cameos/${f}`);
}
// sidebar
for (const f of readdirSync(`${A}/out/sidebar`)) {
  files['ui_side_' + f.replace('.png', '')] = b64(`${A}/out/sidebar/${f}`);
}
// misc
for (const f of readdirSync(`${A}/out/misc`)) {
  files['misc_' + f.replace('.png', '')] = b64(`${A}/out/misc/${f}`);
}

// music
for (const f of readdirSync(`${A}/out/music`)) {
  files['music_' + f.replace('.mp3', '')] = b64audio(`${A}/out/music/${f}`);
}

// ---------- sounds ----------
const SOUNDS = {};
try {
  const soundMap = JSON.parse(readFileSync(`${A}/out/sound_map.json`, 'utf8'));
  for (const [k, file] of Object.entries(soundMap)) {
    try {
      SOUNDS[k] = b64audio(`${A}/audio/${file}.wav`);
    } catch (e) {}
  }
} catch (e) { console.log('no sound map yet'); }
console.log('sounds mapped:', Object.keys(SOUNDS).length);

// ---------- game data ----------
const gameData = JSON.parse(readFileSync(`${A}/out/game_data.json`, 'utf8'));
// attach mk meta to building defs
const mkAnims = readdirSync(`${A}/out/buildings_mk`).map(f => f.replace('.png', '').replace('_mk', ''));
for (const id of mkAnims) {
  if (gameData.buildings[id]) {
    gameData.buildings[id]._mk = true;
  }
}

// ---------- write html ----------
const payload = {
  files,
  data: gameData,
  animMeta: ANIM_META,
  vehicleMeta: VEHICLE_META,
  infantryMeta: INFANTRY_META,
  sounds: SOUNDS,
};

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>红色警戒 · Red Alert Web</title>
<style>
${css}
</style>
</head>
<body>
<script>
window.__RA2_FILES__ = ${JSON.stringify(payload.files)};
window.__RA2_DATA__ = ${JSON.stringify(payload.data)};
window.__ANIM_META__ = ${JSON.stringify(payload.animMeta)};
window.__VEHICLE_META__ = ${JSON.stringify(payload.vehicleMeta)};
window.__INFANTRY_META__ = ${JSON.stringify(payload.infantryMeta)};
window.__RA2_SOUNDS__ = ${JSON.stringify(payload.sounds)};
</script>
<script>
${parts}
</script>
</body>
</html>`;

const outPath = `${OUT}/red-alert.html`;
await Bun.write(outPath, html);
const size = statSync(outPath).size;
console.log(`\nWritten: ${outPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`images: ${Object.keys(files).length - Object.keys(payload.files).filter(k => k.startsWith('music_')).length}, music: ${Object.keys(files).filter(k => k.startsWith('music_')).length}, sounds: ${Object.keys(SOUNDS).length}`);
