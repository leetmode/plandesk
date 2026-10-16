import { useCallback, useEffect, useState } from 'react';
import { useDoc } from './store';
import type { Markup } from './types';
import { openDocument } from './lib/pdfjs';
import { loadPdf, savePdf } from './lib/pdfio';
import * as platform from './lib/platform';
import { hasText, newId, translate } from './lib/markups';
import { DEFAULT_SCALE } from './lib/measure';
import { Toolbar, TOOL_KEYS } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { Sidebar } from './components/Thumbnails';
import { rotateView, toggleFullscreen } from './components/ViewMenu';
import { Properties } from './components/Properties';
import { MarkupsList } from './components/MarkupsList';
import { ScaleDialog } from './components/ScaleDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Icon } from './components/Icon';
import { TabBar } from './components/TabBar';
import { useTabs, addTab, closeTab, switchTab, anyDirty } from './tabs';
import { exportReviewReport } from './lib/exportReport';

let clipboard: Markup[] = [];

export default function App() {
  const s = useDoc();
  const tabs = useTabs((t) => t.tabs);
  const activeId = useTabs((t) => t.active);
  const current = tabs.find((t) => t.id === activeId);
  const pdf = current?.pdf ?? null;
  const oc = current?.oc ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!s.author) platform.userName().then((n) => useDoc.setState({ author: n }));
  }, [s.author]);

  useEffect(() => {
    // the window warns on close if any tab has unsaved changes
    platform.setDirty(anyDirty(s.dirty), s.fileName ? `${s.fileName} - PlanDesk` : 'PlanDesk');
  }, [s.dirty, s.fileName, tabs]);

  // each PDF opens in its own tab; a file that's already open just gets focused
  const openBytes = useCallback(async (file: platform.OpenedFile) => {
    const { tabs } = useTabs.getState();
    const existing = file.path && tabs.find((t) => (t.parked ?? useDoc.getState()).filePath === file.path);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    setBusy(`Opening ${file.name}…`);
    setError(null);
    try {
      const loaded = await loadPdf(file.bytes);
      const doc = await openDocument(loaded.renderBytes);
      const layers = await doc.getOptionalContentConfig().catch(() => null);
      addTab(doc, layers && [...layers].length ? layers : null);
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
    for (const f of await platform.openPdfs()) await openBytes(f);
  }, [openBytes]);

  const close = useCallback((id: string) => {
    const t = useTabs.getState().tabs.find((x) => x.id === id);
    if (!t) return;
    const d = t.parked ?? useDoc.getState();
    if (d.dirty && !window.confirm(`Close ${d.fileName ?? 'this document'} and discard unsaved changes?`)) return;
    closeTab(id);
  }, []);

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
      else if (cmd === 'exportReport') exportReviewReport();
      else if (cmd === 'closeTab') {
        const id = useTabs.getState().active;
        if (id) close(id);
      }
      else if (cmd === 'undo') useDoc.getState().undo();
      else if (cmd === 'redo') useDoc.getState().redo();
    });
  }, [open, save, openBytes, close]);

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
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        save(e.shiftKey);
        return;
      }
      if (mod && e.shiftKey && k === 'e') {
        e.preventDefault();
        exportReviewReport();
        return;
      }
      if (mod && k === 'w') {
        e.preventDefault();
        const id = useTabs.getState().active;
        if (id) close(id);
        return;
      }
      if (e.ctrlKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) {
        // next / previous tab
        e.preventDefault();
        const { tabs, active } = useTabs.getState();
        const back = e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey);
        const i = tabs.findIndex((t) => t.id === active);
        if (tabs.length > 1) switchTab(tabs[(i + (back ? -1 : 1) + tabs.length) % tabs.length].id);
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
      } else if (mod && e.shiftKey && (e.code === 'Equal' || e.code === 'Minus')) {
        e.preventDefault();
        rotateView(e.code === 'Equal' ? 1 : -1);
      } else if (mod && k === 'm') {
        e.preventDefault();
        st.setView({ showMarkups: !st.view.showMarkups });
      } else if (mod && k === 'g') {
        e.preventDefault();
        st.setView({ grid: !st.view.grid });
      } else if (!mod && k === 'z' && st.selection.length) {
        useDoc.setState({ zoomCmd: { kind: 'selection', t: Date.now() } });
      } else if (e.key === 'Enter' && st.selection.length === 1) {
        const m = st.markups.find((x) => x.id === st.selection[0]);
        if (m && hasText(m.type)) {
          e.preventDefault();
          useDoc.setState({ editingText: m.id });
        }
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
      } else if (!mod && e.key === '?') {
        useDoc.setState({ showShortcuts: !st.showShortcuts });
      } else if (!mod && !e.altKey && k === 'x') {
        st.setView({ crosshair: !st.view.crosshair });
      } else if (!mod && !e.altKey && TOOL_KEYS[(e.shiftKey ? 'shift+' : '') + k]) {
        useDoc.setState({ tool: TOOL_KEYS[(e.shiftKey ? 'shift+' : '') + k], selection: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, save, close]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    for (const file of [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name))) await openBytes(await platform.fileToOpened(file));
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
      <TabBar onOpen={open} onClose={close} />
      <div className="main">
        {s.showThumbs && <Sidebar key={activeId} pdf={pdf} oc={oc} />}
        <div className="center">
          {pdf ? (
            <Viewer key={activeId} pdf={pdf} oc={oc} />
          ) : (
            <div className="welcome">
              <h1>PlanDesk</h1>
              <p>Markup and takeoff for construction drawings.</p>
              <button className="primary big" onClick={open}>
                <Icon name="open" /> Open a PDF
              </button>
              <p className="hint">…or drag PDFs onto this window. Each one opens in its own tab.</p>
            </div>
          )}
          {s.showList && pdf && <MarkupsList />}
        </div>
        {s.showProps && <Properties />}
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
        {(busy || s.reportStatus) && <span className="busy">{busy ?? s.reportStatus}</span>}
        {error && (
          <span className="error" onClick={() => setError(null)} title="Dismiss">
            {error}
          </span>
        )}
      </footer>
      {s.scaleDialog.open && <ScaleDialog />}
      {s.showShortcuts && <ShortcutsDialog />}
      {dragOver && <div className="drop-hint">Drop PDF to open</div>}
    </div>
  );
}
