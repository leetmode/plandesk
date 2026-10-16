import { useState } from 'react';
import { useDoc } from '../store';
import type { Unit } from '../types';
import { DEFAULT_SCALE, formatLength, parseLength, PRESETS, UNITS } from '../lib/measure';

export function ScaleDialog() {
  const s = useDoc();
  const { calibrated } = s.scaleDialog;
  const current = s.scales[s.page] ?? DEFAULT_SCALE;
  const [mode, setMode] = useState<'preset' | 'calibrate'>(calibrated ? 'calibrate' : 'preset');
  const [preset, setPreset] = useState(() => {
    const flat = PRESETS.flatMap((g) => g.items);
    return Math.max(0, flat.findIndex((p) => p.label === current.label));
  });
  const [distance, setDistance] = useState('');
  const [unit, setUnit] = useState<Unit>(current.unit === 'in' && current === DEFAULT_SCALE ? 'ft-in' : current.unit);
  const [applyTo, setApplyTo] = useState<'page' | 'all'>(s.pageCount > 1 && !Object.keys(s.scales).length ? 'all' : 'page');
  const close = () => useDoc.setState({ scaleDialog: { open: false } });

  const flat = PRESETS.flatMap((g) => g.items);
  const parsed = calibrated ? parseLength(distance, unit) : null;
  const canApply = mode === 'preset' || (parsed !== null && parsed > 0 && !!calibrated);

  const apply = () => {
    let next;
    if (mode === 'preset') {
      const p = flat[preset];
      next = { inchesPerPoint: p.inchesPerPoint, unit: p.unit === 'ft-in' || p.unit === 'in' ? (unit === 'ft-in' || unit === 'ft' || unit === 'in' ? unit : p.unit) : p.unit, label: p.label };
    } else {
      const inchesPerPoint = parsed! / calibrated!;
      next = { inchesPerPoint, unit, label: `Calibrated: ${formatLength(parsed!, unit)}` };
    }
    const pages = applyTo === 'all' ? Array.from({ length: s.pageCount }, (_, i) => i) : [s.page];
    s.setScale(pages, next);
    close();
  };

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Page scale</h2>
        <div className="tabs">
          <button className={mode === 'preset' ? 'active' : ''} onClick={() => setMode('preset')}>
            Preset scale
          </button>
          <button className={mode === 'calibrate' ? 'active' : ''} onClick={() => setMode('calibrate')}>
            Calibrate
          </button>
        </div>
        {mode === 'preset' ? (
          <label>
            Drawing scale
            <select value={preset} onChange={(e) => setPreset(+e.target.value)}>
              {PRESETS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((p) => {
                    const i = flat.indexOf(p);
                    return (
                      <option key={i} value={i}>
                        {p.label}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
          </label>
        ) : calibrated ? (
          <label>
            Real length of the line you drew
            <input autoFocus placeholder={unit === 'ft-in' ? `e.g. 24'-6"` : 'e.g. 7.5'} value={distance} onChange={(e) => setDistance(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canApply && apply()} />
          </label>
        ) : (
          <p className="hint">
            Close this dialog, choose the <b>Calibrate</b> tool, and draw a line along a dimension you know (a dimension string or a grid spacing). You'll then enter its real length.
          </p>
        )}
        <label>
          Display units
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Apply to
          <select value={applyTo} onChange={(e) => setApplyTo(e.target.value as 'page' | 'all')}>
            <option value="page">This page ({s.page + 1})</option>
            <option value="all">All pages</option>
          </select>
        </label>
        <div className="row-buttons">
          {mode === 'calibrate' && !calibrated && (
            <button onClick={() => useDoc.setState({ scaleDialog: { open: false }, tool: 'calibrate' })}>Draw calibration line</button>
          )}
          <div className="tb-spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" disabled={!canApply} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
