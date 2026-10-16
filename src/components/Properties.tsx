import { savePrefs, useDoc } from '../store';
import type { Markup, MarkupType, StyleDefaults } from '../types';
import { STATUSES } from '../types';
import { hasText, isMarkupTool, TEXT_SHAPES, TYPE_LABEL } from '../lib/markups';
import { DEFAULT_SCALE, measureMarkup } from '../lib/measure';

const SWATCHES = ['#e02020', '#ff7a00', '#ffd400', '#0a9a3c', '#1f5fd6', '#7b2fd6', '#e0208c', '#000000', '#808080', '#ffffff'];

function ColorRow({ value, onChange, allowNone }: { value: string | null; onChange(v: string | null): void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none ${value === null ? 'on' : ''}`} title="None" onClick={() => onChange(null)} />
      )}
      {SWATCHES.map((c) => (
        <button key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
      ))}
      <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} title="Custom color" />
    </div>
  );
}

function StyleFields({ type, v, set }: { type: MarkupType; v: StyleDefaults; set(p: Partial<StyleDefaults>): void }) {
  const hasFill = !['pen', 'line', 'arrow', 'polyline', 'polylength', 'length', 'count'].includes(type);
  const hasText = ['text', 'callout', 'cloudplus', 'length', 'polylength', 'area', 'count', 'rect', 'ellipse', 'cloud', 'polycloud', 'polygon'].includes(type);
  const hasStroke = type !== 'highlight';
  return (
    <>
      <label>Color</label>
      <ColorRow value={v.color} onChange={(c) => set({ color: c ?? '#000000' })} />
      {hasFill && (
        <>
          <label>Fill</label>
          <ColorRow value={v.fill} allowNone onChange={(c) => set({ fill: c })} />
          {v.fill && (
            <label className="row">
              Fill opacity
              <input type="range" min={0.05} max={1} step={0.05} value={v.fillOpacity} onChange={(e) => set({ fillOpacity: +e.target.value })} />
              <span>{Math.round(v.fillOpacity * 100)}%</span>
            </label>
          )}
        </>
      )}
      {hasStroke && (
        <label className="row">
          Line width
          <input type="number" min={0} max={50} step={0.5} value={v.width} onChange={(e) => set({ width: Math.max(0, +e.target.value) })} />
        </label>
      )}
      <label className="row">
        Opacity
        <input type="range" min={0.1} max={1} step={0.05} value={v.opacity} onChange={(e) => set({ opacity: +e.target.value })} />
        <span>{Math.round(v.opacity * 100)}%</span>
      </label>
      {hasText && (
        <label className="row">
          Font size
          <input type="number" min={4} max={144} value={v.fontSize} onChange={(e) => set({ fontSize: Math.max(4, +e.target.value) })} />
        </label>
      )}
      <label className="row">
        Subject
        <input type="text" value={v.subject} onChange={(e) => set({ subject: e.target.value })} />
      </label>
    </>
  );
}

export function Properties() {
  const s = useDoc();
  const selected = s.markups.filter((m) => s.selection.includes(m.id));

  if (selected.length) {
    const first = selected[0];
    const sameType = selected.every((m) => m.type === first.type);
    const update = (p: Partial<Markup>) => s.update(s.selection, p);
    const meas = selected.length === 1 ? measureMarkup(first, s.scales[first.page] ?? DEFAULT_SCALE) : null;
    return (
      <aside className="props">
        <h3>{selected.length === 1 ? TYPE_LABEL[first.type] : `${selected.length} markups`}</h3>
        {meas && <div className="measure-big">{meas.text}</div>}
        <StyleFields type={sameType ? first.type : 'rect'} v={first} set={update} />
        <label>Status</label>
        <select value={first.status} onChange={(e) => update({ status: e.target.value as Markup['status'] })}>
          {STATUSES.map((st) => (
            <option key={st}>{st}</option>
          ))}
        </select>
        {selected.length === 1 && hasText(first.type) && (
          <>
            <label>Text {TEXT_SHAPES.has(first.type) && <span className="hint">(shown inside the shape; or double-click it)</span>}</label>
            <textarea rows={3} value={first.text} onChange={(e) => update({ text: e.target.value })} />
          </>
        )}
        {selected.length === 1 && (
          <>
            <label>Comment</label>
            <textarea rows={4} value={first.comment} onChange={(e) => update({ comment: e.target.value })} />
            <div className="meta">
              {first.author || 'Unknown author'} · {new Date(first.modified).toLocaleString()}
            </div>
          </>
        )}
        <div className="row-buttons">
          <button
            onClick={() => {
              const st = selected[0];
              s.setStyle(st.type, { color: st.color, fill: st.fill, opacity: st.opacity, fillOpacity: st.fillOpacity, width: st.width, fontSize: st.fontSize, subject: st.subject });
            }}
            disabled={!sameType}
            title="Use this markup's style for new markups of this type"
          >
            Set as default
          </button>
          <button className="danger" onClick={() => s.remove(s.selection)}>
            Delete
          </button>
        </div>
      </aside>
    );
  }

  const t = s.tool;
  return (
    <aside className="props">
      {isMarkupTool(t) ? (
        <>
          <h3>{TYPE_LABEL[t]} defaults</h3>
          <StyleFields type={t} v={s.styles[t]} set={(p) => s.setStyle(t, p)} />
        </>
      ) : (
        <>
          <h3>Properties</h3>
          <p className="hint">Select a markup to edit it, or pick a tool to set its default style.</p>
        </>
      )}
      <hr />
      <label className="row">
        Author
        <input
          type="text"
          value={s.author}
          onChange={(e) => {
            useDoc.setState({ author: e.target.value });
            savePrefs(useDoc.getState());
          }}
        />
      </label>
      <label className="row check">
        <input
          type="checkbox"
          checked={s.wheelZooms}
          onChange={(e) => {
            useDoc.setState({ wheelZooms: e.target.checked });
            savePrefs(useDoc.getState());
          }}
        />
        Mouse wheel zooms
      </label>
    </aside>
  );
}
