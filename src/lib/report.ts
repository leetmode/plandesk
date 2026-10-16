// Review report: a plain PDF that walks through every comment one by one, with a
// zoomed, highlighted crop of the drawing and a small map of where it sits on the
// sheet. Meant for people who don't use markup software.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { Markup, PageScale, Status } from '../types';
import type { Box } from './geometry';
import { bounds, wrapText } from './geometry';
import { NOTE_H, NOTE_W, TYPE_LABEL } from './markups';
import { DEFAULT_SCALE, measureMarkup } from './measure';
import { safeText, savePdf } from './pdfio';
import { openDocument, AnnotationMode, type PDFDocumentProxy } from './pdfjs';

const PAGE_W = 612; // US Letter, portrait
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ZOOM_ASPECT = 2 / 3; // crop height / width
const ZOOM_PX = 1400; // rendered width of the zoomed crop
const MAP_PX = 700; // rendered width of the whole-sheet map
const ACCENT = '#ff8a00';

const INK = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.42, 0.46, 0.52);
const RULE = rgb(0.85, 0.87, 0.9);

const STATUS_COLOR: Record<Status, RGB> = {
  None: rgb(0.55, 0.58, 0.63),
  Open: rgb(0.17, 0.49, 1),
  Accepted: rgb(0.13, 0.62, 0.32),
  Rejected: rgb(0.86, 0.25, 0.27),
  Completed: rgb(0.45, 0.33, 0.8),
};

export interface ReportInput {
  baseBytes: Uint8Array;
  markups: Markup[]; // every markup, so the drawing shows them all
  include: Markup[]; // the ones that get a report entry
  scales: Record<number, PageScale>;
  fileName: string;
  onProgress?: (done: number, total: number) => void;
}

/** Area a markup covers on its page, in page units. */
export function markupExtent(m: Markup): Box {
  const b = bounds(m.points);
  if (m.type === 'note') return { x: b.x, y: b.y, w: NOTE_W, h: NOTE_H };
  const pad = m.width / 2 + (m.type === 'count' ? 8 : 0);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** The region to zoom to: the markup plus context, at the frame's aspect, kept on the page. */
export function zoomRegion(ext: Box, page: { w: number; h: number }): Box {
  const ctx = Math.max(36, 0.5 * Math.max(ext.w, ext.h));
  let w = Math.max(ext.w + ctx * 2, 420); // at least ~6 in of sheet, so small markups keep their surroundings
  let h = Math.max(ext.h + ctx * 2, 280);
  if (h / w > ZOOM_ASPECT) w = h / ZOOM_ASPECT;
  else h = w * ZOOM_ASPECT;
  // never larger than the page (keep the aspect), then slide it back onto the page
  const fit = Math.min(1, page.w / w, page.h / h);
  w *= fit;
  h *= fit;
  const cx = ext.x + ext.w / 2, cy = ext.y + ext.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), page.w - w);
  const y = Math.min(Math.max(cy - h / 2, 0), page.h - h);
  return { x, y, w, h };
}

/** Reading order: page, then top to bottom, then left to right. */
export function reportOrder(markups: Markup[]): Markup[] {
  const key = new Map(markups.map((m) => [m.id, markupExtent(m)]));
  return [...markups].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const ea = key.get(a.id)!, eb = key.get(b.id)!;
    const rowA = Math.round(ea.y / 72), rowB = Math.round(eb.y / 72); // same band = same row
    return rowA !== rowB ? rowA - rowB : ea.x - eb.x;
  });
}

// ---------------------------------------------------------------- images

async function toJpeg(doc: PDFDocument, canvas: HTMLCanvasElement): Promise<PDFImage> {
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image encoding failed'))), 'image/jpeg', 0.88));
  return doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
}

