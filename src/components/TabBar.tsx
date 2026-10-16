import { useDoc } from '../store';
import { useTabs, switchTab, tabInfo } from '../tabs';

export function TabBar({ onOpen, onClose }: { onOpen: () => void; onClose: (id: string) => void }) {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const fileName = useDoc((s) => s.fileName);
  const dirty = useDoc((s) => s.dirty);
  if (!tabs.length) return null;
  return (
    <div className="doc-tabs" role="tablist">
      {tabs.map((t) => {
        const info = tabInfo(t, { fileName, dirty });
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={`doc-tab ${t.id === active ? 'active' : ''}`}
            title={(t.parked ?? useDoc.getState()).filePath ?? info.name}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              } else if (e.button === 0) switchTab(t.id);
            }}
          >
            <span className="doc-tab-name">{info.name}</span>
            {info.dirty && <span className="doc-tab-dirty" title="Unsaved changes">●</span>}
            <button
              className="doc-tab-close"
              title="Close tab (Ctrl+W)"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose(t.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="doc-tab-new" title="Open PDF in a new tab (Ctrl+O)" onClick={onOpen}>
        +
      </button>
    </div>
  );
}
