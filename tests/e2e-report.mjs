// Review report export: add commented markups, export, then open the report and capture its pages.
import { _electron as electron } from 'playwright-core';
import { readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (n) => path.join(root, 'tests', 'e2e-out', n);
const sample = path.join(root, 'samples', 'sample-floor-plan.pdf');
const reportPath = out('review-report.pdf');
if (existsSync(reportPath)) rmSync(reportPath);
const results = {};

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PLANDESK_USER_DATA: out('profile') } });
// save dialogs answer with our path; don't launch the system PDF viewer
await app.evaluate(({ dialog, shell }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  globalThis.__opened = [];
  shell.openPath = async (f) => (globalThis.__opened.push(f), '');
}, reportPath);
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.welcome');

const drop = async (file) => {
  const b64 = readFileSync(file).toString('base64');
  await page.evaluate(([data, name]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [b64, path.basename(file)]);
};
await drop(sample);
await page.waitForSelector('.page-canvas', { timeout: 15000 });
await page.click('button[title="Fit page"]');
await page.waitForTimeout(500);

const S = (fx, fy) => page.$eval('svg.overlay', (svg, [fx, fy]) => { const r = svg.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; }, [fx, fy]);
const drag = async (a, b) => {
  const A = await S(...a), B = await S(...b);
  await page.mouse.move(...A);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(A[0] + ((B[0] - A[0]) * i) / 8, A[1] + ((B[1] - A[1]) * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(120);
};
const comment = async (txt) => {
  await page.fill('.props textarea[data-field="comment"]', txt);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
};

// 1) a cloud with a comment, 2) a rectangle with a long comment, 3) a length measurement, 4) a note
await page.keyboard.press('c');
await drag([0.12, 0.3], [0.3, 0.42]);
await page.keyboard.press('Escape'); // leave the shape-text editor
await page.keyboard.press('v');
await page.click('.list-scroll tbody tr:last-child');
await comment('Please move this door 2 ft to the left so it clears the desk.');
await page.keyboard.press('r');
await drag([0.6, 0.25], [0.75, 0.6]);
await page.keyboard.press('Escape');
await page.click('.list-scroll tbody tr:last-child');
await comment(('Open office layout needs another power drop near the window wall. ').repeat(4) + '\nAlso confirm the ceiling height with the architect.');
await page.keyboard.press('m');
await drag([0.15, 0.85], [0.6, 0.85]);
await page.keyboard.press('o');
const n = await S(0.85, 0.12);
await page.mouse.click(...n);
await page.waitForTimeout(150);
await comment('Title block: revision date is wrong.');
await page.keyboard.press('Escape');
results.markups = await page.$$eval('.list-scroll tbody tr', (r) => r.length);

await page.click('button:has-text("Export review report")');
await page.waitForFunction(() => !document.querySelector('.list-bar')?.textContent?.includes('report '), null, { timeout: 60000 }).catch(() => {});
for (let i = 0; i < 100 && !existsSync(reportPath); i++) await page.waitForTimeout(200);
await page.waitForTimeout(500);
results.reportBytes = existsSync(reportPath) ? statSync(reportPath).size : 0;
results.opened = await app.evaluate(() => globalThis.__opened);

// open the report itself in a new tab and capture each page
await drop(reportPath);
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 2);
await page.waitForTimeout(1200);
results.reportPages = await page.$$eval('.thumb', (t) => t.length);
for (let i = 0; i < results.reportPages; i++) {
  await page.click(`.thumb >> nth=${i}`);
  await page.click('button[title="Fit width"]'); // top of each page, large enough to read
  await page.waitForTimeout(900);
  await page.locator('.viewer-shell, .viewer').first().screenshot({ path: out(`report-p${i + 1}.png`) }).catch(() => page.screenshot({ path: out(`report-p${i + 1}.png`) }));
}

await app.close();
console.log(JSON.stringify({ ...results, errors }, null, 1));
