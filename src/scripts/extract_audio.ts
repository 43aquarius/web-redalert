// Extract all WAVs from the audio blob (TD-style mix) and catalog durations
import { DataStream } from '/home/z/my-project/ts-redalert2/src/data/DataStream';
import { MixFile } from '/home/z/my-project/ts-redalert2/src/data/MixFile';
import { MixEntry } from '/home/z/my-project/ts-redalert2/src/data/MixEntry';

const data = new Uint8Array(await Bun.file('/home/z/my-project/ra2assets/unknown/lang_blob37.bin').arrayBuffer());
const mix = new MixFile(new DataStream(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
const index = (mix as any).index as Map<number, any>;
const stream = (mix as any).stream as DataStream;
const dataStart = (mix as any).dataStart as number;

const outDir = '/home/z/my-project/ra2assets/audio';
await Bun.write(outDir + '/.keep', '');
const catalog: { hash: number; len: number; dur: number }[] = [];
let i = 0;
for (const e of [...index.values()].sort((a, b) => a.offset - b.offset)) {
  stream.seek(dataStart + e.offset);
  const b = stream.readUint8Array(e.length);
  const dv = new DataView(b.buffer, b.byteOffset, Math.min(b.byteLength, 44));
  const rate = dv.getUint32(24, true);
  const fmt = dv.getUint16(20, true);
  let dur = 0;
  if (fmt === 17) dur = (e.length - 60) / (rate / 4); // ima adpcm 4-bit
  else if (fmt === 1) dur = (e.length - 44) / (rate * 2);
  catalog.push({ hash: e.hash, len: e.length, dur });
  const name = String(i).padStart(3, '0') + '.wav';
  await Bun.write(`${outDir}/${name}`, b);
  i++;
}
await Bun.write(outDir + '/catalog.json', JSON.stringify(catalog));
const speech = catalog.filter(c => c.dur > 0.7 && c.dur < 8).length;
const sfx = catalog.filter(c => c.dur <= 0.7).length;
const long = catalog.filter(c => c.dur >= 8).length;
console.log(`total: ${catalog.length}, sfx(<0.7s): ${sfx}, speech(0.7-8s): ${speech}, long(>8s): ${long}`);
