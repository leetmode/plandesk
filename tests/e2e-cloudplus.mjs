// Cloud+, tool shortcut badges and cheat sheet, side-by-side layouts, crosshair, snap to markup.
import { _electron as electron } from 'playwright-core';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');
const savedPath = out('saved-cloudplus.pdf');
if (existsSync(savedPath)) rmSync(savedPath);
const results = {};

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PLANDESK_USER_DATA: path.join(root, 'tests', 'e2e-out', 'profile') } });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.welcome');

async function dropFile(file) {
  const b64 = readFileSync(file).toString('base64');
  await page.evaluate(([data, name]) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [b64, path.basename(file)]);
}
await dropFile(sample);
await page.waitForSelector('.page-canvas', { timeout: 15000 });
await page.waitForTimeout(500);

// page units -> screen via the overlay's own transform (works for any rotation)
const S = async (x, y, pageIndex = 0) =>
  page.evaluate(([x, y, i]) => {
    const svg = document.querySelectorAll('svg.overlay')[i];
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    return [p.x, p.y];
  }, [x, y, pageIndex]);
const F = (fx, fy) => [200 + fx * 18, 1728 - (300 + fy * 18)];
const drag = async (a, b) => {
  const A = await S(...a), B = await S(...b);
  await page.mouse.move(...A);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(A[0] + ((B[0] - A[0]) * i) / 8, A[1] + ((B[1] - A[1]) * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(80);
};
const viewItem = async (label) => {
  await page.click('button[title="View options"]');
  await page.click(`.menu-item .label:text-is("${label}")`);
  await page.waitForTimeout(400);
};
await page.click('button[title="Fit page"]');
await page.waitForTimeout(400);

// 1) every tool button shows its key
results.badges = await page.$$eval('.toolbar .kbd', (k) => k.map((x) => x.textContent).join(' '));
await page.screenshot({ path: out('20-badges.png'), clip: { x: 0, y: 0, width: 1500, height: 60 } });

// 2) ? opens the cheat sheet
await page.keyboard.press('Shift+Slash');
await page.waitForSelector('.modal.shortcuts');
results.cheatSheetRows = await page.$$eval('.shortcut-row', (r) => r.length);
await page.screenshot({ path: out('21-shortcuts.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
results.cheatSheetClosed = !(await page.$('.modal.shortcuts'));

// 3) Cloud+ with B: drag the cloud, the text box opens for typing right away
await page.keyboard.press('b');
results.cloudPlusActive = await page.$eval('.toolbar button.active', (b) => b.title);
await drag(F(17, 42), F(31, 62));
await page.waitForSelector('.text-editor');
await page.keyboard.type('RELOCATE DOOR PER ASI-03');
await page.mouse.click(...(await S(...F(85, 5))));
await page.waitForTimeout(300);
await page.screenshot({ path: out('22-cloudplus.png') });

// 4) select it and drag the middle handle: only the text box moves
await page.mouse.click(...(await S(...F(18, 43))));
await page.waitForTimeout(200);
const handles = await page.$$eval('svg.overlay rect[fill="#fff"]', (rs) => rs.map((r) => { const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
results.cloudPlusHandles = handles.length;
const mid = handles[4];
await page.mouse.move(...mid);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(mid[0] + i * 10, mid[1] + i * 25);
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: out('23-cloudplus-moved-box.png') });

// 5) snap to markup: a line started 3pt off the cloud's corner starts exactly on it
await viewItem('Snap to markup');
await page.keyboard.press('l');
const [cx, cy] = F(31, 62);
await drag([cx + 3, cy - 2], [cx + 150, cy + 60]);
await viewItem('Snap to markup');

// 6) shift+C picks the polygon cloud
await page.keyboard.press('Shift+C');
results.shiftC = await page.$eval('.toolbar button.active', (b) => b.title);
await page.keyboard.press('v');

// 7) side-by-side layouts
await viewItem('Side-by-side');
await page.click('button[title="Fit width"]');
await page.waitForTimeout(800);
results.sideBySide = await page.$$eval('.page-slot', (s) => s.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
await page.screenshot({ path: out('24-side-by-side.png') });
await viewItem('Continuous side-by-side');
await page.waitForTimeout(600);
results.contSideBySide = await page.$$eval('.page-slot', (s) => s.length);
await viewItem('Single page');
await page.click('button[title="Fit page"]');
await page.waitForTimeout(400);

// 8) full-screen crosshair (X)
await page.keyboard.press('x');
await page.mouse.move(...(await S(...F(40, 40))));
await page.mouse.move(...(await S(...F(41, 41))));
await page.waitForTimeout(200);
results.crosshair = (await page.$$('.crosshair-h, .crosshair-v')).length;
await page.screenshot({ path: out('25-crosshair.png') });
await page.keyboard.press('x');

// 8b) sticky note (O): click, then type straight into the comment field
await page.keyboard.press('o');
await page.mouse.click(...(await S(...F(70, 50))));
await page.waitForTimeout(150);
await page.keyboard.type('Field verify ceiling height');
results.noteFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-field'));
await page.keyboard.press('Escape');
await page.screenshot({ path: out('27-note.png') });

// 9) save, reopen: Cloud+ text and geometry survive
await app.evaluate(({ dialog }, target) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
}, savedPath);
await page.keyboard.press('Control+Shift+S');
for (let i = 0; i < 50 && !existsSync(savedPath); i++) await page.waitForTimeout(100);
await page.waitForTimeout(300);
await dropFile(savedPath);
await page.waitForTimeout(1200);
results.textsAfterReopen = await page.$$eval('.list-scroll tbody tr td.clip', (tds) => tds.map((t) => t.textContent));
await page.screenshot({ path: out('26-reopened.png') });

const { PDFDocument, PDFName } = await import('pdf-lib');
const doc = await PDFDocument.load(readFileSync(savedPath));
const ann = doc.getPages()[0].node.Annots();
const saved = [];
for (let i = 0; i < ann.size(); i++) saved.push(JSON.parse(doc.context.lookup(ann.get(i)).get(PDFName.of('PlanDesk')).decodeText()));
const cp = saved.find((m) => m.type === 'cloudplus');
const ln = saved.find((m) => m.type === 'line');
results.cloudPlus = cp && { points: cp.points, text: cp.text };
results.cloudCorner = [cx, cy];
results.lineStart = ln?.points[0];
results.note = saved.find((m) => m.type === 'note')?.comment;

results.errors = errors;
console.log(JSON.stringify(results, null, 2));
await app.close();
