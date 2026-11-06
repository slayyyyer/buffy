import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wardrobe = require('../overlay/wardrobe-catalog.cjs');

test('migrates a v1 wardrobe without losing a choice', () => {
  const result = wardrobe.normalizeWardrobe({ bow: 'lavender', hat: 'party', wand: true, theme: 'mint' });
  assert.equal(result.version, 2);
  assert.equal(result.outfit, 'princess');
  assert.equal(result.bow, 'lavender');
  assert.equal(result.hat, 'party');
  assert.equal(result.glasses, 'none');
  assert.equal(result.wand, 'star');
  assert.equal(result.theme, 'mint');
  assert.equal(result.presets.length, 0);
});

test('falls back per slot for unknown values', () => {
  const result = wardrobe.normalizeWardrobe({
    outfit: 'astronaut',
    bow: 'neon',
    hat: 'crown',
    glasses: 'x-ray',
    wand: 'laser',
    theme: 'void',
  });
  const look = wardrobe.lookOf(result);
  for (const key of Object.keys(wardrobe.DEFAULTS)) {
    assert.equal(look[key], wardrobe.DEFAULTS[key]);
  }
});

test('saves, applies, finds, and removes a user preset', () => {
  const base = wardrobe.normalizeWardrobe({});
  const saved = wardrobe.addPreset(base, '  Date night  ', { id: 'p1', now: '2026-11-06T21:00:00.000Z' });
  assert.equal(saved.error, null);
  assert.equal(saved.preset.name, 'Date night');
  assert.equal(saved.wardrobe.presets.length, 1);
  assert.equal(wardrobe.findPreset(saved.wardrobe, 'p1').name, 'Date night');
  const applied = wardrobe.applyLook(saved.wardrobe, { ...wardrobe.lookOf(base), theme: 'sky' });
  assert.equal(applied.theme, 'sky');
  assert.equal(applied.presets.length, 1);
  assert.equal(wardrobe.removePreset(applied, 'p1').wardrobe.presets.length, 0);
});

test('rejects empty, long, duplicate, and over-limit preset names', () => {
  const base = wardrobe.normalizeWardrobe({});
  assert.match(wardrobe.addPreset(base, '   ', { id: 'p1' }).error, /name/i);
  assert.match(wardrobe.addPreset(base, 'x'.repeat(25), { id: 'p1' }).error, /24/);
  const first = wardrobe.addPreset(base, 'Date night', { id: 'p1' });
  assert.match(wardrobe.addPreset(first.wardrobe, 'date NIGHT', { id: 'p2' }).error, /already/i);
  let current = base;
  for (let i = 0; i < 12; i += 1) current = wardrobe.addPreset(current, `Look ${i}`, { id: `p${i}` }).wardrobe;
  assert.match(wardrobe.addPreset(current, 'One more', { id: 'p12' }).error, /12/);
});

test('randomLook uses the injected random and stays inside the catalog', () => {
  const look = wardrobe.randomLook(() => 0.5);
  for (const slot of wardrobe.SLOTS) {
    assert.ok(slot.items.some((item) => item.id === look[slot.id]), `${slot.id} value not in catalog`);
  }
});

test('built-in looks are available and cannot be deleted', () => {
  const base = wardrobe.normalizeWardrobe({});
  for (const id of ['builtin-royal', 'builtin-cozy', 'builtin-starlight']) {
    assert.ok(wardrobe.findPreset(base, id), `${id} missing`);
  }
  assert.match(wardrobe.removePreset(base, 'builtin-royal').error, /built-in/i);
});

test('applying a built-in preserves user presets', () => {
  const base = wardrobe.normalizeWardrobe({});
  const saved = wardrobe.addPreset(base, 'Mine', { id: 'p1' }).wardrobe;
  const royal = wardrobe.findPreset(saved, 'builtin-royal');
  const applied = wardrobe.applyLook(saved, royal.look);
  assert.equal(applied.presets.length, 1);
  assert.equal(wardrobe.sameLook(applied, royal.look), true);
});
