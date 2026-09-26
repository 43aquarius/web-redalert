// Parse rules.ini + art.ini + csf into a compact game-data JSON for the web engine
import { IniParser } from './iniparse';

const A = '/home/z/my-project/ra2assets';
const rulesSrc = await Bun.file(A + '/ini/rules.ini').text();
const artSrc = await Bun.file(A + '/ini/art.ini').text();

// ---------- parse INI ----------
const rules = new IniParser(rulesSrc).parse();
const art = new IniParser(artSrc).parse();

// ---------- curated roster ----------
const ROSTER = {
  buildings: {
    // id: rulesKey
    aconyard: 'GACNST', apower: 'GAPOWR', arefinery: 'GAREFN', awarfactory: 'GAWEAP',
    abarracks: 'GAPILE', airforce: 'GAAIRC', prismtower: 'ATESLA', pillbox: 'GAPILL',
    abattlelab: 'GATECH', arepair: 'GADEPT', chronosphere: 'GACSPH', weather: 'GAWEAT',
    gapgen: 'GAGAP', anavyard: 'GAYARD',
    sconyard: 'NACNST', spower: 'NAPOWR', srefinery: 'NAREFN', swarfactory: 'NAWEAP',
    sbarracks: 'NAHAND', sradar: 'NARADR', teslacoil: 'TESLA', sbattlelab: 'NATECH',
    srepair: 'NADEPT', nuclearmissile: 'NAMISL', flakcannon: 'NAFLAK', snavyard: 'NAYARD',
    ironcurtain: 'NAIRON',
  },
  vehicles: {
    harvester: 'HARV', mcv: 'AMCV', smcv: 'SMCV',
    rhino: 'HTNK', grizzly: 'MTNK', teslatank: 'TTNK', prismtank: 'SREF',
    ifv: 'FV', v3launcher: 'V3', ltnk: 'LTNK', htk: 'HTK',
    harrier: 'SHAD', kirov: 'ZEP',
  },
  infantry: {
    gi: 'E1', conscript: 'E2', teslatrooper: 'SHK',
    engineer: 'ENGINEER', crazyivan: 'IVAN', desolator: 'DESO', dog: 'DOG',
    spy: 'SPY', chronolegion: 'CLEG', tanya: 'TANY', sniper: 'SNIPE', flaktrooper: 'FLAKT',
  },
};

const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const n = parseFloat(v.replace('%', ''));
  return isNaN(n) ? d : n;
};

// ---------- weapons ----------
const weapons: Record<string, any> = {};
for (const [name, sec] of Object.entries(rules.sections)) {
  if (!sec) continue;
  // heuristic: weapon sections have Damage + ROF + Warhead
  if (sec.Damage !== undefined && sec.Warhead !== undefined) {
    weapons[name.toLowerCase()] = {
      damage: num(sec.Damage), rof: num(sec.ROF, 50), range: num(sec.Range, 5),
      speed: num(sec.Speed, 100), warhead: (sec.Warhead ?? '').toLowerCase(),
      burst: num(sec.Burst, 1), report: sec.Report, anim: sec.Anim,
      projectile: (sec.Projectile ?? '').toLowerCase(),
    };
  }
}
// warheads: verses vs armor types
const warheads: Record<string, any> = {};
for (const [name, sec] of Object.entries(rules.sections)) {
  if (!sec || sec.Verses === undefined) continue;
  const verses = String(sec.Verses).split(',').map(s => num(s, 100) / 100);
  warheads[name.toLowerCase()] = {
    verses, spread: num(sec.CellSpread, 0),
    vs_inf: verses[0] ?? 1, vs_armor_light: verses[4] ?? 1, // indices: none,flak,plate,light,medium,heavy,wood,steel,concrete,special
  };
}

