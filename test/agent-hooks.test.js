import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-agent-hooks-'));
const env = {
  ...process.env,
  BUFFY_HOME: home,
  BUFFY_FREEBUFF_HOME: `${home}/no-freebuff`,
  CLAUDE_CONFIG_DIR: `${home}/no-claude`,
};
delete env.BUFFY_PORT;

const baseConfig = readConfig(env);
const config = { ...baseConfig, port: 0, watch: { ...baseConfig.watch, enabled: false } };
const daemon = await startDaemon({ config, env, quiet: true });
fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify({ port: daemon.port }, null, 2)}\n`);

function runHook(agent, event, payload, input = JSON.stringify(payload)) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'hook', agent, event], { env, cwd: ROOT });
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

async function dismissAll() {
  const snapshot = await state();
  for (const session of snapshot.sessions || []) {
    await fetch(`http://127.0.0.1:${daemon.port}/session/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });
  }
}

test.after(async () => {
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('Gemini hooks return valid empty JSON and drive thinking, working, and done', async () => {
  await dismissAll();
  const start = await runHook('gemini', 'SessionStart', {
    hook_event_name: 'SessionStart',
    session_id: 'g1',
    cwd: 'C:/work/app',
  });
  assert.equal(start.status, 0, start.stderr);
  assert.equal(start.stdout.trim(), '{}');

  const prompt = await runHook('gemini', 'BeforeAgent', {
    hook_event_name: 'BeforeAgent',
    session_id: 'g1',
  });
  assert.equal(prompt.stdout.trim(), '{}');
  let snapshot = await state();
  assert.equal(snapshot.current.state, 'thinking');
  assert.equal(snapshot.current.source, 'gemini');
  assert.equal(snapshot.current.sessionId, 'gemini:g1');

  const tool = await runHook('gemini', 'BeforeTool', {
    hook_event_name: 'BeforeTool',
    session_id: 'g1',
    cwd: 'C:/work/app',
    tool_name: 'run_shell_command',
  });
  assert.equal(tool.stdout.trim(), '{}');
  snapshot = await state();
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.category, 'running');
  assert.equal(
    snapshot.sessions.find((session) => session.id === 'gemini:g1')?.cwd,
    'C:/work/app',
  );

  const done = await runHook('gemini', 'AfterAgent', {
    hook_event_name: 'AfterAgent',
    session_id: 'g1',
  });
  assert.equal(done.stdout.trim(), '{}');
  assert.equal((await state()).current.state, 'done');
});

test('Gemini tool permission alerts stay pending until the tool actually runs', async () => {
  await dismissAll();
  const permission = await runHook('gemini', 'Notification', {
    hook_event_name: 'Notification',
    session_id: 'g2',
    notification_type: 'ToolPermission',
    message: 'Allow Gemini to run npm test?',
    details: { tool_name: 'run_shell_command' },
  });
  assert.equal(permission.status, 0, permission.stderr);
  assert.equal(permission.stdout.trim(), '{}');
  let snapshot = await state();
  assert.equal(snapshot.current.state, 'needs-you');
  assert.equal(snapshot.current.sessionId, 'gemini:g2');
  assert.equal(snapshot.pendingRequests, 1);

  const finished = await runHook('gemini', 'AfterTool', {
    hook_event_name: 'AfterTool',
    session_id: 'g2',
    tool_name: 'run_shell_command',
    tool_response: { llmContent: 'ok' },
  });
  assert.equal(finished.stdout.trim(), '{}');
  snapshot = await state();
  assert.equal(snapshot.pendingRequests, 0);
  assert.equal(snapshot.current.state, 'working');

  await runHook('gemini', 'SessionEnd', { session_id: 'g2', reason: 'exit' });
});

test('Cursor hooks use JSON responses and track prompts, tools, and completion', async () => {
  await dismissAll();
  const start = await runHook('cursor', 'sessionStart', {
    hook_event_name: 'sessionStart',
    conversation_id: 'c1',
    session_id: 'c1',
    workspace_roots: ['/work/app'],
  });
  assert.equal(start.status, 0, start.stderr);
  assert.equal(start.stdout.trim(), '{}');

  const prompt = await runHook('cursor', 'beforeSubmitPrompt', {
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: 'c1',
    workspace_roots: ['/work/app'],
    prompt: 'fix the tests',
  });
  assert.equal(prompt.stdout.trim(), '{"continue":true}');
  let snapshot = await state();
  assert.equal(snapshot.current.state, 'thinking');
  assert.equal(snapshot.current.source, 'cursor');
  assert.equal(snapshot.current.sessionId, 'cursor:c1');

  const tool = await runHook('cursor', 'postToolUse', {
    hook_event_name: 'postToolUse',
    conversation_id: 'c1',
    tool_name: 'Shell',
    tool_use_id: 'tool-1',
  });
  assert.equal(tool.stdout.trim(), '{}');
  snapshot = await state();
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.category, 'running');

  const done = await runHook('cursor', 'stop', {
    hook_event_name: 'stop',
    conversation_id: 'c1',
    status: 'completed',
  });
  assert.equal(done.stdout.trim(), '{}');
  assert.equal((await state()).current.state, 'done');
});

test('Cursor failures are explicit errors and malformed input stays successful', async () => {
  await dismissAll();
  const failed = await runHook('cursor', 'postToolUseFailure', {
    hook_event_name: 'postToolUseFailure',
    conversation_id: 'c2',
    tool_name: 'Shell',
    error_message: 'Command timed out after 30s',
  });
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(failed.stdout.trim(), '{}');
  let snapshot = await state();
  assert.equal(snapshot.current.state, 'error');
  assert.equal(snapshot.current.message, 'Command timed out after 30s');

  const malformed = await runHook('gemini', 'BeforeAgent', {}, '{not json');
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout.trim(), '{}');

  await runHook('cursor', 'sessionEnd', { conversation_id: 'c2', reason: 'completed' });
  snapshot = await state();
  assert.equal(snapshot.current.state, 'idle');
});
