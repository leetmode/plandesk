// Drives the built Electron app: opens the sample plan, draws markups, sets a
// scale, measures, saves, and reopens. Screenshots land in tests/e2e-out/.
import { _electron as electron } from 'playwright-core';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');
const savedPath = out('saved.pdf');
if (existsSync(savedPath)) rmSync(savedPath);

const app = await electron.launch({ args: [root], cwd: root });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
await page.waitForSelector('.welcome');
await page.screenshot({ path: out('01-welcome.png') });

// open the sample through the same path a file drop uses
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
await page.waitForTimeout(600);
await page.screenshot({ path: out('02-opened.png') });

const svg = await page.$('svg.overlay');
const box = await svg.boundingBox();
const zoom = await page.evaluate(() => Number(document.querySelector('.zoom-label').textContent.replace('%', '')) / 100);
// page units -> screen
const S = (x, y) => [box.x + x * zoom, box.y + y * zoom];
const drag = async (a, b, opts = {}) => {
  await page.mouse.move(...S(...a));
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(...S(a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8));
  await page.mouse.up();
  if (opts.wait !== false) await page.waitForTimeout(80);
};
const click = async (p, count = 1) => {
  await page.mouse.click(...S(...p), { clickCount: count });
  await page.waitForTimeout(60);
};
const key = (k) => page.keyboard.press(k);

// Plan coordinates: origin at PDF (200,300), 18pt per foot, page 1728pt tall.
// Page-unit y = 1728 - (300 + ft*18)
const F = (fx, fy) => [200 + fx * 18, 1728 - (300 + fy * 18)];

// 1) set the scale with the calibrate tool along the 96'-0" dimension
await page.click('button[title^="Calibrate"]');
await drag(F(0, -4), F(96, -4));
await page.waitForSelector('.modal');
await page.fill('.modal input', "96'");
await page.screenshot({ path: out('03-calibrate.png') });
await page.click('.modal button.primary');

// 2) markups
await key('c'); await drag(F(17, 42), F(31, 62));                 // cloud around office 102
await key('r'); await drag(F(33, 42), F(47, 62));                 // rectangle
await key('a'); await drag(F(60, 70), F(52, 56));                 // arrow
await key('q'); await drag(F(9, 50), F(2, 72));                   // callout
await page.keyboard.type('Verify door swing with owner');
await page.mouse.click(...S(...F(85, 5)));                        // blur to commit
await key('t'); await drag(F(72, 60), F(94, 56));
await page.keyboard.type('NEW OPEN OFFICE LAYOUT\nSee A-501');
await page.mouse.click(...S(...F(85, 5)));
await key('i'); await drag(F(30, 35), F(42, 37.5));               // highlight corridor label

// 3) measurements
await key('m'); await drag(F(0, 32), F(70, 32));                  // corridor length
await key('g');                                                   // area of office 101
for (const p of [F(0, 40), F(16, 40), F(16, 64)]) await click(p);
await click(F(0, 64), 2);
await key('k');                                                   // count doors
for (const x of [5, 21, 37, 53]) await click(F(x + 1.5, 41.5));
await key('Escape');
await key('n');                                                   // polylength
for (const p of [F(72, 4), F(90, 4), F(90, 28)]) await click(p);
await click(F(94, 28), 2);
await key('v');
await page.waitForTimeout(400);
await page.screenshot({ path: out('04-markups.png') });
// close-up at 100% around the corridor
await page.evaluate(() => document.querySelector('.zoom-label').click());
await page.waitForTimeout(500);
await page.evaluate(([x, y]) => { const v = document.querySelector('.viewer'); v.scrollLeft = 24 + x - v.clientWidth / 2; v.scrollTop = 24 + y - v.clientHeight / 2; }, F(40, 40));
await page.waitForTimeout(500);
await page.screenshot({ path: out('04b-closeup.png') });
await page.click('button[title="Fit page"]');
await page.waitForTimeout(400);

// 4) select + edit via properties panel
await click(F(17, 52));
await page.waitForTimeout(200);
await page.fill('.props textarea', 'Revise per ASI-03');
await page.click('.props select');
await page.selectOption('.props select', 'Open');
await page.screenshot({ path: out('05-selected.png') });

// takeoff tab
await page.click('text=Takeoff summary');
await page.waitForTimeout(150);
await page.screenshot({ path: out('06-takeoff.png') });
const takeoff = await page.$$eval('.list-scroll tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));

// 5) save through the real save path, but to a known file
await app.evaluate(({ dialog }, target) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
}, savedPath);
await page.keyboard.press('Control+Shift+S');
for (let i = 0; i < 50 && !existsSync(savedPath); i++) await page.waitForTimeout(100);
await page.waitForTimeout(300);

// 6) reopen the saved file and check everything came back
await dropFile(savedPath);
await page.waitForTimeout(1200);
const listCount = await page.$eval('.list-bar .tabs button', (b) => b.textContent);
const scaleLabel = await page.$eval('.scale-btn', (b) => b.textContent);
await page.click('text=Takeoff summary');
await page.waitForTimeout(150);
const takeoffAfter = await page.$$eval('.list-scroll tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
await page.screenshot({ path: out('07-reopened.png') });

console.log(JSON.stringify({ zoom, takeoff, takeoffAfter, listCount, scaleLabel, saved: existsSync(savedPath), errors }, null, 2));
await app.close();
