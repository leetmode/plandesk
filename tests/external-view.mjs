// Opens the saved PDF in Chromium's own PDF viewer (PDFium) to confirm other
// programs see the markups via their appearance streams.
import { _electron as electron } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PLANDESK_USER_DATA: path.join(root, 'tests', 'e2e-out', 'profile') } });
await app.firstWindow();
const url = pathToFileURL(path.join(root, 'tests', 'e2e-out', process.argv[2] ?? 'saved.pdf')).toString();
const b64 = await app.evaluate(async ({ BrowserWindow }, u) => {
  const w = new BrowserWindow({ width: 1500, height: 1000, webPreferences: { plugins: true } });
  await w.loadURL(u);
  await new Promise((r) => setTimeout(r, 3500));
  return (await w.webContents.capturePage()).toPNG().toString('base64');
}, url);
writeFileSync(path.join(root, 'tests', 'e2e-out', (process.argv[3] ?? '08-external-viewer.png')), Buffer.from(b64, 'base64'));
await app.close();
