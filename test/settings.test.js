import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULTS, normalizeOverlaySettings } = require('../overlay/settings.cjs');

test('overlay settings default to hobbies on and a two-minute sleep', () => {
  assert.equal(DEFAULTS.idleHobbies, true);
  assert.equal(DEFAULTS.sleepAfterMs, 120000);
  assert.equal(normalizeOverlaySettings(undefined).idleHobbies, true);
  assert.equal(normalizeOverlaySettings(undefined).sleepAfterMs, 120000);
});

test('sleep is clamped and the hobbies switch is explicit', () => {
  assert.equal(normalizeOverlaySettings({ sleepAfterMs: 1000 }).sleepAfterMs, 30000);
  assert.equal(normalizeOverlaySettings({ sleepAfterMs: 999999 }).sleepAfterMs, 600000);
  assert.equal(normalizeOverlaySettings({ sleepAfterMs: 'nope' }).sleepAfterMs, 120000);
  assert.equal(normalizeOverlaySettings({ idleHobbies: false }).idleHobbies, false);
  assert.equal(normalizeOverlaySettings({ idleHobbies: true }).idleHobbies, true);
});
