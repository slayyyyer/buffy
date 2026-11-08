import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadClassic } from './helpers/classic.js';

const { BUFFY_MANIFEST: manifest } = loadClassic(
  new URL('../overlay/characters/manifest.js', import.meta.url),
);
const context = loadClassic(new URL('../overlay/character-system.js', import.meta.url), {
  BUFFY_MANIFEST: manifest,
});
const { poseFor } = context.BuffyCharacters;

const REACTIONS = ['flustered', 'tapping', 'squish', 'waiting', 'celebrate'];

test('Buffy declares every reaction pose and ships its art', () => {
  const buffy = manifest.characters.find((character) => character.id === 'buffy');
  for (const pose of REACTIONS) {
    assert.ok(buffy.supportedPoses.includes(pose), `${pose} is missing from supportedPoses`);
    assert.ok(fs.existsSync(new URL(`../overlay/characters/${buffy.poses[pose]}`, import.meta.url)), `${pose}.svg is missing`);
  }
});

test('Mochi keeps its nine-cell atlas', () => {
  const mochi = manifest.characters.find((character) => character.id === 'mochi');
  assert.equal(mochi.supportedPoses.length, 9);
  assert.equal(mochi.order.length, 9);
});

test('state and explicit signals resolve to the reaction poses', () => {
  assert.equal(poseFor({ state: 'error' }), 'flustered');
  assert.equal(poseFor({ state: 'needs-you' }), 'tapping');
  assert.equal(poseFor({ state: 'working', category: 'compacting' }), 'squish');
  assert.equal(poseFor({ state: 'working', waiting: true }), 'waiting');
  assert.equal(poseFor({ state: 'working', waiting: true, celebration: true }), 'celebrate');
  assert.equal(poseFor({ state: 'done' }), 'happy');
  assert.equal(poseFor({ state: 'working' }), 'typingLeft');
});
