// Small stroke icon set (24x24 grid).
const PATHS: Record<string, string> = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  pan: 'M8 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S6 18 4.5 15l-1-2a1.5 1.5 0 012.6-1.5L8 14',
  pen: 'M4 20c3-1 4-4 7-8s6-7 9-8c-1 3-4 6-8 9s-7 4-8 7z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M10 5h9v9',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  polyline: 'M4 18l5-9 5 6 6-10',
  polygon: 'M12 3l8 6-3 10H7L4 9z',
  cloud: 'M6 8a2 2 0 014 0 2 2 0 014 0 2 2 0 014 0 2 2 0 010 4 2 2 0 010 4 2 2 0 01-4 0 2 2 0 01-4 0 2 2 0 01-4 0 2 2 0 010-4 2 2 0 010-4z',
  polycloud: 'M12 3a2 2 0 013 1.5 2 2 0 013 2.5 2 2 0 010 4 2 2 0 01-1 4 2 2 0 01-3 2.5 2 2 0 01-4 0A2 2 0 017 15a2 2 0 01-1-4 2 2 0 010-4 2 2 0 013-2.5A2 2 0 0112 3z',
  highlight: 'M4 15h16v5H4zM8 15l2-10h4l2 10',
  text: 'M5 5h14M12 5v14M9 19h6',
  callout: 'M10 6h10v8H10zM10 12l-6 6',
  length: 'M4 12h16M4 8v8M20 8v8M8 12v2M12 12v3M16 12v2',
  polylength: 'M4 18l6-8 4 4 6-8M4 16v4M20 4v4',
  area: 'M5 5h14v14H5zM5 12h14M12 5v14',
  count: 'M12 4a8 8 0 100 16 8 8 0 000-16zM8 12l3 3 5-6',
  calibrate: 'M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  open: 'M3 6h6l2 2h10v11H3z',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  zoomIn: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6',
  fitWidth: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  fitPage: 'M4 4h16v16H4zM9 9h6v6H9z',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
  unlock: 'M7 11V8a5 5 0 019.6-2M5 11h14v10H5z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  pages: 'M7 3h10v18H7zM4 6v12M20 6v12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
