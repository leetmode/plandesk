// Generates build/icon.png (1024x1024): a blue tile with a plan sheet and a red revision cloud.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const px = new Uint8Array(N * N * 4);
const set = (x, y, [r, g, b], a = 1) => {
  const i = (y * N + x) * 4;
  const inv = 1 - a;
  px[i] = px[i] * inv + r * a; px[i + 1] = px[i + 1] * inv + g * a; px[i + 2] = px[i + 2] * inv + b * a;
  px[i + 3] = Math.max(px[i + 3], a * 255);
};
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return Math.hypot(x - cx, y - cy) - r; // <0 inside
};
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d)); // antialiased coverage

// cloud bumps along a rectangle
const bumps = [];
const cx0 = 320, cy0 = 350, cx1 = 704, cy1 = 670, R = 48;
const edge = (ax, ay, bx, by) => {
  const len = Math.hypot(bx - ax, by - ay), n = Math.round(len / (2 * R));
  for (let j = 0; j < n; j++) bumps.push([ax + (bx - ax) * (j + 0.5) / n, ay + (by - ay) * (j + 0.5) / n, len / n / 2]);
};
edge(cx0, cy0, cx1, cy0); edge(cx1, cy0, cx1, cy1); edge(cx1, cy1, cx0, cy1); edge(cx0, cy1, cx0, cy0);

for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const tile = roundRect(x, y, 40, 40, 984, 984, 200);
  if (tile < 1) {
    const t = y / N;
    set(x, y, [24 + 10 * t, 92 - 30 * t, 214 - 60 * t], cov(tile));
  }
  const sheet = roundRect(x, y, 200, 210, 824, 814, 24);
  if (sheet < 1) set(x, y, [255, 255, 255], cov(sheet));
  // cloud outline: outer edge of the union of bumps, stroked
  let d = Infinity;
  for (const [bx, by, r] of bumps) d = Math.min(d, Math.hypot(x - bx, y - by) - r);
  // signed distance to the cloud shape = union of the rectangle and its bumps
  const qx = Math.max(cx0 - x, 0, x - cx1), qy = Math.max(cy0 - y, 0, y - cy1);
  const dRect = qx || qy ? Math.hypot(qx, qy) : -Math.min(x - cx0, cx1 - x, y - cy0, cy1 - y);
  const dCloud = Math.min(d, dRect);
  // stroke only outside the shape so the cusps between bumps stay crisp
  if (dCloud > -1 && dCloud < 26) set(x, y, [226, 40, 40], cov(Math.abs(dCloud - 12.5) - 12.5));
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[2] ?? 'build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
