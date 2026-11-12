import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { createState, saveState } from '../src/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-cli-'));
const env = { ...process.env, BUFFY_HOME: home };
delete env.BUFFY_PORT;

const baseConfig = readConfig(env);
const config = { ...baseConfig, port: 0, watch: { ...baseConfig.watch, enabled: false } };
const daemon = await startDaemon({ config, env, quiet: true });
fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify({ port: daemon.port }, null, 2)}\n`);

function run(args, runEnv = env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: runEnv, cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test.after(async () => {
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('buffy event drives the daemon quietly', async () => {
  const event = await run(['event', 'working', '--msg', 'editing src/app.ts', '--source', 'claude']);
  assert.equal(event.status, 0, event.stderr);
  assert.equal(event.stdout, '');
});

test('buffy status --json reflects the event', async () => {
  const status = await run(['status', '--json']);
  assert.equal(status.status, 0, status.stderr);

  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.source, 'claude');
  assert.equal(snapshot.current.message, 'editing src/app.ts');
  assert.equal(snapshot.daemonPort, daemon.port);
});

test('buffy hello prints a reaction', async () => {
  const hello = await run(['hello']);
  assert.equal(hello.status, 0, hello.stderr);
  assert.match(hello.stdout, /seems pleased/);

  const snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.equal(snapshot.reaction.kind, 'hello');
});

test('buffy celebrate records an explicit pass', async () => {
  const celebrate = await run(['celebrate', 'tests passed']);
  assert.equal(celebrate.status, 0, celebrate.stderr);
  assert.match(celebrate.stdout, /celebrates: tests passed/);

  const snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.equal(snapshot.celebration.message, 'tests passed');
});

test('unknown states exit with code 2', async () => {
  const bad = await run(['event', 'dancing']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown state/);
});

test('status falls back to persisted state when the daemon is down', async () => {
  const offlineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-offline-'));
  const offlineEnv = { ...process.env, BUFFY_HOME: offlineHome };
  delete offlineEnv.BUFFY_PORT;

  saveState(createState({ name: 'Offline Momo' }), offlineEnv);
  fs.writeFileSync(path.join(offlineHome, 'config.json'), `${JSON.stringify({ port: 1 }, null, 2)}\n`);

  const result = await run(['status', '--json'], offlineEnv);
  assert.equal(result.status, 0, result.stderr);

  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.online, false);
  assert.equal(snapshot.companion.name, 'Offline Momo');
  fs.rmSync(offlineHome, { recursive: true, force: true });
});

test('event --session isolates concurrent CLI sessions', async () => {
  const needs = await run([
    'event',
    'needs-you',
    '--source',
    'claude',
    '--session',
    'cli-a',
    '--msg',
    'approve?',
  ]);
  assert.equal(needs.status, 0, needs.stderr);

  const working = await run(['event', 'working', '--source', 'claude', '--session', 'cli-b', '--msg', 'still working']);
  assert.equal(working.status, 0, working.stderr);

  let snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.sessionId, 'cli-a');
  assert.ok(snapshot.sessions.some((session) => session.id === 'cli-b'));

  const done = await run(['event', 'done', '--source', 'claude', '--session', 'cli-a']);
  assert.equal(done.status, 0, done.stderr);

  snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.sessionId, 'cli-b');
});

test('buffy dismiss clears one concurrent CLI session', async () => {
  const working = await run(['event', 'working', '--source', 'freebuff', '--session', 'dismiss-a']);
  assert.equal(working.status, 0, working.stderr);
  const needs = await run(['event', 'needs-you', '--source', 'claude', '--session', 'dismiss-b', '--msg', 'approve?']);
  assert.equal(needs.status, 0, needs.stderr);

  const dismissed = await run(['dismiss', 'dismiss-b']);
  assert.equal(dismissed.status, 0, dismissed.stderr);
  assert.match(dismissed.stdout, /Dismissed dismiss-b/);

  const snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.ok(snapshot.sessions.every((session) => session.id !== 'dismiss-b'));
  assert.equal(snapshot.current.sessionId, 'dismiss-a');
});
