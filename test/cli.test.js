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

test('buffy pet prints a reaction', async () => {
  const pet = await run(['pet']);
  assert.equal(pet.status, 0, pet.stderr);
  assert.match(pet.stdout, /seems pleased/);

  const snapshot = JSON.parse((await run(['status', '--json'])).stdout);
  assert.equal(snapshot.reaction.kind, 'pet');
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
  assert.equal(snapshot.pet.name, 'Offline Momo');
  fs.rmSync(offlineHome, { recursive: true, force: true });
});
