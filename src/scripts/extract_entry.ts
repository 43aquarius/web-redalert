import { DataStream } from '/home/z/my-project/ts-redalert2/src/data/DataStream';
import { MixFile } from '/home/z/my-project/ts-redalert2/src/data/MixFile';

// extract entries by hash from a mix to files
const [mixPath, outDir] = process.argv.slice(2);
const buf = await Bun.file(mixPath).arrayBuffer();
const mix = new MixFile(new DataStream(buf));
const index = (mix as any).index as Map<number, any>;
const dataStart = (mix as any).dataStart as number;
const stream = (mix as any).stream as DataStream;
const which = process.argv[4] ?? 'all'; // 'all' | 'big' | comma-separated hashes
let entries = [...index.values()].sort((a,b)=>a.offset-b.offset);
if (which === 'big') entries = entries.filter(e => e.length > 1000000 && !['0x55DE03CC','0xF5D1D99','0xB3080BD2','0xBCCC4D97','0x80E03363','0xA8548FD9','0xDD991D13','0x5B0D6FBD','0xA226651E','0xD71EBCFD','0x40B4C119','0x92144015','0x5AA5B016','0xD91501E','0xF160BD3B'].includes('0x'+e.hash.toString(16).toUpperCase()));
for (const e of entries) {
  stream.seek(dataStart + e.offset);
  const bytes = stream.readUint8Array(e.length);
  const name = 'hash_' + e.hash.toString(16).toUpperCase() + '_' + e.length;
  await Bun.write(outDir + '/' + name, bytes);
  // sniff first bytes
  const head = Array.from(bytes.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`${e.length.toString().padStart(9)}  0x${e.hash.toString(16).toUpperCase()}  head=[${head}]`);
}
