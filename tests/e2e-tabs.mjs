// Multiple PDFs in tabs: page panel refreshes per document, markups stay with their tab.
import { _electron as electron } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
mkdirSync(out(''), { recursive: true });
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');

// a second, different document: 3 small pages with a colored block each
const second = out('three-pages.pdf');
const d = await PDFDocument.create();
for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.7, 0.3), rgb(0.2, 0.3, 0.9)]) d.addPage([400, 300]).drawRectangle({ x: 50, y: 50, width: 300, height: 200, color: c });
writeFileSync(second, await d.save());

const results = {};
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PLANDESK_USER_DATA: out('profile') } });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (dlg) => dlg.accept());
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.welcome');

async function drop(files) {
  const payload = files.map((f) => [readFileSync(f).toString('base64'), path.basename(f)]);
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const [data, name] of list) dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, payload);
}
const state = () =>
  page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.doc-tab-name')].map((t) => t.textContent),
    active: document.querySelector('.doc-tab.active .doc-tab-name')?.textContent,
    thumbs: document.querySelectorAll('.thumb').length,
    thumbSizes: [...document.querySelectorAll('.thumb-img canvas')].map((c) => `${c.width}x${c.height}`),
    status: document.querySelector('.status')?.textContent,
  }));

await drop([sample]);
await page.waitForSelector('.page-canvas', { timeout: 15000 });
await page.waitForTimeout(600);
results.first = await state();

// add a markup to tab 1 (rectangle tool, drag)
await page.keyboard.press('r');
const box = await page.$eval('svg.overlay', (s) => { const r = s.getBoundingClientRect(); return [r.left + r.width / 3, r.top + r.height / 3]; });
await page.mouse.move(box[0], box[1]);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(box[0] + i * 15, box[1] + i * 10);
await page.mouse.up();
await page.waitForTimeout(200);

await drop([second]);
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 2);
await page.waitForTimeout(800);
results.second = await state();
await page.screenshot({ path: out('tabs-second.png') });

await page.keyboard.press('Control+Tab');
await page.waitForTimeout(800);
results.backToFirst = await state();
await page.screenshot({ path: out('tabs-first.png') });

await page.keyboard.press('Control+Tab');
await page.waitForTimeout(800);
results.secondAgain = await state();

// Ctrl+W closes the active tab (three-pages); the floor plan comes back with its markup
await page.keyboard.press('Control+w');
await page.waitForTimeout(600);
results.afterClose = await state();

await app.close();
console.log(JSON.stringify({ ...results, errors }, null, 1));
