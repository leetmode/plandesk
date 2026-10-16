// Reading and writing markups as real PDF annotations.
//
// On open, every annotation we know how to edit is lifted out of the PDF into
// our Markup model and removed from the copy we render, so it isn't drawn twice.
// On save, markups are written back as standard annotations (Square, Circle,
// Line, PolyLine, Polygon, Ink, FreeText, Highlight, Stamp) with appearance
// streams, ISO 32000 /Measure dictionaries for measurements, and our own JSON
// under /PlanDesk so a round trip is lossless.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { Markup, MarkupType, PageScale, Pt, Status } from '../types';
import {
  arrowHead,
  boxFrom,
  bounds,
  circleSegs,
  cloudSegs,
  ellipseSegs,
  polySegs,
  rectCorners,
  segsToPdf,
  wrapText,
  type Seg,
} from './geometry';
import { calloutLeader, DEFAULT_STYLES, labelAnchor, newId, textBox, TYPE_LABEL } from './markups';
import { DEFAULT_SCALE, isMetric, measureMarkup } from './measure';

const KEY = PDFName.of('PlanDesk');
const SCALES_KEY = PDFName.of('PlanDeskScales');

// ---------------------------------------------------------------- transforms

type Mat = [number, number, number, number, number, number];

// Maps page units (rotated, y-down) to PDF user space.
export function pageMatrix(page: PDFPage): Mat {
  const { x, y, width, height } = page.getCropBox();
  const x0 = x, y0 = y, x1 = x + width, y1 = y + height;
  const r = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  switch (r) {
    case 90: return [0, 1, 1, 0, x0, y0];
    case 180: return [-1, 0, 0, 1, x1, y0];
    case 270: return [0, -1, -1, 0, x1, y1];
    default: return [1, 0, 0, -1, x0, y1];
  }
}

const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

