# PlanDesk — notes for Claude

PDF markup and takeoff app for construction drawings. Electron + React + Vite + TypeScript,
PDF.js for rendering, pdf-lib for saving. Windows and macOS. Repo: github.com/leetmode/plandesk (private).

## Ground rules
- Clean-room only. Never decompile, disassemble or copy Bluebeam Revu (or run REA/Ghidra on it).
  Public Bluebeam docs and PDFs the user marked up in Revu are fine for behavior and file-format interop.
- Markups must stay standard PDF annotations (with appearance streams) so Revu, Acrobat and browsers show them.

## Workflow
1. `git pull` before starting; work on `master` (single developer).
2. `npm install` after pulling if package-lock.json changed.
3. Make the change, then run: `npm run typecheck`, `npm test`, and the e2e scripts that touch the area:
   `npm run build && node tests/e2e.mjs` (markups/measurements), `node tests/e2e-view.mjs` (view options,
   shape text), `node tests/e2e-cloudplus.mjs` (Cloud+, shortcuts, layouts, notes), `node tests/e2e-tabs.mjs` (tabs), `node tests/e2e-report.mjs` (review report). Check the screenshots
   in tests/e2e-out/ and that `errors` is empty.
4. Commit and push.
5. To ship installers: `npm version patch` (or minor) then `git push --follow-tags`. GitHub Actions
   (.github/workflows/release.yml) builds the Windows .exe and macOS .dmg files and attaches them to a
   Release. Don't hand-build release installers.

## Architecture (where things live)
- Page units: PDF points in the displayed page orientation, top-left origin, y down (src/types.ts).
- src/lib/markups.ts: markup types, default styles, geometry helpers (text boxes, leaders, Cloud+, notes).
- src/lib/render.ts: on-screen drawing plan. src/lib/pdfio.ts: load/save as PDF annotations, imports
  Revu/Acrobat annotations, replies (/IRT) and review states. Keep render.ts and pdfio.ts in sync so the
  screen matches the saved PDF.
- src/lib/report.ts: review report PDF (renders the marked-up sheet with pdf.js, crops/highlights per
  comment, lays out pages with pdf-lib). Text must go through safeText (Helvetica is WinAnsi only).
- src/tabs.ts: open documents. The active tab's document lives in useDoc; inactive tabs keep a parked
  snapshot of the per-document fields (DOC_KEYS). Add new per-document store fields to DOC_KEYS.
- src/components/PageView.tsx: drawing/selection interactions per page. Viewer.tsx: scrolling, zoom, layouts.
- Toolbar.tsx `TOOL_KEYS` is the single source of tool shortcuts (badges and the ? cheat sheet read it).
- Every new markup type needs: types.ts, TYPE_LABEL + DEFAULT_STYLES, render.ts, pdfio.ts draw + SUBTYPE,
  hit testing in PageView, an icon, and a unit test round trip in tests/pdfio.test.ts.

## Gotchas
- Local `npm run dist:*` writes outside Dropbox (../../../plandesk-release/<version>) because Dropbox
  locks files mid-build.
- Tests launch Electron with PLANDESK_USER_DATA set so they don't collide with a running PlanDesk.
- Windows: Chromium pointer events report `detail` 0, so click tools finish via onDoubleClick.
