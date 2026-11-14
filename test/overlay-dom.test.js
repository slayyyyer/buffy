import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

import { defaultCharacterPrefs, defaultPrefs, normalizePrefs } from '../src/prefs.js';

const require = createRequire(import.meta.url);
const catalog = require('../overlay/catalog.cjs');
const source = (name) => fs.readFileSync(new URL(`../overlay/${name}`, import.meta.url), 'utf8');
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * These tests boot the real overlay and settings documents in jsdom with the
 * same scripts the pages load. They are smoke tests: the point is that the
 * wiring survives a boot — no dead selectors, no handlers for buttons that no
 * longer exist, no pane that throws on a normal payload.
 */
function stubCanvas(window) {
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
        if (property === 'measureText') return () => ({ width: 0 });
        if (property === 'canvas') return null;
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
  window.HTMLCanvasElement.prototype.getContext = () => context;
}

function boot(documentName, prepare) {
  const dom = new JSDOM(source(documentName), {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  stubCanvas(dom.window);
  if (prepare) prepare(dom.window);
  return dom;
}

function run(window, ...scripts) {
  for (const script of scripts) window.eval(source(script));
}

/**
 * Poll for the document to reach a shape instead of sleeping for a guessed
 * duration: a cold jsdom boot on a loaded CI runner takes longer than this
 * machine does, and a fixed sleep would fail as if the wiring were broken.
 */
async function waitFor(check, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('the overlay boots with the toolbar it actually wires', async () => {
  const handlers = new Map();
  const listen = (name) => (fn) => {
    handlers.set(name, fn);
    return () => handlers.delete(name);
  };
  const dom = boot('index.html', (window) => {
    window.buffy = {
      getSnapshot: async () => null,
      requestMode: async () => ({ mode: 'full', scale: 1 }),
      getComposer: async () => ({ draft: '', project: null }),
      hello: async () => ({}),
      copy: async () => {},
      handoff: async () => ({}),
      decidePermission: async () => ({ ok: false }),
      dismissSession: async () => ({ ok: true }),
      focusSession: async () => ({ ok: true }),
      snooze: async () => ({ ok: true }),
      closeComposer: async () => ({ ok: true }),
      openClaude: async () => {},
      openSettings: async () => {},
      setIgnoreMouse: () => {},
      menu: () => {},
      dragStart: () => {},
      dragMove: () => {},
      dragEnd: () => {},
      onState: listen('state'),
      onPrefs: listen('prefs'),
      onCatalog: listen('catalog'),
      onMode: listen('mode'),
      onToast: listen('toast'),
      onUpdate: listen('update'),
      onChime: listen('chime'),
      onCursor: listen('cursor'),
      onDraft: listen('draft'),
      onOffline: listen('offline'),
      onOpenPanel: listen('open-panel'),
      onSummon: listen('summon'),
      onVisibility: listen('visibility'),
    };
  });

  try {
    run(dom.window, 'character.js', 'characters/manifest.js', 'hobbies.js', 'pose-smoother.js', 'character-system.js', 'renderer.js');
    const { document } = dom.window;
    await waitFor(() => document.querySelector('#toolbar [data-action]'), 'the overlay toolbar');

    const actions = [...document.querySelectorAll('#toolbar [data-action]')].map((button) => button.dataset.action);
    assert.deepEqual(actions, ['compose', 'activity', 'hello', 'compact', 'settings']);
    assert.equal(document.querySelector('[data-action="dictate"]'), null, 'the removed dictation button must not come back');
    assert.equal(document.querySelector('[aria-label="Start dictation"]'), null);

    assert.ok(handlers.has('state'), 'renderer subscribes to state');
    handlers.get('state')({
      current: { state: 'working', message: 'using read_files', source: 'freebuff-db', since: Date.now(), seq: 1 },
      sessions: [],
      pendingRequests: 0,
      reaction: null,
      companion: null,
      xp: 0,
      level: 1,
      mood: 70,
    });
    await waitFor(() => document.getElementById('app').dataset.state === 'working', "the overlay's working state");
    // The pill composes the state and category; the message itself is what the
    // compact pill and the activity card show.
    assert.match(document.getElementById('pill-state').textContent, /Working/);
    assert.equal(document.getElementById('app').dataset.state, 'working');
  } finally {
    dom.window.close();
  }
});

test('the settings window boots every pane, including the trimmed Connection one', async () => {
  const prefs = normalizePrefs(defaultPrefs(), { now: Date.now() });
  for (const character of catalog.CATALOG.characters) {
    if (!prefs.characters[character.id]) prefs.characters[character.id] = defaultCharacterPrefs(character.defaultLook);
  }
  const payload = {
    version,
    scale: 1,
    prefs,
    catalog: catalog.CATALOG,
    connections: {},
    connection: {},
    health: { ok: true, port: 4517, version, adapters: {}, pendingRequests: 0 },
    watch: { enabled: true, directory: 'C:/code/demo', quietMs: 2000 },
    update: { packaged: true, ready: false, version: null, deferred: false },
    shortcut: { accelerator: 'CommandOrControl+Shift+B', ok: true },
    sources: {},
    notificationsSupported: true,
  };

  const dom = boot('settings.html', (window) => {
    window.buffySettings = {
      get: async () => payload,
      action: async () => ({ ok: true }),
      close: async () => {},
      openExternal: async () => {},
      onSection: () => () => {},
      onState: () => () => {},
    };
  });

  try {
    run(dom.window, 'character.js', 'characters/manifest.js', 'character-system.js', 'settings.js');
    const { document } = dom.window;
    await waitFor(() => document.querySelector('[data-section]'), 'the settings sections');

    const sections = [...document.querySelectorAll('[data-section]')].map((button) => button.dataset.section);
    assert.deepEqual(sections, ['companion', 'personality', 'shortcuts', 'alerts', 'connection', 'updates']);

    const panel = document.getElementById('panel');
    document.querySelector('[data-section="personality"]').click();
    await waitFor(() => /Stay out of screenshots/.test(panel.innerHTML), 'the Personality pane');
    assert.match(panel.innerHTML, /data-privacy="hideFromCapture"/, 'capture exclusion is switchable');

    document.querySelector('[data-section="connection"]').click();
    await waitFor(() => /Local session evidence/.test(panel.innerHTML), 'the Connection pane');
    const connection = panel.innerHTML;
    assert.match(connection, /Local session evidence/);
    assert.match(connection, /Freebuff/);
    assert.match(connection, /Send a test event/, 'each agent can be verified end to end');
    assert.doesNotMatch(connection, /Dictation/, 'the removed dictation card must not come back');
    assert.doesNotMatch(connection, /cloud turn/i, 'the removed cloud-turn state must not come back');

    document.querySelector('[data-section="updates"]').click();
    await waitFor(() => /Restart and install/.test(panel.innerHTML), 'the Updates pane');
    assert.match(panel.innerHTML, /Restart and install/);
  } finally {
    dom.window.close();
  }
});
