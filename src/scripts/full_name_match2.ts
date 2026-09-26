import { DataStream } from '/home/z/my-project/ts-redalert2/src/data/DataStream';
import { MixFile } from '/home/z/my-project/ts-redalert2/src/data/MixFile';
import { MixEntry } from '/home/z/my-project/ts-redalert2/src/data/MixEntry';

const artIni = await Bun.file('/home/z/my-project/ra2assets/ini/art.ini').text();
const rulesIni = await Bun.file('/home/z/my-project/ra2assets/ini/rules.ini').text();
const temperIni = await Bun.file('/home/z/my-project/ra2assets/ini/temperat.ini').text();

const bases = new Set<string>();
const addBase = (s: string) => { const t = s.trim().toLowerCase(); if (t && /^[a-z0-9_\-]+$/i.test(t)) bases.add(t); };
for (const line of artIni.split('\n')) {
  const m = line.match(/^\[([^\]]+)\]/); if (m) addBase(m[1]);
  const kv = line.match(/^\s*([A-Za-z]+)\s*=\s*([A-Za-z0-9_\-]+)/);
  if (kv && ['Image','Voxel','Cameo','AltCameo','Buildup','Remap'].includes(kv[1])) addBase(kv[2]);
}
for (const line of rulesIni.split('\n')) {
  const m = line.match(/^\s*\d+\s*=\s*([A-Za-z0-9_\-]+)/); if (m) addBase(m[1]);
}
// NewTheater: second char is placeholder; variants: t (temperate), g (generic), s, u, a
const theaterVariants = (name: string): string[] => {
  if (name.length < 2) return [name];
  const first = name[0];
  const second = name[1];
  if (['g','n','c','y'].includes(first) && ['a','t','u','d','l','n','g'].includes(second)) {
    return ['t','g','s','u','a'].map(ch => first + ch + name.slice(2)).concat([name]);
  }
  return [name];
};
const exts = ['.shp', '.vxl', '.hva', '.tem', '.pcx', '.pal', '.wsp', '.wav'];
const candidates = new Set<string>();
for (const b of bases) {
  for (const v of theaterVariants(b)) {
    for (const ext of exts) candidates.add(v + ext);
    candidates.add(v + 'tur.vxl'); candidates.add(v + 'tur.hva');
    candidates.add(v + 'barrel.vxl'); candidates.add(v + 'barrel.hva');
    candidates.add(v + 'wak.shp'); candidates.add(v + 'muf.shp');
  }
}
for (const m of temperIni.matchAll(/FileName\s*=\s*(\S+)/gi)) {
  const fn = m[1].toLowerCase();
  for (let i = 1; i <= 60; i++) {
    const pad2 = String(i).padStart(2, '0');
    candidates.add(fn + pad2 + '.tem');
    for (let c = 97; c <= 122; c++) candidates.add(fn + pad2 + String.fromCharCode(c) + '.tem');
  }
}
const sidebar = ['addon.shp','bkgdlg.shp','bkgdmd.shp','bkgdsm.shp','bttnbkgd.shp','button00.shp','button01.shp','button02.shp','button03.shp','button04.shp','button05.shp','button06.shp','button07.shp','button08.shp','button09.shp','button10.shp','button11.shp','credits.shp','diplobtn.shp','gclock2.shp','key.ini','lendcap.shp','lspacer.shp','optbtn.shp','pbeacon.shp','power.shp','powerp.shp','pwrlvl.shp','radar.shp','radar01.shp','radar02.shp','r-dn.shp','rdrbeacn.shp','rendcap.shp','repair.shp','r-up.shp','side1.shp','side2.shp','side2b.shp','side3.shp','sidebar.pal','sidebttn.shp','tab00.shp','tab01.shp','tab02.shp','tab03.shp','tabs.shp','top.shp','uibkgd.pal','wayp.shp'];
for (const s of sidebar) candidates.add(s);
for (const w of ['200meter','blowitup','burn','destroy','eaglehun','fortific','grinder','hm2','indeep','industro','jank','motorize','power','ra2-opt','ra2-sco','tension']) candidates.add(w + '.wav');
for (const p of ['isotem.pal','unittem.pal','temperat.pal','libtem.pal','uibkgd.pal','sidebar.pal','cameo.pal','mouse.pal','anim.pal','alpha.pal','pulse.pal']) candidates.add(p);

console.log('candidates:', candidates.size);
const hash2name = new Map<number, string>();
for (const c of candidates) hash2name.set(MixEntry.hashFilename(c), c);

const mixFiles: Record<string, string> = {
  local: '/home/z/my-project/ra2assets/inner/local.mix',
  conquer: '/home/z/my-project/ra2assets/inner/conquer.mix',
  generic: '/home/z/my-project/ra2assets/inner/generic.mix',
  temperat: '/home/z/my-project/ra2assets/inner/temperat.mix',
  tem: '/home/z/my-project/ra2assets/inner/tem.mix',
  isotemp: '/home/z/my-project/ra2assets/inner/isotemp.mix',
  isogen: '/home/z/my-project/ra2assets/inner/isogen.mix',
  cameo: '/home/z/my-project/ra2assets/inner/cameo.mix',
  sidec01: '/home/z/my-project/ra2assets/inner/sidec01.mix',
  sidec02: '/home/z/my-project/ra2assets/inner/sidec02.mix',
  unk196: '/home/z/my-project/ra2assets/unknown/blob196.bin',
  unk25: '/home/z/my-project/ra2assets/unknown/hash_BC80C10F_25478184',
  unk45: '/home/z/my-project/ra2assets/unknown/hash_7B512B17_45571600',
  unk7a: '/home/z/my-project/ra2assets/unknown/hash_330A4ADF_6935164',
  unk7b: '/home/z/my-project/ra2assets/unknown/hash_74AA300F_6974140',
  theme: '/home/z/my-project/ra2assets/THEME.MIX',
};
const result: Record<string, { named: Record<string, number>; unnamed: number; total: number }> = {};
for (const [name, path] of Object.entries(mixFiles)) {
  const data = new Uint8Array(require('node:fs').readFileSync(path));
  const mix = new MixFile(new DataStream(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  const index = (mix as any).index as Map<number, any>;
  const named: Record<string, number> = {};
  let unnamed = 0;
  for (const [h, e] of index) {
    const n = hash2name.get(h);
    if (n) named[n] = e.length; else unnamed++;
  }
  result[name] = { named, unnamed, total: index.size };
  console.log(`${name}: ${index.size} entries, ${Object.keys(named).length} named, ${unnamed} unknown`);
}
await Bun.write('/home/z/my-project/ra2assets/mix_contents.json', JSON.stringify(result));
