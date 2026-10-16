import type { Markup, MarkupType, Pt, StyleDefaults, Tool } from '../types';
import { boxFrom, centroid, type Box } from './geometry';

export const TYPE_LABEL: Record<MarkupType, string> = {
  pen: 'Pen',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polyline: 'Polyline',
  polygon: 'Polygon',
  cloud: 'Cloud',
  polycloud: 'Polygon Cloud',
  highlight: 'Highlight',
  text: 'Text Box',
  callout: 'Callout',
  cloudplus: 'Cloud+',
  note: 'Note',
  length: 'Length',
  polylength: 'Polylength',
  area: 'Area',
  count: 'Count',
};

const RED = '#e02020';
const BLUE = '#1f5fd6';

export const DEFAULT_STYLES: Record<MarkupType, StyleDefaults> = {
  pen: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Pen' },
  line: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Line' },
  arrow: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Arrow' },
  rect: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Rectangle' },
  ellipse: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Ellipse' },
  polyline: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Polyline' },
  polygon: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Polygon' },
  cloud: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Cloud' },
  polycloud: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Cloud' },
  highlight: { color: '#ffd400', fill: '#ffd400', opacity: 1, fillOpacity: 0.4, width: 0, fontSize: 12, subject: 'Highlight' },
  text: { color: RED, fill: null, opacity: 1, fillOpacity: 1, width: 1, fontSize: 12, subject: 'Text Box' },
  callout: { color: RED, fill: '#ffffff', opacity: 1, fillOpacity: 1, width: 1, fontSize: 12, subject: 'Callout' },
  note: { color: '#6b5200', fill: '#ffd400', opacity: 1, fillOpacity: 1, width: 1, fontSize: 12, subject: 'Note' },
  cloudplus: { color: RED, fill: null, opacity: 1, fillOpacity: 0.3, width: 2, fontSize: 12, subject: 'Cloud+' },
  length: { color: BLUE, fill: null, opacity: 1, fillOpacity: 0.3, width: 1.5, fontSize: 10, subject: 'Length Measurement' },
  polylength: { color: BLUE, fill: null, opacity: 1, fillOpacity: 0.3, width: 1.5, fontSize: 10, subject: 'Polylength Measurement' },
  area: { color: BLUE, fill: BLUE, opacity: 1, fillOpacity: 0.2, width: 1.5, fontSize: 10, subject: 'Area Measurement' },
  count: { color: '#0a9a3c', fill: null, opacity: 1, fillOpacity: 0.3, width: 1.5, fontSize: 10, subject: 'Count Measurement' },
};

export const isMarkupTool = (t: Tool): t is MarkupType => t in TYPE_LABEL;

// Tools that place one vertex per click and finish on double-click / Enter.
export const CLICK_TOOLS = new Set<Tool>(['polyline', 'polygon', 'polycloud', 'polylength', 'area']);
export const CLOSED_TYPES = new Set<MarkupType>(['polygon', 'polycloud', 'area']);
export const BOX_TYPES = new Set<MarkupType>(['rect', 'ellipse', 'cloud', 'highlight', 'text']);

export const newId = () => crypto.randomUUID();

export function makeMarkup(type: MarkupType, page: number, points: Pt[], style: StyleDefaults, author: string): Markup {
  const now = new Date().toISOString();
  return {
    id: newId(),
    page,
    type,
    points,
    text: '',
    comment: '',
    author,
    status: 'None',
    created: now,
    modified: now,
    ...style,
  };
}

export function textBox(m: Markup): Box {
  if (m.type === 'cloudplus') return boxFrom(m.points[2] ?? m.points[0], m.points[3] ?? m.points[1] ?? m.points[0]);
  return m.type === 'callout' ? boxFrom(m.points[1], m.points[2]) : boxFrom(m.points[0], m.points[1]);
}

// Sticky note icon: a speech bubble anchored at its top-left corner.
export const NOTE_W = 30;
export const NOTE_H = 27;
export function noteOutline(at: Pt): Pt[] {
  const { x, y } = at;
  const body = NOTE_H * 0.72;
  return [
    { x, y },
    { x: x + NOTE_W, y },
    { x: x + NOTE_W, y: y + body },
    { x: x + NOTE_W * 0.45, y: y + body },
    { x: x + NOTE_W * 0.2, y: y + NOTE_H },
    { x: x + NOTE_W * 0.25, y: y + body },
    { x, y: y + body },
  ];
}

// the two "text" lines drawn inside the note icon
export const noteLines = (at: Pt): Pt[][] =>
  [0.25, 0.48].map((f) => [
    { x: at.x + NOTE_W * 0.2, y: at.y + NOTE_H * f },
    { x: at.x + NOTE_W * 0.8, y: at.y + NOTE_H * f },
  ]);

