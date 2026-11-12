/**
 * End-to-end check for source precedence, in the real desktop app.
 *
 * Starts Buffy with a temporary home whose `config.json` switches the Freebuff
 * database off while its preferences say on, then asserts:
 *   1. the app's own daemon reports the adapter disabled in `/health`,
 *   2. the Connection panel renders that switch locked and unchecked,
 *   3. the other source is untouched,
 *   4. flipping the watcher shows the restart toast and really restarts the
 *      daemon, which comes back with the watcher off and config.json still
 *      honoured,
 *   5. the locked Freebuff switch ignores clicks and raises no toast,
 *   6. flipping the Claude transcript switch toasts and restarts as well, and
 *      the daemon still serves state with every switch where it was left.
 *
 * Run with `node scripts/verify-config-precedence.js`. It opens a window
 * briefly and needs a desktop session, so it is not part of `node --test`.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ELECTRON = {
  win32: ['node_modules/electron/dist/electron.exe'],
  darwin: ['node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'],
  linux: ['node_modules/electron/dist/electron'],
}[process.platform] || [];

function electronBinary() {
  const found = ELECTRON.map((item) => path.join(ROOT, item)).find((item) => fs.existsSync(item));
  if (!found) throw new Error(`no electron binary found for ${process.platform}; run npm install`);
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function assert(label, condition, detail) {
  if (condition) {
    console.log(`ok     ${label}`);
    return;
  }
  console.error(`FAILED ${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
  process.exitCode = 1;
}

function evaluate(socket, expression, id) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    };
    socket.addEventListener('message', onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    setTimeout(() => reject(new Error('cdp evaluate timed out')), 10_000);
  });
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('cdp socket failed')));
  });
  return socket;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-precedence-home-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-precedence-profile-'));
const port = await freePort();
let cdp = await freePort();
// Two sequential probes can hand back the same ephemeral port.
for (let attempt = 0; cdp === port && attempt < 10; attempt += 1) cdp = await freePort();

fs.writeFileSync(
  path.join(home, 'config.json'),
  `${JSON.stringify({ freebuff: { enabled: false } }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(home, 'preferences.json'),
  `${JSON.stringify(
    { version: 3, connection: { freebuffWatcher: true, freebuffDatabase: true, claudeTranscript: true } },
    null,
    2,
  )}\n`,
);

const child = spawn(
  electronBinary(),
  [
    '.',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${cdp}`,
    '--remote-allow-origins=*',
  ],
  {
    cwd: ROOT,
    env: { ...process.env, BUFFY_HOME: home, BUFFY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let appLog = '';
child.stderr.on('data', (chunk) => {
  appLog += String(chunk);
});
child.stdout.on('data', (chunk) => {
  appLog += String(chunk);
});

try {
  const health = await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      return res.ok ? res.json() : null;
    },
    30_000,
    'the app daemon',
  );

  assert('config.json off beats preferences on', health.adapters?.freebuff?.enabled === false, health.adapters?.freebuff);
  assert('a disabled source says why', health.adapters?.freebuff?.reason === 'disabled', health.adapters?.freebuff);
  assert(
    'a source config.json leaves alone stays on',
    health.adapters?.claudeTranscript?.enabled === true,
    health.adapters?.claudeTranscript,
  );

  let targets = [];
  const findTarget = (match, label) =>
    waitFor(
      async () => {
        const res = await fetch(`http://127.0.0.1:${cdp}/json/list`);
        targets = await res.json();
        return targets.find((item) => String(item.url).includes(match)) || null;
      },
      25_000,
      label,
    ).catch((error) => {
      console.error(`     targets: ${targets.map((item) => item.url).join(', ') || 'none'}`);
      throw error;
    });

  async function openConnectionPanel(attempt) {
    const overlay = await findTarget('overlay/index.html', 'the overlay window');
    const overlaySocket = await connect(overlay);
    const opened = await evaluate(overlaySocket, "window.buffy.openSettings('connection')", 10 + attempt);
    if (opened !== true) console.log(`     openSettings returned ${JSON.stringify(opened)}`);
    overlaySocket.close();
  }

  // A window that fails to register its debugging target is retried rather
  // than failing the whole run; the second attempt always opens.
  let settings = null;
  for (let attempt = 0; attempt < 3 && !settings; attempt += 1) {
    await openConnectionPanel(attempt);
    settings = await findTarget('settings.html', 8_000, 'the settings window').catch(() => null);
  }
  if (!settings) throw new Error('the settings window did not open');

  const settingsSocket = await connect(settings);
  const panel = await evaluate(
    settingsSocket,
    `new Promise((resolve) => {
      const nav = document.querySelector('[data-section="connection"]');
      if (nav) nav.click();
      setTimeout(() => {
        const input = document.querySelector('#freebuff-database');
        const transcript = document.querySelector('#claude-transcript');
        resolve({
          found: Boolean(input),
          checked: input ? input.checked : null,
          disabled: input ? input.disabled : null,
          transcriptChecked: transcript ? transcript.checked : null,
          transcriptDisabled: transcript ? transcript.disabled : null,
          note: [...document.querySelectorAll('.card')].some((card) =>
            card.textContent.includes('config.json') && card.textContent.includes('Local session evidence'),
          ),
        });
      }, 500);
    })`,
    2,
  );

  assert('the Connection panel rendered the switch', panel?.found === true, panel);
  assert('the switch is locked', panel?.disabled === true, panel);
  assert('the locked switch shows off', panel?.checked === false, panel);
  assert('the lock explains itself', panel?.note === true, panel);
  assert('the other source stays switchable', panel?.transcriptDisabled === false, panel);
  assert('the other source keeps its on value', panel?.transcriptChecked === true, panel);

  const healthBefore = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert('the watcher starts on', healthBefore.watch?.enabled === true, healthBefore.watch);
  // The daemon is embedded in the app, so its pid is the Electron process and
  // never changes. `startedAt` is what a restart actually moves.
  const startedBefore = (await (await fetch(`http://127.0.0.1:${port}/state`)).json()).startedAt;

  const flipped = await evaluate(
    settingsSocket,
    `new Promise((resolve) => {
      const input = document.querySelector('#watcher');
      if (!input) return resolve({ missing: true });
      input.click();
      setTimeout(() => {
        const toast = document.querySelector('#settings-toast');
        resolve({
          checked: input.checked,
          toast: (toast?.textContent || '').trim(),
          toastVisible: Boolean(toast) && !toast.classList.contains('hidden'),
        });
      }, 400);
    })`,
    3,
  );

  assert('the watcher switch flips', flipped?.checked === false, flipped);
  assert('the toast names the source and the restart', flipped?.toast === 'Repository watcher disabled.', flipped);
  assert('the toast is visible', flipped?.toastVisible === true, flipped);

  const restarted = await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/state`);
      if (!res.ok) return null;
      const next = await res.json();
      return next.startedAt !== startedBefore ? next : null;
    },
    20_000,
    'the daemon restart',
  ).catch((error) => {
    console.log(`     (${error.message})`);
    return null;
  });

  assert('the daemon really restarted', Boolean(restarted), { startedBefore });
  if (restarted) {
    const healthAfter = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert('the restart applies the watcher switch', healthAfter.watch?.enabled === false, healthAfter.watch);
    assert(
      'the restart still honours config.json',
      healthAfter.adapters?.freebuff?.enabled === false,
      healthAfter.adapters?.freebuff,
    );
  }

  // The Freebuff switch is locked by config.json, so a click must change nothing.
  const lockedAttempt = await evaluate(
    settingsSocket,
    `new Promise((resolve) => {
      const input = document.querySelector('#freebuff-database');
      const toast = document.querySelector('#settings-toast');
      const before = (toast?.textContent || '').trim();
      if (input) input.click();
      setTimeout(() => {
        resolve({
          found: Boolean(input),
          disabled: input ? input.disabled : null,
          checked: input ? input.checked : null,
          toastBefore: before,
          toastAfter: (toast?.textContent || '').trim(),
        });
      }, 350);
    })`,
    4,
  );

  assert('the locked source is still there', lockedAttempt?.found === true, lockedAttempt);
  assert('clicking the locked source leaves it off', lockedAttempt?.checked === false, lockedAttempt);
  assert('the locked source stays disabled', lockedAttempt?.disabled === true, lockedAttempt);
  assert('a locked source raises no toast', lockedAttempt?.toastAfter === lockedAttempt?.toastBefore, lockedAttempt);

  const startedBeforeTranscript = (await (await fetch(`http://127.0.0.1:${port}/state`)).json()).startedAt;

  const transcriptFlip = await evaluate(
    settingsSocket,
    `new Promise((resolve) => {
      const input = document.querySelector('#claude-transcript');
      if (!input) return resolve({ missing: true });
      input.click();
      setTimeout(() => {
        const toast = document.querySelector('#settings-toast');
        resolve({
          checked: input.checked,
          toast: (toast?.textContent || '').trim(),
          toastVisible: Boolean(toast) && !toast.classList.contains('hidden'),
        });
      }, 400);
    })`,
    5,
  );
  settingsSocket.close();

  assert('the transcript switch flips', transcriptFlip?.checked === false, transcriptFlip);
  assert(
    'the transcript toast names the source and the restart',
    transcriptFlip?.toast === 'Claude transcript fallback disabled.',
    transcriptFlip,
  );
  assert('the transcript toast is visible', transcriptFlip?.toastVisible === true, transcriptFlip);

  const restartedAgain = await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/state`);
      if (!res.ok) return null;
      const next = await res.json();
      return next.startedAt !== startedBeforeTranscript ? next : null;
    },
    20_000,
    'the second daemon restart',
  ).catch((error) => {
    console.log(`     (${error.message})`);
    return null;
  });

  assert('the second switch restarts the daemon', Boolean(restartedAgain), { startedBeforeTranscript });
  if (restartedAgain) {
    const healthFinal = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert(
      'the transcript switch applied',
      healthFinal.adapters?.claudeTranscript?.enabled === false,
      healthFinal.adapters?.claudeTranscript,
    );
    assert(
      'config.json still wins after both restarts',
      healthFinal.adapters?.freebuff?.enabled === false && healthFinal.adapters?.freebuff?.reason === 'disabled',
      healthFinal.adapters?.freebuff,
    );
    assert('the watcher switch survived both restarts', healthFinal.watch?.enabled === false, healthFinal.watch);
    assert('the daemon is still healthy', healthFinal.ok === true, healthFinal);

    const finalState = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
    assert(
      'the daemon still serves state',
      typeof finalState.current?.state === 'string' && Array.isArray(finalState.sessions),
      finalState.current,
    );
  }
} catch (error) {
  console.error(`FAILED ${error.message}`);
  process.exitCode = 1;
  if (appLog) console.error(appLog.split('\n').slice(-8).join('\n'));
} finally {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await sleep(400);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(process.exitCode ? 'config precedence: FAILED' : 'config precedence: OK');
}
