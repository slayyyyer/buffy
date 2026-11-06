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
