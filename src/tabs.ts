import { create } from 'zustand';
import type { PDFDocumentProxy } from './lib/pdfjs';
import type { OcConfig } from './components/PageView';
import { useDoc, type DocState } from './store';

// Several PDFs can be open at once, one per tab. The active tab's document lives
// in useDoc as usual; switching tabs parks it here and restores the other one.
const DOC_KEYS = ['fileName', 'filePath', 'baseBytes', 'pageCount', 'markups', 'scales', 'dirty', 'past', 'future', 'page', 'zoom', 'selection', 'focusId'] as const;
export type DocSnapshot = Pick<DocState, (typeof DOC_KEYS)[number]>;

export interface Tab {
  id: string;
  pdf: PDFDocumentProxy;
  oc: OcConfig | null;
  parked: DocSnapshot | null; // null while the tab is active
}

interface TabsState {
  tabs: Tab[];
  active: string | null;
}

export const useTabs = create<TabsState>(() => ({ tabs: [], active: null }));

const EMPTY: DocSnapshot = { fileName: null, filePath: null, baseBytes: null, pageCount: 0, markups: [], scales: {}, dirty: false, past: [], future: [], page: 0, zoom: 1, selection: [], focusId: null };

const snapshot = (): DocSnapshot => {
  const s = useDoc.getState();
  return Object.fromEntries(DOC_KEYS.map((k) => [k, s[k]])) as DocSnapshot;
};

let nextId = 1;

export const activeTab = (): Tab | null => {
  const { tabs, active } = useTabs.getState();
  return tabs.find((t) => t.id === active) ?? null;
};

/** Park the active document so another one can be loaded into useDoc. */
function park(tabs: Tab[], active: string | null): Tab[] {
  const snap = snapshot();
  return tabs.map((t) => (t.id === active ? { ...t, parked: snap } : t));
}

export function switchTab(id: string) {
  const { tabs, active } = useTabs.getState();
  const target = tabs.find((t) => t.id === id);
  if (!target || id === active) return;
  const parked = park(tabs, active); // before useDoc is overwritten
  useDoc.setState({ ...target.parked!, editingText: null, zoomCmd: null });
  useTabs.setState({ tabs: parked.map((t) => (t.id === id ? { ...t, parked: null } : t)), active: id });
}

/** Add a tab for a freshly loaded PDF and make it active. The caller then calls setDocument. */
export function addTab(pdf: PDFDocumentProxy, oc: OcConfig | null): string {
  const { tabs, active } = useTabs.getState();
  const id = `tab${nextId++}`;
  useTabs.setState({ tabs: [...park(tabs, active), { id, pdf, oc, parked: null }], active: id });
  return id;
}

export function closeTab(id: string) {
  const { tabs, active } = useTabs.getState();
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs[i].pdf.loadingTask.destroy();
  const rest = tabs.filter((t) => t.id !== id);
  if (id !== active) {
    useTabs.setState({ tabs: rest });
    return;
  }
  const next = rest[Math.min(i, rest.length - 1)];
  useDoc.setState({ ...(next?.parked ?? EMPTY), editingText: null, zoomCmd: null });
  useTabs.setState({ tabs: rest.map((t) => (t === next ? { ...t, parked: null } : t)), active: next?.id ?? null });
}

/** Name and unsaved flag for a tab, whether or not it's the active one. */
export function tabInfo(t: Tab, live: Pick<DocState, 'fileName' | 'dirty'>): { name: string; dirty: boolean } {
  const d = t.parked ?? live;
  return { name: d.fileName ?? 'Untitled', dirty: d.dirty };
}

export const anyDirty = (liveDirty: boolean) => liveDirty || useTabs.getState().tabs.some((t) => t.parked?.dirty);
