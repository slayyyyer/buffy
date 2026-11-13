import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { loadClassic } from './helpers/classic.js';

const require = createRequire(import.meta.url);
const catalog = require('../overlay/catalog.cjs');

const { BUFFY_MANIFEST: manifest } = loadClassic(
  new URL('../overlay/characters/manifest.js', import.meta.url),
);
const context = loadClassic(new URL('../overlay/character-system.js', import.meta.url), {
  BUFFY_MANIFEST: manifest,
});
const { poseFor, atlasPose } = context.BuffyCharacters;

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

test('the atlas companions keep nine poses each', () => {
  for (const character of manifest.characters.filter((entry) => entry.renderer === 'atlas')) {
    assert.equal(character.supportedPoses.length, 9, `${character.id} should support nine poses`);
    assert.equal(character.order.length, 9, `${character.id} should order nine poses`);
    assert.deepEqual(character.order, character.supportedPoses, `${character.id} order should match its supported poses`);
  }
});

test('every reaction borrows a real nine-cell mood on the atlas cast', () => {
  for (const reaction of REACTIONS) {
    const cell = atlasPose(reaction);
    assert.ok(manifest.poses.includes(cell), `${reaction} maps to ${cell}, which is not a nine-cell pose`);
  }
});

test('every companion ships its character art', () => {
  assert.equal(
    manifest.characters.map((character) => character.id).join(','),
    'buffy,mochi,pip,mallow,fairy,retro-robot,knight,fox-wizard,little-ghost,red-panda,axolotl,clockwork-inventor,tiny-witch,star-keeper,little-vampire,cloud-shepherd,moon-bunny,wise-owl,tiny-pirate-captain,ribbon-dancer,sun-prince,dapper-gent',
  );
  for (const character of manifest.characters) {
    assert.ok(character.name);
    assert.ok(character.tagline);
    const assets = [];
    if (character.renderer === 'atlas') {
      assets.push(character.atlas);
    } else {
      assets.push(character.base, ...Object.values(character.poses || {}));
    }
    assets.push(...Object.values(character.outfitAssets || {}));
    for (const slot of Object.values(character.accessoryAssets || {})) {
      assets.push(...Object.values(slot));
    }
    for (const rel of assets) {
      assert.ok(fs.existsSync(new URL(`../overlay/characters/${rel}`, import.meta.url)), `${character.id} is missing ${rel}`);
    }
  }
});

test('atlas companions expose complete wardrobe assets', () => {
  for (const id of ['pip', 'mallow']) {
    const character = catalog.getCharacter(id);
    for (const slot of ['outfit', 'bow', 'hat', 'glasses', 'wand']) {
      for (const value of catalog.allowedItems(character, slot)) {
        if (value === 'none') continue;
        const rel = catalog.assetFor(character, slot, value);
        assert.ok(rel, `${id} ${slot}/${value} has no asset entry`);
        assert.ok(fs.existsSync(new URL(`../overlay/characters/${rel}`, import.meta.url)), `${id} ${slot}/${value} is missing ${rel}`);
      }
    }
    const builtins = catalog.looksFor(id, { looks: [] });
    assert.equal(builtins.length, 2);
    for (const preset of builtins) {
      assert.equal(catalog.isLookAvailable(preset.look, id), true, `${preset.name} has an unavailable item`);
    }
  }
});

test('Buffy ships every catalog outfit, including the new dress collection', () => {
  const buffy = catalog.getCharacter('buffy');
  const outfits = catalog.allowedItems(buffy, 'outfit');
  const newDresses = [
    'pink-princess',
    'blue-princess',
    'fairy-dress',
    'ballet-tutu',
    'rosebud-ballgown',
    'lavender-lace',
    'cherry-sundress',
    'pearl-party',
    'cranberry-bow-dress',
    'moonlit-tulle',
  ];
  for (const id of newDresses) {
    assert.ok(outfits.includes(id), `${id} is missing from Buffy's wardrobe`);
  }
  assert.ok(outfits.includes('tulip-skirt'), 'the skirt outfit is missing');
  for (const id of outfits) {
    if (id === 'none') continue;
    const rel = catalog.assetFor(buffy, 'outfit', id);
    assert.ok(rel, `buffy outfit/${id} has no asset entry`);
    assert.ok(
      fs.existsSync(new URL(`../overlay/characters/${rel}`, import.meta.url)),
      `buffy outfit/${id} is missing ${rel}`,
    );
  }
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
