// Text inside shapes + view options (continuous, rotate, grid/snap, layers, display, hide markups).
import { _electron as electron } from 'playwright-core';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');
const savedPath = out('saved-view.pdf');
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
  await page.click(`.menu-item:has-text("${label}")`);
  await page.waitForTimeout(400);
};

// 1) text inside a cloud via double-click, and inside an ellipse via the properties panel
await page.keyboard.press('c');
await drag(F(17, 42), F(31, 62));
await page.keyboard.press('v');
await page.mouse.dblclick(...(await S(...F(24, 52))));
await page.waitForSelector('.text-editor');
await page.keyboard.type('REVISE LAYOUT PER ASI-03');
await page.mouse.click(...(await S(...F(85, 5))));
await page.keyboard.press('e');
await drag(F(33, 44), F(47, 60));
await page.fill('.props textarea', 'NEW DOOR');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.click('button[title="Fit page"]');
await page.waitForTimeout(400);
await page.screenshot({ path: out('10-shape-text.png') });
results.shapeTexts = await page.$$eval('.list-scroll tbody tr td.clip', (tds) => tds.map((t) => t.textContent));

// 2) layers: hide Furniture
await page.click('.sidebar-tabs button:has-text("Layers")');
results.layers = await page.$$eval('.layer', (ls) => ls.map((l) => l.textContent.trim()));
await page.click('.layer:has-text("Furniture") input');
await page.waitForTimeout(700);
await page.screenshot({ path: out('11-layers-furniture-off.png') });
await page.click('.layer:has-text("Furniture") input');

// 3) grid + snap: a rectangle drawn off-grid lands on 1/4" grid points
await viewItem('Snap to grid');
await page.keyboard.press('r');
await drag([403, 1103], [517, 1189]);
results.snapped = await page.evaluate(() => {
  const rows = document.querySelectorAll('.list-scroll tbody tr');
  return rows.length;
});
await page.waitForTimeout(300);
await page.screenshot({ path: out('12-grid.png') });
await viewItem('Snap to grid');
await viewItem('Grid');

// 4) rotate the view and draw on it: the markup must land at the same page spot
await page.click('button[title^="Rotate view clockwise"]');
await page.waitForTimeout(600);
await page.keyboard.press('a');
await drag(F(60, 70), F(52, 56));
await page.waitForTimeout(300);
await page.screenshot({ path: out('13-rotated.png') });
await page.click('button[title^="Rotate view clockwise"]');
await page.click('button[title^="Rotate view clockwise"]');
await page.click('button[title^="Rotate view clockwise"]');
await page.waitForTimeout(400);

// 5) display modes
await viewItem('Inverted (dark) drawing');
await page.screenshot({ path: out('14-inverted.png') });
await viewItem('Normal');

// 6) continuous layout: both pages stacked; scrolling down moves the current page
await viewItem('Continuous');
await page.click('button[title="Fit width"]');
await page.waitForTimeout(800);
results.continuousPages = await page.$$eval('.page-slot', (s) => s.length);
await page.evaluate(() => { const v = document.querySelector('.viewer'); v.scrollTop = v.scrollHeight; });
await page.waitForTimeout(800);
results.pageAfterScroll = await page.$eval('.page-input', (i) => i.value);
await page.screenshot({ path: out('15-continuous.png') });
await page.click('.sidebar-tabs button:has-text("Pages")');
await page.click('.thumb >> nth=0');
await page.waitForTimeout(600);
results.pageAfterThumb = await page.$eval('.page-input', (i) => i.value);
await viewItem('Single page');

// 7) hide markups
await page.keyboard.press('Control+m');
await page.waitForTimeout(300);
results.markupsHidden = await page.$$eval('svg.overlay g[data-id]', (g) => g.length);
await page.keyboard.press('Control+m');

// 8) save, reopen, text survives
await app.evaluate(({ dialog }, target) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
}, savedPath);
await page.keyboard.press('Control+Shift+S');
for (let i = 0; i < 50 && !existsSync(savedPath); i++) await page.waitForTimeout(100);
await page.waitForTimeout(300);
await dropFile(savedPath);
await page.waitForTimeout(1200);
results.textsAfterReopen = await page.$$eval('.list-scroll tbody tr td.clip', (tds) => tds.map((t) => t.textContent));

results.errors = errors;
console.log(JSON.stringify(results, null, 2));
await app.close();
