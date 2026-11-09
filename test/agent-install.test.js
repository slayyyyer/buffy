import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURSOR_HOOKS,
  GEMINI_HOOKS,
  hasBuffyHooks,
  installCursor,
  installGemini,
  uninstallCursor,
  uninstallGemini,
} from '../src/install.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isGeminiBuffy(entry) {
  return (entry.hooks || []).some(
    (hook) => hook.name === 'buffy' && String(hook.command).includes('hook gemini'),
  );
}

function isCursorBuffy(entry) {
  return String(entry.command || '').includes('hook cursor');
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

test('install gemini preserves settings and hook groups, is idempotent, and uninstalls cleanly', () => {
  const project = tempDir('buffy-gemini-');
  const home = tempDir('buffy-gemini-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;
  const settingsFile = path.join(project, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        theme: 'dark',
        hooksConfig: { enabled: true, notifications: false },
        hooks: {
          BeforeTool: [
            {
              matcher: 'write_file',
              hooks: [{ type: 'command', command: 'echo existing-hook' }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  try {
    const result = installGemini({ cwd: project, env, now: NOW });
    assert.equal(result.scope, 'project');
    assert.equal(result.backups.length, 1);
    assert.equal(result.skipped, false);

    const data = readJson(settingsFile);
    assert.equal(data.theme, 'dark');
    assert.equal(data.hooksConfig.notifications, false);
    assert.equal(data.hooks.BeforeTool.length, 2);
    assert.equal(data.hooks.BeforeTool[0].hooks[0].command, 'echo existing-hook');

    for (const { event } of GEMINI_HOOKS) {
      const ours = data.hooks[event].filter(isGeminiBuffy);
      assert.equal(ours.length, 1, `${event} should have one Buffy group`);
      assert.equal(ours[0].hooks[0].timeout, 10_000);
      assert.match(ours[0].hooks[0].command, /hook gemini/);
    }
    assert.equal(hasBuffyHooks('gemini', data, env), true);

    const again = installGemini({ cwd: project, env, now: NOW });
    assert.equal(again.backups.length, 0, 'a no-op install must not create another backup');
    assert.equal(readJson(settingsFile).hooks.BeforeTool.length, 2);

    const removed = uninstallGemini({ cwd: project, env });
    assert.equal(removed.removedHooks, GEMINI_HOOKS.length);
    const after = readJson(settingsFile);
    assert.equal(after.theme, 'dark');
    assert.equal(after.hooks.BeforeTool.length, 1);
    assert.equal(after.hooks.BeforeTool[0].hooks[0].command, 'echo existing-hook');
    assert.equal(after.hooks.SessionStart, undefined);
    assert.equal(hasBuffyHooks('gemini', after, env), false);
    assert.deepEqual(readJson(path.join(home, 'installs.json')), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('gemini install leaves disabled hooks untouched', () => {
  const project = tempDir('buffy-gemini-disabled-');
  const home = tempDir('buffy-gemini-disabled-home-');
  const settingsFile = path.join(project, '.gemini', 'settings.json');
  const original = `${JSON.stringify({ hooksConfig: { enabled: false }, hooks: { BeforeTool: [] } }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, original);

  try {
    const result = installGemini({ cwd: project, env: { ...process.env, BUFFY_HOME: home } });
    assert.equal(result.skipped, true);
    assert.match(result.notes[0], /disabled/);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
    assert.equal(
      fs.readdirSync(path.dirname(settingsFile)).filter((name) => name.includes('.buffy-backup-')).length,
      0,
    );
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install cursor preserves hooks.json, avoids permission hooks, and uninstalls cleanly', () => {
  const project = tempDir('buffy-cursor-');
  const home = tempDir('buffy-cursor-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;
  const settingsFile = path.join(project, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        version: 1,
        theme: 'keep-me',
        hooks: { postToolUse: [{ command: 'echo existing-hook' }] },
      },
      null,
      2,
    )}\n`,
  );

  try {
    const result = installCursor({ cwd: project, env, now: NOW });
    assert.equal(result.scope, 'project');
    assert.equal(result.backups.length, 1);

    const data = readJson(settingsFile);
    assert.equal(data.version, 1);
    assert.equal(data.theme, 'keep-me');
    assert.equal(data.hooks.postToolUse.length, 2);
    assert.equal(data.hooks.postToolUse[0].command, 'echo existing-hook');
    assert.equal(data.hooks.preToolUse, undefined, 'Buffy must not install a permission hook');

    for (const { event } of CURSOR_HOOKS) {
      const ours = data.hooks[event].filter(isCursorBuffy);
      assert.equal(ours.length, 1, `${event} should have one Buffy hook`);
      assert.equal(ours[0].timeout, 10);
      assert.match(ours[0].command, /hook cursor/);
    }
    assert.equal(hasBuffyHooks('cursor', data, env), true);

    const again = installCursor({ cwd: project, env, now: NOW });
    assert.equal(again.backups.length, 0);
    assert.equal(readJson(settingsFile).hooks.postToolUse.length, 2);

    const removed = uninstallCursor({ cwd: project, env });
    assert.equal(removed.removedHooks, CURSOR_HOOKS.length);
    const after = readJson(settingsFile);
    assert.equal(after.version, 1);
    assert.equal(after.theme, 'keep-me');
    assert.equal(after.hooks.postToolUse.length, 1);
    assert.equal(after.hooks.sessionStart, undefined);
    assert.equal(hasBuffyHooks('cursor', after, env), false);
    assert.deepEqual(readJson(path.join(home, 'installs.json')), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('packaged gemini and cursor installs create agent-specific stable launchers', () => {
  const project = tempDir('buffy-agent-launchers-');
  const home = tempDir('buffy-agent-launchers-home-');
  const env = { ...process.env, BUFFY_HOME: home };

  try {
    const gemini = installGemini({ cwd: project, env, packaged: true, now: NOW });
    assert.ok(gemini.launcher);
    assert.match(gemini.launcher, /buffy-hook-gemini/);
    assert.match(fs.readFileSync(gemini.launcher, 'utf8'), /hook gemini/);

    const cursor = installCursor({ cwd: project, env, packaged: true, now: NOW });
    assert.ok(cursor.launcher);
    assert.match(cursor.launcher, /buffy-hook-cursor/);
    assert.match(fs.readFileSync(cursor.launcher, 'utf8'), /hook cursor/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buffy install and uninstall work for gemini and cursor through the CLI', async () => {
  const project = tempDir('buffy-agent-cli-');
  const home = tempDir('buffy-agent-cli-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;

  try {
    const gemini = await runCli(['install', 'gemini'], project, env);
    assert.equal(gemini.status, 0, gemini.stderr);
    assert.match(gemini.stdout, /installed for Gemini CLI/);
    assert.ok(fs.existsSync(path.join(project, '.gemini', 'settings.json')));

    const cursor = await runCli(['install', 'cursor'], project, env);
    assert.equal(cursor.status, 0, cursor.stderr);
    assert.match(cursor.stdout, /installed for Cursor/);
    assert.ok(fs.existsSync(path.join(project, '.cursor', 'hooks.json')));

    const removed = await runCli(['uninstall', 'cursor'], project, env);
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /removed from Cursor/);
    assert.equal(hasBuffyHooks('cursor', readJson(path.join(project, '.cursor', 'hooks.json')), env), false);

    const bad = await runCli(['install', 'codex'], project, env);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /gemini/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