// Markups whose text sits in a top-left aligned box that grows to fit.
export const BOX_TEXT = new Set<MarkupType>(['text', 'callout', 'cloudplus']);
export const hasText = (t: MarkupType) => BOX_TEXT.has(t) || TEXT_SHAPES.has(t);

// Cloud+ is a revision cloud with a leader running to a separate text box.
export const cloudRect = (m: Markup): Box => boxFrom(m.points[0], m.points[1] ?? m.points[0]);

// Default spot for a new Cloud+ box: up and to the right of the cloud, kept on the page.
export function cloudPlusBox(a: Pt, b: Pt, fontSize: number, pageW: number): [Pt, Pt] {
  const c = boxFrom(a, b);
  const w = Math.max(160, fontSize * 20);
  const h = fontSize * 2.5;
  let x = c.x + c.w + 40;
  if (x + w > pageW) x = Math.max(0, c.x - 40 - w);
  const y = Math.max(0, c.y - h - 30);
  return [{ x, y }, { x: x + w, y: y + h }];
}

// Leader from the cloud's edge to the nearest side of the text box (null when they overlap).
export function cloudPlusLeader(m: Markup): [Pt, Pt] | null {
  if (m.points.length < 4) return null;
  const c = cloudRect(m);
  const b = textBox(m);
  const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  const sides = [
    { x: b.x, y: b.y + b.h / 2 },
    { x: b.x + b.w, y: b.y + b.h / 2 },
    { x: b.x + b.w / 2, y: b.y },
    { x: b.x + b.w / 2, y: b.y + b.h },
  ];
  const end = sides.reduce((best, s) => (Math.hypot(s.x - cc.x, s.y - cc.y) < Math.hypot(best.x - cc.x, best.y - cc.y) ? s : best));
  const inside = (p: Pt) => p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
  if (inside(end)) return null;
  // where the line from the cloud center to the box crosses the cloud's rectangle
  const dx = end.x - cc.x, dy = end.y - cc.y;
  const t = Math.min(dx ? c.w / 2 / Math.abs(dx) : Infinity, dy ? c.h / 2 / Math.abs(dy) : Infinity);
  return [{ x: cc.x + dx * t, y: cc.y + dy * t }, end];
}

// Leader for a callout runs from the tip to the nearest side midpoint of the box.
export function calloutLeader(m: Markup): { tip: Pt; knee: Pt; end: Pt } {
  const tip = m.points[0];
  const b = textBox(m);
  const sides = [
    { x: b.x, y: b.y + b.h / 2 },
    { x: b.x + b.w, y: b.y + b.h / 2 },
    { x: b.x + b.w / 2, y: b.y },
    { x: b.x + b.w / 2, y: b.y + b.h },
  ];
  let end = sides[0];
  let best = Infinity;
  for (const s of sides) {
    const d = Math.hypot(s.x - tip.x, s.y - tip.y);
    if (d < best) {
      best = d;
      end = s;
    }
  }
  const horizontal = end === sides[0] || end === sides[1];
  const dir = end === sides[0] || end === sides[2] ? -1 : 1;
  const knee = horizontal ? { x: end.x + dir * 12, y: end.y } : { x: end.x, y: end.y + dir * 12 };
  return { tip, knee, end };
}

// Where a measurement's value label is drawn.
export function labelAnchor(m: Markup): Pt | null {
  const p = m.points;
  if (!p.length) return null;
  if (m.type === 'length') return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  if (m.type === 'polylength') {
    const i = Math.floor((p.length - 1) / 2);
    const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (m.type === 'area') return centroid(p);
  return null;
}

export function translate(m: Markup, dx: number, dy: number): Markup {
  return { ...m, points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

// Closed shapes that can hold centered text (double-click to type).
export const TEXT_SHAPES = new Set<MarkupType>(['rect', 'ellipse', 'cloud', 'polycloud', 'polygon']);

export function shapeTextBox(m: Markup): Box {
  const b = m.type === 'polycloud' || m.type === 'polygon' ? boundsOf(m.points) : boxFrom(m.points[0], m.points[1] ?? m.points[0]);
  // keep text inside the curve of an ellipse
  const k = m.type === 'ellipse' ? 0.7 : 1;
  const inset = 4 + m.width;
  const w = Math.max(10, b.w * k - inset * 2);
  const h = Math.max(10, b.h * k - inset * 2);
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}

function boundsOf(pts: Pt[]): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Line height used everywhere text is laid out (screen and PDF).
export const LINE_HEIGHT = 1.2;
