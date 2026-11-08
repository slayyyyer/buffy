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
  globalShortcut,
  Notification,
} = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : ROOT;
const HOME = process.env.BUFFY_HOME ? path.resolve(process.env.BUFFY_HOME) : path.join(os.homedir(), '.buffy');
const WINDOW_FILE = path.join(HOME, 'window.json');
const CONFIG_FILE = path.join(HOME, 'config.json');
const ONBOARDING_FILE = path.join(HOME, 'onboarding.json');
const LEGACY_WARDROBE_FILE = path.join(HOME, 'wardrobe.json');
const DOCS_URL = 'https://github.com/slayyyyer/buffy#install-and-run';
const SETTINGS_WIDTH = 1080;
const SETTINGS_HEIGHT = 780;
const EDGE_GAP = 24;
const WINDOW_STATE = require('./window-state.cjs');
const LOOKS = require('./catalog.cjs');
const { createDraftStore, buildClaudeCodeUrl } = require('./handoff.cjs');
const { createAlertPlanner } = require('./alerts.cjs');
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
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      fs.rmSync(file, { force: true });
      fs.renameSync(temp, file);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const shotPath = argValue('--shot');
const shotMode = argValue('--shot-mode') || 'full';
const shotExit = process.argv.includes('--shot-exit');
const settingsShotPath = argValue('--settings-shot') || argValue('--wardrobe-shot');
const settingsShotExit = process.argv.includes('--settings-shot-exit') || process.argv.includes('--wardrobe-shot-exit');
const dev = process.argv.includes('--dev');
const smokeTest = process.argv.includes('--smoke-test');
const forceOnboarding = process.argv.includes('--onboarding');
const CONFIG = readJson(CONFIG_FILE, {});
const PORT = Number(process.env.BUFFY_PORT || CONFIG.port || 4517);
const DRAFT = createDraftStore('');
const ALERTS = createAlertPlanner();

let win = null;
let settingsWindow = null;
let setupWindow = null;
let tray = null;
let drag = null;
let saveTimer = null;
let hideTimer = null;
let cursorTimer = null;
let pollTimer = null;
let streamRequest = null;
let streamResponse = null;
let streamTimer = null;
let streamConnected = false;
let failures = 0;
let lastCursor = '';
let embeddedDaemon = null;
let daemonStarting = null;
let quitting = false;
let autoUpdater = null;
let updateReady = null;
let updatePromptOpen = false;
let updateDeferred = false;
let manualUpdateCheck = false;
let handoffInFlight = false;
let composerOpen = false;
let pendingRestoreFocus = false;
let mode = 'full';
let windowState = WINDOW_STATE.normalizeWindowState(readJson(WINDOW_FILE, {}));
let prefs = null;
let prefsApi = null;
let rotationApi = null;
let installApi = null;
let snapshot = null;
let shortcutStatus = { accelerator: null, ok: false, error: 'Shortcut not registered yet.' };
let connectionCache = null;

function sourceModule(name) {
  return import(pathToFileURL(path.join(SOURCE_ROOT, 'src', name)).href);
}

async function loadSupportModules() {
  [prefsApi, rotationApi, installApi] = await Promise.all([
    sourceModule('prefs.js'),
    sourceModule('rotation.js'),
    sourceModule('install.js'),
  ]);
  const legacyWardrobe = readJson(LEGACY_WARDROBE_FILE, null);
  prefs = prefsApi.loadPrefs({
    env: process.env,
    legacyWardrobe,
    legacyOverlay: CONFIG.overlay,
  });
  for (const character of LOOKS.CHARACTERS) {
    if (!prefs.characters[character.id]) {
      prefs.characters[character.id] = prefsApi.defaultCharacterPrefs(character.defaultLook);
    }
  }
  prefsApi.savePrefs(prefs);
}

function ensureCharacterPrefs(characterId) {
  if (!prefs.characters[characterId]) {
    prefs.characters[characterId] = prefsApi.defaultCharacterPrefs(LOOKS.getCharacter(characterId).defaultLook);
  }
  return prefs.characters[characterId];
}

function normalizeAndSavePrefs(next) {
  prefs = prefsApi.normalizePrefs(next, { now: Date.now() });
  for (const character of LOOKS.CHARACTERS) {
    if (!prefs.characters[character.id]) {
      prefs.characters[character.id] = prefsApi.defaultCharacterPrefs(character.defaultLook);
    }
  }
  prefsApi.savePrefs(prefs);
  broadcastPrefs();
  refreshTrayMenu();
  return prefs;
}

function catalogPayload() {
  return {
    ...LOOKS.CATALOG,
    characters: LOOKS.CATALOG.characters.map((character) => ({ ...character })),
    builtinPresets: LOOKS.CATALOG.builtinPresets.map((preset) => ({ ...preset })),
  };
}

function dictationCapability() {
  return {
    available: false,
    reason:
      process.platform === 'darwin'
        ? 'Local dictation needs the signed on-device helper, which is not installed in this build. Typing still works.'
        : 'On-device dictation is unavailable on this platform; Buffy will not send audio to a cloud service. Typing still works.',
  };
}

function modePayload() {
  return { mode, scale: windowState.scale, dictation: dictationCapability() };
}

function broadcastPrefs() {
  if (!prefs) return;
  const payload = { prefs, ...modePayload() };
  for (const target of [win, settingsWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send('prefs', payload);
  }
}

function broadcastCatalog() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('catalog', catalogPayload());
}

