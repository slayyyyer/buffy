import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { VERSION } from '../src/config.js';

test('VERSION is sourced from package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+(?:[-+].*)?$/);
});
