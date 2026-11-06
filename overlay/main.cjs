const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  screen,
  nativeImage,
  dialog,
  shell,
  clipboard,
} = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.BUFFY_HOME ? path.resolve(process.env.BUFFY_HOME) : path.join(os.homedir(), '.buffy');
const WINDOW_FILE = path.join(HOME, 'window.json');
const WARDROBE_FILE = path.join(HOME, 'wardrobe.json');
const ONBOARDING_FILE = path.join(HOME, 'onboarding.json');
const DOCS_URL = 'https://github.com/slayyyyer/buffy#install-and-run';
const WIDTH = 300;
const HEIGHT = 330;
const EDGE_GAP = 24;
const WARDROBE_DEFAULTS = { bow: 'none', hat: 'none', wand: false, theme: 'rose' };
const BOWS = ['none', 'pink', 'lavender', 'mint'];
const HATS = ['none', 'beret', 'party'];
const THEMES = ['rose', 'lavender', 'mint', 'sky'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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
const smokeTest = process.argv.includes('--smoke-test');
const forceOnboarding = process.argv.includes('--onboarding');

let win = null;
let setupWindow = null;
let tray = null;
let drag = null;
let saveTimer = null;
let hideTimer = null;
let pollTimer = null;
let cursorTimer = null;
let failures = 0;
let lastCursor = '';
let embeddedDaemon = null;
let daemonStarting = null;
let quitting = false;
let autoUpdater = null;
let updateReady = null;
let updatePromptOpen = false;
let manualUpdateCheck = false;

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
    writeJson(WINDOW_FILE, { x, y });
  } catch {
    /* position persistence is best effort */
  }
}

function saveWardrobe() {
  try {
    writeJson(WARDROBE_FILE, wardrobe);
  } catch {
    /* wardrobe persistence is best effort */
  }
}

function updateWardrobe(patch) {
  wardrobe = normalizeWardrobe({ ...wardrobe, ...patch });
  saveWardrobe();
  if (win && !win.isDestroyed()) win.webContents.send('wardrobe', wardrobe);
  refreshTrayMenu();
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

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        timeout: 1200,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': payload.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('daemon timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function ensureDaemon() {
  try {
    await getJson('/health');
    return;
  } catch {
    /* no daemon is listening yet */
  }
  if (daemonStarting) return daemonStarting;

  daemonStarting = (async () => {
    try {
      const daemonRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : ROOT;
      const daemonUrl = pathToFileURL(path.join(daemonRoot, 'src', 'daemon.js')).href;
      const { startDaemon } = await import(daemonUrl);
      let daemonConfig;
      if (smokeTest) {
        const { readConfig } = await import(pathToFileURL(path.join(daemonRoot, 'src', 'config.js')).href);
        const base = readConfig();
        daemonConfig = { ...base, watch: { ...base.watch, enabled: false } };
      }
      embeddedDaemon = await startDaemon({ port: PORT, quiet: true, ...(daemonConfig ? { config: daemonConfig } : {}) });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        console.error(`buffy daemon: ${error.message}`);
      }
    }
  })();
  try {
    return await daemonStarting;
  } finally {
    daemonStarting = null;
  }
}

async function restartDaemon() {
  const current = embeddedDaemon;
  embeddedDaemon = null;
  daemonStarting = null;
  if (current) {
    try {
      await current.close();
    } catch {
      /* the next daemon can still start */
    }
  }
  await ensureDaemon();
  if (win && !win.isDestroyed()) poll();
  refreshTrayMenu();
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
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    if (dev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);

  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  });

  win.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      win.hide();
      refreshTrayMenu();
    }
  });

  win.on('closed', () => {
    win = null;
    clearInterval(pollTimer);
    clearInterval(cursorTimer);
    pollTimer = null;
    cursorTimer = null;
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

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
  } else {
    win.showInactive();
  }
  refreshTrayMenu();
}

function hideWindow() {
  if (win && !win.isDestroyed()) win.hide();
  refreshTrayMenu();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) hideWindow();
  else showWindow();
}

