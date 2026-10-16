import type { Pt } from '../types';

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function polylineLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (pts: Pt[]) => Math.abs(signedArea(pts));

export function centroid(pts: Pt[]): Pt {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxFrom(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function bounds(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const rectCorners = (b: Box): Pt[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.w, y: b.y },
  { x: b.x + b.w, y: b.y + b.h },
  { x: b.x, y: b.y + b.h },
];

// Snap the segment a->b to the nearest 45 degrees (shift-drag).
export function snap45(a: Pt, b: Pt): Pt {
  const len = dist(a, b);
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
}

export function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(out[out.length - 1], pts[i]) >= tolerance) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

// A path made of straight moves and cubic curves. One representation feeds
// both the SVG overlay and the PDF appearance streams so they always match.
export type Seg =
  | { k: 'M'; p: Pt }
  | { k: 'L'; p: Pt }
  | { k: 'C'; c1: Pt; c2: Pt; p: Pt }
  | { k: 'Z' };

const KAPPA = 0.5522847498;

export function cloudSegs(poly: Pt[], arc: number): Seg[] {
  if (poly.length < 2) return [];
  // Bumps bulge away from the polygon's interior.
  const orient = signedArea(poly) >= 0 ? 1 : -1;
  const segs: Seg[] = [{ k: 'M', p: poly[0] }];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / arc));
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // y-down coordinates: for a positive (clockwise on screen) polygon the outward normal is (t.y, -t.x)
    const nrm = { x: t.y * orient, y: -t.x * orient };
    const step = len / n;
    const r = step / 2;
    const k = r * KAPPA;
    for (let j = 0; j < n; j++) {
      const p = { x: a.x + t.x * step * j, y: a.y + t.y * step * j };
      const q = { x: a.x + t.x * step * (j + 1), y: a.y + t.y * step * (j + 1) };
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const top = { x: m.x + nrm.x * r, y: m.y + nrm.y * r };
      segs.push({ k: 'C', c1: { x: p.x + nrm.x * k, y: p.y + nrm.y * k }, c2: { x: top.x - t.x * k, y: top.y - t.y * k }, p: top });
      segs.push({ k: 'C', c1: { x: top.x + t.x * k, y: top.y + t.y * k }, c2: { x: q.x + nrm.x * k, y: q.y + nrm.y * k }, p: q });
    }
  }
  segs.push({ k: 'Z' });
  return segs;
}

export function ellipseSegs(b: Box): Seg[] {
  const rx = b.w / 2, ry = b.h / 2;
  const cx = b.x + rx, cy = b.y + ry;
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { k: 'M', p: { x: cx + rx, y: cy } },
    { k: 'C', c1: { x: cx + rx, y: cy + ky }, c2: { x: cx + kx, y: cy + ry }, p: { x: cx, y: cy + ry } },
    { k: 'C', c1: { x: cx - kx, y: cy + ry }, c2: { x: cx - rx, y: cy + ky }, p: { x: cx - rx, y: cy } },
    { k: 'C', c1: { x: cx - rx, y: cy - ky }, c2: { x: cx - kx, y: cy - ry }, p: { x: cx, y: cy - ry } },
    { k: 'C', c1: { x: cx + kx, y: cy - ry }, c2: { x: cx + rx, y: cy - ky }, p: { x: cx + rx, y: cy } },
    { k: 'Z' },
  ];
}

export function polySegs(pts: Pt[], closed: boolean): Seg[] {
  if (!pts.length) return [];
  const segs: Seg[] = [{ k: 'M', p: pts[0] }];
  for (let i = 1; i < pts.length; i++) segs.push({ k: 'L', p: pts[i] });
  if (closed) segs.push({ k: 'Z' });
  return segs;
}

export function circleSegs(c: Pt, r: number): Seg[] {
  return ellipseSegs({ x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r });
}

// Filled arrowhead triangle at `tip`, pointing away from `from`.
export function arrowHead(from: Pt, tip: Pt, width: number): Pt[] {
  const len = Math.max(8, width * 4);
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  return [
    tip,
    { x: tip.x - len * Math.cos(ang - spread), y: tip.y - len * Math.sin(ang - spread) },
    { x: tip.x - len * Math.cos(ang + spread), y: tip.y - len * Math.sin(ang + spread) },
  ];
}

export function segsToSvg(segs: Seg[]): string {
  const f = (n: number) => +n.toFixed(2);
  return segs
    .map((s) => {
      switch (s.k) {
        case 'M': return `M${f(s.p.x)} ${f(s.p.y)}`;
        case 'L': return `L${f(s.p.x)} ${f(s.p.y)}`;
        case 'C': return `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p.x)} ${f(s.p.y)}`;
        case 'Z': return 'Z';
      }
    })
    .join('');
}

export function segsToPdf(segs: Seg[]): string {
  const f = (n: number) => +n.toFixed(3);
  return segs
    .map((s) => {
      switch (s.k) {
        case 'M': return `${f(s.p.x)} ${f(s.p.y)} m`;
        case 'L': return `${f(s.p.x)} ${f(s.p.y)} l`;
        case 'C': return `${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p.x)} ${f(s.p.y)} c`;
        case 'Z': return 'h';
      }
    })
    .join('\n');
}

// Greedy word wrap; `measure` returns the width of a string at the font size in use.
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && measure(next.trimEnd()) > maxWidth && w.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