function currentDisplay() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds());
  return screen.getPrimaryDisplay();
}

// The resting window has to fit the display, otherwise she hangs off the
// screen. The transient composer and activity panels are clamped to the work
// area instead, so a large size does not lock you out of them.
function scaleFitsDisplay(scale) {
  const area = currentDisplay().workArea;
  return ['full', 'compact'].every((name) => {
    const size = WINDOW_STATE.sizeFor(name, scale);
    return size.width <= area.width && size.height <= area.height;
  });
}

function defaultBounds(size = WINDOW_stateSize('full')) {
  return WINDOW_STATE.defaultPosition(screen.getPrimaryDisplay().workArea, size, EDGE_GAP);
}

function WINDOW_stateSize(name) {
  const size = WINDOW_STATE.sizeFor(name, windowState.scale);
  const area = currentDisplay().workArea;
  return {
    width: Math.min(size.width, area.width),
    height: Math.min(size.height, area.height),
  };
}

function savedPosition(name) {
  const saved = name === 'compact' ? windowState.compact : windowState.full;
  if (!saved) return null;
  const size = WINDOW_stateSize(name);
  const bounds = { ...saved, ...size };
  return WINDOW_STATE.visibleOn(bounds, screen.getAllDisplays()) ? saved : null;
}

function anchoredPosition(previous, size) {
  const area = previous ? screen.getDisplayMatching(previous).workArea : screen.getPrimaryDisplay().workArea;
  if (!previous) return WINDOW_STATE.defaultPosition(area, size, EDGE_GAP);
  return {
    x: Math.round(previous.x + previous.width - size.width),
    y: Math.round(previous.y + previous.height - size.height),
  };
}

function clampBounds(bounds) {
  const area = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  }).workArea;
  return WINDOW_STATE.clampToDisplay(bounds, area);
}

function savePosition(name = mode) {
  if (!win || win.isDestroyed()) return;
  try {
    const [x, y] = win.getPosition();
    if (name === 'compact') windowState.compact = { x, y };
    else windowState.full = { x, y };
    writeJson(WINDOW_FILE, {
      full: windowState.full,
      compact: windowState.compact,
      scale: windowState.scale,
    });
  } catch {
    /* position persistence is best effort */
  }
}

function setMode(next, { position = null, force = false } = {}) {
  const valid = ['full', 'compose', 'cards', 'compact'].includes(next) ? next : 'full';
  if (!win || win.isDestroyed()) {
    mode = valid;
    return modePayload();
  }
  if (valid === mode && !position && !force) {
    if (valid !== 'compact') composerOpen = valid === 'compose' || composerOpen;
    return modePayload();
  }
  const previousMode = mode;
  const previousBounds = win.getBounds();
  savePosition(previousMode === 'compact' ? 'compact' : 'full');
  mode = valid;
  const size = WINDOW_stateSize(valid);
  let nextPosition = position;
  if (!nextPosition) {
    if (valid === 'compact') {
      nextPosition = savedPosition('compact') || anchoredPosition(previousBounds, size);
    } else if (previousMode === 'compact') {
      nextPosition = savedPosition('full') || anchoredPosition(previousBounds, size);
    } else {
      nextPosition = anchoredPosition(previousBounds, size);
    }
  }
  const bounds = clampBounds({ ...nextPosition, ...size });
  win.setMinimumSize(size.width, size.height);
  win.setMaximumSize(size.width, size.height);
  win.setBounds(bounds, true);
  win.webContents.send('mode', modePayload());
  if (valid === 'compose' || valid === 'cards') {
    if (!win.isVisible()) win.show();
    win.focus();
  } else if (pendingRestoreFocus) {
    pendingRestoreFocus = false;
    win.blur();
  }
  return modePayload();
}

function applyDailyRotation() {
  if (!prefs || !rotationApi || !win) return;
  const characterId = prefs.companion.characterId;
  const plan = rotationApi.planRotation({
    prefs,
    catalog: LOOKS.CATALOG,
    characterId,
    now: Date.now(),
    resting: !snapshot || ['idle', 'done'].includes(snapshot.current?.state || 'idle'),
    busy: Boolean(drag) || handoffInFlight,
    composing: composerOpen || mode === 'compose',
    recording: false,
    settingsOpen: Boolean(settingsWindow && !settingsWindow.isDestroyed()),
    cardsOpen: mode === 'cards',
    isAvailable: () => true,
  });
  if (!plan.rotate) return;
  const character = ensureCharacterPrefs(characterId);
  prefs.characters[characterId] = rotationApi.rotationAfterApply(
    { ...character, look: LOOKS.normalizeLook(plan.look, characterId) },
    plan,
  );
  normalizeAndSavePrefs(prefs);
  win.webContents.send('toast', `Daily look: ${plan.name}.`);
}

function syncShortcut() {
  if (!prefs) return shortcutStatus;
  const accelerator = prefs.shortcuts.summon;
  const previous = shortcutStatus.accelerator;
  try {
    if (previous) globalShortcut.unregister(previous);
    const ok = globalShortcut.register(accelerator, summonCompanion);
    if (!ok) {
      if (previous) {
        try {
          globalShortcut.register(previous, summonCompanion);
        } catch {
          /* old shortcut could not be restored */
        }
      }
      shortcutStatus = {
        accelerator: previous || null,
        ok: false,
        error: `${accelerator} is already used by another app. Choose another shortcut.`,
      };
    } else {
      shortcutStatus = { accelerator, ok: true, error: null };
    }
  } catch (error) {
    shortcutStatus = { accelerator: previous || null, ok: false, error: error.message };
  }
  return shortcutStatus;
}

