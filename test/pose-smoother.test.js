import test from 'node:test';
import assert from 'node:assert/strict';

import { loadClassic } from './helpers/classic.js';

const context = loadClassic(new URL('../overlay/pose-smoother.js', import.meta.url));
const { createPoseSmoother, weightFor } = context.BuffyPoses;

test('the first pose is adopted immediately', () => {
  const smoother = createPoseSmoother();
  assert.equal(smoother.push('idle', 0), 'idle');
  assert.equal(smoother.current(), 'idle');
});

test('a new pose waits for confirmation and the minimum hold', () => {
  const smoother = createPoseSmoother({ confirmMs: 250, minHoldMs: 380 });
  smoother.push('idle', 0);

  assert.equal(smoother.push('reading', 100), 'idle', 'confirmed too early');
  assert.equal(smoother.push('reading', 300), 'idle', 'minimum hold not met');
  assert.equal(smoother.push('reading', 400), 'reading');
  assert.equal(smoother.current(), 'reading');
});

test('flapping between two poses never strobes the screen', () => {
  const smoother = createPoseSmoother({ confirmMs: 250, minHoldMs: 380 });
  smoother.push('idle', 0);
  const seen = new Set();
  for (let at = 0; at <= 1200; at += 50) {
    seen.add(smoother.push(at % 100 === 0 ? 'reading' : 'typingLeft', at));
    if (seen.size > 4) break;
  }
  assert.ok(seen.size <= 2, `saw ${[...seen].join(', ')}`);
});

test('a calmer pose does not interrupt a louder one straight away', () => {
  const smoother = createPoseSmoother({ confirmMs: 250, minHoldMs: 380 });
  smoother.push('celebrate', 0);
  assert.equal(smoother.push('idle', 300), 'celebrate');
  assert.equal(smoother.push('idle', 700), 'celebrate', 'still inside the louder hold');
  assert.equal(smoother.push('idle', 1200), 'idle');
});

test('a louder pose can interrupt immediately after the hold', () => {
  const smoother = createPoseSmoother({ confirmMs: 250, minHoldMs: 380 });
  smoother.push('typingLeft', 0);
  assert.equal(smoother.push('tapping', 150), 'typingLeft');
  assert.equal(smoother.push('tapping', 300), 'typingLeft');
  assert.equal(smoother.push('tapping', 400), 'tapping');
});

test('weights rank urgent poses above calm ones', () => {
  assert.ok(weightFor('celebrate') > weightFor('typingLeft'));
  assert.ok(weightFor('flustered') > weightFor('idle'));
  assert.equal(weightFor('unknown-pose'), 1);
});
