import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadClassic } from './helpers/classic.js';

const require = createRequire(import.meta.url);
const catalog = require('../overlay/wardrobe-catalog.cjs');
const { BuffyCharacter } = loadClassic(new URL('../overlay/character.js', import.meta.url));
const { BuffyHobbies } = loadClassic(new URL('../overlay/hobbies.js', import.meta.url));

function stubContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
      if (property === 'measureText') return () => ({ width: 0 });
      return () => {};
    },
    set() { return true; },
  });
}

const LOOK = { outfit: 'princess', bow: 'pink', hat: 'beret', glasses: 'none', wand: 'star', theme: 'rose' };

function drawLook(look, hobby = null) {
  return BuffyCharacter.draw(stubContext(), {
    now: 3000,
    state: 'idle',
    look,
    width: 300,
    height: 330,
    hobby,
  });
}

test('draws the placeholder character without throwing', () => {
  assert.ok(BuffyCharacter);
  assert.equal(BuffyCharacter.supports('outfit', 'princess'), true);
  assert.doesNotThrow(() => {
    BuffyCharacter.draw(stubContext(), { now: 1234, state: 'idle', look: LOOK, width: 300, height: 330 });
  });
});

test('draws a custom sprite without touching the procedural layers', () => {
  assert.doesNotThrow(() => {
    BuffyCharacter.draw(stubContext(), {
      now: 1234,
      state: 'idle',
      look: LOOK,
      width: 300,
      height: 330,
      customImage: { naturalWidth: 100, naturalHeight: 120 },
    });
  });
});

test('returns a palette copy for the active theme', () => {
  const colors = BuffyCharacter.colors({ ...LOOK, theme: 'mint' });
  assert.equal(colors.cloudTop, '#d9fff1');
  const sky = BuffyCharacter.paletteFor('sky');
  assert.equal(sky.hue, 205);
  assert.equal(sky.hue2, 265);
});

test('every catalog item has a drawing manifest entry', () => {
  for (const slot of catalog.SLOTS) {
    for (const item of slot.items) {
      assert.equal(BuffyCharacter.supports(slot.id, item.id), true, `${slot.id}/${item.id} has no drawing entry`);
    }
  }
});

test('draws every outfit, accessory, and theme without throwing', () => {
  for (const slot of catalog.SLOTS) {
    for (const item of slot.items) {
      assert.doesNotThrow(() => drawLook({ ...LOOK, [slot.id]: item.id }), `${slot.id}/${item.id}`);
    }
  }
});

test('every scheduled hobby has a drawing entry and a pose', () => {
  assert.equal(
    [...BuffyCharacter.HOBBIES].sort().join(','),
    BuffyHobbies.HOBBIES.map((hobby) => hobby.id).sort().join(','),
  );
  for (const hobby of BuffyHobbies.HOBBIES) {
    assert.doesNotThrow(() => drawLook(LOOK, { id: hobby.id, startedAt: 1000, endsAt: 30000 }), hobby.id);
  }
});
