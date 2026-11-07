import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { mapClaudeHook } from '../src/hook.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-hook-'));
const env = { ...process.env, BUFFY_HOME: home };
delete env.BUFFY_PORT;

const baseConfig = readConfig(env);
const config = { ...baseConfig, port: 0, watch: { ...baseConfig.watch, enabled: false } };
const daemon = await startDaemon({ config, env, quiet: true });
fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify({ port: daemon.port }, null, 2)}\n`);

function runHook(event, payload, input = JSON.stringify(payload)) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'hook', 'claude', event], { env, cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function state() {
  const response = await fetch(`http://127.0.0.1:${daemon.port}/state`);
  return response.json();
}

test.after(async () => {
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('maps the Claude Code hook vocabulary onto six states', () => {
  const prompt = mapClaudeHook('UserPromptSubmit', {});
  assert.equal(prompt.state, 'thinking');
  assert.equal(prompt.message, 'thinking about your prompt');
  assert.equal(prompt.source, 'claude');
  assert.equal(prompt.category, 'thinking');
  assert.equal(prompt.observed, 'explicit');

  assert.equal(mapClaudeHook('PreToolUse', { tool_name: 'Edit' }).state, 'working');
  assert.equal(mapClaudeHook('PreToolUse', { tool_name: 'Edit' }).message, 'using Edit');
  assert.equal(mapClaudeHook('PreToolUse', { tool_name: 'Read' }).category, 'reading');
  assert.equal(mapClaudeHook('PostToolUse', { tool_name: 'Bash' }).message, 'Bash finished');
  assert.equal(mapClaudeHook('PostToolUseFailure', { tool_name: 'Bash', error: 'tests failed' }).state, 'error');
  assert.equal(mapClaudeHook('PreCompact', {}).state, 'working');
  assert.equal(mapClaudeHook('PreCompact', {}).category, 'compacting');
  assert.equal(mapClaudeHook('SessionEnd', {}).resolveAllRequests, true);

  const permission = mapClaudeHook('PermissionRequest', { tool_name: 'Bash', permission_request_id: 'r1' });
  assert.equal(permission.state, 'needs-you');
  assert.equal(permission.request.kind, 'permission');
  assert.equal(permission.request.id, 'r1');
  assert.equal(permission.category, 'permission');

  const idle = mapClaudeHook('Notification', { notification_type: 'idle_prompt', message: 'still there' });
  assert.equal(idle.state, 'idle');
  assert.equal(idle.informational, true);
  assert.equal(idle.category, 'idle-reminder');

  assert.equal(mapClaudeHook('Notification', { message: 'Allow Bash?' }).state, 'needs-you');
  assert.equal(mapClaudeHook('Notification', { message: 'Allow Bash?' }).message, 'Allow Bash?');
  assert.equal(mapClaudeHook('Stop', {}).state, 'done');
  assert.equal(mapClaudeHook('SomethingElse', {}), null);
  assert.equal(mapClaudeHook(undefined, { hook_event_name: 'Stop' }).state, 'done');
});

test('UserPromptSubmit moves the pet to thinking', async () => {
  const result = await runHook('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');

  const snapshot = await state();
  assert.equal(snapshot.current.state, 'thinking');
  assert.equal(snapshot.current.source, 'claude');
});

test('Notification moves the pet to needs-you with the message', async () => {
  const result = await runHook('Notification', {
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'Claude needs permission to run npm test',
  });
  assert.equal(result.status, 0, result.stderr);

  const snapshot = await state();
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.message, 'Claude needs permission to run npm test');
});

test('Stop moves the pet to done', async () => {
  const result = await runHook('Stop', { hook_event_name: 'Stop' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await state()).current.state, 'done');
});

test('unknown events and malformed input stay silent and successful', async () => {
  const unknown = await runHook('SomethingElse', { hook_event_name: 'SomethingElse' });
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.equal(unknown.stdout, '');

  const malformed = await runHook('Stop', {}, '{not json');
  assert.equal(malformed.status, 0, malformed.stderr);
  assert.equal(malformed.stdout, '');
});

test('Claude session ids keep concurrent conversations isolated', async () => {
  const needs = await runHook('Notification', {
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'approve deployment',
    session_id: 'session-a',
  });
  assert.equal(needs.status, 0, needs.stderr);

  const done = await runHook('Stop', {
    hook_event_name: 'Stop',
    session_id: 'session-b',
  });
  assert.equal(done.status, 0, done.stderr);

  const snapshot = await state();
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.sessionId, 'claude:session-a');
  assert.ok(snapshot.sessions.some((session) => session.id === 'claude:session-b'));
});
