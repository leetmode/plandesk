import { useEffect } from 'react';
import { useDoc } from '../store';
import { Icon } from './Icon';
import { GROUPS, keyFor } from './Toolbar';

const OTHER: { label: string; keys: [string, string][] }[] = [
  {
    label: 'File & edit',
    keys: [
      ['Ctrl+O', 'Open (one or more PDFs, each in a tab)'],
      ['Ctrl+W', 'Close tab'],
      ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
      ['Ctrl+S', 'Save'],
      ['Ctrl+Shift+S', 'Save as'],
      ['Ctrl+Shift+E', 'Export review report'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+C / X / V', 'Copy / cut / paste markups'],
      ['Ctrl+A', 'Select all on this page'],
      ['Delete', 'Delete selection'],
      ['Arrows', 'Nudge selection (Shift = 10x)'],
      ['Enter / double-click', 'Type in the selected shape, cloud or callout'],
      ['Ctrl+Enter / Esc', 'Finish typing'],
    ],
  },
  {
    label: 'Drawing',
    keys: [
      ['Shift (while drawing)', 'Lock lines to 45°'],
      ['Double-click / Enter', 'Finish a click-point shape'],
      ['Backspace', 'Remove the last clicked point'],
      ['Esc', 'Cancel / start a new count'],
    ],
  },
  {
    label: 'View',
    keys: [
      ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
      ['Ctrl+wheel', 'Zoom at the cursor'],
      ['Ctrl+0', 'Fit page'],
      ['Z', 'Zoom to selection'],
      ['Space+drag / middle drag', 'Pan'],
      ['PageUp / PageDown', 'Previous / next page'],
      ['Ctrl+Shift+= / -', 'Rotate view'],
      ['Ctrl+M', 'Show / hide markups'],
      ['Ctrl+G', 'Show / hide grid'],
      ['X', 'Full-screen crosshair'],
      ['F11', 'Full screen'],
      ['?', 'This list'],
    ],
  },
];

export function ShortcutsDialog() {
  const close = () => useDoc.setState({ showShortcuts: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <div className="shortcut-cols">
          {GROUPS.map((g) => (
            <section key={g.label}>
              <h4>{g.label} tools</h4>
              {g.tools.map((t) => (
                <div className="shortcut-row" key={t.id}>
                  <kbd>{keyFor(t.id) ?? '—'}</kbd>
                  <Icon name={t.id} size={16} />
                  <span>{t.title.replace(/ \(.*\)$/, '')}</span>
                </div>
              ))}
            </section>
          ))}
          {OTHER.map((g) => (
            <section key={g.label}>
              <h4>{g.label}</h4>
              {g.keys.map(([k, what]) => (
                <div className="shortcut-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="row-buttons">
          <div className="tb-spacer" />
          <button className="primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
