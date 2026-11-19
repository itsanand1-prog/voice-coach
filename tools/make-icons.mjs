// Generates the app icons (PNG) with no dependencies: a teal tile with five white sound bars.
// Run: node tools/make-icons.mjs   (writes icons/icon-192.png, icon-512.png, icon-maskable-512.png)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const TEAL = [15, 106, 91];
const WHITE = [255, 255, 255];
const BARS = [0.35, 0.65, 1.0, 0.7, 0.45]; // relative bar heights: a voice-level shape

/**
 * @param size     pixels
 * @param maskable full-bleed background with the bars inside the central safe zone
 */
function draw(size, maskable) {
  const SS = 4; // supersampling per axis for smooth edges
  const px = new Uint8Array(size * size * 4);
  const corner = maskable ? 0 : 0.22; // rounded-square radius, as a share of size
  const content = maskable ? 0.5 : 0.62; // width taken by the bars
  const barW = content / (BARS.length * 2 - 1);
  const left = (1 - content) / 2;
  const maxH = content * 0.95;

  const inTile = (x, y) => {
    if (corner === 0) return true;
    const r = corner;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inBar = (x, y) => {
    for (let k = 0; k < BARS.length; k++) {
      const x0 = left + k * 2 * barW;
      if (x < x0 || x > x0 + barW) continue;
      const h = maxH * BARS[k];
      const r = barW / 2; // rounded bar ends
      const top = 0.5 - h / 2 + r;
      const bottom = 0.5 + h / 2 - r;
      const cy = Math.min(Math.max(y, top), bottom);
      return (x - (x0 + r)) ** 2 + (y - cy) ** 2 <= r * r;
    }
    return false;
  };

  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let tile = 0;
      let bar = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (inTile(x, y)) {
            tile++;
            if (inBar(x, y)) bar++;
          }
        }
      }
      const n = SS * SS;
      const a = tile / n;
      const w = tile ? bar / tile : 0;
      const i = (py * size + pxl) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(TEAL[c] * (1 - w) + WHITE[c] * w);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

// ---- minimal PNG encoder (RGBA, 8 bit) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(out + 'icon-192.png', draw(192, false));
writeFileSync(out + 'icon-512.png', draw(512, false));
writeFileSync(out + 'icon-maskable-512.png', draw(512, true));
console.log('icons written to', out);