async function summonCompanion() {
  if (!win || win.isDestroyed()) createWindow();
  const wasVisible = win.isVisible();
  const size = WINDOW_stateSize('compose');
  const shouldPlace = !wasVisible;
  let position = null;
  if (shouldPlace) {
    position = WINDOW_STATE.placeNearCursor(screen.getCursorScreenPoint(), size, screen.getAllDisplays());
  }
  setMode('compose', { position });
  win.show();
  win.focus();
  composerOpen = true;
  await sleep(120);
  if (win && !win.isDestroyed()) win.webContents.send('summon');
}

async function postJson(pathname, body, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        timeout,
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

function getJson(pathname, timeout = 1200) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout }, (res) => {
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

async function ensureDaemon() {
  try {
    await getJson('/health', 400);
    return;
  } catch {
    /* no daemon is listening yet */
  }
  if (daemonStarting) return daemonStarting;
  daemonStarting = (async () => {
    try {
      const daemonRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : ROOT;
      const { startDaemon } = await import(pathToFileURL(path.join(daemonRoot, 'src', 'daemon.js')).href);
      const { readConfig } = await import(pathToFileURL(path.join(daemonRoot, 'src', 'config.js')).href);
      const base = readConfig();
      const watchEnabled = smokeTest ? false : prefs?.connection?.freebuffWatcher !== false;
      const daemonConfig = { ...base, watch: { ...base.watch, enabled: watchEnabled } };
      embeddedDaemon = await startDaemon({ port: PORT, quiet: true, config: daemonConfig });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') console.error(`buffy daemon: ${error.message}`);
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
  disconnectStream();
  connectStream();
  await poll();
  refreshTrayMenu();
  return { ok: true };
}

function showNotification(alert) {
  if (!Notification.isSupported()) return false;
  try {
    const notification = new Notification({
      title: alert.title,
      body: alert.body,
      silent: true,
    });
    notification.on('click', () => {
      if (!win || win.isDestroyed()) createWindow();
      setMode('cards');
      win.show();
      win.focus();
      win.webContents.send('open-panel', 'cards');
    });
    notification.show();
    return true;
  } catch {
    return false;
  }
}

function processAlerts(next) {
  if (!prefs) return;
  const result = ALERTS.ingest(next, {
    requests: prefs.alerts.requests,
    completions: prefs.alerts.completions,
    sounds: prefs.alerts.sounds,
    snoozeUntil: prefs.alerts.snoozeUntil,
  });
  if (result.startup) return;
  for (const alert of result.notifications) showNotification(alert);
  if (result.sounds && prefs.alerts.sounds) {
    try {
      shell.beep();
    } catch {
      /* sound is optional */
    }
  }
}

function handleSnapshot(next) {
  if (!next) return;
  snapshot = next;
  failures = 0;
  if (win && !win.isDestroyed()) win.webContents.send('state', next);
  processAlerts(next);
  applyDailyRotation();
  refreshTrayMenu();
}

function disconnectStream() {
  clearTimeout(streamTimer);
  streamTimer = null;
  if (streamResponse) {
    try {
      streamResponse.destroy();
    } catch {
      /* already closed */
    }
    streamResponse = null;
  }
  if (streamRequest) {
    try {
      streamRequest.destroy();
    } catch {
      /* already closed */
    }
    streamRequest = null;
  }
  streamConnected = false;
}

function scheduleStream(delay = 1200) {
  if (quitting) return;
  clearTimeout(streamTimer);
  streamTimer = setTimeout(connectStream, delay);
}

function connectStream() {
  if (quitting || !win || win.isDestroyed()) return;
  disconnectStream();
  streamRequest = http.get(
    { host: '127.0.0.1', port: PORT, path: '/events', timeout: 0, headers: { accept: 'text/event-stream' } },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        streamConnected = false;
        failures += 1;
        if (failures >= 3 && win && !win.isDestroyed()) win.webContents.send('offline');
        scheduleStream(1800);
        return;
      }
      streamResponse = res;
      streamConnected = true;
      failures = 0;
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            try {
              handleSnapshot(JSON.parse(line.slice(5).trim()));
            } catch {
              /* ignore a partial or malformed snapshot */
            }
          }
          split = buffer.indexOf('\n\n');
        }
      });
      res.on('end', () => {
        streamConnected = false;
        streamResponse = null;
        scheduleStream(1200);
      });
      res.on('error', () => {
        streamConnected = false;
        streamResponse = null;
        scheduleStream(1200);
      });
    },
  );
  streamRequest.on('error', () => {
    streamConnected = false;
    failures += 1;
    if (failures >= 3 && win && !win.isDestroyed()) win.webContents.send('offline');
    scheduleStream(1800);
  });
}

