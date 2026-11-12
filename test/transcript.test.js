import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyTranscript,
  createTranscriptAdapter,
  listTranscripts,
  parseEntries,
  readTail,
} from '../src/transcript.js';

const NOW = 1_800_000_000_000;
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const toolUse = (id, name, offset = 0) => ({
  type: 'assistant',
  timestamp: at(offset),
  cwd: 'C:/work/project',
  message: { content: [{ type: 'tool_use', id, name }], stop_reason: 'tool_use' },
});

const toolResult = (id, offset = 0) => ({
  type: 'user',
  timestamp: at(offset),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

test('a tool call without a result is working', () => {
  const event = classifyTranscript([toolUse('t1', 'Bash')], { now: NOW });
  assert.equal(event.state, 'working');
  assert.equal(event.category, 'running');
  assert.equal(event.message, 'using Bash');
  assert.equal(event.observed, 'inferred');
  assert.equal(event.cwd, 'C:/work/project');
});

test('a result followed by a finished turn is done, once', () => {
  const entries = [
    toolUse('t1', 'Read', -2_000),
    toolResult('t1', -1_500),
    {
      type: 'assistant',
      timestamp: at(-1_000),
      message: { content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn' },
    },
  ];
  const event = classifyTranscript(entries, { now: NOW, doneWindowMs: 60_000 });
  assert.equal(event.state, 'done');
  assert.equal(event.completedAt, NOW - 1_000);

  assert.equal(
    classifyTranscript(entries, { now: NOW + 120_000, doneWindowMs: 60_000 }),
    null,
    'an old completion is not replayed',
  );
});

test('a bare prompt is thinking', () => {
  const event = classifyTranscript(
    [{ type: 'user', timestamp: at(-500), message: { content: [{ type: 'text', text: 'fix the tests' }] } }],
    { now: NOW },
  );
  assert.equal(event.state, 'thinking');
});

test('a tool that never returned eventually ends the session', () => {
  const event = classifyTranscript([toolUse('t1', 'Bash', -11 * 60_000)], {
    now: NOW,
    stuckMs: 10 * 60_000,
  });
  assert.equal(event.state, 'idle');
  assert.equal(event.message, 'Claude stopped reporting');
});

test('silence is never reported as a question or a pass', () => {
  const event = classifyTranscript([toolUse('t1', 'Bash', -3 * 60_000)], { now: NOW });
  assert.equal(event.state, 'working');
  assert.equal('completionMessage' in event, false);
});

test('transcripts are parsed line by line and tolerate a torn tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-transcript-'));
  try {
    const root = path.join(dir, 'projects');
    const slug = path.join(root, '-work-project');
    fs.mkdirSync(slug, { recursive: true });
    const file = path.join(slug, 'session-abc.jsonl');
    const lines = [toolUse('t1', 'Edit', 0), toolResult('t1', 100)].map((entry) => JSON.stringify(entry));
    fs.writeFileSync(file, `${lines.join('\n')}\n{"type":"assistant","timest`);

    const found = listTranscripts({ root, now: Date.now(), activeMs: 60 * 60_000 });
    assert.equal(found.length, 1);
    assert.equal(found[0].sessionId, 'session-abc');

    const entries = parseEntries(readTail(file).text);
    assert.equal(entries.length, 2, 'the torn last line is skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the adapter reports a session id the claude hook can share', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-transcript-'));
  try {
    const root = path.join(dir, 'projects');
    const slug = path.join(root, '-work-project');
    fs.mkdirSync(slug, { recursive: true });
    // The active window is measured against real time, so this fixture does too.
    const live = Date.now();
    const entry = {
      type: 'assistant',
      timestamp: new Date(live).toISOString(),
      cwd: 'C:/work/project',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Write' }], stop_reason: 'tool_use' },
    };
    fs.writeFileSync(path.join(slug, 'session-live.jsonl'), `${JSON.stringify(entry)}\n`);

    const events = [];
    const adapter = createTranscriptAdapter({ root, now: () => live, onEvent: (event) => events.push(event) });
    adapter.sample();

    assert.equal(events.length, 1);
    assert.equal(events[0].sessionId, 'session-live');
    assert.equal(events[0].state, 'working');
    assert.equal(events[0].observed, 'inferred');
    adapter.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the adapter yields to hooks and stays quiet with no claude install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-transcript-'));
  try {
    const empty = createTranscriptAdapter({ root: path.join(dir, 'missing'), now: () => NOW });
    assert.equal(empty.sample(), null);
    assert.equal(empty.state().available, false);
    empty.close();

    const root = path.join(dir, 'projects');
    const slug = path.join(root, '-work-project');
    fs.mkdirSync(slug, { recursive: true });
    const live = Date.now();
    const entry = {
      type: 'assistant',
      timestamp: new Date(live).toISOString(),
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }], stop_reason: 'tool_use' },
    };
    fs.writeFileSync(path.join(slug, 'session-abc.jsonl'), `${JSON.stringify(entry)}\n`);

    const events = [];
    const yielded = createTranscriptAdapter({
      root,
      now: () => live,
      shouldYield: (event) => event.sessionId === 'session-abc',
      onEvent: (event) => events.push(event),
    });
    yielded.sample();
    assert.deepEqual(events, []);
    yielded.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
