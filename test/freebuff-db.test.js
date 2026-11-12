import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyFreebuffThread,
  createFreebuffAdapter,
  listFreebuffProjects,
} from '../src/freebuff.js';

// `node:sqlite` is unflagged from Node 22.13. The adapter already reports
// itself unavailable below that, so these tests skip instead of failing a
// checkout that the package still supports.
const sqlite = await import('node:sqlite').catch(() => null);
const DatabaseSync = sqlite?.DatabaseSync ?? null;
const needsSqlite = DatabaseSync
  ? {}
  : { skip: 'node:sqlite needs Node 22.13+; the adapter reports unavailable below that' };
const sqliteTest = (name, fn) => test(name, needsSqlite, fn);

const NOW = 1_800_000_000_000;

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-freebuff-'));
}

function writeProject(root, name, { thread, parts = null, outType = null, queue = [] }) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'desktop-v2.db');
  const db = new DatabaseSync(file);
  db.exec(`
    create table threads (
      id text primary key,
      title text,
      updated_at integer,
      turn_state text,
      agent_mode text,
      attention_reason text,
      last_turn_outcome text,
      turn_alive_at integer,
      last_turn_finished_at integer,
      harness_state text
    );
    create table messages (seq integer primary key, thread_id text, role text, parts_json text);
    create table queue_items (id text primary key, thread_id text, state text);
  `);
  db.prepare(
    `insert into threads (id, title, updated_at, turn_state, agent_mode, attention_reason,
       last_turn_outcome, turn_alive_at, last_turn_finished_at, harness_state)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    thread.id,
    thread.title || 'a thread',
    thread.updated_at,
    thread.turn_state,
    thread.agent_mode || 'build',
    thread.attention_reason ?? null,
    thread.last_turn_outcome ?? null,
    thread.turn_alive_at ?? null,
    thread.last_turn_finished_at ?? null,
    parts ? JSON.stringify({ runtimeMove: { parts, output: { type: outType } } }) : null,
  );
  for (const [index, item] of queue.entries()) {
    db.prepare('insert into queue_items (id, thread_id, state) values (?, ?, ?)').run(
      `q-${index}`,
      thread.id,
      item,
    );
  }
  db.close();
  return file;
}

const runningThread = (overrides = {}) => ({
  id: 'thread-1',
  title: 'build the thing',
  updated_at: NOW - 500,
  turn_state: 'running',
  turn_alive_at: NOW - 500,
  ...overrides,
});

sqliteTest('reasoning, tools, edits and compaction map onto Buffy events', () => {
  const base = { thread: runningThread(), now: NOW };

  assert.deepEqual(classifyFreebuffThread({ ...base, part: { kind: 'reasoning' } }), {
    state: 'thinking',
    category: 'thinking',
    message: 'thinking it through',
    observed: 'explicit',
  });

  assert.deepEqual(classifyFreebuffThread({ ...base, part: { kind: 'tool', toolName: 'read_files' } }), {
    state: 'working',
    category: 'reading',
    message: 'using read_files',
    observed: 'explicit',
  });

  assert.deepEqual(classifyFreebuffThread({ ...base, part: { kind: 'changes' } }), {
    state: 'working',
    category: 'editing',
    message: 'editing files',
    observed: 'explicit',
  });

  assert.deepEqual(classifyFreebuffThread({ ...base, part: { kind: 'compaction' } }), {
    state: 'working',
    category: 'compacting',
    message: 'compacting context',
    observed: 'explicit',
  });
});

sqliteTest('a failed tool reports an error rather than a working pose', () => {
  const event = classifyFreebuffThread({
    thread: runningThread(),
    part: { kind: 'tool', toolName: 'run_terminal_command', exitCode: 2 },
    now: NOW,
  });
  assert.equal(event.state, 'error');
  assert.equal(event.message, 'run_terminal_command failed');
});

sqliteTest('an attention reason is a real needs-you, not a silence guess', () => {
  const event = classifyFreebuffThread({
    thread: runningThread({ attention_reason: 'waiting_for_approval' }),
    part: { kind: 'tool', toolName: 'run_terminal_command' },
    now: NOW,
  });
  assert.equal(event.state, 'needs-you');
  assert.equal(event.message, 'Freebuff is waiting: waiting for approval');
});

sqliteTest('an abandoned running turn stops pretending to work', () => {
  const event = classifyFreebuffThread({
    thread: runningThread({ turn_alive_at: NOW - 10 * 60_000 }),
    part: null,
    now: NOW,
    staleMs: 120_000,
  });
  assert.equal(event.state, 'idle');
  assert.equal(event.message, 'Freebuff stopped reporting');
});

sqliteTest('a live tool part keeps a slow turn alive past the heartbeat window', () => {
  const event = classifyFreebuffThread({
    thread: runningThread({ turn_alive_at: NOW - 10 * 60_000 }),
    part: { kind: 'tool', toolName: 'run_terminal_command', status: 'running' },
    now: NOW,
  });
  assert.equal(event.state, 'working');
});

sqliteTest('a finished turn is reported once, inside the window', () => {
  const thread = {
    id: 'thread-1',
    turn_state: 'idle',
    updated_at: NOW - 5_000,
    last_turn_finished_at: NOW - 5_000,
    last_turn_outcome: 'completed',
  };
  const event = classifyFreebuffThread({ thread, now: NOW, doneWindowMs: 60_000 });
  assert.equal(event.state, 'done');
  assert.equal(event.completedAt, thread.last_turn_finished_at);

  assert.equal(classifyFreebuffThread({ thread, now: NOW + 120_000, doneWindowMs: 60_000 }), null);
});

sqliteTest('an old completed turn never replays when buffy starts', () => {
  const thread = {
    id: 'thread-1',
    turn_state: 'idle',
    updated_at: NOW - 3_600_000,
    last_turn_finished_at: NOW - 3_600_000,
    last_turn_outcome: 'completed',
  };
  assert.equal(classifyFreebuffThread({ thread, now: NOW }), null);
});

sqliteTest('project databases are ranked by their newest write', () => {
  const root = makeRoot();
  try {
    writeProject(root, 'old', { thread: { id: 'a', updated_at: NOW - 60_000, turn_state: 'idle' } });
    const fresh = writeProject(root, 'fresh', {
      thread: { id: 'b', updated_at: NOW, turn_state: 'idle' },
    });
    const projects = listFreebuffProjects({ root });
    assert.equal(projects.length, 2);
    assert.equal(projects[0].file, fresh);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

sqliteTest('the adapter dispatches once per change and stays silent on errors', async () => {
  const root = makeRoot();
  try {
    writeProject(root, 'proj-a', {
      thread: runningThread(),
      parts: [{ kind: 'tool', toolName: 'code_search' }],
    });

    const events = [];
    const adapter = createFreebuffAdapter({
      root,
      now: () => NOW,
      onEvent: (event) => events.push(event),
    });

    await adapter.sample();
    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'working');
    assert.equal(events[0].category, 'searching');
    assert.equal(events[0].project, 'proj-a');

    await adapter.sample();
    assert.equal(events.length, 1, 'an unchanged turn is not re-dispatched');
    assert.equal(adapter.state().available, true);
    adapter.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

sqliteTest('the adapter yields to a fresh explicit event', async () => {
  const root = makeRoot();
  try {
    writeProject(root, 'proj-a', {
      thread: runningThread(),
      parts: [{ kind: 'tool', toolName: 'read_files' }],
    });
    const events = [];
    const adapter = createFreebuffAdapter({
      root,
      now: () => NOW,
      shouldYield: () => true,
      onEvent: (event) => events.push(event),
    });
    await adapter.sample();
    assert.deepEqual(events, []);
    adapter.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

sqliteTest('a missing freebuff install is silent', async () => {
  const root = path.join(makeRoot(), 'nothing-here');
  const events = [];
  const adapter = createFreebuffAdapter({ root, now: () => NOW, onEvent: (event) => events.push(event) });
  const result = await adapter.sample();
  assert.equal(result, null);
  assert.deepEqual(events, []);
  assert.equal(adapter.state().available, false);
  assert.equal(adapter.state().reason, 'no freebuff projects');
  adapter.close();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

sqliteTest('an unchanged tick opens no database, a changed one still dispatches', async () => {
  const root = makeRoot();
  try {
    const file = writeProject(root, 'proj-a', {
      thread: { id: 'thread-1', title: 'quiet', updated_at: NOW - 60_000, turn_state: 'idle' },
    });

    const events = [];
    const adapter = createFreebuffAdapter({
      root,
      now: () => NOW,
      pollMs: 200,
      idlePollMs: 5000,
      onEvent: (event) => events.push(event),
    });

    await adapter.sample();
    const opened = adapter.state().opens;
    assert.ok(opened > 0, 'the first tick reads the database');
    assert.equal(events.length, 0, 'an idle turn reports nothing');

    await adapter.sample();
    assert.equal(adapter.state().opens, opened, 'an unchanged tick opens nothing');
    assert.equal(adapter.state().skipped, 1);
    assert.deepEqual(events, []);

    // A real write moves the database's mtime, which is all the gate watches.
    await sleep(60);
    const db = new DatabaseSync(file);
    db.prepare(
      'update threads set turn_state = ?, turn_alive_at = ?, updated_at = ?, harness_state = ? where id = ?',
    ).run(
      'running',
      NOW,
      NOW,
      JSON.stringify({ runtimeMove: { parts: [{ kind: 'tool', toolName: 'read_files' }] } }),
      'thread-1',
    );
    db.close();

    await adapter.sample();
    assert.equal(events.length, 1, 'a changed database still dispatches');
    assert.equal(events[0].state, 'working');
    assert.equal(events[0].category, 'reading');
    assert.ok(adapter.state().opens > opened, 'the changed tick reads again');
    assert.equal(adapter.state().skipped, 1, 'the changed tick was not skipped');
    adapter.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
