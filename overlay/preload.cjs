const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('buffy', {
  onState: (callback) => subscribe('state', callback),
  onOffline: (callback) => subscribe('offline', callback),
  onCursor: (callback) => subscribe('cursor', callback),
  onPrefs: (callback) => subscribe('prefs', callback),
  onCatalog: (callback) => subscribe('catalog', callback),
  onToast: (callback) => subscribe('toast', callback),
  onSummon: (callback) => subscribe('summon', callback),
  onVisibility: (callback) => subscribe('visibility', callback),
  onOpenPanel: (callback) => subscribe('open-panel', callback),
  onDraft: (callback) => subscribe('draft', callback),
  onMode: (callback) => subscribe('mode', callback),
  onUpdate: (callback) => subscribe('update', callback),
  onChime: (callback) => subscribe('chime', callback),

  hello: () => ipcRenderer.invoke('hello'),
  dismissSession: (sessionId) => ipcRenderer.invoke('dismiss-session', sessionId),
  decidePermission: (payload) => ipcRenderer.invoke('permission:decide', payload && typeof payload === 'object' ? payload : {}),
  focusSession: (payload) => ipcRenderer.invoke('session:focus', payload && typeof payload === 'object' ? payload : {}),
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  getComposer: () => ipcRenderer.invoke('composer:get'),
  setDraft: (text) => ipcRenderer.invoke('composer:update', String(text ?? '')),
  handoff: (payload) => ipcRenderer.invoke('composer:handoff', payload && typeof payload === 'object' ? payload : {}),
  closeComposer: (options) => ipcRenderer.invoke('composer:close', options && typeof options === 'object' ? options : {}),
  copy: (text) => ipcRenderer.invoke('clipboard:write', String(text ?? '')),
  requestMode: (mode) => ipcRenderer.invoke('ui:mode', mode),
  openSettings: (section) => ipcRenderer.invoke('ui:settings', section || null),
  openClaude: () => ipcRenderer.invoke('ui:open-claude'),
  snooze: (durationMs) => ipcRenderer.invoke('alerts:snooze', durationMs),
  setIgnoreMouse: (ignore) => ipcRenderer.send('ui:ignore-mouse', Boolean(ignore)),
  dragStart: (screenX, screenY) => ipcRenderer.send('drag-start', screenX, screenY),
  dragMove: (screenX, screenY) => ipcRenderer.send('drag-move', screenX, screenY),
  dragEnd: () => ipcRenderer.send('drag-end'),
  menu: () => ipcRenderer.send('menu'),
});