async function poll() {
  if (!win || win.isDestroyed() || streamConnected) return;
  try {
    handleSnapshot(await getJson('/state'));
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
  const size = WINDOW_stateSize('full');
  const saved = savedPosition('full');
  const bounds = clampBounds({ ...(saved || defaultBounds(size)), ...size });
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
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
    title: 'Buffy',
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
  win.setResizable(false);
  win.setMinimumSize(size.width, size.height);
  win.setMaximumSize(size.width, size.height);
  win.on('will-resize', (event) => event.preventDefault());
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    broadcastCatalog();
    if (prefs) win.webContents.send('prefs', { prefs, ...modePayload() });
    win.webContents.send('mode', modePayload());
    win.webContents.send('draft', DRAFT.snapshot());
    win.setIgnoreMouseEvents(true, { forward: true });
    connectStream();
    poll();
  });

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    if (dev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('show', () => {
    refreshTrayMenu();
    win.webContents.send('visibility', true);
  });
  win.on('hide', () => {
    refreshTrayMenu();
    win.webContents.send('visibility', false);
  });

  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePosition(), 400);
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
    disconnectStream();
  });

  pollTimer = setInterval(poll, 2200);
  cursorTimer = setInterval(sendCursor, 80);
  sendCursor();

  if (shotPath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (shotMode === 'settings') {
            await openSettings();
            await sleep(900);
            const targetWindow = settingsWindow;
            const image = await targetWindow.webContents.capturePage();
            const target = path.resolve(shotPath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, image.toPNG());
            console.log(`buffy settings screenshot: ${target}`);
          } else {
            if (shotMode === 'compose') {
              setMode('compose');
              win.webContents.send('summon');
              await sleep(500);
            }
            const image = await win.webContents.capturePage();
            const target = path.resolve(shotPath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, image.toPNG());
            console.log(`buffy overlay screenshot: ${target}`);
          }
        } catch (error) {
          console.error(`buffy overlay screenshot failed: ${error.message}`);
        }
        if (shotExit) app.quit();
      }, 2600);
    });
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else win.showInactive();
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
    width: 560,
    height: 700,
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

async function openSettings(section = 'companion') {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (section) settingsWindow.webContents.send('settings:section', section);
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: 900,
    minHeight: 640,
    center: true,
    show: false,
    title: 'Buffy settings',
    backgroundColor: '#fbf4ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
    }
  });
  settingsWindow.webContents.on('did-finish-load', () => {
    if (section && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:section', section);
    }
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  try {
    await settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  } catch (error) {
    dialog.showErrorBox('Could not open settings', error.message);
  }
  return settingsWindow;
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
  return dialog.showMessageBox({ type: 'info', title: 'Buffy updates', ...options });
}

function updateIsBusy() {
  return Boolean(composerOpen || DRAFT.text.trim() || handoffInFlight);
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
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info;
    refreshTrayMenu();
    if (prefs?.updates?.deferWhileBusy !== false && updateIsBusy()) {
      updateDeferred = true;
      if (win && !win.isDestroyed()) {
        win.webContents.send('update', { kind: 'deferred', version: info.version });
        win.webContents.send('toast', 'Update ready. It will wait until your draft is finished.');
      }
      return;
    }
    updateDeferred = false;
    promptInstall();
  });
  autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateMessage({ message: 'Buffy is up to date.', detail: `You are running ${app.getVersion()}.` });
  });
  autoUpdater.on('error', (error) => {
    const manual = manualUpdateCheck;
    manualUpdateCheck = false;
    console.error(`buffy updater: ${error.message}`);
    if (manual) {
      showUpdateMessage({ type: 'error', message: 'Could not check for updates.', detail: error.message });
    }
  });
  setTimeout(() => checkForUpdates(false), 20_000).unref?.();
}

async function promptInstall() {
  if (!autoUpdater || !updateReady || updatePromptOpen) return;
  if (updateIsBusy()) {
    updateDeferred = true;
    if (win && !win.isDestroyed()) win.webContents.send('toast', 'Finish or clear your draft before installing the update.');
    return;
  }
  updatePromptOpen = true;
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Buffy update ready',
    message: `Buffy ${updateReady.version} is ready to install.`,
    detail: 'Restart Buffy to finish the update. Your pet, looks, and preferences stay put.',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  updatePromptOpen = false;
  if (result.response === 0) installUpdateNow();
}

function installUpdateNow() {
  if (!autoUpdater || !updateReady) return { ok: false, error: 'No update is ready yet.' };
  if (updateIsBusy()) {
    updateDeferred = true;
    return { ok: false, error: 'Finish or clear your draft before installing.' };
  }
  autoUpdater.quitAndInstall();
  return { ok: true };
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged || !autoUpdater) {
    if (manual) {
      await showUpdateMessage({
        message: 'Updates are available in installed builds.',
        detail: 'Run Buffy from an installed release to receive updates.',
      });
    }
    return { ok: false, error: 'Updates are available in installed builds.' };
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    if (manual) {
      await showUpdateMessage({
        message: 'Updates are available in the AppImage build.',
        detail: 'Download the latest AppImage from the Buffy releases page.',
      });
    }
    return { ok: false, error: 'Use the latest AppImage.' };
  }
  manualUpdateCheck = Boolean(manual);
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    if (manual) {
      manualUpdateCheck = false;
      await showUpdateMessage({ type: 'error', message: 'Could not check for updates.', detail: error.message });
    }
    return { ok: false, error: error.message };
  }
}

