// Convert THEME.MIX WAVs to MP3
import { openMix } from '/home/z/my-project/scripts/ra2lib.ts';
import { mkdirSync } from 'node:fs';
mkdirSync('/home/z/my-project/ra2assets/out/music', { recursive: true });
const theme = openMix('/home/z/my-project/ra2assets/THEME.MIX');
const tracks: Record<string, string> = {
  'hm2.wav': 'hellmarch2', 'grinder.wav': 'grinder', 'blowitup.wav': 'blowitup',
  '200meter.wav': '200meter', 'eaglehun.wav': 'eaglehunter', 'fortific.wav': 'fortification',
  'indeep.wav': 'indeep', 'industro.wav': 'industro', 'jank.wav': 'jank', 'motorize.wav': 'motorized',
  'power.wav': 'power', 'tension.wav': 'tension', 'burn.wav': 'burn', 'destroy.wav': 'destroy',
  'ra2-opt.wav': 'ra2opt', 'ra2-sco.wav': 'ra2sco',
};
for (const [src, id] of Object.entries(tracks)) {
  if (!theme.has(src)) { console.log('MISS', src); continue; }
  const bytes = theme.get(src)!;
  await Bun.write(`/tmp/music_${id}.wav`, bytes);
}
console.log('wavs extracted');
