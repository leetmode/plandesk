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
  return m.type === 'callout' ? boxFrom(m.points[1], m.points[2]) : boxFrom(m.points[0], m.points[1]);
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
