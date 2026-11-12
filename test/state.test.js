import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, normalizeState } from '../src/state.js';

test('new state stores the identity under companion', () => {
  const state = createState({ name: 'Buffy', seed: 7, now: 0 });
  assert.equal(state.version, 2);
  assert.equal(state.companion.name, 'Buffy');
  assert.equal(state.companion.seed, 7);
  assert.equal('pet' in state, false);
});

test('normalizes a companion identity and its counters', () => {
  const state = normalizeState({
    version: 1,
    companion: {
      name: 'Pip',
      seed: 42,
      sprite: { type: 'image', file: 'pip.png', prompt: 'a tiny cloud' },
    },
    counters: { events: 4, hellos: 5, sessions: 2 },
  });

  assert.equal(state.version, 2);
  assert.equal(state.companion.name, 'Pip');
  assert.equal(state.companion.seed, 42);
  assert.equal(state.companion.sprite.type, 'image');
  assert.equal(state.companion.sprite.file, 'pip.png');
  assert.equal(state.companion.sprite.prompt, 'a tiny cloud');
  assert.deepEqual(state.counters, { events: 4, hellos: 5, sessions: 2 });
  assert.equal('pet' in state, false);
});
