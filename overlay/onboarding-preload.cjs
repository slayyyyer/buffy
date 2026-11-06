const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buffySetup', {
  copy: (text) => ipcRenderer.invoke('setup-copy', text),
  complete: () => ipcRenderer.send('setup-complete'),
  docs: () => ipcRenderer.send('setup-docs'),
});
