#!/usr/bin/env node
/**
 * Generates the PWA icons into `public/icons/`.
 *
 * They are drawn in code rather than committed as binaries from a design tool
 * so the whole icon set can be regenerated from one place — `npm run icons`
 * after changing a colour beats hand-editing four PNGs.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG_TOP = [30, 36, 54];
const BG_BOTTOM = [16, 19, 28];
const LINE = [75, 86, 112];
const CARET = [122, 162, 247];

/** Coverage of a rounded rectangle at (u, v), in normalised 0..1 space. */
function roundedRect(u, v, x0, y0, x1, y1, radius) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return 0;
  const cx = Math.min(Math.max(u, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(v, y0 + radius), y1 - radius);
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= radius * radius ? 1 : 0;
}

function blend(base, colour, alpha) {
  if (alpha <= 0) return base;
  return [
    base[0] + (colour[0] - base[0]) * alpha,
    base[1] + (colour[1] - base[1]) * alpha,
    base[2] + (colour[2] - base[2]) * alpha,
  ];
}

/**
 * The mark: three lines of text with a caret to their right.
 * `scale` shrinks the artwork into the safe zone for maskable icons.
 */
function sample(u, v, maskable) {
  const scale = maskable ? 0.66 : 0.82;
  const cu = (u - 0.5) / scale + 0.5;
  const cv = (v - 0.5) / scale + 0.5;

  const gradient = Math.min(1, Math.max(0, (u + v) / 2));
  let colour = [
    BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * gradient,
    BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * gradient,
    BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * gradient,
  ];

  const bar = 0.036;
  colour = blend(colour, LINE, roundedRect(cu, cv, 0.17, 0.28 - bar, 0.60, 0.28 + bar, bar));
  colour = blend(colour, LINE, roundedRect(cu, cv, 0.17, 0.5 - bar, 0.46, 0.5 + bar, bar));
  colour = blend(colour, LINE, roundedRect(cu, cv, 0.17, 0.72 - bar, 0.54, 0.72 + bar, bar));
  colour = blend(colour, CARET, roundedRect(cu, cv, 0.70, 0.20, 0.775, 0.80, 0.037));

  // Rounded outline, except for maskable icons which the platform clips itself.
  const alpha = maskable ? 1 : roundedRect(u, v, 0, 0, 1, 1, 0.22);
  return [colour[0], colour[1], colour[2], alpha * 255];
}

function renderPixels(size, maskable) {
  const data = Buffer.alloc(size * size * 4);
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const [pr, pg, pb, pa] = sample(u, v, maskable);
          r += pr;
          g += pg;
          b += pb;
          a += pa;
        }
      }
      const n = samples * samples;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(r / n);
      data[offset + 1] = Math.round(g / n);
      data[offset + 2] = Math.round(b / n);
      data[offset + 3] = Math.round(a / n);
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline, then the raw RGBA row.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-180.png', size: 180, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const target of targets) {
  const png = encodePng(target.size, renderPixels(target.size, target.maskable));
  writeFileSync(join(OUT_DIR, target.file), png);
  console.log(`wrote ${target.file} (${target.size}px, ${(png.length / 1024).toFixed(1)} KB)`);
}
