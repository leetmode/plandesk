# PlanDesk

PDF markup and takeoff for construction drawings. Windows and macOS desktop app
(Electron + React + PDF.js), written from scratch.

## Features (v0.2)

- **Markups:** pen, line, arrow, rectangle, ellipse, polyline, polygon, revision
  cloud (rectangle and polygon), highlight, text box, callout
- **Measurements:** calibrate scale (draw along a known dimension) or pick a preset
  (architectural, engineering, metric); length, polylength, area, count
- **Markups list:** sortable and filterable, with status (Open / Accepted / Rejected /
  Completed), comments, author, and CSV export
- **Takeoff summary:** totals grouped by subject; rename a measurement's subject
  (e.g. "Drywall") to group it
- **Standard PDF files:** markups save as real PDF annotations with appearance
  streams and ISO 32000 `/Measure` scale data, so they show up in Bluebeam Revu,
  Acrobat and browsers. Annotations made in those programs (squares, clouds,
  lines, polylines, polygons, ink, free text and callouts, highlights, and
  measurements) open as editable markups.
- **Text in shapes:** double-click a cloud, rectangle, ellipse or polygon (or
  select it and press Enter) to type centered text inside it
- **View menu:** single page or continuous scrolling, rotate view, show/hide
  markups (Ctrl+M), grid (Ctrl+G) with snap to grid, grayscale or inverted
  drawing display, PDF layers panel, zoom to selection (Z), full screen (F11),
  and panel toggles
- Undo/redo, copy/paste, multi-select (shift-click or drag a box), drag handles,
  arrow-key nudge, tool lock, page thumbnails, drag-and-drop to open

## Shortcuts

| Key | Tool | Key | Tool |
|---|---|---|---|
| V | Select | Q | Callout |
| H | Pan (or hold Space / middle-drag) | I | Highlight |
| P | Pen | M | Length |
| L | Line | N | Polylength |
| A | Arrow | G | Area |
| R | Rectangle | K | Count |
| E | Ellipse | T | Text box |
| C | Cloud | Esc | Cancel / finish count |

Click-to-place tools (polyline, polygon, polygon cloud, polylength, area): click
each vertex, then double-click or press Enter to finish. Backspace removes the
last vertex. Hold Shift to snap to 45°.

## Development

```bash
npm install
npm run dev        # UI in a browser at http://localhost:5173
npm run app        # build, then run the desktop app
npm test           # unit tests (PDF round trip, measurements)
npm run test:e2e   # drives the real Electron app, screenshots in tests/e2e-out/
node tests/e2e-view.mjs  # shape text + view options
npm run dist:win   # Windows installer -> ../../../plandesk-release/<version>/
npm run dist:mac   # macOS .dmg (run this on a Mac)
```

Build output goes outside Dropbox because Dropbox locks files mid-sync and breaks
the packager.

## Layout

- `src/lib/pdfio.ts`: PDF annotation read/write (the file-format core)
- `src/lib/geometry.ts`: shared geometry (clouds, arrows, wrapping), used by both
  the screen renderer and the PDF writer, so they match
- `src/lib/measure.ts`: scales, units, ft-in formatting and parsing
- `src/lib/render.ts` + `components/MarkupView.tsx`: on-screen drawing
- `src/components/Viewer.tsx`: scrolling, zoom, page layout (single or continuous)
- `src/components/PageView.tsx`: one page: canvas, overlay, grid, all tool interactions
- `electron/`: desktop shell (file dialogs, menu, file associations)
