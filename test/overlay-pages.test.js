import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../overlay/${name}`, import.meta.url), 'utf8');

test('the overlay loads character.js before renderer.js', () => {
  const html = read('index.html');
  assert.ok(html.includes('character.js'));
  assert.ok(html.includes('renderer.js'));
  assert.ok(html.indexOf('character.js') < html.indexOf('renderer.js'));
});

test('the overlay loads hobbies.js before renderer.js', () => {
  const html = read('index.html');
  assert.ok(html.includes('hobbies.js'));
  assert.ok(html.indexOf('hobbies.js') < html.indexOf('renderer.js'));
});

test('the wardrobe page loads character.js before its own script', () => {
  const html = read('wardrobe.html');
  assert.ok(html.includes('character.js'));
  assert.ok(html.includes('wardrobe.js'));
  assert.ok(html.indexOf('character.js') < html.indexOf('wardrobe.js'));
});

test('the wardrobe preload exposes the window API', () => {
  const preload = read('wardrobe-preload.cjs');
  assert.match(preload, /buffyWardrobe/);
  assert.match(preload, /wardrobe:update/);
});