function onboardingSeen() {
  return readJson(ONBOARDING_FILE, {})?.seen === true;
}

function markOnboardingSeen() {
  try {
    writeJson(ONBOARDING_FILE, { seen: true, seenAt: new Date().toISOString() });
  } catch {
    /* onboarding should never block the pet */
  }
}

function showOnboarding({ force = false } = {}) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  if (!force && onboardingSeen()) return;

  setupWindow = new BrowserWindow({
    width: 540,
    height: 680,
    center: true,
    resizable: false,
    minimizable: true,
    maximizable: false,
    show: false,
    title: 'Welcome to Buffy',
    backgroundColor: '#fff8f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'onboarding-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, 'onboarding.html'));
  setupWindow.once('ready-to-show', () => {
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.show();
  });
  setupWindow.on('closed', () => {
    markOnboardingSeen();
    setupWindow = null;
  });
}

function linuxAutostartFile() {
  return path.join(app.getPath('appData'), 'autostart', 'buffy.desktop');
}

function loginItemEnabled() {
  try {
    if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile());
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function setLoginItem(enabled) {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') {
    const file = linuxAutostartFile();
    if (enabled) {
      const target = process.env.APPIMAGE || process.execPath;
      const escaped = target.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Buffy',
          'Comment=A tiny companion for your coding agents',
          `Exec="${escaped}"`,
          'Terminal=false',
          'X-GNOME-Autostart-enabled=true',
          '',
        ].join('\n'),
      );
    } else {
      fs.rmSync(file, { force: true });
    }
    return enabled;
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return loginItemEnabled();
}

function showUpdateMessage(options) {
  return dialog.showMessageBox({
    type: 'info',
    title: 'Buffy updates',
    ...options,
  });
}

function initUpdater() {
  if (!app.isPackaged || smokeTest) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    console.error(`buffy updater: ${error.message}`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info;
    refreshTrayMenu();
    promptInstall();
  });
  autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateMessage({
      message: 'Buffy is up to date.',
      detail: `You are running ${app.getVersion()}.`,
    });
  });
  autoUpdater.on('error', (error) => {
    const manual = manualUpdateCheck;
    manualUpdateCheck = false;
    console.error(`buffy updater: ${error.message}`);
    if (manual) {
      showUpdateMessage({
        type: 'error',
        message: 'Could not check for updates.',
        detail: error.message,
      });
    }
  });

  setTimeout(() => checkForUpdates(false), 20_000).unref?.();
}

async function promptInstall() {
  if (!autoUpdater || !updateReady || updatePromptOpen) return;
  updatePromptOpen = true;
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Buffy update ready',
    message: `Buffy ${updateReady.version} is ready to install.`,
    detail: 'Restart Buffy to finish the update. Your pet and settings stay put.',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  updatePromptOpen = false;
  if (result.response === 0) autoUpdater.quitAndInstall();
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged || !autoUpdater) {
    if (manual) {
      await showUpdateMessage({
        message: 'Updates are available in installed builds.',
        detail: 'Run Buffy from an installed release to receive updates.',
      });
    }
    return;
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    if (manual) {
      await showUpdateMessage({
        message: 'Updates are available in the AppImage build.',
        detail: 'Download the latest AppImage from the Buffy releases page.',
      });
    }
    return;
  }

  manualUpdateCheck = Boolean(manual);
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (manual) {
      manualUpdateCheck = false;
      await showUpdateMessage({
        type: 'error',
        message: 'Could not check for updates.',
        detail: error.message,
      });
    }
  }
}

