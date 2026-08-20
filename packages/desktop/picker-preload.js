const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onSources: (callback) => ipcRenderer.on('picker:sources', (_event, sources) => callback(sources)),
  select: (id) => ipcRenderer.send('picker:select', id),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