// ---------- buildings ----------
const buildings: Record<string, any> = {};
for (const [id, key] of Object.entries(ROSTER.buildings)) {
  const sec = rules.sections[key];
  if (!sec) { console.log('MISSING building rules:', key); continue; }
  const owner = String(sec.Owner ?? '');
  const side = owner.includes('Russians') || owner.includes('Confederation') || owner.includes('Africans') || owner.includes('Arabs') ? 'soviet' : (id.startsWith('s') ? 'soviet' : 'allied');
  const fact = sec.Factory;
  buildings[id] = {
    name_key: sec.UIName ?? ('Name:' + key),
    cost: num(sec.Cost), strength: num(sec.Strength, 100),
    power: num(sec.Power, 0), // positive = produces, negative = drains? (RA2: Power=negative for drain? no: Power positive gen;Powered consumes via... actually "Power=" is generation; drain is via Power negative? In RA2 Power= is generation amount; consumers have "Power=" absent and drain = ??? Hmm — actually RA2 uses Power= positive for gen, negative for drain!)
    sight: num(sec.Sight, 4),
    armor: (sec.Armor ?? 'wood').toLowerCase(),
    prereq: String(sec.Prerequisite ?? '').split(',').filter(Boolean),
    tech: num(sec.TechLevel, 1),
    side,
    size: (art.sections[key]?.Foundation ?? sec.Foundation ?? '1x1'),
    factory: fact ? String(fact).toLowerCase() : null,
    requirespower: /yes/i.test(sec.RequiresPower ?? 'no'),
    superweapon: sec.Type ? String(sec.Type) : null,
    adjacent: num(sec.Adjacent, 2),
    buildcat: sec.BuildCat ? String(sec.BuildCat).toLowerCase() : null,
    crewed: /yes/i.test(sec.Crewed ?? 'no'),
    wall: /yes/i.test(sec.Wall ?? 'no'),
  };
}

// ---------- vehicles ----------
const vehicles: Record<string, any> = {};
for (const [id, key] of Object.entries(ROSTER.vehicles)) {
  const sec = rules.sections[key];
  if (!sec) { console.log('MISSING vehicle rules:', key); continue; }
  const owner = String(sec.Owner ?? '');
  const side = /Russian|Confederation|African|Arab/i.test(owner) ? 'soviet' : 'allied';
  vehicles[id] = {
    name_key: sec.UIName ?? ('Name:' + key),
    cost: num(sec.Cost), strength: num(sec.Strength, 100),
    speed: num(sec.Speed, 4), sight: num(sec.Sight, 5),
    armor: (sec.Armor ?? 'light').toLowerCase(),
    prereq: String(sec.Prerequisite ?? '').split(',').filter(Boolean),
    tech: num(sec.TechLevel, 1),
    side,
    weapon: (sec.Primary ?? sec.Weapon ?? '').toLowerCase() || null,
    weapon2: (sec.Secondary ?? '').toLowerCase() || null,
    turret: !!art.sections[key]?.Turret,
    isAircraft: art.sections[key]?.Voxel !== undefined && /yes/i.test(String(art.sections[key]?.Jumpjet ?? 'no')),
  };
}

// ---------- infantry ----------
const infantry: Record<string, any> = {};
for (const [id, key] of Object.entries(ROSTER.infantry)) {
  let sec = rules.sections[key];
  let artSec = art.sections[key];
  if (!sec) { console.log('MISSING infantry rules:', key); continue; }
  const owner = String(sec.Owner ?? '');
  const side = /Russian|Confederation|African|Arab/i.test(owner) ? 'soviet' : 'allied';
  infantry[id] = {
    name_key: sec.UIName ?? ('Name:' + key),
    cost: num(sec.Cost), strength: num(sec.Strength, 50),
    speed: num(sec.Speed, 4), sight: num(sec.Sight, 5),
    armor: (sec.Armor ?? 'flak').toLowerCase(),
    prereq: String(sec.Prerequisite ?? '').split(',').filter(Boolean),
    tech: num(sec.TechLevel, 1),
    side,
    weapon: (sec.Primary ?? sec.Weapon ?? '').toLowerCase() || null,
    weapon2: (sec.Secondary ?? '').toLowerCase() || null,
  };
}

