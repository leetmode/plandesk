import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { useDoc } from '../store';
import type { Pt } from '../types';
import { bounds } from '../lib/geometry';
import { PageView, type OcConfig, type Size, clientToPage, pageToClient, keys } from './PageView';

const PAD = 24;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;

interface Props {
  pdf: PDFDocumentProxy;
  oc: OcConfig | null;
}

export function Viewer({ pdf, oc }: Props) {
  const page = useDoc((s) => s.page);
  const zoom = useDoc((s) => s.zoom);
  const tool = useDoc((s) => s.tool);
  const view = useDoc((s) => s.view);
  const zoomCmd = useDoc((s) => s.zoomCmd);
  const focusId = useDoc((s) => s.focusId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const svgs = useRef(new Map<number, SVGSVGElement>());
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hair, setHair] = useState<Pt | null>(null); // crosshair position inside the viewer
  const anchor = useRef<{ index: number; pt: Pt; client: Pt } | null>(null);
  const scrolledPage = useRef(-1); // page the continuous view last scrolled to / from
  const pan = useRef<{ client: Pt; scroll: Pt } | null>(null);
  const [, force] = useState(0);

  const continuous = view.layout === 'continuous' || view.layout === 'continuousSideBySide';
  // side-by-side shows pages in pairs: odd pages on the left, even on the right
  const paired = view.layout === 'sideBySide' || view.layout === 'continuousSideBySide';
  const rotated = view.rotation % 180 !== 0;
  const disp = useCallback((s: Size): Size => (rotated ? { w: s.h, h: s.w } : s), [rotated]);

  // all page sizes up front so continuous layout doesn't jump
  useEffect(() => {
    let live = true;
    setSizes(null);
    Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        pdf.getPage(i + 1).then((p) => {
          const v = p.getViewport({ scale: 1 });
          return { w: v.width, h: v.height };
        }),
      ),
    ).then((s) => live && setSizes(s));
    return () => {
      live = false;
    };
  }, [pdf]);

  const registerSlot = useCallback((i: number, el: HTMLDivElement | null) => {
    if (el) slots.current.set(i, el);
    else slots.current.delete(i);
  }, []);
  const registerSvg = useCallback((i: number, el: SVGSVGElement | null) => {
    if (el) svgs.current.set(i, el);
    else svgs.current.delete(i);
  }, []);

  const scrollToPage = useCallback((index: number) => {
    const el = scrollRef.current;
    const slot = slots.current.get(index);
    if (!el || !slot) return;
    el.scrollTop += slot.getBoundingClientRect().top - el.getBoundingClientRect().top - PAD;
    scrolledPage.current = index;
  }, []);

  // ---------------------------------------------------------------- zoom
  const pageAt = (client: Pt): number => {
    for (const [i, slot] of slots.current) {
      const r = slot.getBoundingClientRect();
      if (client.x >= r.left && client.x <= r.right && client.y >= r.top && client.y <= r.bottom) return i;
    }
    return useDoc.getState().page;
  };

  const setZoom = useCallback((z: number, client?: Pt) => {
    const el = scrollRef.current;
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (el) {
      const r = el.getBoundingClientRect();
      const c = client ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const index = pageAt(c);
      const svg = svgs.current.get(index);
      if (svg) anchor.current = { index, pt: clientToPage(svg, c), client: c };
    }
    useDoc.setState({ zoom: nz });
  }, []);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = null;
    const svg = svgs.current.get(a.index);
    if (!svg) return;
    const now = pageToClient(svg, a.pt);
    el.scrollLeft += now.x - a.client.x;
    el.scrollTop += now.y - a.client.y;
  }, [zoom, view.rotation]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!zoomCmd || !el || !sizes) return;
    const first = paired ? page - (page % 2) : page;
    const row = [first, ...(paired && first + 1 < sizes.length ? [first + 1] : [])].map((i) => disp(sizes[i]));
    const sz = { w: row.reduce((a, s) => a + s.w, 0), h: Math.max(...row.map((s) => s.h)) };
    const gaps = (row.length - 1) * PAD; // screen pixels between paired pages
    const fw = (el.clientWidth - PAD * 2 - gaps) / sz.w;
    const fp = Math.min(fw, (el.clientHeight - PAD * 2) / sz.h);
    const st = useDoc.getState();
    useDoc.setState({ zoomCmd: null });
    switch (zoomCmd.kind) {
      case 'fitWidth':
      case 'fitPage':
        useDoc.setState({ zoom: zoomCmd.kind === 'fitWidth' ? fw : fp });
        requestAnimationFrame(() => {
          scrollToPage(page);
          if (zoomCmd.kind === 'fitPage') el.scrollLeft = 0;
        });
        break;
      case 'actual':
        setZoom(1);
        break;
      case 'in':
        setZoom(st.zoom * 1.25);
        break;
      case 'out':
        setZoom(st.zoom * 0.8);
        break;
      case 'selection': {
        const sel = st.markups.filter((m) => st.selection.includes(m.id) && m.page === page);
        if (!sel.length) break;
        const b = bounds(sel.flatMap((m) => m.points));
        const pad = 30;
        const r = rotated ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
        const z = Math.min(ZOOM_MAX, (el.clientWidth - PAD * 2) / (r.w + pad * 2), (el.clientHeight - PAD * 2) / (r.h + pad * 2));
        useDoc.setState({ zoom: z, focusId: sel[0].id });
        break;
      }
    }
  }, [zoomCmd, sizes, page, disp, rotated, setZoom, scrollToPage, paired]);

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
  }, [setZoom, sizes]);

  // ---------------------------------------------------------------- page tracking (continuous)
  useEffect(() => {
    if (!continuous || !sizes) return;
    if (page !== scrolledPage.current) requestAnimationFrame(() => scrollToPage(page));
  }, [page, continuous, sizes, scrollToPage]);

  const onScroll = () => {
    if (!continuous) return;
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 3;
    let best = useDoc.getState().page;
    let bestDist = Infinity;
    for (const [i, slot] of slots.current) {
      const sr = slot.getBoundingClientRect();
      const d = mid < sr.top ? sr.top - mid : mid > sr.bottom ? mid - sr.bottom : 0;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== useDoc.getState().page) {
      scrolledPage.current = best;
      useDoc.setState({ page: best });
    }
  };

  // scroll a markup into view when picked from the list
  useEffect(() => {
    const el = scrollRef.current;
    if (!focusId || !el || !sizes) return;
    const m = useDoc.getState().markups.find((x) => x.id === focusId);
    if (!m) return;
    if (m.page !== page) return; // page change re-runs this
    const raf = requestAnimationFrame(() => {
      const svg = svgs.current.get(m.page);
      if (!svg) return;
      const b = bounds(m.points);
      const c = pageToClient(svg, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const r = el.getBoundingClientRect();
      el.scrollLeft += c.x - (r.left + r.width / 2);
      el.scrollTop += c.y - (r.top + r.height / 2);
      if (continuous) scrolledPage.current = m.page;
      useDoc.setState({ focusId: null });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusId, page, sizes, zoom, continuous]);

  // ---------------------------------------------------------------- panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea, select')) {
        if (!keys.space) force((n) => n + 1);
        keys.space = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        keys.space = false;
        force((n) => n + 1);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current!;
    if (e.button === 1 || tool === 'pan' || keys.space) {
      pan.current = { client: { x: e.clientX, y: e.clientY }, scroll: { x: el.scrollLeft, y: el.scrollTop } };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pages')) {
      useDoc.setState({ selection: [] });
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const el = scrollRef.current!;
    el.scrollLeft = p.scroll.x - (e.clientX - p.client.x);
    el.scrollTop = p.scroll.y - (e.clientY - p.client.y);
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  // ---------------------------------------------------------------- render
  const all = sizes ? sizes.map((_, i) => i) : [];
  const indices = !sizes ? [] : continuous ? all : paired ? all.filter((i) => i - (i % 2) === page - (page % 2)) : [page];
  const rows: number[][] = [];
  for (const i of indices) {
    if (paired && rows.length && i % 2 === 1 && rows[rows.length - 1][0] === i - 1) rows[rows.length - 1].push(i);
    else rows.push([i]);
  }
  const filter = view.display === 'gray' ? 'grayscale(1)' : view.display === 'invert' ? 'invert(1) hue-rotate(180deg)' : undefined;
  const panning = tool === 'pan' || keys.space;

  return (
    <div
      className="viewer-shell"
      onPointerMove={(e) => {
        if (!view.crosshair) return;
        const el = scrollRef.current!;
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        setHair(x >= 0 && y >= 0 && x < el.clientWidth && y < el.clientHeight ? { x, y } : null);
      }}
      onPointerLeave={() => setHair(null)}
    >
      <div
        className={`viewer ${panning ? 'panning' : ''} ${view.display === 'invert' ? 'dark-paper' : ''}`}
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="pages" style={{ padding: PAD, gap: PAD }}>
          {rows.map((row) => (
            <div className="page-row" key={row[0]} style={{ gap: PAD }}>
            {row.map((i) => (
            <PageView
              key={i}
              pdf={pdf}
              index={i}
              size={sizes![i]}
              zoom={zoom}
              rotation={view.rotation}
              oc={oc}
              canvasFilter={filter}
              scrollRoot={scrollRef}
              alwaysVisible={!continuous}
              registerSlot={registerSlot}
              registerSvg={registerSvg}
              onCursor={setCursor}
            />
            ))}
            </div>
          ))}
        </div>
      </div>
      {view.crosshair && hair && (
        <>
          <div className="crosshair-h" style={{ top: hair.y }} />
          <div className="crosshair-v" style={{ left: hair.x }} />
        </>
      )}
      {cursor && (
        <div className="cursor-readout">
          {cursor.x.toFixed(0)}, {cursor.y.toFixed(0)} pt
        </div>
      )}
    </div>
  );
}
