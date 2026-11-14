import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishedHash, updateCask } from '../scripts/bump-cask.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cask = fs.readFileSync(path.join(ROOT, 'Casks', 'buffy.rb'), 'utf8');

const ARM = 'a'.repeat(64);
const INTEL = 'b'.repeat(64);

test('the rewrite repoints the version and both architecture hashes', () => {
  const next = updateCask(cask, { version: '9.9.9', arm: ARM, intel: INTEL });
  assert.match(next, /^ {2}version "9\.9\.9"$/m);
  assert.match(next, new RegExp(`sha256 arm: +"${ARM}"`));
  assert.match(next, new RegExp(`intel: "${INTEL}"`));
  assert.match(next, /Buffy-#\{version\}-mac-#\{arch\}\.dmg/, 'the interpolated url is untouched');
  assert.doesNotMatch(next, /8b3ba4866fc0/, 'the old arm hash is gone');
});

test('rewriting an already-current cask is a no-op', () => {
  const once = updateCask(cask, { version: '9.9.9', arm: ARM, intel: INTEL });
  assert.equal(updateCask(once, { version: '9.9.9', arm: ARM, intel: INTEL }), once);
});

test('a cask missing its stanzas is refused instead of half-rewritten', () => {
  assert.throws(() => updateCask('cask "buffy" do\nend\n', { version: '1.0.0', arm: ARM, intel: INTEL }), /version stanza/);
  assert.throws(
    () => updateCask('cask "buffy" do\n  version "1.0.0"\n  sha256 arm: "x"\nend\n', {
      version: '1.0.0',
      arm: ARM,
      intel: INTEL,
    }),
    /arm sha256|intel sha256/,
  );
});

test('a published checksum is read from the release asset', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    return { ok: true, text: async () => `${ARM.toUpperCase()}  Buffy-1.2.3-mac-arm64.dmg\n` };
  };
  assert.equal(await publishedHash('1.2.3', 'mac-arm64', fakeFetch), ARM);
  assert.match(requested[0], /releases\/download\/v1\.2\.3\/Buffy-1\.2\.3-mac-arm64\.dmg\.sha256$/);
});

test('a missing asset fails loudly', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => publishedHash('1.2.3', 'mac-x64', fakeFetch), /404/);
});
