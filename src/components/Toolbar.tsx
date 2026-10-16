import { useDoc } from '../store';
import type { Tool } from '../types';
import { Icon } from './Icon';
import { rotateView, ViewMenu } from './ViewMenu';

export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  p: 'pen',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  e: 'ellipse',
  c: 'cloud',
  b: 'cloudplus',
  t: 'text',
  q: 'callout',
  i: 'highlight',
  m: 'length',
  n: 'polylength',
  g: 'area',
  k: 'count',
  o: 'note',
  s: 'calibrate',
  'shift+l': 'polyline',
  'shift+r': 'polygon',
  'shift+c': 'polycloud',
};

// "shift+c" -> "⇧C"
export const keyLabel = (k: string) => k.replace('shift+', '⇧').toUpperCase();
export const keyFor = (t: Tool) => {
  const k = Object.entries(TOOL_KEYS).find(([, v]) => v === t)?.[0];
  return k ? keyLabel(k) : undefined;
};

// tiny drawn shift arrow; the ⇧ glyph is unreadable at badge size
function KeyBadge({ k }: { k: string }) {
  const shift = k.startsWith('⇧');
  return (
    <span className="kbd">
      {shift && (
        <svg width="6" height="7" viewBox="0 0 6 7" aria-label="Shift">
          <path d="M3 0L6 3.4H4.2V7H1.8V3.4H0z" fill="currentColor" />
        </svg>
      )}
      {shift ? k.slice(1) : k}
    </span>
  );
}

export const GROUPS: { label: string; tools: { id: Tool; title: string }[] }[] = [
  { label: 'Navigate', tools: [{ id: 'select', title: 'Select' }, { id: 'pan', title: 'Pan' }] },
  {
    label: 'Markup',
    tools: [
      { id: 'pen', title: 'Pen' },
      { id: 'line', title: 'Line' },
      { id: 'arrow', title: 'Arrow' },
      { id: 'rect', title: 'Rectangle' },
      { id: 'ellipse', title: 'Ellipse' },
      { id: 'polyline', title: 'Polyline (click points, double-click to finish)' },
      { id: 'polygon', title: 'Polygon (click points, double-click to finish)' },
      { id: 'cloud', title: 'Cloud' },
      { id: 'cloudplus', title: 'Cloud+ (drag the cloud, then type; drag the middle handle to move the text box)' },
      { id: 'polycloud', title: 'Polygon Cloud (click points, double-click to finish)' },
      { id: 'highlight', title: 'Highlight' },
      { id: 'text', title: 'Text Box' },
      { id: 'callout', title: 'Callout (drag from the arrow tip to the box)' },
      { id: 'note', title: 'Note (click to drop a sticky-note comment)' },
    ],
  },
  {
    label: 'Measure',
    tools: [
      { id: 'calibrate', title: 'Calibrate scale (draw along a known dimension)' },
      { id: 'length', title: 'Length' },
      { id: 'polylength', title: 'Polylength (click points, double-click to finish)' },
      { id: 'area', title: 'Area (click points, double-click to finish)' },
      { id: 'count', title: 'Count (click each item; Esc to start a new count)' },
    ],
  },
];

interface Props {
  onOpen(): void;
  onSave(saveAs?: boolean): void;
}

export function Toolbar({ onOpen, onSave }: Props) {
  const s = useDoc();
  const hasDoc = !!s.baseBytes;
  return (
    <header className="toolbar">
      <div className="brand">PlanDesk</div>
      <div className="tb-group">
        <button title="Open PDF (Ctrl+O)" onClick={onOpen}>
          <Icon name="open" />
        </button>
        <button title="Save (Ctrl+S)" disabled={!hasDoc} onClick={() => onSave()}>
          <Icon name="save" />
        </button>
        <button title="Undo (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}>
          <Icon name="undo" />
        </button>
        <button title="Redo (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}>
          <Icon name="redo" />
        </button>
      </div>
      {GROUPS.map((g) => (
        <div className="tb-group" key={g.label} aria-label={g.label}>
          {g.tools.map((t) => {
            const k = keyFor(t.id);
            return (
              <button
                key={t.id}
                className={s.tool === t.id ? 'active' : ''}
                disabled={!hasDoc}
                title={k ? `${t.title} (${k})` : t.title}
                onClick={() => useDoc.setState({ tool: t.id, selection: t.id === 'select' ? s.selection : [] })}
              >
                <Icon name={t.id} />
                {k && <KeyBadge k={k} />}
              </button>
            );
          })}
        </div>
      ))}
      <div className="tb-group">
        <button
          className={s.toolLocked ? 'active' : ''}
          title={s.toolLocked ? 'Tool lock on: tools stay active after drawing' : 'Tool lock off: returns to Select after drawing'}
          onClick={() => useDoc.setState({ toolLocked: !s.toolLocked })}
        >
          <Icon name={s.toolLocked ? 'lock' : 'unlock'} />
        </button>
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <ViewMenu />
        <button title="Rotate view clockwise (Ctrl+Shift+=)" disabled={!hasDoc} onClick={() => rotateView(1)}>
          <Icon name="rotateCw" />
        </button>
      </div>
      <div className="tb-group">
        <button title="Zoom out" disabled={!hasDoc} onClick={() => useDoc.setState({ zoomCmd: { kind: 'out', t: Date.now() } })}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-label" title="Click for 100%" onClick={() => useDoc.setState({ zoomCmd: { kind: 'actual', t: Date.now() } })}>
          {Math.round(s.zoom * 100)}%
        </span>
        <button title="Zoom in" disabled={!hasDoc} onClick={() => useDoc.setState({ zoomCmd: { kind: 'in', t: Date.now() } })}>
          <Icon name="zoomIn" />
        </button>
        <button title="Fit width" disabled={!hasDoc} onClick={() => useDoc.setState({ zoomCmd: { kind: 'fitWidth', t: Date.now() } })}>
          <Icon name="fitWidth" />
        </button>
        <button title="Fit page" disabled={!hasDoc} onClick={() => useDoc.setState({ zoomCmd: { kind: 'fitPage', t: Date.now() } })}>
          <Icon name="fitPage" />
        </button>
      </div>
      <div className="tb-group">
        <button title="Keyboard shortcuts (?)" onClick={() => useDoc.setState({ showShortcuts: true })}>
          <Icon name="keyboard" />
        </button>
        <button className={s.showThumbs ? 'active' : ''} title="Pages panel" onClick={() => useDoc.setState({ showThumbs: !s.showThumbs })}>
          <Icon name="pages" />
        </button>
        <button className={s.showList ? 'active' : ''} title="Markups list" onClick={() => useDoc.setState({ showList: !s.showList })}>
          <Icon name="list" />
        </button>
      </div>
    </header>
  );
}
