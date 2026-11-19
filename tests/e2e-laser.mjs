// Laser pointer (presenting): D turns it on, a held drag draws a red trail that fades out,
// nothing becomes a markup or an undo step, and Esc goes back to Select.
import { _electron as electron } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');
const results = {};

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PLANDESK_USER_DATA: path.join(root, 'tests', 'e2e-out', 'profile') } });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.welcome');

const b64 = readFileSync(sample).toString('base64');
await page.evaluate(([data, name]) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
  document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [b64, path.basename(sample)]);
await page.waitForSelector('.page-canvas', { timeout: 15000 });
await page.waitForTimeout(500);

// red pixels on the laser canvas
const redPixels = () =>
  page.evaluate(() => {
    const c = document.querySelector('.laser-canvas');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 3] > 150) n++;
    return n;
  });
const overlayMarkups = () => page.$$eval('svg.overlay g[data-id]', (g) => g.length);

results.markupsBefore = await overlayMarkups();
await page.keyboard.press('d');
await page.waitForTimeout(150);
results.laserButtonActive = await page.$eval('button[title^="Laser pointer"]', (b) => b.classList.contains('active'));
results.canvasShown = !!(await page.$('.laser-canvas'));

// circle something in the middle of the sheet
const box = await page.$eval('.page-slot', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const [cx, cy] = box;
await page.mouse.move(cx + 80, cy);
await page.mouse.down();
for (let i = 1; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  await page.mouse.move(cx + 80 * Math.cos(a), cy + 55 * Math.sin(a));
}
await page.waitForTimeout(50);
results.redWhileDrawing = await redPixels();
await page.screenshot({ path: out('40-laser-drawing.png') });
await page.mouse.up();
await page.waitForTimeout(1000);
results.redAfter1s = await redPixels(); // still held on screen
await page.screenshot({ path: out('41-laser-held.png') });
await page.mouse.move(cx - 300, cy - 200); // park the dot away from the trail
await page.waitForTimeout(3200);
results.redAfter4s = await redPixels(); // trail gone; only the small dot remains
await page.screenshot({ path: out('42-laser-faded.png') });

results.markupsAfter = await overlayMarkups();
results.undoDisabled = await page.$eval('button[title^="Undo"]', (b) => b.disabled);

await page.keyboard.press('Escape');
await page.waitForTimeout(150);
results.canvasAfterEsc = !!(await page.$('.laser-canvas'));
results.selectActive = await page.$eval('button[title^="Select"]', (b) => b.classList.contains('active'));

results.errors = errors;
console.log(JSON.stringify(results, null, 2));
await app.close();