async function renderRegion(pdf: PDFDocumentProxy, pageIndex: number, region: Box, widthPx: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageIndex + 1);
  const scale = widthPx / region.w;
  const vp = page.getViewport({ scale, offsetX: -region.x * scale, offsetY: -region.y * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPx);
  canvas.height = Math.round(region.h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: AnnotationMode.ENABLE }).promise;
  return canvas;
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, label: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r / 6);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * (label.length > 2 ? 0.8 : 1.05))}px Segoe UI, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 1);
}

/** Dim everything except the markup, outline it, and pin its number. */
function highlight(canvas: HTMLCanvasElement, region: Box, ext: Box, n: number) {
  const ctx = canvas.getContext('2d')!;
  const s = canvas.width / region.w;
  const pad = 16; // keep the outline clear of the markup's own lines
  const x = (ext.x - region.x) * s - pad, y = (ext.y - region.y) * s - pad;
  const w = ext.w * s + pad * 2, h = ext.h * s + pad * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(20, 24, 32, 0.3)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill('evenodd');
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.stroke();
  ctx.restore();
  const r = 22;
  badge(ctx, Math.min(Math.max(x, r + 4), canvas.width - r - 4), Math.min(Math.max(y, r + 4), canvas.height - r - 4), r, String(n));
}

/** Mark the zoomed area on the whole-sheet map. */
function locate(canvas: HTMLCanvasElement, page: { w: number }, region: Box, n: number) {
  const ctx = canvas.getContext('2d')!;
  const s = canvas.width / page.w;
  ctx.lineWidth = 4;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = 'rgba(255, 138, 0, 0.18)';
  ctx.fillRect(region.x * s, region.y * s, region.w * s, region.h * s);
  ctx.strokeRect(region.x * s, region.y * s, region.w * s, region.h * s);
  badge(ctx, Math.max(region.x * s, 16), Math.max(region.y * s, 16), 14, String(n));
}

// ---------------------------------------------------------------- text layout

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private footer: string,
  ) {}

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNo++;
    this.y = PAGE_H - MARGIN;
    this.text(`${this.footer}  ·  ${this.pageNo}`, MARGIN, 24, 8, this.fonts.regular, MUTED);
  }

  text(s: string, x: number, y: number, size: number, font: PDFFont, color: RGB = INK) {
    this.page.drawText(safeText(font, s), { x, y, size, font, color });
  }

  width = (s: string, size: number, font: PDFFont) => font.widthOfTextAtSize(safeText(font, s), size);

  /** Wrapped paragraph at the cursor; continues on a new page when it runs out of room. */
  para(s: string, x: number, maxW: number, size: number, font: PDFFont, color: RGB = INK, gap = 1.35) {
    for (const line of wrapText(s, maxW, (t) => this.width(t, size, font))) {
      if (this.y - size < MARGIN + 12) {
        this.newPage();
        this.text('(continued)', x, this.y - 8, 8, this.fonts.regular, MUTED);
        this.y -= 22;
      }
      this.y -= size;
      this.text(line, x, this.y, size, font, color);
      this.y -= size * (gap - 1);
    }
  }

  rule(y = this.y) {
    this.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: RULE });
  }

  chip(label: string, x: number, y: number, color: RGB) {
    const size = 8.5;
    const w = this.width(label, size, this.fonts.bold) + 12;
    this.page.drawRectangle({ x, y: y - 4, width: w, height: size + 8, color });
    this.text(label, x + 6, y, size, this.fonts.bold, rgb(1, 1, 1));
    return w;
  }
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

// ---------------------------------------------------------------- report

