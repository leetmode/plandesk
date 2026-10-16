import { useCallback, useEffect, useRef, useState } from 'react';
import { useDoc } from './store';
import type { Markup } from './types';
import { openDocument, type PDFDocumentProxy } from './lib/pdfjs';
import { loadPdf, savePdf } from './lib/pdfio';
import * as platform from './lib/platform';
import { newId, translate } from './lib/markups';
import { DEFAULT_SCALE } from './lib/measure';
import { Toolbar, TOOL_KEYS } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { Thumbnails } from './components/Thumbnails';
import { Properties } from './components/Properties';
import { MarkupsList } from './components/MarkupsList';
import { ScaleDialog } from './components/ScaleDialog';
import { Icon } from './components/Icon';

let clipboard: Markup[] = [];

export default function App() {
  const s = useDoc();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!s.author) platform.userName().then((n) => useDoc.setState({ author: n }));
  }, [s.author]);

  useEffect(() => {
    platform.setDirty(s.dirty, s.fileName ? `${s.fileName} - PlanDesk` : 'PlanDesk');
  }, [s.dirty, s.fileName]);

  const openBytes = useCallback(async (file: platform.OpenedFile) => {
    const st = useDoc.getState();
    if (st.dirty && !window.confirm('Discard unsaved changes to the current document?')) return;
    setBusy(`Opening ${file.name}…`);
    setError(null);
    try {
      const loaded = await loadPdf(file.bytes);
      const doc = await openDocument(loaded.renderBytes);
      pdfRef.current?.loadingTask.destroy();
      pdfRef.current = doc;
      setPdf(doc);
      useDoc.getState().setDocument({
        fileName: file.name,
        filePath: file.path,
        baseBytes: loaded.renderBytes,
        pageCount: doc.numPages,
        markups: loaded.markups,
        scales: loaded.scales,
      });
    } catch (e) {
      console.error(e);
      setError(`Couldn't open ${file.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const open = useCallback(async () => {
    const f = await platform.openPdf();
    if (f) await openBytes(f);
  }, [openBytes]);

  const save = useCallback(async (saveAs = false) => {
    const st = useDoc.getState();
    if (!st.baseBytes) return;
    useDoc.setState({ editingText: null });
    setBusy('Saving…');
    setError(null);
    try {
      const bytes = await savePdf(st.baseBytes, st.markups, st.scales);
      const name = st.fileName ?? 'markup.pdf';
      const target = saveAs || !st.filePath ? null : st.filePath;
      const written = await platform.savePdf(bytes, target, name);
      if (written) {
        const fileName = written.split(/[\\/]/).pop() ?? name;
        st.markSaved(platform.isDesktop() ? written : st.filePath, fileName);
      }
    } catch (e) {
      console.error(e);
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // files passed on the command line / "Open with", and native menu commands
  useEffect(() => {
    platform.onOpenPath(async (path) => openBytes(await platform.readPath(path)));
    platform.onMenu((cmd) => {
      if (cmd === 'open') open();
      else if (cmd === 'save') save();
      else if (cmd === 'saveAs') save(true);
      else if (cmd === 'undo') useDoc.getState().undo();
      else if (cmd === 'redo') useDoc.getState().redo();
    });
  }, [open, save, openBytes]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      const st = useDoc.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'o') {
        e.preventDefault();
        open();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        save(e.shiftKey);
        return;
      }
      if (typing || !st.baseBytes) return;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'a') {
        e.preventDefault();
        useDoc.setState({ selection: st.markups.filter((m) => m.page === st.page).map((m) => m.id), tool: 'select' });
      } else if (mod && k === 'c') {
        clipboard = st.markups.filter((m) => st.selection.includes(m.id));
      } else if (mod && k === 'x') {
        clipboard = st.markups.filter((m) => st.selection.includes(m.id));
        st.remove(st.selection);
      } else if (mod && k === 'v' && clipboard.length) {
        const now = new Date().toISOString();
        const samePage = clipboard[0].page === st.page;
        const pasted = clipboard.map((m) => ({ ...translate(m, samePage ? 12 : 0, samePage ? 12 : 0), id: newId(), page: st.page, created: now, modified: now }));
        st.commit([...st.markups, ...pasted]);
        clipboard = pasted;
        useDoc.setState({ selection: pasted.map((m) => m.id), tool: 'select' });
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        useDoc.setState({ zoomCmd: { kind: 'in', t: Date.now() } });
      } else if (mod && k === '-') {
        e.preventDefault();
        useDoc.setState({ zoomCmd: { kind: 'out', t: Date.now() } });
      } else if (mod && k === '0') {
        e.preventDefault();
        useDoc.setState({ zoomCmd: { kind: 'fitPage', t: Date.now() } });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection.length) {
        e.preventDefault();
        st.remove(st.selection);
      } else if (e.key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / st.zoom;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        st.update(st.selection, (m) => ({ points: translate(m, dx, dy).points }));
      } else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !st.selection.length)) {
        useDoc.setState({ page: Math.min(st.pageCount - 1, st.page + 1), selection: [] });
      } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !st.selection.length)) {
        useDoc.setState({ page: Math.max(0, st.page - 1), selection: [] });
      } else if (e.key === 'Escape') {
        useDoc.setState({ selection: [], tool: st.tool === 'count' ? 'count' : 'select' });
      } else if (!mod && !e.altKey && TOOL_KEYS[k]) {
        useDoc.setState({ tool: TOOL_KEYS[k], selection: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, save]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = [...e.dataTransfer.files].find((f) => /\.pdf$/i.test(f.name));
    if (file) await openBytes(await platform.fileToOpened(file));
  };

  const scale = s.scales[s.page] ?? DEFAULT_SCALE;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <Toolbar onOpen={open} onSave={save} />
      <div className="main">
        {s.showThumbs && <Thumbnails pdf={pdf} />}
        <div className="center">
          {pdf ? (
            <Viewer pdf={pdf} />
          ) : (
            <div className="welcome">
              <h1>PlanDesk</h1>
              <p>Markup and takeoff for construction drawings.</p>
              <button className="primary big" onClick={open}>
                <Icon name="open" /> Open a PDF
              </button>
              <p className="hint">…or drag a PDF onto this window.</p>
            </div>
          )}
          {s.showList && pdf && <MarkupsList />}
        </div>
        <Properties />
      </div>
      <footer className="status">
        {pdf ? (
          <>
            <button disabled={s.page === 0} onClick={() => useDoc.setState({ page: s.page - 1, selection: [] })}>
              <Icon name="prev" size={14} />
            </button>
            <span>
              Page{' '}
              <input
                className="page-input"
                value={s.page + 1}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (n >= 1 && n <= s.pageCount) useDoc.setState({ page: n - 1, selection: [] });
                }}
              />{' '}
              of {s.pageCount}
            </span>
            <button disabled={s.page >= s.pageCount - 1} onClick={() => useDoc.setState({ page: s.page + 1, selection: [] })}>
              <Icon name="next" size={14} />
            </button>
            <span className="sep" />
            <button className={`scale-btn ${s.scales[s.page] ? '' : 'warn'}`} onClick={() => useDoc.setState({ scaleDialog: { open: true } })} title="Set the page scale">
              Scale: {scale.label}
            </button>
            <span className="sep" />
            <span>{s.markups.filter((m) => m.page === s.page).length} markups on this page</span>
          </>
        ) : (
          <span>Ready</span>
        )}
        <span className="tb-spacer" />
        {busy && <span className="busy">{busy}</span>}
        {error && (
          <span className="error" onClick={() => setError(null)} title="Dismiss">
            {error}
          </span>
        )}
      </footer>
      {s.scaleDialog.open && <ScaleDialog />}
      {dragOver && <div className="drop-hint">Drop PDF to open</div>}
    </div>
  );
}
