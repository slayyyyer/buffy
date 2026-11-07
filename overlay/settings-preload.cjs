const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('buffySettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  action: (type, payload) => ipcRenderer.invoke('settings:action', { type, ...(payload || {}) }),
  close: () => ipcRenderer.invoke('settings:close'),
  openExternal: (url) => ipcRenderer.invoke('settings:open-external', url),
  onState: (callback) => subscribe('settings:state', callback),
  onSection: (callback) => subscribe('settings:section', callback),
});