export async function buildReport(input: ReportInput): Promise<Uint8Array> {
  const { markups, scales, fileName } = input;
  const items = reportOrder(input.include);
  const pdf = await openDocument(await savePdf(input.baseBytes, markups, scales)); // drawing with every markup on it
  try {
    const out = await PDFDocument.create();
    out.setTitle(`Review comments - ${fileName}`);
    out.setCreator('PlanDesk');
    const fonts: Fonts = { regular: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
    const w = new Writer(out, fonts, `${fileName}  ·  Review comments`);

    const sizes = new Map<number, { w: number; h: number }>();
    for (const p of new Set(items.map((m) => m.page))) {
      const v = (await pdf.getPage(p + 1)).getViewport({ scale: 1 });
      sizes.set(p, { w: v.width, h: v.height });
    }

    // ---- summary page
    w.newPage();
    w.text('Review comments', MARGIN, w.y - 26, 26, fonts.bold);
    w.y -= 46;
    w.text(fileName, MARGIN, w.y - 12, 12, fonts.regular, MUTED);
    w.y -= 18;
    w.text(`Prepared ${fmtDate(new Date().toISOString())}  ·  ${items.length} comment${items.length === 1 ? '' : 's'} on ${sizes.size} sheet page${sizes.size === 1 ? '' : 's'}`, MARGIN, w.y - 10, 10, fonts.regular, MUTED);
    w.y -= 28;
    w.para(
      'Each following page shows one comment: a close-up of the drawing with the spot highlighted in orange, a small map of where it is on the sheet, and what the reviewer wrote.',
      MARGIN, CONTENT_W, 10, fonts.regular, INK,
    );
    w.y -= 10;

    const statuses = new Map<Status, number>();
    for (const m of items) statuses.set(m.status, (statuses.get(m.status) ?? 0) + 1);
    let cx = MARGIN;
    for (const [st, n] of statuses) cx += w.chip(`${st === 'None' ? 'No status' : st}: ${n}`, cx, w.y - 12, STATUS_COLOR[st]) + 6;
    w.y -= 34;

    // index table
    const cols = [MARGIN, MARGIN + 28, MARGIN + 70, MARGIN + 150, MARGIN + 250, MARGIN + 470];
    const header = () => {
      ['#', 'Page', 'Type', 'By', 'Comment', 'Status'].forEach((h, i) => w.text(h, cols[i], w.y - 9, 8.5, fonts.bold, MUTED));
      w.y -= 15;
      w.rule();
      w.y -= 4;
    };
    header();
    items.forEach((m, i) => {
      if (w.y < MARGIN + 30) {
        w.newPage();
        header();
      }
      const say = firstLine(m.comment) || firstLine(m.text) || measureMarkup(m, scales[m.page] ?? DEFAULT_SCALE)?.text || '-';
      let clipped = say;
      while (clipped.length > 1 && w.width(clipped, 9, fonts.regular) > cols[5] - cols[4] - 10) clipped = clipped.slice(0, -2);
      const cells = [String(i + 1), String(m.page + 1), TYPE_LABEL[m.type], m.author || '-', clipped === say ? say : `${clipped.trimEnd()}...`];
      cells.forEach((c, j) => w.text(c, cols[j], w.y - 10, 9, j === 0 ? fonts.bold : fonts.regular, INK));
      w.text(m.status === 'None' ? '-' : m.status, cols[5], w.y - 10, 9, fonts.bold, STATUS_COLOR[m.status]);
      w.y -= 16;
    });

    // ---- one page per comment
    const maps = new Map<number, HTMLCanvasElement>();
    for (const [i, m] of items.entries()) {
      input.onProgress?.(i, items.length);
      const n = i + 1;
      const size = sizes.get(m.page)!;
      const ext = markupExtent(m);
      const region = zoomRegion(ext, size);

      const zoom = await renderRegion(pdf, m.page, region, ZOOM_PX);
      highlight(zoom, region, ext, n);
      if (!maps.has(m.page)) maps.set(m.page, await renderRegion(pdf, m.page, { x: 0, y: 0, ...size }, MAP_PX));
      const base = maps.get(m.page)!;
      const map = document.createElement('canvas');
      map.width = base.width;
      map.height = base.height;
      map.getContext('2d')!.drawImage(base, 0, 0);
      locate(map, size, region, n);

      w.newPage();
      // header
      w.page.drawCircle({ x: MARGIN + 14, y: w.y - 12, size: 14, color: rgb(1, 0.54, 0) });
      const label = String(n);
      w.text(label, MARGIN + 14 - w.width(label, 13, fonts.bold) / 2, w.y - 16.5, 13, fonts.bold, rgb(1, 1, 1));
      w.text(`Comment ${n} of ${items.length}`, MARGIN + 36, w.y - 17, 17, fonts.bold);
      const where = `Sheet page ${m.page + 1}`;
      w.text(where, PAGE_W - MARGIN - w.width(where, 10, fonts.regular), w.y - 15, 10, fonts.regular, MUTED);
      w.y -= 34;

      // close-up
      const zImg = await toJpeg(out, zoom);
      const zh = CONTENT_W * (zoom.height / zoom.width);
      w.page.drawImage(zImg, { x: MARGIN, y: w.y - zh, width: CONTENT_W, height: zh });
      w.page.drawRectangle({ x: MARGIN, y: w.y - zh, width: CONTENT_W, height: zh, borderColor: RULE, borderWidth: 1 });
      w.y -= zh + 18;

      // map on the left, details on the right
      const top = w.y;
      const mapW = 190;
      const mapH = Math.min(170, mapW * (map.height / map.width));
      const mw = mapH / (map.height / map.width);
      w.page.drawImage(await toJpeg(out, map), { x: MARGIN, y: top - mapH - 14, width: mw, height: mapH });
      w.page.drawRectangle({ x: MARGIN, y: top - mapH - 14, width: mw, height: mapH, borderColor: RULE, borderWidth: 1 });
      w.text('Where on the sheet', MARGIN, top - 9, 8.5, fonts.bold, MUTED);

      const dx = MARGIN + mapW + 22;
      const dw = PAGE_W - MARGIN - dx;
      const said = m.comment.trim();
      const onDrawing = m.text.trim();
      const meas = measureMarkup(m, scales[m.page] ?? DEFAULT_SCALE)?.text;
      w.y = top;
      const section = (title: string, body: string, size: number, font: PDFFont, color: RGB = INK) => {
        w.text(title, dx, w.y - 9, 8.5, fonts.bold, MUTED);
        w.y -= 14;
        w.para(body, dx, dw, size, font, color);
        w.y -= 10;
      };
      if (said) section('Comment', said, 12.5, fonts.regular);
      if (onDrawing && onDrawing !== said) section(said ? 'Text on the drawing' : 'Comment', onDrawing, said ? 11 : 12.5, fonts.regular);
      if (!said && !onDrawing) section('Comment', meas ? 'Measurement only (no written comment).' : 'No written comment. See the highlighted markup.', 11, fonts.regular, MUTED);
      if (meas) section('Measurement', meas, 12, fonts.bold);

      w.y -= 2;
      const facts: [string, string][] = [
        ['Type', TYPE_LABEL[m.type]],
        ...(m.subject && m.subject !== TYPE_LABEL[m.type] ? [['Subject', m.subject] as [string, string]] : []),
        ['By', m.author || '-'],
        ['Date', fmtDate(m.modified || m.created)],
      ];
      for (const [k, v] of facts) {
        if (w.y < MARGIN + 20) w.newPage();
        w.text(k, dx, w.y - 10, 9, fonts.bold, MUTED);
        w.text(v, dx + 52, w.y - 10, 9.5, fonts.regular);
        w.y -= 15;
      }
      w.text('Status', dx, w.y - 10, 9, fonts.bold, MUTED);
      w.chip(m.status === 'None' ? 'No status' : m.status, dx + 52, w.y - 10, STATUS_COLOR[m.status]);
    }
    input.onProgress?.(items.length, items.length);
    return await out.save();
  } finally {
    pdf.loadingTask.destroy();
  }
}
