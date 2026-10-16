import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { AnnotationMode } from '../lib/pdfjs';
import { useDoc } from '../store';
import type { Markup, MarkupType, Pt } from '../types';
import { bounds, dist, distToSegment, pointInPolygon, rectCorners, boxFrom, simplify, snap45 } from '../lib/geometry';
import {
  BOX_TEXT,
  BOX_TYPES,
  CLICK_TOOLS,
  cloudPlusBox,
  cloudRect,
  hasText,
  NOTE_H,
  NOTE_W,
  CLOSED_TYPES,
  isMarkupTool,
  LINE_HEIGHT,
  makeMarkup,
  shapeTextBox,
  TEXT_SHAPES,
  textBox,
  translate,
} from '../lib/markups';
import { handlesFor, textLayout } from '../lib/render';
import { DEFAULT_SCALE } from '../lib/measure';
import { MarkupView, measureUi } from './MarkupView';

export type OcConfig = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;
export interface Size {
  w: number;
  h: number;
}

const MAX_PIXELS = 36_000_000;

// Shared keyboard state (space-to-pan) between the viewer and its pages.
export const keys = { space: false };

// Screen <-> page units. getScreenCTM includes the viewBox scale and any CSS rotation.
export function clientToPage(svg: SVGSVGElement, c: Pt): Pt {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(c.x, c.y).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export function pageToClient(svg: SVGSVGElement, p: Pt): Pt {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const q = new DOMPoint(p.x, p.y).matrixTransform(m);
  return { x: q.x, y: q.y };
}

// CSS transform that rotates the page box inside its (rotated-size) slot.
function rotationTransform(rot: number, w: number, h: number): string | undefined {
  switch (rot) {
    case 90: return `translateX(${h}px) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translateY(${w}px) rotate(270deg)`;
    default: return undefined;
  }
}

type Drag =
  | { mode: 'draw'; type: MarkupType | 'calibrate'; start: Pt }
  | { mode: 'pen'; pts: Pt[] }
  | { mode: 'move'; start: Pt; orig: Markup[]; moved: boolean }
  | { mode: 'handle'; id: string; index: number; orig: Markup }
  | { mode: 'marquee'; start: Pt; additive: boolean };

const LINE_LIKE = new Set(['line', 'arrow', 'length', 'calibrate']);

interface Props {
  pdf: PDFDocumentProxy;
  index: number;
  size: Size;
  zoom: number;
  rotation: number;
  oc: OcConfig | null;
  canvasFilter?: string;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  alwaysVisible: boolean;
  registerSlot(i: number, el: HTMLDivElement | null): void;
  registerSvg(i: number, el: SVGSVGElement | null): void;
  onCursor(p: Pt | null): void;
}

function PageViewImpl(props: Props) {
  const { pdf, index, size, zoom, rotation, oc, scrollRoot, alwaysVisible } = props;
  const tool = useDoc((s) => s.tool);
  const active = useDoc((s) => s.page === index);
  const allMarkups = useDoc((s) => s.markups);
  const selection = useDoc((s) => s.selection);
  const editingText = useDoc((s) => s.editingText);
  const scale = useDoc((s) => s.scales[index]) ?? DEFAULT_SCALE;
  const view = useDoc((s) => s.view);
  const layersVersion = useDoc((s) => s.layersVersion);

  const slotRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(alwaysVisible);
  const [draft, setDraft] = useState<Markup | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [liveEdit, setLiveEdit] = useState<Markup[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const clickPts = useRef<Pt[]>([]);
  const activeCount = useRef<string | null>(null);

  const W = size.w * zoom;
  const H = size.h * zoom;
  const rotated = rotation % 180 !== 0;
  const gridPts = view.gridSpacing * 72;

  useEffect(() => {
    props.registerSlot(index, slotRef.current);
    props.registerSvg(index, svgRef.current);
    return () => {
      props.registerSlot(index, null);
      props.registerSvg(index, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // ---------------------------------------------------------------- lazy canvas rendering
  useEffect(() => {
    if (alwaysVisible) {
      setVisible(true);
      return;
    }
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: scrollRoot.current, rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [alwaysVisible, scrollRoot]);

  useEffect(() => {
    if (!visible) {
      canvasHost.current?.replaceChildren(); // free memory for pages far off screen
      return;
    }
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    const timer = setTimeout(async () => {
      const p = await pdf.getPage(index + 1);
      if (cancelled) return;
      let renderScale = zoom * (window.devicePixelRatio || 1);
      const px = size.w * size.h * renderScale * renderScale;
      if (px > MAX_PIXELS) renderScale *= Math.sqrt(MAX_PIXELS / px);
      const vp = p.getViewport({ scale: renderScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.className = 'page-canvas';
      const t = p.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport: vp,
        annotationMode: AnnotationMode.ENABLE,
        ...(oc ? { optionalContentConfigPromise: Promise.resolve(oc) } : {}),
      });
      task = t;
      try {
        await t.promise;
        if (!cancelled) canvasHost.current?.replaceChildren(canvas);
      } catch {
        /* cancelled */
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, index, size, zoom, visible, oc, layersVersion]);

  // ---------------------------------------------------------------- helpers
  // snap to a nearby markup point first (when on), then to the grid
  const snapPt = (p: Pt): Pt => {
    if (view.snapMarkup) {
      const tol = 10 / zoom;
      let best: Pt | null = null;
      let bestD = tol;
      for (const m of useDoc.getState().markups) {
        if (m.page !== index) continue;
        const pts = BOX_TYPES.has(m.type) || m.type === 'cloudplus' ? [...rectCorners(boxFrom(m.points[0], m.points[1] ?? m.points[0])), ...m.points.slice(2)] : m.points;
        for (const q of pts) {
          const d = dist(q, p);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (best) return best;
    }
    if (!view.grid || !view.snap) return p;
    return { x: Math.round(p.x / gridPts) * gridPts, y: Math.round(p.y / gridPts) * gridPts };
  };
  const toPage = (e: { clientX: number; clientY: number }): Pt => clientToPage(svgRef.current!, { x: e.clientX, y: e.clientY });
  const style = (t: MarkupType) => useDoc.getState().styles[t];

  const finishTool = () => {
    if (!useDoc.getState().toolLocked) useDoc.setState({ tool: 'select' });
  };

  const commitClickShape = useCallback(() => {
    const pts = clickPts.current;
    const t = useDoc.getState().tool;
    clickPts.current = [];
    setDraft(null);
    if (!isMarkupTool(t)) return;
    if (pts.length >= (CLOSED_TYPES.has(t) ? 3 : 2)) {
      const st = useDoc.getState();
      const m = makeMarkup(t, index, pts, st.styles[t], st.author);
      st.add(m);
      useDoc.setState({ selection: [m.id] });
      finishTool();
    }
  }, [index]);

  const cancelDraft = useCallback(() => {
    clickPts.current = [];
    activeCount.current = null;
    drag.current = null;
    setDraft(null);
    setMarquee(null);
    setLiveEdit(null);
  }, []);

  useEffect(cancelDraft, [tool, active, cancelDraft]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (clickPts.current.length) {
        if (e.key === 'Enter') commitClickShape();
        else if (e.key === 'Escape') cancelDraft();
        else if (e.key === 'Backspace') {
          clickPts.current = clickPts.current.slice(0, -1);
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'Escape' || e.key === 'Enter') activeCount.current = null;
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [commitClickShape, cancelDraft]);

  const hitTest = (pt: Pt): Markup | null => {
    if (!useDoc.getState().view.showMarkups) return null;
    const tol = 6 / zoom;
    const list = useDoc.getState().markups.filter((m) => m.page === index);
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.type === 'note') {
        const a = m.points[0];
        if (pt.x >= a.x - tol && pt.x <= a.x + NOTE_W + tol && pt.y >= a.y - tol && pt.y <= a.y + NOTE_H + tol) return m;
        continue;
      }
      if (m.type === 'cloudplus') {
        const near = (bx: { x: number; y: number; w: number; h: number }) => pt.x >= bx.x - tol && pt.x <= bx.x + bx.w + tol && pt.y >= bx.y - tol && pt.y <= bx.y + bx.h + tol;
        if (near(cloudRect(m)) || (m.points.length >= 4 && near(textBox(m)))) return m;
        continue;
      }
      if (BOX_TYPES.has(m.type) || m.type === 'callout') {
        const bx = m.type === 'callout' ? textBox(m) : bounds(m.points);
        if (pt.x >= bx.x - tol && pt.x <= bx.x + bx.w + tol && pt.y >= bx.y - tol && pt.y <= bx.y + bx.h + tol) return m;
      }
      // polygons and polygon clouds are grabbed anywhere inside, like boxes
      if ((m.type === 'polygon' || m.type === 'polycloud' || (m.fill && m.type === 'area')) && pointInPolygon(pt, m.points)) return m;
      const pts = m.points;
      const closed = CLOSED_TYPES.has(m.type);
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j];
        const c = pts[j + 1] ?? (closed ? pts[0] : null);
        if (m.type === 'count' ? dist(a, pt) < 8 / zoom + tol : c ? distToSegment(pt, a, c) < tol + m.width : dist(a, pt) < tol) return m;
      }
    }
    return null;
  };

  const draftFor = (type: MarkupType | 'calibrate', points: Pt[]): Markup => {
    const t: MarkupType = type === 'calibrate' ? 'length' : type;
    const m = makeMarkup(t, index, points, style(t), useDoc.getState().author);
    if (type === 'calibrate') m.color = '#ff00aa';
    return m;
  };

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    if (useDoc.getState().editingText) return;
    // panning is handled by the viewer; let the event bubble to it
    if (e.button === 1 || tool === 'pan' || keys.space) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!active) useDoc.setState({ page: index, selection: [] });
    const raw = toPage(e);
    const pt = tool === 'select' ? raw : snapPt(raw);
    const st = useDoc.getState();

    if (tool === 'select') {
      if (st.selection.length === 1) {
        const m = st.markups.find((x) => x.id === st.selection[0]);
        if (m && m.page === index) {
          const idx = handlesFor(m).findIndex((h) => dist(h, pt) < 7 / zoom);
          if (idx >= 0) {
            drag.current = { mode: 'handle', id: m.id, index: idx, orig: m };
            return;
          }
        }
      }
      const hit = hitTest(pt);
      if (hit) {
        let sel = active ? st.selection : [];
        if (e.shiftKey) sel = sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id];
        else if (!sel.includes(hit.id)) sel = [hit.id];
        useDoc.setState({ selection: sel });
        drag.current = { mode: 'move', start: pt, orig: st.markups.filter((m) => sel.includes(m.id)), moved: false };
      } else {
        if (!e.shiftKey) useDoc.setState({ selection: [] });
        drag.current = { mode: 'marquee', start: pt, additive: e.shiftKey };
      }
      return;
    }

    if (tool === 'note') {
      // drop a sticky note and jump to its comment field
      const m = makeMarkup('note', index, [{ x: pt.x - 4, y: pt.y - NOTE_H }], style('note'), st.author);
      st.add(m);
      useDoc.setState({ selection: [m.id], showProps: true });
      finishTool();
      setTimeout(() => (document.querySelector('.props textarea[data-field="comment"]') as HTMLTextAreaElement | null)?.focus(), 50);
      return;
    }

    if (tool === 'count') {
      const existing = activeCount.current && st.markups.find((m) => m.id === activeCount.current && m.page === index);
      if (existing) st.update([existing.id], (m) => ({ points: [...m.points, pt] }));
      else {
        const m = makeMarkup('count', index, [pt], style('count'), st.author);
        st.add(m);
        activeCount.current = m.id;
      }
      return;
    }

    if (CLICK_TOOLS.has(tool)) {
      // the second press of a double-click lands on the same spot; onDoubleClick finishes the shape
      const last = clickPts.current[clickPts.current.length - 1];
      if (last && dist(last, pt) * zoom < 4) return;
      clickPts.current = [...clickPts.current, last && e.shiftKey ? snap45(last, pt) : pt];
      return;
    }

    if (tool === 'pen') {
      drag.current = { mode: 'pen', pts: [raw] };
      return;
    }

    if (isMarkupTool(tool) || tool === 'calibrate') drag.current = { mode: 'draw', type: tool, start: pt };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toPage(e);
    props.onCursor(raw);
    const d = drag.current;
    const pt = d?.mode === 'move' || d?.mode === 'marquee' || tool === 'select' ? raw : snapPt(raw);

    if (!d) {
      if (clickPts.current.length && isMarkupTool(tool)) {
        const last = clickPts.current[clickPts.current.length - 1];
        setDraft(draftFor(tool, [...clickPts.current, e.shiftKey ? snap45(last, pt) : pt]));
      }
      return;
    }
    switch (d.mode) {
      case 'pen':
        d.pts.push(raw);
        setDraft(draftFor('pen', [...d.pts]));
        break;
      case 'draw': {
        const end = LINE_LIKE.has(d.type) && e.shiftKey ? snap45(d.start, pt) : pt;
        if (d.type === 'callout') setDraft(draftFor('callout', [d.start, end, { x: end.x + 160, y: end.y + 40 }]));
        else if (d.type === 'cloudplus') setDraft(draftFor('cloudplus', [d.start, end, ...cloudPlusBox(d.start, end, style('cloudplus').fontSize, size.w)]));
        else setDraft(draftFor(d.type, [d.start, end]));
        break;
      }
      case 'move': {
        const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
        d.moved = true;
        setLiveEdit(d.orig.map((m) => translate(m, dx, dy)));
        break;
      }
      case 'handle': {
        const pts = [...d.orig.points];
        if (d.orig.type === 'cloudplus' && d.index === 4) {
          // the middle handle drags the text box on its own; the leader follows
          const c = { x: (pts[2].x + pts[3].x) / 2, y: (pts[2].y + pts[3].y) / 2 };
          const dx = raw.x - c.x, dy = raw.y - c.y;
          pts[2] = { x: pts[2].x + dx, y: pts[2].y + dy };
          pts[3] = { x: pts[3].x + dx, y: pts[3].y + dy };
          setLiveEdit([{ ...d.orig, points: pts }]);
          break;
        }
        const prev = pts[d.index - 1] ?? pts[d.index + 1];
        pts[d.index] = e.shiftKey && prev ? snap45(prev, pt) : pt;
        setLiveEdit([{ ...d.orig, points: pts }]);
        break;
      }
      case 'marquee':
        setMarquee({ a: d.start, b: pt });
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useDoc.getState();
    const raw = toPage(e);
    const pt = d.mode === 'move' || d.mode === 'marquee' ? raw : snapPt(raw);

    switch (d.mode) {
      case 'pen': {
        setDraft(null);
        const pts = simplify(d.pts, 1.5 / zoom);
        if (pts.length > 1) st.add(makeMarkup('pen', index, pts, style('pen'), st.author));
        break;
      }
      case 'draw': {
        setDraft(null);
        let end = LINE_LIKE.has(d.type) && e.shiftKey ? snap45(d.start, pt) : pt;
        const tiny = dist(d.start, end) * zoom < 4;
        if (d.type === 'calibrate') {
          if (!tiny) useDoc.setState({ scaleDialog: { open: true, calibrated: dist(d.start, end) }, tool: 'select' });
          return;
        }
        let points = [d.start, end];
        if (d.type === 'text') {
          if (tiny) end = { x: d.start.x + 180, y: d.start.y + st.styles.text.fontSize * 2.5 };
          points = [d.start, end];
        } else if (d.type === 'callout') {
          points = [d.start, end, { x: end.x + 160, y: end.y + 40 }];
        } else if (tiny) return;
        else if (d.type === 'cloudplus') points = [d.start, end, ...cloudPlusBox(d.start, end, st.styles.cloudplus.fontSize, size.w)];
        const m = makeMarkup(d.type, index, points, style(d.type), st.author);
        st.add(m);
        useDoc.setState({ selection: [m.id] });
        if (BOX_TEXT.has(d.type)) useDoc.setState({ editingText: m.id, tool: st.toolLocked ? tool : 'select' });
        else finishTool();
        break;
      }
      case 'move':
      case 'handle': {
        const edited = liveEdit;
        setLiveEdit(null);
        if (edited && (d.mode === 'handle' || d.moved)) {
          const byId = new Map(edited.map((m) => [m.id, m]));
          st.update([...byId.keys()], (m) => ({ points: byId.get(m.id)!.points }));
        }
        break;
      }
      case 'marquee': {
        setMarquee(null);
        const x0 = Math.min(d.start.x, pt.x), x1 = Math.max(d.start.x, pt.x);
        const y0 = Math.min(d.start.y, pt.y), y1 = Math.max(d.start.y, pt.y);
        if ((x1 - x0) * zoom < 3 && (y1 - y0) * zoom < 3) return;
        const inside = st.markups
          .filter((m) => m.page === index && st.view.showMarkups)
          .filter((m) => {
            const b = bounds(m.points);
            return b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
          })
          .map((m) => m.id);
        useDoc.setState({ selection: d.additive ? [...new Set([...st.selection, ...inside])] : inside });
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (CLICK_TOOLS.has(tool)) {
      commitClickShape();
      return;
    }
    if (tool !== 'select') return;
    const hit = hitTest(toPage(e));
    if (hit && hasText(hit.type)) useDoc.setState({ editingText: hit.id, selection: [hit.id] });
  };

  // ---------------------------------------------------------------- render
  const live = new Map((liveEdit ?? []).map((m) => [m.id, m]));
  const pageMarkups = view.showMarkups ? allMarkups.filter((m) => m.page === index).map((m) => live.get(m.id) ?? m) : [];
  const selected = active ? pageMarkups.filter((m) => selection.includes(m.id)) : [];
  const editing = editingText ? pageMarkups.find((m) => m.id === editingText) : null;
  const cursor = keys.space || tool === 'pan' ? 'grab' : view.crosshair ? 'none' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div className="page-slot" ref={slotRef} style={{ width: rotated ? H : W, height: rotated ? W : H }}>
      <div className="page" style={{ width: W, height: H, transform: rotationTransform(rotation, W, H), transformOrigin: '0 0' }}>
        <div className="canvas-host" ref={canvasHost} style={{ filter: props.canvasFilter }} />
        <svg
          ref={svgRef}
          className="overlay"
          width={W}
          height={H}
          viewBox={`0 0 ${size.w} ${size.h}`}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => props.onCursor(null)}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {view.grid && <Grid id={index} w={size.w} h={size.h} spacing={gridPts} zoom={zoom} />}
          {pageMarkups.map((m) => (
            <MarkupView key={m.id} m={m} scale={scale} interactive={false} hitWidth={0} hideText={m.id === editingText} />
          ))}
          {draft && <MarkupView m={draft} scale={scale} interactive={false} hitWidth={0} />}
          {selected.map((m) => {
            const b = bounds(m.points);
            const pad = 4 / zoom;
            return (
              <g key={m.id} pointerEvents="none">
                <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" stroke="#2b7cff" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
                {selected.length === 1 &&
                  handlesFor(m).map((h, i) => (
                    <rect key={i} x={h.x - 4 / zoom} y={h.y - 4 / zoom} width={8 / zoom} height={8 / zoom} fill="#fff" stroke="#2b7cff" strokeWidth={1.5 / zoom} />
                  ))}
              </g>
            );
          })}
          {marquee && (
            <rect
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
              fill="rgba(43,124,255,0.08)"
              stroke="#2b7cff"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
        </svg>
        {editing && <TextEditor m={editing} zoom={zoom} />}
      </div>
    </div>
  );
}

export const PageView = memo(PageViewImpl);

function Grid({ id, w, h, spacing, zoom }: { id: number; w: number; h: number; spacing: number; zoom: number }) {
  // minor lines thin out when they'd be closer than ~6px on screen
  const minorVisible = spacing * zoom >= 6;
  const major = spacing * 4;
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id={`grid-minor-${id}`} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          <path d={`M ${spacing} 0 L 0 0 0 ${spacing}`} fill="none" stroke="#2b7cff" strokeOpacity={0.18} strokeWidth={0.6 / zoom} />
        </pattern>
        <pattern id={`grid-major-${id}`} width={major} height={major} patternUnits="userSpaceOnUse">
          <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="#2b7cff" strokeOpacity={0.35} strokeWidth={1 / zoom} />
        </pattern>
      </defs>
      {minorVisible && <rect width={w} height={h} fill={`url(#grid-minor-${id})`} />}
      <rect width={w} height={h} fill={`url(#grid-major-${id})`} />
    </g>
  );
}

function TextEditor({ m, zoom }: { m: Markup; zoom: number }) {
  const shape = TEXT_SHAPES.has(m.type);
  const box = shape ? shapeTextBox(m) : textBox(m);
  const [value, setValue] = useState(m.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = () => {
    const st = useDoc.getState();
    useDoc.setState({ editingText: null });
    const isTextBox = BOX_TEXT.has(m.type);
    // an empty Cloud+ is still a cloud; empty text boxes and callouts are dropped
    if ((m.type === 'text' || m.type === 'callout') && !value.trim() && !m.text) {
      st.remove([m.id]);
      return;
    }
    if (value === m.text) return;
    if (!isTextBox) {
      st.update([m.id], { text: value });
      return;
    }
    // grow text boxes so nothing gets clipped
    const { lines } = textLayout({ ...m, text: value }, measureUi);
    const needH = lines.length * m.fontSize * LINE_HEIGHT + 8;
    const pts = [...m.points];
    const i = m.type === 'cloudplus' ? 3 : m.type === 'callout' ? 2 : 1;
    const j = i - 1;
    if (Math.abs(pts[i].y - pts[j].y) < needH) pts[i] = { ...pts[i], y: Math.min(pts[i].y, pts[j].y) + needH };
    st.update([m.id], { text: value, points: pts });
  };
  const outline = shape ? rectCorners(boxFrom({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h })) : null;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      placeholder={shape ? 'Type text…' : ''}
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      style={{
        left: box.x * zoom,
        top: box.y * zoom,
        width: Math.max(80, box.w * zoom),
        height: Math.max(m.fontSize * zoom * 1.6, box.h * zoom),
        fontSize: m.fontSize * zoom,
        color: m.color,
        padding: shape ? 0 : 4 * zoom,
        textAlign: shape ? 'center' : 'left',
        paddingTop: outline ? Math.max(0, (box.h * zoom - m.fontSize * zoom * LINE_HEIGHT) / 2) : undefined,
      }}
    />
  );
}
