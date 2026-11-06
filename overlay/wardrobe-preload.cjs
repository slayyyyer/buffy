const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('buffyWardrobe', {
  get: () => ipcRenderer.invoke('wardrobe:get'),
  update: (patch) => ipcRenderer.invoke('wardrobe:update', patch),
  random: () => ipcRenderer.invoke('wardrobe:random'),
  savePreset: (name) => ipcRenderer.invoke('wardrobe:save-preset', name),
  applyPreset: (id) => ipcRenderer.invoke('wardrobe:apply-preset', id),
  deletePreset: (id) => ipcRenderer.invoke('wardrobe:delete-preset', id),
  close: () => ipcRenderer.send('wardrobe:close'),
  onChanged: (callback) => subscribe('wardrobe:changed', callback),
});
