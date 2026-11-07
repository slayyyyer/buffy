import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAUDE_HOOKS, installClaude, uninstallClaude } from '../src/install.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isOurs(entry) {
  return (entry.hooks || []).some((hook) => {
    const command = String(hook.command);
    return command.includes('bin/buffy.js') || command.includes('buffy-hook');
  });
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

test('install merges hooks, preserves user settings and is idempotent', () => {
  const project = tempDir('buffy-install-');
  const home = tempDir('buffy-install-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;

  const settingsFile = path.join(project, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        statusLine: { type: 'command', command: 'echo existing' },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing-hook' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'echo existing-stop' }] }],
        },
      },
      null,
      2,
    )}\n`,
  );

  try {
    const result = installClaude({ cwd: project, env, now: NOW });
    assert.equal(result.scope, 'project');
    assert.equal(result.backups.length, 1);

    const settings = readJson(settingsFile);
    assert.deepEqual(settings.statusLine, { type: 'command', command: 'echo existing' });
    assert.equal(settings.hooks.PreToolUse.length, 2);
    assert.equal(settings.hooks.Stop.length, 2);
    assert.ok(settings.hooks.PreToolUse.some((entry) => entry.hooks[0].command === 'echo existing-hook'));

    for (const { event } of CLAUDE_HOOKS) {
      assert.equal(settings.hooks[event].filter(isOurs).length, 1, `${event} should have exactly one buffy hook`);
    }
    assert.equal(settings.hooks.Notification[0].matcher, 'permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog');
    assert.equal(settings.hooks.Stop.find(isOurs).hooks[0].timeout, 10);

    const commandFile = path.join(project, '.claude', 'commands', 'buffy.md');
    assert.ok(fs.existsSync(commandFile));
    assert.match(fs.readFileSync(commandFile, 'utf8'), /buffy-managed/);
    assert.match(fs.readFileSync(commandFile, 'utf8'), /hatch/);

    const backups = fs.readdirSync(path.dirname(settingsFile)).filter((name) => name.includes('.buffy-backup-'));
    assert.equal(backups.length, 1);
    const manifest = readJson(path.join(home, 'installs.json'));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].scope, 'project');

    installClaude({ cwd: project, env, now: NOW });
    const second = readJson(settingsFile);
    assert.equal(second.hooks.PreToolUse.length, 2);
    assert.equal(second.hooks.Stop.length, 2);
    const backupsAfter = fs.readdirSync(path.dirname(settingsFile)).filter((name) => name.includes('.buffy-backup-'));
    assert.equal(backupsAfter.length, 1, 'a no-op install must not create another backup');

    const removed = uninstallClaude({ cwd: project, env });
    assert.equal(removed.removedHooks, CLAUDE_HOOKS.length);
    assert.equal(removed.removedCommand, true);

    const after = readJson(settingsFile);
    assert.deepEqual(after.statusLine, { type: 'command', command: 'echo existing' });
    assert.equal(after.hooks.PreToolUse.length, 1);
    assert.equal(after.hooks.Stop.length, 1);
    assert.equal(after.hooks.UserPromptSubmit, undefined);
    assert.equal(after.hooks.Notification, undefined);
    assert.equal(fs.existsSync(commandFile), false);
    assert.deepEqual(readJson(path.join(home, 'installs.json')), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install respects Claude Code disableAllHooks and leaves settings untouched', () => {
  const project = tempDir('buffy-disabled-');
  const home = tempDir('buffy-disabled-home-');
  const settingsFile = path.join(project, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify({ disableAllHooks: true, hooks: { Stop: [] } }, null, 2)}\n`);

  try {
    const result = installClaude({ cwd: project, env: { ...process.env, BUFFY_HOME: home } });
    assert.equal(result.skipped, true);
    assert.match(result.notes[0], /disableAllHooks/);
    assert.equal(readJson(settingsFile).disableAllHooks, true);
    assert.equal(fs.readdirSync(path.dirname(settingsFile)).filter((name) => name.includes('.buffy-backup-')).length, 0);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('packaged installs use a stable launcher and uninstall only Buffy hooks', () => {
  const project = tempDir('buffy-packaged-');
  const home = tempDir('buffy-packaged-home-');
  const env = { ...process.env, BUFFY_HOME: home };

  try {
    const result = installClaude({ cwd: project, env, packaged: true, now: NOW });
    assert.ok(result.launcher, 'stable launcher path is returned');
    assert.ok(fs.existsSync(result.launcher), 'stable launcher exists');
    assert.match(fs.readFileSync(result.launcher, 'utf8'), /hook claude/);
    const settings = readJson(path.join(project, '.claude', 'settings.json'));
    assert.match(settings.hooks.Stop.find(isOurs).hooks[0].command, /buffy-hook/);

    assert.ok(result.commandLauncher, 'packaged command launcher path is returned');
    assert.ok(fs.existsSync(result.commandLauncher), 'packaged command launcher exists');
    const launcherText = fs.readFileSync(result.commandLauncher, 'utf8');
    assert.match(launcherText, /ELECTRON_RUN_AS_NODE=1/);
    assert.doesNotMatch(launcherText, /hook claude/);
    const commandMarkdown = fs.readFileSync(path.join(project, '.claude', 'commands', 'buffy.md'), 'utf8');
    assert.ok(
      commandMarkdown.replace(/\\/g, '/').includes(result.commandLauncher.replace(/\\/g, '/')),
      '/buffy command points at the stable CLI launcher',
    );

    const removed = uninstallClaude({ cwd: project, env });
    assert.equal(removed.removedHooks, CLAUDE_HOOKS.length);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install refuses to overwrite invalid JSON', () => {
  const project = tempDir('buffy-invalid-');
  const home = tempDir('buffy-invalid-home-');
  const settingsFile = path.join(project, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, '{not json');

  try {
    assert.throws(() => installClaude({ cwd: project, env: { ...process.env, BUFFY_HOME: home } }), /not a valid JSON/);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{not json');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buffy install claude works through the CLI', async () => {
  const project = tempDir('buffy-cli-install-');
  const home = tempDir('buffy-cli-install-home-');
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;

  try {
    const result = await runCli(['install', 'claude'], project, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installed for Claude Code/);
    assert.ok(fs.existsSync(path.join(project, '.claude', 'settings.json')));
    assert.ok(fs.existsSync(path.join(project, '.claude', 'commands', 'buffy.md')));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