async function connectionStatus() {
  if (!prefs) return { state: 'unknown', detail: 'Preferences are still loading.' };
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const launcher = path.join(HOME, 'bin', process.platform === 'win32' ? 'buffy-hook.cmd' : 'buffy-hook');
  const lastPath = path.join(HOME, 'hook-last.json');
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    return {
      state: error.code === 'ENOENT' ? 'not-installed' : 'error',
      detail: error.code === 'ENOENT' ? 'Claude Code settings were not found yet.' : `Could not read Claude Code settings: ${error.message}`,
      settingsPath,
      launcher,
      lastHookAt: null,
    };
  }
  if (data?.disableAllHooks === true) {
    return {
      state: 'disabled',
      detail: 'Claude Code has disableAllHooks enabled, so Buffy hooks will not run. Enable hooks in Claude Code first.',
      settingsPath,
      launcher,
      lastHookAt: null,
    };
  }
  const hooks = data?.hooks && typeof data.hooks === 'object' ? data.hooks : {};
  const installed = Object.values(hooks).some((entries) =>
    (Array.isArray(entries) ? entries : []).some((entry) =>
      (Array.isArray(entry?.hooks) ? entry.hooks : []).some(
        (hook) =>
          typeof hook?.command === 'string' &&
          (hook.command.includes('buffy-hook') || hook.command.replace(/\\/g, '/').includes('bin/buffy.js')),
      ),
    ),
  );
  const last = readJson(lastPath, null);
  const lastHookAt = last?.at && Number.isFinite(Date.parse(last.at)) ? last.at : null;
  if (!installed) {
    return {
      state: 'not-installed',
      detail: 'Connect Claude Code so Buffy can see prompts, tools, and permission requests.',
      settingsPath,
      launcher,
      lastHookAt,
    };
  }
  if (!fs.existsSync(launcher) && app.isPackaged) {
    return {
      state: 'repair',
      detail: 'Hooks are installed, but the stable launcher is missing. Repair the connection.',
      settingsPath,
      launcher,
      lastHookAt,
    };
  }
  if (!lastHookAt) {
    return {
      state: 'installed',
      detail: 'Hooks are installed. No Claude Code event has reached Buffy yet; start a Claude Code session.',
      settingsPath,
      launcher,
      lastHookAt,
    };
  }
  const ageMinutes = Math.round((Date.now() - Date.parse(lastHookAt)) / 60000);
  return {
    state: ageMinutes <= 30 ? 'connected' : 'installed',
    detail:
      ageMinutes <= 30
        ? `Claude Code reached Buffy ${ageMinutes <= 0 ? 'just now' : `${ageMinutes}m ago`}.`
        : 'Hooks are installed but no recent event was seen. Start a Claude Code session to test them.',
    settingsPath,
    launcher,
    lastHookAt,
  };
}

function applyPreferencesFromSettings(payload) {
  if (!prefsApi) return { ok: false, error: 'Preferences are still loading.' };
  if (!payload?.prefs) return { ok: false, error: 'No preferences were provided.' };
  const beforeShortcut = prefs?.shortcuts?.summon;
  normalizeAndSavePrefs(payload.prefs);
  if (prefs.shortcuts.summon !== beforeShortcut) syncShortcut();
  if (Array.isArray(payload.characterId)) {
    /* no-op for malformed callers */
  }
  return { ok: true, prefs, shortcut: shortcutStatus };
}

