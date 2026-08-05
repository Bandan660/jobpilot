/**
 * Generates placeholder extension icons.
 *
 * Chrome refuses to load an extension whose manifest points at missing icon
 * files, so the repo needs real PNGs to be runnable after a fresh clone.
 * Replace these with actual artwork before publishing to the Web Store.
 *
 * Run: node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Dark rounded square with a white chevron - a stand-in, not a logo. */
function renderPixels(size) {
  const rows = [];
  const radius = size * 0.22;
  const cx = size / 2;

  for (let y = 0; y < size; y++) {
    // Each scanline is prefixed with a filter-type byte (0 = None).
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inCorner =
        (x < radius && y < radius && Math.hypot(radius - x, radius - y) > radius) ||
        (x >= size - radius && y < radius && Math.hypot(x - (size - radius), radius - y) > radius) ||
        (x < radius && y >= size - radius && Math.hypot(radius - x, y - (size - radius)) > radius) ||
        (x >= size - radius &&
          y >= size - radius &&
          Math.hypot(x - (size - radius), y - (size - radius)) > radius);

      if (inCorner) {
        row.push(0, 0, 0, 0);
        continue;
      }

      // Upward chevron, scaled to the canvas.
      const dx = Math.abs(x - cx);
      const thickness = size * 0.13;
      const apexY = size * 0.34;
      const expected = apexY + dx * 0.95;
      const onMark = Math.abs(y - expected) < thickness / 2 && dx < size * 0.3;

      if (onMark) row.push(255, 255, 255, 255);
      else row.push(17, 24, 39, 255);
    }
    rows.push(Buffer.from(row));
  }

  return Buffer.concat(rows);
}

function png(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(renderPixels(size))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  await writeFile(resolve(outDir, `icon${size}.png`), png(size));
}
console.log(`Wrote placeholder icons to ${outDir}`);
