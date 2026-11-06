import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from './helpers/classic.js';

const { createHobbyScheduler } = loadClassic(new URL('../overlay/hobbies.js', import.meta.url)).BuffyHobbies;
const first = () => 0;

test('the first hobby starts after eight idle seconds', () => {
  const scheduler = createHobbyScheduler({ now: 0, random: first });
  assert.equal(scheduler.update(7999), null);
  const hobby = scheduler.update(8000);
  assert.equal(hobby.id, 'reading');
  assert.equal(hobby.startedAt, 8000);
  assert.equal(hobby.endsAt, 28000);
});

test('hobbies never repeat immediately and leave a gap', () => {
  const scheduler = createHobbyScheduler({ now: 0, random: first });
  assert.equal(scheduler.update(8000).id, 'reading');
  assert.equal(scheduler.update(28000), null);
  assert.equal(scheduler.update(36999), null);
  assert.equal(scheduler.update(37000).id, 'coffee');
});

test('hover and busy clear a hobby and restart the delay', () => {
  const scheduler = createHobbyScheduler({ now: 0, random: first });
  assert.equal(scheduler.update(8000).id, 'reading');
  assert.equal(scheduler.update(9000, { hovered: true }), null);
  assert.equal(scheduler.update(16999), null);
  assert.equal(scheduler.update(17000).id, 'coffee');

  const busy = createHobbyScheduler({ now: 0, random: first });
  assert.equal(busy.update(8000).id, 'reading');
  assert.equal(busy.update(9000, { busy: true }), null);
  assert.equal(busy.update(17000).id, 'reading');
});

test('sleep finishes the active hobby and then wins', () => {
  const scheduler = createHobbyScheduler({ now: 0, random: first });
  assert.equal(scheduler.update(8000).id, 'reading');
  assert.equal(scheduler.update(28000), null);
  assert.equal(scheduler.update(37000).id, 'coffee');
  assert.equal(scheduler.update(53000), null);
  assert.equal(scheduler.update(62000).id, 'stretch');
  assert.equal(scheduler.update(69000), null);
  assert.equal(scheduler.update(78000).id, 'reading');
  assert.equal(scheduler.update(98000), null);
  assert.equal(scheduler.update(107000).id, 'coffee');
  assert.equal(scheduler.update(120000).id, 'coffee');
  assert.equal(scheduler.isAsleep(120000), false);
  assert.equal(scheduler.update(123000), null);
  assert.equal(scheduler.isAsleep(123000), true);
});

test('disabling hobbies keeps sleep and clears the active hobby', () => {
  const scheduler = createHobbyScheduler({ now: 0, random: first, idleHobbies: false });
  assert.equal(scheduler.update(119999), null);
  assert.equal(scheduler.update(120000), null);
  assert.equal(scheduler.isAsleep(120000), true);

  const active = createHobbyScheduler({ now: 0, random: first });
  assert.equal(active.update(8000).id, 'reading');
  active.configure({ idleHobbies: false });
  assert.equal(active.update(9000), null);
  assert.equal(active.isAsleep(9000), false);
});