// ---------- superweapons ----------
const superweapons: Record<string, any> = {};
for (const [name, sec] of Object.entries(rules.sections)) {
  if (!sec || sec.Type === undefined || sec.RechargeTime === undefined) continue;
  superweapons[name.toLowerCase()] = {
    type: sec.Type, recharge: num(sec.RechargeTime, 600),
    range: num(sec.Range, 5), damage: num(sec.Damage ?? '0'),
  };
}

// ---------- CSF strings (find-based robust parse) ----------
const csfData = new Uint8Array(await Bun.file(A + '/inner/ra2.csf').arrayBuffer());
const strings: Record<string, string> = {};
{
  const dv = new DataView(csfData.buffer, csfData.byteOffset, csfData.byteLength);
  const LBL = [0x20, 0x4c, 0x42, 0x4c]; // " LBL"
  let p = 24;
  while (p + 12 < csfData.byteLength) {
    // find next " LBL"
    if (csfData[p] !== LBL[0] || csfData[p+1] !== LBL[1] || csfData[p+2] !== LBL[2] || csfData[p+3] !== LBL[3]) { p++; continue; }
    let q = p + 4;
    const numValues = dv.getUint32(q, true); q += 4;
    const nameLen = dv.getUint32(q, true); q += 4;
    if (numValues > 4 || nameLen > 256 || q + nameLen > csfData.byteLength) { p++; continue; }
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(csfData[q + i]);
    q += nameLen;
    let value = '';
    for (let c = 0; c < numValues; c++) {
      if (q + 8 > csfData.byteLength) break;
      const m2 = String.fromCharCode(csfData[q+1], csfData[q+2], csfData[q+3]);
      if (m2 !== 'RTS' && m2 !== 'STR') break;
      const wide = m2 === 'RTS';
      q += 4;
      const vlen = dv.getUint32(q, true); q += 4;
      if (vlen > 4096 || q + vlen > csfData.byteLength) break;
      // this repack writes vlen as CHAR COUNT for wide strings: bytes = vlen*2
      const vbytes = wide ? vlen * 2 : vlen;
      const out = new Uint8Array(vbytes);
      for (let j = 0; j < vbytes; j++) out[j] = csfData[q + j] ^ 0xff;
      q += vbytes;
      if (wide && vbytes % 2 === 0) {
        const u16 = new Uint16Array(out.buffer, out.byteOffset, vbytes / 2);
        let s = '';
        for (const ch of u16) s += String.fromCharCode(ch);
        value = s;
      } else {
        value = Buffer.from(out).toString('latin1');
      }
    }
    if (name && value) strings[name] = value;
    p = q;
  }
}
console.log('csf strings parsed:', Object.keys(strings).length);

// resolve UI names
const resolveName = (k: string) => {
  const key = k.replace(/^Name:/, '');
  return strings[key] ?? strings['Name:' + key] ?? key;
};
for (const b of Object.values(buildings)) b.name = resolveName(b.name_key);
for (const v of Object.values(vehicles)) v.name = resolveName(v.name_key);
for (const i of Object.values(infantry)) i.name = resolveName(i.name_key);

// ---------- global constants ----------
const general = rules.sections.General ?? {};
const combat = rules.sections.CombatDamage ?? {};

const gameData = {
  general: {
    buildSpeed: num(general.BuildSpeed, 0.7),
    refundPercent: num(general.RefundPercent, 50),
    repairStep: num(general.RepairStep, 8),
    growthRate: num(general.GrowthRate, 5),
    harvestersPerRefinery: num(general.HarvestersPerRefinery, 2),
  },
  buildings, vehicles, infantry, weapons, warheads, superweapons, strings,
};

await Bun.write(A + '/out/game_data.json', JSON.stringify(gameData));
console.log('game_data.json written');
console.log('buildings:', Object.keys(buildings).length, 'vehicles:', Object.keys(vehicles).length, 'infantry:', Object.keys(infantry).length, 'weapons:', Object.keys(weapons).length);

// sample outputs
console.log('\n=== sample: rhino ===');
console.log(JSON.stringify(vehicles.rhino, null, 1));
console.log(JSON.stringify(weapons[vehicles.rhino.weapon], null, 1));
console.log('\n=== sample: teslacoil ===');
console.log(JSON.stringify(buildings.teslacoil, null, 1));
