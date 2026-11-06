import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { freebuffInstructions, installFreebuff, uninstallFreebuff } from '../src/install.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env });
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

test('install freebuff preserves AGENTS.md, backs it up and is idempotent', () => {
  const project = tempDir('buffy-freebuff-');
  const home = tempDir('buffy-freebuff-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;
  const file = path.join(project, 'AGENTS.md');
  const original = '# House rules\n\nBe kind.\n';
  fs.writeFileSync(file, original);

  try {
    const result = installFreebuff({ cwd: project, env, now: NOW });
    assert.equal(result.scope, 'project');
    assert.equal(result.backups.length, 1);
    assert.equal(fs.readFileSync(result.backups[0], 'utf8'), original);

    let text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^# House rules/);
    assert.match(text, /<!-- buffy:start -->/);
    assert.match(text, /<!-- buffy:end -->/);
    assert.match(text, /event thinking --source freebuff/);
    assert.match(text, /event working --source freebuff/);
    assert.match(text, /event needs-you --source freebuff/);
    assert.match(text, /event done --source freebuff/);
    assert.match(text, /End every turn with exactly one/);
    assert.equal((text.match(/<!-- buffy:start -->/g) || []).length, 1);

    const manifest = JSON.parse(fs.readFileSync(path.join(home, 'installs.json'), 'utf8'));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].kind, 'freebuff');
    assert.equal(manifest[0].scope, 'project');

    const again = installFreebuff({ cwd: project, env, now: NOW });
    assert.equal(again.backups.length, 0, 'a no-op install must not create another backup');
    text = fs.readFileSync(file, 'utf8');
    assert.equal((text.match(/<!-- buffy:start -->/g) || []).length, 1);

    const removed = uninstallFreebuff({ cwd: project, env });
    assert.equal(removed.removed, true);
    assert.equal(removed.removedFile, false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'installs.json'), 'utf8')), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('freebuff instructions require every checkpoint and name the watcher fallback', () => {
  const text = freebuffInstructions();
  assert.match(text, /required at the checkpoints/);
  assert.match(text, /As your first action/);
  assert.match(text, /Before each file edit or project-changing tool call/);
  assert.match(text, /Before you stop because you need the user's approval or input/);
  assert.match(text, /Before you stop after completing the task/);
  assert.match(text, /End every turn with exactly one of `needs-you` or `done`/);
  assert.match(text, /repo watcher detects file edits/);
});

test('uninstall deletes an AGENTS.md that only held the block', () => {
  const project = tempDir('buffy-freebuff-only-');
  const home = tempDir('buffy-freebuff-only-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  const file = path.join(project, 'AGENTS.md');

  try {
    const result = installFreebuff({ cwd: project, env, now: NOW });
    assert.equal(result.backups.length, 0);
    assert.ok(fs.existsSync(file));

    const removed = uninstallFreebuff({ cwd: project, env });
    assert.equal(removed.removed, true);
    assert.equal(removed.removedFile, true);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buffy install/uninstall freebuff works through the CLI', async () => {
  const project = tempDir('buffy-freebuff-cli-');
  const home = tempDir('buffy-freebuff-cli-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;
  const file = path.join(project, 'AGENTS.md');

  try {
    const install = await runCli(['install', 'freebuff'], project, env);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /installed for Freebuff/);
    assert.match(install.stdout, /best-effort/);
    assert.match(fs.readFileSync(file, 'utf8'), /<!-- buffy:start -->/);

    const global = await runCli(['install', 'freebuff', '--global'], project, env);
    assert.equal(global.status, 2);
    assert.match(global.stderr, /not supported/);

    const uninstall = await runCli(['uninstall', 'freebuff'], project, env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
