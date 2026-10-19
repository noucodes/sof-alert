const zlib = require('zlib');
const { nativeImage } = require('electron');

// Tray icons are drawn at runtime as anti-aliased status dots, so the repo
// needs no binary image assets.
const COLORS = {
  green: [34, 197, 94],
  amber: [245, 158, 11],
  red: [239, 68, 68],
  grey: [148, 163, 184],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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

function dotPng(size, [r, g, b]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const centre = (size - 1) / 2;
  const radius = size * 0.42;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - centre, y - centre);
      const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const cache = new Map();

function statusIcon(color, size = 32) {
  const key = `${color}:${size}`;
  if (!cache.has(key)) cache.set(key, nativeImage.createFromBuffer(dotPng(size, COLORS[color])));
  return cache.get(key);
}

module.exports = { statusIcon };