// ---------------------------------------------------------------- colors

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function colorFromArray(arr: number[] | null): string | null {
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return rgbToHex([arr[0], arr[0], arr[0]]);
  if (arr.length === 4) {
    const [c, m, y, k] = arr;
    return rgbToHex([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
  }
  return rgbToHex(arr.slice(0, 3));
}

const f3 = (n: number) => +n.toFixed(3);
const rg = (hex: string) => hexToRgb(hex).map(f3).join(' ');

// ---------------------------------------------------------------- loading

export interface LoadedPdf {
  renderBytes: Uint8Array;
  markups: Markup[];
  scales: Record<number, PageScale>;
  pageCount: number;
}

const num = (o: unknown): number | null => (o instanceof PDFNumber ? o.asNumber() : null);

function lookup(doc: PDFDocument, o: unknown): unknown {
  return o instanceof PDFRef ? doc.context.lookup(o) : o;
}

function numbers(doc: PDFDocument, o: unknown): number[] | null {
  const v = lookup(doc, o);
  if (!(v instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) {
    const n = num(lookup(doc, v.get(i)));
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function text(doc: PDFDocument, o: unknown): string {
  const v = lookup(doc, o);
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
}

function name(doc: PDFDocument, o: unknown): string {
  const v = lookup(doc, o);
  return v instanceof PDFName ? v.decodeText() : '';
}

const pairs = (arr: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) out.push({ x: arr[i], y: arr[i + 1] });
  return out;
};

// PDF date "D:20260115093000-05'00'" -> ISO string
function pdfDate(s: string): string {
  const m = s.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return new Date().toISOString();
  const d = new Date(Date.UTC(+m[1], +(m[2] || 1) - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const toPdfDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

const STATUS_SET = new Set<Status>(['None', 'Open', 'Accepted', 'Rejected', 'Completed']);

// Converts an annotation written by another program (Revu, Acrobat, ...) into a Markup.
function importForeign(doc: PDFDocument, dict: PDFDict, pageIndex: number, inv: Mat): Markup | null {
  const sub = name(doc, dict.get(PDFName.of('Subtype')));
  const it = name(doc, dict.get(PDFName.of('IT')));
  const be = lookup(doc, dict.get(PDFName.of('BE')));
  const cloudy = be instanceof PDFDict && name(doc, be.get(PDFName.of('S'))) === 'C';
  const hasMeasure = dict.has(PDFName.of('Measure'));
  const rect = numbers(doc, dict.get(PDFName.of('Rect')));
  const toPage = (pts: Pt[]) => pts.map((p) => apply(inv, p));
  const rectPts = (r: number[]) => {
    // /RD insets the drawn shape from /Rect (used by clouds and thick borders)
    const rd = numbers(doc, dict.get(PDFName.of('RD'))) ?? [0, 0, 0, 0];
    return toPage([
      { x: r[0] + rd[0], y: r[1] + rd[3] },
      { x: r[2] - rd[2], y: r[3] - rd[1] },
    ]);
  };

  let type: MarkupType | null = null;
  let points: Pt[] = [];
  let textValue = '';

  switch (sub) {
    case 'Square':
      if (!rect) return null;
      type = cloudy ? 'cloud' : 'rect';
      points = rectPts(rect);
      break;
    case 'Circle':
      if (!rect) return null;
      type = 'ellipse';
      points = rectPts(rect);
      break;
    case 'Line': {
      const l = numbers(doc, dict.get(PDFName.of('L')));
      if (!l || l.length < 4) return null;
      points = toPage(pairs(l));
      const le = lookup(doc, dict.get(PDFName.of('LE')));
      const ends = le instanceof PDFArray ? [0, 1].map((i) => name(doc, le.get(i))) : [];
      const arrow = ends.some((e) => /Arrow/.test(e));
      type = it === 'LineDimension' || hasMeasure ? 'length' : arrow ? 'arrow' : 'line';
      // our arrows point at the second vertex
      if (type === 'arrow' && /Arrow/.test(ends[0] ?? '') && !/Arrow/.test(ends[1] ?? '')) points.reverse();
      break;
    }
    case 'PolyLine': {
      const v = numbers(doc, dict.get(PDFName.of('Vertices')));
      if (!v) return null;
      points = toPage(pairs(v));
      type = it === 'PolyLineDimension' || hasMeasure ? 'polylength' : 'polyline';
      break;
    }
    case 'Polygon': {
      const v = numbers(doc, dict.get(PDFName.of('Vertices')));
      if (!v) return null;
      points = toPage(pairs(v));
      type = it === 'PolygonDimension' || hasMeasure ? 'area' : cloudy || it === 'PolygonCloud' ? 'polycloud' : 'polygon';
      break;
    }
    case 'Ink': {
      const ink = lookup(doc, dict.get(PDFName.of('InkList')));
      if (!(ink instanceof PDFArray) || !ink.size()) return null;
      const first = numbers(doc, ink.get(0));
      if (!first) return null;
      points = toPage(pairs(first));
      type = 'pen';
      break;
    }
    case 'FreeText': {
      if (!rect) return null;
      textValue = text(doc, dict.get(PDFName.of('Contents')));
      const cl = numbers(doc, dict.get(PDFName.of('CL')));
      const box = rectPts(rect);
      if ((it === 'FreeTextCallout' || cl) && cl && cl.length >= 4) {
        type = 'callout';
        points = [apply(inv, { x: cl[0], y: cl[1] }), ...box];
      } else {
        type = 'text';
        points = box;
      }
      break;
    }
    case 'Highlight': {
      const q = numbers(doc, dict.get(PDFName.of('QuadPoints')));
      const src = q && q.length >= 8 ? pairs(q) : rect ? [{ x: rect[0], y: rect[1] }, { x: rect[2], y: rect[3] }] : null;
      if (!src) return null;
      const b = bounds(toPage(src));
      type = 'highlight';
      points = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }];
      break;
    }
    default:
      return null;
  }
  if (!type || points.length < 2) return null;

  const style = DEFAULT_STYLES[type];
  const c = colorFromArray(numbers(doc, dict.get(PDFName.of('C'))));
  const ic = colorFromArray(numbers(doc, dict.get(PDFName.of('IC'))));
  const bs = lookup(doc, dict.get(PDFName.of('BS')));
  const w = bs instanceof PDFDict ? num(lookup(doc, bs.get(PDFName.of('W')))) : null;
  const ca = num(lookup(doc, dict.get(PDFName.of('CA'))));
  let color = c ?? style.color;
  let fontSize = style.fontSize;
  if (sub === 'FreeText') {
    // text color and size live in the default appearance string, e.g. "/Helv 12 Tf 1 0 0 rg"
    const da = text(doc, dict.get(PDFName.of('DA')));
    const col = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
    if (col) color = rgbToHex([+col[1], +col[2], +col[3]]);
    const size = da.match(/([\d.]+)\s+Tf/);
    if (size && +size[1] > 0) fontSize = +size[1];
  }
  const modified = pdfDate(text(doc, dict.get(PDFName.of('M'))));
  return {
    id: text(doc, dict.get(PDFName.of('NM'))) || newId(),
    page: pageIndex,
    type,
    points,
    color,
    fill: type === 'highlight' ? color : sub === 'FreeText' ? ic : ic ?? null,
    opacity: ca ?? 1,
    fillOpacity: type === 'highlight' ? 0.4 : style.fillOpacity,
    width: w ?? style.width,
    text: textValue,
    fontSize,
    subject: text(doc, dict.get(PDFName.of('Subj'))) || TYPE_LABEL[type],
    comment: sub === 'FreeText' ? '' : text(doc, dict.get(PDFName.of('Contents'))),
    author: text(doc, dict.get(PDFName.of('T'))),
    status: 'None',
    created: modified,
    modified,
  };
}

const UNIT_INCHES: Record<string, number> = { in: 1, ft: 12, yd: 36, mi: 63360, mm: 0.0393700787, cm: 0.393700787, m: 39.3700787, km: 39370.0787 };

// Reads a page scale from an ISO 32000 /Measure dictionary (written by Revu, Acrobat, ...).
function scaleFromMeasure(doc: PDFDocument, measure: unknown): PageScale | null {
  const m = lookup(doc, measure);
  if (!(m instanceof PDFDict)) return null;
  const x = lookup(doc, m.get(PDFName.of('X')));
  if (!(x instanceof PDFArray) || !x.size()) return null;
  const nf = lookup(doc, x.get(0));
  if (!(nf instanceof PDFDict)) return null;
  const factor = num(lookup(doc, nf.get(PDFName.of('C'))));
  const unitName = text(doc, nf.get(PDFName.of('U'))).trim().toLowerCase().replace(/[^a-z]/g, '');
  const perUnit = UNIT_INCHES[unitName];
  if (!factor || !perUnit) return null;
  const unit = unitName === 'ft' ? 'ft-in' : (['in', 'yd', 'm', 'cm', 'mm'].includes(unitName) ? unitName : 'in') as PageScale['unit'];
  return { inchesPerPoint: factor * perUnit, unit, label: text(doc, m.get(PDFName.of('R'))) || 'From file' };
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const markups: Markup[] = [];
  const scales: Record<number, PageScale> = {};
  let changed = false;

  const stored = lookup(doc, doc.catalog.get(SCALES_KEY));
  if (stored instanceof PDFHexString || stored instanceof PDFString) {
    try {
      Object.assign(scales, JSON.parse(stored.decodeText()));
    } catch {
      /* ignore a damaged entry */
    }
  }

  pages.forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) return;
    const inv = invert(pageMatrix(page));
    const removed = new Set<PDFDict>();
    for (let i = 0; i < annots.size(); i++) {
      const dict = lookup(doc, annots.get(i));
      if (!(dict instanceof PDFDict)) continue;
      let m: Markup | null = null;
      const own = lookup(doc, dict.get(KEY));
      if (own instanceof PDFHexString || own instanceof PDFString) {
        try {
          m = { ...JSON.parse(own.decodeText()), page: pageIndex };
        } catch {
          m = null;
        }
      }
      if (!m) m = importForeign(doc, dict, pageIndex, inv);
      if (!m) continue;
      if (!STATUS_SET.has(m.status)) m.status = 'None';
      if (!(pageIndex in scales) && dict.has(PDFName.of('Measure'))) {
        const s = scaleFromMeasure(doc, dict.get(PDFName.of('Measure')));
        if (s) scales[pageIndex] = s;
      }
      markups.push(m);
      removed.add(dict);
    }
    if (!removed.size) return;
    // drop the lifted annotations and any popups that belonged to them
    const keep: unknown[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const dict = lookup(doc, raw);
      if (dict instanceof PDFDict) {
        if (removed.has(dict)) continue;
        const parent = lookup(doc, dict.get(PDFName.of('Parent')));
        if (name(doc, dict.get(PDFName.of('Subtype'))) === 'Popup' && parent instanceof PDFDict && removed.has(parent)) continue;
      }
      keep.push(raw);
    }
    page.node.set(PDFName.of('Annots'), doc.context.obj(keep as never[]));
    changed = true;
  });

  if (doc.catalog.has(SCALES_KEY)) {
    doc.catalog.delete(SCALES_KEY);
    changed = true;
  }
  const renderBytes = changed ? await doc.save({ useObjectStreams: false }) : bytes;
  return { renderBytes, markups, scales, pageCount: pages.length };
}

// ---------------------------------------------------------------- saving

interface Drawing {
  ops: string[];
  extent: Pt[]; // page-unit points the appearance covers
}

const LABEL_PAD = 2;

function strokeFill(segs: Seg[], m: Markup, d: Drawing, opts: { fill?: boolean; stroke?: boolean } = {}) {
  const path = segsToPdf(segs);
  const fill = opts.fill !== false && m.fill;
  const stroke = opts.stroke !== false && m.width > 0;
  if (fill) d.ops.push('q /GSf gs', `${rg(m.fill!)} rg`, path, 'f', 'Q');
  if (stroke) d.ops.push('q /GSs gs', `${rg(m.color)} RG ${f3(m.width)} w 1 J 1 j`, path, 'S', 'Q');
}

function drawText(lines: string[], x: number, y: number, size: number, color: string, font: PDFFont, d: Drawing) {
  // the page matrix flips y; the text matrix flips it back so glyphs stay upright
  d.ops.push('q /GSs gs BT', `/Helv ${f3(size)} Tf ${rg(color)} rg`);
  lines.forEach((line, i) => {
    const baseline = y + size * (i + 0.85) + i * size * 0.2;
    d.ops.push(`1 0 0 -1 ${f3(x)} ${f3(baseline)} Tm`, `${safeEncode(font, line)} Tj`);
  });
  d.ops.push('ET Q');
}

function safeEncode(font: PDFFont, s: string): string {
  // standard fonts are WinAnsi only; replace anything outside it
  const clean = [...s].map((ch) => {
    try {
      font.encodeText(ch);
      return ch;
    } catch {
      return '?';
    }
  }).join('');
  return font.encodeText(clean).toString();
}

function labelBox(label: string, at: Pt, size: number, font: PDFFont, m: Markup, d: Drawing) {
  const w = font.widthOfTextAtSize(label, size) + LABEL_PAD * 2;
  const h = size * 1.25;
  const box = { x: at.x - w / 2, y: at.y - h / 2, w, h };
  d.ops.push('q 1 1 1 rg', `${f3(box.x)} ${f3(box.y)} ${f3(w)} ${f3(h)} re f Q`);
  drawText([label], box.x + LABEL_PAD, box.y + size * 0.05, size, m.color, font, d);
  d.extent.push({ x: box.x, y: box.y }, { x: box.x + w, y: box.y + h });
}

export const textLines = (m: Markup, font: PDFFont) => {
  const b = textBox(m);
  return wrapText(m.text, Math.max(10, b.w - 8), (s) => font.widthOfTextAtSize(s, m.fontSize));
};

function draw(m: Markup, scale: PageScale, font: PDFFont): Drawing {
  const d: Drawing = { ops: [], extent: [...m.points] };
  const p = m.points;
  switch (m.type) {
    case 'pen':
    case 'polyline':
    case 'polylength':
      strokeFill(polySegs(p, false), m, d, { fill: false });
      break;
    case 'line':
    case 'length':
      strokeFill(polySegs(p, false), m, d, { fill: false });
      if (m.type === 'length') {
        // tick marks at both ends
        for (const [a, b] of [[p[0], p[1]], [p[1], p[0]]]) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
          const t = 5;
          strokeFill(polySegs([{ x: a.x + Math.cos(ang) * t, y: a.y + Math.sin(ang) * t }, { x: a.x - Math.cos(ang) * t, y: a.y - Math.sin(ang) * t }], false), m, d, { fill: false });
        }
      }
      break;
    case 'arrow': {
      strokeFill(polySegs(p, false), m, d, { fill: false });
      const head = arrowHead(p[0], p[1], m.width);
      d.ops.push('q /GSs gs', `${rg(m.color)} rg`, segsToPdf(polySegs(head, true)), 'f', 'Q');
      d.extent.push(...head);
      break;
    }
    case 'rect':
    case 'highlight':
      if (m.type === 'highlight') {
        d.ops.push('q /GSf gs', `${rg(m.fill ?? m.color)} rg`, segsToPdf(polySegs(rectCorners(boxFrom(p[0], p[1])), true)), 'f', 'Q');
      } else strokeFill(polySegs(rectCorners(boxFrom(p[0], p[1])), true), m, d);
      break;
    case 'ellipse':
      strokeFill(ellipseSegs(boxFrom(p[0], p[1])), m, d);
      break;
    case 'polygon':
    case 'area':
      strokeFill(polySegs(p, true), m, d);
      break;
    case 'cloud':
    case 'polycloud': {
      const poly = m.type === 'cloud' ? rectCorners(boxFrom(p[0], p[1])) : p;
      const arc = Math.max(8, m.width * 6);
      strokeFill(cloudSegs(poly, arc), m, d);
      d.extent.push(...bounds(poly).w ? rectCorners(pad(bounds(poly), arc / 2 + m.width)) : []);
      break;
    }
    case 'count':
      p.forEach((pt, i) => {
        const r = 6;
        d.ops.push('q /GSs gs', `${rg(m.color)} RG ${f3(m.width)} w`, segsToPdf(circleSegs(pt, r)), 'S');
        d.ops.push(`${f3(pt.x - 3)} ${f3(pt.y)} m ${f3(pt.x - 0.5)} ${f3(pt.y + 2.5)} l ${f3(pt.x + 3.5)} ${f3(pt.y - 3)} l S Q`);
        drawText([String(i + 1)], pt.x + r + 1, pt.y - r - m.fontSize * 0.6, m.fontSize * 0.8, m.color, font, d);
        d.extent.push({ x: pt.x - r - 1, y: pt.y - r - m.fontSize }, { x: pt.x + r + font.widthOfTextAtSize(String(i + 1), m.fontSize) + 4, y: pt.y + r + 1 });
      });
      break;
    case 'text':
    case 'callout': {
      const b = textBox(m);
      if (m.type === 'callout') {
        const { tip, knee, end } = calloutLeader(m);
        strokeFill(polySegs([tip, knee, end], false), m, d, { fill: false });
        const head = arrowHead(knee, tip, Math.max(1, m.width));
        d.ops.push('q /GSs gs', `${rg(m.color)} rg`, segsToPdf(polySegs(head, true)), 'f', 'Q');
      }
      strokeFill(polySegs(rectCorners(b), true), m, d);
      drawText(textLines(m, font), b.x + 4, b.y + 4, m.fontSize, m.color, font, d);
      break;
    }
  }
  const meas = measureMarkup(m, scale);
  const anchor = labelAnchor(m);
  if (meas && anchor) labelBox(meas.text, anchor, m.fontSize, font, m, d);
  return d;
}

const pad = (b: { x: number; y: number; w: number; h: number }, n: number) => ({ x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n });

const SUBTYPE: Record<MarkupType, string> = {
  pen: 'Ink',
  line: 'Line',
  arrow: 'Line',
  length: 'Line',
  rect: 'Square',
  cloud: 'Square',
  ellipse: 'Circle',
  polyline: 'PolyLine',
  polylength: 'PolyLine',
  polygon: 'Polygon',
  polycloud: 'Polygon',
  area: 'Polygon',
  highlight: 'Highlight',
  text: 'FreeText',
  callout: 'FreeText',
  count: 'Stamp',
};

function measureDict(doc: PDFDocument, scale: PageScale) {
  const metric = isMetric(scale.unit);
  const unit = metric ? 'm' : 'ft';
  const factor = metric ? scale.inchesPerPoint * 0.0254 : scale.inchesPerPoint / 12;
  const nf = (u: string, c: number) =>
    doc.context.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: c, D: 100, F: 'D', SS: PDFString.of(' ') });
  return doc.context.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of(scale.label),
    X: [nf(unit, factor)],
    D: [nf(unit, 1)],
    A: [nf(metric ? 'sq m' : 'sq ft', 1)],
  });
}

