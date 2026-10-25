// Vygeneruje PNG ikonky (oranžové pozadie, tanier s príborom) bez externých knižníc.
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

const inRRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

// Farba v bode (u,v ∈ 0..1)
function color(u, v) {
  const BG = [194, 65, 12], WHITE = [255, 255, 255], PLATE = [253, 238, 228], DARK = [90, 30, 6];
  let c = BG;
  if (inCircle(u, v, 0.5, 0.5, 0.27)) c = WHITE;                           // tanier
  if (inCircle(u, v, 0.5, 0.5, 0.19)) c = PLATE;
  if (inRRect(u, v, 0.15, 0.42, 0.18, 0.8, 0.012)) c = WHITE;              // vidlička – rúčka
  for (const x of [0.12, 0.155, 0.19]) if (inRRect(u, v, x, 0.2, x + 0.025, 0.42, 0.012)) c = WHITE; // zuby
  if (inRRect(u, v, 0.12, 0.38, 0.215, 0.44, 0.02)) c = WHITE;
  if (inRRect(u, v, 0.82, 0.2, 0.87, 0.8, 0.02)) c = WHITE;                // nôž
  if (inCircle(u, v, 0.5, 0.5, 0.06)) c = DARK;                            // jedlo :)
  return c;
}

// zoom < 1 zmenší obrázok k stredu (maskable ikona: Android ju oreže do kruhu)
function png(size, zoom = 1) {
  const SS = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = color(0.5 + ((x + (sx + 0.5) / SS) / size - 0.5) / zoom, 0.5 + ((y + (sy + 0.5) / SS) / size - 0.5) / zoom);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [180, 192, 512]) fs.writeFileSync(new URL(`../app/icons/icon-${s}.png`, import.meta.url), png(s));
fs.writeFileSync(new URL('../app/icons/icon-maskable-512.png', import.meta.url), png(512, 0.72));
console.log('Ikonky hotové.');
