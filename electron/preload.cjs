const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('plandesk', {
  openPdf: () => ipcRenderer.invoke('open-pdf'),
  readPath: (p) => ipcRenderer.invoke('read-path', p),
  savePdf: (bytes, path, suggestedName) => ipcRenderer.invoke('save-pdf', bytes, path, suggestedName),
  saveText: (text, suggestedName, filterName, ext) => ipcRenderer.invoke('save-text', text, suggestedName, filterName, ext),
  pathForFile: (file) => webUtils.getPathForFile(file),
  userName: () => ipcRenderer.invoke('user-name'),
  setDirty: (dirty, title) => ipcRenderer.send('set-dirty', dirty, title),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
});
