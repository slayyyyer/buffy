import test from 'node:test';
import assert from 'node:assert/strict';

import { createMachine, normalizeState } from '../src/machine.js';

test('normalizes aliases and rejects unknown states', () => {
  assert.equal(normalizeState('needs_you'), 'needs-you');
  assert.equal(normalizeState('Finished'), 'done');
  assert.equal(normalizeState('  WORKING '), 'working');
  assert.throws(() => normalizeState('dancing'), /unknown state/);
});

test('dispatch records seq, message and source', () => {
  const machine = createMachine({ doneHoldMs: 1000 });
  const first = machine.dispatch({ state: 'thinking', message: 'reading', source: 'claude' }, 1000);
  assert.equal(first.state, 'thinking');
  assert.equal(first.message, 'reading');
  assert.equal(first.source, 'claude');
  assert.equal(first.seq, 1);

  const second = machine.dispatch({ state: 'working', source: 'freebuff' }, 2000);
  assert.equal(second.seq, 2);
  assert.equal(second.message, null);
  assert.equal(second.source, 'freebuff');
});

test('done falls back to idle after the hold window', () => {
  const machine = createMachine({ doneHoldMs: 1000 });
  machine.dispatch({ state: 'done', source: 'claude' }, 10_000);

  assert.equal(machine.snapshot(10_500).state, 'done');
  assert.equal(machine.tick(10_999), false);
  assert.equal(machine.tick(11_000), true);

  const snapshot = machine.snapshot(11_001);
  assert.equal(snapshot.state, 'idle');
  assert.equal(snapshot.message, null);
  assert.equal(snapshot.source, 'claude');
});

test('needs-you is sticky', () => {
  const machine = createMachine({ doneHoldMs: 1000 });
  machine.dispatch({ state: 'needs-you', message: 'permission?' }, 0);
  assert.equal(machine.tick(60_000), false);
  assert.equal(machine.snapshot(60_000).state, 'needs-you');
  assert.equal(machine.snapshot(60_000).message, 'permission?');
});

test('done timestamp is exposed only while holding', () => {
  const machine = createMachine({ doneHoldMs: 500 });
  machine.dispatch({ state: 'done' }, 1_000);
  assert.equal(machine.snapshot(1_100).until, 1_500);
  machine.dispatch({ state: 'working' }, 1_200);
  assert.equal(machine.snapshot(1_200).until, null);
});

test('concurrent sessions aggregate by urgency', () => {
  const machine = createMachine({ doneHoldMs: 1_000, sessionTtlMs: 60_000 });
  machine.dispatch({ state: 'working', source: 'claude', sessionId: 'session-a', message: 'editing' }, 1_000);

  const needs = machine.dispatch(
    { state: 'needs-you', source: 'claude', sessionId: 'session-b', message: 'approve?' },
    2_000,
  );
  assert.equal(needs.state, 'needs-you');
  assert.equal(needs.sessionId, 'session-b');
  assert.equal(needs.sessions.length, 2);

  const stillNeeds = machine.dispatch(
    { state: 'working', source: 'claude', sessionId: 'session-a', message: 'still editing' },
    3_000,
  );
  assert.equal(stillNeeds.state, 'needs-you');
  assert.equal(stillNeeds.message, 'approve?');

  const afterDone = machine.dispatch({ state: 'done', source: 'claude', sessionId: 'session-b' }, 4_000);
  assert.equal(afterDone.state, 'working');
  assert.equal(afterDone.sessionId, 'session-a');
});

test('idle and untagged events do not clear other sessions', () => {
  const machine = createMachine({ doneHoldMs: 1_000, sessionTtlMs: 60_000 });
  machine.dispatch({ state: 'working', source: 'claude', sessionId: 'session-a' }, 1_000);
  machine.dispatch({ state: 'thinking', source: 'freebuff', sessionId: 'session-b' }, 2_000);

  const afterIdle = machine.dispatch({ state: 'idle', source: 'claude', sessionId: 'session-a' }, 3_000);
  assert.equal(afterIdle.state, 'thinking');
  assert.equal(afterIdle.sessionId, 'session-b');

  const afterAll = machine.dispatch({ state: 'idle', source: 'freebuff', sessionId: 'session-b' }, 4_000);
  assert.equal(afterAll.state, 'idle');
  assert.equal(afterAll.sessions.length, 0);
});

test('untagged events use their source as the session', () => {
  const machine = createMachine({ doneHoldMs: 1_000, sessionTtlMs: 60_000 });
  machine.dispatch({ state: 'needs-you', source: 'freebuff' }, 1_000);

  const snapshot = machine.dispatch({ state: 'working', source: 'claude' }, 2_000);
  assert.equal(snapshot.state, 'needs-you');
  assert.equal(snapshot.source, 'freebuff');
  assert.deepEqual(snapshot.sessions.map((session) => session.id).sort(), ['claude', 'freebuff']);
});

test('sessions expire after sessionTtlMs', () => {
  const machine = createMachine({ doneHoldMs: 1_000, sessionTtlMs: 1_000 });
  machine.dispatch({ state: 'needs-you', sessionId: 'session-a' }, 1_000);

  assert.equal(machine.tick(1_500), false);
  assert.equal(machine.snapshot(1_500).state, 'needs-you');
  assert.equal(machine.tick(2_000), true);
  assert.equal(machine.snapshot(2_001).state, 'idle');
});
