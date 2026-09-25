// 校验代码中引用的所有音频文件是否存在
const fs = require('fs');
const path = require('path');
const PUB = '/home/z/my-project/public/audio';

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(PUB);
const rels = new Set([...files].map(f => path.relative(PUB, f).replace(/\\/g, '/')));

const src = fs.readFileSync('/home/z/my-project/src/game/audio.ts', 'utf8');
const missing = [];

// EVA lines
const evaMatches = [...src.matchAll(/file: '(eva\/[^']+)'/g)];
evaMatches.forEach(m => { if (!rels.has(m[1] + '.wav')) missing.push(m[1]); });

// VOICE_SETS
const voiceMatches = [...src.matchAll(/'(\/?[a-z0-9_-]+)'/g)];
// 提取所有形如 voices/ 引用: 解析 VOICE_SETS 块
const vsBlock = src.slice(src.indexOf('VOICE_SETS'), src.indexOf('export const MUSIC_TRACKS'));
const nameMatches = [...vsBlock.matchAll(/\[([^\]]+)\]/g)];
nameMatches.forEach(m => {
  const items = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  items.forEach(it => {
    if (it.includes("'")) return;
    if (!rels.has('voices/' + it + '.wav')) missing.push('voices/' + it);
  });
});

// MUSIC
const musicBlock = src.slice(src.indexOf('MUSIC_TRACKS'));
[...musicBlock.matchAll(/file: '(music\/[^']+)'/g)].forEach(m => {
  if (!rels.has(m[1] + '.mp3')) missing.push(m[1]);
});

// SFX: 从其他源文件收集 playSfx('xxx') 与 report: 'xxx'
const gameSrc = ['entities.ts', 'game.ts', 'title.ts', 'fx.ts', 'sidebar.ts', 'data.ts'].map(f =>
  fs.readFileSync('/home/z/my-project/src/game/' + f, 'utf8')).join('\n');
[...gameSrc.matchAll(/playSfx\('([a-z0-9-]+)'/g)].forEach(m => {
  if (!rels.has('sfx/' + m[1] + '.wav')) missing.push('sfx/' + m[1]);
});
[...gameSrc.matchAll(/report: '([a-z0-9-]+)'/g)].forEach(m => {
  if (!rels.has('sfx/' + m[1] + '.wav')) missing.push('sfx/' + m[1]);
});

console.log('缺失的音频引用 (' + missing.length + '):');
[...new Set(missing)].forEach(m => console.log(' -', m));
console.log('\n音频总文件数:', rels.size);
