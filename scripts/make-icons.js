// Draws the app icon (a small "week wheel") and writes PNGs with no dependencies.
// Run: node scripts/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// wedges: colour + how full (fraction of radius) — mirrors the app's starter interests
const WEDGES = [["#3D8BD9", .85], ["#7A8794", .55], ["#E9B44C", .95], ["#8E6CCF", .7], ["#2A9D8F", 1], ["#E07A5F", .8]];
const BG = hex("#2E5B4E"), HUB = hex("#F1F3EE");

function sample(u, v, mode) {
  const tray = mode === "tray", full = mode === "full";
  // u,v in [0,1]; returns [r,g,b,a]
  const x = u - .5, y = v - .5;
  // rounded square background (not for tray: tray is just the wheel)
  if (!tray && !full) {
    const r = .2, q = Math.max(Math.abs(x) - (.5 - r), 0) ** 2 + Math.max(Math.abs(y) - (.5 - r), 0) ** 2;
    if (q > r * r) return [0, 0, 0, 0];
  }
  const d = Math.hypot(x, y), R = tray ? .5 : full ? .33 : .40, r0 = R * .30;
  if (d < r0 * .82) return tray ? [...HUB, 255] : [...BG, 255];
  if (d < r0) return [...HUB, 255];
  let a = Math.atan2(x, -y); if (a < 0) a += Math.PI * 2;
  const n = WEDGES.length, step = Math.PI * 2 / n, i = Math.floor(a / step), within = a - i * step;
  const gap = .07;
  if (d <= R && within > gap && within < step - gap) {
    const [c, f] = WEDGES[i];
    if (d <= r0 + (R - r0) * f) return [...hex(c), 255];
    return tray ? [...hex(c), 90] : [...hex(c), 70].map((v, k) => (k < 3 ? Math.round(v * .35 + BG[k] * .65) : 255));
  }
  return tray ? [0, 0, 0, 0] : [...BG, 255];
}
function render(size, mode) {
  const ss = 4, out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const [cr, cg, cb, ca] = sample((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size, mode);
      r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
    }
    const o = (py * size + px) * 4;
    out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0; out[o + 3] = Math.round(a / (ss * ss));
  }
  return png(size, out);
}
const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "app", "icons"), { recursive: true });
fs.mkdirSync(path.join(root, "build"), { recursive: true });
const out = (p, size, mode) => fs.writeFileSync(path.join(root, ...p), render(size, mode));
out(["build", "icon.png"], 256, "app");
out(["app", "icons", "icon.png"], 256, "app");
out(["app", "icons", "tray.png"], 32, "tray");
out(["app", "icons", "icon-192.png"], 192, "app");
out(["app", "icons", "icon-512.png"], 512, "app");
out(["app", "icons", "maskable-512.png"], 512, "full");
out(["app", "icons", "apple-touch-icon.png"], 180, "full");
console.log("icons written");
