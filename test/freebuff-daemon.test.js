import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';

const sqlite = await import('node:sqlite').catch(() => null);
const DatabaseSync = sqlite?.DatabaseSync ?? null;
const needsSqlite = DatabaseSync
  ? {}
  : { skip: 'node:sqlite needs Node 22.13+; the adapter reports unavailable below that' };
const sqliteTest = (name, fn) => test(name, needsSqlite, fn);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createProjectDatabase(root, name, parts) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'desktop-v2.db');
  const db = new DatabaseSync(file);
  db.exec(`
    create table threads (
      id text primary key, title text, updated_at integer, turn_state text,
      agent_mode text, attention_reason text, last_turn_outcome text,
      turn_alive_at integer, last_turn_finished_at integer, harness_state text
    );
    create table messages (seq integer primary key, thread_id text, role text, parts_json text);
    create table queue_items (id text primary key, thread_id text, state text);
  `);
  db.prepare(
    `insert into threads (id, title, updated_at, turn_state, agent_mode, turn_alive_at, harness_state)
     values ('thread-a', 'build the thing', ?, 'running', 'build', ?, ?)`,
  ).run(Date.now(), Date.now(), JSON.stringify({ runtimeMove: { parts } }));
  return { db, file };
}

function setParts(db, parts) {
  db.prepare('update threads set harness_state = ?, updated_at = ?, turn_alive_at = ? where id = ?').run(
    JSON.stringify({ runtimeMove: { parts } }),
    Date.now(),
    Date.now(),
    'thread-a',
  );
}

async function waitFor(check, timeoutMs = 4000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await check();
    if (last) return last;
    await sleep(100);
  }
  return last;
}

sqliteTest('the daemon reports a running freebuff turn and keeps following it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-fb-daemon-'));
  const freebuffHome = path.join(home, 'freebuff');
  fs.mkdirSync(freebuffHome, { recursive: true });
  const { db } = createProjectDatabase(freebuffHome, 'proj-a', [
    { kind: 'tool', toolName: 'read_files', status: 'running' },
  ]);

  const env = {
    ...process.env,
    BUFFY_HOME: home,
    BUFFY_FREEBUFF_HOME: freebuffHome,
    CLAUDE_CONFIG_DIR: path.join(home, 'no-claude'),
  };
  delete env.BUFFY_PORT;

  const base = readConfig(env);
  const daemon = await startDaemon({
    config: {
      ...base,
      port: 0,
      watch: { ...base.watch, enabled: false },
      freebuff: { ...base.freebuff, pollMs: 200, explicitGraceMs: 60_000 },
      claudeTranscript: { enabled: false },
    },
    env,
    quiet: true,
  });

  try {
    const state = () =>
      fetch(`http://127.0.0.1:${daemon.port}/state`).then((res) => res.json());

    const reading = await waitFor(async () => {
      const snapshot = await state();
      return snapshot.current.state === 'working' ? snapshot : null;
    });
    assert.ok(reading, 'the running turn reached the overlay');
    assert.equal(reading.current.source, 'freebuff-db');
    assert.equal(reading.current.category, 'reading');
    assert.equal(reading.current.message, 'using read_files');
    assert.equal(reading.sessions.length, 1, 'one session, not one per source');

    // A second, different update must not be swallowed by the adapter's own
    // previous event being "explicit" inside the grace window.
    setParts(db, [{ kind: 'changes' }]);
    const editing = await waitFor(async () => {
      const snapshot = await state();
      return snapshot.current.category === 'editing' ? snapshot : null;
    });
    assert.ok(editing, 'later freebuff updates keep arriving');
    assert.equal(editing.current.message, 'editing files');
    assert.equal(editing.sessions.length, 1);

    const health = await fetch(`http://127.0.0.1:${daemon.port}/health`).then((res) => res.json());
    assert.equal(health.adapters.freebuff.available, true);
    assert.equal(health.adapters.freebuff.enabled, true);
    assert.equal(health.adapters.claudeTranscript.enabled, false);
  } finally {
    db.close();
    await daemon.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

sqliteTest('an explicit AGENTS.md event wins over the database reader', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-fb-daemon-'));
  const freebuffHome = path.join(home, 'freebuff');
  fs.mkdirSync(freebuffHome, { recursive: true });
  const { db } = createProjectDatabase(freebuffHome, 'proj-a', [
    { kind: 'tool', toolName: 'read_files', status: 'running' },
  ]);

  const env = {
    ...process.env,
    BUFFY_HOME: home,
    BUFFY_FREEBUFF_HOME: freebuffHome,
    CLAUDE_CONFIG_DIR: path.join(home, 'no-claude'),
  };
  delete env.BUFFY_PORT;

  const base = readConfig(env);
  const daemon = await startDaemon({
    config: {
      ...base,
      port: 0,
      watch: { ...base.watch, enabled: false },
      freebuff: { ...base.freebuff, pollMs: 200 },
      claudeTranscript: { enabled: false },
    },
    env,
    quiet: true,
  });

  try {
    const baseUrl = `http://127.0.0.1:${daemon.port}`;
    const event = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: 'needs-you',
        source: 'freebuff',
        message: 'may I run the tests?',
        request: { kind: 'question', label: 'may I run the tests?' },
      }),
    }).then((res) => res.json());

    assert.equal(event.state.current.state, 'needs-you');
    assert.equal(event.state.current.source, 'freebuff');

    await sleep(800);
    const snapshot = await fetch(`${baseUrl}/state`).then((res) => res.json());
    assert.equal(snapshot.current.state, 'needs-you', 'the database never overrides a question');
    assert.equal(snapshot.current.message, 'may I run the tests?');
  } finally {
    db.close();
    await daemon.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