export async function savePdf(baseBytes: Uint8Array, markups: Markup[], scales: Record<number, PageScale>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const m of markups) {
    const page = pages[m.page];
    if (!page || m.points.length === 0) continue;
    const mat = pageMatrix(page);
    const toPdf = (pts: Pt[]) => pts.map((p) => apply(mat, p));
    const flat = (pts: Pt[]) => toPdf(pts).flatMap((p) => [f3(p.x), f3(p.y)]);
    const scale = scales[m.page] ?? DEFAULT_SCALE;
    const d = draw(m, scale, font);

    const margin = m.width + 2;
    const pdfExtent = bounds(toPdf(d.extent));
    const rect = [pdfExtent.x - margin, pdfExtent.y - margin, pdfExtent.x + pdfExtent.w + margin, pdfExtent.y + pdfExtent.h + margin].map(f3);

    const highlight = m.type === 'highlight';
    const gs = doc.context.obj({
      GSs: { Type: 'ExtGState', CA: m.opacity, ca: m.opacity },
      GSf: { Type: 'ExtGState', CA: m.opacity, ca: m.fillOpacity * m.opacity, ...(highlight ? { BM: 'Multiply' } : {}) },
    });
    const content = ['q', `${mat.map(f3).join(' ')} cm`, ...d.ops, 'Q'].join('\n');
    const ap = doc.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: rect,
      Resources: { Font: { Helv: font.ref }, ExtGState: gs },
    });
    const apRef = doc.context.register(ap);

    const entries: Record<string, unknown> = {
      Type: 'Annot',
      Subtype: SUBTYPE[m.type],
      Rect: rect,
      F: 4,
      NM: PDFHexString.fromText(m.id),
      T: PDFHexString.fromText(m.author),
      Subj: PDFHexString.fromText(m.subject),
      Contents: PDFHexString.fromText(m.type === 'text' || m.type === 'callout' ? m.text : m.comment),
      M: PDFString.of(toPdfDate(m.modified)),
      CreationDate: PDFString.of(toPdfDate(m.created)),
      C: hexToRgb(m.color).map(f3),
      CA: m.opacity,
      BS: { Type: 'Border', W: m.width, S: 'S' },
      AP: { N: apRef },
    };
    if (m.fill && !highlight && m.type !== 'text' && m.type !== 'callout') entries.IC = hexToRgb(m.fill).map(f3);

    switch (m.type) {
      case 'line':
      case 'arrow':
      case 'length':
        entries.L = flat(m.points.slice(0, 2));
        if (m.type === 'arrow') entries.LE = ['None', 'ClosedArrow'];
        break;
      case 'polyline':
      case 'polylength':
      case 'polygon':
      case 'polycloud':
      case 'area':
        entries.Vertices = flat(m.points);
        break;
      case 'pen':
        entries.InkList = [flat(m.points)];
        break;
      case 'highlight': {
        const c = toPdf(rectCorners(boxFrom(m.points[0], m.points[1])));
        // QuadPoints order: top-left, top-right, bottom-left, bottom-right
        entries.QuadPoints = [c[0], c[1], c[3], c[2]].flatMap((p) => [f3(p.x), f3(p.y)]);
        break;
      }
      case 'text':
      case 'callout': {
        entries.DA = PDFString.of(`/Helv ${m.fontSize} Tf ${rg(m.color)} rg`);
        if (m.fill) entries.IC = hexToRgb(m.fill).map(f3);
        if (m.type === 'callout') {
          const { tip, knee, end } = calloutLeader(m);
          entries.IT = 'FreeTextCallout';
          entries.CL = flat([tip, knee, end]);
          entries.LE = 'OpenArrow';
        }
        break;
      }
      case 'count':
        entries.Name = 'PlanDeskCount';
        break;
    }
    if (m.type === 'cloud' || m.type === 'polycloud') entries.BE = { S: 'C', I: 1 };
    if (m.type === 'length') entries.IT = 'LineDimension';
    if (m.type === 'polylength') entries.IT = 'PolyLineDimension';
    if (m.type === 'area') entries.IT = 'PolygonDimension';
    if (m.type === 'length' || m.type === 'polylength' || m.type === 'area') entries.Measure = measureDict(doc, scale);

    const annot = doc.context.obj(entries as never) as unknown as PDFDict;
    annot.set(KEY, PDFHexString.fromText(JSON.stringify(m)));
    page.node.addAnnot(doc.context.register(annot));
  }

  if (Object.keys(scales).length) doc.catalog.set(SCALES_KEY, PDFHexString.fromText(JSON.stringify(scales)));
  return doc.save({ useObjectStreams: false });
}
