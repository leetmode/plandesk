import { create } from 'zustand';
import type { Markup, MarkupType, PageScale, StyleDefaults, Tool } from './types';
import { DEFAULT_STYLES } from './lib/markups';

const HISTORY_LIMIT = 200;

export interface ViewOptions {
  layout: 'single' | 'continuous';
  rotation: 0 | 90 | 180 | 270;
  showMarkups: boolean;
  grid: boolean;
  snap: boolean;
  gridSpacing: number; // paper inches
  display: 'normal' | 'gray' | 'invert';
}

const DEFAULT_VIEW: ViewOptions = { layout: 'single', rotation: 0, showMarkups: true, grid: false, snap: false, gridSpacing: 0.25, display: 'normal' };

interface Snapshot {
  markups: Markup[];
  scales: Record<number, PageScale>;
}

export interface DocState {
  fileName: string | null;
  filePath: string | null;
  baseBytes: Uint8Array | null; // the PDF with editable annotations removed
  pageCount: number;
  markups: Markup[];
  scales: Record<number, PageScale>;
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];

  page: number;
  zoom: number;
  tool: Tool;
  toolLocked: boolean;
  selection: string[];
  styles: Record<MarkupType, StyleDefaults>;
  author: string;
  wheelZooms: boolean;
  showList: boolean;
  showThumbs: boolean;
  showProps: boolean;
  editingText: string | null;
  view: ViewOptions;
  sidebarTab: 'pages' | 'layers';
  layersVersion: number; // bumps when PDF layer visibility changes
  scaleDialog: { open: boolean; calibrated?: number }; // calibrated = drawn length in page units
  zoomCmd: { kind: 'fitWidth' | 'fitPage' | 'in' | 'out' | 'actual' | 'selection'; t: number } | null;
  focusId: string | null; // markup the viewer should scroll into view

  setDocument(d: { fileName: string; filePath: string | null; baseBytes: Uint8Array; pageCount: number; markups: Markup[]; scales: Record<number, PageScale> }): void;
  markSaved(filePath: string | null, fileName: string): void;
  commit(markups: Markup[], scales?: Record<number, PageScale>): void;
  add(m: Markup): void;
  update(ids: string[], patch: Partial<Markup> | ((m: Markup) => Partial<Markup>)): void;
  remove(ids: string[]): void;
  setScale(pages: number[], s: PageScale): void;
  undo(): void;
  redo(): void;
  set(p: Partial<DocState>): void;
  setStyle(type: MarkupType, patch: Partial<StyleDefaults>): void;
  setView(patch: Partial<ViewOptions>): void;
}

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem('plandesk.prefs') || '{}');
  } catch {
    return {};
  }
};
const prefs = loadPrefs();

export const savePrefs = (s: Pick<DocState, 'styles' | 'author' | 'wheelZooms' | 'view'>) => {
  try {
    localStorage.setItem('plandesk.prefs', JSON.stringify({ styles: s.styles, author: s.author, wheelZooms: s.wheelZooms, view: s.view }));
  } catch {
    /* storage unavailable */
  }
};

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export const useDoc = create<DocState>((set, get) => ({
  fileName: null,
  filePath: null,
  baseBytes: null,
  pageCount: 0,
  markups: [],
  scales: {},
  dirty: false,
  past: [],
  future: [],

  page: 0,
  zoom: 1,
  tool: 'select',
  toolLocked: false,
  selection: [],
  styles: { ...DEFAULT_STYLES, ...(prefs.styles ?? {}) },
  author: prefs.author ?? '',
  wheelZooms: prefs.wheelZooms ?? !isMac,
  showList: true,
  showThumbs: true,
  showProps: true,
  editingText: null,
  view: { ...DEFAULT_VIEW, ...(prefs.view ?? {}), rotation: 0 },
  sidebarTab: 'pages',
  layersVersion: 0,
  scaleDialog: { open: false },
  zoomCmd: null,
  focusId: null,

  setDocument: (d) =>
    set({
      ...d,
      dirty: false,
      past: [],
      future: [],
      page: 0,
      selection: [],
      editingText: null,
      tool: 'select',
      zoomCmd: { kind: 'fitPage', t: Date.now() },
    }),

  markSaved: (filePath, fileName) => set({ filePath, fileName, dirty: false }),

  commit: (markups, scales) => {
    const s = get();
    const past = [...s.past, { markups: s.markups, scales: s.scales }].slice(-HISTORY_LIMIT);
    set({ markups, scales: scales ?? s.scales, past, future: [], dirty: true });
  },

  add: (m) => get().commit([...get().markups, m]),

  update: (ids, patch) => {
    const now = new Date().toISOString();
    const idSet = new Set(ids);
    get().commit(
      get().markups.map((m) => (idSet.has(m.id) ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch), modified: now } : m)),
    );
  },

  remove: (ids) => {
    const idSet = new Set(ids);
    get().commit(get().markups.filter((m) => !idSet.has(m.id)));
    set({ selection: get().selection.filter((id) => !idSet.has(id)) });
  },

  setScale: (pages, sc) => {
    const scales = { ...get().scales };
    for (const p of pages) scales[p] = sc;
    get().commit(get().markups, scales);
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ ...prev, past: s.past.slice(0, -1), future: [{ markups: s.markups, scales: s.scales }, ...s.future], dirty: true, selection: [] });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ ...next, future: s.future.slice(1), past: [...s.past, { markups: s.markups, scales: s.scales }], dirty: true, selection: [] });
  },

  set: (p) => set(p),

  setView: (patch) => {
    set({ view: { ...get().view, ...patch } });
    savePrefs(get());
  },

  setStyle: (type, patch) => {
    set({ styles: { ...get().styles, [type]: { ...get().styles[type], ...patch } } });
    savePrefs(get());
  },
}));
