const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.BUFFY_HOME ? path.resolve(process.env.BUFFY_HOME) : path.join(os.homedir(), '.buffy');
const WINDOW_FILE = path.join(HOME, 'window.json');
const WARDROBE_FILE = path.join(HOME, 'wardrobe.json');
const WIDTH = 240;
const HEIGHT = 250;
const EDGE_GAP = 24;
const WARDROBE_DEFAULTS = { bow: 'none', hat: 'none', wand: false, theme: 'rose' };
const BOWS = ['none', 'pink', 'lavender', 'mint'];
const HATS = ['none', 'beret', 'party'];
const THEMES = ['rose', 'lavender', 'mint', 'sky'];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const config = readJson(path.join(HOME, 'config.json'), {});
const PORT = Number(process.env.BUFFY_PORT || config.port || 4517);

function normalizeWardrobe(value) {
  const next = value && typeof value === 'object' ? value : {};
  return {
    bow: BOWS.includes(next.bow) ? next.bow : WARDROBE_DEFAULTS.bow,
    hat: HATS.includes(next.hat) ? next.hat : WARDROBE_DEFAULTS.hat,
    wand: Boolean(next.wand),
    theme: THEMES.includes(next.theme) ? next.theme : WARDROBE_DEFAULTS.theme,
  };
}

let wardrobe = normalizeWardrobe(readJson(WARDROBE_FILE, {}));

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const shotPath = argValue('--shot');
const shotExit = process.argv.includes('--shot-exit');
const dev = process.argv.includes('--dev');

let win = null;
let drag = null;
let saveTimer = null;
let pollTimer = null;
let cursorTimer = null;
let failures = 0;
let lastCursor = '';

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WIDTH - EDGE_GAP, y: area.y + area.height - HEIGHT - EDGE_GAP };
}

function savedBounds() {
  const saved = readJson(WINDOW_FILE, null);
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      saved.x + WIDTH - 40 > area.x &&
      saved.x + 40 < area.x + area.width &&
      saved.y + HEIGHT - 40 > area.y &&
      saved.y + 40 < area.y + area.height
    );
  });
  return visible ? { x: saved.x, y: saved.y } : null;
}

function saveBounds() {
  if (!win) return;
  try {
    const [x, y] = win.getPosition();
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(WINDOW_FILE, `${JSON.stringify({ x, y }, null, 2)}\n`);
  } catch {
    /* position persistence is best effort */
  }
}

function saveWardrobe() {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(WARDROBE_FILE, `${JSON.stringify(wardrobe, null, 2)}\n`);
  } catch {
    /* wardrobe persistence is best effort */
  }
}

function updateWardrobe(patch) {
  wardrobe = normalizeWardrobe({ ...wardrobe, ...patch });
  saveWardrobe();
  if (win && !win.isDestroyed()) win.webContents.send('wardrobe', wardrobe);
}

function wardrobeMenu() {
  return {
    label: 'Wardrobe',
    submenu: [
      {
        label: 'Bow',
        submenu: [
          { label: 'No bow', type: 'radio', checked: wardrobe.bow === 'none', click: () => updateWardrobe({ bow: 'none' }) },
          { label: 'Pink bow', type: 'radio', checked: wardrobe.bow === 'pink', click: () => updateWardrobe({ bow: 'pink' }) },
          { label: 'Lavender bow', type: 'radio', checked: wardrobe.bow === 'lavender', click: () => updateWardrobe({ bow: 'lavender' }) },
          { label: 'Mint bow', type: 'radio', checked: wardrobe.bow === 'mint', click: () => updateWardrobe({ bow: 'mint' }) },
        ],
      },
      {
        label: 'Hat',
        submenu: [
          { label: 'No hat', type: 'radio', checked: wardrobe.hat === 'none', click: () => updateWardrobe({ hat: 'none' }) },
          { label: 'Pastel beret', type: 'radio', checked: wardrobe.hat === 'beret', click: () => updateWardrobe({ hat: 'beret' }) },
          { label: 'Party hat', type: 'radio', checked: wardrobe.hat === 'party', click: () => updateWardrobe({ hat: 'party' }) },
        ],
      },
      {
        label: 'Wand',
        type: 'checkbox',
        checked: wardrobe.wand,
        click: () => updateWardrobe({ wand: !wardrobe.wand }),
      },
      { type: 'separator' },
      {
        label: 'Theme',
        submenu: [
          { label: 'Rose', type: 'radio', checked: wardrobe.theme === 'rose', click: () => updateWardrobe({ theme: 'rose' }) },
          { label: 'Lavender', type: 'radio', checked: wardrobe.theme === 'lavender', click: () => updateWardrobe({ theme: 'lavender' }) },
          { label: 'Mint', type: 'radio', checked: wardrobe.theme === 'mint', click: () => updateWardrobe({ theme: 'mint' }) },
          { label: 'Sky', type: 'radio', checked: wardrobe.theme === 'sky', click: () => updateWardrobe({ theme: 'sky' }) },
        ],
      },
    ],
  };
}

