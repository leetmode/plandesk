// Thin layer over the Electron bridge, with a browser fallback so the UI also
// runs from `npm run dev` in a plain browser.
export interface OpenedFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

interface Bridge {
  openPdf(): Promise<OpenedFile[]>;
  readPath(path: string): Promise<OpenedFile>;
  savePdf(bytes: Uint8Array, path: string | null, suggestedName: string): Promise<string | null>;
  saveText(text: string, suggestedName: string, filterName: string, ext: string): Promise<string | null>;
  pathForFile(file: File): string;
  userName(): Promise<string>;
  setDirty(dirty: boolean, title: string): void;
  onOpenPath(cb: (path: string) => void): void;
  onMenu(cb: (command: string) => void): void;
}

declare global {
  interface Window {
    plandesk?: Bridge;
  }
}

const bridge = () => window.plandesk;
export const isDesktop = () => !!bridge();

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function fileToOpened(file: File): Promise<OpenedFile> {
  const path = bridge()?.pathForFile(file) || null;
  return { name: file.name, path, bytes: new Uint8Array(await file.arrayBuffer()) };
}

// Lets the user pick one or more PDFs; empty if cancelled.
export async function openPdfs(): Promise<OpenedFile[]> {
  const b = bridge();
  if (b) return b.openPdf();
  return Promise.all((await pickFiles('application/pdf,.pdf')).map(fileToOpened));
}

export const readPath = (path: string) => bridge()!.readPath(path);

// Returns the path written to (desktop), the file name (browser), or null if cancelled.
export async function savePdf(bytes: Uint8Array, path: string | null, suggestedName: string): Promise<string | null> {
  const b = bridge();
  if (b) return b.savePdf(bytes, path, suggestedName);
  download(bytes as BlobPart, suggestedName, 'application/pdf');
  return suggestedName;
}

export async function saveText(text: string, suggestedName: string, filterName: string, ext: string): Promise<string | null> {
  const b = bridge();
  if (b) return b.saveText(text, suggestedName, filterName, ext);
  download(text, suggestedName, 'text/plain');
  return suggestedName;
}

export async function userName(): Promise<string> {
  return (await bridge()?.userName()) ?? 'User';
}

export const setDirty = (dirty: boolean, title: string) => {
  bridge()?.setDirty(dirty, title);
  document.title = `${dirty ? '• ' : ''}${title}`;
};

export const onOpenPath = (cb: (path: string) => void) => bridge()?.onOpenPath(cb);
export const onMenu = (cb: (command: string) => void) => bridge()?.onMenu(cb);
