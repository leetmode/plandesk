import { useState } from 'react';
import { useDoc } from '../store';
import type { OcConfig } from './PageView';

type OrderItem = string | { name: string | null; order: OrderItem[] };

interface Group {
  name: string;
  visible: boolean;
}

// PDF layers (optional content groups), e.g. the CAD layers in an exported drawing set.
export function LayersPanel({ oc }: { oc: OcConfig | null }) {
  const [, force] = useState(0);
  if (!oc) return <p className="hint pad">This PDF has no layers.</p>;

  const order: OrderItem[] | null = oc.getOrder();
  const ids: string[] = [];
  for (const [id] of oc) ids.push(id);
  if (!ids.length) return <p className="hint pad">This PDF has no layers.</p>;

  const setVisible = (targets: string[], visible: boolean) => {
    for (const id of targets) oc.setVisibility(id, visible);
    useDoc.setState((s) => ({ layersVersion: s.layersVersion + 1 }));
    force((n) => n + 1);
  };

  const group = (id: string): Group | null => oc.getGroup(id);

  const collect = (items: OrderItem[]): string[] => items.flatMap((it) => (typeof it === 'string' ? [it] : collect(it.order)));

  const renderItems = (items: OrderItem[], depth: number): React.ReactNode =>
    items.map((it, i) => {
      if (typeof it === 'string') {
        const g = group(it);
        if (!g) return null;
        return (
          <label key={it} className="layer" style={{ paddingLeft: 8 + depth * 14 }}>
            <input type="checkbox" checked={g.visible} onChange={(e) => setVisible([it], e.target.checked)} />
            {g.name || '(unnamed)'}
          </label>
        );
      }
      const children = collect(it.order);
      const allOn = children.every((id) => group(id)?.visible);
      return (
        <div key={`g${i}`}>
          {it.name && (
            <label className="layer group" style={{ paddingLeft: 8 + depth * 14 }}>
              <input type="checkbox" checked={allOn} onChange={(e) => setVisible(children, e.target.checked)} />
              {it.name}
            </label>
          )}
          {renderItems(it.order, depth + (it.name ? 1 : 0))}
        </div>
      );
    });

  return (
    <div className="layers">
      <div className="row-buttons pad">
        <button onClick={() => setVisible(ids, true)}>Show all</button>
        <button onClick={() => setVisible(ids, false)}>Hide all</button>
      </div>
      {renderItems(order?.length ? order : ids, 0)}
    </div>
  );
}
