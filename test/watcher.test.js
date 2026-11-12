import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { isIgnored } from '../src/watcher.js';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-watch-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-watch-home-'));
const env = { ...process.env, BUFFY_HOME: home };
delete env.BUFFY_PORT;

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
if (hasGit) {
  execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'buffy@example.test'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'buffy test'], { cwd: project });
  fs.writeFileSync(path.join(project, '.gitignore'), 'ignored.txt\nnode_modules/\n');
  fs.writeFileSync(path.join(project, 'base.txt'), 'base\n');
  fs.writeFileSync(path.join(project, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', '.gitignore', 'base.txt'], { cwd: project });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: project, stdio: 'ignore' });
}

const baseConfig = readConfig(env);
const config = {
  ...baseConfig,
  port: 0,
  doneHoldMs: 1200,
  watch: {
    ...baseConfig.watch,
    enabled: true,
    directory: project,
    quietMs: 500,
    pollMs: 100,
    ignore: [...baseConfig.watch.ignore, 'ignored.txt'],
  },
};
const daemon = await startDaemon({ config, env, quiet: true });
const base = `http://127.0.0.1:${daemon.port}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getState() {
  const response = await fetch(`${base}/state`);
  return response.json();
}

async function post(body) {
  const response = await fetch(`${base}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  let state = null;
  while (Date.now() < deadline) {
    state = await getState();
    if (predicate(state)) return state;
    await sleep(50);
  }
  throw new Error(`timed out; last state: ${JSON.stringify(state?.current)}`);
}

test.after(async () => {
  await daemon.close();
  // Windows can hold watcher handles briefly after close; retry the cleanup.
  await fs.promises.rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('ignore patterns match path segments and globs', () => {
  assert.equal(isIgnored('node_modules/pkg/index.js', ['node_modules']), true);
  assert.equal(isIgnored('src/app.ts', ['node_modules']), false);
  assert.equal(isIgnored('.claude/settings.json.buffy-backup-1', ['*.buffy-backup-*']), true);
  assert.equal(isIgnored('src/app.ts', []), false);
});

test('the daemon starts idle with the watcher enabled', async () => {
  const state = await getState();
  assert.equal(state.current.state, 'idle');
  assert.equal(state.watch.enabled, true);
  assert.equal(state.watch.directory, project);
  assert.equal(state.watch.git, hasGit);
});

test('file churn sets working, quiet sets done, then idle', async () => {
  fs.writeFileSync(path.join(project, 'src.txt'), 'one\n');

  const working = await waitFor((state) => state.current.state === 'working');
  assert.equal(working.current.source, 'watcher');
  assert.equal(working.current.sessionId, 'watcher');
  assert.match(working.current.message, /src\.txt|watching/);

  const done = await waitFor((state) => state.current.state === 'done');
  assert.equal(done.current.source, 'watcher');
  assert.equal(done.current.message, 'activity settled');
  assert.equal(done.current.category, 'settled-inferred');
  assert.equal(done.current.observed, 'inferred');

  const idle = await waitFor((state) => state.current.state === 'idle');
  assert.equal(idle.current.state, 'idle');
});

test('ignored paths do not disturb Buffy', async () => {
  await post({ state: 'idle', source: 'test' });
  await waitFor((state) => state.current.state === 'idle');

  fs.writeFileSync(path.join(project, 'ignored.txt'), 'noise\n');
  fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(project, 'node_modules', 'pkg', 'index.js'), 'noise\n');
  await sleep(800);

  assert.equal((await getState()).current.state, 'idle');
});

test('needs-you is not cleared by file churn', async () => {
  await post({ state: 'needs-you', message: 'approve?', source: 'freebuff' });
  fs.writeFileSync(path.join(project, 'src.txt'), 'two\n');
  await sleep(900);

  const state = await getState();
  assert.equal(state.current.state, 'needs-you');
  assert.equal(state.current.message, 'approve?');
  assert.equal(state.current.sessionId, 'freebuff');
});

test('git index changes are picked up by the poll', { skip: !hasGit }, async () => {
  await post({ state: 'idle', source: 'test' });
  await post({ state: 'idle', source: 'freebuff' });
  await sleep(250);

  execFileSync('git', ['add', 'staged.txt'], { cwd: project });
  const working = await waitFor((state) => state.current.state === 'working');
  assert.equal(working.current.source, 'watcher');
});
