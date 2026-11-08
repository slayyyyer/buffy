import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-sessions-'));
const env = { ...process.env, BUFFY_HOME: home };
delete env.BUFFY_PORT;

const baseConfig = readConfig(env);
const config = {
  ...baseConfig,
  port: 0,
  doneHoldMs: 5_000,
  sessionTtlMs: 60_000,
  watch: { ...baseConfig.watch, enabled: false },
};
const daemon = await startDaemon({ config, env, quiet: true });
const base = `http://127.0.0.1:${daemon.port}`;

async function get(pathname) {
  const res = await fetch(base + pathname);
  return { status: res.status, body: await res.json() };
}

async function postTo(pathname, body, session) {
  const headers = { 'content-type': 'application/json' };
  if (session) headers['x-buffy-session'] = session;
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function post(body, session) {
  return postTo('/event', body, session);
}

test.after(async () => {
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('celebrate is a separate explicit signal with its own snapshot window', async () => {
  const before = (await get('/state')).body;
  const result = await postTo('/celebrate', { message: 'build passed' });
  assert.equal(result.status, 200);
  assert.equal(result.body.state.celebration.message, 'build passed');
  assert.ok(result.body.state.xp >= before.xp + 4);
});

test('a needs-you session survives another session working and finishing', async () => {
  await post({ state: 'working', source: 'claude', sessionId: 'claude:a', message: 'editing' });
  await post({ state: 'needs-you', source: 'claude', sessionId: 'claude:b', message: 'approve?' });

  let snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.sessionId, 'claude:b');
  assert.equal(snapshot.sessions.length, 2);

  await post({ state: 'working', source: 'claude', sessionId: 'claude:a', message: 'still editing' });
  snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.message, 'approve?');

  await post({ state: 'done', source: 'claude', sessionId: 'claude:b' });
  snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.sessionId, 'claude:a');
  assert.equal(snapshot.current.message, 'still editing');

  await post({ state: 'done', source: 'claude', sessionId: 'claude:a' });
  snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.state, 'done');
});

test('the session header assigns an independent session', async () => {
  const result = await post({ state: 'working', source: 'claude', message: 'from a header' }, 'header:one');
  assert.equal(result.status, 200);

  const snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.sessionId, 'header:one');
  assert.ok(snapshot.sessions.some((session) => session.id === 'header:one' && session.state === 'working'));
});

test('dismiss clears one session and leaves the others active', async () => {
  await post({ state: 'needs-you', source: 'claude', sessionId: 'dismiss:a', message: 'approve?' });
  await post({ state: 'working', source: 'freebuff', sessionId: 'dismiss:b', message: 'editing' });

  const result = await postTo('/session/dismiss', { sessionId: 'dismiss:a' });
  assert.equal(result.status, 200);
  assert.equal(result.body.removed, true);

  const snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.sessionId, 'dismiss:b');
  assert.equal(snapshot.current.state, 'working');
  assert.ok(snapshot.sessions.every((session) => session.id !== 'dismiss:a'));
});

test('a session carries the project folder for its activity card', async () => {
  await post({
    state: 'needs-you',
    source: 'claude',
    sessionId: 'cwd:one',
    message: 'approve?',
    cwd: 'C:/work/app',
    request: { id: 'perm-cwd', kind: 'permission', label: 'approve?', toolName: 'Bash' },
  });

  const snapshot = (await get('/state')).body;
  assert.equal(snapshot.current.sessionId, 'cwd:one');
  const session = snapshot.sessions.find((entry) => entry.id === 'cwd:one');
  assert.equal(session.cwd, 'C:/work/app');
  assert.equal(snapshot.pendingRequestsList[0].cwd, 'C:/work/app');
});