function moveToCorner(corner) {
  if (!win || win.isDestroyed()) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const x = corner.endsWith('left') ? area.x + EDGE_GAP : area.x + area.width - WIDTH - EDGE_GAP;
  const y = corner.startsWith('top') ? area.y + EDGE_GAP : area.y + area.height - HEIGHT - EDGE_GAP;
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
  saveBounds();
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 600 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('daemon timeout')));
    req.on('error', reject);
  });
}

function postPet() {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/pet', method: 'POST', timeout: 800 }, (res) => res.resume());
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end();
}

async function poll() {
  if (!win || win.isDestroyed()) return;
  try {
    const snapshot = await getJson('/state');
    failures = 0;
    win.webContents.send('state', snapshot);
  } catch {
    failures += 1;
    if (failures >= 3) win.webContents.send('offline');
  }
}

function sendCursor() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const point = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const payload = { x: point.x - bounds.x, y: point.y - bounds.y };
  const key = `${payload.x},${payload.y}`;
  if (key === lastCursor) return;
  lastCursor = key;
  win.webContents.send('cursor', payload);
}

function createWindow() {
  const bounds = savedBounds() || defaultBounds();

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'buffy',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'floating');
  // Frameless transparent windows can still be hit-tested as resizable on
  // Windows. Pin both dimensions so a drag cannot turn into a resize.
  win.setResizable(false);
  win.setMinimumSize(WIDTH, HEIGHT);
  win.setMaximumSize(WIDTH, HEIGHT);
  win.on('will-resize', (event) => event.preventDefault());
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('wardrobe', wardrobe);
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    if (dev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  });

  win.on('closed', () => {
    win = null;
  });

  pollTimer = setInterval(poll, 350);
  poll();

  cursorTimer = setInterval(sendCursor, 80);
  sendCursor();

  if (shotPath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage();
          const target = path.resolve(shotPath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, image.toPNG());
          console.log(`buffy overlay screenshot: ${target}`);
        } catch (error) {
          console.error(`buffy overlay screenshot failed: ${error.message}`);
        }
        if (shotExit) app.quit();
      }, 2200);
    });
  }
}

ipcMain.on('pet', () => postPet());

ipcMain.on('drag-start', (_event, screenX, screenY) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  drag = { screenX, screenY, x, y };
});

ipcMain.on('drag-move', (_event, screenX, screenY) => {
  if (!win || !drag) return;
  const nextX = drag.x + (screenX - drag.screenX);
  const nextY = drag.y + (screenY - drag.screenY);
  const display = screen.getDisplayNearestPoint({ x: nextX + WIDTH / 2, y: nextY + HEIGHT / 2 });
  const area = display.workArea;
  const x = Math.min(Math.max(nextX, area.x - 60), area.x + area.width - 40);
  const y = Math.min(Math.max(nextY, area.y), area.y + area.height - 40);
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT });
});

ipcMain.on('drag-end', () => {
  if (!win) return;
  drag = null;
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
  saveBounds();
});

ipcMain.on('menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
    {
      label: 'Move to corner',
      submenu: [
        { label: 'Top left', click: () => moveToCorner('top-left') },
        { label: 'Top right', click: () => moveToCorner('top-right') },
        { label: 'Bottom left', click: () => moveToCorner('bottom-left') },
        { label: 'Bottom right', click: () => moveToCorner('bottom-right') },
      ],
    },
    wardrobeMenu(),
    { type: 'separator' },
    {
      label: 'Hide for 10 minutes',
      click: () => {
        if (!win) return;
        win.hide();
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.showInactive();
        }, 10 * 60 * 1000);
      },
    },
    { label: 'Quit buffy', click: () => app.quit() },
  ]).popup({ window: win });
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) win.showInactive();
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    clearInterval(pollTimer);
    clearInterval(cursorTimer);
    saveBounds();
  });
}
