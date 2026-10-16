const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.PLANDESK_DEV_URL; // e.g. http://localhost:5173 while running `npm run dev`
const DIST = path.join(__dirname, '..', 'dist');

// Serve the built UI from app:// so module workers (pdf.js) load like on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let dirty = false;
let pendingPath = null;

const pdfArg = (argv) => argv.slice(1).find((a) => /\.pdf$/i.test(a) && !a.startsWith('-'));

function sendOpen(p) {
  if (!p) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('open-path', path.resolve(p));
  else pendingPath = path.resolve(p);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1d2128',
    title: 'PlanDesk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(DEV_URL || 'app://plandesk/index.html');

  win.webContents.on('did-finish-load', () => {
    if (pendingPath) {
      win.webContents.send('open-path', pendingPath);
      pendingPath = null;
    }
  });

  // links open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });

  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved markups.',
      detail: 'Close PlanDesk and discard them? Use Cancel, then Ctrl+S to save first.',
    });
    if (choice === 1) e.preventDefault();
  });
  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  const send = (cmd) => () => win?.webContents.send('menu', cmd);
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // undo/redo go to the app; the rest keep native behavior inside text fields
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo'), registerAccelerator: false },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo'), registerAccelerator: false },
        { type: 'separator' },
        { role: 'cut', registerAccelerator: false },
        { role: 'copy', registerAccelerator: false },
        { role: 'paste', registerAccelerator: false },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function writeAtomic(target, bytes) {
  const tmp = `${target}.plandesk-tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, target);
}

ipcMain.handle('open-pdf', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), path: p, bytes: new Uint8Array(await fs.readFile(p)) };
});

ipcMain.handle('read-path', async (_e, p) => {
  if (typeof p !== 'string' || !/\.pdf$/i.test(p)) throw new Error('Not a PDF');
  return { name: path.basename(p), path: p, bytes: new Uint8Array(await fs.readFile(p)) };
});

ipcMain.handle('save-pdf', async (_e, bytes, target, suggestedName) => {
  let p = target;
  if (!p) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  await writeAtomic(p, Buffer.from(bytes));
  return p;
});

ipcMain.handle('save-text', async (_e, text, suggestedName, filterName, ext) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: [{ name: filterName, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await writeAtomic(r.filePath, text);
  return r.filePath;
});

ipcMain.handle('user-name', () => {
  try {
    return os.userInfo().username;
  } catch {
    return 'User';
  }
});

ipcMain.on('set-dirty', (_e, d, title) => {
  dirty = !!d;
  if (win) {
    win.setTitle(`${d ? '• ' : ''}${title}`);
    win.setDocumentEdited?.(dirty);
  }
});

// one window; a second launch (e.g. double-clicking another PDF) opens in it
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    sendOpen(pdfArg(argv));
  });

  // macOS: files opened from Finder
  app.on('open-file', (e, p) => {
    e.preventDefault();
    sendOpen(p);
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
      if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    buildMenu();
    createWindow();
    sendOpen(pdfArg(process.argv));
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
