import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { defaultPrefs } from '../src/prefs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-decisions-'));
const env = {
  ...process.env,
  BUFFY_HOME: home,
  BUFFY_FREEBUFF_HOME: `${home}/no-freebuff`,
  CLAUDE_CONFIG_DIR: `${home}/no-claude`,
};
delete env.BUFFY_PORT;
const prefsFile = path.join(home, 'preferences.json');

const baseConfig = readConfig(env);
const config = { ...baseConfig, port: 0, watch: { ...baseConfig.watch, enabled: false } };
const daemon = await startDaemon({ config, env, quiet: true });
const base = `http://127.0.0.1:${daemon.port}`;
fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify({ port: daemon.port }, null, 2)}\n`);

function writePrefs(enabled) {
  const next = defaultPrefs();
  next.permissions.claudeDecisions = enabled;
  fs.writeFileSync(prefsFile, `${JSON.stringify(next, null, 2)}\n`);
}

async function state() {
  const response = await fetch(`${base}/state`);
  return response.json();
}

function waitFor(check, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      try {
        const result = await check();
        if (result) return resolve(result);
      } catch {
        /* keep polling while the daemon starts */
      }
      if (Date.now() >= deadline) return reject(new Error('timed out waiting for permission state'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function postRaw(pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: daemon.port,
        path: pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function startHook(payload) {
  const child = spawn(process.execPath, [BIN, 'hook', 'claude', 'PermissionRequest'], {
    env,
    cwd: ROOT,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve) => {
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  child.stdin.end(JSON.stringify(payload));
  return { child, done };
}

async function dismissAll() {
  const snapshot = await state();
  for (const session of snapshot.sessions || []) {
    await postRaw('/session/dismiss', { sessionId: session.id });
  }
}

const sse = http.get(
  { host: '127.0.0.1', port: daemon.port, path: '/events', headers: { accept: 'text/event-stream' } },
  (res) => {
    res.on('data', () => {});
    res.on('error', () => {});
  },
);
sse.on('error', () => {});

test.after(async () => {
  sse.destroy();
  await daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('permission decisions are off by default and do not hold the hook', async () => {
  writePrefs(false);
  const hook = startHook({
    hook_event_name: 'PermissionRequest',
    session_id: 'default-off',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    permission_request_id: 'default-off-request',
  });
  const result = await hook.done;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');

  const snapshot = await state();
  const request = snapshot.pendingRequestsList.find((entry) => entry.sessionId === 'claude:default-off');
  assert.ok(request);
  assert.equal(request.decisionId, null);
  await dismissAll();
});

test('an opted-in permission request can be allowed only with the daemon token', async () => {
  writePrefs(true);
  const runtime = JSON.parse(fs.readFileSync(path.join(home, 'runtime.json'), 'utf8'));
  assert.equal(runtime.controlToken, daemon.controlToken);
  await waitFor(async () => (await fetch(`${base}/health`).then((response) => response.json())).overlayConnected);

  const hook = startHook({
    hook_event_name: 'PermissionRequest',
    session_id: 'allow-session',
    cwd: 'C:/work/app',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    permission_request_id: 'allow-request',
  });
  const snapshotWithRequest = await waitFor(async () => {
    const snapshot = await state();
    return snapshot.pendingRequestsList.some((entry) => entry.sessionId === 'claude:allow-session') ? snapshot : null;
  });
  const request = snapshotWithRequest.pendingRequestsList.find(
    (entry) => entry.sessionId === 'claude:allow-session',
  );
  assert.equal(request.id, 'allow-request');
  assert.match(request.decisionId, /^[a-f0-9-]{16,96}$/);
  assert.equal(JSON.stringify(snapshotWithRequest).includes(daemon.controlToken), false);

  const missing = await postRaw('/permission/decision', { id: request.decisionId, behavior: 'allow' });
  assert.equal(missing.status, 403);
  const wrong = await postRaw(
    '/permission/decision',
    { id: request.decisionId, behavior: 'allow' },
    { 'x-buffy-control': 'not-the-token' },
  );
  assert.equal(wrong.status, 403);
  const foreignOrigin = await postRaw(
    '/permission/decision',
    { id: request.decisionId, behavior: 'allow' },
    { origin: 'https://example.test', 'x-buffy-control': daemon.controlToken },
  );
  assert.equal(foreignOrigin.status, 403);

  const allowed = await postRaw(
    '/permission/decision',
    { id: request.decisionId, behavior: 'allow' },
    { 'x-buffy-control': daemon.controlToken },
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.decision.behavior, 'allow');

  const result = await hook.done;
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');

  const snapshot = await state();
  assert.equal(snapshot.pendingRequests, 0);
  assert.equal(snapshot.current.state, 'working');
  assert.equal(snapshot.current.message, 'permission allowed');
});

test('a denied permission returns a deny decision to Claude', async () => {
  writePrefs(true);
  const hook = startHook({
    hook_event_name: 'PermissionRequest',
    session_id: 'deny-session',
    tool_name: 'Write',
    tool_input: { file_path: 'C:/work/app/notes.txt' },
    permission_request_id: 'deny-request',
  });
  const request = await waitFor(async () => {
    const snapshot = await state();
    return snapshot.pendingRequestsList.find((entry) => entry.sessionId === 'claude:deny-session');
  });

  const denied = await postRaw(
    '/permission/decision',
    { id: request.decisionId, behavior: 'deny' },
    { 'x-buffy-control': daemon.controlToken },
  );
  assert.equal(denied.status, 200);

  const result = await hook.done;
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(output.hookSpecificOutput.decision.message, 'Denied from Buffy');

  const snapshot = await state();
  assert.equal(snapshot.pendingRequests, 0);
  assert.equal(snapshot.current.message, 'permission denied');
});

test('an unanswered permission request times out and leaves the decision to Claude', { timeout: 15_000 }, async () => {
  writePrefs(true);
  await waitFor(async () => (await fetch(`${base}/health`).then((response) => response.json())).overlayConnected);

  const startedAt = Date.now();
  const hook = startHook({
    hook_event_name: 'PermissionRequest',
    session_id: 'timeout-session',
    tool_name: 'Bash',
    tool_input: { command: 'echo no-response' },
    permission_request_id: 'timeout-request',
  });
  const request = await waitFor(async () => {
    const snapshot = await state();
    return snapshot.pendingRequestsList.find((entry) => entry.sessionId === 'claude:timeout-session');
  });
  assert.match(request.decisionId, /^[a-f0-9-]{16,96}$/);

  const result = await hook.done;
  const elapsed = Date.now() - startedAt;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  // The daemon's eight-second waiter, not the hook's ten-second HTTP timeout,
  // must release Claude. Empty stdout means Claude's native prompt proceeds.
  assert.ok(elapsed >= 7900, `the unanswered request returned too early (${elapsed}ms)`);
  assert.ok(elapsed < 9500, `the unanswered request did not time out at eight seconds (${elapsed}ms)`);

  const snapshot = await state();
  const expired = snapshot.pendingRequestsList.find((entry) => entry.sessionId === 'claude:timeout-session');
  assert.ok(expired);
  assert.equal(expired.decisionId, null);
  assert.equal(snapshot.current.state, 'needs-you');
  assert.notEqual(snapshot.current.message, 'permission allowed');
  assert.notEqual(snapshot.current.message, 'permission denied');
  await dismissAll();
});
