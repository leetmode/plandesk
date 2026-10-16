import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../store';
import { Icon } from './Icon';

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

export const rotateView = (dir: 1 | -1) => {
  const r = useDoc.getState().view.rotation;
  useDoc.getState().setView({ rotation: ((r + dir * 90 + 360) % 360) as 0 | 90 | 180 | 270 });
};

const GRID_SIZES = [
  { v: 0.125, label: '1/8"' },
  { v: 0.25, label: '1/4"' },
  { v: 0.5, label: '1/2"' },
  { v: 1, label: '1"' },
];

function Item({ label, checked, shortcut, onClick, disabled }: { label: string; checked?: boolean; shortcut?: string; onClick(): void; disabled?: boolean }) {
  return (
    <button className="menu-item" onClick={onClick} disabled={disabled}>
      <span className="check">{checked ? '✓' : ''}</span>
      <span className="label">{label}</span>
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </button>
  );
}

export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = useDoc();
  const v = s.view;
  const hasDoc = !!s.baseBytes;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const zoom = (kind: 'fitWidth' | 'fitPage' | 'actual' | 'selection') => useDoc.setState({ zoomCmd: { kind, t: Date.now() } });

  return (
    <div className="menu-wrap" ref={ref}>
      <button className={open ? 'active' : ''} onClick={() => setOpen(!open)} title="View options">
        <Icon name="eye" /> View
      </button>
      {open && (
        <div className="menu" onClick={(e) => (e.target as HTMLElement).closest('.menu-item') && setOpen(false)}>
          <div className="menu-head">Page layout</div>
          <Item label="Single page" checked={v.layout === 'single'} onClick={() => s.setView({ layout: 'single' })} />
          <Item label="Continuous" checked={v.layout === 'continuous'} onClick={() => s.setView({ layout: 'continuous' })} />
          <div className="menu-sep" />
          <div className="menu-head">Rotate view</div>
          <Item label="Rotate clockwise" shortcut="Ctrl+Shift+=" onClick={() => rotateView(1)} disabled={!hasDoc} />
          <Item label="Rotate counter-clockwise" shortcut="Ctrl+Shift+-" onClick={() => rotateView(-1)} disabled={!hasDoc} />
          <div className="menu-sep" />
          <div className="menu-head">Zoom</div>
          <Item label="Fit width" onClick={() => zoom('fitWidth')} disabled={!hasDoc} />
          <Item label="Fit page" shortcut="Ctrl+0" onClick={() => zoom('fitPage')} disabled={!hasDoc} />
          <Item label="Actual size (100%)" onClick={() => zoom('actual')} disabled={!hasDoc} />
          <Item label="Zoom to selection" shortcut="Z" onClick={() => zoom('selection')} disabled={!s.selection.length} />
          <div className="menu-sep" />
          <div className="menu-head">Show</div>
          <Item label="Markups" checked={v.showMarkups} shortcut="Ctrl+M" onClick={() => s.setView({ showMarkups: !v.showMarkups })} />
          <Item label="Grid" checked={v.grid} shortcut="Ctrl+G" onClick={() => s.setView({ grid: !v.grid })} />
          <Item label="Snap to grid" checked={v.snap} onClick={() => s.setView({ snap: !v.snap, grid: v.grid || !v.snap })} />
          <div className="menu-grid-size">
            Grid spacing
            <select value={v.gridSpacing} onChange={(e) => s.setView({ gridSpacing: +e.target.value })} onClick={(e) => e.stopPropagation()}>
              {GRID_SIZES.map((g) => (
                <option key={g.v} value={g.v}>
                  {g.label} on paper
                </option>
              ))}
            </select>
          </div>
          <div className="menu-sep" />
          <div className="menu-head">Display</div>
          <Item label="Normal" checked={v.display === 'normal'} onClick={() => s.setView({ display: 'normal' })} />
          <Item label="Grayscale drawing" checked={v.display === 'gray'} onClick={() => s.setView({ display: 'gray' })} />
          <Item label="Inverted (dark) drawing" checked={v.display === 'invert'} onClick={() => s.setView({ display: 'invert' })} />
          <div className="menu-sep" />
          <div className="menu-head">Panels</div>
          <Item label="Pages / Layers" checked={s.showThumbs} onClick={() => useDoc.setState({ showThumbs: !s.showThumbs })} />
          <Item label="Markups list" checked={s.showList} onClick={() => useDoc.setState({ showList: !s.showList })} />
          <Item label="Properties" checked={s.showProps} onClick={() => useDoc.setState({ showProps: !s.showProps })} />
          <Item label="Full screen" shortcut="F11" onClick={toggleFullscreen} />
        </div>
      )}
    </div>
  );
}
