import test from 'node:test';
import assert from 'node:assert/strict';

import { createMachine } from '../src/machine.js';

test('a working session goes quiet without being deleted', () => {
  const machine = createMachine({ doneHoldMs: 30_000, sessionTtlMs: 30 * 60_000, livenessMs: 90_000 });
  machine.dispatch({ state: 'working', sessionId: 'claude', message: 'using Bash' }, 1_000);

  const early = machine.snapshot(60_000);
  assert.equal(early.quiet, false, 'a recent event is live');
  assert.equal(early.sessions[0].quiet, false);

  const later = machine.snapshot(1_000 + 95_000);
  assert.equal(later.state, 'working', 'the session is still active');
  assert.equal(later.quiet, true);
  assert.equal(later.quietForMs, 95_000);
  assert.equal(later.sessions.length, 1, 'quiet does not delete the session');
  assert.equal(later.sessions[0].quiet, true);
});

test('a long build keeps its session for the full ttl while quiet', () => {
  const machine = createMachine({ sessionTtlMs: 30 * 60_000, livenessMs: 90_000 });
  machine.dispatch({ state: 'working', sessionId: 'claude' }, 0);
  assert.equal(machine.snapshot(10 * 60_000).quiet, true);
  assert.equal(machine.snapshot(10 * 60_000).sessions.length, 1);
  assert.equal(machine.tick(10 * 60_000), false);
});

test('an unanswered request is never quiet', () => {
  const machine = createMachine({ sessionTtlMs: 30 * 60_000, livenessMs: 1_000 });
  machine.dispatch(
    { state: 'working', sessionId: 'claude', request: { kind: 'permission', label: 'Claude needs Bash' } },
    0,
  );
  const snapshot = machine.snapshot(120_000);
  assert.equal(snapshot.state, 'needs-you');
  assert.equal(snapshot.quiet, false);
  assert.equal(snapshot.sessions[0].quiet, false);
});

test('done and error are not liveness states', () => {
  const machine = createMachine({ doneHoldMs: 10 * 60_000, livenessMs: 1_000 });
  machine.dispatch({ state: 'error', sessionId: 'claude', message: 'boom' }, 0);
  assert.equal(machine.snapshot(60_000).quiet, false);
});

test('idle snapshots report no quiet state', () => {
  const machine = createMachine();
  const snapshot = machine.snapshot(5_000);
  assert.equal(snapshot.state, 'idle');
  assert.equal(snapshot.quiet, false);
  assert.equal(snapshot.quietForMs, 0);
});