function menuTemplate(fromTray = false) {
  const items = [];
  if (fromTray) {
    items.push({
      label: win && !win.isDestroyed() && win.isVisible() ? 'Hide Buffy' : 'Show Buffy',
      click: toggleWindow,
    });
  }
  items.push(
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
      label: 'Setup guide…',
      click: () => showOnboarding({ force: true }),
    },
    {
      label: 'Open Buffy folder',
      click: () => shell.openPath(HOME),
    },
  );

  if (app.isPackaged) {
    items.push({
      label: 'Launch at login',
      type: 'checkbox',
      checked: loginItemEnabled(),
      click: (item) => {
        try {
          setLoginItem(item.checked);
        } catch (error) {
          dialog.showErrorBox('Could not update launch at login', error.message);
        }
        refreshTrayMenu();
      },
    });
    items.push({
      label: updateReady ? 'Restart to update' : 'Check for updates…',
      click: () => (updateReady ? promptInstall() : checkForUpdates(true)),
    });
  } else {
    items.push(
      { label: 'Launch at login (installed builds)', enabled: false },
      { label: 'Updates (installed builds)', enabled: false },
    );
  }

  items.push(
    {
      label: 'Restart local daemon',
      click: () => restartDaemon().catch((error) => dialog.showErrorBox('Could not restart the daemon', error.message)),
    },
    { type: 'separator' },
    {
      label: 'Hide for 10 minutes',
      click: () => {
        if (!win || win.isDestroyed()) return;
        win.hide();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (win && !win.isDestroyed()) win.showInactive();
        }, 10 * 60 * 1000);
      },
    },
    { label: 'Quit Buffy', click: () => app.quit() },
  );
  return items;
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(true)));
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      console.error(`buffy tray: icon not found at ${iconPath}`);
      return;
    }
    image = image.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 });
    tray = new Tray(image);
    tray.setToolTip('Buffy');
    tray.on('click', toggleWindow);
    refreshTrayMenu();
  } catch (error) {
    console.error(`buffy tray: ${error.message}`);
  }
}

async function runSmokeTest() {
  try {
    const health = await getJson('/health');
    if (!health?.ok || health.service !== 'buffy') throw new Error('daemon health check failed');
    if (!win || win.isDestroyed()) throw new Error('overlay window was not created');
    await Promise.race([
      new Promise((resolve) => {
        if (!win.webContents.isLoadingMainFrame()) return resolve();
        win.webContents.once('did-finish-load', resolve);
      }),
      sleep(10_000),
    ]);
    const page = await win.webContents.executeJavaScript(
      "({ stage: Boolean(document.querySelector('#stage')), sessions: Boolean(document.querySelector('#sessions')), api: Boolean(window.buffy), ready: document.readyState })",
    );
    if (!page.stage || !page.sessions || !page.api || page.ready !== 'complete') {
      throw new Error(`renderer check failed: ${JSON.stringify(page)}`);
    }
    console.log(`SMOKE_OK ${health.version} ${page.ready}`);
    app.exit(0);
  } catch (error) {
    console.error(`SMOKE_FAIL ${error.message}`);
    app.exit(1);
  }
}

ipcMain.on('pet', () => postPet());

ipcMain.handle('dismiss-session', async (_event, sessionId) => {
  if (!sessionId) return false;
  try {
    await postJson('/session/dismiss', { sessionId: String(sessionId) });
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('setup-copy', (_event, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.on('setup-complete', () => {
  markOnboardingSeen();
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
});

ipcMain.on('setup-docs', () => {
  shell.openExternal(DOCS_URL);
});

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
  Menu.buildFromTemplate(menuTemplate(false)).popup({ window: win });
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    if (argv.includes('--onboarding')) showOnboarding({ force: true });
  });
  app.on('activate', () => {
    showWindow();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.slayyyyer.buffy');
    try {
      await ensureDaemon();
    } catch (error) {
      console.error(`buffy daemon: ${error.message}`);
    }
    createWindow();
    if (smokeTest) {
      await runSmokeTest();
      return;
    }
    createTray();
    initUpdater();
    if (!shotPath && (forceOnboarding || !onboardingSeen())) {
      setTimeout(() => showOnboarding({ force: forceOnboarding }), 1000);
    }
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
  app.on('before-quit', (event) => {
    quitting = true;
    clearInterval(pollTimer);
    clearInterval(cursorTimer);
    clearTimeout(hideTimer);
    saveBounds();
    if (embeddedDaemon) {
      event.preventDefault();
      const daemon = embeddedDaemon;
      embeddedDaemon = null;
      daemon.close().catch(() => {}).finally(() => app.quit());
    }
  });
}
