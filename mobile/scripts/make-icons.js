// Generates the app's PNG icons (alert dot + ring) so no design tool is
// needed. Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [15, 17, 21];
const RED = [239, 68, 68];
const WHITE = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// shapes: [{ kind: 'disc'|'ring', r, r2?, color, alpha? }], radii as a
// fraction of the image size; background is optional
function render(size, { background, shapes }) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      let [r, g, b] = background || [0, 0, 0];
      let a = background ? 1 : 0;
      const d = Math.hypot(x - c, y - c);
      for (const s of shapes) {
        const outer = s.r * size;
        let cov = Math.max(0, Math.min(1, outer - d + 0.5));
        if (s.kind === 'ring') cov = Math.min(cov, Math.max(0, Math.min(1, d - s.r2 * size + 0.5)));
        cov *= s.alpha ?? 1;
        if (!cov) continue;
        // "over" compositing
        const na = cov + a * (1 - cov);
        r = (s.color[0] * cov + r * a * (1 - cov)) / na;
        g = (s.color[1] * cov + g * a * (1 - cov)) / na;
        b = (s.color[2] * cov + b * a * (1 - cov)) / na;
        a = na;
      }
      const i = row + 1 + x * 4;
      raw[i] = Math.round(r);
      raw[i + 1] = Math.round(g);
      raw[i + 2] = Math.round(b);
      raw[i + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// mark scaled to `k` of the canvas (adaptive icons must fit the inner ~66%)
const mark = (color, k = 1) => [
  { kind: 'ring', r: 0.36 * k, r2: 0.3 * k, color, alpha: 0.35 },
  { kind: 'disc', r: 0.19 * k, color },
];

const out = path.join(__dirname, '..', 'assets');
const files = {
  'icon.png': render(1024, { background: BG, shapes: mark(RED) }),
  'android-icon-background.png': render(1024, { background: BG, shapes: [] }),
  'android-icon-foreground.png': render(1024, { shapes: mark(RED, 0.62) }),
  'android-icon-monochrome.png': render(1024, { shapes: mark(WHITE, 0.62) }),
  'notification-icon.png': render(96, { shapes: mark(WHITE, 1.3) }),
  'splash-icon.png': render(512, { shapes: mark(RED) }),
  'favicon.png': render(48, { background: BG, shapes: mark(RED) }),
};
for (const [name, png] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), png);
  console.log(`assets/${name}`);
}
