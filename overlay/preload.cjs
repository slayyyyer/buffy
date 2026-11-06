const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('buffy', {
  onState: (callback) => subscribe('state', callback),
  onCursor: (callback) => subscribe('cursor', callback),
  onWardrobe: (callback) => subscribe('wardrobe', callback),
  onPetRequest: (callback) => subscribe('pet-request', callback),
  pet: () => ipcRenderer.send('pet'),
  dragStart: (screenX, screenY) => ipcRenderer.send('drag-start', screenX, screenY),
  dragMove: (screenX, screenY) => ipcRenderer.send('drag-move', screenX, screenY),
  dragEnd: () => ipcRenderer.send('drag-end'),
  menu: () => ipcRenderer.send('menu'),
});
