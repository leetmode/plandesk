// Builds a drawing plan for a markup: the paths, text lines and labels to show
// on screen. Shares geometry with pdfio.ts so the screen matches the saved PDF.
import type { Markup, PageScale, Pt } from '../types';
import {
  arrowHead,
  boxFrom,
  circleSegs,
  cloudSegs,
  ellipseSegs,
  polySegs,
  rectCorners,
  segsToSvg,
  wrapText,
  type Box,
} from './geometry';
import { calloutLeader, cloudPlusLeader, cloudRect, labelAnchor, noteLines, noteOutline, LINE_HEIGHT, shapeTextBox, TEXT_SHAPES, textBox } from './markups';
import { measureMarkup } from './measure';

export type Part =
  | { kind: 'path'; d: string; stroke: boolean; fill: string | null; fillOpacity?: number; blend?: boolean }
  | { kind: 'solid'; d: string } // filled with the markup color (arrowheads)
  | { kind: 'text'; x: number; y: number; lines: string[]; size: number; center?: boolean }
  | { kind: 'label'; at: Pt; text: string; size: number };

export function textLayout(m: Markup, measure: (s: string, size: number) => number): { box: Box; lines: string[] } {
  const box = textBox(m);
  return { box, lines: wrapText(m.text, Math.max(10, box.w - 8), (s) => measure(s, m.fontSize)) };
}

export function shapeTextLayout(m: Markup, measure: (s: string, size: number) => number): { box: Box; lines: string[] } {
  const box = shapeTextBox(m);
  return { box, lines: wrapText(m.text, box.w, (s) => measure(s, m.fontSize)) };
}

export function planMarkup(m: Markup, scale: PageScale, measure: (s: string, size: number) => number): Part[] {
  const p = m.points;
  if (!p.length) return [];
  const out: Part[] = [];
  const line = (pts: Pt[]) => out.push({ kind: 'path', d: segsToSvg(polySegs(pts, false)), stroke: true, fill: null });
  const shape = (d: string) => out.push({ kind: 'path', d, stroke: m.width > 0, fill: m.fill });

  switch (m.type) {
    case 'pen':
    case 'polyline':
    case 'polylength':
      line(p);
      break;
    case 'line':
    case 'length':
      line(p);
      if (m.type === 'length' && p.length > 1) {
        for (const [a, b] of [[p[0], p[1]], [p[1], p[0]]]) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
          const dx = Math.cos(ang) * 5, dy = Math.sin(ang) * 5;
          line([{ x: a.x + dx, y: a.y + dy }, { x: a.x - dx, y: a.y - dy }]);
        }
      }
      break;
    case 'arrow':
      line(p);
      if (p.length > 1) out.push({ kind: 'solid', d: segsToSvg(polySegs(arrowHead(p[0], p[1], m.width), true)) });
      break;
    case 'rect':
      shape(segsToSvg(polySegs(rectCorners(boxFrom(p[0], p[1] ?? p[0])), true)));
      break;
    case 'highlight':
      out.push({ kind: 'path', d: segsToSvg(polySegs(rectCorners(boxFrom(p[0], p[1] ?? p[0])), true)), stroke: false, fill: m.fill ?? m.color, blend: true });
      break;
    case 'ellipse':
      shape(segsToSvg(ellipseSegs(boxFrom(p[0], p[1] ?? p[0]))));
      break;
    case 'polygon':
    case 'area':
      shape(segsToSvg(polySegs(p, true)));
      break;
    case 'cloud':
    case 'polycloud': {
      const poly = m.type === 'cloud' ? rectCorners(boxFrom(p[0], p[1] ?? p[0])) : p;
      shape(segsToSvg(cloudSegs(poly, Math.max(8, m.width * 6))));
      break;
    }
    case 'count':
      p.forEach((pt, i) => {
        out.push({ kind: 'path', d: segsToSvg(circleSegs(pt, 6)), stroke: true, fill: null });
        line([{ x: pt.x - 3, y: pt.y }, { x: pt.x - 0.5, y: pt.y + 2.5 }, { x: pt.x + 3.5, y: pt.y - 3 }]);
        out.push({ kind: 'text', x: pt.x + 7, y: pt.y - 6 - m.fontSize * 0.6, lines: [String(i + 1)], size: m.fontSize * 0.8 });
      });
      break;
    case 'note': {
      shape(segsToSvg(polySegs(noteOutline(p[0]), true)));
      noteLines(p[0]).forEach(line);
      break;
    }
    case 'cloudplus': {
      shape(segsToSvg(cloudSegs(rectCorners(cloudRect(m)), Math.max(8, m.width * 6))));
      if (p.length < 4) break;
      const leader = cloudPlusLeader(m);
      if (leader) line(leader);
      const { box, lines } = textLayout(m, measure);
      out.push({ kind: 'path', d: segsToSvg(polySegs(rectCorners(box), true)), stroke: m.width > 0, fill: m.fill });
      out.push({ kind: 'text', x: box.x + 4, y: box.y + 4, lines, size: m.fontSize });
      break;
    }
    case 'text':
    case 'callout': {
      if (m.type === 'callout' && p.length >= 3) {
        const { tip, knee, end } = calloutLeader(m);
        line([tip, knee, end]);
        out.push({ kind: 'solid', d: segsToSvg(polySegs(arrowHead(knee, tip, Math.max(1, m.width)), true)) });
      }
      const { box, lines } = textLayout(m, measure);
      shape(segsToSvg(polySegs(rectCorners(box), true)));
      out.push({ kind: 'text', x: box.x + 4, y: box.y + 4, lines, size: m.fontSize });
      break;
    }
  }

  if (TEXT_SHAPES.has(m.type) && m.text.trim()) {
    const { box, lines } = shapeTextLayout(m, measure);
    const blockH = lines.length * m.fontSize * LINE_HEIGHT;
    out.push({ kind: 'text', x: box.x + box.w / 2, y: box.y + (box.h - blockH) / 2, lines, size: m.fontSize, center: true });
  }

  const meas = measureMarkup(m, scale);
  const at = labelAnchor(m);
  if (meas && at && (m.type !== 'length' || p.length > 1)) out.push({ kind: 'label', at, text: meas.text, size: m.fontSize });
  return out;
}

// Handles the user can drag to reshape a markup (none for freehand pen strokes).
// Cloud+ adds a fifth handle in the middle of its text box that moves just the box.
export function handlesFor(m: Markup): Pt[] {
  if (m.type === 'cloudplus' && m.points.length >= 4) {
    const b = boxFrom(m.points[2], m.points[3]);
    return [...m.points, { x: b.x + b.w / 2, y: b.y + b.h / 2 }];
  }
  return m.type === 'pen' ? [] : m.points;
}
