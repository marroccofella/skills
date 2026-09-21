// Synthetic containers for offline transport tests; not live perception evidence.
import { syntheticPng, crc32 } from './probes.mjs';
export const JPEG = Buffer.from([255,216,255,192,0,8,8,0,1,0,1,1,255,218,0,6,1,1,0,0,1,255,217]);
export const MP4 = Buffer.from('000000146674797069736f6d0000000069736f6d000000096d64617400000000086d6f6f76', 'hex');
export function fixturePng(label = 'synthetic') {
  const png = syntheticPng('red'), data = Buffer.from('Fixture\0' + label), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write('tEXt', 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
