import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { useDoc } from '../store';
import { LayersPanel } from './LayersPanel';
import type { OcConfig } from './PageView';

const THUMB_W = 150;

function Thumb({ pdf, index, active, count }: { pdf: PDFDocumentProxy; index: number; active: boolean; count: number }) {
  const host = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // render lazily, only once the thumbnail scrolls into view
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || done.current) return;
      done.current = true;
      const page = await pdf.getPage(index + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (THUMB_W / vp1.width) * (window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      el.replaceChildren(canvas);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [pdf, index]);

  return (
    <button className={`thumb ${active ? 'active' : ''}`} onClick={() => useDoc.setState({ page: index, selection: [] })}>
      <div className="thumb-img" ref={host} />
      <div className="thumb-label">
        {index + 1}
        {count > 0 && <span className="badge">{count}</span>}
      </div>
    </button>
  );
}

export function Sidebar({ pdf, oc }: { pdf: PDFDocumentProxy | null; oc: OcConfig | null }) {
  const pageCount = useDoc((s) => s.pageCount);
  const page = useDoc((s) => s.page);
  const markups = useDoc((s) => s.markups);
  const tab = useDoc((s) => s.sidebarTab);
  if (!pdf) return null;
  const counts = new Map<number, number>();
  for (const m of markups) counts.set(m.page, (counts.get(m.page) ?? 0) + 1);
  return (
    <aside className="sidebar">
      <div className="tabs sidebar-tabs">
        <button className={tab === 'pages' ? 'active' : ''} onClick={() => useDoc.setState({ sidebarTab: 'pages' })}>
          Pages
        </button>
        <button className={tab === 'layers' ? 'active' : ''} onClick={() => useDoc.setState({ sidebarTab: 'layers' })}>
          Layers
        </button>
      </div>
      {tab === 'pages' ? (
        <div className="thumbs">
          {Array.from({ length: pageCount }, (_, i) => (
            <Thumb key={i} pdf={pdf} index={i} active={i === page} count={counts.get(i) ?? 0} />
          ))}
        </div>
      ) : (
        <LayersPanel oc={oc} />
      )}
    </aside>
  );
}
