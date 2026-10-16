import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { AnnotationMode } from '../lib/pdfjs';
import { useDoc } from '../store';
import type { Markup, MarkupType, Pt } from '../types';
import { bounds, dist, distToSegment, simplify, snap45 } from '../lib/geometry';
import { BOX_TYPES, CLICK_TOOLS, CLOSED_TYPES, isMarkupTool, makeMarkup, textBox, translate } from '../lib/markups';
import { handlesFor } from '../lib/render';
import { DEFAULT_SCALE } from '../lib/measure';
import { MarkupView } from './MarkupView';

const MAX_PIXELS = 36_000_000;
const PAD = 24;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;

type Drag =
  | { mode: 'draw'; type: MarkupType | 'calibrate'; start: Pt }
  | { mode: 'pen'; pts: Pt[] }
  | { mode: 'move'; start: Pt; orig: Markup[]; moved: boolean }
  | { mode: 'handle'; id: string; index: number; orig: Markup }
  | { mode: 'marquee'; start: Pt; additive: boolean }
  | { mode: 'pan'; client: Pt; scroll: Pt };

interface Props {
  pdf: PDFDocumentProxy | null;
}

export function Viewer({ pdf }: Props) {
  const s = useDoc();
  const { page, zoom, tool } = s;
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Markup | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [liveEdit, setLiveEdit] = useState<Markup[] | null>(null); // markups being dragged, before commit
  const drag = useRef<Drag | null>(null);
  const clickPts = useRef<Pt[]>([]);
  const activeCount = useRef<string | null>(null);
  const spaceDown = useRef(false);
  const zoomAnchor = useRef<{ page: Pt; client: Pt } | null>(null);

  const scale = s.scales[page] ?? DEFAULT_SCALE;
  const style = (t: MarkupType) => s.styles[t];

  // ---------------------------------------------------------------- page size + rendering
  useEffect(() => {
    let live = true;
    setSize(null);
    if (!pdf) return;
    pdf.getPage(page + 1).then((p) => {
      if (!live) return;
      const vp = p.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      live = false;
    };
  }, [pdf, page]);

  useEffect(() => {
    if (!pdf || !size) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    const timer = setTimeout(async () => {
      const p = await pdf.getPage(page + 1);
      if (cancelled) return;
      let renderScale = zoom * (window.devicePixelRatio || 1);
      const px = size.w * size.h * renderScale * renderScale;
      if (px > MAX_PIXELS) renderScale *= Math.sqrt(MAX_PIXELS / px);
      const vp = p.getViewport({ scale: renderScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.className = 'page-canvas';
      const t = p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp, annotationMode: AnnotationMode.ENABLE });
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
  }, [pdf, page, size, zoom]);

  // ---------------------------------------------------------------- zoom
  const setZoom = useCallback((z: number, anchorClient?: Pt) => {
    const el = scrollRef.current;
    const svg = svgRef.current;
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (el && svg) {
      const r = el.getBoundingClientRect();
      const client = anchorClient ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const sr = svg.getBoundingClientRect();
      const cur = useDoc.getState().zoom;
      zoomAnchor.current = { page: { x: (client.x - sr.left) / cur, y: (client.y - sr.top) / cur }, client };
    }
    useDoc.setState({ zoom: nz });
  }, []);

  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!a || !el || !svg) return;
    zoomAnchor.current = null;
    const sr = svg.getBoundingClientRect();
    el.scrollLeft += sr.left + a.page.x * zoom - a.client.x;
    el.scrollTop += sr.top + a.page.y * zoom - a.client.y;
  }, [zoom]);

  useEffect(() => {
    const cmd = s.zoomCmd;
    const el = scrollRef.current;
    if (!cmd || !el || !size) return;
    const fw = (el.clientWidth - PAD * 2) / size.w;
    const fp = Math.min(fw, (el.clientHeight - PAD * 2) / size.h);
    if (cmd.kind === 'fitWidth') useDoc.setState({ zoom: fw });
    else if (cmd.kind === 'fitPage') useDoc.setState({ zoom: fp });
    else if (cmd.kind === 'actual') setZoom(1);
    else setZoom(zoom * (cmd.kind === 'in' ? 1.25 : 0.8));
    useDoc.setState({ zoomCmd: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.zoomCmd, size]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const zoomIt = e.ctrlKey || e.metaKey || useDoc.getState().wheelZooms;
      if (!zoomIt) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !useDoc.getState().wheelZooms ? 0.01 : 0.0015));
      setZoom(useDoc.getState().zoom * factor, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // scroll a markup into view when picked from the list
  useEffect(() => {
    const id = s.focusId;
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!id || !el || !svg || !size) return;
    const m = s.markups.find((x) => x.id === id);
    if (!m || m.page !== page) return;
    const b = bounds(m.points);
    el.scrollLeft = PAD + (b.x + b.w / 2) * zoom - el.clientWidth / 2;
    el.scrollTop = PAD + (b.y + b.h / 2) * zoom - el.clientHeight / 2;
    useDoc.setState({ focusId: null });
  }, [s.focusId, s.markups, page, size, zoom]);

  // ---------------------------------------------------------------- helpers
  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const finishTool = () => {
    if (!useDoc.getState().toolLocked) useDoc.setState({ tool: 'select' });
  };

  const commitClickShape = useCallback(() => {
    const pts = clickPts.current;
    const t = useDoc.getState().tool;
    clickPts.current = [];
    setDraft(null);
    if (!isMarkupTool(t)) return;
    const min = CLOSED_TYPES.has(t) ? 3 : 2;
    if (pts.length >= min) {
      const st = useDoc.getState();
      const m = makeMarkup(t, st.page, pts, st.styles[t], st.author);
      st.add(m);
      useDoc.setState({ selection: [m.id] });
      finishTool();
    }
  }, []);

  const cancelDraft = useCallback(() => {
    clickPts.current = [];
    activeCount.current = null;
    drag.current = null;
    setDraft(null);
    setMarquee(null);
    setLiveEdit(null);
  }, []);

  useEffect(cancelDraft, [tool, page, cancelDraft]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.code === 'Space') spaceDown.current = true;
      if (clickPts.current.length) {
        if (e.key === 'Enter') commitClickShape();
        else if (e.key === 'Escape') cancelDraft();
        else if (e.key === 'Backspace') {
          clickPts.current = clickPts.current.slice(0, -1);
          e.preventDefault();
        }
      } else if (e.key === 'Escape' || e.key === 'Enter') activeCount.current = null;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [commitClickShape, cancelDraft]);

  const hitTest = (pt: Pt): Markup | null => {
    const tol = 6 / zoom;
    const list = useDoc.getState().markups.filter((m) => m.page === page);
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const b = bounds(m.type === 'callout' ? m.points : m.points);
      if (BOX_TYPES.has(m.type) || m.type === 'callout' || (m.fill && CLOSED_TYPES.has(m.type))) {
        const bx = m.type === 'callout' ? textBox(m) : b;
        if (pt.x >= bx.x - tol && pt.x <= bx.x + bx.w + tol && pt.y >= bx.y - tol && pt.y <= bx.y + bx.h + tol) return m;
      }
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

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    if (!size || s.editingText) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const el = scrollRef.current!;
    if (e.button === 1 || tool === 'pan' || spaceDown.current) {
      drag.current = { mode: 'pan', client: { x: e.clientX, y: e.clientY }, scroll: { x: el.scrollLeft, y: el.scrollTop } };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = toPage(e);
    const st = useDoc.getState();

    if (tool === 'select') {
      // handle drag on the single selected markup
      if (st.selection.length === 1) {
        const m = st.markups.find((x) => x.id === st.selection[0]);
        if (m && m.page === page) {
          const idx = handlesFor(m).findIndex((h) => dist(h, pt) < 7 / zoom);
          if (idx >= 0) {
            drag.current = { mode: 'handle', id: m.id, index: idx, orig: m };
            return;
          }
        }
      }
      const hit = hitTest(pt);
      if (hit) {
        let sel = st.selection;
        if (e.shiftKey) sel = sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id];
        else if (!sel.includes(hit.id)) sel = [hit.id];
        useDoc.setState({ selection: sel });
        const orig = st.markups.filter((m) => sel.includes(m.id));
        drag.current = { mode: 'move', start: pt, orig, moved: false };
      } else {
        if (!e.shiftKey) useDoc.setState({ selection: [] });
        drag.current = { mode: 'marquee', start: pt, additive: e.shiftKey };
      }
      return;
    }

    if (tool === 'count') {
      const existing = activeCount.current && st.markups.find((m) => m.id === activeCount.current && m.page === page);
      if (existing) st.update([existing.id], (m) => ({ points: [...m.points, pt] }));
      else {
        const m = makeMarkup('count', page, [pt], style('count'), st.author);
        st.add(m);
        activeCount.current = m.id;
      }
      return;
    }

    if (CLICK_TOOLS.has(tool)) {
      // the second press of a double-click lands on the same spot; the dblclick handler finishes the shape
      const last = clickPts.current[clickPts.current.length - 1];
      if (last && dist(last, pt) * zoom < 4) return;
      const p2 = last && e.shiftKey ? snap45(last, pt) : pt;
      clickPts.current = [...clickPts.current, p2];
      return;
    }

    if (tool === 'pen') {
      drag.current = { mode: 'pen', pts: [pt] };
      return;
    }

    if (isMarkupTool(tool) || tool === 'calibrate') {
      drag.current = { mode: 'draw', type: tool, start: pt };
    }
  };

  const draftFor = (type: MarkupType | 'calibrate', points: Pt[]): Markup => {
    const t: MarkupType = type === 'calibrate' ? 'length' : type;
    const m = makeMarkup(t, page, points, style(t), s.author);
    if (type === 'calibrate') m.color = '#ff00aa';
    return m;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!size) return;
    const pt = toPage(e);
    setCursor(pt);
    const d = drag.current;

    if (!d) {
      if (clickPts.current.length && isMarkupTool(tool)) {
        const last = clickPts.current[clickPts.current.length - 1];
        setDraft(draftFor(tool, [...clickPts.current, e.shiftKey ? snap45(last, pt) : pt]));
      }
      return;
    }
    switch (d.mode) {
      case 'pan': {
        const el = scrollRef.current!;
        el.scrollLeft = d.scroll.x - (e.clientX - d.client.x);
        el.scrollTop = d.scroll.y - (e.clientY - d.client.y);
        break;
      }
      case 'pen':
        d.pts.push(pt);
        setDraft(draftFor('pen', [...d.pts]));
        break;
      case 'draw': {
        const lineLike = d.type === 'line' || d.type === 'arrow' || d.type === 'length' || d.type === 'calibrate';
        const end = lineLike && e.shiftKey ? snap45(d.start, pt) : pt;
        if (d.type === 'callout') {
          setDraft(draftFor('callout', [d.start, end, { x: end.x + 160, y: end.y + 40 }]));
        } else setDraft(draftFor(d.type, [d.start, end]));
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
    if (!d || !size) return;
    const st = useDoc.getState();
    const pt = toPage(e);

    switch (d.mode) {
      case 'pen': {
        setDraft(null);
        const pts = simplify(d.pts, 1.5 / zoom);
        if (pts.length > 1) st.add(makeMarkup('pen', page, pts, style('pen'), st.author));
        break;
      }
      case 'draw': {
        setDraft(null);
        const lineLike = d.type === 'line' || d.type === 'arrow' || d.type === 'length' || d.type === 'calibrate';
        let end = lineLike && e.shiftKey ? snap45(d.start, pt) : pt;
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
        const m = makeMarkup(d.type, page, points, style(d.type), st.author);
        st.add(m);
        useDoc.setState({ selection: [m.id] });
        if (d.type === 'text' || d.type === 'callout') useDoc.setState({ editingText: m.id, tool: st.toolLocked ? tool : 'select' });
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
          .filter((m) => m.page === page)
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
    if (hit && (hit.type === 'text' || hit.type === 'callout')) useDoc.setState({ editingText: hit.id, selection: [hit.id] });
  };

  // ---------------------------------------------------------------- render
  if (!pdf) return <div className="viewer empty" ref={scrollRef} />;

  const live = new Map((liveEdit ?? []).map((m) => [m.id, m]));
  const pageMarkups = s.markups.filter((m) => m.page === page).map((m) => live.get(m.id) ?? m);
  const selected = pageMarkups.filter((m) => s.selection.includes(m.id));
  const editing = s.editingText ? pageMarkups.find((m) => m.id === s.editingText) : null;
  const hitWidth = 10 / zoom;
  const cursorStyle =
    tool === 'pan' || spaceDown.current ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div className="viewer-shell">
    <div className="viewer" ref={scrollRef}>
      {size && (
        <div className="page-wrap" style={{ padding: PAD, width: size.w * zoom + PAD * 2, height: size.h * zoom + PAD * 2 }}>
          <div className="page" style={{ width: size.w * zoom, height: size.h * zoom }}>
            <div className="canvas-host" ref={canvasHost} />
            <svg
              ref={svgRef}
              className="overlay"
              width={size.w * zoom}
              height={size.h * zoom}
              viewBox={`0 0 ${size.w} ${size.h}`}
              style={{ cursor: cursorStyle }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setCursor(null)}
              onDoubleClick={onDoubleClick}
              onContextMenu={(e) => e.preventDefault()}
            >
              {pageMarkups.map((m) => (
                <MarkupView key={m.id} m={m} scale={scale} interactive={false} hitWidth={hitWidth} hideText={m.id === s.editingText} />
              ))}
              {draft && <MarkupView m={draft} scale={scale} interactive={false} hitWidth={0} />}
              {selected.map((m) => {
                const b = bounds(m.type === 'callout' ? [m.points[0], ...m.points.slice(1)] : m.points);
                const padding = 4 / zoom;
                return (
                  <g key={m.id} pointerEvents="none">
                    <rect
                      x={b.x - padding}
                      y={b.y - padding}
                      width={b.w + padding * 2}
                      height={b.h + padding * 2}
                      fill="none"
                      stroke="#2b7cff"
                      strokeWidth={1 / zoom}
                      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                    />
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
      )}
    </div>
      {cursor && <CursorReadout pt={cursor} />}
    </div>
  );
}

function CursorReadout({ pt }: { pt: Pt }) {
  return (
    <div className="cursor-readout">
      {pt.x.toFixed(0)}, {pt.y.toFixed(0)} pt
    </div>
  );
}

function TextEditor({ m, zoom }: { m: Markup; zoom: number }) {
  const box = textBox(m);
  const [value, setValue] = useState(m.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = () => {
    const st = useDoc.getState();
    useDoc.setState({ editingText: null });
    if (!value.trim() && !m.text) {
      st.remove([m.id]);
      return;
    }
    if (value !== m.text) {
      // grow the box to fit the text so nothing gets clipped
      const lines = value.split('\n').length;
      const needH = lines * m.fontSize * 1.2 + 8;
      const pts = [...m.points];
      const i = m.type === 'callout' ? 2 : 1;
      const j = m.type === 'callout' ? 1 : 0;
      if (Math.abs(pts[i].y - pts[j].y) < needH) pts[i] = { ...pts[i], y: Math.min(pts[i].y, pts[j].y) + needH };
      st.update([m.id], { text: value, points: pts });
    }
  };
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
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
        padding: 4 * zoom,
      }}
    />
  );
}