async function settingsAction(type, payload = {}) {
  if (!prefs || !prefsApi) return { ok: false, error: 'Preferences are still loading.' };
  const characterId =
    LOOKS.getCharacter(payload.characterId || prefs.companion.characterId).id;
  const character = ensureCharacterPrefs(characterId);
  const saveCharacter = (nextCharacter) => {
    prefs.characters[characterId] = nextCharacter;
    normalizeAndSavePrefs(prefs);
    return { ok: true, prefs, characterId, character: prefs.characters[characterId] };
  };

  try {
    switch (type) {
      case 'save': {
        const beforeWatcher = prefs.connection.freebuffWatcher;
        const result = applyPreferencesFromSettings({ prefs: payload.prefs });
        if (result.ok && beforeWatcher !== prefs.connection.freebuffWatcher) await restartDaemon();
        return result;
      }
      case 'look': {
        const look = LOOKS.normalizeLook(payload.look, characterId);
        const marked = rotationApi.markManualLook(character, Date.now());
        return saveCharacter({ ...marked, look });
      }
      case 'clothing': {
        return saveCharacter({
          ...character,
          clothing: { ...character.clothing, ...(payload.clothing || {}) },
        });
      }
      case 'random': {
        const look = LOOKS.randomLook(characterId, character);
        return saveCharacter({ ...rotationApi.markManualLook(character, Date.now()), look });
      }
      case 'save-look': {
        const result = LOOKS.saveLook(character, { name: payload.name, id: payload.id || randomUUID() });
        if (result.error) return { ok: false, error: result.error, prefs, characterId };
        return saveCharacter(result.character);
      }
      case 'rename-look': {
        const result = LOOKS.renameLook(character, String(payload.id || ''), payload.name);
        if (result.error) return { ok: false, error: result.error, prefs, characterId };
        return saveCharacter(result.character);
      }
      case 'replace-look': {
        const result = LOOKS.replaceLook(character, String(payload.id || ''));
        if (result.error) return { ok: false, error: result.error, prefs, characterId };
        return saveCharacter(result.character);
      }
      case 'delete-look': {
        const result = LOOKS.deleteLook(character, String(payload.id || ''));
        if (result.error) return { ok: false, error: result.error, prefs, characterId };
        return saveCharacter(result.character);
      }
      case 'favorite': {
        return saveCharacter(LOOKS.toggleFavorite(character, String(payload.id || '')));
      }
      case 'rotation-look': {
        const result = LOOKS.toggleRotationLook(character, String(payload.id || ''), payload.include !== false);
        if (result.error) return { ok: false, error: result.error, prefs, characterId };
        return saveCharacter(result.character);
      }
      case 'rotation': {
        return saveCharacter(rotationApi.setRotationEnabled(character, payload.enabled === true, Date.now()));
      }
      case 'character': {
        const next = LOOKS.getCharacter(payload.characterId || prefs.companion.characterId);
        prefs.companion.characterId = next.id;
        ensureCharacterPrefs(next.id);
        return applyPreferencesFromSettings({ prefs });
      }
      case 'companion': {
        if (typeof payload.name === 'string') prefs.companion.name = payload.name;
        if (typeof payload.pronouns === 'string') prefs.companion.pronouns = payload.pronouns;
        return applyPreferencesFromSettings({ prefs });
      }
      case 'scale': {
        const scale = Number(payload.scale);
        if (!WINDOW_STATE.SCALES.includes(scale)) return { ok: false, error: 'Unsupported scale.' };
        if (!scaleFitsDisplay(scale)) return { ok: false, error: 'That size is larger than this display. Choose a smaller size.' };
        savePosition(mode === 'compact' ? 'compact' : 'full');
        windowState.scale = scale;
        writeJson(WINDOW_FILE, {
          full: windowState.full,
          compact: windowState.compact,
          scale,
        });
        setMode(mode, { force: true });
        broadcastPrefs();
        refreshTrayMenu();
        return { ok: true, scale };
      }
      case 'shortcut': {
        const accelerator = String(payload.accelerator || '').trim();
        if (!accelerator) return { ok: false, error: 'Shortcut cannot be empty.', shortcut: shortcutStatus };
        const previous = prefs.shortcuts.summon;
        prefs.shortcuts.summon = accelerator;
        const status = syncShortcut();
        if (!status.ok) {
          prefs.shortcuts.summon = previous;
          syncShortcut();
          return { ok: false, error: status.error, shortcut: shortcutStatus };
        }
        prefsApi.savePrefs(prefs);
        broadcastPrefs();
        return { ok: true, shortcut: status, prefs };
      }
      case 'snooze': {
        prefsApi.setAlertsSnooze(prefs, Number(payload.durationMs) || 0, Date.now());
        prefsApi.savePrefs(prefs);
        broadcastPrefs();
        return { ok: true, prefs };
      }
      case 'connection': {
        connectionCache = null;
        if (payload.operation === 'install' || payload.operation === 'repair') {
          const result = installApi.installClaude({ global: true, env: process.env, packaged: app.isPackaged });
          connectionCache = await connectionStatus();
          return { ok: !result.skipped, skipped: result.skipped, notes: result.notes, result, connection: connectionCache };
        }
        if (payload.operation === 'uninstall') {
          const result = installApi.uninstallClaude({ global: true, env: process.env });
          connectionCache = await connectionStatus();
          return { ok: true, result, connection: connectionCache };
        }
        connectionCache = await connectionStatus();
        return { ok: true, connection: connectionCache };
      }
      case 'restart-daemon': {
        return { ok: true, ...(await restartDaemon()) };
      }
      case 'check-update': {
        return { ...(await checkForUpdates(true)), update: updateReady, deferred: updateDeferred };
      }
      case 'install-update': {
        return installUpdateNow();
      }
      default:
        return { ok: false, error: `Unknown settings action: ${type}` };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const SCALE_CHOICES = [
  { scale: 0.8, name: 'Small' },
  { scale: 1, name: 'Medium' },
  { scale: 1.25, name: 'Large' },
  { scale: 1.5, name: 'Extra large' },
  { scale: 1.75, name: 'Huge' },
];

function chooseScale(scale) {
  settingsAction('scale', { scale })
    .then((result) => {
      if (!result?.ok && win && !win.isDestroyed()) {
        win.webContents.send('toast', result?.error || 'That size could not be applied.');
      }
      refreshTrayMenu();
    })
    .catch((error) => dialog.showErrorBox('Could not change size', error.message));
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
      label: 'Compose for Claude…',
      accelerator: prefs?.shortcuts?.summon || undefined,
      click: () => summonCompanion().catch(() => {}),
    },
    {
      label: 'Activity',
      click: () => {
        showWindow();
        setMode('cards');
        if (win && !win.isDestroyed()) win.webContents.send('open-panel', 'cards');
      },
    },
    { type: 'separator' },
    {
      label: 'Move to corner',
      submenu: [
        { label: 'Top left', click: () => moveToCorner('top-left') },
        { label: 'Top right', click: () => moveToCorner('top-right') },
        { label: 'Bottom left', click: () => moveToCorner('bottom-left') },
        { label: 'Bottom right', click: () => moveToCorner('bottom-right') },
      ],
    },
    { label: 'Compact mode', type: 'checkbox', checked: mode === 'compact', click: () => setMode(mode === 'compact' ? 'full' : 'compact') },
    {
      label: 'Size',
      submenu: SCALE_CHOICES.map((choice) => {
        const percent = Math.round(choice.scale * 100);
        const fits = scaleFitsDisplay(choice.scale);
        return {
          label: fits ? `${choice.name} · ${percent}%` : `${choice.name} · ${percent}% (needs a taller display)`,
          type: 'radio',
          checked: windowState.scale === choice.scale,
          enabled: fits || windowState.scale === choice.scale,
          click: () => chooseScale(choice.scale),
        };
      }),
    },
    {
      label: 'Surprise me',
      click: () => {
        const characterId = prefs?.companion?.characterId || 'buffy';
        settingsAction('random', { characterId });
      },
    },
    {
      label: 'Wardrobe & settings…',
      click: () => openSettings('companion').catch((error) => dialog.showErrorBox('Could not open settings', error.message)),
    },
    { type: 'separator' },
    { label: 'Setup guide…', click: () => showOnboarding({ force: true }) },
    { label: 'Open Buffy folder', click: () => shell.openPath(HOME) },
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
      label: updateReady ? (updateDeferred ? 'Update ready (finish draft)…' : 'Restart to update…') : 'Check for updates…',
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

function moveToCorner(corner) {
  if (!win || win.isDestroyed()) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const size = WINDOW_stateSize(mode);
  const x = corner.endsWith('left') ? area.x + EDGE_GAP : area.x + area.width - size.width - EDGE_GAP;
  const y = corner.startsWith('top') ? area.y + EDGE_GAP : area.y + area.height - size.height - EDGE_GAP;
  win.setBounds({ x, y, ...size });
  savePosition();
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
      "({ stage: Boolean(document.querySelector('#stage')), pill: Boolean(document.querySelector('#pill')), composer: Boolean(document.querySelector('#composer')), cards: Boolean(document.querySelector('#cards')), api: Boolean(window.buffy), character: Boolean(window.BuffyCharacters), legacy: Boolean(window.BuffyCharacter), ready: document.readyState })",
    );
    if (!page.stage || !page.pill || !page.composer || !page.cards || !page.api || !page.character || page.ready !== 'complete') {
      throw new Error(`renderer check failed: ${JSON.stringify(page)}`);
    }
    const settings = await openSettings();
    await sleep(800);
    const settingsPage = await settings.webContents.executeJavaScript(
      "({ app: Boolean(document.querySelector('#settings-app')), nav: document.querySelectorAll('[data-section]').length, preview: Boolean(document.querySelector('#preview')), api: Boolean(window.buffySettings) })",
    );
    if (!settingsPage.app || settingsPage.nav < 6 || !settingsPage.preview || !settingsPage.api) {
      throw new Error(`settings renderer check failed: ${JSON.stringify(settingsPage)}`);
    }
    settings.close();
    console.log(`SMOKE_OK ${health.version} ${page.ready}`);
    app.exit(0);
  } catch (error) {
    console.error(`SMOKE_FAIL ${error.message}`);
    app.exit(1);
  }
}

/* ---------------- IPC ---------------- */

ipcMain.on('ui:ignore-mouse', (_event, ignore) => {
  if (!win || win.isDestroyed()) return;
  try {
    win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  } catch {
    /* older platforms may not support forwarding */
  }
});

ipcMain.handle('pet', async () => {
  try {
    const result = await postJson('/pet', {});
    return { ok: true, state: result.state };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('dismiss-session', async (_event, sessionId) => {
  if (!sessionId) return { ok: false, error: 'No session was specified.' };
  try {
    const result = await postJson('/session/dismiss', { sessionId: String(sessionId) });
    return { ok: true, removed: Boolean(result.removed), state: result.state };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('snapshot:get', () => snapshot);

ipcMain.handle('composer:get', () => DRAFT.snapshot());

ipcMain.handle('composer:update', (_event, text) => DRAFT.set(text));

ipcMain.handle('composer:handoff', async (_event, payload) => {
  if (handoffInFlight) return { ok: false, error: 'A handoff is already in progress.' };
  const current = DRAFT.snapshot();
  const text = typeof payload?.text === 'string' ? payload.text : current.text;
  const revision = Number.isFinite(payload?.revision) ? payload.revision : current.revision;
  if (revision !== current.revision) {
    return { ok: false, code: 'STALE', error: 'The draft changed. Review it and try again.' };
  }
  if (text !== current.text) DRAFT.set(text);
  const submitted = DRAFT.submit();
  if (!submitted.ok) return submitted;
  const link = buildClaudeCodeUrl(submitted.text);
  if (!link.ok) return link;
  handoffInFlight = true;
  try {
    await shell.openExternal(link.url);
  } catch (error) {
    handoffInFlight = false;
    return { ok: false, code: 'OPEN_FAILED', error: `Claude could not be opened: ${error.message}`, draft: DRAFT.snapshot() };
  }
  handoffInFlight = false;
  const settled = DRAFT.settle(submitted);
  if (win && !win.isDestroyed()) win.webContents.send('draft', settled.draft);
  if (settled.cleared) maybeResumeUpdate();
  return {
    ok: true,
    opened: true,
    cleared: settled.cleared,
    reason: settled.reason,
    revision: settled.draft.revision,
    draft: settled.draft,
  };
});

ipcMain.handle('composer:close', (_event, options) => {
  composerOpen = false;
  pendingRestoreFocus = options?.restoreFocus !== false;
  maybeResumeUpdate();
  return { ok: true };
});

ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.handle('ui:mode', (_event, next) => {
  const result = setMode(next);
  if (next === 'compose') composerOpen = true;
  if (next === 'compact') composerOpen = false;
  return result;
});

ipcMain.handle('ui:settings', async (_event, section) => {
  await openSettings(section || 'companion');
  return true;
});

ipcMain.handle('ui:open-claude', async () => {
  try {
    await shell.openExternal('claude://code/new');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('alerts:snooze', (_event, durationMs) => {
  prefsApi.setAlertsSnooze(prefs, Number(durationMs) || 0, Date.now());
  prefsApi.savePrefs(prefs);
  broadcastPrefs();
  return { ok: true, prefs };
});

ipcMain.on('drag-start', (_event, screenX, screenY) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  // Pin the size for the whole drag. Feeding getBounds() output back into
  // setBounds() makes a frameless window grow a pixel per call on Windows at
  // display scales above 100% (electron/electron#27651), and drag-move runs on
  // every pointer event.
  drag = { screenX, screenY, x, y, mode, size: WINDOW_stateSize(mode) };
});

ipcMain.on('drag-move', (_event, screenX, screenY) => {
  if (!win || !drag) return;
  const { size } = drag;
  const nextX = drag.x + (screenX - drag.screenX);
  const nextY = drag.y + (screenY - drag.screenY);
  const display = screen.getDisplayNearestPoint({
    x: nextX + Math.round(size.width / 2),
    y: nextY + Math.round(size.height / 2),
  });
  const area = display.workArea;
  const x = Math.min(Math.max(nextX, area.x - size.width + 70), area.x + area.width - 70);
  const y = Math.min(Math.max(nextY, area.y), area.y + area.height - 70);
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: size.width, height: size.height });
});

ipcMain.on('drag-end', () => {
  if (!win || win.isDestroyed()) return;
  drag = null;
  savePosition(mode === 'compact' ? 'compact' : 'full');
});

ipcMain.on('menu', () => {
  if (!win) return;
  Menu.buildFromTemplate(menuTemplate(false)).popup({ window: win });
});

ipcMain.handle('settings:get', async () => {
  if (connectionCache === null) connectionCache = await connectionStatus();
  return {
    prefs,
    catalog: catalogPayload(),
    version: app.getVersion(),
    mode,
    scale: windowState.scale,
    notificationsSupported: Notification.isSupported(),
    shortcut: shortcutStatus,
    connection: connectionCache,
    dictation: dictationCapability(),
    health: await getJson('/health', 500).catch(() => null),
    watch: snapshot?.watch || null,
    update: {
      ready: updateReady,
      deferred: updateDeferred,
      version: updateReady?.version || null,
      packaged: app.isPackaged,
    },
  };
});

ipcMain.handle('settings:action', async (_event, payload) => {
  const type = payload?.type;
  const result = await settingsAction(type, payload || {});
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:state', {
      prefs,
      shortcut: shortcutStatus,
      connection: connectionCache,
      update: { ready: updateReady, deferred: updateDeferred, version: updateReady?.version || null },
    });
  }
  return result;
});

ipcMain.handle('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  return true;
});

ipcMain.handle('settings:open-external', (_event, url) => {
  const target = String(url || '');
  if (!/^https?:/i.test(target)) return false;
  return shell.openExternal(target).then(() => true).catch(() => false);
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

function maybeResumeUpdate() {
  if (!updateReady || !updateDeferred) return;
  if (updateIsBusy()) return;
  updateDeferred = false;
  refreshTrayMenu();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update', { kind: 'ready', version: updateReady.version });
    win.webContents.send('toast', 'Update ready. Use Settings → Updates or the tray to restart when convenient.');
  }
}

/* ---------------- app lifecycle ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    if (argv.includes('--onboarding')) showOnboarding({ force: true });
  });
  app.on('activate', () => showWindow());
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.slayyyyer.buffy');
    try {
      await loadSupportModules();
    } catch (error) {
      console.error(`buffy preferences: ${error.message}`);
      dialog.showErrorBox('Buffy could not start', error.message);
      app.exit(1);
      return;
    }
    syncShortcut();
    await ensureDaemon().catch((error) => console.error(`buffy daemon: ${error.message}`));
    createWindow();
    if (smokeTest) {
      await runSmokeTest();
      return;
    }
    createTray();
    initUpdater();
    applyDailyRotation();
    setInterval(applyDailyRotation, 60_000).unref?.();
    if (settingsShotPath) {
      try {
        await sleep(600);
        const settings = await openSettings('companion');
        await sleep(1100);
        const target = path.resolve(settingsShotPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, (await settings.webContents.capturePage()).toPNG());
        console.log(`buffy settings screenshot: ${target}`);
      } catch (error) {
        console.error(`buffy settings screenshot failed: ${error.message}`);
        if (settingsShotExit) app.exit(1);
      }
      if (settingsShotExit) app.quit();
      return;
    }
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
    clearTimeout(streamTimer);
    clearTimeout(saveTimer);
    globalShortcut.unregisterAll();
    savePosition();
    disconnectStream();
    if (embeddedDaemon) {
      event.preventDefault();
      const daemon = embeddedDaemon;
      embeddedDaemon = null;
      daemon.close().catch(() => {}).finally(() => app.quit());
    }
  });
}
