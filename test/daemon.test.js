import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-daemon-'));
const env = {
  ...process.env,
  BUFFY_HOME: home,
  BUFFY_FREEBUFF_HOME: `${home}/no-freebuff`,
  CLAUDE_CONFIG_DIR: `${home}/no-claude`,
};
delete env.BUFFY_PORT;

const baseConfig = readConfig(env);
const config = { ...baseConfig, port: 0, doneHoldMs: 180, watch: { ...baseConfig.watch, enabled: false } };
const daemon = await startDaemon({ config, env, quiet: true });
const base = `http://127.0.0.1:${daemon.port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(pathname) {
  const res = await fetch(base + pathname);
  return { status: res.status, body: await res.json() };
}

async function post(pathname, body) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.after(async () => {
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('health and initial state', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, 'buffy');

  const state = await get('/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.online, true);
  assert.equal(state.body.current.state, 'idle');
  assert.deepEqual(state.body.sessions, []);
  assert.equal(state.body.watch.enabled, false);
  assert.ok(state.body.companion.name);
  assert.equal(state.body.companion.sprite.type, 'placeholder');
  assert.equal('pet' in state.body, false);
});

test('events drive the machine with source and message', async () => {
  const before = (await get('/state')).body;
  const result = await post('/event', { state: 'thinking', message: 'reading the repo', source: 'claude' });
  assert.equal(result.status, 200);

  const state = (await get('/state')).body;
  assert.equal(state.current.state, 'thinking');
  assert.equal(state.current.source, 'claude');
  assert.equal(state.current.message, 'reading the repo');
  assert.ok(state.xp > before.xp);
});

test('done returns to idle', async () => {
  await post('/event', { state: 'done', source: 'claude' });
  assert.equal((await get('/state')).body.current.state, 'done');

  await sleep(500);
  const state = (await get('/state')).body;
  assert.equal(state.current.state, 'idle');
});

test('needs-you sticks until another event', async () => {
  await post('/event', { state: 'needs-you', message: 'need a decision', source: 'freebuff' });
  await sleep(400);

  const state = (await get('/state')).body;
  assert.equal(state.current.state, 'needs-you');
  assert.equal(state.current.message, 'need a decision');
});

test('saying hello raises mood and xp', async () => {
  const before = (await get('/state')).body;
  const result = await post('/hello', {});
  assert.equal(result.status, 200);

  const after = result.body.state;
  assert.equal(after.reaction.kind, 'hello');
  assert.ok(after.mood >= before.mood);
  assert.ok(after.xp > before.xp);
});

test('unknown states are rejected', async () => {
  const result = await post('/event', { state: 'dancing' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /unknown state/);
});
