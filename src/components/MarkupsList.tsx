import { useMemo, useState } from 'react';
import { useDoc } from '../store';
import type { Markup, Status } from '../types';
import { STATUSES } from '../types';
import { TYPE_LABEL } from '../lib/markups';
import { DEFAULT_SCALE, formatArea, formatLength, measureMarkup } from '../lib/measure';
import { saveText } from '../lib/platform';
import { exportReviewReport, listedMarkups } from '../lib/exportReport';
import { Icon } from './Icon';

type Col = 'page' | 'type' | 'subject' | 'text' | 'measurement' | 'author' | 'date' | 'status';
const COLS: { id: Col; label: string }[] = [
  { id: 'page', label: 'Page' },
  { id: 'type', label: 'Type' },
  { id: 'subject', label: 'Subject' },
  { id: 'text', label: 'Comment / Text' },
  { id: 'measurement', label: 'Measurement' },
  { id: 'author', label: 'Author' },
  { id: 'date', label: 'Modified' },
  { id: 'status', label: 'Status' },
];

export interface Row {
  m: Markup;
  measurement: string;
  value: number | null;
  kind: 'length' | 'area' | 'count' | null;
}

export function buildRows(markups: Markup[], scales: Record<number, import('../types').PageScale>): Row[] {
  return markups.map((m) => {
    const meas = measureMarkup(m, scales[m.page] ?? DEFAULT_SCALE);
    return { m, measurement: meas?.text ?? '', value: meas?.value ?? null, kind: meas?.kind ?? null };
  });
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Row[], scales: Record<number, import('../types').PageScale>): string {
  const header = ['Page', 'Type', 'Subject', 'Comment', 'Text', 'Measurement', 'Value', 'Unit', 'Author', 'Created', 'Modified', 'Status', 'Color'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const unit = scales[r.m.page]?.unit ?? 'in';
    const base = unit === 'ft-in' ? 'ft' : unit;
    let value = '';
    let u = '';
    if (r.kind === 'length' && r.value !== null) {
      value = (r.value / ({ ft: 12, in: 1, yd: 36, m: 39.3700787, cm: 0.393700787, mm: 0.0393700787 } as Record<string, number>)[base]).toFixed(3);
      u = base;
    } else if (r.kind === 'area' && r.value !== null) {
      const per = ({ ft: 144, in: 1, yd: 1296, m: 1550.0031, cm: 0.15500031, mm: 0.0015500031 } as Record<string, number>)[base];
      value = (r.value / per).toFixed(3);
      u = `sq ${base}`;
    } else if (r.kind === 'count' && r.value !== null) {
      value = String(r.value);
      u = 'ea';
    }
    lines.push(
      [r.m.page + 1, TYPE_LABEL[r.m.type], r.m.subject, r.m.comment, r.m.text, r.measurement, value, u, r.m.author, r.m.created, r.m.modified, r.m.status, r.m.color]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

export function MarkupsList() {
  const s = useDoc();
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'page', dir: 1 });
  const [tab, setTab] = useState<'list' | 'takeoff'>('list');

  const rows = useMemo(() => {
    const all = buildRows(listedMarkups(s), s.scales);
    const key = (r: Row): string | number => {
      switch (sort.col) {
        case 'page': return r.m.page;
        case 'type': return TYPE_LABEL[r.m.type];
        case 'subject': return r.m.subject.toLowerCase();
        case 'text': return (r.m.comment || r.m.text).toLowerCase();
        case 'measurement': return r.value ?? -1;
        case 'author': return r.m.author.toLowerCase();
        case 'date': return r.m.modified;
        case 'status': return r.m.status;
      }
    };
    return all.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir;
    });
  }, [s.markups, s.scales, s.listFilter, s.listStatus, sort]);

  // Takeoff summary: totals per subject, kept separate per page scale unit.
  const takeoff = useMemo(() => {
    const groups = new Map<string, { subject: string; kind: string; total: number; count: number; unit: string }>();
    for (const r of buildRows(s.markups, s.scales)) {
      if (!r.kind || r.value === null) continue;
      const unit = (s.scales[r.m.page] ?? DEFAULT_SCALE).unit;
      const key = `${r.m.subject}|${r.kind}|${unit}`;
      const g = groups.get(key) ?? { subject: r.m.subject, kind: r.kind, total: 0, count: 0, unit };
      g.total += r.value;
      g.count += 1;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.subject.localeCompare(b.subject));
  }, [s.markups, s.scales]);

  const exportCsv = async () => {
    const base = (s.fileName ?? 'markups').replace(/\.pdf$/i, '');
    await saveText(toCsv(rows, s.scales), `${base} - markups.csv`, 'CSV', 'csv');
  };

  const pick = (m: Markup) => useDoc.setState({ page: m.page, selection: [m.id], tool: 'select', focusId: m.id });

  return (
    <section className="list-panel">
      <div className="list-bar">
        <div className="tabs">
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            Markups ({s.markups.length})
          </button>
          <button className={tab === 'takeoff' ? 'active' : ''} onClick={() => setTab('takeoff')}>
            Takeoff summary
          </button>
        </div>
        {tab === 'list' && (
          <>
            <input className="filter" placeholder="Filter…" value={s.listFilter} onChange={(e) => useDoc.setState({ listFilter: e.target.value })} />
            <select value={s.listStatus} onChange={(e) => useDoc.setState({ listStatus: e.target.value as Status | 'All' })}>
              <option>All</option>
              {STATUSES.map((st) => (
                <option key={st}>{st}</option>
              ))}
            </select>
          </>
        )}
        <div className="tb-spacer" />
        <button
          className="text-btn"
          onClick={exportReviewReport}
          disabled={!rows.length || !!s.reportStatus}
          title="A PDF that walks through each comment with a zoomed, highlighted view. Easy to send to anyone. Uses the current filter."
        >
          <Icon name="report" size={14} /> {s.reportStatus ?? 'Export review report'}
        </button>
        <button className="text-btn" onClick={exportCsv} disabled={!s.markups.length}>
          <Icon name="download" size={14} /> Export CSV
        </button>
      </div>
      <div className="list-scroll">
        {tab === 'list' ? (
          <table>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.id} onClick={() => setSort({ col: c.id, dir: sort.col === c.id ? (-sort.dir as 1 | -1) : 1 })}>
                    {c.label}
                    {sort.col === c.id ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.m.id} className={s.selection.includes(r.m.id) ? 'sel' : ''} onClick={() => pick(r.m)}>
                  <td>{r.m.page + 1}</td>
                  <td>
                    <span className="dot" style={{ background: r.m.color }} />
                    {TYPE_LABEL[r.m.type]}
                  </td>
                  <td>{r.m.subject}</td>
                  <td className="clip">{r.m.comment || r.m.text}</td>
                  <td>{r.measurement}</td>
                  <td>{r.m.author}</td>
                  <td>{new Date(r.m.modified).toLocaleDateString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select value={r.m.status} onChange={(e) => s.update([r.m.id], { status: e.target.value as Status })}>
                      {STATUSES.map((st) => (
                        <option key={st}>{st}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={COLS.length} className="hint">
                    No markups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Type</th>
                <th>Items</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {takeoff.map((g) => (
                <tr key={`${g.subject}|${g.kind}|${g.unit}`}>
                  <td>{g.subject}</td>
                  <td>{g.kind === 'length' ? 'Length' : g.kind === 'area' ? 'Area' : 'Count'}</td>
                  <td>{g.count}</td>
                  <td>
                    <strong>
                      {g.kind === 'length'
                        ? formatLength(g.total, g.unit as never)
                        : g.kind === 'area'
                          ? formatArea(g.total, g.unit as never)
                          : `${g.total} ea`}
                    </strong>
                  </td>
                </tr>
              ))}
              {!takeoff.length && (
                <tr>
                  <td colSpan={4} className="hint">
                    No measurements yet. Calibrate the page scale, then use Length, Area or Count. Rename a measurement's Subject (e.g. "Drywall") to group totals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
