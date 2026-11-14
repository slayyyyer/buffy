import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCask, inspectCask, releasePublished } from '../scripts/check-cask.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caskText = fs.readFileSync(path.join(ROOT, 'Casks', 'buffy.rb'), 'utf8');

test('the shipped cask is internally consistent', () => {
  const result = inspectCask(caskText);
  assert.deepEqual(result.problems, []);
  assert.match(result.declared, /^\d+\.\d+\.\d+$/);
  assert.equal(result.hashes.length, 2);
});

test('a truncated hash and a hardcoded url are both rejected', () => {
  const broken = caskText
    .replace(/sha256 arm: +"[0-9a-f]{64}"/, 'sha256 arm:   "abc"')
    .replace(/url "https:\/\/[^"]+"/, 'url "https://example.com/Buffy-3.3.4.dmg"');
  const { problems } = inspectCask(broken);
  assert.ok(problems.some((problem) => /one sha256 per architecture/.test(problem)));
  assert.ok(problems.some((problem) => /does not interpolate the version/.test(problem)));
});

test('being behind is tolerated only while the release has no assets', async () => {
  const unpublished = await checkCask({ version: '9.9.9', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.deepEqual(unpublished.problems, []);
  assert.equal(unpublished.notes.length, 1);

  const published = await checkCask({ version: '9.9.9', fetchImpl: async () => ({ ok: true }) });
  assert.ok(published.problems.some((problem) => /is published/.test(problem)));
});

test('a release probe treats network errors as unpublished', async () => {
  assert.equal(await releasePublished('9.9.9', async () => ({ ok: false, status: 500 })), false);
  assert.equal(
    await releasePublished('9.9.9', async () => {
      throw new Error('offline');
    }),
    false,
  );
});
